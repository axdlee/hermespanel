import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { getDiagnosticCommand } from '../lib/diagnostics';
import {
  consumePageIntent,
  getPageIntent,
  getPanelState,
  loadShell,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import { countConnectedPlatforms, hasCronFailure, isRemoteDelivery, platformTone } from '../lib/runtime';
import {
  buttonHtml,
  emptyStateHtml,
  escapeHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';
import {
  channelReadiness,
  cloneEnvWorkspace,
  cloneGatewayWorkspace,
  countConfiguredPlatformDrafts,
  envWorkspaceDirty,
  gatewayWorkspaceDirty,
  parseOptionalNumber,
  PLATFORM_WORKSPACE_PRESETS,
  relaySeed,
  renderControlWorkspace,
  renderDiagnosticsWorkspace,
  renderGatewayRail,
  renderGatewayTabs,
  renderJobsWorkspace,
  renderPlatformsWorkspace,
  renderRuntimeWorkspace,
  splitLineValues,
} from './gateway-workbench';
import { infoTipHtml } from './workbench-helpers';

let activeView = null;

function launcherCardHtml({ action, kicker, title, meta, tone = 'neutral', attrs = {} }) {
  const attrString = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(' ');

  return `
    <button
      type="button"
      class="dashboard-jump-card dashboard-jump-card-${tone}"
      data-action="${escapeHtml(action)}"
      ${attrString}
    >
      <span class="dashboard-jump-kicker">${escapeHtml(kicker)}</span>
      <strong class="dashboard-jump-title">${escapeHtml(title)}</strong>
      <span class="dashboard-jump-meta">${escapeHtml(meta)}</span>
    </button>
  `;
}

function surfaceTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-gateway-surface="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function subviewTabHtml(attrName, activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" ${attrName}="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function platformFocusIdFromName(platformName) {
  const normalized = String(platformName || '').trim().toLowerCase();
  return PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === normalized || item.runtimeName === normalized)?.id || null;
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">Gateway</h1>
      </div>
      <p class="page-desc">正在同步 Service 与平台链路。</p>
    </div>
    <div class="stat-cards stat-cards-4">
      ${Array.from({ length: 4 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:118px"></div>').join('')}
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.dashboard) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.dashboard || !view.installation || !view.config) {
    view.page.innerHTML = `
      <div class="page-header page-header-compact">
        <div class="panel-title-row">
          <h1 class="page-title">Gateway</h1>
          ${infoTipHtml('Gateway 页需要同时读取运行快照和结构化配置；只要有一端异常，就先在这里暴露出来。')}
        </div>
        <p class="page-desc">Service、平台和策略没有完整读出来，先处理读取错误。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">网关快照或结构化配置当前不可用，可以重试或继续看桌面端日志。</p>
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

  const { dashboard, installation, cronSnapshot, config } = view;
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
  const envDraft = view.envDraft ?? cloneEnvWorkspace(config.envWorkspace);
  const workbenchMain = view.workspaceTab === 'control'
    ? renderControlWorkspace(view, {
      config,
      gateway,
      gatewayRunning,
      installation,
      remoteJobs,
      unhealthyPlatforms,
    })
    : view.workspaceTab === 'platforms'
      ? renderPlatformsWorkspace(view, {
        connectedPlatforms,
        gatewayRunning,
        installation,
        platforms,
        unhealthyPlatforms,
      })
      : view.workspaceTab === 'jobs'
        ? renderJobsWorkspace(remoteJobs)
        : view.workspaceTab === 'diagnostics'
          ? renderDiagnosticsWorkspace(view, installation)
          : renderRuntimeWorkspace(view);
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
  const gatewayDraft = view.gatewayDraft ?? cloneGatewayWorkspace(config.gatewayWorkspace);
  const gatewayDirty = gatewayWorkspaceDirty(view);
  const envDirty = envWorkspaceDirty(view);
  const workspaceDirty = gatewayDirty || envDirty;
  const configuredPlatforms = countConfiguredPlatformDrafts(envDraft);

  if (!installation.binaryFound) {
    warnings.push('当前还没有检测到 Hermes 可执行组件，Service 动作会被禁用，但结构化配置仍然可以继续保存。');
  }
  if (!gatewayDraft.hermesGatewayToken.trim()) {
    warnings.push('当前没有写入 HERMES_GATEWAY_TOKEN，外部网关鉴权链路还不完整。');
  }
  if (gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 当前未运行，消息平台和远端交付链路都还没有真正恢复。');
  }
  if (!installation.gatewayStateExists) {
    warnings.push('还没有看到 gateway_state.json，说明 service 尚未被完整接管或从未成功启动。');
  }
  if (remoteJobs.length > 0 && gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端作业依赖 Gateway，但网关当前不可用。`);
  }
  if (unhealthyPlatforms.length > 0) {
    warnings.push(`共有 ${unhealthyPlatforms.length} 个平台连接异常或未就绪：${unhealthyPlatforms.map((item) => item.name).join('、')}。`);
  }
  if (configuredPlatforms === 0) {
    warnings.push('当前还没有配置任何消息通道，Gateway 启动后也不会接到外部消息。');
  }
  if (gatewayDirty) {
    warnings.push('策略草稿还未保存，建议先保存。');
  }
  if (envDirty) {
    warnings.push('通道草稿还未保存。');
  }

  const surfaceView = view.surfaceView || 'focus';
  const focusSection = view.focusSection || 'status';
  const nextStep = !gatewayDraft.hermesGatewayToken.trim()
    ? {
      title: '补网关钥匙',
      detail: '先写入 Gateway Token，再做启动和闭环验证。',
    }
    : configuredPlatforms === 0
      ? {
        title: '接消息平台',
        detail: '至少接入一个消息入口，否则 Gateway 跑起来也接不到消息。',
      }
      : workspaceDirty
        ? {
          title: '先保存草稿',
          detail: '当前有未保存改动，先保存后再启动或排障会更稳妥。',
        }
        : !gatewayRunning
          ? {
            title: '启动验证',
            detail: '配置已基本齐备，接下来启动 Gateway。',
          }
          : warnings.length > 0
            ? {
              title: '处理提醒',
              detail: warnings[0],
            }
            : {
              title: '按需细调',
              detail: '当前主链路基本稳定。',
            };
  const focusSectionMeta = focusSection === 'actions'
    ? { title: '快捷入口', desc: '常用去向。', pill: '入口' }
    : focusSection === 'details'
      ? { title: '补充信息', desc: '查看目录和补充状态。', pill: '信息' }
      : { title: '当前摘要', desc: '先看 Gateway 状态。', pill: '摘要' };
  const focusSectionContent = focusSection === 'actions'
    ? `
      <div class="dashboard-jump-grid">
        ${launcherCardHtml({
          action: 'open-gateway-workbench',
          attrs: { 'data-tab': 'control' },
          kicker: '策略',
          title: gatewayDraft.hermesGatewayToken.trim() ? '细调会话策略' : '补网关钥匙',
          meta: gatewayDraft.hermesGatewayToken.trim()
            ? `${gatewayDraft.sessionResetMode} · ${gatewayDraft.unauthorizedDmBehavior}`
            : '没写 Token 就还不能完整接管 Gateway',
          tone: gatewayDraft.hermesGatewayToken.trim() ? 'good' : 'warn',
        })}
        ${launcherCardHtml({
          action: 'open-gateway-workbench',
          attrs: { 'data-tab': 'platforms' },
          kicker: '平台',
          title: configuredPlatforms === 0 ? '接消息平台' : '检查消息入口',
          meta: configuredPlatforms === 0
            ? '至少接一个入口再做闭环验证'
            : `${connectedPlatforms}/${platforms.length || 0} 已连通`,
          tone: configuredPlatforms === 0 || unhealthyPlatforms.length > 0 ? 'warn' : 'good',
        })}
        ${launcherCardHtml({
          action: 'open-gateway-workbench',
          attrs: { 'data-tab': 'jobs' },
          kicker: '投递',
          title: remoteJobs.length > 0 ? '检查远端投递' : '查看投递策略',
          meta: remoteJobs.length > 0 ? `${remoteJobs.length} 个作业依赖 Gateway` : '当前以本地处理为主',
          tone: failingRemoteJobs.length > 0 ? 'warn' : 'neutral',
        })}
        ${launcherCardHtml({
          action: 'goto-logs',
          kicker: '排查',
          title: warnings.length > 0 ? '去排查提醒' : '看日志和诊断',
          meta: warnings[0] || '查看日志或诊断原始输出',
          tone: warnings.length > 0 ? 'warn' : 'neutral',
        })}
      </div>
    `
    : focusSection === 'details'
      ? `
        ${warnings.length > 0
          ? `<div class="warning-stack">${warnings.slice(0, 3).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
          : ''}
        <div class="detail-list compact ${warnings.length > 0 ? 'top-gap' : ''}">
          ${[
            { label: '状态文件', value: installation.gatewayStateExists ? '已生成' : '还没生成' },
            { label: '日志目录', value: installation.logsDirExists ? '已就绪' : '还没看到日志目录' },
            { label: '远端投递', value: remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '当前没有远端作业' },
            { label: '待保存改动', value: workspaceDirty ? '有未保存草稿' : '当前已同步' },
          ].map((item) => `
            <div class="key-value-row">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join('')}
        </div>
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'open-gateway-workbench', label: '打开管理', attrs: { 'data-tab': 'control' } })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '诊断' })}
        </div>
      `
      : `
        <div class="detail-list compact">
          ${[
            { label: '网关状态', value: gatewayRunning ? '已经接管' : '还没接管' },
            { label: '消息入口', value: configuredPlatforms === 0 ? '还没有接入口' : `${connectedPlatforms}/${platforms.length || 0} 已连通` },
            { label: '当前提醒', value: warnings[0] || '暂时没有新的阻塞提醒' },
            { label: '下一步', value: nextStep.title },
          ].map((item) => `
            <div class="key-value-row">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join('')}
        </div>
      `;
  const focusShell = `
    <div class="dashboard-focus-shell dashboard-focus-shell-single">
      <section class="dashboard-focus-card dashboard-focus-card-${gatewayRunning && warnings.length === 0 ? 'good' : 'warn'}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${gatewayRunning ? '已接管' : '待接管'}</span>
            <h2 class="dashboard-focus-title">${gatewayRunning ? 'Gateway 已经跑起来了' : '先让 Gateway 真正跑起来'}</h2>
            <p class="dashboard-focus-desc">${gatewayRunning ? '当前可以继续验证平台接入和投递链路。' : '先补网关钥匙、消息入口和策略，再启动服务。'}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(gatewayRunning ? 'Gateway 运行中' : 'Gateway 待启动', gatewayRunning ? 'good' : 'warn')}
            ${pillHtml(configuredPlatforms === 0 ? '还没接消息入口' : `${connectedPlatforms}/${platforms.length || 0} 入口已连`, connectedPlatforms > 0 ? 'good' : 'warn')}
            ${pillHtml(warnings.length > 0 ? `${warnings.length} 条提醒` : '状态正常', warnings.length > 0 ? 'warn' : 'good')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">网关</span>
            <strong class="dashboard-signal-value">${escapeHtml(gatewayRunning ? '已经接管' : '还没接管')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(gatewayRunning ? '现在可以继续验证平台接入和投递链路。' : '先补配置，再启动服务做一次真实验证。')}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">消息入口</span>
            <strong class="dashboard-signal-value">${escapeHtml(configuredPlatforms === 0 ? '还没接入口' : `${connectedPlatforms}/${platforms.length || 0} 已连通`)}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(unhealthyPlatforms.length === 0 ? '当前没有明显的平台连接异常。' : `还有 ${unhealthyPlatforms.length} 个入口异常或未就绪。`)}</span>
          </section>
                          <section class="dashboard-signal-card">
                            <span class="dashboard-signal-label">下一步</span>
                            <strong class="dashboard-signal-value">${escapeHtml(nextStep.title)}</strong>
                            <span class="dashboard-signal-meta">${escapeHtml(nextStep.detail)}</span>
                          </section>
        </div>
        <div class="dashboard-focus-actions">
          ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: gatewayRunning ? '重启 Gateway' : '启动 Gateway', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'open-gateway-workbench', label: '打开管理', attrs: { 'data-tab': 'control' } })}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', disabled: Boolean(view.refreshing || view.savingGateway || view.savingEnv) })}
        </div>
      </section>
    </div>
  `;

  const focusContent = `
    ${focusShell}
    <section class="config-section dashboard-quiet-card">
      <div class="workspace-main-header">
        <div>
          <strong>${escapeHtml(focusSectionMeta.title)}</strong>
          <p class="workspace-main-copy">${escapeHtml(focusSectionMeta.desc)}</p>
        </div>
        ${pillHtml(focusSectionMeta.pill, 'neutral')}
      </div>
      <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
        ${subviewTabHtml('data-gateway-focus-section', focusSection, 'status', '状态')}
        ${subviewTabHtml('data-gateway-focus-section', focusSection, 'actions', '去处理')}
        ${subviewTabHtml('data-gateway-focus-section', focusSection, 'details', '更多')}
      </div>
      <div class="top-gap">
        ${focusSectionContent}
      </div>
    </section>
  `;

  const workspaceContent = `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">Gateway 管理</h2>
          </div>
          <p class="config-section-desc">策略、平台、投递和运行验证。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workspaceTab, 'neutral')}
          ${warnings.length > 0 ? pillHtml(`${warnings.length} 条提醒`, 'warn') : pillHtml('状态正常', 'good')}
        </div>
      </div>
      ${renderGatewayTabs(view)}
      <div class="workspace-shell workspace-shell-dense">
        <aside class="workspace-rail">
          ${renderGatewayRail(view, {
            connectedPlatforms,
            config,
            failingRemoteJobs,
            gateway,
            gatewayStatePath,
            installation,
            logsDir,
            remoteJobs,
            unhealthyPlatforms,
            warnings,
          })}
        </aside>
        <div class="workspace-main-card">
          ${workbenchMain}
        </div>
      </div>
    </section>
  `;

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">Gateway</h1>
      </div>
      <p class="page-desc">Service、会话策略、平台链路。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner context-banner-compact">
        <div class="context-banner-header">
          <div class="context-banner-copy">
            <span class="context-banner-label">联动上下文</span>
            <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
            <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
          </div>
          <div class="context-banner-meta">
            ${view.investigation.platformName ? pillHtml(view.investigation.platformName, 'warn') : ''}
            ${seed.context?.source ? pillHtml(seed.context.source, 'neutral') : ''}
          </div>
        </div>
        <div class="context-banner-actions toolbar">
          ${buttonHtml({ action: 'clear-investigation', label: '清除' })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '诊断' })}
        </div>
      </div>
    ` : ''}

    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(surfaceView, 'focus', '概览')}
      ${surfaceTabHtml(surfaceView, 'workspace', '管理')}
    </div>

    ${surfaceView === 'focus' ? focusContent : workspaceContent}
  `;

  bindEvents(view, logsIntent);
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.dashboard && view.installation && view.config);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [dashboard, installation, config, cronSnapshot] = await Promise.all([
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getConfigDocuments(profile),
      api.getCronJobs(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.dashboard = dashboard;
    view.installation = installation;
    view.config = config;
    view.cronSnapshot = cronSnapshot;
    view.gatewayDraft = cloneGatewayWorkspace(config.gatewayWorkspace);
    view.envDraft = cloneEnvWorkspace(config.envWorkspace);
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

async function saveGatewayWorkspace(view, options = {}) {
  const { restart = false } = options;
  if (!view.gatewayDraft) {
    return;
  }

  view.savingGateway = true;
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredGateway(view.gatewayDraft, view.profile);
    notify('success', 'Gateway 策略已保存到 config.yaml 和 .env。');
    view.config = nextConfig;
    view.gatewayDraft = cloneGatewayWorkspace(nextConfig.gatewayWorkspace);

    if (restart) {
      if (!view.installation?.binaryFound) {
        notify('info', '已保存 Gateway 策略，但当前未检测到 Hermes 可执行组件，暂未执行 Gateway 重启。');
      } else {
        const gatewayRunning = view.dashboard?.gateway?.gatewayState === 'running';
        const action = gatewayRunning ? 'restart' : 'start';
        const label = gatewayRunning ? '重启 Gateway' : '启动 Gateway';
        const result = await api.runGatewayAction(action, view.profile);
        view.lastResult = { label, result };
        notify(result.success ? 'success' : 'error', `${label} 已执行。`);
      }
    }

    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.savingGateway = false;
    renderPage(view);
  }
}

async function saveEnvWorkspace(view, options = {}) {
  const { restart = false } = options;
  if (!view.envDraft) {
    return;
  }

  view.savingEnv = restart ? 'restart' : 'save';
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredEnv(view.envDraft, view.profile);
    view.config = nextConfig;
    view.gatewayDraft = cloneGatewayWorkspace(nextConfig.gatewayWorkspace);
    view.envDraft = cloneEnvWorkspace(nextConfig.envWorkspace);
    notify('success', '通道配置已保存到 .env。');

    if (restart) {
      if (!view.installation?.binaryFound) {
        notify('info', '已保存通道配置，但当前未检测到 Hermes 可执行组件，暂未执行 Gateway 重启。');
      } else {
        const gatewayRunning = view.dashboard?.gateway?.gatewayState === 'running';
        const action = gatewayRunning ? 'restart' : 'start';
        const label = gatewayRunning ? '重启 Gateway' : '启动 Gateway';
        const result = await api.runGatewayAction(action, view.profile);
        view.lastResult = { label, result };
        notify(result.success ? 'success' : 'error', `${label} 已执行。`);
      }
    }

    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.savingEnv = null;
    renderPage(view);
  }
}

function applyPlatformPreset(view, platformId) {
  const preset = PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === platformId);
  if (!preset || !view.envDraft) {
    return;
  }

  if (preset.modeKey && !channelReadiness(view.envDraft[preset.modeKey])) {
    view.envDraft[preset.modeKey] = preset.modeDefault || 'reply';
  }
  if (preset.toggleKey) {
    view.envDraft[preset.toggleKey] = true;
  }
}

function clearPlatformDraft(view, platformId) {
  const preset = PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === platformId);
  if (!preset || !view.envDraft) {
    return;
  }

  [preset.tokenKey, preset.channelKey, preset.modeKey]
    .filter(Boolean)
    .forEach((key) => {
      view.envDraft[key] = '';
    });
  if (preset.toggleKey) {
    view.envDraft[preset.toggleKey] = false;
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
    view.config = null;
    view.cronSnapshot = null;
    view.gatewayDraft = cloneGatewayWorkspace();
    view.envDraft = cloneEnvWorkspace();
    view.activePlatformFocus = null;
    view.error = null;
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('gateway');
  if (nextIntent) {
    view.investigation = nextIntent;
    view.surfaceView = 'workspace';
    view.workspaceTab = nextIntent.platformName ? 'platforms' : 'control';
    view.activePlatformFocus = nextIntent.platformName ? platformFocusIdFromName(nextIntent.platformName) : null;
    consumePageIntent();
    renderPage(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindGatewayInputs(view) {
  if (!view.gatewayDraft) {
    return;
  }

  const stringInputs = [
    ['#gateway-token', 'hermesGatewayToken'],
  ];
  stringInputs.forEach(([selector, key]) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.oninput = (event) => {
      view.gatewayDraft[key] = event.target.value;
    };
  });

  const numberInputs = [
    ['#gateway-reset-hour', 'sessionResetAtHour'],
    ['#gateway-reset-idle', 'sessionResetIdleMinutes'],
  ];
  numberInputs.forEach(([selector, key]) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.oninput = (event) => {
      view.gatewayDraft[key] = parseOptionalNumber(event.target.value);
    };
  });

  const resetTriggers = view.page.querySelector('#gateway-reset-triggers');
  if (resetTriggers) {
    resetTriggers.oninput = (event) => {
      view.gatewayDraft.resetTriggers = splitLineValues(event.target.value);
    };
  }

  const checkboxInputs = [
    ['#gateway-always-log-local', 'alwaysLogLocal'],
    ['#gateway-stt-enabled', 'sttEnabled'],
    ['#gateway-group-sessions', 'groupSessionsPerUser'],
    ['#gateway-thread-sessions', 'threadSessionsPerUser'],
    ['#gateway-reset-notify', 'sessionResetNotify'],
  ];
  checkboxInputs.forEach(([selector, key]) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.onchange = (event) => {
      view.gatewayDraft[key] = event.target.checked;
    };
  });
}

function bindPlatformInputs(view) {
  if (!view.envDraft) {
    return;
  }

  const bindValue = (selector, key) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.oninput = (event) => {
      view.envDraft[key] = event.target.value;
    };
  };

  const bindCheckbox = (selector, key) => {
    const element = view.page.querySelector(selector);
    if (!element) {
      return;
    }
    element.onchange = (event) => {
      view.envDraft[key] = event.target.checked;
    };
  };

  bindValue('#platform-telegram-token', 'telegramBotToken');
  bindValue('#platform-telegram-channel', 'telegramHomeChannel');
  bindValue('#platform-telegram-mode', 'telegramReplyToMode');
  bindValue('#platform-discord-token', 'discordBotToken');
  bindValue('#platform-discord-channel', 'discordHomeChannel');
  bindValue('#platform-discord-mode', 'discordReplyToMode');
  bindValue('#platform-slack-token', 'slackBotToken');
  bindCheckbox('#platform-whatsapp-enabled', 'whatsappEnabled');
}

function bindEvents(view, logsIntent) {
  bindGatewayInputs(view);
  bindPlatformInputs(view);

  view.page.querySelectorAll('[data-gateway-surface]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-gateway-surface');
      if (!nextView || nextView === view.surfaceView) {
        return;
      }
      view.surfaceView = nextView;
      renderPage(view);
    };
  });

  view.page.querySelectorAll('[data-gateway-focus-section]').forEach((element) => {
    element.onclick = () => {
      const nextSection = element.getAttribute('data-gateway-focus-section');
      if (!nextSection || nextSection === view.focusSection) {
        return;
      }
      view.focusSection = nextSection;
      renderPage(view);
    };
  });

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

      switch (action) {
        case 'toggle-service-actions':
          view.showServiceActions = !view.showServiceActions;
          renderPage(view);
          return;
        case 'open-gateway-workbench':
          view.surfaceView = 'workspace';
          view.workspaceTab = element.getAttribute('data-tab') || 'control';
          if (view.workspaceTab === 'control' && !view.gatewayPolicySection) {
            view.gatewayPolicySection = 'reset';
          }
          renderPage(view);
          return;
        case 'switch-workspace-tab':
          view.surfaceView = 'workspace';
          view.workspaceTab = element.getAttribute('data-tab') || 'control';
          if (view.workspaceTab === 'control' && !view.gatewayPolicySection) {
            view.gatewayPolicySection = 'reset';
          }
          renderPage(view);
          return;
        case 'focus-gateway-policy':
          view.surfaceView = 'workspace';
          view.workspaceTab = 'control';
          view.gatewayPolicySection = element.getAttribute('data-section') || 'reset';
          renderPage(view);
          return;
        case 'focus-platform-card':
          view.surfaceView = 'workspace';
          view.workspaceTab = 'platforms';
          view.activePlatformFocus = element.getAttribute('data-platform') || null;
          renderPage(view);
          return;
        case 'save-gateway-workspace':
          await saveGatewayWorkspace(view);
          return;
        case 'save-gateway-workspace-restart':
          await saveGatewayWorkspace(view, { restart: true });
          return;
        case 'save-env-workspace':
          await saveEnvWorkspace(view);
          return;
        case 'save-env-workspace-restart':
          await saveEnvWorkspace(view, { restart: true });
          return;
        case 'reset-env-workspace':
          view.envDraft = cloneEnvWorkspace(view.config?.envWorkspace);
          renderPage(view);
          return;
        case 'set-reset-mode':
          view.gatewayDraft.sessionResetMode = element.getAttribute('data-value') || 'both';
          renderPage(view);
          return;
        case 'set-dm-behavior':
          view.gatewayDraft.unauthorizedDmBehavior = element.getAttribute('data-value') || 'pair';
          renderPage(view);
          return;
        case 'apply-platform-preset':
          applyPlatformPreset(view, element.getAttribute('data-platform') || '');
          renderPage(view);
          return;
        case 'clear-platform-draft':
          clearPlatformDraft(view, element.getAttribute('data-platform') || '');
          renderPage(view);
          return;
        case 'set-platform-mode': {
          const platformId = element.getAttribute('data-platform') || '';
          const preset = PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === platformId);
          if (preset?.modeKey && view.envDraft) {
            view.envDraft[preset.modeKey] = element.getAttribute('data-value') || preset.modeDefault || 'reply';
            renderPage(view);
          }
          return;
        }
        case 'gateway-install':
          await runGatewayAction(view, 'install', '安装 Gateway Service');
          return;
        case 'gateway-start':
          await runGatewayAction(view, 'start', '启动 Gateway');
          return;
        case 'gateway-restart':
          await runGatewayAction(view, 'restart', '重启 Gateway');
          return;
        case 'gateway-stop':
          await runGatewayAction(view, 'stop', '停止 Gateway');
          return;
        case 'gateway-uninstall':
          if (!window.confirm('确定卸载当前 profile 的 Gateway Service 吗？')) {
            return;
          }
          await runGatewayAction(view, 'uninstall', '卸载 Gateway Service');
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
          navigate('logs', logsIntent);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', buildDiagnosticsDrilldownIntent(relaySeed(view), {
            description: '围绕网关 Service、平台异常和远端交付继续深检。',
            suggestedCommand: view.dashboard.gateway?.gatewayState === 'running' ? 'gateway-status' : 'gateway-status-deep',
            logName: 'gateway.error',
          }));
          return;
        case 'goto-credentials':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续完成平台 token、home channel 和 reply mode 配置。',
            focus: 'credentials',
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
    config: null,
    cronSnapshot: null,
    dashboard: null,
    destroyed: false,
    error: null,
    gatewayDraft: cloneGatewayWorkspace(),
    gatewayPolicySection: 'reset',
    installation: null,
    investigation: getPageIntent('gateway'),
    lastResult: null,
    loading: true,
    focusSection: 'status',
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    surfaceView: 'focus',
    envDraft: cloneEnvWorkspace(),
    savingEnv: null,
    savingGateway: false,
    showServiceActions: false,
    activePlatformFocus: null,
    unsubscribe: null,
    workspaceTab: 'control',
  };

  if (activeView.investigation) {
    activeView.surfaceView = 'workspace';
    activeView.workspaceTab = activeView.investigation.platformName ? 'platforms' : 'control';
    activeView.activePlatformFocus = activeView.investigation.platformName
      ? platformFocusIdFromName(activeView.investigation.platformName)
      : null;
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
