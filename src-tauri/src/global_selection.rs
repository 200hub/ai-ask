//! 全局划词监听器（Global selection monitor）
//!
//! 职责：监听主窗口 WebView 之外的系统级划词手势，在用户结束选择时显示工具栏。
//!
//! 本次变更说明：
//! - 移除键盘事件处理，完全避免对输入法/打字的干扰；
//! - Windows 改用 Win32 低级鼠标钩子，仅分发鼠标移动与左键抬起事件；
//! - 精简事件分支与状态（删除按下状态等不必要逻辑）；
//! - macOS 继续使用 rdev 监听，但在回调中忽略键盘事件；
//! - Windows UIA 文本捕获策略升级：先尝试焦点元素/窗口根元素的 TextPattern，若失败再进行“受限”子树搜索（有深度与节点数量上限），
//!   以避免 Electron/Chromium（如 draw.io Desktop）在可访问树上大范围遍历导致的卡顿，同时保持对普通应用的兼容；
//! - 按项目规范保留英文日志，注释改为中文便于维护。

use arboard::Clipboard;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
// removed unused time imports after provider refactor

#[cfg(target_os = "macos")]
use rdev::ListenError;
#[cfg(target_os = "macos")]
use rdev::{listen, Button, Event, EventType};
#[cfg(target_os = "windows")]
use rdev::{Button, Event, EventType};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::ptr::null_mut;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicPtr, Ordering};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONUP, WM_MOUSEMOVE,
};

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

/// 有效划词所需的最少非空白字符数量
const MIN_TEXT_LENGTH: usize = 2;

/// 触发去抖时间（毫秒），用于避免快速重复触发
const TRIGGER_DEBOUNCE_MS: u64 = 200;

/// 文本捕获的最大超时时间（毫秒）
/// 用于防止 UIA/Accessibility API 卡死导致整个应用无响应
const CAPTURE_TIMEOUT_MS: u64 = 2000;

/// 预留节流时间窗口（当前未使用）
const _RESERVED_SUPPRESS_MS: u64 = 0;

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
        .count()
        < MIN_TEXT_LENGTH
    {
        return None;
    }

    Some(trimmed.to_string())
}

// -----------------------------------------------------------------------------
// Windows UI Automation Provider（阶段 2）
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod windows_uia {
    //! Windows UI Automation Provider
    //!
    //! 设计目标：
    //! - 尽可能利用 UIA 的 TextPattern 直接读取外部应用的选中文本；
    //! - 保持对现代浏览器/编辑器的良好兼容；
    //! - 避免在 Electron/Chromium 应用（例如 draw.io Desktop）上触发昂贵的深度遍历，导致主线程卡顿与交互受阻。
    //!
    //! 实现策略：
    //! 1) 候选元素：优先从“焦点元素”和“前台窗口根元素”两类候选中尝试；
    //! 2) 直接尝试：对候选元素调用 `GetCurrentPattern(UIA_TextPattern)`，成功则立即返回；
    //! 3) 受限搜索：若直接尝试失败，则使用 RawView walker 进行“有界广度搜索”：
    //!    - 最大深度 `UIA_MAX_DESCENDANT_DEPTH`（默认 3）
    //!    - 最大访问节点上限 `UIA_MAX_DESCENDANT_NODES`（默认 400）
    //!    - 达到任一阈值即中止搜索，确保最坏情况下的开销受控；
    //! 4) 失败回退：若依旧失败，交由 Win32 Edit Provider 兜底。
    //!
    //! 权衡说明：
    //! - 仅直接尝试会导致部分应用无法捕获（因为 TextPattern 暴露在后代节点中）；
    //! - 不加限制的子树查找会严重卡顿（draw.io Desktop 就属于此类场景）；
    //! - 因此选择“受限搜索”以在“功能性”和“性能”之间取得平衡。相关阈值可按需微调。
    use super::{normalize_selection, GlobalSelectionProvider};
    use std::collections::VecDeque;
    use tauri::AppHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextRangeArray, IUIAutomationTreeWalker, UIA_TextPatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    /// UIA 受限搜索的最大深度（根的直接子节点深度为 1）
    const UIA_MAX_DESCENDANT_DEPTH: u32 = 3;
    /// UIA 受限搜索的最大访问节点数（防止在复杂可访问树上遍历过多节点）
    const UIA_MAX_DESCENDANT_NODES: usize = 400;

    /// 尝试直接从元素本身获取 TextPattern；若元素未声明该模式则快速返回
    fn try_text_pattern(element: &IUIAutomationElement) -> Option<IUIAutomationTextPattern> {
        unsafe {
            element
                .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                .ok()
        }
    }

    /// 在受限范围内搜索后代节点上的 TextPattern（广度优先）
    ///
    /// 注意：使用 RawView walker 可避免属性条件创建的额外成本；但必须控制深度与节点数以确保性能可预期。
    fn search_descendants_for_text_pattern(
        ui: &IUIAutomation,
        element: &IUIAutomationElement,
    ) -> Option<IUIAutomationTextPattern> {
        unsafe {
            let walker: IUIAutomationTreeWalker = match ui.RawViewWalker() {
                Ok(walker) => walker,
                Err(err) => {
                    log::debug!(
                        "Windows UIA provider: failed to create RawView walker: {:?}",
                        err
                    );
                    return None;
                }
            };

            let mut queue: VecDeque<(IUIAutomationElement, u32)> = VecDeque::new();
            queue.push_back((element.clone(), 0));
            let mut visited: usize = 0;

            while let Some((current, depth)) = queue.pop_front() {
                if depth >= UIA_MAX_DESCENDANT_DEPTH {
                    continue;
                }

                let mut child = walker.GetFirstChildElement(&current).ok();
                while let Some(node) = child {
                    visited += 1;
                    if visited > UIA_MAX_DESCENDANT_NODES {
                        log::debug!(
                            "Windows UIA provider: descendant search aborted after {} nodes",
                            visited
                        );
                        return None;
                    }

                    if let Some(pattern) = try_text_pattern(&node) {
                        return Some(pattern);
                    }

                    if depth + 1 < UIA_MAX_DESCENDANT_DEPTH {
                        queue.push_back((node.clone(), depth + 1));
                    }

                    child = walker.GetNextSiblingElement(&node).ok();
                }
            }

            None
        }
    }

    /// 获取元素本身或其受限后代上的 TextPattern：
    /// 1) 先直接尝试当前元素；
    /// 2) 失败则在限定范围内尝试其后代；
    fn obtain_text_pattern(
        ui: &IUIAutomation,
        element: &IUIAutomationElement,
    ) -> Option<IUIAutomationTextPattern> {
        if let Some(pattern) = try_text_pattern(element) {
            return Some(pattern);
        }

        search_descendants_for_text_pattern(ui, element)
    }

    pub struct WindowsUIAutomationProvider;

    impl WindowsUIAutomationProvider {
        pub fn new() -> Self {
            Self
        }

        fn capture_impl(&self) -> Option<String> {
            unsafe {
                // 初始化线程 COM；已初始化返回 S_FALSE，首次成功返回 S_OK
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

                    // 候选元素：焦点元素 + 前台窗口根元素
                    let mut candidates: Vec<(&'static str, IUIAutomationElement)> = Vec::new();

                    // 尝试获取当前焦点元素
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

                    // 获取前台窗口根元素作为回退
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

                    // 在候选元素上查找 TextPattern（仅检测元素本身，避免深层遍历）
                    let mut pattern: Option<IUIAutomationTextPattern> = None;
                    for (label, element) in &candidates {
                        if let Some(found) = obtain_text_pattern(&ui, element) {
                            pattern = Some(found);
                            break;
                        } else {
                            log::debug!(
                                "Windows UIA provider: {} element does not expose TextPattern",
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
// Windows Win32 Edit 控件回退 Provider
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod windows_win32 {
    // 当 UIA 无法提供文本时，回退从经典 Win32 Edit 控件读取。
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

    /// 从 Win32 Edit 控件提取选中文本；若无选区或失败则返回 None
    unsafe fn extract_selection_from_edit(hwnd: HWND) -> Option<String> {
        let mut start: u32 = 0;
        let mut end: u32 = 0;

        // EM_GETSEL 以 UTF-16 code unit 返回选区起止索引
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

/// 全局划词监听共享状态
#[derive(Default)]
struct MonitorState {
    /// 最近一次触发时间（去抖）
    last_trigger_at: Option<Instant>,
    /// 最近一次捕获文本（用于重复检测）
    last_text: Option<String>,
    /// 最近记录的鼠标坐标 (x, y)
    last_mouse_position: (f64, f64),
    /// 并发保护标记（避免同时进行多次捕获）
    capture_in_progress: bool,
}

#[cfg(target_os = "windows")]
struct WindowsMouseHookContext {
    app_handle: AppHandle,
    toolbar_manager: ToolbarManager,
    monitor_state: Arc<Mutex<MonitorState>>,
    providers: Arc<ProviderList>,
}

#[cfg(target_os = "windows")]
static WINDOWS_MOUSE_CONTEXT: AtomicPtr<WindowsMouseHookContext> = AtomicPtr::new(null_mut());

#[cfg(target_os = "windows")]
unsafe extern "system" fn windows_mouse_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // Windows 低级鼠标钩子：仅转发鼠标移动与左键抬起至统一事件处理函数
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let context_ptr = WINDOWS_MOUSE_CONTEXT.load(Ordering::SeqCst);
    if context_ptr.is_null() {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let mouse_info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
    let event_type = match wparam.0 as u32 {
        WM_MOUSEMOVE => Some(EventType::MouseMove {
            x: mouse_info.pt.x as f64,
            y: mouse_info.pt.y as f64,
        }),
        WM_LBUTTONUP => Some(EventType::ButtonRelease(Button::Left)),
        _ => None,
    };

    if let Some(event_type) = event_type {
        let event = Event {
            event_type,
            name: None,
            time: SystemTime::now(),
        };

        let context = &*context_ptr;
        handle_event(
            event,
            &context.app_handle,
            &context.toolbar_manager,
            &context.monitor_state,
            &context.providers,
        );
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

    log::info!("Global selection monitor worker spawned"); // 启动监听线程（macOS）
}

#[cfg(target_os = "windows")]
fn spawn_windows_selection_listener(
    app_handle: AppHandle,
    toolbar_manager: ToolbarManager,
    providers: Arc<ProviderList>,
    shared_state: Arc<Mutex<MonitorState>>,
) {
    thread::spawn(move || unsafe {
        let context = Box::new(WindowsMouseHookContext {
            app_handle,
            toolbar_manager,
            monitor_state: shared_state,
            providers,
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
        while GetMessageW(&mut message, None, 0, 0).into() {
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

/// RAII 守卫：在异步任务结束时重置 capture_in_progress，确保异常退出也能复位
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

/// 事件核心处理：
/// - 鼠标移动：只更新坐标并返回；
/// - 左键抬起：触发一次捕获流程；
/// - 键盘事件（macOS）：直接忽略，避免输入干扰。
///
/// 性能优化说明：
/// - 鼠标移动使用 try_lock 避免阻塞；
/// - 左键抬起时合并多次锁获取为单次，减少锁竞争；
/// - 所有状态检查在单次锁内完成后立即释放。
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_event(
    event: Event,
    app: &AppHandle,
    toolbar_manager: &ToolbarManager,
    monitor_state: &Arc<Mutex<MonitorState>>,
    providers: &Arc<ProviderList>,
) {
    #[cfg(target_os = "macos")]
    if matches!(
        event.event_type,
        EventType::KeyPress(_) | EventType::KeyRelease(_)
    ) {
        return;
    }

    // 鼠标移动：使用 try_lock 避免阻塞，失败则丢弃（高频事件可容忍丢失）
    if let EventType::MouseMove { x, y } = event.event_type {
        if let Ok(mut state) = monitor_state.try_lock() {
            state.last_mouse_position = (x, y);
        }
        return;
    }

    if !matches!(event.event_type, EventType::ButtonRelease(Button::Left)) {
        return;
    }

    // 检查功能开关（未开启则隐藏工具栏并返回）
    let feature_enabled = match toolbar_manager.try_lock() {
        Ok(state) => state.is_enabled(),
        Err(_) => {
            // 锁被占用时跳过本次触发，避免阻塞
            log::debug!("Toolbar state lock busy, skipping this trigger");
            return;
        }
    };

    if !feature_enabled {
        schedule_hide_toolbar(app, Arc::clone(toolbar_manager));
        return;
    }

    // 忽略主窗口自身的选中（仅响应外部应用）
    // 注意：此检查放在锁操作之前，因为 is_focused 可能有一定开销
    if let Some(window) = resolve_main_window(app) {
        if window.is_focused().unwrap_or(false) {
            return;
        }
    }

    // 合并去抖检查和并发保护为单次锁获取，减少锁竞争
    {
        let mut state = match monitor_state.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                // 锁被占用，说明有其他操作正在进行，跳过本次触发
                log::debug!("Monitor state lock busy, skipping this trigger");
                return;
            }
        };

        let now = Instant::now();

        // 去抖处理：若与上次触发间隔小于阈值则跳过
        if let Some(last) = state.last_trigger_at {
            if now.duration_since(last) < Duration::from_millis(TRIGGER_DEBOUNCE_MS) {
                return;
            }
        }

        // 并发保护：避免在慢速 UIA/Win32 操作期间再次进入捕获
        if state.capture_in_progress {
            log::debug!("Global selection capture skipped: previous capture still running");
            return;
        }

        // 所有检查通过，更新状态
        state.last_trigger_at = Some(now);
        state.capture_in_progress = true;
    }

    // 克隆句柄：用于后续异步任务
    let app_task = app.clone();
    let toolbar_task = toolbar_manager.clone();
    let state_task = Arc::clone(monitor_state);
    let providers_task = Arc::clone(providers);

    // 启动异步任务：避免阻塞输入钩子线程
    tauri::async_runtime::spawn(async move {
        // 守卫：确保任务结束后复位并发标记
        let _reset_guard = CaptureResetGuard {
            state: Arc::clone(&state_task),
        };

        // 在线程池中执行捕获（阻塞型），添加超时保护
        // 防止 UIA/Accessibility API 卡死导致整个应用无响应
        let capture_app = app_task.clone();
        let capture_providers = Arc::clone(&providers_task);
        let capture_task = tauri::async_runtime::spawn_blocking(move || {
            capture_with_providers(&capture_app, &capture_providers)
        });

        // 使用 tokio::time::timeout 添加超时保护
        let capture_result =
            tokio::time::timeout(Duration::from_millis(CAPTURE_TIMEOUT_MS), capture_task).await;

        // 处理捕获结果（包括超时情况）
        let selected_text = match capture_result {
            Ok(Ok(text)) => text,
            Ok(Err(error)) => {
                log::error!("Global selection capture task panicked: {}", error);
                None
            }
            Err(_) => {
                // 捕获超时，这通常意味着 UIA/Accessibility API 卡住了
                // 记录警告但不阻塞后续操作
                log::warn!(
                    "Global selection capture timed out after {} ms, skipping",
                    CAPTURE_TIMEOUT_MS
                );
                None
            }
        };

        // 如未获取到文本：隐藏工具栏并返回
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

        // 避免重复：与上次文本相同则跳过；否则使用最近记录的鼠标坐标
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
