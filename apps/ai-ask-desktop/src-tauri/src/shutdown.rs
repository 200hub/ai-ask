//! Coordinate durable local writes in every editor before allowing process exit.

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tokio::sync::Notify;

const BEFORE_EXIT_EVENT: &str = "app-before-exit";
const EXIT_FAILED_EVENT: &str = "app-exit-failed";
const EXIT_FLUSH_TIMEOUT: Duration = Duration::from_secs(10);
const MAIN_WINDOW_LABEL: &str = "main";
const NOTE_WINDOW_PREFIX: &str = "desktop-note-";

#[tauri::command]
pub fn request_app_exit(app: AppHandle, webview: Webview) -> Result<(), String> {
    if webview.label() != MAIN_WINDOW_LABEL {
        return Err("Application exit is only available from the main window".into());
    }
    app.exit(0);
    Ok(())
}

#[derive(Default)]
pub struct ExitCoordinator {
    started: AtomicBool,
    approved: AtomicBool,
    generation: AtomicU64,
    pending: Mutex<Option<PendingFlush>>,
    changed: Notify,
    editor_creation: tokio::sync::Mutex<()>,
}

impl ExitCoordinator {
    /// 创建与退出快照使用同一把锁，避免新编辑窗口漏掉保存请求。
    pub async fn begin_editor_open(&self) -> Result<tokio::sync::MutexGuard<'_, ()>, String> {
        let guard = self.editor_creation.lock().await;
        if self.started.load(Ordering::SeqCst) {
            return Err("Cannot open an editor while application exit is in progress".into());
        }
        Ok(guard)
    }
}

struct PendingFlush {
    request_id: u64,
    windows: HashSet<String>,
    error: Option<String>,
}

impl PendingFlush {
    fn acknowledge(&mut self, request_id: u64, label: &str, error: Option<String>) -> bool {
        if self.request_id != request_id || !self.windows.remove(label) {
            return false;
        }
        if let Some(error) = error {
            self.error
                .get_or_insert_with(|| format!("{label}: {error}"));
        }
        true
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitFlushRequest {
    request_id: u64,
}

#[derive(Clone, Serialize)]
struct ExitFailure {
    message: String,
}

/// The window label is injected by Tauri, so one editor cannot acknowledge another.
#[tauri::command]
pub fn complete_exit_flush(
    webview: Webview,
    state: State<'_, ExitCoordinator>,
    request_id: u64,
    error: Option<String>,
) -> Result<(), String> {
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "Exit coordination state unavailable".to_string())?;
    if let Some(pending) = pending.as_mut() {
        if pending.acknowledge(request_id, webview.label(), error) {
            state.changed.notify_one();
        }
    }
    Ok(())
}

/// A closing note has already completed its own local save before destroying itself.
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let state = app.state::<ExitCoordinator>();
    if let Ok(mut pending) = state.pending.lock() {
        if let Some(pending) = pending.as_mut() {
            if pending.windows.remove(label) {
                state.changed.notify_one();
            }
        }
    };
}

/// Keeps the application alive while an update installer is being started.
/// Dropping an unused permit cancels the exit and unlocks the editors.
pub struct ExitPermit {
    app: AppHandle,
    committed: bool,
}

impl ExitPermit {
    pub fn restart(mut self) {
        self.app
            .state::<ExitCoordinator>()
            .approved
            .store(true, Ordering::SeqCst);
        self.committed = true;
        self.app.request_restart();
    }

    pub fn exit(mut self, code: i32) {
        self.app
            .state::<ExitCoordinator>()
            .approved
            .store(true, Ordering::SeqCst);
        self.committed = true;
        self.app.exit(code);
    }
}

impl Drop for ExitPermit {
    fn drop(&mut self) {
        let state = self.app.state::<ExitCoordinator>();
        if let Ok(mut pending) = state.pending.lock() {
            *pending = None;
        }
        if !self.committed {
            state.started.store(false, Ordering::SeqCst);
            let _ = self.app.emit(
                EXIT_FAILED_EVENT,
                ExitFailure {
                    message: "Application exit was cancelled; local data was retained".into(),
                },
            );
        }
    }
}

pub async fn prepare_exit(app: &AppHandle) -> Result<ExitPermit, String> {
    let state = app.state::<ExitCoordinator>();
    let editor_creation = state.editor_creation.lock().await;
    state
        .started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Application exit is already in progress".to_string())?;
    let permit = ExitPermit {
        app: app.clone(),
        committed: false,
    };
    let request_id = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let windows: HashSet<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| label == MAIN_WINDOW_LABEL || label.starts_with(NOTE_WINDOW_PREFIX))
        .collect();
    *state
        .pending
        .lock()
        .map_err(|_| "Exit coordination state unavailable".to_string())? = Some(PendingFlush {
        request_id,
        windows: windows.clone(),
        error: None,
    });
    drop(editor_creation);

    for label in windows {
        app.emit_to(&label, BEFORE_EXIT_EVENT, ExitFlushRequest { request_id })
            .map_err(|error| format!("Failed to request local save from {label}: {error}"))?;
    }

    wait_for_flush(&state, EXIT_FLUSH_TIMEOUT).await?;
    log::info!("All editor windows saved local changes before exit");
    Ok(permit)
}

async fn wait_for_flush(state: &ExitCoordinator, timeout: Duration) -> Result<(), String> {
    let result = tokio::time::timeout(timeout, async {
        loop {
            let changed = state.changed.notified();
            {
                let pending = state
                    .pending
                    .lock()
                    .map_err(|_| "Exit coordination state unavailable".to_string())?;
                let pending = pending
                    .as_ref()
                    .ok_or_else(|| "Exit coordination was cancelled".to_string())?;
                if let Some(error) = &pending.error {
                    return Err(format!("Local save failed before exit: {error}"));
                }
                if pending.windows.is_empty() {
                    return Ok(());
                }
            }
            changed.await;
        }
    })
    .await;

    match result {
        Ok(result) => result?,
        Err(_) => {
            return Err("Timed out waiting for editor saves; application exit cancelled".into())
        }
    }
    Ok(())
}

pub fn handle_exit_requested(app: &AppHandle, code: Option<i32>, api: tauri::ExitRequestApi) {
    let state = app.state::<ExitCoordinator>();
    if state.approved.load(Ordering::SeqCst) {
        return;
    }
    api.prevent_exit();
    if state.started.load(Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match prepare_exit(&app).await {
            Ok(permit) => permit.exit(code.unwrap_or_default()),
            Err(error) => log::error!("Failed to prepare application exit: {error}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn new_editors_are_rejected_after_exit_begins_and_allowed_after_cancellation() {
        let state = ExitCoordinator::default();
        assert!(state.begin_editor_open().await.is_ok());
        state.started.store(true, Ordering::SeqCst);
        assert!(state.begin_editor_open().await.is_err());
        state.started.store(false, Ordering::SeqCst);
        assert!(state.begin_editor_open().await.is_ok());
    }

    fn request() -> PendingFlush {
        PendingFlush {
            request_id: 2,
            windows: ["main".into(), "desktop-note-a".into()].into(),
            error: None,
        }
    }

    #[test]
    fn waits_for_every_editor_instead_of_only_the_main_window() {
        let mut pending = request();
        assert!(pending.acknowledge(2, "main", None));
        assert!(!pending.windows.is_empty());
        assert!(pending.acknowledge(2, "desktop-note-a", None));
        assert!(pending.windows.is_empty());
        assert!(pending.error.is_none());
    }

    #[test]
    fn ignores_old_duplicate_and_unrelated_acknowledgements() {
        let mut pending = request();
        assert!(!pending.acknowledge(1, "main", None));
        assert!(!pending.acknowledge(2, "selection-toolbar", None));
        assert_eq!(pending.windows.len(), 2);
        assert!(pending.acknowledge(2, "main", None));
        assert!(!pending.acknowledge(2, "main", None));
        assert_eq!(pending.windows.len(), 1);
    }

    #[test]
    fn successful_other_windows_cannot_erase_a_local_save_failure() {
        let mut pending = request();
        assert!(pending.acknowledge(2, "desktop-note-a", Some("disk full".into())));
        assert!(pending.acknowledge(2, "main", None));
        assert!(pending.windows.is_empty());
        assert_eq!(pending.error.as_deref(), Some("desktop-note-a: disk full"));
    }

    #[tokio::test]
    async fn an_unresponsive_editor_times_out_without_approving_exit() {
        let state = ExitCoordinator::default();
        let mut pending = request();
        pending.acknowledge(2, "main", None);
        *state.pending.lock().unwrap() = Some(pending);
        let error = wait_for_flush(&state, Duration::from_millis(1))
            .await
            .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(!state.approved.load(Ordering::SeqCst));
        assert!(state
            .pending
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .windows
            .contains("desktop-note-a"));
    }

    #[tokio::test]
    async fn a_local_save_failure_aborts_before_other_editors_acknowledge() {
        let state = ExitCoordinator::default();
        let mut pending = request();
        pending.acknowledge(2, "desktop-note-a", Some("disk full".into()));
        *state.pending.lock().unwrap() = Some(pending);
        let error = wait_for_flush(&state, EXIT_FLUSH_TIMEOUT)
            .await
            .unwrap_err();
        assert!(error.contains("disk full"));
        assert!(!state.approved.load(Ordering::SeqCst));
    }
}
