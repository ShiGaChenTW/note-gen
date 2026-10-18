// Fork (D2): read-only macOS Calendar access for the Today page.
// The EventKit work runs in a small Swift helper (native-calendar/macos-eventkit),
// built by build.rs and bundled under resources/calendar, the same way as OCR.
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start: f64,
    pub end: f64,
    pub all_day: bool,
    pub calendar: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarResponse {
    pub access: String,
    pub events: Vec<CalendarEvent>,
}

impl CalendarResponse {
    fn unavailable() -> Self {
        Self { access: "unavailable".to_string(), events: Vec::new() }
    }
}

#[tauri::command]
pub async fn calendar_events(app_handle: AppHandle, start: f64, end: f64) -> Result<CalendarResponse, String> {
    run_helper(app_handle, "events", start, end).await
}

/// Shows the macOS permission prompt when access was never decided, then returns events.
#[tauri::command]
pub async fn calendar_request_access(app_handle: AppHandle, start: f64, end: f64) -> Result<CalendarResponse, String> {
    run_helper(app_handle, "request", start, end).await
}

#[cfg(target_os = "macos")]
async fn run_helper(app_handle: AppHandle, action: &'static str, start: f64, end: f64) -> Result<CalendarResponse, String> {
    if !(start.is_finite() && end.is_finite() && end > start) {
        return Err("Invalid calendar range".to_string());
    }
    let Some(command_path) = helper_path(&app_handle) else {
        return Ok(CalendarResponse::unavailable());
    };
    tauri::async_runtime::spawn_blocking(move || run_helper_sync(command_path, action, start, end))
        .await
        .map_err(|e| format!("Calendar helper task failed: {}", e))?
}

#[cfg(not(target_os = "macos"))]
async fn run_helper(_app_handle: AppHandle, _action: &'static str, _start: f64, _end: f64) -> Result<CalendarResponse, String> {
    Ok(CalendarResponse::unavailable())
}

#[cfg(target_os = "macos")]
fn helper_path(app_handle: &AppHandle) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    use tauri::Manager;

    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("calendar").join("notegen-calendar"));
        candidates.push(resource_dir.join("resources").join("calendar").join("notegen-calendar"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("calendar")
            .join("notegen-calendar"),
    );
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn run_helper_sync(command_path: std::path::PathBuf, action: &str, start: f64, end: f64) -> Result<CalendarResponse, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let payload = serde_json::json!({ "action": action, "start": start, "end": end });
    let mut child = Command::new(command_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start calendar helper: {}", e))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| format!("Failed to write calendar helper input: {}", e))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read calendar helper output: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Calendar helper exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Failed to parse calendar helper output: {}", e))
}
