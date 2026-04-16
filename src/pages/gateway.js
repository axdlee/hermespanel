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
  tokenPreview,
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

function platformFocusIdFromName(platformName) {
  const normalized = String(platformName || '').trim().toLowerCase();
  return PLATFORM_WORKSPACE_PRESETS.find((item) => item.id === normalized || item.runtimeName === normalized)?.id || null;
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">网关控制</h1>
        ${infoTipHtml('这页只做 Gateway Service、会话策略和平台链路接管；模型与通道凭证继续走客户端内的专属工作台，不再依赖 gateway setup。')}
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
          <h1 class="page-title">网关控制</h1>
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
  if (envWorkspaceDirty(view)) {
    warnings.push('平台连接工作台还有未保存的通道草稿。');
  }

  const surfaceView = view.surfaceView || 'focus';
  const focusShell = `
    <div class="dashboard-focus-shell">
      <section class="dashboard-focus-card dashboard-focus-card-${gatewayRunning && warnings.length === 0 ? 'good' : 'warn'}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${gatewayRunning ? '已接管' : '待接管'}</span>
            <h2 class="dashboard-focus-title">${gatewayRunning ? 'Gateway 已经跑起来了' : '先让 Gateway 真正跑起来'}</h2>
            <p class="dashboard-focus-desc">${gatewayRunning ? '默认层只保留状态、通道和下一步。策略、作业、诊断和原始输出继续沉到工作台标签里。' : '当前先补 Token、平台接入和会话策略，再启动服务做真实闭环验证。'}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(gatewayRunning ? 'Gateway 运行中' : 'Gateway 待启动', gatewayRunning ? 'good' : 'warn')}
            ${pillHtml(`${connectedPlatforms}/${platforms.length || 0} 平台已连`, connectedPlatforms > 0 ? 'good' : 'warn')}
            ${pillHtml(`${remoteJobs.length} 个远端作业`, remoteJobs.length > 0 ? 'warn' : 'neutral')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">Gateway</span>
            <strong class="dashboard-signal-value">${escapeHtml(gatewayRunning ? '运行中' : '待启动')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(gatewayRunning ? `PID ${gateway?.pid ?? '—'} · ${gateway?.activeAgents ?? 0} 个活跃 Agent` : '当前还没有运行中的 Gateway 状态。')}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">平台</span>
            <strong class="dashboard-signal-value">${escapeHtml(platforms.length ? `${connectedPlatforms}/${platforms.length}` : '暂无平台')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(unhealthyPlatforms.length === 0 ? '当前没有明显的平台连接异常。' : `异常平台 ${unhealthyPlatforms.length} 个`)}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">Remote Jobs</span>
            <strong class="dashboard-signal-value">${escapeHtml(remoteJobs.length > 0 ? `${remoteJobs.length} 个` : '本地优先')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(failingRemoteJobs.length > 0 ? `${failingRemoteJobs.length} 个作业投递异常` : '暂未发现远端投递失败。')}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">Token</span>
            <strong class="dashboard-signal-value">${escapeHtml(tokenPreview(gatewayDraft.hermesGatewayToken))}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(`${gatewayDraft.sessionResetMode} · reset ${gatewayDraft.resetTriggers.join(', ')}`)}</span>
          </section>
        </div>
        <div class="dashboard-focus-actions">
          ${buttonHtml({ action: gatewayRunning ? 'gateway-restart' : 'gateway-start', label: gatewayRunning ? '重启 Gateway' : '启动 Gateway', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'open-gateway-workbench', label: '进入策略工作台', attrs: { 'data-tab': 'control' } })}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', disabled: Boolean(view.refreshing || view.savingGateway || view.savingEnv) })}
        </div>
      </section>

      <aside class="dashboard-jump-panel">
        <div class="workspace-main-header">
          <div>
            <strong>继续去哪里</strong>
            <p class="workspace-main-copy">常用入口只保留四个，具体字段继续在工作台标签里展开。</p>
          </div>
          ${pillHtml('高频 4 项', 'neutral')}
        </div>
        <div class="dashboard-jump-grid">
          ${launcherCardHtml({
            action: 'open-gateway-workbench',
            attrs: { 'data-tab': 'control' },
            kicker: '策略',
            title: '会话与 Token',
            meta: `${gatewayDraft.sessionResetMode} · ${gatewayDraft.unauthorizedDmBehavior}`,
            tone: gatewayDraft.hermesGatewayToken.trim() ? 'good' : 'warn',
          })}
          ${launcherCardHtml({
            action: 'open-gateway-workbench',
            attrs: { 'data-tab': 'platforms' },
            kicker: '平台',
            title: '通道接入',
            meta: `${connectedPlatforms}/${platforms.length || 0} 已连通`,
            tone: unhealthyPlatforms.length === 0 ? 'good' : 'warn',
          })}
          ${launcherCardHtml({
            action: 'open-gateway-workbench',
            attrs: { 'data-tab': 'jobs' },
            kicker: '作业',
            title: '远端投递',
            meta: remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '当前没有远端作业',
            tone: failingRemoteJobs.length > 0 ? 'warn' : 'neutral',
          })}
          ${launcherCardHtml({
            action: 'goto-logs',
            kicker: '排障',
            title: '日志与诊断',
            meta: warnings[0] || '进入日志与诊断继续排查',
            tone: warnings.length > 0 ? 'warn' : 'neutral',
          })}
        </div>
      </aside>
    </div>
  `;

  const focusContent = `
    ${focusShell}
    <section class="config-section dashboard-quiet-card">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">当前只保留这些摘要</h2>
          <p class="config-section-desc">默认页不再把策略编辑器、平台字段、作业与诊断一起铺开，只保留最需要先判断的信息。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(warnings.length > 0 ? `${warnings.length} 条提醒` : '当前稳定', warnings.length > 0 ? 'warn' : 'good')}
        </div>
      </div>
      <div class="detail-list compact">
        ${[
          { label: 'Gateway', value: gatewayRunning ? '运行中' : '待启动' },
          { label: '通道接入', value: platforms.length ? `${connectedPlatforms}/${platforms.length} 已连通` : '还没有通道' },
          { label: 'Token / Reset', value: `${tokenPreview(gatewayDraft.hermesGatewayToken)} · ${gatewayDraft.sessionResetMode}` },
          { label: '下一步', value: !gatewayDraft.hermesGatewayToken.trim() ? '先补网关 Token' : !gatewayRunning ? '启动 Gateway 做闭环验证' : '按需进入工作台继续细调' },
        ].map((item) => `
          <div class="key-value-row">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  const workspaceContent = `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">Gateway 工作台</h2>
            ${infoTipHtml('保持一个主工作区，避免 Service 区、配置区、诊断区到处重复。策略接管是默认入口，平台和作业放到次级标签。')}
          </div>
          <p class="config-section-desc">策略主控，运行回执兜底。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workspaceTab, 'neutral')}
          ${warnings.length > 0 ? pillHtml(`${warnings.length} 条提醒`, 'warn') : pillHtml('当前稳定', 'good')}
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
        <h1 class="page-title">网关控制</h1>
        ${infoTipHtml('这一页不再重复铺陈介绍，也不再把高频配置藏到命令行；Service、策略和平台状态都放进一个紧凑工作台。')}
      </div>
      <p class="page-desc">Service、会话策略、平台链路。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner context-banner-compact">
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

    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(surfaceView, 'focus', '常用')}
      ${surfaceTabHtml(surfaceView, 'workspace', '工作台')}
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
