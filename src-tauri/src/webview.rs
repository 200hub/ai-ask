//! 子 WebView 管理模块
//!
//! 负责维护子 WebView 的生命周期，包括创建、边界同步、
//! 可见性切换以及代理配置更新时的安全重建。
//!
//! ## 注入结果回传架构 (Injection Result Return Channel)
//!
//! 外部网站的 WebView 无法使用 Tauri IPC，因此我们使用基于导航拦截的通信方案：
//!
//! ### 流程：
//! 1. **子 WebView (JS)**: 注入脚本执行完成后，将结果编码为 base64url
//! 2. **子 WebView (JS)**: 通过导航到 `http://injection.localhost/begin|chunk|end` 发送数据
//!    - 使用分块传输避免 URL 长度限制（每块 ~1800 字符）
//! 3. **Rust (on_navigation)**: 拦截这些导航请求，聚合所有分块
//! 4. **Rust**: 解码 base64url → JSON，emit 事件到主窗口
//! 5. **主窗口 (Svelte)**: 接收事件，直接使用解析后的 JSON 结果
//!
//! ### 关键设计：
//! - 每个子 WebView 维护独立的聚合状态 (expected, received, data)
//! - 导航被取消（返回 false），不会真正跳转，避免页面中断
//! - Rust 端解码确保前端逻辑简单，降低出错概率
//! - 错误通过 /error 路径传递，统一错误处理

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::Deserialize;
use tauri::{
    webview::{NewWindowResponse, Webview, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Position, Size, State, Url, WebviewUrl, Window,
};
use tauri_plugin_opener::open_url;
use tokio::sync::{oneshot, Mutex as AsyncMutex, Notify};

use crate::proxy::{parse_external_url, parse_proxy_url, resolve_proxy_data_directory};
use crate::utils::decode_base64url_to_json;

/// 保存所有活跃子 WebView 实例
///
/// 使用 Mutex 保证线程安全的并发访问
#[derive(Default)]
pub(crate) struct ChildWebviewManager {
    webviews: Mutex<HashMap<String, ManagedWebview>>,
    load_changed: Arc<Notify>,
    pending_injections: Arc<Mutex<HashMap<(String, u32), InjectionReply>>>,
}

type InjectionReply = oneshot::Sender<Result<serde_json::Value, String>>;

/// 单个子 WebView 的管理信息
///
/// 包含 Webview 实例和关联的代理配置
/// 代理配置变化时需要重建 Webview（浏览器引擎限制）
struct ManagedWebview {
    webview: Webview,
    proxy_url: Option<String>,
    requested_url: Url,
    loaded: Arc<AtomicBool>,
    injection_gate: Arc<AsyncMutex<()>>,
}

/// WebView 位置参数（逻辑坐标）
#[derive(Debug, Deserialize)]
pub(crate) struct PositionPayload {
    #[serde(rename = "x")]
    x: f64,
    #[serde(rename = "y")]
    y: f64,
}

/// WebView 尺寸参数（逻辑坐标）
#[derive(Debug, Deserialize)]
pub(crate) struct SizePayload {
    #[serde(rename = "width")]
    width: f64,
    #[serde(rename = "height")]
    height: f64,
}

/// WebView 边界参数（位置 + 尺寸 + 缩放因子）
#[derive(Debug, Deserialize)]
pub(crate) struct BoundsPayload {
    #[serde(rename = "positionLogical")]
    position_logical: PositionPayload,
    #[serde(rename = "sizeLogical")]
    size_logical: SizePayload,
    #[serde(rename = "scaleFactor")]
    _scale_factor: f64,
}

/// 创建或更新子 WebView 的请求参数
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnsureChildWebviewPayload {
    id: String,
    url: String,
    /// 边界参数（可选）- 如果不提供且 webview 已存在，则不更新位置和大小
    bounds: Option<BoundsPayload>,
    proxy_url: Option<String>,
}

/// 更新子 WebView 边界的请求参数
#[derive(Debug, Deserialize)]
pub(crate) struct ChildWebviewBoundsUpdatePayload {
    id: String,
    bounds: BoundsPayload,
}

/// 操作子 WebView 的 ID 参数（通用）
#[derive(Debug, Deserialize)]
pub(crate) struct ChildWebviewIdPayload {
    id: String,
}

/// 支持通过系统默认程序打开的新窗口 URL Scheme
const SUPPORTED_EXTERNAL_URL_SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

/// 部分站点（如千问）在内嵌 WebView 环境下会基于 UA 进行兼容性限制。
/// 为其使用标准桌面浏览器 UA，可提高页面可访问性。
const CHILD_WEBVIEW_DESKTOP_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn should_use_desktop_user_agent(webview_id: &str, url: &str) -> bool {
    webview_id.ends_with("qianwen") || url.contains("qianwen.com") || url.contains("tongyi.com")
}

fn should_open_in_default_browser(url: &Url) -> bool {
    SUPPORTED_EXTERNAL_URL_SCHEMES.contains(&url.scheme())
}

fn open_new_window_in_browser(webview_id: &str, url: &Url) {
    if should_open_in_default_browser(url) {
        match open_url(url.as_str(), None::<&str>) {
            Ok(()) => {
                log::info!(
                    "Opened external link from child webview {} in system browser: {}",
                    webview_id,
                    url
                );
            }
            Err(error) => {
                log::error!(
                    "Failed to open external link from child webview {}: {} ({})",
                    webview_id,
                    url,
                    error
                );
            }
        }
    } else {
        log::warn!(
            "Blocked unsupported new-window scheme from child webview {}: {}",
            webview_id,
            url
        );
    }
}

/// 将边界参数转换为 Tauri 逻辑位置
fn logical_position(bounds: &BoundsPayload) -> LogicalPosition<f64> {
    LogicalPosition::new(bounds.position_logical.x, bounds.position_logical.y)
}

/// 将边界参数转换为 Tauri 逻辑尺寸
fn logical_size(bounds: &BoundsPayload) -> LogicalSize<f64> {
    LogicalSize::new(bounds.size_logical.width, bounds.size_logical.height)
}

/// 确保子 WebView 存在或在代理发生变化时重建
#[tauri::command]
pub(crate) async fn ensure_child_webview(
    app: tauri::AppHandle,
    state: State<'_, ChildWebviewManager>,
    payload: EnsureChildWebviewPayload,
) -> Result<(), String> {
    let window = crate::window_control::resolve_main_window(&app)
        .ok_or_else(|| "Main window not found".to_string())?;
    let requested_url = parse_external_url(&payload.url)?;
    log::debug!(
        "Ensuring child webview exists: id={}, url={}, proxy={:?}, bounds={:?}",
        payload.id,
        payload.url,
        payload.proxy_url,
        payload.bounds.is_some()
    );

    // 只有提供了 bounds 时才解析位置和大小
    let position_size = payload
        .bounds
        .as_ref()
        .map(|b| (logical_position(b), logical_size(b)));

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
        log::info!(
            "Proxy config changed, recreating child webview: {}",
            payload.id
        );
        if let Some(entry) = webviews.remove(&payload.id) {
            let _ = entry.webview.close();
        }
    }

    if let Some(entry) = webviews.get_mut(&payload.id) {
        let webview = &entry.webview;

        if entry.requested_url != requested_url {
            let loaded_before = entry.loaded.swap(false, Ordering::AcqRel);
            if let Err(err) = webview.navigate(requested_url.clone()) {
                entry.loaded.store(loaded_before, Ordering::Release);
                return Err(err.to_string());
            }
            entry.requested_url = requested_url;
        }

        // 只有提供了 bounds 时才更新位置和大小
        if let Some((position, size)) = position_size {
            webview
                .set_position(Position::Logical(position))
                .map_err(|err| err.to_string())?;
            webview
                .set_size(Size::Logical(size))
                .map_err(|err| err.to_string())?;
            log::debug!("Child webview bounds updated: {}", payload.id);
        } else {
            log::debug!("Child webview exists, bounds not updated: {}", payload.id);
        }
    } else {
        // 创建新 webview - 如果没有提供 bounds，使用默认的隐藏位置
        let (position, size) = position_size.unwrap_or_else(|| {
            log::info!(
                "Creating child webview without bounds, using hidden defaults: {}",
                payload.id
            );
            // 使用主窗口中的隐藏位置（在可视区域外）
            (
                LogicalPosition::new(-10000.0, -10000.0),
                LogicalSize::new(800.0, 600.0),
            )
        });

        log::info!("Creating new child webview: {}", payload.id);
        let mut builder = WebviewBuilder::new(
            payload.id.clone(),
            WebviewUrl::External(requested_url.clone()),
        );

        if should_use_desktop_user_agent(&payload.id, &payload.url) {
            builder = builder.user_agent(CHILD_WEBVIEW_DESKTOP_USER_AGENT);
        }

        if let Some(proxy_url) = requested_proxy {
            builder = builder.proxy_url(parse_proxy_url(proxy_url)?);
            if let Some(data_dir) = resolve_proxy_data_directory(&window, requested_proxy) {
                builder = builder.data_directory(data_dir);
            }
        }

        // Attach navigation and page load events
        let pending = state.pending_injections.clone();

        // Intercept navigation to http(s)://injection.localhost/* to shuttle injection results
        {
            let app_handle_nav = app.clone();
            let webview_id_nav = payload.id.clone();
            let chunks = Mutex::new(HashMap::<Option<u32>, ResultChunks>::new());
            builder = builder.on_navigation(move |url| {
                if let Some(host) = url.host_str() {
                    if (url.scheme() == "http" || url.scheme() == "https")
                        && host == "injection.localhost"
                    {
                        let path = url.path().trim_start_matches('/');
                        let get_param = |name: &str| -> Option<String> {
                            url.query_pairs()
                                .find(|(k, _)| k == name)
                                .map(|(_, v)| v.to_string())
                        };
                        let request_id = get_param("r").and_then(|value| value.parse().ok());
                        let reply_key = request_id.map(|id| (webview_id_nav.clone(), id));
                        if let Some(key) = &reply_key {
                            if !pending
                                .lock()
                                .is_ok_and(|injections| injections.contains_key(key))
                            {
                                return false;
                            }
                        }
                        if let Some(result) =
                            accept_result_chunk(&chunks, request_id, path, get_param)
                        {
                            if let Some(key) = reply_key {
                                if let Ok(mut injections) = pending.lock() {
                                    if let Some(reply) = injections.remove(&key) {
                                        let _ = reply.send(result);
                                    }
                                }
                            } else {
                                let event = match result {
                                    Ok(value) => serde_json::json!({
                                        "id": webview_id_nav, "success": true, "result": value
                                    }),
                                    Err(error) => serde_json::json!({
                                        "id": webview_id_nav, "success": false, "error": error
                                    }),
                                };
                                let _ =
                                    app_handle_nav.emit("child-webview:injection-result", event);
                            }
                        }
                        return false;
                    }
                }
                true
            });
        }

        {
            let webview_id_new_window = payload.id.clone();
            builder = builder.on_new_window(move |url, _features| {
                open_new_window_in_browser(&webview_id_new_window, &url);
                NewWindowResponse::Deny
            });
        }

        let loaded = Arc::new(AtomicBool::new(false));
        let page_loaded = loaded.clone();
        let load_changed = state.load_changed.clone();
        builder = builder.on_page_load(move |_wv, payload| {
            use tauri::webview::PageLoadEvent;
            page_loaded.store(
                payload.event() == PageLoadEvent::Finished,
                Ordering::Release,
            );
            load_changed.notify_waiters();
        });

        let child = window
            .add_child(builder, position, size)
            .map_err(|err| err.to_string())?;

        let _ = child.hide();

        webviews.insert(
            payload.id.clone(),
            ManagedWebview {
                webview: child,
                proxy_url: payload.proxy_url.clone(),
                requested_url,
                loaded,
                injection_gate: Arc::new(AsyncMutex::new(())),
            },
        );
        state.load_changed.notify_waiters();
        log::info!("Child webview created successfully: {}", payload.id);
    }

    Ok(())
}

const MAX_RESULT_CHUNKS: usize = 2048;
const MAX_RESULT_CHUNK_LENGTH: usize = 1800;

struct ResultChunks {
    expected: usize,
    received: usize,
    data: String,
}

fn accept_result_chunk(
    chunks: &Mutex<HashMap<Option<u32>, ResultChunks>>,
    request_id: Option<u32>,
    path: &str,
    parameter: impl Fn(&str) -> Option<String>,
) -> Option<Result<serde_json::Value, String>> {
    let mut chunks = chunks.lock().ok()?;
    match path {
        "result" => {
            let data = parameter("d")?;
            if data.len() <= MAX_RESULT_CHUNK_LENGTH {
                return Some(decode_base64url_to_json(&data));
            }
        }
        "begin" => {
            chunks.retain(|id, _| id.is_none() || *id == request_id);
            let expected = parameter("t")?.parse().ok()?;
            if (1..=MAX_RESULT_CHUNKS).contains(&expected) {
                chunks.insert(
                    request_id,
                    ResultChunks {
                        expected,
                        received: 0,
                        data: String::new(),
                    },
                );
            }
        }
        "chunk" => {
            let index = parameter("i")?.parse::<usize>().ok()?;
            let data = parameter("d")?;
            let state = chunks.get_mut(&request_id)?;
            if index == state.received
                && index < state.expected
                && data.len() <= MAX_RESULT_CHUNK_LENGTH
            {
                state.data.push_str(&data);
                state.received += 1;
            }
        }
        "end" => {
            let state = chunks.remove(&request_id);
            drop(chunks);
            return Some(match state {
                Some(state) if state.received == state.expected => {
                    decode_base64url_to_json(&state.data).map_err(|error| error.to_string())
                }
                _ => Err("incomplete_chunks".into()),
            });
        }
        "error" => {
            chunks.remove(&request_id);
            return Some(Err(
                parameter("m").unwrap_or_else(|| "injection_failed".into())
            ));
        }
        _ => {}
    }
    None
}

#[tauri::command]
pub(crate) async fn run_selection_injection(
    state: State<'_, ChildWebviewManager>,
    payload: EvaluateScriptPayload,
    request_id: u32,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let gate = {
        let webviews = state.webviews.lock().map_err(|error| error.to_string())?;
        webviews
            .get(&payload.id)
            .map(|entry| entry.injection_gate.clone())
            .ok_or_else(|| format!("child webview not found: {}", payload.id))?
    };
    let key = (payload.id.clone(), request_id);
    let result = tokio::time::timeout(Duration::from_millis(timeout_ms), async {
        let _guard = gate.lock().await;
        let (reply, result) = oneshot::channel();
        state
            .pending_injections
            .lock()
            .map_err(|error| error.to_string())?
            .insert(key.clone(), reply);
        evaluate_child_webview_script(state.clone(), payload).await?;
        result.await.map_err(|error| error.to_string())?
    })
    .await;
    if let Ok(mut injections) = state.pending_injections.lock() {
        injections.remove(&key);
    }
    result.unwrap_or_else(|_| Err("EXTRACT_TIMEOUT".into()))
}

/// Observe the current native load state even when the WebView finished before the caller subscribed.
#[tauri::command]
pub(crate) async fn wait_child_webview_ready(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
    timeout_ms: u64,
) -> Result<bool, String> {
    let wait = async {
        loop {
            let changed = state.load_changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let ready = state
                .webviews
                .lock()
                .map_err(|err| format!("failed to lock webview map: {err}"))?
                .get(&payload.id)
                .is_some_and(|entry| entry.loaded.load(Ordering::Acquire));
            if ready {
                return Ok(true);
            }
            changed.await;
        }
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms), wait)
        .await
        .unwrap_or(Ok(false))
}

/// 更新子 WebView 边界
#[tauri::command]
pub(crate) async fn set_child_webview_bounds(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewBoundsUpdatePayload,
) -> Result<(), String> {
    log::debug!("Setting child webview bounds: {}", payload.id);

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
        log::debug!("Child webview bounds updated: {}", payload.id);
    }

    Ok(())
}

/// 显示指定子 WebView
#[tauri::command]
pub(crate) async fn show_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("Showing child webview: {}", payload.id);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.show().map_err(|err| err.to_string())?;
        log::debug!("Child webview shown: {}", payload.id);
    }

    Ok(())
}

/// 隐藏指定子 WebView
#[tauri::command]
pub(crate) async fn hide_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("Hiding child webview: {}", payload.id);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.hide().map_err(|err| err.to_string())?;
        log::debug!("Child webview hidden: {}", payload.id);
    }

    Ok(())
}

/// 关闭并移除指定子 WebView
#[tauri::command]
pub(crate) async fn close_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("Closing child webview: {}", payload.id);

    let mut webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.remove(&payload.id) {
        entry.webview.close().map_err(|err| err.to_string())?;
        log::info!("Child webview closed: {}", payload.id);
    }

    Ok(())
}

/// 清理指定子 WebView 的浏览数据（缓存、Cookie、LocalStorage 等）
///
/// 此操作会：
/// 1. 如果 WebView 存在：清除其浏览数据并关闭
/// 2. 如果 WebView 不存在：创建临时 WebView 来清理该 ID 对应的数据
///
/// 注意：在 Windows WebView2 上，所有共享同一用户数据目录的 WebView 会共享浏览数据。
/// `clear_all_browsing_data()` 会清除整个用户数据目录的数据。
///
/// 下次访问时会重新创建干净的 WebView
#[tauri::command]
pub(crate) async fn clear_child_webview_cache(
    window: Window,
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::info!("Clearing cache for child webview: {}", payload.id);

    let mut webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.remove(&payload.id) {
        // WebView 存在，直接清理
        log::info!("WebView exists, clearing browsing data: {}", payload.id);
        entry
            .webview
            .clear_all_browsing_data()
            .map_err(|err| format!("failed to clear browsing data: {err}"))?;

        entry
            .webview
            .close()
            .map_err(|err| format!("failed to close webview: {err}"))?;

        log::info!("Child webview cache cleared and closed: {}", payload.id);
    } else {
        // WebView 不存在，需要创建临时 WebView 来清理数据
        // 因为 clear_all_browsing_data() 需要一个 WebView 实例来调用
        log::info!(
            "WebView not loaded, creating temporary webview to clear data: {}",
            payload.id
        );

        // 释放锁，因为创建 WebView 可能需要一些时间
        drop(webviews);

        // 创建一个临时的 WebView 来清理数据
        // 使用 about:blank 作为 URL，这样不会加载任何内容
        let temp_label = format!("{}_temp_clear", payload.id);
        let temp_webview =
            WebviewBuilder::new(&temp_label, WebviewUrl::App("about:blank".into())).auto_resize();

        match window.add_child(
            temp_webview,
            LogicalPosition::new(-9999.0, -9999.0), // 放在屏幕外
            LogicalSize::new(1.0, 1.0),
        ) {
            Ok(webview) => {
                // 清理浏览数据
                if let Err(e) = webview.clear_all_browsing_data() {
                    log::error!("Failed to clear browsing data: {}", e);
                } else {
                    log::info!("Browsing data cleared successfully");
                }

                // 关闭临时 WebView
                if let Err(e) = webview.close() {
                    log::error!("Failed to close temporary webview: {}", e);
                }

                log::info!("Temporary webview created and cleared for: {}", payload.id);
            }
            Err(e) => {
                log::error!("Failed to create temporary webview for clearing: {}", e);
                return Err(format!("Failed to create temporary webview: {e}"));
            }
        }
    }

    Ok(())
}

/// 聚焦指定子 WebView
#[tauri::command]
pub(crate) async fn focus_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("Focusing child webview: {}", payload.id);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.set_focus().map_err(|err| err.to_string())?;
        log::debug!("Child webview focused: {}", payload.id);
    }

    Ok(())
}

/// 检查子 WebView 是否已存在
#[tauri::command]
pub(crate) async fn check_child_webview_exists(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<bool, String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    Ok(webviews.contains_key(&payload.id))
}

/// 隐藏所有子 WebView
#[tauri::command]
pub(crate) async fn hide_all_child_webviews(
    state: State<'_, ChildWebviewManager>,
) -> Result<(), String> {
    log::debug!("Hiding all child webviews");

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    for entry in webviews.values() {
        let _ = entry.webview.hide();
    }

    log::debug!("All child webviews hidden");
    Ok(())
}

/// 执行脚本的请求参数
/// 注意：加载外部 URL 的子 WebView 无法使用 Tauri IPC，因此脚本执行后不返回结果
#[derive(Debug, Deserialize)]
pub(crate) struct EvaluateScriptPayload {
    id: String,
    script: String,
}

#[tauri::command]
pub(crate) async fn evaluate_child_webview_script(
    state: State<'_, ChildWebviewManager>,
    payload: EvaluateScriptPayload,
) -> Result<serde_json::Value, String> {
    log::debug!(
        "Evaluating script in child webview: id={}, script_len={}",
        payload.id,
        payload.script.len()
    );

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        // Execute the user script directly - it's already a complete IIFE with async wrapper
        // No need to wrap it again, as that would create syntax errors
        log::debug!("About to evaluate script in child webview: {}", payload.id);
        log::debug!("Script length: {} bytes", payload.script.len());

        entry
            .webview
            .eval(&payload.script)
            .map_err(|err| format!("script evaluation failed: {err}"))?;

        log::info!("Script eval() completed for child webview: {}", payload.id);

        // Return success immediately
        Ok(serde_json::json!({
            "success": true,
            "message": "Script executed, check console for results"
        }))
    } else {
        Err(format!("child webview not found: {}", payload.id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Url;

    #[test]
    fn result_chunks_require_the_matching_request_and_sequence() {
        let chunks = Mutex::default();
        let parse = |id, path, parameters: &[(&str, &str)]| {
            accept_result_chunk(&chunks, id, path, |key| {
                parameters
                    .iter()
                    .find(|(name, _)| *name == key)
                    .map(|(_, value)| value.to_string())
            })
        };
        assert!(parse(Some(7), "begin", &[("t", "2")]).is_none());
        assert!(parse(Some(6), "chunk", &[("i", "0"), ("d", "e30")]).is_none());
        assert!(parse(Some(7), "chunk", &[("i", "1"), ("d", "30")]).is_none());
        assert!(parse(Some(7), "chunk", &[("i", "0"), ("d", "e")]).is_none());
        assert!(parse(Some(7), "chunk", &[("i", "0"), ("d", "30")]).is_none());
        assert!(parse(Some(7), "chunk", &[("i", "1"), ("d", "30")]).is_none());
        assert_eq!(parse(Some(7), "end", &[]), Some(Ok(serde_json::json!({}))));
        assert_eq!(
            parse(Some(6), "end", &[]),
            Some(Err("incomplete_chunks".into()))
        );
    }

    #[test]
    fn short_result_uses_one_navigation() {
        let chunks = Mutex::default();
        assert_eq!(
            accept_result_chunk(&chunks, Some(7), "result", |key| (key == "d")
                .then_some("e30".to_string())),
            Some(Ok(serde_json::json!({})))
        );
    }

    #[test]
    fn allows_well_known_schemes() {
        let http = Url::parse("http://example.com").unwrap();
        assert!(should_open_in_default_browser(&http));

        let https = Url::parse("https://example.com").unwrap();
        assert!(should_open_in_default_browser(&https));

        let mailto = Url::parse("mailto:user@example.com").unwrap();
        assert!(should_open_in_default_browser(&mailto));

        let tel = Url::parse("tel:123456").unwrap();
        assert!(should_open_in_default_browser(&tel));
    }

    #[test]
    fn blocks_unsupported_schemes() {
        let ftp = Url::parse("ftp://example.com").unwrap();
        assert!(!should_open_in_default_browser(&ftp));

        let about = Url::parse("about:blank").unwrap();
        assert!(!should_open_in_default_browser(&about));

        let javascript = Url::parse("javascript:alert('x')").unwrap();
        assert!(!should_open_in_default_browser(&javascript));
    }

    #[test]
    fn enables_desktop_ua_for_qianwen_routes() {
        assert!(should_use_desktop_user_agent(
            "ai-chat-qianwen",
            "https://www.qianwen.com"
        ));
        assert!(should_use_desktop_user_agent(
            "ai-chat-custom",
            "https://www.tongyi.com"
        ));
        assert!(!should_use_desktop_user_agent(
            "ai-chat-chatgpt",
            "https://chatgpt.com"
        ));
    }
}
