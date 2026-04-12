use crate::application::hermes_manager::HermesManager;
use crate::models::CommandRunResult;

#[tauri::command]
pub fn run_gateway_action(
    action: String,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_gateway_action(&action))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_diagnostic(kind: String, profile: Option<String>) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_diagnostic(&kind))
        .map_err(|error| error.to_string())
}
