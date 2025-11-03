//! 应用更新服务
//!
//! 负责检测 GitHub Release，下载与安装平台对应的更新包，
//! 并通过事件通知前端更新状态。

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use futures_util::StreamExt;
use reqwest::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::io::AsyncWriteExt;

use crate::proxy::parse_proxy_url;

const GITHUB_API_BASE: &str = "https://api.github.com";
const PENDING_UPDATE_FILE: &str = "pending-update.json";

/// 更新服务配置
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateServiceOptions {
    pub current_version: String,
    pub repo: String,
    #[serde(default)]
    pub auto_update: bool,
    #[serde(default)]
    pub proxy: Option<UpdateProxyConfig>,
}

/// 代理配置
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProxyConfig {
    #[serde(rename = "type")]
    pub proxy_type: String,
    pub host: Option<String>,
    pub port: Option<String>,
}

/// 管理更新状态
#[derive(Clone, Default)]
pub(crate) struct UpdateManager {
    inner: Arc<Mutex<UpdateStateInner>>,
}

#[derive(Default)]
struct UpdateStateInner {
    client: Option<Arc<Client>>,
    pending_release: Option<PreparedRelease>,
    downloading: bool,
}

impl UpdateManager {
    fn store_client(&self, client: Client) -> Arc<Client> {
        let client = Arc::new(client);
        let mut inner = self.inner.lock().unwrap();
        inner.client = Some(client.clone());
        client
    }

    fn store_release(&self, release: PreparedRelease) {
        let mut inner = self.inner.lock().unwrap();
        inner.pending_release = Some(release);
    }

    fn is_downloading(&self) -> bool {
        self.inner.lock().unwrap().downloading
    }

    fn prepare_download(&self) -> Option<(Arc<Client>, PreparedRelease)> {
        let mut inner = self.inner.lock().unwrap();
        if inner.downloading {
            return None;
        }

        let client = inner.client.clone()?;
        let release = inner.pending_release.clone()?;
        inner.downloading = true;
        Some((client, release))
    }

    fn finish_download(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.downloading = false;
    }
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
    content_type: Option<String>,
}

#[derive(Debug, Clone)]
struct PreparedRelease {
    version: String,
    repo: String,
    notes: Option<String>,
    asset: GitHubAsset,
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingUpdateRecord {
    version: String,
    file_path: String,
    asset_name: String,
}

#[derive(Debug, Serialize)]
struct UpdateAvailablePayload {
    version: String,
    notes: Option<String>,
}

#[derive(Debug, Serialize)]
struct UpdateProgressPayload {
    version: String,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Debug, Serialize)]
struct UpdateDownloadedPayload {
    version: String,
    file_path: String,
}

#[derive(Debug, Serialize)]
struct UpdateErrorPayload {
    stage: String,
    message: String,
}

/// 前端调用：启动更新检测
#[tauri::command]
pub(crate) async fn start_update_service(
    window: Window,
    manager: tauri::State<'_, UpdateManager>,
    options: UpdateServiceOptions,
) -> Result<(), String> {
    log::info!(
        "启动更新服务: repo={}, current={}, auto={}",
        options.repo,
        options.current_version,
        options.auto_update
    );

    let current_version =
        parse_version(&options.current_version).map_err(|err| format!("当前版本号无效: {err}"))?;

    let client = build_http_client(options.proxy.clone()).map_err(|err| {
        log::error!("构建 HTTP 客户端失败: {}", err);
        err
    })?;
    let client = manager.store_client(client);

    let latest_release = fetch_latest_release(&client, &options.repo).await?;
    let latest_version =
        parse_version(&latest_release.tag_name).map_err(|err| format!("远端版本号无效: {err}"))?;

    if latest_version <= current_version {
        log::info!("当前已是最新版本: {}", current_version);
        return Ok(());
    }

    let asset = select_asset(&latest_release.assets).ok_or_else(|| {
        log::error!("未找到与平台匹配的安装包");
        "未找到适用于当前平台的安装包".to_string()
    })?;

    let prepared = PreparedRelease {
        version: latest_version.to_string(),
        repo: options.repo.clone(),
        notes: latest_release.body.clone(),
        asset,
    };

    manager.store_release(prepared.clone());

    window
        .emit(
            "update:available",
            UpdateAvailablePayload {
                version: prepared.version.clone(),
                notes: prepared.notes.clone(),
            },
        )
        .map_err(|err| err.to_string())?;

    if options.auto_update {
        log::info!("自动下载更新: {}", prepared.version);
        if let Some((client, release)) = manager.prepare_download() {
            spawn_update_task(window.app_handle(), manager.inner.clone(), client, release);
        }
    }

    Ok(())
}

/// 前端调用：立即下载更新
#[tauri::command]
pub(crate) async fn download_update_now(
    window: Window,
    manager: tauri::State<'_, UpdateManager>,
) -> Result<(), String> {
    if manager.is_downloading() {
        log::warn!("更新下载已在进行中");
        return Err("更新正在下载中".into());
    }

    if let Some((client, release)) = manager.prepare_download() {
        log::info!("手动触发更新下载: {}", release.version);
        spawn_update_task(window.app_handle(), manager.inner.clone(), client, release);
        Ok(())
    } else {
        log::warn!("没有可下载的更新");
        Err("没有可下载的更新".into())
    }
}

fn spawn_update_task(
    app_handle: AppHandle,
    state: Arc<Mutex<UpdateStateInner>>,
    client: Arc<Client>,
    release: PreparedRelease,
) {
    let version = release.version.clone();
    tauri::async_runtime::spawn(async move {
        let result = download_update(&app_handle, &client, &release).await;

        let manager = UpdateManager {
            inner: state.clone(),
        };
        manager.finish_download();

        if let Err(err) = result {
            log::error!("下载更新失败: {}", err);
            let _ = app_handle.emit_all(
                "update:error",
                UpdateErrorPayload {
                    stage: "download".into(),
                    message: err.clone(),
                },
            );
        } else {
            log::info!("更新下载完成: {}", version);
        }
    });
}

async fn download_update(
    app_handle: &AppHandle,
    client: &Client,
    release: &PreparedRelease,
) -> Result<(), String> {
    let path_resolver = app_handle.path();
    let base_dir = path_resolver
        .app_data_dir()
        .or_else(|_| path_resolver.app_cache_dir())
        .map_err(|err| err.to_string())?;

    let updates_dir = base_dir.join("updates").join(&release.version);
    tokio::fs::create_dir_all(&updates_dir)
        .await
        .map_err(|err| err.to_string())?;

    let file_path = updates_dir.join(&release.asset.name);

    let response = client
        .get(&release.asset.browser_download_url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?;

    let total = release.asset.size.or_else(|| response.content_length());

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|err| err.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|err| err.to_string())?;
        file.write_all(&bytes)
            .await
            .map_err(|err| err.to_string())?;
        downloaded += bytes.len() as u64;

        let _ = app_handle.emit_all(
            "update:download-progress",
            UpdateProgressPayload {
                version: release.version.clone(),
                downloaded,
                total,
            },
        );
    }

    file.flush().await.map_err(|err| err.to_string())?;

    let record = PendingUpdateRecord {
        version: release.version.clone(),
        file_path: file_path.to_string_lossy().to_string(),
        asset_name: release.asset.name.clone(),
    };

    persist_pending_update(app_handle, &record).await?;

    app_handle
        .emit_all(
            "update:downloaded",
            UpdateDownloadedPayload {
                version: release.version.clone(),
                file_path: record.file_path.clone(),
            },
        )
        .map_err(|err| err.to_string())?;

    Ok(())
}

async fn persist_pending_update(
    app_handle: &AppHandle,
    record: &PendingUpdateRecord,
) -> Result<(), String> {
    let pending_path = pending_update_path(app_handle)?;

    if let Some(parent) = pending_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| err.to_string())?;
    }

    let data = serde_json::to_vec_pretty(record).map_err(|err| err.to_string())?;
    tokio::fs::write(&pending_path, data)
        .await
        .map_err(|err| err.to_string())
}

fn pending_update_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let resolver = app_handle.path();
    let base_dir = resolver
        .app_data_dir()
        .or_else(|_| resolver.app_cache_dir())
        .map_err(|err| err.to_string())?;
    Ok(base_dir.join("updates").join(PENDING_UPDATE_FILE))
}

fn build_http_client(proxy: Option<UpdateProxyConfig>) -> Result<Client, String> {
    let mut builder = Client::builder();
    builder = builder.user_agent("AI-Ask-Updater/1.0");

    if let Some(proxy_config) = proxy {
        match proxy_config.proxy_type.as_str() {
            "custom" => {
                let host = proxy_config
                    .host
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "代理地址不能为空".to_string())?;
                let port = proxy_config
                    .port
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "代理端口不能为空".to_string())?;

                let proxy_url = if host.contains("://") {
                    host.to_string()
                } else {
                    format!("http://{}:{}", host, port)
                };

                let parsed = parse_proxy_url(&proxy_url)?;
                let proxy = reqwest::Proxy::all(parsed.as_str()).map_err(|err| err.to_string())?;
                builder = builder.proxy(proxy);
            }
            "system" => {}
            "none" | "" => {
                builder = builder.no_proxy();
            }
            other => {
                return Err(format!("不支持的代理类型: {other}"));
            }
        }
    }

    builder.build().map_err(|err| err.to_string())
}

async fn fetch_latest_release(client: &Client, repo: &str) -> Result<GitHubRelease, String> {
    let url = format!("{}/repos/{}/releases", GITHUB_API_BASE, repo);
    let releases: Vec<GitHubRelease> = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .json()
        .await
        .map_err(|err| err.to_string())?;

    let mut best: Option<(Version, GitHubRelease)> = None;

    for release in releases
        .into_iter()
        .filter(|item| !item.draft && !item.prerelease)
    {
        if let Ok(version) = parse_version(&release.tag_name) {
            let should_replace = best
                .as_ref()
                .map_or(true, |(current, _)| version > *current);
            if should_replace {
                best = Some((version, release));
            }
        }
    }

    best.map(|(_, release)| release)
        .ok_or_else(|| "未找到有效的版本发布".to_string())
}

fn parse_version(input: &str) -> Result<Version, semver::Error> {
    if let Some(stripped) = input.strip_prefix('v').or_else(|| input.strip_prefix('V')) {
        Version::parse(stripped)
    } else {
        Version::parse(input)
    }
}

fn select_asset(assets: &[GitHubAsset]) -> Option<GitHubAsset> {
    let mut matches: Vec<GitHubAsset> = assets
        .iter()
        .filter(|asset| asset_matches_platform(asset))
        .cloned()
        .collect();
    matches.sort_by_key(|asset| asset.size.unwrap_or_default());
    matches.pop()
}

fn asset_matches_platform(asset: &GitHubAsset) -> bool {
    let name = asset.name.to_lowercase();
    let os_keywords = platform_os_keywords();
    let arch_keywords = platform_arch_keywords();

    os_keywords.iter().any(|key| name.contains(key))
        && arch_keywords.iter().any(|key| name.contains(key))
}

fn platform_os_keywords() -> Vec<&'static str> {
    match std::env::consts::OS {
        "windows" => vec!["windows", "win"],
        "macos" => vec!["mac", "darwin", "osx"],
        "linux" => vec!["linux", "appimage", "deb"],
        other => vec![other],
    }
}

fn platform_arch_keywords() -> Vec<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => vec!["x86_64", "amd64", "x64"],
        "aarch64" => vec!["aarch64", "arm64"],
        "x86" => vec!["x86", "ia32", "i386"],
        other => vec![other],
    }
}

/// 应用启动时检查并安装待处理更新
pub(crate) fn check_pending_updates_on_startup(app_handle: &AppHandle) {
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = handle_pending_update(&handle).await {
            log::error!("安装待处理更新失败: {}", err);
            let _ = handle.emit_all(
                "update:error",
                UpdateErrorPayload {
                    stage: "install".into(),
                    message: err,
                },
            );
        }
    });
}

async fn handle_pending_update(app_handle: &AppHandle) -> Result<(), String> {
    let pending_path = match pending_update_path(app_handle) {
        Ok(path) => path,
        Err(err) => {
            log::warn!("无法解析更新路径: {}", err);
            return Ok(());
        }
    };

    if !pending_path.exists() {
        return Ok(());
    }

    let data = tokio::fs::read_to_string(&pending_path)
        .await
        .map_err(|err| err.to_string())?;
    let record: PendingUpdateRecord = serde_json::from_str(&data).map_err(|err| err.to_string())?;

    log::info!(
        "检测到待安装更新: version={}, file={}",
        record.version,
        record.file_path
    );

    install_update(app_handle, &record).await?;

    tokio::fs::remove_file(&pending_path)
        .await
        .map_err(|err| err.to_string())?;

    if let Some(parent) = Path::new(&record.file_path).parent() {
        if let Err(err) = tokio::fs::remove_dir_all(parent).await {
            log::warn!("清理更新目录失败: {}", err);
        }
    }

    app_handle
        .emit_all(
            "update:installed",
            HashMap::from([
                ("version", record.version.clone()),
                ("file", record.file_path.clone()),
            ]),
        )
        .map_err(|err| err.to_string())?;

    Ok(())
}

async fn install_update(
    app_handle: &AppHandle,
    record: &PendingUpdateRecord,
) -> Result<(), String> {
    let path = PathBuf::from(&record.file_path);
    if !path.exists() {
        return Err("更新文件不存在".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::env::consts::OS != "macos" {
            if let Ok(metadata) = tokio::fs::metadata(&path).await {
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o755);
                if let Err(err) = tokio::fs::set_permissions(&path, permissions).await {
                    log::warn!("更新文件修改权限失败: {}", err);
                }
            }
        }
    }

    let (program, args): (&str, Vec<&str>) = match std::env::consts::OS {
        "windows" => (
            "msiexec",
            vec!["/i", record.file_path.as_str(), "/passive", "/norestart"],
        ),
        "macos" => ("open", vec![record.file_path.as_str()]),
        "linux" => (record.file_path.as_str(), vec![]),
        other => return Err(format!("当前平台不支持自动安装: {other}")),
    };

    let mut command = app_handle.shell().command(program);
    if !args.is_empty() {
        command = command.args(args.clone());
    }

    let (mut rx, _child) = command.spawn().map_err(|err| err.to_string())?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Error(err) => return Err(err),
            CommandEvent::Terminated(payload) => {
                if payload.code.unwrap_or_default() == 0 {
                    log::info!("更新安装完成");
                    return Ok(());
                } else {
                    return Err(format!("安装程序退出码 {}", payload.code.unwrap_or(-1)));
                }
            }
            _ => {}
        }
    }

    Err("安装程序未返回结果".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_strips_prefix() {
        let version = parse_version("v1.2.3").expect("version should parse");
        assert_eq!(version.major, 1);
        assert_eq!(version.minor, 2);
        assert_eq!(version.patch, 3);
    }

    #[test]
    fn select_asset_prefers_matching_platform() {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        let matching_name = format!("app-{os}-{arch}.zip");

        let assets = vec![
            GitHubAsset {
                name: "app-other.zip".into(),
                browser_download_url: "https://example.com/other".into(),
                size: Some(1),
                content_type: None,
            },
            GitHubAsset {
                name: matching_name.clone(),
                browser_download_url: "https://example.com/matching".into(),
                size: Some(10),
                content_type: None,
            },
        ];

        let selected = select_asset(&assets).expect("expected asset");
        assert_eq!(selected.name, matching_name);
    }

    #[test]
    fn select_asset_returns_none_when_no_match() {
        let assets = vec![GitHubAsset {
            name: "unrelated.zip".into(),
            browser_download_url: "https://example.com/unrelated".into(),
            size: Some(1),
            content_type: None,
        }];

        assert!(select_asset(&assets).is_none());
    }
}
