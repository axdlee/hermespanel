use crate::application::hermes_manager::HermesManager;
use crate::models::LogReadResult;

#[tauri::command]
pub fn read_log(
    log_name: String,
    limit: Option<usize>,
    level: Option<String>,
    contains: Option<String>,
    profile: Option<String>,
) -> Result<LogReadResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| {
            manager.read_log(
                &log_name,
                limit.unwrap_or(120),
                level.as_deref(),
                contains.as_deref(),
            )
        })
        .map_err(|error| error.to_string())
}
