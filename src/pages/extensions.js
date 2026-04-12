import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
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
  const installation = view.installation;
  const skills = view.skills;
  const runtimeSkills = extensions?.runtimeSkills ?? [];
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
  if (dashboard?.config.memoryProvider && dashboard.config.memoryProvider !== 'builtin-file' && extensions?.memoryRuntime.provider.includes('none')) {
    warnings.push(`配置里声明了 memory provider「${dashboard.config.memoryProvider}」，但运行态仍像 built-in only。`);
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
    currentPlatform,
    currentPlatformMetrics,
    currentPlatformSummary,
    diagnosticsIntent,
    filteredSkills,
    logsIntent,
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

function renderPluginCards(view) {
  if (!view.extensions?.plugins.items.length) {
    return emptyStateHtml('尚未安装插件', '当前还是 builtin + local skills 主导的扩展形态。若要扩展 memory/provider，通常需要先安装对应插件。');
  }

  return `
    <div class="list-stack">
      ${view.extensions.plugins.items.map((item) => {
        const enableActionId = pluginActionState('enable', item);
        const disableActionId = pluginActionState('disable', item);
        return `
          <div class="list-card">
            <div class="list-card-title">
              <strong>${escapeHtml(item)}</strong>
              ${pillHtml('installed', 'good')}
            </div>
            <p>插件管理器已识别该插件。是否在当前 profile 生效，建议结合原始输出、记忆 provider 和相关功能页一起判断。</p>
            <div class="toolbar">
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
                action: 'plugin-fill',
                label: '填入输入框',
                attrs: { 'data-name': item },
              })}
            </div>
          </div>
        `;
      }).join('')}
    </div>
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
        ${buttonHtml({ action: 'terminal-tools', label: '打开工具面', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
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
          <p class="workspace-main-copy">安装、更新、启停仍走 Hermes 原生命令。</p>
        </div>
        ${pillHtml(String(view.extensions.plugins.installedCount), view.extensions.plugins.installedCount > 0 ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>已安装</span>
          <strong>${escapeHtml(String(view.extensions.plugins.installedCount))}</strong>
        </div>
        <div class="key-value-row">
          <span>当前输入</span>
          <strong>${escapeHtml(view.pluginNameInput.trim() || '未填写')}</strong>
        </div>
        <div class="key-value-row">
          <span>Memory Provider</span>
          <strong>${escapeHtml(view.extensions.memoryRuntime.provider)}</strong>
        </div>
      </div>
      <p class="helper-text">${escapeHtml(view.extensions.plugins.installHint || '插件层会直接影响 provider 与扩展来源，执行后建议回到运行态核对 raw 输出。')}</p>
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({ action: 'terminal-plugins-panel', label: '插件面板', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
        ${buttonHtml({ action: 'terminal-memory', label: '记忆 Provider', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
        ${buttonHtml({ action: 'goto-config', label: '核对配置页' })}
      </div>
    `;
  }

  if (view.workbenchTab === 'skills') {
    return `
      <div class="workspace-rail-header">
        <div>
          <strong>技能来源摘要</strong>
          <p class="workspace-main-copy">区分目录态、安装态和 source/trust，避免只看本地文件。</p>
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
      </div>
      ${state.runtimeSkillMismatch
        ? `<div class="warning-stack top-gap"><div class="warning-item">${escapeHtml(`CLI local 技能 ${state.sourceLocalCount} 个，本地目录 ${view.skills.length} 个，安装态存在偏差。`)}</div></div>`
        : '<p class="helper-text">当前目录态和运行态没有明显偏差，可以继续按分类筛选。</p>'}
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({ action: 'terminal-skills-browse', label: '技能浏览器', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
        ${buttonHtml({ action: 'terminal-skills', label: '技能开关', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
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
            <p class="workspace-main-copy">按平台启停工具，同时保留 Hermes tools 原生命令闭环。</p>
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
          </div>
          <p class="helper-text">当前平台：<code>${escapeHtml(state.currentPlatform.displayName)}</code>，这里直接调用 <code>hermes tools enable|disable</code>。</p>
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

function renderPluginsWorkbench(view, runningPluginInstall, runningPluginUpdate, runningPluginRemove, runningPluginEnable, runningPluginDisable) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>插件治理</strong>
            <p class="workspace-main-copy">安装、更新、移除交给 Terminal，profile 内启停通过 Hermes CLI 回显。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-plugins-panel', label: '打开插件面板', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>Plugin 名称</span>
            <input class="search-input" id="extensions-plugin-input" placeholder="owner/repo 或 plugin 名称" ${view.runningAction ? 'disabled' : ''}>
          </label>
          <label class="field-stack">
            <span>当前已安装</span>
            <input class="search-input" id="extensions-plugin-installed" readonly>
          </label>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'plugin-install', label: runningPluginInstall ? '安装插件…' : '安装插件', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-update', label: runningPluginUpdate ? '更新插件…' : '更新插件', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-remove', label: runningPluginRemove ? '移除插件…' : '移除插件', kind: 'danger', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-enable-current', label: runningPluginEnable ? '启用插件中…' : '启用插件', disabled: Boolean(view.runningAction) || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-disable-current', label: runningPluginDisable ? '停用插件中…' : '停用插件', disabled: Boolean(view.runningAction) || !view.pluginNameInput.trim() })}
        </div>
      </section>
      <section class="panel panel-nested">
        <div class="workspace-list-scroll">
          ${renderPluginCards(view)}
        </div>
      </section>
    </div>
  `;
}

function renderSkillsWorkbench(view, state) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
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
          </div>
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

  if (view.error || !view.extensions || !view.dashboard || !view.installation) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">扩展能力台</h1>
        </div>
        <p class="page-desc">围绕 tools、plugins、skills 和 memory provider 做集中治理。</p>
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
  const runningPluginInstall = view.runningAction === 'extensions:plugin-install';
  const runningPluginUpdate = view.runningAction === 'extensions:plugin-update';
  const runningPluginRemove = view.runningAction === 'extensions:plugin-remove';
  const runningPluginEnable = view.runningAction === pluginActionState('enable', view.pluginNameInput);
  const runningPluginDisable = view.runningAction === pluginActionState('disable', view.pluginNameInput);

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">扩展能力台</h1>
        ${infoTipHtml('扩展页聚焦真正可操作的 tools、skills、plugins 和 memory provider 闭环，不再大段铺介绍文案。')}
      </div>
      <p class="page-desc">只包装 Hermes 运行时扩展能力，不重造一套 plugin 或 tool 逻辑。</p>
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

    <div class="stat-cards">
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
          <span class="stat-card-label">Runtime Skills</span>
          ${statusDotHtml(state.runtimeSkills.length > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(String(state.runtimeSkills.length))}</div>
        <div class="stat-card-meta">来自 <code>hermes skills list</code> 的当前安装态</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Builtin / Local</span>
          ${statusDotHtml(state.runtimeSkillMismatch ? 'warning' : 'running')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${state.sourceBuiltinCount} / ${state.sourceLocalCount}`)}</div>
        <div class="stat-card-meta">运行时技能来源分布</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Plugins</span>
          ${statusDotHtml(view.extensions.plugins.installedCount > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(String(view.extensions.plugins.installedCount))}</div>
        <div class="stat-card-meta">${escapeHtml(view.extensions.plugins.installHint || '当前仍以 builtin 与 local skills 为主。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Memory Provider</span>
          ${statusDotHtml(view.extensions.memoryRuntime.provider.includes('none') ? 'warning' : 'running')}
        </div>
        <div class="stat-card-value">${escapeHtml(view.extensions.memoryRuntime.provider)}</div>
        <div class="stat-card-meta">${escapeHtml(`Built-in ${view.extensions.memoryRuntime.builtInStatus} · 可用记忆插件 ${view.extensions.memoryRuntime.installedPlugins.length} 个`)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway</span>
          ${statusDotHtml(view.dashboard.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(view.dashboard.gateway?.gatewayState || '未检测到')}</div>
        <div class="stat-card-meta">${escapeHtml(`${view.dashboard.config.contextEngine || 'context 未配置'} · ${view.dashboard.config.modelProvider || 'provider 未配置'}`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', kind: 'primary', disabled: view.refreshing })}
      ${buttonHtml({ action: 'terminal-tools', label: '工具面配置', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
      ${buttonHtml({ action: 'terminal-skills', label: '技能开关', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
      ${buttonHtml({ action: 'terminal-memory', label: '记忆 Provider', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
      ${buttonHtml({ action: 'terminal-plugins-panel', label: '插件面板', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
      ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">扩展接管动作台</h2>
          <p class="config-section-desc">把 tools、skills、plugins、memory provider 的官方入口拉进同一页，形成真正可操作的扩展运营台。</p>
        </div>
      </div>
      <div class="control-card-grid">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Tools</p>
              <h3 class="action-card-title">工具面接管</h3>
            </div>
            ${pillHtml(state.toolsEnabled > 0 ? `${state.toolsEnabled}/${state.toolsTotal}` : '待启用', state.toolsEnabled > 0 ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">先用 Hermes 官方交互式工具面配置，再回到下方做平台级启停和日志核对。</p>
          <p class="command-line">${escapeHtml(`hermes tools · ${view.installation.toolsSetupCommand}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-tools', label: view.runningAction === 'extensions:tools' ? '工具面配置…' : '工具面配置', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-tools-setup', label: '工具选择向导', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Skills</p>
              <h3 class="action-card-title">技能来源与安装态</h3>
            </div>
            ${pillHtml(state.runtimeSkillMismatch ? '安装态偏差' : '安装态对齐', state.runtimeSkillMismatch ? 'warn' : 'good')}
          </div>
          <p class="action-card-copy">技能既有目录态也有安装态，优先走官方 registry/config 入口，再回技能页看本地目录。</p>
          <p class="command-line">${escapeHtml(`hermes skills browse · ${view.installation.skillsConfigCommand} · hermes skills list`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-skills-browse', label: '技能浏览器', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-skills', label: '技能开关', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Provider</p>
              <h3 class="action-card-title">Memory / Context Provider</h3>
            </div>
            ${pillHtml(view.extensions.memoryRuntime.provider, view.extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good')}
          </div>
          <p class="action-card-copy">记忆 provider 和 context engine 都仍通过官方交互式入口切换，客户端不私自重建逻辑。</p>
          <p class="command-line">hermes memory setup · hermes plugins</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-memory', label: '记忆 Provider', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-plugins-panel', label: '插件与 Provider 面板', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Workspace</p>
              <h3 class="action-card-title">日志与闭环验证</h3>
            </div>
            ${pillHtml(state.warnings.length === 0 ? '姿态稳定' : `${state.warnings.length} 条提醒`, state.warnings.length === 0 ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">扩展面不只看安装数，还要结合日志、配置和诊断页确认运行期是否真的生效。</p>
          <p class="command-line">hermes tools --summary · hermes plugins list · hermes memory status · hermes skills list</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) })}
            ${buttonHtml({ action: 'goto-config', label: '回到配置页' })}
            ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
          </div>
        </section>
      </div>
    </section>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">工具编排</h2>
            <p class="config-section-desc">对 <code>hermes tools list --platform &lt;platform&gt;</code> 做治理包装，平台与能力仍来自 Hermes 自己。</p>
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
          <div class="health-grid">
            <section class="health-card">
              <div class="health-card-header">
                <strong>Inventory</strong>
                ${pillHtml(`${state.currentPlatformMetrics.enabled}/${state.currentPlatformMetrics.total}`, state.currentPlatformMetrics.enabled > 0 ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(`${state.currentPlatform.displayName} 当前从 tools list 解析出 ${state.currentPlatform.items.length} 个可治理项。`)}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Summary Drift</strong>
                ${pillHtml(state.currentPlatformSummary ? '已对齐' : '缺摘要', state.currentPlatformSummary ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(state.currentPlatformSummary
                ? `${state.currentPlatformSummary.name} 摘要显示 ${state.currentPlatformSummary.enabledCount}/${state.currentPlatformSummary.totalCount}，可和下方运行清单交叉核对。`
                : '当前平台没有在 tools summary 中找到对应摘要，建议到诊断页复核原始命令。')}</p>
            </section>
          </div>
          <div class="form-grid top-gap">
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
          </div>
          <p class="helper-text">这里直接调用 Hermes 原生命令 <code>hermes tools enable|disable --platform ...</code>，只做治理包装，不改 Hermes 自身结构。</p>
        ` : ''}
        <div class="top-gap">
          ${renderToolCards(view, state)}
        </div>
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">插件编排</h2>
            <p class="config-section-desc">把插件安装、更新、移除和 profile 内启停都收进一个闭环区域。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-plugins-panel', label: '打开插件面板', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>Plugin 名称</span>
            <input class="search-input" id="extensions-plugin-input" placeholder="owner/repo 或 plugin 名称" ${view.runningAction ? 'disabled' : ''}>
          </label>
          <label class="field-stack">
            <span>当前已安装</span>
            <input class="search-input" id="extensions-plugin-installed" readonly>
          </label>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'plugin-install', label: runningPluginInstall ? '安装插件…' : '安装插件', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-update', label: runningPluginUpdate ? '更新插件…' : '更新插件', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-remove', label: runningPluginRemove ? '移除插件…' : '移除插件', kind: 'danger', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-enable-current', label: runningPluginEnable ? '启用插件中…' : '启用插件', disabled: Boolean(view.runningAction) || !view.pluginNameInput.trim() })}
          ${buttonHtml({ action: 'plugin-disable-current', label: runningPluginDisable ? '停用插件中…' : '停用插件', disabled: Boolean(view.runningAction) || !view.pluginNameInput.trim() })}
        </div>
        <p class="helper-text">安装 / 更新 / 移除会交给 Terminal 执行；启用 / 停用则直接调用 Hermes 原生命令并保留退出结果。</p>
        <div class="top-gap">
          ${renderPluginCards(view)}
        </div>
      </section>
    </div>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">技能来源</h2>
            <p class="config-section-desc">这里看运行时安装来源、信任级别和 CLI 识别结果，不重复做技能目录页的文件展示。</p>
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
          </div>
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
          <section class="health-card">
            <div class="health-card-header">
              <strong>Category</strong>
              ${pillHtml(`${state.categoryCounts.length} 类`, 'neutral')}
            </div>
            <p>${escapeHtml(state.categoryCounts.slice(0, 6).map((item) => `${item.name} ${item.count}`).join(' · ') || '—')}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Gateway Context</strong>
              ${pillHtml(view.dashboard.gateway?.gatewayState || '未检测到', view.dashboard.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
            </div>
            <p>如果这些技能还要经过消息平台或自动化任务验证，最终还是要回到 Gateway、Cron 和 Logs 联动确认。</p>
          </section>
        </div>
        <div class="top-gap" id="extensions-skills-container">
          ${renderSkillCards(state)}
        </div>
      </section>

      <div class="page-stack">
        <section class="config-section">
          <div class="config-section-header">
            <div>
              <h2 class="config-section-title">运行健康</h2>
              <p class="config-section-desc">把工具面、记忆 provider、插件层和技能来源放一起看，快速判断闭环有没有搭起来。</p>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) })}
              ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
            </div>
          </div>
          <div class="health-grid">
            <section class="health-card">
              <div class="health-card-header">
                <strong>Tool Surface</strong>
                ${pillHtml(view.extensions.toolPlatforms.length ? `${view.extensions.toolPlatforms.length} 个平台` : '未解析', view.extensions.toolPlatforms.length ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(state.warnings.find((item) => item.includes('平台当前没有启用任何工具')) || '当前每个平台都至少挂了部分工具。')}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Memory Runtime</strong>
                ${pillHtml(view.extensions.memoryRuntime.provider, view.extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good')}
              </div>
              <p>${escapeHtml(`Built-in ${view.extensions.memoryRuntime.builtInStatus} · 已识别记忆插件 ${view.extensions.memoryRuntime.installedPlugins.length} 个`)}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Plugin Overlay</strong>
                ${pillHtml(view.extensions.plugins.installedCount > 0 ? `${view.extensions.plugins.installedCount} 个` : '未安装', view.extensions.plugins.installedCount > 0 ? 'good' : 'neutral')}
              </div>
              <p>${escapeHtml(view.extensions.plugins.installHint || '当前主要依赖 builtin 与 local skill 扩展，而不是独立 plugin 仓库。')}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Skill Sources</strong>
                ${pillHtml(state.runtimeSkillMismatch ? '存在差异' : '已对齐', state.runtimeSkillMismatch ? 'warn' : 'good')}
              </div>
              <p>${escapeHtml(`CLI local 技能 ${state.sourceLocalCount} 个 · 本地目录扫描 ${view.skills.length} 个`)}</p>
            </section>
          </div>
          ${view.extensions.memoryRuntime.installedPlugins.length > 0 || view.extensions.plugins.items.length > 0 ? `
            <div class="pill-row top-gap">
              ${view.extensions.memoryRuntime.installedPlugins.map((item) => pillHtml(`${item.name} · ${item.availability}`, 'neutral')).join('')}
              ${view.extensions.plugins.items.map((item) => pillHtml(item, 'neutral')).join('')}
            </div>
          ` : ''}
          ${state.warnings.length > 0 ? `
            <div class="warning-stack top-gap">
              ${state.warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
            </div>
          ` : emptyStateHtml('扩展层状态清晰', '当前没有发现明显的结构性问题，可以继续按平台或技能来源看细节。')}
        </section>

        <section class="config-section">
          <div class="config-section-header">
            <div>
              <h2 class="config-section-title">原始输出与最近命令</h2>
              <p class="config-section-desc">每次治理动作都保留 Hermes 原生命令结果，同时允许你切换查看 tools / memory / plugins / skills 的原始快照。</p>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'raw-tools', label: 'Tools', kind: view.rawKind === 'tools' ? 'primary' : 'secondary' })}
              ${buttonHtml({ action: 'raw-memory', label: 'Memory', kind: view.rawKind === 'memory' ? 'primary' : 'secondary' })}
              ${buttonHtml({ action: 'raw-plugins', label: 'Plugins', kind: view.rawKind === 'plugins' ? 'primary' : 'secondary' })}
              ${buttonHtml({ action: 'raw-skills', label: 'Skills', kind: view.rawKind === 'skills' ? 'primary' : 'secondary' })}
            </div>
          </div>
          ${commandResultHtml(view.lastResult, '尚未执行命令', '启停工具、插件或交接 Terminal 后，这里会保留最近一次原始结果。')}
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'goto-config', label: '回到配置页' })}
            ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
            ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
          </div>
          <pre class="code-block tall top-gap">${escapeHtml(state.rawOutput || '当前没有可展示的原始输出。')}</pre>
        </section>
      </div>
    </div>
  `;

  bindEvents(view);

  const toolInput = view.page.querySelector('#extensions-tool-input');
  const toolPreview = view.page.querySelector('#extensions-tool-preview');
  const pluginInput = view.page.querySelector('#extensions-plugin-input');
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
  if (pluginInstalled) {
    pluginInstalled.value = view.extensions.plugins.items.join(', ') || '当前没有已安装插件';
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
  const hasData = Boolean(view.extensions && view.dashboard && view.installation);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [nextExtensions, nextDashboard, nextInstallation, nextSkills] = await Promise.all([
      api.getExtensionsSnapshot(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.listSkills(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.extensions = nextExtensions;
    view.dashboard = nextDashboard;
    view.installation = nextInstallation;
    view.skills = nextSkills;
    view.selectedPlatform = nextExtensions.toolInventory.some((item) => item.platformKey === view.selectedPlatform)
      ? view.selectedPlatform
      : nextExtensions.toolInventory[0]?.platformKey ?? '';
    if (!view.pluginNameInput.trim()) {
      view.pluginNameInput = nextExtensions.plugins.items[0] ?? '';
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

async function openInTerminal(view, actionKey, label, command, options = {}) {
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
        ? `插件 ${normalizedName} 已执行 ${action}。`
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
    view.query = nextIntent.query ?? view.query;
    view.sourceFilter = nextIntent.sourceFilter ?? view.sourceFilter;
    if (nextIntent.selectedPlatform) {
      view.selectedPlatform = nextIntent.selectedPlatform;
    }
    if (nextIntent.toolNames?.length) {
      view.toolNamesInput = nextIntent.toolNames.join(', ');
    }
    if (nextIntent.pluginName) {
      view.pluginNameInput = nextIntent.pluginName;
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

  if (pluginInstalled) {
    pluginInstalled.value = view.extensions?.plugins.items.join(', ') || '当前没有已安装插件';
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
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'terminal-tools':
          await openInTerminal(view, 'extensions:tools', '工具面配置', 'hermes tools');
          return;
        case 'terminal-tools-setup':
          await openInTerminal(view, 'extensions:tools-setup', '工具选择向导', view.installation.toolsSetupCommand);
          return;
        case 'terminal-skills-browse':
          await openInTerminal(view, 'extensions:skills-browse', '技能浏览器', 'hermes skills browse');
          return;
        case 'terminal-skills':
          await openInTerminal(view, 'extensions:skills-config', '技能开关', view.installation.skillsConfigCommand);
          return;
        case 'terminal-memory':
          await openInTerminal(view, 'extensions:memory-setup', '记忆 Provider', 'hermes memory setup');
          return;
        case 'terminal-plugins-panel':
          await openInTerminal(view, 'extensions:plugins-panel', '插件与 Provider 面板', 'hermes plugins');
          return;
        case 'plugin-install':
          await openInTerminal(view, 'extensions:plugin-install', '安装插件', `hermes plugins install ${view.pluginNameInput.trim()}`);
          return;
        case 'plugin-update':
          await openInTerminal(view, 'extensions:plugin-update', '更新插件', `hermes plugins update ${view.pluginNameInput.trim()}`);
          return;
        case 'plugin-remove':
          await openInTerminal(view, 'extensions:plugin-remove', '移除插件', `hermes plugins remove ${view.pluginNameInput.trim()}`, {
            confirmMessage: `确定移除插件 ${view.pluginNameInput.trim()} 吗？`,
          });
          return;
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
        case 'raw-tools':
          view.rawKind = 'tools';
          renderPage(view);
          return;
        case 'raw-memory':
          view.rawKind = 'memory';
          renderPage(view);
          return;
        case 'raw-plugins':
          view.rawKind = 'plugins';
          renderPage(view);
          return;
        case 'raw-skills':
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
    dashboard: null,
    destroyed: false,
    error: null,
    extensions: null,
    installation: null,
    investigation: getPageIntent('extensions'),
    lastResult: null,
    loading: true,
    page,
    pluginNameInput: '',
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
  };

  if (activeView.investigation) {
    activeView.rawKind = activeView.investigation.rawKind ?? activeView.rawKind;
    activeView.query = activeView.investigation.query ?? activeView.query;
    activeView.sourceFilter = activeView.investigation.sourceFilter ?? activeView.sourceFilter;
    activeView.selectedPlatform = activeView.investigation.selectedPlatform ?? activeView.selectedPlatform;
    activeView.toolNamesInput = activeView.investigation.toolNames?.join(', ') ?? activeView.toolNamesInput;
    activeView.pluginNameInput = activeView.investigation.pluginName ?? activeView.pluginNameInput;
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
