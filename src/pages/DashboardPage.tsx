import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import { RuntimePostureView } from '../components/runtime-posture';
import type { DiagnosticKind } from '../lib/diagnostics';
import { formatEpoch, formatTimestamp } from '../lib/format';
import { buildRuntimePosture } from '../lib/posture';
import { api } from '../lib/api';
import type { CommandRunResult, DashboardSnapshot, LogReadResult, ProfileSummary } from '../types';
import type { PageProps } from './types';

type HealthTone = 'neutral' | 'good' | 'warn' | 'bad';

interface QuickResultState {
  label: string;
  result: CommandRunResult;
  finishedAt: string;
}

interface HealthItem {
  key: string;
  title: string;
  tone: HealthTone;
  summary: string;
  detail: string;
}

const AUTO_REFRESH_MS = 15_000;

const DIAGNOSTIC_ACTIONS: Array<{ key: DiagnosticKind; label: string; kind: 'primary' | 'secondary' }> = [
  { key: 'version', label: 'Hermes 版本', kind: 'secondary' as const },
  { key: 'status', label: '全量状态', kind: 'secondary' as const },
  { key: 'gateway-status', label: '网关诊断', kind: 'secondary' as const },
  { key: 'dump', label: '安装摘要', kind: 'secondary' as const },
  { key: 'doctor', label: '健康检查', kind: 'primary' as const },
];

const LOG_OPTIONS = [
  { key: 'gateway', label: 'gateway.log' },
  { key: 'gateway.error', label: 'gateway.error.log' },
  { key: 'agent', label: 'agent.log' },
  { key: 'errors', label: 'errors.log' },
];

const WORKSPACE_SHORTCUTS = [
  { key: 'profiles', label: 'Profile 管理' },
  { key: 'gateway', label: '网关控制' },
  { key: 'config', label: '配置中心' },
  { key: 'extensions', label: '扩展能力' },
  { key: 'logs', label: '日志查看' },
  { key: 'cron', label: 'Cron 作业' },
  { key: 'diagnostics', label: '诊断面板' },
] as const;

const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

function buildHealthItems(data: DashboardSnapshot, profileSummary: ProfileSummary | null): HealthItem[] {
  const gateway = data.gateway;
  const hasFatalPlatform = gateway?.platforms.some((platform) => platform.state === 'fatal') ?? false;
  const missingMemory = data.memoryFiles.filter((item) => !item.exists);
  const modelReady = Boolean(data.config.modelDefault && data.config.modelProvider);
  const hasAlias = Boolean(profileSummary?.aliases.length);
  const workspaceSignals = [data.counts.sessions > 0, data.counts.skills > 0, data.counts.cronJobs > 0].filter(Boolean).length;
  const memoryEnabled = data.config.memoryEnabled !== false;
  const memoryProvider = data.config.memoryProvider || 'builtin-file';

  return [
    {
      key: 'gateway',
      title: 'Gateway',
      tone: !gateway ? 'warn' : hasFatalPlatform ? 'bad' : gateway.gatewayState === 'running' ? 'good' : 'warn',
      summary: !gateway ? '未读取到运行态' : gateway.gatewayState === 'running' ? '运行中' : gateway.gatewayState,
      detail: gateway
        ? `${gateway.activeAgents} 个活跃 Agent · ${gateway.platforms.length} 个平台状态`
        : '尚未发现 gateway_state.json，可先执行一次网关启动或诊断。',
    },
    {
      key: 'model',
      title: '模型配置',
      tone: modelReady ? 'good' : 'warn',
      summary: modelReady ? `${data.config.modelProvider} / ${data.config.modelDefault}` : 'provider 或 model 缺失',
      detail: data.config.modelBaseUrl
        ? `Base URL: ${data.config.modelBaseUrl}`
        : '未配置 Base URL 时将使用 provider 默认地址。',
    },
    {
      key: 'env',
      title: 'Secrets',
      tone: profileSummary?.envExists ? 'good' : 'warn',
      summary: profileSummary?.envExists ? '.env 已就绪' : '.env 缺失',
      detail: profileSummary?.envExists
        ? '敏感凭证文件已存在，可直接通过 Finder 定位。'
        : '建议补齐 API Key 或平台密钥，避免运行期才暴露问题。',
    },
    {
      key: 'memory',
      title: '记忆链',
      tone: !memoryEnabled ? 'warn' : missingMemory.length === 0 ? 'good' : 'warn',
      summary: !memoryEnabled
        ? 'memory 已关闭'
        : missingMemory.length === 0
          ? '核心记忆完整'
          : `缺失 ${missingMemory.length} 项记忆文件`,
      detail: !memoryEnabled
        ? `当前 provider: ${memoryProvider}，但运行态已关闭文件记忆闭环。`
        : missingMemory.length === 0
          ? `${data.memoryFiles.length} 个记忆文件都已就绪 · provider ${memoryProvider}`
          : `缺失项: ${missingMemory.map((item) => item.label).join('、')}`,
    },
    {
      key: 'alias',
      title: 'Profile Alias',
      tone: hasAlias ? 'good' : 'warn',
      summary: hasAlias ? `${profileSummary?.aliases.length ?? 0} 个 alias` : '尚未创建 alias',
      detail: hasAlias
        ? profileSummary?.aliases
          .map((alias) => alias.isPrimary ? `${alias.name} (primary)` : alias.name)
          .join('、') ?? '—'
        : '建议保留至少一个 primary alias，方便 CLI、cron 和脚本切换 profile。',
    },
    {
      key: 'workspace',
      title: '工作区活跃度',
      tone: workspaceSignals >= 2 ? 'good' : workspaceSignals === 1 ? 'neutral' : 'warn',
      summary: `${data.counts.sessions} 会话 / ${data.counts.skills} 技能 / ${data.counts.cronJobs} Cron`,
      detail: workspaceSignals >= 2
        ? '本地工作区已经有明显使用痕迹，可直接持续迭代。'
        : '如果这是新 profile，先跑一次会话或补几个技能会更容易验证全链路。',
    },
  ];
}

export function DashboardPage({ notify, profile, profiles, refreshProfiles, navigate }: PageProps) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<QuickResultState | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [logName, setLogName] = useState('gateway');
  const [logPreview, setLogPreview] = useState<LogReadResult | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  const currentProfile = useMemo(
    () => profiles?.profiles.find((item) => item.name === profile) ?? null,
    [profile, profiles],
  );

  async function load(options?: { includeProfiles?: boolean; silent?: boolean }) {
    const hasSnapshot = data !== null;
    if (hasSnapshot) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const [snapshot] = await Promise.all([
        api.getDashboardSnapshot(profile),
        options?.includeProfiles ? refreshProfiles(profile) : Promise.resolve(),
      ]);
      setData(snapshot);
      setError(null);
      setLastLoadedAt(new Date().toISOString());
    } catch (reason) {
      const message = String(reason);
      if (options?.silent) {
        return;
      }
      if (hasSnapshot) {
        notify('error', message);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadLogPreview(options?: { silent?: boolean }) {
    setLogLoading(true);
    try {
      const result = await api.readLog(logName, 40, undefined, undefined, profile);
      setLogPreview(result);
      setLogError(null);
    } catch (reason) {
      const message = String(reason);
      setLogPreview(null);
      setLogError(message);
      if (!options?.silent) {
        notify('error', message);
      }
    } finally {
      setLogLoading(false);
    }
  }

  async function storeResult(label: string, result: CommandRunResult, shouldReload = false) {
    setLastResult({
      label,
      result,
      finishedAt: new Date().toISOString(),
    });
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    if (shouldReload) {
      await load({ silent: true });
      await loadLogPreview({ silent: true });
    }
  }

  async function runDiagnostic(kind: DiagnosticKind, label: string) {
    setRunningAction(`diagnostic:${kind}`);
    try {
      const result = await api.runDiagnostic(kind, profile);
      await storeResult(label, result, kind === 'gateway-status' || kind === 'doctor' || kind === 'status');
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function runGatewayAction(action: string, label: string) {
    setRunningAction(`gateway:${action}`);
    try {
      const result = await api.runGatewayAction(action, profile);
      await storeResult(label, result, true);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    setRunningAction(`finder:${label}`);
    try {
      const result = await api.openInFinder({ path, revealInFinder });
      await storeResult(label, result);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  function toggleAutoRefresh() {
    const next = !autoRefresh;
    setAutoRefresh(next);
    notify('info', next ? '已开启 15 秒自动刷新。' : '已关闭自动刷新。');
  }

  useEffect(() => {
    void load({ includeProfiles: false });
  }, [profile]);

  useEffect(() => {
    void loadLogPreview({ silent: true });
  }, [logName, profile]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void load({ silent: true });
      void loadLogPreview({ silent: true });
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [autoRefresh, logName, profile]);

  if (loading) {
    return <LoadingState label="正在加载 HermesPanel 仪表盘。" />;
  }

  if (error || !data) {
    return (
      <Panel title="仪表盘">
        <EmptyState
          title="读取失败"
          description={error ?? '未能读取 Hermes 桌面快照。'}
        />
        <Toolbar>
          <Button onClick={() => void load()}>重试</Button>
        </Toolbar>
      </Panel>
    );
  }

  const configPath = `${data.hermesHome}/config.yaml`;
  const envPath = `${data.hermesHome}/.env`;
  const logsPath = `${data.hermesHome}/logs`;
  const cronPath = `${data.hermesHome}/cron`;
  const primaryAlias = currentProfile?.aliases.find((alias) => alias.isPrimary) ?? currentProfile?.aliases[0] ?? null;
  const healthItems = buildHealthItems(data, currentProfile);
  const posture = buildRuntimePosture({ dashboard: data });
  const runtimeWarnings = [...data.warnings];

  if (isMacPlatform) {
    runtimeWarnings.push(
      'macOS 提示：如果从 Finder 启动后发现 alias、PATH 或网关状态异常，优先检查 Hermes Binary 路径与 `~/.local/bin` 中的 wrapper。',
    );
  }

  return (
    <div className="page-stack">
      <Panel
        title="Hermes 工作台"
        subtitle="借鉴 ClawPanel 的工作台思路，但只包装 Hermes CLI、本地状态目录与运行产物，不改 Hermes Agent 本体。"
        aside={(
          <Toolbar>
            <Button
              onClick={() => {
                void load({ includeProfiles: true });
                void loadLogPreview({ silent: true });
              }}
              disabled={refreshing}
            >
              {refreshing ? '刷新中…' : '刷新'}
            </Button>
            <Button kind={autoRefresh ? 'primary' : 'secondary'} onClick={toggleAutoRefresh}>
              {autoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
            </Button>
          </Toolbar>
        )}
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">本地 Hermes 控制台</p>
            <p className="hero-subtitle">
              把 `~/.hermes`、gateway、会话、技能、记忆文件和 profile alias 收拢成统一桌面工作区。
            </p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={data.profileName} />
              <KeyValueRow label="Hermes Home" value={data.hermesHome} />
              <KeyValueRow label="Hermes Binary" value={data.hermesBinary} />
              <KeyValueRow label="Primary Alias" value={primaryAlias?.name ?? '未创建'} />
              <KeyValueRow label="最后刷新" value={formatTimestamp(lastLoadedAt)} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="会话数" value={data.counts.sessions} hint="来自 state.db 的历史对话" />
            <MetricCard label="技能数" value={data.counts.skills} hint="已扫描本地 skills 目录" />
            <MetricCard label="Cron 作业" value={data.counts.cronJobs} hint="复用 Hermes 原生 cron/jobs.json" />
            <MetricCard label="日志文件" value={data.counts.logFiles} hint="用于运行期排障与回溯" />
            <MetricCard label="平台配置" value={data.counts.configuredPlatforms} hint="来自当前 gateway 运行态" />
            <MetricCard
              label="Alias 数"
              value={currentProfile?.aliases.length ?? 0}
              hint={primaryAlias ? `主 alias: ${primaryAlias.name}` : '建议至少保留一个 primary alias'}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="运行姿态"
        subtitle="把 Hermes 真正决定 agent 行为的几条主链路收拢在一起看：首页偏总览，配置页会给更细的能力侧信息。"
      >
        <RuntimePostureView posture={posture} navigate={navigate} />
      </Panel>

      <div className="two-column wide-left">
        <Panel
          title="快捷工作台"
          subtitle="把最常用的网关控制、诊断与本地目录入口收在首页，减少切页成本。"
        >
          <div className="workbench-grid">
            <section className="action-card">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Gateway</p>
                  <h3 className="action-card-title">网关控制</h3>
                </div>
                <Pill tone={data.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {data.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p className="action-card-copy">
                直接透传 `hermes gateway start|restart|stop`，客户端只显示结果和运行态变化。
              </p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void runGatewayAction('start', '启动 Gateway')}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'gateway:start' ? '启动中…' : '启动'}
                </Button>
                <Button
                  onClick={() => void runGatewayAction('restart', '重启 Gateway')}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'gateway:restart' ? '重启中…' : '重启'}
                </Button>
                <Button
                  kind="danger"
                  onClick={() => void runGatewayAction('stop', '停止 Gateway')}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'gateway:stop' ? '停止中…' : '停止'}
                </Button>
              </Toolbar>
            </section>

            <section className="action-card">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Doctor</p>
                  <h3 className="action-card-title">Hermes 诊断</h3>
                </div>
                <Pill tone="neutral">CLI 原生输出</Pill>
              </div>
              <p className="action-card-copy">
                复用 `hermes version|status|dump|doctor`，不在面板里自造第二套诊断逻辑。
              </p>
              <Toolbar>
                {DIAGNOSTIC_ACTIONS.map((item) => (
                  <Button
                    key={item.key}
                    kind={item.kind}
                    onClick={() => void runDiagnostic(item.key, item.label)}
                    disabled={runningAction !== null}
                  >
                    {runningAction === `diagnostic:${item.key}` ? `${item.label}…` : item.label}
                  </Button>
                ))}
              </Toolbar>
            </section>

            <section className="action-card">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Finder</p>
                  <h3 className="action-card-title">macOS 快捷入口</h3>
                </div>
                <Pill tone="neutral">桌面集成</Pill>
              </div>
              <p className="action-card-copy">
                直接打开 Hermes Home、logs、cron 目录，或在 Finder 中定位关键配置文件和主 alias。
              </p>
              <Toolbar>
                <Button onClick={() => void openInFinder(data.hermesHome, '打开 Hermes Home')} disabled={runningAction !== null}>
                  打开 Home
                </Button>
                <Button onClick={() => void openInFinder(logsPath, '打开 logs 目录')} disabled={runningAction !== null}>
                  打开 logs
                </Button>
                <Button onClick={() => void openInFinder(cronPath, '打开 cron 目录')} disabled={runningAction !== null}>
                  打开 cron
                </Button>
                <Button onClick={() => void openInFinder(configPath, '定位 config.yaml', true)} disabled={runningAction !== null}>
                  定位 config.yaml
                </Button>
                <Button
                  onClick={() => void openInFinder(envPath, '定位 .env', true)}
                  disabled={runningAction !== null || !currentProfile?.envExists}
                >
                  定位 .env
                </Button>
                <Button
                  onClick={() => primaryAlias && void openInFinder(primaryAlias.path, '定位主 Alias', true)}
                  disabled={runningAction !== null || !primaryAlias}
                >
                  定位主 Alias
                </Button>
              </Toolbar>
            </section>

            <section className="action-card">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Workspace</p>
                  <h3 className="action-card-title">工作流跳转</h3>
                </div>
                <Pill tone="neutral">页面入口</Pill>
              </div>
              <p className="action-card-copy">
                需要继续细查时，直接从首页跳到对应页面，不用再从侧边栏重新找。
              </p>
              <Toolbar>
                {WORKSPACE_SHORTCUTS.map((item) => (
                  <Button key={item.key} onClick={() => navigate(item.key)}>
                    {item.label}
                  </Button>
                ))}
              </Toolbar>
            </section>
          </div>
        </Panel>

        <Panel
          title="系统体检"
          subtitle="围绕 Hermes 的真实运行对象给出健康摘要，帮助你在首页快速发现配置和运行风险。"
        >
          <div className="health-grid">
            {healthItems.map((item) => (
              <section className="health-card" key={item.key}>
                <div className="health-card-header">
                  <strong>{item.title}</strong>
                  <Pill tone={item.tone}>{item.summary}</Pill>
                </div>
                <p>{item.detail}</p>
              </section>
            ))}
          </div>
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel
          title="快捷输出"
          subtitle="集中显示最近一次快捷动作的命令、退出码与输出，避免来回切到诊断页。"
        >
          {lastResult ? (
            <div className="result-stack">
              <div className="result-header">
                <div>
                  <p className="eyebrow">Latest Action</p>
                  <h3 className="action-card-title">{lastResult.label}</h3>
                </div>
                <Pill tone={lastResult.result.success ? 'good' : 'bad'}>
                  {lastResult.result.success ? '成功' : '失败'}
                </Pill>
              </div>
              <div className="detail-list compact">
                <KeyValueRow label="命令" value={lastResult.result.command} />
                <KeyValueRow label="退出码" value={lastResult.result.exitCode} />
                <KeyValueRow label="完成时间" value={formatTimestamp(lastResult.finishedAt)} />
              </div>
              <pre className="code-block">{lastResult.result.stdout || 'stdout 为空'}</pre>
              {lastResult.result.stderr ? (
                <pre className="code-block">{lastResult.result.stderr}</pre>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="暂无快捷输出"
              description="执行上面的任一快捷动作后，命令输出会统一汇总到这里。"
            />
          )}
        </Panel>

        <div className="page-stack">
          <Panel title="当前配置摘要">
            <div className="detail-list">
              <KeyValueRow label="默认模型" value={data.config.modelDefault} />
              <KeyValueRow label="提供商" value={data.config.modelProvider} />
              <KeyValueRow label="Base URL" value={data.config.modelBaseUrl ?? '—'} />
              <KeyValueRow label="终端后端" value={data.config.terminalBackend} />
              <KeyValueRow label="工作目录" value={data.config.terminalCwd} />
              <KeyValueRow label="Context Engine" value={data.config.contextEngine ?? '—'} />
              <KeyValueRow label="人格" value={data.config.personality} />
              <KeyValueRow
                label="Toolsets"
                value={data.config.toolsets.length ? data.config.toolsets.join(', ') : '—'}
              />
              <KeyValueRow label="记忆功能" value={String(data.config.memoryEnabled ?? false)} />
              <KeyValueRow label="记忆 Provider" value={data.config.memoryProvider || 'builtin-file'} />
              <KeyValueRow label="用户画像" value={String(data.config.userProfileEnabled ?? false)} />
            </div>
          </Panel>

          <Panel title="网关状态摘要">
            {data.gateway ? (
              <div className="detail-list">
                <KeyValueRow
                  label="运行状态"
                  value={(
                    <Pill tone={data.gateway.gatewayState === 'running' ? 'good' : 'warn'}>
                      {data.gateway.gatewayState}
                    </Pill>
                  )}
                />
                <KeyValueRow label="PID" value={data.gateway.pid ?? '—'} />
                <KeyValueRow label="活跃 Agent" value={data.gateway.activeAgents} />
                <KeyValueRow label="更新时间" value={formatTimestamp(data.gateway.updatedAt)} />
                {data.gateway.platforms.map((platform) => (
                  <KeyValueRow
                    key={platform.name}
                    label={platform.name}
                    value={(
                      <span>
                        <Pill
                          tone={
                            platform.state === 'connected'
                              ? 'good'
                              : platform.state === 'fatal'
                                ? 'bad'
                                : 'warn'
                          }
                        >
                          {platform.state}
                        </Pill>
                        {platform.errorMessage ? ` ${platform.errorMessage}` : ''}
                      </span>
                    )}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="未检测到运行态" description="尚未读取到 gateway_state.json。" />
            )}
          </Panel>

          <Panel
            title="日志尾部预览"
            subtitle="参考 ClawPanel 的 log tail 思路，把最近日志直接带到首页，先看再决定是否深入日志页。"
            aside={(
              <Toolbar>
                <select
                  className="select-input"
                  value={logName}
                  onChange={(event) => setLogName(event.target.value)}
                >
                  {LOG_OPTIONS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <Button onClick={() => void loadLogPreview()} disabled={logLoading}>
                  {logLoading ? '读取中…' : '刷新日志'}
                </Button>
                <Button onClick={() => navigate('logs')}>进入日志页</Button>
              </Toolbar>
            )}
          >
            {logPreview ? (
              <>
                <div className="detail-list compact">
                  <KeyValueRow label="文件" value={logPreview.filePath} />
                  <KeyValueRow label="返回行数" value={logPreview.lines.length} />
                </div>
                <pre className="code-block">{logPreview.lines.join('\n') || '没有匹配到日志行。'}</pre>
              </>
            ) : (
              <EmptyState
                title="暂无日志预览"
                description={logError ?? '还没有读取到日志内容，可切换日志类型后再试。'}
              />
            )}
          </Panel>
        </div>
      </div>

      <div className="two-column">
        <Panel title="最近会话">
          {data.recentSessions.length === 0 ? (
            <EmptyState title="暂无会话" description="先运行一次 Hermes 对话，会话库就会出现。" />
          ) : (
            <div className="list-stack">
              {data.recentSessions.map((session) => (
                <div className="list-card" key={session.id}>
                  <div className="list-card-title">
                    <strong>{session.title || session.preview || session.id}</strong>
                    <Pill>{session.source}</Pill>
                  </div>
                  <p>{session.preview || '无预览文本'}</p>
                  <div className="meta-line">
                    <span>{session.model || '未知模型'}</span>
                    <span>{formatEpoch(session.startedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="记忆文件">
          <div className="list-stack">
            {data.memoryFiles.map((item) => (
              <div className="list-card" key={item.key}>
                <div className="list-card-title">
                  <strong>{item.label}</strong>
                  <Pill tone={item.exists ? 'good' : 'warn'}>
                    {item.exists ? '已存在' : '缺失'}
                  </Pill>
                </div>
                <p>{item.path}</p>
                <div className="meta-line">
                  <span>{item.key}</span>
                  <span>{formatTimestamp(item.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="运行提醒与版本">
        {runtimeWarnings.length === 0 ? (
          <EmptyState title="状态健康" description="当前未发现明显的本地运行风险。" />
        ) : (
          <div className="warning-stack">
            {runtimeWarnings.map((warning) => (
              <div className="warning-item" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        )}
        <pre className="code-block">{data.versionOutput}</pre>
      </Panel>
    </div>
  );
}
