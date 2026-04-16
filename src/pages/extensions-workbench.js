import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { truncate } from '../lib/format';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
} from './native-helpers';
import { infoTipHtml } from './workbench-helpers';

const EMPTY_PLUGIN_IMPORT_DRAFT = {
  category: '',
  overwrite: false,
  sourcePath: '',
};

const EMPTY_PLUGIN_CREATE_DRAFT = {
  category: '',
  description: '',
  name: '',
  overwrite: false,
};

const PLUGIN_WORKSPACE_GROUPS = [
  {
    key: 'catalog',
    label: '目录',
    description: '筛选插件并选择目标。',
  },
  {
    key: 'target',
    label: '目标',
    description: '查看当前插件的状态、凭证和操作。',
  },
  {
    key: 'provider',
    label: 'Provider',
    description: '切换 Provider 并查看凭证。',
  },
  {
    key: 'local',
    label: '本地接入',
    description: '导入本地插件或创建空白骨架。',
  },
];

function countCategories(items) {
  const counts = new Map();
  items.forEach((item) => {
    const key = item.category || '未分类';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function normalizeToolNames(value) {
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

export function toolActionState(action, platformKey, names) {
  return `tool:${action}:${platformKey}:${names.join(',')}`;
}

export function pluginActionState(action, name) {
  return `plugin:${action}:${name.trim()}`;
}

export function providerActionState(mode, providerName) {
  return `provider:${mode}:${providerName.trim() || 'builtin-file'}`;
}

export function uniqueValues(items) {
  return Array.from(new Set((items ?? []).map((item) => String(item ?? '').trim()).filter(Boolean)));
}

export function normalizePlatformBindings(bindings = []) {
  return [...(bindings ?? [])]
    .map((item) => ({
      platform: String(item?.platform ?? '').trim(),
      toolsets: uniqueValues(item?.toolsets ?? []),
    }))
    .filter((item) => item.platform)
    .sort((left, right) => left.platform.localeCompare(right.platform));
}

export function cloneConfigWorkspace(workspace = {}) {
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

export function clonePluginImportDraft(draft = EMPTY_PLUGIN_IMPORT_DRAFT) {
  return {
    category: draft.category || '',
    overwrite: Boolean(draft.overwrite),
    sourcePath: draft.sourcePath || '',
  };
}

export function clonePluginCreateDraft(draft = EMPTY_PLUGIN_CREATE_DRAFT) {
  return {
    category: draft.category || '',
    description: draft.description || '',
    name: draft.name || '',
    overwrite: Boolean(draft.overwrite),
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

function categoryLabel(value) {
  return value || '未分类';
}

function toolStateLabel(enabled) {
  return enabled ? '已启用' : '已停用';
}

function toolExposureLabel(item, inBinding, inTopLevel) {
  if (inBinding && inTopLevel && item.enabled) {
    return '运行与配置一致';
  }
  if (inBinding && inTopLevel) {
    return '已接入能力集';
  }
  if (inBinding && !inTopLevel) {
    return '平台已绑，顶层缺失';
  }
  if (item.enabled) {
    return '运行已启用，配置未接入';
  }
  if (inTopLevel) {
    return '仅顶层暴露';
  }
  return '尚未接入';
}

function pluginInstallLabel(installed) {
  return installed ? '已安装' : '可安装';
}

function providerDisplayLabel(value) {
  if (!value || value === 'builtin-file') {
    return '内置文件';
  }
  if (value === 'off') {
    return '已关闭';
  }
  return value;
}

function sourceLabel(value) {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'local':
      return '本地';
    case 'builtin':
      return '内置';
    default:
      return value || '未知';
  }
}

function previewList(values = [], emptyLabel = '—', limit = 5) {
  const normalized = uniqueValues(values);
  if (!normalized.length) {
    return emptyLabel;
  }
  if (normalized.length <= limit) {
    return normalized.join(', ');
  }
  return `${normalized.slice(0, limit).join(', ')} +${normalized.length - limit}`;
}

function trustLabel(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'local') {
    return '本地';
  }
  if (normalized === 'trusted') {
    return '可信';
  }
  if (normalized === 'builtin') {
    return '内置';
  }
  return value || '未知';
}

function providerButtonLabel(option) {
  if (option.selected) {
    return option.mode === 'off' ? '当前已关闭' : '当前配置';
  }
  if (option.mode === 'off') {
    return '关闭记忆';
  }
  if (option.mode === 'builtin') {
    return '切回内置';
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
    label: '内置文件',
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

function samePlatformKey(left, right) {
  return normalizeLookupValue(left) === normalizeLookupValue(right);
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

function parseConfiguredEnvKeys(content) {
  const configured = new Set();
  String(content ?? '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      const normalized = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length).trim()
        : trimmed;
      const separatorIndex = normalized.indexOf('=');
      if (separatorIndex <= 0) {
        return;
      }

      const key = normalized.slice(0, separatorIndex).trim();
      const rawValue = normalized.slice(separatorIndex + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return;
      }

      const value = rawValue.replace(/^['"]|['"]$/g, '').trim();
      if (!value) {
        return;
      }
      configured.add(key);
    });

  return configured;
}

function pluginEnvStatus(view, item) {
  const required = uniqueValues(item?.requiresEnv ?? []);
  const configuredKeys = parseConfiguredEnvKeys(view.configDocs?.envFile ?? '');
  const configured = required.filter((name) => configuredKeys.has(name));
  const missing = required.filter((name) => !configuredKeys.has(name));

  return {
    configured,
    configuredCount: configured.length,
    missing,
    totalCount: required.length,
  };
}

function findMatchingPluginCatalogItem(pluginCatalog, pluginName) {
  return (pluginCatalog ?? []).find((item) => (
    sameLookupTarget(item.name, pluginName)
    || sameLookupTarget(item.relativePath, pluginName)
  )) ?? null;
}

function findMatchingRuntimePluginName(runtimePlugins, pluginName) {
  return (runtimePlugins ?? []).find((item) => sameLookupTarget(item, pluginName)) ?? '';
}

function pluginLifecycleSummary(focus) {
  if (!focus.name) {
    return '等待选择目标';
  }
  if (focus.installed && focus.catalogItem) {
    return '目录态与运行态均已接入';
  }
  if (focus.installed) {
    return '当前只有运行态安装信息';
  }
  if (focus.catalogItem) {
    return '目录已接入，尚未安装到运行态';
  }
  return '等待加入当前目标';
}

export function resolvePluginGovernanceTarget(view, state) {
  const preferredName = [
    view.pluginNameInput.trim(),
    view.lastCreatedPlugin?.created?.name || '',
    view.lastImportedPlugin?.imported?.name || '',
    state.filteredPluginCatalog[0]?.name || '',
    state.pluginCatalog[0]?.name || '',
    state.filteredRuntimePlugins[0] || '',
    view.extensions?.plugins.items?.[0] || '',
  ].find((item) => String(item ?? '').trim()) || '';

  const catalogItem = preferredName
    ? findMatchingPluginCatalogItem(state.pluginCatalog, preferredName)
    : null;
  const runtimeName = preferredName
    ? findMatchingRuntimePluginName(view.extensions?.plugins.items ?? [], preferredName)
    : '';
  const name = catalogItem?.name || runtimeName || preferredName;
  const providerOption = name ? providerOptionForPlugin(state, name) : null;
  const envStatus = catalogItem
    ? pluginEnvStatus(view, catalogItem)
    : {
        configured: [],
        configuredCount: 0,
        missing: [],
        totalCount: 0,
      };
  const isLastImported = Boolean(
    name
    && view.lastImportedPlugin?.imported?.name
    && sameLookupTarget(view.lastImportedPlugin.imported.name, name)
  );
  const directoryPath = catalogItem?.directoryPath
    || (isLastImported ? view.lastImportedPlugin?.targetDirectory || '' : '');

  return {
    catalogItem,
    dependencyCount: (catalogItem?.pipDependencies.length ?? 0) + (catalogItem?.externalDependencies.length ?? 0),
    directoryPath,
    envStatus,
    hasRuntimeRecord: Boolean(runtimeName),
    installed: Boolean(catalogItem?.installed || runtimeName),
    isLastImported,
    lifecycleSummary: pluginLifecycleSummary({
      catalogItem,
      installed: Boolean(catalogItem?.installed || runtimeName),
      name,
    }),
    name,
    providerOption,
    runtimeName,
  };
}

function renderPluginSignalCard(label, value, meta, tone = 'neutral') {
  return `
    <section class="plugin-signal-card">
      <span class="plugin-signal-label">${escapeHtml(label)}</span>
      <strong class="plugin-signal-value">${escapeHtml(value)}</strong>
      <span class="plugin-signal-meta plugin-signal-meta-${escapeHtml(tone)}">${escapeHtml(meta)}</span>
    </section>
  `;
}

function renderEnvChips(envStatus) {
  if (!envStatus.totalCount) {
    return '<div class="plugin-chip-row"><span class="plugin-focus-chip">当前插件未声明额外凭证</span></div>';
  }

  return `
    <div class="plugin-chip-row">
      ${envStatus.configured.map((name) => `<span class="plugin-focus-chip plugin-focus-chip-good">${escapeHtml(name)}</span>`).join('')}
      ${envStatus.missing.map((name) => `<span class="plugin-focus-chip plugin-focus-chip-warn">${escapeHtml(name)}</span>`).join('')}
    </div>
  `;
}

function renderPluginDependencyDetails(item) {
  if (!item) {
    return '';
  }

  const rows = [];
  if (item.pipDependencies.length > 0) {
    rows.push(`
      <div class="plugin-dependency-item">
        <span>Python 依赖</span>
        <code>${escapeHtml(item.pipDependencies.join(', '))}</code>
      </div>
    `);
  }
  item.externalDependencies.forEach((dependency) => {
    rows.push(`
      <div class="plugin-dependency-item">
        <span>${escapeHtml(dependency.name)}</span>
        <code>${escapeHtml(dependency.check || dependency.install || '待手工核对')}</code>
      </div>
    `);
  });

  if (!rows.length) {
    return '<div class="plugin-chip-row"><span class="plugin-focus-chip">当前 manifest 未声明额外依赖</span></div>';
  }

  return `<div class="plugin-dependency-list compact">${rows.join('')}</div>`;
}

function renderPluginManifestEditor(view, focus) {
  if (!focus.catalogItem) {
    return '';
  }

  const draft = view.pluginManifestDraft;
  const hasDraft = draft && draft.manifestPath === view.pluginManifestTarget;
  const manifest = hasDraft ? draft : null;

  return `
    <details class="compact-disclosure plugin-manifest-disclosure" id="extensions-plugin-manifest-disclosure" ${view.pluginManifestExpanded ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">Manifest 接管</strong>
            <span class="preset-card-copy">直接编辑本地 <code>plugin.yaml</code>，只接管已知字段，其他键保持原样。</span>
          </div>
          <div class="pill-row">
            ${pillHtml(view.pluginManifestLoading ? '读取中' : manifest ? '已加载' : view.pluginManifestError ? '读取失败' : '等待加载', view.pluginManifestError ? 'warn' : manifest ? 'good' : 'neutral')}
            ${pillHtml(focus.catalogItem.relativePath, 'neutral')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${view.pluginManifestLoading ? `
          <div class="plugin-manifest-state">
            <strong>正在载入 manifest…</strong>
            <p>读取当前插件目录下的结构化字段，稍后会把编辑表单直接填进来。</p>
          </div>
        ` : view.pluginManifestError ? `
          <div class="plugin-manifest-state plugin-manifest-state-warn">
            <strong>读取 manifest 失败</strong>
            <p>${escapeHtml(view.pluginManifestError)}</p>
          </div>
        ` : !manifest ? `
          <div class="plugin-manifest-state">
            <strong>等待 manifest</strong>
            <p>当前插件目录已识别，HermesPanel 会在这里接管 <code>plugin.yaml</code> 的常用字段。</p>
          </div>
        ` : `
          <div class="plugin-manifest-grid">
            <div class="plugin-manifest-meta">
              <span>manifest</span>
              <code>${escapeHtml(manifest.manifestPath)}</code>
            </div>
            <div class="form-grid form-grid-compact">
              <label class="field-stack">
                <span>插件名称</span>
                <input class="search-input" id="extensions-plugin-manifest-name" value="${escapeHtml(manifest.name)}" ${view.runningAction ? 'disabled' : ''}>
              </label>
              <label class="field-stack">
                <span>描述</span>
                <input class="search-input" id="extensions-plugin-manifest-description" value="${escapeHtml(manifest.description)}" placeholder="一句话描述插件用途" ${view.runningAction ? 'disabled' : ''}>
              </label>
            </div>
            <div class="form-grid form-grid-compact">
              <label class="field-stack">
                <span>ENV 声明</span>
                <textarea class="search-input plugin-manifest-textarea" id="extensions-plugin-manifest-env" placeholder="一行一个环境变量，例如&#10;OPENAI_API_KEY" ${view.runningAction ? 'disabled' : ''}>${escapeHtml(manifest.requiresEnvText)}</textarea>
              </label>
              <label class="field-stack">
                <span>Pip 依赖</span>
                <textarea class="search-input plugin-manifest-textarea" id="extensions-plugin-manifest-pip" placeholder="一行一个包名，例如&#10;requests" ${view.runningAction ? 'disabled' : ''}>${escapeHtml(manifest.pipDependenciesText)}</textarea>
              </label>
            </div>
            <label class="field-stack">
              <span>外部依赖</span>
              <textarea class="search-input plugin-manifest-textarea plugin-manifest-textarea-wide" id="extensions-plugin-manifest-external" placeholder="一行一个依赖，格式：名称 | 安装命令 | 检查命令" ${view.runningAction ? 'disabled' : ''}>${escapeHtml(manifest.externalDependenciesText)}</textarea>
            </label>
            <p class="plugin-focus-note">外部依赖建议按 <code>名称 | install | check</code> 逐行填写。留空的列会自动省略，不会污染现有 YAML。</p>
            <div class="toolbar">
              ${buttonHtml({
                action: 'plugin-manifest-save',
                label: view.runningAction === 'plugin:save-manifest' ? '保存中…' : '保存 manifest',
                kind: 'primary',
                disabled: Boolean(view.runningAction) || !manifest.name.trim(),
              })}
              ${buttonHtml({
                action: 'plugin-manifest-reset',
                label: '重置',
                disabled: Boolean(view.runningAction) || !view.pluginManifest,
              })}
              ${buttonHtml({
                action: 'plugin-open',
                label: '打开目录',
                attrs: { 'data-name': focus.name, 'data-path': focus.directoryPath },
              })}
            </div>
          </div>
        `}
      </div>
    </details>
  `;
}

function renderPluginReadmeEditor(view, focus) {
  if (!focus.catalogItem) {
    return '';
  }

  const draft = view.pluginReadmeDraft;
  const hasDraft = draft && draft.directoryPath === view.pluginReadmeTarget;
  const readme = hasDraft ? draft : null;

  return `
    <details class="compact-disclosure plugin-readme-disclosure" id="extensions-plugin-readme-disclosure" ${view.pluginReadmeExpanded ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">README 接管</strong>
            <span class="preset-card-copy">像技能页那样直接编辑本地 <code>README.md</code>，把接入说明、用法和依赖备注留在客户端里。</span>
          </div>
          <div class="pill-row">
            ${pillHtml(view.pluginReadmeLoading ? '读取中' : readme ? (readme.exists ? '已接管' : '待创建') : view.pluginReadmeError ? '读取失败' : '等待加载', view.pluginReadmeError ? 'warn' : readme ? 'good' : 'neutral')}
            ${pillHtml(focus.catalogItem.category, 'neutral')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${view.pluginReadmeLoading ? `
          <div class="plugin-manifest-state">
            <strong>正在载入 README…</strong>
            <p>会优先读取当前插件目录下的 <code>README.md</code>，如果不存在，也可以直接在这里创建。</p>
          </div>
        ` : view.pluginReadmeError ? `
          <div class="plugin-manifest-state plugin-manifest-state-warn">
            <strong>读取 README 失败</strong>
            <p>${escapeHtml(view.pluginReadmeError)}</p>
          </div>
        ` : !readme ? `
          <div class="plugin-manifest-state">
            <strong>等待 README</strong>
            <p>当前插件目录已经接管完成，稍后会在这里展开本地说明文件。</p>
          </div>
        ` : `
          <div class="plugin-manifest-grid">
            <div class="plugin-manifest-meta">
              <span>readme</span>
              <code>${escapeHtml(readme.filePath)}</code>
            </div>
            <label class="field-stack">
              <span>README.md</span>
              <textarea class="editor compact-control-editor-mini plugin-readme-editor" id="extensions-plugin-readme-editor" placeholder="在这里记录插件用途、安装说明、Provider 接管方式和注意事项…" ${view.runningAction ? 'disabled' : ''}>${escapeHtml(readme.content)}</textarea>
            </label>
            <div class="toolbar">
              ${buttonHtml({
                action: 'plugin-readme-save',
                label: view.runningAction === 'plugin:save-readme' ? '保存中…' : (readme.exists ? '保存 README' : '创建 README'),
                kind: 'primary',
                disabled: Boolean(view.runningAction) || !readme.filePath,
              })}
              ${buttonHtml({
                action: 'plugin-readme-reset',
                label: '重置',
                disabled: Boolean(view.runningAction) || !view.pluginReadme,
              })}
              ${buttonHtml({
                action: 'plugin-open',
                label: '打开目录',
                attrs: { 'data-name': focus.name, 'data-path': focus.directoryPath },
              })}
            </div>
          </div>
        `}
      </div>
    </details>
  `;
}

function renderPluginLocalOps(view, focus) {
  if (!focus.catalogItem) {
    return '';
  }

  const readme = view.pluginReadmeDraft && view.pluginReadmeDraft.directoryPath === view.pluginReadmeTarget
    ? view.pluginReadmeDraft
    : view.pluginReadme;

  return `
    <details class="compact-disclosure plugin-localops-disclosure" id="extensions-plugin-localops-disclosure" ${view.pluginLocalOpsExpanded ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">本地目录控制</strong>
            <span class="preset-card-copy">把目录定位、文件确认和本地删除收进危险区，避免和主治理动作混在一起。</span>
          </div>
          <div class="pill-row">
            ${pillHtml(focus.installed ? '运行态已安装' : '仅本地目录', focus.installed ? 'warn' : 'good')}
            ${readme?.exists ? pillHtml('README 已存在', 'good') : pillHtml('README 未创建', 'neutral')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${keyValueRowsHtml([
          { label: '插件目录', value: focus.directoryPath || '—' },
          { label: '相对路径', value: focus.catalogItem.relativePath },
          { label: 'Manifest', value: `${focus.directoryPath}/plugin.yaml` },
          { label: 'README', value: readme?.filePath || `${focus.directoryPath}/README.md` },
        ])}
        <div class="danger-copy-compact">
          <strong>本地危险操作</strong>
          <p>${escapeHtml(focus.installed ? '当前插件仍在运行态内。为了避免 Hermes 引用断裂，先移除运行态插件，再删除本地目录。' : '删除只会影响当前 profile 的本地插件目录，不会触碰 Hermes 其他 profile。')}</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({
            action: 'plugin-open',
            label: '打开目录',
            attrs: { 'data-name': focus.name, 'data-path': focus.directoryPath },
          })}
          ${buttonHtml({
            action: 'plugin-delete-local',
            label: view.runningAction === 'plugin:delete-local' ? '删除中…' : '删除本地目录',
            kind: 'danger',
            disabled: Boolean(view.runningAction) || focus.installed,
          })}
        </div>
      </div>
    </details>
  `;
}

function pluginIcon(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('memory')) {
    return '🧠';
  }
  if (normalized.includes('browser')) {
    return '🌐';
  }
  if (normalized.includes('gateway') || normalized.includes('channel')) {
    return '🔌';
  }
  if (normalized.includes('search')) {
    return '🔎';
  }
  return '🧩';
}

function primaryInvestigationTool(investigation) {
  return investigation?.context?.toolNames.find((item) => item.trim().length > 0) ?? '';
}

export function relaySeed(view) {
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

export function derivedState(view) {
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
  const workspaceToolsets = uniqueValues(configDocs?.workspace?.toolsets ?? []);
  const normalizedPlatformBindings = normalizePlatformBindings(configDocs?.workspace?.platformToolsets ?? []);
  const currentPlatformBinding = currentPlatform
    ? normalizedPlatformBindings.find((item) => samePlatformKey(item.platform, currentPlatform.platformKey)) ?? null
    : null;
  const currentPlatformBindingToolsets = uniqueValues(currentPlatformBinding?.toolsets ?? []);
  const currentPlatformRuntimeNames = uniqueValues(currentPlatform?.items.map((item) => item.name) ?? []);
  const currentPlatformRuntimeEnabledNames = uniqueValues(
    currentPlatform?.items.filter((item) => item.enabled).map((item) => item.name) ?? [],
  );
  const currentPlatformConfigEnabledCount = currentPlatformRuntimeNames.filter((item) => currentPlatformBindingToolsets.includes(item)).length;
  const currentPlatformTopLevelCount = currentPlatformRuntimeNames.filter((item) => workspaceToolsets.includes(item)).length;
  const currentPlatformRuntimeOnly = currentPlatformRuntimeEnabledNames.filter((item) => !currentPlatformBindingToolsets.includes(item));
  const currentPlatformBindingOnly = currentPlatformBindingToolsets.filter((item) => !currentPlatformRuntimeNames.includes(item));
  const currentPlatformMissingTopLevel = currentPlatformBindingToolsets.filter((item) => !workspaceToolsets.includes(item));
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
    warnings.push('当前没有检测到 Hermes 可执行组件，扩展安装、技能配置和 memory provider 切换都无法真正执行。');
  }
  if (!extensions?.toolPlatforms.length) {
    warnings.push('当前没有解析出任何 tools 平台摘要，Hermes 工具面摘要没有成功返回。');
  }
  if (toollessPlatforms.length > 0) {
    warnings.push(`存在 ${toollessPlatforms.length} 个平台当前没有启用任何工具：${toollessPlatforms.map((item) => item.name).join('、')}。`);
  }
  if ((extensions?.plugins.installedCount ?? 0) === 0) {
    warnings.push('当前运行态还没有检测到已安装插件，扩展层仍以 builtin 和 local skills 为主。');
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
    warnings.push(`运行态识别到 ${sourceLocalCount} 个 local 技能，而本地目录扫描到 ${skills.length} 个，说明安装态和文件态存在差异。`);
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
    currentPlatformBinding,
    currentPlatformBindingOnly,
    currentPlatformBindingToolsets,
    currentPlatformConfigEnabledCount,
    currentPlatformMetrics,
    currentPlatformMissingTopLevel,
    currentPlatformRuntimeEnabledNames,
    currentPlatformRuntimeOnly,
    currentPlatformSummary,
    currentPlatformTopLevelCount,
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
    workspaceToolsets,
    warnings,
  };
}

function renderToolCards(view, state) {
  if (!state.currentPlatform) {
    return emptyStateHtml('暂无平台清单', '当前还没有返回可治理的平台内容。');
  }

  if (!state.currentPlatform.items.length) {
    return emptyStateHtml('平台下暂无工具', '当前平台还没有返回可治理工具项。');
  }

  return `
    <div class="tool-card-grid">
      ${state.currentPlatform.items.map((item) => {
        const inBinding = state.currentPlatformBindingToolsets.includes(item.name);
        const inTopLevel = state.workspaceToolsets.includes(item.name);
        const enableActionId = toolActionState('enable', state.currentPlatform.platformKey, [item.name]);
        const disableActionId = toolActionState('disable', state.currentPlatform.platformKey, [item.name]);
        return `
          <article class="tool-card${inBinding ? ' tool-card-managed' : ''}${item.enabled ? ' tool-card-runtime' : ''}">
            <div class="tool-card-head">
              <div class="tool-card-title-wrap">
                <strong>${escapeHtml(item.name)}</strong>
                <p class="tool-card-copy">${escapeHtml(item.description || '当前没有额外描述信息。')}</p>
              </div>
              <div class="pill-row">
                ${pillHtml(toolStateLabel(item.enabled), item.enabled ? 'good' : 'warn')}
                ${pillHtml(inBinding ? '已接入平台' : '未接入平台', inBinding ? 'neutral' : 'warn')}
                ${pillHtml(inTopLevel ? '顶层已暴露' : '顶层未暴露', inTopLevel ? 'good' : 'warn')}
              </div>
            </div>
            <div class="tool-card-meta">
              <span>${escapeHtml(toolExposureLabel(item, inBinding, inTopLevel))}</span>
              <span>${escapeHtml(`平台 ${state.currentPlatform.displayName}`)}</span>
            </div>
            <div class="toolbar tool-card-actions">
              ${buttonHtml({
                action: 'tool-enable',
                label: view.runningAction === enableActionId ? '接入中…' : '接入平台',
                kind: 'primary',
                disabled: Boolean(view.runningAction) || inBinding,
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: 'tool-disable',
                label: view.runningAction === disableActionId ? '移出中…' : '移出平台',
                disabled: Boolean(view.runningAction) || !inBinding,
                attrs: { 'data-name': item.name },
              })}
              ${!inTopLevel && inBinding ? buttonHtml({
                action: 'tool-promote-top-level',
                label: '补到顶层',
                disabled: Boolean(view.runningAction),
                attrs: { 'data-name': item.name },
              }) : ''}
              ${buttonHtml({
                action: 'tool-logs',
                label: '查看日志',
                attrs: { 'data-name': item.name },
              })}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderPluginCards(view, state, focus) {
  if (!state.pluginCatalog.length && !view.extensions?.plugins.items.length) {
    return emptyStateHtml('尚未发现插件目录', '当前还没有扫描到可治理的 plugin manifest。你仍然可以在上方输入 owner/repo 或插件名直接安装。');
  }

  if (!state.pluginCatalog.length) {
    if (!state.filteredRuntimePlugins.length) {
      return emptyStateHtml('当前筛选下没有插件', '换一个插件关键词，或者切回“全部插件 / 已安装”继续查看。');
    }

    return `
      <div class="plugin-grid">
        ${state.filteredRuntimePlugins.map((item) => {
          const providerOption = providerOptionForPlugin(state, item);
          const statusTone = providerOption?.selected ? 'good' : 'neutral';
          const updateActionId = pluginActionState('update', item);
          const focused = focus?.name && sameLookupTarget(focus.name, item);
          return `
            <article class="plugin-tile-card${focused ? ' plugin-tile-card-active' : ''}">
              <div class="plugin-tile-head">
                <div class="plugin-tile-title-wrap">
                  <span class="plugin-card-icon">${pluginIcon(item)}</span>
                  <div class="plugin-tile-title-block">
                    <strong class="plugin-tile-name">${escapeHtml(item)}</strong>
                    <div class="plugin-tile-badges">
                      ${pillHtml('已安装', 'good')}
                      ${focused ? pillHtml('当前目标', 'good') : ''}
                      ${providerOption ? pillHtml(providerOption.selected ? '当前 Provider' : '可设为 Provider', statusTone) : ''}
                    </div>
                  </div>
                </div>
                <span class="plugin-status-dot plugin-status-enabled" title="已安装"></span>
              </div>
              <p class="plugin-tile-desc">当前只有运行态，还没有本地 manifest。选中后可在上方执行启停、更新和本地接入。</p>
              <div class="plugin-tile-meta">
                <span>运行态插件</span>
                <span>manifest 缺失</span>
                ${providerOption ? `<span>${escapeHtml(providerOption.selected ? 'Provider 已接管' : '可接管 Provider')}</span>` : ''}
              </div>
              <div class="plugin-tile-actions">
                ${buttonHtml({
                  action: 'plugin-fill',
                  label: focused ? '当前目标' : '设为当前目标',
                  kind: focused ? 'secondary' : 'primary',
                  attrs: { 'data-name': item },
                })}
                ${buttonHtml({
                  action: 'plugin-update-card',
                  label: view.runningAction === updateActionId ? '更新中…' : '刷新安装',
                  disabled: Boolean(view.runningAction) || !view.installation.binaryFound,
                  attrs: { 'data-name': item },
                })}
              </div>
              <p class="plugin-tile-hint">更多操作请在上方“当前目标”里处理。</p>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  if (!state.filteredPluginCatalog.length) {
    return emptyStateHtml('当前筛选下没有插件', '可以切回“全部插件”，或者换一个关键词继续筛。');
  }

  return `
      <div class="plugin-grid">
        ${state.filteredPluginCatalog.map((item) => {
          const installActionId = pluginActionState('install', item.name);
          const updateActionId = pluginActionState('update', item.name);
          const providerOption = providerOptionForPlugin(state, item.name);
          const statusClass = item.installed ? 'plugin-status-enabled' : 'plugin-status-missing';
          const envStatus = pluginEnvStatus(view, item);
          const focused = focus?.name && sameLookupTarget(focus.name, item.name);
          return `
          <article class="plugin-tile-card ${item.installed ? '' : 'plugin-tile-card-muted'}${focused ? ' plugin-tile-card-active' : ''}">
            <div class="plugin-tile-head">
              <div class="plugin-tile-title-wrap">
                <span class="plugin-card-icon">${pluginIcon(item.category || item.name)}</span>
                <div class="plugin-tile-title-block">
                  <strong class="plugin-tile-name">${escapeHtml(item.name)}</strong>
                  <div class="plugin-tile-badges">
                    ${pillHtml(categoryLabel(item.category), 'neutral')}
                    ${pillHtml(pluginInstallLabel(item.installed), item.installed ? 'good' : 'neutral')}
                    ${focused ? pillHtml('当前目标', 'good') : ''}
                    ${item.requiresEnv.length ? pillHtml(`${item.requiresEnv.length} 个 ENV`, 'warn') : ''}
                    ${providerOption ? pillHtml(providerOption.selected ? '当前 Provider' : '可设为 Provider', providerOption.selected ? 'good' : 'neutral') : ''}
                  </div>
                </div>
              </div>
              <span class="plugin-status-dot ${statusClass}" title="${escapeHtml(pluginInstallLabel(item.installed))}"></span>
            </div>
            <p class="plugin-tile-desc">${escapeHtml(truncate(item.description || '当前 manifest 没有提供额外说明。', 92))}</p>
            <div class="plugin-tile-meta">
              <span>${escapeHtml(
                item.requiresEnv.length
                  ? (envStatus.missing.length
                    ? `凭证 ${envStatus.configuredCount}/${envStatus.totalCount} 已配`
                    : `凭证 ${envStatus.totalCount}/${envStatus.totalCount} 已配`)
                  : '无需凭证'
              )}</span>
              <span>${escapeHtml(item.externalDependencies.length || item.pipDependencies.length ? pluginDependencySummary(item) : '无额外依赖')}</span>
              <span>${escapeHtml(truncate(item.relativePath || item.directoryPath || '—', 40))}</span>
            </div>
            <div class="plugin-tile-actions">
              ${buttonHtml({
                action: 'plugin-fill',
                label: focused ? '当前目标' : '设为当前目标',
                kind: focused ? 'secondary' : 'primary',
                attrs: { 'data-name': item.name },
              })}
              ${buttonHtml({
                action: item.installed ? 'plugin-update-card' : 'plugin-install-card',
                label: item.installed
                  ? (view.runningAction === updateActionId ? '更新中…' : '更新')
                  : (view.runningAction === installActionId ? '安装中…' : '安装'),
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound,
                attrs: { 'data-name': item.name },
              })}
            </div>
            <p class="plugin-tile-hint">${escapeHtml(item.requiresEnv.length ? '凭证、Provider、manifest 和 README 都可在“当前目标”里处理。' : '目录、Provider 和文档都可在“当前目标”里处理。')}</p>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function resolvePluginWorkspaceGroup(activeKey) {
  return PLUGIN_WORKSPACE_GROUPS.find((group) => group.key === activeKey) ?? PLUGIN_WORKSPACE_GROUPS[0];
}

function renderPluginWorkspaceTabs(activeKey) {
  return `
    <div class="tab-bar tab-bar-dense">
      ${PLUGIN_WORKSPACE_GROUPS.map((group) => `
        <button
          type="button"
          class="tab ${group.key === activeKey ? 'active' : ''}"
          data-action="focus-plugin-workspace-section"
          data-section="${escapeHtml(group.key)}"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderPluginCatalogWorkspace(view, state, focus) {
  return `
    <section class="panel panel-nested">
      <div class="workspace-main-header">
        <div>
          <strong>插件目录</strong>
          <p class="workspace-main-copy">筛选插件并选择当前目标。</p>
        </div>
        <div class="pill-row">
          ${pillHtml(`${state.filteredPluginCatalog.length || state.filteredRuntimePlugins.length} 项`, 'neutral')}
          ${focus?.name ? pillHtml(`当前 ${focus.name}`, 'good') : pillHtml('等待目标', 'warn')}
        </div>
      </div>
      <div class="selection-chip-grid">
        ${buttonHtml({ action: 'set-plugin-filter', label: '全部插件', className: `selection-chip${view.pluginFilter === 'all' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'all' } })}
        ${buttonHtml({ action: 'set-plugin-filter', label: '仅已安装', className: `selection-chip${view.pluginFilter === 'installed' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'installed' } })}
        ${buttonHtml({ action: 'set-plugin-filter', label: '需要凭证', className: `selection-chip${view.pluginFilter === 'requires-env' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'requires-env' } })}
        ${buttonHtml({ action: 'set-plugin-filter', label: '包含依赖', className: `selection-chip${view.pluginFilter === 'dependencies' ? ' selection-chip-active' : ''}`, attrs: { 'data-filter': 'dependencies' } })}
      </div>
      <div class="workspace-list-scroll top-gap">
        ${renderPluginCards(view, state, focus)}
      </div>
    </section>
  `;
}

function renderPluginProviderWorkspace(view, state) {
  const providerPluginCount = state.providerOptions.filter((item) => item.mode === 'plugin').length;

  return `
    <div class="page-stack">
      ${renderProviderPresetStrip(view, state)}
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <h2 class="config-section-title">当前 Provider 入口</h2>
            <p class="config-section-desc">在这里切换 Provider 并查看相关入口。</p>
          </div>
          ${pillHtml(state.providerAligned ? '已对齐' : '待对齐', state.providerAligned ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: '当前配置', value: providerDisplayLabel(state.configuredProviderDisplay) },
          { label: '运行态', value: view.extensions.memoryRuntime.provider || '未读取' },
          { label: '可切换插件', value: String(providerPluginCount) },
          { label: '提示', value: view.extensions.plugins.installHint || '如缺凭证，再回配置中心补变量。' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({
            action: 'provider-apply',
            label: state.configuredProviderDisplay === 'builtin-file' ? '当前内置' : '切回内置',
            kind: state.configuredProviderDisplay === 'builtin-file' ? 'secondary' : 'primary',
            disabled: Boolean(view.runningAction) || !view.configDocs || state.configuredProviderDisplay === 'builtin-file',
            attrs: { 'data-provider-mode': 'builtin', 'data-provider-name': '' },
          })}
          ${buttonHtml({ action: 'goto-config-credentials', label: '去配凭证' })}
          ${buttonHtml({ action: 'goto-memory', label: '查看 Memory' })}
        </div>
      </section>
    </div>
  `;
}

function renderPluginLocalWorkspace(view) {
  const importDraft = view.pluginImportDraft ?? clonePluginImportDraft();
  const createDraft = view.pluginCreateDraft ?? clonePluginCreateDraft();
  const lastCreated = view.lastCreatedPlugin;
  const lastImported = view.lastImportedPlugin;

  return `
    <div class="page-stack">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <h2 class="config-section-title">导入现成目录</h2>
            <p class="workspace-main-copy">填写路径后可直接导入本地插件目录。</p>
          </div>
          ${lastImported ? pillHtml(`导入 ${lastImported.copiedFiles} 个文件`, 'good') : pillHtml(importDraft.category || '自动归类', 'neutral')}
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>源路径</span>
            <input class="search-input" id="extensions-plugin-import-source" value="${escapeHtml(importDraft.sourcePath)}" placeholder="~/Downloads/byterover 或 /tmp/demo/plugin.yaml" ${view.runningAction ? 'disabled' : ''}>
          </label>
          <label class="field-stack">
            <span>归档分类</span>
            <input class="search-input" id="extensions-plugin-import-category" value="${escapeHtml(importDraft.category)}" placeholder="留空沿用源分类，否则归入 imported" ${view.runningAction ? 'disabled' : ''}>
          </label>
        </div>
        <div class="checkbox-row top-gap">
          <label>
            <input type="checkbox" id="extensions-plugin-import-overwrite" ${importDraft.overwrite ? 'checked' : ''} ${view.runningAction ? 'disabled' : ''}>
            覆盖同名目录
          </label>
        </div>
        ${lastImported ? `
          <div class="top-gap">
            ${keyValueRowsHtml([
              { label: '最近导入', value: lastImported.imported.name },
              { label: '来源', value: lastImported.sourcePath },
              { label: '目标', value: lastImported.targetDirectory },
            ])}
          </div>
        ` : ''}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'plugin-import-local', label: view.runningAction === 'plugin:import-local' ? '导入中…' : '导入目录', kind: 'primary', disabled: Boolean(view.runningAction) || !importDraft.sourcePath.trim() })}
          ${buttonHtml({ action: 'plugin-import-reset', label: '清空', disabled: Boolean(view.runningAction) })}
          ${buttonHtml({ action: 'open-plugin-root', label: '打开插件目录', disabled: Boolean(view.runningAction) })}
        </div>
      </section>

      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <h2 class="config-section-title">新建最小骨架</h2>
            <p class="workspace-main-copy">填写名称、分类和描述后即可创建。</p>
          </div>
          ${lastCreated ? pillHtml(lastCreated.created.category, 'good') : pillHtml(createDraft.category || 'custom', 'neutral')}
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>插件名称</span>
            <input class="search-input" id="extensions-plugin-create-name" value="${escapeHtml(createDraft.name)}" placeholder="Release Memory" ${view.runningAction ? 'disabled' : ''}>
          </label>
          <label class="field-stack">
            <span>分类</span>
            <input class="search-input" id="extensions-plugin-create-category" value="${escapeHtml(createDraft.category)}" placeholder="custom / memory / channel" ${view.runningAction ? 'disabled' : ''}>
          </label>
        </div>
        <label class="field-stack top-gap">
          <span>描述</span>
          <input class="search-input" id="extensions-plugin-create-description" value="${escapeHtml(createDraft.description)}" placeholder="一句话描述插件用途" ${view.runningAction ? 'disabled' : ''}>
        </label>
        <div class="checkbox-row top-gap">
          <label>
            <input type="checkbox" id="extensions-plugin-create-overwrite" ${createDraft.overwrite ? 'checked' : ''} ${view.runningAction ? 'disabled' : ''}>
            覆盖同名目录
          </label>
        </div>
        ${lastCreated ? `
          <div class="top-gap">
            ${keyValueRowsHtml([
              { label: '最近新建', value: lastCreated.created.name },
              { label: '分类', value: lastCreated.created.category },
              { label: '目标', value: lastCreated.targetDirectory },
            ])}
          </div>
        ` : ''}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'plugin-create-local', label: view.runningAction === 'plugin:create-local' ? '创建中…' : '新建插件', kind: 'primary', disabled: Boolean(view.runningAction) || !createDraft.name.trim() })}
          ${buttonHtml({ action: 'plugin-create-reset', label: '清空', disabled: Boolean(view.runningAction) })}
        </div>
      </section>
    </div>
  `;
}

function renderPluginTargetWorkbench(view, state, focus) {
  const installActionId = focus.name ? pluginActionState('install', focus.name) : '';
  const updateActionId = focus.name ? pluginActionState('update', focus.name) : '';
  const removeActionId = focus.name ? pluginActionState('remove', focus.name) : '';
  const enableActionId = focus.name ? pluginActionState('enable', focus.name) : '';
  const disableActionId = focus.name ? pluginActionState('disable', focus.name) : '';
  const providerOption = focus.providerOption;

  return `
    <section class="shell-card shell-card-dense plugin-focus-card">
      <div class="shell-card-header plugin-focus-head">
        <div class="plugin-focus-title-wrap">
          <div>
            <strong>当前目标</strong>
            <p class="shell-card-copy">安装、启停、Provider 和 manifest 编辑都在这里闭环。</p>
          </div>
          ${focus.name ? `
            <div class="plugin-focus-title">
              <span class="plugin-card-icon">${pluginIcon(focus.catalogItem?.category || focus.name)}</span>
              <div class="plugin-focus-title-copy">
                <strong class="plugin-focus-name">${escapeHtml(focus.name)}</strong>
                <div class="plugin-tile-badges">
                  ${pillHtml(focus.installed ? '已安装' : '待安装', focus.installed ? 'good' : 'warn')}
                  ${focus.catalogItem ? pillHtml(categoryLabel(focus.catalogItem.category), 'neutral') : pillHtml('仅运行态', 'neutral')}
                  ${focus.isLastImported ? pillHtml('刚导入', 'good') : ''}
                  ${providerOption ? pillHtml(providerOption.selected ? '当前 Provider' : '可设为 Provider', providerOption.selected ? 'good' : 'neutral') : ''}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
        ${pillHtml(focus.name || '等待目标', focus.name ? 'good' : 'warn')}
      </div>
      <div class="form-grid">
        <label class="field-stack">
          <span>Plugin 名称</span>
          <input class="search-input" id="extensions-plugin-input" placeholder="owner/repo 或 plugin 名称" ${view.runningAction ? 'disabled' : ''}>
        </label>
        <label class="field-stack">
          <span>筛选关键词</span>
          <input class="search-input" id="extensions-plugin-search" placeholder="名称、描述、ENV、依赖" ${view.runningAction ? 'disabled' : ''}>
        </label>
      </div>
      ${view.lastImportedPlugin?.imported?.name && !focus.isLastImported ? `
        <div class="plugin-chip-row top-gap">
          <span class="plugin-focus-chip">最近导入 ${escapeHtml(view.lastImportedPlugin.imported.name)}</span>
          ${buttonHtml({
            action: 'plugin-fill',
            label: '带入最近导入',
            attrs: { 'data-name': view.lastImportedPlugin.imported.name },
          })}
        </div>
      ` : ''}
      ${focus.name ? `
        <div class="plugin-signal-grid top-gap">
          ${renderPluginSignalCard('状态', focus.installed ? '已安装' : '等待安装', focus.lifecycleSummary, focus.installed ? 'good' : 'warn')}
          ${renderPluginSignalCard(
            '凭证',
            focus.catalogItem?.requiresEnv.length
              ? `${focus.envStatus.configuredCount}/${focus.envStatus.totalCount} 已配`
              : '无需额外凭证',
            focus.catalogItem?.requiresEnv.length
              ? (focus.envStatus.missing.length ? `缺 ${focus.envStatus.missing.join(', ')}` : '当前所需 ENV 已齐')
              : '无需额外 ENV',
            focus.envStatus.missing.length ? 'warn' : 'good'
          )}
          ${renderPluginSignalCard(
            '依赖',
            focus.catalogItem
              ? (focus.dependencyCount ? `${focus.dependencyCount} 项` : '无额外依赖')
              : '未发现 manifest',
            focus.catalogItem
              ? (focus.dependencyCount ? pluginDependencySummary(focus.catalogItem) : '直接可用')
              : '仅运行态，无法从本地目录解析依赖',
            focus.dependencyCount ? 'warn' : 'good'
          )}
          ${renderPluginSignalCard(
            '目录',
            focus.catalogItem ? '已接管' : '未接管',
            focus.catalogItem?.relativePath || focus.runtimeName || '先从目录卡选一个插件',
            focus.catalogItem ? 'good' : 'neutral'
          )}
        </div>
        ${focus.catalogItem ? `
          <section class="plugin-focus-section top-gap">
            <div class="plugin-focus-section-head">
              <strong>凭证检查</strong>
              <span>${escapeHtml(focus.envStatus.totalCount ? `${focus.envStatus.configuredCount}/${focus.envStatus.totalCount} 已配置` : '无需额外凭证')}</span>
            </div>
            ${renderEnvChips(focus.envStatus)}
          </section>
          <section class="plugin-focus-section">
            <div class="plugin-focus-section-head">
              <strong>依赖检查</strong>
              <span>${escapeHtml(focus.dependencyCount ? `${focus.dependencyCount} 项待核对` : '无需额外依赖')}</span>
            </div>
            ${renderPluginDependencyDetails(focus.catalogItem)}
          </section>
          <div class="compact-disclosure-stack top-gap">
            ${renderPluginManifestEditor(view, focus)}
            ${renderPluginReadmeEditor(view, focus)}
            ${renderPluginLocalOps(view, focus)}
          </div>
        ` : `
          <div class="plugin-focus-section top-gap">
            <div class="plugin-focus-section-head">
              <strong>目录状态</strong>
              <span>仅运行态</span>
            </div>
            <p class="plugin-focus-note">当前只有运行态。先导入本地目录，才能继续编辑 manifest、依赖和凭证声明。</p>
          </div>
        `}
        <div class="plugin-action-lane-grid top-gap">
          <section class="plugin-action-lane">
            <div class="plugin-focus-section-head">
              <strong>客户端直写</strong>
              <span>不经 Hermes CLI</span>
            </div>
            <p class="plugin-focus-note">Provider、凭证联动、本地目录和文档接管都优先在客户端内完成。</p>
            <div class="toolbar">
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
                action: 'plugin-configure',
                label: focus.catalogItem?.requiresEnv.length ? '配置凭证' : '查看配置',
                attrs: { 'data-name': focus.name },
              })}
              ${focus.directoryPath
                ? buttonHtml({
                  action: 'plugin-open',
                  label: '打开目录',
                  attrs: { 'data-name': focus.name, 'data-path': focus.directoryPath },
                })
                : buttonHtml({ action: 'open-plugin-root', label: '打开插件目录' })}
              ${buttonHtml({ action: 'goto-config-credentials', label: '凭证页' })}
            </div>
          </section>
          <section class="plugin-action-lane plugin-action-lane-runtime">
            <div class="plugin-focus-section-head">
              <strong>运行态安装 / 启停</strong>
              <span>经 Hermes 插件管理器</span>
            </div>
            <p class="plugin-focus-note">当前 Hermes 还没有暴露结构化插件生命周期配置，所以安装、更新、启停、移除仍通过 Hermes 原生插件管理器执行。</p>
            <div class="toolbar">
              ${buttonHtml({
                action: 'plugin-install',
                label: view.runningAction === installActionId ? '安装插件…' : '安装插件',
                kind: focus.installed ? 'secondary' : 'primary',
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !focus.name || focus.installed,
              })}
              ${buttonHtml({
                action: 'plugin-update',
                label: view.runningAction === updateActionId ? '更新插件…' : '更新插件',
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !focus.name,
              })}
              ${buttonHtml({
                action: 'plugin-enable-current',
                label: view.runningAction === enableActionId ? '启用中…' : '启用插件',
                disabled: Boolean(view.runningAction) || !focus.name,
              })}
              ${buttonHtml({
                action: 'plugin-disable-current',
                label: view.runningAction === disableActionId ? '停用中…' : '停用插件',
                disabled: Boolean(view.runningAction) || !focus.name,
              })}
              ${buttonHtml({
                action: 'plugin-remove',
                label: view.runningAction === removeActionId ? '移除插件…' : '移除插件',
                kind: 'secondary',
                disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !focus.name,
              })}
            </div>
          </section>
        </div>
      ` : `
        <div class="top-gap">
          ${emptyStateHtml('还没选插件', '从目录里选择一个插件，或直接输入名称。')}
        </div>
      `}
    </section>
  `;
}

function renderProviderPresetStrip(view, state) {
  if (!state.providerOptions.length) {
    return '';
  }

  return `
    <section class="preset-strip">
      <div class="preset-strip-header">
        <strong>Provider 预设</strong>
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
              ${pillHtml(categoryLabel(item.category), 'neutral')}
              ${pillHtml(sourceLabel(item.source), item.source === 'local' ? 'warn' : 'good')}
              ${pillHtml(trustLabel(item.trust), item.trust === 'local' ? 'warn' : 'neutral')}
            </div>
          </div>
          <p>${escapeHtml(`${categoryLabel(item.category)} · 来源 ${sourceLabel(item.source)} · 信任 ${trustLabel(item.trust)}`)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

export function renderWorkbenchTabs(view) {
  const tabs = [
    { key: 'tools', label: '工具' },
    { key: 'plugins', label: '插件' },
    { key: 'skills', label: '技能' },
    { key: 'runtime', label: '运行快照' },
  ];

  return `
    <div class="tab-bar tab-bar-dense">
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

export function renderWorkbenchRail(view, state) {
  if (view.workbenchTab === 'tools') {
    return `
      <div class="workspace-rail-header">
        <div>
          <strong>平台摘要</strong>
          <p class="workspace-main-copy">查看当前平台的能力接入状态。</p>
        </div>
        ${pillHtml(state.currentPlatform ? state.currentPlatform.displayName : '未选择', state.currentPlatform ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>当前平台</span>
          <strong>${escapeHtml(state.currentPlatform?.displayName || '未解析')}</strong>
        </div>
        <div class="key-value-row">
          <span>运行态启用</span>
          <strong>${escapeHtml(`${state.currentPlatformMetrics.enabled}/${state.currentPlatformMetrics.total}`)}</strong>
        </div>
        <div class="key-value-row">
          <span>平台绑定</span>
          <strong>${escapeHtml(String(state.currentPlatformBindingToolsets.length))}</strong>
        </div>
        <div class="key-value-row">
          <span>顶层覆盖</span>
          <strong>${escapeHtml(`${state.currentPlatformTopLevelCount}/${state.currentPlatformMetrics.total}`)}</strong>
        </div>
      </div>
      ${state.warnings.length > 0
        ? `<div class="warning-stack top-gap">${state.warnings.slice(0, 2).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
        : '<p class="helper-text">当前平台没有明显结构性提醒，可以直接在本页做能力接管与日志核对。</p>'}
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({ action: 'goto-config-toolsets', label: '能力集配置', kind: 'primary' })}
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
          <p class="workspace-main-copy">在当前页完成安装、启停和 Provider 切换。</p>
        </div>
        ${pillHtml(`${state.pluginInstalledCount}/${state.pluginAvailableCount || state.pluginInstalledCount}`, state.pluginInstalledCount > 0 ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>已安装</span>
          <strong>${escapeHtml(String(state.pluginInstalledCount))}</strong>
        </div>
        <div class="key-value-row">
          <span>本地目录</span>
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
          <strong>${escapeHtml(providerDisplayLabel(state.configuredProviderDisplay))}</strong>
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
          label: state.configuredProviderDisplay === 'builtin-file' ? '当前内置' : '切回内置',
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
          <p class="workspace-main-copy">查看目录、安装状态和来源信息。</p>
        </div>
        ${pillHtml(`${state.runtimeSkills.length} 项`, state.runtimeSkills.length > 0 ? 'good' : 'warn')}
      </div>
      <div class="detail-list compact">
        <div class="key-value-row">
          <span>内置 / 本地</span>
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
        ? `<div class="warning-stack top-gap"><div class="warning-item">${escapeHtml(`运行态 local 技能 ${state.sourceLocalCount} 个，本地目录 ${view.skills.length} 个，安装态存在偏差。`)}</div></div>`
        : '<p class="helper-text">当前目录态和运行态没有明显偏差，可以继续按分类筛选。</p>'}
      <div class="workspace-rail-toolbar top-gap">
        ${buttonHtml({ action: 'goto-skills', label: '进入 Skills 页', kind: 'primary' })}
        ${buttonHtml({ action: 'goto-config-toolsets', label: '核对能力集' })}
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
        <p class="workspace-main-copy">这里集中查看提醒和最近结果。</p>
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

export function renderToolsWorkbench(view, state, runningToolBatchEnable, runningToolBatchDisable) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>工具</strong>
            <p class="workspace-main-copy">查看当前平台的工具接入状态并执行批量操作。</p>
          </div>
          <div class="pill-row">
            ${pillHtml(state.currentPlatform?.displayName || '未选择平台', state.currentPlatform ? 'good' : 'warn')}
            ${pillHtml(`${state.currentPlatformMetrics.enabled}/${state.currentPlatformMetrics.total}`, state.currentPlatformMetrics.enabled > 0 ? 'good' : 'warn')}
            ${pillHtml(`${state.currentPlatformBindingToolsets.length} 平台绑定`, state.currentPlatformBindingToolsets.length ? 'neutral' : 'warn')}
            ${pillHtml(`${state.workspaceToolsets.length} 顶层能力`, state.workspaceToolsets.length ? 'neutral' : 'warn')}
          </div>
        </div>
        <div class="compact-overview-grid compact-overview-grid-dense tool-governance-grid">
          <section class="shell-card shell-card-dense tool-governance-shell">
            <div class="shell-card-header">
              <div>
                <strong>当前平台</strong>
                <p class="shell-card-copy">平台能力、顶层 Toolsets 和批量操作都集中在这里。</p>
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
              <div class="tool-signal-grid">
                <section class="tool-signal-card">
                  <span class="tool-signal-label">平台绑定</span>
                  <strong class="tool-signal-value">${escapeHtml(previewList(state.currentPlatformBindingToolsets, '未绑定'))}</strong>
                  <span class="tool-signal-meta">${escapeHtml(state.currentPlatformBinding ? '已接管到 platform_toolsets' : '当前还没有平台绑定')}</span>
                </section>
                <section class="tool-signal-card">
                  <span class="tool-signal-label">运行态启用</span>
                  <strong class="tool-signal-value">${escapeHtml(previewList(state.currentPlatformRuntimeEnabledNames, '无启用项'))}</strong>
                  <span class="tool-signal-meta">这里只显示运行状态</span>
                </section>
                <section class="tool-signal-card">
                  <span class="tool-signal-label">顶层覆盖</span>
                  <strong class="tool-signal-value">${escapeHtml(`${state.currentPlatformTopLevelCount}/${state.currentPlatformMetrics.total}`)}</strong>
                  <span class="tool-signal-meta">${escapeHtml(previewList(state.workspaceToolsets, '顶层未配置', 6))}</span>
                </section>
              </div>
              <div class="form-grid top-gap">
                <label class="field-stack">
                  <span>批量工具名称</span>
                  <input class="search-input" id="extensions-tool-input" placeholder="web, browser, terminal" ${view.runningAction ? 'disabled' : ''}>
                </label>
                <label class="field-stack">
                  <span>批量预览</span>
                  <input class="search-input" id="extensions-tool-preview" readonly>
                </label>
              </div>
              <div class="toolbar top-gap">
                ${buttonHtml({
                  action: 'tool-batch-enable',
                  label: runningToolBatchEnable ? '接入中…' : '接入当前平台',
                  kind: 'primary',
                  disabled: Boolean(view.runningAction) || state.batchToolNames.length === 0,
                })}
                ${buttonHtml({
                  action: 'tool-batch-disable',
                  label: runningToolBatchDisable ? '移出中…' : '移出当前平台',
                  disabled: Boolean(view.runningAction) || state.batchToolNames.length === 0,
                })}
                ${buttonHtml({ action: 'goto-config-toolsets', label: '能力集配置' })}
              </div>
            ` : emptyStateHtml('暂无平台', '当前还没有读取到可操作的平台。')}
          </section>
          <section class="shell-card shell-card-dense shell-card-muted tool-governance-shell">
            <div class="shell-card-header">
              <div>
                <strong>能力对照</strong>
                <p class="shell-card-copy">查看配置和运行态之间的差异。</p>
              </div>
              ${pillHtml(
                state.currentPlatformMissingTopLevel.length || state.currentPlatformRuntimeOnly.length || state.currentPlatformBindingOnly.length
                  ? '存在差异'
                  : '已对齐',
                state.currentPlatformMissingTopLevel.length || state.currentPlatformRuntimeOnly.length || state.currentPlatformBindingOnly.length
                  ? 'warn'
                  : 'good',
              )}
            </div>
            ${keyValueRowsHtml([
              { label: '平台绑定', value: previewList(state.currentPlatformBindingToolsets, '未绑定', 4) },
              { label: '运行态启用', value: previewList(state.currentPlatformRuntimeEnabledNames, '无启用项', 4) },
              { label: '仅运行态', value: previewList(state.currentPlatformRuntimeOnly, '无', 4) },
              { label: '仅配置态', value: previewList(state.currentPlatformBindingOnly, '无', 4) },
              { label: '顶层缺口', value: previewList(state.currentPlatformMissingTopLevel, '无', 4) },
            ])}
          </section>
        </div>
      </section>
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>平台工具清单</strong>
            <p class="workspace-main-copy">每张卡同时展示运行态状态和配置态暴露，动作统一收成“接入平台 / 移出平台”。</p>
          </div>
          <div class="pill-row">
            ${pillHtml(`${state.currentPlatformConfigEnabledCount}/${state.currentPlatformMetrics.total} 已纳入平台`, state.currentPlatformConfigEnabledCount ? 'good' : 'warn')}
            ${state.currentPlatformMissingTopLevel.length ? pillHtml(`${state.currentPlatformMissingTopLevel.length} 个待补顶层`, 'warn') : ''}
          </div>
        </div>
        <div class="workspace-list-scroll">
          ${renderToolCards(view, state)}
        </div>
      </section>
    </div>
  `;
}

export function renderPluginsWorkbench(view, state) {
  const focus = resolvePluginGovernanceTarget(view, state);
  const activeGroup = resolvePluginWorkspaceGroup(view.pluginWorkspaceSection);
  const workspaceBody = activeGroup.key === 'catalog'
    ? renderPluginCatalogWorkspace(view, state, focus)
    : activeGroup.key === 'provider'
      ? renderPluginProviderWorkspace(view, state)
      : activeGroup.key === 'local'
        ? renderPluginLocalWorkspace(view)
        : renderPluginTargetWorkbench(view, state, focus);

  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>插件</strong>
            <p class="workspace-main-copy">目录、目标、Provider 和本地接入分开显示。</p>
          </div>
          <div class="toolbar">
            ${pillHtml(`${state.pluginInstalledCount} 已安装`, state.pluginInstalledCount ? 'good' : 'warn')}
            ${pillHtml(`${state.pluginEnvRequiredCount} 需凭证`, state.pluginEnvRequiredCount ? 'warn' : 'neutral')}
            ${pillHtml(providerDisplayLabel(state.configuredProviderDisplay), 'neutral')}
            ${pillHtml(focus.name || '等待目标', focus.name ? 'good' : 'warn')}
            ${buttonHtml({ action: 'refresh', label: '刷新运行态', disabled: Boolean(view.runningAction) })}
          </div>
        </div>
        ${renderPluginWorkspaceTabs(activeGroup.key)}
      </section>
      ${workspaceBody}
    </div>
  `;
}

export function renderSkillsWorkbench(view, state) {
  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>技能安装态</strong>
            <p class="workspace-main-copy">这里查看运行态来源和信任状态。</p>
          </div>
          <div class="toolbar">
            ${pillHtml(`${state.runtimeSkills.length} 运行态`, 'neutral')}
            ${pillHtml(`${state.sourceBuiltinCount}/${state.sourceLocalCount} 内置/本地`, 'neutral')}
            ${pillHtml(`${state.filteredSkills.length} 命中`, 'neutral')}
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
        <div class="control-card-grid control-card-grid-dense">
          <section class="action-card action-card-compact">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">对账</p>
                <h3 class="action-card-title">目录态与运行态</h3>
              </div>
              ${pillHtml(state.runtimeSkillMismatch ? '待校对' : '已对齐', state.runtimeSkillMismatch ? 'warn' : 'good')}
            </div>
            <p class="workspace-inline-meta">${escapeHtml(`目录 ${view.skills.length} · 运行本地 ${state.sourceLocalCount} · 能力集 ${(view.dashboard.config.toolsets ?? []).join(', ') || '—'}`)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-config-toolsets', label: '核对能力集', kind: 'primary' })}
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
              ${pillHtml(view.dashboard.config.memoryEnabled ? '记忆开启' : '记忆关闭', view.dashboard.config.memoryEnabled ? 'good' : 'warn')}
            </div>
            <p class="workspace-inline-meta">${escapeHtml(`Gateway ${view.dashboard.gateway?.gatewayState ?? 'unknown'} · Cron ${view.dashboard.counts?.cronJobs ?? 0} · Provider ${view.dashboard.config.memoryProvider || '—'}`)}</p>
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

export function renderRuntimeWorkbench(view, state) {
  return `
    <div class="workspace-bottom-grid workspace-bottom-grid-dense">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>最近动作回执</strong>
            <p class="workspace-main-copy">显示最近一次操作结果。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行操作', '执行 tools / plugins / provider 相关动作后，这里会显示最近结果。')}
      </section>
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>运行态原始对照</strong>
            <p class="workspace-main-copy">需要时再查看 raw 输出。</p>
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
