import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { GATEWAY_DIAGNOSTIC_COMMANDS, getDiagnosticCommand } from '../lib/diagnostics';
import { formatTimestamp, truncate } from '../lib/format';
import {
  consumePageIntent,
  getPageIntent,
  getPanelState,
  loadShell,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import { countConnectedPlatforms, cronTone, hasCronFailure, isRemoteDelivery, platformTone } from '../lib/runtime';
import {
  attrsToString,
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';

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

const PLATFORM_WORKSPACE_PRESETS = [
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

let activeView = null;

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">网关控制</h1>
        ${infoTipHtml('这页只做 Gateway Service、会话策略和平台链路接管；模型与通道凭证继续走客户端内的专属工作台，不再依赖 gateway setup。')}
      </div>
      <p class="page-desc">正在同步 Service、平台状态和网关策略。</p>
    </div>
    <div class="stat-cards stat-cards-4">
      ${Array.from({ length: 4 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:118px"></div>').join('')}
    </div>
  `;
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'gateway',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'gateway',
        headline: '来自 Gateway 的链路下钻',
        description: '继续围绕消息平台、会话策略和远端交付做排障。',
      };
}

function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
}

function shortcutCardHtml({ action, label, meta, active = false, attrs = {} }) {
  return `
    <button
      type="button"
      class="workspace-shortcut-card${active ? ' active' : ''}"
      data-action="${escapeHtml(action)}"
      ${attrsToString(attrs)}
    >
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(meta)}</span>
    </button>
  `;
}

function cloneGatewayWorkspace(workspace = {}) {
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

function cloneEnvWorkspace(workspace = {}) {
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

function splitLineValues(value) {
  return String(value ?? '')
    .split(/\r?\n|[,，；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function gatewayWorkspaceDirty(view) {
  if (!view.config?.gatewayWorkspace || !view.gatewayDraft) {
    return false;
  }
  return JSON.stringify(view.gatewayDraft) !== JSON.stringify(cloneGatewayWorkspace(view.config.gatewayWorkspace));
}

function envWorkspaceDirty(view) {
  if (!view.config?.envWorkspace || !view.envDraft) {
    return false;
  }
  return JSON.stringify(view.envDraft) !== JSON.stringify(cloneEnvWorkspace(view.config.envWorkspace));
}

function tokenPreview(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '未设置';
  }
  if (normalized.length <= 10) {
    return normalized;
  }
  return `${normalized.slice(0, 4)}•••${normalized.slice(-4)}`;
}

function channelReadiness(value) {
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

function countConfiguredPlatformDrafts(draft) {
  return PLATFORM_WORKSPACE_PRESETS.filter((preset) => platformDraftReady(preset, draft)).length;
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
    pieces.push(channelReadiness(draft[preset.tokenKey]) ? 'token 已写' : '缺 token');
  }
  if (preset.channelKey) {
    pieces.push(channelReadiness(draft[preset.channelKey]) ? `home ${draft[preset.channelKey]}` : 'home 未填');
  }
  if (preset.modeKey) {
    pieces.push(channelReadiness(draft[preset.modeKey]) ? `reply ${draft[preset.modeKey]}` : 'reply 未设');
  }
  if (preset.toggleKey) {
    pieces.push(draft[preset.toggleKey] ? '已启用' : '未启用');
  }
  return pieces.join(' · ') || '尚未配置';
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

function renderGatewayTabs(view) {
  const tabs = [
    { key: 'control', label: '策略接管' },
    { key: 'platforms', label: '平台连接' },
    { key: 'jobs', label: '远端作业' },
    { key: 'diagnostics', label: '网关诊断' },
    { key: 'runtime', label: '最新输出' },
  ];

  return `
    <div class="tab-bar">
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

function renderGatewayRail(view, context) {
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
        <strong>工作台摘要</strong>
        <p class="helper-text">主区做接管，侧栏只做导航、运行动作和系统边界收纳。</p>
      </div>
      ${workspaceDirty ? pillHtml('待保存', 'warn') : pillHtml('已同步', 'good')}
    </div>
    ${keyValueRowsHtml([
      { label: 'Gateway', value: gateway?.gatewayState || '未检测到' },
      { label: 'Platforms', value: `${connectedPlatforms}/${(gateway?.platforms ?? []).length}` },
      { label: '已配通道', value: `${configuredPlatforms}/${PLATFORM_WORKSPACE_PRESETS.length}` },
      { label: 'Remote Jobs', value: `${remoteJobs.length} / 失败 ${failingRemoteJobs.length}` },
      { label: '会话模式', value: draft.threadSessionsPerUser ? '线程隔离' : '线程共享' },
      { label: 'Gateway Token', value: tokenPreview(draft.hermesGatewayToken) },
    ])}
    ${warnings.length > 0
      ? `<div class="warning-stack top-gap">${warnings.slice(0, 3).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
      : `<p class="helper-text">平台异常 ${escapeHtml(String(unhealthyPlatforms.length))} 个，当前没有新的阻塞告警。</p>`}
    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">主工作台</span>
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
        <span class="workspace-rail-section-title">运行动作</span>
        ${view.workspaceTab === 'platforms'
          ? pillHtml(envDirty ? '通道待保存' : '通道已同步', envDirty ? 'warn' : 'good')
          : pillHtml(gatewayRunning ? 'Service Running' : 'Service Idle', gatewayRunning ? 'good' : 'warn')}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-grid">
        ${view.workspaceTab === 'platforms'
          ? `
            ${buttonHtml({ action: 'save-env-workspace', label: view.savingEnv ? '保存中…' : '保存通道', kind: envDirty ? 'primary' : 'secondary', disabled: railBusy })}
            ${buttonHtml({ action: 'save-env-workspace-restart', label: view.savingEnv ? '处理中…' : (gatewayRunning ? '保存并重启' : '保存并启动'), kind: 'primary', disabled: railBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'reset-env-workspace', label: '重置草稿', disabled: railBusy || !envDirty })}
            ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: railBusy || !installation.binaryFound })}
          `
          : `
            ${buttonHtml({ action: 'save-gateway-workspace', label: view.savingGateway ? '保存中…' : '保存策略', kind: gatewayDirty ? 'primary' : 'secondary', disabled: railBusy })}
            ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: restartLabel, kind: gatewayRunning ? 'secondary' : 'primary', disabled: railBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'gateway-stop', label: '停止 Gateway', kind: 'danger', disabled: railBusy || !installation.binaryFound || !gatewayRunning })}
            ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: railBusy || !installation.binaryFound })}
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
      <p class="helper-text">安装和卸载 service 会改系统侧状态，所以默认弱化，不抢策略接管主区。</p>
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

function renderControlWorkspace(view, context) {
  const { config, gateway, gatewayRunning, installation, remoteJobs, unhealthyPlatforms } = context;
  const draft = view.gatewayDraft ?? cloneGatewayWorkspace(config?.gatewayWorkspace);
  const env = view.envDraft ?? cloneEnvWorkspace(config?.envWorkspace);
  const platformStates = new Map((gateway?.platforms ?? []).map((item) => [item.name, item.state]));
  const dirty = gatewayWorkspaceDirty(view);

  return `
    <div class="compact-overview-grid">
      <section class="shell-card">
        <div class="shell-card-header">
          <div>
            <strong>Service 接管</strong>
            <p class="shell-card-copy">保留 Hermes 原生 service 生命周期，但把安装、启停和状态回收进客户端。</p>
          </div>
          ${pillHtml(gatewayRunning ? '运行中' : '待启动', gatewayRunning ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: 'PID', value: String(gateway?.pid ?? '—') },
          { label: '活跃 Agent', value: String(gateway?.activeAgents ?? 0) },
          { label: '异常平台', value: String(unhealthyPlatforms.length) },
          { label: '远端作业', value: String(remoteJobs.length) },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: gatewayRunning ? '重启 Gateway' : '启动 Gateway', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'gateway-stop', label: '停止 Gateway', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'toggle-service-actions', label: view.showServiceActions ? '收起系统动作' : '系统动作' })}
        </div>
        <p class="helper-text">安装和卸载 Service 已收进侧栏弱化区，避免和高频启停动作混在一起。</p>
      </section>

      <section class="shell-card">
        <div class="shell-card-header">
          <div>
            <strong>通道桥接</strong>
            <p class="shell-card-copy">平台 token、home channel 和 reply mode 已收回当前页的平台连接标签，不再强依赖跳到凭证页。</p>
          </div>
          ${buttonHtml({ action: 'switch-workspace-tab', label: '进入平台连接', attrs: { 'data-tab': 'platforms' } })}
        </div>
        <div class="service-stack">
          ${renderChannelHealthItem('Telegram', env.telegramBotToken, env.telegramHomeChannel, env.telegramReplyToMode, platformStates.get('telegram'))}
          ${renderChannelHealthItem('Discord', env.discordBotToken, env.discordHomeChannel, env.discordReplyToMode, platformStates.get('discord'))}
          ${renderChannelHealthItem('Slack', env.slackBotToken, '', '', platformStates.get('slack'))}
        </div>
      </section>
    </div>

    <section class="shell-card top-gap">
      <div class="shell-card-header">
        <div>
          <div class="panel-title-row">
            <strong>Gateway 策略</strong>
            ${infoTipHtml('这里接管的是 Hermes 原生网关策略字段：gateway token、会话隔离、自动重置、语音转写和未授权私聊策略。避免和模型/插件/技能页重复。')}
          </div>
          <p class="shell-card-copy">保存后直接写回 config.yaml 和 .env，不再依赖 gateway setup。</p>
        </div>
        <div class="toolbar">
          ${dirty ? pillHtml('待保存', 'warn') : pillHtml('已同步', 'good')}
          ${pillHtml(draft.sessionResetMode, 'neutral')}
        </div>
      </div>

      <div class="top-gap">
        <div class="panel-title-row">
          <strong>自动重置模式</strong>
          ${infoTipHtml('Hermes 原生支持按天、按闲置或双重重置，适合让群聊/线程会话保持可控，不必频繁手动 /new。')}
        </div>
        <div class="selection-chip-grid top-gap">
          ${RESET_MODE_OPTIONS.map((item) => buttonHtml({
            action: 'set-reset-mode',
            label: item.label,
            className: `selection-chip${draft.sessionResetMode === item.key ? ' selection-chip-active' : ''}`,
            kind: draft.sessionResetMode === item.key ? 'primary' : 'secondary',
            attrs: { 'data-value': item.key },
          })).join('')}
        </div>
      </div>

      <div class="top-gap">
        <div class="panel-title-row">
          <strong>未授权私聊</strong>
          ${infoTipHtml('Hermes 原生只支持配对后放行或直接忽略，客户端这里做成显式开关，不再埋在 YAML 里。')}
        </div>
        <div class="selection-chip-grid top-gap">
          ${DM_BEHAVIOR_OPTIONS.map((item) => buttonHtml({
            action: 'set-dm-behavior',
            label: item.label,
            className: `selection-chip${draft.unauthorizedDmBehavior === item.key ? ' selection-chip-active' : ''}`,
            kind: draft.unauthorizedDmBehavior === item.key ? 'primary' : 'secondary',
            attrs: { 'data-value': item.key },
          })).join('')}
        </div>
      </div>

      <div class="form-grid top-gap">
        <label class="field-stack">
          <span>Gateway Token</span>
          <input class="search-input" id="gateway-token" value="${escapeHtml(draft.hermesGatewayToken)}" placeholder="HERMES_GATEWAY_TOKEN">
        </label>
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

      <div class="checkbox-row top-gap">
        <label>
          <input type="checkbox" id="gateway-always-log-local" ${draft.alwaysLogLocal ? 'checked' : ''}>
          <span>始终保留本地日志</span>
        </label>
        <label>
          <input type="checkbox" id="gateway-stt-enabled" ${draft.sttEnabled ? 'checked' : ''}>
          <span>启用语音转写</span>
        </label>
        <label>
          <input type="checkbox" id="gateway-group-sessions" ${draft.groupSessionsPerUser ? 'checked' : ''}>
          <span>群聊按用户隔离</span>
        </label>
        <label>
          <input type="checkbox" id="gateway-thread-sessions" ${draft.threadSessionsPerUser ? 'checked' : ''}>
          <span>线程按用户隔离</span>
        </label>
        <label>
          <input type="checkbox" id="gateway-reset-notify" ${draft.sessionResetNotify ? 'checked' : ''}>
          <span>自动重置时通知</span>
        </label>
      </div>

      <div class="toolbar top-gap">
        ${buttonHtml({ action: 'save-gateway-workspace', label: view.savingGateway ? '保存中…' : '保存并应用', kind: 'primary', disabled: view.savingGateway })}
        ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        ${buttonHtml({ action: 'diagnostic-gateway-status-deep', label: '网关深检', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        ${buttonHtml({ action: 'switch-workspace-tab', label: '平台连接', attrs: { 'data-tab': 'platforms' } })}
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
    <section class="shell-card platform-workspace-card${ready ? ' platform-workspace-card-ready' : ''}">
      <div class="platform-workspace-head">
        <div class="platform-workspace-heading">
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
      ${snapshot?.errorMessage
        ? `
          <div class="danger-copy-compact platform-runtime-note">
            <strong>最近错误</strong>
            <p>${escapeHtml(snapshot.errorMessage)}</p>
          </div>
        `
        : `<div class="platform-runtime-meta">${escapeHtml(runtimeMeta)}</div>`}
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
          ? buttonHtml({ action: 'apply-platform-preset', label: '应用推荐', attrs: { 'data-platform': preset.id } })
          : ''}
        ${buttonHtml({ action: 'clear-platform-draft', label: '清空', disabled: !hasValue, attrs: { 'data-platform': preset.id } })}
        ${buttonHtml({ action: 'platform-logs', label: '日志', attrs: { 'data-platform': snapshot?.name || preset.runtimeName } })}
        ${buttonHtml({ action: 'platform-diagnostics', label: '诊断', attrs: { 'data-platform': snapshot?.name || preset.runtimeName } })}
      </div>
    </section>
  `;
}

function renderPlatformsWorkspace(view, context) {
  const { connectedPlatforms, gatewayRunning, platforms, unhealthyPlatforms } = context;
  const draft = view.envDraft ?? cloneEnvWorkspace(view.config?.envWorkspace);
  const configuredPlatforms = countConfiguredPlatformDrafts(draft);
  const dirty = envWorkspaceDirty(view);

  return `
    <div class="page-stack">
      <section class="workspace-summary-strip">
        <section class="summary-mini-card">
          <span class="summary-mini-label">接入骨架</span>
          <strong class="summary-mini-value">${escapeHtml(`${configuredPlatforms}/${PLATFORM_WORKSPACE_PRESETS.length}`)}</strong>
          <span class="summary-mini-meta">当前已填至少一项通道字段的平台数</span>
        </section>
        <section class="summary-mini-card">
          <span class="summary-mini-label">运行连接</span>
          <strong class="summary-mini-value">${escapeHtml(`${connectedPlatforms}/${platforms.length || 0}`)}</strong>
          <span class="summary-mini-meta">${escapeHtml(unhealthyPlatforms.length > 0 ? `${unhealthyPlatforms.length} 个平台待排障` : '当前没有新的平台告警')}</span>
        </section>
        <section class="summary-mini-card">
          <span class="summary-mini-label">通道草稿</span>
          <strong class="summary-mini-value">${escapeHtml(dirty ? '待保存' : '已同步')}</strong>
          <span class="summary-mini-meta">直接写回 .env，避免交给 Terminal</span>
        </section>
        <section class="summary-mini-card">
          <span class="summary-mini-label">Gateway 联调</span>
          <strong class="summary-mini-value">${escapeHtml(gatewayRunning ? '运行中' : '待启动')}</strong>
          <span class="summary-mini-meta">${escapeHtml(gatewayRunning ? '保存后可直接重启验证链路' : '保存后可直接启动并验证链路')}</span>
        </section>
      </section>

      <section class="shell-card">
        <div class="shell-card-header">
          <div>
            <div class="panel-title-row">
              <strong>平台接入工作台</strong>
              ${infoTipHtml('这里直接接管 .env 中的消息通道字段。保存后可以立刻重启 Gateway 验证运行态，不再跳去命令行。')}
            </div>
            <p class="shell-card-copy">把 token、home channel、reply mode 和启停联调压进一个面板内，减少跨页和重复曝光。</p>
          </div>
          <div class="toolbar">
            ${pillHtml(dirty ? '通道待保存' : '通道已同步', dirty ? 'warn' : 'good')}
            ${pillHtml(gatewayRunning ? 'Gateway Running' : 'Gateway Idle', gatewayRunning ? 'neutral' : 'warn')}
          </div>
        </div>
      </section>

      <div class="platform-workspace-grid top-gap">
        ${PLATFORM_WORKSPACE_PRESETS.map((preset) => renderPlatformWorkspaceCard(
          view,
          preset,
          findPlatformSnapshot(platforms, preset.runtimeName),
        )).join('')}
      </div>
    </div>
  `;
}

function renderGatewayQuickActions(view, context) {
  const { gatewayRunning, installation } = context;
  const refreshDisabled = Boolean(view.refreshing || view.savingGateway || view.savingEnv);
  const envDirty = envWorkspaceDirty(view);
  const gatewayDirty = gatewayWorkspaceDirty(view);

  if (view.workspaceTab === 'platforms') {
    return `
      <div class="quick-actions">
        ${buttonHtml({ action: 'save-env-workspace', label: view.savingEnv ? '保存中…' : '保存通道配置', kind: envDirty ? 'primary' : 'secondary', disabled: Boolean(view.runningAction || view.savingEnv || view.savingGateway) })}
        ${buttonHtml({ action: 'save-env-workspace-restart', label: view.savingEnv ? '处理中…' : (gatewayRunning ? '保存并重启 Gateway' : '保存并启动 Gateway'), kind: 'primary', disabled: Boolean(view.runningAction || view.savingEnv || view.savingGateway || !installation.binaryFound) })}
        ${buttonHtml({ action: 'reset-env-workspace', label: '重置通道草稿', disabled: Boolean(view.runningAction || view.savingEnv || !envDirty) })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        ${buttonHtml({ action: 'refresh', label: refreshDisabled ? '同步中…' : '刷新状态', disabled: refreshDisabled })}
      </div>
    `;
  }

  if (view.workspaceTab === 'control') {
    return `
      <div class="quick-actions">
        ${buttonHtml({ action: 'save-gateway-workspace', label: view.savingGateway ? '保存中…' : '保存 Gateway 配置', kind: gatewayDirty ? 'primary' : 'secondary', disabled: Boolean(view.runningAction || view.savingGateway || view.savingEnv) })}
        ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: gatewayRunning ? '重启 Gateway' : '启动 Gateway', kind: 'primary', disabled: Boolean(view.runningAction || view.savingGateway || view.savingEnv || !installation.binaryFound) })}
        ${buttonHtml({ action: 'switch-workspace-tab', label: '平台连接', attrs: { 'data-tab': 'platforms' } })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        ${buttonHtml({ action: 'refresh', label: refreshDisabled ? '同步中…' : '刷新状态', disabled: refreshDisabled })}
      </div>
    `;
  }

  return `
    <div class="quick-actions">
      ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
      ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
      ${buttonHtml({ action: 'refresh', label: refreshDisabled ? '同步中…' : '刷新状态', disabled: refreshDisabled })}
    </div>
  `;
}

function renderJobsWorkspace(remoteJobs) {
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

function renderDiagnosticsWorkspace(view, installation) {
  return `
    <div class="workbench-grid">
      ${GATEWAY_DIAGNOSTIC_COMMANDS.map((item) => `
        <section class="action-card">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">CLI</p>
              <h3 class="action-card-title">${escapeHtml(item.label)}</h3>
            </div>
            ${pillHtml(item.key, item.kind === 'primary' ? 'good' : item.key.includes('deep') ? 'warn' : 'neutral')}
          </div>
          <p class="action-card-copy">${escapeHtml(item.description)}</p>
          <p class="command-line">${escapeHtml(item.cli)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: `diagnostic-${item.key}`, label: `执行${item.label}`, kind: item.kind, disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'goto-related-page', label: '进入相关页', attrs: { 'data-page': item.relatedPage } })}
          </div>
        </section>
      `).join('')}
    </div>
  `;
}

function renderRuntimeWorkspace(view) {
  return commandResultHtml(view.lastResult, '暂无网关输出', '执行网关动作、安装或诊断后，这里会保留 Hermes 原始输出。');
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.dashboard) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.dashboard || !view.installation || !view.config) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">网关控制</h1>
          ${infoTipHtml('Gateway 页需要同时读取运行快照和结构化配置；只要有一端异常，就先在这里暴露出来。')}
        </div>
        <p class="page-desc">Service、平台和策略没有完整读出来，先处理读取错误。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">网关快照或结构化配置当前不可用，可以重试或继续看桌面端日志。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 Gateway 快照', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const { dashboard, installation, cronSnapshot, config } = view;
  const gateway = dashboard.gateway;
  const platforms = gateway?.platforms ?? [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const failingRemoteJobs = remoteJobs.filter(hasCronFailure);
  const unhealthyPlatforms = platforms.filter((platform) => platformTone(platform.state) !== 'good');
  const connectedPlatforms = countConnectedPlatforms(platforms);
  const gatewayRunning = gateway?.gatewayState === 'running';
  const gatewayStatePath = `${dashboard.hermesHome}/gateway_state.json`;
  const logsDir = `${dashboard.hermesHome}/logs`;
  const envDraft = view.envDraft ?? cloneEnvWorkspace(config.envWorkspace);
  const workbenchMain = view.workspaceTab === 'control'
    ? renderControlWorkspace(view, {
      config,
      gateway,
      gatewayRunning,
      installation,
      remoteJobs,
      unhealthyPlatforms,
    })
    : view.workspaceTab === 'platforms'
      ? renderPlatformsWorkspace(view, {
        connectedPlatforms,
        gatewayRunning,
        platforms,
        unhealthyPlatforms,
      })
      : view.workspaceTab === 'jobs'
        ? renderJobsWorkspace(remoteJobs)
        : view.workspaceTab === 'diagnostics'
          ? renderDiagnosticsWorkspace(view, installation)
          : renderRuntimeWorkspace(view);
  const seed = relaySeed(view);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    description: '查看网关链路相关日志，验证平台连接、交付异常和运行状态。',
    logName: unhealthyPlatforms.length > 0 || failingRemoteJobs.length > 0 ? 'gateway.error' : 'gateway',
    contains:
      view.investigation?.platformName
      || unhealthyPlatforms[0]?.name
      || failingRemoteJobs[0]?.deliver
      || seed.context?.source
      || '',
    limit: '160',
  });
  const warnings = [];
  const gatewayDraft = view.gatewayDraft ?? cloneGatewayWorkspace(config.gatewayWorkspace);
  const configuredPlatforms = countConfiguredPlatformDrafts(envDraft);

  if (!installation.binaryFound) {
    warnings.push('当前还没有检测到 Hermes CLI，Service 动作会被禁用，但结构化配置仍然可以继续保存。');
  }
  if (!gatewayDraft.hermesGatewayToken.trim()) {
    warnings.push('当前没有写入 HERMES_GATEWAY_TOKEN，外部网关鉴权链路还不完整。');
  }
  if (gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 当前未运行，消息平台和远端交付链路都还没有真正恢复。');
  }
  if (!installation.gatewayStateExists) {
    warnings.push('还没有看到 gateway_state.json，说明 service 尚未被完整接管或从未成功启动。');
  }
  if (remoteJobs.length > 0 && gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端作业依赖 Gateway，但网关当前不可用。`);
  }
  if (unhealthyPlatforms.length > 0) {
    warnings.push(`共有 ${unhealthyPlatforms.length} 个平台连接异常或未就绪：${unhealthyPlatforms.map((item) => item.name).join('、')}。`);
  }
  if (configuredPlatforms === 0) {
    warnings.push('当前还没有配置任何消息通道，Gateway 启动后也不会接到外部消息。');
  }
  if (envWorkspaceDirty(view)) {
    warnings.push('平台连接工作台还有未保存的通道草稿。');
  }

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">网关控制</h1>
        ${infoTipHtml('这一页不再重复铺陈介绍，也不再把高频配置藏到命令行；Service、策略和平台状态都放进一个紧凑工作台。')}
      </div>
      <p class="page-desc">Service、会话策略、平台链路。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner">
        <div class="context-banner-header">
          <div class="context-banner-copy">
            <span class="context-banner-label">Session Drilldown</span>
            <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
            <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
          </div>
          <div class="context-banner-meta">
            ${view.investigation.platformName ? pillHtml(view.investigation.platformName, 'warn') : ''}
            ${seed.context?.source ? pillHtml(seed.context.source, 'neutral') : ''}
          </div>
        </div>
        <div class="context-banner-actions toolbar">
          ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
          ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        </div>
      </div>
    ` : ''}

    <div class="stat-cards stat-cards-4">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway</span>
          ${statusDotHtml(gatewayRunning ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${gatewayRunning ? '运行中' : '待启动'}</div>
        <div class="stat-card-meta">${gatewayRunning ? `PID ${escapeHtml(gateway?.pid ?? '—')} · ${escapeHtml(gateway?.activeAgents ?? 0)} 个活跃 Agent` : '当前还没有看到运行中的 Gateway 状态。'}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Platforms</span>
          ${statusDotHtml(unhealthyPlatforms.length === 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${platforms.length ? `${connectedPlatforms}/${platforms.length}` : '暂无平台'}</div>
        <div class="stat-card-meta">${unhealthyPlatforms.length === 0 ? '当前没有明显的平台连接异常。' : `异常平台 ${unhealthyPlatforms.length} 个`}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Remote Jobs</span>
          ${statusDotHtml(failingRemoteJobs.length > 0 ? 'warning' : 'running')}
        </div>
        <div class="stat-card-value">${remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '本地优先'}</div>
        <div class="stat-card-meta">${failingRemoteJobs.length > 0 ? `${failingRemoteJobs.length} 个作业已出现交付异常。` : '暂未发现远端投递失败。'}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway Token</span>
          ${statusDotHtml(gatewayDraft.hermesGatewayToken.trim() ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${tokenPreview(gatewayDraft.hermesGatewayToken)}</div>
        <div class="stat-card-meta">${escapeHtml(`${gatewayDraft.sessionResetMode} · reset ${gatewayDraft.resetTriggers.join(', ')}`)}</div>
      </section>
    </div>

    ${renderGatewayQuickActions(view, { gatewayRunning, installation })}

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">Gateway Workbench</h2>
            ${infoTipHtml('保持一个主工作区，避免 Service 区、配置区、诊断区到处重复。策略接管是默认入口，平台和作业放到次级标签。')}
          </div>
          <p class="config-section-desc">结构化接管优先，诊断和原始输出兜底。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workspaceTab, 'neutral')}
          ${warnings.length > 0 ? pillHtml(`${warnings.length} 条提醒`, 'warn') : pillHtml('当前稳定', 'good')}
        </div>
      </div>
      ${renderGatewayTabs(view)}
      <div class="workspace-shell">
        <aside class="workspace-rail">
          ${renderGatewayRail(view, {
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
          })}
        </aside>
        <div class="workspace-main-card">
          ${workbenchMain}
        </div>
      </div>
    </section>
  `;

  bindEvents(view, logsIntent);
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.dashboard && view.installation && view.config);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [dashboard, installation, config, cronSnapshot] = await Promise.all([
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getConfigDocuments(profile),
      api.getCronJobs(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.dashboard = dashboard;
    view.installation = installation;
    view.config = config;
    view.cronSnapshot = cronSnapshot;
    view.gatewayDraft = cloneGatewayWorkspace(config.gatewayWorkspace);
    view.envDraft = cloneEnvWorkspace(config.envWorkspace);
  } catch (reason) {
    if (view.destroyed) {
      return;
    }
    view.error = String(reason);
    if (hasData && !silent) {
      notify('error', view.error);
    }
  } finally {
    view.loading = false;
    view.refreshing = false;
    renderPage(view);
  }
}

async function runGatewayAction(view, action, label) {
  view.runningAction = `gateway:${action}`;
  renderPage(view);
  try {
    const result = await api.runGatewayAction(action, view.profile);
    view.lastResult = { label, result };
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function runDiagnostic(view, kind, options = {}) {
  const { silent = false, refresh = true } = options;
  view.runningAction = `diagnostic:${kind}`;
  renderPage(view);
  try {
    const result = await api.runDiagnostic(kind, view.profile);
    view.lastResult = { label: getDiagnosticCommand(kind)?.label || kind, result };
    if (!silent) {
      notify(result.success ? 'success' : 'error', `${getDiagnosticCommand(kind)?.label || kind} 已执行。`);
    }
    if (refresh) {
      await Promise.all([
        loadShell(view.profile, { silent: true }),
        loadData(view, { silent: true }),
      ]);
    }
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function saveGatewayWorkspace(view) {
  if (!view.gatewayDraft) {
    return;
  }

  view.savingGateway = true;
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredGateway(view.gatewayDraft, view.profile);
    notify('success', 'Gateway 策略已保存到 config.yaml 和 .env。');
    view.config = nextConfig;
    view.gatewayDraft = cloneGatewayWorkspace(nextConfig.gatewayWorkspace);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.savingGateway = false;
    renderPage(view);
  }
}

async function saveEnvWorkspace(view, options = {}) {
  const { restart = false } = options;
  if (!view.envDraft) {
    return;
  }

  view.savingEnv = restart ? 'restart' : 'save';
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredEnv(view.envDraft, view.profile);
    view.config = nextConfig;
    view.gatewayDraft = cloneGatewayWorkspace(nextConfig.gatewayWorkspace);
    view.envDraft = cloneEnvWorkspace(nextConfig.envWorkspace);
    notify('success', '通道配置已保存到 .env。');

    if (restart) {
      if (!view.installation?.binaryFound) {
        notify('info', '已保存通道配置，但当前未检测到 Hermes CLI，暂未执行 Gateway 重启。');
      } else {
        const gatewayRunning = view.dashboard?.gateway?.gatewayState === 'running';
        const action = gatewayRunning ? 'restart' : 'start';
        const label = gatewayRunning ? '重启 Gateway' : '启动 Gateway';
        const result = await api.runGatewayAction(action, view.profile);
        view.lastResult = { label, result };
        notify(result.success ? 'success' : 'error', `${label} 已执行。`);
      }
    }

    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.savingEnv = null;
    renderPage(view);
  }
}

function applyPlatformPreset(view, platformId) {
  const preset = PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === platformId);
  if (!preset || !view.envDraft) {
    return;
  }

  if (preset.modeKey && !channelReadiness(view.envDraft[preset.modeKey])) {
    view.envDraft[preset.modeKey] = preset.modeDefault || 'reply';
  }
  if (preset.toggleKey) {
    view.envDraft[preset.toggleKey] = true;
  }
}

function clearPlatformDraft(view, platformId) {
  const preset = PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === platformId);
  if (!preset || !view.envDraft) {
    return;
  }

  [preset.tokenKey, preset.channelKey, preset.modeKey]
    .filter(Boolean)
    .forEach((key) => {
      view.envDraft[key] = '';
    });
  if (preset.toggleKey) {
    view.envDraft[preset.toggleKey] = false;
  }
}

async function runFinderAction(view, actionKey, label, path, revealInFinder = false) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    await openFinderLocation({
      actionKey,
      label,
      notify,
      onResult: (nextLabel, result) => {
        view.lastResult = { label: nextLabel, result };
      },
      path,
      revealInFinder,
      setBusy: (value) => {
        view.runningAction = value;
        renderPage(view);
      },
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncWithPanelState(view) {
  const shell = getPanelState();

  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.dashboard = null;
    view.installation = null;
    view.config = null;
    view.cronSnapshot = null;
    view.gatewayDraft = cloneGatewayWorkspace();
    view.envDraft = cloneEnvWorkspace();
    view.error = null;
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('gateway');
  if (nextIntent) {
    view.investigation = nextIntent;
    view.workspaceTab = nextIntent.platformName ? 'platforms' : 'control';
    consumePageIntent();
    renderPage(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindGatewayInputs(view) {
  if (!view.gatewayDraft) {
    return;
  }

  const stringInputs = [
    ['#gateway-token', 'hermesGatewayToken'],
  ];
  stringInputs.forEach(([selector, key]) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.oninput = (event) => {
      view.gatewayDraft[key] = event.target.value;
    };
  });

  const numberInputs = [
    ['#gateway-reset-hour', 'sessionResetAtHour'],
    ['#gateway-reset-idle', 'sessionResetIdleMinutes'],
  ];
  numberInputs.forEach(([selector, key]) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.oninput = (event) => {
      view.gatewayDraft[key] = parseOptionalNumber(event.target.value);
    };
  });

  const resetTriggers = view.page.querySelector('#gateway-reset-triggers');
  if (resetTriggers) {
    resetTriggers.oninput = (event) => {
      view.gatewayDraft.resetTriggers = splitLineValues(event.target.value);
    };
  }

  const checkboxInputs = [
    ['#gateway-always-log-local', 'alwaysLogLocal'],
    ['#gateway-stt-enabled', 'sttEnabled'],
    ['#gateway-group-sessions', 'groupSessionsPerUser'],
    ['#gateway-thread-sessions', 'threadSessionsPerUser'],
    ['#gateway-reset-notify', 'sessionResetNotify'],
  ];
  checkboxInputs.forEach(([selector, key]) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.onchange = (event) => {
      view.gatewayDraft[key] = event.target.checked;
    };
  });
}

function bindPlatformInputs(view) {
  if (!view.envDraft) {
    return;
  }

  const bindValue = (selector, key) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.oninput = (event) => {
      view.envDraft[key] = event.target.value;
    };
  };

  const bindCheckbox = (selector, key) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.onchange = (event) => {
      view.envDraft[key] = event.target.checked;
    };
  };

  bindValue('#platform-telegram-token', 'telegramBotToken');
  bindValue('#platform-telegram-channel', 'telegramHomeChannel');
  bindValue('#platform-telegram-mode', 'telegramReplyToMode');
  bindValue('#platform-discord-token', 'discordBotToken');
  bindValue('#platform-discord-channel', 'discordHomeChannel');
  bindValue('#platform-discord-mode', 'discordReplyToMode');
  bindValue('#platform-slack-token', 'slackBotToken');
  bindCheckbox('#platform-whatsapp-enabled', 'whatsappEnabled');
}

function bindEvents(view, logsIntent) {
  bindGatewayInputs(view);
  bindPlatformInputs(view);

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'refresh') {
        await loadData(view, { silent: true });
        return;
      }

      switch (action) {
        case 'toggle-service-actions':
          view.showServiceActions = !view.showServiceActions;
          renderPage(view);
          return;
        case 'switch-workspace-tab':
          view.workspaceTab = element.getAttribute('data-tab') || 'control';
          renderPage(view);
          return;
        case 'save-gateway-workspace':
          await saveGatewayWorkspace(view);
          return;
        case 'save-env-workspace':
          await saveEnvWorkspace(view);
          return;
        case 'save-env-workspace-restart':
          await saveEnvWorkspace(view, { restart: true });
          return;
        case 'reset-env-workspace':
          view.envDraft = cloneEnvWorkspace(view.config?.envWorkspace);
          renderPage(view);
          return;
        case 'set-reset-mode':
          view.gatewayDraft.sessionResetMode = element.getAttribute('data-value') || 'both';
          renderPage(view);
          return;
        case 'set-dm-behavior':
          view.gatewayDraft.unauthorizedDmBehavior = element.getAttribute('data-value') || 'pair';
          renderPage(view);
          return;
        case 'apply-platform-preset':
          applyPlatformPreset(view, element.getAttribute('data-platform') || '');
          renderPage(view);
          return;
        case 'clear-platform-draft':
          clearPlatformDraft(view, element.getAttribute('data-platform') || '');
          renderPage(view);
          return;
        case 'set-platform-mode': {
          const platformId = element.getAttribute('data-platform') || '';
          const preset = PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === platformId);
          if (preset?.modeKey && view.envDraft) {
            view.envDraft[preset.modeKey] = element.getAttribute('data-value') || preset.modeDefault || 'reply';
            renderPage(view);
          }
          return;
        }
        case 'gateway-install':
          await runGatewayAction(view, 'install', '安装 Gateway Service');
          return;
        case 'gateway-start':
          await runGatewayAction(view, 'start', '启动 Gateway');
          return;
        case 'gateway-restart':
          await runGatewayAction(view, 'restart', '重启 Gateway');
          return;
        case 'gateway-stop':
          await runGatewayAction(view, 'stop', '停止 Gateway');
          return;
        case 'gateway-uninstall':
          if (!window.confirm('确定卸载当前 profile 的 Gateway Service 吗？')) {
            return;
          }
          await runGatewayAction(view, 'uninstall', '卸载 Gateway Service');
          return;
        case 'open-gateway-state':
          await runFinderAction(view, 'finder:gateway-state', '定位状态文件', `${view.dashboard.hermesHome}/gateway_state.json`, true);
          return;
        case 'open-logs':
          await runFinderAction(view, 'finder:gateway-logs', '打开日志目录', `${view.dashboard.hermesHome}/logs`, false);
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'goto-logs':
          navigate('logs', logsIntent);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', buildDiagnosticsDrilldownIntent(relaySeed(view), {
            description: '围绕网关 Service、平台异常和远端交付继续深检。',
            suggestedCommand: view.dashboard.gateway?.gatewayState === 'running' ? 'gateway-status' : 'gateway-status-deep',
            logName: 'gateway.error',
          }));
          return;
        case 'goto-credentials':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续完成平台 token、home channel 和 reply mode 配置。',
            focus: 'credentials',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-extensions':
          navigate('extensions', buildExtensionsDrilldownIntent(relaySeed(view), {
            rawKind: 'tools',
          }));
          return;
        case 'goto-cron':
          navigate('cron');
          return;
        case 'goto-related-page':
          navigate(element.getAttribute('data-page'));
          return;
        case 'platform-logs': {
          const platformName = element.getAttribute('data-platform') || '';
          navigate('logs', buildLogsDrilldownIntent(relaySeed(view), {
            description: `查看平台 ${platformName} 关联的网关日志。`,
            logName: 'gateway.error',
            contains: platformName,
            limit: '160',
          }));
          return;
        }
        case 'platform-diagnostics': {
          const platformName = element.getAttribute('data-platform') || '';
          navigate('diagnostics', buildDiagnosticsDrilldownIntent(relaySeed(view), {
            description: `围绕平台 ${platformName} 继续做网关深检。`,
            suggestedCommand: 'gateway-status-deep',
            logName: 'gateway.error',
          }));
          return;
        }
        case 'job-logs': {
          const jobId = element.getAttribute('data-job') || '';
          const deliver = element.getAttribute('data-deliver') || '';
          navigate('logs', buildLogsDrilldownIntent(relaySeed(view), {
            description: `查看远端作业 ${jobId} 的交付日志。`,
            logName: 'gateway.error',
            contains: jobId || deliver,
            limit: '160',
          }));
          return;
        }
        default:
          if (action.startsWith('diagnostic-')) {
            await runDiagnostic(view, action.replace('diagnostic-', ''));
          }
      }
    };
  });
}

export async function render() {
  cleanup();

  const page = document.createElement('div');
  page.className = 'page';

  activeView = {
    config: null,
    cronSnapshot: null,
    dashboard: null,
    destroyed: false,
    error: null,
    gatewayDraft: cloneGatewayWorkspace(),
    installation: null,
    investigation: getPageIntent('gateway'),
    lastResult: null,
    loading: true,
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    envDraft: cloneEnvWorkspace(),
    savingEnv: null,
    savingGateway: false,
    showServiceActions: false,
    unsubscribe: null,
    workspaceTab: 'control',
  };

  if (activeView.investigation) {
    activeView.workspaceTab = activeView.investigation.platformName ? 'platforms' : 'control';
    consumePageIntent();
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView);
  if (activeView.installation?.binaryFound) {
    await runDiagnostic(activeView, 'gateway-status', { silent: true, refresh: false });
  }
  return page;
}

export function cleanup() {
  if (!activeView) {
    return;
  }

  activeView.destroyed = true;
  activeView.unsubscribe?.();
  activeView = null;
}
