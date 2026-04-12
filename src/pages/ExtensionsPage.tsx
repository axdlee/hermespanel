import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import { api } from '../lib/api';
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
  NamedCount,
  RuntimeSkillItem,
  SkillItem,
  ToolPlatformInventory,
  ToolRuntimeItem,
} from '../types';
import { isExtensionsPageIntent, type ExtensionsPageIntent, type PageProps } from './types';

type RawOutputKind = 'tools' | 'memory' | 'plugins' | 'skills';
type ExtensionAction = 'enable' | 'disable';

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
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [investigation, setInvestigation] = useState<ExtensionsPageIntent | null>(null);
  const [rawKind, setRawKind] = useState<RawOutputKind>('tools');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [toolNamesInput, setToolNamesInput] = useState('');
  const [pluginNameInput, setPluginNameInput] = useState('');
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [nextExtensions, nextDashboard, nextSkills] = await Promise.all([
        api.getExtensionsSnapshot(profile),
        api.getDashboardSnapshot(profile),
        api.listSkills(profile),
      ]);
      setExtensions(nextExtensions);
      setDashboard(nextDashboard);
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
    try {
      const result = await api.openInFinder({ path, revealInFinder });
      notify(
        result.success ? 'success' : 'error',
        result.success ? `${label} 已在 Finder 中打开。` : `${label} 打开失败，请检查命令输出。`,
      );
    } catch (reason) {
      notify('error', String(reason));
    }
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
    setLastCommand(null);
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

  if (loading || !extensions || !dashboard) {
    return <LoadingState label="正在构建 Hermes 扩展能力工作台。" />;
  }

  const toolsEnabled = extensions.toolPlatforms.reduce((sum, item) => sum + item.enabledCount, 0);
  const toolsTotal = extensions.toolPlatforms.reduce((sum, item) => sum + item.totalCount, 0);
  const toollessPlatforms = extensions.toolPlatforms.filter((item) => item.enabledCount === 0);
  const sourceLocalCount = extensions.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
  const sourceBuiltinCount = extensions.skillSourceCounts.find((item) => item.name === 'builtin')?.count ?? 0;
  const runtimeSkillMismatch = sourceLocalCount !== skills.length;
  const warnings: string[] = [];

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

  const rawOutput = rawKind === 'tools'
    ? extensions.toolsRawOutput
    : rawKind === 'memory'
      ? extensions.memoryRuntime.rawOutput
      : rawKind === 'plugins'
        ? extensions.plugins.rawOutput
        : extensions.skillsRawOutput;

  const currentPlatformSummary = currentPlatform ? matchingPlatformSummary(extensions, currentPlatform.platformKey) : undefined;
  const currentPlatformMetrics = inventoryMetrics(currentPlatform);
  const runningToolBatchEnable = runningAction === toolActionState('enable', currentPlatform?.platformKey ?? '', batchToolNames);
  const runningToolBatchDisable = runningAction === toolActionState('disable', currentPlatform?.platformKey ?? '', batchToolNames);
  const runningPluginEnable = runningAction === pluginActionState('enable', pluginNameInput);
  const runningPluginDisable = runningAction === pluginActionState('disable', pluginNameInput);
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

  return (
    <div className="page-stack">
      <Panel
        title="扩展能力台"
        subtitle="聚焦 Hermes 自己的 `tools / plugins / memory / skills` 运行能力面，帮助你区分“目录里有”与“运行时真的生效”。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load()}>刷新</Button>
            <Button onClick={() => navigate('skills')}>进入技能页</Button>
            <Button onClick={() => navigate('diagnostics')}>进入诊断页</Button>
            <Button onClick={() => navigate('config')}>进入配置页</Button>
          </Toolbar>
        )}
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">Hermes Runtime Extension Surface</p>
            <p className="hero-subtitle">
              这里看的是 Hermes 运行时真正暴露出来的能力表面，而不是单纯的本地文件目录。现在你不只可以看，还可以直接对
              `tools` 和 `plugins` 做启停编排，同时保留原生命令输出用于核对。
            </p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={extensions.profileName} />
              <KeyValueRow label="Hermes Home" value={extensions.hermesHome} />
              <KeyValueRow label="Context Engine" value={dashboard.config.contextEngine || '—'} />
              <KeyValueRow label="当前 Memory Provider" value={extensions.memoryRuntime.provider} />
              <KeyValueRow label="Gateway" value={dashboard.gateway?.gatewayState ?? '未检测到'} />
              <KeyValueRow label="最近 Gateway 更新时间" value={formatTimestamp(dashboard.gateway?.updatedAt)} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="工具面" value={`${toolsEnabled}/${toolsTotal}`} hint="所有平台已启用工具总量 / 总容量" />
            <MetricCard label="运行时技能" value={runtimeSkills.length} hint="来自 `hermes skills list` 的当前安装态" />
            <MetricCard label="Builtin / Local" value={`${sourceBuiltinCount} / ${sourceLocalCount}`} hint="运行时技能来源分布" />
            <MetricCard label="插件数" value={extensions.plugins.installedCount} hint="来自 `hermes plugins list` 的已安装插件数" />
          </div>
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
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>回到会话页</Button>
              <Button onClick={() => navigate('logs', extensionLogsIntent)}>进入日志页</Button>
              <Button onClick={() => navigate('diagnostics', extensionDiagnosticsIntent)}>进入诊断页</Button>
              <Button onClick={() => navigate('config', extensionConfigIntent)}>进入配置页</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="two-column wide-left">
        <Panel title="运行健康" subtitle="把工具面、记忆 provider、插件层和技能来源放在一起看，快速判断扩展闭环有没有搭起来。">
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Tool Surface</strong>
                <Pill tone={extensions.toolPlatforms.length > 0 ? 'good' : 'warn'}>
                  {extensions.toolPlatforms.length ? `${extensions.toolPlatforms.length} 个平台` : '未解析'}
                </Pill>
              </div>
              <p>{toollessPlatforms.length === 0 ? '当前每个平台都至少挂了部分工具。' : `无工具平台：${toollessPlatforms.map((item) => item.name).join('、')}`}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Memory Runtime</strong>
                <Pill tone={extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good'}>
                  {extensions.memoryRuntime.provider}
                </Pill>
              </div>
              <p>Built-in {extensions.memoryRuntime.builtInStatus} · 可用记忆插件 {extensions.memoryRuntime.installedPlugins.length} 个</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Plugin Overlay</strong>
                <Pill tone={extensions.plugins.installedCount > 0 ? 'good' : 'neutral'}>
                  {extensions.plugins.installedCount > 0 ? `${extensions.plugins.installedCount} 个` : '未安装'}
                </Pill>
              </div>
              <p>{extensions.plugins.installHint || '当前主要依赖 builtin 与 local skill 扩展，而不是独立 plugin 仓库。'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Skill Sources</strong>
                <Pill tone={runtimeSkillMismatch ? 'warn' : 'good'}>
                  {runtimeSkillMismatch ? '存在差异' : '已对齐'}
                </Pill>
              </div>
              <p>CLI local 技能 {sourceLocalCount} 个 · 本地目录扫描 {skills.length} 个</p>
            </section>
          </div>
          <Toolbar>
            <Button onClick={() => void openInFinder(extensions.hermesHome, 'Hermes Home')}>打开 Home</Button>
            <Button onClick={() => navigate('memory')}>进入记忆页</Button>
            <Button onClick={() => navigate('skills')}>进入技能页</Button>
            <Button onClick={() => navigate('logs', extensionLogsIntent)}>进入日志页</Button>
            <Button onClick={() => navigate('diagnostics', extensionDiagnosticsIntent)}>进入诊断页</Button>
            <Button onClick={() => navigate('config', extensionConfigIntent)}>进入配置页</Button>
          </Toolbar>
          {warnings.length > 0 ? (
            <div className="warning-stack">
              {warnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="扩展层状态清晰" description="当前没有发现明显的扩展层结构性问题，可以继续按平台或技能来源看细节。" />
          )}
        </Panel>

        <Panel title="记忆与插件目录" subtitle="这里更偏 Hermes 自身的扩展生态，不是本地记忆文件编辑。">
          <div className="list-stack">
            <div className="list-card">
              <div className="list-card-title">
                <strong>Memory Runtime</strong>
                <Pill tone={extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good'}>
                  {extensions.memoryRuntime.provider}
                </Pill>
              </div>
              <p>Built-in: {extensions.memoryRuntime.builtInStatus}</p>
              <div className="pill-row">
                {extensions.memoryRuntime.installedPlugins.map((item) => (
                  <Pill key={`${item.name}:${item.availability}`}>{item.name} · {item.availability}</Pill>
                ))}
              </div>
            </div>
            <div className="list-card">
              <div className="list-card-title">
                <strong>Plugin Manager</strong>
                <Pill tone={extensions.plugins.installedCount > 0 ? 'good' : 'neutral'}>
                  {extensions.plugins.installedCount > 0 ? `${extensions.plugins.installedCount} installed` : 'none'}
                </Pill>
              </div>
              <p>{extensions.plugins.installHint || '当前没有通过 plugins manager 安装额外插件。'}</p>
              {extensions.plugins.items.length > 0 ? (
                <div className="pill-row">
                  {extensions.plugins.items.map((item) => (
                    <Pill key={item}>{item}</Pill>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel
          title="工具编排"
          subtitle="对 `hermes tools list --platform <platform>` 做治理包装。平台与能力来自 Hermes 自己，HermesPanel 只负责治理入口和结果回显。"
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
              <div className="health-grid">
                <section className="health-card">
                  <div className="health-card-header">
                    <strong>Inventory</strong>
                    <Pill tone={currentPlatformMetrics.enabled > 0 ? 'good' : 'warn'}>
                      {currentPlatformMetrics.enabled}/{currentPlatformMetrics.total}
                    </Pill>
                  </div>
                  <p>{currentPlatform.displayName} 当前从 `tools list` 解析出 {currentPlatform.items.length} 个可治理项。</p>
                </section>
                <section className="health-card">
                  <div className="health-card-header">
                    <strong>Summary Drift</strong>
                    <Pill tone={currentPlatformSummary ? 'good' : 'warn'}>
                      {currentPlatformSummary ? '已对齐' : '缺摘要'}
                    </Pill>
                  </div>
                  <p>
                    {currentPlatformSummary
                      ? `${currentPlatformSummary.name} 摘要显示 ${currentPlatformSummary.enabledCount}/${currentPlatformSummary.totalCount}，可与下方运行清单交叉核对。`
                      : '当前平台没有在 tools summary 中找到对应摘要，建议到诊断页复核原始命令。'}
                  </p>
                </section>
              </div>

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
                  onClick={() => void executeToolAction('enable', currentPlatform.platformKey, batchToolNames, {
                    clearInput: true,
                    label: `${currentPlatform.displayName} 批量工具`,
                  })}
                  disabled={runningAction !== null || batchToolNames.length === 0}
                >
                  {runningToolBatchEnable ? '批量启用中…' : '批量启用'}
                </Button>
                <Button
                  onClick={() => void executeToolAction('disable', currentPlatform.platformKey, batchToolNames, {
                    clearInput: true,
                    label: `${currentPlatform.displayName} 批量工具`,
                  })}
                  disabled={runningAction !== null || batchToolNames.length === 0}
                >
                  {runningToolBatchDisable ? '批量停用中…' : '批量停用'}
                </Button>
              </Toolbar>
              <p className="helper-text">
                这里直接调用 Hermes 原生命令 `hermes tools enable|disable --platform {currentPlatform.platformKey} ...`，不改 Hermes 自身配置结构。
              </p>

              {currentPlatform.items.length > 0 ? (
                <div className="list-stack">
                  {currentPlatform.items.map(renderToolRow)}
                </div>
              ) : (
                <EmptyState title="平台下暂无工具" description="当前平台没有从 `hermes tools list` 解析到可治理项。" />
              )}
            </>
          ) : (
            <EmptyState title="暂无平台清单" description="`hermes tools list --platform <platform>` 还没有返回可治理的平台内容。" />
          )}
        </Panel>

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
            <Button onClick={() => navigate('config')}>核对配置</Button>
          </Toolbar>
          <p className="helper-text">
            `plugins list` 当前主要暴露“已安装插件”，不会像 tools 一样直接给出启用态，所以这里把命令入口和原始输出一起保留，方便你判读真实状态。
          </p>
          {extensions.plugins.items.length > 0 ? (
            <div className="list-stack">
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
      </div>

      <div className="two-column wide-left">
        <Panel title="工具面总览" subtitle="按平台展示 Hermes 当前真正启用的工具集合。">
          {extensions.toolPlatforms.length ? (
            <div className="list-stack">
              {extensions.toolPlatforms.map((platform) => (
                <div className="list-card" key={platform.name}>
                  <div className="list-card-title">
                    <strong>{platform.name}</strong>
                    <Pill tone={platform.enabledCount > 0 ? 'good' : 'warn'}>
                      {platform.enabledCount}/{platform.totalCount}
                    </Pill>
                  </div>
                  <p>{platform.enabledTools.length ? truncate(platform.enabledTools.join('、'), 220) : '当前没有启用工具。'}</p>
                  <div className="pill-row">
                    {platform.enabledTools.slice(0, 12).map((tool) => (
                      <Pill key={`${platform.name}:${tool}`}>{tool}</Pill>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无工具摘要" description="`hermes tools --summary` 没有成功返回可解析的平台摘要。" />
          )}
        </Panel>

        <Panel
          title="技能来源分布"
          subtitle="和技能目录页不同，这里更看运行时安装来源、信任级别和当前 CLI 识别结果。"
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
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Source</strong>
                <Pill tone="good">{extensions.skillSourceCounts.length} 类</Pill>
              </div>
              <p>{extensions.skillSourceCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Trust</strong>
                <Pill tone="neutral">{extensions.skillTrustCounts.length} 类</Pill>
              </div>
              <p>{extensions.skillTrustCounts.map((item) => `${item.name} ${item.count}`).join(' · ') || '—'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Category Spread</strong>
                <Pill tone="neutral">{categoryCounts.length} 类</Pill>
              </div>
              <p>{categoryCounts.slice(0, 6).map((item) => `${item.name} ${item.count}`).join(' · ') || '—'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Gateway Context</strong>
                <Pill tone={dashboard.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {dashboard.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p>如果这些技能还要经过消息平台或自动化任务验证，最终还是要回到 Gateway、Cron 和 Logs 联动确认。</p>
            </section>
          </div>
          {filteredSkills.length ? (
            <div className="list-stack">
              {filteredSkills.slice(0, 18).map((item) => (
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
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel title="最近命令回显" subtitle="每一次治理操作都保留 Hermes 原生命令、退出码和 stdout/stderr，方便你审计包装层行为。">
          {lastCommand ? (
            <div className="result-stack">
              <div className="detail-list compact">
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
              <Button onClick={() => navigate('diagnostics')}>进入诊断页</Button>
            </Toolbar>
          )}
        >
          <pre className="code-block tall">{rawOutput || '无输出'}</pre>
        </Panel>
      </div>
    </div>
  );
}
