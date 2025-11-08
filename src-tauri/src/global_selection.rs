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

const MIN_TEXT_LENGTH: usize = 2;
const TRIGGER_DEBOUNCE_MS: u64 = 200;
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

trait GlobalSelectionProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn capture(&self, app: &AppHandle) -> Option<String>;
}

type ProviderList = Vec<Box<dyn GlobalSelectionProvider>>;

fn build_providers() -> ProviderList {
    let mut list: ProviderList = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Windows UI Automation provider has highest priority
        list.push(Box::new(WindowsUIAutomationProvider::new()));
    }

    #[cfg(target_os = "macos")]
    {
        list.push(Box::new(MacosAccessibilityProvider::new()));
    }

    list
}

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

    fn obtain_text_pattern(
        ui: &IUIAutomation,
        element: &IUIAutomationElement,
    ) -> Option<IUIAutomationTextPattern> {
        unsafe {
            if let Ok(pattern) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                return Some(pattern);
            }

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
                // Initialize COM for the current thread (if already initialized, returns S_FALSE)
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

                    let mut candidates: Vec<(&'static str, IUIAutomationElement)> = Vec::new();

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

#[derive(Default)]
struct MonitorState {
    last_trigger_at: Option<Instant>,
    last_text: Option<String>,
    last_mouse_position: (f64, f64),
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

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_event(
    event: Event,
    app: &AppHandle,
    toolbar_manager: &ToolbarManager,
    monitor_state: &Arc<Mutex<MonitorState>>,
    providers: &ProviderList,
) {
    // Track mouse position from MouseMove events
    if let EventType::MouseMove { x, y } = event.event_type {
        if let Ok(mut state) = monitor_state.lock() {
            state.last_mouse_position = (x, y);
        }
        return;
    }

    if !matches!(event.event_type, EventType::ButtonRelease(Button::Left)) {
        return;
    }

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
    drop(state);

    if let Some(window) = resolve_main_window(app) {
        if window.is_focused().unwrap_or(false) {
            return;
        }
    }

    let Some(selected_text) = capture_with_providers(app, providers) else {
        schedule_hide_toolbar(app, Arc::clone(toolbar_manager));
        return;
    };

    log::info!(
        "Global selection detected: {} characters (preview: \"{}\")",
        selected_text.len(),
        selected_text
            .chars()
            .take(50)
            .collect::<String>()
            .replace('\n', " ")
            .replace('\r', "")
    );

    let mut state = match monitor_state.lock() {
        Ok(guard) => guard,
        Err(err) => {
            log::error!("Failed to lock global selection state: {}", err);
            return;
        }
    };

    if state
        .last_text
        .as_ref()
        .map(|previous| previous == &selected_text)
        .unwrap_or(false)
    {
        return;
    }

    state.last_text = Some(selected_text.clone());
    // Get the last known mouse position from the state
    let position = CursorPosition {
        x: state.last_mouse_position.0,
        y: state.last_mouse_position.1,
    };
    drop(state);

    let app_clone = app.clone();
    let toolbar_manager_clone = toolbar_manager.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = show_selection_toolbar_with_manager(
            app_clone,
            selected_text,
            position,
            toolbar_manager_clone,
        )
        .await
        {
            log::error!(
                "Failed to show selection toolbar from global monitor: {}",
                error
            );
        }
    });
}

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

fn schedule_hide_toolbar(app: &AppHandle, toolbar_manager: ToolbarManager) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = hide_selection_toolbar_with_manager(app_handle, toolbar_manager).await {
            log::debug!("Skip hiding selection toolbar: {}", error);
        }
    });
}

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
