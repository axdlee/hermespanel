import { GATEWAY_DIAGNOSTIC_COMMANDS } from '../lib/diagnostics';
import { formatTimestamp, truncate } from '../lib/format';
import { cronTone, platformTone } from '../lib/runtime';
import {
  buttonHtml,
  emptyStateHtml,
  escapeHtml,
  firstLine,
  keyValueRowsHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';
import { infoTipHtml, shortcutCardHtml } from './workbench-helpers';

const RESET_MODE_OPTIONS = [
  { key: 'both', label: '双重重置' },
  { key: 'daily', label: '按天重置' },
  { key: 'idle', label: '闲置重置' },
  { key: 'none', label: '不自动重置' },
];

const DM_BEHAVIOR_OPTIONS = [
  { key: 'pair', label: '先配对再放行' },
  { key: 'ignore', label: '直接忽略' },
];

export const PLATFORM_WORKSPACE_PRESETS = [
  {
    id: 'telegram',
    label: 'Telegram',
    runtimeName: 'telegram',
    tokenKey: 'telegramBotToken',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'telegram bot token',
    channelKey: 'telegramHomeChannel',
    channelLabel: 'Home Channel',
    channelPlaceholder: 'home channel / chat id',
    modeKey: 'telegramReplyToMode',
    modeDefault: 'reply',
  },
  {
    id: 'discord',
    label: 'Discord',
    runtimeName: 'discord',
    tokenKey: 'discordBotToken',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'discord bot token',
    channelKey: 'discordHomeChannel',
    channelLabel: 'Home Channel',
    channelPlaceholder: 'channel id / alias',
    modeKey: 'discordReplyToMode',
    modeDefault: 'thread',
  },
  {
    id: 'slack',
    label: 'Slack',
    runtimeName: 'slack',
    tokenKey: 'slackBotToken',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'xoxb-...',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    runtimeName: 'whatsapp',
    toggleKey: 'whatsappEnabled',
  },
];

const CHANNEL_REPLY_MODE_OPTIONS = ['reply', 'thread', 'inline'];

const GATEWAY_POLICY_GROUPS = [
  {
    key: 'reset',
    label: '重置',
    description: '会话重置与触发词。',
  },
  {
    key: 'access',
    label: '准入',
    description: '私聊准入与会话隔离。',
  },
  {
    key: 'runtime',
    label: '令牌与特性',
    description: 'Token、本地日志和语音转写。',
  },
];

export function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'gateway',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'gateway',
        headline: '查看 Gateway 状态',
        description: '查看消息平台、会话策略和远端作业。',
      };
}

export function cloneGatewayWorkspace(workspace = {}) {
  return {
    hermesGatewayToken: workspace.hermesGatewayToken || '',
    alwaysLogLocal: workspace.alwaysLogLocal ?? true,
    sttEnabled: workspace.sttEnabled ?? true,
    groupSessionsPerUser: workspace.groupSessionsPerUser ?? true,
    threadSessionsPerUser: workspace.threadSessionsPerUser ?? false,
    unauthorizedDmBehavior: workspace.unauthorizedDmBehavior || 'pair',
    resetTriggers: [...((workspace.resetTriggers && workspace.resetTriggers.length) ? workspace.resetTriggers : ['/new', '/reset'])],
    sessionResetMode: workspace.sessionResetMode || 'both',
    sessionResetAtHour: workspace.sessionResetAtHour ?? 4,
    sessionResetIdleMinutes: workspace.sessionResetIdleMinutes ?? 1440,
    sessionResetNotify: workspace.sessionResetNotify ?? true,
  };
}

export function cloneEnvWorkspace(workspace = {}) {
  return {
    openaiApiKey: workspace.openaiApiKey || '',
    openrouterApiKey: workspace.openrouterApiKey || '',
    anthropicApiKey: workspace.anthropicApiKey || '',
    googleApiKey: workspace.googleApiKey || '',
    hfToken: workspace.hfToken || '',
    anyrouter2ApiKey: workspace.anyrouter2ApiKey || '',
    crsApiKey: workspace.crsApiKey || '',
    siliconflowApiKey: workspace.siliconflowApiKey || '',
    hermesGatewayToken: workspace.hermesGatewayToken || '',
    telegramBotToken: workspace.telegramBotToken || '',
    telegramHomeChannel: workspace.telegramHomeChannel || '',
    telegramReplyToMode: workspace.telegramReplyToMode || '',
    discordBotToken: workspace.discordBotToken || '',
    discordHomeChannel: workspace.discordHomeChannel || '',
    discordReplyToMode: workspace.discordReplyToMode || '',
    slackBotToken: workspace.slackBotToken || '',
    whatsappEnabled: Boolean(workspace.whatsappEnabled),
    terminalModalImage: workspace.terminalModalImage || '',
    terminalTimeout: workspace.terminalTimeout ?? null,
    terminalLifetimeSeconds: workspace.terminalLifetimeSeconds ?? null,
    browserSessionTimeout: workspace.browserSessionTimeout ?? null,
    browserInactivityTimeout: workspace.browserInactivityTimeout ?? null,
  };
}

export function splitLineValues(value) {
  return String(value ?? '')
    .split(/\r?\n|[,，；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseOptionalNumber(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function gatewayWorkspaceDirty(view) {
  if (!view.config?.gatewayWorkspace || !view.gatewayDraft) {
    return false;
  }
  return JSON.stringify(view.gatewayDraft) !== JSON.stringify(cloneGatewayWorkspace(view.config.gatewayWorkspace));
}

export function envWorkspaceDirty(view) {
  if (!view.config?.envWorkspace || !view.envDraft) {
    return false;
  }
  return JSON.stringify(view.envDraft) !== JSON.stringify(cloneEnvWorkspace(view.config.envWorkspace));
}

export function tokenPreview(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '未设置';
  }
  if (normalized.length <= 10) {
    return normalized;
  }
  return `${normalized.slice(0, 4)}•••${normalized.slice(-4)}`;
}

export function channelReadiness(value) {
  return String(value ?? '').trim().length > 0;
}

function findPlatformSnapshot(platforms, runtimeName) {
  const target = String(runtimeName || '').trim().toLowerCase();
  return (platforms ?? []).find((item) => String(item.name || '').trim().toLowerCase() === target) || null;
}

function platformDraftReady(preset, draft) {
  if (!draft || !preset) {
    return false;
  }
  if (preset.toggleKey) {
    return Boolean(draft[preset.toggleKey]);
  }
  return [preset.tokenKey, preset.channelKey]
    .filter(Boolean)
    .some((key) => channelReadiness(draft[key]));
}

function platformDraftHasValue(preset, draft) {
  if (!draft || !preset) {
    return false;
  }
  if (preset.toggleKey) {
    return Boolean(draft[preset.toggleKey]);
  }
  return [preset.tokenKey, preset.channelKey, preset.modeKey]
    .filter(Boolean)
    .some((key) => channelReadiness(draft[key]));
}

export function countConfiguredPlatformDrafts(draft) {
  return PLATFORM_WORKSPACE_PRESETS.filter((preset) => platformDraftReady(preset, draft)).length;
}

function optionLabel(options, value, fallback = '未设置') {
  return options.find((item) => item.key === value)?.label || fallback;
}

function gatewayResetSummary(draft) {
  const pieces = [];
  if (draft.sessionResetMode !== 'none') {
    if (draft.sessionResetAtHour !== null && draft.sessionResetAtHour !== undefined) {
      pieces.push(`${draft.sessionResetAtHour} 点`);
    }
    if (draft.sessionResetIdleMinutes !== null && draft.sessionResetIdleMinutes !== undefined) {
      pieces.push(`idle ${draft.sessionResetIdleMinutes} 分钟`);
    }
  }
  pieces.push(`${draft.resetTriggers.length} 个触发词`);
  return pieces.join(' · ');
}

function gatewayIsolationSummary(draft) {
  return [
    draft.groupSessionsPerUser ? '群聊按用户隔离' : '群聊共享会话',
    draft.threadSessionsPerUser ? '线程按用户隔离' : '线程共享会话',
  ].join(' · ');
}

function gatewayFeatureSummary(draft) {
  return [
    draft.alwaysLogLocal ? '本地日志保留' : '按策略落盘',
    draft.sttEnabled ? '语音转写开启' : '语音转写关闭',
  ].join(' · ');
}

function renderGatewayPolicyDisclosure({ title, summary, pills = '', body, open = false }) {
  return `
    <details class="compact-disclosure"${open ? ' open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">${escapeHtml(title)}</strong>
            <p class="platform-workspace-copy">${escapeHtml(summary)}</p>
          </div>
          ${pills ? `<div class="pill-row">${pills}</div>` : ''}
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${body}
      </div>
    </details>
  `;
}

function resolveGatewayPolicyGroup(activeKey) {
  return GATEWAY_POLICY_GROUPS.find((item) => item.key === activeKey) ?? GATEWAY_POLICY_GROUPS[0];
}

function renderGatewayPolicyTabs(activeKey) {
  return `
    <div class="tab-bar tab-bar-dense">
      ${GATEWAY_POLICY_GROUPS.map((group) => `
        <button
          type="button"
          class="tab ${group.key === activeKey ? 'active' : ''}"
          data-action="focus-gateway-policy"
          data-section="${escapeHtml(group.key)}"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function runtimePillTone(snapshot, ready) {
  if (snapshot?.state) {
    const tone = platformTone(snapshot.state);
    return tone === 'good' ? 'good' : tone === 'bad' ? 'warn' : 'neutral';
  }
  return ready ? 'neutral' : 'warn';
}

function runtimeDotTone(snapshot, ready) {
  if (snapshot?.state) {
    return statusToneToDot(platformTone(snapshot.state));
  }
  return ready ? 'warning' : 'stopped';
}

function platformRuntimeLabel(snapshot, ready) {
  if (snapshot?.state) {
    return snapshot.state;
  }
  return ready ? '待验证' : '未配置';
}

function platformMetaSummary(preset, draft) {
  const pieces = [];
  if (preset.tokenKey) {
    pieces.push(channelReadiness(draft[preset.tokenKey]) ? 'Token 已写' : '缺 Token');
  }
  if (preset.channelKey) {
    pieces.push(channelReadiness(draft[preset.channelKey]) ? `Home ${draft[preset.channelKey]}` : '缺 Home');
  }
  if (preset.modeKey) {
    pieces.push(channelReadiness(draft[preset.modeKey]) ? `Reply ${draft[preset.modeKey]}` : '未设 Reply');
  }
  if (preset.toggleKey) {
    pieces.push(draft[preset.toggleKey] ? '已启用' : '未启用');
  }
  return pieces.join(' · ') || '尚未配置';
}

function renderPlatformSignalPills(preset, draft) {
  const items = [];
  if (preset.tokenKey) {
    items.push(pillHtml(channelReadiness(draft[preset.tokenKey]) ? 'Token' : '缺 Token', channelReadiness(draft[preset.tokenKey]) ? 'good' : 'warn'));
  }
  if (preset.channelKey) {
    items.push(pillHtml(channelReadiness(draft[preset.channelKey]) ? 'Home' : '缺 Home', channelReadiness(draft[preset.channelKey]) ? 'neutral' : 'warn'));
  }
  if (preset.modeKey) {
    const mode = String(draft[preset.modeKey] || '').trim();
    items.push(pillHtml(mode ? `Reply ${mode}` : '未设 Reply', mode ? 'neutral' : 'warn'));
  }
  if (preset.toggleKey) {
    items.push(pillHtml(draft[preset.toggleKey] ? '已启用' : '未启用', draft[preset.toggleKey] ? 'good' : 'warn'));
  }
  return items.join('');
}

function platformMissingFields(preset, draft) {
  const missing = [];
  if (preset.tokenKey && !channelReadiness(draft[preset.tokenKey])) {
    missing.push('Token');
  }
  if (preset.channelKey && !channelReadiness(draft[preset.channelKey])) {
    missing.push('Home');
  }
  if (preset.modeKey && !channelReadiness(draft[preset.modeKey])) {
    missing.push('Reply');
  }
  if (preset.toggleKey && !draft[preset.toggleKey]) {
    missing.push('启用');
  }
  return missing;
}

function defaultPlatformFocusId(draft, platforms) {
  const unhealthy = PLATFORM_WORKSPACE_PRESETS.find((preset) => {
    const snapshot = findPlatformSnapshot(platforms, preset.runtimeName);
    return snapshot?.state && platformTone(snapshot.state) !== 'good';
  });
  if (unhealthy) {
    return unhealthy.id;
  }

  const incomplete = PLATFORM_WORKSPACE_PRESETS.find((preset) => {
    const hasValue = platformDraftHasValue(preset, draft);
    return hasValue && platformMissingFields(preset, draft).length > 0;
  });
  if (incomplete) {
    return incomplete.id;
  }

  return PLATFORM_WORKSPACE_PRESETS.find((preset) => platformDraftHasValue(preset, draft))?.id
    || PLATFORM_WORKSPACE_PRESETS[0]?.id
    || '';
}

function renderPlatformGovernanceCard(view, preset, snapshot, focused) {
  const draft = view.envDraft ?? cloneEnvWorkspace(view.config?.envWorkspace);
  const ready = platformDraftReady(preset, draft);
  const runtimeLabel = platformRuntimeLabel(snapshot, ready);
  const runtimeTone = runtimePillTone(snapshot, ready);
  const missing = platformMissingFields(preset, draft);
  const meta = snapshot?.errorMessage
    ? snapshot.errorMessage
    : missing.length > 0
      ? `待补 ${missing.join(' / ')}`
      : ready
        ? (snapshot?.updatedAt ? `最近 ${formatTimestamp(snapshot.updatedAt)}` : '配置齐备，等待联调')
        : '还没开始接入';

  return `
    <button
      type="button"
      class="platform-governance-card${focused ? ' platform-governance-card-active' : ''}"
      data-action="focus-platform-card"
      data-platform="${escapeHtml(preset.id)}"
    >
      <div class="platform-governance-card-head">
        <div class="platform-governance-card-copy">
          <div class="platform-workspace-title-row">
            ${statusDotHtml(runtimeDotTone(snapshot, ready))}
            <strong>${escapeHtml(preset.label)}</strong>
          </div>
          <p class="platform-governance-card-meta">${escapeHtml(meta)}</p>
        </div>
        ${pillHtml(runtimeLabel, runtimeTone)}
      </div>
      <div class="platform-governance-pills">
        ${renderPlatformSignalPills(preset, draft)}
      </div>
    </button>
  `;
}

function statusToneToDot(tone) {
  if (tone === 'good') {
    return 'running';
  }
  if (tone === 'bad') {
    return 'stopped';
  }
  return 'warning';
}

export function renderGatewayTabs(view) {
  const tabs = [
    { key: 'control', label: '策略' },
    { key: 'platforms', label: '平台' },
    { key: 'jobs', label: '作业' },
    { key: 'diagnostics', label: '诊断' },
    { key: 'runtime', label: '输出' },
  ];

  return `
    <div class="tab-bar tab-bar-dense">
      ${tabs.map((tab) => `
        <button
          type="button"
          class="tab ${view.workspaceTab === tab.key ? 'active' : ''}"
          data-action="switch-workspace-tab"
          data-tab="${escapeHtml(tab.key)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `).join('')}
    </div>
  `;
}

export function renderGatewayRail(view, context) {
  const {
    connectedPlatforms,
    config,
    failingRemoteJobs,
    gateway,
    gatewayStatePath,
    installation,
    logsDir,
    remoteJobs,
    unhealthyPlatforms,
    warnings,
  } = context;
  const draft = view.gatewayDraft ?? cloneGatewayWorkspace(config?.gatewayWorkspace);
  const envDraft = view.envDraft ?? cloneEnvWorkspace(config?.envWorkspace);
  const gatewayDirty = gatewayWorkspaceDirty(view);
  const envDirty = envWorkspaceDirty(view);
  const workspaceDirty = gatewayDirty || envDirty;
  const gatewayRunning = gateway?.gatewayState === 'running';
  const restartLabel = gatewayRunning ? '重启 Gateway' : '启动 Gateway';
  const configuredPlatforms = countConfiguredPlatformDrafts(envDraft);
  const railBusy = Boolean(view.runningAction || view.savingGateway || view.savingEnv);

  return `
    <div class="workspace-rail-header">
      <div>
        <strong>概览</strong>
      </div>
      ${workspaceDirty ? pillHtml('待保存', 'warn') : pillHtml('已同步', 'good')}
    </div>
    ${keyValueRowsHtml([
      { label: 'Gateway', value: gateway?.gatewayState || '未检测到' },
      { label: 'Platforms', value: `${connectedPlatforms}/${(gateway?.platforms ?? []).length}` },
      { label: '已配通道', value: `${configuredPlatforms}/${PLATFORM_WORKSPACE_PRESETS.length}` },
      { label: 'Remote Jobs', value: `${remoteJobs.length} / 失败 ${failingRemoteJobs.length}` },
      { label: '会话模式', value: draft.threadSessionsPerUser ? '线程隔离' : '线程共享' },
      { label: '私聊准入', value: optionLabel(DM_BEHAVIOR_OPTIONS, draft.unauthorizedDmBehavior, '未设置') },
    ])}
    ${warnings.length > 0
      ? `<div class="warning-stack top-gap">${warnings.slice(0, 3).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
      : `<p class="helper-text">平台异常 ${escapeHtml(String(unhealthyPlatforms.length))} 个，当前没有新的阻塞告警。</p>`}
    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">常用入口</span>
        ${pillHtml(view.workspaceTab, 'neutral')}
      </div>
      <div class="workspace-shortcut-grid">
        ${shortcutCardHtml({
          action: 'switch-workspace-tab',
          label: '策略',
          meta: gatewayDirty ? '策略待保存' : `${draft.sessionResetMode} · 已同步`,
          active: view.workspaceTab === 'control',
          attrs: { 'data-tab': 'control' },
        })}
        ${shortcutCardHtml({
          action: 'switch-workspace-tab',
          label: '平台',
          meta: envDirty ? '通道草稿待保存' : `${connectedPlatforms}/${(gateway?.platforms ?? []).length || 0} 已连通`,
          active: view.workspaceTab === 'platforms',
          attrs: { 'data-tab': 'platforms' },
        })}
        ${shortcutCardHtml({
          action: 'switch-workspace-tab',
          label: '作业',
          meta: remoteJobs.length ? `${remoteJobs.length} 个远端作业` : '当前无远端作业',
          active: view.workspaceTab === 'jobs',
          attrs: { 'data-tab': 'jobs' },
        })}
        ${shortcutCardHtml({
          action: 'switch-workspace-tab',
          label: '诊断',
          meta: warnings.length ? `${warnings.length} 条提醒` : '运行态稳定',
          active: view.workspaceTab === 'diagnostics',
          attrs: { 'data-tab': 'diagnostics' },
        })}
        ${shortcutCardHtml({
          action: 'switch-workspace-tab',
          label: '输出',
          meta: view.lastResult?.label || '查看最近输出',
          active: view.workspaceTab === 'runtime',
          attrs: { 'data-tab': 'runtime' },
        })}
      </div>
    </section>
    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">联动导航</span>
        ${view.workspaceTab === 'platforms'
          ? pillHtml(envDirty ? '通道待保存' : '通道已同步', envDirty ? 'warn' : 'good')
          : pillHtml(gatewayRunning ? '服务联机' : '服务待机', gatewayRunning ? 'good' : 'warn')}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-grid">
        ${view.workspaceTab === 'platforms'
          ? `
            ${buttonHtml({ action: 'switch-workspace-tab', label: '策略接管', attrs: { 'data-tab': 'control' } })}
            ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: railBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'switch-workspace-tab', label: '最新输出', attrs: { 'data-tab': 'runtime' } })}
            ${buttonHtml({ action: 'reset-env-workspace', label: '重置草稿', disabled: railBusy || !envDirty })}
          `
          : `
            ${buttonHtml({ action: 'switch-workspace-tab', label: '平台连接', attrs: { 'data-tab': 'platforms' } })}
            ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: railBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'switch-workspace-tab', label: '最新输出', attrs: { 'data-tab': 'runtime' } })}
            ${buttonHtml({ action: 'refresh', label: '刷新状态', disabled: railBusy })}
          `}
      </div>
    </section>
    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">文件与联动</span>
        ${pillHtml(`${failingRemoteJobs.length} 失败`, failingRemoteJobs.length > 0 ? 'warn' : 'good')}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-grid">
        ${buttonHtml({ action: 'open-gateway-state', label: '状态文件', disabled: Boolean(view.runningAction) || !installation.gatewayStateExists })}
        ${buttonHtml({ action: 'open-logs', label: '日志目录', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
        ${buttonHtml({ action: 'goto-logs', label: '日志页' })}
        ${buttonHtml({ action: 'goto-extensions', label: '扩展页' })}
        ${buttonHtml({ action: 'goto-cron', label: 'Cron 页' })}
        ${buttonHtml({ action: 'goto-diagnostics', label: '诊断页' })}
      </div>
      <p class="helper-text">${escapeHtml(`gateway_state.json: ${gatewayStatePath}`)}</p>
      <p class="helper-text">${escapeHtml(`logs: ${logsDir}`)}</p>
    </section>
    <section class="workspace-rail-section workspace-compat-card">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">系统边界动作</span>
        ${buttonHtml({ action: 'toggle-service-actions', label: view.showServiceActions ? '收起' : '展开' })}
      </div>
      <p class="helper-text">安装和卸载 Service 会改系统状态，因此保留在弱化区。</p>
      ${view.showServiceActions ? `
        <div class="workspace-compat-panel">
          ${buttonHtml({ action: 'gateway-install', label: '安装 Service', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'gateway-uninstall', label: '卸载 Service', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        </div>
      ` : ''}
    </section>
  `;
}

function renderChannelHealthItem(label, envValue, homeChannel, replyMode, platformState) {
  const ready = channelReadiness(envValue);
  const tone = ready ? (platformTone(platformState || 'idle') === 'good' ? 'good' : platformTone(platformState || 'idle') === 'bad' ? 'warn' : 'neutral') : 'warn';
  const pieces = [];
  pieces.push(ready ? '已写 Token' : '缺 Token');
  if (String(homeChannel ?? '').trim()) {
    pieces.push(`home ${homeChannel}`);
  }
  if (String(replyMode ?? '').trim()) {
    pieces.push(`reply ${replyMode}`);
  }

  return `
    <div class="service-card">
      <div class="service-info">
        ${statusDotHtml(ready ? 'running' : 'warning')}
        <div>
          <div class="service-name">${escapeHtml(label)}</div>
          <div class="service-desc">${escapeHtml(pieces.join(' · ') || '尚未配置')}</div>
        </div>
      </div>
      <div class="service-actions">
        ${pillHtml(platformState || (ready ? '待启动' : '未配置'), tone)}
      </div>
    </div>
  `;
}

function renderChannelBridgePills(env, platformStates) {
  return PLATFORM_WORKSPACE_PRESETS.map((preset) => {
    if (preset.toggleKey) {
      const enabled = Boolean(env[preset.toggleKey]);
      return pillHtml(`${preset.label} ${enabled ? '已启用' : '未启用'}`, enabled ? 'good' : 'neutral');
    }

    const ready = channelReadiness(env[preset.tokenKey]);
    const state = platformStates.get(preset.runtimeName) || (ready ? '待验证' : '未配置');
    const tone = ready
      ? (platformTone(state) === 'good' ? 'good' : platformTone(state) === 'bad' ? 'warn' : 'neutral')
      : 'warn';
    return pillHtml(`${preset.label} ${ready ? '已配' : '未配'}`, tone);
  }).join('');
}

export function renderControlWorkspace(view, context) {
  const { config, gateway, gatewayRunning, installation, remoteJobs, unhealthyPlatforms } = context;
  const draft = view.gatewayDraft ?? cloneGatewayWorkspace(config?.gatewayWorkspace);
  const env = view.envDraft ?? cloneEnvWorkspace(config?.envWorkspace);
  const platformStates = new Map((gateway?.platforms ?? []).map((item) => [item.name, item.state]));
  const dirty = gatewayWorkspaceDirty(view);
  const resetModeLabel = optionLabel(RESET_MODE_OPTIONS, draft.sessionResetMode, '未设置');
  const dmBehaviorLabel = optionLabel(DM_BEHAVIOR_OPTIONS, draft.unauthorizedDmBehavior, '未设置');
  const activePolicyGroup = resolveGatewayPolicyGroup(view.gatewayPolicySection);
  const activePolicyDisclosure = activePolicyGroup.key === 'reset'
    ? renderGatewayPolicyDisclosure({
      title: '会话重置',
      summary: `${resetModeLabel} · ${gatewayResetSummary(draft)}`,
      pills: `${pillHtml(resetModeLabel, 'neutral')}${pillHtml(draft.sessionResetNotify ? '重置通知' : '静默重置', draft.sessionResetNotify ? 'good' : 'neutral')}`,
      open: true,
      body: `
        <div class="selection-chip-grid">
          ${RESET_MODE_OPTIONS.map((item) => buttonHtml({
            action: 'set-reset-mode',
            label: item.label,
            className: `selection-chip${draft.sessionResetMode === item.key ? ' selection-chip-active' : ''}`,
            kind: draft.sessionResetMode === item.key ? 'primary' : 'secondary',
            attrs: { 'data-value': item.key },
          })).join('')}
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>Reset Hour</span>
            <input class="search-input" id="gateway-reset-hour" type="number" min="0" max="23" value="${escapeHtml(draft.sessionResetAtHour ?? '')}" placeholder="4">
          </label>
          <label class="field-stack">
            <span>Idle Minutes</span>
            <input class="search-input" id="gateway-reset-idle" type="number" min="1" value="${escapeHtml(draft.sessionResetIdleMinutes ?? '')}" placeholder="1440">
          </label>
          <label class="field-stack">
            <span>Reset Triggers</span>
            <input class="search-input" id="gateway-reset-triggers" value="${escapeHtml(draft.resetTriggers.join(', '))}" placeholder="/new, /reset">
          </label>
        </div>
        <div class="checkbox-row">
          <label>
            <input type="checkbox" id="gateway-reset-notify" ${draft.sessionResetNotify ? 'checked' : ''}>
            <span>自动重置时通知</span>
          </label>
        </div>
      `,
    })
    : activePolicyGroup.key === 'access'
      ? renderGatewayPolicyDisclosure({
        title: '准入与隔离',
        summary: `${dmBehaviorLabel} · ${gatewayIsolationSummary(draft)}`,
        pills: `${pillHtml(dmBehaviorLabel, 'neutral')}${pillHtml(draft.groupSessionsPerUser || draft.threadSessionsPerUser ? '按用户隔离' : '共享会话', draft.groupSessionsPerUser || draft.threadSessionsPerUser ? 'good' : 'neutral')}`,
        open: true,
        body: `
          <div class="selection-chip-grid">
            ${DM_BEHAVIOR_OPTIONS.map((item) => buttonHtml({
              action: 'set-dm-behavior',
              label: item.label,
              className: `selection-chip${draft.unauthorizedDmBehavior === item.key ? ' selection-chip-active' : ''}`,
              kind: draft.unauthorizedDmBehavior === item.key ? 'primary' : 'secondary',
              attrs: { 'data-value': item.key },
            })).join('')}
          </div>
          <div class="checkbox-row">
            <label>
              <input type="checkbox" id="gateway-group-sessions" ${draft.groupSessionsPerUser ? 'checked' : ''}>
              <span>群聊按用户隔离</span>
            </label>
            <label>
              <input type="checkbox" id="gateway-thread-sessions" ${draft.threadSessionsPerUser ? 'checked' : ''}>
              <span>线程按用户隔离</span>
            </label>
          </div>
        `,
      })
      : renderGatewayPolicyDisclosure({
        title: '令牌与运行特性',
        summary: `${draft.hermesGatewayToken.trim() ? 'Gateway Token 已写入' : 'Gateway Token 未写入'} · ${gatewayFeatureSummary(draft)}`,
        pills: `${pillHtml(draft.hermesGatewayToken.trim() ? 'Token 已写' : '缺 Token', draft.hermesGatewayToken.trim() ? 'good' : 'warn')}${pillHtml(draft.sttEnabled ? 'STT On' : 'STT Off', draft.sttEnabled ? 'good' : 'neutral')}`,
        open: true,
        body: `
          <div class="form-grid">
            <label class="field-stack">
              <span>Gateway Token</span>
              <input class="search-input" id="gateway-token" value="${escapeHtml(draft.hermesGatewayToken)}" placeholder="HERMES_GATEWAY_TOKEN">
            </label>
          </div>
          <div class="checkbox-row">
            <label>
              <input type="checkbox" id="gateway-always-log-local" ${draft.alwaysLogLocal ? 'checked' : ''}>
              <span>始终保留本地日志</span>
            </label>
            <label>
              <input type="checkbox" id="gateway-stt-enabled" ${draft.sttEnabled ? 'checked' : ''}>
              <span>启用语音转写</span>
            </label>
          </div>
        `,
      });

  return `
    <div class="compact-overview-grid compact-overview-grid-dense">
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <strong>服务状态</strong>
          </div>
          ${pillHtml(gatewayRunning ? '运行中' : '待启动', gatewayRunning ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: '服务接管', value: gatewayRunning ? '已经接管' : '还没启动' },
          { label: '异常入口', value: unhealthyPlatforms.length > 0 ? `${unhealthyPlatforms.length} 个待处理` : '当前正常' },
          { label: '远端投递', value: remoteJobs.length > 0 ? `${remoteJobs.length} 个依赖` : '当前没有' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: gatewayRunning ? '重启 Gateway' : '启动 Gateway', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'gateway-stop', label: '停止 Gateway', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'toggle-service-actions', label: view.showServiceActions ? '收起系统动作' : '系统动作' })}
        </div>
        <p class="helper-text">系统级安装和卸载放在侧栏里。</p>
      </section>

      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <strong>消息入口</strong>
          </div>
          ${buttonHtml({ action: 'switch-workspace-tab', label: '进入平台', attrs: { 'data-tab': 'platforms' } })}
        </div>
        <div class="platform-bridge-pill-row">
          ${renderChannelBridgePills(env, platformStates)}
        </div>
        <p class="helper-text">详细通道字段请到“平台”里编辑。</p>
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'switch-workspace-tab', label: '平台连接', kind: 'primary', attrs: { 'data-tab': 'platforms' } })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        </div>
      </section>
    </div>

    <section class="shell-card shell-card-dense top-gap">
      <div class="shell-card-header">
        <div>
          <strong>策略设置</strong>
          <p class="shell-card-copy">策略、重置和运行特性都集中在这里。</p>
        </div>
        <div class="toolbar">
          ${dirty ? pillHtml('待保存', 'warn') : pillHtml('已同步', 'good')}
          ${pillHtml(resetModeLabel, 'neutral')}
        </div>
      </div>

      <section class="workspace-summary-strip workspace-summary-strip-dense">
        <section class="summary-mini-card">
          <span class="summary-mini-label">Gateway Token</span>
          <strong class="summary-mini-value">${escapeHtml(draft.hermesGatewayToken.trim() ? '已写入' : '未写入')}</strong>
          <span class="summary-mini-meta">${escapeHtml(tokenPreview(draft.hermesGatewayToken))}</span>
        </section>
        <section class="summary-mini-card">
          <span class="summary-mini-label">自动重置</span>
          <strong class="summary-mini-value">${escapeHtml(resetModeLabel)}</strong>
          <span class="summary-mini-meta">${escapeHtml(gatewayResetSummary(draft))}</span>
        </section>
        <section class="summary-mini-card">
          <span class="summary-mini-label">私聊准入</span>
          <strong class="summary-mini-value">${escapeHtml(dmBehaviorLabel)}</strong>
          <span class="summary-mini-meta">${escapeHtml(gatewayIsolationSummary(draft))}</span>
        </section>
        <section class="summary-mini-card">
          <span class="summary-mini-label">运行特性</span>
          <strong class="summary-mini-value">${escapeHtml(draft.sttEnabled ? '语音转写开启' : '语音转写关闭')}</strong>
          <span class="summary-mini-meta">${escapeHtml(gatewayFeatureSummary(draft))}</span>
        </section>
      </section>

      <div class="toolbar top-gap">
        ${buttonHtml({ action: 'save-gateway-workspace', label: view.savingGateway ? '保存中…' : '保存策略', disabled: view.savingGateway })}
        ${buttonHtml({ action: 'save-gateway-workspace-restart', label: view.savingGateway ? '处理中…' : (gatewayRunning ? '保存并重启 Gateway' : '保存并启动 Gateway'), kind: 'primary', disabled: Boolean(view.savingGateway || view.runningAction || !installation.binaryFound) })}
        ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        ${buttonHtml({ action: 'diagnostic-gateway-status-deep', label: '网关深检', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        ${buttonHtml({ action: 'switch-workspace-tab', label: '平台连接', attrs: { 'data-tab': 'platforms' } })}
      </div>

      <div class="workspace-main-header top-gap">
        <div>
          <strong>当前分组</strong>
          <p class="workspace-main-copy">${escapeHtml(activePolicyGroup.description)}</p>
        </div>
        ${pillHtml(activePolicyGroup.label, 'neutral')}
      </div>
      ${renderGatewayPolicyTabs(activePolicyGroup.key)}
      <div class="compact-disclosure-stack top-gap">
        ${activePolicyDisclosure}
      </div>
    </section>
  `;
}

function renderPlatformWorkspaceCard(view, preset, snapshot) {
  const draft = view.envDraft ?? cloneEnvWorkspace(view.config?.envWorkspace);
  const ready = platformDraftReady(preset, draft);
  const hasValue = platformDraftHasValue(preset, draft);
  const modeValue = preset.modeKey ? draft[preset.modeKey] : '';
  const runtimeLabel = platformRuntimeLabel(snapshot, ready);
  const runtimeTone = runtimePillTone(snapshot, ready);
  const missing = platformMissingFields(preset, draft);
  const runtimeMeta = snapshot?.updatedAt
    ? `最近 ${formatTimestamp(snapshot.updatedAt)}`
    : ready
      ? '保存并重启后校验运行态'
      : '先补配置再接入';
  const fieldRows = [];

  if (preset.tokenKey) {
    fieldRows.push(`
      <label class="field-stack">
        <span>${escapeHtml(preset.tokenLabel)}</span>
        <input
          class="search-input"
          id="platform-${escapeHtml(preset.id)}-token"
          value="${escapeHtml(draft[preset.tokenKey])}"
          placeholder="${escapeHtml(preset.tokenPlaceholder || '')}"
          spellcheck="false"
          autocomplete="off"
        >
      </label>
    `);
  }

  if (preset.channelKey) {
    fieldRows.push(`
      <label class="field-stack">
        <span>${escapeHtml(preset.channelLabel)}</span>
        <input
          class="search-input"
          id="platform-${escapeHtml(preset.id)}-channel"
          value="${escapeHtml(draft[preset.channelKey])}"
          placeholder="${escapeHtml(preset.channelPlaceholder || '')}"
        >
      </label>
    `);
  }

  if (preset.modeKey) {
    fieldRows.push(`
      <label class="field-stack">
        <span>Reply Mode</span>
        <input
          class="search-input"
          id="platform-${escapeHtml(preset.id)}-mode"
          value="${escapeHtml(modeValue)}"
          placeholder="${escapeHtml(preset.modeDefault || 'reply')}"
        >
      </label>
    `);
  }

  return `
    <details class="compact-disclosure platform-disclosure workspace-section-anchor" data-platform-card="${escapeHtml(preset.id)}" ${view.activePlatformFocus === preset.id ? 'open' : ''}>
      <summary class="compact-disclosure-summary platform-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <div class="platform-workspace-title-row">
              ${statusDotHtml(runtimeDotTone(snapshot, ready))}
              <strong>${escapeHtml(preset.label)}</strong>
            </div>
            <p class="platform-workspace-copy">${escapeHtml(platformMetaSummary(preset, draft))}</p>
          </div>
          <div class="platform-workspace-pills">
            ${pillHtml(runtimeLabel, runtimeTone)}
            ${hasValue ? pillHtml('已配置', 'neutral') : pillHtml('未配置', 'warn')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body platform-disclosure-body">
        ${snapshot?.errorMessage
          ? `
            <div class="danger-copy-compact platform-runtime-note">
              <strong>最近错误</strong>
              <p>${escapeHtml(snapshot.errorMessage)}</p>
            </div>
          `
          : `<div class="platform-runtime-meta">${escapeHtml(missing.length > 0 ? `待补 ${missing.join(' / ')} · ${runtimeMeta}` : runtimeMeta)}</div>`}
        <div class="platform-signal-row">
          ${renderPlatformSignalPills(preset, draft)}
        </div>
        ${fieldRows.length > 0 ? `<div class="form-grid platform-form-grid">${fieldRows.join('')}</div>` : ''}
        ${preset.toggleKey
          ? `
            <div class="checkbox-row top-gap platform-toggle-row">
              <label>
                <input type="checkbox" id="platform-${escapeHtml(preset.id)}-enabled" ${draft[preset.toggleKey] ? 'checked' : ''}>
                <span>启用 ${escapeHtml(preset.label)} 通道</span>
              </label>
            </div>
          `
          : ''}
        ${preset.modeKey
          ? `
            <div class="selection-chip-grid top-gap platform-mode-strip">
              ${CHANNEL_REPLY_MODE_OPTIONS.map((mode) => buttonHtml({
                action: 'set-platform-mode',
                label: mode,
                className: `selection-chip${modeValue === mode ? ' selection-chip-active' : ''}`,
                kind: modeValue === mode ? 'primary' : 'secondary',
                attrs: {
                  'data-platform': preset.id,
                  'data-value': mode,
                },
              })).join('')}
            </div>
          `
          : ''}
        <div class="toolbar top-gap platform-card-toolbar">
          ${(preset.modeKey || preset.toggleKey)
            ? buttonHtml({ action: 'apply-platform-preset', label: '推荐值', attrs: { 'data-platform': preset.id } })
            : ''}
          ${buttonHtml({ action: 'clear-platform-draft', label: '清空', disabled: !hasValue, attrs: { 'data-platform': preset.id } })}
          ${buttonHtml({ action: 'platform-logs', label: '日志', attrs: { 'data-platform': snapshot?.name || preset.runtimeName } })}
          ${buttonHtml({ action: 'platform-diagnostics', label: '诊断', attrs: { 'data-platform': snapshot?.name || preset.runtimeName } })}
        </div>
      </div>
    </details>
  `;
}

export function renderPlatformsWorkspace(view, context) {
  const { connectedPlatforms, gatewayRunning, installation, platforms, unhealthyPlatforms } = context;
  const draft = view.envDraft ?? cloneEnvWorkspace(view.config?.envWorkspace);
  const configuredPlatforms = countConfiguredPlatformDrafts(draft);
  const dirty = envWorkspaceDirty(view);
  const focusId = view.activePlatformFocus || defaultPlatformFocusId(draft, platforms);
  const focusedPreset = PLATFORM_WORKSPACE_PRESETS.find((preset) => preset.id === focusId) || null;
  const focusedSnapshot = focusedPreset ? findPlatformSnapshot(platforms, focusedPreset.runtimeName) : null;
  const incompletePlatforms = PLATFORM_WORKSPACE_PRESETS.filter((preset) => {
    const hasValue = platformDraftHasValue(preset, draft);
    return hasValue && platformMissingFields(preset, draft).length > 0;
  }).length;

  return `
    <div class="page-stack">
      <section class="shell-card shell-card-dense platform-focus-card">
        <div class="shell-card-header model-focus-head">
          <div class="model-focus-title-wrap">
            <div>
              <strong>通道设置</strong>
            </div>
            <div class="model-focus-title">
              <div class="model-focus-title-copy">
                <strong class="model-focus-name">${escapeHtml(focusedPreset?.label || '消息平台')}</strong>
                <div class="pill-row">
                  ${pillHtml(dirty ? '通道待保存' : '通道已同步', dirty ? 'warn' : 'good')}
                  ${pillHtml(gatewayRunning ? 'Gateway 已联机' : 'Gateway 待启动', gatewayRunning ? 'good' : 'warn')}
                  ${pillHtml('直写 .env', 'neutral')}
                </div>
              </div>
            </div>
          </div>
          ${pillHtml(focusedPreset?.label || '聚焦平台', focusedPreset ? 'good' : 'neutral')}
        </div>

        <section class="workspace-summary-strip workspace-summary-strip-dense">
          <section class="summary-mini-card">
            <span class="summary-mini-label">接入骨架</span>
            <strong class="summary-mini-value">${escapeHtml(`${configuredPlatforms}/${PLATFORM_WORKSPACE_PRESETS.length}`)}</strong>
            <span class="summary-mini-meta">已填至少一项平台字段</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">运行连接</span>
            <strong class="summary-mini-value">${escapeHtml(`${connectedPlatforms}/${platforms.length || 0}`)}</strong>
            <span class="summary-mini-meta">${escapeHtml(unhealthyPlatforms.length > 0 ? `${unhealthyPlatforms.length} 个平台待排障` : '当前没有新的平台告警')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">待补平台</span>
            <strong class="summary-mini-value">${escapeHtml(String(incompletePlatforms))}</strong>
            <span class="summary-mini-meta">${escapeHtml(incompletePlatforms > 0 ? '建议先补齐缺项再联调' : '当前没有半配置平台')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">联调模式</span>
            <strong class="summary-mini-value">${escapeHtml(gatewayRunning ? '保存并重启' : '保存并启动')}</strong>
            <span class="summary-mini-meta">${escapeHtml(installation.binaryFound ? '客户端内直接闭环验证' : '当前仅可保存配置')}</span>
          </section>
        </section>

        <div class="platform-governance-grid top-gap">
          ${PLATFORM_WORKSPACE_PRESETS.map((preset) => renderPlatformGovernanceCard(
            view,
            preset,
            findPlatformSnapshot(platforms, preset.runtimeName),
            focusId === preset.id,
          )).join('')}
        </div>

        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'save-env-workspace', label: view.savingEnv ? '保存中…' : '保存通道配置', kind: dirty ? 'primary' : 'secondary', disabled: Boolean(view.runningAction || view.savingEnv || view.savingGateway) })}
          ${buttonHtml({ action: 'save-env-workspace-restart', label: view.savingEnv ? '处理中…' : (gatewayRunning ? '保存并重启 Gateway' : '保存并启动 Gateway'), kind: 'primary', disabled: Boolean(view.runningAction || view.savingEnv || view.savingGateway || !installation.binaryFound) })}
          ${buttonHtml({ action: 'reset-env-workspace', label: '重置通道草稿', disabled: Boolean(view.runningAction || view.savingEnv || !dirty) })}
          ${buttonHtml({ action: 'diagnostic-gateway-status-deep', label: '网关深检', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        </div>
      </section>

      <section class="panel panel-nested top-gap">
        <div class="workspace-main-header">
          <div>
            <strong>${escapeHtml(focusedPreset?.label || '当前平台')} 细项</strong>
            <p class="workspace-main-copy">这里只显示当前选中的平台。</p>
          </div>
          <div class="pill-row">
            ${focusedSnapshot?.state ? pillHtml(focusedSnapshot.state, runtimePillTone(focusedSnapshot, true)) : ''}
            ${focusedPreset ? pillHtml(focusedPreset.label, 'neutral') : ''}
          </div>
        </div>
        <div class="platform-disclosure-stack">
          ${focusedPreset
            ? renderPlatformWorkspaceCard(
              { ...view, activePlatformFocus: focusId },
              focusedPreset,
              focusedSnapshot,
            )
            : emptyStateHtml('暂无可编辑平台', '当前还没有可聚焦的平台配置。')}
        </div>
      </section>
    </div>
  `;
}

export function renderGatewayQuickActions(view, context) {
  const { gatewayRunning, installation } = context;
  const refreshDisabled = Boolean(view.refreshing || view.savingGateway || view.savingEnv);

  if (view.workspaceTab === 'platforms') {
    return `
      <div class="quick-actions">
        ${buttonHtml({ action: 'switch-workspace-tab', label: '策略接管', attrs: { 'data-tab': 'control' } })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        ${buttonHtml({ action: 'refresh', label: refreshDisabled ? '同步中…' : '刷新状态', disabled: refreshDisabled })}
      </div>
    `;
  }

  if (view.workspaceTab === 'control') {
    return `
      <div class="quick-actions">
        ${buttonHtml({ action: 'switch-workspace-tab', label: '平台连接', attrs: { 'data-tab': 'platforms' } })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        ${buttonHtml({ action: 'refresh', label: refreshDisabled ? '同步中…' : '刷新状态', disabled: refreshDisabled })}
      </div>
    `;
  }

  return `
    <div class="quick-actions">
      ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
      ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
      ${buttonHtml({ action: 'switch-workspace-tab', label: '最新输出', attrs: { 'data-tab': 'runtime' } })}
      ${buttonHtml({ action: 'refresh', label: refreshDisabled ? '同步中…' : '刷新状态', disabled: refreshDisabled })}
    </div>
  `;
}

export function renderJobsWorkspace(remoteJobs) {
  return remoteJobs.length
    ? `
      <div class="service-stack">
        ${remoteJobs.map((job) => `
          <div class="service-card">
            <div class="service-info">
              ${statusDotHtml(statusToneToDot(cronTone(job)))}
              <div>
                <div class="service-name">${escapeHtml(job.name)}</div>
                <div class="service-desc">${escapeHtml(job.lastDeliveryError || job.lastError || truncate(job.prompt || '无 prompt', 132))}</div>
                <div class="service-desc service-path">${escapeHtml(`${job.id} · 下次 ${formatTimestamp(job.nextRunAt)} · 最近 ${formatTimestamp(job.lastRunAt)}`)}</div>
              </div>
            </div>
            <div class="service-actions">
              ${pillHtml(job.deliver, 'warn')}
              ${buttonHtml({ action: 'job-logs', label: '查看日志', attrs: { 'data-job': job.id, 'data-deliver': job.deliver } })}
            </div>
          </div>
        `).join('')}
      </div>
    `
    : emptyStateHtml('暂无远端作业', '当前 profile 还没有依赖 Gateway 的远端交付任务。');
}

function renderGatewayResultReceipt(payload, emptyTitle, emptyDescription) {
  if (!payload) {
    return emptyStateHtml(emptyTitle, emptyDescription);
  }

  const stdoutPreview = firstLine(payload.result.stdout, payload.result.stderr ? 'stderr 可展开查看' : 'stdout 为空');
  const stderrPreview = firstLine(payload.result.stderr, '无 stderr');

  return `
    <div class="result-stack">
      ${keyValueRowsHtml([
        { label: '动作', value: payload.label || '动作执行' },
        { label: '退出码', value: String(payload.result.exitCode ?? '—') },
        { label: '结果', value: payload.result.success ? '成功' : '失败' },
        { label: 'stdout 摘要', value: truncate(stdoutPreview, 72) },
      ])}
      <p class="workspace-inline-meta">${escapeHtml(`原始动作: ${payload.result.command || '—'}`)}</p>
      ${payload.result.stderr ? `<p class="workspace-inline-meta">${escapeHtml(`stderr 摘要: ${truncate(stderrPreview, 72)}`)}</p>` : ''}
    </div>
  `;
}

function renderGatewayRawOutput(payload) {
  if (!payload) {
    return '<pre class="code-block tall">暂无输出</pre>';
  }

  const blocks = [];
  if (payload.result.stdout) {
    blocks.push(`<pre class="code-block tall">${escapeHtml(payload.result.stdout)}</pre>`);
  }
  if (payload.result.stderr) {
    blocks.push(`<pre class="code-block tall">${escapeHtml(payload.result.stderr)}</pre>`);
  }

  return blocks.length
    ? blocks.join('')
    : '<pre class="code-block tall">stdout / stderr 当前都为空</pre>';
}

export function renderDiagnosticsWorkspace(view, installation) {
  const lastExitCode = view.lastResult?.result?.exitCode;
  const lastSuccess = view.lastResult?.result?.success;
  const lastStdout = firstLine(view.lastResult?.result?.stdout, '等待执行诊断');
  const priorityCommands = GATEWAY_DIAGNOSTIC_COMMANDS.filter((item) => item.key === 'gateway-status' || item.key === 'gateway-status-deep');
  const supportCommands = GATEWAY_DIAGNOSTIC_COMMANDS.filter((item) => item.key !== 'gateway-status' && item.key !== 'gateway-status-deep');

  return `
    <div class="page-stack">
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <strong>网关诊断</strong>
            <p class="shell-card-copy">常用诊断在上，详细结果在下。</p>
          </div>
          <div class="pill-row">
            ${pillHtml(installation.binaryFound ? 'Hermes 可执行' : '未检测到可执行组件', installation.binaryFound ? 'good' : 'warn')}
            ${pillHtml(lastSuccess === undefined ? '尚未执行' : lastSuccess ? '最近成功' : '最近失败', lastSuccess === undefined ? 'neutral' : lastSuccess ? 'good' : 'warn')}
          </div>
        </div>

        <section class="workspace-summary-strip workspace-summary-strip-dense">
          <section class="summary-mini-card">
            <span class="summary-mini-label">最近诊断</span>
            <strong class="summary-mini-value">${escapeHtml(view.lastResult?.label || '还没执行')}</strong>
            <span class="summary-mini-meta">显示最近一条结果</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">退出码</span>
            <strong class="summary-mini-value">${escapeHtml(String(lastExitCode ?? '—'))}</strong>
            <span class="summary-mini-meta">${escapeHtml(lastSuccess === undefined ? '等待执行' : lastSuccess ? '结果正常返回' : '上次诊断失败')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">stdout 摘要</span>
            <strong class="summary-mini-value">${escapeHtml(truncate(lastStdout, 24))}</strong>
            <span class="summary-mini-meta">需要时再查看完整输出</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">日志联动</span>
            <strong class="summary-mini-value">${escapeHtml(view.lastResult?.result?.stderr ? '建议看 gateway.error' : '可先看 gateway')}</strong>
            <span class="summary-mini-meta">诊断失败优先看错误日志，成功则核对运行日志</span>
          </section>
        </section>

        <div class="control-card-grid control-card-grid-dense top-gap">
          ${priorityCommands.map((item) => `
            <section class="action-card action-card-compact">
              <div class="action-card-header">
                <div>
                  <p class="eyebrow">常用诊断</p>
                  <h3 class="action-card-title">${escapeHtml(item.label)}</h3>
                </div>
                ${pillHtml(item.key, item.key.includes('deep') ? 'warn' : 'good')}
              </div>
              <p class="action-card-copy">${escapeHtml(item.description)}</p>
              <p class="workspace-inline-meta">${escapeHtml(`相关日志: ${item.relatedLog}`)}</p>
              <div class="toolbar">
                ${buttonHtml({ action: `diagnostic-${item.key}`, label: `执行${item.label}`, kind: item.kind, disabled: Boolean(view.runningAction) || !installation.binaryFound })}
                ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
              </div>
            </section>
          `).join('')}
        </div>

        <details class="compact-disclosure top-gap" ${view.lastResult ? 'open' : ''}>
          <summary class="compact-disclosure-summary">
            <div class="compact-disclosure-head">
              <div class="compact-disclosure-copy">
                <strong class="compact-disclosure-title">补充诊断与最近回执</strong>
              </div>
              <div class="pill-row">
                ${pillHtml(`${supportCommands.length} 个补充动作`, 'neutral')}
                ${pillHtml(view.lastResult ? '有回执' : '无回执', view.lastResult ? 'good' : 'neutral')}
              </div>
            </div>
          </summary>
          <div class="compact-disclosure-body">
            <div class="control-card-grid control-card-grid-dense">
              ${supportCommands.map((item) => `
                <section class="action-card action-card-compact">
                  <div class="action-card-header">
                    <div>
                      <p class="eyebrow">${item.scope === 'runtime' ? '补充诊断' : '配置核对'}</p>
                      <h3 class="action-card-title">${escapeHtml(item.label)}</h3>
                    </div>
                    ${pillHtml(item.scope === 'capability' ? '配置' : '运行态', item.scope === 'capability' ? 'neutral' : 'warn')}
                  </div>
                  <p class="action-card-copy">${escapeHtml(item.description)}</p>
                  <div class="toolbar">
                    ${buttonHtml({ action: `diagnostic-${item.key}`, label: `执行${item.label}`, kind: item.kind, disabled: Boolean(view.runningAction) || !installation.binaryFound })}
                    ${buttonHtml({ action: 'goto-related-page', label: '进入相关页', attrs: { 'data-page': item.relatedPage } })}
                  </div>
                </section>
              `).join('')}
            </div>
            <section class="panel panel-nested">
              <div class="workspace-main-header">
                <div>
                  <strong>最近诊断回执</strong>
                  <p class="workspace-main-copy">这里显示最近一次诊断结果。</p>
                </div>
              </div>
              ${renderGatewayResultReceipt(view.lastResult, '尚未执行 Gateway 诊断', '执行诊断后，这里会显示最近一次结果。')}
            </section>
          </div>
        </details>
      </section>
    </div>
  `;
}

export function renderRuntimeWorkspace(view) {
  const lastSuccess = view.lastResult?.result?.success;
  const stdoutPreview = firstLine(view.lastResult?.result?.stdout, '等待 Gateway 动作执行');
  const stderrPreview = firstLine(view.lastResult?.result?.stderr, '无 stderr');

  return `
    <div class="workspace-bottom-grid workspace-bottom-grid-dense">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>最近动作回执</strong>
            <p class="workspace-main-copy">显示最近一次启动、保存或诊断结果。</p>
          </div>
          <div class="pill-row">
            ${pillHtml(view.lastResult?.label || '尚未执行', 'neutral')}
            ${pillHtml(lastSuccess === undefined ? '等待动作' : lastSuccess ? '成功' : '失败', lastSuccess === undefined ? 'neutral' : lastSuccess ? 'good' : 'warn')}
          </div>
        </div>
        <section class="workspace-summary-strip workspace-summary-strip-dense">
          <section class="summary-mini-card">
            <span class="summary-mini-label">stdout 摘要</span>
            <strong class="summary-mini-value">${escapeHtml(truncate(stdoutPreview, 24))}</strong>
            <span class="summary-mini-meta">最近一条标准输出摘要</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">stderr 摘要</span>
            <strong class="summary-mini-value">${escapeHtml(truncate(stderrPreview, 24))}</strong>
            <span class="summary-mini-meta">有报错时这里会优先出现信号</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">退出码</span>
            <strong class="summary-mini-value">${escapeHtml(String(view.lastResult?.result?.exitCode ?? '—'))}</strong>
            <span class="summary-mini-meta">帮助判断是否是硬失败</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">建议操作</span>
            <strong class="summary-mini-value">${escapeHtml(view.lastResult?.result?.stderr ? '优先看日志' : '查看连接状态')}</strong>
            <span class="summary-mini-meta">需要完整内容时再看下方输出</span>
          </section>
        </section>
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'switch-workspace-tab', label: '回到策略接管', attrs: { 'data-tab': 'control' } })}
          ${buttonHtml({ action: 'switch-workspace-tab', label: '进入网关诊断', attrs: { 'data-tab': 'diagnostics' } })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        </div>
      </section>

      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>完整输出</strong>
            <p class="workspace-main-copy">需要时再查看完整 stdout / stderr。</p>
          </div>
        </div>
        ${renderGatewayRawOutput(view.lastResult)}
      </section>
    </div>
  `;
}
