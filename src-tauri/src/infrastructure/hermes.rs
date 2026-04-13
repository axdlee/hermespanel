use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use chrono::{DateTime, Local};
use regex::Regex;
use rusqlite::Connection;
use serde::Deserialize;
use serde_yaml::Value;
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::models::{
    BinaryStatus, CommandRunResult, ConfigDocuments, ConfigSummary, ConfigWorkspace,
    CronCreateRequest, CronDeleteRequest, CronJobItem, CronJobsSnapshot, CronUpdateRequest,
    DashboardCounts, DashboardSnapshot, EnvWorkspace, ExtensionsSnapshot, GatewayPlatformState,
    GatewayStateSnapshot, GatewayWorkspace, HermesHome, InstallationSnapshot, LogReadResult,
    MemoryFileDetail, MemoryFileSummary, MemoryProviderOption, MemoryRuntimeSnapshot, NamedCount,
    PlatformToolsetBinding, PluginCatalogItem, PluginExternalDependency, PluginRuntimeSnapshot,
    ProfileAliasCreateRequest, ProfileAliasDeleteRequest, ProfileAliasItem, ProfileCreateRequest,
    ProfileDeleteRequest, ProfileExportRequest, ProfileImportRequest, ProfileRenameRequest,
    ProfileSummary, ProfilesSnapshot, RuntimeSkillItem, SessionDetail, SessionMessage,
    SessionRecord, SkillCreateRequest, SkillFileDetail, SkillFrontmatter, SkillItem,
    ToolPlatformInventory, ToolPlatformSummary, ToolRuntimeItem,
};

const QUICK_INSTALL_COMMAND: &str =
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash";
const UPDATE_COMMAND: &str = "hermes update";
const UNINSTALL_COMMAND: &str = "hermes uninstall";
const SETUP_COMMAND: &str = "hermes setup";
const MODEL_COMMAND: &str = "hermes model";
const TERMINAL_SETUP_COMMAND: &str = "hermes setup terminal";
const TOOLS_SETUP_COMMAND: &str = "hermes setup tools";
const GATEWAY_INSTALL_COMMAND: &str = "hermes gateway install";
const GATEWAY_UNINSTALL_COMMAND: &str = "hermes gateway uninstall";
const GATEWAY_SETUP_COMMAND: &str = "hermes gateway setup";
const CONFIG_MIGRATE_COMMAND: &str = "hermes config migrate";
const SKILLS_CONFIG_COMMAND: &str = "hermes skills config";
const CLAW_MIGRATE_COMMAND: &str = "hermes claw migrate";

#[derive(Debug, Clone, PartialEq, Eq)]
enum InstallationActionCommand {
    Hermes(Vec<String>),
    Shell(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EnvLine {
    Entry {
        key: String,
        value: String,
        raw: String,
    },
    Raw(String),
}

#[derive(Debug, Default, Deserialize)]
struct RawPluginManifest {
    name: Option<String>,
    description: Option<String>,
    pip_dependencies: Option<Vec<String>>,
    requires_env: Option<Vec<String>>,
    external_dependencies: Option<Vec<RawPluginExternalDependency>>,
}

#[derive(Debug, Default, Deserialize)]
struct RawPluginExternalDependency {
    name: Option<String>,
    install: Option<String>,
    check: Option<String>,
}

pub fn resolve_default_hermes_root(explicit_root: Option<&Path>) -> AppResult<PathBuf> {
    explicit_root
        .map(Path::to_path_buf)
        .or_else(|| std::env::var_os("HERMES_HOME").map(PathBuf::from))
        .or_else(|| dirs::home_dir().map(|path| path.join(".hermes")))
        .ok_or_else(|| AppError::Message("无法定位 Hermes Home".into()))
}

pub fn get_active_profile(explicit_root: Option<&Path>) -> AppResult<String> {
    let default_root = resolve_default_hermes_root(explicit_root)?;
    let path = default_root.join("active_profile");
    let name = fs::read_to_string(path)
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| "default".into());

    if name.is_empty() {
        Ok("default".into())
    } else {
        Ok(name)
    }
}

pub fn set_active_profile(profile_name: &str, explicit_root: Option<&Path>) -> AppResult<()> {
    let normalized = normalize_profile_name(profile_name);
    let default_root = resolve_default_hermes_root(explicit_root)?;

    if normalized != "default" {
        let profile_root = default_root.join("profiles").join(&normalized);
        if !profile_root.is_dir() {
            return Err(AppError::Message(format!(
                "Hermes profile 不存在: {normalized}"
            )));
        }
    }

    let active_path = default_root.join("active_profile");
    if normalized == "default" {
        match fs::remove_file(&active_path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        return Ok(());
    }

    if let Some(parent) = active_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = active_path.with_extension("tmp");
    fs::write(&temp_path, format!("{normalized}\n"))?;
    fs::rename(temp_path, active_path)?;
    Ok(())
}

pub fn resolve_hermes_home(
    profile_name: Option<&str>,
    explicit_root: Option<&Path>,
) -> AppResult<HermesHome> {
    let default_root = resolve_default_hermes_root(explicit_root)?;
    let effective_profile = match profile_name {
        Some(name) => normalize_profile_name(name),
        None => get_active_profile(Some(default_root.as_path()))?,
    };

    let root = resolve_profile_root(&default_root, &effective_profile)?;

    Ok(build_hermes_home(root, effective_profile))
}

pub fn list_profiles(explicit_root: Option<&Path>) -> AppResult<ProfilesSnapshot> {
    let default_root = resolve_default_hermes_root(explicit_root)?;
    let active_profile = get_active_profile(Some(default_root.as_path()))?;
    let profiles_root = default_root.join("profiles");

    let mut names = vec!["default".to_string()];
    if profiles_root.exists() {
        let mut discovered = fs::read_dir(&profiles_root)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect::<Vec<_>>();
        discovered.sort();
        names.extend(discovered);
    }

    let profiles = names
        .into_iter()
        .map(|name| build_profile_summary(&default_root, &name, active_profile.as_str()))
        .collect::<AppResult<Vec<_>>>()?;

    Ok(ProfilesSnapshot {
        active_profile,
        profiles,
    })
}

fn build_hermes_home(root: PathBuf, profile_name: String) -> HermesHome {
    HermesHome {
        profile_name,
        config_yaml: root.join("config.yaml"),
        env_file: root.join(".env"),
        gateway_state: root.join("gateway_state.json"),
        logs_dir: root.join("logs"),
        skills_dir: root.join("skills"),
        state_db: root.join("state.db"),
        root,
    }
}

fn normalize_profile_name(profile_name: &str) -> String {
    let trimmed = profile_name.trim();
    if trimmed.is_empty() {
        "default".into()
    } else {
        trimmed.to_string()
    }
}

fn resolve_profile_root(default_root: &Path, profile_name: &str) -> AppResult<PathBuf> {
    if profile_name == "default" {
        return Ok(default_root.to_path_buf());
    }

    let root = default_root.join("profiles").join(profile_name);
    if !root.is_dir() {
        return Err(AppError::Message(format!(
            "Hermes profile 不存在: {profile_name}"
        )));
    }

    Ok(root)
}

fn build_profile_summary(
    default_root: &Path,
    profile_name: &str,
    active_profile: &str,
) -> AppResult<ProfileSummary> {
    let root = if profile_name == "default" {
        default_root.to_path_buf()
    } else {
        default_root.join("profiles").join(profile_name)
    };
    let home = build_hermes_home(root, profile_name.to_string());
    let config_summary = read_text_file(&home.config_yaml)
        .ok()
        .and_then(|content| build_config_summary(&content).ok());
    let gateway_state = if home.gateway_state.exists() {
        read_gateway_state(&home.gateway_state)
            .ok()
            .map(|snapshot| snapshot.gateway_state)
    } else {
        None
    };
    let aliases = list_profile_aliases(profile_name, None).unwrap_or_default();
    let alias_path = aliases
        .iter()
        .find(|alias| alias.is_primary)
        .or_else(|| aliases.first())
        .map(|alias| alias.path.clone());

    Ok(ProfileSummary {
        name: profile_name.to_string(),
        home_path: home.root.display().to_string(),
        is_default: profile_name == "default",
        is_active: profile_name == active_profile,
        model_default: config_summary.and_then(|summary| summary.model_default),
        gateway_state,
        session_count: count_sessions(&home.state_db).unwrap_or(0),
        skill_count: list_skills(&home).unwrap_or_default().len(),
        env_exists: home.env_file.exists(),
        soul_exists: home.root.join("SOUL.md").exists(),
        alias_path,
        aliases,
    })
}

pub fn read_gateway_state(path: &Path) -> AppResult<GatewayStateSnapshot> {
    #[derive(Debug, Deserialize)]
    struct RawGatewayPlatformState {
        state: String,
        updated_at: Option<String>,
        error_message: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct RawGatewayState {
        pid: Option<u32>,
        gateway_state: Option<String>,
        exit_reason: Option<String>,
        restart_requested: Option<bool>,
        active_agents: Option<u32>,
        updated_at: Option<String>,
        platforms: Option<BTreeMap<String, RawGatewayPlatformState>>,
    }

    let raw: RawGatewayState = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let platforms = raw
        .platforms
        .unwrap_or_default()
        .into_iter()
        .map(|(name, value)| GatewayPlatformState {
            error_message: value.error_message,
            name,
            state: value.state,
            updated_at: value.updated_at,
        })
        .collect();

    Ok(GatewayStateSnapshot {
        active_agents: raw.active_agents.unwrap_or(0),
        exit_reason: raw.exit_reason,
        gateway_state: raw.gateway_state.unwrap_or_else(|| "unknown".into()),
        pid: raw.pid,
        platforms,
        restart_requested: raw.restart_requested.unwrap_or(false),
        updated_at: raw.updated_at,
    })
}

pub fn parse_skill_frontmatter(markdown: &str, relative_path: &str) -> SkillFrontmatter {
    #[derive(Debug, Default, Deserialize)]
    struct RawSkillFrontmatter {
        name: Option<String>,
        description: Option<String>,
    }

    let mut lines = markdown.lines();
    let mut frontmatter = RawSkillFrontmatter::default();

    if matches!(lines.next(), Some("---")) {
        let mut yaml_lines = Vec::new();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
            yaml_lines.push(line);
        }

        if !yaml_lines.is_empty() {
            frontmatter = serde_yaml::from_str::<RawSkillFrontmatter>(&yaml_lines.join("\n"))
                .unwrap_or_default();
        }
    }

    let category = relative_path
        .split('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("uncategorized")
        .to_string();

    let fallback_name = relative_path
        .rsplit('/')
        .nth(1)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown-skill")
        .to_string();

    SkillFrontmatter {
        category,
        description: frontmatter.description.unwrap_or_default(),
        name: frontmatter.name.unwrap_or(fallback_name),
        relative_path: relative_path.to_string(),
    }
}

pub fn load_recent_sessions(db_path: &Path, limit: usize) -> AppResult<Vec<SessionRecord>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT
          s.id,
          s.title,
          s.source,
          s.model,
          s.started_at,
          s.ended_at,
          COALESCE(s.message_count, 0) AS message_count,
          COALESCE(s.tool_call_count, 0) AS tool_call_count,
          COALESCE(
            (
              SELECT m.content
              FROM messages m
              WHERE m.session_id = s.id
                AND m.role = 'user'
                AND COALESCE(m.content, '') <> ''
              ORDER BY m.timestamp ASC, m.id ASC
              LIMIT 1
            ),
            ''
          ) AS preview
        FROM sessions s
        ORDER BY s.started_at DESC
        LIMIT ?1
        "#,
    )?;

    let rows = stmt.query_map([limit as i64], |row| {
        Ok(SessionRecord {
            ended_at: row.get(5)?,
            id: row.get(0)?,
            message_count: row.get(6)?,
            model: row.get(3)?,
            preview: row.get(8)?,
            source: row.get(2)?,
            started_at: row.get(4)?,
            title: row.get(1)?,
            tool_call_count: row.get(7)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn find_command_binary(name: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|dir| dir.join(name)));
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join(name));
    }

    candidates.into_iter().find(|path| path.exists())
}

pub fn probe_hermes_binary() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("HERMES_BINARY") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Some(path);
        }
    }

    find_command_binary("hermes")
}

pub fn find_hermes_binary() -> AppResult<PathBuf> {
    probe_hermes_binary().ok_or_else(|| AppError::Message("未找到 hermes 可执行文件".into()))
}

fn compose_hermes_command_args<S>(
    profile_name: Option<&str>,
    args: impl IntoIterator<Item = S>,
) -> Vec<String>
where
    S: AsRef<str>,
{
    let mut command_args = Vec::new();
    if let Some(profile) = profile_name {
        command_args.push("-p".to_string());
        command_args.push(normalize_profile_name(profile));
    }
    command_args.extend(args.into_iter().map(|item| item.as_ref().to_string()));
    command_args
}

pub fn run_hermes_command(
    profile_name: Option<&str>,
    args: &[&str],
) -> AppResult<CommandRunResult> {
    let hermes = find_hermes_binary()?;
    let command_args = compose_hermes_command_args(profile_name, args);
    let output = Command::new(&hermes).args(&command_args).output()?;
    Ok(command_result_from_output(&hermes, &command_args, output))
}

pub fn run_hermes_command_with_tty(
    profile_name: Option<&str>,
    args: &[&str],
) -> AppResult<CommandRunResult> {
    let hermes = find_hermes_binary()?;
    let command_args = compose_hermes_command_args(profile_name, args);
    let output = run_process_with_tty(&hermes, &command_args)?;
    Ok(command_result_from_output(&hermes, &command_args, output))
}

pub fn run_hermes_command_owned(
    profile_name: Option<&str>,
    args: &[String],
) -> AppResult<CommandRunResult> {
    let hermes = find_hermes_binary()?;
    let command_args = compose_hermes_command_args(profile_name, args.iter().map(String::as_str));
    let output = Command::new(&hermes).args(&command_args).output()?;
    Ok(command_result_from_output(&hermes, &command_args, output))
}

fn installation_action_command(action: &str) -> AppResult<InstallationActionCommand> {
    match action {
        "install" | "reinstall" => {
            Ok(InstallationActionCommand::Shell(QUICK_INSTALL_COMMAND.to_string()))
        }
        "update" => Ok(InstallationActionCommand::Hermes(vec!["update".to_string()])),
        "uninstall" => Ok(InstallationActionCommand::Hermes(vec![
            "uninstall".to_string(),
            "--yes".to_string(),
        ])),
        other => Err(AppError::Message(format!(
            "不支持的安装动作: {other}"
        ))),
    }
}

fn config_compat_action_args(action: &str) -> AppResult<Vec<String>> {
    match action {
        "config-migrate" => Ok(vec!["config".to_string(), "migrate".to_string()]),
        "claw-migrate" => Ok(vec!["claw".to_string(), "migrate".to_string()]),
        other => Err(AppError::Message(format!(
            "不支持的配置兼容动作: {other}"
        ))),
    }
}

pub fn run_installation_action(action: &str) -> AppResult<CommandRunResult> {
    match installation_action_command(action)? {
        InstallationActionCommand::Hermes(args) => run_hermes_command_owned(None, &args),
        InstallationActionCommand::Shell(command) => run_shell_command(&command, None),
    }
}

pub fn run_config_compat_action(
    profile_name: Option<&str>,
    action: &str,
) -> AppResult<CommandRunResult> {
    let args = config_compat_action_args(action)?;
    run_hermes_command_owned(profile_name, &args)
}

pub fn run_shell_command(
    command: &str,
    working_directory: Option<&Path>,
) -> AppResult<CommandRunResult> {
    let normalized = command.trim();
    if normalized.is_empty() {
        return Err(AppError::Message("shell command 不能为空".into()));
    }

    let mut shell = Command::new("/bin/bash");
    shell.arg("-lc").arg(normalized);
    if let Some(path) = working_directory {
        shell.current_dir(path);
    }
    let output = shell.output()?;

    Ok(CommandRunResult {
        command: build_shell_display_command(normalized, working_directory),
        exit_code: output.status.code().unwrap_or(-1),
        stderr: normalize_command_text(&String::from_utf8_lossy(&output.stderr)),
        stdout: normalize_command_text(&String::from_utf8_lossy(&output.stdout)),
        success: output.status.success(),
    })
}

pub fn read_config_documents(home: &HermesHome) -> AppResult<ConfigDocuments> {
    let config_yaml = read_text_file(&home.config_yaml)?;
    let env_file = read_text_file(&home.env_file)?;
    let value = if config_yaml.trim().is_empty() {
        Value::Mapping(Default::default())
    } else {
        serde_yaml::from_str::<Value>(&config_yaml)?
    };
    let summary = build_config_summary_from_value(&value);
    let workspace = build_config_workspace(&value);
    let gateway_workspace = build_gateway_workspace(&value, &env_file);
    let env_workspace = build_env_workspace(&env_file);

    Ok(ConfigDocuments {
        config_path: home.config_yaml.display().to_string(),
        config_yaml,
        env_file,
        env_path: home.env_file.display().to_string(),
        hermes_home: home.root.display().to_string(),
        summary,
        workspace,
        gateway_workspace,
        env_workspace,
    })
}

pub fn read_extensions_snapshot(home: &HermesHome) -> AppResult<ExtensionsSnapshot> {
    let tools = run_hermes_command_with_tty(Some(&home.profile_name), &["tools", "--summary"])?;
    let memory = run_hermes_command(Some(&home.profile_name), &["memory", "status"])?;
    let skills = run_hermes_command(Some(&home.profile_name), &["skills", "list"])?;
    let plugins = run_hermes_command(Some(&home.profile_name), &["plugins", "list"])?;
    let tool_platforms = parse_tool_summary(&tools.stdout);
    let tool_inventory = tool_platforms
        .iter()
        .map(|platform| {
            let platform_key = platform.name.to_lowercase();
            let result = run_hermes_command_with_tty(
                Some(&home.profile_name),
                &["tools", "list", "--platform", &platform_key],
            )?;
            Ok(parse_tool_inventory(
                &platform_key,
                &platform.name,
                &result.stdout,
            ))
        })
        .collect::<AppResult<Vec<_>>>()?;

    let runtime_skills = parse_runtime_skills(&skills.stdout);
    let skill_source_counts = count_by_name(runtime_skills.iter().map(|item| item.source.as_str()));
    let skill_trust_counts = count_by_name(runtime_skills.iter().map(|item| item.trust.as_str()));
    let plugin_runtime = parse_plugin_runtime(&plugins.stdout);
    let plugin_catalog = build_plugin_catalog(home, &plugin_runtime);

    Ok(ExtensionsSnapshot {
        profile_name: home.profile_name.clone(),
        hermes_home: home.root.display().to_string(),
        tool_platforms,
        tool_inventory,
        tools_raw_output: tools.stdout,
        memory_runtime: parse_memory_runtime(&memory.stdout),
        runtime_skills,
        skills_raw_output: skills.stdout,
        skill_source_counts,
        skill_trust_counts,
        plugins: plugin_runtime,
        plugin_catalog,
    })
}

pub fn build_tool_action_args(
    action: &str,
    platform: &str,
    names: &[String],
) -> AppResult<Vec<String>> {
    let normalized_action = action.trim();
    if normalized_action != "enable" && normalized_action != "disable" {
        return Err(AppError::Message(format!("不支持的 tools 操作: {action}")));
    }

    let normalized_platform = platform.trim();
    if normalized_platform.is_empty() {
        return Err(AppError::Message("tools platform 不能为空".into()));
    }

    let normalized_names = names
        .iter()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    if normalized_names.is_empty() {
        return Err(AppError::Message("至少要提供一个 tool 名称".into()));
    }

    let mut args = vec![
        "tools".to_string(),
        normalized_action.to_string(),
        "--platform".to_string(),
        normalized_platform.to_string(),
    ];
    args.extend(normalized_names);
    Ok(args)
}

pub fn build_plugin_action_args(action: &str, name: &str) -> AppResult<Vec<String>> {
    let normalized_action = action.trim();
    if !matches!(
        normalized_action,
        "enable" | "disable" | "install" | "update" | "remove"
    ) {
        return Err(AppError::Message(format!(
            "不支持的 plugins 操作: {action}"
        )));
    }

    let normalized_name = name.trim();
    if normalized_name.is_empty() {
        return Err(AppError::Message("plugin 名称不能为空".into()));
    }

    Ok(vec![
        "plugins".to_string(),
        normalized_action.to_string(),
        normalized_name.to_string(),
    ])
}

pub fn build_skill_action_args(action: &str, value: Option<&str>) -> AppResult<Vec<String>> {
    let normalized_action = action.trim();
    match normalized_action {
        "search" => {
            let terms = value
                .unwrap_or_default()
                .split_whitespace()
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();

            if terms.is_empty() {
                return Err(AppError::Message("skills search 关键词不能为空".into()));
            }

            let mut args = vec!["skills".to_string(), "search".to_string()];
            args.extend(terms);
            Ok(args)
        }
        "inspect" | "install" => {
            let normalized_value = value.unwrap_or_default().trim();
            if normalized_value.is_empty() {
                return Err(AppError::Message(format!(
                    "skills {normalized_action} 目标不能为空"
                )));
            }

            Ok(vec![
                "skills".to_string(),
                normalized_action.to_string(),
                normalized_value.to_string(),
            ])
        }
        "check" | "update" | "audit" => {
            Ok(vec!["skills".to_string(), normalized_action.to_string()])
        }
        other => Err(AppError::Message(format!("不支持的 skills 操作: {other}"))),
    }
}

pub fn write_config_yaml(home: &HermesHome, content: &str) -> AppResult<()> {
    serde_yaml::from_str::<Value>(content)?;
    fs::write(&home.config_yaml, content)?;
    Ok(())
}

pub fn write_env_file(home: &HermesHome, content: &str) -> AppResult<()> {
    fs::write(&home.env_file, content)?;
    Ok(())
}

pub fn build_config_summary(config_yaml: &str) -> AppResult<ConfigSummary> {
    let value = serde_yaml::from_str::<Value>(config_yaml)?;
    Ok(build_config_summary_from_value(&value))
}

fn build_config_summary_from_value(value: &Value) -> ConfigSummary {
    ConfigSummary {
        context_engine: lookup_yaml_string(value, &["context", "engine"]),
        memory_enabled: lookup_yaml_bool(value, &["memory", "memory_enabled"]),
        memory_char_limit: lookup_yaml_i64(value, &["memory", "memory_char_limit"]),
        memory_provider: lookup_yaml_string(value, &["memory", "provider"]),
        model_base_url: lookup_yaml_string(value, &["model", "base_url"]),
        model_default: lookup_yaml_string(value, &["model", "default"])
            .or_else(|| lookup_yaml_string(value, &["model"])),
        model_provider: lookup_yaml_string(value, &["model", "provider"]),
        personality: lookup_yaml_string(value, &["display", "personality"]),
        streaming_enabled: lookup_yaml_bool(value, &["display", "streaming"])
            .or_else(|| lookup_yaml_bool(value, &["streaming", "enabled"])),
        terminal_backend: lookup_yaml_string(value, &["terminal", "backend"]),
        terminal_cwd: lookup_yaml_string(value, &["terminal", "cwd"]),
        toolsets: lookup_yaml_array(value, &["toolsets"]),
        user_char_limit: lookup_yaml_i64(value, &["memory", "user_char_limit"]),
        user_profile_enabled: lookup_yaml_bool(value, &["memory", "user_profile_enabled"]),
    }
}

fn build_config_workspace(value: &Value) -> ConfigWorkspace {
    ConfigWorkspace {
        model_default: lookup_yaml_string(value, &["model", "default"]).unwrap_or_default(),
        model_provider: lookup_yaml_string(value, &["model", "provider"]).unwrap_or_default(),
        model_base_url: lookup_yaml_string(value, &["model", "base_url"]).unwrap_or_default(),
        context_engine: lookup_yaml_string(value, &["context", "engine"]).unwrap_or_default(),
        terminal_backend: lookup_yaml_string(value, &["terminal", "backend"]).unwrap_or_default(),
        terminal_cwd: lookup_yaml_string(value, &["terminal", "cwd"]).unwrap_or_default(),
        personality: lookup_yaml_string(value, &["display", "personality"]).unwrap_or_default(),
        streaming_enabled: lookup_yaml_bool(value, &["display", "streaming"])
            .or_else(|| lookup_yaml_bool(value, &["streaming", "enabled"]))
            .unwrap_or(false),
        memory_enabled: lookup_yaml_bool(value, &["memory", "memory_enabled"]).unwrap_or(false),
        user_profile_enabled: lookup_yaml_bool(value, &["memory", "user_profile_enabled"])
            .unwrap_or(false),
        memory_provider: lookup_yaml_string(value, &["memory", "provider"]).unwrap_or_default(),
        memory_char_limit: lookup_yaml_i64(value, &["memory", "memory_char_limit"]),
        user_char_limit: lookup_yaml_i64(value, &["memory", "user_char_limit"]),
        toolsets: lookup_yaml_array(value, &["toolsets"]),
        platform_toolsets: lookup_platform_toolsets(value),
        skills_external_dirs: lookup_yaml_array(value, &["skills", "external_dirs"]),
        discord_require_mention: lookup_yaml_bool(value, &["discord", "require_mention"])
            .unwrap_or(false),
        discord_free_response_channels: lookup_yaml_string(
            value,
            &["discord", "free_response_channels"],
        )
        .unwrap_or_default(),
        discord_allowed_channels: lookup_yaml_string(value, &["discord", "allowed_channels"])
            .unwrap_or_default(),
        discord_auto_thread: lookup_yaml_bool(value, &["discord", "auto_thread"]).unwrap_or(false),
        discord_reactions: lookup_yaml_bool(value, &["discord", "reactions"]).unwrap_or(false),
        approvals_mode: lookup_yaml_string(value, &["approvals", "mode"]).unwrap_or_default(),
        approvals_timeout: lookup_yaml_i64(value, &["approvals", "timeout"]),
    }
}

fn build_gateway_workspace(value: &Value, env_file: &str) -> GatewayWorkspace {
    let env = env_map(env_file);
    let reset_triggers = lookup_yaml_array(value, &["reset_triggers"]);

    GatewayWorkspace {
        hermes_gateway_token: lookup_env_string(&env, "HERMES_GATEWAY_TOKEN"),
        always_log_local: lookup_yaml_bool(value, &["always_log_local"]).unwrap_or(true),
        stt_enabled: lookup_yaml_bool(value, &["stt", "enabled"]).unwrap_or(true),
        group_sessions_per_user: lookup_yaml_bool(value, &["group_sessions_per_user"])
            .unwrap_or(true),
        thread_sessions_per_user: lookup_yaml_bool(value, &["thread_sessions_per_user"])
            .unwrap_or(false),
        unauthorized_dm_behavior: lookup_yaml_string(value, &["unauthorized_dm_behavior"])
            .unwrap_or_else(|| "pair".into()),
        reset_triggers: if reset_triggers.is_empty() {
            vec!["/new".into(), "/reset".into()]
        } else {
            reset_triggers
        },
        session_reset_mode: lookup_yaml_string(value, &["session_reset", "mode"])
            .unwrap_or_else(|| "both".into()),
        session_reset_at_hour: lookup_yaml_i64(value, &["session_reset", "at_hour"]).or(Some(4)),
        session_reset_idle_minutes: lookup_yaml_i64(value, &["session_reset", "idle_minutes"])
            .or(Some(1440)),
        session_reset_notify: lookup_yaml_bool(value, &["session_reset", "notify"]).unwrap_or(true),
    }
}

pub fn write_structured_config(
    home: &HermesHome,
    workspace: &ConfigWorkspace,
) -> AppResult<ConfigDocuments> {
    let current = read_text_file(&home.config_yaml)?;
    let mut value = if current.trim().is_empty() {
        Value::Mapping(Default::default())
    } else {
        serde_yaml::from_str::<Value>(&current)?
    };

    set_yaml_string(&mut value, &["model", "default"], &workspace.model_default);
    set_yaml_string(
        &mut value,
        &["model", "provider"],
        &workspace.model_provider,
    );
    set_yaml_string(
        &mut value,
        &["model", "base_url"],
        &workspace.model_base_url,
    );
    set_yaml_string(
        &mut value,
        &["context", "engine"],
        &workspace.context_engine,
    );
    set_yaml_string(
        &mut value,
        &["terminal", "backend"],
        &workspace.terminal_backend,
    );
    set_yaml_string(&mut value, &["terminal", "cwd"], &workspace.terminal_cwd);
    set_yaml_string(
        &mut value,
        &["display", "personality"],
        &workspace.personality,
    );
    set_yaml_bool(
        &mut value,
        &["display", "streaming"],
        workspace.streaming_enabled,
    );
    set_yaml_bool(
        &mut value,
        &["streaming", "enabled"],
        workspace.streaming_enabled,
    );
    set_yaml_bool(
        &mut value,
        &["memory", "memory_enabled"],
        workspace.memory_enabled,
    );
    set_yaml_bool(
        &mut value,
        &["memory", "user_profile_enabled"],
        workspace.user_profile_enabled,
    );
    set_yaml_string(
        &mut value,
        &["memory", "provider"],
        &workspace.memory_provider,
    );
    set_yaml_optional_i64(
        &mut value,
        &["memory", "memory_char_limit"],
        workspace.memory_char_limit,
    );
    set_yaml_optional_i64(
        &mut value,
        &["memory", "user_char_limit"],
        workspace.user_char_limit,
    );
    set_yaml_string_array(&mut value, &["toolsets"], &workspace.toolsets);
    set_yaml_string_array(
        &mut value,
        &["skills", "external_dirs"],
        &workspace.skills_external_dirs,
    );
    set_yaml_bool(
        &mut value,
        &["discord", "require_mention"],
        workspace.discord_require_mention,
    );
    set_yaml_string(
        &mut value,
        &["discord", "free_response_channels"],
        &workspace.discord_free_response_channels,
    );
    set_yaml_string(
        &mut value,
        &["discord", "allowed_channels"],
        &workspace.discord_allowed_channels,
    );
    set_yaml_bool(
        &mut value,
        &["discord", "auto_thread"],
        workspace.discord_auto_thread,
    );
    set_yaml_bool(
        &mut value,
        &["discord", "reactions"],
        workspace.discord_reactions,
    );
    set_yaml_string(
        &mut value,
        &["approvals", "mode"],
        &workspace.approvals_mode,
    );
    set_yaml_optional_i64(
        &mut value,
        &["approvals", "timeout"],
        workspace.approvals_timeout,
    );
    set_platform_toolsets(&mut value, &workspace.platform_toolsets);

    let content = serde_yaml::to_string(&value)?;
    fs::write(&home.config_yaml, content)?;
    read_config_documents(home)
}

pub fn write_structured_gateway(
    home: &HermesHome,
    workspace: &GatewayWorkspace,
) -> AppResult<ConfigDocuments> {
    let current = read_text_file(&home.config_yaml)?;
    let mut value = if current.trim().is_empty() {
        Value::Mapping(Default::default())
    } else {
        serde_yaml::from_str::<Value>(&current)?
    };

    let dm_behavior = match workspace.unauthorized_dm_behavior.trim() {
        "ignore" => "ignore",
        _ => "pair",
    };
    let reset_mode = match workspace.session_reset_mode.trim() {
        "daily" => "daily",
        "idle" => "idle",
        "none" => "none",
        _ => "both",
    };

    set_yaml_bool(
        &mut value,
        &["always_log_local"],
        workspace.always_log_local,
    );
    set_yaml_bool(&mut value, &["stt", "enabled"], workspace.stt_enabled);
    set_yaml_bool(
        &mut value,
        &["group_sessions_per_user"],
        workspace.group_sessions_per_user,
    );
    set_yaml_bool(
        &mut value,
        &["thread_sessions_per_user"],
        workspace.thread_sessions_per_user,
    );
    set_yaml_string(&mut value, &["unauthorized_dm_behavior"], dm_behavior);
    set_yaml_string_array(&mut value, &["reset_triggers"], &workspace.reset_triggers);
    set_yaml_string(&mut value, &["session_reset", "mode"], reset_mode);
    set_yaml_optional_i64(
        &mut value,
        &["session_reset", "at_hour"],
        workspace.session_reset_at_hour,
    );
    set_yaml_optional_i64(
        &mut value,
        &["session_reset", "idle_minutes"],
        workspace.session_reset_idle_minutes,
    );
    set_yaml_bool(
        &mut value,
        &["session_reset", "notify"],
        workspace.session_reset_notify,
    );

    let content = serde_yaml::to_string(&value)?;
    fs::write(&home.config_yaml, content)?;

    let current_env = read_text_file(&home.env_file)?;
    let mut env_workspace = build_env_workspace(&current_env);
    env_workspace.hermes_gateway_token = workspace.hermes_gateway_token.trim().to_string();
    let env_content = serialize_env_file(&current_env, &env_workspace);
    fs::write(&home.env_file, env_content)?;

    read_config_documents(home)
}

pub fn write_structured_env(
    home: &HermesHome,
    workspace: &EnvWorkspace,
) -> AppResult<ConfigDocuments> {
    let current = read_text_file(&home.env_file)?;
    let content = serialize_env_file(&current, workspace);
    fs::write(&home.env_file, content)?;
    read_config_documents(home)
}

fn build_env_workspace(content: &str) -> EnvWorkspace {
    let map = env_map(content);

    EnvWorkspace {
        openai_api_key: lookup_env_string(&map, "OPENAI_API_KEY"),
        openrouter_api_key: lookup_env_string(&map, "OPENROUTER_API_KEY"),
        anthropic_api_key: lookup_env_string(&map, "ANTHROPIC_API_KEY"),
        google_api_key: lookup_env_string(&map, "GOOGLE_API_KEY"),
        hf_token: lookup_env_string(&map, "HF_TOKEN"),
        anyrouter_2_api_key: lookup_env_string(&map, "ANYROUTER_2_API_KEY"),
        crs_api_key: lookup_env_string(&map, "CRS_API_KEY"),
        siliconflow_api_key: lookup_env_string(&map, "SILICONFLOW_API_KEY"),
        hermes_gateway_token: lookup_env_string(&map, "HERMES_GATEWAY_TOKEN"),
        telegram_bot_token: lookup_env_string(&map, "TELEGRAM_BOT_TOKEN"),
        telegram_home_channel: lookup_env_string(&map, "TELEGRAM_HOME_CHANNEL"),
        telegram_reply_to_mode: lookup_env_string(&map, "TELEGRAM_REPLY_TO_MODE"),
        discord_bot_token: lookup_env_string(&map, "DISCORD_BOT_TOKEN"),
        discord_home_channel: lookup_env_string(&map, "DISCORD_HOME_CHANNEL"),
        discord_reply_to_mode: lookup_env_string(&map, "DISCORD_REPLY_TO_MODE"),
        slack_bot_token: lookup_env_string(&map, "SLACK_BOT_TOKEN"),
        whatsapp_enabled: lookup_env_bool(&map, "WHATSAPP_ENABLED"),
        terminal_modal_image: lookup_env_string(&map, "TERMINAL_MODAL_IMAGE"),
        terminal_timeout: lookup_env_i64(&map, "TERMINAL_TIMEOUT"),
        terminal_lifetime_seconds: lookup_env_i64(&map, "TERMINAL_LIFETIME_SECONDS"),
        browser_session_timeout: lookup_env_i64(&map, "BROWSER_SESSION_TIMEOUT"),
        browser_inactivity_timeout: lookup_env_i64(&map, "BROWSER_INACTIVITY_TIMEOUT"),
    }
}

fn env_map(content: &str) -> BTreeMap<String, String> {
    parse_env_lines(content)
        .into_iter()
        .filter_map(|line| match line {
            EnvLine::Entry { key, value, .. } => Some((key, value)),
            EnvLine::Raw(_) => None,
        })
        .collect()
}

fn parse_env_lines(content: &str) -> Vec<EnvLine> {
    let assignment = Regex::new(r"^(?:export\s+)?(?P<key>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>.*)$")
        .expect(".env 正则应可编译");

    content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return EnvLine::Raw(line.to_string());
            }

            let Some(captures) = assignment.captures(trimmed) else {
                return EnvLine::Raw(line.to_string());
            };

            let key = captures
                .name("key")
                .map(|value| value.as_str().to_string())
                .unwrap_or_default();
            let value = captures
                .name("value")
                .map(|value| parse_env_value(value.as_str()))
                .unwrap_or_default();

            EnvLine::Entry {
                key,
                value,
                raw: line.to_string(),
            }
        })
        .collect()
}

fn parse_env_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        return unquote_env_value(&trimmed[1..trimmed.len() - 1]);
    }

    trimmed
        .split(" #")
        .next()
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

fn unquote_env_value(raw: &str) -> String {
    raw.replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\t", "\t")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

fn lookup_env_string(map: &BTreeMap<String, String>, key: &str) -> String {
    map.get(key)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn lookup_env_bool(map: &BTreeMap<String, String>, key: &str) -> bool {
    matches!(
        map.get(key)
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn lookup_env_i64(map: &BTreeMap<String, String>, key: &str) -> Option<i64> {
    map.get(key)
        .and_then(|value| value.trim().parse::<i64>().ok())
}

fn serialize_env_file(current: &str, workspace: &EnvWorkspace) -> String {
    let managed = managed_env_entries(workspace);
    let managed_map = managed
        .iter()
        .map(|(key, value)| ((*key).to_string(), value.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut handled = BTreeSet::new();
    let mut lines = Vec::new();

    for line in parse_env_lines(current) {
        match line {
            EnvLine::Raw(raw) => lines.push(raw),
            EnvLine::Entry { key, raw, .. } => {
                if let Some(value) = managed_map.get(&key) {
                    handled.insert(key.clone());
                    if let Some(value) = value {
                        lines.push(format_env_assignment(&key, value));
                    }
                } else {
                    lines.push(raw);
                }
            }
        }
    }

    let missing = managed
        .into_iter()
        .filter(|(key, value)| value.is_some() && !handled.contains(*key))
        .map(|(key, value)| format_env_assignment(key, &value.unwrap_or_default()))
        .collect::<Vec<_>>();

    if !missing.is_empty() {
        if lines.last().is_some_and(|line| !line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.extend(missing);
    }

    if lines.is_empty() {
        return String::new();
    }

    let mut serialized = lines.join("\n");
    if !serialized.ends_with('\n') {
        serialized.push('\n');
    }
    serialized
}

fn managed_env_entries(workspace: &EnvWorkspace) -> Vec<(&'static str, Option<String>)> {
    vec![
        (
            "OPENAI_API_KEY",
            optional_env_string(&workspace.openai_api_key),
        ),
        (
            "OPENROUTER_API_KEY",
            optional_env_string(&workspace.openrouter_api_key),
        ),
        (
            "ANTHROPIC_API_KEY",
            optional_env_string(&workspace.anthropic_api_key),
        ),
        (
            "GOOGLE_API_KEY",
            optional_env_string(&workspace.google_api_key),
        ),
        ("HF_TOKEN", optional_env_string(&workspace.hf_token)),
        (
            "ANYROUTER_2_API_KEY",
            optional_env_string(&workspace.anyrouter_2_api_key),
        ),
        ("CRS_API_KEY", optional_env_string(&workspace.crs_api_key)),
        (
            "SILICONFLOW_API_KEY",
            optional_env_string(&workspace.siliconflow_api_key),
        ),
        (
            "HERMES_GATEWAY_TOKEN",
            optional_env_string(&workspace.hermes_gateway_token),
        ),
        (
            "TELEGRAM_BOT_TOKEN",
            optional_env_string(&workspace.telegram_bot_token),
        ),
        (
            "TELEGRAM_HOME_CHANNEL",
            optional_env_string(&workspace.telegram_home_channel),
        ),
        (
            "TELEGRAM_REPLY_TO_MODE",
            optional_env_string(&workspace.telegram_reply_to_mode),
        ),
        (
            "DISCORD_BOT_TOKEN",
            optional_env_string(&workspace.discord_bot_token),
        ),
        (
            "DISCORD_HOME_CHANNEL",
            optional_env_string(&workspace.discord_home_channel),
        ),
        (
            "DISCORD_REPLY_TO_MODE",
            optional_env_string(&workspace.discord_reply_to_mode),
        ),
        (
            "SLACK_BOT_TOKEN",
            optional_env_string(&workspace.slack_bot_token),
        ),
        (
            "WHATSAPP_ENABLED",
            Some(workspace.whatsapp_enabled.to_string()),
        ),
        (
            "TERMINAL_MODAL_IMAGE",
            optional_env_string(&workspace.terminal_modal_image),
        ),
        (
            "TERMINAL_TIMEOUT",
            workspace.terminal_timeout.map(|value| value.to_string()),
        ),
        (
            "TERMINAL_LIFETIME_SECONDS",
            workspace
                .terminal_lifetime_seconds
                .map(|value| value.to_string()),
        ),
        (
            "BROWSER_SESSION_TIMEOUT",
            workspace
                .browser_session_timeout
                .map(|value| value.to_string()),
        ),
        (
            "BROWSER_INACTIVITY_TIMEOUT",
            workspace
                .browser_inactivity_timeout
                .map(|value| value.to_string()),
        ),
    ]
}

fn optional_env_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn format_env_assignment(key: &str, value: &str) -> String {
    let needs_quotes = value.is_empty()
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '#' | '"' | '\\'));

    if needs_quotes {
        let escaped = value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t");
        format!(r#"{key}="{escaped}""#)
    } else {
        format!("{key}={value}")
    }
}

fn build_plugin_catalog(
    home: &HermesHome,
    runtime: &PluginRuntimeSnapshot,
) -> Vec<PluginCatalogItem> {
    let Some(root) = plugin_catalog_root(home) else {
        return Vec::new();
    };

    let installed = plugin_installed_aliases(runtime);
    let mut items = WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.file_name() == OsString::from("plugin.yaml")
        })
        .filter_map(|entry| parse_plugin_catalog_item(&root, entry.path(), &installed).ok())
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        right
            .installed
            .cmp(&left.installed)
            .then_with(|| left.category.cmp(&right.category))
            .then_with(|| left.name.cmp(&right.name))
    });
    items
}

fn plugin_catalog_root(home: &HermesHome) -> Option<PathBuf> {
    let mut candidates = vec![home.root.join("hermes-agent").join("plugins")];
    if let Ok(default_root) = resolve_default_hermes_root(None) {
        candidates.push(default_root.join("hermes-agent").join("plugins"));
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.exists() && candidate.is_dir())
}

fn plugin_installed_aliases(runtime: &PluginRuntimeSnapshot) -> BTreeSet<String> {
    let mut aliases = BTreeSet::new();
    for item in &runtime.items {
        add_plugin_aliases(&mut aliases, item);
    }
    aliases
}

fn add_plugin_aliases(aliases: &mut BTreeSet<String>, value: &str) {
    let normalized = value.trim().replace('\\', "/").to_ascii_lowercase();
    if normalized.is_empty() {
        return;
    }

    aliases.insert(normalized.clone());
    if let Some(last_segment) = normalized.rsplit('/').next() {
        aliases.insert(last_segment.to_string());
    }
}

fn parse_plugin_catalog_item(
    root: &Path,
    manifest_path: &Path,
    installed_aliases: &BTreeSet<String>,
) -> AppResult<PluginCatalogItem> {
    let manifest: RawPluginManifest = serde_yaml::from_str(&read_text_file(manifest_path)?)?;
    let directory = manifest_path
        .parent()
        .ok_or_else(|| AppError::Message("plugin.yaml 缺少父目录".into()))?;
    let relative_path = directory
        .strip_prefix(root)
        .unwrap_or(directory)
        .to_string_lossy()
        .replace('\\', "/");
    let category = relative_path
        .split('/')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("uncategorized")
        .to_string();
    let fallback_name = directory
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown-plugin");
    let name = manifest
        .name
        .unwrap_or_else(|| fallback_name.to_string())
        .trim()
        .to_string();
    let mut aliases = BTreeSet::new();
    add_plugin_aliases(&mut aliases, &name);
    add_plugin_aliases(&mut aliases, &relative_path);
    add_plugin_aliases(&mut aliases, &format!("{category}/{name}"));
    let installed = aliases
        .iter()
        .any(|alias| installed_aliases.contains(alias.as_str()));

    Ok(PluginCatalogItem {
        name,
        category,
        relative_path,
        directory_path: directory.display().to_string(),
        description: manifest.description.unwrap_or_default().trim().to_string(),
        requires_env: manifest.requires_env.unwrap_or_default(),
        pip_dependencies: manifest.pip_dependencies.unwrap_or_default(),
        external_dependencies: manifest
            .external_dependencies
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let name = item.name.unwrap_or_default().trim().to_string();
                if name.is_empty() {
                    return None;
                }
                Some(PluginExternalDependency {
                    name,
                    install: item.install.unwrap_or_default().trim().to_string(),
                    check: item.check.unwrap_or_default().trim().to_string(),
                })
            })
            .collect(),
        installed,
    })
}

pub fn list_skills(home: &HermesHome) -> AppResult<Vec<SkillItem>> {
    if !home.skills_dir.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in WalkDir::new(&home.skills_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.file_name() == OsString::from("SKILL.md")
        })
    {
        let full_path = entry.path().to_path_buf();
        let relative = full_path
            .strip_prefix(&home.skills_dir)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let content = read_text_file(&full_path)?;
        let meta = parse_skill_frontmatter(&content, &relative);
        let preview = extract_markdown_preview(&content);

        skills.push(SkillItem {
            category: meta.category,
            description: meta.description,
            file_path: full_path.display().to_string(),
            name: meta.name,
            preview,
            relative_path: meta.relative_path,
        });
    }

    skills.sort_by(|left, right| {
        left.category
            .cmp(&right.category)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(skills)
}

pub fn read_skill_file(home: &HermesHome, file_path: &str) -> AppResult<SkillFileDetail> {
    let path = ensure_skill_file_within_home(home, file_path)?;
    let content = read_text_file(&path)?;
    let relative = path
        .strip_prefix(&home.skills_dir)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .replace('\\', "/");
    let meta = parse_skill_frontmatter(&content, &relative);

    Ok(SkillFileDetail {
        category: meta.category,
        content,
        file_path: path.display().to_string(),
        name: meta.name,
        relative_path: meta.relative_path,
    })
}

pub fn write_skill_file(
    home: &HermesHome,
    file_path: &str,
    content: &str,
) -> AppResult<SkillFileDetail> {
    let path = ensure_skill_file_within_home(home, file_path)?;
    fs::write(&path, content)?;
    read_skill_file(home, &path.display().to_string())
}

pub fn create_skill_file(
    home: &HermesHome,
    request: &SkillCreateRequest,
) -> AppResult<SkillFileDetail> {
    let category = normalize_skill_segment(&request.category, "custom");
    let slug = normalize_skill_segment(&request.name, "new-skill");
    let directory = home.skills_dir.join(&category).join(&slug);
    let file_path = directory.join("SKILL.md");

    if file_path.exists() && !request.overwrite {
        return Err(AppError::Message(format!(
            "技能已存在：{}/{}",
            category, slug
        )));
    }

    fs::create_dir_all(&directory)?;
    fs::write(
        &file_path,
        build_skill_markdown(
            request.name.trim(),
            request.description.trim(),
            request.content.trim(),
        ),
    )?;

    read_skill_file(home, &file_path.display().to_string())
}

pub fn get_session_detail(db_path: &Path, session_id: &str) -> AppResult<SessionDetail> {
    let conn = Connection::open(db_path)?;
    let session = {
        let mut stmt = conn.prepare(
            r#"
            SELECT
              s.id,
              s.title,
              s.source,
              s.model,
              s.started_at,
              s.ended_at,
              COALESCE(s.message_count, 0),
              COALESCE(s.tool_call_count, 0),
              COALESCE(
                (
                  SELECT m.content
                  FROM messages m
                  WHERE m.session_id = s.id
                    AND m.role = 'user'
                    AND COALESCE(m.content, '') <> ''
                  ORDER BY m.timestamp ASC, m.id ASC
                  LIMIT 1
                ),
                ''
              )
            FROM sessions s
            WHERE s.id = ?1
            "#,
        )?;

        stmt.query_row([session_id], |row| {
            Ok(SessionRecord {
                ended_at: row.get(5)?,
                id: row.get(0)?,
                message_count: row.get(6)?,
                model: row.get(3)?,
                preview: row.get(8)?,
                source: row.get(2)?,
                started_at: row.get(4)?,
                title: row.get(1)?,
                tool_call_count: row.get(7)?,
            })
        })?
    };

    let mut stmt = conn.prepare(
        r#"
        SELECT id, role, COALESCE(content, ''), tool_name, timestamp
        FROM messages
        WHERE session_id = ?1
        ORDER BY id ASC
        "#,
    )?;

    let messages = stmt
        .query_map([session_id], |row| {
            Ok(SessionMessage {
                content: row.get(2)?,
                id: row.get(0)?,
                role: row.get(1)?,
                timestamp: row.get(4)?,
                tool_name: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SessionDetail { session, messages })
}

pub fn read_log_tail(
    home: &HermesHome,
    log_name: &str,
    limit: usize,
    level: Option<&str>,
    contains: Option<&str>,
) -> AppResult<LogReadResult> {
    let filename = match log_name {
        "agent" | "agent.log" => "agent.log",
        "errors" | "errors.log" => "errors.log",
        "gateway" | "gateway.log" => "gateway.log",
        "gateway.error" | "gateway.error.log" => "gateway.error.log",
        other => {
            return Err(AppError::Message(format!("不支持的日志文件: {other}")));
        }
    };

    let file_path = home.logs_dir.join(filename);
    let content = read_text_file(&file_path)?;
    let normalized_level = level.map(str::to_ascii_uppercase);
    let query = contains.map(str::to_owned);

    let mut lines: Vec<String> = content
        .lines()
        .filter(|line| {
            let matches_level = normalized_level
                .as_ref()
                .map(|target| line.to_ascii_uppercase().contains(target))
                .unwrap_or(true);
            let matches_query = query
                .as_ref()
                .map(|value| line.contains(value))
                .unwrap_or(true);
            matches_level && matches_query
        })
        .map(ToString::to_string)
        .collect();

    if lines.len() > limit {
        lines = lines.split_off(lines.len() - limit);
    }

    Ok(LogReadResult {
        file_path: file_path.display().to_string(),
        lines,
        name: log_name.to_string(),
    })
}

pub fn list_memory_files(home: &HermesHome) -> AppResult<Vec<MemoryFileSummary>> {
    let entries = [
        ("soul", "SOUL.md", home.root.join("SOUL.md")),
        (
            "memory",
            "MEMORY.md",
            home.root.join("memories").join("MEMORY.md"),
        ),
        (
            "user",
            "USER.md",
            home.root.join("memories").join("USER.md"),
        ),
    ];

    Ok(entries
        .into_iter()
        .map(|(key, label, path)| MemoryFileSummary {
            exists: path.exists(),
            key: key.to_string(),
            label: label.to_string(),
            path: path.display().to_string(),
            updated_at: file_updated_at(&path),
        })
        .collect())
}

pub fn read_memory_file(home: &HermesHome, key: &str) -> AppResult<MemoryFileDetail> {
    let (label, path) = memory_path_for_key(home, key)?;
    let exists = path.exists();

    Ok(MemoryFileDetail {
        content: read_text_file(&path).unwrap_or_default(),
        exists,
        key: key.to_string(),
        label,
        path: path.display().to_string(),
    })
}

pub fn write_memory_file(home: &HermesHome, key: &str, content: &str) -> AppResult<()> {
    let (_, path) = memory_path_for_key(home, key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct RawCronJobsFile {
    jobs: Option<Vec<RawCronJob>>,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCronJob {
    id: String,
    name: Option<String>,
    prompt: Option<String>,
    schedule_display: Option<String>,
    schedule: Option<RawCronSchedule>,
    state: Option<String>,
    next_run_at: Option<String>,
    last_run_at: Option<String>,
    deliver: Option<String>,
    skill: Option<String>,
    skills: Option<Vec<String>>,
    enabled: Option<bool>,
    repeat: Option<RawCronRepeat>,
    script: Option<String>,
    last_status: Option<String>,
    last_error: Option<String>,
    last_delivery_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCronSchedule {
    kind: Option<String>,
    run_at: Option<String>,
    minutes: Option<i64>,
    expr: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCronRepeat {
    times: Option<i64>,
    completed: Option<i64>,
}

pub fn read_cron_jobs(home: &HermesHome) -> AppResult<CronJobsSnapshot> {
    let jobs_path = home.root.join("cron").join("jobs.json");
    if !jobs_path.exists() {
        return Ok(CronJobsSnapshot {
            jobs_path: jobs_path.display().to_string(),
            updated_at: None,
            jobs: Vec::new(),
        });
    }

    let parsed: RawCronJobsFile = serde_json::from_str(&read_text_file(&jobs_path)?)?;
    let mut jobs = parsed
        .jobs
        .unwrap_or_default()
        .into_iter()
        .map(|job| {
            let mut skills = job.skills.unwrap_or_default();
            if skills.is_empty() {
                if let Some(skill) = job.skill {
                    if !skill.trim().is_empty() {
                        skills.push(skill);
                    }
                }
            }
            let schedule_display = job
                .schedule_display
                .clone()
                .unwrap_or_else(|| "未提供调度信息".into());

            CronJobItem {
                id: job.id,
                name: job.name.unwrap_or_else(|| "未命名作业".into()),
                prompt: job.prompt.unwrap_or_default(),
                schedule_display: schedule_display.clone(),
                schedule_input: cron_schedule_input(job.schedule.as_ref())
                    .or(Some(schedule_display))
                    .unwrap_or_default(),
                state: job.state.unwrap_or_else(|| "unknown".into()),
                next_run_at: job.next_run_at,
                last_run_at: job.last_run_at,
                deliver: job.deliver.unwrap_or_else(|| "local".into()),
                skills,
                enabled: job.enabled.unwrap_or(true),
                repeat_times: job.repeat.as_ref().and_then(|repeat| repeat.times),
                repeat_completed: job
                    .repeat
                    .as_ref()
                    .and_then(|repeat| repeat.completed)
                    .unwrap_or(0),
                script: job.script,
                last_status: job.last_status,
                last_error: job.last_error,
                last_delivery_error: job.last_delivery_error,
            }
        })
        .collect::<Vec<_>>();

    jobs.sort_by(|left, right| {
        left.next_run_at
            .cmp(&right.next_run_at)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(CronJobsSnapshot {
        jobs_path: jobs_path.display().to_string(),
        updated_at: parsed.updated_at,
        jobs,
    })
}

pub fn build_cron_create_args(request: &CronCreateRequest) -> AppResult<Vec<String>> {
    let schedule = request.schedule.trim();
    if schedule.is_empty() {
        return Err(AppError::Message("cron schedule 不能为空".into()));
    }

    let mut args = vec![
        "cron".to_string(),
        "create".to_string(),
        schedule.to_string(),
    ];

    if let Some(name) = normalize_optional_cli_value(request.name.as_deref()) {
        args.push("--name".to_string());
        args.push(name);
    }
    if let Some(deliver) = normalize_optional_cli_value(request.deliver.as_deref()) {
        args.push("--deliver".to_string());
        args.push(deliver);
    }
    if let Some(repeat) = request.repeat {
        args.push("--repeat".to_string());
        args.push(repeat.to_string());
    }
    for skill in request
        .skills
        .iter()
        .filter_map(|skill| normalize_optional_cli_value(Some(skill.as_str())))
    {
        args.push("--skill".to_string());
        args.push(skill);
    }
    if let Some(script) = normalize_optional_cli_value(request.script.as_deref()) {
        args.push("--script".to_string());
        args.push(script);
    }
    if let Some(prompt) = normalize_optional_cli_value(request.prompt.as_deref()) {
        args.push(prompt);
    }

    Ok(args)
}

pub fn build_cron_update_args(request: &CronUpdateRequest) -> AppResult<Vec<String>> {
    let job_id = request.job_id.trim();
    if job_id.is_empty() {
        return Err(AppError::Message("cron job_id 不能为空".into()));
    }

    let mut args = vec!["cron".to_string(), "edit".to_string(), job_id.to_string()];

    if let Some(schedule) = request.schedule.as_deref() {
        let normalized = schedule.trim();
        if normalized.is_empty() {
            return Err(AppError::Message("编辑 cron 时 schedule 不能为空".into()));
        }
        args.push("--schedule".to_string());
        args.push(normalized.to_string());
    }

    if let Some(prompt) = request.prompt.as_ref() {
        args.push("--prompt".to_string());
        args.push(prompt.clone());
    }
    if let Some(name) = normalize_optional_cli_value(request.name.as_deref()) {
        args.push("--name".to_string());
        args.push(name);
    }
    if let Some(deliver) = normalize_optional_cli_value(request.deliver.as_deref()) {
        args.push("--deliver".to_string());
        args.push(deliver);
    }
    if let Some(repeat) = request.repeat {
        args.push("--repeat".to_string());
        args.push(repeat.to_string());
    }

    if request.clear_skills {
        args.push("--clear-skills".to_string());
    } else if let Some(skills) = request.skills.as_ref() {
        let normalized_skills = skills
            .iter()
            .filter_map(|skill| normalize_optional_cli_value(Some(skill.as_str())))
            .collect::<Vec<_>>();
        if normalized_skills.is_empty() {
            args.push("--clear-skills".to_string());
        } else {
            for skill in normalized_skills {
                args.push("--skill".to_string());
                args.push(skill);
            }
        }
    }

    if request.clear_script {
        args.push("--script".to_string());
        args.push(String::new());
    } else if let Some(script) = normalize_optional_cli_value(request.script.as_deref()) {
        args.push("--script".to_string());
        args.push(script);
    }

    Ok(args)
}

pub fn build_cron_delete_args(request: &CronDeleteRequest) -> AppResult<Vec<String>> {
    let job_id = request.job_id.trim();
    let confirm_id = request.confirm_id.trim();
    if job_id.is_empty() {
        return Err(AppError::Message("cron delete 的 job_id 不能为空".into()));
    }
    if confirm_id != job_id {
        return Err(AppError::Message(
            "删除 cron 前，确认输入必须与目标 job_id 完全一致".into(),
        ));
    }

    Ok(vec![
        "cron".to_string(),
        "remove".to_string(),
        job_id.to_string(),
    ])
}

pub fn build_profile_create_args(request: &ProfileCreateRequest) -> AppResult<Vec<String>> {
    let profile_name = request.profile_name.trim();
    if profile_name.is_empty() {
        return Err(AppError::Message("profile_name 不能为空".into()));
    }
    if request.clone && request.clone_all {
        return Err(AppError::Message(
            "--clone 和 --clone-all 不能同时启用".into(),
        ));
    }

    let mut args = vec![
        "profile".to_string(),
        "create".to_string(),
        profile_name.to_string(),
    ];

    if request.clone {
        args.push("--clone".to_string());
    }
    if request.clone_all {
        args.push("--clone-all".to_string());
    }
    if let Some(clone_from) = normalize_optional_cli_value(request.clone_from.as_deref()) {
        args.push("--clone-from".to_string());
        args.push(clone_from);
    }
    if request.no_alias {
        args.push("--no-alias".to_string());
    }

    Ok(args)
}

pub fn build_profile_rename_args(request: &ProfileRenameRequest) -> AppResult<Vec<String>> {
    let old_name = request.old_name.trim();
    let new_name = request.new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err(AppError::Message("profile rename 的名称不能为空".into()));
    }
    if old_name == "default" {
        return Err(AppError::Message("default profile 不支持重命名".into()));
    }

    Ok(vec![
        "profile".to_string(),
        "rename".to_string(),
        old_name.to_string(),
        new_name.to_string(),
    ])
}

pub fn build_profile_export_args(request: &ProfileExportRequest) -> AppResult<Vec<String>> {
    let profile_name = request.profile_name.trim();
    if profile_name.is_empty() {
        return Err(AppError::Message(
            "profile export 的 profile_name 不能为空".into(),
        ));
    }

    let mut args = vec![
        "profile".to_string(),
        "export".to_string(),
        profile_name.to_string(),
    ];
    if let Some(output) = normalize_optional_cli_value(request.output.as_deref()) {
        args.push("--output".to_string());
        args.push(output);
    }
    Ok(args)
}

pub fn build_profile_import_args(request: &ProfileImportRequest) -> AppResult<Vec<String>> {
    let archive = request.archive.trim();
    if archive.is_empty() {
        return Err(AppError::Message(
            "profile import 的 archive 不能为空".into(),
        ));
    }

    let mut args = vec![
        "profile".to_string(),
        "import".to_string(),
        archive.to_string(),
    ];
    if let Some(name) = normalize_optional_cli_value(request.import_name.as_deref()) {
        args.push("--name".to_string());
        args.push(name);
    }
    Ok(args)
}

pub fn build_profile_delete_args(request: &ProfileDeleteRequest) -> AppResult<Vec<String>> {
    let profile_name = request.profile_name.trim();
    let confirm_name = request.confirm_name.trim();
    if profile_name.is_empty() {
        return Err(AppError::Message(
            "profile delete 的 profile_name 不能为空".into(),
        ));
    }
    if profile_name == "default" {
        return Err(AppError::Message("default profile 不支持删除".into()));
    }
    if confirm_name != profile_name {
        return Err(AppError::Message(
            "删除 profile 前，确认输入必须与目标 profile 名称完全一致".into(),
        ));
    }

    Ok(vec![
        "profile".to_string(),
        "delete".to_string(),
        "--yes".to_string(),
        profile_name.to_string(),
    ])
}

pub fn build_profile_alias_create_args(
    request: &ProfileAliasCreateRequest,
) -> AppResult<Vec<String>> {
    let profile_name = request.profile_name.trim();
    if profile_name.is_empty() {
        return Err(AppError::Message(
            "profile alias 的 profile_name 不能为空".into(),
        ));
    }

    let alias_name = normalize_optional_cli_value(request.alias_name.as_deref());

    let mut args = vec![
        "profile".to_string(),
        "alias".to_string(),
        profile_name.to_string(),
    ];
    if let Some(alias_name) = alias_name {
        if alias_name != profile_name {
            args.push("--name".to_string());
            args.push(alias_name);
        }
    }

    Ok(args)
}

pub fn build_profile_alias_delete_args(
    request: &ProfileAliasDeleteRequest,
) -> AppResult<Vec<String>> {
    let profile_name = request.profile_name.trim();
    let alias_name = request.alias_name.trim();
    let confirm_name = request.confirm_name.trim();
    if profile_name.is_empty() {
        return Err(AppError::Message(
            "profile alias 删除时 profile_name 不能为空".into(),
        ));
    }
    if alias_name.is_empty() {
        return Err(AppError::Message(
            "profile alias 删除时 alias_name 不能为空".into(),
        ));
    }
    if confirm_name != alias_name {
        return Err(AppError::Message(
            "删除 alias 前，确认输入必须与目标 alias 名称完全一致".into(),
        ));
    }

    let mut args = vec![
        "profile".to_string(),
        "alias".to_string(),
        profile_name.to_string(),
        "--remove".to_string(),
    ];
    if alias_name != profile_name {
        args.push("--name".to_string());
        args.push(alias_name.to_string());
    }

    Ok(args)
}

pub fn read_dashboard_snapshot(home: &HermesHome) -> AppResult<DashboardSnapshot> {
    let config_docs = read_config_documents(home)?;
    let gateway = if home.gateway_state.exists() {
        Some(read_gateway_state(&home.gateway_state)?)
    } else {
        None
    };
    let binary = probe_hermes_binary();
    let skills = list_skills(home)?;
    let sessions = if home.state_db.exists() {
        load_recent_sessions(&home.state_db, 6)?
    } else {
        Vec::new()
    };
    let memory_files = list_memory_files(home)?;
    let version_output = if binary.is_some() {
        run_hermes_command(Some(&home.profile_name), &["version"])
            .map(|result| result.stdout)
            .unwrap_or_else(|_| "无法读取 Hermes 版本信息".into())
    } else {
        "尚未检测到 Hermes，可先在控制中心执行安装或升级。".into()
    };
    let warnings = build_runtime_warnings(home, gateway.as_ref(), &config_docs.summary);
    let counts = DashboardCounts {
        configured_platforms: gateway
            .as_ref()
            .map(|snapshot| snapshot.platforms.len())
            .unwrap_or(0),
        cron_jobs: count_cron_jobs(&home.root),
        log_files: count_log_files(&home.logs_dir),
        sessions: count_sessions(&home.state_db).unwrap_or(sessions.len()),
        skills: skills.len(),
    };

    Ok(DashboardSnapshot {
        binary_found: binary.is_some(),
        config: config_docs.summary,
        counts,
        gateway,
        hermes_binary: binary
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "未安装 Hermes".into()),
        hermes_home: home.root.display().to_string(),
        memory_files,
        profile_name: home.profile_name.clone(),
        recent_sessions: sessions,
        version_output,
        warnings,
    })
}

pub fn read_installation_snapshot(home: &HermesHome) -> AppResult<InstallationSnapshot> {
    let binary = probe_hermes_binary();
    let version_output = if binary.is_some() {
        run_hermes_command(Some(&home.profile_name), &["version"])
            .map(|result| result.stdout.trim().to_string())
            .unwrap_or_else(|_| "已检测到 Hermes，但暂时无法读取版本信息。".into())
    } else {
        "尚未检测到 Hermes，可先执行一键安装。".into()
    };

    let dependencies = [
        (
            "hermes",
            "Hermes CLI 本体；控制台、诊断和治理功能都依赖它。",
            binary.clone(),
        ),
        (
            "curl",
            "官方安装脚本默认通过 curl 拉取。",
            find_command_binary("curl"),
        ),
        (
            "git",
            "安装脚本与部分更新场景依赖 Git。",
            find_command_binary("git"),
        ),
        (
            "python3",
            "Hermes 本体运行依赖 Python 环境。",
            find_command_binary("python3"),
        ),
        (
            "uv",
            "很多 Hermes 用户会用 uv 管理 Python 工具安装。",
            find_command_binary("uv"),
        ),
        (
            "pipx",
            "可作为独立工具安装的补充方案。",
            find_command_binary("pipx"),
        ),
    ]
    .into_iter()
    .map(|(name, note, path)| BinaryStatus {
        found: path.is_some(),
        name: name.to_string(),
        note: note.to_string(),
        path: path.map(|value| value.display().to_string()),
    })
    .collect::<Vec<_>>();

    Ok(InstallationSnapshot {
        profile_name: home.profile_name.clone(),
        hermes_home: home.root.display().to_string(),
        hermes_home_exists: home.root.exists(),
        config_exists: home.config_yaml.exists(),
        env_exists: home.env_file.exists(),
        state_db_exists: home.state_db.exists(),
        gateway_state_exists: home.gateway_state.exists(),
        logs_dir_exists: home.logs_dir.exists(),
        binary_found: binary.is_some(),
        hermes_binary: binary.map(|path| path.display().to_string()),
        version_output,
        dependencies,
        quick_install_command: QUICK_INSTALL_COMMAND.to_string(),
        update_command: UPDATE_COMMAND.to_string(),
        uninstall_command: UNINSTALL_COMMAND.to_string(),
        setup_command: SETUP_COMMAND.to_string(),
        model_command: MODEL_COMMAND.to_string(),
        terminal_setup_command: TERMINAL_SETUP_COMMAND.to_string(),
        tools_setup_command: TOOLS_SETUP_COMMAND.to_string(),
        gateway_install_command: GATEWAY_INSTALL_COMMAND.to_string(),
        gateway_uninstall_command: GATEWAY_UNINSTALL_COMMAND.to_string(),
        gateway_setup_command: GATEWAY_SETUP_COMMAND.to_string(),
        config_migrate_command: CONFIG_MIGRATE_COMMAND.to_string(),
        skills_config_command: SKILLS_CONFIG_COMMAND.to_string(),
        claw_migrate_command: CLAW_MIGRATE_COMMAND.to_string(),
    })
}

fn read_text_file(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?)
}

fn normalize_optional_cli_value(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn wrapper_dir() -> AppResult<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join(".local").join("bin"))
        .ok_or_else(|| AppError::Message("无法定位 ~/.local/bin".into()))
}

fn list_profile_aliases(
    profile_name: &str,
    explicit_wrapper_dir: Option<&Path>,
) -> AppResult<Vec<ProfileAliasItem>> {
    let wrapper_root = explicit_wrapper_dir
        .map(Path::to_path_buf)
        .map(Ok)
        .unwrap_or_else(wrapper_dir)?;
    if !wrapper_root.is_dir() {
        return Ok(Vec::new());
    }

    let expected_exec = format!("exec hermes -p {profile_name} \"$@\"");
    let mut aliases = fs::read_dir(&wrapper_root)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().into_string().ok()?;
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let content = fs::read_to_string(&path).ok()?;
            content.contains(&expected_exec).then(|| ProfileAliasItem {
                is_primary: file_name == profile_name,
                name: file_name,
                path: path.display().to_string(),
            })
        })
        .collect::<Vec<_>>();

    aliases.sort_by(|left, right| {
        right
            .is_primary
            .cmp(&left.is_primary)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(aliases)
}

fn cron_schedule_input<T>(schedule: Option<&T>) -> Option<String>
where
    T: CronScheduleLike,
{
    let schedule = schedule?;
    match schedule.kind() {
        Some("once") => schedule.run_at().map(ToString::to_string),
        Some("interval") => schedule
            .minutes()
            .map(|minutes| format!("every {minutes}m")),
        Some("cron") => schedule.expr().map(ToString::to_string),
        _ => None,
    }
}

trait CronScheduleLike {
    fn kind(&self) -> Option<&str>;
    fn run_at(&self) -> Option<&str>;
    fn minutes(&self) -> Option<i64>;
    fn expr(&self) -> Option<&str>;
}

impl CronScheduleLike for RawCronSchedule {
    fn kind(&self) -> Option<&str> {
        self.kind.as_deref()
    }

    fn run_at(&self) -> Option<&str> {
        self.run_at.as_deref()
    }

    fn minutes(&self) -> Option<i64> {
        self.minutes
    }

    fn expr(&self) -> Option<&str> {
        self.expr.as_deref()
    }
}

fn lookup_yaml_string(root: &Value, path: &[&str]) -> Option<String> {
    let mut current = root;
    for segment in path {
        current = current.get(*segment)?;
    }

    match current {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn lookup_yaml_bool(root: &Value, path: &[&str]) -> Option<bool> {
    let mut current = root;
    for segment in path {
        current = current.get(*segment)?;
    }

    current.as_bool()
}

fn lookup_yaml_i64(root: &Value, path: &[&str]) -> Option<i64> {
    let mut current = root;
    for segment in path {
        current = current.get(*segment)?;
    }

    current.as_i64()
}

fn lookup_yaml_array(root: &Value, path: &[&str]) -> Vec<String> {
    let mut current = root;
    for segment in path {
        let Some(next) = current.get(*segment) else {
            return Vec::new();
        };
        current = next;
    }

    current
        .as_sequence()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect()
}

fn lookup_platform_toolsets(root: &Value) -> Vec<PlatformToolsetBinding> {
    root.get("platform_toolsets")
        .and_then(Value::as_mapping)
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| {
            let platform = key.as_str()?.trim().to_string();
            if platform.is_empty() {
                return None;
            }
            Some(PlatformToolsetBinding {
                platform,
                toolsets: value
                    .as_sequence()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect(),
            })
        })
        .collect()
}

fn set_yaml_value(root: &mut Value, path: &[&str], value: Value) {
    if path.is_empty() {
        *root = value;
        return;
    }

    let mut current = root;
    for segment in &path[..path.len() - 1] {
        let key = Value::String((*segment).to_string());
        let mapping = current.as_mapping_mut().expect("YAML 根节点必须是 mapping");
        let entry = mapping
            .entry(key)
            .or_insert_with(|| Value::Mapping(Default::default()));
        if !matches!(entry, Value::Mapping(_)) {
            *entry = Value::Mapping(Default::default());
        }
        current = entry;
    }

    if let Some(mapping) = current.as_mapping_mut() {
        mapping.insert(Value::String(path[path.len() - 1].to_string()), value);
    }
}

fn set_yaml_string(root: &mut Value, path: &[&str], value: &str) {
    set_yaml_value(root, path, Value::String(value.trim().to_string()));
}

fn set_yaml_bool(root: &mut Value, path: &[&str], value: bool) {
    set_yaml_value(root, path, Value::Bool(value));
}

fn set_yaml_optional_i64(root: &mut Value, path: &[&str], value: Option<i64>) {
    let yaml_value = value
        .map(|item| Value::Number(item.into()))
        .unwrap_or(Value::Null);
    set_yaml_value(root, path, yaml_value);
}

fn set_yaml_string_array(root: &mut Value, path: &[&str], values: &[String]) {
    let sequence = values
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| Value::String(item.to_string()))
        .collect();
    set_yaml_value(root, path, Value::Sequence(sequence));
}

fn set_platform_toolsets(root: &mut Value, bindings: &[PlatformToolsetBinding]) {
    let mapping = bindings
        .iter()
        .filter_map(|binding| {
            let platform = binding.platform.trim();
            if platform.is_empty() {
                return None;
            }
            let toolsets = binding
                .toolsets
                .iter()
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .map(|item| Value::String(item.to_string()))
                .collect::<Vec<_>>();
            Some((
                Value::String(platform.to_string()),
                Value::Sequence(toolsets),
            ))
        })
        .collect();
    set_yaml_value(root, &["platform_toolsets"], Value::Mapping(mapping));
}

fn extract_markdown_preview(markdown: &str) -> String {
    markdown
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed == "---"
                || trimmed.starts_with("name:")
                || trimmed.starts_with("description:")
            {
                None
            } else if trimmed.starts_with('#') {
                Some(trimmed.trim_start_matches('#').trim().to_string())
            } else {
                Some(trimmed.to_string())
            }
        })
        .take(2)
        .collect::<Vec<_>>()
        .join(" · ")
}

fn normalize_skill_segment(value: &str, fallback: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn build_skill_markdown(name: &str, description: &str, body: &str) -> String {
    let fallback_body = format!(
        "# {}\n\n## 目标\n\n在这里描述这个 skill 解决的问题。\n\n## 用法\n\n补充你的执行步骤、约束和示例。\n",
        name
    );
    let content = if body.is_empty() {
        fallback_body
    } else {
        body.to_string()
    };

    format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        name.trim(),
        description.trim(),
        content.trim()
    )
}

fn ensure_skill_file_within_home(home: &HermesHome, file_path: &str) -> AppResult<PathBuf> {
    let candidate = PathBuf::from(file_path);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        home.skills_dir.join(candidate)
    };

    if resolved.file_name() != Some(std::ffi::OsStr::new("SKILL.md")) {
        return Err(AppError::Message("技能文件必须是 SKILL.md".into()));
    }

    let skills_root =
        fs::canonicalize(&home.skills_dir).unwrap_or_else(|_| home.skills_dir.clone());
    let canonical = fs::canonicalize(&resolved)?;
    if !canonical.starts_with(&skills_root) {
        return Err(AppError::Message(
            "只能读取或保存 Hermes skills 目录内的文件".into(),
        ));
    }

    Ok(canonical)
}

fn memory_path_for_key(home: &HermesHome, key: &str) -> AppResult<(String, PathBuf)> {
    match key {
        "soul" => Ok(("SOUL.md".into(), home.root.join("SOUL.md"))),
        "memory" => Ok((
            "MEMORY.md".into(),
            home.root.join("memories").join("MEMORY.md"),
        )),
        "user" => Ok(("USER.md".into(), home.root.join("memories").join("USER.md"))),
        other => Err(AppError::Message(format!("不支持的记忆文件键: {other}"))),
    }
}

fn file_updated_at(path: &Path) -> Option<String> {
    let modified = path.metadata().ok()?.modified().ok()?;
    let date: DateTime<Local> = modified.into();
    Some(date.to_rfc3339())
}

fn command_result_from_output(
    hermes: &Path,
    command_args: &[String],
    output: Output,
) -> CommandRunResult {
    let exit_code = output.status.code().unwrap_or(-1);

    CommandRunResult {
        command: format!("{} {}", hermes.display(), command_args.join(" "))
            .trim()
            .to_string(),
        exit_code,
        stderr: normalize_command_text(&String::from_utf8_lossy(&output.stderr)),
        stdout: normalize_command_text(&String::from_utf8_lossy(&output.stdout)),
        success: output.status.success(),
    }
}

fn build_shell_display_command(command: &str, working_directory: Option<&Path>) -> String {
    match working_directory {
        Some(path) => format!(
            "cd {} && {}",
            shell_quote(&path.display().to_string()),
            command.trim()
        ),
        None => command.trim().to_string(),
    }
}

#[cfg(target_os = "macos")]
fn run_process_with_tty(hermes: &Path, command_args: &[String]) -> AppResult<Output> {
    Command::new("script")
        .arg("-q")
        .arg("/dev/null")
        .arg(hermes)
        .args(command_args)
        .output()
        .map_err(AppError::from)
}

#[cfg(not(target_os = "macos"))]
fn run_process_with_tty(hermes: &Path, command_args: &[String]) -> AppResult<Output> {
    let command_line = std::iter::once(hermes.display().to_string())
        .chain(command_args.iter().cloned())
        .map(|arg| shell_quote(&arg))
        .collect::<Vec<_>>()
        .join(" ");

    Command::new("script")
        .args(["-qec", &command_line, "/dev/null"])
        .output()
        .map_err(AppError::from)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

fn normalize_command_text(text: &str) -> String {
    strip_ansi(text)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim_matches('\n')
        .to_string()
}

fn strip_ansi(text: &str) -> String {
    let regex = Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").expect("ANSI 正则应可编译");
    regex.replace_all(text, "").to_string()
}

fn count_by_name<'a>(values: impl Iterator<Item = &'a str>) -> Vec<NamedCount> {
    let mut counts = BTreeMap::<String, usize>::new();
    for value in values.filter(|value| !value.trim().is_empty()) {
        *counts.entry(value.trim().to_string()).or_default() += 1;
    }

    let mut items = counts
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.cmp(&right.name))
    });
    items
}

fn parse_tool_summary(output: &str) -> Vec<ToolPlatformSummary> {
    let mut platforms = Vec::new();
    let mut current: Option<ToolPlatformSummary> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("⚕") {
            continue;
        }

        if let Some((name, enabled_count, total_count)) = parse_tool_platform_header(trimmed) {
            if let Some(platform) = current.take() {
                platforms.push(platform);
            }
            current = Some(ToolPlatformSummary {
                name,
                enabled_count,
                total_count,
                enabled_tools: Vec::new(),
            });
            continue;
        }

        if trimmed.starts_with('✓') {
            if let Some(platform) = current.as_mut() {
                platform.enabled_tools.push(strip_leading_marks(trimmed));
            }
        }
    }

    if let Some(platform) = current {
        platforms.push(platform);
    }

    platforms
}

fn parse_tool_platform_header(line: &str) -> Option<(String, usize, usize)> {
    let open = line.rfind('(')?;
    let close = line.rfind(')')?;
    if close <= open {
        return None;
    }

    let counts = &line[open + 1..close];
    let mut parts = counts.split('/');
    let enabled_count = parts.next()?.trim().parse::<usize>().ok()?;
    let total_count = parts.next()?.trim().parse::<usize>().ok()?;
    let raw_name = line[..open].trim();
    let name = strip_leading_marks(raw_name);

    if name.is_empty() {
        return None;
    }

    Some((name, enabled_count, total_count))
}

fn parse_tool_inventory(
    platform_key: &str,
    display_name: &str,
    output: &str,
) -> ToolPlatformInventory {
    let items = output
        .lines()
        .map(str::trim)
        .filter_map(parse_tool_inventory_line)
        .collect::<Vec<_>>();

    ToolPlatformInventory {
        platform_key: platform_key.to_string(),
        display_name: display_name.to_string(),
        items,
    }
}

fn parse_tool_inventory_line(line: &str) -> Option<ToolRuntimeItem> {
    let trimmed = line.trim();
    if !(trimmed.starts_with('✓') || trimmed.starts_with('✗')) {
        return None;
    }

    let regex = Regex::new(r"^(?P<mark>[✓✗])\s+(?P<state>enabled|disabled)\s+(?P<name>[A-Za-z0-9:_-]+)\s+(?P<desc>.+)$")
        .expect("tools list 正则应可编译");
    let captures = regex.captures(trimmed)?;

    Some(ToolRuntimeItem {
        name: captures.name("name")?.as_str().to_string(),
        enabled: captures.name("state")?.as_str() == "enabled",
        description: strip_leading_marks(captures.name("desc")?.as_str()),
    })
}

fn strip_leading_marks(value: &str) -> String {
    let trimmed = value.trim();
    let mut started = false;
    trimmed
        .chars()
        .filter(|ch| {
            if started {
                true
            } else if ch.is_ascii_alphanumeric() {
                started = true;
                true
            } else {
                false
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn parse_memory_runtime(output: &str) -> MemoryRuntimeSnapshot {
    let mut built_in_status = "unknown".to_string();
    let mut provider = "unknown".to_string();
    let mut installed_plugins = Vec::new();
    let mut in_plugins = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("Memory status") || trimmed.starts_with('─')
        {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("Built-in:") {
            built_in_status = value.trim().to_string();
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("Provider:") {
            provider = value.trim().to_string();
            continue;
        }
        if trimmed.starts_with("Installed plugins:") {
            in_plugins = true;
            continue;
        }
        if in_plugins && trimmed.starts_with('•') {
            let detail = trimmed.trim_start_matches('•').trim();
            if let Some(open) = detail.rfind('(') {
                let close = detail.rfind(')').unwrap_or(detail.len());
                let name = detail[..open].trim().to_string();
                let availability = detail[open + 1..close].trim().to_string();
                installed_plugins.push(MemoryProviderOption { name, availability });
            } else {
                installed_plugins.push(MemoryProviderOption {
                    name: detail.to_string(),
                    availability: String::new(),
                });
            }
        }
    }

    MemoryRuntimeSnapshot {
        built_in_status,
        provider,
        installed_plugins,
        raw_output: output.to_string(),
    }
}

fn parse_runtime_skills(output: &str) -> Vec<RuntimeSkillItem> {
    parse_box_table_rows(output)
        .into_iter()
        .filter_map(|columns| {
            if columns.len() < 4 {
                return None;
            }
            Some(RuntimeSkillItem {
                name: columns[0].clone(),
                category: columns[1].clone(),
                source: columns[2].clone(),
                trust: columns[3].clone(),
            })
        })
        .collect()
}

fn parse_plugin_runtime(output: &str) -> PluginRuntimeSnapshot {
    if output
        .lines()
        .any(|line| line.contains("No plugins installed."))
    {
        return PluginRuntimeSnapshot {
            installed_count: 0,
            items: Vec::new(),
            install_hint: output
                .lines()
                .find(|line| line.contains("Install with:"))
                .map(|line| line.trim().to_string()),
            raw_output: output.to_string(),
        };
    }

    let mut items = parse_box_table_rows(output)
        .into_iter()
        .filter_map(|columns| columns.first().cloned())
        .collect::<Vec<_>>();

    if items.is_empty() {
        items = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.contains("Installed Plugins"))
            .map(ToString::to_string)
            .collect();
    }

    PluginRuntimeSnapshot {
        installed_count: items.len(),
        items,
        install_hint: None,
        raw_output: output.to_string(),
    }
}

fn parse_box_table_rows(output: &str) -> Vec<Vec<String>> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('│'))
        .map(|line| {
            line.trim_matches('│')
                .split('│')
                .map(|part| part.trim().to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn count_sessions(db_path: &Path) -> Option<usize> {
    if !db_path.exists() {
        return Some(0);
    }
    let conn = Connection::open(db_path).ok()?;
    conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| {
        row.get::<_, i64>(0)
    })
    .ok()
    .map(|value| value.max(0) as usize)
}

fn count_log_files(logs_dir: &Path) -> usize {
    fs::read_dir(logs_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
        })
        .count()
}

fn count_cron_jobs(root: &Path) -> usize {
    let jobs_path = root.join("cron").join("jobs.json");
    if !jobs_path.exists() {
        return 0;
    }

    let text = fs::read_to_string(jobs_path).unwrap_or_default();
    let parsed = serde_json::from_str::<serde_json::Value>(&text).unwrap_or_default();
    match parsed {
        serde_json::Value::Array(items) => items.len(),
        serde_json::Value::Object(map) => map
            .get("jobs")
            .and_then(serde_json::Value::as_array)
            .map(|items| items.len())
            .unwrap_or(0),
        _ => 0,
    }
}

fn build_runtime_warnings(
    home: &HermesHome,
    gateway: Option<&GatewayStateSnapshot>,
    config: &ConfigSummary,
) -> Vec<String> {
    let mut warnings = Vec::new();
    if config
        .model_default
        .as_deref()
        .unwrap_or_default()
        .is_empty()
    {
        warnings.push("尚未配置默认模型。".into());
    }
    if !home.state_db.exists() {
        warnings.push("尚未检测到 Hermes 会话数据库，首次聊天后会自动创建。".into());
    }
    if gateway.is_none() {
        warnings.push("未发现 gateway_state.json，消息网关可能尚未启动。".into());
    }
    if let Some(snapshot) = gateway {
        for platform in &snapshot.platforms {
            if platform.state == "fatal" {
                let message = platform
                    .error_message
                    .clone()
                    .unwrap_or_else(|| "存在未处理错误".into());
                warnings.push(format!("{} 平台异常：{}", platform.name, message));
            }
        }
    }
    warnings
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use rusqlite::Connection;
    use tempfile::tempdir;

    use crate::models::{
        ConfigWorkspace, CronCreateRequest, CronDeleteRequest, CronUpdateRequest, EnvWorkspace,
        GatewayWorkspace, PlatformToolsetBinding, PluginRuntimeSnapshot, ProfileAliasCreateRequest,
        ProfileAliasDeleteRequest, ProfileCreateRequest, ProfileDeleteRequest,
        ProfileExportRequest, ProfileImportRequest, ProfileRenameRequest, SkillCreateRequest,
    };

    use super::{
        build_config_summary, build_cron_create_args, build_cron_delete_args,
        build_cron_update_args, build_plugin_action_args, build_plugin_catalog,
        build_profile_alias_create_args, build_profile_alias_delete_args,
        build_profile_create_args, build_profile_delete_args, build_profile_export_args,
        build_profile_import_args, build_profile_rename_args, build_skill_action_args,
        build_tool_action_args, compose_hermes_command_args, config_compat_action_args,
        create_skill_file, get_active_profile, installation_action_command, list_profile_aliases,
        list_profiles, load_recent_sessions, parse_memory_runtime, parse_plugin_runtime,
        parse_runtime_skills, parse_skill_frontmatter, parse_tool_inventory,
        parse_tool_inventory_line, parse_tool_summary, read_config_documents, read_cron_jobs,
        read_gateway_state, resolve_hermes_home, set_active_profile, write_structured_config,
        write_structured_env, write_structured_gateway, InstallationActionCommand,
        QUICK_INSTALL_COMMAND,
    };

    #[test]
    fn resolves_default_hermes_home_layout() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");

        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");

        assert_eq!(home.root, root);
        assert_eq!(home.profile_name, "default");
        assert_eq!(home.config_yaml, root.join("config.yaml"));
        assert_eq!(home.env_file, root.join(".env"));
        assert_eq!(home.state_db, root.join("state.db"));
        assert_eq!(home.gateway_state, root.join("gateway_state.json"));
    }

    #[test]
    fn resolves_named_profile_layout_and_active_profile() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        let named_root = root.join("profiles").join("ops");

        seed_profile_root(&root, "gpt-5.4");
        seed_profile_root(&named_root, "claude-opus");
        set_active_profile("ops", Some(&root)).expect("写入 active_profile 失败");

        let active = get_active_profile(Some(&root)).expect("读取 active_profile 失败");
        let home = resolve_hermes_home(None, Some(&root)).expect("按 active profile 解析失败");

        assert_eq!(active, "ops");
        assert_eq!(home.profile_name, "ops");
        assert_eq!(home.root, named_root);
        assert_eq!(
            home.config_yaml,
            root.join("profiles").join("ops").join("config.yaml")
        );
    }

    #[test]
    fn lists_profiles_with_active_marker_and_summary() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        let named_root = root.join("profiles").join("research");

        seed_profile_root(&root, "gpt-5.4");
        seed_profile_root(&named_root, "gpt-5.3");
        set_active_profile("research", Some(&root)).expect("设置活跃 profile 失败");

        let snapshot = list_profiles(Some(&root)).expect("列出 profile 失败");

        assert_eq!(snapshot.active_profile, "research");
        assert_eq!(snapshot.profiles.len(), 2);
        assert!(snapshot
            .profiles
            .iter()
            .any(|item| item.name == "default" && item.is_default && !item.is_active));
        assert!(snapshot.profiles.iter().any(|item| {
            item.name == "research"
                && item.is_active
                && item.model_default.as_deref() == Some("gpt-5.3")
        }));
        assert!(snapshot
            .profiles
            .iter()
            .any(|item| item.name == "default" && item.env_exists && item.soul_exists));
    }

    #[test]
    fn reads_gateway_runtime_snapshot() {
        let temp = tempdir().expect("创建临时目录失败");
        let gateway_path = temp.path().join("gateway_state.json");

        fs::write(
            &gateway_path,
            r#"{
              "pid": 50678,
              "gateway_state": "running",
              "exit_reason": null,
              "restart_requested": false,
              "active_agents": 2,
              "updated_at": "2026-04-11T05:31:43.257869+00:00",
              "platforms": {
                "telegram": {
                  "state": "connected",
                  "updated_at": "2026-04-11T05:31:43.256595+00:00"
                },
                "discord": {
                  "state": "fatal",
                  "error_message": "token missing"
                }
              }
            }"#,
        )
        .expect("写入 gateway_state.json 失败");

        let snapshot = read_gateway_state(&gateway_path).expect("读取 Gateway 状态失败");

        assert_eq!(snapshot.pid, Some(50678));
        assert_eq!(snapshot.gateway_state, "running");
        assert_eq!(snapshot.active_agents, 2);
        assert_eq!(snapshot.platforms.len(), 2);
        assert!(snapshot
            .platforms
            .iter()
            .any(|item| item.name == "telegram"));
        assert!(snapshot
            .platforms
            .iter()
            .any(|item| item.name == "discord"
                && item.error_message.as_deref() == Some("token missing")));
    }

    #[test]
    fn parses_skill_frontmatter_and_category_from_path() {
        let markdown = r#"---
name: github-auth
description: 管理 GitHub 认证
---

# GitHub Auth
"#;

        let meta = parse_skill_frontmatter(markdown, "software-development/github-auth/SKILL.md");

        assert_eq!(meta.name, "github-auth");
        assert_eq!(meta.description, "管理 GitHub 认证");
        assert_eq!(meta.category, "software-development");
        assert_eq!(
            meta.relative_path,
            "software-development/github-auth/SKILL.md"
        );
    }

    #[test]
    fn loads_recent_sessions_with_first_user_preview() {
        let temp = tempdir().expect("创建临时目录失败");
        let db_path = temp.path().join("state.db");
        let conn = Connection::open(&db_path).expect("创建 SQLite 失败");

        conn.execute_batch(
            r#"
            CREATE TABLE sessions (
              id TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              user_id TEXT,
              model TEXT,
              model_config TEXT,
              system_prompt TEXT,
              parent_session_id TEXT,
              started_at REAL NOT NULL,
              ended_at REAL,
              end_reason TEXT,
              message_count INTEGER DEFAULT 0,
              tool_call_count INTEGER DEFAULT 0,
              input_tokens INTEGER DEFAULT 0,
              output_tokens INTEGER DEFAULT 0,
              cache_read_tokens INTEGER DEFAULT 0,
              cache_write_tokens INTEGER DEFAULT 0,
              reasoning_tokens INTEGER DEFAULT 0,
              billing_provider TEXT,
              billing_base_url TEXT,
              billing_mode TEXT,
              estimated_cost_usd REAL,
              actual_cost_usd REAL,
              cost_status TEXT,
              cost_source TEXT,
              pricing_version TEXT,
              title TEXT
            );

            CREATE TABLE messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT,
              tool_call_id TEXT,
              tool_calls TEXT,
              tool_name TEXT,
              timestamp REAL NOT NULL,
              token_count INTEGER,
              finish_reason TEXT,
              reasoning TEXT,
              reasoning_details TEXT,
              codex_reasoning_items TEXT
            );
            "#,
        )
        .expect("初始化表结构失败");

        conn.execute(
            "INSERT INTO sessions (id, source, model, started_at, ended_at, message_count, tool_call_count, title)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (
                "20260411_133009_5c349d",
                "cli",
                "gpt-5.4",
                1775885441.0619268_f64,
                1775885465.080864_f64,
                3_i64,
                1_i64,
                "测试会话",
            ),
        )
        .expect("插入 sessions 失败");

        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4)",
            (
                "20260411_133009_5c349d",
                "user",
                "你好，帮我看看 Hermes 状态",
                1775885441.973544_f64,
            ),
        )
        .expect("插入用户消息失败");

        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4)",
            (
                "20260411_133009_5c349d",
                "assistant",
                "当然可以",
                1775885442.973544_f64,
            ),
        )
        .expect("插入助手消息失败");

        let sessions = load_recent_sessions(&db_path, 10).expect("读取会话失败");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "20260411_133009_5c349d");
        assert_eq!(sessions[0].title.as_deref(), Some("测试会话"));
        assert_eq!(sessions[0].preview, "你好，帮我看看 Hermes 状态");
        assert_eq!(sessions[0].message_count, 3);
    }

    #[test]
    fn builds_profile_aware_cli_args() {
        let default_args = compose_hermes_command_args(Some("default"), &["status", "--all"]);
        let named_args = compose_hermes_command_args(Some("coder"), &["gateway", "status"]);
        let active_args = compose_hermes_command_args(None, &["version"]);

        assert_eq!(default_args, vec!["-p", "default", "status", "--all"]);
        assert_eq!(named_args, vec!["-p", "coder", "gateway", "status"]);
        assert_eq!(active_args, vec!["version"]);
    }

    #[test]
    fn maps_installation_actions_to_supported_commands() {
        assert_eq!(
            installation_action_command("install").expect("install 应映射成功"),
            InstallationActionCommand::Shell(QUICK_INSTALL_COMMAND.to_string())
        );
        assert_eq!(
            installation_action_command("update").expect("update 应映射成功"),
            InstallationActionCommand::Hermes(vec!["update".to_string()])
        );
        assert_eq!(
            installation_action_command("uninstall").expect("uninstall 应映射成功"),
            InstallationActionCommand::Hermes(vec![
                "uninstall".to_string(),
                "--yes".to_string()
            ])
        );
        assert!(installation_action_command("unknown").is_err());
    }

    #[test]
    fn maps_config_compat_actions_to_supported_commands() {
        assert_eq!(
            config_compat_action_args("config-migrate").expect("config-migrate 应映射成功"),
            vec!["config".to_string(), "migrate".to_string()]
        );
        assert_eq!(
            config_compat_action_args("claw-migrate").expect("claw-migrate 应映射成功"),
            vec!["claw".to_string(), "migrate".to_string()]
        );
        assert!(config_compat_action_args("unknown").is_err());
    }

    #[test]
    fn parses_memory_fields_from_config_summary() {
        let yaml = r#"
memory:
  memory_enabled: true
  user_profile_enabled: false
  memory_char_limit: 2200
  user_char_limit: 1375
  provider: plugin-memory
context:
  engine: semantic-router
display:
  streaming: true
terminal:
  backend: docker
toolsets:
  - hermes-cli
"#;

        let summary = build_config_summary(yaml).expect("解析配置摘要失败");

        assert_eq!(summary.memory_enabled, Some(true));
        assert_eq!(summary.user_profile_enabled, Some(false));
        assert_eq!(summary.memory_char_limit, Some(2200));
        assert_eq!(summary.user_char_limit, Some(1375));
        assert_eq!(summary.memory_provider.as_deref(), Some("plugin-memory"));
        assert_eq!(summary.context_engine.as_deref(), Some("semantic-router"));
        assert_eq!(summary.streaming_enabled, Some(true));
        assert_eq!(summary.terminal_backend.as_deref(), Some("docker"));
        assert_eq!(summary.toolsets, vec!["hermes-cli"]);
    }

    #[test]
    fn reads_config_documents_with_workspace_projection() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        fs::write(
            root.join("config.yaml"),
            r#"
model:
  default: gpt-5.4
  provider: custom
  base_url: https://example.com/v1
toolsets:
  - hermes-cli
context:
  engine: compressor
memory:
  memory_enabled: true
  user_profile_enabled: true
  provider: byterover
  memory_char_limit: 2200
  user_char_limit: 1375
always_log_local: false
group_sessions_per_user: false
thread_sessions_per_user: true
unauthorized_dm_behavior: ignore
reset_triggers:
  - /fresh
  - /clear
session_reset:
  mode: idle
  at_hour: 6
  idle_minutes: 90
  notify: false
stt:
  enabled: false
discord:
  require_mention: true
  free_response_channels: "dev,ops"
  allowed_channels: "dev"
  auto_thread: true
  reactions: false
approvals:
  mode: manual
  timeout: 90
skills:
  external_dirs:
    - /tmp/skills-a
platform_toolsets:
  discord:
    - hermes-discord
"#,
        )
        .expect("写入 config.yaml 失败");
        fs::write(
            root.join(".env"),
            "OPENAI_API_KEY=test\nHERMES_GATEWAY_TOKEN=gw-read\n",
        )
        .expect("写入 .env 失败");

        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");
        let documents = read_config_documents(&home).expect("读取配置文档失败");

        assert_eq!(documents.workspace.model_default, "gpt-5.4");
        assert_eq!(documents.env_workspace.openai_api_key, "test");
        assert_eq!(documents.workspace.model_provider, "custom");
        assert_eq!(documents.workspace.model_base_url, "https://example.com/v1");
        assert_eq!(documents.workspace.toolsets, vec!["hermes-cli"]);
        assert_eq!(
            documents.workspace.skills_external_dirs,
            vec!["/tmp/skills-a"]
        );
        assert_eq!(
            documents.workspace.discord_free_response_channels,
            "dev,ops"
        );
        assert_eq!(documents.workspace.approvals_timeout, Some(90));
        assert_eq!(documents.workspace.platform_toolsets.len(), 1);
        assert_eq!(documents.workspace.platform_toolsets[0].platform, "discord");
        assert_eq!(documents.gateway_workspace.hermes_gateway_token, "gw-read");
        assert!(!documents.gateway_workspace.always_log_local);
        assert!(!documents.gateway_workspace.stt_enabled);
        assert!(!documents.gateway_workspace.group_sessions_per_user);
        assert!(documents.gateway_workspace.thread_sessions_per_user);
        assert_eq!(
            documents.gateway_workspace.unauthorized_dm_behavior,
            "ignore"
        );
        assert_eq!(
            documents.gateway_workspace.reset_triggers,
            vec!["/fresh".to_string(), "/clear".to_string()]
        );
        assert_eq!(documents.gateway_workspace.session_reset_mode, "idle");
        assert_eq!(documents.gateway_workspace.session_reset_at_hour, Some(6));
        assert_eq!(
            documents.gateway_workspace.session_reset_idle_minutes,
            Some(90)
        );
        assert!(!documents.gateway_workspace.session_reset_notify);
    }

    #[test]
    fn writes_structured_config_back_to_yaml() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");

        let saved = write_structured_config(
            &home,
            &ConfigWorkspace {
                model_default: "claude-sonnet-4".into(),
                model_provider: "anthropic".into(),
                model_base_url: "https://api.example.com/v1".into(),
                context_engine: "compressor".into(),
                terminal_backend: "local".into(),
                terminal_cwd: "/tmp".into(),
                personality: "technical".into(),
                streaming_enabled: true,
                memory_enabled: true,
                user_profile_enabled: false,
                memory_provider: "byterover".into(),
                memory_char_limit: Some(4096),
                user_char_limit: Some(2048),
                toolsets: vec!["hermes-cli".into(), "web".into()],
                platform_toolsets: vec![
                    PlatformToolsetBinding {
                        platform: "cli".into(),
                        toolsets: vec!["hermes-cli".into(), "web".into()],
                    },
                    PlatformToolsetBinding {
                        platform: "discord".into(),
                        toolsets: vec!["hermes-discord".into()],
                    },
                ],
                skills_external_dirs: vec!["/opt/skills".into()],
                discord_require_mention: true,
                discord_free_response_channels: "general".into(),
                discord_allowed_channels: "general,ops".into(),
                discord_auto_thread: true,
                discord_reactions: true,
                approvals_mode: "manual".into(),
                approvals_timeout: Some(120),
            },
        )
        .expect("写入结构化配置失败");

        assert_eq!(saved.workspace.model_provider, "anthropic");
        assert_eq!(saved.workspace.memory_provider, "byterover");
        assert_eq!(saved.workspace.platform_toolsets.len(), 2);

        let written = fs::read_to_string(root.join("config.yaml")).expect("读取写回 YAML 失败");
        assert!(written.contains("claude-sonnet-4"));
        assert!(written.contains("anthropic"));
        assert!(written.contains("platform_toolsets"));
        assert!(written.contains("/opt/skills"));
    }

    #[test]
    fn writes_structured_env_back_to_env_file() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");

        let saved = write_structured_env(
            &home,
            &EnvWorkspace {
                openai_api_key: "sk-openai".into(),
                openrouter_api_key: String::new(),
                anthropic_api_key: "sk-anthropic".into(),
                google_api_key: "google-key".into(),
                hf_token: "hf-token".into(),
                anyrouter_2_api_key: String::new(),
                crs_api_key: String::new(),
                siliconflow_api_key: String::new(),
                hermes_gateway_token: "gateway-token".into(),
                telegram_bot_token: "telegram-token".into(),
                telegram_home_channel: "ops-room".into(),
                telegram_reply_to_mode: "inline".into(),
                discord_bot_token: "discord-token".into(),
                discord_home_channel: "discord-main".into(),
                discord_reply_to_mode: "thread".into(),
                slack_bot_token: String::new(),
                whatsapp_enabled: true,
                terminal_modal_image: "debian_slim".into(),
                terminal_timeout: Some(120),
                terminal_lifetime_seconds: Some(900),
                browser_session_timeout: Some(600),
                browser_inactivity_timeout: Some(90),
            },
        )
        .expect("写入结构化 env 失败");

        assert_eq!(saved.env_workspace.openai_api_key, "sk-openai");
        assert!(saved.env_workspace.whatsapp_enabled);
        assert_eq!(saved.env_workspace.terminal_timeout, Some(120));

        let written = fs::read_to_string(root.join(".env")).expect("读取写回 .env 失败");
        assert!(written.contains("OPENAI_API_KEY=sk-openai"));
        assert!(written.contains("ANTHROPIC_API_KEY=sk-anthropic"));
        assert!(written.contains("GOOGLE_API_KEY=google-key"));
        assert!(written.contains("HF_TOKEN=hf-token"));
        assert!(written.contains("HERMES_GATEWAY_TOKEN=gateway-token"));
        assert!(written.contains("WHATSAPP_ENABLED=true"));
        assert!(written.contains("TERMINAL_TIMEOUT=120"));
        assert!(!written.contains("OPENROUTER_API_KEY"));
    }

    #[test]
    fn writes_structured_gateway_back_to_yaml_and_env() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");

        let saved = write_structured_gateway(
            &home,
            &GatewayWorkspace {
                hermes_gateway_token: "gw-save".into(),
                always_log_local: false,
                stt_enabled: false,
                group_sessions_per_user: false,
                thread_sessions_per_user: true,
                unauthorized_dm_behavior: "ignore".into(),
                reset_triggers: vec!["/fresh".into(), "/clear".into()],
                session_reset_mode: "daily".into(),
                session_reset_at_hour: Some(7),
                session_reset_idle_minutes: Some(180),
                session_reset_notify: false,
            },
        )
        .expect("写入结构化 gateway 失败");

        assert_eq!(saved.gateway_workspace.hermes_gateway_token, "gw-save");
        assert!(!saved.gateway_workspace.always_log_local);
        assert!(!saved.gateway_workspace.group_sessions_per_user);
        assert!(saved.gateway_workspace.thread_sessions_per_user);
        assert_eq!(saved.gateway_workspace.session_reset_mode, "daily");

        let written_yaml =
            fs::read_to_string(root.join("config.yaml")).expect("读取写回 YAML 失败");
        let written_env = fs::read_to_string(root.join(".env")).expect("读取写回 .env 失败");

        assert!(written_yaml.contains("always_log_local: false"));
        assert!(written_yaml.contains("group_sessions_per_user: false"));
        assert!(written_yaml.contains("thread_sessions_per_user: true"));
        assert!(written_yaml.contains("unauthorized_dm_behavior: ignore"));
        assert!(written_yaml.contains("mode: daily"));
        assert!(written_yaml.contains("idle_minutes: 180"));
        assert!(written_yaml.contains("/fresh"));
        assert!(written_env.contains("HERMES_GATEWAY_TOKEN=gw-save"));
    }

    #[test]
    fn reads_plugin_catalog_from_local_repo_and_marks_installed_plugins() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        let plugins_root = root.join("hermes-agent").join("plugins").join("memory");
        fs::create_dir_all(plugins_root.join("byterover")).expect("创建 byterover 目录失败");
        fs::create_dir_all(plugins_root.join("retaindb")).expect("创建 retaindb 目录失败");
        fs::write(
            plugins_root.join("byterover").join("plugin.yaml"),
            r#"name: byterover
description: "ByteRover memory"
external_dependencies:
  - name: brv
    install: "curl -fsSL https://byterover.dev/install.sh | sh"
    check: "brv --version"
"#,
        )
        .expect("写入 byterover plugin.yaml 失败");
        fs::write(
            plugins_root.join("retaindb").join("plugin.yaml"),
            r#"name: retaindb
description: "RetainDB memory"
pip_dependencies:
  - requests
requires_env:
  - RETAINDB_API_KEY
"#,
        )
        .expect("写入 retaindb plugin.yaml 失败");

        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");
        let catalog = build_plugin_catalog(
            &home,
            &PluginRuntimeSnapshot {
                installed_count: 1,
                items: vec!["byterover".into()],
                install_hint: None,
                raw_output: String::new(),
            },
        );

        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog[0].name, "byterover");
        assert!(catalog[0].installed);
        assert_eq!(catalog[0].external_dependencies.len(), 1);
        assert_eq!(catalog[1].name, "retaindb");
        assert_eq!(catalog[1].requires_env, vec!["RETAINDB_API_KEY"]);
        assert_eq!(catalog[1].pip_dependencies, vec!["requests"]);
    }

    #[test]
    fn parses_tool_summary_output() {
        let output = r#"
⚕ Tool Summary

  🖥️  CLI  (16/18)
    ✓ 🌐 Browser Automation
    ✓ 💾 Memory
  📱 Telegram  (2/18)
    ✓ 💾 Memory
    ✓ 📚 Skills
"#;

        let platforms = parse_tool_summary(output);

        assert_eq!(platforms.len(), 2);
        assert_eq!(platforms[0].name, "CLI");
        assert_eq!(platforms[0].enabled_count, 16);
        assert_eq!(platforms[0].total_count, 18);
        assert_eq!(
            platforms[0].enabled_tools,
            vec!["Browser Automation", "Memory"]
        );
        assert_eq!(platforms[1].name, "Telegram");
    }

    #[test]
    fn parses_memory_runtime_output() {
        let output = r#"
Memory status
────────────────────────────────────────
  Built-in:  always active
  Provider:  (none — built-in only)

  Installed plugins:
    • byterover  (requires API key)
    • holographic  (local)
"#;

        let snapshot = parse_memory_runtime(output);

        assert_eq!(snapshot.built_in_status, "always active");
        assert_eq!(snapshot.provider, "(none — built-in only)");
        assert_eq!(snapshot.installed_plugins.len(), 2);
        assert_eq!(snapshot.installed_plugins[0].name, "byterover");
        assert_eq!(snapshot.installed_plugins[1].availability, "local");
    }

    #[test]
    fn parses_runtime_skills_table() {
        let output = r#"
                                Installed Skills
┏━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┓
┃ Name         ┃ Category ┃ Source  ┃ Trust   ┃
┡━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━┩
│ codex        │ agents   │ builtin │ builtin │
│ browser-use  │ tools    │ local   │ local   │
└──────────────┴──────────┴─────────┴─────────┘
"#;

        let items = parse_runtime_skills(output);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "codex");
        assert_eq!(items[1].source, "local");
    }

    #[test]
    fn parses_empty_plugins_output() {
        let output = "No plugins installed.\nInstall with: hermes plugins install owner/repo\n";

        let snapshot = parse_plugin_runtime(output);

        assert_eq!(snapshot.installed_count, 0);
        assert!(snapshot.items.is_empty());
        assert_eq!(
            snapshot.install_hint.as_deref(),
            Some("Install with: hermes plugins install owner/repo")
        );
    }

    #[test]
    fn creates_local_skill_scaffold_inside_skills_dir() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");

        let detail = create_skill_file(
            &home,
            &SkillCreateRequest {
                name: "Release Notes".into(),
                category: "ops automation".into(),
                description: "生成版本发布说明".into(),
                content: "## 步骤\n\n1. 收集提交\n2. 总结亮点".into(),
                overwrite: false,
            },
        )
        .expect("创建技能脚手架失败");

        assert!(detail
            .file_path
            .ends_with("skills/ops-automation/release-notes/SKILL.md"));
        assert!(detail.content.contains("name: Release Notes"));
        assert!(detail.content.contains("## 步骤"));
    }

    #[test]
    fn builds_tool_action_args_for_platform_and_names() {
        let args = build_tool_action_args(
            "enable",
            "cli",
            &["web ".to_string(), " browser".to_string(), String::new()],
        )
        .expect("构建 tools action 参数失败");

        assert_eq!(
            args,
            vec![
                "tools".to_string(),
                "enable".to_string(),
                "--platform".to_string(),
                "cli".to_string(),
                "web".to_string(),
                "browser".to_string(),
            ]
        );
    }

    #[test]
    fn builds_plugin_action_args_for_plugin_name() {
        let args = build_plugin_action_args("disable", " local/memory-plugin ")
            .expect("构建 plugins action 参数失败");

        assert_eq!(
            args,
            vec![
                "plugins".to_string(),
                "disable".to_string(),
                "local/memory-plugin".to_string(),
            ]
        );
    }

    #[test]
    fn builds_plugin_action_args_for_registry_operations() {
        let args = build_plugin_action_args("install", " nousresearch/byterover ")
            .expect("构建 plugins install 参数失败");

        assert_eq!(
            args,
            vec![
                "plugins".to_string(),
                "install".to_string(),
                "nousresearch/byterover".to_string(),
            ]
        );
    }

    #[test]
    fn builds_skill_action_args_for_targeted_and_global_commands() {
        let search_args = build_skill_action_args("search", Some("react release notes"))
            .expect("构建 skills search 参数失败");
        let install_args = build_skill_action_args("install", Some("official/security/1password"))
            .expect("构建 skills install 参数失败");
        let update_args =
            build_skill_action_args("update", None).expect("构建 skills update 参数失败");

        assert_eq!(
            search_args,
            vec![
                "skills".to_string(),
                "search".to_string(),
                "react".to_string(),
                "release".to_string(),
                "notes".to_string(),
            ]
        );
        assert_eq!(
            install_args,
            vec![
                "skills".to_string(),
                "install".to_string(),
                "official/security/1password".to_string(),
            ]
        );
        assert_eq!(
            update_args,
            vec!["skills".to_string(), "update".to_string()]
        );
    }

    #[test]
    fn parses_tool_inventory_line_with_status_and_description() {
        let line = "✓ enabled  web  🔍 Web Search & Scraping";

        let item = parse_tool_inventory_line(line).expect("应解析出 tool inventory 行");

        assert_eq!(item.name, "web");
        assert!(item.enabled);
        assert_eq!(item.description, "Web Search & Scraping");
    }

    #[test]
    fn parses_tool_inventory_for_platform() {
        let output = r#"
Built-in toolsets (cli):
  ✓ enabled  web  🔍 Web Search & Scraping
  ✗ disabled  moa  🧠 Mixture of Agents
"#;

        let inventory = parse_tool_inventory("cli", "CLI", output);

        assert_eq!(inventory.platform_key, "cli");
        assert_eq!(inventory.display_name, "CLI");
        assert_eq!(inventory.items.len(), 2);
        assert_eq!(inventory.items[0].name, "web");
        assert!(!inventory.items[1].enabled);
    }

    #[test]
    fn reads_cron_jobs_snapshot_from_jobs_json() {
        let temp = tempdir().expect("创建临时目录失败");
        let root = temp.path().join(".hermes");
        seed_profile_root(&root, "gpt-5.4");
        fs::create_dir_all(root.join("cron")).expect("创建 cron 目录失败");
        fs::write(
            root.join("cron").join("jobs.json"),
            r#"{
              "updated_at": "2026-04-11T12:30:00+08:00",
              "jobs": [
                {
                  "id": "job_1",
                  "name": "日报汇总",
                  "prompt": "生成日报",
                  "skills": ["reporting", "notion"],
                  "script": "/tmp/fetch.py",
                  "repeat": { "times": 5, "completed": 2 },
                  "schedule": { "kind": "interval", "minutes": 60 },
                  "schedule_display": "every 60m",
                  "state": "scheduled",
                  "next_run_at": "2026-04-11T13:00:00+08:00",
                  "last_run_at": "2026-04-11T12:00:00+08:00",
                  "deliver": "telegram",
                  "enabled": true,
                  "last_status": "ok"
                },
                {
                  "id": "job_2",
                  "name": "单次提醒",
                  "prompt": "提醒我",
                  "skill": "reminder",
                  "schedule": { "kind": "once", "run_at": "2026-04-12T09:00:00+08:00" },
                  "schedule_display": "once at 2026-04-12 09:00",
                  "state": "paused",
                  "next_run_at": "2026-04-12T09:00:00+08:00",
                  "deliver": "local",
                  "enabled": false,
                  "last_error": "waiting"
                }
              ]
            }"#,
        )
        .expect("写入 jobs.json 失败");

        let home =
            resolve_hermes_home(Some("default"), Some(&root)).expect("解析 Hermes Home 失败");
        let snapshot = read_cron_jobs(&home).expect("读取 cron jobs 失败");

        assert_eq!(
            snapshot.updated_at.as_deref(),
            Some("2026-04-11T12:30:00+08:00")
        );
        assert_eq!(snapshot.jobs.len(), 2);
        assert_eq!(snapshot.jobs[0].id, "job_1");
        assert_eq!(snapshot.jobs[0].skills, vec!["reporting", "notion"]);
        assert_eq!(snapshot.jobs[0].schedule_input, "every 60m");
        assert_eq!(snapshot.jobs[0].repeat_times, Some(5));
        assert_eq!(snapshot.jobs[0].repeat_completed, 2);
        assert_eq!(snapshot.jobs[0].script.as_deref(), Some("/tmp/fetch.py"));
        assert_eq!(snapshot.jobs[1].skills, vec!["reminder"]);
        assert_eq!(snapshot.jobs[1].schedule_input, "2026-04-12T09:00:00+08:00");
        assert!(!snapshot.jobs[1].enabled);
    }

    #[test]
    fn builds_cron_create_args_with_optional_fields() {
        let request = CronCreateRequest {
            schedule: "every 2h".into(),
            prompt: Some("生成状态汇总".into()),
            name: Some("状态汇总".into()),
            deliver: Some("telegram:ops".into()),
            repeat: Some(3),
            skills: vec!["reporting".into(), "ops".into()],
            script: Some("/tmp/fetch.py".into()),
        };

        let args = build_cron_create_args(&request).expect("构建 create args 失败");

        assert_eq!(
            args,
            vec![
                "cron",
                "create",
                "every 2h",
                "--name",
                "状态汇总",
                "--deliver",
                "telegram:ops",
                "--repeat",
                "3",
                "--skill",
                "reporting",
                "--skill",
                "ops",
                "--script",
                "/tmp/fetch.py",
                "生成状态汇总",
            ]
        );
    }

    #[test]
    fn builds_cron_update_args_with_clear_flags() {
        let request = CronUpdateRequest {
            job_id: "job_123".into(),
            schedule: Some("0 9 * * *".into()),
            prompt: Some(String::new()),
            name: Some("每日提醒".into()),
            deliver: Some("local".into()),
            repeat: Some(0),
            skills: None,
            clear_skills: true,
            script: None,
            clear_script: true,
        };

        let args = build_cron_update_args(&request).expect("构建 update args 失败");

        assert_eq!(
            args,
            vec![
                "cron",
                "edit",
                "job_123",
                "--schedule",
                "0 9 * * *",
                "--prompt",
                "",
                "--name",
                "每日提醒",
                "--deliver",
                "local",
                "--repeat",
                "0",
                "--clear-skills",
                "--script",
                "",
            ]
        );
    }

    #[test]
    fn builds_cron_delete_args_with_confirm_id() {
        let request = CronDeleteRequest {
            job_id: "job-daily".into(),
            confirm_id: "job-daily".into(),
        };

        let args = build_cron_delete_args(&request).expect("构建 delete args 失败");

        assert_eq!(args, vec!["cron", "remove", "job-daily"]);
    }

    #[test]
    fn rejects_cron_delete_when_confirm_id_mismatch() {
        let result = build_cron_delete_args(&CronDeleteRequest {
            job_id: "job-daily".into(),
            confirm_id: "job-other".into(),
        });

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "删除 cron 前，确认输入必须与目标 job_id 完全一致"
        );
    }

    #[test]
    fn builds_profile_create_args_with_clone_options() {
        let request = ProfileCreateRequest {
            profile_name: "ops".into(),
            clone: true,
            clone_all: false,
            clone_from: Some("default".into()),
            no_alias: true,
        };

        let args = build_profile_create_args(&request).expect("构建 profile create args 失败");

        assert_eq!(
            args,
            vec![
                "profile",
                "create",
                "ops",
                "--clone",
                "--clone-from",
                "default",
                "--no-alias",
            ]
        );
    }

    #[test]
    fn builds_profile_rename_export_import_delete_args() {
        let rename = build_profile_rename_args(&ProfileRenameRequest {
            old_name: "ops".into(),
            new_name: "ops-next".into(),
        })
        .expect("构建 rename args 失败");
        let export = build_profile_export_args(&ProfileExportRequest {
            profile_name: "ops".into(),
            output: Some("/tmp/ops.tar.gz".into()),
        })
        .expect("构建 export args 失败");
        let import = build_profile_import_args(&ProfileImportRequest {
            archive: "/tmp/ops.tar.gz".into(),
            import_name: Some("ops-restored".into()),
        })
        .expect("构建 import args 失败");
        let delete = build_profile_delete_args(&ProfileDeleteRequest {
            profile_name: "ops".into(),
            confirm_name: "ops".into(),
        })
        .expect("构建 delete args 失败");

        assert_eq!(rename, vec!["profile", "rename", "ops", "ops-next"]);
        assert_eq!(
            export,
            vec!["profile", "export", "ops", "--output", "/tmp/ops.tar.gz"]
        );
        assert_eq!(
            import,
            vec![
                "profile",
                "import",
                "/tmp/ops.tar.gz",
                "--name",
                "ops-restored"
            ]
        );
        assert_eq!(delete, vec!["profile", "delete", "--yes", "ops"]);
    }

    #[test]
    fn builds_profile_alias_create_and_delete_args() {
        let create_primary = build_profile_alias_create_args(&ProfileAliasCreateRequest {
            profile_name: "ops".into(),
            alias_name: Some("ops".into()),
        })
        .expect("构建同名 alias args 失败");
        let create_custom = build_profile_alias_create_args(&ProfileAliasCreateRequest {
            profile_name: "ops".into(),
            alias_name: Some("ops-prod".into()),
        })
        .expect("构建自定义 alias args 失败");
        let delete_custom = build_profile_alias_delete_args(&ProfileAliasDeleteRequest {
            profile_name: "ops".into(),
            alias_name: "ops-prod".into(),
            confirm_name: "ops-prod".into(),
        })
        .expect("构建删除 alias args 失败");

        assert_eq!(create_primary, vec!["profile", "alias", "ops"]);
        assert_eq!(
            create_custom,
            vec!["profile", "alias", "ops", "--name", "ops-prod"]
        );
        assert_eq!(
            delete_custom,
            vec!["profile", "alias", "ops", "--remove", "--name", "ops-prod"]
        );
    }

    #[test]
    fn rejects_profile_alias_delete_when_confirmation_mismatches() {
        let result = build_profile_alias_delete_args(&ProfileAliasDeleteRequest {
            profile_name: "ops".into(),
            alias_name: "ops-prod".into(),
            confirm_name: "wrong".into(),
        });

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "删除 alias 前，确认输入必须与目标 alias 名称完全一致"
        );
    }

    #[test]
    fn lists_profile_aliases_from_wrapper_scripts() {
        let temp = tempdir().expect("创建临时目录失败");
        let wrapper_root = temp.path().join("bin");
        fs::create_dir_all(&wrapper_root).expect("创建 wrapper 目录失败");
        fs::write(
            wrapper_root.join("research"),
            "#!/bin/sh\nexec hermes -p research \"$@\"\n",
        )
        .expect("写入 research wrapper 失败");
        fs::write(
            wrapper_root.join("rs"),
            "#!/bin/sh\nexec hermes -p research \"$@\"\n",
        )
        .expect("写入 rs wrapper 失败");
        fs::write(
            wrapper_root.join("ops"),
            "#!/bin/sh\nexec hermes -p ops \"$@\"\n",
        )
        .expect("写入 ops wrapper 失败");

        let aliases = list_profile_aliases("research", Some(&wrapper_root))
            .expect("读取 profile aliases 失败");

        assert_eq!(aliases.len(), 2);
        assert_eq!(aliases[0].name, "research");
        assert!(aliases[0].is_primary);
        assert_eq!(aliases[1].name, "rs");
        assert!(!aliases[1].is_primary);
    }

    #[test]
    fn rejects_profile_delete_when_confirmation_mismatches() {
        let result = build_profile_delete_args(&ProfileDeleteRequest {
            profile_name: "ops".into(),
            confirm_name: "not-ops".into(),
        });

        assert!(result.is_err());
    }

    #[allow(dead_code)]
    fn _path(value: &str) -> PathBuf {
        PathBuf::from(value)
    }

    fn seed_profile_root(root: &PathBuf, model: &str) {
        fs::create_dir_all(root.join("skills")).expect("创建 skills 目录失败");
        fs::create_dir_all(root.join("logs")).expect("创建 logs 目录失败");
        fs::create_dir_all(root.join("memories")).expect("创建 memories 目录失败");
        fs::write(
            root.join("config.yaml"),
            format!("model:\n  default: {model}\n"),
        )
        .expect("写入 config.yaml 失败");
        fs::write(root.join(".env"), "OPENAI_API_KEY=test\n").expect("写入 .env 失败");
        fs::write(root.join("SOUL.md"), "# persona\n").expect("写入 SOUL.md 失败");
        fs::write(
            root.join("gateway_state.json"),
            "{\"gateway_state\":\"running\"}",
        )
        .expect("写入 gateway_state.json 失败");
        fs::write(root.join("state.db"), "").expect("写入 state.db 失败");
    }
}
