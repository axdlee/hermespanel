import type { DiagnosticKind } from './diagnostics';
import type {
  AppPageKey,
  ConfigFocus,
  ConfigPageIntent,
  DiagnosticsPageIntent,
  ExtensionsPageIntent,
  ExtensionsRawKind,
  GatewayPageIntent,
  LogsPageIntent,
  SessionNavigationContext,
} from '../pages/types';

const GATEWAY_SOURCE_PATTERN =
  /(gateway|telegram|discord|slack|feishu|dingtalk|wechat|wecom|line|whatsapp|remote|bot)/i;

export interface DrilldownSeed {
  sourcePage: AppPageKey;
  headline: string;
  description: string;
  context?: SessionNavigationContext;
}

interface DrilldownBaseOptions {
  headline?: string;
  description?: string;
  context?: SessionNavigationContext;
}

interface LogsDrilldownOptions extends DrilldownBaseOptions {
  logName?: string;
  level?: string;
  contains?: string;
  limit?: string;
}

interface DiagnosticsDrilldownOptions extends DrilldownBaseOptions {
  suggestedCommand?: DiagnosticKind;
  logName?: string;
}

interface ExtensionsDrilldownOptions extends DrilldownBaseOptions {
  rawKind?: ExtensionsRawKind;
  selectedPlatform?: string;
  query?: string;
  sourceFilter?: string;
  toolNames?: string[];
  pluginName?: string;
}

interface GatewayDrilldownOptions extends DrilldownBaseOptions {
  platformName?: string;
}

interface ConfigDrilldownOptions extends DrilldownBaseOptions {
  focus?: ConfigFocus;
  suggestedCommand?: DiagnosticKind;
}

function resolvedContext(seed: DrilldownSeed, options?: DrilldownBaseOptions) {
  return options?.context ?? seed.context;
}

function buildBase(seed: DrilldownSeed, options?: DrilldownBaseOptions) {
  return {
    sourcePage: seed.sourcePage,
    headline: options?.headline ?? seed.headline,
    description: options?.description ?? seed.description,
    context: resolvedContext(seed, options),
  };
}

function primaryTool(context?: SessionNavigationContext) {
  return context?.toolNames.find(item => item.trim().length > 0);
}

function gatewayLikeContext(context?: SessionNavigationContext) {
  return GATEWAY_SOURCE_PATTERN.test(context?.source ?? '');
}

function fallbackLogName(context?: SessionNavigationContext) {
  if (gatewayLikeContext(context)) {
    return 'gateway.error';
  }
  if ((context?.toolNames.length ?? 0) > 0) {
    return 'agent';
  }
  return 'errors';
}

function fallbackLogContains(context?: SessionNavigationContext) {
  if (gatewayLikeContext(context)) {
    return context?.source ?? '';
  }
  return primaryTool(context) ?? '';
}

export function inferDiagnosticCommand(
  logName?: string,
  context?: SessionNavigationContext
): DiagnosticKind {
  const normalized = logName?.trim().toLowerCase() ?? '';
  if (normalized === 'gateway.error') {
    return 'gateway-status-deep';
  }
  if (normalized === 'gateway' || gatewayLikeContext(context)) {
    return 'gateway-status';
  }
  if ((context?.toolNames.length ?? 0) > 0) {
    return 'tools-summary';
  }
  if (normalized === 'agent') {
    return 'doctor';
  }
  return 'config-check';
}

export function buildLogsDrilldownIntent(
  seed: DrilldownSeed,
  options?: LogsDrilldownOptions
): LogsPageIntent {
  const context = resolvedContext(seed, options);
  return {
    kind: 'logs',
    ...buildBase(seed, options),
    logName: options?.logName ?? fallbackLogName(context),
    level: options?.level ?? '',
    contains: options?.contains ?? fallbackLogContains(context),
    limit: options?.limit ?? '160',
  };
}

export function buildDiagnosticsDrilldownIntent(
  seed: DrilldownSeed,
  options?: DiagnosticsDrilldownOptions
): DiagnosticsPageIntent {
  const context = resolvedContext(seed, options);
  const logName = options?.logName ?? fallbackLogName(context);
  return {
    kind: 'diagnostics',
    ...buildBase(seed, options),
    suggestedCommand: options?.suggestedCommand ?? inferDiagnosticCommand(logName, context),
    logName,
  };
}

export function buildExtensionsDrilldownIntent(
  seed: DrilldownSeed,
  options?: ExtensionsDrilldownOptions
): ExtensionsPageIntent {
  const context = resolvedContext(seed, options);
  return {
    kind: 'extensions',
    ...buildBase(seed, options),
    rawKind: options?.rawKind ?? 'tools',
    selectedPlatform: options?.selectedPlatform,
    query: options?.query ?? context?.toolNames.join(' ') ?? '',
    sourceFilter: options?.sourceFilter,
    toolNames: options?.toolNames ?? context?.toolNames ?? [],
    pluginName: options?.pluginName,
  };
}

export function buildGatewayDrilldownIntent(
  seed: DrilldownSeed,
  options?: GatewayDrilldownOptions
): GatewayPageIntent {
  const context = resolvedContext(seed, options);
  return {
    kind: 'gateway',
    ...buildBase(seed, options),
    platformName:
      options?.platformName ?? (gatewayLikeContext(context) ? context?.source : undefined),
  };
}

export function buildConfigDrilldownIntent(
  seed: DrilldownSeed,
  options?: ConfigDrilldownOptions
): ConfigPageIntent {
  const context = resolvedContext(seed, options);
  const defaultFocus: ConfigFocus =
    (context?.toolNames.length ?? 0) > 0
      ? 'toolsets'
      : gatewayLikeContext(context)
        ? 'context'
        : 'model';

  return {
    kind: 'config',
    ...buildBase(seed, options),
    focus: options?.focus ?? defaultFocus,
    suggestedCommand: options?.suggestedCommand,
  };
}
