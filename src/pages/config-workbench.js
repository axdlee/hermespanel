import { buttonHtml, escapeHtml, keyValueRowsHtml, pillHtml } from './native-helpers';
import { infoTipHtml, shortcutCardHtml } from './workbench-helpers';

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
    models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-4.1'],
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
    models: ['gpt-oss-local', 'qwen3-coder-local', 'deepseek-r1-local'],
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
    label: '本机直控',
    copy: '最接近 Hermes 默认本机体验，适合桌面端直接接管和快速闭环。',
    toolsets: ['hermes-cli'],
    platformToolsets: [{ platform: 'cli', toolsets: ['hermes-cli'] }],
  },
  {
    id: 'research-coding',
    label: '研究开发',
    copy: '把搜索、浏览器、终端、文件、技能、记忆拆成显式能力面，方便精细化调优。',
    toolsets: [
      'web',
      'browser',
      'terminal',
      'file',
      'skills',
      'todo',
      'memory',
      'session_search',
      'code_execution',
    ],
    platformToolsets: [
      {
        platform: 'cli',
        toolsets: [
          'web',
          'browser',
          'terminal',
          'file',
          'skills',
          'todo',
          'memory',
          'session_search',
          'code_execution',
        ],
      },
    ],
  },
  {
    id: 'messaging-ops',
    label: '消息协作',
    copy: '桌面配置完后，顺手把 Telegram、Discord、Slack 的能力面一起拉起。',
    toolsets: [
      'web',
      'browser',
      'terminal',
      'file',
      'skills',
      'todo',
      'memory',
      'session_search',
      'delegation',
    ],
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

const TOOLSET_LIBRARY = [
  { id: 'hermes-cli', label: 'Hermes CLI', copy: '本机 Hermes 默认直控面', scope: 'top' },
  { id: 'web', label: '联网搜索', copy: '网页检索与在线搜索', scope: 'top' },
  { id: 'browser', label: '浏览器', copy: '页面打开、截图与交互', scope: 'top' },
  { id: 'terminal', label: '终端', copy: '命令执行与运行态联调', scope: 'top' },
  { id: 'file', label: '文件', copy: '本地文件读写与目录操作', scope: 'top' },
  { id: 'skills', label: 'Skills', copy: '技能发现、加载与调用', scope: 'top' },
  { id: 'memory', label: '记忆', copy: '长期记忆与画像能力', scope: 'top' },
  { id: 'todo', label: 'Todo', copy: '任务拆解与待办编排', scope: 'top' },
  { id: 'session_search', label: '会话检索', copy: '历史会话与上下文回捞', scope: 'top' },
  { id: 'code_execution', label: '代码执行', copy: '代码运行与结果验证', scope: 'top' },
  { id: 'delegation', label: 'Delegation', copy: '多代理协作与任务派发', scope: 'top' },
  { id: 'safe', label: 'Safe 模式', copy: '偏保守的安全审阅能力面', scope: 'top' },
  {
    id: 'hermes-telegram',
    label: 'Telegram 面',
    copy: 'Telegram 平台专用 toolset',
    scope: 'platform',
  },
  {
    id: 'hermes-discord',
    label: 'Discord 面',
    copy: 'Discord 平台专用 toolset',
    scope: 'platform',
  },
  { id: 'hermes-slack', label: 'Slack 面', copy: 'Slack 平台专用 toolset', scope: 'platform' },
];

const PLATFORM_BINDING_SUGGESTIONS = [
  {
    id: 'cli-default',
    label: 'CLI 直控',
    platform: 'cli',
    toolsets: ['hermes-cli'],
    copy: '桌面端默认最小闭环',
  },
  {
    id: 'cli-dev',
    label: 'CLI 研发',
    platform: 'cli',
    toolsets: [
      'web',
      'browser',
      'terminal',
      'file',
      'skills',
      'todo',
      'memory',
      'session_search',
      'code_execution',
    ],
    copy: '偏开发与调试的常见能力面',
  },
  {
    id: 'telegram-link',
    label: 'Telegram',
    platform: 'telegram',
    toolsets: ['hermes-telegram'],
    copy: '消息通道对接',
  },
  {
    id: 'discord-link',
    label: 'Discord',
    platform: 'discord',
    toolsets: ['hermes-discord'],
    copy: '线程式协作通道',
  },
  {
    id: 'slack-link',
    label: 'Slack',
    platform: 'slack',
    toolsets: ['hermes-slack'],
    copy: '工作区 Bot 通道',
  },
];

const TERMINAL_BACKEND_PRESETS = [
  {
    id: 'local',
    label: '本地',
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

const CONTEXT_ENGINE_PRESETS = [
  {
    id: 'compressor',
    label: 'Compressor',
    value: 'compressor',
    copy: '更适合日常桌面会话，保持上下文压缩与成本平衡。',
  },
  {
    id: 'semantic-router',
    label: 'Semantic Router',
    value: 'semantic-router',
    copy: '更适合多平台、多能力面或消息链路更复杂的场景。',
  },
];

export function cloneWorkspace(workspace = {}) {
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
    platformToolsets: (workspace.platformToolsets ?? []).map(item => ({
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
    .map(item => item.trim())
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

export function envPresetReady(view, key) {
  if (!key) {
    return false;
  }
  return Boolean(view.envDraft?.[key]?.trim());
}

export function getProviderPreset(id) {
  return MODEL_PROVIDER_PRESETS.find(preset => preset.id === id) || null;
}

export function getChannelPreset(id) {
  return CHANNEL_PRESETS.find(preset => preset.id === id) || null;
}

export function getToolsetPreset(id) {
  return TOOLSET_WORKSPACE_PRESETS.find(preset => preset.id === id) || null;
}

export function getTerminalPreset(id) {
  return TERMINAL_BACKEND_PRESETS.find(preset => preset.id === id) || null;
}

export function uniqueValues(values = []) {
  return Array.from(new Set(values.map(item => String(item ?? '').trim()).filter(Boolean)));
}

export function normalizePlatformBindings(bindings = []) {
  return [...(bindings ?? [])]
    .map(item => ({
      platform: String(item?.platform ?? '').trim(),
      toolsets: uniqueValues(item?.toolsets ?? []),
    }))
    .filter(item => item.platform)
    .sort((left, right) => left.platform.localeCompare(right.platform));
}

function sameStringArray(left = [], right = []) {
  const normalizedLeft = uniqueValues(left);
  const normalizedRight = uniqueValues(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function samePlatformBindings(left = [], right = []) {
  return (
    JSON.stringify(normalizePlatformBindings(left)) ===
    JSON.stringify(normalizePlatformBindings(right))
  );
}

function toolsetPresetActive(draft, preset) {
  if (!draft || !preset) {
    return false;
  }
  return (
    sameStringArray(draft.toolsets, preset.toolsets) &&
    samePlatformBindings(draft.platformToolsets, preset.platformToolsets)
  );
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
  const labels = normalized.map(item => `${item.platform}=${previewJoined(item.toolsets, '—', 2)}`);
  if (labels.length <= limit) {
    return labels.join(' · ');
  }
  return `${labels.slice(0, limit).join(' · ')} +${labels.length - limit}`;
}

function editablePlatformBindings(bindings = []) {
  return [...(bindings ?? [])].map(item => ({
    platform: String(item?.platform ?? ''),
    toolsets: uniqueValues(item?.toolsets ?? []),
  }));
}

function toolsetDefinition(id) {
  const normalized = String(id ?? '').trim();
  return (
    TOOLSET_LIBRARY.find(item => item.id === normalized) || {
      id: normalized,
      label: normalized || 'custom',
      copy: '自定义能力集',
      scope: 'custom',
    }
  );
}

function topLevelToolsetOptions(draft) {
  const selected = uniqueValues(draft.toolsets);
  return TOOLSET_LIBRARY.filter(item => item.scope !== 'platform' || selected.includes(item.id));
}

function platformBindingOptions(platform = '') {
  const normalized = String(platform ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'cli') {
    return uniqueValues([
      'hermes-cli',
      'web',
      'browser',
      'terminal',
      'file',
      'skills',
      'todo',
      'memory',
      'session_search',
      'code_execution',
      'delegation',
      'safe',
    ]);
  }
  if (normalized === 'telegram') {
    return uniqueValues(['hermes-telegram', 'skills', 'memory', 'todo', 'session_search']);
  }
  if (normalized === 'discord') {
    return uniqueValues([
      'hermes-discord',
      'skills',
      'memory',
      'todo',
      'session_search',
      'delegation',
    ]);
  }
  if (normalized === 'slack') {
    return uniqueValues(['hermes-slack', 'skills', 'todo', 'session_search']);
  }
  return uniqueValues([
    'skills',
    'memory',
    'todo',
    'session_search',
    'web',
    'browser',
    'terminal',
    'file',
  ]);
}

function renderToolsetToken(toolsetId, active = false) {
  const definition = toolsetDefinition(toolsetId);
  return `
    <button
      type="button"
      class="toolset-token${active ? ' toolset-token-active' : ''}"
      data-action="toggle-top-toolset"
      data-value="${escapeHtml(definition.id)}"
    >
      <strong class="toolset-token-title">${escapeHtml(definition.label)}</strong>
      <span class="toolset-token-meta">${escapeHtml(definition.id)}</span>
      <span class="toolset-token-copy">${escapeHtml(definition.copy)}</span>
    </button>
  `;
}

function renderTopLevelToolsetManager(view, draft) {
  const selected = uniqueValues(draft.toolsets);
  const options = topLevelToolsetOptions(draft);
  const customOnly = selected.filter(item => !options.some(option => option.id === item));

  return `
    <section class="toolset-manager-card">
      <div class="toolset-manager-head">
        <div>
          <div class="panel-title-row">
            <strong>顶层能力集</strong>
            ${infoTipHtml('这里直接管理 Hermes 顶层暴露给模型的能力面。点一下即可开关，不再手写大段文本。')}
          </div>
          <p class="helper-text">先选常用能力，再按需补自定义 toolset。选中的能力卡会高亮。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(selected.length ? `${selected.length} 组已启用` : '未启用', selected.length ? 'good' : 'warn')}
          ${buttonHtml({ action: 'clear-top-toolsets', label: '清空顶层', disabled: !selected.length })}
        </div>
      </div>

      <div class="toolset-token-grid">
        ${options.map(item => renderToolsetToken(item.id, selected.includes(item.id))).join('')}
      </div>

      ${
        customOnly.length
          ? `
          <div class="toolset-custom-list">
            ${customOnly
              .map(
                item => `
              <div class="toolset-custom-row">
                <div>
                  <strong>${escapeHtml(item)}</strong>
                  <span>自定义 toolset</span>
                </div>
                ${buttonHtml({ action: 'toggle-top-toolset', label: '移除', attrs: { 'data-value': item } })}
              </div>
            `
              )
              .join('')}
          </div>
        `
          : ''
      }

      <div class="directory-input-row toolset-entry-row">
        <input
          class="search-input"
          id="control-toolset-entry"
          value="${escapeHtml(String(view.toolsetEntryInput || ''))}"
          placeholder="输入自定义 toolset，例如 my-toolset"
          spellcheck="false"
        >
        ${buttonHtml({ action: 'add-top-toolset', label: '加入顶层', kind: 'primary' })}
        ${buttonHtml({ action: 'apply-toolset-preset', label: '本机基线', attrs: { 'data-preset': 'cli-default' } })}
      </div>
    </section>
  `;
}

function renderPlatformBindingManager(view, draft) {
  const bindings = editablePlatformBindings(draft.platformToolsets);
  const normalizedBindings = normalizePlatformBindings(draft.platformToolsets);
  const boundPlatforms = normalizedBindings.map(item => item.platform.toLowerCase());
  const bindingSuggestions = PLATFORM_BINDING_SUGGESTIONS.filter(
    item => !boundPlatforms.includes(item.platform.toLowerCase())
  );

  return `
    <section class="toolset-manager-card">
      <div class="toolset-manager-head">
        <div>
          <div class="panel-title-row">
            <strong>平台绑定</strong>
            ${infoTipHtml('把不同平台要暴露的能力单独收口。这里写的就是 platform_toolsets，不再用多行文本拼配置。')}
          </div>
          <p class="helper-text">先用推荐平台卡起骨架，再细调每个平台的 toolsets。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(normalizedBindings.length ? `${normalizedBindings.length} 个平台` : '暂无绑定', normalizedBindings.length ? 'good' : 'warn')}
          ${buttonHtml({ action: 'clear-platform-bindings', label: '清空绑定', disabled: !bindings.length })}
        </div>
      </div>

      ${
        bindingSuggestions.length
          ? `
          <div class="selection-chip-grid">
            ${bindingSuggestions
              .map(item =>
                buttonHtml({
                  action: 'add-platform-binding-preset',
                  label: `${item.label} · ${item.platform}`,
                  className: 'selection-chip',
                  attrs: { 'data-preset': item.id },
                })
              )
              .join('')}
          </div>
        `
          : ''
      }

      ${
        bindings.length
          ? `
          <div class="toolset-binding-stack">
            ${bindings
              .map(
                (binding, index) => `
              <section class="toolset-binding-card">
                <div class="toolset-binding-head">
                  <div class="toolset-binding-title">
                    <strong>${escapeHtml(binding.platform || `绑定 ${index + 1}`)}</strong>
                    <span>${escapeHtml(binding.toolsets.length ? previewJoined(binding.toolsets, '未绑定能力', 4) : '未绑定能力')}</span>
                  </div>
                  ${buttonHtml({ action: 'remove-platform-binding', label: '移除', attrs: { 'data-index': String(index) } })}
                </div>
                <div class="toolset-binding-form">
                  <label class="field-stack">
                    <span>平台</span>
                    <input class="search-input" data-binding-platform-index="${String(index)}" value="${escapeHtml(binding.platform)}" placeholder="cli / telegram / discord">
                  </label>
                  <label class="field-stack">
                    <span>绑定能力</span>
                    <input class="search-input" data-binding-toolsets-index="${String(index)}" value="${escapeHtml(binding.toolsets.join(', '))}" placeholder="web, browser, terminal">
                  </label>
                </div>
                <div class="selection-chip-grid top-gap">
                  ${platformBindingOptions(binding.platform)
                    .map(item =>
                      buttonHtml({
                        action: 'toggle-binding-toolset',
                        label: toolsetDefinition(item).label,
                        className: `selection-chip${binding.toolsets.includes(item) ? ' selection-chip-active' : ''}`,
                        kind: binding.toolsets.includes(item) ? 'primary' : 'secondary',
                        attrs: {
                          'data-index': String(index),
                          'data-value': item,
                        },
                      })
                    )
                    .join('')}
                </div>
              </section>
            `
              )
              .join('')}
          </div>
        `
          : `
          <div class="toolset-binding-empty">
            <strong>还没有平台绑定</strong>
            <p>如果你准备让 CLI、Telegram、Discord 或 Slack 各自暴露不同能力，可以先在这里起骨架。</p>
          </div>
        `
      }

      <section class="toolset-binding-card toolset-binding-card-create">
        <div class="toolset-binding-head">
          <div class="toolset-binding-title">
            <strong>新增平台绑定</strong>
            <span>支持自定义平台名和自定义 toolsets</span>
          </div>
          ${buttonHtml({ action: 'add-platform-binding', label: '加入绑定', kind: 'primary' })}
        </div>
        <div class="toolset-binding-create-row">
          <input
            class="search-input"
            id="control-platform-binding-platform"
            value="${escapeHtml(String(view.platformBindingPlatformInput || ''))}"
            placeholder="platform，例如 cli"
            spellcheck="false"
          >
          <input
            class="search-input"
            id="control-platform-binding-toolsets"
            value="${escapeHtml(String(view.platformBindingToolsetsInput || ''))}"
            placeholder="toolsets，例如 hermes-cli, web"
            spellcheck="false"
          >
          ${buttonHtml({ action: 'add-platform-binding', label: '加入', kind: 'primary' })}
        </div>
      </section>
    </section>
  `;
}

function buildSkillsDirectorySuggestions(view, directories = []) {
  const hermesHome = String(view?.data?.hermesHome || view?.installation?.hermesHome || '').trim();
  const normalized = uniqueValues(directories);
  return uniqueValues([
    hermesHome ? `${hermesHome}/skills` : '',
    hermesHome ? `${hermesHome}/shared/skills` : '',
    '~/skills',
    '~/Documents/hermes-skills',
  ]).filter(item => item && !normalized.includes(item));
}

function renderSkillsDirectoryManager(view, draft) {
  const directories = uniqueValues(draft.skillsExternalDirs);
  const suggestions = buildSkillsDirectorySuggestions(view, directories).slice(0, 4);
  const inputValue = String(view.skillDirInput || '');
  const bulkValue = String(view.skillDirBulkInput || '');

  return `
    <section class="directory-manager-card">
      <div class="directory-manager-head">
        <div>
          <div class="panel-title-row">
            <strong>外部 Skills 目录</strong>
            ${infoTipHtml('默认收起大文本录入，优先用目录列表维护。这里只改结构化配置，不会调用 Hermes 命令行。')}
          </div>
          <p class="helper-text">把共享 skill 仓库、团队目录或你自己的技能目录直接挂进当前 profile。</p>
        </div>
        <div class="pill-row">
          ${pillHtml(directories.length ? `${directories.length} 个目录` : '仅内置 Skills', directories.length ? 'good' : 'neutral')}
          ${pillHtml(view.showSkillDirBulk ? '批量录入中' : '轻量模式', view.showSkillDirBulk ? 'warn' : 'neutral')}
        </div>
      </div>

      <div class="directory-input-row">
        <input
          class="search-input"
          id="control-skill-dir-entry"
          value="${escapeHtml(inputValue)}"
          placeholder="/Users/me/skills 或 /opt/hermes-skills"
          spellcheck="false"
        >
        ${buttonHtml({ action: 'add-skill-external-dir', label: '加入目录', kind: 'primary' })}
        ${buttonHtml({ action: 'toggle-skill-dir-bulk', label: view.showSkillDirBulk ? '收起批量' : '批量录入' })}
      </div>

      ${
        suggestions.length
          ? `
          <div class="directory-suggestion-strip">
            ${suggestions
              .map(item =>
                buttonHtml({
                  action: 'add-skill-external-suggestion',
                  label: item,
                  className: 'selection-chip',
                  attrs: { 'data-value': item },
                })
              )
              .join('')}
          </div>
        `
          : ''
      }

      ${
        view.showSkillDirBulk
          ? `
          <div class="directory-bulk-card">
            <textarea
              class="editor compact-control-editor compact-control-editor-mini"
              id="control-skill-dir-bulk"
              placeholder="/Users/me/team-skills&#10;/Volumes/Shared/hermes-skills"
            >${escapeHtml(bulkValue)}</textarea>
            <div class="toolbar">
              ${buttonHtml({ action: 'merge-skill-external-bulk', label: '合并到列表', kind: 'primary' })}
              ${buttonHtml({ action: 'clear-skill-dir-bulk', label: '清空批量输入' })}
            </div>
          </div>
        `
          : ''
      }

      ${
        directories.length
          ? `
          <div class="directory-list">
            ${directories
              .map(
                (item, index) => `
              <section class="directory-row">
                <div class="directory-row-copy">
                  <span class="directory-row-label">目录 ${String(index + 1).padStart(2, '0')}</span>
                  <code>${escapeHtml(item)}</code>
                </div>
                <div class="directory-row-actions">
                  ${buttonHtml({ action: 'open-skill-external-dir', label: '打开', attrs: { 'data-path': item } })}
                  ${buttonHtml({ action: 'remove-skill-external-dir', label: '移除', attrs: { 'data-path': item } })}
                </div>
              </section>
            `
              )
              .join('')}
          </div>
        `
          : `
          <div class="directory-empty-state">
            <strong>还没有外部目录</strong>
            <p>当前只会扫描 Hermes 内置 Skills。你可以把团队共享目录或本地自维护目录加进来。</p>
          </div>
        `
      }
    </section>
  `;
}

function memoryProviderPresets(view) {
  const installed = view.extensions?.memoryRuntime?.installedPlugins ?? [];
  const dynamicPresets = installed.map(item => ({
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
      label: '内置文件',
      provider: '',
      availability: '内置',
      copy: '零依赖的本地文件记忆，最稳妥，也最适合桌面客户端默认闭环。',
      memoryEnabled: true,
      userProfileEnabled: true,
    },
    ...dynamicPresets,
  ];
}

export function getMemoryPreset(view, id) {
  return memoryProviderPresets(view).find(preset => preset.id === id) || null;
}

function memoryPresetActive(view, preset) {
  if (!preset || !view.controlDraft) {
    return false;
  }
  if (!preset.memoryEnabled) {
    return !view.controlDraft.memoryEnabled;
  }
  return (
    view.controlDraft.memoryEnabled &&
    String(view.controlDraft.memoryProvider || '') === String(preset.provider || '')
  );
}

function terminalPresetActive(view, preset) {
  if (!preset || !view.controlDraft) {
    return false;
  }
  const modalImage = String(view.envDraft?.terminalModalImage || '').trim();
  const presetImage = String(preset.terminalModalImage || '').trim();
  return (
    String(view.controlDraft.terminalBackend || '') === String(preset.backend || '') &&
    String(view.controlDraft.terminalCwd || '') === String(preset.cwd || '') &&
    (presetImage ? modalImage === presetImage : true)
  );
}

function renderModelPresetChips(view, preset, draft) {
  const models = preset?.models ?? [];
  if (!models.length) {
    return '';
  }

  return `
    <div class="selection-chip-grid">
      ${models
        .map(model =>
          buttonHtml({
            action: 'apply-model-preset',
            label: model,
            kind:
              draft.modelProvider === preset.provider && draft.modelDefault === model
                ? 'primary'
                : 'secondary',
            className: `selection-chip${draft.modelProvider === preset.provider && draft.modelDefault === model ? ' selection-chip-active' : ''}`,
            attrs: {
              'data-model': model,
              'data-preset': preset.id,
            },
          })
        )
        .join('')}
    </div>
  `;
}

function renderProviderPresetGrid(view, draft) {
  return `
    <div class="preset-card-grid workspace-preset-grid workspace-preset-grid-compact">
      ${MODEL_PROVIDER_PRESETS.map(
        preset => `
        <section class="preset-card preset-card-compact${draft.modelProvider === preset.provider ? ' provider-preset-card-active' : ''}">
          <div class="preset-card-head">
            <div class="preset-card-heading">
              <strong>${escapeHtml(preset.label)}</strong>
              <span class="preset-card-caption">${escapeHtml(preset.provider)}</span>
            </div>
            <div class="pill-row">
              ${draft.modelProvider === preset.provider ? pillHtml('当前', 'good') : ''}
              ${preset.envKey ? pillHtml(envPresetReady(view, preset.envKey) ? '密钥就绪' : '缺密钥', envPresetReady(view, preset.envKey) ? 'good' : 'warn') : pillHtml('自定义', 'neutral')}
            </div>
          </div>
          <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
          <code class="preset-inline-code">${escapeHtml(preset.baseUrl || '保留当前 Base URL')}</code>
          ${renderModelPresetChips(view, preset, draft)}
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'apply-provider-preset', label: '应用', kind: 'primary', attrs: { 'data-preset': preset.id } })}
          </div>
        </section>
      `
      ).join('')}
    </div>
  `;
}

function renderToolsetPresetGrid(draft) {
  return `
    <div class="preset-card-grid">
      ${TOOLSET_WORKSPACE_PRESETS.map(
        preset => `
        <section class="preset-card preset-card-compact">
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
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'apply-toolset-preset', label: '应用能力面', kind: 'primary', attrs: { 'data-preset': preset.id } })}
          </div>
        </section>
      `
      ).join('')}
    </div>
  `;
}

function renderMemoryPresetGrid(view, presets) {
  return `
    <div class="preset-card-grid">
      ${presets
        .map(
          preset => `
        <section class="preset-card preset-card-compact">
          <div class="preset-card-head">
            <div class="preset-card-heading">
              <strong>${escapeHtml(preset.label)}</strong>
              <span class="preset-card-caption">${escapeHtml(preset.availability)}</span>
            </div>
            <div class="pill-row">
              ${memoryPresetActive(view, preset) ? pillHtml('当前', 'good') : ''}
              ${pillHtml(preset.memoryEnabled ? '记忆开启' : '记忆关闭', preset.memoryEnabled ? 'neutral' : 'warn')}
            </div>
          </div>
          <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
          <code class="preset-inline-code">${escapeHtml(preset.provider || 'builtin-file')}</code>
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'apply-memory-preset', label: preset.memoryEnabled ? '设为默认' : '关闭记忆', kind: preset.memoryEnabled ? 'primary' : 'secondary', attrs: { 'data-preset': preset.id } })}
          </div>
        </section>
      `
        )
        .join('')}
    </div>
  `;
}

function renderTerminalPresetGrid(view) {
  return `
    <div class="preset-card-grid">
      ${TERMINAL_BACKEND_PRESETS.map(
        preset => `
        <section class="preset-card preset-card-compact">
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
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'apply-terminal-preset', label: '应用后端', kind: 'primary', attrs: { 'data-preset': preset.id } })}
          </div>
        </section>
      `
      ).join('')}
    </div>
  `;
}

function renderChannelPresetGrid(view) {
  return `
    <div class="preset-card-grid">
      ${CHANNEL_PRESETS.map(
        preset => `
        <section class="preset-card preset-card-compact">
          <div class="preset-card-head">
            <div class="preset-card-heading">
              <strong>${escapeHtml(preset.label)}</strong>
              <span class="preset-card-caption">${escapeHtml(preset.tokenLabel)}</span>
            </div>
            <div class="pill-row">
              ${pillHtml(envPresetReady(view, preset.tokenKey) ? 'Token 已填' : '待填 Token', envPresetReady(view, preset.tokenKey) ? 'good' : 'warn')}
              ${preset.modeKey ? pillHtml(view.envDraft?.[preset.modeKey]?.trim() ? view.envDraft[preset.modeKey] : '模式待写入', view.envDraft?.[preset.modeKey]?.trim() ? 'neutral' : 'warn') : pillHtml('仅 Token', 'neutral')}
            </div>
          </div>
          <p class="preset-card-copy">${escapeHtml(preset.copy)}</p>
          <code class="preset-inline-code">${escapeHtml(preset.modeKey ? `${preset.modeKey} = ${preset.modeDefault}` : `${preset.tokenLabel} = ...`)}</code>
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'apply-channel-preset', label: '应用骨架', kind: 'primary', attrs: { 'data-preset': preset.id } })}
          </div>
        </section>
      `
      ).join('')}
    </div>
  `;
}

function activeModelProviderPreset(draft) {
  return (
    MODEL_PROVIDER_PRESETS.find(
      preset => preset.provider === String(draft?.modelProvider || '').trim()
    ) || null
  );
}

function modelGovernanceState(view, draft) {
  const preset = activeModelProviderPreset(draft);
  const envReady = preset?.envKey ? envPresetReady(view, preset.envKey) : true;
  const baseUrl = String(draft.modelBaseUrl || '').trim();
  const presetBaseUrl = String(preset?.baseUrl || '').trim();
  const model = String(draft.modelDefault || '').trim();
  const provider = String(draft.modelProvider || '').trim();
  const contextEngine = String(draft.contextEngine || '').trim();
  const endpointMode = !baseUrl
    ? presetBaseUrl
      ? '未显式写入'
      : '跟随 Provider'
    : presetBaseUrl && baseUrl === presetBaseUrl
      ? '官方 Endpoint'
      : '自定义 Endpoint';
  const ready = Boolean(model && provider && envReady);

  return {
    baseUrl,
    contextEngine,
    endpointMode,
    envLabel: preset?.envLabel || '自定义凭证',
    envReady,
    model,
    preset,
    provider,
    ready,
  };
}

function controlSubviewTabHtml(attrName, activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" ${attrName}="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function resolveModelWorkspaceView(activeKey) {
  return ['status', 'connect', 'detail'].includes(activeKey) ? activeKey : 'status';
}

function resolveToolsetWorkspaceView(activeKey) {
  return ['status', 'presets', 'manual', 'platform'].includes(activeKey) ? activeKey : 'status';
}

function renderModelGovernanceWorkbench(view, draft) {
  const state = modelGovernanceState(view, draft);
  const endpointRecommendation = state.preset?.baseUrl || '';
  const nextStep = !state.provider
    ? '先选一个 Provider 预设'
    : !state.model
      ? '补默认模型'
      : !state.envReady
        ? '去补对应密钥'
        : !state.contextEngine
          ? '补上下文引擎'
          : '可继续调整';

  return `
    <section class="shell-card shell-card-dense model-focus-card">
      <div class="shell-card-header model-focus-head">
        <div class="model-focus-title-wrap">
          <div>
            <strong>模型设置</strong>
            <p class="shell-card-copy">先把 Provider、默认模型和 Endpoint 配好。</p>
          </div>
          <div class="model-focus-title">
            <div class="model-focus-title-copy">
              <strong class="model-focus-name">${escapeHtml(state.model || '还没选默认模型')}</strong>
              <div class="pill-row">
                ${pillHtml(state.provider || 'provider 未配', state.provider ? 'good' : 'warn')}
                ${pillHtml(state.ready ? '主链路可保存' : '主链路待补齐', state.ready ? 'good' : 'warn')}
                ${pillHtml(draft.streamingEnabled ? '流式输出' : '静态输出', draft.streamingEnabled ? 'neutral' : 'warn')}
              </div>
            </div>
          </div>
        </div>
        ${pillHtml(state.preset?.label || (state.provider ? 'Custom Provider' : '待选择'), state.provider ? 'good' : 'warn')}
      </div>

      ${keyValueRowsHtml([
        { label: '当前 Provider', value: state.preset?.label || state.provider || '待配置' },
        { label: '默认模型', value: state.model || '还没选默认模型' },
        {
          label: 'Endpoint',
          value: state.baseUrl || endpointRecommendation || '跟随 Provider 默认值',
        },
        { label: '建议', value: nextStep },
      ])}

      <div class="model-chip-row top-gap">
        ${CONTEXT_ENGINE_PRESETS.map(preset =>
          buttonHtml({
            action: 'apply-context-preset',
            label: preset.label,
            kind: state.contextEngine === preset.value ? 'primary' : 'secondary',
            className: `selection-chip${state.contextEngine === preset.value ? ' selection-chip-active' : ''}`,
            attrs: { 'data-value': preset.value },
          })
        ).join('')}
        ${buttonHtml({
          action: 'toggle-streaming-output',
          label: draft.streamingEnabled ? '关闭流式' : '开启流式',
          className: `selection-chip${draft.streamingEnabled ? ' selection-chip-active' : ''}`,
        })}
        ${
          endpointRecommendation && state.baseUrl !== endpointRecommendation
            ? buttonHtml({
                action: 'apply-base-url-value',
                label: '对齐官方 Endpoint',
                className: 'selection-chip',
                attrs: { 'data-value': endpointRecommendation },
              })
            : ''
        }
        ${
          state.baseUrl
            ? buttonHtml({
                action: 'apply-base-url-value',
                label: '清空 Base URL',
                className: 'selection-chip',
                attrs: { 'data-value': '' },
              })
            : ''
        }
      </div>

      ${
        state.preset?.models?.length
          ? `<p class="model-focus-note">${escapeHtml(`当前 provider 常用模型：${state.preset.models.slice(0, 4).join(' · ')}${state.preset.models.length > 4 ? ' ...' : ''}`)}</p>`
          : ''
      }

      <div class="toolbar top-gap">
        ${buttonHtml({
          action: 'focus-workspace',
          label: '去补凭证',
          kind: state.envReady ? 'secondary' : 'primary',
          attrs: { 'data-tab': 'credentials', 'data-section': 'provider-credentials' },
        })}
        ${buttonHtml({
          action: 'focus-workspace',
          label: '展开模型设置',
          attrs: { 'data-tab': 'control', 'data-section': 'model-presets' },
        })}
        ${buttonHtml({ action: 'goto-gateway', label: '去看 Gateway' })}
      </div>
    </section>
  `;
}

function renderModelStatusWorkbench(view, draft) {
  const state = modelGovernanceState(view, draft);
  const nextStep = !state.provider
    ? '先选一个 Provider 预设'
    : !state.model
      ? '补默认模型'
      : !state.envReady
        ? '去凭证页补密钥'
        : !state.contextEngine
          ? '补上下文引擎'
          : '主链路已就绪';

  return `
    <section class="shell-card shell-card-dense">
      <div class="workspace-main-header">
        <div>
          <strong>当前状态</strong>
          <p class="workspace-main-copy">先确认 Provider、模型和 Endpoint 是否齐全。</p>
        </div>
        ${pillHtml(state.ready ? '主链路可保存' : '仍待补齐', state.ready ? 'good' : 'warn')}
      </div>
      ${keyValueRowsHtml([
        { label: '当前模型', value: state.model || '还没选默认模型' },
        { label: 'Provider', value: state.preset?.label || state.provider || '待配置' },
        {
          label: 'Endpoint',
          value: state.baseUrl || state.preset?.baseUrl || '跟随 Provider 默认值',
        },
        { label: '建议', value: nextStep },
      ])}
      <div class="toolbar top-gap">
        ${buttonHtml({
          action: 'focus-workspace',
          label: state.envReady ? '继续看接入设置' : '先去补凭证',
          kind: state.envReady ? 'secondary' : 'primary',
          attrs: {
            'data-tab': state.envReady ? 'control' : 'credentials',
            'data-section': state.envReady ? 'model-presets' : 'provider-credentials',
          },
        })}
        ${buttonHtml({ action: 'goto-gateway', label: '去看 Gateway' })}
      </div>
    </section>
  `;
}

function renderModelConnectWorkbench(view, draft) {
  return `
    <section class="shell-card shell-card-dense workspace-section-anchor" data-workspace-section="model-presets">
      <div class="workspace-main-header">
        <div>
          <strong>接入设置</strong>
          <p class="workspace-main-copy">先定 Provider、默认模型和 Base URL，把主链路接通后再细调上下文与风格。</p>
        </div>
        ${pillHtml(draft.modelProvider || 'Provider 待补', draft.modelProvider ? 'good' : 'warn')}
      </div>
      ${renderProviderPresetGrid(view, draft)}
      <div class="form-grid top-gap">
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
          <span>上下文引擎</span>
          <input class="search-input" id="control-context-engine" value="${escapeHtml(draft.contextEngine)}" placeholder="compressor">
        </label>
      </div>
    </section>
  `;
}

function renderModelDetailWorkbench(view, draft) {
  const state = modelGovernanceState(view, draft);
  const endpointRecommendation = state.preset?.baseUrl || '';

  return `
    <section class="shell-card shell-card-dense workspace-section-anchor" data-workspace-section="model-detail">
      <div class="workspace-main-header">
        <div>
          <strong>细调与补充</strong>
          <p class="workspace-main-copy">把上下文、流式输出、人格风格和 Endpoint 辅助动作收在这里，避免和主接入表单混成一团。</p>
        </div>
        ${pillHtml(draft.streamingEnabled ? '流式输出' : '静态输出', draft.streamingEnabled ? 'neutral' : 'warn')}
      </div>
      <div class="selection-chip-grid">
        ${CONTEXT_ENGINE_PRESETS.map(preset =>
          buttonHtml({
            action: 'apply-context-preset',
            label: preset.label,
            kind: state.contextEngine === preset.value ? 'primary' : 'secondary',
            className: `selection-chip${state.contextEngine === preset.value ? ' selection-chip-active' : ''}`,
            attrs: { 'data-value': preset.value },
          })
        ).join('')}
        ${buttonHtml({
          action: 'toggle-streaming-output',
          label: draft.streamingEnabled ? '关闭流式' : '开启流式',
          className: `selection-chip${draft.streamingEnabled ? ' selection-chip-active' : ''}`,
        })}
        ${
          endpointRecommendation && state.baseUrl !== endpointRecommendation
            ? buttonHtml({
                action: 'apply-base-url-value',
                label: '对齐官方 Endpoint',
                className: 'selection-chip',
                attrs: { 'data-value': endpointRecommendation },
              })
            : ''
        }
        ${
          state.baseUrl
            ? buttonHtml({
                action: 'apply-base-url-value',
                label: '清空 Base URL',
                className: 'selection-chip',
                attrs: { 'data-value': '' },
              })
            : ''
        }
      </div>
      <div class="form-grid top-gap">
        <label class="field-stack">
          <span>上下文引擎</span>
          <input class="search-input" id="control-context-engine" value="${escapeHtml(draft.contextEngine)}" placeholder="compressor">
        </label>
        <label class="field-stack">
          <span>人格 / 风格</span>
          <input class="search-input" id="control-personality" value="${escapeHtml(draft.personality)}" placeholder="helpful / technical / concise">
        </label>
      </div>
      ${
        state.preset?.models?.length
          ? `<p class="model-focus-note">${escapeHtml(`当前 provider 常用模型：${state.preset.models.slice(0, 4).join(' · ')}${state.preset.models.length > 4 ? ' ...' : ''}`)}</p>`
          : ''
      }
      <div class="toolbar top-gap">
        ${buttonHtml({
          action: 'focus-workspace',
          label: '去补凭证',
          kind: state.envReady ? 'secondary' : 'primary',
          attrs: { 'data-tab': 'credentials', 'data-section': 'provider-credentials' },
        })}
        ${buttonHtml({ action: 'goto-gateway', label: '去看 Gateway' })}
      </div>
    </section>
  `;
}

function renderToolsetStatusWorkbench(draft) {
  const normalizedBindings = normalizePlatformBindings(draft.platformToolsets);
  const nextStep = !draft.toolsets.length
    ? '先选一组顶层能力'
    : !normalizedBindings.length
      ? '按需补平台绑定'
      : '能力面已就绪';

  return `
    <section class="shell-card shell-card-dense workspace-section-anchor" data-workspace-section="toolsets-overview">
      <div class="workspace-main-header">
        <div>
          <strong>能力面状态</strong>
          <p class="workspace-main-copy">先看顶层能力和平台绑定是否完整。</p>
        </div>
        ${pillHtml(draft.toolsets.length ? `${draft.toolsets.length} 组能力` : '待补能力面', draft.toolsets.length ? 'good' : 'warn')}
      </div>
      ${keyValueRowsHtml([
        { label: '顶层能力', value: previewJoined(draft.toolsets, '还没挂能力面', 5) },
        {
          label: '平台绑定',
          value: platformBindingsPreview(normalizedBindings, '还没做平台绑定', 2),
        },
        {
          label: '当前方案',
          value: draft.toolsets.length
            ? `${draft.toolsets.length} 组顶层 / ${normalizedBindings.length} 平台`
            : '待整理',
        },
        { label: '建议', value: nextStep },
      ])}
      <div class="toolbar top-gap">
        ${buttonHtml({
          action: 'focus-workspace',
          label: draft.toolsets.length ? '查看能力预设' : '先选能力预设',
          kind: draft.toolsets.length ? 'secondary' : 'primary',
          attrs: { 'data-tab': 'control', 'data-section': 'toolsets-presets' },
        })}
        ${buttonHtml({
          action: 'focus-workspace',
          label: normalizedBindings.length ? '查看平台绑定' : '补平台绑定',
          attrs: { 'data-tab': 'control', 'data-section': 'toolsets-detail' },
        })}
      </div>
    </section>
  `;
}

export function currentEditorBadge(view) {
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
      return '概览';
  }
}

const CONTROL_WORKSPACE_GROUPS = [
  {
    key: 'model',
    label: '模型',
    sectionId: 'model-governance',
    sections: ['model-governance', 'model-presets', 'model-detail'],
    description: '先把 provider、默认模型、endpoint 和上下文引擎拉稳。',
  },
  {
    key: 'toolsets',
    label: '能力面',
    sectionId: 'toolsets-overview',
    sections: ['toolsets-overview', 'toolsets-presets', 'toolsets-manual', 'toolsets-detail'],
    description: '只看 toolsets 与平台绑定，不把其他设置掺进来。',
  },
  {
    key: 'memory',
    label: '记忆',
    sectionId: 'memory-presets',
    sections: ['memory-presets', 'memory-detail'],
    description: '专注记忆 provider、画像开关和外部 skills 目录。',
  },
  {
    key: 'runtime',
    label: '终端',
    sectionId: 'runtime-presets',
    sections: ['runtime-presets', 'runtime-detail'],
    description: '终端后端、审批模式和 Discord 路由统一收在这一组。',
  },
];

const CREDENTIAL_WORKSPACE_GROUPS = [
  {
    key: 'provider',
    label: '模型密钥',
    sectionId: 'provider-credentials',
    sections: ['provider-credentials'],
    description: '只看模型与 provider 相关密钥。',
  },
  {
    key: 'channel',
    label: '通道',
    sectionId: 'channel-credentials',
    sections: ['channel-credentials', 'channel-presets'],
    description: '网关 token 和消息通道参数单独聚焦，不和模型密钥混排。',
  },
  {
    key: 'runtime',
    label: '运行变量',
    sectionId: 'runtime-env',
    sections: ['runtime-env'],
    description: '终端和浏览器运行时变量单独放在这里。',
  },
];

function approvalModeLabel(value) {
  switch (value) {
    case 'auto':
      return '自动';
    case 'disabled':
      return '关闭';
    case 'manual':
    default:
      return '手动';
  }
}

function workspaceSectionActive(view, sectionIds = []) {
  const current = String(view?.activeWorkspaceSection ?? '').trim();
  if (!current) {
    return false;
  }
  return sectionIds.includes(current);
}

function disclosureOpen(view, sectionIds = [], fallback = false) {
  if (!String(view?.activeWorkspaceSection ?? '').trim()) {
    return fallback;
  }
  return workspaceSectionActive(view, sectionIds);
}

function disclosureHtml({ sectionId, open = false, eyebrow, title, metaHtml = '', body }) {
  return `
    <details class="compact-disclosure workspace-section-anchor" data-workspace-section="${escapeHtml(sectionId)}" ${open ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
            <strong class="compact-disclosure-title">${escapeHtml(title)}</strong>
          </div>
          ${metaHtml ? `<div class="pill-row">${metaHtml}</div>` : ''}
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${body}
      </div>
    </details>
  `;
}

function resolveWorkspaceGroup(groups, activeSection, fallbackKey) {
  const normalized = String(activeSection ?? '').trim();
  if (!normalized) {
    return groups.find(group => group.key === fallbackKey) ?? groups[0];
  }
  return (
    groups.find(group => group.sections.includes(normalized)) ??
    groups.find(group => group.key === fallbackKey) ??
    groups[0]
  );
}

function workspaceGroupTabs(tab, groups, activeGroupKey) {
  return `
    <div class="tab-bar tab-bar-dense">
      ${groups
        .map(
          group => `
        <button
          type="button"
          class="tab ${group.key === activeGroupKey ? 'active' : ''}"
          data-action="focus-workspace"
          data-tab="${escapeHtml(tab)}"
          data-section="${escapeHtml(group.sectionId)}"
        >
          ${escapeHtml(group.label)}
        </button>
      `
        )
        .join('')}
    </div>
  `;
}

export function renderEditorTabs(view, configDirty, envDirty, structuredDirty, credentialsDirty) {
  const tabs = [
    { key: 'control', label: '控制', dirty: structuredDirty },
    { key: 'credentials', label: '凭证', dirty: credentialsDirty },
    { key: 'config', label: 'YAML', dirty: configDirty },
    { key: 'env', label: '.env', dirty: envDirty },
  ];

  return `
    <div class="tab-bar tab-bar-dense">
      ${tabs
        .map(
          tab => `
        <button
          type="button"
          class="tab ${view.editorTab === tab.key ? 'active' : ''}"
          data-action="switch-editor-tab"
          data-tab="${escapeHtml(tab.key)}"
        >
          ${escapeHtml(tab.label)}
          ${tab.dirty ? '<span class="tab-dirty-dot" aria-hidden="true"></span>' : ''}
        </button>
      `
        )
        .join('')}
    </div>
  `;
}

export function renderConfigRail(view, context) {
  const {
    actionBusy,
    data,
    installation,
    enabledTools,
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
  ].filter(value => String(value ?? '').trim()).length;
  const channelCount = [
    env.telegramBotToken,
    env.telegramHomeChannel,
    env.discordBotToken,
    env.discordHomeChannel,
    env.slackBotToken,
  ].filter(value => String(value ?? '').trim()).length;

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
        <span>模型</span>
        <strong>${escapeHtml(`${data.summary.modelProvider || '未配置'} / ${data.summary.modelDefault || '未配置'}`)}</strong>
      </div>
      <div class="key-value-row">
        <span>终端</span>
        <strong>${escapeHtml(data.summary.terminalBackend || '未配置')}</strong>
      </div>
      <div class="key-value-row">
        <span>能力面</span>
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
    ${
      warnings.length > 0
        ? `<div class="warning-stack top-gap">${warnings
            .slice(0, 2)
            .map(warning => `<div class="warning-item">${escapeHtml(warning)}</div>`)
            .join('')}</div>`
        : '<p class="helper-text">当前没有明显结构性风险。</p>'
    }

    <section class="workspace-rail-section">
      <div class="workspace-rail-section-header">
        <span class="workspace-rail-section-title">常用入口</span>
        ${pillHtml(view.editorTab === 'credentials' ? '凭证面' : '控制面', 'neutral')}
      </div>
      <div class="workspace-shortcut-grid">
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '模型',
          meta: `${data.summary.modelProvider || 'provider 待配'} · ${data.summary.modelDefault || '默认模型待配'}`,
          active: workspaceSectionActive(view, ['model-governance', 'model-presets']),
          attrs: { 'data-tab': 'control', 'data-section': 'model-governance' },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '能力面',
          meta: `${data.summary.toolsets.length} 组能力集 · ${enabledTools} 个工具`,
          active: workspaceSectionActive(view, [
            'toolsets-overview',
            'toolsets-presets',
            'toolsets-manual',
            'toolsets-detail',
          ]),
          attrs: { 'data-tab': 'control', 'data-section': 'toolsets-overview' },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '记忆',
          meta: data.summary.memoryEnabled
            ? data.summary.memoryProvider || 'builtin-file'
            : '记忆已关闭',
          active: workspaceSectionActive(view, ['memory-presets', 'memory-detail']),
          attrs: { 'data-tab': 'control', 'data-section': 'memory-presets' },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '凭证',
          meta: `${credentialsCount} 项密钥已填`,
          active: view.activeWorkspaceSection === 'provider-credentials',
          attrs: { 'data-tab': 'credentials', 'data-section': 'provider-credentials' },
        })}
        ${shortcutCardHtml({
          action: 'focus-workspace',
          label: '通道',
          meta: `${channelCount} 项通道参数 · ${remoteJobs.length} 个远端作业`,
          active: view.activeWorkspaceSection === 'channel-credentials',
          attrs: { 'data-tab': 'credentials', 'data-section': 'channel-credentials' },
        })}
        ${shortcutCardHtml({
          action: 'goto-gateway',
          label: 'Gateway',
          meta: snapshot?.gateway?.gatewayState || '进入网关',
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
        ${buttonHtml({ action: 'diagnostic-doctor', label: '深度体检', disabled: actionBusy })}
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
        <span class="workspace-rail-section-title">历史迁移</span>
        ${buttonHtml({
          action: 'toggle-compatibility-actions',
          label: view.showCompatibilityActions ? '收起' : '展开',
          kind: 'secondary',
        })}
      </div>
      <p class="helper-text">这里只在迁移旧配置时使用。</p>
      ${
        view.showCompatibilityActions
          ? `
        <div class="workspace-compat-panel">
          ${buttonHtml({ action: 'compat-config-migrate', label: view.runningAction === 'config:compat-migrate' ? '迁移中…' : '迁移旧配置', kind: 'primary', disabled: actionBusy || !installation.binaryFound })}
          ${buttonHtml({ action: 'compat-claw-migrate', label: view.runningAction === 'config:claw-migrate' ? '导入中…' : '导入 OpenClaw', disabled: actionBusy || !installation.binaryFound })}
        </div>
      `
          : ''
      }
    </section>
  `;
}

export function renderStructuredControls(view) {
  const draft = view.controlDraft ?? cloneWorkspace();
  const normalizedBindings = normalizePlatformBindings(draft.platformToolsets);
  const memoryPresets = memoryProviderPresets(view);
  const activeGroup = resolveWorkspaceGroup(
    CONTROL_WORKSPACE_GROUPS,
    view.activeWorkspaceSection,
    'model'
  );
  const modelView = resolveModelWorkspaceView(view.controlModelView);
  const toolsetView = resolveToolsetWorkspaceView(view.controlToolsetView);
  const activeGroupContent =
    activeGroup.key === 'model'
      ? `
      <section class="workspace-section-anchor" data-workspace-section="model-governance">
        ${renderModelGovernanceWorkbench(view, draft)}
      </section>
      <section class="shell-card shell-card-dense top-gap">
        <div class="workspace-main-header">
          <div>
            <strong>模型 / Provider</strong>
            <p class="workspace-main-copy">把“判断状态”“接入设置”“细调补充”拆开看，减少一屏里同时出现太多输入框。</p>
          </div>
          <div class="pill-row">
            ${pillHtml(draft.modelProvider || '待补 provider', draft.modelProvider ? 'good' : 'warn')}
            ${pillHtml(draft.streamingEnabled ? '流式输出' : '静态输出', draft.streamingEnabled ? 'neutral' : 'warn')}
          </div>
        </div>
        <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
          ${controlSubviewTabHtml('data-control-model-view', modelView, 'status', '状态')}
          ${controlSubviewTabHtml('data-control-model-view', modelView, 'connect', '接入')}
          ${controlSubviewTabHtml('data-control-model-view', modelView, 'detail', '细调')}
        </div>
        <div class="page-stack top-gap">
          ${
            modelView === 'connect'
              ? renderModelConnectWorkbench(view, draft)
              : modelView === 'detail'
                ? renderModelDetailWorkbench(view, draft)
                : renderModelStatusWorkbench(view, draft)
          }
        </div>
      </section>
    `
      : activeGroup.key === 'toolsets'
        ? `
        <section class="shell-card shell-card-dense">
          <div class="workspace-main-header">
            <div>
              <strong>能力面 / Toolsets</strong>
              <p class="workspace-main-copy">先看状态，再决定是套用预设、手动整理顶层能力，还是继续下钻到平台绑定。</p>
            </div>
            <div class="pill-row">
              ${pillHtml(draft.toolsets.length ? `${draft.toolsets.length} 组` : '待补齐', draft.toolsets.length ? 'good' : 'warn')}
              ${pillHtml(normalizedBindings.length ? `${normalizedBindings.length} 平台` : '无平台绑定', normalizedBindings.length ? 'neutral' : 'warn')}
            </div>
          </div>
          <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
            ${controlSubviewTabHtml('data-control-toolset-view', toolsetView, 'status', '状态')}
            ${controlSubviewTabHtml('data-control-toolset-view', toolsetView, 'presets', '预设')}
            ${controlSubviewTabHtml('data-control-toolset-view', toolsetView, 'manual', '手动')}
            ${controlSubviewTabHtml('data-control-toolset-view', toolsetView, 'platform', '平台')}
          </div>
          <div class="page-stack top-gap">
            ${
              toolsetView === 'platform'
                ? `
                <section class="workspace-section-anchor" data-workspace-section="toolsets-detail">
                  ${renderPlatformBindingManager(view, draft)}
                </section>
              `
                : toolsetView === 'manual'
                  ? `
                  <section class="workspace-section-anchor" data-workspace-section="toolsets-manual">
                    ${renderTopLevelToolsetManager(view, draft)}
                  </section>
                `
                  : toolsetView === 'presets'
                    ? `
                    <section class="workspace-section-anchor" data-workspace-section="toolsets-presets">
                      ${renderToolsetPresetGrid(draft)}
                    </section>
                  `
                    : `
                ${renderToolsetStatusWorkbench(draft)}
              `
            }
          </div>
        </section>
      `
        : activeGroup.key === 'memory'
          ? disclosureHtml({
              sectionId: 'memory-presets',
              open: true,
              eyebrow: '记忆',
              title: '记忆 / 外部 Skills',
              metaHtml: `${pillHtml(draft.memoryEnabled ? '记忆开启' : '记忆关闭', draft.memoryEnabled ? 'good' : 'warn')}${pillHtml(draft.userProfileEnabled ? '画像开启' : '画像关闭', draft.userProfileEnabled ? 'neutral' : 'warn')}${pillHtml(draft.skillsExternalDirs.length ? `${draft.skillsExternalDirs.length} 外部目录` : '无外部目录', draft.skillsExternalDirs.length ? 'neutral' : 'warn')}`,
              body: `
            ${renderMemoryPresetGrid(view, memoryPresets)}
            <div class="form-grid">
              <label class="field-stack">
                <span>记忆 Provider</span>
                <input class="search-input" id="control-memory-provider" value="${escapeHtml(draft.memoryProvider)}" placeholder="留空表示内置文件">
              </label>
              <label class="field-stack">
                <span>Memory 字符上限</span>
                <input class="search-input" id="control-memory-char-limit" value="${escapeHtml(draft.memoryCharLimit ?? '')}" placeholder="2200">
              </label>
              <label class="field-stack">
                <span>User 字符上限</span>
                <input class="search-input" id="control-user-char-limit" value="${escapeHtml(draft.userCharLimit ?? '')}" placeholder="1375">
              </label>
            </div>
            <div class="checkbox-row">
              <label>
                <input type="checkbox" id="control-memory-enabled" ${draft.memoryEnabled ? 'checked' : ''}>
                <span>启用记忆</span>
              </label>
              <label>
                <input type="checkbox" id="control-user-profile-enabled" ${draft.userProfileEnabled ? 'checked' : ''}>
                <span>启用用户画像</span>
              </label>
            </div>
            ${renderSkillsDirectoryManager(view, draft)}
          `,
            })
          : disclosureHtml({
              sectionId: 'runtime-presets',
              open: true,
              eyebrow: '运行时',
              title: '运行时 / 终端 / Discord 路由',
              metaHtml: `${pillHtml(draft.terminalBackend || '未配后端', draft.terminalBackend ? 'good' : 'warn')}${pillHtml(approvalModeLabel(draft.approvalsMode), 'neutral')}`,
              body: `
            ${renderTerminalPresetGrid(view)}
            <div class="form-grid">
              <label class="field-stack">
                <span>终端后端</span>
                <input class="search-input" id="control-terminal-backend" value="${escapeHtml(draft.terminalBackend)}" placeholder="local / docker / modal">
              </label>
              <label class="field-stack">
                <span>终端工作目录</span>
                <input class="search-input" id="control-terminal-cwd" value="${escapeHtml(draft.terminalCwd)}" placeholder=".">
              </label>
              <label class="field-stack">
                <span>审批模式</span>
                <select class="select-input" id="control-approvals-mode">
                  ${['manual', 'auto', 'disabled']
                    .map(
                      item => `
                    <option value="${item}" ${draft.approvalsMode === item ? 'selected' : ''}>${approvalModeLabel(item)}</option>
                  `
                    )
                    .join('')}
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
          `,
            });

  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>核心设置</strong>
          </div>
          <div class="pill-row">
            ${pillHtml(draft.modelProvider || 'provider 未配', draft.modelProvider ? 'good' : 'warn')}
            ${pillHtml(draft.memoryEnabled ? '记忆开启' : '记忆关闭', draft.memoryEnabled ? 'good' : 'warn')}
            ${pillHtml(draft.toolsets.length ? `${draft.toolsets.length} 组能力集` : '无能力集', draft.toolsets.length ? 'good' : 'warn')}
          </div>
        </div>

        <section class="workspace-summary-strip workspace-summary-strip-dense">
          <section class="summary-mini-card">
            <span class="summary-mini-label">当前主模型</span>
            <strong class="summary-mini-value">${escapeHtml(draft.modelDefault || '待选择')}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.modelProvider || 'provider 未配')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">能力暴露</span>
            <strong class="summary-mini-value">${escapeHtml(String(draft.toolsets.length))}</strong>
            <span class="summary-mini-meta">${escapeHtml(platformBindingsPreview(normalizedBindings, '无平台绑定', 2))}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">记忆与画像</span>
            <strong class="summary-mini-value">${escapeHtml(draft.memoryEnabled ? draft.memoryProvider || 'builtin-file' : 'off')}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.userProfileEnabled ? '画像已开启' : '画像已关闭')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">终端后端</span>
            <strong class="summary-mini-value">${escapeHtml(draft.terminalBackend || '待配置')}</strong>
            <span class="summary-mini-meta">${escapeHtml(draft.terminalCwd || '未声明工作目录')}</span>
          </section>
        </section>

        <div class="workspace-main-header">
          <div>
            <strong>当前分组</strong>
            <p class="workspace-main-copy">${escapeHtml(activeGroup.description)}</p>
          </div>
          ${pillHtml(activeGroup.label, 'neutral')}
        </div>
        ${workspaceGroupTabs('control', CONTROL_WORKSPACE_GROUPS, activeGroup.key)}
        <div class="compact-disclosure-stack top-gap">
          ${activeGroupContent}
        </div>
      </section>
    </div>
  `;
}

export function renderStructuredEnvControls(view) {
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
  ].filter(value => value.trim()).length;
  const channelCount = [
    draft.telegramHomeChannel,
    draft.telegramReplyToMode,
    draft.discordHomeChannel,
    draft.discordReplyToMode,
  ].filter(value => value.trim()).length;
  const activeGroup = resolveWorkspaceGroup(
    CREDENTIAL_WORKSPACE_GROUPS,
    view.activeWorkspaceSection,
    'provider'
  );
  const activeGroupContent =
    activeGroup.key === 'provider'
      ? disclosureHtml({
          sectionId: 'provider-credentials',
          open: true,
          eyebrow: '模型凭证',
          title: '模型与 Provider 密钥',
          metaHtml: `${pillHtml(credentialsCount ? `${credentialsCount} 项已填` : '待补齐', credentialsCount ? 'good' : 'warn')}`,
          body: `
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
      `,
        })
      : activeGroup.key === 'channel'
        ? disclosureHtml({
            sectionId: 'channel-credentials',
            open: true,
            eyebrow: '通道',
            title: '网关与消息通道',
            metaHtml: `${pillHtml(draft.hermesGatewayToken ? '网关 token 已填' : '网关 token 待补', draft.hermesGatewayToken ? 'good' : 'warn')}${pillHtml(channelCount ? `${channelCount} 项通道参数` : '通道参数待补', channelCount ? 'neutral' : 'warn')}`,
            body: `
          ${renderChannelPresetGrid(view)}
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
        `,
          })
        : disclosureHtml({
            sectionId: 'runtime-env',
            open: true,
            eyebrow: '运行时',
            title: '终端与浏览器变量',
            metaHtml: `${pillHtml(draft.terminalModalImage || '默认镜像', 'neutral')}${pillHtml(draft.browserSessionTimeout ? `Browser ${draft.browserSessionTimeout}s` : 'Browser 默认', draft.browserSessionTimeout ? 'good' : 'neutral')}`,
            body: `
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
        `,
          });

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
            ${pillHtml(draft.whatsappEnabled ? 'WhatsApp 开启' : 'WhatsApp 关闭', draft.whatsappEnabled ? 'good' : 'neutral')}
          </div>
        </div>

        <section class="workspace-summary-strip workspace-summary-strip-dense">
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
            <span class="summary-mini-meta">${escapeHtml(`终端 ${draft.terminalTimeout ?? '—'}s · 浏览器 ${draft.browserSessionTimeout ?? '—'}s`)}</span>
          </section>
        </section>

        <div class="workspace-main-header">
          <div>
            <strong>当前分组</strong>
            <p class="workspace-main-copy">${escapeHtml(activeGroup.description)}</p>
          </div>
          ${pillHtml(activeGroup.label, 'neutral')}
        </div>
        ${workspaceGroupTabs('credentials', CREDENTIAL_WORKSPACE_GROUPS, activeGroup.key)}
        <div class="compact-disclosure-stack top-gap">
          ${activeGroupContent}
        </div>
      </section>
    </div>
  `;
}
