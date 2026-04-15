import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  type DrilldownSeed,
  inferDiagnosticCommand,
} from '../lib/drilldown';
import { formatTimestamp } from '../lib/format';
import type { DashboardSnapshot, LogReadResult } from '../types';
import { Button, ContextBanner, EmptyState, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import { isLogsPageIntent, type LogsPageIntent, type PageProps } from './types';

type LogsTabKey = 'quick' | 'filters' | 'stream';

const LOGS_TABS: Array<{ key: LogsTabKey; label: string; hint: string }> = [
  { key: 'quick', label: '常用概览', hint: '先判断当前日志焦点，再用预设或联动入口。' },
  { key: 'filters', label: '精细筛选', hint: '手动调整日志文件、级别、关键词和返回行数。' },
  { key: 'stream', label: '日志正文', hint: '查看最终返回的日志内容。' },
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
  const gatewayIntent = buildGatewayDrilldownIntent(relaySeed, {
    description: '把当前日志线索继续带到网关编排台，核对平台连接、交付作业和服务状态。',
    platformName: relaySeed.context?.source || contains || undefined,
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
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);
  const quickSection = (
    <>
      <Panel
        title="推荐下一步"
        subtitle="先锁定当前日志焦点，再决定是直接看正文、应用预设，还是带着线索继续联动排查。"
      >
        <div className="list-stack">
          <div className="list-card">
            <div className="list-card-title">
              <strong>先确认当前看的是什么日志</strong>
              <Pill tone={lineCount > 0 ? 'good' : 'warn'}>{activeLogOption?.label ?? logName}</Pill>
            </div>
            <p>新手先看当前文件、关键词和返回行数，避免还没锁定对象就直接去改配置或跑命令。</p>
            <div className="meta-line">
              <span>{data?.filePath ?? '尚未读取日志文件路径'}</span>
              <span>{lineCount} 行返回结果</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => setActiveTab('stream')}>
                打开日志正文
              </Button>
              <Button onClick={() => setActiveTab('filters')}>
                去精细筛选
              </Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>优先用高频预设，不必每次都手工筛选</strong>
              <Pill tone={customFilterActive ? 'warn' : 'good'}>
                {customFilterActive ? '当前为自定义条件' : '当前为默认视图'}
              </Pill>
            </div>
            <p>拿不准该看哪份日志时，先从网关错误、Provider 异常或工具异常这些高频入口开始。</p>
            <div className="meta-line">
              <span>{filterSummary || '默认过滤条件'}</span>
              <span>{autoRefresh ? '自动刷新开启' : '自动刷新关闭'}</span>
            </div>
            <Toolbar>
              <Button
                kind="primary"
                onClick={() => {
                  applyPreset('gateway-error');
                  setActiveTab('stream');
                }}
              >
                看网关错误
              </Button>
              <Button
                onClick={() => {
                  applyPreset('provider-error');
                  setActiveTab('stream');
                }}
              >
                看 Provider 异常
              </Button>
              <Button onClick={() => resetFilters()}>
                恢复默认视图
              </Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>日志别孤立看，必要时直接带着线索下钻</strong>
              <Pill tone={investigation ? 'warn' : 'neutral'}>
                {investigation ? '带上下文继续排查' : '常用联动'}
              </Pill>
            </div>
            <p>日志只负责暴露症状，真正修复通常还要回到诊断、网关、扩展或配置中心继续核对。</p>
            <div className="meta-line">
              <span>{investigation?.headline ?? '未带入额外下钻上下文'}</span>
              <span>{snapshot?.gateway?.gatewayState === 'running' ? 'Gateway 运行中' : 'Gateway 待确认'}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => navigate('diagnostics', diagnosticsIntent)}>
                进入诊断页
              </Button>
              <Button onClick={() => navigate('gateway', gatewayIntent)}>
                进入网关页
              </Button>
              <Button onClick={() => navigate('config', configIntent)}>
                进入配置页
              </Button>
              <Button onClick={() => navigate('extensions', extensionsIntent)}>
                进入扩展页
              </Button>
            </Toolbar>
          </div>
        </div>
      </Panel>

      <Panel
        title="当前判断"
        subtitle="把当前文件、过滤条件、Gateway 状态和结果数量收成摘要，小白先看这里就够了。"
      >
        <div className="health-grid">
          <section className="health-card">
            <div className="health-card-header">
              <strong>当前文件</strong>
              <Pill tone={lineCount > 0 ? 'good' : 'warn'}>{activeLogOption?.label ?? logName}</Pill>
            </div>
            <p>{data?.filePath ?? '尚未读取日志文件路径。'}</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>筛选模式</strong>
              <Pill tone={customFilterActive ? 'warn' : 'good'}>
                {customFilterActive ? '自定义' : '默认'}
              </Pill>
            </div>
            <p>{filterSummary || '当前没有额外 level / 关键词 过滤条件。'}</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>返回结果</strong>
              <Pill tone={lineCount > 0 ? 'good' : 'warn'}>{lineCount} 行</Pill>
            </div>
            <p>{autoRefresh ? '自动刷新已开启，日志会每 5 秒自动更新。' : '当前为手动刷新模式。'}</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Gateway</strong>
              <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                {snapshot?.gateway?.gatewayState ?? '未检测到'}
              </Pill>
            </div>
            <p>最后运行态更新时间：{formatTimestamp(snapshot?.gateway?.updatedAt)}</p>
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
        ) : null}
        <Toolbar>
          <Button onClick={() => logsDir && void openInFinder(logsDir, 'logs 目录')} disabled={!logsDir}>
            打开 logs
          </Button>
          <Button
            onClick={() => data?.filePath && void openInFinder(data.filePath, '当前日志文件', true)}
            disabled={!data?.filePath}
          >
            定位当前日志
          </Button>
          <Button onClick={() => setActiveTab('filters')}>
            去精细筛选
          </Button>
        </Toolbar>
      </Panel>

      <Panel
        title="常用预设"
        subtitle="不确定从哪里看起时，优先从这些高频入口开始，再决定要不要做精细筛选。"
      >
        <div className="workbench-grid">
          {PRESETS.map((preset) => (
            <section className="action-card" key={preset.key}>
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Preset</p>
                  <h3 className="action-card-title">{preset.label}</h3>
                </div>
                <Pill tone={preset.logName === logName ? 'good' : 'neutral'}>{preset.logName}</Pill>
              </div>
              <p className="action-card-copy">
                {preset.contains ? `包含关键词 ${preset.contains}` : '不附加关键词过滤'}，默认读取 {preset.limit} 行。
              </p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => {
                    applyPreset(preset.key);
                    setActiveTab('stream');
                  }}
                >
                  应用并查看
                </Button>
                <Button
                  onClick={() => {
                    applyPreset(preset.key);
                    setActiveTab('filters');
                  }}
                >
                  应用后微调
                </Button>
              </Toolbar>
            </section>
          ))}
        </div>
        <p className="helper-text top-gap">
          建议顺序：先用预设看尾部日志，再根据异常类型跳到诊断页执行 `doctor / gateway-status / config-check / tools-summary`，最后回到配置页修正 provider、context engine、toolsets 或终端后端。
        </p>
      </Panel>
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
    </Panel>
  );

  const streamSection = (
    <Panel
      title="日志正文"
      subtitle="这里只显示当前筛选条件下的最终返回内容，修改条件请回到“精细筛选”。"
      aside={(
        <Toolbar>
          <Button onClick={() => setActiveTab('filters')}>
            调整筛选
          </Button>
          <Button onClick={() => resetFilters()}>
            恢复默认
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
          默认顺序：先看“常用概览”里的当前判断和推荐动作，再决定是不是要进入“精细筛选”，最后才看“日志正文”里的原始输出。
        </p>
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
              <Button onClick={() => navigate('gateway', gatewayIntent)}>带着线索进网关页</Button>
              <Button onClick={() => navigate('extensions', extensionsIntent)}>带着线索进扩展页</Button>
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
