import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { getPanelState, getPageIntent, consumePageIntent, loadShell, navigate, notify, subscribePanelState } from '../lib/panel-state';
import { truncate } from '../lib/format';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';

let activeView = null;

function countCategories(items) {
  const counts = new Map();
  items.forEach((item) => {
    const key = item.category || 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function normalizeToolNames(value) {
  const seen = new Set();
  const result = [];
  value.split(/[,\n，；;]/).forEach((item) => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function matchingPlatformSummary(extensions, platformKey) {
  return extensions.toolPlatforms.find((item) => item.name.trim().toLowerCase() === platformKey.trim().toLowerCase());
}

function inventoryMetrics(platform) {
  if (!platform) {
    return { enabled: 0, total: 0 };
  }
  return {
    enabled: platform.items.filter((item) => item.enabled).length,
    total: platform.items.length,
  };
}

function toolActionState(action, platformKey, names) {
  return `tool:${action}:${platformKey}:${names.join(',')}`;
}

function pluginActionState(action, name) {
  return `plugin:${action}:${name.trim()}`;
}

function providerActionState(mode, providerName) {
  return `provider:${mode}:${providerName.trim() || 'builtin-file'}`;
}

function uniqueValues(items) {
  return Array.from(new Set((items ?? []).map((item) => String(item ?? '').trim()).filter(Boolean)));
}

function cloneConfigWorkspace(workspace = {}) {
  return {
    ...workspace,
    toolsets: [...(workspace.toolsets ?? [])],
    platformToolsets: (workspace.platformToolsets ?? []).map((item) => ({
      ...item,
      toolsets: [...(item.toolsets ?? [])],
    })),
    skillsExternalDirs: [...(workspace.skillsExternalDirs ?? [])],
  };
}

function normalizeLookupValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[_\s]+/g, '-');
}

function lookupVariants(value) {
  const raw = String(value ?? '').trim();
  const variants = new Set();

  [raw, ...raw.split(/[/:]/)].forEach((item) => {
    const normalized = normalizeLookupValue(item);
    if (!normalized) {
      return;
    }
    variants.add(normalized);
    variants.add(normalized.replace(/^hermes-/, ''));
    variants.add(normalized.replace(/-plugin$/, ''));
  });

  return Array.from(variants).filter(Boolean);
}

function sameLookupTarget(left, right) {
  const leftVariants = lookupVariants(left);
  const rightVariants = lookupVariants(right);
  return leftVariants.some((item) => rightVariants.includes(item));
}

function pluginMatchesProvider(pluginName, providerName) {
  const pluginVariants = lookupVariants(pluginName);
  const providerVariants = lookupVariants(providerName);
  return pluginVariants.some((plugin) => providerVariants.some((provider) => (
    plugin === provider
    || plugin.endsWith(`-${provider}`)
    || provider.endsWith(`-${plugin}`)
  )));
}

function runtimeLooksBuiltinOnly(providerName) {
  const normalized = String(providerName ?? '').trim().toLowerCase();
  return normalized.includes('built-in') || normalized.includes('builtin') || normalized.includes('(none');
}

function providerButtonLabel(option) {
  if (option.selected) {
    return option.mode === 'off' ? '当前已关闭' : '当前配置';
  }
  if (option.mode === 'off') {
    return '关闭记忆';
  }
  if (option.mode === 'builtin') {
    return '切回 Builtin';
  }
  return '设为 Provider';
}

function providerTone(option) {
  if (option.selected && option.runtimeActive) {
    return 'good';
  }
  if (option.selected || option.runtimeActive) {
    return 'warn';
  }
  return 'neutral';
}

function providerCopy(option) {
  if (option.mode === 'off') {
    return '把 memory 和 user profile 一起关闭，适合临时排障或极简会话。';
  }
  if (option.mode === 'builtin') {
    return '回退到 Hermes 内置文件记忆，最稳妥，也最适合桌面端默认闭环。';
  }
  return option.availability
    ? `${option.availability}，可直接写回为默认 provider。`
    : '运行态已检测到该 provider，可直接接管到配置里。';
}

function buildProviderOptions(view, pluginCatalog) {
  const workspace = view.configDocs?.workspace ?? {};
  const memoryEnabled = workspace.memoryEnabled ?? view.dashboard?.config?.memoryEnabled ?? false;
  const configuredProvider = String(workspace.memoryProvider ?? view.dashboard?.config?.memoryProvider ?? '').trim();
  const runtimeProvider = view.extensions?.memoryRuntime?.provider ?? '';
  const runtimeInstalled = view.extensions?.memoryRuntime?.installedPlugins ?? [];
  const installedCatalog = (pluginCatalog ?? []).filter((item) => item.installed);
  const options = [];

  options.push({
    availability: '关闭',
    dependencyCount: 0,
    key: 'provider:off',
    label: '关闭记忆',
    matchedPluginName: '',
    mode: 'off',
    providerName: '',
    requiresEnv: [],
    runtimeActive: !memoryEnabled && runtimeLooksBuiltinOnly(runtimeProvider),
    selected: !memoryEnabled,
  });

  options.push({
    availability: '内置',
    dependencyCount: 0,
    key: 'provider:builtin',
    label: 'Builtin File',
    matchedPluginName: '',
    mode: 'builtin',
    providerName: '',
    requiresEnv: [],
    runtimeActive: runtimeLooksBuiltinOnly(runtimeProvider),
    selected: memoryEnabled && !configuredProvider,
  });

  const seen = new Set();
  runtimeInstalled.forEach((item) => {
    const key = normalizeLookupValue(item.name);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    const matchedPlugin = installedCatalog.find((plugin) => pluginMatchesProvider(plugin.name, item.name));
    options.push({
      availability: item.availability || '已检测',
      dependencyCount: (matchedPlugin?.pipDependencies.length ?? 0) + (matchedPlugin?.externalDependencies.length ?? 0),
      key: `provider:${item.name}`,
      label: item.name,
      matchedPluginName: matchedPlugin?.name || '',
      mode: 'plugin',
      providerName: item.name,
      requiresEnv: matchedPlugin?.requiresEnv ?? [],
      runtimeActive: sameLookupTarget(runtimeProvider, item.name),
      selected: memoryEnabled && sameLookupTarget(configuredProvider, item.name),
    });
  });

  return options;
}

function providerOptionForPlugin(state, pluginName) {
  return (state.providerOptions ?? []).find((item) => item.mode === 'plugin' && pluginMatchesProvider(pluginName, item.providerName)) ?? null;
}

function pluginDependencySummary(item) {
  const parts = [];
  if (item.pipDependencies.length > 0) {
    parts.push(`pip ${item.pipDependencies.join(', ')}`);
  }
  if (item.externalDependencies.length > 0) {
    parts.push(`bin ${item.externalDependencies.map((dependency) => dependency.name).join(', ')}`);
  }
  return parts.join(' · ') || '无';
}

function primaryInvestigationTool(investigation) {
  return investigation?.context?.toolNames.find((item) => item.trim().length > 0) ?? '';
}

function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'extensions',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'extensions',
        headline: '来自扩展能力台的链路下钻',
        description: '继续围绕 tools、skills、plugins 和 memory provider 做核对。',
      };
}

function derivedState(view) {
  const extensions = view.extensions;
  const dashboard = view.dashboard;
  const configDocs = view.configDocs;
  const installation = view.installation;
  const skills = view.skills;
  const runtimeSkills = extensions?.runtimeSkills ?? [];
  const pluginCatalog = extensions?.pluginCatalog ?? [];
  const installedCatalog = pluginCatalog.filter((item) => item.installed);
  const pluginQuery = view.pluginQuery.trim().toLowerCase();
  const pluginFilter = view.pluginFilter || 'all';
  const toolsEnabled = extensions?.toolPlatforms.reduce((sum, item) => sum + item.enabledCount, 0) ?? 0;
  const toolsTotal = extensions?.toolPlatforms.reduce((sum, item) => sum + item.totalCount, 0) ?? 0;
  const toollessPlatforms = extensions?.toolPlatforms.filter((item) => item.enabledCount === 0) ?? [];
  const sourceLocalCount = extensions?.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
  const sourceBuiltinCount = extensions?.skillSourceCounts.find((item) => item.name === 'builtin')?.count ?? 0;
  const runtimeSkillMismatch = sourceLocalCount !== skills.length;
  const sourceOptions = ['all', ...Array.from(new Set(runtimeSkills.map((item) => item.source).filter(Boolean))).sort()];
  const categoryCounts = countCategories(runtimeSkills);
  const currentPlatform = extensions?.toolInventory.find((item) => item.platformKey === view.selectedPlatform)
    ?? extensions?.toolInventory[0]
    ?? null;
  const batchToolNames = normalizeToolNames(view.toolNamesInput);
  const providerOptions = buildProviderOptions(view, pluginCatalog);
  const configuredProviderDisplay = !configDocs?.workspace?.memoryEnabled
    ? 'off'
    : (configDocs?.workspace?.memoryProvider || 'builtin-file');
  const providerAligned = providerOptions.some((item) => item.selected && item.runtimeActive);
  const filteredPluginCatalog = pluginCatalog.filter((item) => {
    if (pluginFilter === 'installed' && !item.installed) {
      return false;
    }
    if (pluginFilter === 'requires-env' && item.requiresEnv.length === 0) {
      return false;
    }
    if (pluginFilter === 'dependencies' && item.externalDependencies.length === 0 && item.pipDependencies.length === 0) {
      return false;
    }
    if (!pluginQuery) {
      return true;
    }
    return [
      item.name,
      item.category,
      item.description,
      item.requiresEnv.join(' '),
      item.pipDependencies.join(' '),
      item.externalDependencies.map((dependency) => `${dependency.name} ${dependency.check || ''} ${dependency.install || ''}`).join(' '),
    ]
      .join(' ')
      .toLowerCase()
      .includes(pluginQuery);
  });
  const filteredRuntimePlugins = (extensions?.plugins.items ?? []).filter((item) => {
    if (pluginFilter === 'requires-env' || pluginFilter === 'dependencies') {
      return false;
    }
    if (pluginFilter === 'installed') {
      return true;
    }
    if (!pluginQuery) {
      return true;
    }
    return item.toLowerCase().includes(pluginQuery);
  });
  const filteredSkills = runtimeSkills.filter((item) => {
    const term = view.query.trim().toLowerCase();
    if (view.sourceFilter !== 'all' && item.source !== view.sourceFilter) {
      return false;
    }
    if (!term) {
      return true;
    }
    return [item.name, item.category, item.source, item.trust]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
  const warnings = [];

  if (!installation?.binaryFound) {
    warnings.push('当前没有检测到 Hermes CLI，扩展安装、技能配置和 memory provider 切换都无法真正执行。');
  }
  if (!extensions?.toolPlatforms.length) {
    warnings.push('当前没有解析出任何 tools 平台摘要，Hermes 工具面摘要没有成功返回。');
  }
  if (toollessPlatforms.length > 0) {
    warnings.push(`存在 ${toollessPlatforms.length} 个平台当前没有启用任何工具：${toollessPlatforms.map((item) => item.name).join('、')}。`);
  }
  if ((extensions?.plugins.installedCount ?? 0) === 0) {
    warnings.push('当前没有通过 `hermes plugins list` 检测到已安装插件，扩展层仍以 builtin 和 local skills 为主。');
  }
  if ((extensions?.plugins.installedCount ?? 0) > 0 && pluginCatalog.length === 0) {
    warnings.push('插件运行态已检测到安装结果，但本地 plugin 目录还没扫描到 manifest，目录态信息不完整。');
  }
  if (configDocs?.workspace?.memoryEnabled && !(configDocs.workspace.toolsets ?? []).includes('memory')) {
    warnings.push('Memory 已开启，但顶层 toolsets 里没有 memory，建议顺手补齐，避免能力暴露不稳定。');
  }
  if (providerOptions.length > 0 && !providerAligned) {
    warnings.push(`当前配置 provider 为「${configuredProviderDisplay}」，运行态回报为「${extensions?.memoryRuntime.provider || 'unknown'}」。`);
  }
  if (runtimeSkillMismatch) {
    warnings.push(`CLI skills list 识别到 ${sourceLocalCount} 个 local 技能，而本地目录扫描到 ${skills.length} 个，说明安装态和文件态存在差异。`);
  }
  if (dashboard?.gateway?.gatewayState !== 'running' && (dashboard?.counts.cronJobs ?? 0) > 0) {
    warnings.push('当前 Gateway 未运行，如果 cron 作业里有远端交付目标，扩展能力没法在消息平台侧真正闭环验证。');
  }

  const rawOutput = view.rawKind === 'tools'
    ? extensions?.toolsRawOutput
    : view.rawKind === 'memory'
      ? extensions?.memoryRuntime.rawOutput
      : view.rawKind === 'plugins'
        ? extensions?.plugins.rawOutput
        : extensions?.skillsRawOutput;

  const currentPlatformSummary = currentPlatform ? matchingPlatformSummary(extensions, currentPlatform.platformKey) : null;
  const currentPlatformMetrics = inventoryMetrics(currentPlatform);
  const seed = relaySeed(view);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    description: '继续把当前工具、插件或 provider 线索带到日志页核对。',
    logName: 'agent',
    contains: batchToolNames[0] || primaryInvestigationTool(view.investigation) || view.query || currentPlatform?.platformKey || '',
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    description: '继续做扩展层体检，确认 tools、skills、plugins 和 memory provider 是否一致。',
    suggestedCommand: batchToolNames.length > 0 || primaryInvestigationTool(view.investigation) ? 'tools-summary' : 'plugins-list',
    logName: 'agent',
  });
  const configIntent = buildConfigDrilldownIntent(seed, {
    description: '带着当前扩展线索回到配置中心，核对 toolsets、context engine 与 memory provider。',
    focus: currentPlatform ? 'toolsets' : 'memory',
    suggestedCommand: 'config-check',
  });

  return {
    batchToolNames,
    categoryCounts,
    configIntent,
    configuredProviderDisplay,
    currentPlatform,
    currentPlatformMetrics,
    currentPlatformSummary,
    diagnosticsIntent,
    filteredSkills,
    filteredPluginCatalog,
    filteredRuntimePlugins,
    logsIntent,
    pluginAvailableCount: pluginCatalog.length,
    pluginCatalog,
    pluginDependencyCount: pluginCatalog.filter((item) => item.externalDependencies.length > 0 || item.pipDependencies.length > 0).length,
    pluginEnvRequiredCount: pluginCatalog.filter((item) => item.requiresEnv.length > 0).length,
    pluginInstalledCount: Math.max(installedCatalog.length, extensions?.plugins.installedCount ?? 0),
    providerAligned,
    providerOptions,
    rawOutput,
    runtimeSkillMismatch,
    runtimeSkills,
    sourceBuiltinCount,
    sourceLocalCount,
    sourceOptions,
    toolsEnabled,
    toolsTotal,
    warnings,
  };
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">扩展能力台</h1>
      </div>
      <p class="page-desc">正在同步 Hermes 运行时工具面、插件层、技能来源和记忆 provider。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:124px"></div>').join('')}
    </div>
  `;
}

function renderToolCards(view, state) {
  if (!state.currentPlatform) {
    return emptyStateHtml('暂无平台清单', '`hermes tools list --platform <platform>` 还没有返回可治理的平台内容。');
  }

  if (!state.currentPlatform.items.length) {
    return emptyStateHtml('平台下暂无工具', '当前平台没有从 `hermes tools list` 解析到可治理项。');
  }

  return `
    <div class="list-stack">
      ${state.currentPlatform.items.map((item) => {
        const enableActionId = toolActionState('enable', state.currentPlatform.platformKey, [item.name]);
        const disableActionId = toolActionState('disable', state.currentPlatform.platformKey, [item.name]);
        return `
          <div class="list-card">
            <div class="list-card-title">
              <strong>${escapeHtml(item.name)}</strong>
              <div class="pill-row">
                ${pillHtml(item.enabled ? 'enabled' : 'disabled', item.enabled ? 'good' : 'warn')}
                ${item.description ? pillHtml(truncate(item.description, 40), 'neutral') : ''}
              </div>
            </div>
            <p>${escapeHtml(item.description || 'CLI 没有返回额外描述。')}</p>
            <div class="toolbar">
              ${buttonHtml({
                action: 'tool-enable',
                label: view.runningAction === enableActionId ? '启用中…' : '启用',
                kind: 'primary',
                disabled: Boolean(view.runningAction) || item.enabled,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'tool-disable',
                label: view.runningAction === disableActionId ? '停用中…' : '停用',
                disabled: Boolean(view.runningAction) || !item.enabled,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'tool-logs',
                label: '查看日志',
                attrs: { 'data-name': item.name },
              })}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPluginCards(view, state) {
  if (!state.pluginCatalog.length && !view.extensions?.plugins.items.length) {
    return emptyStateHtml('尚未发现插件目录', '当前还没有扫描到可治理的 plugin manifest。你仍然可以在上方输入 owner/repo 或插件名直接安装。');
  }

  if (!state.pluginCatalog.length) {
    if (!state.filteredRuntimePlugins.length) {
      return emptyStateHtml('当前筛选下没有插件', '换一个插件关键词，或者切回“全部插件 / 已安装”继续查看。');
    }

    return `
      <div class="list-stack">
        ${state.filteredRuntimePlugins.map((item) => {
          const enableActionId = pluginActionState('enable', item);
          const disableActionId = pluginActionState('disable', item);
          const providerOption = providerOptionForPlugin(state, item);
          return `
            <div class="list-card">
              <div class="list-card-title">
                <strong>${escapeHtml(item)}</strong>
                <div class="pill-row">
                  ${pillHtml('installed', 'good')}
                  ${providerOption ? pillHtml(providerOption.selected ? '当前 Provider' : '可设为 Provider', providerOption.selected ? 'good' : 'neutral') : ''}
                </div>
              </div>
              <p>当前只有运行态，没有 manifest 明细。这里仍然保留启停、更新、移除和 provider 接管。</p>
              <div class="toolbar top-gap">
                ${buttonHtml({
                  action: 'plugin-enable',
                  label: view.runningAction === enableActionId ? '启用中…' : '启用',
                  kind: 'primary',
                  disabled: Boolean(view.runningAction),
                  attrs: { 'data-name': item },
                })}
                ${buttonHtml({
                  action: 'plugin-disable',
                  label: view.runningAction === disableActionId ? '停用中…' : '停用',
                  disabled: Boolean(view.runningAction),
                  attrs: { 'data-name': item },
                })}
                ${buttonHtml({
                  action: 'plugin-update-card',
                  label: '更新',
                  disabled: Boolean(view.runningAction) || !view.installation.binaryFound,
                  attrs: { 'data-name': item },
                })}
                ${buttonHtml({
                  action: 'plugin-remove-card',
                  label: '移除',
                  kind: 'danger',
                  disabled: Boolean(view.runningAction) || !view.installation.binaryFound,
                  attrs: { 'data-name': item },
                })}
                ${buttonHtml({
                  action: 'plugin-fill',
                  label: '带入输入框',
                  attrs: { 'data-name': item },
                })}
                ${providerOption ? buttonHtml({
                  action: 'provider-apply',
                  label: providerButtonLabel(providerOption),
                  kind: providerOption.selected ? 'secondary' : 'primary',
                  disabled: Boolean(view.runningAction) || !view.configDocs || providerOption.selected,
                  attrs: {
                    'data-provider-mode': providerOption.mode,
                    'data-provider-name': providerOption.providerName,
                  },
                }) : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (!state.filteredPluginCatalog.length) {
    return emptyStateHtml('当前筛选下没有插件', '可以切回“全部插件”，或者换一个关键词继续筛。');
  }

  return `
    <div class="list-stack">
      ${state.filteredPluginCatalog.map((item) => {
        const installActionId = pluginActionState('install', item.name);
        const updateActionId = pluginActionState('update', item.name);
        const removeActionId = pluginActionState('remove', item.name);
        const enableActionId = pluginActionState('enable', item.name);
        const disableActionId = pluginActionState('disable', item.name);
        const providerOption = providerOptionForPlugin(state, item.name);
        const detailRows = [
          { label: 'ENV', value: item.requiresEnv.length ? truncate(item.requiresEnv.join(' · '), 52) : '无' },
          { label: '依赖', value: truncate(pluginDependencySummary(item), 58) },
          { label: '目录', value: truncate(item.relativePath || item.directoryPath || '—', 58) },
        ];
        return `
          <div class="list-card plugin-catalog-card">
            <div class="list-card-title">
              <strong>${escapeHtml(item.name)}</strong>
              <div class="pill-row">
                ${pillHtml(item.category || 'uncategorized', 'neutral')}
                ${pillHtml(item.installed ? 'installed' : 'available', item.installed ? 'good' : 'neutral')}
                ${item.requiresEnv.length ? pillHtml(`${item.requiresEnv.length} 个 ENV`, 'warn') : ''}
                ${providerOption ? pillHtml(providerOption.selected ? '当前 Provider' : '可设为 Provider', providerOption.selected ? 'good' : 'neutral') : ''}
              </div>
            </div>
            <p>${escapeHtml(truncate(item.description || '当前 manifest 没有提供额外说明。', 120))}</p>
            ${keyValueRowsHtml(detailRows)}
            <div class="toolbar top-gap">
              ${buttonHtml({
                action: 'plugin-install-card',
                label: view.runningAction === installActionId ? '安装中…' : '安装',
                kind: 'primary',
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound || item.installed,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'plugin-update-card',
                label: view.runningAction === updateActionId ? '更新中…' : '更新',
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !item.installed,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'plugin-remove-card',
                label: view.runningAction === removeActionId ? '移除中…' : '移除',
                kind: 'danger',
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !item.installed,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'plugin-enable',
                label: view.runningAction === enableActionId ? '启用中…' : '启用',
                kind: 'primary',
                disabled: Boolean(view.runningAction) || !item.installed,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'plugin-disable',
                label: view.runningAction === disableActionId ? '停用中…' : '停用',
                disabled: Boolean(view.runningAction) || !item.installed,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'plugin-configure',
                label: item.requiresEnv.length ? '配置凭证' : '查看配置',
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'plugin-fill',
                label: '带入输入框',
                attrs: { 'data-name': item.name },
              })}
              ${providerOption ? buttonHtml({
                action: 'provider-apply',
                label: providerButtonLabel(providerOption),
                kind: providerOption.selected ? 'secondary' : 'primary',
                disabled: Boolean(view.runningAction) || !view.configDocs || providerOption.selected,
                attrs: {
                  'data-provider-mode': providerOption.mode,
                  'data-provider-name': providerOption.providerName,
                },
              }) : ''}
              ${buttonHtml({
                action: 'plugin-open',
                label: '打开目录',
                attrs: { 'data-name': item.name, 'data-path': item.directoryPath },
              })}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderProviderPresetStrip(view, state) {
  if (!state.providerOptions.length) {
    return '';
  }

  return `
    <section class="preset-strip">
      <div class="preset-strip-header">
        <div class="panel-title-row">
          <strong>Provider 预设</strong>
          ${infoTipHtml('这里会直接写回 config.yaml 里的 memory 配置，用客户端接管大部分 provider 切换，不再依赖 hermes memory setup。')}
        </div>
        <div class="pill-row">
          ${pillHtml(state.configuredProviderDisplay, state.providerAligned ? 'good' : 'warn')}
          ${pillHtml(`可切换 ${state.providerOptions.filter((item) => item.mode === 'plugin').length} 个`, 'neutral')}
        </div>
      </div>
      <div class="preset-card-grid workspace-preset-grid">
        ${state.providerOptions.map((option) => `
          <section class="preset-card provider-preset-card${option.selected ? ' provider-preset-card-active' : ''}">
            <div class="preset-card-head">
              <div class="preset-card-heading">
                <strong>${escapeHtml(option.label)}</strong>
                <span class="preset-card-caption">${escapeHtml(providerCopy(option))}</span>
              </div>
              <div class="pill-row">
                ${pillHtml(option.availability, 'neutral')}
                ${pillHtml(option.selected ? '配置中' : option.runtimeActive ? '运行中' : '待接管', providerTone(option))}
              </div>
            </div>
            <div class="preset-card-foot">
              <code class="preset-inline-code">${escapeHtml(
                option.mode === 'plugin'
                  ? `plugin ${option.matchedPluginName || option.providerName}${option.requiresEnv.length ? ` · ENV ${option.requiresEnv.join(', ')}` : ''}${option.dependencyCount ? ` · deps ${option.dependencyCount}` : ''}`
                  : option.mode === 'builtin'
                    ? 'builtin-file · 无额外依赖'
                    : 'memory=false · user_profile=false'
              )}</code>
              <div class="toolbar">
                ${buttonHtml({
                  action: 'provider-apply',
                  label: providerButtonLabel(option),
                  kind: option.selected ? 'secondary' : option.mode === 'off' ? 'danger' : 'primary',
                  disabled: Boolean(view.runningAction) || !view.configDocs || option.selected,
                  attrs: {
                    'data-provider-mode': option.mode,
                    'data-provider-name': option.providerName,
                  },
                })}
                ${option.requiresEnv.length
                  ? buttonHtml({
                    action: 'provider-configure',
                    label: '补凭证',
                    attrs: { 'data-provider-name': option.matchedPluginName || option.providerName },
                  })
                  : buttonHtml({ action: 'goto-memory', label: '查看 Memory' })}
              </div>
            </div>
          </section>
        `).join('')}
      </div>
    </section>
  `;
}

function renderSkillCards(state) {
  if (!state.filteredSkills.length) {
    return emptyStateHtml('没有匹配技能', '当前筛选条件下没有匹配的运行时技能。');
  }

  return `
    <div class="list-stack">
      ${state.filteredSkills.slice(0, 18).map((item) => `
        <div class="list-card">
          <div class="list-card-title">
            <strong>${escapeHtml(item.name)}</strong>
            <div class="pill-row">
              ${pillHtml(item.category || 'uncategorized', 'neutral')}
              ${pillHtml(item.source, item.source === 'local' ? 'warn' : 'good')}
              ${pillHtml(item.trust, item.trust === 'local' ? 'warn' : 'neutral')}
            </div>
          </div>
          <p>${escapeHtml(`${item.category || 'uncategorized'} · source ${item.source} · trust ${item.trust}`)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

function renderWorkbenchTabs(view) {
  const tabs = [
    { key: 'tools', label: 'Tools' },
    { key: 'plugins', label: 'Plugins' },
    { key: 'skills', label: 'Skills' },
    { key: 'runtime', label: '运行态 / Raw' },
  ];

  return `
    <div class="tab-bar">
      ${tabs.map((tab) => `
        <button
          type="button"
          class="tab ${view.workbenchTab === tab.key ? 'active' : ''}"
          data-action="set-workbench-tab"
          data-tab="${escapeHtml(tab.key)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderWorkbenchRail(view, state) {
  if (view.workbenchTab === 'tools') {
    return `
      <div class="workspace-rail-header">
        <div>
          <strong>平台治理摘要</strong>
          <p class="workspace-main-copy">只保留当前平台的关键读数和常用下钻。</p>
        </div>
        ${pillHtml(state.currentPlatform ? state.currentPlatform.displayName : '未选择', state.currentPlatform ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>当前平台</span>
          <strong>${escapeHtml(state.currentPlatform?.displayName || '未解析')}</strong>
        </div>
        <div class="key-value-row">
          <span>Inventory</span>
          <strong>${escapeHtml(`${state.currentPlatformMetrics.enabled}/${state.currentPlatformMetrics.total}`)}</strong>
        </div>
        <div class="key-value-row">
          <span>Summary</span>
          <strong>${escapeHtml(state.currentPlatformSummary ? `${state.currentPlatformSummary.enabledCount}/${state.currentPlatformSummary.totalCount}` : '缺摘要')}</strong>
        </div>
      </div>
      ${state.warnings.length > 0
        ? `<div class="warning-stack top-gap">${state.warnings.slice(0, 2).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
        : '<p class="helper-text">当前平台没有明显结构性提醒，可以直接做启停与日志核对。</p>'}
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({ action: 'goto-config-toolsets', label: 'Toolsets 配置', kind: 'primary' })}
        ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
      </div>
    `;
  }

  if (view.workbenchTab === 'plugins') {
    return `
      <div class="workspace-rail-header">
        <div>
          <strong>插件接管摘要</strong>
          <p class="workspace-main-copy">安装、启停和 provider 切换都先在当前页闭环，配置中心退到次级位。</p>
        </div>
        ${pillHtml(`${state.pluginInstalledCount}/${state.pluginAvailableCount || state.pluginInstalledCount}`, state.pluginInstalledCount > 0 ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>已安装</span>
          <strong>${escapeHtml(String(state.pluginInstalledCount))}</strong>
        </div>
        <div class="key-value-row">
          <span>可治理目录</span>
          <strong>${escapeHtml(String(state.pluginAvailableCount || 0))}</strong>
        </div>
        <div class="key-value-row">
          <span>当前输入</span>
          <strong>${escapeHtml(view.pluginNameInput.trim() || '未填写')}</strong>
        </div>
        <div class="key-value-row">
          <span>筛选</span>
          <strong>${escapeHtml(view.pluginFilter === 'all' ? '全部插件' : view.pluginFilter === 'installed' ? '仅已装' : view.pluginFilter === 'requires-env' ? '需凭证' : '有依赖')}</strong>
        </div>
        <div class="key-value-row">
          <span>当前 Provider</span>
          <strong>${escapeHtml(state.configuredProviderDisplay)}</strong>
        </div>
        <div class="key-value-row">
          <span>可切换 Provider</span>
          <strong>${escapeHtml(String(state.providerOptions.filter((item) => item.mode === 'plugin').length))}</strong>
        </div>
      </div>
      <p class="helper-text">${escapeHtml(view.extensions.plugins.installHint || 'Provider 预设已经接管到客户端。只有缺少凭证时，才需要回配置中心补变量。')}</p>
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({
          action: 'provider-apply',
          label: state.configuredProviderDisplay === 'builtin-file' ? '当前 Builtin' : '切回 Builtin',
          kind: state.configuredProviderDisplay === 'builtin-file' ? 'secondary' : 'primary',
          disabled: Boolean(view.runningAction) || !view.configDocs || state.configuredProviderDisplay === 'builtin-file',
          attrs: { 'data-provider-mode': 'builtin', 'data-provider-name': '' },
        })}
        ${buttonHtml({ action: 'goto-config-credentials', label: '去配凭证' })}
        ${buttonHtml({ action: 'goto-memory', label: '查看 Memory' })}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-muted">
        ${buttonHtml({ action: 'goto-skills', label: '联动 Skills' })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
      </div>
    `;
  }

  if (view.workbenchTab === 'skills') {
    return `
      <div class="workspace-rail-header">
        <div>
          <strong>技能来源摘要</strong>
          <p class="workspace-main-copy">区分目录态、安装态和 source/trust，默认先走本页与 Skills 页闭环。</p>
        </div>
        ${pillHtml(`${state.runtimeSkills.length} 项`, state.runtimeSkills.length > 0 ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>Built-in / Local</span>
          <strong>${escapeHtml(`${state.sourceBuiltinCount} / ${state.sourceLocalCount}`)}</strong>
        </div>
        <div class="key-value-row">
          <span>目录 / 运行态</span>
          <strong>${escapeHtml(`${view.skills.length} / ${state.runtimeSkills.length}`)}</strong>
        </div>
        <div class="key-value-row">
          <span>筛选条件</span>
          <strong>${escapeHtml(view.sourceFilter === 'all' ? '全部来源' : view.sourceFilter)}</strong>
        </div>
        <div class="key-value-row">
          <span>Top 分类</span>
          <strong>${escapeHtml(state.categoryCounts.slice(0, 2).map((item) => `${item.name} ${item.count}`).join(' · ') || '—')}</strong>
        </div>
      </div>
      ${state.runtimeSkillMismatch
        ? `<div class="warning-stack top-gap"><div class="warning-item">${escapeHtml(`CLI local 技能 ${state.sourceLocalCount} 个，本地目录 ${view.skills.length} 个，安装态存在偏差。`)}</div></div>`
        : '<p class="helper-text">当前目录态和运行态没有明显偏差，可以继续按分类筛选。</p>'}
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({ action: 'goto-skills', label: '进入 Skills 页', kind: 'primary' })}
        ${buttonHtml({ action: 'goto-config-toolsets', label: '核对 Toolsets' })}
        ${buttonHtml({ action: 'goto-memory', label: '查看 Memory' })}
      </div>
      <div class="workspace-rail-toolbar workspace-rail-toolbar-muted">
        ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
      </div>
    `;
  }

  return `
    <div class="workspace-rail-header">
      <div>
        <strong>运行态闭环</strong>
        <p class="workspace-main-copy">这里集中看提醒、最近命令和原始 CLI 快照。</p>
      </div>
      ${pillHtml(state.warnings.length === 0 ? '稳定' : `${state.warnings.length} 条提醒`, state.warnings.length === 0 ? 'good' : 'warn')}
    </div>
    ${state.warnings.length > 0
      ? `<div class="warning-stack">${state.warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
      : emptyStateHtml('当前无明显结构性风险', 'Tools、plugins、skills 和 provider 暂未发现明显错位。')}
    <div class="workspace-rail-toolbar top-gap">
      ${buttonHtml({ action: 'goto-config', label: '核对配置页' })}
      ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
      ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
      ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) })}
    </div>
  `;
}

function renderToolsWorkbench(view, state, runningToolBatchEnable, runningToolBatchDisable) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>Tools 平台治理</strong>
            <p class="workspace-main-copy">按平台直接启停工具，优先在客户端完成能力面治理。</p>
          </div>
          <div class="toolbar">
            <select class="select-input" id="extensions-platform-select" ${!view.extensions.toolInventory.length || view.runningAction ? 'disabled' : ''}>
              ${view.extensions.toolInventory.map((item) => `
                <option value="${escapeHtml(item.platformKey)}" ${item.platformKey === (state.currentPlatform?.platformKey ?? '') ? 'selected' : ''}>
                  ${escapeHtml(item.displayName)}
                </option>
              `).join('')}
            </select>
            ${buttonHtml({ action: 'refresh', label: '刷新运行态', disabled: Boolean(view.runningAction) })}
          </div>
        </div>
        ${state.currentPlatform ? `
          <div class="form-grid">
            <label class="field-stack">
              <span>批量工具名称</span>
              <input class="search-input" id="extensions-tool-input" placeholder="web,browser,terminal" ${view.runningAction ? 'disabled' : ''}>
            </label>
            <label class="field-stack">
              <span>批量预览</span>
              <input class="search-input" id="extensions-tool-preview" readonly>
            </label>
          </div>
          <div class="toolbar">
            ${buttonHtml({
              action: 'tool-batch-enable',
              label: runningToolBatchEnable ? '批量启用中…' : '批量启用',
              kind: 'primary',
              disabled: Boolean(view.runningAction) || state.batchToolNames.length === 0,
            })}
            ${buttonHtml({
              action: 'tool-batch-disable',
              label: runningToolBatchDisable ? '批量停用中…' : '批量停用',
              disabled: Boolean(view.runningAction) || state.batchToolNames.length === 0,
            })}
            ${buttonHtml({ action: 'goto-config-toolsets', label: 'Toolsets 配置' })}
          </div>
          <p class="helper-text">当前平台：<code>${escapeHtml(state.currentPlatform.displayName)}</code>。模型最终能看到哪些工具，仍由配置中心的 toolsets / platform toolsets 决定。</p>
        ` : emptyStateHtml('暂无平台可治理', '当前还没有从 Hermes tools 解析出可操作的平台。')}
      </section>
      <section class="panel panel-nested">
        <div class="workspace-list-scroll">
          ${renderToolCards(view, state)}
        </div>
      </section>
    </div>
  `;
}

function renderPluginsWorkbench(view, state, runningPluginInstall, runningPluginUpdate, runningPluginRemove, runningPluginEnable, runningPluginDisable) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-summary-strip">
          <section class="summary-mini-card">
            <span class="summary-mini-label">已安装</span>
            <strong class="summary-mini-value">${escapeHtml(String(state.pluginInstalledCount))}</strong>
            <span class="summary-mini-meta">运行态已识别的插件</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">需凭证</span>
            <strong class="summary-mini-value">${escapeHtml(String(state.pluginEnvRequiredCount))}</strong>
            <span class="summary-mini-meta">manifest 声明了 requires_env</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">有依赖</span>
            <strong class="summary-mini-value">${escapeHtml(String(state.pluginDependencyCount))}</strong>
            <span class="summary-mini-meta">需要 pip 或外部依赖检查</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">Provider</span>
            <strong class="summary-mini-value">${escapeHtml(state.configuredProviderDisplay)}</strong>
            <span class="summary-mini-meta">${escapeHtml(`runtime ${view.extensions.memoryRuntime.provider}`)}</span>
          </section>
        </div>
        <div class="workspace-main-header">
          <div>
            <strong>插件治理</strong>
            <p class="workspace-main-copy">安装、启停、provider 接管和依赖核对都尽量留在客户端里做闭环。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-config-credentials', label: '凭证页' })}
            ${buttonHtml({ action: 'refresh', label: '刷新运行态', disabled: Boolean(view.runningAction) })}
          </div>
        </div>
        ${renderProviderPresetStrip(view, state)}
        <div class="form-grid">
          <label class="field-stack">
            <span>Plugin 名称</span>
            <input class="search-input" id="extensions-plugin-input" placeholder="owner/repo 或 plugin 名称" ${view.runningAction ? 'disabled' : ''}>
          </label>
          <label class="field-stack">
            <span>筛选关键词</span>
            <input class="search-input" id="extensions-plugin-search" placeholder="名称、描述、ENV、依赖" ${view.runningAction ? 'disabled' : ''}>
          </label>
          <label class="field-stack">
            <span>当前已安装 / 目录可见</span>
            <input class="search-input" id="extensions-plugin-installed" readonly>
          </label>
          <label class="field-stack">
            <span>当前筛选</span>
            <input class="search-input" id="extensions-plugin-filter-state" readonly>
          </label>
        </div>
        <div class="selection-chip-grid top-gap">
          ${buttonHtml({ action: 'set-plugin-filter', label: '全部插件', className: `selection-chip${view.pluginFilter === 'all' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'all' } })}
          ${buttonHtml({ action: 'set-plugin-filter', label: '仅已安装', className: `selection-chip${view.pluginFilter === 'installed' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'installed' } })}
          ${buttonHtml({ action: 'set-plugin-filter', label: '需要凭证', className: `selection-chip${view.pluginFilter === 'requires-env' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'requires-env' } })}
          ${buttonHtml({ action: 'set-plugin-filter', label: '包含依赖', className: `selection-chip${view.pluginFilter === 'dependencies' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'dependencies' } })}
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'plugin-install', label: runningPluginInstall ? '安装插件…' : '安装插件', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-update', label: runningPluginUpdate ? '更新插件…' : '更新插件', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-remove', label: runningPluginRemove ? '移除插件…' : '移除插件', kind: 'danger', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-enable-current', label: runningPluginEnable ? '启用插件中…' : '启用插件', disabled: Boolean(view.runningAction) || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-disable-current', label: runningPluginDisable ? '停用插件中…' : '停用插件', disabled: Boolean(view.runningAction) || !view.pluginNameInput.trim() })}
        </div>
        <div class="control-card-grid top-gap">
          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Runtime</p>
                <h3 class="action-card-title">当前对账</h3>
              </div>
              ${pillHtml(state.providerAligned ? '已对齐' : '待校对', state.providerAligned ? 'good' : 'warn')}
            </div>
            <p class="command-line">${escapeHtml(`config ${state.configuredProviderDisplay} · runtime ${view.extensions.memoryRuntime.provider} · gateway ${view.dashboard.gateway?.gatewayState || 'unknown'}`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-memory', label: '查看 Memory 文件' })}
              ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
              ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
            </div>
          </section>
          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Closed Loop</p>
                <h3 class="action-card-title">技能 / Toolsets 联动</h3>
              </div>
              ${pillHtml(state.runtimeSkillMismatch ? '安装态偏差' : '已对齐', state.runtimeSkillMismatch ? 'warn' : 'good')}
            </div>
            <p class="command-line">${escapeHtml(`local ${state.sourceLocalCount} · builtin ${state.sourceBuiltinCount} · toolsets ${(view.dashboard.config.toolsets ?? []).join(', ') || '—'}`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-skills', label: '进入 Skills 页', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-config-toolsets', label: '核对 Toolsets' })}
              ${buttonHtml({ action: 'goto-config-credentials', label: '补齐凭证' })}
            </div>
          </section>
        </div>
      </section>
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>插件目录</strong>
            <p class="workspace-main-copy">这里只保留筛选命中的插件，常用动作和 provider 接管都直接挂在卡片上。</p>
          </div>
          <div class="pill-row">
            ${pillHtml(`${state.filteredPluginCatalog.length || state.filteredRuntimePlugins.length} 项`, 'neutral')}
            ${view.pluginQuery.trim() ? pillHtml(`关键词 ${view.pluginQuery.trim()}`, 'warn') : ''}
          </div>
        </div>
        <div class="workspace-list-scroll">
          ${renderPluginCards(view, state)}
        </div>
      </section>
    </div>
  `;
}

function renderSkillsWorkbench(view, state) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-summary-strip">
          <section class="summary-mini-card">
            <span class="summary-mini-label">运行态技能</span>
            <strong class="summary-mini-value">${escapeHtml(String(state.runtimeSkills.length))}</strong>
            <span class="summary-mini-meta">source / trust 已被 Hermes 识别</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">Built-in / Local</span>
            <strong class="summary-mini-value">${escapeHtml(`${state.sourceBuiltinCount} / ${state.sourceLocalCount}`)}</strong>
            <span class="summary-mini-meta">和本地目录 ${view.skills.length} 个对照</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">Top 分类</span>
            <strong class="summary-mini-value">${escapeHtml(state.categoryCounts[0]?.name || '—')}</strong>
            <span class="summary-mini-meta">${escapeHtml(state.categoryCounts.slice(0, 2).map((item) => `${item.name} ${item.count}`).join(' · ') || '暂无分类')}</span>
          </section>
          <section class="summary-mini-card">
            <span class="summary-mini-label">筛选结果</span>
            <strong class="summary-mini-value">${escapeHtml(String(state.filteredSkills.length))}</strong>
            <span class="summary-mini-meta">${escapeHtml(view.sourceFilter === 'all' ? '全部来源' : view.sourceFilter)}${view.query.trim() ? ` · ${view.query.trim()}` : ''}</span>
          </section>
        </div>
        <div class="workspace-main-header">
          <div>
            <strong>技能安装态</strong>
            <p class="workspace-main-copy">这里专注运行态 source/trust，不再重复技能目录页的文件视图。</p>
          </div>
          <div class="toolbar">
            <input class="search-input" id="extensions-skill-search" placeholder="搜索技能名、分类、source、trust">
            <select class="select-input" id="extensions-source-filter">
              ${state.sourceOptions.map((item) => `
                <option value="${escapeHtml(item)}" ${item === view.sourceFilter ? 'selected' : ''}>
                  ${escapeHtml(item === 'all' ? '全部来源' : item)}
                </option>
              `).join('')}
            </select>
            ${buttonHtml({ action: 'apply-skill-filter', label: '应用筛选' })}
            ${buttonHtml({ action: 'goto-skills', label: '进入 Skills 页' })}
          </div>
        </div>
        <div class="control-card-grid">
          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Runtime</p>
                <h3 class="action-card-title">目录态与运行态</h3>
              </div>
              ${pillHtml(state.runtimeSkillMismatch ? '待校对' : '已对齐', state.runtimeSkillMismatch ? 'warn' : 'good')}
            </div>
            <p class="command-line">${escapeHtml(`目录 ${view.skills.length} · runtime local ${state.sourceLocalCount} · toolsets ${(view.dashboard.config.toolsets ?? []).join(', ') || '—'}`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-config-toolsets', label: '核对 Toolsets', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-skills', label: '打开 Skills 页' })}
              ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
            </div>
          </section>
          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">Memory</p>
                <h3 class="action-card-title">记忆与自动化闭环</h3>
              </div>
              ${pillHtml(view.dashboard.config.memoryEnabled ? 'Memory On' : 'Memory Off', view.dashboard.config.memoryEnabled ? 'good' : 'warn')}
            </div>
            <p class="command-line">${escapeHtml(`gateway ${view.dashboard.gateway?.gatewayState ?? 'unknown'} · cron ${view.dashboard.counts?.cronJobs ?? 0} · provider ${view.dashboard.config.memoryProvider || '—'}`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-config-memory', label: 'Memory 配置', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-memory', label: '查看 Memory 文件' })}
              ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
            </div>
          </section>
        </div>
        <div class="health-grid">
          <section class="health-card">
            <div class="health-card-header">
              <strong>Source</strong>
              ${pillHtml(`${view.extensions.skillSourceCounts.length} 类`, 'good')}
            </div>
            <p>${escapeHtml(view.extensions.skillSourceCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—')}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Trust</strong>
              ${pillHtml(`${view.extensions.skillTrustCounts.length} 类`, 'neutral')}
            </div>
            <p>${escapeHtml(view.extensions.skillTrustCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—')}</p>
          </section>
        </div>
      </section>
      <section class="panel panel-nested">
        <div class="workspace-list-scroll" id="extensions-skills-container">
          ${renderSkillCards(state)}
        </div>
      </section>
    </div>
  `;
}

function renderRuntimeWorkbench(view, state) {
  return `
    <div class="workspace-bottom-grid">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>最近命令回显</strong>
            <p class="workspace-main-copy">保留最新一次 Hermes 原始结果，不在客户端里再做二次解释。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行治理动作', '执行 tools / plugins / provider 相关动作后，这里会保留原始输出。')}
      </section>
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>原始 CLI 快照</strong>
            <p class="workspace-main-copy">在 tools / memory / plugins / skills 之间切换，对照结构化卡片和真实输出。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'raw-tools', label: 'Tools', kind: view.rawKind === 'tools' ? 'primary' : 'secondary' })}
            ${buttonHtml({ action: 'raw-memory', label: 'Memory', kind: view.rawKind === 'memory' ? 'primary' : 'secondary' })}
            ${buttonHtml({ action: 'raw-plugins', label: 'Plugins', kind: view.rawKind === 'plugins' ? 'primary' : 'secondary' })}
            ${buttonHtml({ action: 'raw-skills', label: 'Skills', kind: view.rawKind === 'skills' ? 'primary' : 'secondary' })}
          </div>
        </div>
        <pre class="code-block tall">${escapeHtml(state.rawOutput || '暂无输出')}</pre>
      </section>
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
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">扩展能力台</h1>
        </div>
        <p class="page-desc">围绕 tools、plugins、skills runtime 和 provider 做集中治理。</p>
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
  const runningPluginInstall = view.runningAction === pluginActionState('install', view.pluginNameInput);
  const runningPluginUpdate = view.runningAction === pluginActionState('update', view.pluginNameInput);
  const runningPluginRemove = view.runningAction === pluginActionState('remove', view.pluginNameInput);
  const runningPluginEnable = view.runningAction === pluginActionState('enable', view.pluginNameInput);
  const runningPluginDisable = view.runningAction === pluginActionState('disable', view.pluginNameInput);
  const workbenchMain = view.workbenchTab === 'tools'
    ? renderToolsWorkbench(view, state, runningToolBatchEnable, runningToolBatchDisable)
    : view.workbenchTab === 'plugins'
      ? renderPluginsWorkbench(view, state, runningPluginInstall, runningPluginUpdate, runningPluginRemove, runningPluginEnable, runningPluginDisable)
      : view.workbenchTab === 'skills'
        ? renderSkillsWorkbench(view, state)
        : renderRuntimeWorkbench(view, state);

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">扩展能力台</h1>
        ${infoTipHtml('扩展页聚焦真正可操作的 tools、skills、plugins 和 memory provider 闭环，不再大段铺介绍文案。')}
      </div>
      <p class="page-desc">集中治理 Hermes 扩展运行态，不重造底层逻辑。</p>
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
          <span class="stat-card-label">Tools</span>
          ${statusDotHtml(state.toolsEnabled > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.toolsEnabled}/${state.toolsTotal}`)}</div>
        <div class="stat-card-meta">所有平台已启用工具总量 / 总容量</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Skills</span>
          ${statusDotHtml(state.runtimeSkillMismatch ? 'warning' : 'running')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.runtimeSkills.length} / ${view.skills.length}`)}</div>
        <div class="stat-card-meta">运行态技能 / 本地目录技能</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Plugins</span>
          ${statusDotHtml(state.pluginInstalledCount > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.pluginInstalledCount}/${state.pluginAvailableCount || state.pluginInstalledCount}`)}</div>
        <div class="stat-card-meta">${escapeHtml(state.pluginAvailableCount ? '已安装 / 目录插件总数' : view.extensions.plugins.installHint || '当前仍以 builtin 与 local skills 为主。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Provider / Gateway</span>
          ${statusDotHtml(state.providerAligned && view.dashboard.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(state.configuredProviderDisplay)}</div>
        <div class="stat-card-meta">${escapeHtml(`runtime ${view.extensions.memoryRuntime.provider} · ${view.dashboard.gateway?.gatewayState || 'Gateway 未运行'}`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', kind: 'primary', disabled: view.refreshing })}
      ${buttonHtml({
        action: 'provider-apply',
        label: state.configuredProviderDisplay === 'builtin-file' ? 'Builtin 已接管' : '切回 Builtin',
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
          <p class="config-section-desc">改成单主工作区，避免 tools、plugins、skills 和 raw 输出分散到多块区域。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workbenchTab, 'neutral')}
          ${state.warnings.length > 0 ? pillHtml(`${state.warnings.length} 条提醒`, 'warn') : pillHtml('运行态稳定', 'good')}
        </div>
      </div>
      ${renderWorkbenchTabs(view)}
      <div class="workspace-shell">
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
  const pluginFilterState = view.page.querySelector('#extensions-plugin-filter-state');
  const pluginInstalled = view.page.querySelector('#extensions-plugin-installed');
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
  if (pluginInstalled) {
    pluginInstalled.value = view.extensions.plugins.items.join(', ') || '当前没有已安装插件';
  }
  if (pluginFilterState) {
    pluginFilterState.value = `${view.pluginFilter === 'all' ? '全部插件' : view.pluginFilter === 'installed' ? '仅已安装' : view.pluginFilter === 'requires-env' ? '需要凭证' : '包含依赖'}${view.pluginQuery.trim() ? ` · ${view.pluginQuery.trim()}` : ''}`;
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
    successMessage = 'Builtin File 已设为默认 provider，并已直接写回到 Hermes 配置。';
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

function syncWithPanelState(view) {
  const shell = getPanelState();
  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.configDocs = null;
    view.extensions = null;
    view.dashboard = null;
    view.installation = null;
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
  const pluginFilterState = view.page.querySelector('#extensions-plugin-filter-state');
  const pluginInstalled = view.page.querySelector('#extensions-plugin-installed');
  const skillSearch = view.page.querySelector('#extensions-skill-search');
  const sourceFilter = view.page.querySelector('#extensions-source-filter');
  const platformSelect = view.page.querySelector('#extensions-platform-select');

  const syncInlineControls = () => {
    const batchNames = normalizeToolNames(view.toolNamesInput);
    const hasPluginName = Boolean(view.pluginNameInput.trim());
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

  if (pluginInstalled) {
    const installedNames = view.extensions?.pluginCatalog?.filter((item) => item.installed).map((item) => item.name) ?? [];
    const catalogSummary = view.extensions?.pluginCatalog?.length
      ? `${installedNames.join(', ') || '无已安装插件'} / 目录 ${view.extensions.pluginCatalog.length} 项`
      : view.extensions?.plugins.items.join(', ') || '当前没有已安装插件';
    pluginInstalled.value = catalogSummary;
  }

  if (pluginFilterState) {
    pluginFilterState.value = `${view.pluginFilter === 'all' ? '全部插件' : view.pluginFilter === 'installed' ? '仅已安装' : view.pluginFilter === 'requires-env' ? '需要凭证' : '包含依赖'}${view.pluginQuery.trim() ? ` · ${view.pluginQuery.trim()}` : ''}`;
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
          await executePluginAction(view, 'install', view.pluginNameInput);
          return;
        case 'plugin-install-card':
          await executePluginAction(view, 'install', element.getAttribute('data-name') || '');
          return;
        case 'plugin-update':
          await executePluginAction(view, 'update', view.pluginNameInput);
          return;
        case 'plugin-update-card':
          await executePluginAction(view, 'update', element.getAttribute('data-name') || '');
          return;
        case 'plugin-remove':
          if (!window.confirm(`确定移除插件 ${view.pluginNameInput.trim()} 吗？`)) {
            return;
          }
          await executePluginAction(view, 'remove', view.pluginNameInput);
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
          await executePluginAction(view, 'enable', view.pluginNameInput);
          return;
        case 'plugin-disable-current':
          await executePluginAction(view, 'disable', view.pluginNameInput);
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
    lastResult: null,
    loading: true,
    page,
    pluginFilter: 'all',
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
