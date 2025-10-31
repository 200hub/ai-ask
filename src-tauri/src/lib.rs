// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    webview::{Webview, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State, Url,
    WebviewUrl, Window,
};

#[derive(Debug, Deserialize)]
struct ProxyTestConfig {
    #[serde(rename = "type")]
    proxy_type: String,
    host: Option<String>,
    port: Option<String>,
}

#[derive(Debug, Serialize)]
struct ProxyTestResult {
    success: bool,
    message: String,
    latency: Option<u128>,
}

struct ManagedWebview {
    webview: Webview,
    proxy_url: Option<String>,
}

#[derive(Default)]
struct ChildWebviewManager {
    webviews: Mutex<HashMap<String, ManagedWebview>>,
}

#[derive(Debug, Deserialize)]
struct PositionPayload {
    #[serde(rename = "x")]
    x: f64,
    #[serde(rename = "y")]
    y: f64,
}

#[derive(Debug, Deserialize)]
struct SizePayload {
    #[serde(rename = "width")]
    width: f64,
    #[serde(rename = "height")]
    height: f64,
}

#[derive(Debug, Deserialize)]
struct BoundsPayload {
    #[serde(rename = "positionLogical")]
    position_logical: PositionPayload,
    #[serde(rename = "sizeLogical")]
    size_logical: SizePayload,
    #[serde(rename = "scaleFactor")]
    _scale_factor: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureChildWebviewPayload {
    id: String,
    url: String,
    bounds: BoundsPayload,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChildWebviewBoundsUpdatePayload {
    id: String,
    bounds: BoundsPayload,
}

#[derive(Debug, Deserialize)]
struct ChildWebviewIdPayload {
    id: String,
}

fn resolve_main_window(app: &AppHandle) -> Option<Window> {
    app.get_window("main")
        .or_else(|| app.windows().values().next().cloned())
}

/// Tauri命令：切换窗口显示状态
#[tauri::command]
async fn toggle_window(window: tauri::Window) -> Result<(), String> {
    toggle_main_window_visibility(&window).await
}

/// Tauri命令：显示窗口
#[tauri::command]
async fn show_window(window: tauri::Window) -> Result<(), String> {
    show_main_window(&window).await
}

/// Tauri命令：隐藏窗口
#[tauri::command]
async fn hide_window(window: tauri::Window) -> Result<(), String> {
    hide_main_window(&window).await
}

fn parse_external_url(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|err| err.to_string())
}

fn parse_proxy_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|err| err.to_string())?;

    match parsed.scheme() {
        "http" | "socks5" => Ok(parsed),
        scheme => Err(format!("不支持的代理协议: {scheme}")),
    }
}

fn sanitize_for_directory(input: &str) -> String {
    input
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

/// Returns a unique WebView data directory for the given proxy configuration.
///
/// Windows WebView2 instances with different network settings must not share
/// the same data directory, otherwise the proxy configuration is ignored.
fn resolve_proxy_data_directory(window: &Window, proxy: Option<&str>) -> Option<PathBuf> {
    let proxy = proxy?;
    let resolver = window.app_handle().path();
    let base_dir = resolver
        .app_data_dir()
        .or_else(|_| resolver.app_cache_dir())
        .ok()?;

    let dir = base_dir
        .join("webview-proxies")
        .join(sanitize_for_directory(proxy));

    if let Err(err) = fs::create_dir_all(&dir) {
        eprintln!("创建代理数据目录失败 {dir:?}: {err}");
        return None;
    }

    Some(dir)
}

fn logical_position(bounds: &BoundsPayload) -> LogicalPosition<f64> {
    LogicalPosition::new(bounds.position_logical.x, bounds.position_logical.y)
}

fn logical_size(bounds: &BoundsPayload) -> LogicalSize<f64> {
    LogicalSize::new(bounds.size_logical.width, bounds.size_logical.height)
}

async fn hide_main_window(window: &Window) -> Result<(), String> {
    let _ = window.emit("hideAllWebviews", ());
    tokio::time::sleep(Duration::from_millis(100)).await;
    window.hide().map_err(|err| err.to_string())?;
    Ok(())
}

async fn show_main_window(window: &Window) -> Result<(), String> {
    if window.is_minimized().map_err(|err| err.to_string())? {
        window.unminimize().map_err(|err| err.to_string())?;
    }

    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    let _ = window.emit("restoreWebviews", ());
    Ok(())
}

async fn toggle_main_window_visibility(window: &Window) -> Result<(), String> {
    let is_visible = window.is_visible().map_err(|err| err.to_string())?;
    let is_minimized = window.is_minimized().map_err(|err| err.to_string())?;

    if is_visible && !is_minimized {
        hide_main_window(window).await
    } else {
        show_main_window(window).await
    }
}

#[tauri::command]
async fn ensure_child_webview(
    window: tauri::Window,
    state: State<'_, ChildWebviewManager>,
    payload: EnsureChildWebviewPayload,
) -> Result<(), String> {
    let position = logical_position(&payload.bounds);
    let size = logical_size(&payload.bounds);

    let mut webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    let requested_proxy = payload.proxy_url.as_deref();
    let should_recreate = webviews
        .get(&payload.id)
        .map(|entry| entry.proxy_url.as_deref() != requested_proxy)
        .unwrap_or(false);

    if should_recreate {
        if let Some(entry) = webviews.remove(&payload.id) {
            let _ = entry.webview.close();
        }
    }

    if let Some(entry) = webviews.get(&payload.id) {
        let webview = &entry.webview;

        if let Ok(current_url) = webview.url() {
            if current_url.as_str() != payload.url {
                webview
                    .navigate(parse_external_url(&payload.url)?)
                    .map_err(|err| err.to_string())?;
            }
        }

        webview
            .set_position(Position::Logical(position))
            .map_err(|err| err.to_string())?;
        webview
            .set_size(Size::Logical(size))
            .map_err(|err| err.to_string())?;
    } else {
        let mut builder = WebviewBuilder::new(
            payload.id.clone(),
            WebviewUrl::External(parse_external_url(&payload.url)?),
        );

        if let Some(proxy_url) = requested_proxy {
            builder = builder.proxy_url(parse_proxy_url(proxy_url)?);
            if let Some(data_dir) = resolve_proxy_data_directory(&window, requested_proxy) {
                builder = builder.data_directory(data_dir);
            }
        }

        let child = window
            .add_child(builder, position, size)
            .map_err(|err| err.to_string())?;
        let _ = child.hide();

        webviews.insert(
            payload.id,
            ManagedWebview {
                webview: child,
                proxy_url: payload.proxy_url.clone(),
            },
        );
    }

    Ok(())
}

#[tauri::command]
async fn set_child_webview_bounds(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewBoundsUpdatePayload,
) -> Result<(), String> {
    let position = logical_position(&payload.bounds);
    let size = logical_size(&payload.bounds);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.get(&payload.id) {
        entry
            .webview
            .set_position(Position::Logical(position))
            .map_err(|err| err.to_string())?;
        entry
            .webview
            .set_size(Size::Logical(size))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn show_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.show().map_err(|err| err.to_string())?;
        let _ = entry.webview.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn hide_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.hide().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    let mut webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.remove(&payload.id) {
        entry.webview.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn focus_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.set_focus().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_all_child_webviews(state: State<'_, ChildWebviewManager>) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    for entry in webviews.values() {
        let _ = entry.webview.hide();
    }
    Ok(())
}

/// 测试代理连通性
#[tauri::command]
async fn test_proxy_connection(config: ProxyTestConfig) -> Result<ProxyTestResult, String> {
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::limited(5));

    match config.proxy_type.as_str() {
        "custom" => {
            let host = config
                .host
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "代理地址不能为空".to_string())?;

            let port = config
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

            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|err| err.to_string())?;
            client_builder = client_builder.proxy(proxy);
        }
        "system" | "none" => {}
        other => {
            return Err(format!("不支持的代理类型: {other}"));
        }
    }

    let client = client_builder.build().map_err(|err| err.to_string())?;
    let target_url = "https://www.example.com";
    let start = Instant::now();

    match client.get(target_url).send().await {
        Ok(response) => {
            let latency = start.elapsed().as_millis();
            if response.status().is_success() {
                Ok(ProxyTestResult {
                    success: true,
                    message: "连接成功".into(),
                    latency: Some(latency),
                })
            } else {
                Ok(ProxyTestResult {
                    success: false,
                    message: format!("目标返回状态码 {}", response.status()),
                    latency: Some(latency),
                })
            }
        }
        Err(error) => Ok(ProxyTestResult {
            success: false,
            message: error.to_string(),
            latency: None,
        }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ChildWebviewManager::default())
        // 插件初始化
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        // 设置处理程序
        .setup(|app| {
            // 创建托盘菜单
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "偏好设置", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

            // 设置托盘菜单
            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;

                // 托盘图标点击事件
                tray.on_tray_icon_event(move |tray, event| match event {
                    TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } => {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            let app = tray.app_handle().clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = resolve_main_window(&app) {
                                    let _ = toggle_main_window_visibility(&window).await;
                                }
                            });
                        }
                    }
                    _ => {}
                });

                // 托盘菜单事件
                tray.on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = resolve_main_window(app) {
                            tauri::async_runtime::spawn(async move {
                                let _ = show_main_window(&window).await;
                            });
                        }
                    }
                    "settings" => {
                        if let Some(window) = resolve_main_window(app) {
                            tauri::async_runtime::spawn(async move {
                                if show_main_window(&window).await.is_ok() {
                                    let _ = window.emit("open-settings", ());
                                }
                            });
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });
            }

            // 注册全局快捷键（默认）
            let handle = app.handle().clone();
            let last_shortcut_trigger = Arc::new(Mutex::new(None::<Instant>));
            #[cfg(target_os = "macos")]
            let shortcut = "Cmd+Shift+A";
            #[cfg(not(target_os = "macos"))]
            let shortcut = "Ctrl+Shift+A";

            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
            if let Ok(shortcut) = shortcut.parse::<Shortcut>() {
                let throttle = last_shortcut_trigger.clone();
                let _ =
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _event, _shortcut| {
                            let mut last = throttle.lock().unwrap();
                            let now = Instant::now();
                            if let Some(previous) = *last {
                                if now.duration_since(previous) < Duration::from_millis(350) {
                                    return;
                                }
                            }

                            *last = Some(now);

                            let app_handle = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = resolve_main_window(&app_handle) {
                                    let _ = toggle_main_window_visibility(&window).await;
                                }
                            });
                        });
            }

            Ok(())
        })
        // 窗口事件处理
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 阻止窗口关闭，而是隐藏到托盘
                api.prevent_close();
                window.hide().unwrap();
            }
        })
        // 注册命令
        .invoke_handler(tauri::generate_handler![
            toggle_window,
            show_window,
            hide_window,
            ensure_child_webview,
            set_child_webview_bounds,
            show_child_webview,
            hide_child_webview,
            close_child_webview,
            focus_child_webview,
            hide_all_child_webviews,
            test_proxy_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
