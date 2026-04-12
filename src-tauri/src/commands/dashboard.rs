use crate::application::hermes_manager::HermesManager;
use crate::models::{DashboardSnapshot, InstallationSnapshot};

#[tauri::command]
pub fn get_dashboard_snapshot(profile: Option<String>) -> Result<DashboardSnapshot, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.dashboard())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_installation_snapshot(profile: Option<String>) -> Result<InstallationSnapshot, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.installation_snapshot())
        .map_err(|error| error.to_string())
}
