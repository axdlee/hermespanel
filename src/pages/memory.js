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

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function relaySeed(view) {
  return {
    sourcePage: 'memory',
    headline: view.detail?.label
      ? `围绕 ${view.detail.label} 继续下钻`
      : '围绕记忆工作台继续下钻',
    description: view.investigation?.description
      || '继续围绕 provider、槽位文件、字符预算和运行态一致性做排查。',
    context: view.investigation?.context,
  };
}

function applyIntent(view, intent, announce = true) {
  if (!intent || intent.kind !== 'memory') {
    return;
  }

  view.investigation = intent;
  if (intent.selectedKey) {
    view.selectedKey = intent.selectedKey;
  }
  consumePageIntent();
  if (announce) {
    notify('info', `${intent.headline} 已带入记忆工作台。`);
  }
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">记忆工作台</h1>
      </div>
      <p class="page-desc">正在同步槽位、Provider 和运行态信号。</p>
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
          <h1 class="page-title">记忆工作台</h1>
        </div>
        <p class="page-desc">围绕记忆文件、Provider 和校验动作做统一治理。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">记忆工作台快照暂时不可用，可以重新同步后再继续。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
          </div>
        </div>
        ${emptyStateHtml('未能读取记忆工作台快照', view.error || '请稍后再试。')}
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

  view.page.innerHTML = renderMemoryWorkbench(view, state);

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
  const pluginInput = view.page.querySelector('#memory-plugin-input');
  const editor = view.page.querySelector('#memory-editor');

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
            description: '继续在扩展工作台直接管理插件、memory runtime 和相关依赖。',
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
