//! 子 WebView 管理模块
//!
//! 负责维护子 WebView 的生命周期，包括创建、边界同步、
//! 可见性切换以及代理配置更新时的安全重建。

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    webview::{Webview, WebviewBuilder},
    LogicalPosition, LogicalSize, Position, Size, State, WebviewUrl, Window,
};

use crate::proxy::{parse_external_url, parse_proxy_url, resolve_proxy_data_directory};

/// 保存所有活跃子 WebView 实例
#[derive(Default)]
pub(crate) struct ChildWebviewManager {
    webviews: Mutex<HashMap<String, ManagedWebview>>,
}

struct ManagedWebview {
    webview: Webview,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PositionPayload {
    #[serde(rename = "x")]
    x: f64,
    #[serde(rename = "y")]
    y: f64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SizePayload {
    #[serde(rename = "width")]
    width: f64,
    #[serde(rename = "height")]
    height: f64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BoundsPayload {
    #[serde(rename = "positionLogical")]
    position_logical: PositionPayload,
    #[serde(rename = "sizeLogical")]
    size_logical: SizePayload,
    #[serde(rename = "scaleFactor")]
    _scale_factor: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnsureChildWebviewPayload {
    id: String,
    url: String,
    bounds: BoundsPayload,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChildWebviewBoundsUpdatePayload {
    id: String,
    bounds: BoundsPayload,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChildWebviewIdPayload {
    id: String,
}

fn logical_position(bounds: &BoundsPayload) -> LogicalPosition<f64> {
    LogicalPosition::new(bounds.position_logical.x, bounds.position_logical.y)
}

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
        log::info!("Proxy configuration changed, recreating child webview: {}", payload.id);
        if let Some(entry) = webviews.remove(&payload.id) {
            let _ = entry.webview.close();
        }
    }

    if let Some(entry) = webviews.get(&payload.id) {
        let webview = &entry.webview;

        if let Ok(current_url) = webview.url() {
            if current_url.as_str() != payload.url {
                log::debug!("Updating child webview URL: {} -> {}", current_url, payload.url);
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
