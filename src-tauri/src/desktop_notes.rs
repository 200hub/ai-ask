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
#[cfg(target_os = "windows")]
mod windows_displays;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    preferred_monitor: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    monitor_bounds: HashMap<String, NoteGeometry>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
struct NoteGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Default for NoteGeometry {
    fn default() -> Self {
        Self {
            x: DEFAULT_OFFSET,
            y: DEFAULT_OFFSET,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        }
    }
}

impl DesktopNoteBounds {
    fn geometry(&self) -> NoteGeometry {
        NoteGeometry {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }

    fn preferred_monitor(&self) -> Option<&str> {
        self.preferred_monitor
            .as_deref()
            .or(self.monitor.as_deref())
    }

    fn legacy_profile(&self) -> Option<(&str, NoteGeometry)> {
        let id = self.preferred_monitor()?;
        if id.starts_with("windows:") {
            return None;
        }
        if self.preferred_monitor.is_none() && self.monitor_bounds.is_empty() {
            return Some((id, self.geometry()));
        }
        self.monitor_bounds
            .get(id)
            .copied()
            .map(|geometry| (id, geometry))
    }

    fn record(&mut self, display: &Display, geometry: NoteGeometry, displays: &[Display]) {
        let mut preferred = self.preferred_monitor().map(str::to_owned);
        if let Some((old_id, old_geometry)) = self.legacy_profile() {
            let old_id = old_id.to_owned();
            let migrated_id = displays
                .iter()
                .find(|candidate| candidate.persistable && candidate.matches_legacy_id(&old_id))
                .map_or(old_id.as_str(), |candidate| candidate.id.as_str());
            self.monitor_bounds.remove(&old_id);
            self.monitor_bounds
                .entry(migrated_id.to_owned())
                .or_insert(old_geometry);
            preferred = Some(migrated_id.to_owned());
        } else if let Some(id) = &self.monitor {
            let saved = self.geometry();
            self.monitor_bounds.entry(id.clone()).or_insert(saved);
        }
        let can_select_monitor = preferred
            .as_ref()
            .is_none_or(|id| displays.iter().any(|candidate| &candidate.id == id));
        self.preferred_monitor = if can_select_monitor {
            Some(display.id.clone())
        } else {
            preferred
        };
        self.monitor = Some(display.id.clone());
        self.monitor_bounds.insert(display.id.clone(), geometry);
        self.x = geometry.x;
        self.y = geometry.y;
        self.width = geometry.width;
        self.height = geometry.height;
    }
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
    name: Option<String>,
    persistable: bool,
    position: PhysicalPosition<i32>,
    origin: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    primary: bool,
}

impl Display {
    fn new(
        monitor: Monitor,
        primary: Option<&Monitor>,
        identities: &HashMap<String, String>,
    ) -> Self {
        let work_area = monitor.work_area();
        let position = *monitor.position();
        let name = monitor.name().cloned();
        let identity = name
            .as_ref()
            .and_then(|name| identities.get(&name.to_ascii_lowercase()))
            .cloned();
        #[cfg(target_os = "windows")]
        let identity = identity.or_else(|| {
            name.as_deref()
                .and_then(windows_displays::fallback_monitor_identity)
        });
        #[cfg(target_os = "windows")]
        let (id, persistable) = identity.map_or_else(
            || (format!("unidentified:{},{}", position.x, position.y), false),
            |id| (id, true),
        );
        #[cfg(not(target_os = "windows"))]
        let (id, persistable) = (
            identity
                .or_else(|| name.clone())
                .unwrap_or_else(|| format!("{},{}", position.x, position.y)),
            true,
        );
        Self {
            id,
            name,
            persistable,
            position,
            origin: work_area.position,
            size: work_area.size,
            scale: monitor.scale_factor(),
            primary: primary.is_some_and(|primary| primary.position() == monitor.position()),
        }
    }

    fn matches_legacy_id(&self, id: &str) -> bool {
        self.id == id
            || self
                .name
                .as_ref()
                .is_some_and(|name| name.eq_ignore_ascii_case(id))
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
    #[cfg(target_os = "windows")]
    let identities = windows_displays::monitor_identities();
    #[cfg(not(target_os = "windows"))]
    let identities = HashMap::new();
    let mut displays: Vec<_> = app
        .available_monitors()?
        .into_iter()
        .map(|monitor| Display::new(monitor, primary.as_ref(), &identities))
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

#[derive(Debug, PartialEq)]
struct PhysicalGeometry {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

struct ResolvedGeometry<'a> {
    display: &'a Display,
    geometry: PhysicalGeometry,
    migration: Option<NoteGeometry>,
}

fn window_geometry<'a>(
    bounds: &DesktopNoteBounds,
    displays: &'a [Display],
) -> Option<ResolvedGeometry<'a>> {
    let primary = displays
        .iter()
        .find(|display| display.primary)
        .or_else(|| displays.first())?;
    let active = |id: &str| displays.iter().find(|display| display.id == id);
    let legacy_target = |id: &str| {
        displays
            .iter()
            .find(|display| display.persistable && display.matches_legacy_id(id))
    };
    let saved = bounds.geometry();
    let (display, logical, migrate) = if bounds.monitor_bounds.is_empty()
        && bounds.preferred_monitor.is_none()
        && !bounds
            .monitor
            .as_deref()
            .is_some_and(|id| id.starts_with("windows:"))
    {
        if let Some((id, _)) = bounds.legacy_profile() {
            let target = legacy_target(id);
            (target.unwrap_or(primary), saved, target.is_some())
        } else {
            // Old notes saved absolute logical coordinates at the note window's DPI.
            let x = finite(saved.x, DEFAULT_OFFSET);
            let y = finite(saved.y, DEFAULT_OFFSET);
            let target = displays
                .iter()
                .find(|display| display.contains_point(x * display.scale, y * display.scale));
            let (x, y) = target.map_or((DEFAULT_OFFSET, DEFAULT_OFFSET), |display| {
                (
                    x - f64::from(display.origin.x) / display.scale,
                    y - f64::from(display.origin.y) / display.scale,
                )
            });
            (
                target.unwrap_or(primary),
                NoteGeometry { x, y, ..saved },
                target.is_some(),
            )
        }
    } else if let Some((display, logical)) = bounds
        .legacy_profile()
        .and_then(|(id, logical)| legacy_target(id).map(|display| (display, logical)))
    {
        (
            display,
            logical,
            !bounds.monitor_bounds.contains_key(&display.id),
        )
    } else {
        let latest = bounds.monitor.as_deref().and_then(active);
        let alternate = || {
            bounds.preferred_monitor().and_then(|_| {
                latest.filter(|display| !display.primary).or_else(|| {
                    displays.iter().find(|display| {
                        !display.primary && bounds.monitor_bounds.contains_key(&display.id)
                    })
                })
            })
        };
        let display = bounds
            .preferred_monitor()
            .and_then(active)
            .or_else(alternate)
            .or(latest)
            .unwrap_or(primary);
        let logical = bounds
            .monitor_bounds
            .get(&display.id)
            .copied()
            .or_else(|| (bounds.monitor.as_ref() == Some(&display.id)).then_some(saved))
            .unwrap_or_default();
        (display, logical, false)
    };

    let width = (finite(logical.width, DEFAULT_WIDTH).max(MIN_WIDTH) * display.scale)
        .round()
        .min(f64::from(display.size.width)) as u32;
    let height = (finite(logical.height, DEFAULT_HEIGHT).max(MIN_HEIGHT) * display.scale)
        .round()
        .min(f64::from(display.size.height)) as u32;
    let x = f64::from(display.origin.x)
        + (finite(logical.x, DEFAULT_OFFSET) * display.scale)
            .clamp(0.0, f64::from(display.size.width - width));
    let y = f64::from(display.origin.y)
        + (finite(logical.y, DEFAULT_OFFSET) * display.scale)
            .clamp(0.0, f64::from(display.size.height - height));

    Some(ResolvedGeometry {
        display,
        geometry: PhysicalGeometry {
            position: PhysicalPosition::new(x.round() as i32, y.round() as i32),
            size: PhysicalSize::new(width, height),
        },
        migration: migrate.then_some(logical),
    })
}

struct Placement {
    desired: DesktopNoteBounds,
    ignore_events_until: Instant,
    applied: Option<AppliedPlacement>,
}

struct AppliedPlacement {
    display_id: String,
    geometry: PhysicalGeometry,
    migration: Option<NoteGeometry>,
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
    if let Some(resolved) = window_geometry(&placement.desired, displays) {
        placement.ignore_events_until = Instant::now() + DISPLAY_SETTLE;
        window.set_position(resolved.geometry.position)?;
        window.set_size(resolved.geometry.size)?;
        placement.applied = Some(AppliedPlacement {
            display_id: resolved.display.id.clone(),
            geometry: PhysicalGeometry {
                position: window.outer_position()?,
                size: window.inner_size()?,
            },
            migration: resolved.migration,
        });
        // A move early in the transition can be the last native event. Check
        // again after settling and let the applied geometry filter layout echoes.
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(DISPLAY_SETTLE).await;
            let _ = window.emit_to(window.label(), CAPTURE_EVENT, ());
        });
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
            applied: None,
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

    (|| -> tauri::Result<Option<DesktopNoteBounds>> {
        if Instant::now() < placement.ignore_events_until
            || !window.is_visible()?
            || window.is_minimized()?
        {
            return Ok(None);
        }
        let Some(monitor) = window.current_monitor()? else {
            return Ok(None);
        };
        let Some(display) = displays
            .iter()
            .find(|display| display.persistable && display.position == *monitor.position())
        else {
            return Ok(None);
        };
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
        let geometry = PhysicalGeometry { position, size };
        let logical = if let Some(applied) = placement
            .applied
            .as_ref()
            .filter(|applied| applied.display_id == display.id && applied.geometry == geometry)
        {
            let Some(migration) = applied.migration else {
                return Ok(None);
            };
            migration
        } else {
            let (x, y) = display.logical_offset(position);
            NoteGeometry {
                x,
                y,
                width: (f64::from(size.width) / display.scale).max(MIN_WIDTH),
                height: (f64::from(size.height) / display.scale).max(MIN_HEIGHT),
            }
        };
        placement.desired.record(display, logical, &displays);
        placement.applied = None;
        Ok(Some(placement.desired.clone()))
    })()
    .map_err(|error| error.to_string())
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
            name: Some(id.to_string()),
            persistable: true,
            position: PhysicalPosition::new(x, 0),
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
            preferred_monitor: None,
            monitor_bounds: HashMap::new(),
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
        let PhysicalGeometry { position, size } =
            window_geometry(&bounds(Some("left"), 120.0, 120.0), &displays)
                .unwrap()
                .geometry;
        assert_eq!(position, PhysicalPosition::new(-1740, 220));
        assert_eq!(size, PhysicalSize::new(480, 420));
    }

    #[test]
    fn restores_note_to_same_display_after_rearrangement() {
        let displays = [
            display("primary", 0, 1.0, true),
            display("left", 1920, 1.25, false),
        ];
        let PhysicalGeometry { position, size } =
            window_geometry(&bounds(Some("left"), 120.0, 120.0), &displays)
                .unwrap()
                .geometry;
        assert_eq!(position, PhysicalPosition::new(2070, 190));
        assert_eq!(size, PhysicalSize::new(400, 350));
    }

    #[test]
    fn clamps_note_inside_primary_work_area_when_saved_display_is_disconnected() {
        let displays = [display("primary", 0, 1.0, true)];
        let PhysicalGeometry { position, size } =
            window_geometry(&bounds(Some("missing"), 2700.0, 900.0), &displays)
                .unwrap()
                .geometry;
        assert_eq!(position, PhysicalPosition::new(1600, 800));
        assert_eq!(size, PhysicalSize::new(320, 280));
    }

    #[test]
    fn keeps_legacy_absolute_coordinates_on_a_negative_origin_display() {
        let displays = [
            display("primary", 0, 1.0, true),
            display("left", -1920, 1.5, false),
        ];
        let position = window_geometry(&bounds(None, -600.0, 240.0), &displays)
            .unwrap()
            .geometry
            .position;
        assert_eq!(position, PhysicalPosition::new(-900, 360));
    }

    #[test]
    fn restores_independent_display_profiles_after_fallback_edit_and_restart() {
        let main = display("windows:main", 0, 1.0, true);
        let projector = display("windows:projector-a", 1920, 1.25, false);
        let main_geometry = NoteGeometry {
            x: 237.0,
            y: 146.0,
            ..Default::default()
        };
        let projector_geometry = NoteGeometry {
            x: 133.6,
            y: 98.4,
            width: 320.8,
            height: 281.6,
        };
        let mut note = bounds(None, 120.0, 120.0);
        note.record(&main, main_geometry, std::slice::from_ref(&main));
        let extended = [main.clone(), projector.clone()];
        note.record(&projector, projector_geometry, &extended);
        let fallback = window_geometry(&note, std::slice::from_ref(&main)).unwrap();
        assert_eq!(fallback.geometry.position, PhysicalPosition::new(237, 186));

        let updated_main = NoteGeometry {
            x: 315.0,
            ..main_geometry
        };
        note.record(&main, updated_main, std::slice::from_ref(&main));
        let saved = serde_json::to_value(&note).unwrap();
        assert_eq!(saved["monitor"], main.id);
        assert_eq!(saved["preferredMonitor"], projector.id);
        assert_eq!(saved["monitorBounds"][&projector.id]["x"], 133.6);
        let reopened: DesktopNoteBounds = serde_json::from_value(saved).unwrap();
        assert_eq!(reopened.monitor_bounds[&main.id], updated_main);
        let rearranged = [main, display(&projector.id, -1920, 1.25, false)];
        let restored = window_geometry(&reopened, &rearranged).unwrap();
        assert_eq!(restored.display.id, projector.id);
        assert_eq!(
            restored.geometry.position,
            PhysicalPosition::new(-1753, 163)
        );
        assert_eq!(restored.geometry.size, PhysicalSize::new(401, 352));
    }

    #[test]
    fn reused_display_alias_does_not_inherit_a_different_projectors_geometry() {
        let mut original = display("windows:projector-a", 0, 1.0, true);
        let mut replacement = display("windows:projector-b", 0, 1.0, true);
        let alias = r"\\.\DISPLAY2";
        original.name = Some(alias.into());
        replacement.name = Some(alias.into());
        let original_geometry = NoteGeometry {
            x: 630.0,
            y: 456.0,
            ..Default::default()
        };
        let mut note = bounds(None, 120.0, 120.0);
        note.record(
            &original,
            original_geometry,
            std::slice::from_ref(&original),
        );
        let fallback = window_geometry(&note, std::slice::from_ref(&replacement)).unwrap();
        assert_eq!(fallback.display.id, replacement.id);
        assert_eq!(fallback.geometry.position, PhysicalPosition::new(120, 160));
        assert_eq!(fallback.migration, None);
        let replacement_geometry = NoteGeometry {
            x: 147.0,
            y: 178.0,
            ..Default::default()
        };
        note.record(
            &replacement,
            replacement_geometry,
            std::slice::from_ref(&replacement),
        );
        assert_eq!(note.monitor_bounds[&original.id], original_geometry);
        assert_eq!(note.monitor_bounds[&replacement.id], replacement_geometry);
        assert_eq!(
            note.preferred_monitor.as_deref(),
            Some(original.id.as_str())
        );
    }

    #[test]
    fn unidentified_display_cannot_claim_a_saved_legacy_alias() {
        let alias = r"\\.\DISPLAY2";
        let main = display("windows:main", 0, 1.0, true);
        let mut unverified = display("unidentified:1920,0", 1920, 1.0, false);
        unverified.name = Some(alias.into());
        unverified.persistable = false;
        let displays = [main.clone(), unverified];
        let note = bounds(Some(alias), 455.0, 238.0);
        let resolved = window_geometry(&note, &displays).unwrap();
        assert_eq!(resolved.display.id, main.id);
        assert_eq!(resolved.migration, None);
    }

    #[test]
    fn restores_known_alternate_projector_when_preferred_is_still_absent() {
        let main = display("windows:main", 0, 1.0, true);
        let original = display("windows:projector-a", 1920, 1.0, false);
        let replacement = display("windows:projector-b", 1920, 1.0, false);
        let default_geometry = NoteGeometry::default();
        let replacement_geometry = NoteGeometry {
            x: 218.0,
            ..default_geometry
        };
        let mut note = bounds(None, 120.0, 120.0);
        note.record(&original, default_geometry, std::slice::from_ref(&original));
        let alternate = [main.clone(), replacement.clone()];
        let unknown = window_geometry(&note, &alternate).unwrap();
        assert_eq!(unknown.display.id, main.id);
        note.record(&replacement, replacement_geometry, &alternate);
        note.record(&main, default_geometry, std::slice::from_ref(&main));
        let reopened = serde_json::from_str(&serde_json::to_string(&note).unwrap()).unwrap();
        let restored = window_geometry(&reopened, &alternate).unwrap();
        assert_eq!(restored.display.id, replacement.id);
        assert_eq!(restored.geometry.position, PhysicalPosition::new(2138, 160));

        let original_returned = [main.clone(), original, replacement];
        note.record(&main, default_geometry, &original_returned);
        assert_eq!(
            window_geometry(&note, &original_returned)
                .unwrap()
                .display
                .id,
            main.id
        );
    }

    #[test]
    fn migrates_old_alias_without_overwriting_its_geometry_from_another_display() {
        let main = display("windows:main", 0, 1.0, true);
        let mut projector = display("windows:projector", 1920, 1.0, false);
        let alias = r"\\.\DISPLAY2";
        projector.name = Some(alias.into());
        let mut note = bounds(Some(alias), 455.0, 238.0);
        let original = note.geometry();
        note.record(&main, NoteGeometry::default(), std::slice::from_ref(&main));
        assert_eq!(note.monitor_bounds[alias], original);
        let extended = [main, projector.clone()];
        let resolved = window_geometry(&note, &extended).unwrap();
        assert_eq!(resolved.display.id, projector.id);
        assert_eq!(resolved.migration, Some(original));
        note.record(resolved.display, resolved.migration.unwrap(), &extended);
        assert_eq!(note.monitor_bounds[&projector.id], original);
        assert!(!note.monitor_bounds.contains_key(alias));
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
