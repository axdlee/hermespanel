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

function dependencyTone(dependency) {
  if (dependency?.found) {
    return 'good';
  }

  return ['hermes', 'curl', 'git', 'python3'].includes(dependency?.name) ? 'bad' : 'warn';
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
    <div class="page-header">
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
      <div class="page-header">
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
  const primaryActionLabel = installation.binaryFound
    ? (gatewayRunning ? '重启 Gateway' : '启动 Gateway')
    : '安装 CLI';

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">仪表盘</h1>
        ${infoTipHtml('首页只保留高频治理入口、最近运行材料和少量系统边界动作，避免把配置、技能、网关按钮在多个区域重复铺开。')}
      </div>
      <p class="page-desc">Hermes 运行与治理总览。</p>
    </div>

    <div class="stat-cards">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway</span>
          ${statusDotHtml(gatewayRunning ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${gatewayRunning ? '运行中' : '待启动'}</div>
        <div class="stat-card-meta">${gatewayRunning ? `PID ${escapeHtml(dashboard.gateway?.pid ?? '—')} · ${escapeHtml(dashboard.gateway?.activeAgents ?? 0)} 个活跃 Agent` : '当前还没有检测到运行中的 Gateway 状态。'}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">CLI / Version</span>
          ${statusDotHtml(installation.binaryFound ? 'running' : 'stopped')}
        </div>
        <div class="stat-card-value">${escapeHtml(installation.binaryFound ? versionLine : '未安装 Hermes CLI')}</div>
        <div class="stat-card-meta">${escapeHtml(installation.binaryFound ? installation.hermesBinary || 'CLI 已就绪' : '安装后才能接管模型、Gateway 与技能治理。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Model</span>
          ${statusDotHtml(modelReady ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(modelReady ? `${dashboard.config.modelProvider} / ${dashboard.config.modelDefault}` : '待配置')}</div>
        <div class="stat-card-meta">${escapeHtml(dashboard.config.modelBaseUrl || '建议先补齐 provider、默认模型和 key。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Workspace</span>
        </div>
        <div class="stat-card-value">${escapeHtml(`${dashboard.counts.sessions} 会话 / ${dashboard.counts.skills} 技能`)}</div>
        <div class="stat-card-meta">${escapeHtml(`Cron ${dashboard.counts.cronJobs} · Alias ${primaryAlias?.name || '未创建'}`)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Dependencies</span>
          ${statusDotHtml(dependencyReadyCount === installation.dependencies.length ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${dependencyReadyCount}/${installation.dependencies.length}`)}</div>
        <div class="stat-card-meta">${dependencyReadyCount === installation.dependencies.length ? 'CLI 周边依赖已齐备。' : '仍有缺失依赖，建议继续做 doctor。'}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Artifacts</span>
          ${statusDotHtml(missingArtifacts === 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(missingArtifacts === 0 ? '工作区完整' : `缺失 ${missingArtifacts} 项`)}</div>
        <div class="stat-card-meta">${escapeHtml(`Home ${installation.hermesHomeExists ? 'Ready' : 'Missing'} · Logs ${installation.logsDirExists ? 'Ready' : 'Missing'}`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({
        action: 'quick-primary',
        label: view.runningAction === 'installation:install'
          ? (installation.binaryFound ? '重装中…' : '安装中…')
          : view.runningAction === 'gateway:start'
            ? '启动中…'
            : view.runningAction === 'gateway:restart'
              ? '重启中…'
              : primaryActionLabel,
        kind: 'primary',
        disabled: Boolean(view.runningAction),
      })}
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', disabled: view.refreshing || Boolean(view.runningAction) })}
      ${buttonHtml({ action: 'goto-config-model', label: '配置中心' })}
      ${buttonHtml({ action: 'goto-gateway', label: 'Gateway 工作台' })}
      ${buttonHtml({ action: 'goto-skills', label: '技能工作台' })}
      ${buttonHtml({ action: 'goto-logs', label: '日志查看' })}
      ${buttonHtml({ action: 'doctor', label: '健康检查', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">工作台入口</h2>
            ${infoTipHtml('像 clawpanel 一样，首页优先承担导航和状态聚合。需要深操作时再下钻到对应工作台，而不是在首页重复实现整套功能。')}
          </div>
          <p class="config-section-desc">高频入口集中，重复动作收口。</p>
        </div>
      </div>
      <div class="overview-grid dashboard-entry-grid">
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="panel-title-row">
              <div class="overview-card-title">模型 / 凭证</div>
              ${infoTipHtml('模型 provider、默认模型、API key、平台 token 和 toolsets 继续放到配置中心做结构化编辑。')}
            </div>
            <div class="overview-card-value">${escapeHtml(modelReady ? `${dashboard.config.modelProvider} / ${dashboard.config.modelDefault}` : '待补齐模型链路')}</div>
            <div class="overview-card-meta">${escapeHtml(`${dashboard.config.modelBaseUrl || 'base url 未配置'} · toolsets ${toolsetsLine}`)}</div>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'goto-config-model', label: '模型配置', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-config-credentials', label: '凭证 / 通道' })}
              ${buttonHtml({ action: 'goto-config-toolsets', label: 'Toolsets' })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="panel-title-row">
              <div class="overview-card-title">Gateway / 通道</div>
              ${infoTipHtml('Gateway 启停、平台 token、home channel 和 service 接管统一回 Gateway 工作台，不在首页重复铺平台卡片。')}
            </div>
            <div class="overview-card-value">${escapeHtml(gatewayRunning ? `运行中 / PID ${dashboard.gateway?.pid ?? '—'}` : '待启动')}</div>
            <div class="overview-card-meta">${escapeHtml(`${dashboard.counts.configuredPlatforms} 个平台已配置 · active agents ${dashboard.gateway?.activeAgents ?? 0}`)}</div>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'goto-gateway', label: 'Gateway 工作台', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
              ${buttonHtml({ action: 'goto-diagnostics', label: '系统诊断' })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="panel-title-row">
              <div class="overview-card-title">Skills / Plugins / Memory</div>
              ${infoTipHtml('技能目录、插件安装、memory provider 和工具运行态都已经有对应工作台，首页只保留总览和跳转。')}
            </div>
            <div class="overview-card-value">${escapeHtml(`${dashboard.counts.skills} 个技能 / ${dashboard.counts.cronJobs} 个作业`)}</div>
            <div class="overview-card-meta">${escapeHtml(`sessions ${dashboard.counts.sessions} · toolsets ${toolsetsLine}`)}</div>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'goto-skills', label: '技能工作台', kind: 'primary' })}
              ${buttonHtml({ action: 'goto-extensions', label: '扩展能力' })}
              ${buttonHtml({ action: 'goto-memory', label: '记忆工作台' })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="panel-title-row">
              <div class="overview-card-title">Profile / Workspace</div>
              ${infoTipHtml('把当前 profile、别名和工作区入口放在一张卡里，避免这些路径信息在多个区域重复出现。')}
            </div>
            <div class="overview-card-value">${escapeHtml(`${view.profile}${primaryAlias ? ` / ${primaryAlias.name}` : ''}`)}</div>
            <div class="overview-card-meta">${escapeHtml(`Home ${installation.hermesHomeExists ? 'ready' : 'missing'} · logs ${installation.logsDirExists ? 'ready' : 'missing'} · 会话 ${dashboard.counts.sessions}`)}</div>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'goto-profiles', label: 'Profile 管理', kind: 'primary' })}
              ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) || !installation.hermesHomeExists })}
              ${buttonHtml({ action: 'open-logs', label: '打开 Logs', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
            </div>
          </div>
        </section>
      </div>
    </section>

    <div class="two-column wide-left">
      <div class="page-stack">
        <section class="config-section">
          <div class="config-section-header">
            <div>
              <div class="panel-title-row">
                <h2 class="config-section-title">最近动作</h2>
                ${infoTipHtml('无论是内部执行的安装、Gateway 控制，还是其他治理动作，最近一次原始结果都会留在这里。')}
              </div>
              <p class="config-section-desc">统一回看原始输出，不额外铺说明。</p>
            </div>
            ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
          </div>
          ${commandResultHtml(view.lastResult, '暂无动作输出', '先执行任一控制动作，这里会保留 Hermes 的原始命令结果。')}
        </section>

        <section class="config-section">
          <div class="config-section-header">
            <div>
              <h2 class="config-section-title">最近日志</h2>
              <p class="config-section-desc">先看最近日志，再决定是否继续下钻。</p>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
              ${buttonHtml({ action: 'open-logs', label: '打开日志目录', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
            </div>
          </div>
          <div class="log-viewer">${view.logPreview?.lines?.length ? escapeHtml(view.logPreview.lines.join('\n')) : escapeHtml(view.logError || '当前没有读取到最近日志。')}</div>
        </section>
      </div>

      <div class="page-stack">
        <section class="config-section">
          <div class="config-section-header">
            <div>
              <div class="panel-title-row">
                <h2 class="config-section-title">工作区与风险</h2>
                ${infoTipHtml('把依赖、关键文件和真正影响闭环的提醒放在右侧，避免长说明挤占主操作区。')}
              </div>
              <p class="config-section-desc">缺什么、丢了什么，一眼可见。</p>
            </div>
          </div>
          <div class="service-stack">
            ${installation.dependencies.map((dependency) => `
              <div class="service-card">
                <div class="service-info">
                  ${pillHtml(dependency.found ? '已发现' : '缺失', dependencyTone(dependency))}
                  <div>
                    <div class="service-name">${escapeHtml(dependency.name)}</div>
                    <div class="service-desc">${escapeHtml(dependency.note)}</div>
                    <div class="service-desc service-path">${escapeHtml(dependency.path || '未检测到可执行路径')}</div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="artifact-grid artifact-grid-compact">
            ${artifacts.map((artifact) => `
              <div class="artifact-card">
                <div class="artifact-card-header">
                  <strong>${escapeHtml(artifact.label)}</strong>
                  ${pillHtml(artifact.exists ? '存在' : '缺失', artifact.exists ? 'good' : 'warn')}
                </div>
                <p>${escapeHtml(artifact.path)}</p>
              </div>
            `).join('')}
          </div>
          ${warnings.length > 0 ? `
            <div class="warning-stack top-gap">
              ${warnings.slice(0, 4).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
            </div>
          ` : ''}
        </section>

        <section class="config-section">
          <div class="config-section-header">
            <div>
              <h2 class="config-section-title">最近会话</h2>
              <p class="config-section-desc">从控制面板直接继续追 session。</p>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-sessions', label: '进入会话页' })}
              ${buttonHtml({ action: 'goto-gateway', label: '进入 Gateway' })}
            </div>
          </div>
          ${
            sessions.length
              ? `
                <div class="session-list session-list-compact">
                  ${sessions.slice(0, 6).map((session) => `
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
      </div>
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">系统边界动作</h2>
            ${infoTipHtml('这里专门收纳真正触及系统边界的动作，例如 CLI 安装、升级和卸载。它们仍由面板内执行，但不再占据首页主操作位。')}
          </div>
          <p class="config-section-desc">仍然可控，但不喧宾夺主。</p>
        </div>
        ${pillHtml(installation.binaryFound ? 'CLI 就绪' : 'CLI 缺失', installation.binaryFound ? 'good' : 'warn')}
      </div>
      <section class="shell-card shell-card-muted">
        <div class="shell-card-header">
          <div>
            <strong>CLI 生命周期</strong>
            <p class="shell-card-copy">默认在客户端内执行，不再直接把安装和升级甩给外部 Terminal。</p>
          </div>
          ${pillHtml(view.lastResult?.label || '待执行', view.lastResult?.result?.success ? 'good' : view.lastResult ? 'warn' : 'neutral')}
        </div>
        ${keyValueRowsHtml([
          { label: '安装', value: installation.quickInstallCommand },
          { label: '升级', value: installation.updateCommand },
          { label: '卸载', value: 'hermes uninstall --yes' },
          { label: '当前版本', value: versionLine },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'install-cli', label: view.runningAction === 'installation:install' ? (installation.binaryFound ? '重装中…' : '安装中…') : (installation.binaryFound ? '重装 CLI' : '安装 CLI'), kind: 'primary', disabled: Boolean(view.runningAction) })}
          ${buttonHtml({ action: 'update-cli', label: view.runningAction === 'installation:update' ? '升级中…' : '升级 CLI', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
          ${buttonHtml({ action: 'uninstall-cli', label: view.runningAction === 'installation:uninstall' ? '卸载中…' : '卸载 CLI', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
        </div>
      </section>
    </section>
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
            await runInstallationAction(view, 'install', '安装 CLI');
          }
          return;
        case 'doctor':
          await runDiagnostic(view, 'doctor', '健康检查');
          return;
        case 'install-cli':
          await runInstallationAction(view, 'install', installation.binaryFound ? '重装 CLI' : '安装 CLI');
          return;
        case 'update-cli':
          await runInstallationAction(view, 'update', '升级 CLI');
          return;
        case 'uninstall-cli':
          if (!window.confirm('确定卸载 Hermes CLI 吗？这会移除当前安装的命令行客户端。')) {
            return;
          }
          await runInstallationAction(view, 'uninstall', '卸载 CLI');
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
