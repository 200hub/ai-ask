//! Global selection monitor
//!
//! Listens to system-wide selection gestures and triggers the selection toolbar
//! when the user finishes selecting text outside the main webview.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
// removed unused time imports after provider refactor

#[cfg(target_os = "macos")]
use rdev::ListenError;
use rdev::{listen, Button, Event, EventType};
use tauri::{AppHandle, Manager};

use crate::selection_toolbar::{
    hide_selection_toolbar_with_manager, platform_cursor_position,
    show_selection_toolbar_with_manager, CursorPosition, ToolbarManager,
};
use crate::window_control::resolve_main_window;

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::boolean::CFBoolean;
#[cfg(target_os = "macos")]
use core_foundation::dictionary::CFDictionary;
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;

/// Minimum number of non-whitespace characters required for valid selection
const MIN_TEXT_LENGTH: usize = 2;

/// Debounce time in milliseconds to prevent rapid-fire triggers
const TRIGGER_DEBOUNCE_MS: u64 = 200;

/// macOS listener retry delay when accessibility permissions fail
#[cfg(target_os = "macos")]
const LISTENER_RETRY_DELAY_MS: u64 = 2_000;

/// Check if macOS accessibility permissions are granted
#[cfg(target_os = "macos")]
fn check_macos_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe { AXIsProcessTrusted() }
}

/// Request macOS accessibility permissions with prompt
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

/// Tauri command to check accessibility permission status
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

/// Tauri command to request accessibility permission
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

/// Platform-agnostic trait for capturing selected text from the system
trait GlobalSelectionProvider: Send + Sync {
    /// Returns the provider's name for logging purposes
    fn name(&self) -> &'static str;

    /// Attempts to capture selected text from the active window
    /// Returns None if no selection is available or capture fails
    fn capture(&self, app: &AppHandle) -> Option<String>;
}

type ProviderList = Vec<Box<dyn GlobalSelectionProvider>>;

/// Constructs the list of available selection providers for the current platform
/// Providers are ordered by priority (first match wins)
fn build_providers() -> ProviderList {
    let mut list: ProviderList = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Windows UI Automation provider has highest priority (works with most modern apps)
        list.push(Box::new(WindowsUIAutomationProvider::new()));
        // Win32 Edit control fallback for legacy applications
        list.push(Box::new(WindowsWin32EditProvider::new()));
    }

    #[cfg(target_os = "macos")]
    {
        list.push(Box::new(MacosAccessibilityProvider::new()));
    }

    list
}

/// Normalizes and validates captured text
/// Returns None if text is too short or contains only whitespace
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn normalize_selection(text: &str) -> Option<String> {
    let trimmed = text.trim();
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

// -----------------------------------------------------------------------------
// Windows UI Automation Provider (Phase 2)
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod windows_uia {
    use super::{normalize_selection, GlobalSelectionProvider};
    use tauri::AppHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextRangeArray, TreeScope_Subtree, UIA_IsTextPatternAvailablePropertyId,
        UIA_TextPatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    /// Attempts to obtain a TextPattern from an element or its descendants
    /// First tries the element directly, then searches subtree for text-capable descendants
    fn obtain_text_pattern(
        ui: &IUIAutomation,
        element: &IUIAutomationElement,
    ) -> Option<IUIAutomationTextPattern> {
        unsafe {
            // Try to get TextPattern directly from the element
            if let Ok(pattern) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                return Some(pattern);
            }

            // Search for descendants that support TextPattern
            let value = VARIANT::from(true);
            if let Ok(condition) =
                ui.CreatePropertyCondition(UIA_IsTextPatternAvailablePropertyId, &value)
            {
                if let Ok(descendant) = element.FindFirst(TreeScope_Subtree, &condition) {
                    if let Ok(pattern) = descendant
                        .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                    {
                        return Some(pattern);
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

        fn capture_impl(&self) -> Option<String> {
            unsafe {
                // Initialize COM for the current thread
                // CoInitializeEx returns S_OK if initialized, S_FALSE if already initialized
                let init_hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                if init_hr.is_err() {
                    log::debug!("Windows UIA provider COM init error: {:?}", init_hr);
                }
                let should_uninit = init_hr.is_ok();

                let result = (|| -> windows::core::Result<Option<String>> {
                    let ui: IUIAutomation =
                        match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                            Ok(ui) => ui,
                            Err(err) => {
                                log::debug!(
                                "Windows UIA provider failed to create automation instance: {:?}",
                                err
                            );
                                return Ok(None);
                            }
                        };

                    let hwnd: HWND = GetForegroundWindow();
                    if hwnd.0.is_null() {
                        log::debug!("Windows UIA provider skipped: no foreground window");
                        return Ok(None);
                    }

                    // Collect candidate elements: focused element and window root
                    let mut candidates: Vec<(&'static str, IUIAutomationElement)> = Vec::new();

                    // Try to get the currently focused UI element
                    match ui.GetFocusedElement() {
                        Ok(focus) => {
                            candidates.push(("focus", focus));
                        }
                        Err(err) => {
                            log::debug!(
                                "Windows UIA provider: failed to get focused element: {:?}",
                                err
                            );
                        }
                    }

                    // Get the root element of the foreground window as fallback
                    match ui.ElementFromHandle(hwnd) {
                        Ok(root) => {
                            candidates.push(("window", root));
                        }
                        Err(err) => {
                            log::debug!(
                                "Windows UIA provider failed to resolve element from hwnd: {:?}",
                                err
                            );
                        }
                    }

                    if candidates.is_empty() {
                        log::debug!(
                            "Windows UIA provider: no elements available for TextPattern lookup"
                        );
                        return Ok(None);
                    }

                    // Search for TextPattern in candidate elements (focus first, then window)
                    let mut pattern: Option<IUIAutomationTextPattern> = None;
                    for (label, element) in &candidates {
                        if let Some(found) = obtain_text_pattern(&ui, element) {
                            pattern = Some(found);
                            break;
                        } else {
                            log::debug!(
                                "Windows UIA provider: {} element lacks TextPattern after search",
                                label
                            );
                        }
                    }

                    let pattern = match pattern {
                        Some(pattern) => pattern,
                        None => {
                            log::debug!("Windows UIA provider: no TextPattern found; falling back");
                            return Ok(None);
                        }
                    };

                    let ranges: IUIAutomationTextRangeArray = match pattern.GetSelection() {
                        Ok(ranges) => ranges,
                        Err(err) => {
                            log::debug!("Windows UIA provider: GetSelection failed: {:?}", err);
                            return Ok(None);
                        }
                    };

                    let length: i32 = match ranges.Length() {
                        Ok(length) => length,
                        Err(err) => {
                            log::debug!(
                                "Windows UIA provider: failed to read selection length: {:?}",
                                err
                            );
                            return Ok(None);
                        }
                    };
                    if length <= 0 {
                        return Ok(None);
                    }

                    let range = match ranges.GetElement(0) {
                        Ok(range) => range,
                        Err(err) => {
                            log::debug!(
                                "Windows UIA provider: failed to get selection range: {:?}",
                                err
                            );
                            return Ok(None);
                        }
                    };

                    let text_bstr = match range.GetText(-1) {
                        Ok(text) => text,
                        Err(err) => {
                            log::debug!(
                                "Windows UIA provider: failed to read text from range: {:?}",
                                err
                            );
                            return Ok(None);
                        }
                    };
                    let text = text_bstr.to_string();
                    Ok(normalize_selection(&text))
                })();

                if should_uninit {
                    CoUninitialize();
                }

                match result {
                    Ok(v) => v,
                    Err(e) => {
                        log::debug!("Windows UIA capture error: {:?}", e);
                        None
                    }
                }
            }
        }
    }

    impl GlobalSelectionProvider for WindowsUIAutomationProvider {
        fn name(&self) -> &'static str {
            "windows-uia"
        }

        fn capture(&self, _app: &AppHandle) -> Option<String> {
            self.capture_impl()
        }
    }
}

#[cfg(target_os = "windows")]
use windows_uia::WindowsUIAutomationProvider;

// -----------------------------------------------------------------------------
// Windows Win32 Edit Control Fallback Provider
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod windows_win32 {
    // Agent fallback provider: proxy classic Win32 edit controls when UIA cannot supply text.
    use super::{normalize_selection, GlobalSelectionProvider};
    use std::collections::HashSet;
    use std::sync::OnceLock;
    use tauri::AppHandle;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, RealGetWindowClassW, SendMessageW, WM_GETTEXT, WM_GETTEXTLENGTH,
    };

    const EM_GETSEL: u32 = 0x00B0;

    pub struct WindowsWin32EditProvider;

    impl WindowsWin32EditProvider {
        pub fn new() -> Self {
            Self
        }

        fn capture_impl(&self) -> Option<String> {
            unsafe {
                let hwnd: HWND = GetForegroundWindow();
                if hwnd.0.is_null() {
                    return None;
                }

                let class_name = get_window_class(hwnd)?;
                if !is_supported_class(&class_name) {
                    return None;
                }

                extract_selection_from_edit(hwnd).and_then(|text| normalize_selection(&text))
            }
        }
    }

    impl GlobalSelectionProvider for WindowsWin32EditProvider {
        fn name(&self) -> &'static str {
            "windows-win32-edit"
        }

        fn capture(&self, _app: &AppHandle) -> Option<String> {
            self.capture_impl()
        }
    }

    fn supported_classes() -> &'static HashSet<String> {
        static CLASSES: OnceLock<HashSet<String>> = OnceLock::new();
        CLASSES.get_or_init(|| {
            [
                "Edit",
                "RichEdit20A",
                "RichEdit20W",
                "RichEdit50W",
                "RichEdit41W",
            ]
            .iter()
            .map(|name| name.to_string())
            .collect()
        })
    }

    fn is_supported_class(class: &str) -> bool {
        supported_classes().contains(class)
    }

    unsafe fn get_window_class(hwnd: HWND) -> Option<String> {
        let mut buffer = [0u16; 256];
        let length = RealGetWindowClassW(hwnd, &mut buffer) as usize;
        if length == 0 {
            return None;
        }
        let trimmed_length = length.min(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..trimmed_length]))
    }

    /// Extracts selected text from a Win32 Edit control
    /// Returns None if no selection or extraction fails
    unsafe fn extract_selection_from_edit(hwnd: HWND) -> Option<String> {
        let mut start: u32 = 0;
        let mut end: u32 = 0;

        // EM_GETSEL returns selection start/end positions in UTF-16 code units
        let _ = SendMessageW(
            hwnd,
            EM_GETSEL,
            Some(WPARAM((&mut start as *mut u32) as usize)),
            Some(LPARAM((&mut end as *mut u32) as isize)),
        );

        if start >= end {
            return None;
        }

        let text_length =
            SendMessageW(hwnd, WM_GETTEXTLENGTH, Some(WPARAM(0)), Some(LPARAM(0))).0 as usize;
        if text_length == 0 {
            return None;
        }

        let mut buffer = vec![0u16; text_length + 1];
        let copied = SendMessageW(
            hwnd,
            WM_GETTEXT,
            Some(WPARAM(buffer.len())),
            Some(LPARAM(buffer.as_mut_ptr() as isize)),
        )
        .0 as usize;

        if copied == 0 {
            return None;
        }

        let slice_end = end.min(copied as u32) as usize;
        let slice_start = start.min(slice_end as u32) as usize;
        if slice_start >= slice_end {
            return None;
        }

        String::from_utf16(&buffer[slice_start..slice_end]).ok()
    }
}

#[cfg(target_os = "windows")]
use windows_win32::WindowsWin32EditProvider;

// -----------------------------------------------------------------------------
// macOS Accessibility Provider (Phase 2)
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

/// Shared state for the global selection monitor
#[derive(Default)]
struct MonitorState {
    /// Timestamp of last trigger for debouncing
    last_trigger_at: Option<Instant>,
    /// Last captured text to detect duplicates
    last_text: Option<String>,
    /// Last recorded mouse position (x, y)
    last_mouse_position: (f64, f64),
    /// Flag to prevent concurrent capture operations
    capture_in_progress: bool,
}

pub fn start_global_selection_monitor(app: AppHandle) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        // Check accessibility permission on macOS
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

            match listen(move |event| {
                handle_event(
                    event,
                    &listener_app,
                    &listener_toolbar,
                    &listener_state,
                    &listener_providers,
                );
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

    log::info!("Global selection monitor worker spawned");
}

#[cfg(target_os = "windows")]
fn spawn_windows_selection_listener(
    app_handle: AppHandle,
    toolbar_manager: ToolbarManager,
    providers: Arc<ProviderList>,
    shared_state: Arc<Mutex<MonitorState>>,
) {
    thread::spawn(move || {
        if let Err(error) = listen(move |event| {
            handle_event(
                event,
                &app_handle,
                &toolbar_manager,
                &shared_state,
                &providers,
            );
        }) {
            log::error!("Global selection monitor stopped: {:?}", error);
        }
    });

    log::info!("Global selection monitor started");
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

/// RAII guard to reset capture_in_progress flag when async task completes
/// This ensures the flag is always reset, even if the task exits early
struct CaptureResetGuard {
    state: Arc<Mutex<MonitorState>>,
}

impl Drop for CaptureResetGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.capture_in_progress = false;
        }
    }
}

/// Core event handler for mouse events
/// Triggers selection capture when left mouse button is released
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_event(
    event: Event,
    app: &AppHandle,
    toolbar_manager: &ToolbarManager,
    monitor_state: &Arc<Mutex<MonitorState>>,
    providers: &Arc<ProviderList>,
) {
    // Continuously track mouse position for toolbar positioning
    if let EventType::MouseMove { x, y } = event.event_type {
        if let Ok(mut state) = monitor_state.lock() {
            state.last_mouse_position = (x, y);
        }
        return;
    }

    // Only process left mouse button release events
    if !matches!(event.event_type, EventType::ButtonRelease(Button::Left)) {
        return;
    }

    // Check if the feature is enabled
    let feature_enabled = match toolbar_manager.lock() {
        Ok(state) => state.is_enabled(),
        Err(err) => {
            log::error!("Failed to lock toolbar state: {}", err);
            return;
        }
    };

    if !feature_enabled {
        schedule_hide_toolbar(app, Arc::clone(toolbar_manager));
        return;
    }

    // Apply debounce to prevent rapid-fire triggers
    {
        let mut state = match monitor_state.lock() {
            Ok(guard) => guard,
            Err(err) => {
                log::error!("Failed to lock global selection state: {}", err);
                return;
            }
        };

        let now = Instant::now();
        if let Some(last) = state.last_trigger_at {
            if now.duration_since(last) < Duration::from_millis(TRIGGER_DEBOUNCE_MS) {
                return;
            }
        }
        state.last_trigger_at = Some(now);
    }

    // Ignore selections in the main window itself
    if let Some(window) = resolve_main_window(app) {
        if window.is_focused().unwrap_or(false) {
            return;
        }
    }

    // Check and set capture_in_progress flag to prevent concurrent captures
    // This avoids blocking the input hook with slow UIA/Win32 operations
    {
        let mut state = match monitor_state.lock() {
            Ok(guard) => guard,
            Err(err) => {
                log::error!("Failed to lock global selection state: {}", err);
                return;
            }
        };

        if state.capture_in_progress {
            log::debug!("Global selection capture skipped: previous capture still running");
            return;
        }

        state.capture_in_progress = true;
    }

    // Clone handles for async task
    let app_task = app.clone();
    let toolbar_task = toolbar_manager.clone();
    let state_task = Arc::clone(monitor_state);
    let providers_task = Arc::clone(providers);

    // Spawn async task to avoid blocking the input hook
    tauri::async_runtime::spawn(async move {
        // Guard ensures capture_in_progress is reset when task completes
        let _reset_guard = CaptureResetGuard {
            state: Arc::clone(&state_task),
        };

        // Run capture in blocking thread pool to avoid blocking async runtime
        let capture_app = app_task.clone();
        let capture_providers = Arc::clone(&providers_task);
        let capture_result = tauri::async_runtime::spawn_blocking(move || {
            capture_with_providers(&capture_app, &capture_providers)
        })
        .await;

        // Handle capture result
        let selected_text = match capture_result {
            Ok(text) => text,
            Err(error) => {
                log::error!("Global selection capture task failed: {}", error);
                None
            }
        };

        // If no text captured, hide toolbar and exit
        let Some(selected_text) = selected_text else {
            schedule_hide_toolbar(&app_task, toolbar_task.clone());
            return;
        };

        log::debug!(
            "Global selection detected: {} characters (preview: \"{}\")",
            selected_text.len(),
            selected_text
                .chars()
                .take(50)
                .collect::<String>()
                .replace('\n', " ")
                .replace('\r', "")
        );

        // Check for duplicate text and get cursor position
        // Scope ensures mutex is not held across async await
        let maybe_position = {
            let mut state = match state_task.lock() {
                Ok(guard) => guard,
                Err(err) => {
                    log::error!("Failed to lock global selection state: {}", err);
                    return;
                }
            };

            let is_duplicate = state
                .last_text
                .as_ref()
                .map(|previous| previous == &selected_text)
                .unwrap_or(false);

            if is_duplicate {
                None
            } else {
                state.last_text = Some(selected_text.clone());
                Some(CursorPosition {
                    x: state.last_mouse_position.0,
                    y: state.last_mouse_position.1,
                })
            }
        };

        let Some(position) = maybe_position else {
            return;
        };

        if let Err(error) =
            show_selection_toolbar_with_manager(app_task, selected_text, position, toolbar_task)
                .await
        {
            log::error!(
                "Failed to show selection toolbar from global monitor: {}",
                error
            );
        }
    });
}

/// Attempts to capture text using available providers in priority order
/// Returns the first successful capture or None if all providers fail
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

/// Schedules toolbar hide operation in async task
fn schedule_hide_toolbar(app: &AppHandle, toolbar_manager: ToolbarManager) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = hide_selection_toolbar_with_manager(app_handle, toolbar_manager).await {
            log::debug!("Skip hiding selection toolbar: {}", error);
        }
    });
}

/// Manually triggers the selection toolbar via hotkey
/// Captures current selection and shows toolbar at cursor position
pub fn trigger_toolbar_from_hotkey(app: AppHandle, toolbar_manager: ToolbarManager) {
    let feature_enabled = match toolbar_manager.lock() {
        Ok(state) => state.is_enabled(),
        Err(err) => {
            log::error!("Failed to lock toolbar state for hotkey: {}", err);
            return;
        }
    };

    if !feature_enabled {
        log::debug!("Selection toolbar hotkey ignored because feature is disabled");
        return;
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let providers = build_providers();
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let candidate_text = capture_with_providers(&app, &providers);

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let candidate_text: Option<String> = None;

    let Some(text) = candidate_text else {
        log::debug!("Hotkey trigger skipped: no provider produced text");
        schedule_hide_toolbar(&app, toolbar_manager.clone());
        return;
    };

    let position = match platform_cursor_position() {
        Ok((x, y)) => CursorPosition { x, y },
        Err(err) => {
            log::warn!("Failed to read cursor position for hotkey trigger: {}", err);
            return;
        }
    };

    let app_clone = app.clone();
    let toolbar_manager_clone = toolbar_manager.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) =
            show_selection_toolbar_with_manager(app_clone, text, position, toolbar_manager_clone)
                .await
        {
            log::error!("Failed to show selection toolbar from hotkey: {}", error);
        }
    });
}
