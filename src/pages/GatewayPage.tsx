import { useEffect, useState } from 'react';

import { Button, ContextBanner, EmptyState, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
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

  return (
    <div className="page-stack">
      <Panel
        title="网关编排台"
        subtitle="参考 ClawPanel 的 service / gateway 管理思路，但这里只做 Hermes gateway 的原生封装，不接管任何内部运行逻辑。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load()}>刷新状态</Button>
            <Button onClick={() => void runDiagnostic('gateway-status')}>刷新诊断</Button>
            <Button onClick={() => navigate('diagnostics')}>进入诊断页</Button>
          </Toolbar>
        )}
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">Gateway Runtime & Delivery</p>
            <p className="hero-subtitle">
              网关页关注的不只是服务本身有没有起来，还包括平台连接、远端投递作业、上下文引擎和记忆链路有没有一起对上。
            </p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={profile} />
              <KeyValueRow
                label="Gateway"
                value={(
                  <Pill tone={gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                    {gateway?.gatewayState ?? '未检测到'}
                  </Pill>
                )}
              />
              <KeyValueRow label="PID" value={gateway?.pid ?? '—'} />
              <KeyValueRow label="活跃 Agent" value={gateway?.activeAgents ?? 0} />
              <KeyValueRow label="更新时间" value={formatTimestamp(gateway?.updatedAt)} />
              <KeyValueRow label="Context Engine" value={data.config.contextEngine ?? '—'} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="平台总数" value={platforms.length} hint="gateway_state.json 中的平台对象数" />
            <MetricCard label="已连接" value={connectedPlatforms} hint="当前状态为 connected / running 的平台数" />
            <MetricCard label="远端作业" value={remoteJobs.length} hint="依赖 gateway 投递结果的 cron 作业" />
            <MetricCard label="交付异常" value={failingRemoteJobs.length} hint="远端作业里的错误或投递失败数" />
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
              {investigation.platformName ? <Pill tone="warn">{investigation.platformName}</Pill> : null}
              <Pill>{investigation.context?.source ?? 'sessions'}</Pill>
            </div>
          )}
          actions={(
            <Toolbar>
              <Button kind="primary" onClick={() => void runDiagnostic('gateway-status')} disabled={runningCommand !== null}>
                刷新网关状态
              </Button>
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('logs', logsIntent)}>进入日志页</Button>
              <Button onClick={() => navigate('diagnostics', diagnosticsIntent)}>进入诊断页</Button>
              <Button onClick={() => navigate('extensions', extensionsIntent)}>进入扩展页</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <Panel
        title="服务接管与编排"
        subtitle="把 gateway 的 install / setup / uninstall 和运行控制分开，形成更像 ClawPanel 的服务层闭环。"
      >
        <div className="control-card-grid">
          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Bootstrap</p>
                <h3 className="action-card-title">Gateway Service 接管</h3>
              </div>
              <Pill tone={installation.gatewayStateExists ? 'good' : 'warn'}>
                {installation.gatewayStateExists ? '已发现状态文件' : '尚未接管'}
              </Pill>
            </div>
            <p className="action-card-copy">
              先让 Hermes 自己完成 gateway service 安装和平台向导，面板只负责桌面级入口与状态汇总。
            </p>
            <p className="command-line">
              {installation.gatewayInstallCommand} · {installation.gatewaySetupCommand} · {installation.gatewayUninstallCommand}
            </p>
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
                <h3 className="action-card-title">Service 运行控制</h3>
              </div>
              <Pill tone={gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                {gateway?.gatewayState ?? 'idle'}
              </Pill>
            </div>
            <p className="action-card-copy">
              日常控制仍然直接走 `hermes gateway start / restart / stop`，不在 HermesPanel 内重造服务守护逻辑。
            </p>
            <p className="command-line">hermes gateway start · hermes gateway restart · hermes gateway stop</p>
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
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Topology</p>
                <h3 className="action-card-title">链路与文件入口</h3>
              </div>
              <Pill tone={platforms.length > 0 ? 'good' : 'warn'}>
                {platforms.length > 0 ? `${platforms.length} 个平台` : '暂无平台'}
              </Pill>
            </div>
            <p className="action-card-copy">
              先看状态文件和日志，再判断是 service、平台接入还是远端 delivery 本身的问题。
            </p>
            <p className="command-line">{gatewayStatePath} · {logsDir}</p>
            <Toolbar>
              <Button onClick={() => void openInFinder(gatewayStatePath, 'gateway_state.json', true)} disabled={runningCommand !== null}>定位状态文件</Button>
              <Button onClick={() => void openInFinder(logsDir, 'logs 目录')} disabled={runningCommand !== null}>打开日志目录</Button>
              <Button onClick={() => navigate('logs', logsIntent)}>进入日志页</Button>
              <Button onClick={() => navigate('cron')}>进入 Cron 页</Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Validation</p>
                <h3 className="action-card-title">上下游依赖核对</h3>
              </div>
              <Pill tone={remoteJobs.length === 0 || gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                {remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '本地优先'}
              </Pill>
            </div>
            <p className="action-card-copy">
              gateway 不只是一个进程，还要看 provider、context engine 和远端作业是否一并对上。
            </p>
            <p className="command-line">
              {data.config.modelProvider || 'provider 未配置'} / {data.config.modelDefault || 'model 未配置'} · context {data.config.contextEngine || '未配置'}
            </p>
            <Toolbar>
              <Button onClick={() => navigate('config', configIntent)}>核对配置</Button>
              <Button onClick={() => navigate('extensions', extensionsIntent)}>核对扩展</Button>
              <Button onClick={() => navigate('diagnostics', diagnosticsIntent)}>进入诊断页</Button>
            </Toolbar>
          </section>
        </div>
      </Panel>

      <div className="two-column wide-left">
        <Panel
          title="运行健康"
          subtitle="把 Hermes gateway 的运行态、平台连接和作业依赖放在一起看，方便先判断问题大概在哪一层。"
        >
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Service State</strong>
                <Pill tone={gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p>PID {gateway?.pid ?? '—'} · 更新时间 {formatTimestamp(gateway?.updatedAt)} · restart_requested {String(gateway?.restartRequested ?? false)}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Platform Connectivity</strong>
                <Pill tone={unhealthyPlatforms.length === 0 ? 'good' : 'bad'}>
                  {platforms.length ? `${connectedPlatforms}/${platforms.length} 已连接` : '暂无平台'}
                </Pill>
              </div>
              <p>{unhealthyPlatforms.length === 0 ? '当前没有明显平台异常。' : `异常平台：${unhealthyPlatforms.map((item) => item.name).join('、')}`}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Delivery Dependency</strong>
                <Pill tone={remoteJobs.length === 0 || gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {remoteJobs.length ? `${remoteJobs.length} 个远端作业` : '本地优先'}
                </Pill>
              </div>
              <p>{failingRemoteJobs.length === 0 ? '当前没有明显的远端交付失败。' : `${failingRemoteJobs.length} 个远端作业已经出现交付异常。`}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Runtime Composition</strong>
                <Pill tone={data.config.contextEngine ? 'good' : 'warn'}>
                  {data.config.contextEngine || '未配置'}
                </Pill>
              </div>
              <p>{data.config.modelProvider || '未配置 provider'} / {data.config.modelDefault || '未配置 model'} · Memory {data.config.memoryProvider || 'builtin-file'}</p>
            </section>
          </div>
          <Toolbar>
            <Button onClick={() => void openInFinder(gatewayStatePath, 'gateway_state.json', true)}>定位 gateway_state.json</Button>
            <Button onClick={() => void openInFinder(logsDir, 'logs 目录')}>打开 logs</Button>
            <Button onClick={() => navigate('cron')}>进入 Cron 页</Button>
            <Button onClick={() => navigate('config', configIntent)}>进入配置页</Button>
            <Button onClick={() => navigate('logs', logsIntent)}>进入日志页</Button>
            <Button onClick={() => navigate('diagnostics', diagnosticsIntent)}>进入诊断页</Button>
          </Toolbar>
          {warnings.length > 0 ? (
            <div className="warning-stack">
              {warnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="网关状态稳定" description="当前没有看到明显的网关结构性风险，可以继续看平台细节或远端作业映射。" />
          )}
        </Panel>

        <Panel
          title="网关动作与诊断"
          subtitle="所有动作都直接复用 Hermes CLI，客户端只负责给你一个更顺手的桌面工作流。"
        >
          <div className="workbench-grid">
            <section className="action-card">
              <div className="action-card-header">
                <div>
                  <p className="eyebrow">Control</p>
                  <h3 className="action-card-title">网关控制</h3>
                </div>
                <Pill tone={gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  service
                </Pill>
              </div>
              <p className="action-card-copy">直接调用 `hermes gateway start / restart / stop`，不在客户端里重造控制逻辑。</p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void runAction('start')}
                  disabled={runningCommand !== null}
                >
                  {runningCommand === 'gateway:start' ? '启动中…' : '启动'}
                </Button>
                <Button onClick={() => void runAction('restart')} disabled={runningCommand !== null}>
                  {runningCommand === 'gateway:restart' ? '重启中…' : '重启'}
                </Button>
                <Button
                  kind="danger"
                  onClick={() => void runAction('stop')}
                  disabled={runningCommand !== null}
                >
                  {runningCommand === 'gateway:stop' ? '停止中…' : '停止'}
                </Button>
              </Toolbar>
            </section>

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
                  <Button onClick={() => navigate(item.relatedPage, item.relatedPage === 'logs' ? logsIntent : item.relatedPage === 'config' ? configIntent : undefined)}>进入相关页</Button>
                </Toolbar>
              </section>
            ))}
          </div>
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel title="平台连接" subtitle="按平台看连接状态、最后更新时间和错误信息。">
          {platforms.length ? (
            <div className="list-stack">
              {platforms.map((platform) => (
                <div className="list-card" key={platform.name}>
                  <div className="list-card-title">
                    <strong>{platform.name}</strong>
                    <Pill tone={platformTone(platform.state)}>
                      {platform.state}
                    </Pill>
                  </div>
                  <p>{platform.errorMessage || '当前没有额外错误信息。'}</p>
                  <div className="meta-line">
                    <span>{platform.name}</span>
                    <span>{formatTimestamp(platform.updatedAt)}</span>
                  </div>
                  <Toolbar>
                    <Button
                      onClick={() => navigate('logs', buildLogsDrilldownIntent(relaySeed, {
                        description: `查看平台 ${platform.name} 关联的网关日志。`,
                        logName: 'gateway.error',
                        contains: platform.name,
                        limit: '160',
                      }))}
                    >
                      查看日志
                    </Button>
                    <Button
                      onClick={() => navigate('diagnostics', buildDiagnosticsDrilldownIntent(relaySeed, {
                        description: `围绕平台 ${platform.name} 继续做网关深检。`,
                        suggestedCommand: 'gateway-status-deep',
                        logName: 'gateway.error',
                      }))}
                    >
                      继续诊断
                    </Button>
                  </Toolbar>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无平台状态" description="启动并配置消息平台后，这里会显示各平台连接状态。" />
          )}
        </Panel>

        <Panel title="远端投递作业" subtitle="把依赖 gateway 的 cron 作业拉出来看，更容易判断异常究竟是作业问题还是网关问题。">
          {remoteJobs.length ? (
            <div className="list-stack">
              {remoteJobs.map((job) => (
                <div className="list-card" key={job.id}>
                  <div className="list-card-title">
                    <strong>{job.name}</strong>
                    <div className="pill-row">
                      <Pill tone={cronTone(job)}>{job.state}</Pill>
                      <Pill tone="warn">{job.deliver}</Pill>
                    </div>
                  </div>
                  <p>{job.lastDeliveryError || job.lastError || truncate(job.prompt || '无 prompt', 132)}</p>
                  <div className="meta-line">
                    <span>{job.id}</span>
                    <span>下次 {formatTimestamp(job.nextRunAt)}</span>
                    <span>最近 {formatTimestamp(job.lastRunAt)}</span>
                  </div>
                  <Toolbar>
                    <Button
                      onClick={() => navigate('logs', buildLogsDrilldownIntent(relaySeed, {
                        description: `查看远端作业 ${job.name} 的交付日志。`,
                        logName: job.lastDeliveryError || job.lastError ? 'gateway.error' : 'gateway',
                        contains: job.id,
                        limit: '160',
                      }))}
                    >
                      查看日志
                    </Button>
                    <Button onClick={() => navigate('logs', logsIntent)}>查看网关总日志</Button>
                  </Toolbar>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无远端作业" description="当前 profile 还没有依赖 gateway 的 delivery 作业，或者所有作业都走本地交付。" />
          )}
        </Panel>
      </div>

      <Panel
        title="CLI 诊断输出"
        subtitle="这里保留 Hermes 原生命令结果，方便你对照页面摘要和真实命令输出。"
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
          <EmptyState title="暂无诊断输出" description="点击上方任一网关动作或诊断命令后，这里会展示 Hermes 的原始输出。" />
        )}
      </Panel>
    </div>
  );
}
