//! Desktop Notes - 桌面便签窗口管理
//!
//! 设计目标：
//! 1. 保持窗口层轻量，只负责创建/更新/关闭便签窗口
//! 2. 认证与同步由前端通过 Supabase JS SDK 完成，Rust 不参与
//! 3. 便签位置以屏幕百分比存储在前端，打开时前端转换为像素坐标传入

use serde::Deserialize;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const DESKTOP_NOTE_LABEL_PREFIX: &str = "desktop-note-";
const DESKTOP_NOTE_WINDOW_ROUTE: &str = "/sticky-note";
const DESKTOP_NOTE_WINDOW_TITLE: &str = "Sticky Note";
const DESKTOP_NOTE_MIN_WIDTH: f64 = 240.0;
const DESKTOP_NOTE_MIN_HEIGHT: f64 = 180.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNoteBoundsPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDesktopNoteWindowPayload {
    note_id: String,
    bounds: DesktopNoteBoundsPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNoteIdPayload {
    note_id: String,
}

fn desktop_note_window_label(note_id: &str) -> String {
    format!("{}{}", DESKTOP_NOTE_LABEL_PREFIX, note_id)
}

fn desktop_note_window_route(note_id: &str) -> String {
    format!("{}?noteId={}", DESKTOP_NOTE_WINDOW_ROUTE, note_id)
}

fn set_note_window_geometry(
    window: &WebviewWindow,
    bounds: &DesktopNoteBoundsPayload,
) -> Result<(), String> {
    window
        .set_position(Position::Logical(LogicalPosition::new(bounds.x, bounds.y)))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(bounds.width, bounds.height)))
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 确保便签窗口存在：已存在则显示，否则创建新窗口
///
/// 前端负责将百分比 bounds 转换为当前屏幕的绝对像素坐标，
/// Rust 端只需按给定坐标创建/显示窗口。
#[tauri::command]
pub async fn ensure_desktop_note_window(
    app: AppHandle,
    payload: EnsureDesktopNoteWindowPayload,
) -> Result<(), String> {
    let label = desktop_note_window_label(&payload.note_id);

    // 如果窗口已存在，仅显示并恢复焦点，不重新设置 bounds
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(desktop_note_window_route(&payload.note_id).into()),
    )
    .title(DESKTOP_NOTE_WINDOW_TITLE)
    .inner_size(payload.bounds.width, payload.bounds.height)
    .min_inner_size(DESKTOP_NOTE_MIN_WIDTH, DESKTOP_NOTE_MIN_HEIGHT)
    .decorations(false)
    .resizable(true)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(true)
    .focused(false)
    .build()
    .map_err(|error| error.to_string())?;

    set_note_window_geometry(&window, &payload.bounds)?;
    window.show().map_err(|error| error.to_string())?;

    Ok(())
}

/// 关闭便签窗口
#[tauri::command]
pub async fn close_desktop_note_window(
    app: AppHandle,
    payload: DesktopNoteIdPayload,
) -> Result<(), String> {
    let label = desktop_note_window_label(&payload.note_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_label_format() {
        assert_eq!(desktop_note_window_label("abc-123"), "desktop-note-abc-123");
    }

    #[test]
    fn test_window_route_format() {
        assert_eq!(
            desktop_note_window_route("abc-123"),
            "/sticky-note?noteId=abc-123"
        );
    }
}
