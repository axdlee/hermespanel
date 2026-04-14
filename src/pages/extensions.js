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
  clonePluginCreateDraft,
  clonePluginImportDraft,
  cloneConfigWorkspace,
  derivedState,
  normalizePlatformBindings,
  normalizeToolNames,
  pluginActionState,
  providerActionState,
  relaySeed,
  renderPluginsWorkbench,
  resolvePluginGovernanceTarget,
  renderRuntimeWorkbench,
  renderSkillsWorkbench,
  renderToolsWorkbench,
  uniqueValues,
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

  return view.lastCreatedPlugin?.created?.name
    || view.lastImportedPlugin?.imported?.name
    || view.extensions?.pluginCatalog?.find((item) => item.installed)?.name
    || view.extensions?.pluginCatalog?.[0]?.name
    || view.extensions?.plugins?.items?.[0]
    || '';
}

function manifestPathForFocus(focus) {
  if (!focus?.catalogItem?.directoryPath) {
    return '';
  }
  return `${focus.catalogItem.directoryPath}/plugin.yaml`;
}

function readmeTargetPathForFocus(focus) {
  return focus?.catalogItem?.directoryPath || '';
}

function formatPluginManifestList(values = []) {
  return (values ?? []).join('\n');
}

function formatPluginExternalDependencies(values = []) {
  return (values ?? [])
    .map((item) => [item.name, item.install, item.check].map((part) => String(part ?? '').trim()).join(' | '))
    .join('\n');
}

function createPluginManifestDraft(detail) {
  if (!detail) {
    return null;
  }

  return {
    category: detail.category || '',
    description: detail.description || '',
    directoryPath: detail.directoryPath || '',
    externalDependenciesText: formatPluginExternalDependencies(detail.externalDependencies),
    manifestPath: detail.manifestPath || '',
    name: detail.name || '',
    pipDependenciesText: formatPluginManifestList(detail.pipDependencies),
    rawYaml: detail.rawYaml || '',
    relativePath: detail.relativePath || '',
    requiresEnvText: formatPluginManifestList(detail.requiresEnv),
  };
}

function createPluginReadmeDraft(detail) {
  if (!detail) {
    return null;
  }

  return {
    category: detail.category || '',
    content: detail.content || '',
    directoryPath: detail.directoryPath || '',
    exists: Boolean(detail.exists),
    filePath: detail.filePath || '',
    name: detail.name || '',
    relativePath: detail.relativePath || '',
  };
}

function parsePluginManifestList(value) {
  const seen = new Set();
  const result = [];

  value.split(/[\n,，；;]/).forEach((item) => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function parsePluginExternalDependencies(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', install = '', check = ''] = line.split('|').map((item) => item.trim());
      if (!name) {
        return null;
      }
      return {
        check,
        install,
        name,
      };
    })
    .filter(Boolean);
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
  if (view.workbenchTab === 'plugins') {
    syncPluginManifestTarget(view, state);
    syncPluginReadmeTarget(view, state);
  }
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

  if (view.workbenchTab === 'plugins') {
    void ensurePluginManifestLoaded(view);
    void ensurePluginReadmeLoaded(view);
  }
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

function normalizePlatformKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function upsertPlatformBinding(bindings, platformKey, toolsets) {
  const normalizedPlatform = String(platformKey ?? '').trim();
  const nextBindings = normalizePlatformBindings(bindings);
  const index = nextBindings.findIndex((item) => normalizePlatformKey(item.platform) === normalizePlatformKey(normalizedPlatform));

  if (!toolsets.length) {
    if (index >= 0) {
      nextBindings.splice(index, 1);
    }
    return normalizePlatformBindings(nextBindings);
  }

  if (index >= 0) {
    nextBindings[index] = {
      ...nextBindings[index],
      platform: nextBindings[index].platform || normalizedPlatform,
      toolsets,
    };
  } else {
    nextBindings.push({
      platform: normalizedPlatform,
      toolsets,
    });
  }

  return normalizePlatformBindings(nextBindings);
}

function pruneTopLevelToolsets(toolsets, bindings, removedNames) {
  const candidates = new Set(uniqueValues(removedNames));
  const stillBound = new Set(normalizePlatformBindings(bindings).flatMap((item) => item.toolsets));
  return uniqueValues(toolsets).filter((item) => !candidates.has(item) || stillBound.has(item));
}

function applyToolConfigMutation(workspace, action, platformKey, names) {
  const normalizedPlatform = String(platformKey ?? '').trim();
  const normalizedNames = uniqueValues(names);
  if (!normalizedPlatform) {
    throw new Error('请先选择一个 Hermes tools 平台。');
  }
  if (!normalizedNames.length) {
    throw new Error('至少提供一个 tool 名称。');
  }

  const request = cloneConfigWorkspace(workspace);
  request.toolsets = uniqueValues(request.toolsets);
  request.platformToolsets = normalizePlatformBindings(request.platformToolsets);

  if (action === 'promote-top-level') {
    request.toolsets = uniqueValues([...request.toolsets, ...normalizedNames]);
    return {
      normalizedNames,
      request,
      nextPlatformToolsets: request.platformToolsets.find((item) => normalizePlatformKey(item.platform) === normalizePlatformKey(normalizedPlatform))?.toolsets ?? [],
    };
  }

  const currentBinding = request.platformToolsets.find((item) => normalizePlatformKey(item.platform) === normalizePlatformKey(normalizedPlatform));
  const currentToolsets = uniqueValues(currentBinding?.toolsets ?? []);
  const nextPlatformToolsets = action === 'enable'
    ? uniqueValues([...currentToolsets, ...normalizedNames])
    : currentToolsets.filter((item) => !normalizedNames.includes(item));

  request.platformToolsets = upsertPlatformBinding(request.platformToolsets, normalizedPlatform, nextPlatformToolsets);
  request.toolsets = action === 'enable'
    ? uniqueValues([...request.toolsets, ...normalizedNames])
    : pruneTopLevelToolsets(request.toolsets, request.platformToolsets, normalizedNames);

  return {
    normalizedNames,
    request,
    nextPlatformToolsets,
  };
}

function toolGovernanceMessage(action, platformKey, names) {
  const label = names.join('、');
  if (action === 'promote-top-level') {
    return `已把 ${label} 补入顶层 toolsets。`;
  }
  if (action === 'enable') {
    return `${platformKey} 已接入 ${label}，并同步顶层 toolsets。`;
  }
  return `${platformKey} 已移出 ${label}，并按剩余平台绑定同步顶层 toolsets。`;
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
  if (!view.configDocs?.workspace) {
    notify('error', '结构化配置尚未加载完成，暂时不能直接治理工具能力。');
    return;
  }

  let mutation;
  try {
    mutation = applyToolConfigMutation(view.configDocs.workspace, action, platformKey, names);
  } catch (reason) {
    notify('error', String(reason));
    return;
  }

  const actionId = toolActionState(action, platformKey, mutation.normalizedNames);
  view.runningAction = actionId;
  renderPage(view);
  try {
    const nextConfigDocs = await api.saveStructuredConfig(mutation.request, view.profile);
    view.configDocs = nextConfigDocs;
    const message = toolGovernanceMessage(action, platformKey, mutation.normalizedNames);
    storeResult(view, options.label ?? `${platformKey} 工具治理`, {
      command: 'save_structured_config',
      exitCode: 0,
      success: true,
      stdout: [
        `action: ${action}`,
        `platform: ${platformKey}`,
        `tools: ${mutation.normalizedNames.join(', ')}`,
        `topLevelToolsets: ${nextConfigDocs.workspace.toolsets.join(', ') || '—'}`,
        `platformToolsets: ${mutation.nextPlatformToolsets.join(', ') || '—'}`,
      ].join('\n'),
      stderr: '',
    });
    if (options.clearInput) {
      view.toolNamesInput = '';
    }
    notify('success', message);
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

async function createLocalPlugin(view) {
  const draft = view.pluginCreateDraft ?? clonePluginCreateDraft();
  if (!draft.name.trim()) {
    notify('error', '请先填写插件名称。');
    return;
  }

  view.runningAction = 'plugin:create-local';
  renderPage(view);
  try {
    const result = await api.createPlugin({
      category: draft.category.trim(),
      description: draft.description.trim(),
      name: draft.name.trim(),
      overwrite: Boolean(draft.overwrite),
    }, view.profile);
    view.lastCreatedPlugin = result;
    view.pluginNameInput = result.created.name;
    storeResult(view, `新建插件 · ${result.created.name}`, {
      command: 'local://plugins/create',
      exitCode: 0,
      stderr: '',
      stdout: `target: ${result.targetDirectory}\nfiles: ${result.createdFiles}\ncategory: ${result.created.category}`,
      success: true,
    });
    notify('success', `${result.created.name} 已在当前 profile 下创建完成。`);
    view.pluginCreateDraft = clonePluginCreateDraft({
      category: result.created.category,
    });
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncPluginManifestTarget(view, state) {
  const focus = resolvePluginGovernanceTarget(view, state);
  const manifestPath = manifestPathForFocus(focus);

  if (view.pluginManifestTarget === manifestPath) {
    return manifestPath;
  }

  view.pluginManifest = null;
  view.pluginManifestDraft = null;
  view.pluginManifestError = null;
  view.pluginManifestLoading = false;
  view.pluginManifestTarget = manifestPath;
  return manifestPath;
}

function syncPluginReadmeTarget(view, state) {
  const focus = resolvePluginGovernanceTarget(view, state);
  const directoryPath = readmeTargetPathForFocus(focus);

  if (view.pluginReadmeTarget === directoryPath) {
    return directoryPath;
  }

  view.pluginReadme = null;
  view.pluginReadmeDraft = null;
  view.pluginReadmeError = null;
  view.pluginReadmeLoading = false;
  view.pluginReadmeTarget = directoryPath;
  return directoryPath;
}

async function ensurePluginManifestLoaded(view) {
  if (view.workbenchTab !== 'plugins' || !view.extensions) {
    return;
  }

  const state = derivedState(view);
  const manifestPath = syncPluginManifestTarget(view, state);
  if (!manifestPath || view.pluginManifest || view.pluginManifestLoading) {
    return;
  }

  const profile = view.profile;
  view.pluginManifestLoading = true;
  renderPage(view);

  try {
    const detail = await api.readPluginManifest(manifestPath, profile);
    if (view.destroyed || profile !== view.profile || view.pluginManifestTarget !== manifestPath) {
      return;
    }

    view.pluginManifest = detail;
    view.pluginManifestDraft = createPluginManifestDraft(detail);
    view.pluginManifestError = null;
  } catch (reason) {
    if (view.destroyed || profile !== view.profile || view.pluginManifestTarget !== manifestPath) {
      return;
    }
    view.pluginManifestError = String(reason);
  } finally {
    if (view.destroyed || profile !== view.profile || view.pluginManifestTarget !== manifestPath) {
      return;
    }
    view.pluginManifestLoading = false;
    renderPage(view);
  }
}

async function ensurePluginReadmeLoaded(view) {
  if (view.workbenchTab !== 'plugins' || !view.extensions) {
    return;
  }

  const state = derivedState(view);
  const directoryPath = syncPluginReadmeTarget(view, state);
  if (!directoryPath || view.pluginReadme || view.pluginReadmeLoading) {
    return;
  }

  const profile = view.profile;
  view.pluginReadmeLoading = true;
  renderPage(view);

  try {
    const detail = await api.readPluginReadme(directoryPath, profile);
    if (view.destroyed || profile !== view.profile || view.pluginReadmeTarget !== directoryPath) {
      return;
    }

    view.pluginReadme = detail;
    view.pluginReadmeDraft = createPluginReadmeDraft(detail);
    view.pluginReadmeError = null;
  } catch (reason) {
    if (view.destroyed || profile !== view.profile || view.pluginReadmeTarget !== directoryPath) {
      return;
    }
    view.pluginReadmeError = String(reason);
  } finally {
    if (view.destroyed || profile !== view.profile || view.pluginReadmeTarget !== directoryPath) {
      return;
    }
    view.pluginReadmeLoading = false;
    renderPage(view);
  }
}

async function savePluginManifest(view) {
  const draft = view.pluginManifestDraft;
  if (!draft?.manifestPath) {
    notify('error', '当前还没有可保存的本地 plugin.yaml。');
    return;
  }
  if (!draft.name.trim()) {
    notify('error', '插件名称不能为空。');
    return;
  }

  view.runningAction = 'plugin:save-manifest';
  renderPage(view);

  try {
    const result = await api.savePluginManifest({
      description: draft.description.trim(),
      externalDependencies: parsePluginExternalDependencies(draft.externalDependenciesText),
      manifestPath: draft.manifestPath,
      name: draft.name.trim(),
      pipDependencies: parsePluginManifestList(draft.pipDependenciesText),
      requiresEnv: parsePluginManifestList(draft.requiresEnvText),
    }, view.profile);

    view.pluginManifest = result;
    view.pluginManifestDraft = createPluginManifestDraft(result);
    view.pluginManifestError = null;
    view.pluginNameInput = result.name;

    storeResult(view, `保存 manifest · ${result.name}`, {
      command: 'local://plugins/manifest/save',
      exitCode: 0,
      stderr: '',
      stdout: `manifest: ${result.manifestPath}\nrelative: ${result.relativePath}`,
      success: true,
    });
    notify('success', `${result.name} 的 plugin.yaml 已保存。`);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function resetPluginManifestDraft(view) {
  if (!view.pluginManifest) {
    return;
  }
  view.pluginManifestDraft = createPluginManifestDraft(view.pluginManifest);
  renderPage(view);
}

async function savePluginReadme(view) {
  const draft = view.pluginReadmeDraft;
  if (!draft?.filePath) {
    notify('error', '当前还没有可保存的本地 README。');
    return;
  }

  view.runningAction = 'plugin:save-readme';
  renderPage(view);

  try {
    const result = await api.savePluginReadme({
      filePath: draft.filePath,
      content: draft.content,
    }, view.profile);

    view.pluginReadme = result;
    view.pluginReadmeDraft = createPluginReadmeDraft(result);
    view.pluginReadmeError = null;
    storeResult(view, `保存 README · ${result.name}`, {
      command: 'local://plugins/readme/save',
      exitCode: 0,
      stderr: '',
      stdout: `readme: ${result.filePath}\nrelative: ${result.relativePath}`,
      success: true,
    });
    notify('success', `${result.name} 的 README 已保存。`);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function resetPluginReadmeDraft(view) {
  if (!view.pluginReadme) {
    return;
  }
  view.pluginReadmeDraft = createPluginReadmeDraft(view.pluginReadme);
  renderPage(view);
}

async function deleteLocalPlugin(view) {
  const state = derivedState(view);
  const focus = resolvePluginGovernanceTarget(view, state);
  if (!focus.catalogItem?.directoryPath || !focus.name) {
    notify('error', '当前没有可删除的本地插件目录。');
    return;
  }
  if (focus.installed) {
    notify('error', '当前插件仍在运行态内，先移除运行态插件，再删除本地目录。');
    return;
  }

  if (!window.confirm(`确定删除本地插件目录 ${focus.name} 吗？此操作会移除当前目录下的 manifest、README 和附属文件。`)) {
    return;
  }

  view.runningAction = 'plugin:delete-local';
  renderPage(view);

  try {
    const result = await api.deleteLocalPlugin({
      directoryPath: focus.catalogItem.directoryPath,
      name: focus.name,
    }, view.profile);

    storeResult(view, `删除本地插件 · ${result.name}`, {
      command: 'local://plugins/delete',
      exitCode: 0,
      stderr: '',
      stdout: `directory: ${result.directoryPath}\nremovedFiles: ${result.removedFiles}`,
      success: true,
    });
    notify('success', `${result.name} 的本地目录已删除，共移除 ${result.removedFiles} 个文件。`);

    view.pluginNameInput = '';
    view.pluginManifest = null;
    view.pluginManifestDraft = null;
    view.pluginManifestError = null;
    view.pluginManifestTarget = '';
    view.pluginReadme = null;
    view.pluginReadmeDraft = null;
    view.pluginReadmeError = null;
    view.pluginReadmeTarget = '';
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
    view.lastCreatedPlugin = null;
    view.lastImportedPlugin = null;
    view.pluginManifest = null;
    view.pluginManifestDraft = null;
    view.pluginManifestError = null;
    view.pluginManifestLoading = false;
    view.pluginManifestTarget = '';
    view.pluginReadme = null;
    view.pluginReadmeDraft = null;
    view.pluginReadmeError = null;
    view.pluginReadmeLoading = false;
    view.pluginReadmeTarget = '';
    view.pluginCreateDraft = clonePluginCreateDraft();
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
  const pluginCreateName = view.page.querySelector('#extensions-plugin-create-name');
  const pluginCreateCategory = view.page.querySelector('#extensions-plugin-create-category');
  const pluginCreateDescription = view.page.querySelector('#extensions-plugin-create-description');
  const pluginCreateOverwrite = view.page.querySelector('#extensions-plugin-create-overwrite');
  const pluginManifestDisclosure = view.page.querySelector('#extensions-plugin-manifest-disclosure');
  const pluginManifestName = view.page.querySelector('#extensions-plugin-manifest-name');
  const pluginManifestDescription = view.page.querySelector('#extensions-plugin-manifest-description');
  const pluginManifestEnv = view.page.querySelector('#extensions-plugin-manifest-env');
  const pluginManifestPip = view.page.querySelector('#extensions-plugin-manifest-pip');
  const pluginManifestExternal = view.page.querySelector('#extensions-plugin-manifest-external');
  const pluginReadmeDisclosure = view.page.querySelector('#extensions-plugin-readme-disclosure');
  const pluginReadmeEditor = view.page.querySelector('#extensions-plugin-readme-editor');
  const pluginLocalOpsDisclosure = view.page.querySelector('#extensions-plugin-localops-disclosure');
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
    const pluginCreate = view.page.querySelector('[data-action="plugin-create-local"]');
    const pluginManifestSave = view.page.querySelector('[data-action="plugin-manifest-save"]');
    const pluginReadmeSave = view.page.querySelector('[data-action="plugin-readme-save"]');

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
    if (pluginCreate) {
      pluginCreate.disabled = Boolean(view.runningAction) || !view.pluginCreateDraft?.name?.trim();
    }
    if (pluginManifestSave) {
      pluginManifestSave.disabled = Boolean(view.runningAction) || !view.pluginManifestDraft?.name?.trim();
    }
    if (pluginReadmeSave) {
      pluginReadmeSave.disabled = Boolean(view.runningAction) || !view.pluginReadmeDraft?.filePath;
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

  if (pluginCreateName) {
    pluginCreateName.oninput = (event) => {
      view.pluginCreateDraft.name = event.target.value;
      syncInlineControls();
    };
  }

  if (pluginCreateCategory) {
    pluginCreateCategory.oninput = (event) => {
      view.pluginCreateDraft.category = event.target.value;
    };
  }

  if (pluginCreateDescription) {
    pluginCreateDescription.oninput = (event) => {
      view.pluginCreateDraft.description = event.target.value;
    };
  }

  if (pluginCreateOverwrite) {
    pluginCreateOverwrite.onchange = (event) => {
      view.pluginCreateDraft.overwrite = Boolean(event.target.checked);
    };
  }

  if (pluginManifestDisclosure) {
    pluginManifestDisclosure.ontoggle = () => {
      view.pluginManifestExpanded = pluginManifestDisclosure.open;
    };
  }

  if (pluginManifestName) {
    pluginManifestName.oninput = (event) => {
      if (!view.pluginManifestDraft) {
        return;
      }
      view.pluginManifestDraft.name = event.target.value;
      syncInlineControls();
    };
  }

  if (pluginManifestDescription) {
    pluginManifestDescription.oninput = (event) => {
      if (!view.pluginManifestDraft) {
        return;
      }
      view.pluginManifestDraft.description = event.target.value;
    };
  }

  if (pluginManifestEnv) {
    pluginManifestEnv.oninput = (event) => {
      if (!view.pluginManifestDraft) {
        return;
      }
      view.pluginManifestDraft.requiresEnvText = event.target.value;
    };
  }

  if (pluginManifestPip) {
    pluginManifestPip.oninput = (event) => {
      if (!view.pluginManifestDraft) {
        return;
      }
      view.pluginManifestDraft.pipDependenciesText = event.target.value;
    };
  }

  if (pluginManifestExternal) {
    pluginManifestExternal.oninput = (event) => {
      if (!view.pluginManifestDraft) {
        return;
      }
      view.pluginManifestDraft.externalDependenciesText = event.target.value;
    };
  }

  if (pluginReadmeDisclosure) {
    pluginReadmeDisclosure.ontoggle = () => {
      view.pluginReadmeExpanded = pluginReadmeDisclosure.open;
    };
  }

  if (pluginLocalOpsDisclosure) {
    pluginLocalOpsDisclosure.ontoggle = () => {
      view.pluginLocalOpsExpanded = pluginLocalOpsDisclosure.open;
    };
  }

  if (pluginReadmeEditor) {
    pluginReadmeEditor.oninput = (event) => {
      if (!view.pluginReadmeDraft) {
        return;
      }
      view.pluginReadmeDraft.content = event.target.value;
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
        case 'plugin-create-local':
          await createLocalPlugin(view);
          return;
        case 'plugin-create-reset':
          view.pluginCreateDraft = clonePluginCreateDraft();
          renderPage(view);
          return;
        case 'plugin-manifest-save':
          await savePluginManifest(view);
          return;
        case 'plugin-manifest-reset':
          resetPluginManifestDraft(view);
          return;
        case 'plugin-readme-save':
          await savePluginReadme(view);
          return;
        case 'plugin-readme-reset':
          resetPluginReadmeDraft(view);
          return;
        case 'plugin-delete-local':
          await deleteLocalPlugin(view);
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
                label: `${currentState.currentPlatform.displayName} 批量接入`,
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
                label: `${currentState.currentPlatform.displayName} 批量移出`,
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
        case 'tool-promote-top-level':
          {
            const currentState = derivedState(view);
            if (currentState.currentPlatform) {
              await executeToolAction(view, 'promote-top-level', currentState.currentPlatform.platformKey, [element.getAttribute('data-name') || '']);
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
    lastCreatedPlugin: null,
    lastImportedPlugin: null,
    lastResult: null,
    loading: true,
    page,
    pluginFilter: 'all',
    pluginCreateDraft: clonePluginCreateDraft(),
    pluginImportDraft: clonePluginImportDraft(),
    pluginManifest: null,
    pluginManifestDraft: null,
    pluginManifestError: null,
    pluginManifestExpanded: true,
    pluginManifestLoading: false,
    pluginManifestTarget: '',
    pluginReadme: null,
    pluginReadmeDraft: null,
    pluginReadmeError: null,
    pluginReadmeExpanded: false,
    pluginReadmeLoading: false,
    pluginReadmeTarget: '',
    pluginLocalOpsExpanded: false,
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
