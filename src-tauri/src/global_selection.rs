//! Global selection monitor
//!
//! Listens to system-wide selection gestures and triggers the selection toolbar
//! when the user finishes selecting text outside the main webview.

use arboard::Clipboard;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
// removed unused time imports after provider refactor

#[cfg(target_os = "macos")]
use rdev::ListenError;
use rdev::{listen, Button, Event, EventType};
use tauri::{AppHandle, Manager};

use crate::selection_toolbar::{
    hide_selection_toolbar_with_manager, platform_cursor_position, resolve_active_app_identifiers,
    show_selection_toolbar_force_with_manager, show_selection_toolbar_with_manager, CursorPosition,
    ToolbarManager,
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
    let providers = build_providers();
    if let Some(text) = capture_with_providers(app, &providers) {
        return Some(text);
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

/// Schedules toolbar hide operation in async task
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

        // 步骤 5.1: 在阻塞线程池中执行文本捕获
        // 原因：Windows UIA / macOS Accessibility API 可能耗时较长
        // 使用 spawn_blocking 避免阻塞异步运行时
        let capture_result =
            tauri::async_runtime::spawn_blocking(move || capture_text_for_hotkey(&capture_app))
                .await;

        // 步骤 5.2: 处理捕获结果
        let selected_text = match capture_result {
            Ok(Some(text)) => text,
            Ok(None) => {
                // 系统 provider 和剪贴板都没有可用文本，隐藏工具栏
                log::debug!("Hotkey trigger skipped: no provider or clipboard text available");
                schedule_hide_toolbar(&app_clone, toolbar_for_hide);
                return;
            }
            Err(error) => {
                // 捕获任务本身失败（极少见），记录错误并隐藏工具栏
                log::error!("Selection toolbar hotkey capture task failed: {}", error);
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
