mod application;
mod commands;
mod error;
mod infrastructure;
mod models;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::profiles::get_profiles_snapshot,
            commands::profiles::set_active_profile,
            commands::profiles::create_profile,
            commands::profiles::create_profile_alias,
            commands::profiles::rename_profile,
            commands::profiles::export_profile,
            commands::profiles::import_profile,
            commands::profiles::delete_profile,
            commands::profiles::delete_profile_alias,
            commands::dashboard::get_dashboard_snapshot,
            commands::dashboard::get_installation_snapshot,
            commands::dashboard::run_installation_action,
            commands::config::get_config_documents,
            commands::config::save_config_yaml,
            commands::config::save_env_file,
            commands::config::save_structured_config,
            commands::config::save_structured_env,
            commands::config::save_structured_gateway,
            commands::config::run_config_compat_action,
            commands::extensions::get_extensions_snapshot,
            commands::extensions::run_tool_action,
            commands::extensions::run_plugin_action,
            commands::sessions::list_sessions,
            commands::sessions::get_session_detail,
            commands::skills::list_skills,
            commands::skills::read_skill_file,
            commands::skills::save_skill_file,
            commands::skills::create_skill,
            commands::skills::run_skill_action,
            commands::desktop::open_in_finder,
            commands::desktop::open_in_terminal,
            commands::cron::get_cron_jobs,
            commands::cron::run_cron_action,
            commands::cron::create_cron_job,
            commands::cron::update_cron_job,
            commands::cron::delete_cron_job,
            commands::logs::read_log,
            commands::memory::list_memory_files,
            commands::memory::read_memory_file,
            commands::memory::write_memory_file,
            commands::gateway::run_gateway_action,
            commands::gateway::run_diagnostic,
        ])
        .run(tauri::generate_context!())
        .expect("启动 HermesPanel 失败");
}
