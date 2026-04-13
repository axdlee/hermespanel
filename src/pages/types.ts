import type { DiagnosticKind } from '../lib/diagnostics';
import type { NoticeTone, ProfilesSnapshot } from '../types';

export type AppPageKey =
  | 'dashboard'
  | 'profiles'
  | 'gateway'
  | 'config'
  | 'sessions'
  | 'skills'
  | 'extensions'
  | 'cron'
  | 'logs'
  | 'memory'
  | 'diagnostics';

export interface SessionNavigationContext {
  sessionId: string;
  title: string;
  source: string;
  model?: string | null;
  preview: string;
  toolNames: string[];
}

interface PageIntentBase {
  sourcePage: AppPageKey;
  headline: string;
  description: string;
  context?: SessionNavigationContext;
}

export interface LogsPageIntent extends PageIntentBase {
  kind: 'logs';
  logName?: string;
  level?: string;
  contains?: string;
  limit?: string;
}

export interface DiagnosticsPageIntent extends PageIntentBase {
  kind: 'diagnostics';
  suggestedCommand?: DiagnosticKind;
  logName?: string;
}

export type ExtensionsRawKind = 'tools' | 'memory' | 'plugins' | 'skills';

export interface ExtensionsPageIntent extends PageIntentBase {
  kind: 'extensions';
  rawKind?: ExtensionsRawKind;
  selectedPlatform?: string;
  query?: string;
  sourceFilter?: string;
  toolNames?: string[];
  pluginName?: string;
}

export type MemorySlotKey = 'soul' | 'memory' | 'user';

export interface MemoryPageIntent extends PageIntentBase {
  kind: 'memory';
  selectedKey?: MemorySlotKey;
}

export type ConfigFocus = 'model' | 'context' | 'toolsets' | 'memory' | 'credentials';

export interface ConfigPageIntent extends PageIntentBase {
  kind: 'config';
  focus?: ConfigFocus;
  suggestedCommand?: DiagnosticKind;
}

export interface GatewayPageIntent extends PageIntentBase {
  kind: 'gateway';
  platformName?: string;
}

export type PageIntent =
  | LogsPageIntent
  | DiagnosticsPageIntent
  | ExtensionsPageIntent
  | MemoryPageIntent
  | ConfigPageIntent
  | GatewayPageIntent;

export function isLogsPageIntent(value: PageIntent | null): value is LogsPageIntent {
  return value?.kind === 'logs';
}

export function isDiagnosticsPageIntent(value: PageIntent | null): value is DiagnosticsPageIntent {
  return value?.kind === 'diagnostics';
}

export function isExtensionsPageIntent(value: PageIntent | null): value is ExtensionsPageIntent {
  return value?.kind === 'extensions';
}

export function isMemoryPageIntent(value: PageIntent | null): value is MemoryPageIntent {
  return value?.kind === 'memory';
}

export function isConfigPageIntent(value: PageIntent | null): value is ConfigPageIntent {
  return value?.kind === 'config';
}

export function isGatewayPageIntent(value: PageIntent | null): value is GatewayPageIntent {
  return value?.kind === 'gateway';
}

export interface PageProps {
  notify: (tone: NoticeTone, message: string) => void;
  profile: string;
  profiles: ProfilesSnapshot | null;
  refreshProfiles: (preferredProfile?: string) => Promise<void>;
  pageIntent: PageIntent | null;
  consumePageIntent: () => void;
  navigate: (page: AppPageKey, intent?: PageIntent | null) => void;
}
