import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, InfoTip, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import { RuntimePostureView } from '../components/runtime-posture';
import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import { getDiagnosticCommand, type DiagnosticCommandDefinition, type DiagnosticKind } from '../lib/diagnostics';
import { buildRuntimePosture } from '../lib/posture';
import { enabledToolCount, isRemoteDelivery, localRuntimeSkillCount, pluginsCount, totalToolCount } from '../lib/runtime';
import type {
  CommandRunResult,
  ConfigDocuments,
  CronJobsSnapshot,
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  SkillItem,
} from '../types';
import { isConfigPageIntent, type ConfigPageIntent, type PageProps } from './types';

const CONFIG_WORKBENCH_KEYS: DiagnosticKind[] = [
  'config-check',
  'doctor',
  'memory-status',
  'gateway-status',
];

type ConfigTabKey = 'overview' | 'files' | 'advanced';
type ConfigOverviewViewKey = 'launch' | 'status' | 'checks';
type ConfigFileFocusKey = 'config' | 'env';
type ConfigFilesViewKey = 'editor' | 'signals' | 'output';
type ConfigAdvancedViewKey = 'actions' | 'posture' | 'output';

const CONFIG_TABS: Array<{ key: ConfigTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用设置', hint: '先看推荐下一步、当前判断和常用体检。' },
  { key: 'files', label: '原始文件', hint: '按需修改 config.yaml 与 .env。' },
  { key: 'advanced', label: '进阶接管', hint: '低频但必要的官方向导与 CLI 接管动作。' },
];

const CONFIG_OVERVIEW_VIEWS: Array<{
  key: ConfigOverviewViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'launch', label: '常用去向', icon: '🚀', hint: '先决定要去改配置、做体检，还是继续去能力链路。' },
  { key: 'status', label: '当前判断', icon: '🌤️', hint: '只看最核心的配置结论和提醒，不再默认连着体检区一起铺开。' },
  { key: 'checks', label: '快速体检', icon: '🩺', hint: '最常用的 4 个体检命令单独收成一个工作面。' },
];

const CONFIG_FILES_VIEWS: Array<{
  key: ConfigFilesViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'editor', label: '文件编辑', icon: '✍️', hint: '默认只专注当前正在改的那份文件，另一份文件收进辅助区。' },
  { key: 'signals', label: '闭环信号', icon: '🔗', hint: '文件改完后，再来看配置声明和运行态有没有对齐。' },
  { key: 'output', label: '最近输出', icon: '🧾', hint: 'Hermes 原生命令回显只放在这里，不默认占住编辑区。' },
];

const CONFIG_ADVANCED_VIEWS: Array<{
  key: ConfigAdvancedViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'actions', label: '接管动作', icon: '🛠️', hint: '低频但必要的官方向导和接管动作集中在这里。' },
  { key: 'posture', label: '运行姿态', icon: '🧭', hint: '需要判断配置、扩展、cron 和技能是不是同一条链路时再展开。' },
  { key: 'output', label: '最近输出', icon: '🧾', hint: '最近一次接管或体检输出后置到这里，不和动作区混在一起。' },
];

function configWorkbenchIcon(key: DiagnosticKind) {
  switch (key) {
    case 'config-check':
      return '🩺';
    case 'memory-status':
      return '🧠';
    case 'gateway-status':
      return '📡';
    case 'doctor':
      return '🧭';
    default:
      return '🛠️';
  }
}

function isDiagnosticCommandDefinition(
  value: DiagnosticCommandDefinition | undefined,
): value is DiagnosticCommandDefinition {
  return Boolean(value);
}

function runtimeWarnings(
  data: ConfigDocuments,
  snapshot: DashboardSnapshot | null,
  skills: SkillItem[],
  extensions: ExtensionsSnapshot | null,
  cronSnapshot: CronJobsSnapshot | null,
) {
  const warnings: string[] = [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const runtimeLocalSkills = localRuntimeSkillCount(extensions);

  if (!data.summary.modelDefault || !data.summary.modelProvider) {
    warnings.push('默认模型或提供商缺失，Hermes 可能无法稳定启动主对话链路。');
  }
  if (!data.summary.contextEngine) {
    warnings.push('当前没有显式声明 context.engine，Hermes 的上下文编排策略会更难一眼判断。');
  }
  if (!data.summary.terminalBackend) {
    warnings.push('终端后端为空，很多文件与命令类工具会缺失清晰的执行语义。');
  }
  if (!data.summary.toolsets.length) {
    warnings.push('当前没有配置 toolsets，说明模型可见能力面可能过窄。');
  }
  if (!skills.length) {
    warnings.push('当前 profile 下没有扫描到任何 skills，闭环能力会明显下降。');
  }
  if (data.summary.memoryEnabled === false) {
    warnings.push('记忆功能关闭后，长期 persona 和学习闭环会减弱。');
  }
  if (data.summary.memoryEnabled && data.summary.userProfileEnabled === false) {
    warnings.push('USER 画像记忆当前关闭，Hermes 对个体偏好的长期跟踪会弱一些。');
  }
  if (snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push('gateway 当前未运行，配置变更对消息平台链路的影响还没有被验证。');
  }
  if (data.summary.memoryProvider && extensions?.memoryRuntime.provider.includes('none')) {
    warnings.push(`配置声明了 memory provider「${data.summary.memoryProvider}」，但运行态仍显示 built-in only。`);
  }
  if (data.summary.toolsets.length > 0 && extensions && enabledToolCount(extensions) === 0) {
    warnings.push('配置里声明了 toolsets，但运行态没有解析到任何启用中的 tools，建议立即体检。');
  }
  if (remoteJobs.length > 0 && snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端投递作业依赖 gateway，但 gateway 不在 running 状态。`);
  }
  if (runtimeLocalSkills !== skills.length) {
    warnings.push(`CLI 运行态 local skills 为 ${runtimeLocalSkills} 个，本地目录扫描到 ${skills.length} 个，存在安装态 / 文件态差异。`);
  }

  return Array.from(new Set(warnings));
}

export function ConfigPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [activeTab, setActiveTab] = useState<ConfigTabKey>('overview');
  const [overviewView, setOverviewView] = useState<ConfigOverviewViewKey>('launch');
  const [fileFocus, setFileFocus] = useState<ConfigFileFocusKey>('config');
  const [filesView, setFilesView] = useState<ConfigFilesViewKey>('editor');
  const [advancedView, setAdvancedView] = useState<ConfigAdvancedViewKey>('actions');
  const [data, setData] = useState<ConfigDocuments | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [cronSnapshot, setCronSnapshot] = useState<CronJobsSnapshot | null>(null);
  const [investigation, setInvestigation] = useState<ConfigPageIntent | null>(null);
  const [configYaml, setConfigYaml] = useState('');
  const [envFile, setEnvFile] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'config' | 'env' | null>(null);
  const [runningDesktopAction, setRunningDesktopAction] = useState<string | null>(null);
  const [runningDiagnostic, setRunningDiagnostic] = useState<DiagnosticKind | null>(null);
  const [lastDiagnostic, setLastDiagnostic] = useState<DiagnosticKind | null>(null);
  const [lastResultLabel, setLastResultLabel] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CommandRunResult | null>(null);

  async function load(options?: { refreshEditors?: boolean }) {
    const refreshEditors = options?.refreshEditors ?? true;
    const shouldKeepConfigDraft = !refreshEditors && data ? configYaml !== data.configYaml : false;
    const shouldKeepEnvDraft = !refreshEditors && data ? envFile !== data.envFile : false;

    setLoading(true);
    try {
      const [nextConfig, nextSnapshot, nextInstallation, nextSkills, nextExtensions, nextCron] = await Promise.all([
        api.getConfigDocuments(profile),
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.listSkills(profile),
        api.getExtensionsSnapshot(profile),
        api.getCronJobs(profile),
      ]);
      setData(nextConfig);
      setSnapshot(nextSnapshot);
      setInstallation(nextInstallation);
      setSkills(nextSkills);
      setExtensions(nextExtensions);
      setCronSnapshot(nextCron);
      if (!shouldKeepConfigDraft) {
        setConfigYaml(nextConfig.configYaml);
      }
      if (!shouldKeepEnvDraft) {
        setEnvFile(nextConfig.envFile);
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function runDiagnostic(kind: DiagnosticKind) {
    setRunningDiagnostic(kind);
    try {
      const result = await api.runDiagnostic(kind, profile);
      setLastDiagnostic(kind);
      setLastResultLabel(getDiagnosticCommand(kind)?.label ?? kind);
      setLastResult(result);
      await load({ refreshEditors: false });
      notify(result.success ? 'success' : 'error', `${getDiagnosticCommand(kind)?.label ?? kind} 已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningDiagnostic(null);
    }
  }

  async function saveConfig(verify = false) {
    setSaving('config');
    try {
      await api.saveConfigYaml(configYaml, profile);
      await load({ refreshEditors: true });
      notify('success', verify ? 'config.yaml 已保存，开始执行配置体检。' : 'config.yaml 已保存。');
      if (verify) {
        await runDiagnostic('config-check');
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(null);
    }
  }

  async function saveEnv(verify = false) {
    setSaving('env');
    try {
      await api.saveEnvFile(envFile, profile);
      await load({ refreshEditors: true });
      notify('success', verify ? '.env 已保存，开始执行配置体检。' : '.env 已保存。');
      if (verify) {
        await runDiagnostic('config-check');
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      label,
      notify,
      path,
      revealInFinder,
    });
  }

  async function openInTerminal(
    actionKey: string,
    label: string,
    command: string,
    options?: { confirmMessage?: string; workingDirectory?: string | null },
  ) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage: options?.confirmMessage,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastDiagnostic(null);
        setLastResultLabel(resultLabel);
        setLastResult(result);
      },
      profile,
      setBusy: setRunningDesktopAction,
      workingDirectory: options?.workingDirectory ?? null,
    });
  }

  useEffect(() => {
    setActiveTab('overview');
    setOverviewView('launch');
    setLastDiagnostic(null);
    setLastResultLabel(null);
    setLastResult(null);
    setFileFocus('config');
    setFilesView('editor');
    setAdvancedView('actions');
    void load({ refreshEditors: true });
  }, [profile]);

  useEffect(() => {
    if (!isConfigPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    setActiveTab('overview');
    setOverviewView('launch');
    setFilesView('editor');
    setAdvancedView('actions');
    notify('info', `${pageIntent.headline} 已带入配置工作台。`);
    consumePageIntent();
  }, [consumePageIntent, notify, pageIntent]);

  const warnings = useMemo(
    () => (data ? runtimeWarnings(data, snapshot, skills, extensions, cronSnapshot) : []),
    [cronSnapshot, data, extensions, skills, snapshot],
  );
  const configDirty = data ? configYaml !== data.configYaml : false;
  const envDirty = data ? envFile !== data.envFile : false;
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const posture = useMemo(
    () => buildRuntimePosture({
      dashboard: snapshot,
      configDocuments: data,
      extensions,
      cronSnapshot,
      skills,
    }),
    [cronSnapshot, data, extensions, skills, snapshot],
  );
  const workbenchCommands = useMemo(
    () => CONFIG_WORKBENCH_KEYS.map((key) => getDiagnosticCommand(key)).filter(isDiagnosticCommandDefinition),
    [],
  );
  const workingDirectory = installation?.hermesHomeExists ? installation.hermesHome : null;
  const actionBusy = saving !== null || runningDiagnostic !== null || runningDesktopAction !== null;

  if (loading || !data || !installation) {
    return <LoadingState label="正在读取 Hermes 配置文件。" />;
  }

  const modelReady = Boolean(data.summary.modelDefault && data.summary.modelProvider);
  const backendReady = Boolean(data.summary.terminalBackend);
  const toolingReady = data.summary.toolsets.length > 0 && enabledToolCount(extensions) > 0;
  const memoryRuntimeReady = data.summary.memoryEnabled !== false && !(extensions?.memoryRuntime.provider.includes('none') ?? true);
  const configStartReadiness = modelReady && backendReady
    ? (configDirty || envDirty ? '待保存草稿' : '可以继续')
    : '先补核心配置';
  const configStartHint = !modelReady
    ? '先补齐 provider 和默认模型。'
    : !backendReady
      ? '先确认 terminal backend，避免后续工具链执行不稳定。'
      : configDirty || envDirty
        ? '当前已有草稿修改，建议先保存再做体检。'
        : '基础配置已经成形，可以继续做体检或核对上下游工作台。';
  const focusedFileLabel = fileFocus === 'config' ? 'config.yaml' : '.env';
  const focusedFilePath = fileFocus === 'config' ? data.configPath : data.envPath;
  const focusedFileDirty = fileFocus === 'config' ? configDirty : envDirty;
  const secondaryFileLabel = fileFocus === 'config' ? '.env' : 'config.yaml';
  const secondaryFilePath = fileFocus === 'config' ? data.envPath : data.configPath;
  const secondaryFileDirty = fileFocus === 'config' ? envDirty : configDirty;
  const overviewWarnings = warnings.slice(0, 3);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);
  const activeFilesView = CONFIG_FILES_VIEWS.find((item) => item.key === filesView) ?? CONFIG_FILES_VIEWS[0];
  const activeAdvancedView = CONFIG_ADVANCED_VIEWS.find((item) => item.key === advancedView) ?? CONFIG_ADVANCED_VIEWS[0];
  const activeOverviewView = CONFIG_OVERVIEW_VIEWS.find((item) => item.key === overviewView) ?? CONFIG_OVERVIEW_VIEWS[0];

  const recentResultSection = (
    <Panel title="最近校验输出" subtitle="保留 Hermes 原生命令回显，避免把配置页做成另一个解释器。">
      {lastResult ? (
        <div className="result-stack">
          <div className="detail-list compact">
            <KeyValueRow label="命令类型" value={lastResultLabel ?? getDiagnosticCommand(lastDiagnostic ?? '')?.label ?? '—'} />
            <KeyValueRow label="命令" value={lastResult.command} />
            <KeyValueRow label="退出码" value={lastResult.exitCode} />
            <KeyValueRow label="结果" value={<Pill tone={lastResult.success ? 'good' : 'bad'}>{lastResult.success ? '成功' : '失败'}</Pill>} />
          </div>
          <pre className="code-block">{lastResult.stdout || 'stdout 为空'}</pre>
          {lastResult.stderr ? <pre className="code-block">{lastResult.stderr}</pre> : null}
          {lastDiagnostic ? (
            <Toolbar>
              <Button onClick={() => navigate(getDiagnosticCommand(lastDiagnostic)?.relatedPage ?? 'diagnostics')}>进入相关页</Button>
            </Toolbar>
          ) : (
            <Toolbar>
              <Button onClick={() => navigate('diagnostics')}>打开诊断页</Button>
            </Toolbar>
          )}
        </div>
      ) : (
        <EmptyState title="尚未执行校验" description="保存后执行 `config-check`，或者直接从上面的工作台触发任一校验动作。" />
      )}
      <div className="detail-list compact top-gap">
        <KeyValueRow label="默认模型" value={data.summary.modelDefault || '—'} />
        <KeyValueRow label="提供商" value={data.summary.modelProvider || '—'} />
        <KeyValueRow label="Context Engine" value={data.summary.contextEngine || '—'} />
        <KeyValueRow label="Toolsets" value={data.summary.toolsets.length ? data.summary.toolsets.join(', ') : '—'} />
      </div>
    </Panel>
  );

  const closureSignalsSection = (
    <div className="two-column wide-left">
      <Panel
        title="配置闭环信号"
        subtitle="看配置与运行态是否一致。"
        aside={(
          <Toolbar>
            <Button onClick={() => void openInFinder(data.hermesHome, 'Hermes Home')}>打开 Home</Button>
            <Button onClick={() => void openInFinder(data.configPath, 'config.yaml', true)}>定位 config.yaml</Button>
            <Button onClick={() => void openInFinder(data.envPath, '.env', true)}>定位 .env</Button>
          </Toolbar>
        )}
      >
        <div className="health-grid">
          <section className="health-card">
            <div className="health-card-header">
              <strong>Memory Runtime</strong>
              <Pill tone={extensions?.memoryRuntime.provider.includes('none') ? 'warn' : 'good'}>
                {extensions?.memoryRuntime.provider || '未读取'}
              </Pill>
            </div>
            <p>配置声明 {data.summary.memoryProvider || 'builtin-file'} · 运行态 {extensions?.memoryRuntime.provider || '未读取'}。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Gateway Delivery</strong>
              <Pill tone={remoteJobs.length === 0 || snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                {snapshot?.gateway?.gatewayState ?? '未检测到'}
              </Pill>
            </div>
            <p>{remoteJobs.length > 0 ? `当前有 ${remoteJobs.length} 个远端作业依赖 gateway。` : '当前没有依赖 gateway 的远端投递作业。'}</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Skills Closure</strong>
              <Pill tone={skills.length === localRuntimeSkillCount(extensions) ? 'good' : 'warn'}>
                {localRuntimeSkillCount(extensions)}/{skills.length}
              </Pill>
            </div>
            <p>CLI 运行态 local skills / 本地目录扫描 skills，用来发现安装态与文件态的偏差。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Plugin Overlay</strong>
              <Pill tone={pluginsCount(extensions) > 0 ? 'good' : 'neutral'}>
                {pluginsCount(extensions)}
              </Pill>
            </div>
            <p>插件数 {pluginsCount(extensions)} · 已启用工具 {enabledToolCount(extensions)} / {totalToolCount(extensions)}。</p>
          </section>
        </div>
      </Panel>
    </div>
  );

  const advancedActionsSection = (
    <Panel
      title="高级接管动作"
      subtitle="把低频、交互式、仍需官方向导参与的能力收进这里，避免打断日常配置流程。"
    >
      <div className="control-card-grid">
        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Onboarding</p>
              <h3 className="action-card-title">Setup / Model / Migration</h3>
            </div>
            <Pill tone={installation.binaryFound ? 'good' : 'bad'}>
              {installation.binaryFound ? 'CLI 就绪' : 'CLI 缺失'}
            </Pill>
          </div>
          <p className="action-card-copy">
            首次接管或大幅调整 provider 时，优先走 Hermes 官方向导，而不是在 YAML 里硬改。
          </p>
          <p className="command-line">
            {installation.setupCommand} · {installation.modelCommand} · {installation.configMigrateCommand} · {installation.clawMigrateCommand}
          </p>
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => void openInTerminal('config:setup', '全量 Setup', installation.setupCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:setup' ? '全量 Setup…' : '全量 Setup'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:model', '模型 / Provider', installation.modelCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:model' ? '模型 / Provider…' : '模型 / Provider'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:migrate', '迁移配置', installation.configMigrateCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:migrate' ? '迁移配置…' : '迁移配置'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:claw-migrate', '导入 OpenClaw', installation.clawMigrateCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:claw-migrate' ? '导入 OpenClaw…' : '导入 OpenClaw'}
            </Button>
          </Toolbar>
        </section>

        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Capability</p>
              <h3 className="action-card-title">Terminal / Tools / Skills</h3>
            </div>
            <Pill tone={data.summary.toolsets.length > 0 ? 'good' : 'warn'}>
              {data.summary.toolsets.length > 0 ? `${data.summary.toolsets.length} 个 toolset` : '待配置'}
            </Pill>
          </div>
          <p className="action-card-copy">
            Hermes 的能力面不是只写在配置里，更要通过 terminal backend、tools 和 skills 交互式确认。
          </p>
          <p className="command-line">
            {installation.terminalSetupCommand} · {installation.toolsSetupCommand} · {installation.skillsConfigCommand}
          </p>
          <Toolbar>
            <Button
              onClick={() => void openInTerminal('config:terminal-backend', '终端后端', installation.terminalSetupCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:terminal-backend' ? '终端后端…' : '终端后端'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:tools-setup', '工具选择', installation.toolsSetupCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:tools-setup' ? '工具选择…' : '工具选择'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:skills-config', '技能开关', installation.skillsConfigCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:skills-config' ? '技能开关…' : '技能开关'}
            </Button>
          </Toolbar>
        </section>

        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Provider</p>
              <h3 className="action-card-title">Memory / Plugins / Gateway</h3>
            </div>
            <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
              {snapshot?.gateway?.gatewayState ?? 'gateway 待接管'}
            </Pill>
          </div>
          <p className="action-card-copy">
            记忆 provider、context engine 和消息平台接入都需要官方向导配合，面板只做桌面封装。
          </p>
          <p className="command-line">
            hermes memory setup · hermes plugins · {installation.gatewaySetupCommand}
          </p>
          <Toolbar>
            <Button
              onClick={() => void openInTerminal('config:memory-setup', '记忆 Provider', 'hermes memory setup', { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:memory-setup' ? '记忆 Provider…' : '记忆 Provider'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:plugins', '插件 / Context Engine', 'hermes plugins', { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:plugins' ? '插件 / Context Engine…' : '插件 / Context Engine'}
            </Button>
            <Button
              onClick={() => void openInTerminal('config:gateway-setup', 'Gateway Setup', installation.gatewaySetupCommand, { workingDirectory })}
              disabled={actionBusy || !installation.binaryFound}
            >
              {runningDesktopAction === 'config:gateway-setup' ? 'Gateway Setup…' : 'Gateway Setup'}
            </Button>
          </Toolbar>
        </section>

        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h3 className="action-card-title">文件与闭环验证</h3>
            </div>
            <Pill tone={warnings.length === 0 ? 'good' : 'warn'}>
              {warnings.length === 0 ? '姿态稳定' : `${warnings.length} 条提醒`}
            </Pill>
          </div>
          <p className="action-card-copy">
            编辑器仍然保留，但推荐先做接管动作，再回来保存和体检，避免只改文件不验证运行态。
          </p>
          <p className="command-line">
            hermes config check · hermes memory status · hermes gateway status · hermes doctor
          </p>
          <Toolbar>
            <Button onClick={() => void openInFinder(data.hermesHome, 'Hermes Home')} disabled={actionBusy}>打开 Home</Button>
            <Button onClick={() => void openInFinder(data.configPath, 'config.yaml', true)} disabled={actionBusy}>定位 config.yaml</Button>
            <Button onClick={() => void openInFinder(data.envPath, '.env', true)} disabled={actionBusy}>定位 .env</Button>
            <Button onClick={() => void runDiagnostic('config-check')} disabled={actionBusy}>
              {runningDiagnostic === 'config-check' ? '配置体检…' : '配置体检'}
            </Button>
          </Toolbar>
        </section>
      </div>
      <p className="helper-text">
        macOS 下这些交互式命令会交给系统 Terminal 持续运行，执行完成后回到面板点刷新即可看到最新姿态。
      </p>
    </Panel>
  );

  return (
    <div className="page-stack">
      <Panel
        title="配置中心"
        subtitle="先处理核心配置，再按需进入文件编辑和高级接管。"
        tip={(
          <InfoTip content="这里优先承接模型、终端、工具、记忆这些高频配置。低频 CLI 接管动作统一后置到“高级接管”，避免新手被复杂操作打断。"/>
        )}
        aside={(
          <Toolbar>
            <Button onClick={() => void load({ refreshEditors: true })}>重新读取</Button>
            <Button onClick={() => void runDiagnostic('config-check')} disabled={runningDiagnostic !== null}>
              {runningDiagnostic === 'config-check' ? '体检中…' : '配置体检'}
            </Button>
          </Toolbar>
        )}
      >
        <div className="workspace-summary-strip">
          <section className="summary-mini-card">
            <span className="summary-mini-label">当前起点</span>
            <strong className="summary-mini-value">{configStartReadiness}</strong>
            <span className="summary-mini-meta">{configStartHint}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">模型 / Provider</span>
            <strong className="summary-mini-value">{data.summary.modelDefault || '未配置模型'}</strong>
            <span className="summary-mini-meta">{data.summary.modelProvider || 'provider 未配置'}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">终端与工具</span>
            <strong className="summary-mini-value">{data.summary.terminalBackend || '未配置 backend'}</strong>
            <span className="summary-mini-meta">{`${data.summary.toolsets.length} 个 toolset / ${enabledToolCount(extensions)} 个运行态 tools`}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">上下游链路</span>
            <strong className="summary-mini-value">{snapshot?.gateway?.gatewayState ?? 'gateway 未检测到'}</strong>
            <span className="summary-mini-meta">{`${extensions?.memoryRuntime.provider || 'memory 未读取'} / ${remoteJobs.length} 个远端作业`}</span>
          </section>
        </div>
        <p className="helper-text top-gap">配置中心只承接高频核心参数。文件保存、体检和高级向导仍然都在当前页，但已经按层级后置，不会一上来全部铺开。</p>
      </Panel>

      {investigation ? (
        <ContextBanner
          label="Session Drilldown"
          title={investigation.headline}
          description={investigation.description}
          meta={(
            <div className="pill-row">
              {investigation.focus ? <Pill tone="warn">{investigation.focus}</Pill> : null}
              {investigation.suggestedCommand ? <Pill>{investigation.suggestedCommand}</Pill> : null}
              <Pill>{investigation.context?.source ?? 'sessions'}</Pill>
            </div>
          )}
          actions={(
            <Toolbar>
              {investigation.suggestedCommand ? (
                <Button kind="primary" onClick={() => void runDiagnostic(investigation.suggestedCommand!)} disabled={runningDiagnostic !== null}>
                  执行建议体检
                </Button>
              ) : null}
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>回到会话页</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="tab-bar">
        {CONFIG_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'files' && (configDirty || envDirty) ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <>
          <Panel
            title="总览入口"
            subtitle="总览页继续拆成二级工作面，默认只展开一个主区块，避免配置首页一次铺太多块。"
          >
            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              {CONFIG_OVERVIEW_VIEWS.map((item) => (
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
            <Panel
              title="常用去向"
              subtitle="首页只保留真正高频的 4 条去向，原始文件和接管向导继续后置到下一层。"
            >
              <div className="workspace-shortcut-grid dashboard-launcher-grid">
                <button
                  type="button"
                  className="workspace-shortcut-card dashboard-shortcut-card"
                  onClick={() => {
                    setFileFocus('config');
                    setFilesView('editor');
                    setActiveTab('files');
                  }}
                >
                  <strong><span className="dashboard-shortcut-icon">⚙️</span>核心参数</strong>
                  <span>{modelReady && backendReady ? `${data.summary.modelProvider} / ${data.summary.modelDefault}` : '先补 provider、模型与 terminal backend'}</span>
                </button>
                <button
                  type="button"
                  className="workspace-shortcut-card dashboard-shortcut-card"
                  onClick={() => void runDiagnostic('config-check')}
                  disabled={runningDiagnostic !== null}
                >
                  <strong><span className="dashboard-shortcut-icon">🩺</span>配置体检</strong>
                  <span>{configDirty || envDirty ? '有草稿时建议先保存再体检' : lastResultLabel || '立即检查文件态与运行态是否一致'}</span>
                </button>
                <button
                  type="button"
                  className="workspace-shortcut-card dashboard-shortcut-card"
                  onClick={() => navigate('extensions')}
                >
                  <strong><span className="dashboard-shortcut-icon">🧩</span>能力链路</strong>
                  <span>{toolingReady ? `${data.summary.toolsets.length} 个 toolset / ${enabledToolCount(extensions)} 个运行态 tools` : '继续核对 tools、skills 与插件叠层'}</span>
                </button>
                <button
                  type="button"
                  className="workspace-shortcut-card dashboard-shortcut-card"
                  onClick={() => {
                    setAdvancedView('actions');
                    setActiveTab('advanced');
                  }}
                >
                  <strong><span className="dashboard-shortcut-icon">🛠️</span>进阶接管</strong>
                  <span>{memoryRuntimeReady && snapshot?.gateway?.gatewayState === 'running' ? '向导和接管动作已后置到进阶层' : '记忆、插件和 Gateway 仍建议继续核对'}</span>
                </button>
              </div>
              <p className="helper-text top-gap">总览页现在只负责决定下一步去哪里，不再同时铺开多张解释型卡片。</p>
            </Panel>
          ) : null}

          {overviewView === 'status' ? (
            <Panel title="当前判断" subtitle="首页只保留最关键的四个配置结论，让你先知道现在该修哪一段。">
              <div className="workspace-summary-strip">
                <section className="summary-mini-card">
                  <span className="summary-mini-label">模型</span>
                  <strong className="summary-mini-value">{modelReady ? '已就绪' : '待补齐'}</strong>
                  <span className="summary-mini-meta">{`${data.summary.modelProvider || 'provider 未配置'} / ${data.summary.modelDefault || 'model 未配置'}`}</span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">终端后端</span>
                  <strong className="summary-mini-value">{data.summary.terminalBackend || '未配置'}</strong>
                  <span className="summary-mini-meta">{data.summary.terminalCwd || '当前未声明工作目录。'}</span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">工具与 Skill</span>
                  <strong className="summary-mini-value">{toolingReady ? '已成形' : '待补齐'}</strong>
                  <span className="summary-mini-meta">{`${data.summary.toolsets.length} 个 toolset / ${enabledToolCount(extensions)}/${totalToolCount(extensions)} 个运行态 tools`}</span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">记忆与网关</span>
                  <strong className="summary-mini-value">{data.summary.contextEngine || 'context 未配置'}</strong>
                  <span className="summary-mini-meta">{`Memory ${data.summary.memoryProvider || 'builtin-file'} / Gateway ${snapshot?.gateway?.gatewayState ?? '未检测到'}`}</span>
                </section>
              </div>
              <div className="detail-list compact top-gap">
                <KeyValueRow label="当前起点" value={configStartReadiness} />
                <KeyValueRow label="文件状态" value={configDirty || envDirty ? '有未保存草稿' : '文件已同步'} />
                <KeyValueRow label="最近结果" value={lastResultLabel ?? '尚未执行最近一次体检'} />
              </div>
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
                    <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在“文件与保存”和“高级接管”里。</p>
                  ) : null}
                </>
              ) : (
                <EmptyState title="配置较完整" description="当前没有明显的运行态配置风险，可以继续去技能页或诊断页验证闭环。" />
              )}
              <Toolbar>
                <Button kind="primary" onClick={() => { setFilesView('signals'); setActiveTab('files'); }}>查看闭环信号</Button>
                <Button onClick={() => setOverviewView('checks')}>继续做体检</Button>
              </Toolbar>
            </Panel>
          ) : null}

          {overviewView === 'checks' ? (
            <Panel title="快速体检" subtitle="只保留 4 个最常用入口，完整接管与原始回显继续留在文件层和进阶层。">
              <div className="workspace-shortcut-grid dashboard-launcher-grid">
                {workbenchCommands.map((command) => (
                  <button
                    key={command.key}
                    type="button"
                    className="workspace-shortcut-card dashboard-shortcut-card"
                    onClick={() => void runDiagnostic(command.key)}
                    disabled={runningDiagnostic !== null}
                  >
                    <strong><span className="dashboard-shortcut-icon">{configWorkbenchIcon(command.key)}</span>{command.label}</strong>
                    <span>{runningDiagnostic === command.key ? `${command.label} 执行中…` : command.description}</span>
                  </button>
                ))}
              </div>
              <div className="detail-list compact top-gap">
                <KeyValueRow label="推荐顺序" value="先 config-check，再 memory-status / gateway-status，最后 doctor" />
                <KeyValueRow label="最近动作" value={lastResultLabel ?? '尚未执行最近一次体检'} />
              </div>
              <Toolbar>
                <Button kind="primary" onClick={() => { setFilesView('editor'); setActiveTab('files'); }}>去文件与保存</Button>
                <Button onClick={() => { setAdvancedView('actions'); setActiveTab('advanced'); }}>去进阶接管</Button>
              </Toolbar>
            </Panel>
          ) : null}
        </>
      ) : null}

      {activeTab === 'files' ? (
        <>
          <Panel
            title="文件与保存入口"
            subtitle="文件编辑、闭环信号和最近输出拆成子视图，默认只展开当前工作面。"
            aside={(
              <Toolbar>
                <Pill tone={configDirty || envDirty ? 'warn' : 'good'}>
                  {configDirty || envDirty ? '有未保存修改' : '文件已同步'}
                </Pill>
              </Toolbar>
            )}
          >
            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              {CONFIG_FILES_VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`workspace-shortcut-card dashboard-shortcut-card ${filesView === item.key ? 'active' : ''}`}
                  onClick={() => setFilesView(item.key)}
                >
                  <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
            <p className="helper-text top-gap">{activeFilesView.hint}</p>
          </Panel>

          {filesView === 'editor' ? (
            <>
              <Panel
                title="原始文件工作区"
                subtitle="需要直接改文件时，再进入这一层；一次只专注编辑一份文件，保存后再做体检。"
              >
                <div className="workspace-summary-strip">
                  <section className="summary-mini-card">
                    <span className="summary-mini-label">建议顺序</span>
                    <strong className="summary-mini-value">先选文件，再保存，再体检</strong>
                    <span className="summary-mini-meta">修改文件 → 保存 → 配置体检 → 看闭环信号</span>
                  </section>
                  <section className="summary-mini-card">
                    <span className="summary-mini-label">当前焦点</span>
                    <strong className="summary-mini-value">{focusedFileLabel}</strong>
                    <span className="summary-mini-meta">{focusedFilePath}</span>
                  </section>
                  <section className="summary-mini-card">
                    <span className="summary-mini-label">另一份文件</span>
                    <strong className="summary-mini-value">{secondaryFileLabel}</strong>
                    <span className="summary-mini-meta">{secondaryFileDirty ? '存在未保存修改' : '当前没有未保存修改'}</span>
                  </section>
                  <section className="summary-mini-card">
                    <span className="summary-mini-label">最近体检</span>
                    <strong className="summary-mini-value">{lastResultLabel ?? '尚未执行'}</strong>
                    <span className="summary-mini-meta">{configDirty || envDirty ? '建议先保存当前草稿' : '可以直接运行 config-check'}</span>
                  </section>
                </div>
                <p className="helper-text top-gap">小白通常只需要处理当前正在改的那一份文件；另一份文件的状态会保留在辅助区里，不再同时把两个大编辑器都铺开。</p>
                <Toolbar>
                  {fileFocus === 'config' ? (
                    <Button kind="primary" onClick={() => setFileFocus('config')}>正在编辑 config.yaml</Button>
                  ) : (
                    <Button onClick={() => setFileFocus('config')}>切到 config.yaml</Button>
                  )}
                  {fileFocus === 'env' ? (
                    <Button kind="primary" onClick={() => setFileFocus('env')}>正在编辑 .env</Button>
                  ) : (
                    <Button onClick={() => setFileFocus('env')}>切到 .env</Button>
                  )}
                  <Button onClick={() => void openInFinder(focusedFilePath, focusedFileLabel, true)}>定位当前文件</Button>
                  <Button onClick={() => void runDiagnostic('config-check')} disabled={runningDiagnostic !== null}>
                    {runningDiagnostic === 'config-check' ? '体检中…' : '保存后体检'}
                  </Button>
                </Toolbar>
              </Panel>

              <div className="two-column wide-left">
                <Panel
                  title={focusedFileLabel}
                  aside={(
                    <Toolbar>
                      {focusedFileDirty ? <Pill tone="warn">未保存</Pill> : <Pill tone="good">已同步</Pill>}
                      {fileFocus === 'config' ? (
                        <>
                          <Button kind="primary" onClick={() => void saveConfig()} disabled={saving !== null || runningDiagnostic !== null}>
                            {saving === 'config' ? '保存中…' : '保存 YAML'}
                          </Button>
                          <Button onClick={() => void saveConfig(true)} disabled={saving !== null || runningDiagnostic !== null}>
                            {saving === 'config' ? '保存中…' : '保存并体检'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button kind="primary" onClick={() => void saveEnv()} disabled={saving !== null || runningDiagnostic !== null}>
                            {saving === 'env' ? '保存中…' : '保存 ENV'}
                          </Button>
                          <Button onClick={() => void saveEnv(true)} disabled={saving !== null || runningDiagnostic !== null}>
                            {saving === 'env' ? '保存中…' : '保存并体检'}
                          </Button>
                        </>
                      )}
                    </Toolbar>
                  )}
                >
                  {fileFocus === 'config' ? (
                    <textarea
                      className="editor"
                      value={configYaml}
                      onChange={(event) => setConfigYaml(event.target.value)}
                      spellCheck={false}
                    />
                  ) : (
                    <textarea
                      className="editor"
                      value={envFile}
                      onChange={(event) => setEnvFile(event.target.value)}
                      spellCheck={false}
                    />
                  )}
                </Panel>

                <Panel
                  title="辅助区"
                  subtitle="把另一份文件和常用操作收在旁边，避免一次看到两个大编辑器。"
                >
                  <div className="detail-list compact">
                    <KeyValueRow label="当前编辑" value={focusedFileLabel} />
                    <KeyValueRow label="当前路径" value={focusedFilePath} />
                    <KeyValueRow label="另一份文件" value={secondaryFileLabel} />
                    <KeyValueRow label="另一份路径" value={secondaryFilePath} />
                    <KeyValueRow label="另一份状态" value={secondaryFileDirty ? '有未保存修改' : '当前已同步'} />
                  </div>
                  <Toolbar>
                    <Button onClick={() => setFileFocus(fileFocus === 'config' ? 'env' : 'config')}>
                      切到 {secondaryFileLabel}
                    </Button>
                    <Button onClick={() => void openInFinder(secondaryFilePath, secondaryFileLabel, true)}>
                      定位 {secondaryFileLabel}
                    </Button>
                    <Button onClick={() => setFilesView('signals')}>
                      看闭环信号
                    </Button>
                  </Toolbar>
                  <p className="helper-text">
                    `config.yaml` 更适合模型、Provider、toolsets 和上下文策略；`.env` 更适合密钥、Base URL 和环境变量覆盖。
                  </p>
                </Panel>
              </div>
            </>
          ) : null}

          {filesView === 'signals' ? closureSignalsSection : null}
          {filesView === 'output' ? recentResultSection : null}
        </>
      ) : null}

      {activeTab === 'advanced' ? (
        <>
          <Panel
            title="进阶接管入口"
            subtitle="接管动作、运行姿态和最近输出拆成子视图，默认只展开当前工作面。"
          >
            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              {CONFIG_ADVANCED_VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`workspace-shortcut-card dashboard-shortcut-card ${advancedView === item.key ? 'active' : ''}`}
                  onClick={() => setAdvancedView(item.key)}
                >
                  <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
            <p className="helper-text top-gap">{activeAdvancedView.hint}</p>
          </Panel>
          {advancedView === 'posture' ? (
            <Panel
              title="运行姿态与分流"
              subtitle="这里带上了扩展、cron 和技能上下文，更适合在熟悉配置后继续判断真实闭环。"
            >
              <RuntimePostureView posture={posture} navigate={navigate} />
              <Toolbar className="top-gap">
                <Button kind="primary" onClick={() => setAdvancedView('actions')}>去接管动作</Button>
                <Button onClick={() => setAdvancedView('output')}>查看最近输出</Button>
              </Toolbar>
            </Panel>
          ) : null}
          {advancedView === 'actions' ? advancedActionsSection : null}
          {advancedView === 'output' ? recentResultSection : null}
        </>
      ) : null}
    </div>
  );
}
