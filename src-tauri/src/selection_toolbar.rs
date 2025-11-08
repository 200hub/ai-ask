//! Selection Toolbar - 划词工具栏管理
//!
//! 提供系统级文本选择监听和浮动工具栏窗口管理功能

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const TOOLBAR_WIDTH: f64 = 80.0;
const TOOLBAR_HEIGHT: f64 = 35.0;
const TOOLBAR_VERTICAL_OFFSET: f64 = 10.0;

/// 工具栏窗口状态
pub struct ToolbarState {
    last_shown_at: Option<Instant>,
    last_text: Option<String>,
    enabled: bool,
}

impl Default for ToolbarState {
    fn default() -> Self {
        Self {
            last_shown_at: None,
            last_text: None,
            enabled: true,
        }
    }
}

impl ToolbarState {
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}

/// 工具栏窗口管理器
pub type ToolbarManager = Arc<Mutex<ToolbarState>>;

/// 光标位置信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPosition {
    /// Anchor X coordinate in physical screen pixels
    pub x: f64,
    /// Anchor Y coordinate in physical screen pixels
    pub y: f64,
}

/// 创建或显示划词工具栏窗口
///
/// # Arguments
///
/// * `app` - Tauri应用句柄
/// * `text` - 选中的文本
/// * `position` - 光标位置 (屏幕坐标)
#[tauri::command]
pub async fn show_selection_toolbar(
    app: AppHandle,
    text: String,
    position: CursorPosition,
    toolbar_state: tauri::State<'_, ToolbarManager>,
) -> Result<(), String> {
    show_toolbar_internal(&app, text, position, toolbar_state.inner().clone()).await
}

/// 外部调用接口 (例如全局监听器) —— 直接使用工具栏管理器实例
pub async fn show_selection_toolbar_with_manager(
    app: AppHandle,
    text: String,
    position: CursorPosition,
    toolbar_manager: ToolbarManager,
) -> Result<(), String> {
    show_toolbar_internal(&app, text, position, toolbar_manager).await
}

/// 隐藏划词工具栏窗口
#[tauri::command]
pub async fn hide_selection_toolbar(
    app: AppHandle,
    toolbar_state: tauri::State<'_, ToolbarManager>,
) -> Result<(), String> {
    hide_toolbar_internal(&app, toolbar_state.inner()).await
}

pub async fn hide_selection_toolbar_with_manager(
    app: AppHandle,
    toolbar_manager: ToolbarManager,
) -> Result<(), String> {
    hide_toolbar_internal(&app, &toolbar_manager).await
}

#[tauri::command]
pub async fn set_selection_toolbar_enabled(
    app: AppHandle,
    enabled: bool,
    toolbar_state: tauri::State<'_, ToolbarManager>,
) -> Result<(), String> {
    let previous = {
        let mut state = toolbar_state
            .lock()
            .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;
        let previous = state.enabled;
        state.enabled = enabled;
        previous
    };

    if !enabled {
        hide_toolbar_internal(&app, toolbar_state.inner()).await?;
    }

    if previous != enabled {
        log::info!(
            "Selection toolbar {}",
            if enabled { "enabled" } else { "disabled" }
        );
    } else {
        log::debug!(
            "Selection toolbar enable request ignored because state unchanged: {}",
            enabled
        );
    }

    Ok(())
}

async fn hide_toolbar_internal(
    app: &AppHandle,
    toolbar_manager: &ToolbarManager,
) -> Result<(), String> {
    let mut state = toolbar_manager
        .lock()
        .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;

    state.last_text = None;
    state.last_shown_at = None;

    drop(state);

    if let Some(window) = app.get_webview_window("selection-toolbar") {
        if let Err(error) = window.hide() {
            log::debug!(
                "Skipping toolbar hide because window handle is invalid: {}",
                error
            );
        }
    }

    Ok(())
}

/// 获取鼠标光标位置
///
/// 返回屏幕坐标系下的光标位置
#[tauri::command]
pub async fn get_cursor_position() -> Result<CursorPosition, String> {
    // 注意：Tauri 2.x 没有内置的光标位置API
    // 这里返回一个占位符，实际实现需要使用平台特定的API
    // 在前端可以使用鼠标事件获取位置
    match platform_cursor_position() {
        Ok((x, y)) => Ok(CursorPosition { x, y }),
        Err(err) => {
            log::warn!("get_cursor_position fallback: {}", err);
            Ok(CursorPosition { x: 0.0, y: 0.0 })
        }
    }
}

async fn show_toolbar_internal(
    app: &AppHandle,
    text: String,
    position: CursorPosition,
    toolbar_manager: ToolbarManager,
) -> Result<(), String> {
    let trimmed_text = text.trim();
    if trimmed_text.is_empty() {
        log::debug!("Selection toolbar suppressed due to empty text");
        return Ok(());
    }
    let preview: String = trimmed_text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect();
    log::debug!("Selection toolbar text preview: \"{}\"", preview);

    let mut state = toolbar_manager
        .lock()
        .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;

    if !state.enabled {
        log::debug!("Selection toolbar suppressed because feature is disabled");
        return Ok(());
    }

    let now = Instant::now();
    if let Some(last) = state.last_shown_at {
        if now.duration_since(last) < Duration::from_millis(120)
            && state
                .last_text
                .as_ref()
                .map(|prev| prev == trimmed_text)
                .unwrap_or(false)
        {
            log::debug!("Selection toolbar suppressed due to throttle");
            return Ok(());
        }
    }

    state.last_shown_at = Some(now);
    state.last_text = Some(trimmed_text.to_string());

    drop(state);

    let window = ensure_toolbar_window(app)?;

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let toolbar_width = TOOLBAR_WIDTH * scale_factor;
    let toolbar_height = TOOLBAR_HEIGHT * scale_factor;
    let offset_y = TOOLBAR_VERTICAL_OFFSET * scale_factor;

    let mut toolbar_x = position.x - toolbar_width / 2.0;
    let mut toolbar_y = position.y - toolbar_height - offset_y;

    if toolbar_x < 0.0 {
        toolbar_x = 0.0;
    }

    if toolbar_y < 0.0 {
        toolbar_y = 0.0;
    }

    if let Err(error) = window.set_always_on_top(true) {
        log::warn!("Failed to set toolbar always-on-top: {}", error);
    }

    let toolbar_x_i32 = toolbar_x.round() as i32;
    let toolbar_y_i32 = toolbar_y.round() as i32;

    if let Err(error) = window.set_position(Position::Physical(PhysicalPosition::new(
        toolbar_x_i32,
        toolbar_y_i32,
    ))) {
        log::warn!("Failed to position toolbar window: {}", error);
    }

    // 先隐藏再显示，确保位置更新立即生效
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    }

    let text_payload = trimmed_text.to_string();
    let window_for_emit = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = window_for_emit.emit("toolbar-text-selected", text_payload);
        let _ = window_for_emit.show();
    });

    Ok(())
}

fn ensure_toolbar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("selection-toolbar") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, "selection-toolbar", WebviewUrl::App("/toolbar".into()))
        .title("Selection Toolbar")
        .inner_size(TOOLBAR_WIDTH, TOOLBAR_HEIGHT)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("Failed to create toolbar window: {}", e))
}

pub(crate) fn platform_cursor_position() -> Result<(f64, f64), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        unsafe {
            let mut point = POINT::default();
            if GetCursorPos(&mut point).is_ok() {
                return Ok((point.x as f64, point.y as f64));
            }
        }

        Err("GetCursorPos failed".into())
    }

    #[cfg(target_os = "macos")]
    {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
            Ok(source) => match CGEvent::new(source) {
                Ok(event) => {
                    let location = event.location();
                    Ok((location.x, location.y))
                }
                Err(_) => Err("Failed to create CGEvent".into()),
            },
            Err(_) => Err("Failed to create CGEventSource".into()),
        }
    }

    #[cfg(target_os = "linux")]
    {
        return Err("Cursor position lookup not implemented on Linux".into());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        return Err("Cursor position lookup not implemented for this platform".into());
    }
}
