//! 改编自 Hai beta.35 桌面更新模板；Tauri 官方插件负责版本、下载、验签和安装。

use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, Resource, ResourceId, Webview};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

use crate::proxy::{custom_proxy_url, ProxyTestConfig};

#[derive(Default)]
struct DesktopUpdater {
    operation: tokio::sync::Mutex<()>,
}

fn safe_update_error(stage: &str, error: &Error) -> String {
    let kind = match error {
        Error::Reqwest(error) if error.is_timeout() => "network-timeout",
        Error::Reqwest(error) if error.is_connect() => "network-connect",
        Error::Reqwest(error) if error.is_redirect() => "network-redirect",
        Error::Reqwest(_) => "network-request",
        Error::Io(_) => "io",
        Error::Serialization(_) => "manifest-json",
        Error::Minisign(_) => "signature",
        Error::SignedVersionMismatch { .. } => "signed-version-mismatch",
        Error::MissingSignedVersion => "missing-signed-version",
        Error::ReleaseNotFound => "release-not-found",
        Error::InvalidUpdaterFormat => "package-format",
        Error::Network(_) => "http-response",
        Error::InsecureTransportProtocol => "insecure-transport",
        _ => "updater-configuration",
    };
    let status = match error {
        Error::Reqwest(error) => error.status().map(|status| status.as_u16()),
        Error::Network(message) => message.split_whitespace().find_map(|word| {
            word.parse::<u16>()
                .ok()
                .filter(|status| (100..600).contains(status))
        }),
        _ => None,
    };
    let io_kind = match error {
        Error::Io(error) => Some(error.kind()),
        _ => None,
    };
    log::warn!("Signed desktop update failed: stage={stage} kind={kind} status={status:?} io_kind={io_kind:?}");
    format!("Desktop update {stage} failed ({kind})")
}

/// 发布构建固定信任根；开发包和没有配置真实公钥的包不发更新网络请求。
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    if cfg!(dev)
        || cfg!(debug_assertions)
        || !supports_updater_bundle()
        || !valid_updater_config(app.config().plugins.0.get("updater"))
    {
        return Ok(());
    }
    app.plugin(
        tauri_plugin_updater::Builder::new()
            .default_version_comparator(|current, release| {
                release.version.cmp_precedence(&current).is_gt()
            })
            .build(),
    )?;
    app.manage(DesktopUpdater::default());
    Ok(())
}

fn valid_updater_config(value: Option<&serde_json::Value>) -> bool {
    let Some(config) = value.and_then(|value| {
        serde_json::from_value::<tauri_plugin_updater::Config>(value.clone()).ok()
    }) else {
        return false;
    };
    if !config.require_signed_version
        || config.allow_downgrades
        || config.dangerous_insecure_transport_protocol
        || config.dangerous_accept_invalid_certs
        || config.dangerous_accept_invalid_hostnames
        || config.endpoints.is_empty()
        || config
            .endpoints
            .iter()
            .any(|url| !trusted_url(url) || url.query().is_some() || url.fragment().is_some())
    {
        return false;
    }
    let Ok(decoded) = STANDARD.decode(config.pubkey) else {
        return false;
    };
    std::str::from_utf8(&decoded).is_ok_and(|key| minisign_verify::PublicKey::decode(key).is_ok())
}

fn trusted_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

fn supports_updater_bundle() -> bool {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    match bundle_type() {
        #[cfg(target_os = "windows")]
        Some(BundleType::Nsis | BundleType::Msi) => true,
        #[cfg(target_os = "macos")]
        Some(BundleType::App) => true,
        #[cfg(target_os = "linux")]
        Some(BundleType::AppImage) => tauri::Env::default()
            .appimage
            .is_some_and(|path| std::path::Path::new(&path).is_file()),
        _ => false,
    }
}

#[tauri::command]
pub fn desktop_update_configured(webview: Webview) -> bool {
    webview.label() == "main" && webview.try_state::<DesktopUpdater>().is_some()
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum DesktopUpdateCheck {
    Available { update: DesktopUpdateMetadata },
    Current,
    Unavailable,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn desktop_update_check(
    webview: Webview,
    proxy: Option<ProxyTestConfig>,
) -> Result<DesktopUpdateCheck, String> {
    if webview.label() != "main" {
        return Err("Desktop updates are only available from the main window".into());
    }
    if !desktop_update_configured(webview.clone()) {
        return Ok(DesktopUpdateCheck::Unavailable);
    }
    let state = webview.state::<DesktopUpdater>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Desktop update operation is already running")?;
    let mut builder = webview
        .updater_builder()
        .timeout(Duration::from_secs(10))
        .configure_client(|client| client.https_only(true))
        // Windows 官方插件在启动安装器前会同步清理应用。失败时仍要保留可操作的应用。
        // 本适配器提前完成全部编辑窗口的异步保存，由进程退出/重启释放原生资源。
        .on_before_exit(|| {});
    if let Some(proxy) = proxy {
        match proxy.proxy_type.as_str() {
            "system" => {}
            "custom" => builder = builder.proxy(custom_proxy_url(&proxy)?),
            _ => return Err("Unsupported proxy type".into()),
        }
    }
    let updater = builder
        .build()
        .map_err(|error| safe_update_error("configuration", &error))?;
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return Ok(DesktopUpdateCheck::Current),
        Err(Error::TargetNotFound(_) | Error::TargetsNotFound(_)) => {
            return Ok(DesktopUpdateCheck::Unavailable)
        }
        Err(error) => return Err(safe_update_error("check", &error)),
    };
    if !trusted_url(&update.download_url) {
        return Err("Desktop update download URL is invalid".into());
    }
    let metadata = DesktopUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: serde_json::json!({}),
        rid: webview.resources_table().add(update),
    };
    Ok(DesktopUpdateCheck::Available { update: metadata })
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

struct DownloadedUpdate {
    update: Update,
    bytes: Vec<u8>,
}
impl Resource for DownloadedUpdate {}

#[tauri::command]
pub async fn desktop_update_download(
    webview: Webview,
    rid: ResourceId,
    on_event: Channel<DownloadEvent>,
) -> Result<ResourceId, String> {
    if !desktop_update_configured(webview.clone()) {
        return Err("Desktop update download is unavailable".into());
    }
    let state = webview.state::<DesktopUpdater>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Desktop update operation is already running")?;
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|_| "Desktop update resource is unavailable")?;
    let mut update = (*update).clone();
    update.timeout = Some(Duration::from_secs(300));
    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {},
        )
        .await
        .map_err(|error| safe_update_error("download", &error))?;
    // Finished 表示已通过官方签名及签名版本核验，不能提前将下载流结束视为可安装。
    let _ = on_event.send(DownloadEvent::Finished);
    Ok(webview
        .resources_table()
        .add(DownloadedUpdate { update, bytes }))
}

#[tauri::command]
pub async fn desktop_update_install(webview: Webview, rid: ResourceId) -> Result<(), String> {
    if !desktop_update_configured(webview.clone()) {
        return Err("Desktop update installation is unavailable".into());
    }
    let state = webview.state::<DesktopUpdater>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Desktop update operation is already running")?;
    let package = webview
        .resources_table()
        .get::<DownloadedUpdate>(rid)
        .map_err(|_| "Verified update package is unavailable")?;
    let permit = install_after_save(
        crate::shutdown::prepare_exit(webview.app_handle()),
        || async move {
            tauri::async_runtime::spawn_blocking(move || package.update.install(&package.bytes))
                .await
                .map_err(|_| {
                    log::warn!("Signed desktop update failed: stage=install kind=worker-join");
                    "Desktop update worker failed".to_string()
                })?
                .map_err(|error| safe_update_error("install", &error))
        },
    )
    .await?;
    let _ = webview.resources_table().close(rid);
    permit.restart();
    Ok(())
}

async fn install_after_save<P, S, I, F>(save: S, install: I) -> Result<P, String>
where
    S: std::future::Future<Output = Result<P, String>>,
    I: FnOnce() -> F,
    F: std::future::Future<Output = Result<(), String>>,
{
    let permit = save.await?;
    install().await?;
    Ok(permit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_editor_save_never_starts_the_installer() {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let result =
            install_after_save(async { Err::<(), _>("disk full".to_string()) }, || async {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            })
            .await;
        assert_eq!(result.unwrap_err(), "disk full");
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn installer_failure_drops_the_exit_permit_and_preserves_the_running_app() {
        struct Permit(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Permit {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let result = install_after_save(async { Ok(Permit(cancelled.clone())) }, || async {
            Err("installer failed".into())
        })
        .await;
        assert!(result.is_err());
        assert!(cancelled.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn missing_or_placeholder_signing_configuration_is_not_enabled() {
        assert!(!valid_updater_config(None));
        for config in [
            serde_json::json!({}),
            serde_json::json!({"endpoints":["https://example.test/latest.json"],"pubkey":"REPLACE_WITH_PUBLIC_KEY_CONTENT","requireSignedVersion":true}),
        ] {
            assert!(!valid_updater_config(Some(&config)));
        }
    }

    #[test]
    fn committed_release_configuration_has_a_valid_signing_key_and_stable_feed() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];

        // 验证真实构建输入，避免只有 CI 临时覆盖包含可用的更新信任根。
        assert!(valid_updater_config(Some(updater)));
        assert_eq!(
            updater["endpoints"],
            serde_json::json!([
                "https://github.com/200hub/ai-ask/releases/download/desktop-updates/latest.json"
            ])
        );
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], false);
    }

    #[test]
    fn download_sources_must_use_https_without_credentials() {
        assert!(trusted_url(
            &tauri::Url::parse("https://example.test/app.exe").unwrap()
        ));
        for value in [
            "http://example.test/app.exe",
            "https://user:secret@example.test/app.exe",
            "file:///tmp/app",
        ] {
            assert!(!trusted_url(&tauri::Url::parse(value).unwrap()));
        }
    }

    #[test]
    fn versions_use_semver_precedence_instead_of_build_metadata_ordering() {
        let current = semver::Version::parse("1.0.0+build.1").unwrap();
        let candidate = semver::Version::parse("1.0.0+build.2").unwrap();
        assert!(!candidate.cmp_precedence(&current).is_gt());
        assert!(semver::Version::parse("1.0.1-beta.1")
            .unwrap()
            .cmp_precedence(&current)
            .is_gt());
    }
}
