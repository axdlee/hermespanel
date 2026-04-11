use crate::application::hermes_manager::HermesManager;
use crate::models::{
    CommandRunResult, CronCreateRequest, CronDeleteRequest, CronJobsSnapshot, CronUpdateRequest,
};

#[tauri::command]
pub fn get_cron_jobs(profile: Option<String>) -> Result<CronJobsSnapshot, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.cron_jobs())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_cron_action(
    action: String,
    job_id: String,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_cron_action(&action, &job_id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_cron_job(
    request: CronCreateRequest,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.create_cron_job(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_cron_job(
    request: CronUpdateRequest,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.update_cron_job(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_cron_job(
    request: CronDeleteRequest,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.delete_cron_job(&request))
        .map_err(|error| error.to_string())
}
