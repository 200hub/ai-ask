use std::{collections::HashMap, time::Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
mod windows_desktop;

const LABEL_PREFIX: &str = "desktop-note-";
const ROUTE: &str = "/sticky-note";
const WINDOW_TITLE: &str = "Sticky Note";
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 180.0;
const DEFAULT_WIDTH: f64 = 320.0;
const DEFAULT_HEIGHT: f64 = 280.0;
const DEFAULT_OFFSET: f64 = 120.0;
const DISPLAY_SETTLE: std::time::Duration = std::time::Duration::from_millis(750);
const DISPLAY_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(2500);
const CAPTURE_EVENT: &str = "desktop-note:capture-geometry";
const STORE_PATH: &str = "config.json";
const NOTES_KEY: &str = "desktop_notes";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNoteBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    monitor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDesktopNoteWindowPayload {
    note_id: String,
    bounds: DesktopNoteBounds,
    #[serde(default)]
    activate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNoteIdPayload {
    note_id: String,
    #[serde(default)]
    silent: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Display {
    id: String,
    origin: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    primary: bool,
}

impl Display {
    fn new(monitor: Monitor, primary: Option<&Monitor>) -> Self {
        let work_area = monitor.work_area();
        Self {
            id: monitor.name().cloned().unwrap_or_else(|| {
                let position = monitor.position();
                format!("{},{}", position.x, position.y)
            }),
            origin: work_area.position,
            size: work_area.size,
            scale: monitor.scale_factor(),
            primary: primary.is_some_and(|primary| primary.position() == monitor.position()),
        }
    }

    fn logical_offset(&self, position: PhysicalPosition<i32>) -> (f64, f64) {
        (
            (f64::from(position.x) - f64::from(self.origin.x)) / self.scale,
            (f64::from(position.y) - f64::from(self.origin.y)) / self.scale,
        )
    }

    fn contains_point(&self, x: f64, y: f64) -> bool {
        let left = f64::from(self.origin.x);
        let top = f64::from(self.origin.y);
        x >= left
            && x < left + f64::from(self.size.width)
            && y >= top
            && y < top + f64::from(self.size.height)
    }
}

fn available_displays(app: &AppHandle) -> tauri::Result<Vec<Display>> {
    let primary = app.primary_monitor()?;
    let mut displays: Vec<_> = app
        .available_monitors()?
        .into_iter()
        .map(|monitor| Display::new(monitor, primary.as_ref()))
        .filter(|display| display.size.width > 0 && display.size.height > 0 && display.scale > 0.0)
        .collect();
    displays.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(displays)
}

fn finite(value: f64, default: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn window_geometry(
    bounds: &DesktopNoteBounds,
    displays: &[Display],
) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let x = finite(bounds.x, DEFAULT_OFFSET);
    let y = finite(bounds.y, DEFAULT_OFFSET);
    let primary = displays
        .iter()
        .find(|display| display.primary)
        .or_else(|| displays.first())?;
    let target = match &bounds.monitor {
        Some(monitor) => displays.iter().find(|display| &display.id == monitor),
        // Legacy coordinates are absolute logical pixels at the note window's DPI.
        None => displays
            .iter()
            .find(|display| display.contains_point(x * display.scale, y * display.scale)),
    };
    let display = target.unwrap_or(primary);
    let (x, y) = if bounds.monitor.is_some() {
        (x, y)
    } else if target.is_some() {
        display.logical_offset(PhysicalPosition::new(
            (x * display.scale).round() as i32,
            (y * display.scale).round() as i32,
        ))
    } else {
        (DEFAULT_OFFSET, DEFAULT_OFFSET)
    };

    let width = (finite(bounds.width, DEFAULT_WIDTH).max(MIN_WIDTH) * display.scale)
        .round()
        .min(f64::from(display.size.width)) as u32;
    let height = (finite(bounds.height, DEFAULT_HEIGHT).max(MIN_HEIGHT) * display.scale)
        .round()
        .min(f64::from(display.size.height)) as u32;
    let x = f64::from(display.origin.x)
        + (x * display.scale).clamp(0.0, f64::from(display.size.width - width));
    let y = f64::from(display.origin.y)
        + (y * display.scale).clamp(0.0, f64::from(display.size.height - height));

    Some((
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        PhysicalSize::new(width, height),
    ))
}

struct Placement {
    desired: DesktopNoteBounds,
    ignore_events_until: Instant,
}

#[derive(Default)]
pub struct DesktopNoteWindows {
    placements: Mutex<HashMap<String, Placement>>,
    displays: Mutex<Vec<Display>>,
    persistence: Mutex<()>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotePatch {
    note_id: String,
    updates: Map<String, Value>,
    if_unchanged: Option<DesktopNoteRevision>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNoteRevision {
    updated_at: Option<u64>,
}

fn apply_note_patches(notes: &mut Vec<Value>, patches: Vec<DesktopNotePatch>) {
    for patch in patches {
        let current = notes
            .iter_mut()
            .find(|note| note.get("id").and_then(Value::as_str) == Some(patch.note_id.as_str()));
        let Some(current) = current else {
            if patch
                .if_unchanged
                .is_some_and(|revision| revision.updated_at.is_some())
            {
                continue;
            }
            let mut created = patch.updates;
            if created.contains_key("createdAt") {
                created.insert("id".into(), Value::String(patch.note_id));
                notes.insert(0, Value::Object(created));
            }
            continue;
        };
        let Some(current) = current.as_object_mut() else {
            continue;
        };
        let current_revision = current.get("updatedAt").and_then(Value::as_u64);
        if let Some(expected) = patch.if_unchanged {
            if expected.updated_at.is_none() || expected.updated_at != current_revision {
                continue;
            }
            current.extend(patch.updates);
        } else {
            if current
                .get("deletedAt")
                .is_some_and(|value| !value.is_null())
            {
                continue;
            }
            for (key, value) in patch.updates {
                if key == "sync" {
                    if let Some(sync) = value.as_object() {
                        let current_sync = current
                            .entry("sync")
                            .or_insert_with(|| Value::Object(Map::new()));
                        if let Some(current_sync) = current_sync.as_object_mut() {
                            current_sync.extend(sync.clone());
                            continue;
                        }
                    }
                }
                if key == "updatedAt" {
                    let requested = value.as_u64().unwrap_or_default();
                    let revision =
                        requested.max(current_revision.unwrap_or_default().saturating_add(1));
                    current.insert(key, Value::from(revision));
                } else {
                    current.insert(key, value);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn persist_desktop_note_patches(
    app: AppHandle,
    state: State<'_, DesktopNoteWindows>,
    patches: Vec<DesktopNotePatch>,
) -> Result<(), String> {
    let _transaction = state.persistence.lock().await;
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    let mut notes = match store.get(NOTES_KEY) {
        Some(Value::Array(notes)) => notes,
        _ => Vec::new(),
    };
    apply_note_patches(&mut notes, patches);
    store.set(NOTES_KEY, Value::Array(notes));
    store.save().map_err(|error| error.to_string())
}

fn window_label(note_id: &str) -> String {
    format!("{LABEL_PREFIX}{note_id}")
}

fn window_route(note_id: &str) -> String {
    format!("{ROUTE}?noteId={note_id}")
}

fn place_window(
    window: &WebviewWindow,
    placement: &mut Placement,
    displays: &[Display],
) -> tauri::Result<()> {
    if let Some((position, size)) = window_geometry(&placement.desired, displays) {
        placement.ignore_events_until = Instant::now() + DISPLAY_SETTLE;
        window.set_position(position)?;
        window.set_size(size)?;
    }
    Ok(())
}

fn apply_display_changes(
    app: &AppHandle,
    placements: &mut HashMap<String, Placement>,
    previous: &mut Vec<Display>,
) -> tauri::Result<()> {
    let displays = available_displays(app)?;
    if displays.is_empty() || *previous == displays {
        return Ok(());
    }
    placements.retain(|label, placement| {
        let Some(window) = app.get_webview_window(label) else {
            return false;
        };
        if let Err(error) = place_window(&window, placement, &displays) {
            log::warn!("Failed to restore note position for {label}: {error}");
        }
        true
    });
    *previous = displays;
    Ok(())
}

pub fn watch_displays(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<DesktopNoteWindows>();
        let mut interval = tokio::time::interval(DISPLAY_CHECK_INTERVAL);
        loop {
            interval.tick().await;
            let mut placements = state.placements.lock().await;
            if placements.is_empty() {
                continue;
            }
            let mut displays = state.displays.lock().await;
            if let Err(error) = apply_display_changes(&app, &mut placements, &mut displays) {
                log::debug!("Unable to inspect display topology for sticky notes: {error}");
            }
        }
    });
}

#[tauri::command]
pub async fn ensure_desktop_note_window(
    app: AppHandle,
    state: State<'_, DesktopNoteWindows>,
    payload: EnsureDesktopNoteWindowPayload,
) -> Result<(), String> {
    let label = window_label(&payload.note_id);
    let mut placements = state.placements.lock().await;
    let mut displays = state.displays.lock().await;
    apply_display_changes(&app, &mut placements, &mut displays)
        .map_err(|error| error.to_string())?;

    let window = if let Some(window) = app.get_webview_window(&label) {
        window
    } else {
        let builder = WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::App(window_route(&payload.note_id).into()),
        )
        .title(WINDOW_TITLE)
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false);

        #[cfg(target_os = "macos")]
        let builder = builder.visible_on_all_workspaces(true);

        let window = builder.build().map_err(|error| error.to_string())?;
        let mut placement = Placement {
            desired: payload.bounds,
            ignore_events_until: Instant::now() + DISPLAY_SETTLE,
        };
        if let Err(error) = place_window(&window, &mut placement, &displays) {
            log::warn!("Failed to position new note {label}: {error}");
        }
        placements.insert(label, placement);

        let event_window = window.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                #[cfg(target_os = "windows")]
                windows_desktop::forget(event_window.label());
                let app = event_window.app_handle().clone();
                let label = event_window.label().to_string();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<DesktopNoteWindows>();
                    let mut placements = state.placements.lock().await;
                    if app.get_webview_window(&label).is_none() {
                        placements.remove(&label);
                    }
                });
            }
            if matches!(
                event,
                WindowEvent::Moved(_)
                    | WindowEvent::Resized(_)
                    | WindowEvent::ScaleFactorChanged { .. }
            ) {
                let _ = event_window.emit_to(event_window.label(), CAPTURE_EVENT, ());
            }
        });
        window
    };
    if payload.activate {
        #[cfg(target_os = "windows")]
        activate_on_current_desktop(&window).await;
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    windows_desktop::track(&window);
    if payload.activate {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn activate_on_current_desktop(window: &WebviewWindow) {
    use windows::Win32::{
        Foundation::HWND,
        System::Com::{CoCreateInstance, CLSCTX_ALL},
        UI::{
            Shell::{IVirtualDesktopManager, VirtualDesktopManager},
            WindowsAndMessaging::GetForegroundWindow,
        },
    };

    let (complete, completed) = tokio::sync::oneshot::channel();
    let target = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let result = (|| -> anyhow::Result<()> {
            let hwnd = HWND(target.hwnd()?.0);
            // SAFETY: Tauri's main thread hosts WebView2 and is initialized for COM.
            // Both window handles are obtained from Win32/Tauri just before the COM calls.
            unsafe {
                let desktops: IVirtualDesktopManager =
                    CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_ALL)?;
                if desktops.IsWindowOnCurrentVirtualDesktop(hwnd)?.as_bool() {
                    return Ok(());
                }
                let foreground = GetForegroundWindow();
                if !foreground.is_invalid()
                    && desktops
                        .IsWindowOnCurrentVirtualDesktop(foreground)?
                        .as_bool()
                {
                    let desktop = desktops.GetWindowDesktopId(foreground)?;
                    desktops.MoveWindowToDesktop(hwnd, &desktop)?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            log::warn!("Failed to move sticky note to the current virtual desktop: {error}");
        }
        let _ = complete.send(());
    }) {
        log::warn!("Failed to schedule sticky note activation: {error}");
        return;
    }
    let _ = completed.await;
}

#[tauri::command]
pub async fn capture_desktop_note_bounds(
    window: WebviewWindow,
    state: State<'_, DesktopNoteWindows>,
) -> Result<Option<DesktopNoteBounds>, String> {
    let mut placements = state.placements.lock().await;
    let mut displays = state.displays.lock().await;
    apply_display_changes(window.app_handle(), &mut placements, &mut displays)
        .map_err(|error| error.to_string())?;
    let Some(placement) = placements.get_mut(window.label()) else {
        return Ok(None);
    };

    let bounds = (|| -> tauri::Result<Option<DesktopNoteBounds>> {
        if Instant::now() < placement.ignore_events_until
            || !window.is_visible()?
            || window.is_minimized()?
        {
            return Ok(None);
        }
        let Some(monitor) = window.current_monitor()? else {
            return Ok(None);
        };
        let display = Display::new(monitor, None);
        let position = window.outer_position()?;
        let size = window.inner_size()?;
        if size.width == 0 || size.height == 0 {
            return Ok(None);
        }
        let center_x = f64::from(position.x) + f64::from(size.width) / 2.0;
        let center_y = f64::from(position.y) + f64::from(size.height) / 2.0;
        if !display.contains_point(center_x, center_y) {
            return Ok(None);
        }
        let (x, y) = display.logical_offset(position);
        Ok(Some(DesktopNoteBounds {
            x: x.round(),
            y: y.round(),
            width: (f64::from(size.width) / display.scale)
                .round()
                .max(MIN_WIDTH),
            height: (f64::from(size.height) / display.scale)
                .round()
                .max(MIN_HEIGHT),
            monitor: Some(display.id),
        }))
    })()
    .map_err(|error| error.to_string())?;

    if let Some(bounds) = &bounds {
        placement.desired = bounds.clone();
    }
    Ok(bounds)
}

#[tauri::command]
pub async fn suspend_desktop_note_windows(
    app: AppHandle,
    state: State<'_, DesktopNoteWindows>,
) -> Result<(), String> {
    let placements = state.placements.lock().await;
    let mut first_error = None;
    for label in placements.keys() {
        if let Some(window) = app.get_webview_window(label) {
            if let Err(error) = window.hide() {
                log::warn!("Failed to suspend desktop note {label}: {error}");
                first_error.get_or_insert_with(|| error.to_string());
            } else {
                #[cfg(target_os = "windows")]
                windows_desktop::refresh_after_hide(&window);
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

#[tauri::command]
pub async fn close_desktop_note_window(
    app: AppHandle,
    payload: DesktopNoteIdPayload,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&window_label(&payload.note_id)) {
        let result = if payload.silent {
            window.destroy()
        } else {
            window.close()
        };
        result.map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn display(id: &str, x: i32, scale: f64, primary: bool) -> Display {
        Display {
            id: id.to_string(),
            origin: PhysicalPosition::new(x, 40),
            size: PhysicalSize::new(1920, 1040),
            scale,
            primary,
        }
    }

    fn bounds(monitor: Option<&str>, x: f64, y: f64) -> DesktopNoteBounds {
        DesktopNoteBounds {
            x,
            y,
            width: 320.0,
            height: 280.0,
            monitor: monitor.map(str::to_string),
        }
    }

    #[test]
    fn formats_window_label_and_route() {
        assert_eq!(window_label("abc-123"), "desktop-note-abc-123");
        assert_eq!(window_route("abc-123"), "/sticky-note?noteId=abc-123");
    }

    #[test]
    fn resolves_relative_position_at_target_dpi() {
        let displays = [
            display("primary", 0, 1.0, true),
            display("left", -1920, 1.5, false),
        ];
        let (position, size) =
            window_geometry(&bounds(Some("left"), 120.0, 120.0), &displays).unwrap();
        assert_eq!(position, PhysicalPosition::new(-1740, 220));
        assert_eq!(size, PhysicalSize::new(480, 420));
    }

    #[test]
    fn restores_note_to_same_display_after_rearrangement() {
        let displays = [
            display("primary", 0, 1.0, true),
            display("left", 1920, 1.25, false),
        ];
        let (position, size) =
            window_geometry(&bounds(Some("left"), 120.0, 120.0), &displays).unwrap();
        assert_eq!(position, PhysicalPosition::new(2070, 190));
        assert_eq!(size, PhysicalSize::new(400, 350));
    }

    #[test]
    fn clamps_note_inside_primary_work_area_when_saved_display_is_disconnected() {
        let displays = [display("primary", 0, 1.0, true)];
        let (position, size) =
            window_geometry(&bounds(Some("missing"), 2700.0, 900.0), &displays).unwrap();
        assert_eq!(position, PhysicalPosition::new(1600, 800));
        assert_eq!(size, PhysicalSize::new(320, 280));
    }

    #[test]
    fn keeps_legacy_absolute_coordinates_on_a_negative_origin_display() {
        let displays = [
            display("primary", 0, 1.0, true),
            display("left", -1920, 1.5, false),
        ];
        let (position, _) = window_geometry(&bounds(None, -600.0, 240.0), &displays).unwrap();
        assert_eq!(position, PhysicalPosition::new(-900, 360));
    }

    #[test]
    fn patch_preserves_other_notes_and_concurrent_fields() {
        let mut notes = vec![
            json!({"id":"a","content":"before","visible":true,"updatedAt":7,"sync":{"dirty":false}}),
            json!({"id":"b","content":"untouched","updatedAt":5}),
        ];
        let patches = serde_json::from_value(json!([
            {"noteId":"a","updates":{"content":"- [x] done","updatedAt":8,"sync":{"dirty":true}}},
            {"noteId":"a","updates":{"visible":false,"updatedAt":8}},
            {"noteId":"c","updates":{"content":"new note","createdAt":9,"updatedAt":9}}
        ]))
        .unwrap();
        apply_note_patches(&mut notes, patches);
        assert_eq!(notes[0]["id"], "c");
        assert_eq!(
            notes[1],
            json!({
                "id":"a","content":"- [x] done","visible":false,"updatedAt":9,"sync":{"dirty":true}
            })
        );
        assert_eq!(notes[2]["content"], "untouched");
    }

    #[test]
    fn late_sync_and_editor_writes_preserve_newer_changes_and_tombstones() {
        let mut notes = vec![json!({"id":"a","content":"newer","updatedAt":7})];
        let patches = serde_json::from_value(json!([
            {"noteId":"a","updates":{"content":"older","updatedAt":6},"ifUnchanged":{"updatedAt":5}},
            {"noteId":"a","updates":{"deletedAt":8,"visible":false,"updatedAt":8}},
            {"noteId":"a","updates":{"content":"late","updatedAt":9}}
        ])).unwrap();
        apply_note_patches(&mut notes, patches);
        assert_eq!(notes[0]["content"], "newer");
        assert_eq!(notes[0]["deletedAt"], 8);
        assert_eq!(notes[0]["visible"], false);
    }
}
