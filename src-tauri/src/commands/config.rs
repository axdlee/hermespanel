use crate::application::hermes_manager::HermesManager;
use crate::models::ConfigDocuments;

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
