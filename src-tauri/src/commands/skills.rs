use crate::application::hermes_manager::HermesManager;
use crate::models::SkillItem;

#[tauri::command]
pub fn list_skills(profile: Option<String>) -> Result<Vec<SkillItem>, String> {
    HermesManager::new(profile.as_deref())
        .and_then(|manager| manager.skills())
        .map_err(|error| error.to_string())
}
