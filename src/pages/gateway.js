import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { GATEWAY_DIAGNOSTIC_COMMANDS, getDiagnosticCommand } from '../lib/diagnostics';
import { formatTimestamp, truncate } from '../lib/format';
import {
  consumePageIntent,
  getPageIntent,
  getPanelState,
  loadShell,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import { countConnectedPlatforms, cronTone, hasCronFailure, isRemoteDelivery, platformTone } from '../lib/runtime';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';

let activeView = null;

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">网关控制</h1>
      <p class="page-desc">正在同步 Gateway Service、平台连接和远端投递作业。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:132px"></div>').join('')}
    </div>
  `;
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'gateway',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'gateway',
        headline: '来自 Gateway 的链路下钻',
        description: '继续围绕消息链路、远端投递和网关运行态做排障。',
      };
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.dashboard) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.dashboard || !view.installation) {
    view.page.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">网关控制</h1>
        <p class="page-desc">围绕 Hermes Gateway Service、平台状态与远端投递做编排。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">网关快照目前不可用，可以重试或者回到桌面端窗口继续验证。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 Gateway 快照', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const { dashboard, installation, cronSnapshot } = view;
  const gateway = dashboard.gateway;
  const platforms = gateway?.platforms ?? [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const failingRemoteJobs = remoteJobs.filter(hasCronFailure);
  const unhealthyPlatforms = platforms.filter((platform) => platformTone(platform.state) !== 'good');
  const connectedPlatforms = countConnectedPlatforms(platforms);
  const gatewayRunning = gateway?.gatewayState === 'running';
  const gatewayStatePath = `${dashboard.hermesHome}/gateway_state.json`;
  const logsDir = `${dashboard.hermesHome}/logs`;
  const seed = relaySeed(view);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    description: '查看网关链路相关日志，验证平台连接、交付异常和运行状态。',
    logName: unhealthyPlatforms.length > 0 || failingRemoteJobs.length > 0 ? 'gateway.error' : 'gateway',
    contains:
      view.investigation?.platformName
      || unhealthyPlatforms[0]?.name
      || failingRemoteJobs[0]?.deliver
      || seed.context?.source
      || '',
    limit: '160',
  });
  const warnings = [];

  if (!installation.binaryFound) {
    warnings.push('当前还没有检测到 Hermes CLI，先完成安装后，Gateway Service 和平台配置才能真正闭环。');
  }
  if (gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 当前未运行，消息平台和远端 delivery 链路都还没有真正恢复。');
  }
  if (!installation.gatewayStateExists) {
    warnings.push('还没有看到 gateway_state.json，说明 service 尚未被完整接管或从未成功启动。');
  }
  if (remoteJobs.length > 0 && gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端投递作业依赖 Gateway，但网关当前不可用。`);
  }
  if (unhealthyPlatforms.length > 0) {
    warnings.push(`共有 ${unhealthyPlatforms.length} 个平台连接异常或未就绪：${unhealthyPlatforms.map((item) => item.name).join('、')}。`);
  }

  view.page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">网关控制</h1>
      <p class="page-desc">围绕 Hermes Gateway Service、平台状态、远端投递与诊断链路做集中控制，不额外造守护层。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner">
        <div class="context-banner-header">
          <div class="context-banner-copy">
            <span class="context-banner-label">Session Drilldown</span>
            <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
            <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
          </div>
          <div class="context-banner-meta">
            ${view.investigation.platformName ? pillHtml(view.investigation.platformName, 'warn') : ''}
            ${seed.context?.source ? pillHtml(seed.context.source, 'neutral') : ''}
          </div>
        </div>
        <div class="context-banner-actions toolbar">
          ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
          ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        </div>
      </div>
    ` : ''}

    <div class="stat-cards">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway</span>
          ${statusDotHtml(gatewayRunning ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${gatewayRunning ? '运行中' : '待启动'}</div>
        <div class="stat-card-meta">${gatewayRunning ? `PID ${escapeHtml(gateway?.pid ?? '—')} · ${escapeHtml(gateway?.activeAgents ?? 0)} 个活跃 Agent` : '当前还没有看到运行中的 Gateway 状态。'}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Platforms</span>
          ${statusDotHtml(unhealthyPlatforms.length === 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${platforms.length ? `${connectedPlatforms}/${platforms.length}` : '暂无平台'}</div>
        <div class="stat-card-meta">${unhealthyPlatforms.length === 0 ? '当前没有明显的平台连接异常。' : `异常平台 ${unhealthyPlatforms.length} 个`}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Delivery</span>
          ${statusDotHtml(failingRemoteJobs.length > 0 ? 'warning' : 'running')}
        </div>
        <div class="stat-card-value">${remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '本地优先'}</div>
        <div class="stat-card-meta">${failingRemoteJobs.length > 0 ? `${failingRemoteJobs.length} 个作业已出现交付异常。` : '暂未发现远端投递失败。'}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Context</span>
          ${statusDotHtml(dashboard.config.contextEngine ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(dashboard.config.contextEngine || '未配置')}</div>
        <div class="stat-card-meta">${escapeHtml(`${dashboard.config.modelProvider || 'provider 未配置'} / ${dashboard.config.modelDefault || 'model 未配置'}`)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">State File</span>
          ${statusDotHtml(installation.gatewayStateExists ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${installation.gatewayStateExists ? 'gateway_state.json 已就绪' : '状态文件缺失'}</div>
        <div class="stat-card-meta">${escapeHtml(gatewayStatePath)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Runtime</span>
        </div>
        <div class="stat-card-value">${escapeHtml(gateway?.updatedAt ? formatTimestamp(gateway.updatedAt) : '尚无更新时间')}</div>
        <div class="stat-card-meta">${escapeHtml(`restart_requested ${String(gateway?.restartRequested ?? false)} · logs ${logsDir}`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: gatewayRunning ? '重启 Gateway' : '启动 Gateway', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'gateway-stop', label: '停止 Gateway', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'diagnostic-gateway-status', label: '网关状态', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'diagnostic-gateway-status-deep', label: '网关深检', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', disabled: view.refreshing })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">Gateway Service</h2>
          <p class="config-section-desc">服务接管、启停控制和状态材料收敛到同一区域，避免“能看到但不好操作”。</p>
        </div>
      </div>
      <div class="service-stack">
        <div class="service-card">
          <div class="service-info">
            ${statusDotHtml(gatewayRunning ? 'running' : 'warning')}
            <div>
              <div class="service-name">运行控制</div>
              <div class="service-desc">${gatewayRunning ? `PID ${escapeHtml(gateway?.pid ?? '—')} · ${escapeHtml(gateway?.activeAgents ?? 0)} 个活跃 Agent` : '当前还没有运行中的 Gateway。'}</div>
              <div class="service-desc service-path">${escapeHtml(gatewayStatePath)}</div>
            </div>
          </div>
          <div class="service-actions">
            ${buttonHtml({ action: 'gateway-start', label: '启动', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'gateway-restart', label: '重启', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'gateway-stop', label: '停止', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'open-gateway-state', label: '定位状态文件', disabled: Boolean(view.runningAction) || !installation.gatewayStateExists })}
          </div>
        </div>
        <div class="service-card">
          <div class="service-info">
            ${statusDotHtml(installation.gatewayStateExists ? 'running' : 'warning')}
            <div>
              <div class="service-name">Service 接管</div>
              <div class="service-desc">保持 Hermes 原生 service install / setup / uninstall，不在客户端里重造 service 生命周期。</div>
              <div class="service-desc service-path">${escapeHtml(installation.gatewayInstallCommand)}</div>
            </div>
          </div>
          <div class="service-actions">
            ${buttonHtml({ action: 'gateway-install', label: '安装 Service', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'gateway-setup', label: 'Gateway Setup', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'gateway-uninstall', label: '卸载 Service', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            ${buttonHtml({ action: 'open-logs', label: '打开 Logs', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
          </div>
        </div>
      </div>
    </section>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">平台连接</h2>
            <p class="config-section-desc">按平台查看连接状态、最后更新时间和错误信息，优先定位到底是 Gateway 还是平台本身异常。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-config', label: '核对配置' })}
            ${buttonHtml({ action: 'goto-extensions', label: '核对扩展' })}
          </div>
        </div>
        ${
          platforms.length
            ? `
              <div class="service-stack">
                ${platforms.map((platform) => `
                  <div class="service-card">
                    <div class="service-info">
                      ${statusDotHtml(platformTone(platform.state) === 'good' ? 'running' : platformTone(platform.state) === 'bad' ? 'stopped' : 'warning')}
                      <div>
                        <div class="service-name">${escapeHtml(platform.name)}</div>
                        <div class="service-desc">${escapeHtml(platform.errorMessage || '当前没有额外错误信息。')}</div>
                        <div class="service-desc service-path">${escapeHtml(formatTimestamp(platform.updatedAt))}</div>
                      </div>
                    </div>
                    <div class="service-actions">
                      ${buttonHtml({ action: 'platform-logs', label: '查看日志', attrs: { 'data-platform': platform.name } })}
                      ${buttonHtml({ action: 'platform-diagnostics', label: '继续诊断', attrs: { 'data-platform': platform.name } })}
                    </div>
                  </div>
                `).join('')}
              </div>
            `
            : emptyStateHtml('暂无平台状态', '启动并配置消息平台后，这里会显示各平台连接状态。')
        }
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">远端投递作业</h2>
            <p class="config-section-desc">把依赖 Gateway 的 Cron 作业拉出来看，更容易判断问题究竟在作业、交付还是 Gateway 本身。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-cron', label: '进入 Cron 页' })}
            ${buttonHtml({ action: 'goto-logs', label: '查看网关日志' })}
          </div>
        </div>
        ${
          remoteJobs.length
            ? `
              <div class="service-stack">
                ${remoteJobs.map((job) => `
                  <div class="service-card">
                    <div class="service-info">
                      ${statusDotHtml(cronTone(job) === 'good' ? 'running' : cronTone(job) === 'bad' ? 'stopped' : 'warning')}
                      <div>
                        <div class="service-name">${escapeHtml(job.name)}</div>
                        <div class="service-desc">${escapeHtml(job.lastDeliveryError || job.lastError || truncate(job.prompt || '无 prompt', 132))}</div>
                        <div class="service-desc service-path">${escapeHtml(`${job.id} · 下次 ${formatTimestamp(job.nextRunAt)} · 最近 ${formatTimestamp(job.lastRunAt)}`)}</div>
                      </div>
                    </div>
                    <div class="service-actions">
                      ${pillHtml(job.deliver, 'warn')}
                      ${buttonHtml({ action: 'job-logs', label: '查看日志', attrs: { 'data-job': job.id, 'data-deliver': job.deliver } })}
                    </div>
                  </div>
                `).join('')}
              </div>
            `
            : emptyStateHtml('暂无远端作业', '当前 profile 还没有依赖 Gateway 的 delivery 作业，或者所有作业都走本地交付。')
        }
      </section>
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">CLI 诊断工作台</h2>
          <p class="config-section-desc">只保留原生命令链路，服务启停和材料入口已经收敛到页面顶部，不在这里重复露出。</p>
        </div>
      </div>
      <div class="health-grid">
        ${GATEWAY_DIAGNOSTIC_COMMANDS.map((item) => `
          <section class="action-card">
            <div class="action-card-header">
              <div>
                <p class="eyebrow">CLI</p>
                <h3 class="action-card-title">${escapeHtml(item.label)}</h3>
              </div>
              ${pillHtml(item.key, item.kind === 'primary' ? 'good' : item.key.includes('deep') ? 'warn' : 'neutral')}
            </div>
            <p class="action-card-copy">${escapeHtml(item.description)}</p>
            <p class="command-line">${escapeHtml(item.cli)}</p>
            <div class="toolbar">
              ${buttonHtml({ action: `diagnostic-${item.key}`, label: `执行${item.label}`, kind: item.kind, disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'goto-related-page', label: '进入相关页', attrs: { 'data-page': item.relatedPage } })}
            </div>
          </section>
        `).join('')}
      </div>
    </section>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">CLI 原始输出</h2>
            <p class="config-section-desc">保留 Hermes 原生命令结果，方便你对照页面摘要和真实命令输出。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '暂无诊断输出', '点击上方任一网关动作或诊断命令后，这里会展示 Hermes 的原始输出。')}
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">链路材料</h2>
            <p class="config-section-desc">状态文件、日志、配置和风险提示放在一起，方便围绕同一条链路继续排查。</p>
          </div>
        </div>
        <div class="service-stack">
          <div class="service-card">
            <div class="service-info">
              ${statusDotHtml(installation.gatewayStateExists ? 'running' : 'warning')}
              <div>
                <div class="service-name">状态文件</div>
                <div class="service-desc">${installation.gatewayStateExists ? 'gateway_state.json 已生成' : '当前还没有看到状态文件'}</div>
                <div class="service-desc service-path">${escapeHtml(gatewayStatePath)}</div>
              </div>
            </div>
            <div class="service-actions">
              ${buttonHtml({ action: 'open-gateway-state', label: '定位状态文件', disabled: Boolean(view.runningAction) || !installation.gatewayStateExists })}
            </div>
          </div>
          <div class="service-card">
            <div class="service-info">
              ${statusDotHtml(installation.logsDirExists ? 'running' : 'warning')}
              <div>
                <div class="service-name">日志目录</div>
                <div class="service-desc">优先查看 Gateway 与 gateway.error 的差异，再决定是否回到配置或扩展层排查。</div>
                <div class="service-desc service-path">${escapeHtml(logsDir)}</div>
              </div>
            </div>
            <div class="service-actions">
              ${buttonHtml({ action: 'open-logs', label: '打开日志目录', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
              ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
            </div>
          </div>
        </div>
        ${warnings.length > 0 ? `
          <div class="warning-stack top-gap">
            ${warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
          </div>
        ` : emptyStateHtml('当前无明显结构性风险', '网关、平台和远端作业目前没有看到明显结构性风险，可以继续深挖具体日志。')}
      </section>
    </div>
  `;

  bindEvents(view);
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.dashboard && view.installation);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [dashboard, installation, cronSnapshot] = await Promise.all([
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getCronJobs(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.dashboard = dashboard;
    view.installation = installation;
    view.cronSnapshot = cronSnapshot;
  } catch (reason) {
    if (view.destroyed) {
      return;
    }
    view.error = String(reason);
    if (hasData && !silent) {
      notify('error', view.error);
    }
  } finally {
    view.loading = false;
    view.refreshing = false;
    renderPage(view);
  }
}

async function runGatewayAction(view, action, label) {
  view.runningAction = `gateway:${action}`;
  renderPage(view);
  try {
    const result = await api.runGatewayAction(action, view.profile);
    view.lastResult = { label, result };
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function runDiagnostic(view, kind, options = {}) {
  const { silent = false, refresh = true } = options;
  view.runningAction = `diagnostic:${kind}`;
  renderPage(view);
  try {
    const result = await api.runDiagnostic(kind, view.profile);
    view.lastResult = { label: getDiagnosticCommand(kind)?.label || kind, result };
    if (!silent) {
      notify(result.success ? 'success' : 'error', `${getDiagnosticCommand(kind)?.label || kind} 已执行。`);
    }
    if (refresh) {
      await Promise.all([
        loadShell(view.profile, { silent: true }),
        loadData(view, { silent: true }),
      ]);
    }
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function runTerminalAction(view, actionKey, label, command, options = {}) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage: options.confirmMessage,
      label,
      notify,
      onResult: (nextLabel, result) => {
        view.lastResult = { label: nextLabel, result };
      },
      profile: view.profile,
      setBusy: (value) => {
        view.runningAction = value;
        renderPage(view);
      },
      workingDirectory: options.workingDirectory ?? (view.installation?.hermesHomeExists ? view.installation.hermesHome : null),
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function runFinderAction(view, actionKey, label, path, revealInFinder = false) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    await openFinderLocation({
      actionKey,
      label,
      notify,
      onResult: (nextLabel, result) => {
        view.lastResult = { label: nextLabel, result };
      },
      path,
      revealInFinder,
      setBusy: (value) => {
        view.runningAction = value;
        renderPage(view);
      },
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncWithPanelState(view) {
  const shell = getPanelState();

  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.dashboard = null;
    view.installation = null;
    view.cronSnapshot = null;
    view.error = null;
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('gateway');
  if (nextIntent) {
    view.investigation = nextIntent;
    consumePageIntent();
    renderPage(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindEvents(view) {
  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'refresh') {
        await loadData(view, { silent: true });
        return;
      }

      if (!view.installation) {
        return;
      }

      switch (action) {
        case 'gateway-start':
          await runGatewayAction(view, 'start', '启动 Gateway');
          return;
        case 'gateway-restart':
          await runGatewayAction(view, 'restart', '重启 Gateway');
          return;
        case 'gateway-stop':
          await runGatewayAction(view, 'stop', '停止 Gateway');
          return;
        case 'gateway-install':
          await runTerminalAction(view, 'gateway:install', '安装 Gateway Service', view.installation.gatewayInstallCommand);
          return;
        case 'gateway-setup':
          await runTerminalAction(view, 'gateway:setup', 'Gateway Setup', view.installation.gatewaySetupCommand);
          return;
        case 'gateway-uninstall':
          await runTerminalAction(view, 'gateway:uninstall', '卸载 Gateway Service', view.installation.gatewayUninstallCommand, {
            confirmMessage: '确定卸载当前 profile 的 Gateway Service 吗？',
          });
          return;
        case 'open-gateway-state':
          await runFinderAction(view, 'finder:gateway-state', '定位状态文件', `${view.dashboard.hermesHome}/gateway_state.json`, true);
          return;
        case 'open-logs':
          await runFinderAction(view, 'finder:gateway-logs', '打开日志目录', `${view.dashboard.hermesHome}/logs`, false);
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'goto-logs':
          navigate('logs', buildLogsDrilldownIntent(relaySeed(view), {
            logName: view.dashboard.gateway?.gatewayState === 'running' ? 'gateway' : 'gateway.error',
            limit: '160',
          }));
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', buildDiagnosticsDrilldownIntent(relaySeed(view), {
            suggestedCommand: view.dashboard.gateway?.gatewayState === 'running' ? 'gateway-status' : 'gateway-status-deep',
            logName: 'gateway.error',
          }));
          return;
        case 'goto-config':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            focus: 'context',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-extensions':
          navigate('extensions', buildExtensionsDrilldownIntent(relaySeed(view), {
            rawKind: 'tools',
          }));
          return;
        case 'goto-cron':
          navigate('cron');
          return;
        case 'goto-related-page':
          navigate(element.getAttribute('data-page'));
          return;
        case 'platform-logs': {
          const platformName = element.getAttribute('data-platform') || '';
          navigate('logs', buildLogsDrilldownIntent(relaySeed(view), {
            description: `查看平台 ${platformName} 关联的网关日志。`,
            logName: 'gateway.error',
            contains: platformName,
            limit: '160',
          }));
          return;
        }
        case 'platform-diagnostics': {
          const platformName = element.getAttribute('data-platform') || '';
          navigate('diagnostics', buildDiagnosticsDrilldownIntent(relaySeed(view), {
            description: `围绕平台 ${platformName} 继续做网关深检。`,
            suggestedCommand: 'gateway-status-deep',
            logName: 'gateway.error',
          }));
          return;
        }
        case 'job-logs': {
          const jobId = element.getAttribute('data-job') || '';
          const deliver = element.getAttribute('data-deliver') || '';
          navigate('logs', buildLogsDrilldownIntent(relaySeed(view), {
            description: `查看远端作业 ${jobId} 的交付日志。`,
            logName: 'gateway.error',
            contains: jobId || deliver,
            limit: '160',
          }));
          return;
        }
        default:
          if (action.startsWith('diagnostic-')) {
            await runDiagnostic(view, action.replace('diagnostic-', ''));
          }
      }
    };
  });
}

export async function render() {
  cleanup();

  const page = document.createElement('div');
  page.className = 'page';

  activeView = {
    cronSnapshot: null,
    dashboard: null,
    destroyed: false,
    error: null,
    installation: null,
    investigation: getPageIntent('gateway'),
    lastResult: null,
    loading: true,
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    unsubscribe: null,
  };

  if (activeView.investigation) {
    consumePageIntent();
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView);
  if (activeView.installation?.binaryFound) {
    await runDiagnostic(activeView, 'gateway-status', { silent: true, refresh: false });
  }
  return page;
}

export function cleanup() {
  if (!activeView) {
    return;
  }

  activeView.destroyed = true;
  activeView.unsubscribe?.();
  activeView = null;
}
