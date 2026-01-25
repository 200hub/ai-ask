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
    show_main_window_internal(window, true).await
}

/// 显示主窗口但不恢复子 webviews（用于打开设置等场景）
pub(crate) async fn show_main_window_without_restore(window: &Window) -> Result<(), String> {
    show_main_window_internal(window, false).await
}

/// 显示主窗口的内部实现
async fn show_main_window_internal(window: &Window, restore_webviews: bool) -> Result<(), String> {
    log::debug!(
        "Showing main window (restore_webviews={})",
        restore_webviews
    );

    if window.is_minimized().map_err(|err| {
        log::error!("Failed to check if window is minimized: {}", err);
        err.to_string()
    })? {
        window.unminimize().map_err(|err| {
            log::error!("Failed to unminimize window: {}", err);
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

    if restore_webviews {
        let _ = window.emit("restoreWebviews", ());
    }

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
        log::error!("Failed to check if window is minimized: {}", err);
        err.to_string()
    })?;

    log::debug!(
        "Toggling window state: visible={}, minimized={}",
        is_visible,
        is_minimized
    );

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

/// 在主窗口中打开指定平台
///
/// 此命令会：
/// 1. 显示主窗口
/// 2. 发送事件让前端切换到指定平台
#[tauri::command]
pub(crate) async fn open_platform_in_main_window(
    app: tauri::AppHandle,
    platform_id: String,
    platform_type: String,
    text: Option<String>,
    action: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Opening platform in main window: id={}, type={}, has_text={}, action={:?}",
        platform_id,
        platform_type,
        text.is_some(),
        action
    );

    // 获取主窗口
    let main_window =
        resolve_main_window(&app).ok_or_else(|| "Main window not found".to_string())?;

    // 显示主窗口
    show_main_window(&main_window).await?;

    // 发送事件让前端切换到指定平台
    main_window
        .emit(
            "openPlatform",
            serde_json::json!({
                "platformId": platform_id,
                "platformType": platform_type,
                "text": text,
                "action": action
            }),
        )
        .map_err(|e| format!("Failed to emit openPlatform event: {}", e))?;

    Ok(())
}
