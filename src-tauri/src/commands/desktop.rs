use crate::application::desktop_manager::DesktopManager;
use crate::models::{CommandRunResult, DesktopOpenRequest, DesktopTerminalRequest};

#[tauri::command]
pub fn open_in_finder(request: DesktopOpenRequest) -> Result<CommandRunResult, String> {
    DesktopManager::open_in_finder(&request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_in_terminal(request: DesktopTerminalRequest) -> Result<CommandRunResult, String> {
    DesktopManager::open_in_terminal(&request).map_err(|error| error.to_string())
}
