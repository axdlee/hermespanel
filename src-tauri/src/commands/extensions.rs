use crate::application::hermes_manager::HermesManager;
use crate::models::{CommandRunResult, ExtensionsSnapshot, PluginImportRequest, PluginImportResult};

#[tauri::command]
pub fn get_extensions_snapshot(profile: Option<String>) -> Result<ExtensionsSnapshot, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.extensions_snapshot())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_tool_action(
    action: String,
    platform: String,
    names: Vec<String>,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_tool_action(&action, &platform, &names))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_plugin_action(
    action: String,
    name: String,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_plugin_action(&action, &name))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn import_plugin(
    request: PluginImportRequest,
    profile: Option<String>,
) -> Result<PluginImportResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.import_plugin(&request))
        .map_err(|error| error.to_string())
}
