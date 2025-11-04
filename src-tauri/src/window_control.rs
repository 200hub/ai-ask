//! 主窗口控制模块
//!
//! 提供主窗口的显示、隐藏、切换等实用函数，并暴露对应的 Tauri 命令。

use std::time::Duration;

use tauri::{Emitter, Manager, Window};

/// 尝试解析主窗口实例
pub(crate) fn resolve_main_window(app: &tauri::AppHandle) -> Option<Window> {
    if let Some(window) = app.get_window("main") {
        log::trace!("resolve_main_window: using explicit 'main' window");
        return Some(window);
    }

    let fallback = app.windows().values().next().cloned();
    if fallback.is_some() {
        log::trace!("resolve_main_window: falling back to first available window");
    } else {
        log::warn!("resolve_main_window: no window instances available");
    }

    fallback
}

/// 隐藏主窗口（向前端广播事件后再隐藏）
pub(crate) async fn hide_main_window(window: &Window) -> Result<(), String> {
    log::debug!("Hiding main window");

    let _ = window.emit("hideAllWebviews", ());
    tokio::time::sleep(Duration::from_millis(100)).await;

    window.hide().map_err(|err| {
        log::error!("Failed to hide window: {}", err);
        err.to_string()
    })?;

    log::debug!("Main window hidden");
    Ok(())
}

/// 显示主窗口（并恢复焦点与最小化状态）
pub(crate) async fn show_main_window(window: &Window) -> Result<(), String> {
    log::debug!("Showing main window");

    if window.is_minimized().map_err(|err| {
        log::error!("Failed to check window minimized state: {}", err);
        err.to_string()
    })? {
        window.unminimize().map_err(|err| {
            log::error!("Failed to restore minimized window: {}", err);
            err.to_string()
        })?;
    }

    window.show().map_err(|err| {
        log::error!("Failed to show window: {}", err);
        err.to_string()
    })?;

    window.set_focus().map_err(|err| {
        log::error!("Failed to set window focus: {}", err);
        err.to_string()
    })?;

    let _ = window.emit("restoreWebviews", ());

    log::debug!("Main window shown");
    Ok(())
}

/// 切换主窗口的可见状态
pub(crate) async fn toggle_main_window_visibility(window: &Window) -> Result<(), String> {
    let is_visible = window.is_visible().map_err(|err| {
        log::error!("Failed to check window visibility: {}", err);
        err.to_string()
    })?;
    let is_minimized = window.is_minimized().map_err(|err| {
        log::error!("Failed to check window minimized state: {}", err);
        err.to_string()
    })?;

    log::debug!("Toggling window state: visible={}, minimized={}", is_visible, is_minimized);

    if is_visible && !is_minimized {
        hide_main_window(window).await
    } else {
        show_main_window(window).await
    }
}

#[tauri::command]
pub(crate) async fn toggle_window(window: Window) -> Result<(), String> {
    toggle_main_window_visibility(&window).await
}

#[tauri::command]
pub(crate) async fn show_window(window: Window) -> Result<(), String> {
    show_main_window(&window).await
}

#[tauri::command]
pub(crate) async fn hide_window(window: Window) -> Result<(), String> {
    hide_main_window(&window).await
}
