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

  useEffect(() => {
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

  return (
    <div className="page-stack">
      <Panel
        title="日志查看"
        subtitle="直接读取 Hermes 本地日志目录，并补上预设、自动刷新和排障联动，方便把日志分析当成日常工作流。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? '读取中…' : '读取'}
            </Button>
            <Button kind={autoRefresh ? 'primary' : 'secondary'} onClick={toggleAutoRefresh}>
              {autoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
            </Button>
          </Toolbar>
        )}
      >
        <div className="workbench-grid">
          {PRESETS.map((preset) => (
            <section className="action-card" key={preset.key}>
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Preset</p>
                  <h3 className="action-card-title">{preset.label}</h3>
                </div>
                <Pill tone="neutral">{preset.logName}</Pill>
              </div>
              <p className="action-card-copy">
                {preset.contains ? `包含关键词 ${preset.contains}` : '不附加关键词过滤'}，默认读取 {preset.limit} 行。
              </p>
              <Toolbar>
                <Button onClick={() => applyPreset(preset.key)}>应用预设</Button>
              </Toolbar>
            </section>
          ))}
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
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>回到会话页</Button>
              <Button onClick={() => navigate('diagnostics', diagnosticsIntent)}>继续做诊断</Button>
              <Button onClick={() => navigate('gateway', gatewayIntent)}>带着线索进网关页</Button>
              <Button onClick={() => navigate('extensions', extensionsIntent)}>带着线索进扩展页</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="two-column wide-left">
        <Panel
          title="过滤条件"
          subtitle="适合手动缩小范围。预设更适合快速排障，手动过滤更适合二次深挖。"
          aside={(
            <Toolbar>
              <select className="select-input" value={logName} onChange={(event) => setLogName(event.target.value)}>
                {LOG_OPTIONS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <input className="search-input narrow" placeholder="level" value={level} onChange={(event) => setLevel(event.target.value)} />
              <input className="search-input" placeholder="包含关键词" value={contains} onChange={(event) => setContains(event.target.value)} />
              <input className="search-input tiny" placeholder="120" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </Toolbar>
          )}
        >
          <div className="detail-list">
            <KeyValueRow label="当前 Profile" value={profile} />
            <KeyValueRow
              label="Gateway"
              value={(
                <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {snapshot?.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              )}
            />
            <KeyValueRow label="日志目录" value={logsDir || '—'} />
            <KeyValueRow label="文件" value={data?.filePath ?? '—'} />
            <KeyValueRow label="返回行数" value={data?.lines.length ?? 0} />
            <KeyValueRow label="最后运行态更新时间" value={formatTimestamp(snapshot?.gateway?.updatedAt)} />
          </div>
        </Panel>

        <Panel
          title="联动入口"
          subtitle="日志不该孤立分析，必要时直接跳到诊断、网关或配置页面继续排查。"
        >
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
            <Button onClick={() => navigate('diagnostics', diagnosticsIntent)}>进入诊断页</Button>
            <Button onClick={() => navigate('gateway', gatewayIntent)}>进入网关页</Button>
            <Button onClick={() => navigate('extensions', extensionsIntent)}>进入扩展页</Button>
            <Button onClick={() => navigate('config', configIntent)}>进入配置页</Button>
            <Button onClick={() => navigate('dashboard')}>回到工作台</Button>
          </Toolbar>
          <p className="helper-text">
            建议顺序：先用预设看尾部日志，再根据异常类型跳到诊断页执行 `doctor / gateway-status / config-check / tools-summary`，最后回到配置页修正 provider、context engine、toolsets 或终端后端。
          </p>
        </Panel>
      </div>

      <Panel title="日志内容">
        {data ? (
          <>
            <div className="detail-list compact">
              <div className="key-value-row"><span>文件</span><strong>{data.filePath}</strong></div>
              <div className="key-value-row"><span>返回行数</span><strong>{data.lines.length}</strong></div>
            </div>
            <pre className="code-block tall">{data.lines.join('\n') || '没有匹配到日志行。'}</pre>
          </>
        ) : (
          <EmptyState title="暂无日志" description="点击上方“读取”开始加载日志。" />
        )}
      </Panel>
    </div>
  );
}
