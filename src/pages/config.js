import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import {
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { getDiagnosticCommand } from '../lib/diagnostics';
import {
  consumePageIntent,
  getPageIntent,
  getPanelState,
  loadShell,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import { enabledToolCount, isRemoteDelivery, localRuntimeSkillCount, pluginsCount, totalToolCount } from '../lib/runtime';
import {
  attrsToString,
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';

const CONFIG_WORKBENCH_KEYS = ['config-check', 'doctor', 'memory-status', 'gateway-status'];
const MODEL_PROVIDER_PRESETS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'openrouterApiKey',
    envLabel: 'OPENROUTER_API_KEY',
    copy: '聚合路由，一套配置接多家模型，适合 Hermes 的快速切换场景。',
    models: [
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-5.4',
      'openai/gpt-5.3-codex',
      'google/gemini-3-flash-preview',
      'qwen/qwen3.6-plus',
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'openaiApiKey',
    envLabel: 'OPENAI_API_KEY',
    copy: '最直接的 OpenAI 直连配置，适合主模型链路稳定接入。',
    models: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2-codex',
      'gpt-4.1',
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    envKey: 'anthropicApiKey',
    envLabel: 'ANTHROPIC_API_KEY',
    copy: '适合 Claude 直连；如果走兼容端点，也可以先套预设再改 Base URL。',
    models: [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    provider: 'gemini',
    baseUrl: '',
    envKey: 'googleApiKey',
    envLabel: 'GOOGLE_API_KEY',
    copy: 'Google AI Studio 直连模式，Hermes 会按 provider 解析 Gemini 路由。',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ],
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    provider: 'huggingface',
    baseUrl: 'https://router.huggingface.co/v1',
    envKey: 'hfToken',
    envLabel: 'HF_TOKEN',
    copy: '适合用 HF Router 接开放模型；如果你有自定义网关，也可以再改 Base URL。',
    models: [
      'openai/gpt-oss-120b',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'moonshotai/Kimi-K2-Instruct',
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    provider: 'custom',
    baseUrl: '',
    envKey: '',
    envLabel: '',
    copy: '保留完全自定义的 provider / endpoint 组合，适合私有网关和兼容接口。',
    models: [
      'gpt-oss-local',
      'qwen3-coder-local',
      'deepseek-r1-local',
    ],
  },
];

const CHANNEL_PRESETS = [
  {
    id: 'telegram',
    label: 'Telegram',
    tokenKey: 'telegramBotToken',
    channelKey: 'telegramHomeChannel',
    modeKey: 'telegramReplyToMode',
    modeDefault: 'reply',
    tokenLabel: 'TELEGRAM_BOT_TOKEN',
    copy: '适合个人通知和轻量群组接入，建议同时配置 home channel 和 reply mode。',
  },
  {
    id: 'discord',
    label: 'Discord',
    tokenKey: 'discordBotToken',
    channelKey: 'discordHomeChannel',
    modeKey: 'discordReplyToMode',
    modeDefault: 'thread',
    tokenLabel: 'DISCORD_BOT_TOKEN',
    copy: '适合团队协作和线程式回复，通常会配合 Gateway 和 toolsets 一起验证。',
  },
  {
    id: 'slack',
    label: 'Slack',
    tokenKey: 'slackBotToken',
    channelKey: '',
    modeKey: '',
    modeDefault: '',
    tokenLabel: 'SLACK_BOT_TOKEN',
    copy: '先补 bot token，复杂的 Slack 工作区行为再交给 Gateway 页和日志页闭环验证。',
  },
];

const TOOLSET_WORKSPACE_PRESETS = [
  {
    id: 'cli-default',
    label: 'CLI 全能力',
    copy: '最接近 Hermes 默认 CLI 体验，适合本机直接接管和快速闭环。',
    toolsets: ['hermes-cli'],
    platformToolsets: [{ platform: 'cli', toolsets: ['hermes-cli'] }],
  },
  {
    id: 'research-coding',
    label: '研究开发',
    copy: '把搜索、浏览器、终端、文件、技能、记忆拆成显式能力面，方便精细化调优。',
    toolsets: ['web', 'browser', 'terminal', 'file', 'skills', 'todo', 'memory', 'session_search', 'code_execution'],
    platformToolsets: [
      { platform: 'cli', toolsets: ['web', 'browser', 'terminal', 'file', 'skills', 'todo', 'memory', 'session_search', 'code_execution'] },
    ],
  },
  {
    id: 'messaging-ops',
    label: '消息协作',
    copy: '桌面配置完后，顺手把 CLI、Telegram、Discord、Slack 的能力面一起拉起。',
    toolsets: ['web', 'browser', 'terminal', 'file', 'skills', 'todo', 'memory', 'session_search', 'delegation'],
    platformToolsets: [
      { platform: 'cli', toolsets: ['hermes-cli'] },
      { platform: 'telegram', toolsets: ['hermes-telegram'] },
      { platform: 'discord', toolsets: ['hermes-discord'] },
      { platform: 'slack', toolsets: ['hermes-slack'] },
    ],
  },
  {
    id: 'safe-review',
    label: '安全审阅',
    copy: '偏保守的审阅能力面，默认不暴露 terminal / file 的强写能力。',
    toolsets: ['safe', 'skills', 'todo', 'session_search'],
    platformToolsets: [{ platform: 'cli', toolsets: ['safe', 'skills', 'todo', 'session_search'] }],
  },
];

const TERMINAL_BACKEND_PRESETS = [
  {
    id: 'local',
    label: 'Local',
    backend: 'local',
    cwd: '.',
    terminalTimeout: 180,
    terminalLifetimeSeconds: 300,
    copy: '直接在当前 Mac 工作目录执行，适合本机开发与排障。',
  },
  {
    id: 'docker',
    label: 'Docker',
    backend: 'docker',
    cwd: '/workspace',
    terminalTimeout: 180,
    terminalLifetimeSeconds: 300,
    copy: '容器隔离执行环境；如果需要自定义镜像，可再进入 YAML 补 docker_image。',
    partial: true,
  },
  {
    id: 'modal',
    label: 'Modal',
    backend: 'modal',
    cwd: '/workspace',
    terminalTimeout: 180,
    terminalLifetimeSeconds: 300,
    terminalModalImage: 'debian_slim',
    copy: '云端沙盒执行，适合临时远端算力和更干净的运行环境。',
  },
  {
    id: 'daytona',
    label: 'Daytona',
    backend: 'daytona',
    cwd: '~',
    terminalTimeout: 180,
    terminalLifetimeSeconds: 300,
    copy: '偏云开发工作区形态；如需镜像或配额参数，可再进入 YAML 补充。',
    partial: true,
  },
];

let activeView = null;

function cloneWorkspace(workspace = {}) {
  return {
    modelDefault: workspace.modelDefault || '',
    modelProvider: workspace.modelProvider || '',
    modelBaseUrl: workspace.modelBaseUrl || '',
    contextEngine: workspace.contextEngine || '',
    terminalBackend: workspace.terminalBackend || '',
    terminalCwd: workspace.terminalCwd || '',
    personality: workspace.personality || '',
    streamingEnabled: Boolean(workspace.streamingEnabled),
    memoryEnabled: Boolean(workspace.memoryEnabled),
    userProfileEnabled: Boolean(workspace.userProfileEnabled),
    memoryProvider: workspace.memoryProvider || '',
    memoryCharLimit: workspace.memoryCharLimit ?? null,
    userCharLimit: workspace.userCharLimit ?? null,
    toolsets: [...(workspace.toolsets ?? [])],
    platformToolsets: (workspace.platformToolsets ?? []).map((item) => ({
      platform: item.platform || '',
      toolsets: [...(item.toolsets ?? [])],
    })),
    skillsExternalDirs: [...(workspace.skillsExternalDirs ?? [])],
    discordRequireMention: Boolean(workspace.discordRequireMention),
    discordFreeResponseChannels: workspace.discordFreeResponseChannels || '',
    discordAllowedChannels: workspace.discordAllowedChannels || '',
    discordAutoThread: Boolean(workspace.discordAutoThread),
    discordReactions: Boolean(workspace.discordReactions),
    approvalsMode: workspace.approvalsMode || 'manual',
    approvalsTimeout: workspace.approvalsTimeout ?? null,
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

function platformToolsetsToText(bindings = []) {
  return bindings
    .filter((item) => item.platform && item.toolsets?.length)
    .map((item) => `${item.platform} = ${item.toolsets.join(', ')}`)
    .join('\n');
}

function parsePlatformToolsets(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [platformPart, toolsetsPart = ''] = line.split('=');
      return {
        platform: platformPart.trim(),
        toolsets: splitLineValues(toolsetsPart),
      };
    })
    .filter((item) => item.platform);
}

function structuredConfigDirty(view) {
  if (!view.data?.workspace || !view.controlDraft) {
    return false;
  }
  return JSON.stringify(view.controlDraft) !== JSON.stringify(cloneWorkspace(view.data.workspace));
}

function structuredEnvDirty(view) {
  if (!view.data?.envWorkspace || !view.envDraft) {
    return false;
  }
  return JSON.stringify(view.envDraft) !== JSON.stringify(cloneEnvWorkspace(view.data.envWorkspace));
}

function envPresetReady(view, key) {
  if (!key) {
    return false;
  }
  return Boolean(view.envDraft?.[key]?.trim());
}

function getProviderPreset(id) {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) || null;
}

function getChannelPreset(id) {
  return CHANNEL_PRESETS.find((preset) => preset.id === id) || null;
}

function getToolsetPreset(id) {
  return TOOLSET_WORKSPACE_PRESETS.find((preset) => preset.id === id) || null;
}

function getTerminalPreset(id) {
  return TERMINAL_BACKEND_PRESETS.find((preset) => preset.id === id) || null;
}

function uniqueValues(values = []) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  );
}

function normalizePlatformBindings(bindings = []) {
  return [...(bindings ?? [])]
    .map((item) => ({
      platform: String(item?.platform ?? '').trim(),
      toolsets: uniqueValues(item?.toolsets ?? []),
    }))
    .filter((item) => item.platform)
    .sort((left, right) => left.platform.localeCompare(right.platform));
}

function sameStringArray(left = [], right = []) {
  const normalizedLeft = uniqueValues(left);
  const normalizedRight = uniqueValues(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function samePlatformBindings(left = [], right = []) {
  return JSON.stringify(normalizePlatformBindings(left)) === JSON.stringify(normalizePlatformBindings(right));
}

function toolsetPresetActive(draft, preset) {
  if (!draft || !preset) {
    return false;
  }
  return sameStringArray(draft.toolsets, preset.toolsets)
    && samePlatformBindings(draft.platformToolsets, preset.platformToolsets);
}

function previewJoined(values = [], emptyLabel = '—', limit = 3) {
  const normalized = uniqueValues(values);
  if (!normalized.length) {
    return emptyLabel;
  }
  if (normalized.length <= limit) {
    return normalized.join(', ');
  }
  return `${normalized.slice(0, limit).join(', ')} +${normalized.length - limit}`;
}

function platformBindingsPreview(bindings = [], emptyLabel = '—', limit = 2) {
  const normalized = normalizePlatformBindings(bindings);
  if (!normalized.length) {
    return emptyLabel;
  }
  const labels = normalized.map((item) => `${item.platform}=${previewJoined(item.toolsets, '—', 2)}`);
  if (labels.length <= limit) {
    return labels.join(' · ');
  }
  return `${labels.slice(0, limit).join(' · ')} +${labels.length - limit}`;
}

function memoryProviderPresets(view) {
  const installed = view.extensions?.memoryRuntime?.installedPlugins ?? [];
  const dynamicPresets = installed.map((item) => ({
    id: `memory:${item.name}`,
    label: item.name,
    provider: item.name,
    availability: item.availability || '已发现插件',
    copy: item.availability || '运行态已发现该记忆插件，可直接切换为默认 provider。',
    memoryEnabled: true,
    userProfileEnabled: true,
  }));

  return [
    {
      id: 'memory-off',
      label: '关闭记忆',
      provider: view.controlDraft?.memoryProvider || '',
      availability: '关闭',
      copy: '适合极简会话或临时排查，把长期记忆和用户画像一起关闭。',
      memoryEnabled: false,
      userProfileEnabled: false,
    },
    {
      id: 'builtin-file',
      label: 'Builtin File',
      provider: '',
      availability: '内置',
      copy: '零依赖的本地文件记忆，最稳妥，也最适合桌面客户端默认闭环。',
      memoryEnabled: true,
      userProfileEnabled: true,
    },
    ...dynamicPresets,
  ];
}

function getMemoryPreset(view, id) {
  return memoryProviderPresets(view).find((preset) => preset.id === id) || null;
}

function memoryPresetActive(view, preset) {
  if (!preset || !view.controlDraft) {
    return false;
  }
  if (!preset.memoryEnabled) {
    return !view.controlDraft.memoryEnabled;
  }
  return view.controlDraft.memoryEnabled && String(view.controlDraft.memoryProvider || '') === String(preset.provider || '');
}

function terminalPresetActive(view, preset) {
  if (!preset || !view.controlDraft) {
    return false;
  }
  const modalImage = String(view.envDraft?.terminalModalImage || '').trim();
  const presetImage = String(preset.terminalModalImage || '').trim();
  return String(view.controlDraft.terminalBackend || '') === String(preset.backend || '')
    && String(view.controlDraft.terminalCwd || '') === String(preset.cwd || '')
    && (presetImage ? modalImage === presetImage : true);
}

function renderModelPresetChips(view, preset, draft) {
  const models = preset?.models ?? [];
  if (!models.length) {
    return '';
  }

  return `
    <div class="selection-chip-grid">
      ${models.map((model) => buttonHtml({
        action: 'apply-model-preset',
        label: model,
        kind: draft.modelProvider === preset.provider && draft.modelDefault === model ? 'primary' : 'secondary',
        className: `selection-chip${draft.modelProvider === preset.provider && draft.modelDefault === model ? ' selection-chip-active' : ''}`,
        attrs: {
          'data-model': model,
          'data-preset': preset.id,
        },
      })).join('')}
    </div>
  `;
}

function currentEditorBadge(view) {
  switch (view.editorTab) {
    case 'control':
      return '控制面';
    case 'credentials':
      return '凭证';
    case 'config':
      return 'YAML';
    case 'env':
      return 'ENV';
    default:
      return '工作台';
  }
}

function runtimeWarnings(data, snapshot, skills, extensions, cronSnapshot) {
  const warnings = [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const runtimeLocalSkills = localRuntimeSkillCount(extensions);

  if (!data.summary.modelDefault || !data.summary.modelProvider) {
    warnings.push('默认模型或 provider 缺失，主对话链路还不稳定。');
  }
  if (!data.summary.contextEngine) {
    warnings.push('当前没有显式声明 context.engine，能力编排很难一眼判断。');
  }
  if (!data.summary.terminalBackend) {
    warnings.push('终端后端为空，很多命令与文件类工具会缺乏稳定执行语义。');
  }
  if (!data.summary.toolsets.length) {
    warnings.push('当前没有配置 toolsets，模型可见能力面偏窄。');
  }
  if (!skills.length) {
    warnings.push('当前 profile 下没有扫描到本地 skills，闭环能力会明显下降。');
  }
  if (data.summary.memoryEnabled === false) {
    warnings.push('记忆功能关闭后，长期 persona 和记忆闭环会被削弱。');
  }
  if (data.summary.memoryEnabled && data.summary.userProfileEnabled === false) {
    warnings.push('USER 画像记忆当前关闭，长期个体偏好跟踪会偏弱。');
  }
  if (snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 当前未运行，配置改动还没有在消息链路上得到验证。');
  }
  if (data.summary.memoryProvider && extensions?.memoryRuntime.provider.includes('none')) {
    warnings.push(`配置声明了 memory provider「${data.summary.memoryProvider}」，但运行态仍像 built-in only。`);
  }
  if (data.summary.toolsets.length > 0 && extensions && enabledToolCount(extensions) === 0) {
    warnings.push('配置里声明了 toolsets，但运行态没解析出已启用 tools，建议立刻体检。');
  }
  if (remoteJobs.length > 0 && snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端作业依赖 Gateway，但网关不在 running 状态。`);
  }
  if (runtimeLocalSkills !== skills.length) {
    warnings.push(`CLI 运行态 local skills 为 ${runtimeLocalSkills} 个，本地目录扫描到 ${skills.length} 个，存在安装态偏差。`);
  }

  return Array.from(new Set(warnings));
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

function workspaceSectionFromFocus(focus) {
  switch (focus) {
    case 'model':
      return { tab: 'control', sectionId: 'model-presets' };
    case 'credentials':
      return { tab: 'credentials', sectionId: 'provider-credentials' };
    case 'toolsets':
      return { tab: 'control', sectionId: 'toolsets-presets' };
    case 'memory':
      return { tab: 'control', sectionId: 'memory-presets' };
    case 'context':
      return { tab: 'credentials', sectionId: 'channel-credentials' };
    default:
      return null;
  }
}

function queueWorkspaceFocus(view, tab, sectionId, behavior = 'smooth') {
  view.editorTab = tab;
  view.activeWorkspaceSection = sectionId || null;
  view.pendingSectionFocus = sectionId ? { tab, sectionId, behavior } : null;
  renderPage(view);
}

function flushPendingSectionFocus(view) {
  const pending = view.pendingSectionFocus;
  if (!pending || pending.tab !== view.editorTab) {
    return;
  }

  view.pendingSectionFocus = null;
  if (!pending.sectionId) {
    return;
  }

  const target = view.page.querySelector(`[data-workspace-section="${pending.sectionId}"]`);
  if (!target) {
    return;
  }

  requestAnimationFrame(() => {
    target.scrollIntoView({
      behavior: pending.behavior || 'smooth',
      block: 'start',
    });
  });
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'config',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'config',
        headline: '来自配置中心的链路下钻',
        description: '继续围绕模型、toolsets、provider 和 Gateway 关联配置做排查。',
      };
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">配置中心</h1>
      </div>
      <p class="page-desc">正在同步 Hermes 配置文件、运行态摘要和扩展闭环信号。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:124px"></div>').join('')}
    </div>
  `;
}

function renderWorkbenchCommands(view) {
  return CONFIG_WORKBENCH_KEYS
    .map((key) => getDiagnosticCommand(key))
    .filter(Boolean)
    .map((command) => `
      <section class="action-card">
        <div class="action-card-header">
          <div>
            <p class="eyebrow">${escapeHtml(command.scope === 'capability' ? 'Capability' : 'Runtime')}</p>
            <h3 class="action-card-title">${escapeHtml(command.label)}</h3>
          </div>
          ${pillHtml(command.key, command.kind === 'primary' ? 'good' : 'neutral')}
        </div>
        <p class="action-card-copy">${escapeHtml(command.description)}</p>
        <p class="command-line">${escapeHtml(command.cli)}</p>
        <div class="toolbar">
          ${buttonHtml({
            action: `diagnostic-${command.key}`,
            label: view.runningDiagnostic === command.key ? `${command.label}…` : `执行${command.label}`,
            kind: command.kind,
            disabled: Boolean(view.runningDiagnostic),
          })}
          ${buttonHtml({
            action: 'goto-related-page',
            label: '进入相关页',
            attrs: { 'data-page': command.relatedPage },
          })}
        </div>
      </section>
    `)
    .join('');
}

function renderEditorTabs(view, configDirty, envDirty, structuredDirty, credentialsDirty) {
  const tabs = [
    {
      key: 'control',
      label: '控制面',
      dirty: structuredDirty,
    },
    {
      key: 'credentials',
      label: '凭证',
      dirty: credentialsDirty,
    },
    {
      key: 'config',
      label: 'config.yaml',
      dirty: configDirty,
    },
    {
      key: 'env',
      label: '.env',
      dirty: envDirty,
    },
  ];

  return `
    <div class="tab-bar">
      ${tabs.map((tab) => `
        <button
          type="button"
          class="tab ${view.editorTab === tab.key ? 'active' : ''}"
          data-action="switch-editor-tab"
          data-tab="${escapeHtml(tab.key)}"
        >
          ${escapeHtml(tab.label)}
          ${tab.dirty ? ' *' : ''}
        </button>
      `).join('')}
    </div>
  `;
}

function renderConfigRail(view, context) {
  const {
    actionBusy,
    data,
    enabledTools,
    installation,
    localSkills,
    remoteJobs,
    skills,
    snapshot,
    totalTools,
    warnings,
  } = context;
  const env = data.envWorkspace ?? {};
  const credentialsCount = [
    env.openaiApiKey,
    env.openrouterApiKey,
    env.anthropicApiKey,
    env.googleApiKey,
    env.hfToken,
    env.hermesGatewayToken,
  ].filter((value) => String(value ?? '').trim()).length;
  const channelCount = [
    env.telegramBotToken,
    env.telegramHomeChannel,
    env.discordBotToken,
    env.discordHomeChannel,
    env.slackBotToken,
  ].filter((value) => String(value ?? '').trim()).length;

  return `
    <div class="workspace-rail-header">
      <div>
        <strong>运行校验</strong>
        <p class="workspace-main-copy">主区直改，侧栏只做导航和闭环。</p>
      </div>
      ${pillHtml(warnings.length === 0 ? '稳定' : `${warnings.length} 条提醒`, warnings.length === 0 ? 'good' : 'warn')}
    </div>
    <div class="detail-list compact">
      <div class="key-value-row">
        <span>Model</span>
        <strong>${escapeHtml(`${data.summary.modelProvider || '未配置'} / ${data.summary.modelDefault || '未配置'}`)}</strong>
      </div>
      <div class="key-value-row">
        <span>Terminal</span>
        <strong>${escapeHtml(data.summary.terminalBackend || '未配置')}</strong>
      </div>
      <div class="key-value-row">
        <span>Tools</span>
        <strong>${escapeHtml(`${data.summary.toolsets.length} / ${enabledTools} / ${totalTools}`)}</strong>
      </div>
      <div class="key-value-row">
        <span>Gateway</span>
        <strong>${escapeHtml(snapshot?.gateway?.gatewayState || '未检测到')}</strong>
      </div>
      <div class="key-value-row">
        <span>Skills</span>
        <strong>${escapeHtml(`${localSkills}/${skills.length}`)}</strong>
      </div>
    </div>
    ${warnings.length > 0
      ? `<div class="warning-stack top-gap">${warnings.slice(0, 2).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
      : `<p class="helper-text">当前没有明显结构性风险。</p>`}

    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">主工作台</span>
        ${pillHtml(view.editorTab === 'credentials' ? '凭证面' : '控制面', 'neutral')}
      </div>
      <div class="workspace-shortcut-grid">
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '模型',
          meta: `${data.summary.modelProvider || 'provider 待配'} · ${data.summary.modelDefault || '默认模型待配'}`,
          active: view.activeWorkspaceSection === 'model-presets',
          attrs: {
            'data-tab': 'control',
            'data-section': 'model-presets',
          },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '能力面',
          meta: `${data.summary.toolsets.length} 组 toolsets · ${enabledTools} 个 tools`,
          active: view.activeWorkspaceSection === 'toolsets-presets',
          attrs: {
            'data-tab': 'control',
            'data-section': 'toolsets-presets',
          },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '记忆',
          meta: data.summary.memoryEnabled ? (data.summary.memoryProvider || 'builtin-file') : 'memory off',
          active: view.activeWorkspaceSection === 'memory-presets',
          attrs: {
            'data-tab': 'control',
            'data-section': 'memory-presets',
          },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '凭证',
          meta: `${credentialsCount} 项密钥已填`,
          active: view.activeWorkspaceSection === 'provider-credentials',
          attrs: {
            'data-tab': 'credentials',
            'data-section': 'provider-credentials',
          },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '通道',
          meta: `${channelCount} 项通道参数 · ${remoteJobs.length} 个远端作业`,
          active: view.activeWorkspaceSection === 'channel-credentials',
          attrs: {
            'data-tab': 'credentials',
            'data-section': 'channel-credentials',
          },
        })}
        ${shortcutCardHtml({
          action: 'goto-gateway',
          label: 'Gateway',
          meta: snapshot?.gateway?.gatewayState || '进入网关工作台',
        })}
      </div>
    </section>

    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">体检</span>
        ${pillHtml(remoteJobs.length > 0 ? `${remoteJobs.length} 远端作业` : '本地优先', remoteJobs.length > 0 ? 'warn' : 'neutral')}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-grid">
        ${buttonHtml({ action: 'diagnostic-config-check', label: view.runningDiagnostic === 'config-check' ? '配置体检…' : '配置体检', kind: 'primary', disabled: actionBusy })}
        ${buttonHtml({ action: 'diagnostic-memory-status', label: '记忆状态', disabled: actionBusy })}
        ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: actionBusy })}
        ${buttonHtml({ action: 'diagnostic-doctor', label: 'Doctor', disabled: actionBusy })}
      </div>
    </section>

    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">文件与页内联动</span>
        ${pillHtml(`${localSkills}/${skills.length} Skills`, localSkills === skills.length ? 'good' : 'warn')}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-grid">
        ${buttonHtml({ action: 'open-config', label: '定位 YAML', disabled: actionBusy })}
        ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: actionBusy })}
        ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: actionBusy })}
        ${buttonHtml({ action: 'goto-extensions', label: '扩展页' })}
      </div>
    </section>

    <section class="workspace-rail-section workspace-compat-card">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">高级兼容动作</span>
        ${buttonHtml({
          action: 'toggle-compatibility-actions',
          label: view.showCompatibilityActions ? '收起' : '展开',
          kind: 'secondary',
        })}
      </div>
      <p class="helper-text">只保留系统边界动作；模型、通道、记忆、插件、skills 优先走客户端工作台。</p>
      ${view.showCompatibilityActions ? `
        <div class="workspace-compat-panel">
          ${buttonHtml({ action: 'terminal-setup', label: '官方 Setup', disabled: actionBusy || !installation.binaryFound })}
          ${buttonHtml({ action: 'terminal-config-migrate', label: '迁移旧配置', disabled: actionBusy || !installation.binaryFound })}
          ${buttonHtml({ action: 'terminal-claw-migrate', label: '导入 OpenClaw', disabled: actionBusy || !installation.binaryFound })}
        </div>
      ` : ''}
    </section>
  `;
}

function renderStructuredControls(view) {
  const draft = view.controlDraft ?? cloneWorkspace();
  const memoryPresets = memoryProviderPresets(view);
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <strong>结构化控制面</strong>
              ${infoTipHtml('优先在客户端里直接完成模型、memory、toolsets 等高频配置，尽量减少回 Hermes CLI 跑交互式向导。')}
            </div>
          </div>
          <div class="pill-row">
            ${pillHtml(draft.modelProvider || 'provider 未配', draft.modelProvider ? 'good' : 'warn')}
            ${pillHtml(draft.memoryEnabled ? 'Memory On' : 'Memory Off', draft.memoryEnabled ? 'good' : 'warn')}
            ${pillHtml(draft.toolsets.length ? `${draft.toolsets.length} Toolsets` : '无 Toolsets', draft.toolsets.length ? 'good' : 'warn')}
          </div>
        </div>

        <section class="workspace-summary-strip">
          <section class="summary-mini-card">
            <span class="summary-mini-label">当前主模型</span>
            <strong class="summary-mini-value">${escapeHtml(draft.modelDefault || '待选择')}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.modelProvider || 'provider 未配')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">能力暴露</span>
            <strong class="summary-mini-value">${escapeHtml(String(draft.toolsets.length))}</strong>
            <span class="summary-mini-meta">${escapeHtml(platformBindingsPreview(draft.platformToolsets, '无平台绑定', 2))}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">记忆与画像</span>
            <strong class="summary-mini-value">${escapeHtml(draft.memoryEnabled ? (draft.memoryProvider || 'builtin-file') : 'off')}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.userProfileEnabled ? 'user profile on' : 'user profile off')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">终端后端</span>
            <strong class="summary-mini-value">${escapeHtml(draft.terminalBackend || '待配置')}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.terminalCwd || '未声明 cwd')}</span>
          </section>
        </section>

        <section class="preset-strip workspace-section-anchor" data-workspace-section="model-presets">
          <div class="preset-strip-header">
            <div>
              <div class="panel-title-row">
                <strong>模型工作台</strong>
                ${infoTipHtml('像 clawpanel 一样先决定 provider，再直接点选常用 model。这里会同时改 provider、base URL 和默认模型。')}
              </div>
            </div>
            ${buttonHtml({ action: 'switch-editor-tab', label: '去配凭证', attrs: { 'data-tab': 'credentials' } })}
          </div>
          <div class="preset-card-grid workspace-preset-grid">
            ${MODEL_PROVIDER_PRESETS.map((preset) => `
              <section class="preset-card">
                <div class="preset-card-head">
                  <div class="preset-card-heading">
                    <strong>${escapeHtml(preset.label)}</strong>
                    <span class="preset-card-caption">${escapeHtml(preset.provider)}</span>
                  </div>
                  <div class="pill-row">
                    ${draft.modelProvider === preset.provider ? pillHtml('当前使用', 'good') : ''}
                    ${preset.envKey ? pillHtml(envPresetReady(view, preset.envKey) ? '密钥已就绪' : '缺少密钥', envPresetReady(view, preset.envKey) ? 'good' : 'warn') : pillHtml('自定义', 'neutral')}
                  </div>
                </div>
                <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
                <code class="preset-inline-code">${escapeHtml(preset.baseUrl || '保留当前 Base URL，适合本地兼容端点')}</code>
                ${renderModelPresetChips(view, preset, draft)}
                <div class="preset-card-foot">
                  <div class="toolbar top-gap">
                    ${buttonHtml({ action: 'apply-provider-preset', label: '应用 Provider', kind: 'primary', attrs: { 'data-preset': preset.id } })}
                    ${preset.envKey ? buttonHtml({ action: 'switch-editor-tab', label: preset.envLabel, attrs: { 'data-tab': 'credentials' } }) : ''}
                  </div>
                </div>
              </section>
            `).join('')}
          </div>
        </section>

        <section class="preset-strip workspace-section-anchor" data-workspace-section="toolsets-presets">
          <div class="preset-strip-header">
            <div>
              <div class="panel-title-row">
                <strong>能力预设</strong>
                ${infoTipHtml('直接写入 toolsets 和 platform_toolsets，用预设替代大部分“工具选择”命令行向导。')}
              </div>
            </div>
          </div>
          <div class="preset-card-grid">
            ${TOOLSET_WORKSPACE_PRESETS.map((preset) => `
              <section class="preset-card">
                <div class="preset-card-head">
                  <div class="preset-card-heading">
                    <strong>${escapeHtml(preset.label)}</strong>
                    <span class="preset-card-caption">${escapeHtml(previewJoined(preset.toolsets, '—', 4))}</span>
                  </div>
                  <div class="pill-row">
                    ${toolsetPresetActive(draft, preset) ? pillHtml('当前方案', 'good') : ''}
                    ${pillHtml(`${preset.toolsets.length} 组`, 'neutral')}
                    ${pillHtml(`${preset.platformToolsets.length} 平台`, preset.platformToolsets.length ? 'neutral' : 'warn')}
                  </div>
                </div>
                <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
                <code class="preset-inline-code">${escapeHtml(platformBindingsPreview(preset.platformToolsets, '只写顶层 toolsets', 2))}</code>
                <div class="preset-card-foot">
                  <div class="toolbar top-gap">
                    ${buttonHtml({ action: 'apply-toolset-preset', label: '应用能力面', kind: 'primary', attrs: { 'data-preset': preset.id } })}
                  </div>
                </div>
              </section>
            `).join('')}
          </div>
        </section>

        <section class="preset-strip workspace-section-anchor" data-workspace-section="memory-presets">
          <div class="preset-strip-header">
            <div>
              <div class="panel-title-row">
                <strong>记忆 Provider</strong>
                ${infoTipHtml('直接切换默认 memory provider，并同步打开或关闭 memory / user profile。')}
              </div>
            </div>
            ${buttonHtml({ action: 'goto-memory', label: '记忆页' })}
          </div>
          <div class="preset-card-grid">
            ${memoryPresets.map((preset) => `
              <section class="preset-card">
                <div class="preset-card-head">
                  <div class="preset-card-heading">
                    <strong>${escapeHtml(preset.label)}</strong>
                    <span class="preset-card-caption">${escapeHtml(preset.availability)}</span>
                  </div>
                  <div class="pill-row">
                    ${memoryPresetActive(view, preset) ? pillHtml('当前使用', 'good') : ''}
                    ${pillHtml(preset.memoryEnabled ? 'memory on' : 'memory off', preset.memoryEnabled ? 'neutral' : 'warn')}
                  </div>
                </div>
                <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
                <code class="preset-inline-code">${escapeHtml(preset.provider || 'builtin-file')}</code>
                <div class="preset-card-foot">
                  <div class="toolbar top-gap">
                    ${buttonHtml({ action: 'apply-memory-preset', label: preset.memoryEnabled ? '设为默认' : '关闭记忆', kind: preset.memoryEnabled ? 'primary' : 'secondary', attrs: { 'data-preset': preset.id } })}
                  </div>
                </div>
              </section>
            `).join('')}
          </div>
        </section>

        <section class="preset-strip workspace-section-anchor" data-workspace-section="runtime-presets">
          <div class="preset-strip-header">
            <div>
              <div class="panel-title-row">
                <strong>Terminal Backend</strong>
                ${infoTipHtml('先用常见 backend 预设把 backend、cwd 和基础 timeout 写好，确实需要更细参数时再进 YAML 精修。')}
              </div>
            </div>
          </div>
          <div class="preset-card-grid">
            ${TERMINAL_BACKEND_PRESETS.map((preset) => `
              <section class="preset-card">
                <div class="preset-card-head">
                  <div class="preset-card-heading">
                    <strong>${escapeHtml(preset.label)}</strong>
                    <span class="preset-card-caption">${escapeHtml(preset.backend)}</span>
                  </div>
                  <div class="pill-row">
                    ${terminalPresetActive(view, preset) ? pillHtml('当前后端', 'good') : ''}
                    ${preset.partial ? pillHtml('可继续精修', 'warn') : pillHtml('结构化可配', 'neutral')}
                  </div>
                </div>
                <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
                <code class="preset-inline-code">${escapeHtml(`${preset.cwd} · timeout ${preset.terminalTimeout}s${preset.terminalModalImage ? ` · ${preset.terminalModalImage}` : ''}`)}</code>
                <div class="preset-card-foot">
                  <div class="toolbar top-gap">
                    ${buttonHtml({ action: 'apply-terminal-preset', label: '应用后端', kind: 'primary', attrs: { 'data-preset': preset.id } })}
                  </div>
                </div>
              </section>
            `).join('')}
          </div>
        </section>

        <div class="control-card-grid">
          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="model-detail">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Model</p>
                <h3 class="action-card-title">模型与上下文</h3>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>默认模型</span>
                <input class="search-input" id="control-model-default" value="${escapeHtml(draft.modelDefault)}" placeholder="gpt-5.4">
              </label>
              <label class="field-stack">
                <span>Provider</span>
                <input class="search-input" id="control-model-provider" value="${escapeHtml(draft.modelProvider)}" placeholder="openai / anthropic / custom">
              </label>
              <label class="field-stack">
                <span>Base URL</span>
                <input class="search-input" id="control-model-base-url" value="${escapeHtml(draft.modelBaseUrl)}" placeholder="https://api.example.com/v1">
              </label>
              <label class="field-stack">
                <span>Context Engine</span>
                <input class="search-input" id="control-context-engine" value="${escapeHtml(draft.contextEngine)}" placeholder="compressor">
              </label>
            </div>
            <label class="field-stack">
              <span>Personality</span>
              <input class="search-input" id="control-personality" value="${escapeHtml(draft.personality)}" placeholder="helpful / technical / concise">
            </label>
            <div class="checkbox-row top-gap">
              <label>
                <input type="checkbox" id="control-streaming-enabled" ${draft.streamingEnabled ? 'checked' : ''}>
                <span>启用 Streaming</span>
              </label>
            </div>
          </section>

          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="toolsets-detail">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Toolsets</p>
                <h3 class="action-card-title">能力暴露与平台绑定</h3>
              </div>
            </div>
            <label class="field-stack">
              <span>顶层 Toolsets</span>
              <textarea class="editor compact-control-editor" id="control-toolsets" placeholder="hermes-cli&#10;web">${escapeHtml(draft.toolsets.join('\n'))}</textarea>
            </label>
            <label class="field-stack top-gap">
              <span>平台 Toolsets</span>
              <textarea class="editor compact-control-editor" id="control-platform-toolsets" placeholder="cli = hermes-cli, web&#10;discord = hermes-discord">${escapeHtml(platformToolsetsToText(draft.platformToolsets))}</textarea>
            </label>
            <p class="helper-text">格式：平台 = toolset1, toolset2。</p>
          </section>

          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="memory-detail">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Memory</p>
                <h3 class="action-card-title">记忆与 Skills 目录</h3>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>Memory Provider</span>
                <input class="search-input" id="control-memory-provider" value="${escapeHtml(draft.memoryProvider)}" placeholder="留空表示 builtin-file">
              </label>
              <label class="field-stack">
                <span>Memory Char Limit</span>
                <input class="search-input" id="control-memory-char-limit" value="${escapeHtml(draft.memoryCharLimit ?? '')}" placeholder="2200">
              </label>
              <label class="field-stack">
                <span>User Char Limit</span>
                <input class="search-input" id="control-user-char-limit" value="${escapeHtml(draft.userCharLimit ?? '')}" placeholder="1375">
              </label>
            </div>
            <div class="checkbox-row">
              <label>
                <input type="checkbox" id="control-memory-enabled" ${draft.memoryEnabled ? 'checked' : ''}>
                <span>启用 Memory</span>
              </label>
              <label>
                <input type="checkbox" id="control-user-profile-enabled" ${draft.userProfileEnabled ? 'checked' : ''}>
                <span>启用 User Profile</span>
              </label>
            </div>
            <label class="field-stack">
              <span>外部 Skills 目录</span>
              <textarea class="editor compact-control-editor" id="control-skills-external-dirs" placeholder="/Users/me/skills&#10;/opt/hermes-skills">${escapeHtml(draft.skillsExternalDirs.join('\n'))}</textarea>
            </label>
          </section>

          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="runtime-detail">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Runtime</p>
                <h3 class="action-card-title">终端、审批与 Discord 路由</h3>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>Terminal Backend</span>
                <input class="search-input" id="control-terminal-backend" value="${escapeHtml(draft.terminalBackend)}" placeholder="local / docker / modal">
              </label>
              <label class="field-stack">
                <span>Terminal CWD</span>
                <input class="search-input" id="control-terminal-cwd" value="${escapeHtml(draft.terminalCwd)}" placeholder=".">
              </label>
              <label class="field-stack">
                <span>审批模式</span>
                <select class="select-input" id="control-approvals-mode">
                  ${['manual', 'auto', 'disabled'].map((item) => `
                    <option value="${item}" ${draft.approvalsMode === item ? 'selected' : ''}>${item}</option>
                  `).join('')}
                </select>
              </label>
              <label class="field-stack">
                <span>审批超时</span>
                <input class="search-input" id="control-approvals-timeout" value="${escapeHtml(draft.approvalsTimeout ?? '')}" placeholder="60">
              </label>
            </div>
            <div class="checkbox-row">
              <label>
                <input type="checkbox" id="control-discord-require-mention" ${draft.discordRequireMention ? 'checked' : ''}>
                <span>Discord 需要 @ 提及</span>
              </label>
              <label>
                <input type="checkbox" id="control-discord-auto-thread" ${draft.discordAutoThread ? 'checked' : ''}>
                <span>自动开线程</span>
              </label>
              <label>
                <input type="checkbox" id="control-discord-reactions" ${draft.discordReactions ? 'checked' : ''}>
                <span>启用状态反应</span>
              </label>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>自由响应频道</span>
                <input class="search-input" id="control-discord-free-response" value="${escapeHtml(draft.discordFreeResponseChannels)}" placeholder="dev,ops">
              </label>
              <label class="field-stack">
                <span>允许频道</span>
                <input class="search-input" id="control-discord-allowed" value="${escapeHtml(draft.discordAllowedChannels)}" placeholder="general,alerts">
              </label>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderStructuredEnvControls(view) {
  const draft = view.envDraft ?? cloneEnvWorkspace();
  const credentialsCount = [
    draft.openaiApiKey,
    draft.openrouterApiKey,
    draft.anthropicApiKey,
    draft.googleApiKey,
    draft.hfToken,
    draft.anyrouter2ApiKey,
    draft.crsApiKey,
    draft.siliconflowApiKey,
    draft.hermesGatewayToken,
    draft.telegramBotToken,
    draft.discordBotToken,
    draft.slackBotToken,
  ].filter((value) => value.trim()).length;
  const channelCount = [
    draft.telegramHomeChannel,
    draft.telegramReplyToMode,
    draft.discordHomeChannel,
    draft.discordReplyToMode,
  ].filter((value) => value.trim()).length;

  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <strong>凭证与通道控制面</strong>
              ${infoTipHtml('模型密钥、Gateway Token、消息通道凭证和运行时 .env 都优先在客户端内完成，避免把常见配置再交给 Terminal。')}
            </div>
          </div>
          <div class="pill-row">
            ${pillHtml(credentialsCount ? `${credentialsCount} 项已填` : '暂无密钥', credentialsCount ? 'good' : 'warn')}
            ${pillHtml(channelCount ? `${channelCount} 项通道参数` : '通道参数待补', channelCount ? 'neutral' : 'warn')}
            ${pillHtml(draft.whatsappEnabled ? 'WhatsApp On' : 'WhatsApp Off', draft.whatsappEnabled ? 'good' : 'neutral')}
          </div>
        </div>

        <section class="workspace-summary-strip">
          <section class="summary-mini-card">
            <span class="summary-mini-label">模型凭证</span>
            <strong class="summary-mini-value">${escapeHtml(String(credentialsCount))}</strong>
            <span class="summary-mini-meta">已写入的 provider / gateway / channel token 数</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">消息通道</span>
            <strong class="summary-mini-value">${escapeHtml(String(channelCount))}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.telegramBotToken || draft.discordBotToken || draft.slackBotToken ? '已有至少一个消息入口' : '通道 token 仍待补齐')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">Gateway Token</span>
            <strong class="summary-mini-value">${escapeHtml(draft.hermesGatewayToken ? '已写入' : '未写入')}</strong>
            <span class="summary-mini-meta">用于 Gateway / 多平台闭环</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">运行时变量</span>
            <strong class="summary-mini-value">${escapeHtml(draft.terminalModalImage || '默认')}</strong>
            <span class="summary-mini-meta">${escapeHtml(`terminal ${draft.terminalTimeout ?? '—'}s · browser ${draft.browserSessionTimeout ?? '—'}s`)}</span>
          </section>
        </section>

        <section class="preset-strip workspace-section-anchor" data-workspace-section="channel-presets">
          <div class="preset-strip-header">
            <div>
              <div class="panel-title-row">
                <strong>通道骨架</strong>
                ${infoTipHtml('为 Telegram、Discord、Slack 预填推荐的 reply mode 和最小通道骨架，后续只需要补 token / channel id 即可。')}
              </div>
            </div>
          </div>
          <div class="preset-card-grid">
            ${CHANNEL_PRESETS.map((preset) => `
              <section class="preset-card">
                <div class="preset-card-head">
                  <strong>${escapeHtml(preset.label)}</strong>
                  <div class="pill-row">
                    ${pillHtml(envPresetReady(view, preset.tokenKey) ? 'Token 已填' : '待填 Token', envPresetReady(view, preset.tokenKey) ? 'good' : 'warn')}
                    ${preset.modeKey ? pillHtml(view.envDraft?.[preset.modeKey]?.trim() ? view.envDraft[preset.modeKey] : '默认模式未写入', view.envDraft?.[preset.modeKey]?.trim() ? 'neutral' : 'warn') : pillHtml('仅 Token', 'neutral')}
                  </div>
                </div>
                <p>${escapeHtml(preset.copy)}</p>
                <code class="preset-inline-code">${escapeHtml(preset.modeKey ? `${preset.modeKey} = ${preset.modeDefault}` : `${preset.tokenLabel} = ...`)}</code>
                <div class="toolbar top-gap">
                  ${buttonHtml({ action: 'apply-channel-preset', label: '应用骨架', kind: 'primary', attrs: { 'data-preset': preset.id } })}
                </div>
              </section>
            `).join('')}
          </div>
        </section>

        <div class="control-card-grid">
          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="provider-credentials">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Models</p>
                <h3 class="action-card-title">模型通道凭证</h3>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>OpenAI API Key</span>
                <input class="search-input" id="env-openai-api-key" value="${escapeHtml(draft.openaiApiKey)}" placeholder="sk-..." spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>Anthropic API Key</span>
                <input class="search-input" id="env-anthropic-api-key" value="${escapeHtml(draft.anthropicApiKey)}" placeholder="sk-ant-..." spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>OpenRouter API Key</span>
                <input class="search-input" id="env-openrouter-api-key" value="${escapeHtml(draft.openrouterApiKey)}" placeholder="sk-or-..." spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>Google API Key</span>
                <input class="search-input" id="env-google-api-key" value="${escapeHtml(draft.googleApiKey)}" placeholder="AIza..." spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>HF Token</span>
                <input class="search-input" id="env-hf-token" value="${escapeHtml(draft.hfToken)}" placeholder="hf_..." spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>AnyRouter 2 API Key</span>
                <input class="search-input" id="env-anyrouter2-api-key" value="${escapeHtml(draft.anyrouter2ApiKey)}" placeholder="填写 AnyRouter 2 token" spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>CRS API Key</span>
                <input class="search-input" id="env-crs-api-key" value="${escapeHtml(draft.crsApiKey)}" placeholder="填写 CRS token" spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>SiliconFlow API Key</span>
                <input class="search-input" id="env-siliconflow-api-key" value="${escapeHtml(draft.siliconflowApiKey)}" placeholder="填写 SiliconFlow token" spellcheck="false" autocomplete="off">
              </label>
            </div>
          </section>

          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="channel-credentials">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Gateway</p>
                <h3 class="action-card-title">网关与消息通道</h3>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>Hermes Gateway Token</span>
                <input class="search-input" id="env-hermes-gateway-token" value="${escapeHtml(draft.hermesGatewayToken)}" placeholder="gateway token" spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>Telegram Bot Token</span>
                <input class="search-input" id="env-telegram-bot-token" value="${escapeHtml(draft.telegramBotToken)}" placeholder="telegram bot token" spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>Telegram Home Channel</span>
                <input class="search-input" id="env-telegram-home-channel" value="${escapeHtml(draft.telegramHomeChannel)}" placeholder="home channel / chat id">
              </label>
              <label class="field-stack">
                <span>Telegram Reply Mode</span>
                <input class="search-input" id="env-telegram-reply-to-mode" value="${escapeHtml(draft.telegramReplyToMode)}" placeholder="inline / thread / reply">
              </label>
              <label class="field-stack">
                <span>Discord Bot Token</span>
                <input class="search-input" id="env-discord-bot-token" value="${escapeHtml(draft.discordBotToken)}" placeholder="discord bot token" spellcheck="false" autocomplete="off">
              </label>
              <label class="field-stack">
                <span>Discord Home Channel</span>
                <input class="search-input" id="env-discord-home-channel" value="${escapeHtml(draft.discordHomeChannel)}" placeholder="channel id / alias">
              </label>
              <label class="field-stack">
                <span>Discord Reply Mode</span>
                <input class="search-input" id="env-discord-reply-to-mode" value="${escapeHtml(draft.discordReplyToMode)}" placeholder="inline / thread / reply">
              </label>
              <label class="field-stack">
                <span>Slack Bot Token</span>
                <input class="search-input" id="env-slack-bot-token" value="${escapeHtml(draft.slackBotToken)}" placeholder="xoxb-..." spellcheck="false" autocomplete="off">
              </label>
            </div>
            <div class="checkbox-row top-gap">
              <label>
                <input type="checkbox" id="env-whatsapp-enabled" ${draft.whatsappEnabled ? 'checked' : ''}>
                <span>启用 WhatsApp 通道</span>
              </label>
            </div>
          </section>

          <section class="action-card action-card-compact workspace-section-anchor" data-workspace-section="runtime-env">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Runtime</p>
                <h3 class="action-card-title">终端与浏览器运行时</h3>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-stack">
                <span>Terminal Modal Image</span>
                <input class="search-input" id="env-terminal-modal-image" value="${escapeHtml(draft.terminalModalImage)}" placeholder="debian_slim / ubuntu">
              </label>
              <label class="field-stack">
                <span>Terminal Timeout</span>
                <input class="search-input" id="env-terminal-timeout" value="${escapeHtml(draft.terminalTimeout ?? '')}" placeholder="120">
              </label>
              <label class="field-stack">
                <span>Terminal Lifetime Seconds</span>
                <input class="search-input" id="env-terminal-lifetime-seconds" value="${escapeHtml(draft.terminalLifetimeSeconds ?? '')}" placeholder="900">
              </label>
              <label class="field-stack">
                <span>Browser Session Timeout</span>
                <input class="search-input" id="env-browser-session-timeout" value="${escapeHtml(draft.browserSessionTimeout ?? '')}" placeholder="600">
              </label>
              <label class="field-stack">
                <span>Browser Inactivity Timeout</span>
                <input class="search-input" id="env-browser-inactivity-timeout" value="${escapeHtml(draft.browserInactivityTimeout ?? '')}" placeholder="90">
              </label>
            </div>
            <p class="helper-text">这里直接写 modal / browser 运行时变量。</p>
          </section>

          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Closure</p>
                <h3 class="action-card-title">保存后建议动作</h3>
              </div>
            </div>
            <div class="detail-list compact">
              <div class="key-value-row">
                <span>模型凭证</span>
                <strong>${escapeHtml(draft.openaiApiKey || draft.anthropicApiKey || draft.openrouterApiKey || draft.googleApiKey || draft.hfToken ? '已有至少一个主模型密钥' : '尚未填写')}</strong>
              </div>
              <div class="key-value-row">
                <span>消息通道</span>
                <strong>${escapeHtml(draft.telegramBotToken || draft.discordBotToken || draft.slackBotToken ? '已有通道 token' : '尚未填写')}</strong>
              </div>
              <div class="key-value-row">
                <span>Gateway</span>
                <strong>${escapeHtml(draft.hermesGatewayToken ? 'Token 已填写' : 'Token 待补')}</strong>
              </div>
            </div>
            <p class="helper-text">保存后建议立刻体检，再去 Gateway 或日志页验证。</p>
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.data) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.data || !view.installation) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">配置中心</h1>
        </div>
        <p class="page-desc">文件、结构化控制和体检都收在这里。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">配置工作台快照暂时不可用。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 Hermes 配置工作台', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const { data, snapshot, installation, extensions, cronSnapshot, skills } = view;
  const warnings = runtimeWarnings(data, snapshot, skills, extensions, cronSnapshot);
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const enabledTools = enabledToolCount(extensions);
  const totalTools = totalToolCount(extensions);
  const localSkills = localRuntimeSkillCount(extensions);
  const pluginTotal = pluginsCount(extensions);
  const configDirty = view.configYaml !== data.configYaml;
  const envDirty = view.envFile !== data.envFile;
  const structuredDirty = structuredConfigDirty(view);
  const credentialsDirty = structuredEnvDirty(view);
  const actionBusy = Boolean(view.saving || view.runningDiagnostic || view.runningAction);
  const seed = relaySeed(view);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    description: '继续核对配置相关命令输出和运行日志。',
    logName: snapshot?.gateway?.gatewayState === 'running' ? 'agent' : 'errors',
    contains: view.investigation?.context?.source || '',
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    description: '继续围绕配置完整性、provider 和 Gateway 关联链路做体检。',
    suggestedCommand: view.investigation?.suggestedCommand || 'config-check',
    logName: 'errors',
  });
  const gatewayIntent = buildGatewayDrilldownIntent(seed, {
    description: '带着当前配置上下文继续看 Gateway 和平台链路。',
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(seed, {
    description: '继续核对 toolsets、skills、plugins 和 memory provider。',
    rawKind: view.investigation?.focus === 'memory' ? 'memory' : 'tools',
    query: view.investigation?.focus === 'toolsets' ? data.summary.toolsets.join(' ') : '',
  });

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">配置中心</h1>
        ${infoTipHtml('配置页只保留文件编辑、官方向导接管和运行体检，说明信息后置到提示里，避免抢主操作区。')}
      </div>
      <p class="page-desc">文件、结构化控制和体检在这里合流。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner">
        <div class="context-banner-header">
          <div class="context-banner-copy">
            <span class="context-banner-label">Drilldown</span>
            <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
            <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
          </div>
          <div class="context-banner-meta">
            ${view.investigation.focus ? pillHtml(view.investigation.focus, 'warn') : ''}
            ${view.investigation.suggestedCommand ? pillHtml(view.investigation.suggestedCommand, 'neutral') : ''}
            ${view.investigation.context?.source ? pillHtml(view.investigation.context.source, 'neutral') : ''}
          </div>
        </div>
        <div class="context-banner-actions toolbar">
          ${view.investigation.suggestedCommand
            ? buttonHtml({
                action: 'run-intent-diagnostic',
                label: '执行建议体检',
                kind: 'primary',
                disabled: Boolean(view.runningDiagnostic),
              })
            : ''}
          ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
          ${buttonHtml({ action: 'goto-extensions', label: '进入扩展页' })}
          ${buttonHtml({ action: 'goto-gateway', label: '进入 Gateway' })}
        </div>
      </div>
    ` : ''}

    <div class="stat-cards stat-cards-4">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Model</span>
          ${statusDotHtml(data.summary.modelDefault && data.summary.modelProvider ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(data.summary.modelDefault || '待配置')}</div>
        <div class="stat-card-meta">${escapeHtml(data.summary.modelProvider || 'provider 未配置')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Terminal</span>
          ${statusDotHtml(data.summary.terminalBackend ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(data.summary.terminalBackend || '未配置')}</div>
        <div class="stat-card-meta">${escapeHtml(data.summary.terminalCwd || '当前未声明工作目录')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Toolsets / Tools</span>
          ${statusDotHtml(enabledTools > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${data.summary.toolsets.length} / ${enabledTools}`)}</div>
        <div class="stat-card-meta">${escapeHtml(`声明的 toolsets / 运行态启用 tools（总数 ${totalTools}）`)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway / Memory</span>
          ${statusDotHtml(data.summary.memoryEnabled ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(snapshot?.gateway?.gatewayState || '未检测到')}</div>
        <div class="stat-card-meta">${escapeHtml(`${data.summary.memoryProvider || 'builtin-file'} · 插件 ${pluginTotal} 个 · 远端作业 ${remoteJobs.length} 个`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
      ${buttonHtml({ action: 'diagnostic-config-check', label: view.runningDiagnostic === 'config-check' ? '配置体检…' : '配置体检', disabled: actionBusy })}
      ${buttonHtml({ action: 'switch-editor-tab', label: '凭证 / 通道', attrs: { 'data-tab': 'credentials' } })}
      ${buttonHtml({ action: 'switch-editor-tab', label: '模型 / Toolsets', attrs: { 'data-tab': 'control' } })}
      ${buttonHtml({ action: 'goto-extensions', label: '扩展 / 插件' })}
      ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">配置工作台</h2>
          <p class="config-section-desc">主区直改配置，侧栏负责导航和体检。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(currentEditorBadge(view), 'neutral')}
          ${warnings.length > 0 ? pillHtml(`${warnings.length} 条提醒`, 'warn') : pillHtml('可直接编辑', 'good')}
        </div>
      </div>
      <div class="workspace-shell workspace-shell-editor">
        <aside class="workspace-rail">
          ${renderConfigRail(view, {
            actionBusy,
            data,
            enabledTools,
            installation,
            localSkills,
            remoteJobs,
            skills,
            snapshot,
            totalTools,
            warnings,
          })}
        </aside>
        <div class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>${escapeHtml(view.editorTab === 'control' ? '结构化控制' : view.editorTab === 'credentials' ? '凭证与通道' : '配置编辑')}</strong>
              <p class="workspace-main-copy">${escapeHtml(view.editorTab === 'config' ? data.configPath : view.editorTab === 'env' ? data.envPath : view.editorTab === 'credentials' ? data.envPath : '直接修改高频配置项并同步写回 config.yaml')}</p>
            </div>
            <div class="toolbar">
              ${view.editorTab === 'control'
                ? `<span id="structured-dirty-pill" class="pill pill-warn" ${structuredDirty ? '' : 'style="display:none"'}>未保存</span>`
                : view.editorTab === 'credentials'
                ? `<span id="credentials-dirty-pill" class="pill pill-warn" ${credentialsDirty ? '' : 'style="display:none"'}>未保存</span>`
                : view.editorTab === 'config'
                ? `<span id="config-dirty-pill" class="pill pill-warn" ${configDirty ? '' : 'style="display:none"'}>未保存</span>`
                : `<span id="env-dirty-pill" class="pill pill-warn" ${envDirty ? '' : 'style="display:none"'}>未保存</span>`}
              ${view.editorTab === 'control'
                ? buttonHtml({ action: 'save-structured-config', label: view.saving === 'structured' ? '保存中…' : '保存控制面', kind: 'primary', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) || Boolean(view.runningAction) })
                : view.editorTab === 'credentials'
                ? buttonHtml({ action: 'save-structured-env', label: view.saving === 'structured-env' ? '保存中…' : '保存凭证面', kind: 'primary', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) || Boolean(view.runningAction) })
                : view.editorTab === 'config'
                ? buttonHtml({ action: 'save-config', label: view.saving === 'config' ? '保存中…' : '保存 YAML', kind: 'primary', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })
                : buttonHtml({ action: 'save-env', label: view.saving === 'env' ? '保存中…' : '保存 ENV', kind: 'primary', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })}
              ${view.editorTab === 'control'
                ? buttonHtml({ action: 'reset-structured-config', label: '重置草稿', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) || !structuredDirty })
                : view.editorTab === 'credentials'
                ? buttonHtml({ action: 'reset-structured-env', label: '重置草稿', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) || !credentialsDirty })
                : view.editorTab === 'config'
                ? buttonHtml({ action: 'save-config-verify', label: view.saving === 'config' ? '保存中…' : '保存并体检', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })
                : buttonHtml({ action: 'save-env-verify', label: view.saving === 'env' ? '保存中…' : '保存并体检', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })}
              ${view.editorTab === 'control'
                ? buttonHtml({ action: 'switch-editor-tab', label: '查看 YAML', attrs: { 'data-tab': 'config' } })
                : view.editorTab === 'credentials'
                ? buttonHtml({ action: 'switch-editor-tab', label: '查看 .env', attrs: { 'data-tab': 'env' } })
                : view.editorTab === 'config'
                ? buttonHtml({ action: 'open-config', label: '定位 config.yaml', disabled: actionBusy })
                : buttonHtml({ action: 'open-env', label: '定位 .env', disabled: actionBusy })}
            </div>
          </div>
          ${renderEditorTabs(view, configDirty, envDirty, structuredDirty, credentialsDirty)}
          <div ${view.editorTab === 'control' ? '' : 'style="display:none"'}>
            ${renderStructuredControls(view)}
          </div>
          <div ${view.editorTab === 'credentials' ? '' : 'style="display:none"'}>
            ${renderStructuredEnvControls(view)}
          </div>
          <textarea class="editor large" data-editor="config" spellcheck="false" ${view.editorTab === 'config' ? '' : 'style="display:none"'}></textarea>
          <textarea class="editor large" data-editor="env" spellcheck="false" ${view.editorTab === 'env' ? '' : 'style="display:none"'}></textarea>
          ${view.editorTab === 'config'
            ? '<p class="helper-text config-editor-hint">保存 YAML 后建议立刻做一次配置体检，再去扩展或 Gateway 页验证运行态。</p>'
            : view.editorTab === 'env'
            ? '<p class="helper-text config-editor-hint">ENV 变更保存后最好立刻验证，避免只改变量不核对真实运行结果。</p>'
            : ''}
        </div>
      </div>
    </section>

    <div class="workspace-bottom-grid">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">最近命令回显</h2>
            <p class="config-section-desc">这里保留最近一次原始输出。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行命令', '保存、体检或交接 Terminal 后，这里会保留最近一次原始结果。')}
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">关联工作台</h2>
            <p class="config-section-desc">改完就去相关页闭环验证。</p>
          </div>
        </div>
        <div class="health-grid">
          <section class="action-card action-card-compact">
            <div class="health-card-header">
              <strong>扩展与插件</strong>
              ${pillHtml(`${enabledTools}/${totalTools}`, enabledTools > 0 ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(`${pluginTotal} 个插件目录 · toolsets ${data.summary.toolsets.length} 组 · runtime tools ${enabledTools} 个`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-extensions', label: '进入扩展页' })}
            </div>
          </section>
          <section class="action-card action-card-compact">
            <div class="health-card-header">
              <strong>Gateway 与通道</strong>
              ${pillHtml(snapshot?.gateway?.gatewayState || '未检测到', remoteJobs.length === 0 || snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(remoteJobs.length > 0 ? `当前有 ${remoteJobs.length} 个远端作业依赖 Gateway。` : '当前没有依赖 Gateway 的远端投递作业。')}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-gateway', label: '进入 Gateway' })}
            </div>
          </section>
          <section class="action-card action-card-compact">
            <div class="health-card-header">
              <strong>记忆与 Skills</strong>
              ${pillHtml(`${localSkills}/${skills.length}`, localSkills === skills.length ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(`Memory ${data.summary.memoryProvider || 'builtin-file'} · runtime ${extensions?.memoryRuntime.provider || '未读取'}`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-memory', label: '进入记忆页' })}
            </div>
          </section>
          <section class="action-card action-card-compact">
            <div class="health-card-header">
              <strong>日志与诊断</strong>
              ${pillHtml(view.lastResult?.result?.success ? '最近成功' : view.lastResult ? '最近失败' : '待验证', view.lastResult?.result?.success ? 'good' : view.lastResult ? 'warn' : 'neutral')}
            </div>
            <p>${escapeHtml(view.lastResult?.label ? `最近动作：${view.lastResult.label}` : '还没有保留任何命令或体检回显。')}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
              ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
            </div>
          </section>
        </div>
      </section>
    </div>
  `;

  bindEvents(view);

  const configEditor = view.page.querySelector('[data-editor="config"]');
  const envEditor = view.page.querySelector('[data-editor="env"]');
  if (configEditor) {
    configEditor.value = view.configYaml;
  }
  if (envEditor) {
    envEditor.value = view.envFile;
  }

  view.cachedIntents = {
    diagnosticsIntent,
    extensionsIntent,
    gatewayIntent,
    logsIntent,
  };
  flushPendingSectionFocus(view);
}

async function loadData(view, options = {}) {
  const { refreshEditors = true, silent = false } = options;
  const hasData = Boolean(view.data && view.installation);
  const previousData = view.data;
  const previousConfig = view.configYaml;
  const previousEnv = view.envFile;

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [nextConfig, nextSnapshot, nextInstallation, nextSkills, nextExtensions, nextCron] = await Promise.all([
      api.getConfigDocuments(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.listSkills(profile),
      api.getExtensionsSnapshot(profile),
      api.getCronJobs(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.data = nextConfig;
    view.snapshot = nextSnapshot;
    view.installation = nextInstallation;
    view.skills = nextSkills;
    view.extensions = nextExtensions;
    view.cronSnapshot = nextCron;
    view.controlDraft = cloneWorkspace(nextConfig.workspace);
    view.envDraft = cloneEnvWorkspace(nextConfig.envWorkspace);

    const keepConfigDraft = !refreshEditors && previousData ? previousConfig !== previousData.configYaml : false;
    const keepEnvDraft = !refreshEditors && previousData ? previousEnv !== previousData.envFile : false;

    view.configYaml = keepConfigDraft ? previousConfig : nextConfig.configYaml;
    view.envFile = keepEnvDraft ? previousEnv : nextConfig.envFile;
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

function storeResult(view, label, result) {
  view.lastResult = { label, result };
}

async function runDiagnostic(view, kind, options = {}) {
  const label = getDiagnosticCommand(kind)?.label || kind;
  view.runningDiagnostic = kind;
  renderPage(view);
  try {
    const result = await api.runDiagnostic(kind, view.profile);
    storeResult(view, label, result);
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: false, silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningDiagnostic = null;
    renderPage(view);
  }
}

async function saveDocument(view, target, verify = false) {
  view.saving = target;
  renderPage(view);
  try {
    if (target === 'config') {
      await api.saveConfigYaml(view.configYaml, view.profile);
      notify('success', verify ? 'config.yaml 已保存，开始执行配置体检。' : 'config.yaml 已保存。');
    } else {
      await api.saveEnvFile(view.envFile, view.profile);
      notify('success', verify ? '.env 已保存，开始执行配置体检。' : '.env 已保存。');
    }
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
    ]);
    if (verify) {
      await runDiagnostic(view, 'config-check');
      return;
    }
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function saveStructuredConfig(view) {
  if (view.configYaml !== view.data?.configYaml) {
    notify('error', '你已经手动改动了 YAML 草稿，请先保存或重置 YAML，再使用结构化控制面。');
    return;
  }

  view.saving = 'structured';
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredConfig(view.controlDraft, view.profile);
    notify('success', '结构化配置已保存到 config.yaml。');
    view.data = nextConfig;
    view.configYaml = nextConfig.configYaml;
    view.envFile = nextConfig.envFile;
    view.controlDraft = cloneWorkspace(nextConfig.workspace);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function saveStructuredEnv(view) {
  if (view.envFile !== view.data?.envFile) {
    notify('error', '你已经手动改动了 ENV 草稿，请先保存或重置 .env，再使用凭证控制面。');
    return;
  }

  view.saving = 'structured-env';
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredEnv(view.envDraft, view.profile);
    notify('success', '凭证与通道配置已保存到 .env。');
    view.data = nextConfig;
    view.configYaml = nextConfig.configYaml;
    view.envFile = nextConfig.envFile;
    view.controlDraft = cloneWorkspace(nextConfig.workspace);
    view.envDraft = cloneEnvWorkspace(nextConfig.envWorkspace);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function runTerminalAction(view, actionKey, label, command, options = {}) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage: options.confirmMessage,
      label,
      notify,
      onResult: (nextLabel, result) => {
        storeResult(view, nextLabel, result);
      },
      profile: view.profile,
      setBusy: (value) => {
        view.runningAction = value;
        renderPage(view);
      },
      workingDirectory: options.workingDirectory ?? (view.installation?.hermesHomeExists ? view.installation.hermesHome : null),
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
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
        storeResult(view, nextLabel, result);
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

function syncDirtyPills(view) {
  const configDirtyPill = view.page.querySelector('#config-dirty-pill');
  const envDirtyPill = view.page.querySelector('#env-dirty-pill');
  const structuredDirtyPill = view.page.querySelector('#structured-dirty-pill');
  const credentialsDirtyPill = view.page.querySelector('#credentials-dirty-pill');
  if (configDirtyPill) {
    configDirtyPill.style.display = view.data && view.configYaml !== view.data.configYaml ? 'inline-flex' : 'none';
  }
  if (envDirtyPill) {
    envDirtyPill.style.display = view.data && view.envFile !== view.data.envFile ? 'inline-flex' : 'none';
  }
  if (structuredDirtyPill) {
    structuredDirtyPill.style.display = structuredConfigDirty(view) ? 'inline-flex' : 'none';
  }
  if (credentialsDirtyPill) {
    credentialsDirtyPill.style.display = structuredEnvDirty(view) ? 'inline-flex' : 'none';
  }
}

function syncWithPanelState(view) {
  const shell = getPanelState();
  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.data = null;
    view.snapshot = null;
    view.installation = null;
    view.extensions = null;
    view.cronSnapshot = null;
    view.skills = [];
    view.error = null;
    view.configYaml = '';
    view.controlDraft = cloneWorkspace();
    view.envDraft = cloneEnvWorkspace();
    view.envFile = '';
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('config');
  if (nextIntent) {
    view.investigation = nextIntent;
    if (nextIntent.focus === 'credentials') {
      view.editorTab = 'credentials';
    } else if (nextIntent.focus) {
      view.editorTab = 'control';
    }
    consumePageIntent();
    renderPage(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindEvents(view) {
  const configEditor = view.page.querySelector('[data-editor="config"]');
  const envEditor = view.page.querySelector('[data-editor="env"]');

  if (configEditor) {
    configEditor.oninput = (event) => {
      view.configYaml = event.target.value;
      syncDirtyPills(view);
    };
  }

  if (envEditor) {
    envEditor.oninput = (event) => {
      view.envFile = event.target.value;
      syncDirtyPills(view);
    };
  }

  const bindControlValue = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('input', (event) => {
      view.controlDraft[key] = event.target.value;
      syncDirtyPills(view);
    });
  };

  const bindControlCheckbox = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('change', (event) => {
      view.controlDraft[key] = event.target.checked;
      syncDirtyPills(view);
    });
  };

  const bindEnvValue = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('input', (event) => {
      view.envDraft[key] = event.target.value;
      syncDirtyPills(view);
    });
  };

  const bindEnvCheckbox = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('change', (event) => {
      view.envDraft[key] = event.target.checked;
      syncDirtyPills(view);
    });
  };

  bindControlValue('#control-model-default', 'modelDefault');
  bindControlValue('#control-model-provider', 'modelProvider');
  bindControlValue('#control-model-base-url', 'modelBaseUrl');
  bindControlValue('#control-context-engine', 'contextEngine');
  bindControlValue('#control-terminal-backend', 'terminalBackend');
  bindControlValue('#control-terminal-cwd', 'terminalCwd');
  bindControlValue('#control-personality', 'personality');
  bindControlValue('#control-memory-provider', 'memoryProvider');
  bindControlValue('#control-discord-free-response', 'discordFreeResponseChannels');
  bindControlValue('#control-discord-allowed', 'discordAllowedChannels');

  bindControlCheckbox('#control-streaming-enabled', 'streamingEnabled');
  bindControlCheckbox('#control-memory-enabled', 'memoryEnabled');
  bindControlCheckbox('#control-user-profile-enabled', 'userProfileEnabled');
  bindControlCheckbox('#control-discord-require-mention', 'discordRequireMention');
  bindControlCheckbox('#control-discord-auto-thread', 'discordAutoThread');
  bindControlCheckbox('#control-discord-reactions', 'discordReactions');

  view.page.querySelector('#control-memory-char-limit')?.addEventListener('input', (event) => {
    view.controlDraft.memoryCharLimit = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-user-char-limit')?.addEventListener('input', (event) => {
    view.controlDraft.userCharLimit = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-approvals-timeout')?.addEventListener('input', (event) => {
    view.controlDraft.approvalsTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-approvals-mode')?.addEventListener('change', (event) => {
    view.controlDraft.approvalsMode = event.target.value;
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-toolsets')?.addEventListener('input', (event) => {
    view.controlDraft.toolsets = splitLineValues(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-platform-toolsets')?.addEventListener('input', (event) => {
    view.controlDraft.platformToolsets = parsePlatformToolsets(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-skills-external-dirs')?.addEventListener('input', (event) => {
    view.controlDraft.skillsExternalDirs = splitLineValues(event.target.value);
    syncDirtyPills(view);
  });

  bindEnvValue('#env-openai-api-key', 'openaiApiKey');
  bindEnvValue('#env-openrouter-api-key', 'openrouterApiKey');
  bindEnvValue('#env-anthropic-api-key', 'anthropicApiKey');
  bindEnvValue('#env-google-api-key', 'googleApiKey');
  bindEnvValue('#env-hf-token', 'hfToken');
  bindEnvValue('#env-anyrouter2-api-key', 'anyrouter2ApiKey');
  bindEnvValue('#env-crs-api-key', 'crsApiKey');
  bindEnvValue('#env-siliconflow-api-key', 'siliconflowApiKey');
  bindEnvValue('#env-hermes-gateway-token', 'hermesGatewayToken');
  bindEnvValue('#env-telegram-bot-token', 'telegramBotToken');
  bindEnvValue('#env-telegram-home-channel', 'telegramHomeChannel');
  bindEnvValue('#env-telegram-reply-to-mode', 'telegramReplyToMode');
  bindEnvValue('#env-discord-bot-token', 'discordBotToken');
  bindEnvValue('#env-discord-home-channel', 'discordHomeChannel');
  bindEnvValue('#env-discord-reply-to-mode', 'discordReplyToMode');
  bindEnvValue('#env-slack-bot-token', 'slackBotToken');
  bindEnvValue('#env-terminal-modal-image', 'terminalModalImage');
  bindEnvCheckbox('#env-whatsapp-enabled', 'whatsappEnabled');

  view.page.querySelector('#env-terminal-timeout')?.addEventListener('input', (event) => {
    view.envDraft.terminalTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#env-terminal-lifetime-seconds')?.addEventListener('input', (event) => {
    view.envDraft.terminalLifetimeSeconds = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#env-browser-session-timeout')?.addEventListener('input', (event) => {
    view.envDraft.browserSessionTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#env-browser-inactivity-timeout')?.addEventListener('input', (event) => {
    view.envDraft.browserInactivityTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'refresh') {
        await Promise.all([
          loadShell(view.profile, { silent: true }),
          loadData(view, { refreshEditors: true, silent: true }),
        ]);
        return;
      }

      if (!view.installation || !view.data) {
        return;
      }

      switch (action) {
        case 'focus-workspace':
          queueWorkspaceFocus(
            view,
            element.getAttribute('data-tab') || 'control',
            element.getAttribute('data-section') || '',
          );
          return;
        case 'toggle-compatibility-actions':
          view.showCompatibilityActions = !view.showCompatibilityActions;
          renderPage(view);
          return;
        case 'switch-editor-tab':
          view.pendingSectionFocus = null;
          view.activeWorkspaceSection = null;
          view.editorTab = element.getAttribute('data-tab') || 'config';
          renderPage(view);
          return;
        case 'apply-provider-preset': {
          const preset = getProviderPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.modelProvider = preset.provider;
          view.controlDraft.modelBaseUrl = preset.baseUrl;
          renderPage(view);
          notify('success', `已应用 ${preset.label} Provider 预设。`);
          if (preset.envKey && !envPresetReady(view, preset.envKey)) {
            notify('info', `还需要在凭证页补齐 ${preset.envLabel}。`);
          }
          return;
        }
        case 'apply-model-preset': {
          const preset = getProviderPreset(element.getAttribute('data-preset'));
          const model = String(element.getAttribute('data-model') || '').trim();
          if (!preset || !model) {
            return;
          }
          view.controlDraft.modelProvider = preset.provider;
          view.controlDraft.modelBaseUrl = preset.baseUrl;
          view.controlDraft.modelDefault = model;
          renderPage(view);
          notify('success', `默认模型已切到 ${model}。`);
          if (preset.envKey && !envPresetReady(view, preset.envKey)) {
            notify('info', `还需要在凭证页补齐 ${preset.envLabel}。`);
          }
          return;
        }
        case 'apply-toolset-preset': {
          const preset = getToolsetPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.toolsets = uniqueValues(preset.toolsets);
          view.controlDraft.platformToolsets = normalizePlatformBindings(preset.platformToolsets);
          renderPage(view);
          notify('success', `已应用 ${preset.label} 能力预设。`);
          return;
        }
        case 'apply-memory-preset': {
          const preset = getMemoryPreset(view, element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.memoryEnabled = Boolean(preset.memoryEnabled);
          view.controlDraft.userProfileEnabled = Boolean(preset.userProfileEnabled && preset.memoryEnabled);
          view.controlDraft.memoryProvider = preset.memoryEnabled ? String(preset.provider || '') : '';
          if (preset.memoryEnabled) {
            view.controlDraft.toolsets = uniqueValues([...view.controlDraft.toolsets, 'memory']);
          } else {
            view.controlDraft.toolsets = view.controlDraft.toolsets.filter((item) => item !== 'memory');
          }
          renderPage(view);
          notify('success', preset.memoryEnabled ? `已切换到 ${preset.label}。` : '已关闭记忆与用户画像。');
          return;
        }
        case 'apply-terminal-preset': {
          const preset = getTerminalPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.terminalBackend = preset.backend;
          view.controlDraft.terminalCwd = preset.cwd;
          view.envDraft.terminalTimeout = preset.terminalTimeout;
          view.envDraft.terminalLifetimeSeconds = preset.terminalLifetimeSeconds;
          if (preset.terminalModalImage) {
            view.envDraft.terminalModalImage = preset.terminalModalImage;
          }
          renderPage(view);
          notify('success', `已应用 ${preset.label} terminal backend 预设。`);
          if (preset.partial) {
            notify('info', '如果还要补镜像、主机或资源配额等细项，可以继续在 YAML 页精修。');
          }
          return;
        }
        case 'apply-channel-preset': {
          const preset = getChannelPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          if (preset.modeKey && !String(view.envDraft[preset.modeKey] ?? '').trim()) {
            view.envDraft[preset.modeKey] = preset.modeDefault;
          }
          renderPage(view);
          notify('success', `已应用 ${preset.label} 通道骨架。`);
          if (!envPresetReady(view, preset.tokenKey)) {
            notify('info', `还需要补齐 ${preset.tokenLabel}。`);
          }
          return;
        }
        case 'run-intent-diagnostic':
          if (view.investigation?.suggestedCommand) {
            await runDiagnostic(view, view.investigation.suggestedCommand);
          }
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'diagnostic-config-check':
          await runDiagnostic(view, 'config-check');
          return;
        case 'diagnostic-doctor':
          await runDiagnostic(view, 'doctor');
          return;
        case 'diagnostic-memory-status':
          await runDiagnostic(view, 'memory-status');
          return;
        case 'diagnostic-gateway-status':
          await runDiagnostic(view, 'gateway-status');
          return;
        case 'save-config':
          await saveDocument(view, 'config', false);
          return;
        case 'save-structured-config':
          await saveStructuredConfig(view);
          return;
        case 'save-structured-env':
          await saveStructuredEnv(view);
          return;
        case 'reset-structured-config':
          view.controlDraft = cloneWorkspace(view.data.workspace);
          renderPage(view);
          return;
        case 'reset-structured-env':
          view.envDraft = cloneEnvWorkspace(view.data.envWorkspace);
          renderPage(view);
          return;
        case 'save-config-verify':
          await saveDocument(view, 'config', true);
          return;
        case 'save-env':
          await saveDocument(view, 'env', false);
          return;
        case 'save-env-verify':
          await saveDocument(view, 'env', true);
          return;
        case 'terminal-setup':
          await runTerminalAction(view, 'config:setup', '全量 Setup', view.installation.setupCommand);
          return;
        case 'terminal-model':
          queueWorkspaceFocus(view, 'control', 'model-presets');
          notify('info', '模型与 Provider 已收回配置控制面。');
          return;
        case 'terminal-config-migrate':
          await runTerminalAction(view, 'config:migrate', '迁移配置', view.installation.configMigrateCommand);
          return;
        case 'terminal-claw-migrate':
          await runTerminalAction(view, 'config:claw-migrate', '导入 OpenClaw', view.installation.clawMigrateCommand);
          return;
        case 'terminal-backend':
          queueWorkspaceFocus(view, 'control', 'runtime-presets');
          notify('info', 'Terminal backend 已收回配置控制面。');
          return;
        case 'terminal-tools':
          queueWorkspaceFocus(view, 'control', 'toolsets-presets');
          notify('info', 'Toolsets 已收回配置控制面。');
          return;
        case 'terminal-skills':
          navigate('skills');
          return;
        case 'terminal-memory':
          navigate('memory');
          return;
        case 'terminal-plugins':
          navigate('extensions', view.cachedIntents?.extensionsIntent);
          return;
        case 'terminal-gateway-setup':
          navigate('gateway', view.cachedIntents?.gatewayIntent);
          return;
        case 'open-home':
          await runFinderAction(view, 'finder:home', 'Hermes Home', view.data.hermesHome, false);
          return;
        case 'open-config':
          await runFinderAction(view, 'finder:config', 'config.yaml', view.data.configPath, true);
          return;
        case 'open-env':
          await runFinderAction(view, 'finder:env', '.env', view.data.envPath, true);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', view.cachedIntents?.diagnosticsIntent);
          return;
        case 'goto-extensions':
          navigate('extensions', view.cachedIntents?.extensionsIntent);
          return;
        case 'goto-gateway':
          navigate('gateway', view.cachedIntents?.gatewayIntent);
          return;
        case 'goto-logs':
          navigate('logs', view.cachedIntents?.logsIntent);
          return;
        case 'goto-memory':
          navigate('memory');
          return;
        case 'goto-related-page':
          navigate(element.getAttribute('data-page'));
          return;
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
    activeWorkspaceSection: null,
    cachedIntents: null,
    configYaml: '',
    controlDraft: cloneWorkspace(),
    cronSnapshot: null,
    data: null,
    destroyed: false,
    editorTab: 'control',
    envDraft: cloneEnvWorkspace(),
    envFile: '',
    error: null,
    extensions: null,
    installation: null,
    investigation: getPageIntent('config'),
    lastResult: null,
    loading: true,
    page,
    pendingSectionFocus: null,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    runningDiagnostic: null,
    saving: null,
    skills: [],
    showCompatibilityActions: false,
    snapshot: null,
    unsubscribe: null,
  };

  if (activeView.investigation) {
    const focusTarget = workspaceSectionFromFocus(activeView.investigation.focus);
    if (focusTarget) {
      activeView.editorTab = focusTarget.tab;
      activeView.activeWorkspaceSection = focusTarget.sectionId;
      activeView.pendingSectionFocus = {
        ...focusTarget,
        behavior: 'auto',
      };
    } else if (activeView.investigation.focus === 'credentials') {
      activeView.editorTab = 'credentials';
    } else if (activeView.investigation.focus) {
      activeView.editorTab = 'control';
    }
    consumePageIntent();
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView, { refreshEditors: true });
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
