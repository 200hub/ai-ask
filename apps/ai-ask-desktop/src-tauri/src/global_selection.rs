//! 系统级划词捕获与全局快捷键回退。

use arboard::Clipboard;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use rdev::ListenError;
#[cfg(target_os = "macos")]
use rdev::{listen, Button, EventType};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::ptr::null_mut;
#[cfg(target_os = "windows")]
use std::sync::atomic::AtomicPtr;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP,
};

use crate::selection_toolbar::{
    hide_selection_toolbar_with_manager, platform_cursor_position, resolve_active_app_identifiers,
    show_selection_toolbar_force_with_manager, show_selection_toolbar_with_manager, CursorPosition,
    ToolbarManager,
};
#[cfg(target_os = "macos")]
use crate::window_control::resolve_main_window;

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::boolean::CFBoolean;
#[cfg(target_os = "macos")]
use core_foundation::dictionary::CFDictionary;
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;

/// 有效划词所需的最少非空白字符数量
const MIN_TEXT_LENGTH: usize = 2;

/// 触发去抖时间（毫秒），用于避免快速重复触发
const TRIGGER_DEBOUNCE_MS: u64 = 200;

/// 文本捕获的最大超时时间（毫秒）
/// 用于防止 UIA/Accessibility API 卡死导致整个应用无响应
const CAPTURE_TIMEOUT_MS: u64 = 2000;

const MIN_DRAG_DISTANCE_PX: f64 = 4.0;
const MULTI_CLICK_INTERVAL_MS: u64 = 500;
const MULTI_CLICK_DISTANCE_PX: f64 = 6.0;
static CAPTURE_BUSY: AtomicBool = AtomicBool::new(false);

struct CaptureGuard;

impl CaptureGuard {
    fn try_acquire() -> Option<Self> {
        CAPTURE_BUSY
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURE_BUSY.store(false, Ordering::Release);
    }
}

#[derive(Default)]
struct SelectionGesture {
    press: Option<(f64, f64)>,
    previous_click: Option<(Instant, (f64, f64))>,
}

impl SelectionGesture {
    fn press(&mut self, position: (f64, f64)) {
        self.press = Some(position);
    }

    fn release(&mut self, position: (f64, f64), now: Instant) -> bool {
        let Some(start) = self.press.take() else {
            return false;
        };
        let distance = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs().max((a.1 - b.1).abs());
        if distance(start, position) >= MIN_DRAG_DISTANCE_PX {
            self.previous_click = None;
            return true;
        }
        let repeated = self.previous_click.is_some_and(|(previous, point)| {
            now.duration_since(previous) <= Duration::from_millis(MULTI_CLICK_INTERVAL_MS)
                && distance(point, position) <= MULTI_CLICK_DISTANCE_PX
        });
        self.previous_click = Some((now, position));
        repeated
    }
}

/// macOS：当无辅助功能权限时的重试间隔（毫秒）
#[cfg(target_os = "macos")]
const LISTENER_RETRY_DELAY_MS: u64 = 2_000;

/// 检查 macOS 辅助功能权限是否已授予
#[cfg(target_os = "macos")]
fn check_macos_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe { AXIsProcessTrusted() }
}

/// 请求 macOS 辅助功能权限（会弹出系统提示）
#[cfg(target_os = "macos")]
fn request_macos_accessibility_permission() -> bool {
    use core_foundation::base::ToVoid;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    }

    let prompt_key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
    let prompt_value = CFBoolean::true_value();

    let options =
        CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt_value.as_CFType())]);

    unsafe { AXIsProcessTrustedWithOptions(options.to_void()) }
}

/// Tauri 命令：检查辅助功能权限状态
#[tauri::command]
pub async fn check_accessibility_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(check_macos_accessibility_permission())
    }

    #[cfg(target_os = "windows")]
    {
        // Windows doesn't require explicit permission for UI Automation
        Ok(true)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(false)
    }
}

/// Tauri 命令：请求辅助功能权限
#[tauri::command]
pub async fn request_accessibility_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let granted = request_macos_accessibility_permission();
        if granted {
            log::info!("Accessibility permission granted");
        } else {
            log::warn!("Accessibility permission not granted, system prompt shown");
        }
        Ok(granted)
    }

    #[cfg(target_os = "windows")]
    {
        Ok(true)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Accessibility permissions not supported on this platform".to_string())
    }
}

/// 平台无关的系统选中文本捕获接口
trait GlobalSelectionProvider: Send + Sync {
    /// 返回 provider 名称（用于日志）
    fn name(&self) -> &'static str;

    /// 尝试从活动窗口捕获选中文本；若无选区或失败则返回 None
    fn capture(&self, app: &AppHandle) -> Option<String>;
}

type ProviderList = Vec<Box<dyn GlobalSelectionProvider>>;

/// 构造当前平台可用的 provider 列表（按优先级匹配，先成功先返回）
fn build_providers() -> ProviderList {
    let mut list: ProviderList = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Windows：UI Automation 优先（兼容现代应用）
        list.push(Box::new(WindowsUIAutomationProvider::new()));
        // 传统应用回退：Win32 Edit 控件
        list.push(Box::new(WindowsWin32EditProvider::new()));
    }

    #[cfg(target_os = "macos")]
    {
        list.push(Box::new(MacosAccessibilityProvider::new()));
    }

    list
}

/// 规范化与校验捕获文本；过短或为空白时返回 None
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn normalize_selection(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed
        .chars()
        .filter(|character| !character.is_whitespace())
        .take(MIN_TEXT_LENGTH)
        .count()
        < MIN_TEXT_LENGTH
    {
        return None;
    }

    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_drags_and_nearby_double_clicks() {
        let now = Instant::now();
        let point = (18.0, 24.0);
        let mut gesture = SelectionGesture::default();
        gesture.press(point);
        assert!(!gesture.release((19.0, 25.0), now));

        gesture.press(point);
        assert!(gesture.release(point, now + Duration::from_millis(180)));

        gesture.press(point);
        assert!(gesture.release((80.0, 25.0), now + Duration::from_secs(2)));
    }

    #[test]
    fn ignores_unrelated_clicks_and_unpaired_releases() {
        let now = Instant::now();
        let mut gesture = SelectionGesture::default();
        assert!(!gesture.release((0.0, 0.0), now));
        gesture.press((18.0, 24.0));
        assert!(!gesture.release((18.0, 24.0), now));
        gesture.press((80.0, 25.0));
        assert!(!gesture.release((80.0, 25.0), now + Duration::from_millis(180)));
        gesture.press((80.0, 25.0));
        assert!(!gesture.release((80.0, 25.0), now + Duration::from_secs(1)));
    }
}

#[cfg(target_os = "windows")]
mod windows_uia {
    use super::{normalize_selection, GlobalSelectionProvider};
    use std::collections::VecDeque;
    use std::time::{Duration, Instant};
    use tauri::AppHandle;
    use windows::core::Interface;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomation2, IUIAutomationElement,
        IUIAutomationTextPattern, UIA_TextPatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    const UIA_CALL_TIMEOUT_MS: u32 = 250;
    const UIA_SEARCH_BUDGET_MS: u64 = 450;
    const UIA_MAX_DEPTH: u8 = 3;
    const UIA_MAX_NODES: usize = 32;
    const UIA_MAX_TEXT_LENGTH: i32 = 32768;

    fn selected_text(element: &IUIAutomationElement) -> Option<String> {
        unsafe {
            let pattern = element
                .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                .ok()?;
            let ranges = pattern.GetSelection().ok()?;
            if ranges.Length().ok()? == 0 {
                return None;
            }
            let text = ranges
                .GetElement(0)
                .ok()?
                .GetText(UIA_MAX_TEXT_LENGTH)
                .ok()?;
            normalize_selection(&text.to_string())
        }
    }

    fn search_descendants(
        ui: &IUIAutomation,
        roots: Vec<IUIAutomationElement>,
        deadline: Instant,
    ) -> Option<String> {
        unsafe {
            let walker = ui.ControlViewWalker().ok()?;
            let mut queue: VecDeque<_> = roots.into_iter().map(|root| (root, 0)).collect();
            let mut visited = 0;

            while let Some((element, depth)) = queue.pop_front() {
                if Instant::now() >= deadline || visited >= UIA_MAX_NODES {
                    break;
                }
                let mut child = walker.GetFirstChildElement(&element).ok();
                while let Some(node) = child {
                    if Instant::now() >= deadline || visited >= UIA_MAX_NODES {
                        return None;
                    }
                    visited += 1;
                    if let Some(text) = selected_text(&node) {
                        return Some(text);
                    }
                    child = walker.GetNextSiblingElement(&node).ok();
                    if depth + 1 < UIA_MAX_DEPTH {
                        queue.push_back((node, depth + 1));
                    }
                }
            }
            None
        }
    }

    pub struct WindowsUIAutomationProvider;

    impl WindowsUIAutomationProvider {
        pub fn new() -> Self {
            Self
        }
    }

    impl GlobalSelectionProvider for WindowsUIAutomationProvider {
        fn name(&self) -> &'static str {
            "windows-uia"
        }

        fn capture(&self, _app: &AppHandle) -> Option<String> {
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
                let result = capture();
                CoUninitialize();
                result
            }
        }
    }

    unsafe fn capture() -> Option<String> {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let ui: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        if let Ok(options) = ui.cast::<IUIAutomation2>() {
            let _ = options.SetConnectionTimeout(UIA_CALL_TIMEOUT_MS);
            let _ = options.SetTransactionTimeout(UIA_CALL_TIMEOUT_MS);
        }

        let deadline = Instant::now() + Duration::from_millis(UIA_SEARCH_BUDGET_MS);
        let focused = ui.GetFocusedElement().ok();
        if let Some(text) = focused.as_ref().and_then(selected_text) {
            return Some(text);
        }
        let root = ui.ElementFromHandle(hwnd).ok();
        if let Some(text) = root.as_ref().and_then(selected_text) {
            return Some(text);
        }
        search_descendants(&ui, focused.into_iter().chain(root).collect(), deadline)
    }
}

#[cfg(target_os = "windows")]
use windows_uia::WindowsUIAutomationProvider;

#[cfg(target_os = "windows")]
mod windows_win32 {
    use super::{normalize_selection, GlobalSelectionProvider};
    use tauri::AppHandle;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, RealGetWindowClassW, SendMessageTimeoutW, GUITHREADINFO,
        SMTO_ABORTIFHUNG, WM_GETTEXT,
    };

    const EM_GETSEL: u32 = 0x00B0;
    const MESSAGE_TIMEOUT_MS: u32 = 150;
    const SUPPORTED_CLASSES: [&str; 5] = [
        "Edit",
        "RichEdit20A",
        "RichEdit20W",
        "RichEdit50W",
        "RichEdit41W",
    ];

    pub struct WindowsWin32EditProvider;

    impl WindowsWin32EditProvider {
        pub fn new() -> Self {
            Self
        }
    }

    impl GlobalSelectionProvider for WindowsWin32EditProvider {
        fn name(&self) -> &'static str {
            "windows-win32-edit"
        }

        fn capture(&self, _app: &AppHandle) -> Option<String> {
            unsafe {
                let mut info = GUITHREADINFO {
                    cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                    ..Default::default()
                };
                GetGUIThreadInfo(0, &mut info).ok()?;
                let hwnd = info.hwndFocus;
                if hwnd.0.is_null() {
                    return None;
                }
                let mut class = [0u16; 64];
                let length = RealGetWindowClassW(hwnd, &mut class) as usize;
                let class = String::from_utf16_lossy(&class[..length.min(class.len())]);
                if !SUPPORTED_CLASSES
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(&class))
                {
                    return None;
                }

                let text = extract_selection_from_edit(hwnd)?;
                normalize_selection(&text)
            }
        }
    }

    unsafe fn send_edit_message(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> Option<usize> {
        let mut result = 0usize;
        let success = SendMessageTimeoutW(
            hwnd,
            message,
            wparam,
            lparam,
            SMTO_ABORTIFHUNG,
            MESSAGE_TIMEOUT_MS,
            Some(&mut result),
        );
        (success.0 != 0).then_some(result)
    }

    unsafe fn extract_selection_from_edit(hwnd: HWND) -> Option<String> {
        // EM_GETSEL's packed result contains both UTF-16 offsets for short selections.
        // Avoid cross-process pointer arguments for this control-specific message.
        let selection = send_edit_message(hwnd, EM_GETSEL, WPARAM(0), LPARAM(0))?;
        if selection as u32 == u32::MAX {
            return None;
        }
        let start = selection & 0xffff;
        let end = (selection >> 16) & 0xffff;
        if start >= end {
            return None;
        }
        let mut buffer = vec![0u16; end + 1];
        let copied = send_edit_message(
            hwnd,
            WM_GETTEXT,
            WPARAM(buffer.len()),
            LPARAM(buffer.as_mut_ptr() as isize),
        )?;
        let end = end.min(copied).min(buffer.len());
        (start < end).then(|| String::from_utf16_lossy(&buffer[start..end]))
    }
}

#[cfg(target_os = "windows")]
use windows_win32::WindowsWin32EditProvider;

// -----------------------------------------------------------------------------
// macOS Accessibility Provider（阶段 2）
// -----------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod macos_accessibility {
    use super::{normalize_selection, GlobalSelectionProvider};
    use accessibility::{AXAttribute, AXUIElement, Error as AccessibilityError};
    use core_foundation::string::CFString;
    use log::debug;
    use tauri::AppHandle;

    const ATTR_FOCUSED_UI_ELEMENT: &str = "AXFocusedUIElement";
    const ATTR_SELECTED_TEXT: &str = "AXSelectedText";

    pub struct MacosAccessibilityProvider;

    impl MacosAccessibilityProvider {
        pub fn new() -> Self {
            Self
        }

        fn capture_impl(&self) -> Option<String> {
            let system = AXUIElement::system_wide();
            let focused = Self::focused_element(&system)?;
            let selected = Self::read_selected_text(&focused)?;
            normalize_selection(&selected)
        }

        fn focused_element(system: &AXUIElement) -> Option<AXUIElement> {
            let attr = AXAttribute::new(&CFString::from_static_string(ATTR_FOCUSED_UI_ELEMENT));
            let raw_value = match system.attribute(&attr) {
                Ok(value) => value,
                Err(err) => {
                    match err {
                        AccessibilityError::Ax(code) => {
                            debug!(
                                "macOS accessibility provider failed to get focused element: AX error {:?}",
                                code
                            );
                        }
                        other => {
                            debug!(
                                "macOS accessibility provider failed to get focused element: {:?}",
                                other
                            );
                        }
                    }
                    return None;
                }
            };

            match raw_value.downcast::<AXUIElement>() {
                Some(element) => Some(element),
                None => {
                    debug!("macOS accessibility provider focused element has unexpected type");
                    None
                }
            }
        }

        fn read_selected_text(element: &AXUIElement) -> Option<String> {
            let attr = AXAttribute::new(&CFString::from_static_string(ATTR_SELECTED_TEXT));
            let value = match element.attribute(&attr) {
                Ok(value) => value,
                Err(err) => {
                    match err {
                        AccessibilityError::Ax(code) => {
                            debug!(
                                "macOS accessibility provider failed to read selected text: AX error {:?}",
                                code
                            );
                        }
                        other => {
                            debug!(
                                "macOS accessibility provider failed to read selected text: {:?}",
                                other
                            );
                        }
                    }
                    return None;
                }
            };

            match value.downcast::<CFString>() {
                Some(cf_string) => Some(cf_string.to_string()),
                None => {
                    debug!(
                        "macOS accessibility provider selected text attribute is not a CFString"
                    );
                    None
                }
            }
        }
    }

    impl GlobalSelectionProvider for MacosAccessibilityProvider {
        fn name(&self) -> &'static str {
            "macos-accessibility"
        }

        fn capture(&self, _app: &AppHandle) -> Option<String> {
            self.capture_impl()
        }
    }
}

#[cfg(target_os = "macos")]
use macos_accessibility::MacosAccessibilityProvider;

#[derive(Default)]
struct MonitorState {
    last_trigger_at: Option<Instant>,
}

#[cfg(target_os = "windows")]
struct WindowsMouseHookContext {
    gesture: SelectionGesture,
    sender: std::sync::mpsc::SyncSender<(f64, f64)>,
}

#[cfg(target_os = "windows")]
static WINDOWS_MOUSE_CONTEXT: AtomicPtr<WindowsMouseHookContext> = AtomicPtr::new(null_mut());

#[cfg(target_os = "windows")]
unsafe extern "system" fn windows_mouse_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0 && matches!(wparam.0 as u32, WM_LBUTTONDOWN | WM_LBUTTONUP) {
        let context = WINDOWS_MOUSE_CONTEXT.load(Ordering::Acquire);
        if !context.is_null() {
            let mouse_info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            // The hook and its context are owned by the same message-loop thread.
            let context = &mut *context;
            let point = (f64::from(mouse_info.pt.x), f64::from(mouse_info.pt.y));
            if wparam.0 as u32 == WM_LBUTTONDOWN {
                context.gesture.press(point);
            } else if context.gesture.release(point, Instant::now()) {
                let _ = context.sender.try_send(point);
            }
        }
    }

    CallNextHookEx(None, code, wparam, lparam)
}

pub fn start_global_selection_monitor(app: AppHandle) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        // macOS：检测辅助功能权限（未授权时仍会启动监听并周期重试）
        #[cfg(target_os = "macos")]
        {
            if !check_macos_accessibility_permission() {
                log::warn!(
                    "Global selection monitor: accessibility permission not granted. \
                    The monitor will start but will not receive events until permission is granted. \
                    Please enable accessibility permission in System Settings > Privacy & Security > Accessibility."
                );
            } else {
                log::info!("Global selection monitor: accessibility permission verified");
            }
        }

        let app_handle = app.clone();
        let toolbar_manager = app.state::<ToolbarManager>().inner().clone();
        let providers = Arc::new(build_providers());
        let shared_state = Arc::new(Mutex::new(MonitorState::default()));

        #[cfg(target_os = "macos")]
        spawn_macos_selection_listener(app_handle, toolbar_manager, providers, shared_state);

        #[cfg(target_os = "windows")]
        spawn_windows_selection_listener(app_handle, toolbar_manager, providers, shared_state);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        log::warn!("Global selection monitor is not available on this platform");
    }
}

#[cfg(target_os = "macos")]
fn spawn_macos_selection_listener(
    app_handle: AppHandle,
    toolbar_manager: ToolbarManager,
    providers: Arc<ProviderList>,
    shared_state: Arc<Mutex<MonitorState>>,
) {
    thread::spawn(move || {
        let mut attempt: u64 = 0;

        loop {
            attempt += 1;
            log::info!(
                "Starting global selection monitor listener (attempt #{})",
                attempt
            );

            let listener_app = app_handle.clone();
            let listener_toolbar = toolbar_manager.clone();
            let listener_state = shared_state.clone();
            let listener_providers = providers.clone();

            let gesture = Mutex::new(SelectionGesture::default());
            match listen(move |event| {
                if !matches!(
                    event.event_type,
                    EventType::ButtonPress(Button::Left) | EventType::ButtonRelease(Button::Left)
                ) {
                    return;
                }
                let Ok(point) = platform_cursor_position() else {
                    return;
                };
                let Ok(mut gesture) = gesture.try_lock() else {
                    return;
                };
                match event.event_type {
                    EventType::ButtonPress(Button::Left) => gesture.press(point),
                    EventType::ButtonRelease(Button::Left)
                        if gesture.release(point, Instant::now()) =>
                    {
                        queue_selection_capture(
                            point,
                            &listener_app,
                            &listener_toolbar,
                            &listener_state,
                            &listener_providers,
                        );
                    }
                    _ => {}
                }
            }) {
                Ok(()) => {
                    log::warn!("Global selection monitor listener exited unexpectedly; restarting");
                }
                Err(error) => {
                    log_listener_error(&error);
                }
            }

            log::info!(
                "Retrying global selection monitor in {} ms",
                LISTENER_RETRY_DELAY_MS
            );
            thread::sleep(Duration::from_millis(LISTENER_RETRY_DELAY_MS));
        }
    });

    log::info!("Global selection monitor worker spawned"); // 启动监听线程（macOS）
}

#[cfg(target_os = "windows")]
fn spawn_windows_selection_listener(
    app_handle: AppHandle,
    toolbar_manager: ToolbarManager,
    providers: Arc<ProviderList>,
    shared_state: Arc<Mutex<MonitorState>>,
) {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    thread::spawn(move || {
        while let Ok(point) = receiver.recv() {
            queue_selection_capture(
                point,
                &app_handle,
                &toolbar_manager,
                &shared_state,
                &providers,
            );
        }
    });

    thread::spawn(move || unsafe {
        let context = Box::new(WindowsMouseHookContext {
            gesture: SelectionGesture::default(),
            sender,
        });
        let context_ptr = Box::into_raw(context);
        WINDOWS_MOUSE_CONTEXT.store(context_ptr, Ordering::SeqCst);

        let hook = match SetWindowsHookExW(
            WH_MOUSE_LL,
            Some(windows_mouse_hook_proc),
            Some(HINSTANCE(null_mut())),
            0,
        ) {
            Ok(handle) => handle,
            Err(error) => {
                log::error!("Failed to install Windows mouse hook: {:?}", error);
                WINDOWS_MOUSE_CONTEXT.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(context_ptr));
                return;
            }
        };

        log::info!("Global selection monitor started (Windows mouse hook)"); // 启动监听线程（Windows）

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        if let Err(error) = UnhookWindowsHookEx(hook) {
            log::error!("Failed to unhook Windows mouse hook: {:?}", error);
        }
        WINDOWS_MOUSE_CONTEXT.store(null_mut(), Ordering::SeqCst);
        drop(Box::from_raw(context_ptr));
    });
}

#[cfg(target_os = "macos")]
fn log_listener_error(error: &ListenError) {
    match error {
        ListenError::EventTapError | ListenError::LoopSourceError => {
            log::warn!(
                "Global selection monitor cannot access macOS input events. \
                Please grant Input Monitoring and Accessibility permissions in System Settings; the app will keep retrying."
            );
        }
        ListenError::KeyHookError(code) => {
            log::error!(
                "Global selection monitor key hook error (code {}), restarting",
                code
            );
        }
        ListenError::MouseHookError(code) => {
            log::error!(
                "Global selection monitor mouse hook error (code {}), restarting",
                code
            );
        }
        other => {
            log::error!("Global selection monitor stopped: {:?}", other);
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn queue_selection_capture(
    point: (f64, f64),
    app: &AppHandle,
    toolbar_manager: &ToolbarManager,
    monitor_state: &Arc<Mutex<MonitorState>>,
    providers: &Arc<ProviderList>,
) {
    let now = Instant::now();
    if let Ok(mut state) = monitor_state.try_lock() {
        if state.last_trigger_at.is_some_and(|previous| {
            now.duration_since(previous) < Duration::from_millis(TRIGGER_DEBOUNCE_MS)
        }) {
            return;
        }
        state.last_trigger_at = Some(now);
    }

    let app = app.clone();
    let toolbar_manager = toolbar_manager.clone();
    let providers = providers.clone();
    tauri::async_runtime::spawn(async move {
        if foreground_belongs_to_app(&app) {
            return;
        }
        let identifiers = resolve_active_app_identifiers();
        let allowed = toolbar_manager.lock().is_ok_and(|mut state| {
            state.is_enabled()
                && !state.is_temporarily_disabled()
                && !identifiers.iter().any(|id| state.should_ignore_app(id))
        });
        if !allowed {
            return;
        }

        let Some(guard) = CaptureGuard::try_acquire() else {
            return;
        };
        #[cfg(target_os = "windows")]
        let foreground = foreground_window_token();
        let capture_app = app.clone();
        let capture = tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            capture_with_providers(&capture_app, &providers)
        });

        let Ok(Ok(text)) =
            tokio::time::timeout(Duration::from_millis(CAPTURE_TIMEOUT_MS), capture).await
        else {
            log::debug!("Global selection capture failed or timed out");
            return;
        };
        #[cfg(target_os = "windows")]
        if foreground != foreground_window_token() {
            return;
        }
        let Some(text) = text else {
            return;
        };
        let position = CursorPosition {
            x: point.0,
            y: point.1,
        };
        if let Err(error) =
            show_selection_toolbar_with_manager(app, text, position, toolbar_manager).await
        {
            log::warn!("Failed to show selection toolbar from global monitor: {error}");
        }
    });
}

#[cfg(target_os = "windows")]
fn foreground_window_token() -> usize {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow().0 as usize }
}

#[cfg(target_os = "windows")]
fn foreground_belongs_to_app(_app: &AppHandle) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
    }
    pid == std::process::id()
}

#[cfg(target_os = "macos")]
fn foreground_belongs_to_app(app: &AppHandle) -> bool {
    resolve_main_window(app).is_some_and(|window| window.is_focused().unwrap_or(false))
        || app
            .get_webview_window("selection-toolbar")
            .is_some_and(|window| window.is_focused().unwrap_or(false))
}

/// 依优先级顺序使用各 provider 尝试捕获文本；第一个成功即返回，否则 None
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn capture_with_providers(app: &AppHandle, providers: &ProviderList) -> Option<String> {
    for provider in providers.iter() {
        if let Some(text) = provider.capture(app) {
            log::debug!(
                "Global selection provider {} captured text successfully",
                provider.name()
            );
            return Some(text);
        }
    }
    None
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn capture_with_providers(_app: &AppHandle, _providers: &ProviderList) -> Option<String> {
    None
}

/// 为热键触发场景捕获文本（支持剪贴板回退）
///
/// 此函数专门为快捷键触发提供文本获取能力，与自动划词监听不同的是：
/// 当系统原生 provider（UIA/Accessibility）无法捕获选中文本时，会自动尝试
/// 从剪贴板读取文本作为回退方案。
///
/// # 使用场景
///
/// - 在不支持系统划词的应用中（如某些专有软件、游戏窗口等）
/// - 用户先手动复制文本（Ctrl+C）
/// - 再按划词快捷键（Ctrl/Cmd+Shift+S）
/// - 工具栏会使用剪贴板内容进行后续操作（翻译、解释等）
///
/// # 工作流程
///
/// 1. **优先尝试系统捕获**：调用平台 provider 尝试直接获取选中文本
/// 2. **剪贴板回退**：如果系统捕获失败，则读取剪贴板内容
/// 3. **验证有效性**：确保文本长度满足最小要求
///
/// # 返回值
///
/// - `Some(String)`: 成功捕获的有效文本（来自系统或剪贴板）
/// - `None`: 无法获取任何有效文本
fn capture_text_for_hotkey(app: &AppHandle) -> Option<String> {
    // 步骤 1: 优先使用系统原生 provider 捕获选中文本
    if let Some(_guard) = CaptureGuard::try_acquire() {
        let providers = build_providers();
        if let Some(text) = capture_with_providers(app, &providers) {
            return Some(text);
        }
    }

    // 步骤 2: 系统捕获失败，尝试从剪贴板读取作为回退方案
    let clipboard_text = read_clipboard_text();
    if clipboard_text.is_some() {
        log::debug!("Hotkey fallback captured text from clipboard");
    }

    clipboard_text
}

/// 从剪贴板读取文本并进行验证
///
/// 读取当前剪贴板中的文本内容，并验证其是否满足最小长度要求。
/// 此函数主要用于热键触发的回退场景。
///
/// # 验证规则
///
/// - 文本不能为空（去除首尾空白后）
/// - 非空白字符数量必须 >= MIN_TEXT_LENGTH (2)
///
/// # 返回值
///
/// - `Some(String)`: 有效的剪贴板文本
/// - `None`: 剪贴板为空、访问失败或文本不满足要求
fn read_clipboard_text() -> Option<String> {
    match Clipboard::new() {
        Ok(mut clipboard) => match clipboard.get_text() {
            Ok(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return None;
                }

                // 验证非空白字符数量是否满足最小要求
                if trimmed
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .count()
                    < MIN_TEXT_LENGTH
                {
                    return None;
                }

                Some(trimmed.to_string())
            }
            Err(error) => {
                log::debug!("Clipboard text read failed: {}", error);
                None
            }
        },
        Err(error) => {
            log::debug!("Clipboard access failed: {}", error);
            None
        }
    }
}

/// 异步隐藏工具栏（不阻塞当前线程）
fn schedule_hide_toolbar(app: &AppHandle, toolbar_manager: ToolbarManager) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = hide_selection_toolbar_with_manager(app_handle, toolbar_manager).await {
            log::debug!("Skip hiding selection toolbar: {}", error);
        }
    });
}

/// 通过快捷键手动触发划词工具栏
///
/// 当用户按下划词快捷键（Ctrl/Cmd+Shift+S）时调用此函数，与自动划词监听不同：
/// - **可绕过临时禁用**：即使工具栏处于临时禁用期，快捷键仍可唤起
/// - **支持剪贴板回退**：在不支持系统划词的应用中，可使用剪贴板内容
/// - **保留应用忽略名单**：仍然尊重用户配置的忽略应用列表
///
/// # 状态检查优先级
///
/// 1. **功能完全禁用**：如果用户在设置中关闭了划词功能，则直接返回
/// 2. **应用在忽略名单**：如果当前活动窗口在忽略列表中，则不响应
/// 3. **临时禁用（允许绕过）**：仅记录日志，继续执行捕获和展示流程
///
/// # 工作流程
///
/// 1. 检查各种状态标志（功能开关、忽略名单等）
/// 2. 在阻塞线程中执行文本捕获（系统 provider + 剪贴板回退）
/// 3. 获取当前光标位置
/// 4. 调用强制展示函数，绕过临时禁用限制
///
/// # 参数
///
/// - `app`: Tauri 应用句柄
/// - `toolbar_manager`: 工具栏状态管理器
pub fn trigger_toolbar_from_hotkey(app: AppHandle, toolbar_manager: ToolbarManager) {
    // 步骤 1: 读取并检查各种状态标志
    let (feature_enabled, temporarily_disabled, ignore_active_app) = match toolbar_manager.lock() {
        Ok(mut state) => {
            // 检查功能是否完全禁用
            let enabled = state.is_enabled();

            // 检查是否处于临时禁用期（热键场景下仅记录，不阻止）
            let temporarily_disabled = if enabled {
                state.is_temporarily_disabled()
            } else {
                false
            };

            // 检查当前活动应用是否在忽略名单中
            // 注意：只有在功能开启时才检查，避免无意义的系统调用
            let ignore_active_app = if enabled && !temporarily_disabled {
                let identifiers = resolve_active_app_identifiers();
                identifiers
                    .iter()
                    .any(|identifier| state.should_ignore_app(identifier))
            } else {
                false
            };

            (enabled, temporarily_disabled, ignore_active_app)
        }
        Err(err) => {
            log::error!("Failed to lock toolbar state for hotkey: {}", err);
            return;
        }
    };

    // 步骤 2: 如果功能完全禁用，则隐藏可能残留的工具栏并返回
    if !feature_enabled {
        log::debug!("Selection toolbar hotkey ignored because feature is disabled");
        schedule_hide_toolbar(&app, toolbar_manager.clone());
        return;
    }

    // 步骤 3: 如果当前应用在忽略名单中，则不响应快捷键
    // 这确保了用户配置的忽略规则在快捷键场景下仍然生效
    if ignore_active_app {
        log::debug!("Selection toolbar hotkey suppressed due to ignored application identifier");
        schedule_hide_toolbar(&app, toolbar_manager.clone());
        return;
    }

    // 步骤 4: 临时禁用状态下仍允许快捷键触发（关键设计决策）
    // 原因：用户主动按下快捷键表示明确意图，应优先于自动禁用规则
    if temporarily_disabled {
        log::debug!("Selection toolbar hotkey bypassing temporary disable state");
    }

    let app_clone = app.clone();
    let toolbar_manager_clone = toolbar_manager.clone();

    // 步骤 5: 在异步任务中执行文本捕获和工具栏展示
    // 使用异步任务避免阻塞主线程和快捷键响应
    tauri::async_runtime::spawn(async move {
        let capture_app = app_clone.clone();
        let toolbar_for_hide = toolbar_manager_clone.clone();

        // 步骤 5.1: 在阻塞线程池中执行文本捕获，添加超时保护
        // 原因：Windows UIA / macOS Accessibility API 可能耗时较长
        // 使用 spawn_blocking 避免阻塞异步运行时
        let capture_task =
            tauri::async_runtime::spawn_blocking(move || capture_text_for_hotkey(&capture_app));

        // 添加超时保护，防止 API 卡死
        let capture_result =
            tokio::time::timeout(Duration::from_millis(CAPTURE_TIMEOUT_MS), capture_task).await;

        // 步骤 5.2: 处理捕获结果（包括超时情况）
        let selected_text = match capture_result {
            Ok(Ok(Some(text))) => text,
            Ok(Ok(None)) => {
                // 系统 provider 和剪贴板都没有可用文本，隐藏工具栏
                log::debug!("Hotkey trigger skipped: no provider or clipboard text available");
                schedule_hide_toolbar(&app_clone, toolbar_for_hide);
                return;
            }
            Ok(Err(error)) => {
                // 捕获任务本身失败（极少见），记录错误并隐藏工具栏
                log::error!("Selection toolbar hotkey capture task panicked: {}", error);
                schedule_hide_toolbar(&app_clone, toolbar_manager_clone.clone());
                return;
            }
            Err(_) => {
                // 捕获超时
                log::warn!(
                    "Selection toolbar hotkey capture timed out after {} ms",
                    CAPTURE_TIMEOUT_MS
                );
                schedule_hide_toolbar(&app_clone, toolbar_manager_clone.clone());
                return;
            }
        };

        // 步骤 5.3: 获取当前光标位置，用于定位工具栏
        let position = match platform_cursor_position() {
            Ok((x, y)) => CursorPosition { x, y },
            Err(err) => {
                // 无法获取光标位置时，隐藏工具栏避免显示在错误位置
                log::warn!("Failed to read cursor position for hotkey trigger: {}", err);
                schedule_hide_toolbar(&app_clone, toolbar_manager_clone.clone());
                return;
            }
        };

        // 步骤 5.4: 调用强制展示函数，绕过临时禁用状态
        // 使用 show_selection_toolbar_force_with_manager 而非普通展示函数
        // 确保即使在临时禁用期间，快捷键仍能唤起工具栏
        if let Err(error) = show_selection_toolbar_force_with_manager(
            app_clone.clone(),
            selected_text,
            position,
            toolbar_manager_clone.clone(),
        )
        .await
        {
            log::error!("Failed to show selection toolbar from hotkey: {}", error);
        }
    });
}
