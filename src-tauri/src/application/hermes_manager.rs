use crate::error::AppResult;
use crate::infrastructure::hermes;
use crate::models::{
    CommandRunResult, ConfigDocuments, CronCreateRequest, CronDeleteRequest, CronJobsSnapshot,
    CronUpdateRequest, DashboardSnapshot, HermesHome, LogReadResult, MemoryFileDetail,
    MemoryFileSummary, ProfileCreateRequest, ProfileDeleteRequest, ProfileExportRequest,
    ProfileImportRequest, ProfileRenameRequest, ProfilesSnapshot, SessionDetail, SessionRecord,
    SkillItem,
};

pub struct HermesManager {
    home: HermesHome,
}

impl HermesManager {
    pub fn new(profile_name: Option<&str>) -> AppResult<Self> {
        Ok(Self {
            home: hermes::resolve_hermes_home(profile_name, None)?,
        })
    }

    pub fn dashboard(&self) -> AppResult<DashboardSnapshot> {
        hermes::read_dashboard_snapshot(&self.home)
    }

    pub fn config_documents(&self) -> AppResult<ConfigDocuments> {
        hermes::read_config_documents(&self.home)
    }

    pub fn save_config_yaml(&self, content: &str) -> AppResult<()> {
        hermes::write_config_yaml(&self.home, content)
    }

    pub fn save_env_file(&self, content: &str) -> AppResult<()> {
        hermes::write_env_file(&self.home, content)
    }

    pub fn sessions(&self, limit: usize) -> AppResult<Vec<SessionRecord>> {
        hermes::load_recent_sessions(&self.home.state_db, limit)
    }

    pub fn session_detail(&self, session_id: &str) -> AppResult<SessionDetail> {
        hermes::get_session_detail(&self.home.state_db, session_id)
    }

    pub fn skills(&self) -> AppResult<Vec<SkillItem>> {
        hermes::list_skills(&self.home)
    }

    pub fn read_log(
        &self,
        log_name: &str,
        limit: usize,
        level: Option<&str>,
        contains: Option<&str>,
    ) -> AppResult<LogReadResult> {
        hermes::read_log_tail(&self.home, log_name, limit, level, contains)
    }

    pub fn memory_files(&self) -> AppResult<Vec<MemoryFileSummary>> {
        hermes::list_memory_files(&self.home)
    }

    pub fn memory_file(&self, key: &str) -> AppResult<MemoryFileDetail> {
        hermes::read_memory_file(&self.home, key)
    }

    pub fn save_memory_file(&self, key: &str, content: &str) -> AppResult<()> {
        hermes::write_memory_file(&self.home, key, content)
    }

    pub fn profiles_snapshot(&self) -> AppResult<ProfilesSnapshot> {
        hermes::list_profiles(None)
    }

    pub fn set_active_profile(&self, profile_name: &str) -> AppResult<ProfilesSnapshot> {
        hermes::set_active_profile(profile_name, None)?;
        hermes::list_profiles(None)
    }

    pub fn create_profile(&self, request: &ProfileCreateRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_create_args(request)?;
        hermes::run_hermes_command_owned(None, &args)
    }

    pub fn rename_profile(&self, request: &ProfileRenameRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_rename_args(request)?;
        hermes::run_hermes_command_owned(None, &args)
    }

    pub fn export_profile(&self, request: &ProfileExportRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_export_args(request)?;
        hermes::run_hermes_command_owned(None, &args)
    }

    pub fn import_profile(&self, request: &ProfileImportRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_import_args(request)?;
        hermes::run_hermes_command_owned(None, &args)
    }

    pub fn delete_profile(&self, request: &ProfileDeleteRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_delete_args(request)?;
        hermes::run_hermes_command_owned(None, &args)
    }

    pub fn cron_jobs(&self) -> AppResult<CronJobsSnapshot> {
        hermes::read_cron_jobs(&self.home)
    }

    pub fn run_cron_action(&self, action: &str, job_id: &str) -> AppResult<CommandRunResult> {
        match action {
            "pause" | "resume" | "run" => hermes::run_hermes_command(
                Some(&self.home.profile_name),
                &["cron", action, job_id],
            ),
            other => Err(crate::error::AppError::Message(format!(
                "不支持的 cron 操作: {other}"
            ))),
        }
    }

    pub fn create_cron_job(&self, request: &CronCreateRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_cron_create_args(request)?;
        hermes::run_hermes_command_owned(Some(&self.home.profile_name), &args)
    }

    pub fn update_cron_job(&self, request: &CronUpdateRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_cron_update_args(request)?;
        hermes::run_hermes_command_owned(Some(&self.home.profile_name), &args)
    }

    pub fn delete_cron_job(&self, request: &CronDeleteRequest) -> AppResult<CommandRunResult> {
        let args = hermes::build_cron_delete_args(request)?;
        hermes::run_hermes_command_owned(Some(&self.home.profile_name), &args)
    }

    pub fn run_gateway_action(&self, action: &str) -> AppResult<CommandRunResult> {
        hermes::run_hermes_command(Some(&self.home.profile_name), &["gateway", action])
    }

    pub fn run_diagnostic(&self, kind: &str) -> AppResult<CommandRunResult> {
        match kind {
            "version" => hermes::run_hermes_command(Some(&self.home.profile_name), &["version"]),
            "status" => {
                hermes::run_hermes_command(Some(&self.home.profile_name), &["status", "--all"])
            }
            "gateway-status" => {
                hermes::run_hermes_command(Some(&self.home.profile_name), &["gateway", "status"])
            }
            "dump" => hermes::run_hermes_command(Some(&self.home.profile_name), &["dump"]),
            "doctor" => hermes::run_hermes_command(Some(&self.home.profile_name), &["doctor"]),
            other => hermes::run_hermes_command(Some(&self.home.profile_name), &[other]),
        }
    }
}
