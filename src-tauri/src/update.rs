//! 应用更新模块 (Application update module)
//!
//! 负责检查 GitHub Release、筛选适合当前平台的安装包、下载更新并调度安装时机。
//!
//! - 与前端通过 `update:available` / `update:downloaded` 等事件进行通信
//! - 支持自动更新与手动更新两种模式
//! - 通过缓存结构避免重复解析同一版本的 Release 元数据

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context};
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use time::format_description::well_known::Rfc3339;
use tokio::{fs as async_fs, io::AsyncWriteExt};

use crate::proxy::{build_client_with_proxy, ProxyTestConfig};

const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/200hub/ai-ask/releases";
const STORE_FILE: &str = "config.json";
const STORE_KEY_CONFIG: &str = "app_config";
const PENDING_UPDATE_FILE: &str = "pending-update.json";

/// 更新事件：检测到新版本可用（会推送给前端显示更新 Banner）
pub const EVENT_UPDATE_AVAILABLE: &str = "update:available";
/// 更新事件：更新安装包下载完成（用于提示用户安装或下次启动时自动安装）
pub const EVENT_UPDATE_DOWNLOADED: &str = "update:downloaded";

/// 下载任务状态
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Running,
    Completed,
    Failed,
}

/// 暴露给前端的 Release 资源信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub arch: Option<String>,
    pub download_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<Checksum>,
}

/// 资源校验信息占位结构（目前没有实际计算，预留扩展）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checksum {
    pub algo: String,
    pub value: String,
}

/// 暴露给前端的下载任务信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub status: DownloadStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub target_asset: ReleaseAsset,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
}

/// `check_update` 命令返回给前端的响应结构
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateResponse {
    pub has_update: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_prerelease: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    pub assets: Vec<ReleaseAsset>,
}

/// 触发 `update:available` 事件时携带的负载结构
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAvailablePayload {
    version: String,
    assets: Vec<ReleaseAsset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    release_url: Option<String>,
}

/// 触发 `update:downloaded` 事件时携带的负载结构
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadedPayload {
    version: String,
    task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
}

/// 内部缓存的单个资源数据，用于避免重复解析 GitHub API 响应
#[derive(Debug, Clone)]
struct CachedAsset {
    id: u64,
    meta: ReleaseAsset,
}

/// 内部缓存的 Release 元数据
#[derive(Debug, Clone)]
struct CachedRelease {
    version: String,
    is_prerelease: bool,
    published_at: Option<String>,
    release_notes: Option<String>,
    release_url: Option<String>,
    assets: Vec<CachedAsset>,
}

/// 内部下载任务状态，包含暴露给前端的部分以及仅 Rust 侧使用的字段
#[derive(Debug, Clone)]
struct DownloadTaskInternal {
    task: DownloadTask,
    release_version: String,
    download_path: Option<PathBuf>,
}

#[derive(Default)]
struct UpdateState {
    releases: HashMap<String, CachedRelease>,
    downloads: HashMap<String, Arc<Mutex<DownloadTaskInternal>>>,
}

struct UpdateManager {
    state: Mutex<UpdateState>,
}

impl UpdateManager {
    fn global() -> &'static UpdateManager {
        static INSTANCE: OnceLock<UpdateManager> = OnceLock::new();
        INSTANCE.get_or_init(|| UpdateManager {
            state: Mutex::new(UpdateState::default()),
        })
    }

    fn store_release(&self, release: CachedRelease) {
        let mut state = self
            .state
            .lock()
            .expect("update manager mutex poisoned during store_release");
        state.releases.insert(release.version.clone(), release);
    }

    fn get_release(&self, version: &str) -> Option<CachedRelease> {
        let state = self
            .state
            .lock()
            .expect("update manager mutex poisoned during get_release");
        state.releases.get(version).cloned()
    }

    fn store_download(&self, task_id: String, task: Arc<Mutex<DownloadTaskInternal>>) {
        let mut state = self
            .state
            .lock()
            .expect("update manager mutex poisoned during store_download");
        state.downloads.insert(task_id, task);
    }

    fn get_download(&self, task_id: &str) -> Option<Arc<Mutex<DownloadTaskInternal>>> {
        let state = self
            .state
            .lock()
            .expect("update manager mutex poisoned during get_download");
        state.downloads.get(task_id).cloned()
    }
}

#[derive(Debug, Clone, Default)]
struct UpdateConfig {
    auto_update_enabled: bool,
    proxy: Option<ProxyTestConfig>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct StoredProxyConfig {
    #[serde(rename = "type")]
    proxy_type: Option<String>,
    host: Option<String>,
    port: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct StoredConfig {
    #[serde(default)]
    auto_update_enabled: bool,
    #[serde(default)]
    proxy: Option<StoredProxyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingInstall {
    version: String,
    task_id: String,
    file_path: String,
    scheduled_at: String,
}

/// Initialize update system: apply pending updates and trigger startup check.
pub fn init(app: AppHandle) {
    log::info!("update manager init");
    tauri::async_runtime::spawn(async move {
        if let Err(err) = apply_pending_update(&app).await {
            log::warn!("apply pending update failed: {}", err);
        }

        if let Err(err) = perform_startup_check(&app).await {
            log::warn!("startup update check failed: {}", err);
        }
    });
}

/// Check whether an update exists
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<CheckUpdateResponse, String> {
    let config = load_config(&app)?;
    match fetch_latest_release(&app, &config).await {
        Ok(Some(release)) => {
            let response = CheckUpdateResponse {
                has_update: true,
                latest_version: Some(release.version.clone()),
                is_prerelease: Some(release.is_prerelease),
                published_at: release.published_at.clone(),
                release_notes: release.release_notes.clone(),
                release_url: release.release_url.clone(),
                assets: release
                    .assets
                    .iter()
                    .map(|asset| asset.meta.clone())
                    .collect(),
            };
            Ok(response)
        }
        Ok(None) => Ok(CheckUpdateResponse {
            has_update: false,
            latest_version: None,
            is_prerelease: None,
            published_at: None,
            release_notes: None,
            release_url: None,
            assets: vec![],
        }),
        Err(err) => Err(err.to_string()),
    }
}

/// Download selected asset
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    version: String,
    asset_id: String,
) -> Result<DownloadTask, String> {
    let config = load_config(&app)?;
    log::info!(
        "download_update command: version={} asset_id={}",
        version,
        asset_id
    );
    let release = match UpdateManager::global().get_release(&version) {
        Some(r) => r,
        None => fetch_latest_release(&app, &config)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| "Target release not found".to_string())?,
    };

    let asset = release
        .assets
        .iter()
        .find(|asset| asset.meta.id == asset_id || asset.id.to_string() == asset_id)
        .cloned()
        .ok_or_else(|| "Target release asset not found".to_string())?;

    let handle = start_download(&app, &release, &asset, &config)
        .await
        .map_err(|err| err.to_string())?;

    let task = handle
        .lock()
        .map_err(|_| "Download task state unavailable".to_string())?
        .task
        .clone();

    Ok(task)
}

/// Query download task status
#[tauri::command]
pub async fn get_download_status(_app: AppHandle, task_id: String) -> Result<DownloadTask, String> {
    let manager = UpdateManager::global();
    let task = manager
        .get_download(&task_id)
        .ok_or_else(|| "Download task does not exist".to_string())?;

    let state = task
        .lock()
        .map_err(|_| "Download task state unavailable".to_string())?;
    Ok(state.task.clone())
}

/// Schedule install on next launch
#[tauri::command]
pub async fn schedule_install(app: AppHandle, task_id: String) -> Result<(), String> {
    let manager = UpdateManager::global();
    let download = manager
        .get_download(&task_id)
        .ok_or_else(|| "Download task does not exist".to_string())?;

    let (installer_path, version, _) = extract_installation_info(&download)?;

    let pending = PendingInstall {
        version,
        task_id,
        file_path: installer_path.to_string_lossy().to_string(),
        scheduled_at: now_iso(),
    };

    store_pending_install(&app, &pending)?;
    log::info!(
        "Scheduled install on next launch: version={}, task_id={}, path={}",
        pending.version,
        pending.task_id,
        pending.file_path
    );
    Ok(())
}

/// Install the downloaded update immediately by launching the installer and exiting the app.
#[tauri::command]
pub async fn install_update_now(app: AppHandle, task_id: String) -> Result<(), String> {
    let manager = UpdateManager::global();
    let download = manager
        .get_download(&task_id)
        .ok_or_else(|| "Download task does not exist".to_string())?;

    let (installer_path, release_version, asset_name) = extract_installation_info(&download)?;

    if !installer_path.exists() {
        return Err(format!(
            "Installer file missing: {}",
            installer_path.display()
        ));
    }

    log::info!(
        "Launching installer immediately: version={} task_id={} asset={} path={}",
        release_version,
        task_id,
        asset_name,
        installer_path.display()
    );

    let launch_path = installer_path.clone();
    let log_path = installer_path.clone();
    tauri::async_runtime::spawn_blocking(move || launch_installer(&launch_path))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| {
            log::error!(
                "Failed to launch installer immediately: path={} error={}",
                log_path.display(),
                err
            );
            err
        })?;

    if let Err(err) = clear_pending_install(&app) {
        log::warn!(
            "Failed to clear pending install after immediate launch: {}",
            err
        );
    }

    log::info!(
        "Installer launched successfully, exiting application for version={}",
        release_version
    );

    app.exit(0);
    Ok(())
}

/// Extract installer information from a completed download task.
fn extract_installation_info(
    download: &Arc<Mutex<DownloadTaskInternal>>,
) -> Result<(PathBuf, String, String), String> {
    let state = download
        .lock()
        .map_err(|_| "Download task state unavailable".to_string())?;

    if state.task.status != DownloadStatus::Completed {
        return Err("Download not completed".into());
    }

    let path = state
        .download_path
        .clone()
        .ok_or_else(|| "Downloaded installer path missing".to_string())?;

    let release_version = state.release_version.clone();
    let asset_name = state.task.target_asset.name.clone();

    Ok((path, release_version, asset_name))
}

/// Apply pending update on startup
async fn apply_pending_update(app: &AppHandle) -> Result<(), String> {
    let pending = match load_pending_install(app)? {
        Some(pending) => pending,
        None => return Ok(()),
    };

    let path = PathBuf::from(&pending.file_path);
    if !path.exists() {
        log::warn!(
            "Pending update missing, cancel install path={}",
            pending.file_path
        );
        clear_pending_install(app)?;
        return Ok(());
    }

    log::info!(
        "Pending update detected, launching installer: version={}, path={}",
        pending.version,
        pending.file_path
    );

    // Installation usually involves platform-specific installer; here we simply launch the downloaded file.
    let spawn_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = launch_installer(&spawn_path) {
            log::error!(
                "Failed to launch installer: path={}, error={}",
                spawn_path.display(),
                err
            );
        }
    })
    .await
    .map_err(|err| err.to_string())?;

    clear_pending_install(app)?;
    Ok(())
}

/// Startup update check logic
async fn perform_startup_check(app: &AppHandle) -> Result<(), String> {
    let config = load_config(app)?;
    let result = fetch_latest_release(app, &config)
        .await
        .map_err(|err| err.to_string())?;

    let Some(release) = result else {
        return Ok(());
    };

    let payload = UpdateAvailablePayload {
        version: release.version.clone(),
        assets: release.assets.iter().map(|a| a.meta.clone()).collect(),
        published_at: release.published_at.clone(),
        release_notes: release.release_notes.clone(),
        release_url: release.release_url.clone(),
    };

    if let Err(err) = app.emit(EVENT_UPDATE_AVAILABLE, &payload) {
        log::error!("Failed to emit update:available event: {}", err);
    }

    if config.auto_update_enabled {
        if let Some(asset) = select_asset_for_current_platform(&release.assets) {
            log::info!(
                "Auto update enabled, start download version={}, asset={}",
                release.version,
                asset.meta.name
            );
            let app_handle = app.clone();
            let release_clone = release.clone();
            let config_clone = config.clone();
            let asset_clone = asset.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) =
                    start_download(&app_handle, &release_clone, &asset_clone, &config_clone).await
                {
                    log::error!("Auto download update failed: {}", err);
                }
            });
        } else {
            log::warn!(
                "No matching asset for current platform, skip auto download: version={}",
                release.version
            );
        }
    }

    Ok(())
}

/// Execute download
async fn start_download(
    app: &AppHandle,
    release: &CachedRelease,
    asset: &CachedAsset,
    config: &UpdateConfig,
) -> Result<Arc<Mutex<DownloadTaskInternal>>, anyhow::Error> {
    let task_id = format!(
        "dl-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let started_at = now_iso();
    let mut task = DownloadTaskInternal {
        task: DownloadTask {
            id: task_id.clone(),
            status: DownloadStatus::Running,
            started_at: started_at.clone(),
            completed_at: None,
            error: None,
            target_asset: asset.meta.clone(),
            bytes_total: None,
            bytes_downloaded: Some(0),
        },
        release_version: release.version.clone(),
        download_path: None,
    };

    let download_dir = ensure_updates_dir(app)?;
    let sanitized_name = sanitize_filename(&asset.meta.name);
    let file_path = download_dir.join(format!("{}-{}", release.version, sanitized_name));

    let manager = UpdateManager::global();
    let shared = Arc::new(Mutex::new(task.clone()));
    manager.store_download(task_id.clone(), Arc::clone(&shared));

    let app_handle = app.clone();
    let asset_clone = asset.clone();
    let config_clone = config.clone();
    let shared_clone = Arc::clone(&shared);
    let file_path_for_spawn = file_path.clone();

    log::info!(
        "start download task={} version={} asset={} url={}",
        task_id,
        release.version,
        asset.meta.name,
        asset.meta.download_url
    );

    tauri::async_runtime::spawn(async move {
        let download_path = file_path_for_spawn;
        if let Err(err) = perform_download(
            app_handle,
            Arc::clone(&shared_clone),
            &asset_clone,
            download_path.as_path(),
            &config_clone,
        )
        .await
        {
            log::error!(
                "download update failed: asset={} error={}",
                asset_clone.meta.name,
                err
            );
            // 确保任务状态被更新为失败（如果 perform_download 内部没有更新的话）
            update_task_status(&shared_clone, DownloadStatus::Failed, Some(err.to_string()));
        }
    });

    task.download_path = Some(file_path.clone());
    let mut guard = shared.lock().expect("download mutex poisoned after spawn");
    guard.download_path = Some(file_path);
    Ok(Arc::clone(&shared))
}

async fn perform_download(
    app: AppHandle,
    shared: Arc<Mutex<DownloadTaskInternal>>,
    asset: &CachedAsset,
    file_path: &Path,
    config: &UpdateConfig,
) -> Result<(), anyhow::Error> {
    let client = build_http_client(&app, config)?;
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_str(&build_user_agent(&app))?);

    let request = client.get(&asset.meta.download_url).headers(headers);

    let response_result = request.send().await;
    let mut response = match response_result {
        Ok(resp) => resp,
        Err(err) => {
            let error_msg = format!("Failed to send download request: {}", err);
            update_task_status(&shared, DownloadStatus::Failed, Some(error_msg.clone()));
            return Err(anyhow!(error_msg));
        }
    };

    if !response.status().is_success() {
        update_task_status(
            &shared,
            DownloadStatus::Failed,
            Some(format!("download failed, status {}", response.status())),
        );
        return Err(anyhow!("download failed, status {}", response.status()));
    }

    let total = response.content_length();
    {
        let mut guard = shared
            .lock()
            .map_err(|_| anyhow!("Download task state unavailable"))?;
        guard.task.bytes_total = total;
        guard.task.bytes_downloaded = Some(0);
    }

    if let Some(parent) = file_path.parent() {
        async_fs::create_dir_all(parent)
            .await
            .context("Failed to create update directory")?;
    }

    let mut file = async_fs::File::create(file_path)
        .await
        .with_context(|| format!("Failed to create update file: {}", file_path.display()))?;

    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .context("Failed to read download data")?
    {
        file.write_all(&chunk)
            .await
            .with_context(|| format!("Failed to write update file: {}", file_path.display()))?;
        downloaded += chunk.len() as u64;

        let mut guard = shared
            .lock()
            .map_err(|_| anyhow!("Download task state unavailable"))?;
        guard.task.bytes_downloaded = Some(downloaded);
    }

    file.flush().await.ok();

    {
        let mut guard = shared
            .lock()
            .map_err(|_| anyhow!("Download task state unavailable"))?;
        guard.task.status = DownloadStatus::Completed;
        guard.task.completed_at = Some(now_iso());
        guard.download_path = Some(file_path.to_path_buf());
        guard.task.bytes_downloaded = Some(downloaded);
    }

    let payload = UpdateDownloadedPayload {
        version: {
            let guard = shared
                .lock()
                .map_err(|_| anyhow!("Download task state unavailable"))?;
            guard.release_version.clone()
        },
        task_id: {
            let guard = shared
                .lock()
                .map_err(|_| anyhow!("Download task state unavailable"))?;
            guard.task.id.clone()
        },
        file_path: Some(file_path.to_string_lossy().to_string()),
    };

    if let Err(err) = app.emit(EVENT_UPDATE_DOWNLOADED, &payload) {
        log::error!("Failed to emit update:downloaded event: {}", err);
    }

    log::info!(
        "download finished: task={} version={} bytes={} path={}",
        payload.task_id,
        payload.version,
        downloaded,
        file_path.display()
    );

    Ok(())
}

fn update_task_status(
    task: &Arc<Mutex<DownloadTaskInternal>>,
    status: DownloadStatus,
    error: Option<String>,
) {
    if let Ok(mut guard) = task.lock() {
        guard.task.status = status.clone();
        guard.task.error = error.clone();
        if status == DownloadStatus::Failed {
            guard.task.completed_at = Some(now_iso());
        }
    }
}

async fn fetch_latest_release(
    app: &AppHandle,
    config: &UpdateConfig,
) -> Result<Option<CachedRelease>, anyhow::Error> {
    let client = build_http_client(app, config)?;
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_str(&build_user_agent(app))?);
    headers.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );

    let request = client
        .get(GITHUB_RELEASES_API)
        .query(&[("per_page", "5")])
        .headers(headers);

    let response = request
        .send()
        .await
        .context("failed to fetch GitHub releases")?;

    if !response.status().is_success() {
        return Err(anyhow!(
            "GitHub releases request failed, status {}",
            response.status()
        ));
    }

    let releases: Vec<GithubRelease> = response
        .json()
        .await
        .context("failed to parse GitHub Releases response")?;

    let current_version = current_version(app)?;
    log::info!("update check start: current_version={}", current_version);
    log::info!(
        "matching assets for platform={} arch={}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let mut candidates: Vec<(Version, GithubRelease)> = releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter_map(|release| parse_version(&release.tag_name).map(|v| (v, release)))
        .collect();

    candidates.sort_by(|a, b| b.0.cmp(&a.0));

    log::debug!("candidate releases count={}", candidates.len());

    for (version, release) in candidates {
        if should_skip_release(&current_version, &version, &release) {
            continue;
        }

        let cached = build_cached_release(version.to_string(), release.clone())?;
        let asset_summary = cached
            .assets
            .iter()
            .map(|asset| {
                let arch = asset.meta.arch.as_deref().unwrap_or("unspecified");
                format!(
                    "{}(platform={} arch={})",
                    asset.meta.name, asset.meta.platform, arch
                )
            })
            .collect::<Vec<_>>()
            .join(", ");

        if cached.assets.is_empty() {
            log::warn!(
                "release {} has no matching assets for platform={} arch={}, skip (classified=[])",
                cached.version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            continue;
        } else {
            log::info!(
                "release {} classified assets: [{}]",
                cached.version,
                asset_summary
            );
        }

        let release_type = if release.prerelease {
            "pre-release"
        } else {
            "stable"
        };
        log::info!(
            "found newer {} release: version={} published_at={:?}",
            release_type,
            cached.version,
            cached.published_at
        );
        UpdateManager::global().store_release(cached.clone());
        return Ok(Some(cached));
    }

    log::info!(
        "no newer release available (current_version={})",
        current_version
    );
    Ok(None)
}

fn should_skip_release(
    current_version: &Version,
    release_version: &Version,
    release: &GithubRelease,
) -> bool {
    if release.prerelease {
        if current_version.pre.is_empty() {
            log::debug!(
                "skip pre-release on stable channel: tag={} version={}",
                release.tag_name,
                release_version
            );
            return true;
        }
        if release_version <= current_version {
            log::debug!(
                "skip non-newer pre-release: tag={} version={} (current={})",
                release.tag_name,
                release_version,
                current_version
            );
            return true;
        }
        return false;
    }

    if release_version <= current_version {
        log::debug!(
            "skip non-newer release: tag={} version={} (current<=target)",
            release.tag_name,
            release_version
        );
        return true;
    }

    false
}

fn build_cached_release(
    version: String,
    release: GithubRelease,
) -> Result<CachedRelease, anyhow::Error> {
    let mut assets = Vec::new();
    let mut skipped_assets = Vec::new();

    let release_notes = release
        .body
        .clone()
        .map(|notes| notes.trim().to_string())
        .filter(|notes| !notes.is_empty());
    let release_url = release.html_url.clone();
    let is_prerelease = release.prerelease;
    let published_at = release.published_at.clone();

    for asset in release.assets.into_iter() {
        match classify_asset(&asset.name) {
            Some((platform, arch)) => {
                log::info!(
                    "classified asset {} => platform={} arch={:?}",
                    asset.name,
                    platform,
                    arch
                );
                assets.push(CachedAsset {
                    id: asset.id,
                    meta: ReleaseAsset {
                        id: asset.id.to_string(),
                        name: asset.name.clone(),
                        platform: platform.to_string(),
                        arch: arch.map(|value| value.to_string()),
                        download_url: asset.browser_download_url.clone(),
                        size: Some(asset.size.unwrap_or(0)),
                        checksum: None,
                    },
                });
            }
            None => {
                log::warn!("skip asset {}: unknown platform/arch", asset.name);
                skipped_assets.push(asset.name);
            }
        }
    }

    if assets.is_empty() && !skipped_assets.is_empty() {
        log::warn!(
            "no assets classified for release={}, skipped_assets={:?}",
            version,
            skipped_assets
        );
    }

    Ok(CachedRelease {
        version,
        is_prerelease,
        published_at,
        release_notes,
        release_url,
        assets,
    })
}

fn load_config(app: &AppHandle) -> Result<UpdateConfig, String> {
    let resolver = app.path();
    let config_path = resolver
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join(STORE_FILE);

    let Ok(data) = fs::read_to_string(&config_path) else {
        return Ok(UpdateConfig::default());
    };

    let value: serde_json::Value = serde_json::from_str(&data).map_err(|err| err.to_string())?;
    let stored: StoredConfig = value
        .get(STORE_KEY_CONFIG)
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let proxy = stored.proxy.map(|proxy| {
        let proxy_type = proxy.proxy_type.unwrap_or_else(|| "system".into());
        ProxyTestConfig {
            proxy_type,
            host: proxy.host,
            port: proxy.port,
        }
    });

    Ok(UpdateConfig {
        auto_update_enabled: stored.auto_update_enabled,
        proxy,
    })
}

fn store_pending_install(app: &AppHandle, pending: &PendingInstall) -> Result<(), String> {
    let resolver = app.path();
    let dir = resolver.app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let path = dir.join(PENDING_UPDATE_FILE);
    let data = serde_json::to_string_pretty(pending).map_err(|err| err.to_string())?;
    fs::write(path, data).map_err(|err| err.to_string())
}

fn load_pending_install(app: &AppHandle) -> Result<Option<PendingInstall>, String> {
    let resolver = app.path();
    let path = resolver
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join(PENDING_UPDATE_FILE);

    if !path.exists() {
        return Ok(None);
    }

    let data = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let pending: PendingInstall = serde_json::from_str(&data).map_err(|err| err.to_string())?;
    Ok(Some(pending))
}

fn clear_pending_install(app: &AppHandle) -> Result<(), String> {
    let resolver = app.path();
    let path = resolver
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join(PENDING_UPDATE_FILE);
    if path.exists() {
        fs::remove_file(path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn build_http_client(
    app: &AppHandle,
    config: &UpdateConfig,
) -> Result<reqwest::Client, anyhow::Error> {
    // 下载大文件需要更长的超时时间
    // connect_timeout: 连接超时 30 秒
    // timeout: 整体请求超时（包括下载），设置为 30 分钟以支持大文件
    // 使用 native-tls 后端，兼容性更好（rustls 在某些代理环境下有问题）
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(30 * 60)); // 30 minutes for large file downloads

    if let Some(proxy) = &config.proxy {
        builder = match build_client_with_proxy(proxy) {
            Ok(client) => return Ok(client),
            Err(err) => {
                log::warn!(
                    "failed to build http client with proxy config, fallback to default: {}",
                    err
                );
                reqwest::Client::builder()
                    .connect_timeout(Duration::from_secs(30))
                    .timeout(Duration::from_secs(30 * 60))
            }
        };
    }

    builder
        .user_agent(build_user_agent(app))
        .build()
        .map_err(|err| err.into())
}

fn build_user_agent(app: &AppHandle) -> String {
    format!(
        "{}/{} (+https://github.com/200hub/ai-ask)",
        app.package_info().name,
        app.package_info().version
    )
}

fn current_version(app: &AppHandle) -> Result<Version, anyhow::Error> {
    let version = app.package_info().version.to_string();
    Version::parse(&version).map_err(|err| err.into())
}

fn parse_version(tag: &str) -> Option<Version> {
    let trimmed = tag.trim_start_matches('v');
    Version::parse(trimmed).ok()
}

fn classify_asset(name: &str) -> Option<(&'static str, Option<&'static str>)> {
    let lower = name.to_lowercase();

    let platform = if lower.ends_with(".exe")
        || lower.ends_with(".msi")
        || lower.contains("windows")
        || lower.contains("win32")
        || lower.contains("win64")
    {
        "windows"
    } else if lower.ends_with(".dmg")
        || lower.contains("macos")
        || lower.contains("darwin")
        || lower.contains("mac")
    {
        "macos"
    } else if lower.ends_with(".appimage")
        || lower.ends_with(".deb")
        || lower.ends_with(".rpm")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".tar.xz")
        || lower.contains("linux")
    {
        "linux"
    } else if lower.ends_with(".apk") || lower.contains("android") {
        "android"
    } else if lower.contains("ios") {
        "ios"
    } else {
        return None;
    };

    let arch = if lower.contains("arm64") || lower.contains("aarch64") || lower.contains("armv8") {
        Some("arm64")
    } else if lower.contains("x64") || lower.contains("amd64") || lower.contains("x86_64") {
        Some("x64")
    } else if lower.contains("arm") && lower.contains("64") {
        Some("arm64")
    } else if lower.contains("universal") {
        Some("universal")
    } else {
        None
    };

    Some((platform, arch))
}

fn select_asset_for_current_platform(assets: &[CachedAsset]) -> Option<CachedAsset> {
    let current_platform = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        "android" => "android",
        "ios" => "ios",
        _ => "windows",
    };

    let current_arch = match std::env::consts::ARCH {
        "x86_64" => Some("x64"),
        "aarch64" => Some("arm64"),
        _ => None,
    };

    // Prefer platform + architecture match
    if let Some(asset) = assets.iter().find(|asset| {
        asset.meta.platform == current_platform
            && (asset.meta.arch.is_none()
                || current_arch.is_none()
                || asset.meta.arch.as_deref() == current_arch)
    }) {
        log::info!(
            "select update asset={} (platform match, arch match) for platform={} arch={:?}",
            asset.meta.name,
            current_platform,
            current_arch
        );
        return Some(asset.clone());
    }

    // Fallback: match by platform only
    if let Some(asset) = assets
        .iter()
        .find(|asset| asset.meta.platform == current_platform)
    {
        log::info!(
            "select update asset={} (platform match) for platform={} arch={:?}",
            asset.meta.name,
            current_platform,
            current_arch
        );
        return Some(asset.clone());
    }

    log::warn!(
        "no asset matched for platform={} arch={:?}",
        current_platform,
        current_arch
    );

    None
}

fn ensure_updates_dir(app: &AppHandle) -> Result<PathBuf, anyhow::Error> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| anyhow!(err.to_string()))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|err| anyhow!(err.to_string()))?;
    Ok(dir)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// Launch the downloaded installer using platform-specific tooling.
fn launch_installer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if extension == "msi" {
            std::process::Command::new("msiexec")
                .args(["/i", &path.to_string_lossy(), "/passive", "/norestart"])
                .spawn()
                .map_err(|err| err.to_string())?;
        } else {
            std::process::Command::new(path)
                .spawn()
                .map_err(|err| err.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("chmod")
            .args(["+x", &path.to_string_lossy()])
            .spawn()
            .map_err(|err| err.to_string())
            .ok();

        std::process::Command::new(path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Deserialize, Clone)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize, Clone)]
struct GithubAsset {
    id: u64,
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_release(tag: &str, prerelease: bool) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            draft: false,
            prerelease,
            published_at: Some("2025-01-01T00:00:00Z".into()),
            body: Some("- Fix issue #1\n- Add new feature".into()),
            html_url: Some("https://example.com/releases".into()),
            assets: vec![],
        }
    }

    #[test]
    fn classify_asset_matches_windows_arm() {
        let result = classify_asset("AIAsk-setup-win-arm64.exe");
        assert_eq!(result, Some(("windows", Some("arm64"))));
    }

    #[test]
    fn classify_asset_matches_windows_msi() {
        let result = classify_asset("AI.Ask_0.0.1-2_x64_en-US.msi");
        assert_eq!(result, Some(("windows", Some("x64"))));
    }

    #[test]
    fn classify_asset_matches_macos_universal() {
        let result = classify_asset("AIAsk-macOS-universal.dmg");
        assert_eq!(result, Some(("macos", Some("universal"))));
    }

    #[test]
    fn classify_asset_filters_unknown() {
        let result = classify_asset("AIAsk-source.zip");
        assert!(result.is_none());
    }

    #[test]
    fn classify_asset_matches_linux_appimage() {
        let result = classify_asset("AI.Ask_0.0.1-alpha.2_amd64.AppImage");
        assert_eq!(result, Some(("linux", Some("x64"))));
    }

    #[test]
    fn classify_asset_matches_macos_arm64() {
        let result = classify_asset("AI.Ask_0.0.1-alpha.2_aarch64.dmg");
        assert_eq!(result, Some(("macos", Some("arm64"))));
    }

    fn make_download(
        status: DownloadStatus,
        path: Option<PathBuf>,
    ) -> Arc<Mutex<DownloadTaskInternal>> {
        Arc::new(Mutex::new(DownloadTaskInternal {
            task: DownloadTask {
                id: "task-1".into(),
                status,
                started_at: "2025-01-01T00:00:00Z".into(),
                completed_at: Some("2025-01-01T00:00:10Z".into()),
                error: None,
                target_asset: ReleaseAsset {
                    id: "asset-1".into(),
                    name: "Installer.pkg".into(),
                    platform: "macos".into(),
                    arch: Some("arm64".into()),
                    download_url: "https://example.com/installer".into(),
                    size: Some(1024),
                    checksum: None,
                },
                bytes_total: Some(1024),
                bytes_downloaded: Some(1024),
            },
            release_version: "0.0.1-alpha.2".into(),
            download_path: path,
        }))
    }

    #[test]
    fn extract_installation_info_returns_expected_values() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp installer");
        let download = make_download(DownloadStatus::Completed, Some(tmp.path().to_path_buf()));

        let (path, version, asset) =
            extract_installation_info(&download).expect("extract info succeeds");

        assert_eq!(path, tmp.path());
        assert_eq!(version, "0.0.1-alpha.2");
        assert_eq!(asset, "Installer.pkg");
    }

    #[test]
    fn extract_installation_info_fails_for_incomplete_download() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp installer");
        let download = make_download(DownloadStatus::Running, Some(tmp.path().to_path_buf()));

        let error = extract_installation_info(&download).expect_err("expect failure");
        assert!(error.contains("Download not completed"));
    }

    #[test]
    fn extract_installation_info_fails_when_path_missing() {
        let download = make_download(DownloadStatus::Completed, None);
        let error = extract_installation_info(&download).expect_err("expect missing path");
        assert!(error.contains("installer path missing"));
    }

    #[test]
    fn build_cached_release_collects_expected_assets() {
        let mut release = mock_release("v0.0.1-alpha.2", true);
        release.assets = vec![
            GithubAsset {
                id: 1,
                name: "AI.Ask_0.0.1-2_x64-setup.exe".into(),
                browser_download_url: "https://example.com/win-x64.exe".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 2,
                name: "AI.Ask_0.0.1-2_arm64-setup.exe".into(),
                browser_download_url: "https://example.com/win-arm64.exe".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 3,
                name: "AI.Ask_0.0.1-2_x64_en-US.msi".into(),
                browser_download_url: "https://example.com/win-x64.msi".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 4,
                name: "AI.Ask_0.0.1-2_arm64_en-US.msi".into(),
                browser_download_url: "https://example.com/win-arm64.msi".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 5,
                name: "AI.Ask_0.0.1-alpha.2_x64.dmg".into(),
                browser_download_url: "https://example.com/macos-x64.dmg".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 6,
                name: "AI.Ask_0.0.1-alpha.2_aarch64.dmg".into(),
                browser_download_url: "https://example.com/macos-arm64.dmg".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 7,
                name: "AI.Ask_0.0.1-alpha.2_amd64.AppImage".into(),
                browser_download_url: "https://example.com/linux.appimage".into(),
                size: Some(1024),
            },
            GithubAsset {
                id: 8,
                name: "AI.Ask_0.0.1-alpha.2_amd64.deb".into(),
                browser_download_url: "https://example.com/linux.deb".into(),
                size: Some(1024),
            },
        ];

        let cached = build_cached_release("0.0.1-alpha.2".into(), release).expect("cache build");
        assert_eq!(cached.assets.len(), 8);

        let platforms: Vec<_> = cached
            .assets
            .iter()
            .map(|asset| (asset.meta.platform.as_str(), asset.meta.arch.clone()))
            .collect();
        assert!(platforms.contains(&("windows", Some("x64".into()))));
        assert!(platforms.contains(&("windows", Some("arm64".into()))));
        assert!(platforms.contains(&("macos", Some("x64".into()))));
        assert!(platforms.contains(&("macos", Some("arm64".into()))));
        assert!(platforms.iter().any(|(platform, _)| *platform == "linux"));
    }

    #[test]
    fn skip_release_skips_pre_release_on_stable_channel() {
        let current = Version::parse("0.0.1").unwrap();
        let target = Version::parse("0.0.2-alpha.1").unwrap();
        let release = mock_release("v0.0.2-alpha.1", true);

        assert!(should_skip_release(&current, &target, &release));
    }

    #[test]
    fn skip_release_allows_newer_pre_release_on_pre_channel() {
        let current = Version::parse("0.0.1-alpha.1").unwrap();
        let target = Version::parse("0.0.1-alpha.2").unwrap();
        let release = mock_release("v0.0.1-alpha.2", true);

        assert!(!should_skip_release(&current, &target, &release));
    }

    #[test]
    fn skip_release_returns_true_for_older_or_equal_version() {
        let current = Version::parse("0.0.1").unwrap();
        let target = Version::parse("0.0.1").unwrap();
        let release = mock_release("v0.0.1", false);

        assert!(should_skip_release(&current, &target, &release));
    }

    #[test]
    fn skip_release_returns_false_for_newer_stable_version() {
        let current = Version::parse("0.0.1-alpha.1").unwrap();
        let target = Version::parse("0.0.1").unwrap();
        let release = mock_release("v0.0.1", false);

        assert!(!should_skip_release(&current, &target, &release));
    }
}
