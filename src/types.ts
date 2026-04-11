export interface GatewayPlatformState {
  name: string;
  state: string;
  updatedAt?: string | null;
  errorMessage?: string | null;
}

export interface GatewayStateSnapshot {
  pid?: number | null;
  gatewayState: string;
  exitReason?: string | null;
  restartRequested: boolean;
  activeAgents: number;
  updatedAt?: string | null;
  platforms: GatewayPlatformState[];
}

export interface ConfigSummary {
  modelDefault?: string | null;
  modelProvider?: string | null;
  modelBaseUrl?: string | null;
  terminalBackend?: string | null;
  terminalCwd?: string | null;
  toolsets: string[];
  personality?: string | null;
  memoryEnabled?: boolean | null;
  streamingEnabled?: boolean | null;
}

export interface ConfigDocuments {
  hermesHome: string;
  configPath: string;
  envPath: string;
  configYaml: string;
  envFile: string;
  summary: ConfigSummary;
}

export interface DashboardCounts {
  sessions: number;
  skills: number;
  logFiles: number;
  cronJobs: number;
  configuredPlatforms: number;
}

export interface MemoryFileSummary {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  updatedAt?: string | null;
}

export interface MemoryFileDetail {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  content: string;
}

export interface SessionRecord {
  id: string;
  title?: string | null;
  source: string;
  model?: string | null;
  startedAt: number;
  endedAt?: number | null;
  messageCount: number;
  toolCallCount: number;
  preview: string;
}

export interface SessionMessage {
  id: number;
  role: string;
  content: string;
  toolName?: string | null;
  timestamp: number;
}

export interface SessionDetail {
  session: SessionRecord;
  messages: SessionMessage[];
}

export interface SkillItem {
  name: string;
  description: string;
  category: string;
  relativePath: string;
  filePath: string;
  preview: string;
}

export interface LogReadResult {
  name: string;
  filePath: string;
  lines: string[];
}

export interface CommandRunResult {
  command: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DashboardSnapshot {
  profileName: string;
  hermesHome: string;
  hermesBinary: string;
  versionOutput: string;
  config: ConfigSummary;
  gateway?: GatewayStateSnapshot | null;
  counts: DashboardCounts;
  recentSessions: SessionRecord[];
  memoryFiles: MemoryFileSummary[];
  warnings: string[];
}

export interface ProfileSummary {
  name: string;
  homePath: string;
  isDefault: boolean;
  isActive: boolean;
  modelDefault?: string | null;
  gatewayState?: string | null;
  sessionCount: number;
  skillCount: number;
  envExists: boolean;
  soulExists: boolean;
  aliasPath?: string | null;
}

export interface ProfilesSnapshot {
  activeProfile: string;
  profiles: ProfileSummary[];
}

export interface ProfileCreateRequest {
  profileName: string;
  clone: boolean;
  cloneAll: boolean;
  cloneFrom?: string | null;
  noAlias: boolean;
}

export interface ProfileRenameRequest {
  oldName: string;
  newName: string;
}

export interface ProfileExportRequest {
  profileName: string;
  output?: string | null;
}

export interface ProfileImportRequest {
  archive: string;
  importName?: string | null;
}

export interface ProfileDeleteRequest {
  profileName: string;
  confirmName: string;
}

export interface CronJobItem {
  id: string;
  name: string;
  prompt: string;
  scheduleDisplay: string;
  scheduleInput: string;
  state: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  deliver: string;
  skills: string[];
  enabled: boolean;
  repeatTimes?: number | null;
  repeatCompleted: number;
  script?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  lastDeliveryError?: string | null;
}

export interface CronJobsSnapshot {
  jobsPath: string;
  updatedAt?: string | null;
  jobs: CronJobItem[];
}

export interface CronCreateRequest {
  schedule: string;
  prompt?: string | null;
  name?: string | null;
  deliver?: string | null;
  repeat?: number | null;
  skills: string[];
  script?: string | null;
}

export interface CronUpdateRequest {
  jobId: string;
  schedule?: string | null;
  prompt?: string | null;
  name?: string | null;
  deliver?: string | null;
  repeat?: number | null;
  skills?: string[] | null;
  clearSkills: boolean;
  script?: string | null;
  clearScript: boolean;
}

export interface CronDeleteRequest {
  jobId: string;
  confirmId: string;
}

export interface DesktopOpenRequest {
  path: string;
  revealInFinder: boolean;
}

export type NoticeTone = 'success' | 'error' | 'info';

export interface NoticeState {
  tone: NoticeTone;
  message: string;
}
