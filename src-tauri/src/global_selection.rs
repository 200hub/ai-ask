//! Global selection monitor
//!
//! Listens to system-wide selection gestures and triggers the selection toolbar
//! when the user finishes selecting text outside the main webview.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
// removed unused time imports after provider refactor

use rdev::{listen, Button, Event, EventType};
use tauri::{AppHandle, Manager};

use crate::selection_toolbar::{
    hide_selection_toolbar_with_manager, platform_cursor_position,
    show_selection_toolbar_with_manager, CursorPosition, ToolbarManager,
};
use crate::window_control::resolve_main_window;

const MIN_TEXT_LENGTH: usize = 2;
const TRIGGER_DEBOUNCE_MS: u64 = 200;

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
    use core_foundation::base::{CFType, TCFType};
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
            let focused = match Self::focused_element(&system) {
                Some(element) => element,
                None => return None,
            };

            let selected = match Self::read_selected_text(&focused) {
                Some(text) => text,
                None => return None,
            };

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
                Ok(element) => Some(element),
                Err(_) => {
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
                Ok(cf_string) => Some(cf_string.to_string()),
                Err(_) => {
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
}

pub fn start_global_selection_monitor(app: AppHandle) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let app_handle = app.clone();
        let toolbar_manager = app.state::<ToolbarManager>().inner().clone();
        let providers = Arc::new(build_providers());
        let shared_state = Arc::new(Mutex::new(MonitorState::default()));

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

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        log::warn!("Global selection monitor is not available on this platform");
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
    drop(state);

    let position = match platform_cursor_position() {
        Ok((x, y)) => CursorPosition { x, y },
        Err(err) => {
            log::warn!("Failed to read cursor position: {}", err);
            return;
        }
    };

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
