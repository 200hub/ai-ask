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
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    webview::{NewWindowResponse, Webview, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Position, Size, State, Url, WebviewUrl, Window,
};
use tauri_plugin_opener::open_url;

use crate::proxy::{parse_external_url, parse_proxy_url, resolve_proxy_data_directory};
use crate::utils::decode_base64url_to_json;

/// 保存所有活跃子 WebView 实例
///
/// 使用 Mutex 保证线程安全的并发访问
#[derive(Default)]
pub(crate) struct ChildWebviewManager {
    webviews: Mutex<HashMap<String, ManagedWebview>>,
}

/// 单个子 WebView 的管理信息
///
/// 包含 Webview 实例和关联的代理配置
/// 代理配置变化时需要重建 Webview（浏览器引擎限制）
struct ManagedWebview {
    webview: Webview,
    proxy_url: Option<String>,
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
    bounds: BoundsPayload,
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
    window: Window,
    state: State<'_, ChildWebviewManager>,
    payload: EnsureChildWebviewPayload,
) -> Result<(), String> {
    log::debug!(
        "Ensuring child webview exists: id={}, url={}, proxy={:?}",
        payload.id,
        payload.url,
        payload.proxy_url
    );

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
        log::info!(
            "Proxy config changed, recreating child webview: {}",
            payload.id
        );
        if let Some(entry) = webviews.remove(&payload.id) {
            let _ = entry.webview.close();
        }
    }

    if let Some(entry) = webviews.get(&payload.id) {
        let webview = &entry.webview;

        if let Ok(current_url) = webview.url() {
            if current_url.as_str() != payload.url {
                log::debug!(
                    "Updating child webview URL: {} -> {}",
                    current_url,
                    payload.url
                );
                webview
                    .navigate(parse_external_url(&payload.url)?)
                    .map_err(|err| err.to_string())?;
            }
        }

        // Attach navigation and page load events
        webview
            .set_position(Position::Logical(position))
            .map_err(|err| err.to_string())?;
        webview
            .set_size(Size::Logical(size))
            .map_err(|err| err.to_string())?;
        log::debug!("Child webview updated: {}", payload.id);
    } else {
        log::info!("Creating new child webview: {}", payload.id);
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

        // Attach navigation and page load events
        let main_window = window.clone();
        let webview_id_for_events = payload.id.clone();
        use std::sync::{Arc, Mutex};
        let agg_state = Arc::new(Mutex::new((0usize, 0usize, String::new()))); // (expected, received, data)

        // Intercept navigation to http(s)://injection.localhost/* to shuttle injection results
        {
            let main_window_nav = main_window.clone();
            let webview_id_nav = webview_id_for_events.clone();
            let agg_nav = agg_state.clone();
            builder = builder.on_navigation(move |url| {
                if let Some(host) = url.host_str() {
                    if (url.scheme() == "http" || url.scheme() == "https")
                        && host == "injection.localhost"
                    {
                        log::info!("[NAV-INTERCEPT] Caught navigation to: {}", url);
                        let path = url.path().trim_start_matches('/');
                        let get_param = |name: &str| -> Option<String> {
                            url.query_pairs()
                                .find(|(k, _)| k == name)
                                .map(|(_, v)| v.to_string())
                        };
                        if path.starts_with("begin") {
                            if let Some(t_str) = get_param("t") {
                                if let Ok(t) = t_str.parse::<usize>() {
                                    log::info!("[NAV-INTERCEPT] Begin: expecting {} chunks", t);
                                    if let Ok(mut st) = agg_nav.lock() {
                                        st.0 = t;
                                        st.1 = 0;
                                        st.2.clear();
                                    }
                                }
                            }
                        } else if path.starts_with("chunk") {
                            let d = get_param("d").unwrap_or_default();
                            if let Ok(mut st) = agg_nav.lock() {
                                st.2.push_str(&d);
                                st.1 = st.1.saturating_add(1);
                                log::info!(
                                    "[NAV-INTERCEPT] Chunk: received {}/{}, data_len={}",
                                    st.1,
                                    st.0,
                                    st.2.len()
                                );
                            }
                        } else if path.starts_with("end") {
                            let (expected, received, data) = {
                                let mut s = agg_nav.lock().unwrap();
                                (s.0, s.1, std::mem::take(&mut s.2))
                            };
                            log::info!(
                                "[NAV-INTERCEPT] End: expected={}, received={}, data_len={}",
                                expected,
                                received,
                                data.len()
                            );

                            if expected == 0 || received == 0 || received != expected {
                                log::warn!("[NAV-INTERCEPT] Chunk mismatch");
                                if let Err(e) = main_window_nav.emit(
                                    "child-webview:injection-result",
                                    serde_json::json!({
                                        "id": webview_id_nav,
                                        "success": false,
                                        "error": "incomplete_chunks",
                                        "expected": expected,
                                        "received": received
                                    }),
                                ) {
                                    log::error!(
                                        "[NAV-INTERCEPT] Failed to emit error event: {}",
                                        e
                                    );
                                }
                            } else {
                                // Decode base64url to JSON on Rust side
                                log::info!("[NAV-INTERCEPT] Decoding base64url data...");
                                match decode_base64url_to_json(&data) {
                                    Ok(json_value) => {
                                        log::info!(
                                            "[NAV-INTERCEPT] Decode successful, emitting event"
                                        );
                                        if let Err(e) = main_window_nav.emit(
                                            "child-webview:injection-result",
                                            serde_json::json!({
                                                "id": webview_id_nav,
                                                "result": json_value
                                            }),
                                        ) {
                                            log::error!(
                                                "[NAV-INTERCEPT] Failed to emit success event: {}",
                                                e
                                            );
                                        } else {
                                            log::info!(
                                                "[NAV-INTERCEPT] Event emitted successfully"
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!("[NAV-INTERCEPT] Decode failed: {}", e);
                                        if let Err(emit_err) = main_window_nav.emit(
                                            "child-webview:injection-result",
                                            serde_json::json!({
                                                "id": webview_id_nav,
                                                "success": false,
                                                "error": format!("decode_error: {}", e)
                                            }),
                                        ) {
                                            log::error!(
                                                "[NAV-INTERCEPT] Failed to emit decode error: {}",
                                                emit_err
                                            );
                                        }
                                    }
                                }
                            }
                        } else if path.starts_with("error") {
                            let m = get_param("m");
                            log::error!("[NAV-INTERCEPT] Error signal: {:?}", m);
                            if let Err(e) = main_window_nav.emit(
                                "child-webview:injection-result",
                                serde_json::json!({
                                    "id": webview_id_nav,
                                    "success": false,
                                    "error": m
                                }),
                            ) {
                                log::error!(
                                    "[NAV-INTERCEPT] Failed to emit injection error event: {}",
                                    e
                                );
                            }
                        }
                        // cancel navigation
                        log::info!("[NAV-INTERCEPT] Navigation cancelled");
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

        builder = builder.on_page_load(move |_wv, payload| {
            use tauri::webview::PageLoadEvent;
            match payload.event() {
                PageLoadEvent::Started => {
                    let _ = main_window.emit(
                        "child-webview:load-started",
                        serde_json::json!({ "id": webview_id_for_events }),
                    );
                }
                PageLoadEvent::Finished => {
                    let _ = main_window.emit(
                        "child-webview:ready",
                        serde_json::json!({ "id": webview_id_for_events }),
                    );
                }
            }
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
            },
        );
        log::info!("Child webview created successfully: {}", payload.id);
    }

    Ok(())
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
        let _ = entry.webview.set_focus();
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
        log::debug!(
            "FULL SCRIPT CONTENT:\n{}\n--- END OF SCRIPT ---",
            payload.script
        );

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
    use super::should_open_in_default_browser;
    use tauri::Url;

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
}
