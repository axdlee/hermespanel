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

function workspaceTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-workspace-view="${key}">
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

function dashboardJumpCardHtml({ action, kicker, title, meta, tone = 'neutral' }) {
  return `
    <button type="button" class="dashboard-jump-card dashboard-jump-card-${tone}" data-action="${escapeHtml(action)}">
      <span class="dashboard-jump-kicker">${escapeHtml(kicker)}</span>
      <strong class="dashboard-jump-title">${escapeHtml(title)}</strong>
      <span class="dashboard-jump-meta">${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <h1 class="page-title">仪表盘</h1>
      <p class="page-desc">正在同步安装状态与常用入口。</p>
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
        <p class="page-desc">安装状态、当前进度与常用入口。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">桌面快照暂时不可用，可以稍后重试。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取当前桌面快照', view.error || '请稍后再试。')}
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
  const workspaceView = view.workspaceView || 'launch';
  const recentView = view.recentView || 'result';
  const boundaryView = view.boundaryView || 'radar';
  const focusState = !installation.binaryFound
    ? {
      kicker: '安装',
      title: '先安装 Hermes',
      description: '安装完成后即可开始使用。',
      tone: 'warn',
      primaryAction: { action: 'quick-primary', label: primaryActionLabel, kind: 'primary' },
      secondaryActions: [
        { action: 'goto-diagnostics', label: '环境检查' },
      ],
    }
    : !modelReady
      ? {
        kicker: '配置',
        title: '先完成模型设置',
        description: '补齐 Provider、模型和关键凭证。',
        tone: 'warn',
        primaryAction: { action: 'goto-config-model', label: '配置模型', kind: 'primary' },
        secondaryActions: [
          { action: 'goto-config-credentials', label: '凭证与通道' },
          { action: 'goto-config-toolsets', label: '能力设置' },
        ],
      }
      : !gatewayRunning
        ? {
          kicker: '启动',
          title: '启动 Gateway',
          description: '启动后即可验证消息链路。',
          tone: 'warn',
          primaryAction: { action: 'quick-primary', label: primaryActionLabel, kind: 'primary' },
          secondaryActions: [
            { action: 'goto-gateway', label: 'Gateway' },
            { action: 'goto-logs', label: '日志' },
          ],
        }
        : warnings.length > 0 || missingDependencies.length > 0 || missingArtifacts > 0
          ? {
            kicker: '提醒',
            title: '基础链路已连通',
            description: '还有少量项目需要处理。',
            tone: workspaceTone,
            primaryAction: { action: 'goto-diagnostics', label: '查看提醒', kind: 'primary' },
            secondaryActions: [
              { action: 'goto-logs', label: '日志' },
              { action: 'goto-gateway', label: '系统' },
            ],
          }
          : {
            kicker: '就绪',
            title: '可以开始使用',
            description: '常用入口已经准备好。',
            tone: 'good',
            primaryAction: { action: 'goto-skills', label: '技能', kind: 'primary' },
            secondaryActions: [
              { action: 'goto-extensions', label: '能力扩展' },
              { action: 'goto-gateway', label: 'Gateway' },
            ],
          };
  const signalCards = [
    {
      label: '环境',
      value: installation.binaryFound ? '已接管' : '待安装',
      meta: installation.binaryFound ? `${versionLine} · 运行组件已接管` : '安装后即可开始使用。',
    },
    {
      label: '主链路',
      value: !modelReady ? '待补齐' : gatewayRunning ? '可直接使用' : '待验证',
      meta: !modelReady ? '先补模型和关键凭证。' : gatewayRunning ? '消息入口已经接通。' : '启动 Gateway 后再验证消息链路。',
    },
    {
      label: '概况',
      value: `${dashboard.counts.sessions} 会话 / ${dashboard.counts.skills} 技能`,
      meta: `Cron ${dashboard.counts.cronJobs} · ${warnings[0] || (primaryAlias?.name ? `主别名 ${primaryAlias.name}` : '当前没有新的提醒')}`,
    },
  ];
  const launchWorkspace = `
    <div class="dashboard-focus-shell">
      <section class="dashboard-focus-card dashboard-focus-card-${focusState.tone}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${escapeHtml(focusState.kicker)}</span>
            <h2 class="dashboard-focus-title">${escapeHtml(focusState.title)}</h2>
            <p class="dashboard-focus-desc">${escapeHtml(focusState.description)}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(view.profile, 'neutral')}
            ${pillHtml(gatewayRunning ? 'Gateway 已运行' : 'Gateway 待启动', gatewayRunning ? 'good' : 'warn')}
            ${pillHtml(modelReady ? '模型链路已配' : '模型链路待补', modelReady ? 'good' : 'warn')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          ${signalCards.map((item) => `
            <section class="dashboard-signal-card">
              <span class="dashboard-signal-label">${escapeHtml(item.label)}</span>
              <strong class="dashboard-signal-value">${escapeHtml(item.value)}</strong>
              <span class="dashboard-signal-meta">${escapeHtml(item.meta)}</span>
            </section>
          `).join('')}
        </div>
        <div class="dashboard-focus-actions">
          ${buttonHtml({
            action: focusState.primaryAction.action,
            label: focusState.primaryAction.label,
            kind: focusState.primaryAction.kind,
            disabled: Boolean(view.runningAction) || (focusState.primaryAction.action === 'refresh' && view.refreshing),
          })}
          ${focusState.secondaryActions.map((item) => buttonHtml({ action: item.action, label: item.label })).join('')}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', disabled: view.refreshing || Boolean(view.runningAction) })}
        </div>
      </section>

      <aside class="dashboard-jump-panel">
        <div class="workspace-main-header">
          <div>
            <strong>快捷入口</strong>
            <p class="workspace-main-copy">只放最常用的 4 项。</p>
          </div>
          ${pillHtml('常用 4 项', 'neutral')}
        </div>
        <div class="dashboard-jump-grid">
          ${dashboardJumpCardHtml({
            action: 'goto-config-model',
            kicker: '模型',
            title: '模型与凭证',
            meta: modelReady ? '主对话链路已经可用。' : '默认模型、Provider 和关键凭证还没补齐。',
            tone: modelReady ? 'good' : 'warn',
          })}
          ${dashboardJumpCardHtml({
            action: 'goto-gateway',
            kicker: 'Gateway',
            title: '消息入口',
            meta: gatewayRunning ? '消息链路已经启动。' : '启动后才能接消息与远端作业。',
            tone: gatewayRunning ? 'good' : 'warn',
          })}
          ${dashboardJumpCardHtml({
            action: 'goto-extensions',
            kicker: '能力',
            title: '工具与技能',
            meta: `${dashboard.counts.skills} 个技能 · ${toolsetsLine || '能力面待整理'}`,
          })}
          ${dashboardJumpCardHtml({
            action: 'goto-logs',
            kicker: '材料',
            title: '日志与回执',
            meta: warnings[0] || (view.logName ? `最近日志 ${view.logName}` : '需要时再进入日志与诊断页。'),
          })}
        </div>
      </aside>
    </div>

    <section class="workspace-main-card dashboard-quiet-card">
      <div class="workspace-main-header">
        <div>
          <strong>当前状态</strong>
          <p class="workspace-main-copy">关键状态与提醒。</p>
        </div>
        ${pillHtml(workspaceTone === 'good' ? '正常' : '有提醒', workspaceTone)}
      </div>
      ${keyValueRowsHtml([
        { label: '当前阶段', value: focusState.title },
        { label: '主链路', value: !installation.binaryFound ? '组件待安装' : !modelReady ? '模型链路待补齐' : gatewayRunning ? '模型与 Gateway 已接通' : 'Gateway 待启动' },
        { label: '当前概况', value: `${dashboard.counts.sessions} 会话 · ${dashboard.counts.skills} 技能 · Cron ${dashboard.counts.cronJobs}` },
        { label: '待处理', value: warnings[0] || (missingArtifacts === 0 ? '当前没有明显材料缺口' : missingArtifactList.map((item) => item.label).join('、')) },
      ])}
    </section>
  `;
  const recentBody = recentView === 'logs'
    ? `
      <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>最近日志</strong>
              <p class="workspace-main-copy">查看最近日志片段。</p>
            </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
            ${buttonHtml({ action: 'open-logs', label: '打开目录', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
          </div>
        </div>
        <div class="log-viewer">${view.logPreview?.lines?.length ? escapeHtml(view.logPreview.lines.join('\n')) : escapeHtml(view.logError || '当前没有读取到最近日志。')}</div>
      </section>
    `
    : recentView === 'sessions'
      ? `
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>最近会话</strong>
              <p class="workspace-main-copy">查看最近几条会话记录。</p>
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
      `
      : `
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <div class="panel-title-row">
                <strong>最近动作回执</strong>
              </div>
              <p class="workspace-main-copy">这里保留最近一次操作结果。</p>
            </div>
            ${buttonHtml({ action: 'goto-diagnostics', label: '诊断页' })}
          </div>
          ${commandResultHtml(view.lastResult, '暂无最近动作', '先从上方入口执行一次动作，这里会保留最近回执。')}
        </section>
      `;

  const recentWorkspace = `
    <div class="page-stack">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <strong>运行材料</strong>
            <p class="workspace-main-copy">回执、日志和会话。</p>
          </div>
          ${pillHtml(recentView === 'result' ? '回执' : recentView === 'logs' ? '日志' : '会话', 'neutral')}
        </div>
        <div class="tab-bar tab-bar-dense">
          ${subviewTabHtml('data-recent-view', recentView, 'result', '回执')}
          ${subviewTabHtml('data-recent-view', recentView, 'logs', '日志')}
          ${subviewTabHtml('data-recent-view', recentView, 'sessions', '会话')}
        </div>
      </section>
      ${recentBody}
    </div>
  `;

  const boundaryBody = boundaryView === 'system'
    ? `
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <strong>系统动作</strong>
            </div>
            <p class="workspace-main-copy">安装、目录和系统动作。</p>
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
          ${buttonHtml({ action: 'doctor', label: '健康检查', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) || !installation.hermesHomeExists })}
          ${buttonHtml({ action: 'open-logs', label: '打开日志', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
        </div>
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'install-cli', label: view.runningAction === 'installation:install' ? '安装中…' : (installation.binaryFound ? '重新安装 Hermes' : '安装 Hermes'), kind: 'primary', disabled: Boolean(view.runningAction) })}
          ${buttonHtml({ action: 'update-cli', label: view.runningAction === 'installation:update' ? '升级中…' : '升级 Hermes', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'uninstall-cli', label: view.runningAction === 'installation:uninstall' ? '卸载中…' : '卸载 Hermes', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        </div>
      </section>
    `
    : boundaryView === 'artifacts'
      ? `
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>工作区材料</strong>
              <p class="workspace-main-copy">查看关键材料状态。</p>
            </div>
            ${pillHtml(missingArtifacts === 0 ? '已齐备' : `${missingArtifacts} 项缺失`, missingArtifacts === 0 ? 'good' : 'warn')}
          </div>
          ${keyValueRowsHtml(
            artifacts.slice(0, 4).map((item) => ({
              label: item.label,
              value: item.exists ? item.path : `${item.label} 缺失`,
            })),
          )}
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'goto-diagnostics', label: '系统诊断' })}
            ${buttonHtml({ action: 'goto-logs', label: '日志页' })}
            ${buttonHtml({ action: 'goto-profiles', label: '实例管理' })}
          </div>
        </section>
      `
      : `
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>风险雷达</strong>
              <p class="workspace-main-copy">集中查看依赖、材料和提醒。</p>
            </div>
            ${pillHtml(workspaceTone === 'good' ? '正常' : '待关注', workspaceTone)}
          </div>
          ${keyValueRowsHtml([
            { label: '当前 Profile', value: view.profile },
            { label: '主别名', value: primaryAlias?.name || '未创建' },
            { label: '依赖就绪', value: `${dependencyReadyCount}/${installation.dependencies.length}` },
            { label: '材料缺失', value: missingArtifacts === 0 ? '0' : String(missingArtifacts) },
          ])}
          <div class="list-stack top-gap">
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
                <strong>提醒</strong>
                ${pillHtml(warnings.length > 0 ? `${warnings.length} 条` : '无新增', warnings.length > 0 ? 'warn' : 'good')}
              </div>
              <p>${escapeHtml(warnings[0] || '当前没有明显阻塞项，可以配置或联调。')}</p>
            </div>
          </div>
        </section>
      `;

  const boundaryWorkspace = `
    <div class="page-stack">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <strong>系统</strong>
            <p class="workspace-main-copy">查看风险、系统动作和材料。</p>
          </div>
          ${pillHtml(boundaryView === 'radar' ? '风险' : boundaryView === 'system' ? '系统动作' : '材料', 'neutral')}
        </div>
        <div class="tab-bar tab-bar-dense">
          ${subviewTabHtml('data-boundary-view', boundaryView, 'radar', '风险')}
          ${subviewTabHtml('data-boundary-view', boundaryView, 'system', '系统动作')}
          ${subviewTabHtml('data-boundary-view', boundaryView, 'artifacts', '材料')}
        </div>
      </section>
      ${boundaryBody}
    </div>
  `;
  const workspaceContent = workspaceView === 'recent'
    ? recentWorkspace
    : workspaceView === 'boundary'
      ? boundaryWorkspace
      : launchWorkspace;

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">仪表盘</h1>
      </div>
      <p class="page-desc">安装、状态与常用入口。</p>
    </div>
    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${workspaceTabHtml(workspaceView, 'launch', '开始')}
      ${workspaceTabHtml(workspaceView, 'recent', '材料')}
      ${workspaceTabHtml(workspaceView, 'boundary', '系统')}
    </div>

    ${workspaceContent}
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

  page.querySelectorAll('[data-workspace-view]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-workspace-view');
      if (!nextView || nextView === view.workspaceView) {
        return;
      }
      view.workspaceView = nextView;
      renderPage(view);
    };
  });

  page.querySelectorAll('[data-recent-view]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-recent-view');
      if (!nextView || nextView === view.recentView) {
        return;
      }
      view.recentView = nextView;
      renderPage(view);
    };
  });

  page.querySelectorAll('[data-boundary-view]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-boundary-view');
      if (!nextView || nextView === view.boundaryView) {
        return;
      }
      view.boundaryView = nextView;
      renderPage(view);
    };
  });

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
            description: '围绕 service、平台和远端投递做排查。',
          }));
          return;
        case 'goto-config':
          navigate('config');
          return;
        case 'goto-config-model':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入配置中心',
            description: '在配置中心直接配置模型、provider 和默认链路。',
            focus: 'model',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-config-credentials':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入凭证配置',
            description: '在配置中心直接配置 API Key、消息通道和相关凭证。',
            focus: 'credentials',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-config-toolsets':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入 Toolsets 配置',
            description: '在配置中心直接调整 toolsets 与 platform toolsets。',
            focus: 'toolsets',
            suggestedCommand: 'tools-summary',
          }));
          return;
        case 'goto-config-memory':
          navigate('config', buildConfigDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入记忆配置',
            description: '在配置中心直接调整 memory provider、记忆开关和用户画像。',
            focus: 'memory',
            suggestedCommand: 'memory-status',
          }));
          return;
        case 'goto-extensions':
          navigate('extensions', buildExtensionsDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘打开扩展页',
            description: '在扩展页处理工具面、插件安装态和 memory runtime。',
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
            description: '结合最近动作和运行材料查看具体日志。',
          }, {
            logName: view.logName || 'gateway',
            limit: '160',
          }));
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', buildDiagnosticsDrilldownIntent({
            sourcePage: 'dashboard',
            headline: '从仪表盘进入诊断页',
            description: '围绕安装、依赖、配置与网关做更深诊断。',
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
    boundaryView: 'radar',
    loading: true,
    logError: null,
    logName: 'gateway',
    logPreview: null,
    page,
    profile: getPanelState().selectedProfile,
    recentView: 'result',
    refreshing: false,
    runningAction: null,
    unsubscribe: null,
    workspaceView: 'launch',
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
