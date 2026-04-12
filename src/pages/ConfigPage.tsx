import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, InfoTip, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
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
    setLastDiagnostic(null);
    setLastResultLabel(null);
    setLastResult(null);
    void load({ refreshEditors: true });
  }, [profile]);

  useEffect(() => {
    if (!isConfigPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
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

  return (
    <div className="page-stack">
      <Panel
        title="配置中心"
        subtitle="配置编辑、体检、接管"
        tip={(
          <InfoTip content="配置页聚焦文件编辑、运行体检和官方向导接管。跨页导航不再在页头重复展示，避免和侧边栏抢主操作区。"/>
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
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">Hermes Runtime Composition</p>
            <p className="hero-subtitle">文件层、能力层和运行体检在这里合流。</p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={profile} />
              <KeyValueRow label="Hermes Home" value={data.hermesHome} />
              <KeyValueRow label="Config Path" value={data.configPath} />
              <KeyValueRow label="Env Path" value={data.envPath} />
              <KeyValueRow label="Gateway" value={snapshot?.gateway?.gatewayState ?? '未检测到'} />
              <KeyValueRow label="Context Engine" value={data.summary.contextEngine || '—'} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="Model" value={data.summary.modelDefault || '—'} hint={data.summary.modelProvider || '未配置 provider'} />
            <MetricCard label="Backend" value={data.summary.terminalBackend || '—'} hint={data.summary.terminalCwd || '未声明工作目录'} />
            <MetricCard label="Toolsets / Tools" value={`${data.summary.toolsets.length} / ${enabledToolCount(extensions)}`} hint="声明的 toolsets 数 / 运行态启用 tools 数" />
            <MetricCard label="Cron / 远端" value={`${jobs.length} / ${remoteJobs.length}`} hint="总作业数 / 依赖 gateway 的作业数" />
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

      <Panel
        title="运行姿态"
        subtitle="这里比首页多带了扩展、cron 和技能上下文，更适合判断这个 profile 的真实能力编排是否闭环。"
      >
        <RuntimePostureView posture={posture} navigate={navigate} />
      </Panel>

      <Panel
        title="配置接管动作台"
        subtitle="参考 ClawPanel 的闭环思路，把 Hermes 配置相关的交互式命令直接收进配置页，不再只是编辑 `config.yaml`。"
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

      <div className="two-column wide-left">
        <Panel title="能力编排摘要" subtitle="这些摘要比原始 YAML 更容易帮助你判断当前 profile 能做什么。">
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Provider / Model</strong>
                <Pill tone={data.summary.modelDefault && data.summary.modelProvider ? 'good' : 'warn'}>
                  {data.summary.modelDefault && data.summary.modelProvider ? '已就绪' : '缺失'}
                </Pill>
              </div>
              <p>{data.summary.modelProvider || '未配置 provider'} / {data.summary.modelDefault || '未配置 model'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Terminal Backend</strong>
                <Pill tone={data.summary.terminalBackend ? 'good' : 'warn'}>
                  {data.summary.terminalBackend || '未配置'}
                </Pill>
              </div>
              <p>{data.summary.terminalCwd || '当前未声明工作目录，工具执行上下文可能不稳定。'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Toolsets / Tools</strong>
                <Pill tone={data.summary.toolsets.length && enabledToolCount(extensions) > 0 ? 'good' : 'warn'}>
                  {enabledToolCount(extensions)}/{totalToolCount(extensions)}
                </Pill>
              </div>
              <p>{data.summary.toolsets.join(', ') || '当前没有配置 toolsets。'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Context / Memory</strong>
                <Pill tone={data.summary.contextEngine ? 'good' : 'warn'}>
                  {data.summary.contextEngine || '未配置'}
                </Pill>
              </div>
              <p>
                Memory Provider {data.summary.memoryProvider || 'builtin-file'} · 用户画像 {String(data.summary.userProfileEnabled ?? false)} ·
                流式输出 {String(data.summary.streamingEnabled ?? false)}
              </p>
            </section>
          </div>
          {warnings.length > 0 ? (
            <div className="warning-stack">
              {warnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="配置较完整" description="当前没有明显的运行态配置风险，可以继续去技能页或诊断页验证闭环。" />
          )}
        </Panel>

        <Panel title="校验与修复工作台" subtitle="参考 ClawPanel 的治理工作台思路，把保存、体检、验证和跳转收成一条顺手路径。">
          <div className="workbench-grid">
            {workbenchCommands.map((command) => (
              <section className="action-card" key={command.key}>
                <div className="action-card-header">
                  <div>
                    <p className="eyebrow">{command.scope === 'capability' ? 'Capability' : 'Runtime'}</p>
                    <h3 className="action-card-title">{command.label}</h3>
                  </div>
                  <Pill tone={command.kind === 'primary' ? 'good' : 'neutral'}>{command.key}</Pill>
                </div>
                <p className="action-card-copy">{command.description}</p>
                <p className="helper-text">{command.cli}</p>
                <Toolbar>
                  <Button
                    kind={command.kind}
                    onClick={() => void runDiagnostic(command.key)}
                    disabled={runningDiagnostic !== null}
                  >
                    {runningDiagnostic === command.key ? `${command.label}…` : `执行 ${command.label}`}
                  </Button>
                  <Button onClick={() => navigate(command.relatedPage)}>进入相关页</Button>
                </Toolbar>
              </section>
            ))}
          </div>
          <p className="helper-text">
            推荐顺序：保存配置后先做 `config-check`，再看 `memory-status` 和 `gateway-status`，如果仍不清楚就执行 `doctor`。
          </p>
        </Panel>
      </div>

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

      <div className="two-column">
        <Panel
          title="config.yaml"
          aside={(
            <Toolbar>
              {configDirty && <Pill tone="warn">未保存</Pill>}
              <Button kind="primary" onClick={() => void saveConfig()} disabled={saving !== null || runningDiagnostic !== null}>
                {saving === 'config' ? '保存中…' : '保存 YAML'}
              </Button>
              <Button onClick={() => void saveConfig(true)} disabled={saving !== null || runningDiagnostic !== null}>
                {saving === 'config' ? '保存中…' : '保存并体检'}
              </Button>
            </Toolbar>
          )}
        >
          <textarea
            className="editor"
            value={configYaml}
            onChange={(event) => setConfigYaml(event.target.value)}
            spellCheck={false}
          />
        </Panel>

        <Panel
          title=".env"
          aside={(
            <Toolbar>
              {envDirty && <Pill tone="warn">未保存</Pill>}
              <Button kind="primary" onClick={() => void saveEnv()} disabled={saving !== null || runningDiagnostic !== null}>
                {saving === 'env' ? '保存中…' : '保存 ENV'}
              </Button>
              <Button onClick={() => void saveEnv(true)} disabled={saving !== null || runningDiagnostic !== null}>
                {saving === 'env' ? '保存中…' : '保存并体检'}
              </Button>
            </Toolbar>
          )}
        >
          <textarea
            className="editor"
            value={envFile}
            onChange={(event) => setEnvFile(event.target.value)}
            spellCheck={false}
          />
        </Panel>
      </div>
    </div>
  );
}
