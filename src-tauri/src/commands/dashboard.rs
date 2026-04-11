use crate::application::hermes_manager::HermesManager;
use crate::models::DashboardSnapshot;

#[tauri::command]
pub fn get_dashboard_snapshot(profile: Option<String>) -> Result<DashboardSnapshot, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.dashboard())
        .map_err(|error| error.to_string())
}
