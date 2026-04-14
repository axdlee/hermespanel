import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { formatEpoch, truncate } from '../lib/format';
import {
  getPanelState,
  loadProfiles,
  loadShell,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  firstLine,
  keyValueRowsHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';

let activeView = null;

function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
}

function currentProfileSummary(profile) {
  return getPanelState().profiles?.profiles.find((item) => item.name === profile) ?? null;
}

function workspaceArtifacts(data, installation) {
  return [
    { key: 'home', label: 'Hermes Home', path: installation.hermesHome, exists: installation.hermesHomeExists },
    { key: 'config', label: 'config.yaml', path: `${data.hermesHome}/config.yaml`, exists: installation.configExists },
    { key: 'env', label: '.env', path: `${data.hermesHome}/.env`, exists: installation.envExists },
    { key: 'state', label: 'state.db', path: `${data.hermesHome}/state.db`, exists: installation.stateDbExists },
    { key: 'gateway', label: 'gateway_state.json', path: `${data.hermesHome}/gateway_state.json`, exists: installation.gatewayStateExists },
    { key: 'logs', label: 'logs/', path: `${data.hermesHome}/logs`, exists: installation.logsDirExists },
  ];
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <h1 class="page-title">仪表盘</h1>
      <p class="page-desc">正在同步 Hermes 安装、网关、工作区和最近运行材料。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:132px"></div>').join('')}
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

  if (view.error || !view.dashboard || !view.installation) {
    view.page.innerHTML = `
      <div class="page-header page-header-compact">
        <h1 class="page-title">仪表盘</h1>
        <p class="page-desc">Hermes 运行状态与治理入口。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">控制快照暂时不可用，可以直接重试或者回到桌面端窗口继续验证。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 Hermes 控制中心快照', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const { dashboard, installation } = view;
  const profileSummary = currentProfileSummary(view.profile);
  const versionLine = firstLine(installation.versionOutput, '未读取到 Hermes 版本');
  const gatewayRunning = dashboard.gateway?.gatewayState === 'running';
  const modelReady = Boolean(dashboard.config.modelProvider && dashboard.config.modelDefault);
  const dependencyReadyCount = installation.dependencies.filter((item) => item.found).length;
  const artifacts = workspaceArtifacts(dashboard, installation);
  const missingArtifacts = artifacts.filter((item) => !item.exists).length;
  const warnings = [...dashboard.warnings];
  const primaryAlias = profileSummary?.aliases.find((item) => item.isPrimary) ?? profileSummary?.aliases[0] ?? null;
  const sessions = dashboard.recentSessions ?? [];
  const toolsetsLine = (dashboard.config.toolsets ?? []).join(', ') || '—';
  const missingDependencies = installation.dependencies.filter((item) => !item.found);
  const missingDependencyLine = missingDependencies.length
    ? missingDependencies.map((item) => item.name).join('、')
    : '依赖骨架已齐备';
  const missingArtifactList = artifacts.filter((item) => !item.exists);
  const artifactSummaryLine = missingArtifactList.length
    ? missingArtifactList.map((item) => item.label).join('、')
    : '关键文件与日志目录已齐备';
  const workspaceTone = warnings.length > 0 || missingDependencies.length > 0 || missingArtifacts > 0 ? 'warn' : 'good';
  const primaryActionLabel = installation.binaryFound
    ? (gatewayRunning ? '重启 Gateway' : '启动 Gateway')
    : '安装 Hermes';

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">仪表盘</h1>
        ${infoTipHtml('首页只保留高频治理入口、最近运行材料和少量系统边界动作，避免把配置、技能、网关按钮在多个区域重复铺开。')}
      </div>
      <p class="page-desc">更像客户端控制台首页，而不是命令面板入口页。</p>
    </div>

    <section class="workspace-summary-strip workspace-summary-strip-dense">
      <section class="summary-mini-card">
        <span class="summary-mini-label">Gateway</span>
        <strong class="summary-mini-value">${escapeHtml(gatewayRunning ? '运行中' : '待启动')}</strong>
        <span class="summary-mini-meta">${escapeHtml(gatewayRunning ? `PID ${dashboard.gateway?.pid ?? '—'} · ${dashboard.gateway?.activeAgents ?? 0} 个活跃 Agent` : '当前还没有检测到运行中的 Gateway 状态')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">安装接管</span>
        <strong class="summary-mini-value">${escapeHtml(installation.binaryFound ? versionLine : '待安装')}</strong>
        <span class="summary-mini-meta">${escapeHtml(installation.binaryFound ? (installation.hermesBinary || 'Hermes 可执行组件已接管') : '安装后才能继续接管模型、Gateway 与能力面')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">模型链路</span>
        <strong class="summary-mini-value">${escapeHtml(modelReady ? `${dashboard.config.modelProvider} / ${dashboard.config.modelDefault}` : '待补齐')}</strong>
        <span class="summary-mini-meta">${escapeHtml(dashboard.config.modelBaseUrl || '建议先补齐 provider、默认模型与 key')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">工作区</span>
        <strong class="summary-mini-value">${escapeHtml(`${dashboard.counts.sessions} 会话 / ${dashboard.counts.skills} 技能`)}</strong>
        <span class="summary-mini-meta">${escapeHtml(`Cron ${dashboard.counts.cronJobs} · Alias ${primaryAlias?.name || '未创建'}`)}</span>
      </section>
    </section>

    <div class="quick-actions">
      ${buttonHtml({
        action: 'quick-primary',
        label: view.runningAction === 'installation:install'
          ? '安装中…'
          : view.runningAction === 'gateway:start'
            ? '启动中…'
            : view.runningAction === 'gateway:restart'
              ? '重启中…'
              : primaryActionLabel,
        kind: 'primary',
        disabled: Boolean(view.runningAction),
      })}
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', disabled: view.refreshing || Boolean(view.runningAction) })}
      ${buttonHtml({ action: 'goto-config-model', label: '配置工作台' })}
      ${buttonHtml({ action: 'goto-gateway', label: 'Gateway 工作台' })}
    </div>

    <div class="compact-overview-grid compact-overview-grid-dense">
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <div class="panel-title-row">
              <strong>配置接管</strong>
              ${infoTipHtml('模型、凭证、toolsets 和 provider 继续放到配置工作台里做结构化编辑，首页只保留摘要和跳转。')}
            </div>
            <p class="shell-card-copy">把模型链路、凭证与运行环境汇聚到一张卡里，避免首页重复铺太多入口。</p>
          </div>
          ${pillHtml(modelReady ? '链路已配' : '待补齐', modelReady ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: 'Provider', value: dashboard.config.modelProvider || '未配置' },
          { label: '默认模型', value: dashboard.config.modelDefault || '未配置' },
          { label: 'Base URL', value: dashboard.config.modelBaseUrl || '—' },
          { label: 'Toolsets', value: toolsetsLine },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-config-model', label: '模型配置', kind: 'primary' })}
          ${buttonHtml({ action: 'goto-config-credentials', label: '凭证 / 通道' })}
          ${buttonHtml({ action: 'goto-config-toolsets', label: 'Toolsets' })}
        </div>
      </section>
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <div class="panel-title-row">
              <strong>Gateway 接管</strong>
              ${infoTipHtml('Gateway 启停、平台接入和远端投递继续在专门工作台完成，首页只保留当前链路判断和下钻入口。')}
            </div>
            <p class="shell-card-copy">把 service、平台通道和日志联调后置到 Gateway 工作台，首页不再重复堆平台卡片。</p>
          </div>
          ${pillHtml(gatewayRunning ? '运行中' : '待启动', gatewayRunning ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: 'PID', value: String(dashboard.gateway?.pid ?? '—') },
          { label: '活跃 Agent', value: String(dashboard.gateway?.activeAgents ?? 0) },
          { label: '已配平台', value: String(dashboard.counts.configuredPlatforms) },
          { label: '最近日志', value: view.logName || 'gateway' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-gateway', label: 'Gateway 工作台', kind: 'primary' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '系统诊断' })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
        </div>
      </section>
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <div class="panel-title-row">
              <strong>能力工作台</strong>
              ${infoTipHtml('Skills、Plugins、Memory 和运行工具面继续保留在对应工作台，不在首页重复放功能块。')}
            </div>
            <p class="shell-card-copy">能力面保留摘要，真正治理动作继续落到技能、扩展和记忆工作台中完成。</p>
          </div>
          ${pillHtml(dashboard.counts.skills > 0 ? '已接管' : '待补齐', dashboard.counts.skills > 0 ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: '技能', value: String(dashboard.counts.skills) },
          { label: 'Cron 作业', value: String(dashboard.counts.cronJobs) },
          { label: '会话', value: String(dashboard.counts.sessions) },
          { label: 'Alias', value: primaryAlias?.name || '未创建' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-skills', label: '技能工作台', kind: 'primary' })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展能力' })}
          ${buttonHtml({ action: 'goto-memory', label: '记忆工作台' })}
        </div>
      </section>
    </div>

    <div class="workspace-shell workspace-shell-dense">
      <aside class="workspace-rail">
        <div class="workspace-rail-header">
          <div>
            <strong>运行边界</strong>
            <p class="helper-text">把依赖、关键文件和高风险提醒收在侧栏，主区只保留高价值工作面。</p>
          </div>
          ${pillHtml(workspaceTone === 'good' ? '稳定' : '待关注', workspaceTone)}
        </div>
        ${keyValueRowsHtml([
          { label: '当前 Profile', value: view.profile },
          { label: '主别名', value: primaryAlias?.name || '未创建' },
          { label: '依赖就绪', value: `${dependencyReadyCount}/${installation.dependencies.length}` },
          { label: '材料缺失', value: missingArtifacts === 0 ? '0' : String(missingArtifacts) },
        ])}
        <section class="workspace-rail-section">
          <div class="workspace-rail-section-header">
            <span class="workspace-rail-section-title">风险雷达</span>
            ${pillHtml(missingDependencies.length > 0 ? `${missingDependencies.length} 项缺失` : '已齐备', missingDependencies.length > 0 ? 'warn' : 'good')}
          </div>
          <div class="list-stack">
            <div class="list-card">
              <div class="list-card-title">
                <strong>依赖骨架</strong>
                ${pillHtml(missingDependencies.length > 0 ? '待修复' : '已齐备', missingDependencies.length > 0 ? 'warn' : 'good')}
              </div>
              <p>${escapeHtml(missingDependencyLine)}</p>
            </div>
            <div class="list-card">
              <div class="list-card-title">
                <strong>工作区材料</strong>
                ${pillHtml(missingArtifactList.length > 0 ? '有缺口' : '完整', missingArtifactList.length > 0 ? 'warn' : 'good')}
              </div>
              <p>${escapeHtml(artifactSummaryLine)}</p>
            </div>
            <div class="list-card">
              <div class="list-card-title">
                <strong>结构性提醒</strong>
                ${pillHtml(warnings.length > 0 ? `${warnings.length} 条` : '无新增', warnings.length > 0 ? 'warn' : 'good')}
              </div>
              <p>${escapeHtml(warnings[0] || '当前没有新的结构性阻塞项，适合继续做配置或联调。')}</p>
            </div>
          </div>
        </section>
        <section class="workspace-rail-section">
          <div class="workspace-rail-section-header">
            <span class="workspace-rail-section-title">继续动作</span>
            ${pillHtml(gatewayRunning ? 'Gateway 就绪' : 'Gateway 待启动', gatewayRunning ? 'good' : 'neutral')}
          </div>
          <div class="workspace-rail-toolbar workspace-rail-toolbar-muted">
            <div class="workspace-rail-toolbar-grid">
              ${buttonHtml({ action: 'goto-diagnostics', label: '系统诊断' })}
              ${buttonHtml({ action: 'doctor', label: '健康检查', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'goto-profiles', label: 'Profile 管理' })}
              ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) || !installation.hermesHomeExists })}
              ${buttonHtml({ action: 'goto-logs', label: '日志页' })}
              ${buttonHtml({ action: 'open-logs', label: '打开日志', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
            </div>
          </div>
        </section>
      </aside>

      <div class="workspace-main">
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <div class="panel-title-row">
                <strong>最近动作回执</strong>
                ${infoTipHtml('首页只保留最近一次动作回执，原始细节继续留给诊断页和日志页，避免首页成为命令结果墙。')}
              </div>
              <p class="workspace-main-copy">安装、Gateway 控制和桌面动作都会在这里保留最近一次回执。</p>
            </div>
            ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
          </div>
          ${commandResultHtml(view.lastResult, '暂无最近动作', '先从上方入口执行一次动作，这里会保留最近回执。')}
        </section>

        <div class="workspace-bottom-grid workspace-bottom-grid-dense">
          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <strong>最近日志</strong>
                <p class="workspace-main-copy">先看最近材料，再决定要不要下钻到日志页或诊断页。</p>
              </div>
              <div class="toolbar">
                ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
                ${buttonHtml({ action: 'open-logs', label: '打开目录', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
              </div>
            </div>
            <div class="log-viewer">${view.logPreview?.lines?.length ? escapeHtml(view.logPreview.lines.join('\n')) : escapeHtml(view.logError || '当前没有读取到最近日志。')}</div>
          </section>

          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <strong>最近会话</strong>
                <p class="workspace-main-copy">保留少量最近 session，首页不再铺完整会话管理界面。</p>
              </div>
              <div class="toolbar">
                ${buttonHtml({ action: 'goto-sessions', label: '会话页' })}
                ${buttonHtml({ action: 'goto-gateway', label: 'Gateway' })}
              </div>
            </div>
            ${
              sessions.length
                ? `
                  <div class="session-list session-list-compact">
                    ${sessions.slice(0, 4).map((session) => `
                      <div class="session-row">
                        <div class="session-row-header">
                          <strong class="session-key">${escapeHtml(session.title || session.id)}</strong>
                          ${session.model ? pillHtml(session.model, 'neutral') : ''}
                          ${pillHtml(session.source || 'session', 'neutral')}
                        </div>
                        <div class="service-desc">${escapeHtml(truncate(session.preview || '无预览内容', 128))}</div>
                        <div class="session-row-meta">
                          <span>${escapeHtml(session.id)}</span>
                          <span>${escapeHtml(formatEpoch(session.startedAt))}</span>
                          <span>${escapeHtml(`${session.messageCount} 条消息 / ${session.toolCallCount} 次工具`)}</span>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                `
                : emptyStateHtml('暂无最近会话', '待 Hermes 产生更多 session 后，这里会自动显示最近轨迹。')
            }
          </section>

          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <div class="panel-title-row">
                  <strong>安装边界</strong>
                  ${infoTipHtml('这里专门收纳真正触及系统边界的动作，例如安装、升级和卸载；默认仍在客户端内执行，不再把你甩去外部 Terminal。')}
                </div>
                <p class="workspace-main-copy">保留必要的安装与更新动作，但不再占据首页主要视觉位置。</p>
              </div>
              ${pillHtml(installation.binaryFound ? '已接管' : '待安装', installation.binaryFound ? 'good' : 'warn')}
            </div>
            ${keyValueRowsHtml([
              { label: '安装', value: installation.quickInstallCommand },
              { label: '升级', value: installation.updateCommand },
              { label: '卸载', value: 'hermes uninstall --yes' },
              { label: '当前版本', value: versionLine },
            ])}
            <div class="toolbar top-gap">
              ${buttonHtml({ action: 'install-cli', label: view.runningAction === 'installation:install' ? '安装中…' : (installation.binaryFound ? '重新安装 Hermes' : '安装 Hermes'), kind: 'primary', disabled: Boolean(view.runningAction) })}
              ${buttonHtml({ action: 'update-cli', label: view.runningAction === 'installation:update' ? '升级中…' : '升级 Hermes', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'uninstall-cli', label: view.runningAction === 'installation:uninstall' ? '卸载中…' : '卸载 Hermes', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  bindEvents(view);
}

async function loadData(view, options = {}) {
  const { silent = false, includeProfiles = false } = options;
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
    if (includeProfiles) {
      await loadProfiles(profile);
    }

    const [dashboard, installation] = await Promise.all([
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
    ]);
    const preferredLogName = dashboard.gateway?.gatewayState === 'running' ? 'gateway' : 'errors';
    const logPreview = await api.readLog(preferredLogName, 40, undefined, undefined, profile).catch(() => null);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.dashboard = dashboard;
    view.installation = installation;
    view.logName = preferredLogName;
    view.logPreview = logPreview;
    view.logError = logPreview ? null : '未能读取最近日志。';
    view.lastLoadedAt = new Date().toISOString();
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

function syncWithPanelState(view) {
  const shell = getPanelState();

  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.dashboard = null;
    view.installation = null;
    view.error = null;
    void loadData(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function storeResult(view, label, result) {
  view.lastResult = {
    label,
    result,
    finishedAt: new Date().toISOString(),
  };
}

async function runGatewayAction(view, action, label) {
  view.runningAction = `gateway:${action}`;
  renderPage(view);
  try {
    const result = await api.runGatewayAction(action, view.profile);
    storeResult(view, label, result);
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

async function runDiagnostic(view, kind, label) {
  view.runningAction = `diagnostic:${kind}`;
  renderPage(view);
  try {
    const result = await api.runDiagnostic(kind, view.profile);
    storeResult(view, label, result);
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

async function runInstallationAction(view, action, label) {
  view.runningAction = `installation:${action}`;
  renderPage(view);
  try {
    const result = await api.runInstallationAction(action);
    storeResult(view, label, result);
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

async function runFinderAction(view, actionKey, label, path, revealInFinder = false) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    await openFinderLocation({
      actionKey,
      label,
      notify,
      onResult: (nextLabel, result) => {
        storeResult(view, nextLabel, result);
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

function bindEvents(view) {
  const { page, installation, dashboard } = view;
  if (!page) {
    return;
  }

  page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'refresh') {
        await loadData(view, { includeProfiles: true, silent: true });
        return;
      }

      if (!installation) {
        return;
      }

      switch (action) {
        case 'quick-primary':
          if (installation.binaryFound) {
            await runGatewayAction(view, dashboard?.gateway?.gatewayState === 'running' ? 'restart' : 'start', dashboard?.gateway?.gatewayState === 'running' ? '重启 Gateway' : '启动 Gateway');
          } else {
            await runInstallationAction(view, 'install', '安装 Hermes');
          }
          return;
        case 'doctor':
          await runDiagnostic(view, 'doctor', '健康检查');
          return;
        case 'install-cli':
          await runInstallationAction(view, 'install', installation.binaryFound ? '重新安装 Hermes' : '安装 Hermes');
          return;
        case 'update-cli':
          await runInstallationAction(view, 'update', '升级 Hermes');
          return;
        case 'uninstall-cli':
          if (!window.confirm('确定卸载 Hermes 运行组件吗？这会移除当前安装的命令行主体。')) {
            return;
          }
          await runInstallationAction(view, 'uninstall', '卸载 Hermes');
          return;
        case 'open-home':
          await runFinderAction(view, 'finder:home', '打开 Hermes Home', installation.hermesHome, false);
          return;
        case 'open-logs':
          await runFinderAction(view, 'finder:logs', '打开 logs 目录', `${view.dashboard?.hermesHome}/logs`, false);
          return;
        case 'goto-gateway':
          navigate('gateway', buildGatewayDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入 Gateway 控制',
            description: '继续围绕 service、平台和远端投递做排查。',
          }));
          return;
        case 'goto-config':
          navigate('config');
          return;
        case 'goto-config-model':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入配置中心',
            description: '继续在配置中心直接配置模型、provider 和默认链路。',
            focus: 'model',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-config-credentials':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入凭证配置',
            description: '继续在配置中心直接配置 API Key、消息通道和相关凭证。',
            focus: 'credentials',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-config-toolsets':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入 Toolsets 配置',
            description: '继续在配置中心直接接管 toolsets 与 platform toolsets。',
            focus: 'toolsets',
            suggestedCommand: 'tools-summary',
          }));
          return;
        case 'goto-config-memory':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入记忆配置',
            description: '继续在配置中心直接调整 memory provider、记忆开关和用户画像。',
            focus: 'memory',
            suggestedCommand: 'memory-status',
          }));
          return;
        case 'goto-extensions':
          navigate('extensions', buildExtensionsDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入扩展能力台',
            description: '继续在扩展工作台处理工具面、插件安装态和 memory runtime。',
            rawKind: 'tools',
          }));
          return;
        case 'goto-skills':
          navigate('skills');
          return;
        case 'goto-memory':
          navigate('memory');
          return;
        case 'goto-profiles':
          navigate('profiles');
          return;
        case 'goto-logs':
          navigate('logs', buildLogsDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入日志页',
            description: '结合最近动作和运行材料继续看具体日志。',
          }, {
            logName: view.logName || 'gateway',
            limit: '160',
          }));
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', buildDiagnosticsDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入诊断页',
            description: '继续围绕安装、依赖、配置与网关做更深诊断。',
          }, {
            suggestedCommand: installation.binaryFound ? 'doctor' : 'dump',
          }));
          return;
        case 'goto-sessions':
          navigate('sessions');
          return;
        default:
          return;
      }
    };
  });
}

export async function render() {
  cleanup();

  const page = document.createElement('div');
  page.className = 'page';

  activeView = {
    destroyed: false,
    dashboard: null,
    error: null,
    installation: null,
    lastLoadedAt: null,
    lastResult: null,
    loading: true,
    logError: null,
    logName: 'gateway',
    logPreview: null,
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    unsubscribe: null,
  };

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView);
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
