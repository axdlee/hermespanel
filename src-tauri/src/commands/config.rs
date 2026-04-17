use crate::application::hermes_manager::HermesManager;
use crate::models::{
    CommandRunResult, ConfigDocuments, ConfigWorkspace, EnvWorkspace, GatewayWorkspace,
};

#[tauri::command]
pub fn get_config_documents(profile: Option<String>) -> Result<ConfigDocuments, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.config_documents())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_config_yaml(content: String, profile: Option<String>) -> Result<(), String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_config_yaml(&content))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_env_file(content: String, profile: Option<String>) -> Result<(), String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_env_file(&content))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_structured_config(
    request: ConfigWorkspace,
    profile: Option<String>,
) -> Result<ConfigDocuments, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_structured_config(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_structured_env(
    request: EnvWorkspace,
    profile: Option<String>,
) -> Result<ConfigDocuments, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_structured_env(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_structured_gateway(
    request: GatewayWorkspace,
    profile: Option<String>,
) -> Result<ConfigDocuments, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_structured_gateway(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_config_compat_action(
    action: String,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_config_compat_action(&action))
        .map_err(|error| error.to_string())
}
