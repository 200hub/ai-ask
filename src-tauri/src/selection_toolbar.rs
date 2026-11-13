//! Selection Toolbar - 划词工具栏管理
//!
//! 提供系统级文本选择监听和浮动工具栏窗口管理功能
//! 以及浮动结果窗口（用于显示翻译/解释结果）

use serde::{Deserialize, Serialize};
use std::convert::TryInto;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const TOOLBAR_WIDTH: f64 = 80.0;
const TOOLBAR_HEIGHT: f64 = 35.0;
const TOOLBAR_VERTICAL_OFFSET: f64 = 10.0;
static TOOLBAR_VISIBILITY_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// 浮动结果窗口常量
const RESULT_WINDOW_WIDTH: f64 = 360.0;
const RESULT_WINDOW_HEIGHT: f64 = 240.0;
const RESULT_WINDOW_MIN_HEIGHT: f64 = 120.0;
const RESULT_WINDOW_VERTICAL_GAP: f64 = 8.0;

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
    show_toolbar_internal(&app, text, position, toolbar_state.inner().clone(), false).await
}

/// 外部调用接口 (例如全局监听器) —— 直接使用工具栏管理器实例
pub async fn show_selection_toolbar_with_manager(
    app: AppHandle,
    text: String,
    position: CursorPosition,
    toolbar_manager: ToolbarManager,
) -> Result<(), String> {
    show_toolbar_internal(&app, text, position, toolbar_manager, false).await
}

/// Manually triggered selections bypass temporary suppression.
pub async fn show_selection_toolbar_force_with_manager(
    app: AppHandle,
    text: String,
    position: CursorPosition,
    toolbar_manager: ToolbarManager,
) -> Result<(), String> {
    show_toolbar_internal(&app, text, position, toolbar_manager, true).await
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
    let _visibility = TOOLBAR_VISIBILITY_GATE.lock().await;
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
    bypass_temporary_disable: bool,
) -> Result<(), String> {
    let _visibility = TOOLBAR_VISIBILITY_GATE.lock().await;
    let trimmed_text = text.trim();
    if trimmed_text.is_empty() {
        log::debug!("Selection toolbar suppressed due to empty text");
        return Ok(());
    }

    let active_identifiers = resolve_active_app_identifiers();
    let mut state = toolbar_manager
        .lock()
        .map_err(|e| format!("Failed to lock toolbar state: {}", e))?;

    if !state.enabled {
        log::debug!("Selection toolbar suppressed because feature is disabled");
        return Ok(());
    }

    if !bypass_temporary_disable && state.is_temporarily_disabled() {
        log::debug!("Selection toolbar suppressed because feature is temporarily disabled");
        return Ok(());
    }

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

    position_popup(
        &window,
        position,
        TOOLBAR_WIDTH,
        TOOLBAR_HEIGHT,
        TOOLBAR_VERTICAL_OFFSET,
    )?;

    let text_payload = trimmed_text.to_string();
    if let Err(error) = window.emit("toolbar-text-selected", text_payload) {
        log::warn!("Failed to emit toolbar text event: {}", error);
    }

    // 仅在窗口不可见时才调用 show，避免不必要的窗口操作
    if !window.is_visible().unwrap_or(false) {
        window.show().map_err(|err| err.to_string())?;
    }

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
        .always_on_top(true)
        .focusable(false)
        .visible_on_all_workspaces(true)
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

// ============================================================================
// 浮动结果窗口管理
// ============================================================================

const RESULT_WINDOW_LABEL: &str = "selection-result";
const RESULT_STATE_EVENT: &str = "selection-result:state";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultWindowRequest {
    action_type: String,
    text: String,
    platform_id: String,
    platform_name: String,
    toolbar_position: Option<CursorPosition>,
    error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultWindowSnapshot {
    request_id: u32,
    request: ResultWindowRequest,
    outcome: Option<Result<serde_json::Value, String>>,
    #[serde(skip)]
    pinned: bool,
}

#[derive(Default)]
pub struct ResultWindowManager {
    windows: Mutex<std::collections::HashMap<String, ResultWindowSnapshot>>,
    show_gate: tokio::sync::Mutex<()>,
    next_id: AtomicU32,
}

impl ResultWindowManager {
    fn allocate_request_id(&self) -> Result<u32, String> {
        self.next_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
            .map_err(|_| "Selection request ID space exhausted".into())
    }
}

#[tauri::command]
pub fn allocate_selection_request_id(
    webview: tauri::Webview,
    manager: tauri::State<'_, ResultWindowManager>,
) -> Result<u32, String> {
    if webview.label() != "main" {
        return Err("Only the main webview may allocate selection request IDs".into());
    }
    manager.allocate_request_id()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultWindowTarget {
    window_label: String,
    request_id: u32,
}

#[tauri::command]
pub async fn show_selection_result_window(
    app: AppHandle,
    manager: tauri::State<'_, ResultWindowManager>,
    request: ResultWindowRequest,
) -> Result<ResultWindowTarget, String> {
    let _show = manager.show_gate.lock().await;
    let request_id = manager.allocate_request_id()?;
    let main_is_pinned = manager
        .windows
        .lock()
        .map_err(|err| err.to_string())?
        .get(RESULT_WINDOW_LABEL)
        .is_some_and(|window| window.pinned);
    let label = if main_is_pinned {
        format!("{RESULT_WINDOW_LABEL}-{request_id}")
    } else {
        RESULT_WINDOW_LABEL.to_string()
    };

    let anchor = request.toolbar_position.clone().unwrap_or_else(|| {
        let point = app.cursor_position().unwrap_or_default();
        CursorPosition {
            x: point.x,
            y: point.y,
        }
    });
    let snapshot = ResultWindowSnapshot {
        request_id,
        request,
        outcome: None,
        pinned: false,
    };
    manager
        .windows
        .lock()
        .map_err(|err| err.to_string())?
        .insert(label.clone(), snapshot.clone());

    let show = || -> Result<(), String> {
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => create_result_window(&app, &label)?,
        };
        position_popup(
            &window,
            anchor,
            RESULT_WINDOW_WIDTH,
            RESULT_WINDOW_HEIGHT,
            RESULT_WINDOW_VERTICAL_GAP,
        )?;
        app.emit_to(&label, RESULT_STATE_EVENT, snapshot)
            .map_err(|err| err.to_string())?;
        window.show().map_err(|err| err.to_string())?;
        if let Err(error) = window.set_focus() {
            log::debug!("Could not focus selection result window: {error}");
        }
        Ok(())
    };
    if let Err(error) = show() {
        if let Ok(mut windows) = manager.windows.lock() {
            windows.remove(&label);
        }
        return Err(error);
    }

    Ok(ResultWindowTarget {
        window_label: label,
        request_id,
    })
}

#[tauri::command]
pub fn get_selection_result_state(
    window: WebviewWindow,
    manager: tauri::State<'_, ResultWindowManager>,
) -> Result<Option<ResultWindowSnapshot>, String> {
    let windows = manager.windows.lock().map_err(|err| err.to_string())?;
    Ok(windows.get(window.label()).cloned())
}

#[tauri::command]
pub fn publish_selection_result(
    app: AppHandle,
    manager: tauri::State<'_, ResultWindowManager>,
    window_label: String,
    request_id: u32,
    outcome: Result<serde_json::Value, String>,
) -> Result<(), String> {
    let mut windows = manager.windows.lock().map_err(|err| err.to_string())?;
    let Some(window) = windows.get_mut(&window_label) else {
        return Ok(());
    };
    if window.request_id != request_id {
        return Ok(());
    }
    window.outcome = Some(outcome);
    let snapshot = window.clone();
    drop(windows);
    app.emit_to(&window_label, RESULT_STATE_EVENT, snapshot)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_selection_result_pinned(
    window: WebviewWindow,
    manager: tauri::State<'_, ResultWindowManager>,
    request_id: u32,
    pinned: bool,
) -> Result<(), String> {
    let mut windows = manager.windows.lock().map_err(|err| err.to_string())?;
    if let Some(snapshot) = windows.get_mut(window.label()) {
        if snapshot.request_id == request_id {
            snapshot.pinned = pinned;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn dismiss_selection_result_window(
    window: WebviewWindow,
    manager: tauri::State<'_, ResultWindowManager>,
    request_id: u32,
) -> Result<(), String> {
    let _show = manager.show_gate.lock().await;
    let dismissed = {
        let mut windows = manager.windows.lock().map_err(|err| err.to_string())?;
        if windows
            .get(window.label())
            .is_some_and(|snapshot| snapshot.request_id == request_id)
        {
            windows.remove(window.label());
            true
        } else {
            false
        }
    };
    if dismissed {
        if window.label() == RESULT_WINDOW_LABEL {
            window.hide().map_err(|err| err.to_string())?;
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|err| err.to_string())?;
            }
        } else {
            window.close().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn create_result_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("/toolbar-result".into()))
        .title("Selection Result")
        .inner_size(RESULT_WINDOW_WIDTH, RESULT_WINDOW_HEIGHT)
        .min_inner_size(RESULT_WINDOW_WIDTH, RESULT_WINDOW_MIN_HEIGHT)
        .decorations(false)
        .resizable(true)
        .maximizable(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("Failed to create result window: {e}"))?;
    let window_label = label.to_string();
    let app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let manager = app.state::<ResultWindowManager>();
            if let Ok(mut windows) = manager.windows.lock() {
                windows.remove(&window_label);
            };
        }
    });
    Ok(window)
}

fn position_popup(
    window: &WebviewWindow,
    anchor: CursorPosition,
    width: f64,
    height: f64,
    gap: f64,
) -> Result<(), String> {
    let monitor = window
        .monitor_from_point(anchor.x, anchor.y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let scale = monitor
        .as_ref()
        .map_or(1.0, |monitor| monitor.scale_factor());
    let area = monitor.as_ref().map(|monitor| {
        let area = monitor.work_area();
        (
            f64::from(area.position.x),
            f64::from(area.position.y),
            f64::from(area.size.width),
            f64::from(area.size.height),
        )
    });
    let position = popup_position(anchor, width * scale, height * scale, gap * scale, area);
    window
        .set_position(Position::Physical(position))
        .map_err(|err| err.to_string())
}

fn popup_position(
    anchor: CursorPosition,
    width: f64,
    height: f64,
    gap: f64,
    area: Option<(f64, f64, f64, f64)>,
) -> PhysicalPosition<i32> {
    let mut x = anchor.x - width / 2.0;
    let mut y = anchor.y - height - gap;
    if let Some((left, top, area_width, area_height)) = area {
        if y < top {
            y = anchor.y + gap;
        }
        x = x.clamp(left, left + (area_width - width).max(0.0));
        y = y.clamp(top, top + (area_height - height).max(0.0));
    }
    PhysicalPosition::new(x.round() as i32, y.round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_request_ids_remain_monotonic_without_wrapping() {
        let manager = ResultWindowManager::default();
        assert_eq!(manager.allocate_request_id(), Ok(0));
        assert_eq!(manager.allocate_request_id(), Ok(1));
        manager.next_id.store(u32::MAX - 1, Ordering::Relaxed);
        assert_eq!(manager.allocate_request_id(), Ok(u32::MAX - 1));
        assert!(manager.allocate_request_id().is_err());
    }

    #[test]
    fn popup_stays_on_monitor_with_negative_origin() {
        let area = Some((-1600.0, -300.0, 1600.0, 900.0));
        let anchor = CursorPosition {
            x: -1580.0,
            y: -280.0,
        };
        assert_eq!(
            popup_position(anchor, 540.0, 360.0, 12.0, area),
            PhysicalPosition::new(-1600, -268),
        );
    }

    #[test]
    fn popup_avoids_monitor_work_area_edges() {
        let area = Some((1920.0, 0.0, 1280.0, 760.0));
        let anchor = CursorPosition {
            x: 3198.0,
            y: 700.0,
        };
        assert_eq!(
            popup_position(anchor, 360.0, 240.0, 8.0, area),
            PhysicalPosition::new(2840, 452),
        );
    }
}
