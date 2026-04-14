import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { getPanelState, getPageIntent, consumePageIntent, loadShell, navigate, notify, subscribePanelState } from '../lib/panel-state';
import {
  buttonHtml,
  emptyStateHtml,
  escapeHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';
import {
  clonePluginImportDraft,
  cloneConfigWorkspace,
  derivedState,
  normalizeToolNames,
  pluginActionState,
  providerActionState,
  relaySeed,
  renderPluginsWorkbench,
  renderRuntimeWorkbench,
  renderSkillsWorkbench,
  renderToolsWorkbench,
  renderWorkbenchRail,
  renderWorkbenchTabs,
  toolActionState,
} from './extensions-workbench';
import { infoTipHtml } from './workbench-helpers';

let activeView = null;

function pluginCatalogRootPath(view) {
  return `${view.extensions?.hermesHome || view.dashboard?.hermesHome || ''}/hermes-agent/plugins`;
}

function preferredPluginTargetName(view) {
  const explicit = view.pluginNameInput.trim();
  if (explicit) {
    return explicit;
  }

  return view.lastImportedPlugin?.imported?.name
    || view.extensions?.pluginCatalog?.find((item) => item.installed)?.name
    || view.extensions?.pluginCatalog?.[0]?.name
    || view.extensions?.plugins?.items?.[0]
    || '';
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">扩展能力台</h1>
      </div>
      <p class="page-desc">正在同步扩展运行态与 Provider。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:124px"></div>').join('')}
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.extensions) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.extensions || !view.dashboard || !view.installation || !view.configDocs) {
    view.page.innerHTML = `
      <div class="page-header page-header-compact">
        <div class="panel-title-row">
          <h1 class="page-title">扩展能力台</h1>
        </div>
        <p class="page-desc">围绕工具、插件、技能运行态和 Provider 做集中治理。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">扩展工作台快照暂时不可用，可以直接重试。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取扩展快照', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const state = derivedState(view);
  const runningToolBatchEnable = view.runningAction === toolActionState('enable', state.currentPlatform?.platformKey ?? '', state.batchToolNames);
  const runningToolBatchDisable = view.runningAction === toolActionState('disable', state.currentPlatform?.platformKey ?? '', state.batchToolNames);
  const workbenchMain = view.workbenchTab === 'tools'
    ? renderToolsWorkbench(view, state, runningToolBatchEnable, runningToolBatchDisable)
    : view.workbenchTab === 'plugins'
      ? renderPluginsWorkbench(view, state)
      : view.workbenchTab === 'skills'
        ? renderSkillsWorkbench(view, state)
        : renderRuntimeWorkbench(view, state);

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">扩展能力台</h1>
        ${infoTipHtml('这里聚焦真正可操作的 Tools、Skills、Plugins 和 Memory Provider 闭环，不再让介绍文案占据主区。')}
      </div>
      <p class="page-desc">Tools、Plugins、Skills、Provider 闭环治理。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner context-banner-compact">
        <div class="context-banner-header">
          <div class="context-banner-copy">
            <span class="context-banner-label">Drilldown</span>
            <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
            <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
          </div>
          <div class="context-banner-meta">
            ${pillHtml(view.investigation.rawKind || 'tools', 'neutral')}
            ${view.investigation.selectedPlatform ? pillHtml(view.investigation.selectedPlatform, 'warn') : ''}
            ${(view.investigation.context?.toolNames ?? []).slice(0, 2).map((item) => pillHtml(item, 'neutral')).join('')}
          </div>
        </div>
        <div class="context-banner-actions toolbar">
          ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
          ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
          ${buttonHtml({ action: 'goto-config', label: '进入配置页' })}
        </div>
      </div>
    ` : ''}

    <div class="stat-cards stat-cards-4">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">工具</span>
          ${statusDotHtml(state.toolsEnabled > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.toolsEnabled}/${state.toolsTotal}`)}</div>
        <div class="stat-card-meta">所有平台已启用工具总量 / 总容量</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">技能</span>
          ${statusDotHtml(state.runtimeSkillMismatch ? 'warning' : 'running')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.runtimeSkills.length} / ${view.skills.length}`)}</div>
        <div class="stat-card-meta">运行态技能 / 本地目录技能</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">插件</span>
          ${statusDotHtml(state.pluginInstalledCount > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.pluginInstalledCount}/${state.pluginAvailableCount || state.pluginInstalledCount}`)}</div>
        <div class="stat-card-meta">${escapeHtml(state.pluginAvailableCount ? '已安装 / 目录插件总数' : view.extensions.plugins.installHint || '当前仍以 builtin 与 local skills 为主。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Provider / 网关</span>
          ${statusDotHtml(state.providerAligned && view.dashboard.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(state.configuredProviderDisplay === 'builtin-file' ? '内置文件' : state.configuredProviderDisplay)}</div>
        <div class="stat-card-meta">${escapeHtml(`运行 ${view.extensions.memoryRuntime.provider} · ${view.dashboard.gateway?.gatewayState || 'Gateway 未运行'}`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', kind: 'primary', disabled: view.refreshing })}
      ${buttonHtml({
        action: 'provider-apply',
        label: state.configuredProviderDisplay === 'builtin-file' ? '内置已接管' : '切回内置',
        kind: state.configuredProviderDisplay === 'builtin-file' ? 'secondary' : 'primary',
        disabled: view.refreshing || Boolean(view.runningAction) || state.configuredProviderDisplay === 'builtin-file',
        attrs: { 'data-provider-mode': 'builtin', 'data-provider-name': '' },
      })}
      ${buttonHtml({ action: 'goto-config-credentials', label: '凭证配置' })}
      ${buttonHtml({ action: 'goto-memory', label: '查看 Memory' })}
      ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">扩展工作台</h2>
          <p class="config-section-desc">治理主区，运行快照兜底。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workbenchTab === 'tools' ? '工具' : view.workbenchTab === 'plugins' ? '插件' : view.workbenchTab === 'skills' ? '技能' : '运行快照', 'neutral')}
          ${state.warnings.length > 0 ? pillHtml(`${state.warnings.length} 条提醒`, 'warn') : pillHtml('运行态稳定', 'good')}
        </div>
      </div>
      ${renderWorkbenchTabs(view)}
      <div class="workspace-shell workspace-shell-dense">
        <aside class="workspace-rail">
          ${renderWorkbenchRail(view, state)}
        </aside>
        <div class="workspace-main-card">
          ${workbenchMain}
        </div>
      </div>
    </section>
  `;

  bindEvents(view);

  const toolInput = view.page.querySelector('#extensions-tool-input');
  const toolPreview = view.page.querySelector('#extensions-tool-preview');
  const pluginInput = view.page.querySelector('#extensions-plugin-input');
  const pluginSearch = view.page.querySelector('#extensions-plugin-search');
  const searchInput = view.page.querySelector('#extensions-skill-search');

  if (toolInput) {
    toolInput.value = view.toolNamesInput;
  }
  if (toolPreview) {
    toolPreview.value = state.batchToolNames.join(', ') || '尚未输入有效 tool 名称';
  }
  if (pluginInput) {
    pluginInput.value = view.pluginNameInput;
  }
  if (pluginSearch) {
    pluginSearch.value = view.pluginQuery;
  }
  if (searchInput) {
    searchInput.value = view.query;
  }

  view.cachedIntents = {
    configIntent: state.configIntent,
    diagnosticsIntent: state.diagnosticsIntent,
    logsIntent: state.logsIntent,
  };
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.extensions && view.dashboard && view.installation && view.configDocs);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [nextExtensions, nextDashboard, nextInstallation, nextSkills, nextConfigDocs] = await Promise.all([
      api.getExtensionsSnapshot(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.listSkills(profile),
      api.getConfigDocuments(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.extensions = nextExtensions;
    view.dashboard = nextDashboard;
    view.installation = nextInstallation;
    view.skills = nextSkills;
    view.configDocs = nextConfigDocs;
    view.selectedPlatform = nextExtensions.toolInventory.some((item) => item.platformKey === view.selectedPlatform)
      ? view.selectedPlatform
      : nextExtensions.toolInventory[0]?.platformKey ?? '';
    if (!view.pluginNameInput.trim()) {
      view.pluginNameInput = nextExtensions.pluginCatalog.find((item) => item.installed)?.name
        ?? nextExtensions.pluginCatalog[0]?.name
        ?? nextExtensions.plugins.items[0]
        ?? '';
    }
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

async function saveProviderWorkspace(view, mode, providerName) {
  if (!view.configDocs?.workspace) {
    notify('error', '结构化配置尚未加载完成，暂时不能直接切换 provider。');
    return;
  }

  const request = cloneConfigWorkspace(view.configDocs.workspace);
  const normalizedProvider = providerName.trim();
  let successMessage = '';

  if (mode === 'off') {
    request.memoryEnabled = false;
    request.userProfileEnabled = false;
    request.memoryProvider = '';
    request.toolsets = request.toolsets.filter((item) => item !== 'memory');
    request.platformToolsets = request.platformToolsets.map((item) => ({
      ...item,
      toolsets: item.toolsets.filter((toolset) => toolset !== 'memory'),
    }));
    successMessage = '记忆能力已关闭，并已直接写回到 Hermes 配置。';
  } else if (mode === 'builtin') {
    request.memoryEnabled = true;
    request.userProfileEnabled = true;
    request.memoryProvider = '';
    request.toolsets = uniqueValues([...request.toolsets, 'memory']);
    successMessage = '内置文件已设为默认 provider，并已直接写回到 Hermes 配置。';
  } else {
    if (!normalizedProvider) {
      notify('error', '缺少 provider 名称，无法写回配置。');
      return;
    }
    request.memoryEnabled = true;
    request.userProfileEnabled = true;
    request.memoryProvider = normalizedProvider;
    request.toolsets = uniqueValues([...request.toolsets, 'memory']);
    successMessage = `${normalizedProvider} 已设为默认 memory provider，并已直接写回到 Hermes 配置。`;
  }

  view.runningAction = providerActionState(mode, normalizedProvider);
  renderPage(view);
  try {
    const nextConfigDocs = await api.saveStructuredConfig(request, view.profile);
    if (view.destroyed) {
      return;
    }
    view.configDocs = nextConfigDocs;
    storeResult(view, 'Provider 配置直写', {
      command: 'save_structured_config',
      exitCode: 0,
      success: true,
      stdout: successMessage,
      stderr: '',
    });
    notify('success', successMessage);
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

async function executeToolAction(view, action, platformKey, names, options = {}) {
  const normalizedNames = Array.from(new Set(names.map((item) => item.trim()).filter(Boolean)));
  if (!platformKey.trim()) {
    notify('error', '请先选择一个 Hermes tools 平台。');
    return;
  }
  if (!normalizedNames.length) {
    notify('error', '至少提供一个 tool 名称。');
    return;
  }

  const actionId = toolActionState(action, platformKey, normalizedNames);
  view.runningAction = actionId;
  renderPage(view);
  try {
    const result = await api.runToolAction(action, platformKey, normalizedNames, view.profile);
    storeResult(view, options.label ?? normalizedNames.join('、'), result);
    if (options.clearInput) {
      view.toolNamesInput = '';
    }
    notify(
      result.success ? 'success' : 'error',
      result.success
        ? `${options.label ?? normalizedNames.join('、')} 已执行 ${action}。`
        : `${options.label ?? normalizedNames.join('、')} 执行 ${action} 失败，请查看命令输出。`,
    );
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

async function executePluginAction(view, action, name) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    notify('error', '请输入 plugin 名称。');
    return;
  }

  const actionId = pluginActionState(action, normalizedName);
  view.runningAction = actionId;
  renderPage(view);
  try {
    const result = await api.runPluginAction(action, normalizedName, view.profile);
    storeResult(view, `插件 ${normalizedName} · ${action}`, result);
    notify(
      result.success ? 'success' : 'error',
      result.success
        ? `插件 ${normalizedName} 已在客户端执行 ${action}。`
        : `插件 ${normalizedName} 执行 ${action} 失败，请查看命令输出。`,
    );
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

async function importLocalPlugin(view) {
  const draft = view.pluginImportDraft ?? clonePluginImportDraft();
  if (!draft.sourcePath.trim()) {
    notify('error', '请先填写插件目录或 plugin.yaml 路径。');
    return;
  }

  view.runningAction = 'plugin:import-local';
  renderPage(view);
  try {
    const result = await api.importPlugin({
      category: draft.category.trim(),
      overwrite: Boolean(draft.overwrite),
      sourcePath: draft.sourcePath.trim(),
    }, view.profile);
    view.lastImportedPlugin = result;
    view.pluginNameInput = result.imported.name;
    storeResult(view, `导入插件 · ${result.imported.name}`, {
      command: 'local://plugins/import',
      exitCode: 0,
      stderr: '',
      stdout: `source: ${result.sourcePath}\ntarget: ${result.targetDirectory}\nfiles: ${result.copiedFiles}`,
      success: true,
    });
    notify('success', `${result.imported.name} 已导入到当前 profile，复制了 ${result.copiedFiles} 个文件。`);
    view.pluginImportDraft = clonePluginImportDraft({
      category: result.imported.category,
    });
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncWithPanelState(view) {
  const shell = getPanelState();
  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.configDocs = null;
    view.extensions = null;
    view.dashboard = null;
    view.installation = null;
    view.lastImportedPlugin = null;
    view.pluginImportDraft = clonePluginImportDraft();
    view.skills = [];
    view.error = null;
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('extensions');
  if (nextIntent) {
    view.investigation = nextIntent;
    view.rawKind = nextIntent.rawKind ?? view.rawKind;
    view.workbenchTab = nextIntent.rawKind ? 'runtime' : view.workbenchTab;
    view.query = nextIntent.query ?? view.query;
    view.sourceFilter = nextIntent.sourceFilter ?? view.sourceFilter;
    if (nextIntent.selectedPlatform) {
      view.selectedPlatform = nextIntent.selectedPlatform;
      view.workbenchTab = 'tools';
    }
    if (nextIntent.toolNames?.length) {
      view.toolNamesInput = nextIntent.toolNames.join(', ');
      view.workbenchTab = 'tools';
    }
    if (nextIntent.pluginName) {
      view.pluginNameInput = nextIntent.pluginName;
      view.workbenchTab = 'plugins';
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
  const toolInput = view.page.querySelector('#extensions-tool-input');
  const toolPreview = view.page.querySelector('#extensions-tool-preview');
  const pluginInput = view.page.querySelector('#extensions-plugin-input');
  const pluginSearch = view.page.querySelector('#extensions-plugin-search');
  const pluginImportSource = view.page.querySelector('#extensions-plugin-import-source');
  const pluginImportCategory = view.page.querySelector('#extensions-plugin-import-category');
  const pluginImportOverwrite = view.page.querySelector('#extensions-plugin-import-overwrite');
  const skillSearch = view.page.querySelector('#extensions-skill-search');
  const sourceFilter = view.page.querySelector('#extensions-source-filter');
  const platformSelect = view.page.querySelector('#extensions-platform-select');

  const syncInlineControls = () => {
    const batchNames = normalizeToolNames(view.toolNamesInput);
    const hasPluginName = Boolean(preferredPluginTargetName(view));
    const batchEnable = view.page.querySelector('[data-action="tool-batch-enable"]');
    const batchDisable = view.page.querySelector('[data-action="tool-batch-disable"]');
    const pluginInstall = view.page.querySelector('[data-action="plugin-install"]');
    const pluginUpdate = view.page.querySelector('[data-action="plugin-update"]');
    const pluginRemove = view.page.querySelector('[data-action="plugin-remove"]');
    const pluginEnable = view.page.querySelector('[data-action="plugin-enable-current"]');
    const pluginDisable = view.page.querySelector('[data-action="plugin-disable-current"]');

    if (batchEnable) {
      batchEnable.disabled = Boolean(view.runningAction) || batchNames.length === 0;
    }
    if (batchDisable) {
      batchDisable.disabled = Boolean(view.runningAction) || batchNames.length === 0;
    }
    if (pluginInstall) {
      pluginInstall.disabled = Boolean(view.runningAction) || !view.installation?.binaryFound || !hasPluginName;
    }
    if (pluginUpdate) {
      pluginUpdate.disabled = Boolean(view.runningAction) || !view.installation?.binaryFound || !hasPluginName;
    }
    if (pluginRemove) {
      pluginRemove.disabled = Boolean(view.runningAction) || !view.installation?.binaryFound || !hasPluginName;
    }
    if (pluginEnable) {
      pluginEnable.disabled = Boolean(view.runningAction) || !hasPluginName;
    }
    if (pluginDisable) {
      pluginDisable.disabled = Boolean(view.runningAction) || !hasPluginName;
    }
  };

  if (toolInput) {
    toolInput.oninput = (event) => {
      view.toolNamesInput = event.target.value;
      if (toolPreview) {
        const names = normalizeToolNames(view.toolNamesInput);
        toolPreview.value = names.join(', ') || '尚未输入有效 tool 名称';
      }
      syncInlineControls();
    };
  }

  if (pluginInput) {
    pluginInput.oninput = (event) => {
      view.pluginNameInput = event.target.value;
      syncInlineControls();
    };
  }

  if (pluginSearch) {
    pluginSearch.oninput = (event) => {
      view.pluginQuery = event.target.value;
      renderPage(view);
    };
  }

  if (pluginImportSource) {
    pluginImportSource.oninput = (event) => {
      view.pluginImportDraft.sourcePath = event.target.value;
      renderPage(view);
    };
  }

  if (pluginImportCategory) {
    pluginImportCategory.oninput = (event) => {
      view.pluginImportDraft.category = event.target.value;
    };
  }

  if (pluginImportOverwrite) {
    pluginImportOverwrite.onchange = (event) => {
      view.pluginImportDraft.overwrite = Boolean(event.target.checked);
    };
  }

  if (platformSelect) {
    platformSelect.onchange = (event) => {
      view.selectedPlatform = event.target.value;
      renderPage(view);
    };
  }

  if (skillSearch) {
    skillSearch.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        view.query = skillSearch.value;
        renderPage(view);
      }
    };
  }

  if (sourceFilter) {
    sourceFilter.onchange = (event) => {
      view.sourceFilter = event.target.value;
      renderPage(view);
    };
  }

  syncInlineControls();

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'refresh') {
        await Promise.all([
          loadShell(view.profile, { silent: true }),
          loadData(view, { silent: true }),
        ]);
        return;
      }

      if (!view.installation || !view.extensions) {
        return;
      }

      switch (action) {
        case 'set-workbench-tab':
          view.workbenchTab = element.getAttribute('data-tab') || 'tools';
          renderPage(view);
          return;
        case 'set-plugin-filter':
          view.pluginFilter = element.getAttribute('data-filter') || 'all';
          renderPage(view);
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'plugin-install':
          await executePluginAction(view, 'install', preferredPluginTargetName(view));
          return;
        case 'plugin-import-local':
          await importLocalPlugin(view);
          return;
        case 'plugin-import-reset':
          view.pluginImportDraft = clonePluginImportDraft();
          renderPage(view);
          return;
        case 'plugin-install-card':
          await executePluginAction(view, 'install', element.getAttribute('data-name') || '');
          return;
        case 'plugin-update':
          await executePluginAction(view, 'update', preferredPluginTargetName(view));
          return;
        case 'plugin-update-card':
          await executePluginAction(view, 'update', element.getAttribute('data-name') || '');
          return;
        case 'plugin-remove':
          if (!window.confirm(`确定移除插件 ${preferredPluginTargetName(view).trim()} 吗？`)) {
            return;
          }
          await executePluginAction(view, 'remove', preferredPluginTargetName(view));
          return;
        case 'plugin-remove-card': {
          const name = element.getAttribute('data-name') || '';
          if (!window.confirm(`确定移除插件 ${name} 吗？`)) {
            return;
          }
          await executePluginAction(view, 'remove', name);
          return;
        }
        case 'plugin-enable-current':
          await executePluginAction(view, 'enable', preferredPluginTargetName(view));
          return;
        case 'plugin-disable-current':
          await executePluginAction(view, 'disable', preferredPluginTargetName(view));
          return;
        case 'plugin-enable':
          await executePluginAction(view, 'enable', element.getAttribute('data-name') || '');
          return;
        case 'plugin-disable':
          await executePluginAction(view, 'disable', element.getAttribute('data-name') || '');
          return;
        case 'plugin-fill':
          view.pluginNameInput = element.getAttribute('data-name') || '';
          renderPage(view);
          return;
        case 'plugin-configure': {
          const name = element.getAttribute('data-name') || '';
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: `继续为插件 ${name} 配置相关凭证与通道环境变量。`,
            focus: 'credentials',
          }));
          return;
        }
        case 'provider-apply':
          await saveProviderWorkspace(
            view,
            element.getAttribute('data-provider-mode') || 'builtin',
            element.getAttribute('data-provider-name') || '',
          );
          return;
        case 'provider-configure': {
          const name = element.getAttribute('data-provider-name') || '';
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: `继续补齐 ${name || '当前 provider'} 所需的凭证变量。`,
            focus: 'credentials',
          }));
          return;
        }
        case 'plugin-open':
          await openInFinder(view, element.getAttribute('data-path') || '', element.getAttribute('data-name') || 'Plugin 目录', false);
          return;
        case 'open-plugin-root':
          await openInFinder(view, pluginCatalogRootPath(view), '插件目录', false);
          return;
        case 'tool-batch-enable':
          {
            const currentState = derivedState(view);
            if (currentState.currentPlatform) {
              await executeToolAction(view, 'enable', currentState.currentPlatform.platformKey, normalizeToolNames(view.toolNamesInput), {
                clearInput: true,
                label: `${currentState.currentPlatform.displayName} 批量工具`,
              });
            }
          }
          return;
        case 'tool-batch-disable':
          {
            const currentState = derivedState(view);
            if (currentState.currentPlatform) {
              await executeToolAction(view, 'disable', currentState.currentPlatform.platformKey, normalizeToolNames(view.toolNamesInput), {
                clearInput: true,
                label: `${currentState.currentPlatform.displayName} 批量工具`,
              });
            }
          }
          return;
        case 'tool-enable':
          {
            const currentState = derivedState(view);
            if (currentState.currentPlatform) {
              await executeToolAction(view, 'enable', currentState.currentPlatform.platformKey, [element.getAttribute('data-name') || '']);
            }
          }
          return;
        case 'tool-disable':
          {
            const currentState = derivedState(view);
            if (currentState.currentPlatform) {
              await executeToolAction(view, 'disable', currentState.currentPlatform.platformKey, [element.getAttribute('data-name') || '']);
            }
          }
          return;
        case 'tool-logs': {
          const name = element.getAttribute('data-name') || '';
          navigate('logs', buildLogsDrilldownIntent(relaySeed(view), {
            description: `查看工具 ${name} 的运行日志。`,
            logName: 'agent',
            contains: name,
            limit: '160',
          }));
          return;
        }
        case 'apply-skill-filter':
          view.query = skillSearch?.value ?? view.query;
          view.sourceFilter = sourceFilter?.value ?? view.sourceFilter;
          renderPage(view);
          return;
        case 'open-home':
          await openInFinder(view, view.extensions.hermesHome, 'Hermes Home', false);
          return;
        case 'goto-logs':
          navigate('logs', view.cachedIntents?.logsIntent);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', view.cachedIntents?.diagnosticsIntent);
          return;
        case 'goto-config':
          navigate('config', view.cachedIntents?.configIntent);
          return;
        case 'goto-config-memory':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心核对 memory provider、记忆开关与 provider 闭环。',
            focus: 'memory',
          }));
          return;
        case 'goto-config-toolsets':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心核对 toolsets 与扩展暴露范围。',
            focus: 'toolsets',
          }));
          return;
        case 'goto-config-credentials':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心补齐模型、网关和插件所需的凭证变量。',
            focus: 'credentials',
          }));
          return;
        case 'goto-skills':
          navigate('skills');
          return;
        case 'goto-memory':
          navigate('memory');
          return;
        case 'raw-tools':
          view.workbenchTab = 'runtime';
          view.rawKind = 'tools';
          renderPage(view);
          return;
        case 'raw-memory':
          view.workbenchTab = 'runtime';
          view.rawKind = 'memory';
          renderPage(view);
          return;
        case 'raw-plugins':
          view.workbenchTab = 'runtime';
          view.rawKind = 'plugins';
          renderPage(view);
          return;
        case 'raw-skills':
          view.workbenchTab = 'runtime';
          view.rawKind = 'skills';
          renderPage(view);
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
    cachedIntents: null,
    configDocs: null,
    dashboard: null,
    destroyed: false,
    error: null,
    extensions: null,
    installation: null,
    investigation: getPageIntent('extensions'),
    lastImportedPlugin: null,
    lastResult: null,
    loading: true,
    page,
    pluginFilter: 'all',
    pluginImportDraft: clonePluginImportDraft(),
    pluginNameInput: '',
    pluginQuery: '',
    profile: getPanelState().selectedProfile,
    query: '',
    rawKind: 'tools',
    refreshing: false,
    runningAction: null,
    selectedPlatform: '',
    skills: [],
    sourceFilter: 'all',
    toolNamesInput: '',
    unsubscribe: null,
    workbenchTab: 'tools',
  };

  if (activeView.investigation) {
    activeView.rawKind = activeView.investigation.rawKind ?? activeView.rawKind;
    activeView.query = activeView.investigation.query ?? activeView.query;
    activeView.sourceFilter = activeView.investigation.sourceFilter ?? activeView.sourceFilter;
    activeView.selectedPlatform = activeView.investigation.selectedPlatform ?? activeView.selectedPlatform;
    activeView.toolNamesInput = activeView.investigation.toolNames?.join(', ') ?? activeView.toolNamesInput;
    activeView.pluginNameInput = activeView.investigation.pluginName ?? activeView.pluginNameInput;
    activeView.workbenchTab = activeView.investigation.rawKind
      ? 'runtime'
      : activeView.investigation.pluginName
        ? 'plugins'
        : activeView.investigation.selectedPlatform || activeView.investigation.toolNames?.length
          ? 'tools'
          : activeView.workbenchTab;
    consumePageIntent();
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
