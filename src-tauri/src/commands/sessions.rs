use crate::application::hermes_manager::HermesManager;
use crate::models::{SessionDetail, SessionRecord};

#[tauri::command]
pub fn list_sessions(limit: Option<usize>, profile: Option<String>) -> Result<Vec<SessionRecord>, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.sessions(limit.unwrap_or(80)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_session_detail(session_id: String, profile: Option<String>) -> Result<SessionDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.session_detail(&session_id))
        .map_err(|error| error.to_string())
}
