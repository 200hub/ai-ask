use std::cell::RefCell;

use tauri::WebviewWindow;
use windows::Win32::{
    Foundation::HWND,
    System::Com::{CoCreateInstance, CLSCTX_ALL},
    UI::{
        Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
        Shell::{IVirtualDesktopManager, VirtualDesktopManager},
        WindowsAndMessaging::{
            GetAncestor, GetClassNameW, GetForegroundWindow, GetMessageTime, GetShellWindow,
            GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetWindowPos,
            EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, GA_ROOT, GWL_EXSTYLE,
            HWND_NOTOPMOST, HWND_TOPMOST, OBJID_WINDOW, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOOWNERZORDER, SWP_NOSIZE, WINEVENT_OUTOFCONTEXT, WS_EX_TOPMOST,
        },
    },
};

thread_local! {
    static DESKTOP_NOTES: RefCell<Option<DesktopNotes>> = const { RefCell::new(None) };
}

struct Note {
    label: String,
    hwnd: HWND,
}

struct DesktopNotes {
    hook: HWINEVENTHOOK,
    notes: Vec<Note>,
    desktop_active: bool,
    desktop_entered_at: u32,
}

#[derive(Clone, Copy, Debug)]
enum DesktopEvent {
    Refresh,
    Foreground(u32),
    Restored { hwnd: HWND, time: u32 },
}

#[derive(Clone, Copy, Debug)]
enum Foreground {
    Desktop,
    Note,
    Other,
    Unknown,
}

fn desktop_is_active(previous: bool, foreground: Foreground) -> bool {
    match foreground {
        Foreground::Desktop => true,
        Foreground::Other => false,
        Foreground::Note | Foreground::Unknown => previous,
    }
}

fn event_is_current(entered_at: u32, event_time: u32) -> bool {
    (event_time.wrapping_sub(entered_at) as i32) >= 0
}

impl DesktopNotes {
    fn start() -> Option<Self> {
        // SAFETY: called on the Tauri GUI thread, which pumps the out-of-context hook events.
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_MINIMIZEEND,
                None,
                Some(on_desktop_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        if hook.0.is_null() {
            log::warn!(
                "Could not monitor the Windows desktop foreground: {}",
                std::io::Error::last_os_error()
            );
            return None;
        }
        Some(Self {
            hook,
            notes: Vec::new(),
            desktop_active: false,
            desktop_entered_at: 0,
        })
    }

    fn refresh(&mut self, event: DesktopEvent) {
        // SAFETY: these Win32 functions read window handles without retaining references.
        let foreground = unsafe { GetForegroundWindow() };
        let root = unsafe { GetAncestor(foreground, GA_ROOT) };
        let foreground = if root.is_invalid() { foreground } else { root };
        let foreground_kind = if foreground.is_invalid() {
            Foreground::Unknown
        } else if self.notes.iter().any(|note| note.hwnd == foreground) {
            Foreground::Note
        } else if is_shell_desktop(foreground) {
            Foreground::Desktop
        } else {
            Foreground::Other
        };
        log::trace!(
            "Desktop note event {event:?}, foreground {foreground:?} ({foreground_kind:?}), desktop active {}",
            self.desktop_active
        );
        let restored_window = match event {
            DesktopEvent::Restored { hwnd, time }
                if self.desktop_active
                    && matches!(foreground_kind, Foreground::Note)
                    && event_is_current(self.desktop_entered_at, time)
                    && !self.notes.iter().any(|note| note.hwnd == hwnd)
                    && is_restored_application(hwnd) =>
            {
                Some(hwnd)
            }
            DesktopEvent::Restored { .. } => return,
            _ => None,
        };
        let active =
            restored_window.is_none() && desktop_is_active(self.desktop_active, foreground_kind);
        if active && !self.desktop_active {
            self.desktop_entered_at = match event {
                DesktopEvent::Foreground(time) => time,
                // SAFETY: WinEvents and message times use the same millisecond tick count.
                _ => (unsafe { GetMessageTime() }) as u32,
            };
        }
        self.desktop_active = active;

        // Resolve the public virtual desktop service only when there's a visible note to raise.
        // The GUI thread hosts WebView2 and is initialized for COM.
        let mut desktops = None;
        for note in &mut self.notes {
            let visible =
                unsafe { IsWindowVisible(note.hwnd).as_bool() && !IsIconic(note.hwnd).as_bool() };
            let raise = self.desktop_active && visible && {
                let manager = desktops.get_or_insert_with(|| unsafe {
                    CoCreateInstance::<_, IVirtualDesktopManager>(
                        &VirtualDesktopManager,
                        None,
                        CLSCTX_ALL,
                    )
                });
                manager.as_ref().is_ok_and(|manager| {
                    unsafe { manager.IsWindowOnCurrentVirtualDesktop(note.hwnd) }
                        .is_ok_and(|current| current.as_bool())
                })
            };
            if is_topmost(note.hwnd) == raise {
                continue;
            }
            let layer = if raise { HWND_TOPMOST } else { HWND_NOTOPMOST };
            if let Err(error) = place_in_z_order(note.hwnd, layer) {
                log::debug!("Could not update desktop layer for {}: {error}", note.label);
                continue;
            }
            if !raise {
                let beneath = restored_window.or_else(|| {
                    (matches!(foreground_kind, Foreground::Other) && !is_topmost(foreground))
                        .then_some(foreground)
                });
                if let Some(app) = beneath {
                    let _ = place_in_z_order(note.hwnd, app);
                }
            }
        }
    }
}

impl Drop for DesktopNotes {
    fn drop(&mut self) {
        // SAFETY: thread-local state is created and destroyed on the hook's installing thread.
        let _ = unsafe { UnhookWinEvent(self.hook) };
    }
}

fn is_shell_desktop(foreground: HWND) -> bool {
    // SAFETY: the handles are obtained from the live shell/foreground and never dereferenced.
    unsafe {
        let shell = GetShellWindow();
        if shell.is_invalid() || foreground == shell {
            return foreground == shell;
        }
        // On some Windows versions Explorer hosts the desktop view in a WorkerW window.
        let mut class = [0u16; 32];
        let len = GetClassNameW(foreground, &mut class) as usize;
        if String::from_utf16_lossy(&class[..len]) != "WorkerW" {
            return false;
        }
        let mut shell_pid = 0;
        let mut foreground_pid = 0;
        GetWindowThreadProcessId(shell, Some(&mut shell_pid));
        GetWindowThreadProcessId(foreground, Some(&mut foreground_pid));
        shell_pid != 0 && shell_pid == foreground_pid
    }
}

fn is_topmost(hwnd: HWND) -> bool {
    // SAFETY: reading a window style requires only a live foreground handle.
    unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 }
}

fn place_in_z_order(hwnd: HWND, after: HWND) -> windows::core::Result<()> {
    // SAFETY: hwnd belongs to this app and the operation runs on the owning thread.
    // These flags preserve geometry, visibility, and keyboard focus.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(after),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER,
        )
    }
}

fn is_restored_application(hwnd: HWND) -> bool {
    // SAFETY: the handle comes from a system window event. Verify it is still a visible window.
    unsafe {
        !hwnd.is_invalid()
            && GetAncestor(hwnd, GA_ROOT) == hwnd
            && IsWindowVisible(hwnd).as_bool()
            && !is_topmost(hwnd)
            && !is_shell_desktop(hwnd)
    }
}

unsafe extern "system" fn on_desktop_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    object_id: i32,
    child_id: i32,
    _thread: u32,
    time: u32,
) {
    if object_id != OBJID_WINDOW.0 || child_id != 0 {
        return;
    }
    let event = match event {
        EVENT_SYSTEM_FOREGROUND => DesktopEvent::Foreground(time),
        EVENT_SYSTEM_MINIMIZEEND => DesktopEvent::Restored { hwnd, time },
        _ => return,
    };
    let _ = DESKTOP_NOTES.try_with(|state| {
        if let Ok(mut state) = state.try_borrow_mut() {
            if let Some(desktop) = state.as_mut() {
                desktop.refresh(event);
            }
        }
    });
}

pub(super) fn track(window: &WebviewWindow) {
    let note = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let Ok(hwnd) = note.hwnd() else {
            return;
        };
        DESKTOP_NOTES.with(|state| {
            let mut state = state.borrow_mut();
            if state.is_none() {
                *state = DesktopNotes::start();
            }
            if let Some(desktop) = state.as_mut() {
                if !desktop.notes.iter().any(|existing| existing.hwnd == hwnd) {
                    desktop.notes.push(Note {
                        label: note.label().into(),
                        hwnd,
                    });
                }
                desktop.refresh(DesktopEvent::Refresh);
            }
        });
    }) {
        log::debug!("Could not update the Windows desktop layer: {error}");
    }
}

pub(super) fn forget(label: &str) {
    let _ = DESKTOP_NOTES.try_with(|state| {
        let mut state = state.borrow_mut();
        if let Some(desktop) = state.as_mut() {
            desktop.notes.retain(|note| note.label != label);
            if desktop.notes.is_empty() {
                *state = None;
            }
        }
    });
}

pub(super) fn refresh_after_hide(window: &WebviewWindow) {
    if let Err(error) = window.run_on_main_thread(|| {
        DESKTOP_NOTES.with(|state| {
            if let Some(desktop) = state.borrow_mut().as_mut() {
                desktop.refresh(DesktopEvent::Refresh);
            }
        });
    }) {
        log::debug!("Could not release the Windows desktop layer: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_notes_keep_their_layer_when_edited_and_leave_it_when_an_app_returns() {
        let mut active = false;
        for (foreground, expected) in [
            (Foreground::Note, false),
            (Foreground::Desktop, true),
            (Foreground::Note, true),
            (Foreground::Unknown, true),
            (Foreground::Other, false),
            (Foreground::Note, false),
        ] {
            active = desktop_is_active(active, foreground);
            assert_eq!(active, expected);
        }
    }

    #[test]
    fn ignores_restore_events_older_than_the_current_desktop_session() {
        assert!(!event_is_current(20, 19));
        assert!(event_is_current(20, 20));
        assert!(event_is_current(u32::MAX, 1));
        assert!(!event_is_current(1, u32::MAX));
    }
}
