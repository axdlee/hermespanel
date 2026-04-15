import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, KeyValueRow, LoadingState, OverviewCard, Panel, Pill, StatCard, Toolbar } from '../components/ui';
import { RuntimePostureView } from '../components/runtime-posture';
import type { DiagnosticKind } from '../lib/diagnostics';
import { handoffToTerminal, openFinderLocation, type CommandScope } from '../lib/desktop';
import { formatEpoch, formatTimestamp } from '../lib/format';
import { buildRuntimePosture } from '../lib/posture';
import { api } from '../lib/api';
import type {
  BinaryStatus,
  CommandRunResult,
  DashboardSnapshot,
  InstallationSnapshot,
  LogReadResult,
  ProfileSummary,
} from '../types';
import type { PageProps } from './types';

type HealthTone = 'neutral' | 'good' | 'warn' | 'bad';
type DashboardTabKey = 'overview' | 'workspace' | 'advanced';

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

interface WorkspaceArtifact {
  key: string;
  label: string;
  path: string;
  exists: boolean;
}

interface LauncherAction {
  key: string;
  label: string;
  command: string;
  kind?: 'primary' | 'secondary' | 'danger';
  scope?: CommandScope;
  disabled?: boolean;
  confirmMessage?: string;
}

const AUTO_REFRESH_MS = 15_000;

const DIAGNOSTIC_ACTIONS: Array<{ key: DiagnosticKind; label: string; kind: 'primary' | 'secondary' }> = [
  { key: 'doctor', label: '健康检查', kind: 'primary' },
  { key: 'status', label: '全量状态', kind: 'secondary' },
  { key: 'gateway-status', label: '网关诊断', kind: 'secondary' },
  { key: 'dump', label: '安装摘要', kind: 'secondary' },
  { key: 'version', label: '版本', kind: 'secondary' },
];

const LOG_OPTIONS = [
  { key: 'gateway', label: 'gateway.log' },
  { key: 'gateway.error', label: 'gateway.error.log' },
  { key: 'agent', label: 'agent.log' },
  { key: 'errors', label: 'errors.log' },
];

const DASHBOARD_TABS: Array<{ key: DashboardTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看当前实例能不能用、下一步该去哪里。' },
  { key: 'workspace', label: '运行材料', hint: '查看最近动作、日志尾部、会话与记忆文件。' },
  { key: 'advanced', label: '进阶接管', hint: '低频 CLI 接管、依赖检查和工作区材料定位入口。' },
];

const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

function dependencyTone(dependency: BinaryStatus): HealthTone {
  if (dependency.found) {
    return 'good';
  }

  return ['hermes', 'curl', 'git', 'python3'].includes(dependency.name) ? 'bad' : 'warn';
}

function buildHealthItems(
  data: DashboardSnapshot,
  installation: InstallationSnapshot,
  profileSummary: ProfileSummary | null,
): HealthItem[] {
  const gateway = data.gateway;
  const modelReady = Boolean(data.config.modelDefault && data.config.modelProvider);
  const missingMemory = data.memoryFiles.filter((item) => !item.exists);
  const hasAlias = Boolean(profileSummary?.aliases.length);
  const missingCoreDependencies = installation.dependencies.filter(
    (item) => !item.found && ['curl', 'git', 'python3'].includes(item.name),
  );

  return [
    {
      key: 'binary',
      title: 'Hermes CLI',
      tone: installation.binaryFound ? 'good' : 'bad',
      summary: installation.binaryFound ? '已安装' : '未安装',
      detail: installation.hermesBinary ?? '先执行一键安装，再接管 setup、model、gateway 和 skills。 ',
    },
    {
      key: 'gateway',
      title: 'Gateway',
      tone: !gateway ? 'warn' : gateway.gatewayState === 'running' ? 'good' : 'warn',
      summary: gateway ? gateway.gatewayState : '未检测到',
      detail: gateway
        ? `${gateway.activeAgents} 个活跃 Agent · ${gateway.platforms.length} 个平台状态`
        : '还没有运行态文件，可先做 gateway setup 或直接启动。 ',
    },
    {
      key: 'model',
      title: '模型与 Provider',
      tone: modelReady ? 'good' : 'warn',
      summary: modelReady ? `${data.config.modelProvider} / ${data.config.modelDefault}` : '尚未完整配置',
      detail: data.config.modelBaseUrl
        ? `Base URL: ${data.config.modelBaseUrl}`
        : '建议先跑 `hermes model` 或 `hermes setup`，避免 CLI 和 gateway 启动后才暴露问题。 ',
    },
    {
      key: 'dependencies',
      title: '基础依赖',
      tone: missingCoreDependencies.length === 0 ? 'good' : 'warn',
      summary: missingCoreDependencies.length === 0 ? '核心依赖齐备' : `缺失 ${missingCoreDependencies.length} 项`,
      detail: missingCoreDependencies.length === 0
        ? `${installation.dependencies.filter((item) => item.found).length}/${installation.dependencies.length} 个依赖已就绪`
        : `缺失项：${missingCoreDependencies.map((item) => item.name).join('、')}`,
    },
    {
      key: 'memory',
      title: '记忆链路',
      tone: data.config.memoryEnabled === false ? 'warn' : missingMemory.length === 0 ? 'good' : 'warn',
      summary: data.config.memoryEnabled === false
        ? 'memory 已关闭'
        : missingMemory.length === 0
          ? '记忆文件齐备'
          : `缺失 ${missingMemory.length} 项`,
      detail: data.config.memoryEnabled === false
        ? `当前 provider: ${data.config.memoryProvider || 'builtin-file'}`
        : missingMemory.length === 0
          ? `${data.memoryFiles.length} 个记忆文件均已就绪`
          : `缺失：${missingMemory.map((item) => item.label).join('、')}`,
    },
    {
      key: 'alias',
      title: 'Profile Alias',
      tone: hasAlias ? 'good' : 'warn',
      summary: hasAlias ? `${profileSummary?.aliases.length ?? 0} 个 alias` : '未创建 alias',
      detail: hasAlias
        ? profileSummary?.aliases
          .map((alias) => alias.isPrimary ? `${alias.name} (primary)` : alias.name)
          .join('、') ?? '—'
        : '建议至少保留一个 primary alias，方便脚本、cron 和多 profile 切换。 ',
    },
  ];
}

function buildWorkspaceArtifacts(
  data: DashboardSnapshot,
  installation: InstallationSnapshot,
): WorkspaceArtifact[] {
  return [
    {
      key: 'home',
      label: 'Hermes Home',
      path: installation.hermesHome,
      exists: installation.hermesHomeExists,
    },
    {
      key: 'config',
      label: 'config.yaml',
      path: `${data.hermesHome}/config.yaml`,
      exists: installation.configExists,
    },
    {
      key: 'env',
      label: '.env',
      path: `${data.hermesHome}/.env`,
      exists: installation.envExists,
    },
    {
      key: 'state-db',
      label: 'state.db',
      path: `${data.hermesHome}/state.db`,
      exists: installation.stateDbExists,
    },
    {
      key: 'gateway-state',
      label: 'gateway_state.json',
      path: `${data.hermesHome}/gateway_state.json`,
      exists: installation.gatewayStateExists,
    },
    {
      key: 'logs',
      label: 'logs/',
      path: `${data.hermesHome}/logs`,
      exists: installation.logsDirExists,
    },
  ];
}

export function DashboardPage({ notify, profile, profiles, refreshProfiles, navigate }: PageProps) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
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
  const [activeTab, setActiveTab] = useState<DashboardTabKey>('overview');

  const currentProfile = useMemo(
    () => profiles?.profiles.find((item) => item.name === profile) ?? null,
    [profile, profiles],
  );

  async function load(options?: { includeProfiles?: boolean; silent?: boolean }) {
    const hasSnapshot = data !== null && installation !== null;
    if (hasSnapshot) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const [dashboardSnapshot, installationSnapshot] = await Promise.all([
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        options?.includeProfiles ? refreshProfiles(profile) : Promise.resolve(),
      ]);
      setData(dashboardSnapshot);
      setInstallation(installationSnapshot);
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

  function storeResult(label: string, result: CommandRunResult) {
    setLastResult({
      label,
      result,
      finishedAt: new Date().toISOString(),
    });
  }

  async function runDiagnostic(kind: DiagnosticKind, label: string) {
    const actionKey = `diagnostic:${kind}`;
    setRunningAction(actionKey);
    try {
      const result = await api.runDiagnostic(kind, profile);
      storeResult(label, result);
      notify(result.success ? 'success' : 'error', `${label} 已执行。`);
      if (kind === 'gateway-status' || kind === 'doctor' || kind === 'status') {
        await load({ silent: true });
        await loadLogPreview({ silent: true });
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function runGatewayAction(action: 'start' | 'restart' | 'stop', label: string) {
    const actionKey = `gateway:${action}`;
    setRunningAction(actionKey);
    try {
      const result = await api.runGatewayAction(action, profile);
      storeResult(label, result);
      notify(result.success ? 'success' : 'error', `${label} 已执行。`);
      await load({ silent: true });
      await loadLogPreview({ silent: true });
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function openInFinder(actionKey: string, path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey,
      label,
      notify,
      onResult: storeResult,
      path,
      revealInFinder,
      setBusy: setRunningAction,
    });
  }

  async function openInTerminal(
    actionKey: string,
    label: string,
    command: string,
    options?: {
      scope?: CommandScope;
      workingDirectory?: string | null;
      confirmMessage?: string;
    },
  ) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage: options?.confirmMessage,
      label,
      notify,
      onResult: storeResult,
      profile,
      scope: options?.scope,
      setBusy: setRunningAction,
      workingDirectory: options?.workingDirectory ?? null,
    });
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
    return <LoadingState label="正在加载 HermesPanel 控制中心。" />;
  }

  if (error || !data || !installation) {
    return (
      <Panel title="控制中心">
        <EmptyState
          title="读取失败"
          description={error ?? '未能读取 Hermes 控制中心快照。'}
        />
        <Toolbar>
          <Button onClick={() => void load()}>重试</Button>
        </Toolbar>
      </Panel>
    );
  }

  const primaryAlias = currentProfile?.aliases.find((alias) => alias.isPrimary) ?? currentProfile?.aliases[0] ?? null;
  const posture = buildRuntimePosture({ dashboard: data });
  const healthItems = buildHealthItems(data, installation, currentProfile);
  const workspaceArtifacts = buildWorkspaceArtifacts(data, installation);
  const runtimeWarnings = [...data.warnings];
  const dependencyReadyCount = installation.dependencies.filter((item) => item.found).length;
  const workingDirectory = installation.hermesHomeExists ? installation.hermesHome : null;
  const versionHeadline = installation.versionOutput.trim().split(/\r?\n/)[0] || '未读取 Hermes 版本';
  const gatewayRunning = data.gateway?.gatewayState === 'running';
  const modelReady = Boolean(data.config.modelProvider && data.config.modelDefault);
  const missingArtifacts = workspaceArtifacts.filter((item) => !item.exists).length;

  if (isMacPlatform) {
    runtimeWarnings.push(
      'macOS 提示：Terminal 接管使用系统 Terminal，交互式 setup / model / skills config 会在那里持续运行，执行完再回面板刷新。',
    );
  }

  const lifecycleActions: LauncherAction[] = [
    {
      key: 'terminal:quick-install',
      label: installation.binaryFound ? '重新安装 CLI' : '一键安装 CLI',
      command: installation.quickInstallCommand,
      kind: 'primary' as const,
      scope: 'global' as const,
      disabled: false,
    },
    {
      key: 'terminal:update',
      label: '升级 CLI',
      command: installation.updateCommand,
      kind: 'secondary' as const,
      scope: 'global' as const,
      disabled: !installation.binaryFound,
    },
    {
      key: 'terminal:uninstall',
      label: '卸载 CLI',
      command: installation.uninstallCommand,
      kind: 'danger' as const,
      scope: 'global' as const,
      disabled: !installation.binaryFound,
      confirmMessage: '确定在 Terminal 中执行 `hermes uninstall` 吗？这会移除 Hermes CLI。',
    },
  ];

  const setupActions: LauncherAction[] = [
    {
      key: 'terminal:setup',
      label: '全量 Setup',
      command: installation.setupCommand,
      kind: 'primary' as const,
    },
    {
      key: 'terminal:model',
      label: '配置模型',
      command: installation.modelCommand,
      kind: 'secondary' as const,
    },
    {
      key: 'terminal:config-migrate',
      label: '迁移配置',
      command: installation.configMigrateCommand,
      kind: 'secondary' as const,
    },
    {
      key: 'terminal:claw-migrate',
      label: '导入 OpenClaw',
      command: installation.clawMigrateCommand,
      kind: 'secondary' as const,
    },
  ];

  const toolingActions: LauncherAction[] = [
    {
      key: 'terminal:terminal-setup',
      label: '终端后端',
      command: installation.terminalSetupCommand,
    },
    {
      key: 'terminal:tools-setup',
      label: '工具选择',
      command: installation.toolsSetupCommand,
    },
    {
      key: 'terminal:skills-config',
      label: '技能开关',
      command: installation.skillsConfigCommand,
    },
  ];

  const gatewayServiceActions: LauncherAction[] = [
    {
      key: 'terminal:gateway-install',
      label: '安装服务',
      command: installation.gatewayInstallCommand,
      kind: 'primary' as const,
      disabled: !installation.binaryFound,
    },
    {
      key: 'terminal:gateway-setup',
      label: '配置渠道',
      command: installation.gatewaySetupCommand,
      kind: 'secondary' as const,
      disabled: !installation.binaryFound,
    },
    {
      key: 'terminal:gateway-uninstall',
      label: '卸载服务',
      command: installation.gatewayUninstallCommand,
      kind: 'danger' as const,
      disabled: !installation.binaryFound,
      confirmMessage: '确定卸载当前 profile 的 gateway 服务吗？',
    },
  ];

  const overviewSection = (
    <>
      <Panel
        title="推荐下一步"
        subtitle="把最常走的入口放前面，小白先顺着做，熟手再下钻到具体工作台。"
      >
        <div className="list-stack">
          <div className="list-card">
            <div className="list-card-title">
              <strong>模型、通道与基础参数</strong>
              <Pill tone={modelReady ? 'good' : 'warn'}>
                {modelReady ? '已就绪' : '建议先处理'}
              </Pill>
            </div>
            <p>{modelReady ? `${data.config.modelProvider} / ${data.config.modelDefault}` : '先补齐 provider、默认模型与基础连接参数，后面的能力链路才会稳定。'}</p>
            <div className="meta-line">
              <span>{data.config.modelBaseUrl || '未声明 Base URL'}</span>
              <span>{data.config.contextEngine || 'context.engine 未配置'}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => navigate('config')}>进入配置中心</Button>
              <Button onClick={() => navigate('profiles')}>切换实例</Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>Gateway 运行与消息链路</strong>
              <Pill tone={gatewayRunning ? 'good' : 'warn'}>
                {gatewayRunning ? '运行中' : '待启动'}
              </Pill>
            </div>
            <p>{gatewayRunning ? `PID ${data.gateway?.pid ?? '—'}，当前有 ${data.gateway?.activeAgents ?? 0} 个活跃 Agent。` : '先启动或检查 Gateway，再看平台连接、作业投递和日志材料。'}</p>
            <div className="meta-line">
              <span>{data.gateway?.platforms.length ?? 0} 个平台状态</span>
              <span>{data.gateway?.updatedAt ? formatTimestamp(data.gateway.updatedAt) : '尚无运行更新时间'}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => navigate('gateway')}>进入网关控制</Button>
              <Button onClick={() => navigate('logs')}>查看日志</Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>技能、扩展与能力面</strong>
              <Pill tone={data.counts.skills > 0 ? 'good' : 'warn'}>
                {data.counts.skills > 0 ? `${data.counts.skills} 项已接入` : '待补齐'}
              </Pill>
            </div>
            <p>常用能力建议优先在技能工作台里启用和治理，低频 CLI 接管动作已经后置到“进阶接管”。</p>
            <div className="meta-line">
              <span>{data.counts.skills} 个技能</span>
              <span>{data.counts.cronJobs} 个 Cron 作业</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => navigate('skills')}>进入技能页</Button>
              <Button onClick={() => navigate('extensions')}>查看扩展</Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>最近材料与运行记录</strong>
              <Pill tone={lastResult || logPreview ? 'good' : 'neutral'}>
                {lastResult || logPreview ? '已有材料' : '等待新记录'}
              </Pill>
            </div>
            <p>最近动作、日志尾部、会话历史和记忆文件都已经收进“运行材料”，避免首页继续堆满运维细节。</p>
            <div className="meta-line">
              <span>{lastLoadedAt ? `最近刷新 ${formatTimestamp(lastLoadedAt)}` : '尚未记录刷新时间'}</span>
              <span>{autoRefresh ? '自动刷新开启' : '自动刷新关闭'}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => setActiveTab('workspace')}>打开运行材料</Button>
              <Button onClick={() => navigate('sessions')}>查看会话</Button>
            </Toolbar>
          </div>
        </div>
      </Panel>

      <div className="two-column wide-left">
        <Panel
          title="运行姿态"
          subtitle="围绕 model/provider、terminal backend、context engine、memory、toolsets 和 gateway 看真实运行链路。"
        >
          <RuntimePostureView posture={posture} navigate={navigate} />
        </Panel>

        <Panel
          title="当前判断"
          subtitle="先看摘要结论和提醒，不把依赖、文件定位这类低频材料直接压在首页。"
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

          <div className="detail-list compact top-gap">
            <KeyValueRow label="最近刷新" value={lastLoadedAt ? formatTimestamp(lastLoadedAt) : '—'} />
            <KeyValueRow label="主 Alias" value={primaryAlias?.name ?? '未创建'} />
            <KeyValueRow label="当前版本信息" value={installation.versionOutput.trim() || '—'} />
          </div>

          {runtimeWarnings.length > 0 ? (
            <div className="warning-stack">
              {runtimeWarnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="当前没有额外提醒"
              description="基础摘要看起来是稳定的，可以继续进入配置、技能或网关工作台做下一步。"
            />
          )}
        </Panel>
      </div>
    </>
  );

  const workspaceSection = (
    <>
      <div className="two-column wide-left">
        <Panel
          title="最近输出"
          subtitle="无论是直接执行 gateway / doctor，还是把命令交给 Terminal，最后都能在这里看到最近一次动作摘要。"
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
              <pre className="code-block compact-code">{lastResult.result.stdout || 'stdout 为空'}</pre>
              {lastResult.result.stderr ? (
                <pre className="code-block compact-code">{lastResult.result.stderr}</pre>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="暂无执行摘要"
              description="首页上的任何快捷动作执行后，都会把结果回写到这里，便于确认这次操作是否真正完成。"
            />
          )}

          <div className="detail-list compact top-gap">
            <KeyValueRow label="当前版本信息" value={installation.versionOutput.trim() || '—'} />
          </div>
        </Panel>

        <Panel
          title="日志尾部预览"
          subtitle="先看日志尾部再决定是否切到日志页深挖，自动刷新也收进这个材料区。"
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
              <Button kind={autoRefresh ? 'primary' : 'secondary'} onClick={toggleAutoRefresh}>
                {autoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
              </Button>
            </Toolbar>
          )}
        >
          {logPreview ? (
            <>
              <div className="detail-list compact">
                <KeyValueRow label="文件" value={logPreview.filePath} />
                <KeyValueRow label="返回行数" value={logPreview.lines.length} />
              </div>
              <pre className="code-block compact-code">{logPreview.lines.join('\n') || '没有匹配到日志行。'}</pre>
            </>
          ) : (
            <EmptyState
              title="暂无日志预览"
              description={logError ?? '还没有读取到日志内容，可切换日志类型后再试。'}
            />
          )}
        </Panel>
      </div>

      <div className="two-column">
        <Panel title="最近会话">
          {data.recentSessions.length === 0 ? (
            <EmptyState title="暂无会话" description="先运行一次 Hermes 对话，会话历史就会回到这里。" />
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
    </>
  );

  const advancedSection = (
    <>
      <div className="overview-grid">
        <OverviewCard
          title="CLI 生命周期"
          value={installation.binaryFound ? '安装 / 升级 / 卸载' : '先完成安装'}
          meta="保持 0 侵入，直接复用 Hermes 官方安装脚本与 update / uninstall。"
          actions={(
            <Toolbar>
              {lifecycleActions.map((item) => (
                <Button
                  key={item.key}
                  kind={item.kind}
                  onClick={() => void openInTerminal(item.key, item.label, item.command, {
                    scope: item.scope,
                    confirmMessage: item.confirmMessage,
                  })}
                  disabled={runningAction !== null || item.disabled}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
            </Toolbar>
          )}
        />
        <OverviewCard
          title="Profile 向导"
          value={modelReady ? 'Setup 已落地' : '建议先走官方向导'}
          meta="把 setup、model、config migrate、claw migrate 收成同一层入口，不在 YAML 里硬改。"
          actions={(
            <Toolbar>
              {setupActions.map((item) => (
                <Button
                  key={item.key}
                  kind={item.kind}
                  onClick={() => void openInTerminal(item.key, item.label, item.command, {
                    scope: 'profile',
                    workingDirectory,
                  })}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
            </Toolbar>
          )}
        />
        <OverviewCard
          title="Tooling / Skills"
          value={data.counts.skills > 0 ? `${data.counts.skills} 个技能已接入` : '能力面待接管'}
          meta="把终端后端、工具选择与技能开关拉通，避免功能只停留在读取层。"
          actions={(
            <Toolbar>
              {toolingActions.map((item) => (
                <Button
                  key={item.key}
                  onClick={() => void openInTerminal(item.key, item.label, item.command, {
                    scope: 'profile',
                    workingDirectory,
                  })}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
            </Toolbar>
          )}
        />
        <OverviewCard
          title="Gateway / Finder"
          value={gatewayRunning ? '服务已接管' : '等待 service 接管'}
          meta="把 gateway service 和关键工作区入口集中在低频维护层，不再干扰首页判断。"
          actions={(
            <Toolbar>
              {gatewayServiceActions.map((item) => (
                <Button
                  key={item.key}
                  kind={item.kind}
                  onClick={() => void openInTerminal(item.key, item.label, item.command, {
                    scope: 'profile',
                    workingDirectory,
                    confirmMessage: item.confirmMessage,
                  })}
                  disabled={runningAction !== null || item.disabled}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
              <Button
                onClick={() => void openInFinder('finder:home', installation.hermesHome, '打开 Hermes Home')}
                disabled={runningAction !== null || !installation.hermesHomeExists}
              >
                打开 Home
              </Button>
              <Button
                onClick={() => void openInFinder('finder:logs', `${data.hermesHome}/logs`, '打开 logs 目录')}
                disabled={runningAction !== null || !installation.logsDirExists}
              >
                打开 logs
              </Button>
              <Button
                onClick={() => void openInFinder('finder:config', `${data.hermesHome}/config.yaml`, '定位 config.yaml', true)}
                disabled={runningAction !== null || !installation.configExists}
              >
                定位 config
              </Button>
            </Toolbar>
          )}
        />
      </div>

      <Panel
        title="依赖与工作区"
        subtitle="把可执行依赖、关键文件和工作区材料收敛到进阶维护层，避免新手首页直接面对太多系统细节。"
      >
        <div className="status-list">
          {installation.dependencies.map((dependency) => (
            <section className="status-item" key={dependency.name}>
              <div>
                <div className="status-item-title">{dependency.name}</div>
                <p className="status-item-copy">{dependency.note}</p>
                <span className="status-item-path">{dependency.path ?? '未检测到可执行路径'}</span>
              </div>
              <Pill tone={dependencyTone(dependency)}>
                {dependency.found ? '已发现' : '缺失'}
              </Pill>
            </section>
          ))}
        </div>

        <div className="artifact-grid">
          {workspaceArtifacts.map((item) => (
            <section className="artifact-card" key={item.key}>
              <div className="artifact-card-header">
                <strong>{item.label}</strong>
                <Pill tone={item.exists ? 'good' : 'warn'}>
                  {item.exists ? '存在' : '缺失'}
                </Pill>
              </div>
              <p>{item.path}</p>
            </section>
          ))}
        </div>
      </Panel>
    </>
  );

  return (
    <div className="page-stack">
      <div className="stat-cards">
        <StatCard
          label="Gateway"
          value={gatewayRunning ? '运行中' : '待启动'}
          meta={gatewayRunning ? `PID ${data.gateway?.pid ?? '—'} · ${data.gateway?.activeAgents ?? 0} 个活跃 Agent` : '当前还没有检测到运行中的网关状态。'}
          tone={gatewayRunning ? 'running' : 'warning'}
        />
        <StatCard
          label="CLI / Version"
          value={installation.binaryFound ? versionHeadline : '未安装 Hermes CLI'}
          meta={installation.binaryFound ? installation.hermesBinary ?? '已检测到 CLI' : '先安装后才能接管 setup、model、gateway 和 skills。'}
          tone={installation.binaryFound ? 'running' : 'stopped'}
        />
        <StatCard
          label="Model"
          value={modelReady ? `${data.config.modelProvider} / ${data.config.modelDefault}` : '模型待配置'}
          meta={data.config.modelBaseUrl || '建议先跑官方 setup / model 向导，把 provider 与默认模型一次配齐。'}
          tone={modelReady ? 'running' : 'warning'}
        />
        <StatCard
          label="Workspace"
          value={`${data.counts.sessions} 会话 / ${data.counts.skills} 技能`}
          meta={`Cron ${data.counts.cronJobs} · 主 Alias ${primaryAlias?.name ?? '未创建'}`}
        />
        <StatCard
          label="Dependencies"
          value={`${dependencyReadyCount}/${installation.dependencies.length}`}
          meta={dependencyReadyCount === installation.dependencies.length ? 'CLI 周边依赖齐备。' : '还存在缺失依赖，建议结合 doctor 继续体检。'}
          tone={dependencyReadyCount === installation.dependencies.length ? 'running' : 'warning'}
        />
        <StatCard
          label="Artifacts"
          value={missingArtifacts === 0 ? '工作区完整' : `缺失 ${missingArtifacts} 项`}
          meta={`Home ${installation.hermesHomeExists ? 'Ready' : 'Missing'} · logs ${installation.logsDirExists ? 'Ready' : 'Missing'}`}
          tone={missingArtifacts === 0 ? 'running' : 'warning'}
        />
      </div>

      <div className="quick-actions">
        <Button
          kind="primary"
          onClick={() => installation.binaryFound
            ? void runGatewayAction(gatewayRunning ? 'restart' : 'start', gatewayRunning ? '重启 Gateway' : '启动 Gateway')
            : void openInTerminal('terminal:quick-install', lifecycleActions[0].label, installation.quickInstallCommand, { scope: 'global' })}
          disabled={runningAction !== null}
        >
          {installation.binaryFound ? (gatewayRunning ? '重启 Gateway' : '启动 Gateway') : '一键安装 CLI'}
        </Button>
        <Button onClick={() => void runDiagnostic('doctor', '健康检查')} disabled={runningAction !== null || !installation.binaryFound}>
          健康检查
        </Button>
        <Button onClick={() => navigate('config')}>配置中心</Button>
        <Button onClick={() => navigate('gateway')}>网关控制</Button>
        <Button onClick={() => navigate('logs')}>日志查看</Button>
        <Button
          onClick={() => {
            void load({ includeProfiles: true });
            void loadLogPreview({ silent: true });
          }}
          disabled={refreshing}
        >
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <div className="tab-bar">
        {DASHBOARD_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'workspace' && (lastResult || logError) ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'advanced' && (missingArtifacts > 0 || dependencyReadyCount !== installation.dependencies.length) ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewSection : activeTab === 'workspace' ? workspaceSection : advancedSection}
    </div>
  );
}
