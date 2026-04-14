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

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  const summary = logSummary(view);
  const logsDir = summary.logsDir;
  const currentDiagnostic = inferDiagnosticCommand(view.logName, relaySeed(view).context);
  const lineCount = String(view.data?.lines.length ?? 0);

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">日志查看</h1>
        ${infoTipHtml('参考 clawpanel 的标签式日志页，主区域只保留日志切换、过滤和排障联动，不再用大段说明占位置。')}
      </div>
      <p class="page-desc">把日志切换、过滤、自动刷新和跨页排障联动压成一个紧凑工作台。</p>
    </div>

    <section class="workspace-summary-strip workspace-summary-strip-dense">
      <section class="summary-mini-card">
        <span class="summary-mini-label">当前实例</span>
        <strong class="summary-mini-value">${escapeHtml(view.profile)}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.snapshot?.gateway?.gatewayState ?? '未检测到 Gateway')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">日志标签</span>
        <strong class="summary-mini-value">${escapeHtml(LOG_OPTIONS.find((item) => item.key === view.logName)?.label || view.logName)}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.autoRefresh ? '5 秒自动刷新中' : '手动刷新模式')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">返回行数</span>
        <strong class="summary-mini-value">${escapeHtml(lineCount)}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.data?.filePath || '当前还没有日志文件路径')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">关键词</span>
        <strong class="summary-mini-value">${escapeHtml(view.contains || '未过滤')}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.level ? `级别 ${view.level}` : '未附加级别过滤')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">建议诊断</span>
        <strong class="summary-mini-value">${escapeHtml(currentDiagnostic)}</strong>
        <span class="summary-mini-meta">当前日志线索下更适合继续执行的封装诊断</span>
      </section>
    </section>

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

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">快速预设</h2>
          <p class="config-section-desc">先用预设把范围收窄，再根据日志内容决定进入诊断、网关还是配置。</p>
        </div>
      </div>
      <div class="control-card-grid control-card-grid-dense">
        ${PRESETS.map((preset) => `
          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">预设</p>
                <h3 class="action-card-title">${escapeHtml(preset.label)}</h3>
              </div>
              ${pillHtml(preset.logName, 'neutral')}
            </div>
            <p class="action-card-copy">${escapeHtml(preset.contains ? `包含关键词 ${preset.contains}` : '不附加关键词过滤')}，默认读取 ${escapeHtml(preset.limit)} 行。</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'apply-preset', label: '应用预设', attrs: { 'data-preset': preset.key } })}
            </div>
          </section>
        `).join('')}
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
              <strong>下一步诊断</strong>
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
        case 'read-log':
        case 'apply-filter':
          await refreshAll(view);
          return;
        case 'clear-filter':
          view.level = '';
          view.contains = '';
          view.limit = '120';
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
          view.logName = preset.logName;
          view.level = preset.level;
          view.contains = preset.contains;
          view.limit = preset.limit;
          notify('info', `已应用日志预设：${preset.label}`);
          await refreshAll(view);
          return;
        }
        case 'select-log-tab':
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
    timer: null,
    unsubscribe: null,
  };

  const intent = getPageIntent('logs');
  if (intent) {
    applyIntent(activeView, intent, false);
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
