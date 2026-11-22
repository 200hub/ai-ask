use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

use crate::global_selection::trigger_toolbar_from_hotkey;
use crate::selection_toolbar::ToolbarManager;
use crate::window_control::{show_main_window_without_restore, toggle_main_window_visibility};

const STORE_FILE: &str = "config.json";
const STORE_KEY_CONFIG: &str = "app_config";
const MAIN_WEBVIEW: &str = "main";
const SHORTCUT_DEBOUNCE: Duration = Duration::from_millis(350);
const TRANSLATION_HOTKEY_EVENT: &str = "translation-hotkey-triggered";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) enum ShortcutKind {
    #[serde(rename = "globalHotkey")]
    MainWindow,
    #[serde(rename = "translationHotkey")]
    Translation,
    #[serde(rename = "selectionToolbarHotkey")]
    SelectionToolbar,
}

impl ShortcutKind {
    const ALL: [Self; 3] = [Self::MainWindow, Self::Translation, Self::SelectionToolbar];

    fn config_key(self) -> &'static str {
        match self {
            Self::MainWindow => "globalHotkey",
            Self::Translation => "translationHotkey",
            Self::SelectionToolbar => "selectionToolbarHotkey",
        }
    }

    fn default_accelerator(self) -> &'static str {
        match self {
            Self::MainWindow => "CommandOrControl+Shift+A",
            Self::Translation => "CommandOrControl+Shift+T",
            Self::SelectionToolbar => "CommandOrControl+Shift+S",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShortcutFailure {
    Invalid,
    Duplicate,
    Unavailable,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ShortcutStatus {
    kind: ShortcutKind,
    accelerator: String,
    failure: Option<ShortcutFailure>,
}

struct Binding {
    status: ShortcutStatus,
    registered: Option<Shortcut>,
}

#[derive(Default)]
pub(crate) struct ShortcutManager(Mutex<Vec<Binding>>);

fn parse_shortcut(accelerator: &str) -> Result<Shortcut, ShortcutFailure> {
    let shortcut: Shortcut = accelerator.parse().map_err(|_| ShortcutFailure::Invalid)?;
    if shortcut.mods.is_empty() {
        return Err(ShortcutFailure::Invalid);
    }
    Ok(shortcut)
}

fn replace_shortcut(
    bindings: &[Binding],
    kind: ShortcutKind,
    accelerator: &str,
    register: impl FnOnce(Shortcut) -> Result<(), ShortcutFailure>,
    unregister: impl Fn(Shortcut) -> Result<(), ShortcutFailure>,
    persist: impl Fn() -> Result<(), ShortcutFailure>,
    revert_persisted: impl Fn(),
) -> Result<Shortcut, ShortcutFailure> {
    let shortcut = parse_shortcut(accelerator)?;
    let mut previous = None;
    for binding in bindings {
        if binding.status.kind == kind {
            previous = binding.registered;
        } else if binding.registered == Some(shortcut) {
            return Err(ShortcutFailure::Duplicate);
        }
    }
    if previous == Some(shortcut) {
        persist()?;
        return Ok(shortcut);
    }

    // Register first so a rejected candidate never disables the working shortcut.
    register(shortcut)?;
    let result = persist().and_then(|()| {
        if let Some(previous) = previous {
            unregister(previous).inspect_err(|_| revert_persisted())?;
        }
        Ok(())
    });
    if let Err(error) = result {
        if unregister(shortcut).is_err() {
            log::error!("Failed to roll back shortcut registration: {shortcut}");
        }
        return Err(error);
    }
    Ok(shortcut)
}

fn register_shortcut(
    app: &AppHandle,
    kind: ShortcutKind,
    shortcut: Shortcut,
) -> Result<(), ShortcutFailure> {
    let last_trigger = Mutex::new(None::<Instant>);
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let now = Instant::now();
            let mut last = last_trigger
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if last.is_some_and(|previous| now.duration_since(previous) < SHORTCUT_DEBOUNCE) {
                return;
            }
            *last = Some(now);
            let app = app.clone();
            tauri::async_runtime::spawn(async move { dispatch_shortcut(app, kind).await });
        })
        .map_err(|error| {
            log::warn!("Could not register shortcut for {kind:?} ({shortcut}): {error}");
            match error {
                tauri_plugin_global_shortcut::Error::GlobalHotkey(_) => {
                    ShortcutFailure::Unavailable
                }
                _ => ShortcutFailure::Failed,
            }
        })
}

async fn dispatch_shortcut(app: AppHandle, kind: ShortcutKind) {
    log::debug!("Global shortcut pressed: {kind:?}");
    match kind {
        ShortcutKind::MainWindow => {
            if let Some(window) = app.get_window(MAIN_WEBVIEW) {
                let _ = toggle_main_window_visibility(&window).await;
            }
        }
        ShortcutKind::Translation => {
            if let Some(window) = app.get_window(MAIN_WEBVIEW) {
                if show_main_window_without_restore(&window).await.is_ok() {
                    if let Err(error) = window.emit(TRANSLATION_HOTKEY_EVENT, ()) {
                        log::warn!("Could not emit translation shortcut event: {error}");
                    }
                }
            }
        }
        ShortcutKind::SelectionToolbar => {
            let toolbar_manager = app.state::<ToolbarManager>().inner().clone();
            trigger_toolbar_from_hotkey(app, toolbar_manager);
        }
    }
}

pub(crate) fn initialize(app: &AppHandle) {
    let config = match app.store(STORE_FILE) {
        Ok(store) => store.get(STORE_KEY_CONFIG),
        Err(error) => {
            log::warn!("Could not load shortcut configuration: {error}");
            None
        }
    };
    let state = app.state::<ShortcutManager>();
    let mut bindings = state.0.lock().unwrap_or_else(|error| error.into_inner());
    for kind in ShortcutKind::ALL {
        let accelerator = config
            .as_ref()
            .and_then(|config| config.get(kind.config_key()))
            .and_then(Value::as_str)
            .unwrap_or_else(|| kind.default_accelerator());
        let result = replace_shortcut(
            &bindings,
            kind,
            accelerator,
            |shortcut| register_shortcut(app, kind, shortcut),
            |_| Ok(()),
            || Ok(()),
            || (),
        );
        bindings.push(Binding {
            status: ShortcutStatus {
                kind,
                accelerator: accelerator.into(),
                failure: result.err(),
            },
            registered: result.ok(),
        });
    }
}

#[tauri::command]
pub(crate) fn get_global_shortcut_statuses(app: AppHandle) -> Vec<ShortcutStatus> {
    app.state::<ShortcutManager>()
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .map(|binding| binding.status.clone())
        .collect()
}

#[tauri::command]
pub(crate) async fn set_global_shortcut(
    app: AppHandle,
    webview: Webview,
    kind: ShortcutKind,
    accelerator: String,
) -> Result<ShortcutStatus, ShortcutFailure> {
    if webview.label() != MAIN_WEBVIEW {
        return Err(ShortcutFailure::Failed);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(apply_shortcut(&handle, kind, accelerator));
    })
    .map_err(|error| {
        log::error!("Could not schedule global shortcut update: {error}");
        ShortcutFailure::Failed
    })?;
    receiver.await.map_err(|_| ShortcutFailure::Failed)?
}

fn apply_shortcut(
    app: &AppHandle,
    kind: ShortcutKind,
    accelerator: String,
) -> Result<ShortcutStatus, ShortcutFailure> {
    let state = app.state::<ShortcutManager>();
    let mut bindings = state.0.lock().unwrap_or_else(|error| error.into_inner());
    let Some(index) = bindings
        .iter()
        .position(|binding| binding.status.kind == kind)
    else {
        return Err(ShortcutFailure::Failed);
    };
    let store = app.store(STORE_FILE).map_err(|error| {
        log::error!("Could not open shortcut configuration: {error}");
        ShortcutFailure::Failed
    })?;
    let previous_config = store.get(STORE_KEY_CONFIG);
    let mut config = previous_config
        .as_ref()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    config.insert(kind.config_key().into(), Value::String(accelerator.clone()));
    let restore_config = || {
        if let Some(previous) = &previous_config {
            store.set(STORE_KEY_CONFIG, previous.clone());
        } else {
            store.delete(STORE_KEY_CONFIG);
        }
        if let Err(error) = store.save() {
            log::error!("Could not restore shortcut configuration: {error}");
        }
    };
    let registered = replace_shortcut(
        &bindings,
        kind,
        &accelerator,
        |shortcut| register_shortcut(app, kind, shortcut),
        |shortcut| {
            app.global_shortcut().unregister(shortcut).map_err(|error| {
                log::error!("Could not unregister shortcut for {kind:?} ({shortcut}): {error}");
                ShortcutFailure::Failed
            })
        },
        || {
            store.set(STORE_KEY_CONFIG, Value::Object(config.clone()));
            store.save().map_err(|error| {
                log::error!("Could not save shortcut configuration: {error}");
                restore_config();
                ShortcutFailure::Failed
            })
        },
        restore_config,
    )?;
    let status = ShortcutStatus {
        kind,
        accelerator,
        failure: None,
    };
    bindings[index] = Binding {
        status: status.clone(),
        registered: Some(registered),
    };
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn binding(kind: ShortcutKind) -> Binding {
        let accelerator = kind.default_accelerator();
        Binding {
            status: ShortcutStatus {
                kind,
                accelerator: accelerator.into(),
                failure: None,
            },
            registered: Some(parse_shortcut(accelerator).unwrap()),
        }
    }

    #[test]
    fn detects_duplicate_modifiers_and_aliases_before_calling_os() {
        let modifier = if cfg!(target_os = "macos") {
            "Cmd"
        } else {
            "Ctrl"
        };
        let result = replace_shortcut(
            &[binding(ShortcutKind::MainWindow)],
            ShortcutKind::Translation,
            &format!("Shift+{modifier}+A"),
            |_| panic!("duplicate must not reach the OS"),
            |_| panic!("existing binding must not be touched"),
            || panic!("duplicate must not be saved"),
            || panic!("untouched configuration must not be reverted"),
        );
        assert_eq!(result, Err(ShortcutFailure::Duplicate));
        assert_eq!(parse_shortcut("A"), Err(ShortcutFailure::Invalid));
        assert_eq!(parse_shortcut("Control+"), Err(ShortcutFailure::Invalid));
    }

    #[test]
    fn occupied_accelerator_does_not_release_working_shortcut() {
        let result = replace_shortcut(
            &[binding(ShortcutKind::MainWindow)],
            ShortcutKind::MainWindow,
            "CommandOrControl+Shift+Q",
            |_| Err(ShortcutFailure::Unavailable),
            |_| panic!("working shortcut must not be released"),
            || panic!("occupied accelerator must not be saved"),
            || panic!("untouched configuration must not be reverted"),
        );
        assert_eq!(result, Err(ShortcutFailure::Unavailable));
    }

    #[test]
    fn replaces_binding_and_rolls_back_if_old_key_cannot_be_released() {
        let binding = binding(ShortcutKind::MainWindow);
        let old = binding.registered.unwrap();
        let candidate = "CommandOrControl+Shift+Q";
        let new = parse_shortcut(candidate).unwrap();
        let bindings = [binding];
        for release_fails in [false, true] {
            let calls = RefCell::new(Vec::new());
            let result = replace_shortcut(
                &bindings,
                ShortcutKind::MainWindow,
                candidate,
                |shortcut| {
                    calls.borrow_mut().push(("register", shortcut));
                    Ok(())
                },
                |shortcut| {
                    calls.borrow_mut().push(("unregister", shortcut));
                    if release_fails && shortcut == old {
                        Err(ShortcutFailure::Failed)
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
                || (),
            );
            let mut expected = vec![("register", new), ("unregister", old)];
            if release_fails {
                expected.push(("unregister", new));
                assert_eq!(result, Err(ShortcutFailure::Failed));
            } else {
                assert_eq!(result, Ok(new));
            }
            assert_eq!(*calls.borrow(), expected);
        }
    }
}
