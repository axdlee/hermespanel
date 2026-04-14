use crate::application::hermes_manager::HermesManager;
use crate::models::{
    CommandRunResult, SkillCreateRequest, SkillDeleteRequest, SkillDeleteResult, SkillFileDetail,
    SkillFrontmatterSaveRequest, SkillImportRequest, SkillImportResult, SkillItem,
    SkillSaveRequest,
};

#[tauri::command]
pub fn list_skills(profile: Option<String>) -> Result<Vec<SkillItem>, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.skills())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_skill_file(
    file_path: String,
    profile: Option<String>,
) -> Result<SkillFileDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.read_skill_file(&file_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_skill_file(
    request: SkillSaveRequest,
    profile: Option<String>,
) -> Result<SkillFileDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_skill_file(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_skill_frontmatter(
    request: SkillFrontmatterSaveRequest,
    profile: Option<String>,
) -> Result<SkillFileDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.save_skill_frontmatter(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_skill(
    request: SkillCreateRequest,
    profile: Option<String>,
) -> Result<SkillFileDetail, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.create_skill(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn import_skill(
    request: SkillImportRequest,
    profile: Option<String>,
) -> Result<SkillImportResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.import_skill(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_local_skill(
    request: SkillDeleteRequest,
    profile: Option<String>,
) -> Result<SkillDeleteResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.delete_local_skill(&request))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_skill_action(
    action: String,
    value: Option<String>,
    profile: Option<String>,
) -> Result<CommandRunResult, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.run_skill_action(&action, value.as_deref()))
        .map_err(|error| error.to_string())
}
