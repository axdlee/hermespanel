use crate::application::hermes_manager::HermesManager;
use crate::models::{
    CommandRunResult, ExtensionsSnapshot, PluginCreateRequest, PluginCreateResult,
    PluginDeleteRequest, PluginDeleteResult, PluginImportRequest, PluginImportResult,
    PluginManifestDetail, PluginManifestSaveRequest, PluginReadmeDetail,
    PluginReadmeSaveRequest,
};

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

#[tauri::command]
pub fn create_plugin(
    request: PluginCreateRequest,
    profile: Option<String>,
) -> Result<PluginCreateResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.create_plugin(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_plugin_manifest(
    manifest_path: String,
    profile: Option<String>,
) -> Result<PluginManifestDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.read_plugin_manifest(&manifest_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_plugin_manifest(
    request: PluginManifestSaveRequest,
    profile: Option<String>,
) -> Result<PluginManifestDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_plugin_manifest(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_plugin_readme(
    directory_path: String,
    profile: Option<String>,
) -> Result<PluginReadmeDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.read_plugin_readme(&directory_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_plugin_readme(
    request: PluginReadmeSaveRequest,
    profile: Option<String>,
) -> Result<PluginReadmeDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_plugin_readme(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_local_plugin(
    request: PluginDeleteRequest,
    profile: Option<String>,
) -> Result<PluginDeleteResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.delete_local_plugin(&request))
        .map_err(|error| error.to_string())
}
