use crate::application::hermes_manager::HermesManager;
use crate::models::{MemoryFileDetail, MemoryFileSummary};

#[tauri::command]
pub fn list_memory_files(profile: Option<String>) -> Result<Vec<MemoryFileSummary>, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.memory_files())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_memory_file(key: String, profile: Option<String>) -> Result<MemoryFileDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.memory_file(&key))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_memory_file(
    key: String,
    content: String,
    profile: Option<String>,
) -> Result<(), String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_memory_file(&key, &content))
        .map_err(|error| error.to_string())
}
