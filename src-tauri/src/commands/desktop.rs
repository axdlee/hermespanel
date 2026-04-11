use crate::application::desktop_manager::DesktopManager;
use crate::models::{CommandRunResult, DesktopOpenRequest};

#[tauri::command]
pub fn open_in_finder(request: DesktopOpenRequest) -> Result<CommandRunResult, String> {
    DesktopManager::open_in_finder(&request).map_err(|error| error.to_string())
}
