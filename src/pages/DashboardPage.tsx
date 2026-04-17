import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  EmptyState,
  KeyValueRow,
  LoadingState,
  OverviewCard,
  Panel,
  Pill,
  StatCard,
  Toolbar,
} from '../components/ui';
import { RuntimePostureView } from '../components/runtime-posture';
import type { DiagnosticKind } from '../lib/diagnostics';
import { handoffToTerminal, openFinderLocation, type CommandScope } from '../lib/desktop';
import { formatTimestamp } from '../lib/format';
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
type DashboardOverviewViewKey = 'launch' | 'status' | 'checks';
type DashboardWorkspaceViewKey = 'output' | 'logs' | 'links';

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

const DIAGNOSTIC_ACTIONS: Array<{
  key: DiagnosticKind;
  label: string;
  kind: 'primary' | 'secondary';
}> = [
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
  { key: 'workspace', label: '常用材料', hint: '查看最近动作、日志尾部、会话与记忆文件。' },
  { key: 'advanced', label: '深度维护', hint: '低频 CLI 接管、依赖检查和工作区材料定位入口。' },
];

const DASHBOARD_OVERVIEW_VIEWS: Array<{
  key: DashboardOverviewViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  {
    key: 'launch',
    label: '常用去向',
    icon: '🚀',
    hint: '新手先从这里选下一步，不需要同时理解整页状态。',
  },
  {
    key: 'status',
    label: '当前判断',
    icon: '🌤️',
    hint: '只看最关键的状态摘要和提醒，不把更多细节一次堆满。',
  },
  {
    key: 'checks',
    label: '快速体检',
    icon: '🩺',
    hint: '最常用的安全检查集中在这里，低频动作继续后置。',
  },
];

const DASHBOARD_WORKSPACE_VIEWS: Array<{
  key: DashboardWorkspaceViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'output', label: '最近输出', icon: '🧾', hint: '先确认最近一次动作有没有真正成功。' },
  {
    key: 'logs',
    label: '日志预览',
    icon: '📄',
    hint: '只在需要时看日志尾部，不再和输出摘要并排铺开。',
  },
  {
    key: 'links',
    label: '继续查看',
    icon: '🗂️',
    hint: '会话、记忆和完整日志继续收在这一层入口里。',
  },
];

const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

function dependencyTone(dependency: BinaryStatus): HealthTone {
  if (dependency.found) {
    return 'good';
  }

  return ['hermes', 'curl', 'git', 'python3'].includes(dependency.name) ? 'bad' : 'warn';
}

function dashboardDiagnosticIcon(kind: DiagnosticKind) {
  switch (kind) {
    case 'doctor':
      return '🩺';
    case 'status':
      return '🧭';
    case 'gateway-status':
      return '📡';
    case 'dump':
      return '📦';
    case 'version':
      return '🏷️';
    default:
      return '🛠️';
  }
}

function buildHealthItems(
  data: DashboardSnapshot,
  installation: InstallationSnapshot,
  profileSummary: ProfileSummary | null
): HealthItem[] {
  const gateway = data.gateway;
  const modelReady = Boolean(data.config.modelDefault && data.config.modelProvider);
  const missingMemory = data.memoryFiles.filter(item => !item.exists);
  const hasAlias = Boolean(profileSummary?.aliases.length);
  const missingCoreDependencies = installation.dependencies.filter(
    item => !item.found && ['curl', 'git', 'python3'].includes(item.name)
  );

  return [
    {
      key: 'binary',
      title: 'Hermes CLI',
      tone: installation.binaryFound ? 'good' : 'bad',
      summary: installation.binaryFound ? '已安装' : '未安装',
      detail:
        installation.hermesBinary ?? '先执行一键安装，再接管 setup、model、gateway 和 skills。 ',
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
      summary: modelReady
        ? `${data.config.modelProvider} / ${data.config.modelDefault}`
        : '尚未完整配置',
      detail: data.config.modelBaseUrl
        ? `Base URL: ${data.config.modelBaseUrl}`
        : '建议先跑 `hermes model` 或 `hermes setup`，避免 CLI 和 gateway 启动后才暴露问题。 ',
    },
    {
      key: 'dependencies',
      title: '基础依赖',
      tone: missingCoreDependencies.length === 0 ? 'good' : 'warn',
      summary:
        missingCoreDependencies.length === 0
          ? '核心依赖齐备'
          : `缺失 ${missingCoreDependencies.length} 项`,
      detail:
        missingCoreDependencies.length === 0
          ? `${installation.dependencies.filter(item => item.found).length}/${installation.dependencies.length} 个依赖已就绪`
          : `缺失项：${missingCoreDependencies.map(item => item.name).join('、')}`,
    },
    {
      key: 'memory',
      title: '记忆链路',
      tone:
        data.config.memoryEnabled === false ? 'warn' : missingMemory.length === 0 ? 'good' : 'warn',
      summary:
        data.config.memoryEnabled === false
          ? 'memory 已关闭'
          : missingMemory.length === 0
            ? '记忆文件齐备'
            : `缺失 ${missingMemory.length} 项`,
      detail:
        data.config.memoryEnabled === false
          ? `当前 provider: ${data.config.memoryProvider || 'builtin-file'}`
          : missingMemory.length === 0
            ? `${data.memoryFiles.length} 个记忆文件均已就绪`
            : `缺失：${missingMemory.map(item => item.label).join('、')}`,
    },
    {
      key: 'alias',
      title: 'Profile Alias',
      tone: hasAlias ? 'good' : 'warn',
      summary: hasAlias ? `${profileSummary?.aliases.length ?? 0} 个 alias` : '未创建 alias',
      detail: hasAlias
        ? (profileSummary?.aliases
            .map(alias => (alias.isPrimary ? `${alias.name} (primary)` : alias.name))
            .join('、') ?? '—')
        : '建议至少保留一个 primary alias，方便脚本、cron 和多 profile 切换。 ',
    },
  ];
}

function buildWorkspaceArtifacts(
  data: DashboardSnapshot,
  installation: InstallationSnapshot
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
  const [_refreshing, setRefreshing] = useState(false);
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
  const [overviewView, setOverviewView] = useState<DashboardOverviewViewKey>('launch');
  const [workspaceView, setWorkspaceView] = useState<DashboardWorkspaceViewKey>('output');

  const currentProfile = useMemo(
    () => profiles?.profiles.find(item => item.name === profile) ?? null,
    [profile, profiles]
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

  async function openInFinder(
    actionKey: string,
    path: string,
    label: string,
    revealInFinder = false
  ) {
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
    }
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
    setActiveTab('overview');
    setOverviewView('launch');
    setWorkspaceView('output');
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
        <EmptyState title="读取失败" description={error ?? '未能读取 Hermes 控制中心快照。'} />
        <Toolbar>
          <Button onClick={() => void load()}>重试</Button>
        </Toolbar>
      </Panel>
    );
  }

  const primaryAlias =
    currentProfile?.aliases.find(alias => alias.isPrimary) ?? currentProfile?.aliases[0] ?? null;
  const posture = buildRuntimePosture({ dashboard: data });
  const healthItems = buildHealthItems(data, installation, currentProfile);
  const overviewHealthItems = healthItems.filter(item =>
    ['binary', 'model', 'gateway', 'memory'].includes(item.key)
  );
  const workspaceArtifacts = buildWorkspaceArtifacts(data, installation);
  const runtimeWarnings = [...data.warnings];
  const dependencyReadyCount = installation.dependencies.filter(item => item.found).length;
  const workingDirectory = installation.hermesHomeExists ? installation.hermesHome : null;
  const gatewayRunning = data.gateway?.gatewayState === 'running';
  const modelReady = Boolean(data.config.modelProvider && data.config.modelDefault);
  const missingArtifacts = workspaceArtifacts.filter(item => !item.exists).length;
  const startReadiness =
    installation.binaryFound && modelReady
      ? gatewayRunning
        ? '可以开始'
        : '待启动通道'
      : '先补基础';
  const startReadinessMeta = !installation.binaryFound
    ? '先安装 CLI 才能让所有客户端动作真正执行。'
    : !modelReady
      ? '先补齐 provider、模型和连接参数。'
      : gatewayRunning
        ? '基础链路已连上，可以继续聊天、接入技能或做自动化。'
        : '基础配置已具备，下一步建议先启动或检查网关。';

  if (isMacPlatform) {
    runtimeWarnings.push(
      'macOS 提示：Terminal 接管使用系统 Terminal，交互式 setup / model / skills config 会在那里持续运行，执行完再回面板刷新。'
    );
  }

  const overviewWarnings = runtimeWarnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, runtimeWarnings.length - overviewWarnings.length);
  const memoryReadyCount = data.memoryFiles.filter(item => item.exists).length;
  const activeOverviewView =
    DASHBOARD_OVERVIEW_VIEWS.find(item => item.key === overviewView) ?? DASHBOARD_OVERVIEW_VIEWS[0];
  const activeWorkspaceView =
    DASHBOARD_WORKSPACE_VIEWS.find(item => item.key === workspaceView) ??
    DASHBOARD_WORKSPACE_VIEWS[0];
  const overviewCheckActions = DIAGNOSTIC_ACTIONS.filter(item => item.key !== 'version');

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
        title="总览入口"
        subtitle="总览页拆成二级工作面，默认只展开一个主区块，避免首页同时挤满多个摘要区。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {DASHBOARD_OVERVIEW_VIEWS.map(item => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${overviewView === item.key ? 'active' : ''}`}
              onClick={() => setOverviewView(item.key)}
            >
              <strong>
                <span className="dashboard-shortcut-icon">{item.icon}</span>
                {item.label}
              </strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeOverviewView.hint}</p>
      </Panel>

      {overviewView === 'launch' ? (
        <Panel
          title="常用去向"
          subtitle="首页只显式保留最常用入口，其他治理动作继续收在对应页面和深度维护里。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('config')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">⚙️</span>配置中心
              </strong>
              <span>
                {modelReady
                  ? `${data.config.modelProvider} / ${data.config.modelDefault}`
                  : '先补 provider、模型与基础参数'}
              </span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('gateway')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">📡</span>通道与网关
              </strong>
              <span>
                {gatewayRunning
                  ? `${data.gateway?.platforms.length ?? 0} 个平台已接入`
                  : '先启动或检查 Gateway'}
              </span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('skills')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">🧩</span>技能与能力
              </strong>
              <span>
                {data.counts.skills > 0
                  ? `${data.counts.skills} 个技能可继续使用`
                  : '先接入常用技能'}
              </span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => {
                setWorkspaceView(lastResult ? 'output' : logPreview ? 'logs' : 'links');
                setActiveTab('workspace');
              }}
            >
              <strong>
                <span className="dashboard-shortcut-icon">🗂️</span>回执与材料
              </strong>
              <span>
                {lastResult || logPreview
                  ? '最近输出和日志已经可看'
                  : '需要时再展开日志、回执和资料'}
              </span>
            </button>
          </div>
          <p className="helper-text top-gap">
            自动化、原始文件、依赖检查和官方向导都已经后置，不再占首页主要视觉位。
          </p>
        </Panel>
      ) : null}

      {overviewView === 'status' ? (
        <Panel
          title="当前判断"
          subtitle="这里只保留最关键的状态和少量提醒，避免一进来就看到太多块状信息。"
        >
          <div className="workspace-summary-strip">
            {overviewHealthItems.map(item => (
              <section className="summary-mini-card" key={item.key}>
                <span className="summary-mini-label">{item.title}</span>
                <strong className="summary-mini-value">{item.summary}</strong>
                <span className="summary-mini-meta">{item.detail}</span>
              </section>
            ))}
          </div>
          <p className="helper-text top-gap">{startReadinessMeta}</p>
          <div className="meta-line">
            <span>当前起点：{startReadiness}</span>
            <span>主 Alias：{primaryAlias?.name ?? '未创建'}</span>
            <span>最近刷新：{lastLoadedAt ? formatTimestamp(lastLoadedAt) : '—'}</span>
          </div>

          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack">
                {overviewWarnings.slice(0, 2).map(warning => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
              {remainingWarningCount > 0 ? (
                <p className="helper-text top-gap">
                  还有 {remainingWarningCount} 条提醒已经继续收进“常用材料”和“深度维护”。
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="当前状态比较清晰"
              description="基础链路看起来可用，可以继续去配置、技能或网关页完成下一步。"
            />
          )}

          <Toolbar>
            <Button kind="primary" onClick={() => navigate('config')}>
              去常用配置
            </Button>
            <Button onClick={() => setActiveTab('advanced')}>看深度建议</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {overviewView === 'checks' ? (
        <Panel
          title="快速体检"
          subtitle="最常用的安全检查单独放成一个工作面，避免和去向判断混在同一屏里。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            {overviewCheckActions.map(item => (
              <button
                key={item.key}
                type="button"
                className="workspace-shortcut-card dashboard-shortcut-card"
                onClick={() => void runDiagnostic(item.key, item.label)}
                disabled={runningAction !== null || !installation.binaryFound}
              >
                <strong>
                  <span className="dashboard-shortcut-icon">
                    {dashboardDiagnosticIcon(item.key)}
                  </span>
                  {item.label}
                </strong>
                <span>
                  {runningAction === `diagnostic:${item.key}`
                    ? `${item.label} 执行中…`
                    : '执行后结果会回写到常用材料里'}
                </span>
              </button>
            ))}
          </div>
          <div className="detail-list compact top-gap">
            <KeyValueRow
              label="推荐顺序"
              value="先健康检查，再网关诊断 / 全量状态，最后看安装摘要"
            />
            <KeyValueRow label="最近动作" value={lastResult?.label ?? '尚未执行最近一次体检'} />
          </div>
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => {
                setWorkspaceView('output');
                setActiveTab('workspace');
              }}
            >
              查看最近输出
            </Button>
            <Button onClick={() => navigate('diagnostics')}>进入诊断页</Button>
          </Toolbar>
        </Panel>
      ) : null}
    </>
  );

  const workspaceSection = (
    <>
      <Panel
        title="材料入口"
        subtitle="最近输出、日志预览和继续查看拆成子视图，默认只展开当前最需要的一层。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {DASHBOARD_WORKSPACE_VIEWS.map(item => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${workspaceView === item.key ? 'active' : ''}`}
              onClick={() => setWorkspaceView(item.key)}
            >
              <strong>
                <span className="dashboard-shortcut-icon">{item.icon}</span>
                {item.label}
              </strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeWorkspaceView.hint}</p>
      </Panel>

      {workspaceView === 'output' ? (
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
              <pre className="code-block compact-code">
                {lastResult.result.stdout || 'stdout 为空'}
              </pre>
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
          <Toolbar>
            <Button kind="primary" onClick={() => setWorkspaceView('logs')}>
              继续看日志
            </Button>
            <Button onClick={() => setWorkspaceView('links')}>查看更多材料入口</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {workspaceView === 'logs' ? (
        <Panel
          title="日志尾部预览"
          subtitle="先看日志尾部再决定是否切到日志页深挖，自动刷新也收进这个材料区。"
          aside={
            <Toolbar>
              <select
                className="select-input"
                value={logName}
                onChange={event => setLogName(event.target.value)}
              >
                {LOG_OPTIONS.map(item => (
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
          }
        >
          {logPreview ? (
            <>
              <div className="detail-list compact">
                <KeyValueRow label="文件" value={logPreview.filePath} />
                <KeyValueRow label="返回行数" value={logPreview.lines.length} />
              </div>
              <pre className="code-block compact-code">
                {logPreview.lines.join('\n') || '没有匹配到日志行。'}
              </pre>
            </>
          ) : (
            <EmptyState
              title="暂无日志预览"
              description={logError ?? '还没有读取到日志内容，可切换日志类型后再试。'}
            />
          )}
          <Toolbar>
            <Button kind="primary" onClick={() => navigate('logs')}>
              打开完整日志
            </Button>
            <Button onClick={() => setWorkspaceView('links')}>查看更多入口</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {workspaceView === 'links' ? (
        <Panel
          title="继续查看"
          subtitle="会话、记忆和更多资料不再直接铺满当前页，需要时再跳转进入对应工作台。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('logs')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">🧾</span>完整日志
              </strong>
              <span>
                {logPreview ? `${logPreview.lines.length} 行预览已加载` : '当前还没有日志预览'}
              </span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('sessions')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">💬</span>会话浏览
              </strong>
              <span>
                {data.counts.sessions > 0
                  ? `${data.counts.sessions} 条会话轨迹`
                  : '先运行一次对话再回来查看'}
              </span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => navigate('memory')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">🧠</span>记忆资料
              </strong>
              <span>
                {memoryReadyCount}/{data.memoryFiles.length} 个记忆文件已就绪
              </span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => setActiveTab('advanced')}
            >
              <strong>
                <span className="dashboard-shortcut-icon">🛠️</span>深度维护
              </strong>
              <span>
                {missingArtifacts > 0
                  ? `${missingArtifacts} 个工作区材料缺失`
                  : '依赖和材料都已经收进进阶层'}
              </span>
            </button>
          </div>
        </Panel>
      ) : null}
    </>
  );

  const advancedSection = (
    <>
      <Panel title="链路建议与分流" subtitle="只有在你需要更深判断时，再到这里展开完整链路建议。">
        <RuntimePostureView posture={posture} navigate={navigate} />
        <p className="helper-text top-gap">当前起点说明：{startReadinessMeta}</p>
        <p className="helper-text">当前版本：{installation.versionOutput.trim() || '—'}</p>
      </Panel>

      <div className="overview-grid">
        <OverviewCard
          title="CLI 生命周期"
          value={installation.binaryFound ? '安装 / 升级 / 卸载' : '先完成安装'}
          meta="保持 0 侵入，直接复用 Hermes 官方安装脚本与 update / uninstall。"
          actions={
            <Toolbar>
              {lifecycleActions.map(item => (
                <Button
                  key={item.key}
                  kind={item.kind}
                  onClick={() =>
                    void openInTerminal(item.key, item.label, item.command, {
                      scope: item.scope,
                      confirmMessage: item.confirmMessage,
                    })
                  }
                  disabled={runningAction !== null || item.disabled}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
            </Toolbar>
          }
        />
        <OverviewCard
          title="Profile 向导"
          value={modelReady ? 'Setup 已落地' : '建议先走官方向导'}
          meta="把 setup、model、config migrate、claw migrate 收成同一层入口，不在 YAML 里硬改。"
          actions={
            <Toolbar>
              {setupActions.map(item => (
                <Button
                  key={item.key}
                  kind={item.kind}
                  onClick={() =>
                    void openInTerminal(item.key, item.label, item.command, {
                      scope: 'profile',
                      workingDirectory,
                    })
                  }
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
            </Toolbar>
          }
        />
        <OverviewCard
          title="Tooling / Skills"
          value={data.counts.skills > 0 ? `${data.counts.skills} 个技能已接入` : '能力面待接管'}
          meta="把终端后端、工具选择与技能开关拉通，避免功能只停留在读取层。"
          actions={
            <Toolbar>
              {toolingActions.map(item => (
                <Button
                  key={item.key}
                  onClick={() =>
                    void openInTerminal(item.key, item.label, item.command, {
                      scope: 'profile',
                      workingDirectory,
                    })
                  }
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
            </Toolbar>
          }
        />
        <OverviewCard
          title="Gateway / Finder"
          value={gatewayRunning ? '服务已接管' : '等待 service 接管'}
          meta="把 gateway service 和关键工作区入口集中在低频维护层，不再干扰首页判断。"
          actions={
            <Toolbar>
              {gatewayServiceActions.map(item => (
                <Button
                  key={item.key}
                  kind={item.kind}
                  onClick={() =>
                    void openInTerminal(item.key, item.label, item.command, {
                      scope: 'profile',
                      workingDirectory,
                      confirmMessage: item.confirmMessage,
                    })
                  }
                  disabled={runningAction !== null || item.disabled}
                >
                  {runningAction === item.key ? `${item.label}…` : item.label}
                </Button>
              ))}
              <Button
                onClick={() =>
                  void openInFinder('finder:home', installation.hermesHome, '打开 Hermes Home')
                }
                disabled={runningAction !== null || !installation.hermesHomeExists}
              >
                打开 Home
              </Button>
              <Button
                onClick={() =>
                  void openInFinder('finder:logs', `${data.hermesHome}/logs`, '打开 logs 目录')
                }
                disabled={runningAction !== null || !installation.logsDirExists}
              >
                打开 logs
              </Button>
              <Button
                onClick={() =>
                  void openInFinder(
                    'finder:config',
                    `${data.hermesHome}/config.yaml`,
                    '定位 config.yaml',
                    true
                  )
                }
                disabled={runningAction !== null || !installation.configExists}
              >
                定位 config
              </Button>
            </Toolbar>
          }
        />
      </div>

      <Panel
        title="依赖与工作区"
        subtitle="把可执行依赖、关键文件和工作区材料收敛到进阶维护层，避免新手首页直接面对太多系统细节。"
      >
        <div className="status-list">
          {installation.dependencies.map(dependency => (
            <section className="status-item" key={dependency.name}>
              <div>
                <div className="status-item-title">{dependency.name}</div>
                <p className="status-item-copy">{dependency.note}</p>
                <span className="status-item-path">{dependency.path ?? '未检测到可执行路径'}</span>
              </div>
              <Pill tone={dependencyTone(dependency)}>{dependency.found ? '已发现' : '缺失'}</Pill>
            </section>
          ))}
        </div>

        <div className="artifact-grid">
          {workspaceArtifacts.map(item => (
            <section className="artifact-card" key={item.key}>
              <div className="artifact-card-header">
                <strong>{item.label}</strong>
                <Pill tone={item.exists ? 'good' : 'warn'}>{item.exists ? '存在' : '缺失'}</Pill>
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
      <div className="stat-cards stat-cards-4">
        <StatCard
          label="开始状态"
          value={startReadiness}
          meta={startReadinessMeta}
          tone={installation.binaryFound && modelReady ? 'running' : 'warning'}
        />
        <StatCard
          label="Gateway"
          value={gatewayRunning ? '运行中' : '待启动'}
          meta={
            gatewayRunning
              ? `PID ${data.gateway?.pid ?? '—'} · ${data.gateway?.activeAgents ?? 0} 个活跃 Agent`
              : '当前还没有检测到运行中的网关状态。'
          }
          tone={gatewayRunning ? 'running' : 'warning'}
        />
        <StatCard
          label="Model"
          value={
            modelReady ? `${data.config.modelProvider} / ${data.config.modelDefault}` : '模型待配置'
          }
          meta={
            data.config.modelBaseUrl ||
            '建议先跑官方 setup / model 向导，把 provider 与默认模型一次配齐。'
          }
          tone={modelReady ? 'running' : 'warning'}
        />
        <StatCard
          label="能力工作台"
          value={`${data.counts.skills} 技能 / ${data.counts.cronJobs} 作业`}
          meta={`会话 ${data.counts.sessions} · 主 Alias ${primaryAlias?.name ?? '未创建'}`}
        />
      </div>

      <div className="quick-actions">
        <Button
          kind="primary"
          onClick={() =>
            installation.binaryFound
              ? void runGatewayAction(
                  gatewayRunning ? 'restart' : 'start',
                  gatewayRunning ? '重启 Gateway' : '启动 Gateway'
                )
              : void openInTerminal(
                  'terminal:quick-install',
                  lifecycleActions[0].label,
                  installation.quickInstallCommand,
                  { scope: 'global' }
                )
          }
          disabled={runningAction !== null}
        >
          {installation.binaryFound
            ? gatewayRunning
              ? '重启 Gateway'
              : '启动 Gateway'
            : '一键安装 CLI'}
        </Button>
        <Button
          onClick={() => void runDiagnostic('doctor', '健康检查')}
          disabled={runningAction !== null || !installation.binaryFound}
        >
          健康检查
        </Button>
        <Button onClick={() => setActiveTab('advanced')}>深度维护</Button>
      </div>

      <div className="tab-bar">
        {DASHBOARD_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'workspace' && (lastResult || logError) ? (
              <span className="tab-dirty-dot" />
            ) : null}
            {tab.key === 'advanced' &&
            (missingArtifacts > 0 || dependencyReadyCount !== installation.dependencies.length) ? (
              <span className="tab-dirty-dot" />
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview'
        ? overviewSection
        : activeTab === 'workspace'
          ? workspaceSection
          : advancedSection}
    </div>
  );
}
