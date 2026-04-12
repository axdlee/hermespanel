import { invoke } from '@tauri-apps/api/core';

import type { DiagnosticKind } from './diagnostics';
import type {
  CommandRunResult,
  ConfigDocuments,
  CronCreateRequest,
  CronDeleteRequest,
  CronJobsSnapshot,
  CronUpdateRequest,
  DashboardSnapshot,
  DesktopOpenRequest,
  DesktopTerminalRequest,
  ExtensionsSnapshot,
  InstallationSnapshot,
  LogReadResult,
  MemoryFileDetail,
  MemoryFileSummary,
  ProfileAliasCreateRequest,
  ProfileAliasDeleteRequest,
  ProfileCreateRequest,
  ProfileDeleteRequest,
  ProfileExportRequest,
  ProfileImportRequest,
  ProfileRenameRequest,
  ProfilesSnapshot,
  SessionDetail,
  SessionRecord,
  SkillItem,
} from '../types';

const desktopOnlyMessage = '当前页面运行在浏览器预览环境，HermesPanel 的控制能力仅在 Tauri 桌面端可用。请使用 npm run tauri:dev 打开桌面客户端。';

function resolveTauriInvoke() {
  if (typeof window === 'undefined') {
    return null;
  }

  const runtime = (window as Window & {
    __TAURI_INTERNALS__?: {
      invoke?: typeof invoke;
    };
  }).__TAURI_INTERNALS__;

  return typeof runtime?.invoke === 'function' ? invoke : null;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriInvoke = resolveTauriInvoke();
  if (!tauriInvoke) {
    throw new Error(desktopOnlyMessage);
  }

  return tauriInvoke<T>(command, args);
}

function withProfile(profile?: string, args?: Record<string, unknown>) {
  return {
    ...(args ?? {}),
    profile: profile ?? null,
  };
}

export const api = {
  getProfilesSnapshot: () => call<ProfilesSnapshot>('get_profiles_snapshot'),
  setActiveProfile: (profileName: string) =>
    call<ProfilesSnapshot>('set_active_profile', { profileName }),
  createProfile: (request: ProfileCreateRequest) =>
    call<CommandRunResult>('create_profile', { request }),
  createProfileAlias: (request: ProfileAliasCreateRequest) =>
    call<CommandRunResult>('create_profile_alias', { request }),
  renameProfile: (request: ProfileRenameRequest) =>
    call<CommandRunResult>('rename_profile', { request }),
  exportProfile: (request: ProfileExportRequest) =>
    call<CommandRunResult>('export_profile', { request }),
  importProfile: (request: ProfileImportRequest) =>
    call<CommandRunResult>('import_profile', { request }),
  deleteProfile: (request: ProfileDeleteRequest) =>
    call<CommandRunResult>('delete_profile', { request }),
  deleteProfileAlias: (request: ProfileAliasDeleteRequest) =>
    call<CommandRunResult>('delete_profile_alias', { request }),
  getDashboardSnapshot: (profile?: string) =>
    call<DashboardSnapshot>('get_dashboard_snapshot', withProfile(profile)),
  getInstallationSnapshot: (profile?: string) =>
    call<InstallationSnapshot>('get_installation_snapshot', withProfile(profile)),
  getConfigDocuments: (profile?: string) =>
    call<ConfigDocuments>('get_config_documents', withProfile(profile)),
  getExtensionsSnapshot: (profile?: string) =>
    call<ExtensionsSnapshot>('get_extensions_snapshot', withProfile(profile)),
  runToolAction: (action: 'enable' | 'disable', platform: string, names: string[], profile?: string) =>
    call<CommandRunResult>('run_tool_action', withProfile(profile, { action, platform, names })),
  runPluginAction: (action: 'enable' | 'disable', name: string, profile?: string) =>
    call<CommandRunResult>('run_plugin_action', withProfile(profile, { action, name })),
  saveConfigYaml: (content: string, profile?: string) =>
    call<void>('save_config_yaml', withProfile(profile, { content })),
  saveEnvFile: (content: string, profile?: string) =>
    call<void>('save_env_file', withProfile(profile, { content })),
  listSessions: (limit?: number, profile?: string) =>
    call<SessionRecord[]>('list_sessions', withProfile(profile, { limit })),
  getSessionDetail: (sessionId: string, profile?: string) =>
    call<SessionDetail>('get_session_detail', withProfile(profile, { sessionId })),
  listSkills: (profile?: string) => call<SkillItem[]>('list_skills', withProfile(profile)),
  getCronJobs: (profile?: string) =>
    call<CronJobsSnapshot>('get_cron_jobs', withProfile(profile)),
  createCronJob: (request: CronCreateRequest, profile?: string) =>
    call<CommandRunResult>('create_cron_job', withProfile(profile, { request })),
  updateCronJob: (request: CronUpdateRequest, profile?: string) =>
    call<CommandRunResult>('update_cron_job', withProfile(profile, { request })),
  deleteCronJob: (request: CronDeleteRequest, profile?: string) =>
    call<CommandRunResult>('delete_cron_job', withProfile(profile, { request })),
  openInFinder: (request: DesktopOpenRequest) =>
    call<CommandRunResult>('open_in_finder', { request }),
  openInTerminal: (request: DesktopTerminalRequest) =>
    call<CommandRunResult>('open_in_terminal', { request }),
  runCronAction: (action: string, jobId: string, profile?: string) =>
    call<CommandRunResult>('run_cron_action', withProfile(profile, { action, jobId })),
  readLog: (
    logName: string,
    limit?: number,
    level?: string,
    contains?: string,
    profile?: string,
  ) => call<LogReadResult>('read_log', {
    ...withProfile(profile),
    logName,
    limit,
    level: level || null,
    contains: contains || null,
  }),
  listMemoryFiles: (profile?: string) =>
    call<MemoryFileSummary[]>('list_memory_files', withProfile(profile)),
  readMemoryFile: (key: string, profile?: string) =>
    call<MemoryFileDetail>('read_memory_file', withProfile(profile, { key })),
  writeMemoryFile: (key: string, content: string, profile?: string) =>
    call<void>('write_memory_file', withProfile(profile, { key, content })),
  runGatewayAction: (action: string, profile?: string) =>
    call<CommandRunResult>('run_gateway_action', withProfile(profile, { action })),
  runDiagnostic: (kind: DiagnosticKind, profile?: string) =>
    call<CommandRunResult>('run_diagnostic', withProfile(profile, { kind })),
};
