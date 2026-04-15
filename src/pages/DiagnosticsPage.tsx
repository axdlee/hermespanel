import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, InfoTip, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import { RuntimePostureView } from '../components/runtime-posture';
import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import {
  CAPABILITY_DIAGNOSTIC_COMMANDS,
  RUNTIME_DIAGNOSTIC_COMMANDS,
  getDiagnosticCommand,
  type DiagnosticCommandDefinition,
  type DiagnosticKind,
} from '../lib/diagnostics';
import { formatTimestamp } from '../lib/format';
import { buildRuntimePosture } from '../lib/posture';
import { enabledToolCount, hasCronFailure, isRemoteDelivery, pluginsCount, totalToolCount } from '../lib/runtime';
import type {
  CommandRunResult,
  ConfigDocuments,
  CronJobsSnapshot,
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  LogReadResult,
  SkillItem,
} from '../types';
import { isDiagnosticsPageIntent, type DiagnosticsPageIntent, type PageProps } from './types';

const LOG_OPTIONS = [
  { key: 'gateway.error', label: 'gateway.error.log' },
  { key: 'gateway', label: 'gateway.log' },
  { key: 'errors', label: 'errors.log' },
  { key: 'agent', label: 'agent.log' },
] as const;

type DiagnosticsTabKey = 'quick' | 'repair' | 'artifacts';

const DIAGNOSTICS_TABS: Array<{ key: DiagnosticsTabKey; label: string; hint: string }> = [
  { key: 'quick', label: '快速处理', hint: '先看主链路风险，再执行安全体检。' },
  { key: 'repair', label: '深度修复', hint: '需要官方向导或复杂修复时再展开。' },
  { key: 'artifacts', label: '日志与材料', hint: '回看命令结果、日志和相关文件。' },
];

const QUICK_DIAGNOSTIC_COMMANDS = ['doctor', 'gateway-status', 'config-check', 'memory-status']
  .map((key) => getDiagnosticCommand(key))
  .filter((item): item is DiagnosticCommandDefinition => Boolean(item));

function directoryOf(path: string) {
  const normalized = path.trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function DiagnosticCommandGrid(props: {
  commands: DiagnosticCommandDefinition[];
  running: string | null;
  navigate: PageProps['navigate'];
  onRun: (kind: DiagnosticKind) => Promise<void>;
  showCli?: boolean;
  showRelatedPageButton?: boolean;
}) {
  return (
    <div className="workbench-grid">
      {props.commands.map((item) => (
        <section className="action-card action-card-compact" key={item.key}>
          <div className="action-card-header">
            <div>
              <p className="eyebrow">{item.scope === 'runtime' ? 'Runtime' : 'Capability'}</p>
              <h3 className="action-card-title">{item.label}</h3>
            </div>
            <Pill tone={item.kind === 'primary' ? 'good' : item.scope === 'capability' ? 'neutral' : 'warn'}>
              {item.key}
            </Pill>
          </div>
          <p className="action-card-copy">{item.description}</p>
          {props.showCli === false ? null : <p className="helper-text">{item.cli}</p>}
          <Toolbar>
            <Button
              kind={item.kind}
              onClick={() => void props.onRun(item.key)}
              disabled={props.running !== null}
            >
              {props.running === item.key ? `${item.label}…` : `执行 ${item.label}`}
            </Button>
            {props.showRelatedPageButton === false ? null : (
              <Button onClick={() => props.navigate(item.relatedPage)}>进入相关页</Button>
            )}
          </Toolbar>
        </section>
      ))}
    </div>
  );
}

export function DiagnosticsPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [activeTab, setActiveTab] = useState<DiagnosticsTabKey>('quick');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [config, setConfig] = useState<ConfigDocuments | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [cronSnapshot, setCronSnapshot] = useState<CronJobsSnapshot | null>(null);
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [result, setResult] = useState<CommandRunResult | null>(null);
  const [lastKind, setLastKind] = useState<DiagnosticKind | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState<DiagnosticsPageIntent | null>(null);
  const [logName, setLogName] = useState('gateway.error');
  const [logPreview, setLogPreview] = useState<LogReadResult | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [runningDesktopAction, setRunningDesktopAction] = useState<string | null>(null);

  async function loadContext() {
    setLoading(true);
    try {
      const [nextSnapshot, nextConfig, nextInstallation, nextCron, nextSkills, nextExtensions] = await Promise.all([
        api.getDashboardSnapshot(profile),
        api.getConfigDocuments(profile),
        api.getInstallationSnapshot(profile),
        api.getCronJobs(profile),
        api.listSkills(profile),
        api.getExtensionsSnapshot(profile),
      ]);
      setSnapshot(nextSnapshot);
      setConfig(nextConfig);
      setInstallation(nextInstallation);
      setCronSnapshot(nextCron);
      setSkills(nextSkills);
      setExtensions(nextExtensions);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function loadLogPreview(targetLog = logName, silent = false) {
    setLogLoading(true);
    try {
      const next = await api.readLog(targetLog, 60, undefined, undefined, profile);
      setLogPreview(next);
    } catch (reason) {
      if (!silent) {
        notify('error', String(reason));
      }
      setLogPreview(null);
    } finally {
      setLogLoading(false);
    }
  }

  async function run(kind: DiagnosticKind) {
    setRunning(kind);
    try {
      const next = await api.runDiagnostic(kind, profile);
      const relatedLog = getDiagnosticCommand(kind)?.relatedLog ?? 'errors';
      setResult(next);
      setLastKind(kind);
      setLastActionLabel(getDiagnosticCommand(kind)?.label ?? kind);
      setLogName(relatedLog);
      await Promise.all([
        loadContext(),
        loadLogPreview(relatedLog, true),
      ]);
      notify(next.success ? 'success' : 'error', `${kind} 已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunning(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `finder:${label}`,
      label,
      notify,
      path,
      revealInFinder,
      setBusy: setRunningDesktopAction,
    });
  }

  async function openInTerminal(actionKey: string, label: string, command: string, confirmMessage?: string) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage,
      label,
      notify,
      onResult: (resultLabel, next) => {
        setLastKind(null);
        setLastActionLabel(resultLabel);
        setResult(next);
      },
      profile,
      setBusy: setRunningDesktopAction,
      workingDirectory: installation?.hermesHomeExists ? installation.hermesHome : null,
    });
  }

  useEffect(() => {
    setResult(null);
    setLastKind(null);
    setLastActionLabel(null);
    setLogName('gateway.error');
    setLogPreview(null);
    void Promise.all([
      loadContext(),
      loadLogPreview('gateway.error', true),
    ]);
  }, [profile]);

  useEffect(() => {
    if (!isDiagnosticsPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    const nextLogName = pageIntent.logName ?? 'gateway.error';
    setActiveTab(pageIntent.logName ? 'artifacts' : 'quick');
    setLogName(nextLogName);
    void loadLogPreview(nextLogName, true);
    notify('info', `${pageIntent.headline} 已带入诊断工作台。`);
    consumePageIntent();
  }, [consumePageIntent, notify, pageIntent, profile]);

  useEffect(() => {
    void loadLogPreview(logName, true);
  }, [logName, profile]);

  const jobs = cronSnapshot?.jobs ?? [];
  const skillNameSet = useMemo(() => new Set(skills.map((item) => item.name)), [skills]);
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const failingJobs = jobs.filter(hasCronFailure);
  const memoryRuntimeReady = extensions ? !extensions.memoryRuntime.provider.includes('none') : false;
  const missingReferencedSkills = useMemo(
    () => Array.from(new Set(
      jobs
        .flatMap((job) => job.skills)
        .filter((name) => !skillNameSet.has(name)),
    )),
    [jobs, skillNameSet],
  );
  const posture = useMemo(
    () => buildRuntimePosture({
      dashboard: snapshot,
      configDocuments: config,
      extensions,
      cronSnapshot,
      skills,
    }),
    [config, cronSnapshot, extensions, skills, snapshot],
  );
  const combinedWarnings = useMemo(() => {
    const warnings = [...(snapshot?.warnings ?? [])];
    posture.priorities.forEach((item) => warnings.push(`${item.title}：${item.detail}`));
    if (installation && !installation.binaryFound) {
      warnings.push('当前还没有检测到 Hermes CLI，很多问题在修复前都需要先完成安装或重新安装。');
    }
    if (missingReferencedSkills.length > 0) {
      warnings.push(`存在 ${missingReferencedSkills.length} 个被 jobs.json 引用但当前未扫描到的 skill：${missingReferencedSkills.join('、')}。`);
    }
    if (!skills.length && jobs.some((job) => job.skills.length > 0)) {
      warnings.push('cron 作业声明了 skills，但当前 profile 没扫到任何本地技能，能力面很可能不完整。');
    }
    if (failingJobs.length > 0) {
      warnings.push(`当前已有 ${failingJobs.length} 个 cron 作业出现错误或投递异常，建议结合日志一起看。`);
    }
    return Array.from(new Set(warnings));
  }, [failingJobs.length, installation, jobs, missingReferencedSkills, posture, skills.length, snapshot]);
  const quickWarnings = combinedWarnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, combinedWarnings.length - quickWarnings.length);
  const selectedLogLabel = LOG_OPTIONS.find((item) => item.key === logName)?.label ?? logName;

  if (loading && !snapshot && !config && !installation) {
    return <LoadingState label="正在构建 Hermes 诊断工作台上下文。" />;
  }

  const lastCommand = lastKind ? getDiagnosticCommand(lastKind) : null;
  const logsDir = logPreview?.filePath
    ? directoryOf(logPreview.filePath)
    : snapshot
      ? `${snapshot.hermesHome}/logs`
      : '';
  const actionBusy = running !== null || runningDesktopAction !== null;

  const repairActionsSection = (
    <Panel
      title="修复动作台"
      subtitle="先诊断，再把你送到真正能修问题的 Hermes 官方入口，而不是只给一堆只读摘要。"
    >
      <div className="control-card-grid">
        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Bootstrap</p>
              <h3 className="action-card-title">安装 / 升级 / 重装</h3>
            </div>
            <Pill tone={installation?.binaryFound ? 'good' : 'bad'}>
              {installation?.binaryFound ? 'CLI 可用' : 'CLI 缺失'}
            </Pill>
          </div>
          <p className="action-card-copy">
            如果连 CLI 本体都不稳，后续所有 gateway、skills、plugins、memory 的问题都会是假问题。
          </p>
          <p className="command-line">
            {installation?.quickInstallCommand || '未读取安装命令'} · {installation?.updateCommand || '未读取升级命令'}
          </p>
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => installation && void openInTerminal('diagnostics:install', installation.binaryFound ? '重新安装 CLI' : '一键安装 CLI', installation.quickInstallCommand)}
              disabled={actionBusy || !installation}
            >
              {runningDesktopAction === 'diagnostics:install' ? (installation?.binaryFound ? '重新安装 CLI…' : '一键安装 CLI…') : (installation?.binaryFound ? '重新安装 CLI' : '一键安装 CLI')}
            </Button>
            <Button
              onClick={() => installation && void openInTerminal('diagnostics:update', '升级 CLI', installation.updateCommand)}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:update' ? '升级 CLI…' : '升级 CLI'}
            </Button>
            <Button onClick={() => navigate('dashboard')} disabled={actionBusy}>进入控制中心</Button>
          </Toolbar>
        </section>

        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Repair</p>
              <h3 className="action-card-title">Setup / Model / Gateway</h3>
            </div>
            <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
              {snapshot?.gateway?.gatewayState ?? 'gateway 待修复'}
            </Pill>
          </div>
          <p className="action-card-copy">
            当 provider、消息平台或上下文主链路出问题时，优先回到 Hermes 官方 setup 向导处理。
          </p>
          <p className="command-line">
            {installation?.setupCommand || '未读取 setup'} · {installation?.modelCommand || '未读取 model'} · {installation?.gatewaySetupCommand || '未读取 gateway setup'}
          </p>
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => installation && void openInTerminal('diagnostics:setup', '全量 Setup', installation.setupCommand)}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:setup' ? '全量 Setup…' : '全量 Setup'}
            </Button>
            <Button
              onClick={() => installation && void openInTerminal('diagnostics:model', '模型 / Provider', installation.modelCommand)}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:model' ? '模型 / Provider…' : '模型 / Provider'}
            </Button>
            <Button
              onClick={() => installation && void openInTerminal('diagnostics:gateway-setup', 'Gateway Setup', installation.gatewaySetupCommand)}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:gateway-setup' ? 'Gateway Setup…' : 'Gateway Setup'}
            </Button>
          </Toolbar>
        </section>

        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Capability</p>
              <h3 className="action-card-title">Tools / Skills / Memory / Plugins</h3>
            </div>
            <Pill tone={enabledToolCount(extensions) > 0 ? 'good' : 'warn'}>
              {enabledToolCount(extensions) > 0 ? `${enabledToolCount(extensions)} 个 tools` : '能力面待修'}
            </Pill>
          </div>
          <p className="action-card-copy">
            “明明装了却没生效”的问题大多在这里，尤其是 toolsets、技能安装态、memory provider 和插件层。
          </p>
          <p className="command-line">
            {installation?.toolsSetupCommand || '未读取 tools setup'} · {installation?.skillsConfigCommand || '未读取 skills config'} · hermes memory setup · hermes plugins
          </p>
          <Toolbar>
            <Button
              onClick={() => installation && void openInTerminal('diagnostics:tools-setup', '工具选择', installation.toolsSetupCommand)}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:tools-setup' ? '工具选择…' : '工具选择'}
            </Button>
            <Button
              onClick={() => installation && void openInTerminal('diagnostics:skills-config', '技能开关', installation.skillsConfigCommand)}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:skills-config' ? '技能开关…' : '技能开关'}
            </Button>
            <Button
              onClick={() => void openInTerminal('diagnostics:memory-setup', '记忆 Provider', 'hermes memory setup')}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:memory-setup' ? '记忆 Provider…' : '记忆 Provider'}
            </Button>
            <Button
              onClick={() => void openInTerminal('diagnostics:plugins', '插件与 Context Engine', 'hermes plugins')}
              disabled={actionBusy || !installation?.binaryFound}
            >
              {runningDesktopAction === 'diagnostics:plugins' ? '插件与 Context Engine…' : '插件与 Context Engine'}
            </Button>
          </Toolbar>
        </section>

        <section className="action-card action-card-compact">
          <div className="action-card-header">
            <div>
              <p className="eyebrow">Artifacts</p>
              <h3 className="action-card-title">日志 / 配置 / 状态文件</h3>
            </div>
            <Pill tone={combinedWarnings.length === 0 ? 'good' : 'warn'}>
              {combinedWarnings.length === 0 ? '上下文稳定' : `${combinedWarnings.length} 条风险`}
            </Pill>
          </div>
          <p className="action-card-copy">
            命令结果看不清时，直接回到实际文件和日志最有效，特别适合定位 platform、delivery 和 provider 侧问题。
          </p>
          <p className="command-line">
            {config?.configPath || '未读取 config'} · {config?.envPath || '未读取 env'} · {logsDir || '未读取 logs'}
          </p>
          <Toolbar>
            <Button onClick={() => snapshot && void openInFinder(snapshot.hermesHome, 'Hermes Home')} disabled={actionBusy || !snapshot}>打开 Home</Button>
            <Button onClick={() => config && void openInFinder(config.configPath, 'config.yaml', true)} disabled={actionBusy || !config}>定位 config.yaml</Button>
            <Button onClick={() => config && void openInFinder(config.envPath, '.env', true)} disabled={actionBusy || !config}>定位 .env</Button>
            <Button onClick={() => logsDir && void openInFinder(logsDir, 'logs 目录')} disabled={actionBusy || !logsDir}>打开 logs</Button>
          </Toolbar>
        </section>
      </div>
    </Panel>
  );

  const artifactSection = (
    <div className="two-column wide-left">
      <Panel
        title="CLI 输出"
        subtitle="保留 Hermes 原生命令的 stdout / stderr，不替你重新发明另一套解释器。"
        aside={undefined}
      >
        {result ? (
          <div className="result-stack">
            <div className="detail-list compact">
              <KeyValueRow label="命令类型" value={lastActionLabel ?? lastCommand?.label ?? '—'} />
              <KeyValueRow label="命令" value={result.command} />
              <KeyValueRow label="退出码" value={result.exitCode} />
              <KeyValueRow
                label="结果"
                value={(
                  <Pill tone={result.success ? 'good' : 'bad'}>
                    {result.success ? '成功' : '失败'}
                  </Pill>
                )}
              />
            </div>
            <pre className="code-block tall">{result.stdout || 'stdout 为空'}</pre>
            {result.stderr ? <pre className="code-block">{result.stderr}</pre> : null}
          </div>
        ) : (
          <EmptyState title="尚未执行命令" description="先从“常用体检”执行一项，或去“深度修复”里运行完整命令，这里就会保留 Hermes 原始输出。" />
        )}
      </Panel>

      <Panel
        title="相关日志预览"
        subtitle="命令执行后会自动切到更相关的日志类型，帮助你把 CLI 结果和运行期日志串起来看。"
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
            <Button onClick={() => navigate('logs')}>查看日志</Button>
          </Toolbar>
        )}
      >
        {logPreview ? (
          <>
            <div className="detail-list compact">
              <KeyValueRow label="文件" value={logPreview.filePath} />
              <KeyValueRow label="返回行数" value={logPreview.lines.length} />
              <KeyValueRow label="当前命令" value={lastCommand?.label ?? '未执行命令'} />
              <KeyValueRow label="Gateway 更新时间" value={formatTimestamp(snapshot?.gateway?.updatedAt)} />
            </div>
            <pre className="code-block tall">{logPreview.lines.join('\n') || '没有匹配到日志行。'}</pre>
          </>
        ) : (
          <EmptyState title="暂无日志预览" description="切换日志类型或刷新后，这里会展示相关日志尾部内容。" />
        )}
      </Panel>
    </div>
  );

  return (
    <div className="page-stack">
      <Panel
        title="诊断工作台"
        subtitle="诊断、核对、修复接力"
        tip={(
          <InfoTip content="诊断页只放安全、非交互的体检命令和修复接力入口。说明文本改成悬浮提示，避免排障页本身先被说明占满。"/>
        )}
        aside={(
          <Toolbar>
            <Button onClick={() => void loadContext()}>刷新上下文</Button>
          </Toolbar>
        )}
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">Hermes Diagnostic Workbench</p>
            <p className="hero-subtitle">先汇总主链路风险，再执行命令。</p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={snapshot?.profileName ?? profile} />
              <KeyValueRow label="Hermes Binary" value={snapshot?.hermesBinary ?? '—'} />
              <KeyValueRow label="Hermes Home" value={snapshot?.hermesHome ?? '—'} />
              <KeyValueRow
                label="Gateway"
                value={(
                  <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                    {snapshot?.gateway?.gatewayState ?? '未检测到'}
                  </Pill>
                )}
              />
              <KeyValueRow label="Context Engine" value={config?.summary.contextEngine || '—'} />
              <KeyValueRow label="记忆 Provider" value={config?.summary.memoryProvider || 'builtin-file'} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="高优先项" value={posture.priorities.length} hint="共享运行姿态汇总后的优先修正项" />
            <MetricCard label="远端作业" value={remoteJobs.length} hint="依赖 gateway / delivery 的 cron 作业" />
            <MetricCard label="缺 Skill 引用" value={missingReferencedSkills.length} hint="jobs.json 引用了但本地没扫到" />
            <MetricCard label="运行 Tools" value={`${enabledToolCount(extensions)} / ${totalToolCount(extensions)}`} hint="启用 tools / 全量 tools" />
            <MetricCard label="本地技能 / 插件" value={`${skills.length} / ${pluginsCount(extensions)}`} hint="目录扫描 skills / 插件层覆盖" />
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
              {investigation.suggestedCommand ? <Pill tone="warn">{investigation.suggestedCommand}</Pill> : null}
              <Pill>{investigation.logName ?? logName}</Pill>
              <Pill>{investigation.context?.source ?? 'sessions'}</Pill>
            </div>
          )}
          actions={(
            <Toolbar>
              {investigation.suggestedCommand ? (
                <Button kind="primary" onClick={() => void run(investigation.suggestedCommand!)} disabled={running !== null}>
                  执行建议命令
                </Button>
              ) : null}
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('logs')}>进入日志页</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="tab-bar">
        {DIAGNOSTICS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'repair' && combinedWarnings.length > 0 ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'artifacts' && result ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'quick' ? (
        <>
          <Panel
            title="推荐下一步"
            subtitle="先按推荐路径走，默认只保留最常用的判断和体检，复杂命令与原始输出都已经后置。"
          >
            <div className="list-stack">
              <div className="list-card">
                <div className="list-card-title">
                  <strong>先确认 Hermes 是否正常活着</strong>
                  <Pill tone={installation?.binaryFound && snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                    {installation?.binaryFound ? '主链路已接通' : '先补齐基础运行'}
                  </Pill>
                </div>
                <p>先确认 CLI、本地安装和 gateway 状态，再决定是不是要继续深挖配置或能力面。</p>
                <div className="meta-line">
                  <span>{installation?.binaryFound ? 'CLI 已检测到' : 'CLI 尚未检测到'}</span>
                  <span>{snapshot?.gateway?.gatewayState === 'running' ? 'Gateway 正在运行' : 'Gateway 待确认'}</span>
                </div>
                <Toolbar>
                  <Button kind="primary" onClick={() => void run('doctor')} disabled={actionBusy}>
                    {running === 'doctor' ? '健康检查…' : '运行健康检查'}
                  </Button>
                  <Button onClick={() => void run('gateway-status')} disabled={actionBusy}>
                    {running === 'gateway-status' ? '网关状态…' : '查看网关状态'}
                  </Button>
                </Toolbar>
              </div>

              <div className="list-card">
                <div className="list-card-title">
                  <strong>再核对配置和能力面</strong>
                  <Pill tone={config?.summary.contextEngine && missingReferencedSkills.length === 0 ? 'good' : 'warn'}>
                    {config?.summary.contextEngine || '配置待补齐'}
                  </Pill>
                </div>
                <p>模型、Context Engine、Skills、Memory 和 Tools 没对齐时，最容易出现“明明装了却没生效”。</p>
                <div className="meta-line">
                  <span>{missingReferencedSkills.length === 0 ? 'Skill 引用已对齐' : `缺 ${missingReferencedSkills.length} 个 Skill`}</span>
                  <span>{enabledToolCount(extensions)} / {totalToolCount(extensions)} 个 Tools 已启用</span>
                </div>
                <Toolbar>
                  <Button kind="primary" onClick={() => void run('config-check')} disabled={actionBusy}>
                    {running === 'config-check' ? '配置体检…' : '执行配置体检'}
                  </Button>
                  <Button onClick={() => navigate('config')}>进入配置页</Button>
                  <Button onClick={() => navigate('skills')}>进入技能页</Button>
                </Toolbar>
              </div>

              <div className="list-card">
                <div className="list-card-title">
                  <strong>最后看日志和原始材料</strong>
                  <Pill tone={result || logPreview ? 'good' : 'neutral'}>
                    {result || logPreview ? '材料已就位' : '等待新记录'}
                  </Pill>
                </div>
                <p>最近命令结果、相关日志和原始输出已经集中到材料层，不再默认铺满排障首页。</p>
                <div className="meta-line">
                  <span>{lastActionLabel ?? '尚无最近动作'}</span>
                  <span>{selectedLogLabel}</span>
                </div>
                <Toolbar>
                  <Button kind="primary" onClick={() => setActiveTab('artifacts')}>打开日志与材料</Button>
                  <Button onClick={() => navigate('logs')}>进入日志页</Button>
                </Toolbar>
              </div>
            </div>
          </Panel>

          <div className="two-column wide-left">
            <Panel
              title="当前判断"
              subtitle="先看最关键的 4 个摘要和当前风险，其余命令与接管动作都后置到深层页面。"
            >
              <div className="workspace-summary-strip">
                <div className="summary-mini-card">
                  <span className="summary-mini-label">运行基础</span>
                  <strong className="summary-mini-value">{installation?.binaryFound ? 'CLI 已就绪' : 'CLI 缺失'}</strong>
                  <span className="summary-mini-meta">{installation?.versionOutput.trim() || installation?.hermesHome || '尚未读取版本信息'}</span>
                </div>
                <div className="summary-mini-card">
                  <span className="summary-mini-label">网关与交付</span>
                  <strong className="summary-mini-value">{snapshot?.gateway?.gatewayState ?? '未检测到'}</strong>
                  <span className="summary-mini-meta">
                    {remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '当前以本地执行为主'}
                  </span>
                </div>
                <div className="summary-mini-card">
                  <span className="summary-mini-label">配置链路</span>
                  <strong className="summary-mini-value">{config?.summary.contextEngine || '未配置'}</strong>
                  <span className="summary-mini-meta">
                    {config?.summary.modelProvider || 'provider 未配置'} · {config?.summary.modelDefault || 'model 未配置'}
                  </span>
                </div>
                <div className="summary-mini-card">
                  <span className="summary-mini-label">能力闭环</span>
                  <strong className="summary-mini-value">
                    {config?.summary.memoryEnabled && memoryRuntimeReady ? '记忆链路可用' : '能力面待核对'}
                  </strong>
                  <span className="summary-mini-meta">
                    Skill 缺口 {missingReferencedSkills.length} · 插件 {pluginsCount(extensions)}
                  </span>
                </div>
              </div>

              {quickWarnings.length > 0 ? (
                <>
                  <div className="warning-stack">
                    {quickWarnings.map((warning) => (
                      <div className="warning-item" key={warning}>
                        {warning}
                      </div>
                    ))}
                  </div>
                  {remainingWarningCount > 0 ? (
                    <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒已收进“深度修复”。</p>
                  ) : null}
                </>
              ) : (
                <EmptyState title="当前风险不高" description="没有检测到明显的结构性问题，可以先执行常用体检或进入日志页看细节。" />
              )}

              <Toolbar>
                <Button kind="primary" onClick={() => setActiveTab('repair')}>打开深度修复</Button>
                <Button onClick={() => navigate('gateway')}>进入网关页</Button>
                <Button onClick={() => navigate('memory')}>进入记忆页</Button>
              </Toolbar>
            </Panel>

            <Panel
              title="常用体检"
              subtitle="只保留最常用的四项体检，完整命令集合已经收进“深度修复”。"
            >
              <DiagnosticCommandGrid
                commands={QUICK_DIAGNOSTIC_COMMANDS}
                running={running}
                navigate={navigate}
                onRun={run}
                showCli={false}
                showRelatedPageButton={false}
              />
              <div className="detail-list compact top-gap">
                <KeyValueRow label="最近动作" value={lastActionLabel ?? '尚无最近动作'} />
                <KeyValueRow label="默认日志" value={selectedLogLabel} />
                <KeyValueRow label="深度命令区" value="已收进深度修复" />
              </div>
              <Toolbar>
                <Button kind="primary" onClick={() => setActiveTab('artifacts')}>查看日志与材料</Button>
                <Button onClick={() => setActiveTab('repair')}>查看完整体检</Button>
              </Toolbar>
            </Panel>
          </div>

          <Panel
            title="运行姿态"
            subtitle="需要判断模型、执行后端、记忆和网关是不是同一条链路时，再往下展开这一层。"
          >
            <RuntimePostureView posture={posture} navigate={navigate} />
          </Panel>
        </>
      ) : null}

      {activeTab === 'repair' ? (
        <>
          {repairActionsSection}

          <div className="two-column wide-left">
            <Panel
              title="完整运行体检"
              subtitle="这里保留所有运行态相关体检命令，适合已经确认需要进一步深挖时使用。"
            >
              <DiagnosticCommandGrid
                commands={RUNTIME_DIAGNOSTIC_COMMANDS}
                running={running}
                navigate={navigate}
                onRun={run}
              />
            </Panel>

            <Panel
              title="完整能力体检"
              subtitle="技能、插件、工具和记忆链路的完整核验动作都收在这里，不再默认占用首页。"
            >
              <DiagnosticCommandGrid
                commands={CAPABILITY_DIAGNOSTIC_COMMANDS}
                running={running}
                navigate={navigate}
                onRun={run}
              />
            </Panel>
          </div>

          <Panel
            title="排障上下文"
            subtitle="这里展示的都是当前 profile 的真实本地状态，适合在执行命令前先扫一眼。"
          >
            {snapshot && config ? (
              <div className="detail-list">
                <KeyValueRow label="当前 Profile" value={snapshot.profileName} />
                <KeyValueRow label="默认模型" value={config.summary.modelDefault ?? '—'} />
                <KeyValueRow label="提供商" value={config.summary.modelProvider ?? '—'} />
                <KeyValueRow label="Base URL" value={config.summary.modelBaseUrl ?? '—'} />
                <KeyValueRow label="终端后端" value={config.summary.terminalBackend ?? '—'} />
                <KeyValueRow label="工作目录" value={config.summary.terminalCwd ?? '—'} />
                <KeyValueRow label="Context Engine" value={config.summary.contextEngine ?? '—'} />
                <KeyValueRow
                  label="Toolsets"
                  value={config.summary.toolsets.length ? config.summary.toolsets.join(', ') : '—'}
                />
                <KeyValueRow label="记忆功能" value={String(config.summary.memoryEnabled ?? false)} />
                <KeyValueRow label="用户画像" value={String(config.summary.userProfileEnabled ?? false)} />
                <KeyValueRow label="MEMORY / USER 上限" value={`${config.summary.memoryCharLimit ?? '—'} / ${config.summary.userCharLimit ?? '—'}`} />
                <KeyValueRow label="本地技能数" value={skills.length} />
                <KeyValueRow label="运行工具" value={`${enabledToolCount(extensions)} / ${totalToolCount(extensions)}`} />
                <KeyValueRow label="插件数" value={pluginsCount(extensions)} />
                <KeyValueRow label="Memory Runtime" value={extensions?.memoryRuntime.provider ?? '—'} />
                <KeyValueRow label="Cron 作业数" value={jobs.length} />
                <KeyValueRow label="远端投递作业" value={remoteJobs.length} />
              </div>
            ) : (
              <EmptyState title="上下文未就绪" description="暂时还没有读取到 dashboard、config 与 cron 摘要。" />
            )}
          </Panel>
        </>
      ) : null}

      {activeTab === 'artifacts' ? artifactSection : null}
    </div>
  );
}
