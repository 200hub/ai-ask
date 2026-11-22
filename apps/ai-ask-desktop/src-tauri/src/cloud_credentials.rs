//! Hai session credentials are kept in the operating system credential store.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Webview;

const CREDENTIAL_SERVICE: &str = "com.200hub.aiask.hai-session";
const MAIN_WINDOW_LABEL: &str = "main";
const NOTE_WINDOW_PREFIX: &str = "desktop-note-";
static CREDENTIALS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudTokens {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
}

fn authorize_window(label: &str) -> Result<(), String> {
    if label == MAIN_WINDOW_LABEL || label.starts_with(NOTE_WINDOW_PREFIX) {
        Ok(())
    } else {
        Err("Cloud credentials are unavailable to this window".into())
    }
}

fn credential_account(server_url: &str) -> Result<String, String> {
    let mut url = tauri::Url::parse(server_url).map_err(|_| "Invalid cloud server URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Cloud server URL must use HTTP(S) without credentials, query, or fragment".into(),
        );
    }
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

fn credential_entry(account: &str) -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, account)
        .map_err(|_| "Operating system credential store unavailable".into())
}

fn read_tokens(entry: &Entry) -> Result<Option<CloudTokens>, String> {
    match entry.get_secret() {
        Ok(secret) => serde_json::from_slice(&secret)
            .map(Some)
            .map_err(|_| "Stored cloud session is invalid".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Failed to read cloud session from operating system credential store".into()),
    }
}

fn write_tokens(entry: &Entry, tokens: CloudTokens) -> Result<(), String> {
    let mut current = read_tokens(entry)?.unwrap_or(CloudTokens {
        access_token: None,
        refresh_token: None,
    });
    if tokens.access_token.is_some() {
        current.access_token = tokens.access_token;
    }
    if tokens.refresh_token.is_some() {
        current.refresh_token = tokens.refresh_token;
    }
    let secret = serde_json::to_vec(&current).map_err(|_| "Failed to encode cloud session")?;
    entry
        .set_secret(&secret)
        .map_err(|_| "Failed to save cloud session in operating system credential store".into())
}

fn clear_tokens(entry: &Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => {
            Err("Failed to clear cloud session from operating system credential store".into())
        }
    }
}

#[tauri::command]
pub async fn read_cloud_tokens(
    webview: Webview,
    server_url: String,
) -> Result<Option<CloudTokens>, String> {
    authorize_window(webview.label())?;
    let account = credential_account(&server_url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _transaction = CREDENTIALS_LOCK
            .lock()
            .map_err(|_| "Cloud credential operation unavailable".to_string())?;
        read_tokens(&credential_entry(&account)?)
    })
    .await
    .map_err(|_| "Cloud credential operation failed".to_string())?
}

#[tauri::command]
pub async fn write_cloud_tokens(
    webview: Webview,
    server_url: String,
    tokens: CloudTokens,
) -> Result<(), String> {
    authorize_window(webview.label())?;
    let account = credential_account(&server_url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _transaction = CREDENTIALS_LOCK
            .lock()
            .map_err(|_| "Cloud credential operation unavailable".to_string())?;
        write_tokens(&credential_entry(&account)?, tokens)
    })
    .await
    .map_err(|_| "Cloud credential operation failed".to_string())?
}

#[tauri::command]
pub async fn clear_cloud_tokens(webview: Webview, server_url: String) -> Result<(), String> {
    authorize_window(webview.label())?;
    let account = credential_account(&server_url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _transaction = CREDENTIALS_LOCK
            .lock()
            .map_err(|_| "Cloud credential operation unavailable".to_string())?;
        clear_tokens(&credential_entry(&account)?)
    })
    .await
    .map_err(|_| "Cloud credential operation failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricts_credentials_to_application_editors() {
        assert!(authorize_window("main").is_ok());
        assert!(authorize_window("desktop-note-123").is_ok());
        assert!(authorize_window("selection-toolbar").is_err());
        assert!(authorize_window("platform-chatgpt").is_err());
    }

    #[test]
    fn isolates_hosts_and_server_paths_and_normalizes_trailing_slashes() {
        assert_eq!(
            credential_account("https://EXAMPLE.com:443/api/").unwrap(),
            "https://example.com/api"
        );
        assert_ne!(
            credential_account("https://example.com/a").unwrap(),
            credential_account("https://example.com/b").unwrap()
        );
        assert_ne!(
            credential_account("https://example.com").unwrap(),
            credential_account("http://example.com").unwrap()
        );
    }

    #[test]
    fn rejects_urls_with_embedded_credentials_or_unsupported_schemes() {
        for url in [
            "file:///tmp/test",
            "https://user:secret@example.com",
            "https://user@example.com",
            "https://example.com?token=secret",
            "https://example.com#fragment",
            "invalid",
        ] {
            assert!(credential_account(url).is_err());
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_credential_store_round_trip_and_deletion() {
        let account = format!(
            "https://credential-test-{}.invalid/{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let entry = credential_entry(&account).expect("native credential store must be available");
        assert!(read_tokens(&entry).unwrap().is_none());
        write_tokens(
            &entry,
            CloudTokens {
                access_token: Some("test-access".into()),
                refresh_token: Some("test-refresh".into()),
            },
        )
        .unwrap();
        let tokens = read_tokens(&entry).unwrap().unwrap();
        assert_eq!(tokens.access_token.as_deref(), Some("test-access"));
        assert_eq!(tokens.refresh_token.as_deref(), Some("test-refresh"));
        write_tokens(
            &entry,
            CloudTokens {
                access_token: Some("updated-access".into()),
                refresh_token: None,
            },
        )
        .unwrap();
        let tokens = read_tokens(&entry).unwrap().unwrap();
        let _ = clear_tokens(&entry);
        assert_eq!(tokens.access_token.as_deref(), Some("updated-access"));
        assert_eq!(tokens.refresh_token.as_deref(), Some("test-refresh"));
        assert!(read_tokens(&entry).unwrap().is_none());
        assert!(clear_tokens(&entry).is_ok());
    }
}
