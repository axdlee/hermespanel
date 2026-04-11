use crate::error::AppResult;
use crate::infrastructure::desktop;
use crate::models::{CommandRunResult, DesktopOpenRequest};

pub struct DesktopManager;

impl DesktopManager {
    pub fn open_in_finder(request: &DesktopOpenRequest) -> AppResult<CommandRunResult> {
        desktop::open_in_finder(request)
    }
}
