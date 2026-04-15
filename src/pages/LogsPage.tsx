import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  type DrilldownSeed,
  inferDiagnosticCommand,
} from '../lib/drilldown';
import { formatTimestamp } from '../lib/format';
import type { DashboardSnapshot, LogReadResult } from '../types';
import { Button, ContextBanner, EmptyState, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import { isLogsPageIntent, type LogsPageIntent, type PageProps } from './types';

type LogsTabKey = 'quick' | 'filters' | 'stream';
type LogsQuickViewKey = 'launch' | 'presets' | 'status';

const LOGS_TABS: Array<{ key: LogsTabKey; label: string; hint: string }> = [
  { key: 'quick', label: '常用概览', hint: '先判断当前日志焦点，再用预设或联动入口。' },
  { key: 'filters', label: '精细筛选', hint: '手动调整日志文件、级别、关键词和返回行数。' },
  { key: 'stream', label: '日志正文', hint: '查看最终返回的日志内容。' },
];

const LOGS_QUICK_VIEWS: Array<{
  key: LogsQuickViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'launch', label: '常用去向', icon: '🚀', hint: '先决定是直接看正文、切预设，还是继续联动诊断。' },
  { key: 'presets', label: '高频预设', icon: '🧭', hint: '网关错误、Provider 异常这类高频入口集中到这里。' },
  { key: 'status', label: '当前判断', icon: '🌤️', hint: '只看当前文件、筛选模式和少量提醒，不再同时铺开多块。' },
];

const LOG_OPTIONS = [
  { key: 'agent', label: 'agent.log' },
  { key: 'errors', label: 'errors.log' },
  { key: 'gateway', label: 'gateway.log' },
  { key: 'gateway.error', label: 'gateway.error.log' },
] as const;

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
] as const;

const AUTO_REFRESH_MS = 5_000;

function directoryOf(path: string) {
  const normalized = path.trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function LogsPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [logName, setLogName] = useState('agent');
  const [level, setLevel] = useState('');
  const [contains, setContains] = useState('');
  const [limit, setLimit] = useState('120');
  const [data, setData] = useState<LogReadResult | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [investigation, setInvestigation] = useState<LogsPageIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState<LogsTabKey>('quick');
  const [quickView, setQuickView] = useState<LogsQuickViewKey>('launch');

  async function loadContext() {
    try {
      const next = await api.getDashboardSnapshot(profile);
      setSnapshot(next);
    } catch (reason) {
      notify('error', String(reason));
    }
  }

  async function load(overrides?: {
    logName?: string;
    level?: string;
    contains?: string;
    limit?: string;
  }) {
    setLoading(true);
    try {
      const nextLogName = overrides?.logName ?? logName;
      const nextLevel = overrides?.level ?? level;
      const nextContains = overrides?.contains ?? contains;
      const nextLimit = overrides?.limit ?? limit;
      const next = await api.readLog(
        nextLogName,
        Number(nextLimit) || 120,
        nextLevel || undefined,
        nextContains || undefined,
        profile,
      );
      setData(next);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(presetKey: string) {
    const preset = PRESETS.find((item) => item.key === presetKey);
    if (!preset) {
      return;
    }
    setLogName(preset.logName);
    setLevel(preset.level);
    setContains(preset.contains);
    setLimit(preset.limit);
    notify('info', `已应用日志预设：${preset.label}`);
    void load({
      logName: preset.logName,
      level: preset.level,
      contains: preset.contains,
      limit: preset.limit,
    });
  }

  function toggleAutoRefresh() {
    const next = !autoRefresh;
    setAutoRefresh(next);
    notify('info', next ? '已开启 5 秒自动刷新日志。' : '已关闭自动刷新日志。');
  }

  function resetFilters(options?: { quiet?: boolean }) {
    setAutoRefresh(false);
    setLogName('agent');
    setLevel('');
    setContains('');
    setLimit('120');
    if (!options?.quiet) {
      notify('info', '已恢复默认日志视图。');
    }
    void load({
      logName: 'agent',
      level: '',
      contains: '',
      limit: '120',
    });
  }

  useEffect(() => {
    setActiveTab('quick');
    setQuickView('launch');
    void Promise.all([
      load(),
      loadContext(),
    ]);
  }, [profile]);

  useEffect(() => {
    if (!isLogsPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    setActiveTab('stream');
    setAutoRefresh(false);
    setQuickView('launch');
    setLogName(pageIntent.logName ?? 'agent');
    setLevel(pageIntent.level ?? '');
    setContains(pageIntent.contains ?? '');
    setLimit(pageIntent.limit ?? '160');
    void load({
      logName: pageIntent.logName ?? 'agent',
      level: pageIntent.level ?? '',
      contains: pageIntent.contains ?? '',
      limit: pageIntent.limit ?? '160',
    });
    notify('info', `${pageIntent.headline} 已带入日志过滤条件。`);
    consumePageIntent();
  }, [consumePageIntent, notify, pageIntent, profile]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void load();
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [autoRefresh, contains, level, limit, logName, profile]);

  if (loading && !data) {
    return <LoadingState label="正在读取日志文件。" />;
  }

  const logsDir = data?.filePath ? directoryOf(data.filePath) : snapshot ? `${snapshot.hermesHome}/logs` : '';
  const relaySeed: DrilldownSeed = investigation
    ? {
        sourcePage: 'logs',
        headline: investigation.headline,
        description: investigation.description,
        context: investigation.context,
      }
    : {
        sourcePage: 'logs',
        headline: '来自 Logs 的日志下钻',
        description: '结合当前日志过滤条件继续围绕 Hermes 运行链路下钻。',
      };
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(relaySeed, {
    description: `基于 ${logName} 的日志过滤结果继续做诊断。`,
    suggestedCommand: inferDiagnosticCommand(logName, relaySeed.context),
    logName,
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(relaySeed, {
    description: '把当前日志关键词继续带到扩展层，核对 tools / skills / plugins 能力面。',
    rawKind: 'tools',
    query: contains || relaySeed.context?.toolNames.join(' ') || '',
    toolNames: relaySeed.context?.toolNames ?? [],
  });
  const configIntent = buildConfigDrilldownIntent(relaySeed, {
    description: '把当前日志症状继续带到配置中心，核对 model/provider、context engine 和 toolsets。',
    focus: logName.startsWith('gateway') ? 'context' : relaySeed.context?.toolNames.length ? 'toolsets' : 'model',
    suggestedCommand: logName.startsWith('gateway') ? 'gateway-status' : 'config-check',
  });
  const activeLogOption = LOG_OPTIONS.find((item) => item.key === logName);
  const lineCount = data?.lines.length ?? 0;
  const customFilterActive = Boolean(level || contains || limit !== '120' || logName !== 'agent');
  const filterSummary = [
    level ? `level=${level}` : null,
    contains ? `关键词=${contains}` : null,
    `limit=${limit || '120'}`,
  ].filter(Boolean).join(' / ');
  const warnings = Array.from(new Set([
    logName.startsWith('gateway') && snapshot?.gateway?.gatewayState !== 'running'
      ? '当前正在看网关日志，但 gateway 还不是 running，异常很可能来自服务未恢复。'
      : null,
    lineCount === 0
      ? '这次筛选没有返回任何日志行，建议先恢复默认视图，或直接应用高频预设重新判断。'
      : null,
    customFilterActive
      ? '当前已启用自定义筛选，排障完成后建议恢复默认视图，避免下次继续带着旧条件查看。'
      : null,
    investigation
      ? '当前日志条件来自其他工作台的下钻线索，适合继续联动到诊断、网关或配置页。'
      : null,
  ].filter((item): item is string => Boolean(item))));
  const logsStartReadiness = lineCount === 0
    ? '先换一个预设'
    : investigation
      ? '带着线索继续查'
      : customFilterActive
        ? '注意旧筛选'
        : '可以直接看正文';
  const logsStartHint = lineCount === 0
    ? '当前筛选没有返回任何日志，建议先恢复默认视图，或直接使用网关错误 / Provider 异常预设。'
    : investigation
      ? `${investigation.headline} 已带入当前日志条件，先看正文，再决定是否继续联动。`
      : customFilterActive
        ? '当前不是默认视图，排障结束后建议恢复默认，避免下次继续沿用旧条件。'
      : '当前是默认视图，适合先从高频预设和日志正文入手。';
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);
  const activeQuickView = LOGS_QUICK_VIEWS.find((item) => item.key === quickView) ?? LOGS_QUICK_VIEWS[0];
  const quickSection = (
    <>
      <Panel
        title="概览入口"
        subtitle="常用概览继续拆成二级工作面，默认只展开一个主区块，先把视觉密度降下来。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {LOGS_QUICK_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${quickView === item.key ? 'active' : ''}`}
              onClick={() => setQuickView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeQuickView.hint}</p>
      </Panel>

      {quickView === 'launch' ? (
        <Panel
          title="常用去向"
          subtitle="默认只保留最常走的 4 个入口，预设和精细筛选按需再展开。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => setActiveTab('stream')}
            >
              <strong><span className="dashboard-shortcut-icon">🧾</span>查看正文</strong>
              <span>{lineCount > 0 ? `${lineCount} 行已返回 · ${activeLogOption?.label ?? logName}` : '当前没有日志结果，适合先换一个预设'}</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => setQuickView('presets')}
            >
              <strong><span className="dashboard-shortcut-icon">🧭</span>高频预设</strong>
              <span>先从网关错误、Provider 异常等高频入口开始</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => setActiveTab('filters')}
            >
              <strong><span className="dashboard-shortcut-icon">🎛️</span>精细筛选</strong>
              <span>{customFilterActive ? filterSummary || '当前有自定义条件' : '需要时再改文件、关键词和返回行数'}</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('diagnostics', diagnosticsIntent)}
            >
              <strong><span className="dashboard-shortcut-icon">🩺</span>继续诊断</strong>
              <span>{investigation ? '当前已带上下文，可继续联动诊断' : '日志只暴露症状，真正修复通常在诊断页'}</span>
            </button>
          </div>
          <p className="helper-text top-gap">
            网关、扩展和配置这些低频联动入口已经后置到第二层，不再和首页正文抢注意力。
          </p>
        </Panel>
      ) : null}

      {quickView === 'presets' ? (
        <Panel
          title="高频预设"
          subtitle="不确定从哪里看起时，先用这些轻量入口；更多条件继续收在“精细筛选”。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={`workspace-shortcut-card dashboard-shortcut-card ${preset.logName === logName && preset.contains === contains ? 'active' : ''}`}
                onClick={() => {
                  applyPreset(preset.key);
                  setActiveTab('stream');
                }}
              >
                <strong><span className="dashboard-shortcut-icon">🪄</span>{preset.label}</strong>
                <span>
                  {preset.contains ? `关键词 ${preset.contains}` : '不附加关键词'} · 默认读取 {preset.limit} 行
                </span>
              </button>
            ))}
          </div>
          <div className="detail-list compact top-gap">
            <KeyValueRow label="当前文件" value={activeLogOption?.label ?? logName} />
            <KeyValueRow label="当前结果" value={lineCount > 0 ? `${lineCount} 行已返回` : '当前没有日志结果'} />
          </div>
          <Toolbar>
            <Button kind="primary" onClick={() => setActiveTab('filters')}>继续精细筛选</Button>
            <Button onClick={() => setQuickView('status')}>看当前判断</Button>
          </Toolbar>
          <p className="helper-text top-gap">
            `Cron 运行` 这类更细的情况也保留在这里，但已经从总览首页拆出来了。
          </p>
        </Panel>
      ) : null}

      {quickView === 'status' ? (
        <Panel
          title="当前判断"
          subtitle="把当前文件、过滤条件、Gateway 状态和结果数量收成摘要，小白先看这里就够了。"
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">当前文件</span>
              <strong className="summary-mini-value">{activeLogOption?.label ?? logName}</strong>
              <span className="summary-mini-meta">{data?.filePath ?? '尚未读取日志文件路径'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">筛选模式</span>
              <strong className="summary-mini-value">{customFilterActive ? '自定义' : '默认'}</strong>
              <span className="summary-mini-meta">{filterSummary || '当前没有额外过滤条件'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">返回结果</span>
              <strong className="summary-mini-value">{lineCount} 行</strong>
              <span className="summary-mini-meta">
                {autoRefresh ? '自动刷新已开启，每 5 秒更新一次' : '当前为手动刷新模式'}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Gateway</span>
              <strong className="summary-mini-value">{snapshot?.gateway?.gatewayState ?? '未检测到'}</strong>
              <span className="summary-mini-meta">最后更新于 {formatTimestamp(snapshot?.gateway?.updatedAt)}</span>
            </section>
          </div>
          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack top-gap">
                {overviewWarnings.map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
              {remainingWarningCount > 0 ? (
                <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在“精细筛选”和“日志正文”里。</p>
              ) : null}
            </>
          ) : (
            <p className="helper-text top-gap">
              当前没有新的结构性提醒，可以直接看日志正文，或者按需展开预设与精细筛选。
            </p>
          )}
          <Toolbar>
            <Button kind="primary" onClick={() => setActiveTab('stream')}>打开日志正文</Button>
            <Button onClick={() => setQuickView('launch')}>回到常用去向</Button>
          </Toolbar>
        </Panel>
      ) : null}
    </>
  );

  const filtersSection = (
    <Panel
      title="精细筛选"
      subtitle="常用预设不够时，再手动缩小范围。这里适合熟手做二次深挖。"
      aside={(
        <Toolbar>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? '读取中…' : '读取'}
          </Button>
          <Button onClick={() => resetFilters()}>
            恢复默认
          </Button>
          <Button kind={autoRefresh ? 'primary' : 'secondary'} onClick={toggleAutoRefresh}>
            {autoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
          </Button>
        </Toolbar>
      )}
    >
      <div className="tab-bar tab-bar-dense">
        {LOG_OPTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tab ${logName === item.key ? 'active' : ''}`}
            onClick={() => setLogName(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Toolbar>
        <input className="search-input narrow" placeholder="level" value={level} onChange={(event) => setLevel(event.target.value)} />
        <input className="search-input" placeholder="包含关键词" value={contains} onChange={(event) => setContains(event.target.value)} />
        <input className="search-input tiny" placeholder="120" value={limit} onChange={(event) => setLimit(event.target.value)} />
        <Button
          kind="primary"
          onClick={() => {
            void load();
            setActiveTab('stream');
          }}
          disabled={loading}
        >
          应用筛选
        </Button>
      </Toolbar>

      <div className="detail-list">
        <KeyValueRow label="当前文件" value={logName} />
        <KeyValueRow label="日志目录" value={logsDir || '—'} />
        <KeyValueRow label="level" value={level || '未设置'} />
        <KeyValueRow label="contains" value={contains || '未设置'} />
        <KeyValueRow label="limit" value={limit || '120'} />
        <KeyValueRow label="最后运行态更新时间" value={formatTimestamp(snapshot?.gateway?.updatedAt)} />
      </div>

      <p className="helper-text top-gap">
        当你已经把日志缩到足够具体，再带着这些条件去别的工作台继续修复；配置页和扩展页这种低频联动不再放在首页打扰小白用户。
      </p>
      <Toolbar>
        <Button kind="primary" onClick={() => navigate('diagnostics', diagnosticsIntent)}>
          继续做诊断
        </Button>
        <Button onClick={() => navigate('config', configIntent)}>
          带到配置页
        </Button>
        <Button onClick={() => navigate('extensions', extensionsIntent)}>
          带到扩展页
        </Button>
      </Toolbar>
    </Panel>
  );

  const streamSection = (
    <Panel
      title="日志正文"
      subtitle="这里只显示当前筛选条件下的最终返回内容，修改条件请回到“精细筛选”。"
      aside={(
        <Toolbar>
          <Button onClick={() => setActiveTab('quick')}>
            回到概览
          </Button>
          <Button onClick={() => setActiveTab('filters')}>
            调整筛选
          </Button>
        </Toolbar>
      )}
    >
      {data ? (
        <>
          <div className="detail-list compact">
            <div className="key-value-row"><span>文件</span><strong>{data.filePath}</strong></div>
            <div className="key-value-row"><span>返回行数</span><strong>{data.lines.length}</strong></div>
            <div className="key-value-row"><span>level</span><strong>{level || '—'}</strong></div>
            <div className="key-value-row"><span>contains</span><strong>{contains || '—'}</strong></div>
          </div>
          <pre className="code-block tall">{data.lines.join('\n') || '没有匹配到日志行。'}</pre>
        </>
      ) : (
        <EmptyState title="暂无日志" description="点击上方“读取”开始加载日志。" />
      )}
    </Panel>
  );

  return (
    <div className="page-stack">
      <Panel
        title="日志工作台"
        subtitle="先用常用概览锁定问题方向，复杂过滤和正文查看都已经收进后面的子模块。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? '读取中…' : '读取'}
            </Button>
            <Button onClick={() => resetFilters()}>
              恢复默认
            </Button>
            <Button kind={autoRefresh ? 'primary' : 'secondary'} onClick={toggleAutoRefresh}>
              {autoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
            </Button>
          </Toolbar>
        )}
      >
        <p className="helper-text">
          默认顺序：先看当前焦点，再用预设判断方向，复杂过滤放到第二层，原始正文放到最后一层。
        </p>
        <div className="workspace-summary-strip">
          <section className="summary-mini-card">
            <span className="summary-mini-label">起步判断</span>
            <strong className="summary-mini-value">{logsStartReadiness}</strong>
            <span className="summary-mini-meta">{logsStartHint}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">当前日志</span>
            <strong className="summary-mini-value">{activeLogOption?.label ?? logName}</strong>
            <span className="summary-mini-meta">{contains ? `关键词 ${contains}` : '未附加关键词'}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">返回结果</span>
            <strong className="summary-mini-value">{lineCount} 行</strong>
            <span className="summary-mini-meta">{customFilterActive ? '当前为自定义视图' : '当前为默认视图'}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">Gateway</span>
            <strong className="summary-mini-value">{snapshot?.gateway?.gatewayState ?? '未检测到'}</strong>
            <span className="summary-mini-meta">{autoRefresh ? '自动刷新已开启' : '当前手动刷新'}</span>
          </section>
        </div>
      </Panel>

      {investigation ? (
        <ContextBanner
          label="Session Drilldown"
          title={investigation.headline}
          description={investigation.description}
          meta={(
            <div className="pill-row">
              <Pill>{investigation.context?.source ?? 'sessions'}</Pill>
              <Pill tone="warn">{investigation.logName ?? logName}</Pill>
              {investigation.contains ? <Pill>{investigation.contains}</Pill> : null}
            </div>
          )}
          actions={(
            <Toolbar>
              <Button onClick={() => setActiveTab('stream')}>打开日志正文</Button>
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>回到会话页</Button>
              <Button onClick={() => navigate('diagnostics', diagnosticsIntent)}>继续做诊断</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="tab-bar">
        {LOGS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'filters' && (level || contains || limit !== '120' || logName !== 'agent') ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'stream' && data?.lines.length ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'quick' ? quickSection : activeTab === 'filters' ? filtersSection : streamSection}
    </div>
  );
}
