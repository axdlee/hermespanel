import { useEffect, useState } from 'react';

import { Button, ContextBanner, EmptyState, KeyValueRow, LoadingState, Panel, Pill, StatCard, Toolbar } from '../components/ui';
import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
  type DrilldownSeed,
} from '../lib/drilldown';
import {
  GATEWAY_DIAGNOSTIC_COMMANDS,
  getDiagnosticCommand,
  type DiagnosticKind,
} from '../lib/diagnostics';
import { formatTimestamp, truncate } from '../lib/format';
import {
  countConnectedPlatforms,
  cronTone,
  hasCronFailure,
  isRemoteDelivery,
  platformTone,
} from '../lib/runtime';
import type { CommandRunResult, CronJobsSnapshot, DashboardSnapshot, InstallationSnapshot } from '../types';
import { isGatewayPageIntent, type GatewayPageIntent, type PageProps } from './types';

type GatewayTabKey = 'overview' | 'delivery' | 'repair';
type GatewayDeliveryViewKey = 'platforms' | 'jobs' | 'routing';
type GatewayRepairViewKey = 'service' | 'materials' | 'diagnostics' | 'output';

const GATEWAY_TABS: Array<{ key: GatewayTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看当前链路判断和最常走的排查入口。' },
  { key: 'delivery', label: '平台与远端', hint: '查看平台状态和远端投递作业。' },
  { key: 'repair', label: '修复与材料', hint: '集中处理 service 接管、CLI 诊断与原始输出。' },
];

const GATEWAY_DELIVERY_VIEWS: Array<{
  key: GatewayDeliveryViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'platforms', label: '平台状态', icon: '🛰️', hint: '默认先看平台连接和异常对象，不把平台和作业两组列表同时摊开。' },
  { key: 'jobs', label: '远端作业', icon: '📮', hint: '只在需要核对远端 delivery 时，再看作业摘要和失败对象。' },
  { key: 'routing', label: '继续排查', icon: '🔎', hint: '日志、诊断和跨页联动统一放在这里，不再和列表混在一起。' },
];

const GATEWAY_REPAIR_VIEWS: Array<{
  key: GatewayRepairViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'service', label: '服务接管', icon: '🛠️', hint: 'Service 安装、启停和基础运行控制集中在这里。' },
  { key: 'materials', label: '链路材料', icon: '🗂️', hint: '状态文件、日志目录和上下游核对继续后置到这一层。' },
  { key: 'diagnostics', label: '诊断命令', icon: '🧭', hint: 'CLI 诊断命令单独放一层，避免默认占满修复页。' },
  { key: 'output', label: '命令输出', icon: '🧾', hint: '最近一次动作和原始输出只在这一层查看。' },
];

export function GatewayPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [cronSnapshot, setCronSnapshot] = useState<CronJobsSnapshot | null>(null);
  const [diagnostic, setDiagnostic] = useState<CommandRunResult | null>(null);
  const [lastKind, setLastKind] = useState<DiagnosticKind | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState<GatewayPageIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GatewayTabKey>('overview');
  const [deliveryView, setDeliveryView] = useState<GatewayDeliveryViewKey>('platforms');
  const [repairView, setRepairView] = useState<GatewayRepairViewKey>('service');
  const [showAllPlatforms, setShowAllPlatforms] = useState(false);
  const [showAllRemoteJobs, setShowAllRemoteJobs] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [snapshot, nextInstallation, cron] = await Promise.all([
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.getCronJobs(profile),
      ]);
      setData(snapshot);
      setInstallation(nextInstallation);
      setCronSnapshot(cron);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: 'start' | 'restart' | 'stop') {
    setRunningCommand(`gateway:${action}`);
    try {
      const result = await api.runGatewayAction(action, profile);
      setDiagnostic(result);
      setLastKind(null);
      setLastActionLabel(action === 'start' ? '启动 Gateway' : action === 'restart' ? '重启 Gateway' : '停止 Gateway');
      notify(result.success ? 'success' : 'error', `gateway ${action} 已执行。`);
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningCommand(null);
    }
  }

  async function runDiagnostic(
    kind: DiagnosticKind,
    options: { silent?: boolean; refresh?: boolean } = {},
  ) {
    const { silent = false, refresh = true } = options;
    setRunningCommand(`diagnostic:${kind}`);
    try {
      const result = await api.runDiagnostic(kind, profile);
      setDiagnostic(result);
      setLastKind(kind);
      setLastActionLabel(getDiagnosticCommand(kind)?.label ?? kind);
      if (!silent) {
        notify(result.success ? 'success' : 'error', `${kind} 已执行。`);
      }
      if (refresh) {
        await load();
      }
    } catch (reason) {
      if (!silent) {
        notify('error', String(reason));
      }
    } finally {
      setRunningCommand(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `finder:${label}`,
      label,
      notify,
      path,
      revealInFinder,
      setBusy: setRunningCommand,
    });
  }

  async function openInTerminal(actionKey: string, label: string, command: string, confirmMessage?: string) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setDiagnostic(result);
        setLastKind(null);
        setLastActionLabel(resultLabel);
      },
      profile,
      setBusy: setRunningCommand,
      workingDirectory: installation?.hermesHomeExists ? installation.hermesHome : null,
    });
  }

  useEffect(() => {
    setDiagnostic(null);
    setLastKind(null);
    setLastActionLabel(null);
    setActiveTab('overview');
    setDeliveryView('platforms');
    setRepairView('service');
    setShowAllPlatforms(false);
    setShowAllRemoteJobs(false);
    void Promise.all([
      load(),
      runDiagnostic('gateway-status', { silent: true, refresh: false }),
    ]);
  }, [profile]);

  useEffect(() => {
    if (!isGatewayPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    setActiveTab('overview');
    setDeliveryView(pageIntent.platformName ? 'platforms' : 'routing');
    setRepairView('service');
    notify('info', `${pageIntent.headline} 已带入网关编排台。`);
    consumePageIntent();
  }, [consumePageIntent, notify, pageIntent]);

  if (loading || !data || !installation) {
    return <LoadingState label="正在加载 Hermes 网关编排视图。" />;
  }

  const gateway = data.gateway;
  const platforms = gateway?.platforms ?? [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const failingRemoteJobs = remoteJobs.filter(hasCronFailure);
  const unhealthyPlatforms = platforms.filter((platform) => platformTone(platform.state) !== 'good');
  const connectedPlatforms = countConnectedPlatforms(platforms);
  const lastCommand = lastKind ? getDiagnosticCommand(lastKind) : null;
  const gatewayStatePath = `${data.hermesHome}/gateway_state.json`;
  const logsDir = `${data.hermesHome}/logs`;
  const relaySeed: DrilldownSeed = investigation
    ? {
        sourcePage: 'gateway',
        headline: investigation.headline,
        description: investigation.description,
        context: investigation.context,
      }
    : {
        sourcePage: 'gateway',
        headline: '来自 Gateway 的链路下钻',
        description: '继续围绕消息链路、远端投递和网关运行态做排障。',
      };
  const gatewayLogName = unhealthyPlatforms.length > 0 || failingRemoteJobs.length > 0 ? 'gateway.error' : 'gateway';
  const gatewayContains = investigation?.platformName
    || relaySeed.context?.source
    || unhealthyPlatforms[0]?.name
    || failingRemoteJobs[0]?.deliver
    || '';
  const logsIntent = buildLogsDrilldownIntent(relaySeed, {
    description: '查看当前网关链路相关日志，验证平台连接、交付异常和服务状态。',
    logName: gatewayLogName,
    contains: gatewayContains,
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(relaySeed, {
    description: '继续做更聚焦的网关体检。',
    suggestedCommand: remoteJobs.length > 0 || unhealthyPlatforms.length > 0 ? 'gateway-status-deep' : 'gateway-status',
    logName: gatewayLogName,
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(relaySeed, {
    description: '回到扩展层核对 tools、skills、plugins 与消息链路是否匹配。',
    rawKind: 'tools',
    query: relaySeed.context?.toolNames.join(' ') ?? '',
    toolNames: relaySeed.context?.toolNames ?? [],
  });
  const configIntent = buildConfigDrilldownIntent(relaySeed, {
    description: '回到配置中心核对 context engine、provider 和 memory 配置。',
    focus: 'context',
    suggestedCommand: 'config-check',
  });
  const warnings: string[] = [];
  const gatewayRunning = gateway?.gatewayState === 'running';
  const gatewayStartReadiness = !installation.binaryFound
    ? '先安装 CLI'
    : !gatewayRunning
      ? '先启动网关'
      : unhealthyPlatforms.length > 0
        ? '平台待修复'
        : '链路可用';
  const gatewayStartHint = !installation.binaryFound
    ? 'CLI 缺失时，网关 service、平台接入和诊断链路都无法真正执行。'
    : !gatewayRunning
      ? '基础配置看起来已存在，下一步建议先启动或重启网关。'
      : unhealthyPlatforms.length > 0
        ? `当前已有 ${unhealthyPlatforms.length} 个平台异常，建议先看平台状态和日志。`
        : '网关服务和平台链路看起来都可用，可以继续核对远端投递或上下游配置。';
  if (!installation.binaryFound) {
    warnings.push('当前还没有检测到 Hermes CLI，先完成安装后，网关 service 和平台配置才能真正闭环。');
  }
  if (gateway?.gatewayState !== 'running') {
    warnings.push('gateway 当前未运行，消息平台和远端 delivery 链路都还没有真正恢复。');
  }
  if (!installation.gatewayStateExists) {
    warnings.push('还没有看到 gateway_state.json，说明 service 还未被完整接管或从未成功启动。');
  }
  if (remoteJobs.length > 0 && gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端投递作业依赖 gateway，但网关当前不可用。`);
  }
  if (unhealthyPlatforms.length > 0) {
    warnings.push(`共有 ${unhealthyPlatforms.length} 个平台连接异常或未就绪：${unhealthyPlatforms.map((item) => item.name).join('、')}。`);
  }
  if (failingRemoteJobs.length > 0) {
    warnings.push(`远端投递作业里已有 ${failingRemoteJobs.length} 条出现错误或交付异常，建议回到 Cron 和 Logs 进一步排查。`);
  }
  if (!data.config.contextEngine) {
    warnings.push('当前没有显式声明 context.engine，消息处理链路的上下文组织方式不够清晰。');
  }
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);
  const prioritizedPlatforms = [...platforms].sort((left, right) => {
    const leftWeight = platformTone(left.state) === 'good' ? 1 : 0;
    const rightWeight = platformTone(right.state) === 'good' ? 1 : 0;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0);
  });
  const prioritizedRemoteJobs = [...remoteJobs].sort((left, right) => {
    const leftWeight = hasCronFailure(left) ? 0 : 1;
    const rightWeight = hasCronFailure(right) ? 0 : 1;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return Number(right.nextRunAt ?? 0) - Number(left.nextRunAt ?? 0);
  });
  const visiblePlatforms = showAllPlatforms ? prioritizedPlatforms : prioritizedPlatforms.slice(0, 4);
  const visibleRemoteJobs = showAllRemoteJobs ? prioritizedRemoteJobs : prioritizedRemoteJobs.slice(0, 4);
  const hiddenPlatformCount = Math.max(0, platforms.length - visiblePlatforms.length);
  const hiddenRemoteJobCount = Math.max(0, remoteJobs.length - visibleRemoteJobs.length);
  const activeDeliveryView = GATEWAY_DELIVERY_VIEWS.find((item) => item.key === deliveryView) ?? GATEWAY_DELIVERY_VIEWS[0];
  const activeRepairView = GATEWAY_REPAIR_VIEWS.find((item) => item.key === repairView) ?? GATEWAY_REPAIR_VIEWS[0];

  const overviewSection = (
    <>
      <Panel
        title="常用去向"
        subtitle="默认只保留最常走的四个入口，链路细节和低频修复继续后置到下一层。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => {
              setDeliveryView('platforms');
              setActiveTab('delivery');
            }}
          >
            <strong><span className="dashboard-shortcut-icon">📡</span>服务与平台</strong>
            <span>{gatewayRunning ? `${connectedPlatforms}/${platforms.length || 0} 个平台已连通` : '先启动 Gateway 再看平台链路'}</span>
          </button>
          <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('logs', logsIntent)}>
            <strong><span className="dashboard-shortcut-icon">🧾</span>日志排查</strong>
            <span>{gatewayContains ? `优先筛 ${gatewayContains}` : '直接进入网关日志继续排查'}</span>
          </button>
          <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('cron')}>
            <strong><span className="dashboard-shortcut-icon">📤</span>远端作业</strong>
            <span>{remoteJobs.length > 0 ? `${remoteJobs.length} 个作业待核对` : '当前主要是本地链路'}</span>
          </button>
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => {
              setRepairView('service');
              setActiveTab('repair');
            }}
          >
            <strong><span className="dashboard-shortcut-icon">🛠️</span>深度修复</strong>
            <span>{warnings.length > 0 ? `${warnings.length} 条提醒已后置到修复层` : 'service 接管和原始输出都已后置'}</span>
          </button>
        </div>
        <p className="helper-text top-gap">默认先完成启动、平台、日志和作业这四步，不再把多张解释卡片同时铺在首屏。</p>
      </Panel>

      <Panel
        title="当前判断"
        subtitle="这里只保留当前起点、少量提醒和最近动作，避免重复解释相同问题。"
      >
        <div className="workspace-summary-strip">
          <section className="summary-mini-card">
            <span className="summary-mini-label">服务状态</span>
            <strong className="summary-mini-value">{gateway?.gatewayState ?? '未检测到'}</strong>
            <span className="summary-mini-meta">{`PID ${gateway?.pid ?? '—'} · 更新时间 ${formatTimestamp(gateway?.updatedAt)}`}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">平台连接</span>
            <strong className="summary-mini-value">{platforms.length ? `${connectedPlatforms}/${platforms.length}` : '暂无平台'}</strong>
            <span className="summary-mini-meta">{unhealthyPlatforms.length === 0 ? '当前没有明显平台异常。' : `异常平台 ${unhealthyPlatforms.length} 个`}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">远端交付</span>
            <strong className="summary-mini-value">{remoteJobs.length ? `${remoteJobs.length} 个作业` : '本地优先'}</strong>
            <span className="summary-mini-meta">{failingRemoteJobs.length === 0 ? '当前没有明显交付失败。' : `${failingRemoteJobs.length} 个作业异常`}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">上游配置</span>
            <strong className="summary-mini-value">{data.config.contextEngine || 'context 未配置'}</strong>
            <span className="summary-mini-meta">{`${data.config.modelProvider || 'provider 未配置'} / ${data.config.modelDefault || 'model 未配置'} / Memory ${data.config.memoryProvider || 'builtin-file'}`}</span>
          </section>
        </div>
        <div className="detail-list compact top-gap">
          <KeyValueRow label="当前起点" value={gatewayStartReadiness} />
          <KeyValueRow label="状态文件" value={installation.gatewayStateExists ? 'gateway_state.json 已就绪' : '状态文件缺失'} />
          <KeyValueRow label="最近动作" value={lastActionLabel ?? '尚无最近动作'} />
          <KeyValueRow label="最近诊断" value={diagnostic ? (diagnostic.success ? '最近结果成功' : '最近结果失败') : '暂未执行诊断'} />
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
              <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在“平台与远端”和“修复与材料”里。</p>
            ) : null}
          </>
          ) : (
            <EmptyState title="网关状态稳定" description="当前没有看到明显的网关结构性风险，可以继续看平台细节或远端作业映射。" />
          )}
        <Toolbar>
          <Button kind="primary" onClick={() => void runAction(gatewayRunning ? 'restart' : 'start')} disabled={runningCommand !== null || !installation.binaryFound}>
            {gatewayRunning ? '重启 Gateway' : '启动 Gateway'}
          </Button>
          <Button onClick={() => void runDiagnostic('gateway-status')} disabled={runningCommand !== null || !installation.binaryFound}>
            网关状态
          </Button>
          <Button onClick={() => { setRepairView('service'); setActiveTab('repair'); }}>打开修复层</Button>
        </Toolbar>
      </Panel>
    </>
  );

  const deliverySection = (
    <>
      <Panel title="平台与远端入口" subtitle="平台状态、远端作业和继续排查拆成独立子视图，默认只展开一个工作面。">
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {GATEWAY_DELIVERY_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${deliveryView === item.key ? 'active' : ''}`}
              onClick={() => setDeliveryView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeDeliveryView.hint}</p>
      </Panel>

      {deliveryView === 'platforms' ? (
        <Panel
          title="平台状态"
          subtitle="默认只围绕异常平台和最近更新对象判断，不再把远端作业同时摊开。"
          aside={platforms.length > 4 ? (
            <Toolbar>
              <Button onClick={() => setShowAllPlatforms((value) => !value)}>
                {showAllPlatforms ? '收起平台' : `展开更多平台（剩余 ${hiddenPlatformCount} 个）`}
              </Button>
            </Toolbar>
          ) : undefined}
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">平台总数</span>
              <strong className="summary-mini-value">{platforms.length || '暂无平台'}</strong>
              <span className="summary-mini-meta">{platforms.length > 0 ? `${connectedPlatforms} 个已连通` : '尚未解析出平台'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">异常平台</span>
              <strong className="summary-mini-value">{unhealthyPlatforms.length}</strong>
              <span className="summary-mini-meta">{unhealthyPlatforms[0]?.name || '当前没有明显异常'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">状态文件</span>
              <strong className="summary-mini-value">{installation.gatewayStateExists ? '已就绪' : '缺失'}</strong>
              <span className="summary-mini-meta">{installation.gatewayStateExists ? 'service 状态已可回收' : '建议先启动一次 Gateway'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">最近刷新</span>
              <strong className="summary-mini-value">{formatTimestamp(gateway?.updatedAt)}</strong>
              <span className="summary-mini-meta">{gatewayRunning ? '服务正在运行' : '当前服务未运行'}</span>
            </section>
          </div>
          {visiblePlatforms.length ? (
            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              {visiblePlatforms.map((platform) => (
                <button
                  key={platform.name}
                  type="button"
                  className="workspace-shortcut-card dashboard-shortcut-card"
                  onClick={() => navigate('logs', buildLogsDrilldownIntent(relaySeed, {
                    description: `查看平台 ${platform.name} 关联的网关日志。`,
                    logName: platformTone(platform.state) === 'good' ? 'gateway' : 'gateway.error',
                    contains: platform.name,
                    limit: '160',
                  }))}
                >
                  <strong><span className="dashboard-shortcut-icon">{platformTone(platform.state) === 'good' ? '🟢' : '🟠'}</span>{platform.name}</strong>
                  <span>{platform.errorMessage ? truncate(platform.errorMessage, 56) : `${platform.state} · ${formatTimestamp(platform.updatedAt)}`}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无平台状态" description="启动并配置消息平台后，这里会显示各平台连接状态。" />
          )}
          {platforms.length > visiblePlatforms.length ? (
            <p className="helper-text top-gap">其余 {hiddenPlatformCount} 个平台已先收起，避免默认把入口页铺成整面列表。</p>
          ) : null}
          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => navigate('logs', logsIntent)}>查看日志</Button>
            <Button onClick={() => setDeliveryView('jobs')}>切到远端作业</Button>
            <Button onClick={() => setDeliveryView('routing')}>继续排查</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {deliveryView === 'jobs' ? (
        <Panel
          title="远端作业"
          subtitle="这里只看依赖 Gateway 的 delivery 作业，失败对象优先靠前。"
          aside={remoteJobs.length > 4 ? (
            <Toolbar>
              <Button onClick={() => setShowAllRemoteJobs((value) => !value)}>
                {showAllRemoteJobs ? '收起作业' : `展开更多作业（剩余 ${hiddenRemoteJobCount} 个）`}
              </Button>
            </Toolbar>
          ) : undefined}
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">远端作业</span>
              <strong className="summary-mini-value">{remoteJobs.length || '暂无'}</strong>
              <span className="summary-mini-meta">{remoteJobs.length > 0 ? '这里只看依赖 Gateway 的作业' : '当前仍以本地交付为主'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">失败作业</span>
              <strong className="summary-mini-value">{failingRemoteJobs.length}</strong>
              <span className="summary-mini-meta">{failingRemoteJobs[0]?.name || '当前没有交付失败'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">下一次调度</span>
              <strong className="summary-mini-value">{formatTimestamp(prioritizedRemoteJobs[0]?.nextRunAt)}</strong>
              <span className="summary-mini-meta">{prioritizedRemoteJobs[0]?.name || '暂无远端调度'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">建议去向</span>
              <strong className="summary-mini-value">{failingRemoteJobs.length > 0 ? '先看日志' : '继续看 Cron'}</strong>
              <span className="summary-mini-meta">{failingRemoteJobs.length > 0 ? '错误日志通常更快定位问题' : '回到 Cron 继续核对 delivery'}</span>
            </section>
          </div>
          {visibleRemoteJobs.length ? (
            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              {visibleRemoteJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className="workspace-shortcut-card dashboard-shortcut-card"
                  onClick={() => navigate('logs', buildLogsDrilldownIntent(relaySeed, {
                    description: `查看远端作业 ${job.name} 的交付日志。`,
                    logName: job.lastDeliveryError || job.lastError ? 'gateway.error' : 'gateway',
                    contains: job.id,
                    limit: '160',
                  }))}
                >
                  <strong><span className="dashboard-shortcut-icon">{hasCronFailure(job) ? '⚠️' : '📮'}</span>{job.name}</strong>
                  <span>{job.lastDeliveryError || job.lastError || `下次 ${formatTimestamp(job.nextRunAt)}`}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无远端作业" description="当前 profile 还没有依赖 gateway 的 delivery 作业，或者所有作业都走本地交付。" />
          )}
          {remoteJobs.length > visibleRemoteJobs.length ? (
            <p className="helper-text top-gap">其余 {hiddenRemoteJobCount} 个作业已先收起，需要时再展开全部。</p>
          ) : null}
          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => navigate('cron')}>进入 Cron</Button>
            <Button onClick={() => navigate('logs', logsIntent)}>查看日志</Button>
            <Button onClick={() => setDeliveryView('routing')}>继续排查</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {deliveryView === 'routing' ? (
        <Panel
          title="继续排查"
          subtitle="日志、诊断、Cron 和上下游联动统一后置到这里，不再和平台清单混排。"
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">日志入口</span>
              <strong className="summary-mini-value">{gatewayLogName}</strong>
              <span className="summary-mini-meta">{gatewayContains ? `优先筛 ${gatewayContains}` : '直接看网关主日志'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">诊断建议</span>
              <strong className="summary-mini-value">{remoteJobs.length > 0 || unhealthyPlatforms.length > 0 ? 'gateway-status-deep' : 'gateway-status'}</strong>
              <span className="summary-mini-meta">这里只保留下一步建议，不直接堆所有命令卡片。</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">作业联动</span>
              <strong className="summary-mini-value">{remoteJobs.length ? `${remoteJobs.length} 个远端作业` : '本地优先'}</strong>
              <span className="summary-mini-meta">{failingRemoteJobs.length > 0 ? `${failingRemoteJobs.length} 个异常待核对` : '当前没有明显交付失败'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">上游配置</span>
              <strong className="summary-mini-value">{data.config.contextEngine || '未配置'}</strong>
              <span className="summary-mini-meta">{`${data.config.modelProvider || 'provider 未配置'} / ${data.config.modelDefault || 'model 未配置'}`}</span>
            </section>
          </div>
          <div className="workspace-shortcut-grid dashboard-launcher-grid top-gap">
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('logs', logsIntent)}>
              <strong><span className="dashboard-shortcut-icon">🧾</span>查看日志</strong>
              <span>{gatewayLogName === 'gateway.error' ? '优先看错误日志' : '先看总日志确认链路'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('diagnostics', diagnosticsIntent)}>
              <strong><span className="dashboard-shortcut-icon">🧭</span>进入诊断</strong>
              <span>{warnings.length > 0 ? '带着异常平台和作业继续深检' : '当前可以直接做深检确认'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('cron')}>
              <strong><span className="dashboard-shortcut-icon">📤</span>查看 Cron</strong>
              <span>{remoteJobs.length > 0 ? '继续核对 delivery 调度和失败回执' : '确认是否仍然只走本地交付'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('config', configIntent)}>
              <strong><span className="dashboard-shortcut-icon">⚙️</span>核对配置</strong>
              <span>检查 context、provider、model 与网关链路是否对齐</span>
            </button>
          </div>
          <Toolbar className="top-gap">
            <Button onClick={() => navigate('extensions', extensionsIntent)}>核对扩展层</Button>
            <Button onClick={() => setDeliveryView('platforms')}>回到平台状态</Button>
            <Button onClick={() => setDeliveryView('jobs')}>回到远端作业</Button>
          </Toolbar>
        </Panel>
      ) : null}
    </>
  );

  const repairSection = (
    <>
      <Panel
        title="修复与材料入口"
        subtitle="Service 接管、链路材料、诊断命令和命令输出拆成独立子视图，默认只展开一个模块。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {GATEWAY_REPAIR_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${repairView === item.key ? 'active' : ''}`}
              onClick={() => setRepairView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeRepairView.hint}</p>
      </Panel>

      {repairView === 'service' ? (
        <Panel
          title="Service 接管与运行控制"
          subtitle="把安装、setup、卸载、启停和基础状态刷新合并到一个工作面，不再拆成多块并排。"
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">CLI</span>
              <strong className="summary-mini-value">{installation.binaryFound ? '已就绪' : '缺失'}</strong>
              <span className="summary-mini-meta">{installation.binaryFound ? '可以继续做 service 接管和诊断' : '请先安装 Hermes CLI'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Service</span>
              <strong className="summary-mini-value">{installation.gatewayStateExists ? '已接管' : '待接管'}</strong>
              <span className="summary-mini-meta">{installation.gatewayStateExists ? 'gateway_state.json 已可回收' : '还没有看到完整接管痕迹'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">运行状态</span>
              <strong className="summary-mini-value">{gatewayRunning ? '运行中' : '未运行'}</strong>
              <span className="summary-mini-meta">{gatewayRunning ? `PID ${gateway?.pid ?? '—'}` : '下一步建议先启动或重启'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">最近动作</span>
              <strong className="summary-mini-value">{lastActionLabel ?? '暂无'}</strong>
              <span className="summary-mini-meta">{diagnostic ? (diagnostic.success ? '最近结果成功' : '最近结果失败') : '还没有执行动作'}</span>
            </section>
          </div>

          <div className="control-card-grid top-gap">
            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Service</p>
                  <h3 className="action-card-title">接管工作流</h3>
                </div>
                <Pill tone={installation.gatewayStateExists ? 'good' : 'warn'}>
                  {installation.gatewayStateExists ? '已接管' : '待接管'}
                </Pill>
              </div>
              <p className="action-card-copy">客户端只做接管封装，不重复实现 Hermes 内部 service 逻辑。</p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void openInTerminal('gateway:install-service', '安装 Gateway Service', installation.gatewayInstallCommand)}
                  disabled={runningCommand !== null || !installation.binaryFound}
                >
                  {runningCommand === 'gateway:install-service' ? '安装 Service…' : '安装 Service'}
                </Button>
                <Button
                  onClick={() => void openInTerminal('gateway:setup-service', 'Gateway Setup', installation.gatewaySetupCommand)}
                  disabled={runningCommand !== null || !installation.binaryFound}
                >
                  {runningCommand === 'gateway:setup-service' ? 'Gateway Setup…' : 'Gateway Setup'}
                </Button>
                <Button
                  kind="danger"
                  onClick={() => void openInTerminal('gateway:uninstall-service', '卸载 Gateway Service', installation.gatewayUninstallCommand, '确定卸载当前 profile 的 gateway service 吗？')}
                  disabled={runningCommand !== null || !installation.binaryFound}
                >
                  {runningCommand === 'gateway:uninstall-service' ? '卸载 Service…' : '卸载 Service'}
                </Button>
              </Toolbar>
            </section>

            <section className="action-card action-card-compact">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Runtime</p>
                  <h3 className="action-card-title">运行控制</h3>
                </div>
                <Pill tone={gatewayRunning ? 'good' : 'warn'}>
                  {gatewayRunning ? '运行中' : '待启动'}
                </Pill>
              </div>
              <p className="action-card-copy">日常启停仍走 Hermes 原生命令，客户端只负责集中入口和结果回显。</p>
              <Toolbar>
                <Button kind="primary" onClick={() => void runAction('start')} disabled={runningCommand !== null || !installation.binaryFound}>
                  {runningCommand === 'gateway:start' ? '启动中…' : '启动'}
                </Button>
                <Button onClick={() => void runAction('restart')} disabled={runningCommand !== null || !installation.binaryFound}>
                  {runningCommand === 'gateway:restart' ? '重启中…' : '重启'}
                </Button>
                <Button kind="danger" onClick={() => void runAction('stop')} disabled={runningCommand !== null || !installation.binaryFound}>
                  {runningCommand === 'gateway:stop' ? '停止中…' : '停止'}
                </Button>
                <Button onClick={() => void runDiagnostic('gateway-status')} disabled={runningCommand !== null || !installation.binaryFound}>
                  网关状态
                </Button>
              </Toolbar>
            </section>
          </div>

          <Toolbar className="top-gap">
            <Button onClick={() => setRepairView('materials')}>去看链路材料</Button>
            <Button onClick={() => setRepairView('diagnostics')}>去看诊断命令</Button>
            <Button onClick={() => setRepairView('output')}>查看命令输出</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {repairView === 'materials' ? (
        <Panel
          title="链路材料与上下游核对"
          subtitle="状态文件、日志目录、Cron、配置和扩展入口统一后置到这一层。"
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">状态文件</span>
              <strong className="summary-mini-value">{installation.gatewayStateExists ? '已就绪' : '缺失'}</strong>
              <span className="summary-mini-meta">{installation.gatewayStateExists ? '可以直接定位 gateway_state.json' : '建议先至少成功启动一次'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">日志目录</span>
              <strong className="summary-mini-value">{installation.logsDirExists ? '已就绪' : '缺失'}</strong>
              <span className="summary-mini-meta">{installation.logsDirExists ? '可直接打开 logs 目录' : '当前还没有稳定日志材料'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">远端依赖</span>
              <strong className="summary-mini-value">{remoteJobs.length ? `${remoteJobs.length} 个` : '暂无'}</strong>
              <span className="summary-mini-meta">{failingRemoteJobs.length > 0 ? `${failingRemoteJobs.length} 个作业异常` : '当前没有明显远端失败'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">上游配置</span>
              <strong className="summary-mini-value">{data.config.contextEngine || '未配置'}</strong>
              <span className="summary-mini-meta">{`${data.config.modelProvider || 'provider 未配置'} / ${data.config.memoryProvider || 'builtin-file'}`}</span>
            </section>
          </div>

          <div className="workspace-shortcut-grid dashboard-launcher-grid top-gap">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => void openInFinder(gatewayStatePath, 'gateway_state.json', true)}
              disabled={!installation.gatewayStateExists}
            >
              <strong><span className="dashboard-shortcut-icon">🗂️</span>状态文件</strong>
              <span>{installation.gatewayStateExists ? '直接定位 gateway_state.json' : '状态文件尚未生成'}</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => void openInFinder(logsDir, 'logs 目录')}
              disabled={!installation.logsDirExists}
            >
              <strong><span className="dashboard-shortcut-icon">📁</span>日志目录</strong>
              <span>{installation.logsDirExists ? '直接打开 Hermes logs 目录' : '当前没有可打开的日志目录'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('cron')}>
              <strong><span className="dashboard-shortcut-icon">📤</span>Cron 编排</strong>
              <span>{remoteJobs.length > 0 ? '继续核对 delivery 作业调度' : '确认是否仍然只走本地链路'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('config', configIntent)}>
              <strong><span className="dashboard-shortcut-icon">⚙️</span>配置中心</strong>
              <span>核对 context、provider、memory 与 Gateway 链路</span>
            </button>
          </div>

          {warnings.length > 0 ? (
            <div className="warning-stack top-gap">
              {warnings.slice(0, 3).map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => navigate('logs', logsIntent)}>进入日志页</Button>
            <Button onClick={() => navigate('extensions', extensionsIntent)}>核对扩展层</Button>
            <Button onClick={() => setRepairView('service')}>回到服务接管</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {repairView === 'diagnostics' ? (
        <Panel
          title="诊断命令"
          subtitle="CLI 诊断命令单独放在这一层，默认不再占满修复页首屏。"
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">最近命令</span>
              <strong className="summary-mini-value">{lastActionLabel ?? '暂无'}</strong>
              <span className="summary-mini-meta">{lastCommand?.cli || '进入此层后再执行具体诊断命令'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">最近结果</span>
              <strong className="summary-mini-value">{diagnostic ? (diagnostic.success ? '成功' : '失败') : '未执行'}</strong>
              <span className="summary-mini-meta">{diagnostic ? `退出码 ${diagnostic.exitCode}` : '还没有新的 CLI 输出'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">日志联动</span>
              <strong className="summary-mini-value">{gatewayLogName}</strong>
              <span className="summary-mini-meta">{gatewayContains ? `诊断后优先筛 ${gatewayContains}` : '诊断后可直接回日志页'}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">下一步</span>
              <strong className="summary-mini-value">{warnings.length > 0 ? '先查异常' : '做基础体检'}</strong>
              <span className="summary-mini-meta">深诊断通常只在异常平台、失败作业或配置漂移时再进入。</span>
            </section>
          </div>

          <div className="workbench-grid top-gap">
            {GATEWAY_DIAGNOSTIC_COMMANDS.map((item) => (
              <section className="action-card" key={item.key}>
                <div className="action-card-header">
                  <div>
                    <p className="eyebrow">CLI</p>
                    <h3 className="action-card-title">{item.label}</h3>
                  </div>
                  <Pill tone={item.key.includes('deep') ? 'warn' : item.kind === 'primary' ? 'good' : 'neutral'}>
                    {item.key}
                  </Pill>
                </div>
                <p className="action-card-copy">{item.description}</p>
                <p className="helper-text">{item.cli}</p>
                <Toolbar>
                  <Button
                    kind={item.kind}
                    onClick={() => void runDiagnostic(item.key)}
                    disabled={runningCommand !== null}
                  >
                    {runningCommand === `diagnostic:${item.key}` ? `${item.label}…` : `执行 ${item.label}`}
                  </Button>
                  <Button onClick={() => navigate(item.relatedPage, item.relatedPage === 'logs' ? logsIntent : item.relatedPage === 'config' ? configIntent : undefined)}>
                    进入相关页
                  </Button>
                </Toolbar>
              </section>
            ))}
          </div>

          <Toolbar className="top-gap">
            <Button kind="primary" onClick={() => setRepairView('output')}>查看命令输出</Button>
            <Button onClick={() => setRepairView('materials')}>回到链路材料</Button>
          </Toolbar>
        </Panel>
      ) : null}

      {repairView === 'output' ? (
        <Panel
          title="命令输出"
          subtitle="这里只保留最近一次动作和 Hermes 原生命令结果，方便你对照页面摘要与真实输出。"
          aside={lastCommand ? (
            <Toolbar>
              <Button onClick={() => navigate(lastCommand.relatedPage)}>进入相关页</Button>
            </Toolbar>
          ) : undefined}
        >
          {diagnostic ? (
            <div className="result-stack">
              <div className="detail-list compact">
                <KeyValueRow label="命令类型" value={lastActionLabel ?? lastCommand?.label ?? '网关动作'} />
                <KeyValueRow label="命令" value={diagnostic.command} />
                <KeyValueRow label="退出码" value={diagnostic.exitCode} />
                <KeyValueRow
                  label="结果"
                  value={<Pill tone={diagnostic.success ? 'good' : 'bad'}>{diagnostic.success ? '成功' : '失败'}</Pill>}
                />
              </div>
              <pre className="code-block">{diagnostic.stdout || 'stdout 为空'}</pre>
              {diagnostic.stderr ? <pre className="code-block">{diagnostic.stderr}</pre> : null}
            </div>
          ) : (
            <EmptyState title="暂无诊断输出" description="点击任一网关动作或诊断命令后，这里会展示 Hermes 的原始输出。" />
          )}
          <Toolbar className="top-gap">
            <Button onClick={() => setRepairView('diagnostics')}>去执行诊断命令</Button>
            <Button onClick={() => setRepairView('service')}>回到服务接管</Button>
          </Toolbar>
        </Panel>
      ) : null}
    </>
  );

  return (
    <div className="page-stack">
      <div className="stat-cards">
        <StatCard
          label="当前起点"
          value={gatewayStartReadiness}
          meta={gatewayStartHint}
          tone={gatewayRunning && unhealthyPlatforms.length === 0 ? 'running' : 'warning'}
        />
        <StatCard
          label="平台状态"
          value={platforms.length > 0 ? `${connectedPlatforms}/${platforms.length}` : '暂无平台'}
          meta={unhealthyPlatforms.length === 0 ? '当前没有明显的平台连接异常。' : `异常平台 ${unhealthyPlatforms.length} 个`}
          tone={unhealthyPlatforms.length === 0 ? 'running' : 'warning'}
        />
        <StatCard
          label="远端交付"
          value={remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '本地优先'}
          meta={failingRemoteJobs.length > 0 ? `${failingRemoteJobs.length} 个作业已有交付异常。` : '暂未发现远端投递失败。'}
          tone={failingRemoteJobs.length > 0 ? 'warning' : 'running'}
        />
        <StatCard
          label="上游配置"
          value={data.config.contextEngine || '未配置'}
          meta={`${data.config.modelProvider || 'provider 未配置'} / ${data.config.modelDefault || 'model 未配置'}`}
          tone={data.config.contextEngine ? 'running' : 'warning'}
        />
      </div>

      <Panel
        title="网关编排台"
        subtitle="先看常用总览里的当前判断和推荐动作，平台细节与修复材料都已经后置。"
        aside={(
          <Toolbar>
            <Button kind="primary" onClick={() => void runAction(gatewayRunning ? 'restart' : 'start')} disabled={runningCommand !== null || !installation.binaryFound}>
              {gatewayRunning ? '重启 Gateway' : '启动 Gateway'}
            </Button>
            <Button onClick={() => void runDiagnostic('gateway-status')} disabled={runningCommand !== null || !installation.binaryFound}>
              网关状态
            </Button>
            <Button onClick={() => void load()} disabled={runningCommand !== null}>
              刷新状态
            </Button>
          </Toolbar>
        )}
      >
        <p className="helper-text">
          默认顺序：先看“常用总览”的链路判断，再去“平台与远端”核对平台或作业，最后才进入“修复与材料”处理 service 接管和原始输出。
        </p>
      </Panel>

      {investigation ? (
        <ContextBanner
          label="Session Drilldown"
          title={investigation.headline}
          description={investigation.description}
          meta={(
            <div className="pill-row">
              {investigation.platformName ? <Pill tone="warn">{investigation.platformName}</Pill> : null}
              <Pill>{investigation.context?.source ?? 'sessions'}</Pill>
            </div>
          )}
          actions={(
            <Toolbar>
              <Button kind="primary" onClick={() => void runDiagnostic('gateway-status')} disabled={runningCommand !== null}>
                刷新网关状态
              </Button>
              <Button onClick={() => { setRepairView('service'); setActiveTab('repair'); }}>打开修复层</Button>
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('logs', logsIntent)}>进入日志页</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="tab-bar">
        {GATEWAY_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'delivery' && (unhealthyPlatforms.length > 0 || failingRemoteJobs.length > 0) ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'repair' && (warnings.length > 0 || (diagnostic && !diagnostic.success)) ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewSection : activeTab === 'delivery' ? deliverySection : repairSection}
    </div>
  );
}
