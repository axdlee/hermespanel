use crate::application::hermes_manager::HermesManager;
use crate::models::{
    CommandRunResult, ProfileAliasCreateRequest, ProfileAliasDeleteRequest, ProfileCreateRequest,
    ProfileDeleteRequest, ProfileExportRequest, ProfileImportRequest, ProfileRenameRequest,
    ProfilesSnapshot,
};

#[tauri::command]
pub fn get_profiles_snapshot() -> Result<ProfilesSnapshot, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.profiles_snapshot())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_active_profile(profile_name: String) -> Result<ProfilesSnapshot, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.set_active_profile(&profile_name))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_profile(request: ProfileCreateRequest) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.create_profile(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_profile_alias(
    request: ProfileAliasCreateRequest,
) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.create_profile_alias(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_profile(request: ProfileRenameRequest) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.rename_profile(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_profile(request: ProfileExportRequest) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.export_profile(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn import_profile(request: ProfileImportRequest) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.import_profile(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_profile(request: ProfileDeleteRequest) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.delete_profile(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_profile_alias(
    request: ProfileAliasDeleteRequest,
) -> Result<CommandRunResult, String> {
    HermesManager::new(None)
        .and_then(|manager| manager.delete_profile_alias(&request))
        .map_err(|error| error.to_string())
}
