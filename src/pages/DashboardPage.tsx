import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, InfoTip, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
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

  return (
    <div className="page-stack">
      <Panel
        title="Hermes 控制中心"
        subtitle="安装、接管、运行总览"
        tip={(
          <InfoTip content="首页只保留最常用的安装、接管、运行与诊断动作。说明信息改为后置，避免一进页面就被文案和重复入口淹没。"/>
        )}
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
        <div className="control-hero">
          <div className="hero-copy control-hero-copy">
            <div className="status-row">
              <span className={`status-chip ${installation.binaryFound ? 'good' : 'bad'}`}>
                {installation.binaryFound ? 'CLI Installed' : 'CLI Missing'}
              </span>
              <span className={`status-chip ${data.gateway?.gatewayState === 'running' ? 'good' : 'warn'}`}>
                {data.gateway?.gatewayState === 'running' ? 'Gateway Running' : 'Gateway Idle'}
              </span>
              <span className={`status-chip ${data.config.modelProvider && data.config.modelDefault ? 'good' : 'warn'}`}>
                {data.config.modelProvider && data.config.modelDefault ? 'Model Ready' : 'Model Pending'}
              </span>
            </div>
            <p className="hero-title">
              {installation.binaryFound ? '真正可操作的 Hermes 桌面治理台' : '先安装 Hermes，再接管 setup / model / gateway'}
            </p>
            <p className="hero-subtitle">安装、升级、setup、gateway、日志与目录入口都收敛在首页。</p>
            <div className="detail-list compact">
              <KeyValueRow label="当前 Profile" value={data.profileName} />
              <KeyValueRow label="Hermes Home" value={data.hermesHome} />
              <KeyValueRow label="Hermes Binary" value={installation.hermesBinary ?? '未检测到'} />
              <KeyValueRow label="Primary Alias" value={primaryAlias?.name ?? '未创建'} />
              <KeyValueRow label="版本摘要" value={installation.versionOutput.trim() || '—'} />
              <KeyValueRow label="最后刷新" value={formatTimestamp(lastLoadedAt)} />
            </div>
          </div>
          <div className="metrics-grid metrics-grid-tight">
            <MetricCard label="CLI" value={installation.binaryFound ? 'Ready' : 'Missing'} hint="Hermes 本体安装状态" />
            <MetricCard label="依赖" value={`${dependencyReadyCount}/${installation.dependencies.length}`} hint="CLI 周边依赖可见度" />
            <MetricCard label="会话数" value={data.counts.sessions} hint="来自 state.db" />
            <MetricCard label="技能数" value={data.counts.skills} hint="已扫描本地 skills" />
            <MetricCard label="Cron 作业" value={data.counts.cronJobs} hint="天然是 Hermes 的自动化闭环" />
            <MetricCard
              label="平台配置"
              value={data.gateway?.platforms.length ?? data.counts.configuredPlatforms}
              hint={data.gateway ? `${data.gateway.activeAgents} 个活跃 Agent` : '尚未发现运行态'}
            />
          </div>
        </div>
      </Panel>

      <div className="two-column wide-left">
        <Panel
          title="安装与接管"
          subtitle="把 Hermes CLI 生命周期、profile 配置向导、tooling 和 gateway service 入口直接放在首页。"
        >
          <div className="control-card-grid">
            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Lifecycle</p>
                  <h3 className="action-card-title">CLI 生命周期</h3>
                </div>
                <Pill tone={installation.binaryFound ? 'good' : 'bad'}>
                  {installation.binaryFound ? '可用' : '未安装'}
                </Pill>
              </div>
              <p className="action-card-copy">
                复用 Hermes 官方安装脚本与 `update / uninstall`，不在客户端里私自重写安装逻辑。
              </p>
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
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Profile Setup</p>
                  <h3 className="action-card-title">向导式接管</h3>
                </div>
                <Pill tone={data.config.modelProvider && data.config.modelDefault ? 'good' : 'warn'}>
                  {data.config.modelProvider && data.config.modelDefault ? '已配置' : '待补齐'}
                </Pill>
              </div>
              <p className="action-card-copy">
                针对 Hermes 的核心特性，把 `setup / model / config migrate / claw migrate` 做成第一层入口。
              </p>
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
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Tooling</p>
                  <h3 className="action-card-title">工具与技能</h3>
                </div>
                <Pill tone={data.counts.skills > 0 ? 'good' : 'warn'}>
                  {data.counts.skills > 0 ? `${data.counts.skills} 个技能` : '待配置'}
                </Pill>
              </div>
              <p className="action-card-copy">
                Hermes 的差异化能力在 toolsets、terminal backend、skills hub 和记忆插件，这里直接拉通。
              </p>
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
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Gateway Service</p>
                  <h3 className="action-card-title">消息网关服务</h3>
                </div>
                <Pill tone={data.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {data.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p className="action-card-copy">
                既能直接 `start / restart / stop`，也能把 `gateway install / setup / uninstall` 交给 Terminal 做完整闭环。
              </p>
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
              </Toolbar>
            </section>
          </div>
        </Panel>

        <Panel
          title="运行控制"
          subtitle="参考 ClawPanel 的 service / doctor / shortcut 组合方式，把最常用的操作集中到首页右侧。"
        >
          <div className="control-card-grid">
            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Runtime</p>
                  <h3 className="action-card-title">Gateway 控制</h3>
                </div>
                <Pill tone={data.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {data.gateway?.gatewayState ?? '未运行'}
                </Pill>
              </div>
              <p className="action-card-copy">
                首页直接控制当前 profile 的 gateway，不需要切页才能完成启停和重启。
              </p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void runGatewayAction('start', '启动 Gateway')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'gateway:start' ? '启动中…' : '启动'}
                </Button>
                <Button
                  onClick={() => void runGatewayAction('restart', '重启 Gateway')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'gateway:restart' ? '重启中…' : '重启'}
                </Button>
                <Button
                  kind="danger"
                  onClick={() => void runGatewayAction('stop', '停止 Gateway')}
                  disabled={runningAction !== null || !installation.binaryFound}
                >
                  {runningAction === 'gateway:stop' ? '停止中…' : '停止'}
                </Button>
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Doctor</p>
                  <h3 className="action-card-title">原生诊断</h3>
                </div>
                <Pill tone="neutral">CLI Output</Pill>
              </div>
              <p className="action-card-copy">
                保持 0 侵入，只展示 `hermes doctor / status / gateway status / dump` 的原生输出，不造第二套诊断体系。
              </p>
              <Toolbar>
                {DIAGNOSTIC_ACTIONS.map((item) => (
                  <Button
                    key={item.key}
                    kind={item.kind}
                    onClick={() => void runDiagnostic(item.key, item.label)}
                    disabled={runningAction !== null || !installation.binaryFound}
                  >
                    {runningAction === `diagnostic:${item.key}` ? `${item.label}…` : item.label}
                  </Button>
                ))}
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Finder</p>
                  <h3 className="action-card-title">macOS 材料入口</h3>
                </div>
                <Pill tone="neutral">Desktop</Pill>
              </div>
              <p className="action-card-copy">
                把关键文件和目录直接拉到 Finder，配合 Terminal handoff 才能形成真正可操作的桌面闭环。
              </p>
              <Toolbar>
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
                <Button
                  onClick={() => void openInFinder('finder:env', `${data.hermesHome}/.env`, '定位 .env', true)}
                  disabled={runningAction !== null || !installation.envExists}
                >
                  定位 .env
                </Button>
                <Button
                  onClick={() => primaryAlias && void openInFinder('finder:alias', primaryAlias.path, '定位主 Alias', true)}
                  disabled={runningAction !== null || !primaryAlias}
                >
                  定位 Alias
                </Button>
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Workspace</p>
                  <h3 className="action-card-title">当前实例摘要</h3>
                </div>
                <Pill tone="neutral">Workspace</Pill>
              </div>
              <div className="detail-list compact">
                <KeyValueRow label="当前 Profile" value={data.profileName} />
                <KeyValueRow label="主 Alias" value={primaryAlias?.name ?? '未创建'} />
                <KeyValueRow label="会话数" value={data.counts.sessions} />
                <KeyValueRow label="技能数" value={data.counts.skills} />
                <KeyValueRow label="Cron 作业" value={data.counts.cronJobs} />
              </div>
            </section>
          </div>
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel
          title="运行姿态"
          subtitle="围绕 model/provider、terminal backend、context engine、memory、toolsets 和 gateway 看真实运行链路。"
        >
          <RuntimePostureView posture={posture} navigate={navigate} />
        </Panel>

        <Panel
          title="系统就绪度"
          subtitle="把安装、依赖、关键文件和运行提醒收敛到一个更适合排查问题的右侧面板。"
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

          {runtimeWarnings.length > 0 ? (
            <div className="warning-stack">
              {runtimeWarnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel
          title="最近输出"
          subtitle="无论是直接执行 gateway/doctor，还是把命令交给 Terminal，最后都能在这里看到最近一次动作摘要。"
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
          subtitle="保留 ClawPanel 那种首页先看日志尾部的节奏，先做判断，再决定是否切到日志页深挖。"
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
    </div>
  );
}
