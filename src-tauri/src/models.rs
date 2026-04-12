use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HermesHome {
    pub profile_name: String,
    pub root: PathBuf,
    pub config_yaml: PathBuf,
    pub env_file: PathBuf,
    pub state_db: PathBuf,
    pub gateway_state: PathBuf,
    pub skills_dir: PathBuf,
    pub logs_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GatewayPlatformState {
    pub name: String,
    pub state: String,
    pub updated_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStateSnapshot {
    pub pid: Option<u32>,
    pub gateway_state: String,
    pub exit_reason: Option<String>,
    pub restart_requested: bool,
    pub active_agents: u32,
    pub updated_at: Option<String>,
    pub platforms: Vec<GatewayPlatformState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    pub category: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub title: Option<String>,
    pub source: String,
    pub model: Option<String>,
    pub started_at: f64,
    pub ended_at: Option<f64>,
    pub message_count: i64,
    pub tool_call_count: i64,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    pub model_default: Option<String>,
    pub model_provider: Option<String>,
    pub model_base_url: Option<String>,
    pub terminal_backend: Option<String>,
    pub terminal_cwd: Option<String>,
    pub context_engine: Option<String>,
    pub toolsets: Vec<String>,
    pub personality: Option<String>,
    pub memory_enabled: Option<bool>,
    pub user_profile_enabled: Option<bool>,
    pub memory_provider: Option<String>,
    pub memory_char_limit: Option<i64>,
    pub user_char_limit: Option<i64>,
    pub streaming_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDocuments {
    pub hermes_home: String,
    pub config_path: String,
    pub env_path: String,
    pub config_yaml: String,
    pub env_file: String,
    pub summary: ConfigSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NamedCount {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPlatformSummary {
    pub name: String,
    pub enabled_count: usize,
    pub total_count: usize,
    pub enabled_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRuntimeItem {
    pub name: String,
    pub enabled: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPlatformInventory {
    pub platform_key: String,
    pub display_name: String,
    pub items: Vec<ToolRuntimeItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProviderOption {
    pub name: String,
    pub availability: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuntimeSnapshot {
    pub built_in_status: String,
    pub provider: String,
    pub installed_plugins: Vec<MemoryProviderOption>,
    pub raw_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkillItem {
    pub name: String,
    pub category: String,
    pub source: String,
    pub trust: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRuntimeSnapshot {
    pub installed_count: usize,
    pub items: Vec<String>,
    pub install_hint: Option<String>,
    pub raw_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsSnapshot {
    pub profile_name: String,
    pub hermes_home: String,
    pub tool_platforms: Vec<ToolPlatformSummary>,
    pub tool_inventory: Vec<ToolPlatformInventory>,
    pub tools_raw_output: String,
    pub memory_runtime: MemoryRuntimeSnapshot,
    pub runtime_skills: Vec<RuntimeSkillItem>,
    pub skills_raw_output: String,
    pub skill_source_counts: Vec<NamedCount>,
    pub skill_trust_counts: Vec<NamedCount>,
    pub plugins: PluginRuntimeSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCounts {
    pub sessions: usize,
    pub skills: usize,
    pub log_files: usize,
    pub cron_jobs: usize,
    pub configured_platforms: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFileSummary {
    pub key: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFileDetail {
    pub key: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillItem {
    pub name: String,
    pub description: String,
    pub category: String,
    pub relative_path: String,
    pub file_path: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: SessionRecord,
    pub messages: Vec<SessionMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogReadResult {
    pub name: String,
    pub file_path: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunResult {
    pub command: String,
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallationSnapshot {
    pub profile_name: String,
    pub hermes_home: String,
    pub hermes_home_exists: bool,
    pub config_exists: bool,
    pub env_exists: bool,
    pub state_db_exists: bool,
    pub gateway_state_exists: bool,
    pub logs_dir_exists: bool,
    pub binary_found: bool,
    pub hermes_binary: Option<String>,
    pub version_output: String,
    pub dependencies: Vec<BinaryStatus>,
    pub quick_install_command: String,
    pub update_command: String,
    pub uninstall_command: String,
    pub setup_command: String,
    pub model_command: String,
    pub terminal_setup_command: String,
    pub tools_setup_command: String,
    pub gateway_install_command: String,
    pub gateway_uninstall_command: String,
    pub gateway_setup_command: String,
    pub config_migrate_command: String,
    pub skills_config_command: String,
    pub claw_migrate_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub profile_name: String,
    pub hermes_home: String,
    pub hermes_binary: String,
    pub binary_found: bool,
    pub version_output: String,
    pub config: ConfigSummary,
    pub gateway: Option<GatewayStateSnapshot>,
    pub counts: DashboardCounts,
    pub recent_sessions: Vec<SessionRecord>,
    pub memory_files: Vec<MemoryFileSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAliasItem {
    pub name: String,
    pub path: String,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub name: String,
    pub home_path: String,
    pub is_default: bool,
    pub is_active: bool,
    pub model_default: Option<String>,
    pub gateway_state: Option<String>,
    pub session_count: usize,
    pub skill_count: usize,
    pub env_exists: bool,
    pub soul_exists: bool,
    pub alias_path: Option<String>,
    pub aliases: Vec<ProfileAliasItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesSnapshot {
    pub active_profile: String,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCreateRequest {
    pub profile_name: String,
    pub clone: bool,
    pub clone_all: bool,
    pub clone_from: Option<String>,
    pub no_alias: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRenameRequest {
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileExportRequest {
    pub profile_name: String,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileImportRequest {
    pub archive: String,
    pub import_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDeleteRequest {
    pub profile_name: String,
    pub confirm_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAliasCreateRequest {
    pub profile_name: String,
    pub alias_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAliasDeleteRequest {
    pub profile_name: String,
    pub alias_name: String,
    pub confirm_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CronJobItem {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub schedule_display: String,
    pub schedule_input: String,
    pub state: String,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub deliver: String,
    pub skills: Vec<String>,
    pub enabled: bool,
    pub repeat_times: Option<i64>,
    pub repeat_completed: i64,
    pub script: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_delivery_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CronJobsSnapshot {
    pub jobs_path: String,
    pub updated_at: Option<String>,
    pub jobs: Vec<CronJobItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CronCreateRequest {
    pub schedule: String,
    pub prompt: Option<String>,
    pub name: Option<String>,
    pub deliver: Option<String>,
    pub repeat: Option<i64>,
    pub skills: Vec<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CronUpdateRequest {
    pub job_id: String,
    pub schedule: Option<String>,
    pub prompt: Option<String>,
    pub name: Option<String>,
    pub deliver: Option<String>,
    pub repeat: Option<i64>,
    pub skills: Option<Vec<String>>,
    pub clear_skills: bool,
    pub script: Option<String>,
    pub clear_script: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CronDeleteRequest {
    pub job_id: String,
    pub confirm_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOpenRequest {
    pub path: String,
    pub reveal_in_finder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTerminalRequest {
    pub command: String,
    pub working_directory: Option<String>,
}
