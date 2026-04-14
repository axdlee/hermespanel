use crate::error::{AppError, AppResult};
use crate::infrastructure::hermes;
use crate::models::{
    CommandRunResult, ConfigDocuments, ConfigWorkspace, CronCreateRequest, CronDeleteRequest,
    CronJobsSnapshot, CronUpdateRequest, DashboardSnapshot, EnvWorkspace, ExtensionsSnapshot,
    GatewayWorkspace, HermesHome, InstallationSnapshot, LogReadResult, MemoryFileDetail,
    MemoryFileSummary, PluginCreateRequest, PluginCreateResult, PluginImportRequest,
    PluginImportResult, PluginManifestDetail, PluginManifestSaveRequest, PluginReadmeDetail,
    PluginReadmeSaveRequest, PluginDeleteRequest, PluginDeleteResult,
    ProfileAliasCreateRequest, ProfileAliasDeleteRequest, ProfileCreateRequest,
    ProfileDeleteRequest, ProfileExportRequest, ProfileImportRequest, ProfileRenameRequest,
    ProfilesSnapshot, SessionDetail, SessionRecord, SkillCreateRequest, SkillFileDetail,
    SkillDeleteRequest, SkillDeleteResult, SkillFrontmatterSaveRequest, SkillImportRequest,
    SkillImportResult, SkillItem, SkillSaveRequest,
};

pub struct HermesManager {
    home: HermesHome,
}

fn diagnostic_command_args(kind: &str) -> AppResult<&'static [&'static str]> {
    match kind {
        "version" => Ok(&["version"]),
        "status" => Ok(&["status", "--all"]),
        "status-deep" => Ok(&["status", "--deep"]),
        "gateway-status" => Ok(&["gateway", "status"]),
        "gateway-status-deep" => Ok(&["gateway", "status", "--deep"]),
        "dump" => Ok(&["dump"]),
        "doctor" => Ok(&["doctor"]),
        "config-check" => Ok(&["config", "check"]),
        "tools-summary" => Ok(&["tools", "--summary"]),
        "plugins-list" => Ok(&["plugins", "list"]),
        "memory-status" => Ok(&["memory", "status"]),
        "skills-list" => Ok(&["skills", "list"]),
        other => Err(AppError::Message(format!("不支持的诊断命令: {other}"))),
    }
}

impl HermesManager {
    pub fn new(profile_name: Option<&str>) -> AppResult<Self> {
        Ok(Self {
            home: hermes::resolve_hermes_home(profile_name, None)?,
        })
    }

    pub fn run_installation_action(action: &str) -> AppResult<CommandRunResult> {
        hermes::run_installation_action(action)
    }

    pub fn run_config_compat_action(&self, action: &str) -> AppResult<CommandRunResult> {
        hermes::run_config_compat_action(Some(&self.home.profile_name), action)
    }

    pub fn dashboard(&self) -> AppResult<DashboardSnapshot> {
        hermes::read_dashboard_snapshot(&self.home)
    }

    pub fn installation_snapshot(&self) -> AppResult<InstallationSnapshot> {
        hermes::read_installation_snapshot(&self.home)
    }

    pub fn config_documents(&self) -> AppResult<ConfigDocuments> {
        hermes::read_config_documents(&self.home)
    }

    pub fn extensions_snapshot(&self) -> AppResult<ExtensionsSnapshot> {
        hermes::read_extensions_snapshot(&self.home)
    }

    pub fn run_tool_action(
        &self,
        action: &str,
        platform: &str,
        names: &[String],
    ) -> AppResult<CommandRunResult> {
        let args = hermes::build_tool_action_args(action, platform, names)?;
        hermes::run_hermes_command_owned(Some(&self.home.profile_name), &args)
    }

    pub fn run_plugin_action(&self, action: &str, name: &str) -> AppResult<CommandRunResult> {
        let args = hermes::build_plugin_action_args(action, name)?;
        hermes::run_hermes_command_owned(Some(&self.home.profile_name), &args)
    }

    pub fn import_plugin(&self, request: &PluginImportRequest) -> AppResult<PluginImportResult> {
        hermes::import_plugin(&self.home, request)
    }

    pub fn create_plugin(&self, request: &PluginCreateRequest) -> AppResult<PluginCreateResult> {
        hermes::create_plugin(&self.home, request)
    }

    pub fn read_plugin_manifest(&self, manifest_path: &str) -> AppResult<PluginManifestDetail> {
        hermes::read_plugin_manifest(&self.home, manifest_path)
    }

    pub fn save_plugin_manifest(
        &self,
        request: &PluginManifestSaveRequest,
    ) -> AppResult<PluginManifestDetail> {
        hermes::write_plugin_manifest(&self.home, request)
    }

    pub fn read_plugin_readme(&self, directory_path: &str) -> AppResult<PluginReadmeDetail> {
        hermes::read_plugin_readme(&self.home, directory_path)
    }

    pub fn save_plugin_readme(
        &self,
        request: &PluginReadmeSaveRequest,
    ) -> AppResult<PluginReadmeDetail> {
        hermes::write_plugin_readme(&self.home, request)
    }

    pub fn delete_local_plugin(
        &self,
        request: &PluginDeleteRequest,
    ) -> AppResult<PluginDeleteResult> {
        hermes::delete_local_plugin(&self.home, request)
    }

    pub fn run_skill_action(
        &self,
        action: &str,
        value: Option<&str>,
    ) -> AppResult<CommandRunResult> {
        let args = hermes::build_skill_action_args(action, value)?;
        hermes::run_hermes_command_owned(Some(&self.home.profile_name), &args)
    }

    pub fn save_config_yaml(&self, content: &str) -> AppResult<()> {
        hermes::write_config_yaml(&self.home, content)
    }

    pub fn save_env_file(&self, content: &str) -> AppResult<()> {
        hermes::write_env_file(&self.home, content)
    }

    pub fn save_structured_config(
        &self,
        workspace: &ConfigWorkspace,
    ) -> AppResult<ConfigDocuments> {
        hermes::write_structured_config(&self.home, workspace)
    }

    pub fn save_structured_env(&self, workspace: &EnvWorkspace) -> AppResult<ConfigDocuments> {
        hermes::write_structured_env(&self.home, workspace)
    }

    pub fn save_structured_gateway(
        &self,
        workspace: &GatewayWorkspace,
    ) -> AppResult<ConfigDocuments> {
        hermes::write_structured_gateway(&self.home, workspace)
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

    pub fn read_skill_file(&self, file_path: &str) -> AppResult<SkillFileDetail> {
        hermes::read_skill_file(&self.home, file_path)
    }

    pub fn save_skill_file(&self, request: &SkillSaveRequest) -> AppResult<SkillFileDetail> {
        hermes::write_skill_file(&self.home, &request.file_path, &request.content)
    }

    pub fn save_skill_frontmatter(
        &self,
        request: &SkillFrontmatterSaveRequest,
    ) -> AppResult<SkillFileDetail> {
        hermes::write_skill_frontmatter(&self.home, request)
    }

    pub fn create_skill(&self, request: &SkillCreateRequest) -> AppResult<SkillFileDetail> {
        hermes::create_skill_file(&self.home, request)
    }

    pub fn import_skill(&self, request: &SkillImportRequest) -> AppResult<SkillImportResult> {
        hermes::import_skill(&self.home, request)
    }

    pub fn delete_local_skill(
        &self,
        request: &SkillDeleteRequest,
    ) -> AppResult<SkillDeleteResult> {
        hermes::delete_local_skill(&self.home, request)
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

    pub fn create_profile_alias(
        &self,
        request: &ProfileAliasCreateRequest,
    ) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_alias_create_args(request)?;
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

    pub fn delete_profile_alias(
        &self,
        request: &ProfileAliasDeleteRequest,
    ) -> AppResult<CommandRunResult> {
        let args = hermes::build_profile_alias_delete_args(request)?;
        hermes::run_hermes_command_owned(None, &args)
    }

    pub fn cron_jobs(&self) -> AppResult<CronJobsSnapshot> {
        hermes::read_cron_jobs(&self.home)
    }

    pub fn run_cron_action(&self, action: &str, job_id: &str) -> AppResult<CommandRunResult> {
        match action {
            "pause" | "resume" | "run" => {
                hermes::run_hermes_command(Some(&self.home.profile_name), &["cron", action, job_id])
            }
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
        let args = diagnostic_command_args(kind)?;
        match kind {
            "tools-summary" => {
                hermes::run_hermes_command_with_tty(Some(&self.home.profile_name), args)
            }
            _ => hermes::run_hermes_command(Some(&self.home.profile_name), args),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::diagnostic_command_args;

    #[test]
    fn maps_supported_diagnostic_commands() {
        assert_eq!(
            diagnostic_command_args("config-check").expect("应映射 config-check"),
            ["config", "check"]
        );
        assert_eq!(
            diagnostic_command_args("tools-summary").expect("应映射 tools-summary"),
            ["tools", "--summary"]
        );
        assert_eq!(
            diagnostic_command_args("gateway-status-deep").expect("应映射 gateway-status-deep"),
            ["gateway", "status", "--deep"]
        );
        assert_eq!(
            diagnostic_command_args("skills-list").expect("应映射 skills-list"),
            ["skills", "list"]
        );
    }

    #[test]
    fn rejects_unknown_diagnostic_commands() {
        assert!(diagnostic_command_args("plugins").is_err());
    }
}
