//! Selection Toolbar - 划词工具栏管理
//!
//! 提供系统级文本选择监听和浮动工具栏窗口管理功能

use serde::{Deserialize, Serialize};
use std::convert::TryInto;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const TOOLBAR_WIDTH: f64 = 80.0;
const TOOLBAR_HEIGHT: f64 = 35.0;
const TOOLBAR_VERTICAL_OFFSET: f64 = 10.0;

/// 工具栏窗口状态
///
/// 记录最近一次展示时间、文本内容以及整体启用状态。
/// - `last_text` 在窗口隐藏时会被清空，这样前端在下一次请求快照时就知道需要重置按钮状态。
/// - 该结构只在 Rust 侧持久化，前端通过 `get_selection_toolbar_state` 拉取一个只读快照。
pub struct ToolbarState {
    last_shown_at: Option<Instant>,
    last_text: Option<String>,
    enabled: bool,
    temporary_disabled_until: Option<SystemTime>,
    ignored_apps: Vec<String>,
}

impl Default for ToolbarState {
    fn default() -> Self {
        Self {
            last_shown_at: None,
            last_text: None,
            enabled: true,
            temporary_disabled_until: None,
            ignored_apps: Vec::new(),
        }
    }
}

impl ToolbarState {
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn set_temporary_disabled_until(&mut self, until: Option<SystemTime>) {
        self.temporary_disabled_until = until;
    }

    pub fn temporary_disabled_until(&self) -> Option<SystemTime> {
        self.temporary_disabled_until
    }

    pub fn is_temporarily_disabled(&mut self) -> bool {
        match self.temporary_disabled_until {
            Some(until) => {
                if SystemTime::now() >= until {
                    self.temporary_disabled_until = None;
                    false
                } else {
                    true
                }
            }
            None => false,
        }
    }

    pub fn set_ignored_apps(&mut self, apps: Vec<String>) {
        self.ignored_apps = apps
            .into_iter()
            .map(|app| app.trim().to_lowercase())
            .filter(|app| !app.is_empty())
            .collect();
    }

    pub fn ignored_apps(&self) -> &[String] {
        &self.ignored_apps
    }

    pub fn should_ignore_app(&self, identifier: &str) -> bool {
        if self.ignored_apps.is_empty() {
            return false;
        }

        let candidate = identifier.trim().to_lowercase();
        if candidate.is_empty() {
            return false;
        }

        self.ignored_apps.iter().any(|pattern| {
            candidate == *pattern || candidate.ends_with(pattern) || candidate.contains(pattern)
        })
    }
}

/// 工具栏窗口管理器
pub type ToolbarManager = Arc<Mutex<ToolbarState>>;

/// 工具栏窗口快照
///
/// 由前端在工具栏 Webview 初始化时主动请求一次，用于把 Rust 侧已有的选区同步给刚创建的窗口，
/// 这样首次显示时按钮就能根据历史文本立即启用，避免“第一次全灰”的体验问题。
#[derive(Debug, Serialize)]
pub struct SelectionToolbarSnapshot {
    pub last_text: Option<String>,
    pub enabled: bool,
    pub temporary_disabled_until_ms: Option<u64>,
    pub ignored_apps: Vec<String>,
}

fn system_time_to_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| duration.as_millis().try_into().ok())
}

fn millis_to_system_time(ms: u64) -> Option<SystemTime> {
    UNIX_EPOCH.checked_add(Duration::from_millis(ms))
}

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

/// 强制展示划词工具栏（绕过临时禁用状态）
///
/// 此函数专门用于快捷键触发场景，允许用户在临时禁用期间通过快捷键主动唤起工具栏。
///
/// # 工作原理
///
/// 1. **保存原始状态**：在展示前，先记录当前的临时禁用截止时间
/// 2. **临时清除禁用**：将临时禁用标记清空，以便 `show_toolbar_internal` 能够通过检查
/// 3. **执行展示逻辑**：调用内部展示函数，此时不会被临时禁用阻挡
/// 4. **恢复原始状态**：展示完成后，如果用户没有在工具栏内手动清除禁用，则恢复原来的截止时间
///
/// # 为什么需要这个函数
///
/// `show_toolbar_internal` 内部会检查 `is_temporarily_disabled()` 状态，即使热键处理逻辑
/// 决定"允许绕过"，依然会在最终展示时被拦截。因此需要在调用前临时清空该标记，
/// 待展示完成后再恢复，确保：
/// - 热键触发时能突破临时禁用限制
/// - 自动划词监听仍然受到临时禁用约束
/// - 用户在工具栏中的操作不会被意外覆盖
///
/// # 使用场景
///
/// - 用户按下划词快捷键（Ctrl/Cmd+Shift+S）
/// - 即使工具栏处于临时禁用倒计时中，也应响应快捷键
pub async fn show_selection_toolbar_force_with_manager(
    app: AppHandle,
    text: String,
    position: CursorPosition,
    toolbar_manager: ToolbarManager,
) -> Result<(), String> {
    // 步骤 1: 获取并保存当前的临时禁用截止时间
    let original_disable_until = {
        let mut state = toolbar_manager
            .lock()
            .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;
        let original = state.temporary_disabled_until();

        // 步骤 2: 临时清空禁用标记，允许工具栏展示
        if original.is_some() {
            state.set_temporary_disabled_until(None);
        }
        original
    };

    // 步骤 3: 执行实际的展示逻辑（此时临时禁用标记已清空）
    let result = show_toolbar_internal(&app, text, position, toolbar_manager.clone()).await;

    // 步骤 4: 恢复原始的临时禁用状态（如果用户未在工具栏内清除）
    if let Some(until) = original_disable_until {
        if let Ok(mut state) = toolbar_manager.lock() {
            // 只在当前状态仍为空时恢复，避免覆盖用户的新操作
            if state.temporary_disabled_until().is_none() {
                state.set_temporary_disabled_until(Some(until));
            }
        } else {
            log::warn!("Failed to restore temporary disable state after forced show");
        }
    }

    result
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
        let previous = state.is_enabled();
        state.set_enabled(enabled);
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

#[tauri::command]
pub async fn set_selection_toolbar_ignored_apps(
    apps: Vec<String>,
    toolbar_state: tauri::State<'_, ToolbarManager>,
) -> Result<(), String> {
    let count = {
        let mut state = toolbar_state
            .lock()
            .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;
        state.set_ignored_apps(apps);
        state.ignored_apps().len()
    };

    log::info!("Selection toolbar ignored apps updated (count={})", count);

    Ok(())
}

#[tauri::command]
pub async fn set_selection_toolbar_temporary_disabled_until(
    app: AppHandle,
    until: Option<u64>,
    toolbar_state: tauri::State<'_, ToolbarManager>,
) -> Result<(), String> {
    let resolved = until.and_then(millis_to_system_time);

    {
        let mut state = toolbar_state
            .lock()
            .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;
        state.set_temporary_disabled_until(resolved);
    }

    if let Some(target) = resolved {
        if let Some(ms) = system_time_to_millis(target) {
            log::info!(
                "Selection toolbar temporarily disabled (restore at {} ms since epoch)",
                ms
            );
        } else {
            log::info!("Selection toolbar temporarily disabled");
        }
        hide_toolbar_internal(&app, toolbar_state.inner()).await?;
    } else {
        log::info!("Selection toolbar temporary disable cleared");
    }

    Ok(())
}

/// 获取当前划词工具栏的状态快照
///
/// 主要用于前端在 Webview 首次挂载时同步 Rust 端已经缓存的文本与启用状态，
/// 解决窗口初次显示时按钮全部禁用的问题。
#[tauri::command]
pub async fn get_selection_toolbar_state(
    toolbar_state: tauri::State<'_, ToolbarManager>,
) -> Result<SelectionToolbarSnapshot, String> {
    let mut state = toolbar_state
        .lock()
        .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;

    let temporary_disabled_until_ms = if state.is_temporarily_disabled() {
        state
            .temporary_disabled_until()
            .and_then(system_time_to_millis)
    } else {
        None
    };

    Ok(SelectionToolbarSnapshot {
        last_text: state.last_text.clone(),
        enabled: state.is_enabled(),
        temporary_disabled_until_ms,
        ignored_apps: state.ignored_apps().to_vec(),
    })
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

    if state.is_temporarily_disabled() {
        log::debug!("Selection toolbar suppressed because feature is temporarily disabled");
        return Ok(());
    }

    let active_identifiers = resolve_active_app_identifiers();
    if let Some(identifier) = active_identifiers
        .iter()
        .find(|identifier| state.should_ignore_app(identifier))
    {
        log::debug!(
            "Selection toolbar suppressed due to ignored application identifier: {}",
            identifier
        );
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

pub(crate) fn resolve_active_app_identifiers() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        resolve_active_app_identifiers_windows()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "windows")]
fn resolve_active_app_identifiers_windows() -> Vec<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, RealGetWindowClassW,
    };

    let mut identifiers = Vec::new();

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return identifiers;
        }

        let mut class_buffer = [0u16; 256];
        let class_len = RealGetWindowClassW(hwnd, &mut class_buffer) as usize;
        if class_len > 0 {
            let trimmed = class_len.min(class_buffer.len());
            let class_name = OsString::from_wide(&class_buffer[..trimmed])
                .to_string_lossy()
                .to_lowercase();
            if !class_name.is_empty() {
                identifiers.push(class_name);
            }
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != 0 {
            if let Ok(process_handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut path_buffer = [0u16; 512];
                let mut size = path_buffer.len() as u32;
                if QueryFullProcessImageNameW(
                    process_handle,
                    PROCESS_NAME_FORMAT(0),
                    PWSTR(path_buffer.as_mut_ptr()),
                    &mut size,
                )
                .is_ok()
                    && size > 0
                {
                    let os_path = OsString::from_wide(&path_buffer[..size as usize]);
                    if let Some(name) = Path::new(&os_path)
                        .file_name()
                        .and_then(|segment| segment.to_str())
                    {
                        let normalized = name.to_lowercase();
                        if !normalized.is_empty() {
                            identifiers.push(normalized);
                        }
                    }
                }

                let _ = CloseHandle(process_handle);
            }
        }
    }

    identifiers.sort();
    identifiers.dedup();
    identifiers
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
