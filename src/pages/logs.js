import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  inferDiagnosticCommand,
} from '../lib/drilldown';
import { formatTimestamp } from '../lib/format';
import { consumePageIntent, getPageIntent, getPanelState, navigate, notify, subscribePanelState } from '../lib/panel-state';
import { api } from '../lib/api';
import {
  buttonHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
} from './native-helpers';

let activeView = null;

const LOG_OPTIONS = [
  { key: 'agent', label: 'agent.log' },
  { key: 'errors', label: 'errors.log' },
  { key: 'gateway', label: 'gateway.log' },
  { key: 'gateway.error', label: 'gateway.error.log' },
];

const PRESETS = [
  {
    key: 'gateway-main',
    label: '网关主日志',
    logName: 'gateway',
    level: '',
    contains: '',
    limit: '160',
  },
  {
    key: 'gateway-error',
    label: '网关错误',
    logName: 'gateway.error',
    level: '',
    contains: '',
    limit: '120',
  },
  {
    key: 'provider-error',
    label: 'Provider 异常',
    logName: 'errors',
    level: '',
    contains: 'provider',
    limit: '120',
  },
  {
    key: 'cron-run',
    label: 'Cron 运行',
    logName: 'agent',
    level: '',
    contains: 'cron_',
    limit: '120',
  },
  {
    key: 'tool-error',
    label: '工具异常',
    logName: 'agent',
    level: '',
    contains: 'error',
    limit: '120',
  },
];

const AUTO_REFRESH_MS = 5_000;

function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
}

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightLine(line, query) {
  const html = escapeHtml(line);
  if (!query) {
    return html;
  }

  return html.replace(new RegExp(regexEscape(query), 'gi'), (match) => `<mark class="log-mark">${match}</mark>`);
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'logs',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'logs',
        headline: '来自 Logs 的日志下钻',
        description: '结合当前日志过滤条件继续围绕 Hermes 运行链路下钻。',
      };
}

function applyIntent(view, intent, announce = true) {
  if (!intent) {
    return;
  }

  view.investigation = intent;
  view.autoRefresh = false;
  view.logName = intent.logName ?? 'agent';
  view.level = intent.level ?? '';
  view.contains = intent.contains ?? '';
  view.limit = intent.limit ?? '160';
  consumePageIntent();
  if (announce) {
    notify('info', `${intent.headline} 已带入日志过滤条件。`);
  }
}

function logSummary(view) {
  const logsDir = view.data?.filePath ? directoryOf(view.data.filePath) : view.snapshot ? `${view.snapshot.hermesHome}/logs` : '';
  const relay = relaySeed(view);
  return {
    configIntent: buildConfigDrilldownIntent(relay, {
      description: '把当前日志症状继续带到配置中心，核对 model/provider、context engine 和 toolsets。',
      focus: view.logName.startsWith('gateway')
        ? 'context'
        : (relay.context?.toolNames?.length ?? 0) > 0
          ? 'toolsets'
          : 'model',
      suggestedCommand: view.logName.startsWith('gateway') ? 'gateway-status' : 'config-check',
    }),
    diagnosticsIntent: buildDiagnosticsDrilldownIntent(relay, {
      description: `基于 ${view.logName} 的日志过滤结果继续做诊断。`,
      suggestedCommand: inferDiagnosticCommand(view.logName, relay.context),
      logName: view.logName,
    }),
    extensionsIntent: buildExtensionsDrilldownIntent(relay, {
      description: '把当前日志关键词继续带到扩展层，核对 tools / skills / plugins 能力面。',
      rawKind: 'tools',
      query: view.contains || relay.context?.toolNames?.join(' ') || '',
      toolNames: relay.context?.toolNames ?? [],
    }),
    gatewayIntent: buildGatewayDrilldownIntent(relay, {
      description: '把当前日志线索继续带到网关编排台，核对平台连接、交付作业和服务状态。',
      platformName: relay.context?.source || view.contains || undefined,
    }),
    logsDir,
  };
}

function renderLogLines(view) {
  if (view.loading && !view.data) {
    return '<div class="log-loading">正在读取日志…</div>';
  }

  if (!view.data) {
    return emptyStateHtml('暂无日志', '点击上方读取或应用预设开始加载日志。');
  }

  if (view.data.lines.length === 0) {
    return emptyStateHtml('没有匹配到日志行', '可以切换日志文件、增大返回行数，或者减少关键词过滤。');
  }

  return `
    <div class="log-stream">
      ${view.data.lines.map((line) => `<div class="log-line">${highlightLine(line, view.contains)}</div>`).join('')}
    </div>
  `;
}

function surfaceTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-logs-surface="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function dashboardJumpCardHtml({ action, kicker, title, meta, tone = 'neutral', attrs = {} }) {
  const extraAttrs = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(' ');

  return `
    <button type="button" class="dashboard-jump-card dashboard-jump-card-${tone}" data-action="${escapeHtml(action)}" ${extraAttrs}>
      <span class="dashboard-jump-kicker">${escapeHtml(kicker)}</span>
      <strong class="dashboard-jump-title">${escapeHtml(title)}</strong>
      <span class="dashboard-jump-meta">${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  const summary = logSummary(view);
  const logsDir = summary.logsDir;
  const currentDiagnostic = inferDiagnosticCommand(view.logName, relaySeed(view).context);
  const lineCount = String(view.data?.lines.length ?? 0);
  const surfaceView = view.surfaceView || 'focus';
  const focusState = !view.data
    ? {
      description: '先读一次日志，再决定去诊断、网关还是扩展面继续处理。',
      kicker: '先读取',
      title: '当前还没有带入日志内容',
      tone: 'warn',
    }
    : view.logName.startsWith('gateway')
      ? {
        description: '当前正在查看 Gateway 侧日志。',
        kicker: '网关排障',
        title: '当前正在盯 Gateway 运行链路',
        tone: 'warn',
      }
      : view.contains
        ? {
          description: '日志已经按关键词收窄。',
          kicker: '继续排障',
          title: `围绕「${view.contains}」继续下钻`,
          tone: 'good',
        }
        : {
          description: '先用预设或进入控制台。',
          kicker: '先收窄范围',
          title: '先用预设或进入控制台',
          tone: 'good',
        };
  const focusSignals = [
    {
      label: '当前日志',
      meta: view.autoRefresh ? '5 秒自动刷新中' : '手动刷新模式',
      value: LOG_OPTIONS.find((item) => item.key === view.logName)?.label || view.logName,
    },
    {
      label: '返回行数',
      meta: view.data?.filePath || '当前还没有日志文件路径',
      value: lineCount,
    },
    {
      label: '关键词',
      meta: view.level ? `级别 ${view.level}` : '未附加级别过滤',
      value: view.contains || '未过滤',
    },
    {
      label: '建议诊断',
      meta: view.snapshot?.gateway?.gatewayState ?? '未检测到 Gateway',
      value: currentDiagnostic,
    },
  ];
  const focusContent = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">日志查看</h1>
      </div>
      <p class="page-desc">日志预览、预设与控制台。</p>
    </div>

    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(surfaceView, 'focus', '常用')}
      ${surfaceTabHtml(surfaceView, 'console', '控制台')}
    </div>

    <section class="dashboard-focus-shell">
      <section class="dashboard-focus-card dashboard-focus-card-${focusState.tone}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${escapeHtml(focusState.kicker)}</span>
            <h2 class="dashboard-focus-title">${escapeHtml(focusState.title)}</h2>
            <p class="dashboard-focus-desc">${escapeHtml(focusState.description)}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(view.autoRefresh ? '自动刷新开' : '自动刷新关', view.autoRefresh ? 'good' : 'neutral')}
            ${pillHtml(view.snapshot?.gateway?.gatewayState ?? 'Gateway 未检测', view.snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          ${focusSignals.map((item) => `
            <section class="dashboard-signal-card">
              <span class="dashboard-signal-label">${escapeHtml(item.label)}</span>
              <strong class="dashboard-signal-value">${escapeHtml(item.value)}</strong>
              <span class="dashboard-signal-meta">${escapeHtml(item.meta)}</span>
            </section>
          `).join('')}
        </div>
        <div class="dashboard-focus-actions">
          ${buttonHtml({ action: 'read-log', label: view.loading ? '读取中…' : '读取当前日志', kind: 'primary', disabled: view.loading })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
          ${buttonHtml({ action: 'open-logs-dir', label: '打开 logs', disabled: !logsDir })}
        </div>
      </section>

      <section class="dashboard-jump-panel">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">常用入口</h2>
            <p class="config-section-desc">先用少量预设把范围收窄，想看细节时再进入控制台。</p>
          </div>
        </div>
        <div class="dashboard-jump-grid">
          ${dashboardJumpCardHtml({
            action: 'open-log-console',
            kicker: 'Console',
            title: '进入控制台',
            meta: '查看完整日志流、过滤器和排障联动',
            tone: 'good',
          })}
          ${dashboardJumpCardHtml({
            action: 'apply-preset',
            attrs: { 'data-preset': 'gateway-main' },
            kicker: 'Preset',
            title: '网关主日志',
            meta: '直接带入 gateway.log 并切到控制台',
          })}
          ${dashboardJumpCardHtml({
            action: 'apply-preset',
            attrs: { 'data-preset': 'provider-error' },
            kicker: 'Preset',
            title: 'Provider 异常',
            meta: '快速查看 errors.log 里的 provider 相关线索',
          })}
          ${dashboardJumpCardHtml({
            action: 'apply-preset',
            attrs: { 'data-preset': 'tool-error' },
            kicker: 'Preset',
            title: '工具异常',
            meta: '围绕 agent.log 里的 error 收窄范围',
          })}
        </div>
      </section>
    </section>

    <section class="config-section dashboard-quiet-card">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">概览</h2>
          <p class="config-section-desc">当前日志与建议操作。</p>
        </div>
      </div>
      ${keyValueRowsHtml([
        { label: '日志目录', value: logsDir || '—' },
        { label: '当前文件', value: view.data?.filePath || '—' },
        { label: '当前实例', value: view.profile },
        { label: '建议操作', value: view.logName.startsWith('gateway') ? '优先去 Gateway 或诊断页继续看' : currentDiagnostic },
      ])}
    </section>
  `;

  const consoleContent = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">日志控制台</h1>
      </div>
      <p class="page-desc">这里保留完整控制台、过滤器和日志流；常用预设和轻量判断继续留在上一层。</p>
    </div>

    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(surfaceView, 'focus', '常用')}
      ${surfaceTabHtml(surfaceView, 'console', '控制台')}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">日志控制台</h2>
          <p class="config-section-desc">先切标签，再收窄过滤条件，最后带着线索继续去诊断、网关或配置工作台。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'read-log', label: view.loading ? '读取中…' : '读取', kind: 'primary', disabled: view.loading })}
          ${buttonHtml({ action: 'toggle-auto-refresh', label: view.autoRefresh ? '自动刷新: 开' : '自动刷新: 关', kind: view.autoRefresh ? 'primary' : 'secondary' })}
        </div>
      </div>
      <div class="tab-bar tab-bar-dense">
        ${LOG_OPTIONS.map((item) => `
          <button type="button" class="tab ${item.key === view.logName ? 'active' : ''}" data-action="select-log-tab" data-log="${escapeHtml(item.key)}">
            ${escapeHtml(item.label)}
          </button>
        `).join('')}
      </div>
      <div class="log-toolbar log-toolbar-dense">
        <input class="search-input narrow" id="logs-level-input" placeholder="level" value="${escapeHtml(view.level)}">
        <input class="search-input" id="logs-contains-input" placeholder="包含关键词" value="${escapeHtml(view.contains)}">
        <input class="search-input tiny" id="logs-limit-input" placeholder="120" value="${escapeHtml(view.limit)}">
        ${buttonHtml({ action: 'apply-filter', label: '应用过滤' })}
        ${buttonHtml({ action: 'clear-filter', label: '清空过滤' })}
      </div>
    </section>

    ${
      view.investigation
        ? `
          <div class="context-banner context-banner-compact">
            <div class="context-banner-header">
              <div class="context-banner-copy">
                <span class="context-banner-label">排障上下文</span>
                <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
                <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
              </div>
              <div class="context-banner-meta">
                ${pillHtml(view.investigation.context?.source ?? 'sessions')}
                ${pillHtml(view.investigation.logName ?? view.logName, 'warn')}
                ${view.investigation.contains ? pillHtml(view.investigation.contains, 'neutral') : ''}
              </div>
            </div>
            <div class="context-banner-actions toolbar">
              ${buttonHtml({ action: 'clear-investigation', label: '清除' })}
              ${buttonHtml({ action: 'goto-diagnostics', label: '继续诊断' })}
              ${buttonHtml({ action: 'goto-gateway', label: '进网关页' })}
              ${buttonHtml({ action: 'goto-extensions', label: '进扩展页' })}
            </div>
          </div>
        `
        : ''
    }

    <div class="workspace-shell workspace-shell-dense">
      <aside class="workspace-rail">
        <div class="workspace-rail-header">
          <div>
            <strong>联动入口</strong>
            <p class="helper-text">日志不该孤立分析，必要时直接跳到诊断、网关、扩展或配置工作台继续排查。</p>
          </div>
          ${pillHtml(currentDiagnostic, 'warn')}
        </div>
        <div class="list-stack">
          <div class="list-card">
            <div class="list-card-title">
              <strong>关联诊断</strong>
              ${pillHtml('推荐', 'good')}
            </div>
            <p>结合当前日志标签与过滤条件，优先去诊断页跑更贴近的封装诊断。</p>
            <div class="toolbar top-gap">
              ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页', kind: 'primary' })}
            </div>
          </div>
          <div class="list-card">
            <div class="list-card-title">
              <strong>网关 / 能力面</strong>
              ${pillHtml(view.logName.startsWith('gateway') ? 'Gateway' : '能力面', 'neutral')}
            </div>
            <p>网关日志优先去 Gateway 页，工具、provider 或 skill 异常更适合继续去扩展页或配置页。</p>
            <div class="toolbar top-gap">
              ${buttonHtml({ action: 'goto-gateway', label: '网关页' })}
              ${buttonHtml({ action: 'goto-extensions', label: '扩展页' })}
              ${buttonHtml({ action: 'goto-config', label: '配置页' })}
            </div>
          </div>
        </div>
        <section class="workspace-rail-section">
          <div class="workspace-rail-section-header">
            <span class="workspace-rail-section-title">日志边界</span>
            ${pillHtml(view.loading ? '读取中' : '已同步', view.loading ? 'warn' : 'good')}
          </div>
          ${keyValueRowsHtml([
            { label: '日志目录', value: logsDir || '—' },
            { label: '当前文件', value: view.data?.filePath || '—' },
            { label: '关键词', value: view.contains || '—' },
            { label: '级别', value: view.level || '—' },
          ])}
          <div class="workspace-rail-toolbar workspace-rail-toolbar-muted">
            <div class="workspace-rail-toolbar-grid">
              ${buttonHtml({ action: 'open-logs-dir', label: '打开 logs', disabled: !logsDir })}
              ${buttonHtml({ action: 'open-current-log', label: '定位当前日志', disabled: !view.data?.filePath })}
            </div>
          </div>
        </section>
      </aside>

      <div class="workspace-main">
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>日志内容</strong>
              <p class="workspace-main-copy">支持标签切换、关键词高亮和自动刷新，更接近日常排障使用节奏。</p>
            </div>
            <div class="toolbar">
              ${pillHtml(LOG_OPTIONS.find((item) => item.key === view.logName)?.label || view.logName)}
              ${pillHtml(view.loading ? '读取中' : '已同步', view.loading ? 'warn' : 'good')}
            </div>
          </div>
          <div class="log-viewer log-viewer-tight">${renderLogLines(view)}</div>
        </section>

        <div class="workspace-bottom-grid workspace-bottom-grid-dense">
          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <strong>日志线索</strong>
                <p class="workspace-main-copy">把当前日志症状继续带到诊断、配置和扩展工作台，避免重新描述上下文。</p>
              </div>
            </div>
            <div class="health-grid health-grid-dense">
              <section class="health-card">
                <div class="health-card-header">
                  <strong>最近更新时间</strong>
                  ${pillHtml(view.autoRefresh ? '自动刷新' : '手动模式', view.autoRefresh ? 'good' : 'neutral')}
                </div>
                <p>${escapeHtml(formatTimestamp(view.snapshot?.gateway?.updatedAt))}</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>当前 Gateway</strong>
                  ${pillHtml(view.snapshot?.gateway?.gatewayState ?? '未检测到', view.snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
                </div>
                <p>方便判断这是服务层问题还是能力层问题。</p>
              </section>
            </div>
          </section>

          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <strong>继续下钻</strong>
                <p class="workspace-main-copy">继续围绕当前日志关键词和文件范围，进入更适合的修复工作台。</p>
              </div>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-diagnostics', label: '诊断页', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-gateway', label: 'Gateway 页' })}
              ${buttonHtml({ action: 'goto-extensions', label: '扩展页' })}
              ${buttonHtml({ action: 'goto-config', label: '配置页' })}
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  view.page.innerHTML = surfaceView === 'focus' ? focusContent : consoleContent;

  bindEvents(view);
  syncAutoRefresh(view);
}

async function loadContext(view, silent = false) {
  try {
    const next = await api.getDashboardSnapshot(view.profile);
    if (view.destroyed) {
      return;
    }
    view.snapshot = next;
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
  }
}

async function loadLog(view, overrides = {}, options = {}) {
  const nextLogName = overrides.logName ?? view.logName;
  const nextLevel = overrides.level ?? view.level;
  const nextContains = overrides.contains ?? view.contains;
  const nextLimit = overrides.limit ?? view.limit;

  view.logName = nextLogName;
  view.level = nextLevel;
  view.contains = nextContains;
  view.limit = nextLimit;
  view.loading = true;
  if (!options.quiet) {
    renderPage(view);
  }

  try {
    const next = await api.readLog(
      nextLogName,
      Number(nextLimit) || 120,
      nextLevel || undefined,
      nextContains || undefined,
      view.profile,
    );
    if (view.destroyed) {
      return;
    }
    view.data = next;
    view.error = null;
  } catch (reason) {
    if (view.destroyed) {
      return;
    }
    view.error = String(reason);
    notify('error', view.error);
  } finally {
    view.loading = false;
    renderPage(view);
  }
}

async function refreshAll(view, overrides = {}, options = {}) {
  if (!options.silent) {
    view.refreshing = true;
    renderPage(view);
  }

  try {
    await Promise.all([
      loadContext(view, true),
      loadLog(view, overrides, { quiet: true }),
    ]);
  } finally {
    view.refreshing = false;
    renderPage(view);
  }
}

function syncAutoRefresh(view) {
  if (view.timer) {
    window.clearInterval(view.timer);
    view.timer = null;
  }

  if (!view.autoRefresh) {
    return;
  }

  view.timer = window.setInterval(() => {
    void refreshAll(view, {}, { silent: true });
  }, AUTO_REFRESH_MS);
}

function syncWithPanelState(view) {
  const nextProfile = getPanelState().selectedProfile;
  const intent = getPageIntent('logs');

  if (intent) {
    applyIntent(view, intent);
    view.surfaceView = 'console';
    void refreshAll(view, {
      contains: view.contains,
      level: view.level,
      limit: view.limit,
      logName: view.logName,
    }, { silent: true });
    return;
  }

  if (nextProfile !== view.profile) {
    view.profile = nextProfile;
    view.snapshot = null;
    view.data = null;
    void refreshAll(view, {}, { silent: true });
    return;
  }

  renderPage(view);
}

function bindEvents(view) {
  view.page.querySelectorAll('[data-logs-surface]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-logs-surface');
      if (!nextView || nextView === view.surfaceView) {
        return;
      }
      view.surfaceView = nextView;
      renderPage(view);
    };
  });

  const levelInput = view.page.querySelector('#logs-level-input');
  const containsInput = view.page.querySelector('#logs-contains-input');
  const limitInput = view.page.querySelector('#logs-limit-input');

  if (levelInput) {
    levelInput.oninput = (event) => {
      view.level = event.target.value;
    };
  }
  if (containsInput) {
    containsInput.oninput = (event) => {
      view.contains = event.target.value;
    };
    containsInput.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void refreshAll(view);
      }
    };
  }
  if (limitInput) {
    limitInput.oninput = (event) => {
      view.limit = event.target.value;
    };
    limitInput.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void refreshAll(view);
      }
    };
  }

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      const summary = logSummary(view);

      switch (action) {
        case 'open-log-console':
          view.surfaceView = 'console';
          renderPage(view);
          return;
        case 'read-log':
        case 'apply-filter':
          view.surfaceView = 'console';
          await refreshAll(view);
          return;
        case 'clear-filter':
          view.level = '';
          view.contains = '';
          view.limit = '120';
          view.surfaceView = 'console';
          await refreshAll(view);
          return;
        case 'toggle-auto-refresh':
          view.autoRefresh = !view.autoRefresh;
          notify('info', view.autoRefresh ? '已开启 5 秒自动刷新日志。' : '已关闭自动刷新日志。');
          renderPage(view);
          return;
        case 'apply-preset': {
          const preset = PRESETS.find((item) => item.key === element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.surfaceView = 'console';
          view.logName = preset.logName;
          view.level = preset.level;
          view.contains = preset.contains;
          view.limit = preset.limit;
          notify('info', `已应用日志预设：${preset.label}`);
          await refreshAll(view);
          return;
        }
        case 'select-log-tab':
          view.surfaceView = 'console';
          view.logName = element.getAttribute('data-log') || 'agent';
          await refreshAll(view);
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'open-logs-dir':
          if (summary.logsDir) {
            await openFinderLocation({
              label: 'logs 目录',
              notify,
              path: summary.logsDir,
              setBusy: undefined,
            });
          }
          return;
        case 'open-current-log':
          if (view.data?.filePath) {
            await openFinderLocation({
              label: '当前日志文件',
              notify,
              path: view.data.filePath,
              revealInFinder: true,
              setBusy: undefined,
            });
          }
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', summary.diagnosticsIntent);
          return;
        case 'goto-gateway':
          navigate('gateway', summary.gatewayIntent);
          return;
        case 'goto-extensions':
          navigate('extensions', summary.extensionsIntent);
          return;
        case 'goto-config':
          navigate('config', summary.configIntent);
          return;
        default:
          return;
      }
    };
  });
}

export async function render() {
  cleanup();

  const page = document.createElement('div');
  page.className = 'page';

  activeView = {
    autoRefresh: false,
    contains: '',
    data: null,
    destroyed: false,
    error: null,
    investigation: null,
    level: '',
    limit: '120',
    loading: true,
    logName: 'agent',
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    snapshot: null,
    surfaceView: 'focus',
    timer: null,
    unsubscribe: null,
  };

  const intent = getPageIntent('logs');
  if (intent) {
    applyIntent(activeView, intent, false);
    activeView.surfaceView = 'console';
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderPage(activeView);
  await Promise.all([
    loadContext(activeView, true),
    loadLog(activeView, {}, { quiet: true }),
  ]);
  renderPage(activeView);
  return page;
}

export function cleanup() {
  if (!activeView) {
    return;
  }

  if (activeView.timer) {
    window.clearInterval(activeView.timer);
  }
  activeView.destroyed = true;
  activeView.unsubscribe?.();
  activeView = null;
}
