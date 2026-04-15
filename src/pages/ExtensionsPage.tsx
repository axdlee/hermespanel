import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, InfoTip, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildLogsDrilldownIntent,
  type DrilldownSeed,
} from '../lib/drilldown';
import { formatTimestamp, truncate } from '../lib/format';
import type {
  CommandRunResult,
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  NamedCount,
  RuntimeSkillItem,
  SkillItem,
  ToolPlatformInventory,
  ToolRuntimeItem,
} from '../types';
import { isExtensionsPageIntent, type ExtensionsPageIntent, type PageProps } from './types';

type RawOutputKind = 'tools' | 'memory' | 'plugins' | 'skills';
type ExtensionAction = 'enable' | 'disable';
type ExtensionsTabKey = 'overview' | 'runtime' | 'operations';
type ExtensionsOverviewViewKey = 'launch' | 'status' | 'focus';
type ExtensionsRuntimeViewKey = 'focus' | 'platforms' | 'skills';
type ExtensionsOperationsViewKey = 'setup' | 'batch' | 'plugins' | 'output';

const EXTENSIONS_TABS: Array<{ key: ExtensionsTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用概览', hint: '先看扩展层有没有问题，以及下一步该去哪里。' },
  { key: 'runtime', label: '工具与来源', hint: '查看工具平台、运行态技能来源和能力分布。' },
  { key: 'operations', label: '插件与材料', hint: '低频 CLI 接管、插件操作和原始输出都收在这里。' },
];

const EXTENSIONS_OVERVIEW_VIEWS: Array<{
  key: ExtensionsOverviewViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'launch', label: '常用去向', icon: '🚀', hint: '先决定去工具平台、技能来源、记忆链路还是插件进阶。' },
  { key: 'status', label: '当前判断', icon: '🌤️', hint: '只看扩展层最关键的状态摘要和提醒，不把平台焦点一起铺开。' },
  { key: 'focus', label: '当前焦点', icon: '🧰', hint: '只围绕当前平台做轻量判断，完整运行清单继续放在下一层。' },
];

const EXTENSIONS_RUNTIME_VIEWS: Array<{
  key: ExtensionsRuntimeViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'focus', label: '焦点平台', icon: '🧰', hint: '默认先围绕一个平台完成核对，不把平台入口、来源筛选和列表同时铺开。' },
  { key: 'platforms', label: '平台入口', icon: '🛰️', hint: '需要切换平台或看平台分布时，再进入这一层。' },
  { key: 'skills', label: '来源观察', icon: '🧩', hint: '技能来源、trust 和筛选结果后置到独立观察层。' },
];

const EXTENSIONS_OPERATIONS_VIEWS: Array<{
  key: ExtensionsOperationsViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'setup', label: '官方入口', icon: '🚪', hint: 'Tools、Skills、Memory 和插件安装入口统一放在这里。' },
  { key: 'batch', label: '批量工具', icon: '🪄', hint: '一次性启停多个工具属于进阶动作，继续后置。' },
  { key: 'plugins', label: '插件编排', icon: '🔌', hint: '插件启停和已安装插件清单单独放一层。' },
  { key: 'output', label: '命令回显', icon: '🧾', hint: '最近命令结果和原始 CLI 快照只在这一层展开。' },
];

function countCategories(items: RuntimeSkillItem[]): NamedCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.category || 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function normalizeToolNames(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.split(/[,\n，；;]/)) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function matchingPlatformSummary(extensions: ExtensionsSnapshot, platformKey: string) {
  return extensions.toolPlatforms.find((item) => item.name.trim().toLowerCase() === platformKey.trim().toLowerCase());
}

function inventoryMetrics(platform: ToolPlatformInventory | null) {
  if (!platform) {
    return { enabled: 0, total: 0 };
  }
  const enabled = platform.items.filter((item) => item.enabled).length;
  return { enabled, total: platform.items.length };
}

function toolActionState(action: ExtensionAction, platformKey: string, names: string[]) {
  return `tool:${action}:${platformKey}:${names.join(',')}`;
}

function pluginActionState(action: ExtensionAction, name: string) {
  return `plugin:${action}:${name.trim()}`;
}

function primaryInvestigationTool(investigation: ExtensionsPageIntent | null) {
  return investigation?.context?.toolNames.find((item) => item.trim().length > 0);
}

export function ExtensionsPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [investigation, setInvestigation] = useState<ExtensionsPageIntent | null>(null);
  const [rawKind, setRawKind] = useState<RawOutputKind>('tools');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [toolNamesInput, setToolNamesInput] = useState('');
  const [pluginNameInput, setPluginNameInput] = useState('');
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastCommandLabel, setLastCommandLabel] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [activeTab, setActiveTab] = useState<ExtensionsTabKey>('overview');
  const [overviewView, setOverviewView] = useState<ExtensionsOverviewViewKey>('launch');
  const [runtimeView, setRuntimeView] = useState<ExtensionsRuntimeViewKey>('focus');
  const [operationsView, setOperationsView] = useState<ExtensionsOperationsViewKey>('setup');
  const [showAllRuntimeTools, setShowAllRuntimeTools] = useState(false);
  const [showAllPlatformSummaries, setShowAllPlatformSummaries] = useState(false);
  const [showAllSkillResults, setShowAllSkillResults] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [nextExtensions, nextDashboard, nextInstallation, nextSkills] = await Promise.all([
        api.getExtensionsSnapshot(profile),
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.listSkills(profile),
      ]);
      setExtensions(nextExtensions);
      setDashboard(nextDashboard);
      setInstallation(nextInstallation);
      setSkills(nextSkills);
      setSelectedPlatform((current) =>
        nextExtensions.toolInventory.some((item) => item.platformKey === current)
          ? current
          : nextExtensions.toolInventory[0]?.platformKey ?? '',
      );
      setPluginNameInput((current) => current.trim() || nextExtensions.plugins.items[0] || '');
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `finder:${label}`,
      label,
      notify,
      path,
      revealInFinder,
      setBusy: setRunningAction,
    });
  }

  async function openInTerminal(actionKey: string, label: string, command: string, confirmMessage?: string) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastCommandLabel(resultLabel);
        setLastCommand(result);
      },
      profile,
      setBusy: setRunningAction,
      workingDirectory: installation?.hermesHomeExists ? installation.hermesHome : null,
    });
  }

  async function executeToolAction(
    action: ExtensionAction,
    platformKey: string,
    names: string[],
    options?: { clearInput?: boolean; label?: string },
  ) {
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
    setRunningAction(actionId);
    try {
      const result = await api.runToolAction(action, platformKey, normalizedNames, profile);
      setLastCommandLabel(options?.label ?? normalizedNames.join('、'));
      setLastCommand(result);
      if (options?.clearInput) {
        setToolNamesInput('');
      }
      notify(
        result.success ? 'success' : 'error',
        result.success
          ? `${options?.label ?? normalizedNames.join('、')} 已执行 ${action}。`
          : `${options?.label ?? normalizedNames.join('、')} 执行 ${action} 失败，请查看命令输出。`,
      );
      await load({ silent: true });
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function executePluginAction(action: ExtensionAction, name: string, options?: { clearInput?: boolean }) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      notify('error', '请输入 plugin 名称。');
      return;
    }

    const actionId = pluginActionState(action, normalizedName);
    setRunningAction(actionId);
    try {
      const result = await api.runPluginAction(action, normalizedName, profile);
      setLastCommandLabel(`插件 ${normalizedName} · ${action}`);
      setLastCommand(result);
      if (options?.clearInput) {
        setPluginNameInput(normalizedName);
      }
      notify(
        result.success ? 'success' : 'error',
        result.success
          ? `插件 ${normalizedName} 已执行 ${action}。`
          : `插件 ${normalizedName} 执行 ${action} 失败，请查看命令输出。`,
      );
      await load({ silent: true });
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  useEffect(() => {
    setLastCommandLabel(null);
    setLastCommand(null);
    setActiveTab('overview');
    setOverviewView('launch');
    setRuntimeView('focus');
    setOperationsView('setup');
    setShowAllRuntimeTools(false);
    setShowAllPlatformSummaries(false);
    setShowAllSkillResults(false);
    void load();
  }, [profile]);

  useEffect(() => {
    if (!isExtensionsPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    setRawKind(pageIntent.rawKind ?? 'tools');
    setQuery(pageIntent.query ?? '');
    setSourceFilter(pageIntent.sourceFilter ?? 'all');
    if (pageIntent.toolNames?.length) {
      setToolNamesInput(pageIntent.toolNames.join(', '));
    }
    if (pageIntent.pluginName) {
      setPluginNameInput(pageIntent.pluginName);
    }
    setRuntimeView(
      pageIntent.rawKind === 'skills'
        ? 'skills'
        : pageIntent.selectedPlatform || pageIntent.toolNames?.length || pageIntent.rawKind === 'tools'
          ? 'focus'
          : 'focus',
    );
    setOperationsView(
      pageIntent.pluginName
        ? 'plugins'
        : pageIntent.rawKind === 'plugins' || pageIntent.rawKind === 'memory'
          ? 'output'
          : 'setup',
    );
    setActiveTab(
      pageIntent.pluginName || pageIntent.rawKind === 'plugins' || pageIntent.rawKind === 'memory'
        ? 'operations'
        : pageIntent.selectedPlatform || pageIntent.toolNames?.length || pageIntent.rawKind === 'tools' || pageIntent.rawKind === 'skills'
          ? 'runtime'
          : 'overview',
    );
    notify('info', `${pageIntent.headline} 已带入扩展工作台。`);
    consumePageIntent();
  }, [consumePageIntent, notify, pageIntent]);

  useEffect(() => {
    if (!extensions || !investigation?.selectedPlatform) {
      return;
    }
    if (extensions.toolInventory.some((item) => item.platformKey === investigation.selectedPlatform)) {
      setSelectedPlatform(investigation.selectedPlatform);
    }
  }, [extensions, investigation]);

  useEffect(() => {
    setShowAllRuntimeTools(false);
  }, [selectedPlatform]);

  useEffect(() => {
    if (runtimeView !== 'focus') {
      setShowAllRuntimeTools(false);
    }
    if (runtimeView !== 'platforms') {
      setShowAllPlatformSummaries(false);
    }
    if (runtimeView !== 'skills') {
      setShowAllSkillResults(false);
    }
  }, [runtimeView]);

  const runtimeSkills = extensions?.runtimeSkills ?? [];
  const sourceOptions = useMemo(
    () => ['all', ...Array.from(new Set(runtimeSkills.map((item) => item.source).filter(Boolean))).sort()],
    [runtimeSkills],
  );
  const categoryCounts = useMemo(() => countCategories(runtimeSkills), [runtimeSkills]);
  const filteredSkills = useMemo(() => {
    const term = query.trim().toLowerCase();
    return runtimeSkills.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) {
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
  }, [query, runtimeSkills, sourceFilter]);

  const currentPlatform = useMemo(() => {
    if (!extensions?.toolInventory.length) {
      return null;
    }
    return (
      extensions.toolInventory.find((item) => item.platformKey === selectedPlatform)
      ?? extensions.toolInventory[0]
    );
  }, [extensions, selectedPlatform]);

  const batchToolNames = useMemo(() => normalizeToolNames(toolNamesInput), [toolNamesInput]);

  if (loading || !extensions || !dashboard || !installation) {
    return <LoadingState label="正在构建 Hermes 扩展能力工作台。" />;
  }

  const toolsEnabled = extensions.toolPlatforms.reduce((sum, item) => sum + item.enabledCount, 0);
  const toolsTotal = extensions.toolPlatforms.reduce((sum, item) => sum + item.totalCount, 0);
  const toollessPlatforms = extensions.toolPlatforms.filter((item) => item.enabledCount === 0);
  const sourceLocalCount = extensions.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
  const sourceBuiltinCount = extensions.skillSourceCounts.find((item) => item.name === 'builtin')?.count ?? 0;
  const runtimeSkillMismatch = sourceLocalCount !== skills.length;
  const pluginTerminalName = pluginNameInput.trim();
  const warnings: string[] = [];

  if (!installation.binaryFound) {
    warnings.push('当前没有检测到 Hermes CLI，扩展安装、技能配置和 memory provider 切换都无法真正执行。');
  }
  if (!extensions.toolPlatforms.length) {
    warnings.push('当前没有解析出任何 tools summary 平台，说明 Hermes 工具面摘要没有成功返回。');
  }
  if (toollessPlatforms.length > 0) {
    warnings.push(`存在 ${toollessPlatforms.length} 个平台当前没有启用任何工具：${toollessPlatforms.map((item) => item.name).join('、')}。`);
  }
  if (extensions.plugins.installedCount === 0) {
    warnings.push('当前没有通过 `hermes plugins list` 检测到已安装插件，扩展层仍以 builtin 与 local skills 为主。');
  }
  if (dashboard.config.memoryProvider && dashboard.config.memoryProvider !== 'builtin-file' && extensions.memoryRuntime.provider.includes('none')) {
    warnings.push(`配置里声明了 memory provider「${dashboard.config.memoryProvider}」，但运行态显示仍是 built-in only，建议核对记忆插件是否真的生效。`);
  }
  if (runtimeSkillMismatch) {
    warnings.push(`CLI skills list 识别到 ${sourceLocalCount} 个 local 技能，而本地目录扫描到 ${skills.length} 个，说明“安装态”和“文件态”之间可能有差异。`);
  }
  if (dashboard.gateway?.gatewayState !== 'running' && dashboard.counts.cronJobs > 0) {
    warnings.push('当前 gateway 未运行，如果 cron 作业里有远端交付目标，扩展能力没法在消息平台侧真正闭环验证。');
  }
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);

  const rawOutput = rawKind === 'tools'
    ? extensions.toolsRawOutput
    : rawKind === 'memory'
      ? extensions.memoryRuntime.rawOutput
      : rawKind === 'plugins'
        ? extensions.plugins.rawOutput
        : extensions.skillsRawOutput;

  const currentPlatformSummary = currentPlatform ? matchingPlatformSummary(extensions, currentPlatform.platformKey) : undefined;
  const currentPlatformMetrics = inventoryMetrics(currentPlatform);
  const sourceDistributionSummary = extensions.skillSourceCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—';
  const topCategorySummary = categoryCounts.slice(0, 4).map((item) => `${item.name} ${item.count}`).join(' · ') || '—';
  const focusNextStep = !currentPlatform
    ? '先补齐工具平台摘要'
    : currentPlatformMetrics.enabled === 0
      ? '先为当前平台启用至少一个工具'
      : runtimeSkillMismatch
        ? '再去核对技能来源与本地目录'
        : '可以继续按平台治理或进入技能页';
  const visiblePluginItems = extensions.plugins.items.slice(0, 6);
  const remainingPluginCount = Math.max(0, extensions.plugins.items.length - visiblePluginItems.length);
  const visibleMemoryPlugins = extensions.memoryRuntime.installedPlugins.slice(0, 4);
  const remainingMemoryPluginCount = Math.max(0, extensions.memoryRuntime.installedPlugins.length - visibleMemoryPlugins.length);
  const runningToolBatchEnable = runningAction === toolActionState('enable', currentPlatform?.platformKey ?? '', batchToolNames);
  const runningToolBatchDisable = runningAction === toolActionState('disable', currentPlatform?.platformKey ?? '', batchToolNames);
  const runningPluginEnable = runningAction === pluginActionState('enable', pluginNameInput);
  const runningPluginDisable = runningAction === pluginActionState('disable', pluginNameInput);
  const visibleRuntimeTools = showAllRuntimeTools ? currentPlatform?.items ?? [] : (currentPlatform?.items ?? []).slice(0, 4);
  const prioritizedToolPlatforms = [...extensions.toolPlatforms].sort((left, right) => {
    const leftWeight = left.enabledCount > 0 ? 1 : 0;
    const rightWeight = right.enabledCount > 0 ? 1 : 0;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return right.enabledCount - left.enabledCount;
  });
  const visiblePlatformSummaries = showAllPlatformSummaries ? prioritizedToolPlatforms : prioritizedToolPlatforms.slice(0, 4);
  const visibleFilteredSkills = showAllSkillResults ? filteredSkills : filteredSkills.slice(0, 6);
  const activeRuntimeView = EXTENSIONS_RUNTIME_VIEWS.find((item) => item.key === runtimeView) ?? EXTENSIONS_RUNTIME_VIEWS[0];
  const activeOperationsView = EXTENSIONS_OPERATIONS_VIEWS.find((item) => item.key === operationsView) ?? EXTENSIONS_OPERATIONS_VIEWS[0];
  const activeOverviewView = EXTENSIONS_OVERVIEW_VIEWS.find((item) => item.key === overviewView) ?? EXTENSIONS_OVERVIEW_VIEWS[0];
  const hiddenRuntimeToolCount = Math.max(0, (currentPlatform?.items.length ?? 0) - visibleRuntimeTools.length);
  const hiddenPlatformSummaryCount = Math.max(0, extensions.toolPlatforms.length - visiblePlatformSummaries.length);
  const hiddenSkillResultCount = Math.max(0, filteredSkills.length - visibleFilteredSkills.length);
  const relaySeed: DrilldownSeed = investigation
    ? {
        sourcePage: 'extensions',
        headline: investigation.headline,
        description: investigation.description,
        context: investigation.context,
      }
    : {
        sourcePage: 'extensions',
        headline: '来自 Extensions 的能力下钻',
        description: '继续围绕工具面、技能来源、插件层和记忆 provider 做核对。',
      };
  const extensionLogsIntent = buildLogsDrilldownIntent(relaySeed, {
    description: '把当前能力面线索继续带到日志页，核对工具和插件是否真的在运行期生效。',
    logName: 'agent',
    contains: batchToolNames[0] || primaryInvestigationTool(investigation) || query || currentPlatform?.platformKey || '',
    limit: '160',
  });
  const extensionDiagnosticsIntent = buildDiagnosticsDrilldownIntent(relaySeed, {
    description: '继续做扩展层体检，确认 tools、skills、plugins 和 memory provider 是否一致。',
    suggestedCommand: batchToolNames.length > 0 || primaryInvestigationTool(investigation) ? 'tools-summary' : 'plugins-list',
    logName: 'agent',
  });
  const extensionConfigIntent = buildConfigDrilldownIntent(relaySeed, {
    description: '带着当前能力面线索回到配置中心，核对 toolsets、context engine 与 memory provider。',
    focus: currentPlatform ? 'toolsets' : 'memory',
    suggestedCommand: 'config-check',
  });

  function renderToolRow(item: ToolRuntimeItem) {
    if (!currentPlatform) {
      return null;
    }
    const enableActionId = toolActionState('enable', currentPlatform.platformKey, [item.name]);
    const disableActionId = toolActionState('disable', currentPlatform.platformKey, [item.name]);
    const toolLogsIntent = buildLogsDrilldownIntent(relaySeed, {
      description: `查看工具 ${item.name} 的运行日志。`,
      logName: 'agent',
      contains: item.name,
      limit: '160',
    });
    return (
      <div className="list-card" key={`${currentPlatform.platformKey}:${item.name}`}>
        <div className="list-card-title">
          <strong>{item.name}</strong>
          <div className="pill-row">
            <Pill tone={item.enabled ? 'good' : 'warn'}>{item.enabled ? 'enabled' : 'disabled'}</Pill>
            {item.description ? <Pill>{truncate(item.description, 48)}</Pill> : null}
          </div>
        </div>
        <p>{item.description || 'CLI 没有返回额外描述。'}</p>
        <Toolbar>
          <Button
            kind="primary"
            onClick={() => void executeToolAction('enable', currentPlatform.platformKey, [item.name], { label: item.name })}
            disabled={runningAction !== null || item.enabled}
          >
            {runningAction === enableActionId ? '启用中…' : '启用'}
          </Button>
          <Button
            kind="secondary"
            onClick={() => void executeToolAction('disable', currentPlatform.platformKey, [item.name], { label: item.name })}
            disabled={runningAction !== null || !item.enabled}
          >
            {runningAction === disableActionId ? '停用中…' : '停用'}
          </Button>
          <Button onClick={() => navigate('logs', toolLogsIntent)}>
            查看日志
          </Button>
        </Toolbar>
      </div>
    );
  }

  const overviewSection = (
    <>
      <Panel title="总览入口" subtitle="扩展首页继续拆成二级工作面，默认只展开一个主区块。">
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {EXTENSIONS_OVERVIEW_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${overviewView === item.key ? 'active' : ''}`}
              onClick={() => setOverviewView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeOverviewView.hint}</p>
      </Panel>

      {overviewView === 'launch' ? (
        <Panel title="常用去向" subtitle="首页只露出真正高频的 4 个入口，其他治理动作继续收在子标签。">
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => {
                setRuntimeView('focus');
                setActiveTab('runtime');
              }}
            >
              <strong><span className="dashboard-shortcut-icon">🧰</span>工具平台</strong>
              <span>{currentPlatform ? `${currentPlatform.displayName} ${currentPlatformMetrics.enabled}/${currentPlatformMetrics.total}` : '先选择一个工具平台'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('skills')}>
              <strong><span className="dashboard-shortcut-icon">🧩</span>技能来源</strong>
              <span>{runtimeSkillMismatch ? '运行态和目录态存在差异' : `${runtimeSkills.length} 个运行态技能已对齐`}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('memory')}>
              <strong><span className="dashboard-shortcut-icon">🧠</span>记忆链路</strong>
              <span>{extensions.memoryRuntime.provider} · {extensions.memoryRuntime.installedPlugins.length} 个相关插件</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => {
                setOperationsView('setup');
                setActiveTab('operations');
              }}
            >
              <strong><span className="dashboard-shortcut-icon">🛠️</span>插件与进阶</strong>
              <span>{extensions.plugins.installedCount > 0 ? `${extensions.plugins.installedCount} 个插件与批量操作已后置` : '批量开关和原始输出都已后置'}</span>
            </button>
          </div>
          <p className="helper-text top-gap">把平台、技能、记忆和插件拆成四条清晰去向，避免首页同时堆很多解释卡片。</p>
        </Panel>
      ) : null}

      {overviewView === 'status' ? (
        <Panel title="当前判断" subtitle="先看工具面、技能来源、记忆链路和插件层是否对齐，不把所有运行清单直接摊开。">
          <div className="workspace-summary-strip">
            <div className="summary-mini-card">
              <span className="summary-mini-label">工具平台</span>
              <strong className="summary-mini-value">{extensions.toolPlatforms.length ? `${extensions.toolPlatforms.length} 个平台` : '未解析'}</strong>
              <span className="summary-mini-meta">
                {toollessPlatforms.length === 0 ? '当前平台都已挂上部分工具' : `无工具平台 ${toollessPlatforms.length} 个`}
              </span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">技能来源</span>
              <strong className="summary-mini-value">{runtimeSkillMismatch ? '安装态有差异' : '安装态已对齐'}</strong>
              <span className="summary-mini-meta">CLI local {sourceLocalCount} · 本地目录 {skills.length}</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">记忆链路</span>
              <strong className="summary-mini-value">{extensions.memoryRuntime.provider}</strong>
              <span className="summary-mini-meta">Built-in {extensions.memoryRuntime.builtInStatus} · 可用记忆插件 {extensions.memoryRuntime.installedPlugins.length}</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">插件层</span>
              <strong className="summary-mini-value">{extensions.plugins.installedCount > 0 ? `${extensions.plugins.installedCount} 个` : '未安装'}</strong>
              <span className="summary-mini-meta">{extensions.plugins.installHint || '当前主要依赖 builtin 与 local skills。'}</span>
            </div>
          </div>

          {extensions.memoryRuntime.installedPlugins.length > 0 || extensions.plugins.items.length > 0 ? (
            <div className="pill-row top-gap">
              {visibleMemoryPlugins.map((item) => (
                <Pill key={`${item.name}:${item.availability}`}>{item.name} · {item.availability}</Pill>
              ))}
              {remainingMemoryPluginCount > 0 ? <Pill>{`+${remainingMemoryPluginCount} 个记忆插件`}</Pill> : null}
              {visiblePluginItems.map((item) => (
                <Pill key={item}>{item}</Pill>
              ))}
              {remainingPluginCount > 0 ? <Pill>{`+${remainingPluginCount} 个插件`}</Pill> : null}
            </div>
          ) : null}

          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack">
                {overviewWarnings.map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
              {remainingWarningCount > 0 ? (
                <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在“工具与来源”和“插件与材料”里。</p>
              ) : null}
            </>
          ) : (
            <EmptyState title="扩展层状态清晰" description="当前没有发现明显的扩展层结构性问题，可以继续按平台或技能来源看细节。" />
          )}

          <Toolbar>
            <Button kind="primary" onClick={() => { setRuntimeView('focus'); setActiveTab('runtime'); }}>打开工具与来源</Button>
            <Button onClick={() => navigate('config', extensionConfigIntent)}>核对配置</Button>
            <Button onClick={() => navigate('logs', extensionLogsIntent)}>查看日志</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {overviewView === 'focus' ? (
        <Panel title="当前焦点平台" subtitle="只保留当前平台的核心判断，完整运行清单与批量动作继续留在下一层。">
          <div className="detail-list compact">
            <KeyValueRow label="当前平台" value={currentPlatform?.displayName || '尚未选择平台'} />
            <KeyValueRow label="已启用工具" value={currentPlatform ? `${currentPlatformMetrics.enabled}/${currentPlatformMetrics.total}` : '—'} />
            <KeyValueRow label="来源分布" value={sourceDistributionSummary} />
            <KeyValueRow label="下一步" value={focusNextStep} />
          </div>
          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => { setRuntimeView('focus'); setActiveTab('runtime'); }}>按平台治理</Button>
            <Button onClick={() => navigate('skills')}>去技能页</Button>
            <Button onClick={() => navigate('memory')}>去记忆页</Button>
          </Toolbar>
        </Panel>
      ) : null}
    </>
  );

  const runtimeSection = (
    <>
      <Panel
        title="工具与来源入口"
        subtitle="平台核对、平台入口和来源观察拆成独立子视图，默认只展开一层。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {EXTENSIONS_RUNTIME_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${runtimeView === item.key ? 'active' : ''}`}
              onClick={() => setRuntimeView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeRuntimeView.hint}</p>
      </Panel>

      {runtimeView === 'focus' ? (
        <Panel
          title="当前平台治理"
          subtitle="先围绕一个焦点平台完成启停与核对，再决定是否继续逐项展开。"
          aside={(
            <Toolbar>
              <select
                className="select-input"
                value={currentPlatform?.platformKey ?? ''}
                onChange={(event) => setSelectedPlatform(event.target.value)}
                disabled={!extensions.toolInventory.length || runningAction !== null}
              >
                {extensions.toolInventory.map((item) => (
                  <option key={item.platformKey} value={item.platformKey}>
                    {item.displayName}
                  </option>
                ))}
              </select>
              <Button onClick={() => void load({ silent: true })} disabled={runningAction !== null}>刷新运行态</Button>
            </Toolbar>
          )}
        >
          {currentPlatform ? (
            <>
              <div className="workspace-summary-strip">
                <section className="summary-mini-card">
                  <span className="summary-mini-label">Inventory</span>
                  <strong className="summary-mini-value">{currentPlatformMetrics.enabled}/{currentPlatformMetrics.total}</strong>
                  <span className="summary-mini-meta">{currentPlatform.displayName} 当前可治理 {currentPlatform.items.length} 项</span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">Summary Drift</span>
                  <strong className="summary-mini-value">{currentPlatformSummary ? '已对齐' : '缺摘要'}</strong>
                  <span className="summary-mini-meta">
                    {currentPlatformSummary
                      ? `${currentPlatformSummary.enabledCount}/${currentPlatformSummary.totalCount} 与运行态可交叉核对`
                      : '建议进入诊断页复核 tools summary'}
                  </span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">下一步</span>
                  <strong className="summary-mini-value">{focusNextStep}</strong>
                  <span className="summary-mini-meta">这里只保留日常核对，批量启停已后置到进阶标签</span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">日志线索</span>
                  <strong className="summary-mini-value">{batchToolNames[0] || primaryInvestigationTool(investigation) || currentPlatform.platformKey}</strong>
                  <span className="summary-mini-meta">日志与诊断会优先带上当前平台或焦点工具</span>
                </section>
              </div>
              <Toolbar className="top-gap">
                <Button kind="primary" onClick={() => navigate('logs', extensionLogsIntent)}>查看日志</Button>
                <Button onClick={() => navigate('diagnostics', extensionDiagnosticsIntent)}>进入诊断页</Button>
                <Button onClick={() => { setOperationsView('batch'); setActiveTab('operations'); }}>批量与插件</Button>
              </Toolbar>
              <p className="helper-text top-gap">
                平台入口和来源筛选都已经后置到独立子视图，这里只保留当前平台的最常用治理动作。
              </p>

              {currentPlatform.items.length > 0 ? (
                <>
                  <div className="list-stack top-gap">
                    {visibleRuntimeTools.map(renderToolRow)}
                  </div>
                  {currentPlatform.items.length > visibleRuntimeTools.length ? (
                    <Toolbar className="top-gap">
                      <Button onClick={() => setShowAllRuntimeTools((value) => !value)}>
                        {showAllRuntimeTools ? '收起工具清单' : `展开更多工具（剩余 ${hiddenRuntimeToolCount} 项）`}
                      </Button>
                    </Toolbar>
                  ) : null}
                </>
              ) : (
                <EmptyState title="平台下暂无工具" description="当前平台没有从 `hermes tools list` 解析到可治理项。" />
              )}
            </>
          ) : (
            <EmptyState title="暂无平台清单" description="`hermes tools list --platform <platform>` 还没有返回可治理的平台内容。" />
          )}
        </Panel>
      ) : null}

      {runtimeView === 'platforms' ? (
        <Panel
          title="平台入口"
          subtitle="默认只露出最值得先看的平台，切换焦点后运行态区会跟着更新。"
          aside={extensions.toolPlatforms.length > 4 ? (
            <Toolbar>
              <Button onClick={() => setShowAllPlatformSummaries((value) => !value)}>
                {showAllPlatformSummaries ? '收起平台' : `展开更多平台（剩余 ${hiddenPlatformSummaryCount} 个）`}
              </Button>
            </Toolbar>
          ) : undefined}
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">当前焦点</span>
              <strong className="summary-mini-value">{currentPlatform?.displayName || '尚未选择平台'}</strong>
              <span className="summary-mini-meta">切换入口后，焦点平台治理区只更新当前目标</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">无工具平台</span>
              <strong className="summary-mini-value">{toollessPlatforms.length}</strong>
              <span className="summary-mini-meta">{toollessPlatforms[0]?.name || '当前平台都已挂上部分工具'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">来源分布</span>
              <strong className="summary-mini-value">{extensions.skillSourceCounts.length} 类</strong>
              <span className="summary-mini-meta">{sourceDistributionSummary}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">分类扩散</span>
              <strong className="summary-mini-value">{categoryCounts.length} 类</strong>
              <span className="summary-mini-meta">{topCategorySummary}</span>
            </section>
          </div>
          {visiblePlatformSummaries.length ? (
            <div className="workspace-shortcut-grid dashboard-launcher-grid top-gap">
              {visiblePlatformSummaries.map((platform) => {
                const targetPlatformKey = extensions.toolInventory.find((item) => item.platformKey === platform.name || item.displayName === platform.name)?.platformKey ?? platform.name;
                return (
                  <button
                    key={platform.name}
                    type="button"
                    className={`workspace-shortcut-card dashboard-shortcut-card ${currentPlatform?.platformKey === targetPlatformKey ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedPlatform(targetPlatformKey);
                      setRuntimeView('focus');
                    }}
                  >
                    <strong><span className="dashboard-shortcut-icon">{platform.enabledCount > 0 ? '🟢' : '🟠'}</span>{platform.name}</strong>
                    <span>{platform.enabledCount > 0 ? `${platform.enabledCount}/${platform.totalCount} 已启用` : '当前没有启用工具'}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title="暂无工具摘要" description="`hermes tools --summary` 没有成功返回可解析的平台摘要。" />
          )}
          {extensions.toolPlatforms.length > visiblePlatformSummaries.length ? (
            <p className="helper-text top-gap">其余 {hiddenPlatformSummaryCount} 个平台已先收起，避免入口区默认堆满。</p>
          ) : null}
          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => setRuntimeView('focus')}>回到焦点平台</Button>
            <Button onClick={() => navigate('diagnostics', extensionDiagnosticsIntent)}>进入诊断页</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {runtimeView === 'skills' ? (
        <Panel
          title="来源观察"
          subtitle="这里只看运行时来源、信任级别和筛选结果；本地目录维护仍去技能页。"
          aside={(
            <Toolbar>
              <input
                className="search-input"
                placeholder="搜索技能名、分类、source、trust"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                className="select-input"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
              >
                {sourceOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === 'all' ? '全部来源' : item}
                  </option>
                ))}
              </select>
            </Toolbar>
          )}
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">Source</span>
              <strong className="summary-mini-value">{extensions.skillSourceCounts.length} 类</strong>
              <span className="summary-mini-meta">{extensions.skillSourceCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Trust</span>
              <strong className="summary-mini-value">{extensions.skillTrustCounts.length} 类</strong>
              <span className="summary-mini-meta">{extensions.skillTrustCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Category</span>
              <strong className="summary-mini-value">{categoryCounts.length} 类</strong>
              <span className="summary-mini-meta">{categoryCounts.slice(0, 6).map((item) => `${item.name} ${item.count}`).join(' · ') || '—'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Gateway Context</span>
              <strong className="summary-mini-value">{dashboard.gateway?.gatewayState ?? '未检测到'}</strong>
              <span className="summary-mini-meta">如果要走消息平台或自动化验证，最终还要联动 Gateway、Cron 和 Logs。</span>
            </section>
          </div>
          {visibleFilteredSkills.length ? (
            <div className="list-stack top-gap">
              {visibleFilteredSkills.map((item) => (
                <div className="list-card" key={`${item.name}:${item.source}:${item.trust}`}>
                  <div className="list-card-title">
                    <strong>{item.name}</strong>
                    <div className="pill-row">
                      <Pill>{item.category || 'uncategorized'}</Pill>
                      <Pill tone={item.source === 'local' ? 'warn' : 'good'}>{item.source}</Pill>
                      <Pill tone={item.trust === 'local' ? 'warn' : 'neutral'}>{item.trust}</Pill>
                    </div>
                  </div>
                  <p>{item.category || 'uncategorized'} · source {item.source} · trust {item.trust}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="没有匹配技能" description="当前筛选条件下没有匹配的运行时技能。" />
          )}
          {filteredSkills.length > visibleFilteredSkills.length ? (
            <Toolbar className="top-gap">
              <Button onClick={() => setShowAllSkillResults((value) => !value)}>
                {showAllSkillResults ? '收起筛选结果' : `展开更多结果（剩余 ${hiddenSkillResultCount} 条）`}
              </Button>
            </Toolbar>
          ) : null}
          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => navigate('skills')}>去技能页</Button>
            <Button onClick={() => setRuntimeView('focus')}>回到焦点平台</Button>
          </Toolbar>
        </Panel>
      ) : null}
    </>
  );

  const operationsSection = (
    <>
      <Panel
        title="插件与材料入口"
        subtitle="官方入口、批量工具、插件编排和命令回显拆成独立子视图，默认只展开一个模块。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {EXTENSIONS_OPERATIONS_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${operationsView === item.key ? 'active' : ''}`}
              onClick={() => setOperationsView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeOperationsView.hint}</p>
      </Panel>

      {operationsView === 'setup' ? (
        <Panel
          title="扩展接管与安装"
          subtitle="把 tools、skills、plugins、memory provider 的官方入口拉进同一层，但只在你明确进入后才展示。"
        >
          <div className="control-card-grid">
            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Tools</p>
                  <h3 className="action-card-title">工具面接管</h3>
                </div>
                <Pill tone={toolsEnabled > 0 ? 'good' : 'warn'}>
                  {toolsEnabled > 0 ? `${toolsEnabled}/${toolsTotal}` : '待启用'}
                </Pill>
              </div>
              <p className="action-card-copy">
                先用 Hermes 官方交互式工具面配置，再回到运行细节做平台级批量启停和日志核对。
              </p>
              <p className="command-line">hermes tools · {installation.toolsSetupCommand}</p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void openInTerminal('extensions:tools', '工具面配置', 'hermes tools')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'extensions:tools' ? '工具面配置…' : '工具面配置'}
                </Button>
                <Button
                  onClick={() => void openInTerminal('extensions:tools-setup', '工具选择向导', installation.toolsSetupCommand)}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'extensions:tools-setup' ? '工具选择向导…' : '工具选择向导'}
                </Button>
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Skills</p>
                  <h3 className="action-card-title">技能来源与安装态</h3>
                </div>
                <Pill tone={runtimeSkillMismatch ? 'warn' : 'good'}>
                  {runtimeSkillMismatch ? '安装态偏差' : '安装态对齐'}
                </Pill>
              </div>
              <p className="action-card-copy">
                技能既有目录态也有安装态，优先用官方 registry / config 入口核对，再回到技能页看本地目录。
              </p>
              <p className="command-line">hermes skills browse · {installation.skillsConfigCommand} · hermes skills list</p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void openInTerminal('extensions:skills-browse', '技能浏览器', 'hermes skills browse')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'extensions:skills-browse' ? '技能浏览器…' : '技能浏览器'}
                </Button>
                <Button
                  onClick={() => void openInTerminal('extensions:skills-config', '技能开关', installation.skillsConfigCommand)}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'extensions:skills-config' ? '技能开关…' : '技能开关'}
                </Button>
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Provider</p>
                  <h3 className="action-card-title">Memory / Context Provider</h3>
                </div>
                <Pill tone={extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good'}>
                  {extensions.memoryRuntime.provider}
                </Pill>
              </div>
              <p className="action-card-copy">
                Hermes 的记忆 provider 和 context engine 都应通过官方交互式入口切换，而不是在客户端私自重建逻辑。
              </p>
              <p className="command-line">hermes memory setup · hermes plugins</p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void openInTerminal('extensions:memory-setup', '记忆 Provider', 'hermes memory setup')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'extensions:memory-setup' ? '记忆 Provider…' : '记忆 Provider'}
                </Button>
                <Button
                  onClick={() => void openInTerminal('extensions:plugins-panel', '插件与 Provider 面板', 'hermes plugins')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'extensions:plugins-panel' ? '插件与 Provider 面板…' : '插件与 Provider 面板'}
                </Button>
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Plugin Ops</p>
                  <h3 className="action-card-title">插件安装 / 更新 / 移除</h3>
                </div>
                <Pill tone={pluginTerminalName ? 'good' : 'warn'}>
                  {pluginTerminalName || '等待输入 owner/repo'}
                </Pill>
              </div>
              <p className="action-card-copy">
                这里直接把 plugin 生命周期命令交给 Terminal，既保留 Hermes 原生命令，又能补上安装闭环。
              </p>
              <p className="command-line">
                {pluginTerminalName
                  ? `hermes plugins install ${pluginTerminalName} · hermes plugins update ${pluginTerminalName} · hermes plugins remove ${pluginTerminalName}`
                  : '输入 owner/repo 或已安装插件名后即可执行 install / update / remove'}
              </p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void openInTerminal('extensions:plugin-install', '安装插件', `hermes plugins install ${pluginTerminalName}`)}
                  disabled={runningAction !== null || !installation.binaryFound || !pluginTerminalName}
                >
                  {runningAction === 'extensions:plugin-install' ? '安装插件…' : '安装插件'}
                </Button>
                <Button
                  onClick={() => void openInTerminal('extensions:plugin-update', '更新插件', `hermes plugins update ${pluginTerminalName}`)}
                  disabled={runningAction !== null || !installation.binaryFound || !pluginTerminalName}
                >
                  {runningAction === 'extensions:plugin-update' ? '更新插件…' : '更新插件'}
                </Button>
                <Button
                  kind="danger"
                  onClick={() => void openInTerminal('extensions:plugin-remove', '移除插件', `hermes plugins remove ${pluginTerminalName}`, `确定移除插件 ${pluginTerminalName || ''} 吗？`)}
                  disabled={runningAction !== null || !installation.binaryFound || !pluginTerminalName}
                >
                  {runningAction === 'extensions:plugin-remove' ? '移除插件…' : '移除插件'}
                </Button>
              </Toolbar>
            </section>
          </div>
        </Panel>
      ) : null}

      {operationsView === 'batch' ? (
        <Panel
          title="工具批量启停"
          subtitle="批量工具名和一次性开关属于进阶动作，默认后置到这里，不再挤在运行态首屏。"
          aside={(
            <Toolbar>
              <select
                className="select-input"
                value={currentPlatform?.platformKey ?? ''}
                onChange={(event) => setSelectedPlatform(event.target.value)}
                disabled={!extensions.toolInventory.length || runningAction !== null}
              >
                {extensions.toolInventory.map((item) => (
                  <option key={item.platformKey} value={item.platformKey}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </Toolbar>
          )}
        >
          <div className="form-grid">
            <label className="field-stack">
              <span>批量工具名称</span>
              <input
                className="search-input"
                value={toolNamesInput}
                onChange={(event) => setToolNamesInput(event.target.value)}
                placeholder="web,browser,terminal"
                disabled={runningAction !== null}
              />
            </label>
            <label className="field-stack">
              <span>批量预览</span>
              <input
                className="search-input"
                value={batchToolNames.join(', ') || '尚未输入有效 tool 名称'}
                readOnly
              />
            </label>
          </div>
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => currentPlatform && void executeToolAction('enable', currentPlatform.platformKey, batchToolNames, {
                clearInput: true,
                label: `${currentPlatform.displayName} 批量工具`,
              })}
              disabled={runningAction !== null || !currentPlatform || batchToolNames.length === 0}
            >
              {runningToolBatchEnable ? '批量启用中…' : '批量启用'}
            </Button>
            <Button
              onClick={() => currentPlatform && void executeToolAction('disable', currentPlatform.platformKey, batchToolNames, {
                clearInput: true,
                label: `${currentPlatform.displayName} 批量工具`,
              })}
              disabled={runningAction !== null || !currentPlatform || batchToolNames.length === 0}
            >
              {runningToolBatchDisable ? '批量停用中…' : '批量停用'}
            </Button>
            <Button onClick={() => navigate('logs', extensionLogsIntent)}>查看日志</Button>
          </Toolbar>
          <p className="helper-text top-gap">
            这里直接调用 Hermes 原生命令 `hermes tools enable|disable --platform ...`，不重建 Hermes 的配置结构。
          </p>
        </Panel>
      ) : null}

      {operationsView === 'plugins' ? (
        <Panel
          title="插件编排"
          subtitle="Hermes 原生 `plugins enable|disable` 只要求插件名。这里保留手动输入入口，同时把已安装插件作为快捷操作清单。"
        >
          <div className="form-grid">
            <label className="field-stack">
              <span>Plugin 名称</span>
              <input
                className="search-input"
                value={pluginNameInput}
                onChange={(event) => setPluginNameInput(event.target.value)}
                placeholder="owner/repo 或 plugin 名称"
                disabled={runningAction !== null}
              />
            </label>
            <label className="field-stack">
              <span>当前已安装</span>
              <input
                className="search-input"
                value={extensions.plugins.items.join(', ') || '当前没有已安装插件'}
                readOnly
              />
            </label>
          </div>
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => void executePluginAction('enable', pluginNameInput)}
              disabled={runningAction !== null || !pluginNameInput.trim()}
            >
              {runningPluginEnable ? '启用插件中…' : '启用插件'}
            </Button>
            <Button
              onClick={() => void executePluginAction('disable', pluginNameInput)}
              disabled={runningAction !== null || !pluginNameInput.trim()}
            >
              {runningPluginDisable ? '停用插件中…' : '停用插件'}
            </Button>
            <Button onClick={() => setOperationsView('output')}>查看回显</Button>
          </Toolbar>
          <p className="helper-text">
            `plugins list` 当前主要暴露“已安装插件”，不会像 tools 一样直接给出启用态，所以这里把命令入口和原始输出分开，避免同时把页面挤满。
          </p>
          {extensions.plugins.items.length > 0 ? (
            <div className="list-stack top-gap">
              {extensions.plugins.items.map((item) => {
                const enableActionId = pluginActionState('enable', item);
                const disableActionId = pluginActionState('disable', item);
                return (
                  <div className="list-card" key={item}>
                    <div className="list-card-title">
                      <strong>{item}</strong>
                      <Pill tone="good">installed</Pill>
                    </div>
                    <p>插件管理器已识别该插件。是否在当前 profile 生效，请结合命令输出、记忆 provider 与相关功能页一起判断。</p>
                    <Toolbar>
                      <Button
                        kind="primary"
                        onClick={() => void executePluginAction('enable', item)}
                        disabled={runningAction !== null}
                      >
                        {runningAction === enableActionId ? '启用中…' : '启用'}
                      </Button>
                      <Button
                        onClick={() => void executePluginAction('disable', item)}
                        disabled={runningAction !== null}
                      >
                        {runningAction === disableActionId ? '停用中…' : '停用'}
                      </Button>
                      <Button onClick={() => setPluginNameInput(item)} disabled={runningAction !== null}>填入输入框</Button>
                    </Toolbar>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="尚未安装插件" description="当前还是 builtin + local skills 主导的扩展形态。若要扩展 memory/provider，通常需要先安装对应插件。" />
          )}
        </Panel>
      ) : null}

      {operationsView === 'output' ? (
        <div className="page-stack">
          <Panel title="最近命令回显" subtitle="每一次治理操作都保留 Hermes 原生命令、退出码和 stdout/stderr，方便你审计包装层行为。">
            {lastCommand ? (
              <div className="result-stack">
                <div className="detail-list compact">
                  <KeyValueRow label="动作类型" value={lastCommandLabel ?? '治理动作'} />
                  <KeyValueRow label="命令" value={lastCommand.command} />
                  <KeyValueRow label="退出码" value={lastCommand.exitCode} />
                  <KeyValueRow label="执行结果" value={<Pill tone={lastCommand.success ? 'good' : 'bad'}>{String(lastCommand.success)}</Pill>} />
                </div>
                <pre className="code-block">{lastCommand.stdout || 'stdout 为空'}</pre>
                {lastCommand.stderr ? <pre className="code-block">{lastCommand.stderr}</pre> : null}
              </div>
            ) : (
              <EmptyState title="尚未执行治理操作" description="这里会回显最近一次 tools / plugins 动作的 Hermes CLI 输出。" />
            )}
          </Panel>

          <Panel
            title="原始 CLI 快照"
            subtitle="保留 Hermes 原生命令输出，方便你把结构化卡片和真实 CLI 结果对照着看。"
            aside={(
              <Toolbar>
                <select
                  className="select-input"
                  value={rawKind}
                  onChange={(event) => setRawKind(event.target.value as RawOutputKind)}
                >
                  <option value="tools">tools --summary</option>
                  <option value="memory">memory status</option>
                  <option value="plugins">plugins list</option>
                  <option value="skills">skills list</option>
                </select>
              </Toolbar>
            )}
          >
            <pre className="code-block tall">{rawOutput || '无输出'}</pre>
          </Panel>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="page-stack">
      <Panel
        title="扩展能力台"
        subtitle="先看当前平台、技能来源和记忆链路，再决定往哪一层继续下钻。"
        tip={(
          <InfoTip content="扩展页聚焦运行态扩展闭环：tools、plugins、skills 和 memory provider。跨页跳转收缩到真正需要的上下文动作，常规导航统一交给侧边栏。"/>
        )}
        aside={(
          <Toolbar>
            <Button onClick={() => void load()}>刷新</Button>
          </Toolbar>
        )}
      >
        <div className="workspace-summary-strip">
          <section className="summary-mini-card">
            <span className="summary-mini-label">工具面</span>
            <strong className="summary-mini-value">{toolsEnabled}/{toolsTotal}</strong>
            <span className="summary-mini-meta">所有平台已启用工具总量 / 总容量</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">运行时技能</span>
            <strong className="summary-mini-value">{runtimeSkills.length}</strong>
            <span className="summary-mini-meta">Builtin / Local {sourceBuiltinCount} / {sourceLocalCount}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">记忆链路</span>
            <strong className="summary-mini-value">{extensions.memoryRuntime.provider}</strong>
            <span className="summary-mini-meta">{extensions.memoryRuntime.installedPlugins.length} 个相关插件</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">Gateway</span>
            <strong className="summary-mini-value">{dashboard.gateway?.gatewayState ?? '未检测到'}</strong>
            <span className="summary-mini-meta">最近更新时间 {formatTimestamp(dashboard.gateway?.updatedAt)}</span>
          </section>
        </div>
        <div className="detail-list compact top-gap">
          <KeyValueRow label="当前 Profile" value={extensions.profileName} />
          <KeyValueRow label="Hermes Home" value={extensions.hermesHome} />
          <KeyValueRow label="Context Engine" value={dashboard.config.contextEngine || '—'} />
          <KeyValueRow label="当前焦点平台" value={currentPlatform?.displayName || '尚未选择平台'} />
        </div>
      </Panel>

      {investigation ? (
        <ContextBanner
          label="Session Drilldown"
          title={investigation.headline}
          description={investigation.description}
          meta={(
            <div className="pill-row">
              <Pill>{investigation.rawKind ?? 'tools'}</Pill>
              {investigation.selectedPlatform ? <Pill tone="warn">{investigation.selectedPlatform}</Pill> : null}
              {(investigation.context?.toolNames ?? []).slice(0, 2).map((item) => (
                <Pill key={item}>{item}</Pill>
              ))}
            </div>
          )}
          actions={(
            <Toolbar>
              <Button onClick={() => { setRuntimeView('focus'); setActiveTab('runtime'); }}>查看运行细节</Button>
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>回到会话页</Button>
              <Button onClick={() => navigate('logs', extensionLogsIntent)}>进入日志页</Button>
              <Button onClick={() => { setOperationsView('output'); setActiveTab('operations'); }}>打开插件与输出</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="tab-bar">
        {EXTENSIONS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'runtime' && (toollessPlatforms.length > 0 || runtimeSkillMismatch) ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'operations' && (warnings.length > 0 || lastCommand) ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewSection : activeTab === 'runtime' ? runtimeSection : operationsSection}
    </div>
  );
}
