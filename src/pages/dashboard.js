import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import { buildDiagnosticsDrilldownIntent, buildGatewayDrilldownIntent, buildLogsDrilldownIntent } from '../lib/drilldown';
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
  pillHtml,
  statusDotHtml,
} from './native-helpers';

let activeView = null;

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
  if (navigator.userAgent.includes('Mac')) {
    warnings.push('macOS 下交互式 setup / model / skills config 会转交给 Terminal 执行，完成后回面板刷新即可。');
  }

  view.page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">仪表盘</h1>
      <p class="page-desc">Hermes 运行状态概览。</p>
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
        <div class="stat-card-meta">${escapeHtml(installation.binaryFound ? installation.hermesBinary || 'CLI 已就绪' : '先安装后才能接管 setup、model、gateway 与 skills。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Model</span>
          ${statusDotHtml(modelReady ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(modelReady ? `${dashboard.config.modelProvider} / ${dashboard.config.modelDefault}` : '待配置')}</div>
        <div class="stat-card-meta">${escapeHtml(dashboard.config.modelBaseUrl || '建议先走官方 setup / model 向导，把 provider 与默认模型配齐。')}</div>
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
        <div class="stat-card-meta">${dependencyReadyCount === installation.dependencies.length ? 'CLI 周边依赖已齐备。' : '仍有缺失依赖，建议继续跑 doctor 或回终端补齐。'}</div>
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
        label: installation.binaryFound ? (gatewayRunning ? '重启 Gateway' : '启动 Gateway') : '一键安装 CLI',
        kind: 'primary',
        disabled: Boolean(view.runningAction),
      })}
      ${buttonHtml({ action: 'doctor', label: '健康检查', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'full-setup', label: '全量 Setup', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'configure-model', label: '配置模型', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
      ${buttonHtml({ action: 'goto-skills', label: '技能工作台' })}
      ${buttonHtml({ action: 'goto-memory', label: '记忆文件' })}
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', disabled: view.refreshing })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">控制闭环</h2>
          <p class="config-section-desc">把安装、升级、Setup、Gateway Service 与关键工作区入口集中在首页，减少在不同页来回找操作。</p>
        </div>
      </div>
      <div class="overview-grid">
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="overview-card-title">CLI 生命周期</div>
            <div class="overview-card-value">${escapeHtml(installation.binaryFound ? '安装 / 升级 / 卸载' : '等待安装')}</div>
            <div class="overview-card-meta">继续沿用 Hermes 官方安装与升级链路。</div>
            <p class="command-line">${escapeHtml(installation.binaryFound ? installation.updateCommand : installation.quickInstallCommand)}</p>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'install-cli', label: installation.binaryFound ? '重装 CLI' : '安装 CLI', kind: 'primary', disabled: Boolean(view.runningAction) })}
              ${buttonHtml({ action: 'update-cli', label: '升级 CLI', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'uninstall-cli', label: '卸载 CLI', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="overview-card-title">Profile 向导</div>
            <div class="overview-card-value">${escapeHtml(modelReady ? 'Setup 已落地' : '建议先走向导')}</div>
            <div class="overview-card-meta">setup、model、migrate 都保持原生命令。</div>
            <p class="command-line">${escapeHtml(installation.setupCommand)}</p>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'full-setup', label: '全量 Setup', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'configure-model', label: '配置模型', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'config-migrate', label: '迁移配置', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'claw-migrate', label: '导入 OpenClaw', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="overview-card-title">Tooling / Skills</div>
            <div class="overview-card-value">${escapeHtml(`${dashboard.counts.skills} 个技能 / ${dashboard.counts.configuredPlatforms} 个平台`)}</div>
            <div class="overview-card-meta">技能目录、tools 开关和扩展层都可以直接下钻。</div>
            <p class="command-line">${escapeHtml(installation.toolsSetupCommand)}</p>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'terminal-setup', label: '终端后端', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'tools-setup', label: '工具选择', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'skills-config', label: '技能开关', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'goto-skills', label: '进入技能页' })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="overview-card-title">Gateway Service</div>
            <div class="overview-card-value">${escapeHtml(gatewayRunning ? '服务已接管' : '等待 service 接管')}</div>
            <div class="overview-card-meta">service install / setup / uninstall 与 Finder 入口收敛在这里。</div>
            <p class="command-line">${escapeHtml(installation.gatewayInstallCommand)}</p>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'gateway-install', label: '安装 Service', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'gateway-setup', label: 'Gateway Setup', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'gateway-uninstall', label: '卸载 Service', kind: 'danger', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) || !installation.hermesHomeExists })}
              ${buttonHtml({ action: 'open-logs', label: '打开 Logs', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
            </div>
          </div>
        </section>
        <section class="overview-card">
          <div class="overview-card-body">
            <div class="overview-card-title">Memory / Plugins</div>
            <div class="overview-card-value">${escapeHtml(`${dashboard.config.memoryEnabled ? 'Memory On' : 'Memory Off'} / ${view.dashboard.config.memoryProvider || 'builtin-file'}`)}</div>
            <div class="overview-card-meta">记忆 provider、插件安装和文件编辑都已经形成闭环。</div>
            <p class="command-line">hermes memory setup · hermes memory status · hermes plugins</p>
            <div class="overview-card-actions toolbar">
              ${buttonHtml({ action: 'memory-setup', label: 'Provider 向导', kind: 'primary', disabled: Boolean(view.runningAction) || !installation.binaryFound })}
              ${buttonHtml({ action: 'goto-memory', label: '进入记忆页' })}
              ${buttonHtml({ action: 'goto-config', label: '回到配置页' })}
            </div>
          </div>
        </section>
      </div>
    </section>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">最近动作</h2>
            <p class="config-section-desc">无论是原生命令、Gateway 启停还是 Terminal 交接，最近一次动作都会回到这里。</p>
          </div>
          ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        </div>
        ${commandResultHtml(view.lastResult, '暂无动作输出', '先执行任一控制动作，这里会保留 Hermes 的原始命令结果。')}
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">工作区总览</h2>
            <p class="config-section-desc">关键文件、依赖与风险提示放在右侧，避免说明文案占掉主要控制区。</p>
          </div>
          ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
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
        <div class="artifact-grid">
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
    </div>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">最近日志</h2>
            <p class="config-section-desc">先看最近日志，再决定是继续进 Gateway、Config 还是 Diagnostics。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
            ${buttonHtml({ action: 'open-logs', label: '打开日志目录', disabled: Boolean(view.runningAction) || !installation.logsDirExists })}
          </div>
        </div>
        <div class="log-viewer">${view.logPreview?.lines?.length ? escapeHtml(view.logPreview.lines.join('\n')) : escapeHtml(view.logError || '当前没有读取到最近日志。')}</div>
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">最近会话</h2>
            <p class="config-section-desc">把最新的 session 快速露出来，方便从控制面板直接跳转继续查。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-sessions', label: '进入会话页' })}
            ${buttonHtml({ action: 'goto-gateway', label: '进入 Gateway' })}
          </div>
        </div>
        ${
          sessions.length
            ? `
              <div class="session-list">
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
        storeResult(view, nextLabel, result);
      },
      profile: view.profile,
      scope: options.scope,
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
            await runTerminalAction(view, 'terminal:quick-install', '一键安装 CLI', installation.quickInstallCommand, { scope: 'global' });
          }
          return;
        case 'doctor':
          await runDiagnostic(view, 'doctor', '健康检查');
          return;
        case 'install-cli':
          await runTerminalAction(view, 'terminal:install-cli', installation.binaryFound ? '重装 CLI' : '安装 CLI', installation.quickInstallCommand, { scope: 'global' });
          return;
        case 'update-cli':
          await runTerminalAction(view, 'terminal:update-cli', '升级 CLI', installation.updateCommand, { scope: 'global' });
          return;
        case 'uninstall-cli':
          await runTerminalAction(view, 'terminal:uninstall-cli', '卸载 CLI', installation.uninstallCommand, {
            scope: 'global',
            confirmMessage: '确定在 Terminal 中执行 `hermes uninstall` 吗？这会移除 Hermes CLI。',
          });
          return;
        case 'full-setup':
          await runTerminalAction(view, 'terminal:setup', '全量 Setup', installation.setupCommand);
          return;
        case 'configure-model':
          await runTerminalAction(view, 'terminal:model', '配置模型', installation.modelCommand);
          return;
        case 'config-migrate':
          await runTerminalAction(view, 'terminal:config-migrate', '迁移配置', installation.configMigrateCommand);
          return;
        case 'claw-migrate':
          await runTerminalAction(view, 'terminal:claw-migrate', '导入 OpenClaw', installation.clawMigrateCommand);
          return;
        case 'terminal-setup':
          await runTerminalAction(view, 'terminal:backend-setup', '终端后端', installation.terminalSetupCommand);
          return;
        case 'tools-setup':
          await runTerminalAction(view, 'terminal:tools-setup', '工具选择', installation.toolsSetupCommand);
          return;
        case 'skills-config':
          await runTerminalAction(view, 'terminal:skills-config', '技能开关', installation.skillsConfigCommand);
          return;
        case 'memory-setup':
          await runTerminalAction(view, 'terminal:memory-setup', '记忆 Provider', 'hermes memory setup');
          return;
        case 'gateway-install':
          await runTerminalAction(view, 'terminal:gateway-install', '安装 Gateway Service', installation.gatewayInstallCommand);
          return;
        case 'gateway-setup':
          await runTerminalAction(view, 'terminal:gateway-setup', 'Gateway Setup', installation.gatewaySetupCommand);
          return;
        case 'gateway-uninstall':
          await runTerminalAction(view, 'terminal:gateway-uninstall', '卸载 Gateway Service', installation.gatewayUninstallCommand, {
            confirmMessage: '确定卸载当前 profile 的 Gateway Service 吗？',
          });
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
        case 'goto-skills':
          navigate('skills');
          return;
        case 'goto-memory':
          navigate('memory');
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
