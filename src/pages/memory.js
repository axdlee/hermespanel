import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
} from '../lib/drilldown';
import {
  consumePageIntent,
  getPageIntent,
  getPanelState,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import {
  buttonHtml,
  emptyStateHtml,
} from './native-helpers';
import {
  cloneWorkspace,
  deriveMemoryWorkbenchState,
  remainingChars,
  renderMemoryWorkbench,
} from './memory-workbench';

let activeView = null;

function surfaceTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-memory-surface="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function launcherCardHtml({ action, kicker, title, meta, tone = 'neutral', attrs = {} }) {
  const attrString = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(' ');

  return `
    <button
      type="button"
      class="dashboard-jump-card dashboard-jump-card-${tone}"
      data-action="${escapeHtml(action)}"
      ${attrString}
    >
      <span class="dashboard-jump-kicker">${escapeHtml(kicker)}</span>
      <strong class="dashboard-jump-title">${escapeHtml(title)}</strong>
      <span class="dashboard-jump-meta">${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderSurfaceTabs(view) {
  return `
    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(view.surfaceView, 'focus', '常用')}
      ${surfaceTabHtml(view.surfaceView, 'workbench', '编辑')}
    </div>
  `;
}

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function relaySeed(view) {
  return {
    sourcePage: 'memory',
    headline: view.detail?.label
      ? `围绕 ${view.detail.label} 查看详情`
      : '围绕记忆页查看详情',
    description: view.investigation?.description
      || '围绕 Provider、槽位文件、字符预算和运行态一致性继续查看。',
    context: view.investigation?.context,
  };
}

function applyIntent(view, intent, announce = true) {
  if (!intent || intent.kind !== 'memory') {
    return;
  }

  view.investigation = intent;
  view.surfaceView = 'workbench';
  if (intent.selectedKey) {
    view.selectedKey = intent.selectedKey;
  }
  consumePageIntent();
  if (announce) {
    notify('info', `${intent.headline} 已带入记忆页。`);
  }
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">记忆</h1>
      </div>
      <p class="page-desc">正在同步记忆文件与 Provider。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function updateEditorIndicators(view) {
  const dirtyPill = view.page.querySelector('#memory-dirty-pill');
  const budgetPill = view.page.querySelector('#memory-budget-pill');
  const charValue = view.page.querySelector('#memory-char-count');
  const lineValue = view.page.querySelector('#memory-line-count');

  const dirty = view.detail ? view.content !== view.detail.content : false;
  const remaining = remainingChars(view);
  const lineCount = view.content ? view.content.split(/\r?\n/).length : 0;

  if (dirtyPill) {
    dirtyPill.textContent = dirty ? '未保存' : '已同步';
    dirtyPill.className = `pill pill-${dirty ? 'warn' : 'good'}`;
  }

  if (budgetPill) {
    if (remaining == null) {
      budgetPill.textContent = '无限制';
      budgetPill.className = 'pill pill-neutral';
    } else {
      budgetPill.textContent = `剩余 ${remaining}`;
      budgetPill.className = `pill pill-${remaining < 0 ? 'bad' : remaining < 160 ? 'warn' : 'good'}`;
    }
  }

  if (charValue) {
    charValue.textContent = String(view.content.length);
  }
  if (lineValue) {
    lineValue.textContent = String(lineCount);
  }
}

function renderFocusSurface(view, state) {
  const {
    budgetRemaining,
    current,
    readyCount,
    runtimeProvider,
    selected,
    summary,
    warnings,
  } = state;
  const currentLabel = view.detail?.label || selected?.label || view.selectedKey;
  const currentPath = view.detail?.path || view.config?.hermesHome || '—';
  const memoryEnabled = summary?.memoryEnabled !== false;
  const gatewayRunning = view.dashboard?.gateway?.gatewayState === 'running';
  const userProfileEnabled = Boolean(summary?.userProfileEnabled);
  const slotCount = view.items.length || 3;
  const focusTone = memoryEnabled && warnings.length === 0 ? 'good' : 'warn';
  const focusTitle = !view.items.length
    ? '先准备记忆槽位'
    : warnings.length > 0
      ? `${currentLabel} 有提醒`
      : `${currentLabel} 可编辑`;
  const focusDescription = !view.items.length
    ? '先准备记忆槽位。'
    : warnings.length > 0
      ? '请先处理当前提醒。'
      : '记忆链路状态正常。';
  const budgetLabel = budgetRemaining == null ? '无限制' : `剩余 ${budgetRemaining}`;
  const nextStep = warnings.length > 0 ? '先看诊断' : '打开编辑页';

  return `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">记忆</h1>
      </div>
      <p class="page-desc">记忆文件、Provider 与运行链路。</p>
    </div>

    ${renderSurfaceTabs(view)}

    <section class="workspace-summary-strip workspace-summary-strip-dense">
      <section class="summary-mini-card">
        <span class="summary-mini-label">当前实例</span>
        <strong class="summary-mini-value">${escapeHtml(view.profile)}</strong>
        <span class="summary-mini-meta">${escapeHtml(`${memoryEnabled ? '记忆开启' : '记忆关闭'} · ${gatewayRunning ? '网关运行中' : '网关未运行'}`)}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">运行 Provider</span>
        <strong class="summary-mini-value">${escapeHtml(runtimeProvider)}</strong>
        <span class="summary-mini-meta">${escapeHtml(summary?.memoryProvider === runtimeProvider ? '配置与运行态已对齐' : `配置 ${summary?.memoryProvider || 'builtin-file'}，运行 ${runtimeProvider}`)}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">槽位覆盖</span>
        <strong class="summary-mini-value">${escapeHtml(`${readyCount}/${slotCount}`)}</strong>
        <span class="summary-mini-meta">${escapeHtml(`当前焦点 ${currentLabel} · 用户画像 ${userProfileEnabled ? '开启' : '关闭'}`)}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">当前状态</span>
        <strong class="summary-mini-value">${escapeHtml(warnings.length === 0 ? '正常' : `${warnings.length} 条提醒`)}</strong>
        <span class="summary-mini-meta">${escapeHtml(nextStep)}</span>
      </section>
    </section>

    <section class="dashboard-focus-shell">
      <section class="dashboard-focus-card dashboard-focus-card-${focusTone}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${escapeHtml(current?.eyebrow || '记忆焦点')}</span>
            <h2 class="dashboard-focus-title">${escapeHtml(focusTitle)}</h2>
            <p class="dashboard-focus-desc">${escapeHtml(focusDescription)}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(memoryEnabled ? '记忆开启' : '记忆关闭', memoryEnabled ? 'good' : 'warn')}
            ${pillHtml(gatewayRunning ? '网关运行中' : '网关未运行', gatewayRunning ? 'good' : 'warn')}
            ${pillHtml(warnings.length === 0 ? '正常' : `${warnings.length} 条提醒`, warnings.length === 0 ? 'good' : 'warn')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">当前槽位</span>
            <strong class="dashboard-signal-value">${escapeHtml(currentLabel)}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(currentPath)}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">字符预算</span>
            <strong class="dashboard-signal-value">${escapeHtml(budgetLabel)}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(selected?.exists ? '当前槽位已落盘' : '当前槽位尚未落盘')}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">运行链路</span>
            <strong class="dashboard-signal-value">${escapeHtml(runtimeProvider)}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(`${view.dashboard?.counts?.sessions ?? 0} 个会话 · 插件 ${view.extensions?.plugins?.installedCount ?? 0} 个`)}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">用户画像</span>
            <strong class="dashboard-signal-value">${escapeHtml(userProfileEnabled ? '已开启' : '已关闭')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(memoryEnabled ? '会参与记忆闭环' : '关闭后不会稳定注入运行态')}</span>
          </section>
        </div>
        <div class="dashboard-focus-actions">
          ${buttonHtml({ action: 'open-memory-workbench', label: '打开编辑页', kind: 'primary' })}
          ${buttonHtml({ action: 'memory-setup', label: 'Provider 设置', disabled: Boolean(view.runningAction) || Boolean(view.runningDiagnostic) || Boolean(view.saving) })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '系统诊断' })}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', disabled: Boolean(view.refreshing) || Boolean(view.runningAction) || Boolean(view.runningDiagnostic) || Boolean(view.saving) })}
        </div>
      </section>

      <aside class="dashboard-jump-panel">
        <div class="workspace-main-header">
          <div>
            <strong>快捷入口</strong>
            <p class="workspace-main-copy">只放最常用的 4 项。</p>
          </div>
          ${pillHtml('常用 4 项', 'neutral')}
        </div>
        <div class="dashboard-jump-grid">
          ${launcherCardHtml({
            action: 'open-memory-workbench',
            kicker: '编辑',
            title: '编辑当前槽位',
            meta: `${currentLabel} · ${budgetLabel}`,
            tone: selected?.exists ? 'good' : 'warn',
          })}
          ${launcherCardHtml({
            action: 'memory-setup',
            kicker: '配置',
            title: 'Provider 与记忆开关',
            meta: `${summary?.memoryProvider || 'builtin-file'} · ${memoryEnabled ? '开启' : '关闭'}`,
            tone: memoryEnabled ? 'neutral' : 'warn',
          })}
          ${launcherCardHtml({
            action: 'plugins-panel',
            kicker: '扩展',
            title: '插件',
            meta: `${view.extensions?.plugins?.installedCount ?? 0} 个插件 · 运行时能力`,
          })}
          ${launcherCardHtml({
            action: 'goto-diagnostics',
            kicker: '排障',
            title: '系统诊断',
            meta: warnings[0] || '需要时再进入诊断页排查。',
            tone: warnings.length > 0 ? 'warn' : 'neutral',
          })}
        </div>
      </aside>
    </section>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">当前状态</h2>
          <p class="config-section-desc">当前槽位与系统摘要。</p>
        </div>
      </div>
      <div class="compact-overview-grid compact-overview-grid-dense">
        <section class="shell-card shell-card-dense">
          <div class="shell-card-header">
            <strong>当前槽位</strong>
            ${pillHtml(selected?.exists ? '已落盘' : '未落盘', selected?.exists ? 'good' : 'warn')}
          </div>
          <label class="field-stack">
            <span>槽位</span>
            <select class="select-input" id="memory-focus-select" ${view.items.length === 0 ? 'disabled' : ''}>
              ${
                view.items.length
                  ? view.items.map((item) => `
                    <option value="${escapeHtml(item.key)}" ${item.key === view.selectedKey ? 'selected' : ''}>
                      ${escapeHtml(item.label)}
                    </option>
                  `).join('')
                  : '<option value="">暂无槽位</option>'
              }
            </select>
          </label>
          ${keyValueRowsHtml([
            { label: '路径', value: currentPath },
            { label: 'Provider', value: `${summary?.memoryProvider || 'builtin-file'} / ${runtimeProvider}` },
            { label: '建议操作', value: nextStep },
          ])}
        </section>
        <section class="shell-card shell-card-dense shell-card-muted">
          <div class="shell-card-header">
            <strong>系统状态</strong>
            ${pillHtml(warnings.length === 0 ? '正常' : `${warnings.length} 条提醒`, warnings.length === 0 ? 'good' : 'warn')}
          </div>
          ${keyValueRowsHtml([
            { label: '网关', value: view.dashboard?.gateway?.gatewayState || '未检测到' },
            { label: '会话数', value: String(view.dashboard?.counts?.sessions ?? 0) },
            { label: '用户画像', value: userProfileEnabled ? '已开启' : '已关闭' },
            { label: '插件数', value: String(view.extensions?.plugins?.installedCount ?? 0) },
          ])}
          ${
            warnings.length > 0
              ? `<div class="warning-stack top-gap">${warnings.slice(0, 2).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
              : ''
          }
        </section>
      </div>
    </section>
  `;
}

function renderWorkbenchSurface(view, state) {
  return `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">记忆</h1>
      </div>
      <p class="page-desc">编辑槽位、检查结果和插件都放在这里。</p>
    </div>

    ${renderSurfaceTabs(view)}
    ${renderMemoryWorkbench(view, state, { includeHeader: false })}
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.config) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.config || !view.dashboard || !view.installation || !view.extensions) {
    view.page.innerHTML = `
      <div class="page-header page-header-compact">
        <div class="panel-title-row">
          <h1 class="page-title">记忆</h1>
        </div>
        <p class="page-desc">记忆文件与 Provider。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">记忆快照暂时不可用，可以稍后重试。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
          </div>
        </div>
        ${emptyStateHtml('未能读取记忆快照', view.error || '请稍后再试。')}
      </section>
    `;
    bindEvents(view, {});
    return;
  }

  const state = deriveMemoryWorkbenchState(view);
  const seed = relaySeed(view);
  const configIntent = buildConfigDrilldownIntent(seed, {
    focus: 'memory',
    suggestedCommand: 'memory-status',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    suggestedCommand: 'memory-status',
    logName: 'agent',
  });

  view.page.innerHTML = (view.surfaceView || 'focus') === 'workbench'
    ? renderWorkbenchSurface(view, state)
    : renderFocusSurface(view, state);

  bindEvents(view, { configIntent, diagnosticsIntent });

  const pluginInput = view.page.querySelector('#memory-plugin-input');
  const editor = view.page.querySelector('#memory-editor');

  if (pluginInput) {
    pluginInput.value = view.pluginInput;
  }
  if (editor) {
    editor.value = view.content;
  }
  updateEditorIndicators(view);
}

async function loadDetail(view, key, options = {}) {
  try {
    const detail = await api.readMemoryFile(key, view.profile);
    if (view.destroyed) {
      return;
    }
    view.selectedKey = key;
    view.detail = detail;
    view.content = detail.content;
    if (!options.quiet) {
      renderPage(view);
    }
  } catch (reason) {
    notify('error', String(reason));
  }
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.config && view.dashboard && view.installation && view.extensions);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [items, config, dashboard, installation, extensions] = await Promise.all([
      api.listMemoryFiles(profile),
      api.getConfigDocuments(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getExtensionsSnapshot(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.items = items;
    view.config = config;
    view.dashboard = dashboard;
    view.installation = installation;
    view.extensions = extensions;
    view.pluginInput = view.pluginInput.trim()
      || extensions.plugins.items[0]
      || extensions.memoryRuntime.installedPlugins[0]?.name
      || '';

    const nextKey = items.some((item) => item.key === view.selectedKey)
      ? view.selectedKey
      : items[0]?.key ?? 'soul';
    await loadDetail(view, nextKey, { quiet: true });
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
  view.lastResult = {
    label,
    result,
  };
}

async function runMemoryStatus(view, options = {}) {
  view.runningDiagnostic = true;
  renderPage(view);
  try {
    const result = await api.runDiagnostic('memory-status', view.profile);
    storeResult(view, '记忆状态体检', result);
    if (!options.quiet) {
      notify(result.success ? 'success' : 'error', result.success ? '记忆状态体检已完成。' : '记忆状态体检失败，请查看输出。');
    }
    await loadData(view, { silent: true });
    return result;
  } catch (reason) {
    notify('error', String(reason));
    return null;
  } finally {
    view.runningDiagnostic = false;
    renderPage(view);
  }
}

async function saveCurrent(view, verify = false) {
  view.saving = verify ? 'verify' : 'save';
  renderPage(view);
  try {
    await api.writeMemoryFile(view.selectedKey, view.content, view.profile);
    await loadData(view, { silent: true });
    notify('success', verify ? `${view.selectedKey} 已保存，开始体检记忆运行态。` : `${view.selectedKey} 已保存。`);
    if (verify) {
      await runMemoryStatus(view, { quiet: true });
    }
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function saveMemoryWorkspace(view, mutate, successMessage) {
  view.runningAction = 'memory:save-workspace';
  renderPage(view);
  try {
    const request = cloneWorkspace(view.config?.workspace ?? {});
    mutate(request);
    const nextConfig = await api.saveStructuredConfig(request, view.profile);
    if (view.destroyed) {
      return;
    }
    view.config = nextConfig;
    storeResult(view, successMessage, {
      command: 'save_structured_config',
      exitCode: 0,
      success: true,
      stdout: successMessage,
      stderr: '',
    });
    notify('success', successMessage);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function executePluginAction(view, action, name) {
  const normalized = String(name ?? '').trim();
  if (!normalized) {
    notify('error', '请先输入插件名。');
    return;
  }

  const actionKey = `memory:plugin-${action}`;
  view.runningAction = actionKey;
  renderPage(view);
  try {
    const result = await api.runPluginAction(action, normalized, view.profile);
    storeResult(view, `${action} ${normalized}`, result);
    notify(result.success ? 'success' : 'error', `${normalized} ${action} 已执行。`);
    await loadData(view, { silent: true });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function openInFinder(view, path, label, revealInFinder = false) {
  view.runningAction = `finder:${label}`;
  renderPage(view);
  try {
    await openFinderLocation({
      actionKey: `finder:${label}`,
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

function syncWithPanelState(view) {
  const intent = getPageIntent('memory');
  if (intent) {
    applyIntent(view, intent);
    void loadData(view, { silent: true });
    return;
  }

  const nextProfile = getPanelState().selectedProfile;
  if (nextProfile !== view.profile) {
    view.profile = nextProfile;
    view.config = null;
    view.dashboard = null;
    view.installation = null;
    view.extensions = null;
    view.detail = null;
    view.items = [];
    view.content = '';
    view.error = null;
    view.lastResult = null;
    void loadData(view);
    return;
  }

  renderPage(view);
}

function bindEvents(view, intents) {
  const focusSelect = view.page.querySelector('#memory-focus-select');
  const pluginInput = view.page.querySelector('#memory-plugin-input');
  const editor = view.page.querySelector('#memory-editor');

  view.page.querySelectorAll('[data-memory-surface]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-memory-surface');
      if (!nextView || nextView === view.surfaceView) {
        return;
      }
      view.surfaceView = nextView;
      renderPage(view);
    };
  });

  if (focusSelect) {
    focusSelect.onchange = (event) => {
      void loadDetail(view, event.target.value);
    };
  }

  if (pluginInput) {
    pluginInput.oninput = (event) => {
      view.pluginInput = event.target.value;
      renderPage(view);
    };
    pluginInput.onkeydown = (event) => {
      if (event.key === 'Enter' && view.pluginInput.trim()) {
        event.preventDefault();
        void executePluginAction(view, 'install', view.pluginInput);
      }
    };
  }

  if (editor) {
    editor.oninput = (event) => {
      view.content = event.target.value;
      updateEditorIndicators(view);
    };
  }

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      switch (action) {
        case 'refresh':
          await loadData(view);
          return;
        case 'open-memory-workbench':
          view.surfaceView = 'workbench';
          renderPage(view);
          return;
        case 'memory-status':
          await runMemoryStatus(view);
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'select-slot':
          await loadDetail(view, element.getAttribute('data-key'));
          return;
        case 'memory-setup':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心直接调整 memory provider、记忆开关与用户画像，不再回终端跑 provider 向导。',
            focus: 'memory',
            suggestedCommand: 'memory-status',
          }));
          return;
        case 'memory-off':
          if (!window.confirm('确定关闭当前 profile 的记忆功能吗？')) {
            return;
          }
          await saveMemoryWorkspace(view, (request) => {
            request.memoryEnabled = false;
            request.userProfileEnabled = false;
            request.memoryProvider = '';
            request.toolsets = request.toolsets.filter((item) => item !== 'memory');
            request.platformToolsets = request.platformToolsets.map((item) => ({
              ...item,
              toolsets: item.toolsets.filter((toolset) => toolset !== 'memory'),
            }));
          }, '记忆功能已关闭，配置已直接写回。');
          return;
        case 'plugins-panel':
          navigate('extensions', buildExtensionsDrilldownIntent(relaySeed(view), {
            description: '在扩展页直接管理插件、memory runtime 和相关依赖。',
            pluginName: view.pluginInput.trim() || undefined,
            rawKind: 'plugins',
          }));
          return;
        case 'plugin-install':
          await executePluginAction(view, 'install', view.pluginInput);
          return;
        case 'plugin-update':
          await executePluginAction(view, 'update', view.pluginInput);
          return;
        case 'plugin-remove':
          if (!window.confirm(`确定移除插件 ${view.pluginInput.trim()} 吗？`)) {
            return;
          }
          await executePluginAction(view, 'remove', view.pluginInput);
          return;
        case 'open-home':
          await openInFinder(view, view.config.hermesHome, 'Hermes Home');
          return;
        case 'open-current-file':
          if (view.detail?.path) {
            await openInFinder(view, view.detail.path, view.detail.label, true);
          }
          return;
        case 'open-current-dir':
          if (view.detail?.path) {
            await openInFinder(view, directoryOf(view.detail.path), '记忆目录');
          }
          return;
        case 'goto-config':
          navigate('config', intents.configIntent);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', intents.diagnosticsIntent);
          return;
        case 'save':
          await saveCurrent(view, false);
          return;
        case 'save-verify':
          await saveCurrent(view, true);
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
    config: null,
    content: '',
    dashboard: null,
    detail: null,
    destroyed: false,
    error: null,
    extensions: null,
    installation: null,
    investigation: null,
    items: [],
    lastResult: null,
    loading: true,
    page,
    pluginInput: '',
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    runningDiagnostic: false,
    saving: null,
    selectedKey: 'soul',
    surfaceView: 'focus',
    unsubscribe: null,
  };

  const intent = getPageIntent('memory');
  if (intent) {
    applyIntent(activeView, intent, false);
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView);
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
