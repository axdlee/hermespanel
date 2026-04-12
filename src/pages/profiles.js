import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import { getPanelState, loadProfiles, navigate, notify, subscribePanelState } from '../lib/panel-state';
import {
  enabledToolCount,
  isRemoteDelivery,
  localRuntimeSkillCount,
  platformTone,
  totalToolCount,
} from '../lib/runtime';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
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

function uniqueNames(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function chooseCompareName(selectedName, items, activeProfile) {
  if (!selectedName) {
    return null;
  }

  const candidates = items.filter((item) => item.name !== selectedName);
  if (candidates.length === 0) {
    return null;
  }

  return candidates.find((item) => item.name === activeProfile)?.name ?? candidates[0].name;
}

function profileItems() {
  return getPanelState().profiles?.profiles ?? [];
}

function currentProfilesSnapshot() {
  return getPanelState().profiles;
}

function selectedProfile(view) {
  return profileItems().find((item) => item.name === view.selectedName) ?? null;
}

function compareProfile(view) {
  return profileItems().find((item) => item.name === view.compareName) ?? null;
}

function selectedRuntime(view) {
  return view.selectedName ? view.runtimeBundles[view.selectedName] ?? null : null;
}

function compareRuntime(view) {
  return view.compareName ? view.runtimeBundles[view.compareName] ?? null : null;
}

function runtimeLoading(view, profileName) {
  return Boolean(profileName && view.loadingRuntimeNames.includes(profileName));
}

function runtimeError(view, profileName) {
  return profileName ? view.runtimeErrors[profileName] ?? null : null;
}

function gatewayDot(state) {
  return state?.trim().toLowerCase() === 'running' ? 'running' : 'warning';
}

function toolsetLabel(bundle) {
  return bundle?.config.summary.toolsets.join(', ') || '—';
}

function remoteJobCount(bundle) {
  if (!bundle) {
    return 0;
  }

  return bundle.cron.jobs.filter((job) => isRemoteDelivery(job.deliver)).length;
}

function runtimeHealthWarnings(profile, bundle) {
  const warnings = [];

  if (!profile.envExists) {
    warnings.push('当前实例缺少 .env，很多 provider 与 gateway 认证不会真正生效。');
  }
  if (!profile.soulExists) {
    warnings.push('当前实例缺少 SOUL.md，agent 身份基线并不完整。');
  }
  if (bundle.dashboard.gateway?.gatewayState !== 'running' && remoteJobCount(bundle) > 0) {
    warnings.push('存在依赖 gateway 的远端 cron 作业，但当前 gateway 不在 running 状态。');
  }
  if (bundle.config.summary.memoryEnabled === false && bundle.cron.jobs.length > 0) {
    warnings.push('memory 当前关闭，但实例里已有自动化作业，长期记忆闭环会变弱。');
  }
  if (localRuntimeSkillCount(bundle.extensions) !== profile.skillCount) {
    warnings.push(`CLI 运行态 local skill 为 ${localRuntimeSkillCount(bundle.extensions)} 个，本地扫描为 ${profile.skillCount} 个，存在安装态偏差。`);
  }
  if (bundle.config.summary.memoryProvider && bundle.extensions.memoryRuntime.provider.includes('none')) {
    warnings.push(`配置声明了 memory provider「${bundle.config.summary.memoryProvider}」，但运行态仍像 built-in only。`);
  }

  return warnings;
}

function profileDrifts(leftProfile, leftBundle, rightProfile, rightBundle) {
  const drifts = [];

  if (leftBundle.config.summary.modelDefault !== rightBundle.config.summary.modelDefault) {
    drifts.push(`模型默认值不同：${leftProfile.name} 为 ${leftBundle.config.summary.modelDefault || '未配置'}，${rightProfile.name} 为 ${rightBundle.config.summary.modelDefault || '未配置'}。`);
  }
  if (leftBundle.config.summary.contextEngine !== rightBundle.config.summary.contextEngine) {
    drifts.push(`context.engine 不同：${leftProfile.name} 为 ${leftBundle.config.summary.contextEngine || '未配置'}，${rightProfile.name} 为 ${rightBundle.config.summary.contextEngine || '未配置'}。`);
  }
  if (leftBundle.config.summary.terminalBackend !== rightBundle.config.summary.terminalBackend) {
    drifts.push(`terminal.backend 不同：${leftProfile.name} 为 ${leftBundle.config.summary.terminalBackend || '未配置'}，${rightProfile.name} 为 ${rightBundle.config.summary.terminalBackend || '未配置'}。`);
  }
  if (leftBundle.config.summary.memoryProvider !== rightBundle.config.summary.memoryProvider) {
    drifts.push(`memory.provider 不同：${leftProfile.name} 为 ${leftBundle.config.summary.memoryProvider || 'builtin-file'}，${rightProfile.name} 为 ${rightBundle.config.summary.memoryProvider || 'builtin-file'}。`);
  }
  if (toolsetLabel(leftBundle) !== toolsetLabel(rightBundle)) {
    drifts.push(`toolsets 不同：${leftProfile.name} 为 [${toolsetLabel(leftBundle)}]，${rightProfile.name} 为 [${toolsetLabel(rightBundle)}]。`);
  }
  if (enabledToolCount(leftBundle.extensions) !== enabledToolCount(rightBundle.extensions)) {
    drifts.push(`可用工具面不同：${leftProfile.name} 启用 ${enabledToolCount(leftBundle.extensions)} 个，${rightProfile.name} 启用 ${enabledToolCount(rightBundle.extensions)} 个。`);
  }
  if (leftBundle.extensions.plugins.installedCount !== rightBundle.extensions.plugins.installedCount) {
    drifts.push(`插件安装态不同：${leftProfile.name} 为 ${leftBundle.extensions.plugins.installedCount} 个，${rightProfile.name} 为 ${rightBundle.extensions.plugins.installedCount} 个。`);
  }
  if (leftBundle.cron.jobs.length !== rightBundle.cron.jobs.length) {
    drifts.push(`自动化规模不同：${leftProfile.name} 有 ${leftBundle.cron.jobs.length} 个 cron 作业，${rightProfile.name} 有 ${rightBundle.cron.jobs.length} 个。`);
  }
  if (remoteJobCount(leftBundle) !== remoteJobCount(rightBundle)) {
    drifts.push(`远端交付依赖不同：${leftProfile.name} 有 ${remoteJobCount(leftBundle)} 个远端作业，${rightProfile.name} 有 ${remoteJobCount(rightBundle)} 个。`);
  }
  if (leftProfile.aliases.length !== rightProfile.aliases.length) {
    drifts.push(`Alias 策略不同：${leftProfile.name} 有 ${leftProfile.aliases.length} 个 alias，${rightProfile.name} 有 ${rightProfile.aliases.length} 个。`);
  }
  if (leftProfile.envExists !== rightProfile.envExists) {
    drifts.push(`.env 完整性不同：${leftProfile.name} 为 ${leftProfile.envExists ? 'exists' : 'missing'}，${rightProfile.name} 为 ${rightProfile.envExists ? 'exists' : 'missing'}。`);
  }

  return drifts;
}

function syncSelection(view) {
  const snapshot = currentProfilesSnapshot();
  const items = snapshot?.profiles ?? [];

  if (!items.length) {
    view.selectedName = null;
    view.compareName = null;
    view.removeAliasName = '';
    return;
  }

  const previousSelected = view.selectedName;
  const previousRemoveAlias = view.removeAliasName;
  const preferredSelected = items.some((item) => item.name === view.selectedName)
    ? view.selectedName
    : items.some((item) => item.name === view.profile)
      ? view.profile
      : items.some((item) => item.name === snapshot?.activeProfile)
        ? snapshot?.activeProfile
        : items[0]?.name;

  view.selectedName = preferredSelected ?? null;

  if (!items.some((item) => item.name === view.compareName) || view.compareName === view.selectedName) {
    view.compareName = chooseCompareName(view.selectedName, items, snapshot?.activeProfile);
  }

  if (!items.some((item) => item.name === view.cloneFrom)) {
    view.cloneFrom = snapshot?.activeProfile ?? items[0]?.name ?? 'default';
  }

  const current = selectedProfile(view);
  if (previousSelected !== view.selectedName) {
    view.renameTo = current && !current.isDefault ? current.name : '';
    view.exportOutput = current ? `${current.name}.tar.gz` : '';
    view.aliasName = current?.name ?? '';
    view.deleteConfirm = '';
    view.removeAliasConfirm = '';
  }

  if (!current) {
    view.removeAliasName = '';
    return;
  }

  if (!current.aliases.some((alias) => alias.name === view.removeAliasName)) {
    view.removeAliasName = current.aliases[0]?.name ?? '';
  }

  if (previousRemoveAlias !== view.removeAliasName) {
    view.removeAliasConfirm = '';
  }
}

function pruneRuntimeCache(view) {
  const names = new Set(profileItems().map((item) => item.name));

  Object.keys(view.runtimeBundles).forEach((name) => {
    if (!names.has(name)) {
      delete view.runtimeBundles[name];
    }
  });

  Object.keys(view.runtimeErrors).forEach((name) => {
    if (!names.has(name)) {
      delete view.runtimeErrors[name];
    }
  });
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">Profile 管理</h1>
      </div>
      <p class="page-desc">正在同步 Hermes profile 舰队、实例运行态和生命周期入口。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function renderFleetCards(view) {
  const snapshot = currentProfilesSnapshot();
  const items = snapshot?.profiles ?? [];
  const selected = selectedProfile(view);
  const selectedBundle = selectedRuntime(view);
  const selectedWarnings = selected && selectedBundle ? runtimeHealthWarnings(selected, selectedBundle) : [];
  const compared = selected && selectedBundle && compareProfile(view) && compareRuntime(view)
    ? profileDrifts(selected, selectedBundle, compareProfile(view), compareRuntime(view))
    : [];
  const totalAliases = items.reduce((sum, item) => sum + item.aliases.length, 0);
  const runtimeReady = items.filter((item) => Boolean(view.runtimeBundles[item.name])).length;
  const selectedInstallation = selectedBundle?.installation ?? null;

  return `
    <div class="stat-cards">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Profile Fleet</span>
        </div>
        <div class="stat-card-value">${escapeHtml(String(items.length))}</div>
        <div class="stat-card-meta">当前检测到的 Hermes 实例总数</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Default</span>
          ${statusDotHtml(snapshot?.activeProfile ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(snapshot?.activeProfile || '未识别')}</div>
        <div class="stat-card-meta">当前写回 Hermes 默认实例的 profile</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Selected Runtime</span>
          ${statusDotHtml(selectedBundle ? 'running' : runtimeLoading(view, view.selectedName) ? 'warning' : 'stopped')}
        </div>
        <div class="stat-card-value">${escapeHtml(selected ? selected.name : '未选择')}</div>
        <div class="stat-card-meta">${escapeHtml(selectedBundle ? `${enabledToolCount(selectedBundle.extensions)}/${totalToolCount(selectedBundle.extensions)} tools · ${selectedBundle.extensions.plugins.installedCount} plugins` : '等待运行态读取。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway / CLI</span>
          ${statusDotHtml(gatewayDot(selected?.gatewayState))}
        </div>
        <div class="stat-card-value">${escapeHtml(selected?.gatewayState || 'unknown')}</div>
        <div class="stat-card-meta">${escapeHtml(selectedInstallation ? (selectedInstallation.binaryFound ? 'CLI Ready' : 'CLI Missing') : '等待安装快照。')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Alias</span>
        </div>
        <div class="stat-card-value">${escapeHtml(String(totalAliases))}</div>
        <div class="stat-card-meta">${escapeHtml(selected ? `${selected.aliases.length} 个属于 ${selected.name}` : '所有 wrapper alias 总数')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Warnings / Drift</span>
          ${statusDotHtml(selectedWarnings.length === 0 && compared.length === 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${selectedWarnings.length}/${compared.length}`)}</div>
        <div class="stat-card-meta">${escapeHtml(`${runtimeReady}/${items.length} 个实例已缓存运行态`)}</div>
      </section>
    </div>
  `;
}

function renderProfileRail(view) {
  const items = profileItems();
  const selected = selectedProfile(view);

  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">实例列表</h2>
          <p class="config-section-desc">左侧选实例，右侧做接管、迁移和运行态对照。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'refresh-fleet', label: view.refreshing ? '同步中…' : '刷新列表', kind: 'primary', disabled: view.refreshing || Boolean(view.runningAction) })}
        </div>
      </div>
      ${
        items.length
          ? `
            <div class="list-stack profile-rail profile-rail-scroll">
              ${items.map((item) => `
                <button
                  type="button"
                  class="list-card session-card ${selected?.name === item.name ? 'selected' : ''}"
                  data-action="select-profile"
                  data-name="${escapeHtml(item.name)}"
                >
                  <div class="list-card-title">
                    <strong>${escapeHtml(item.name)}</strong>
                    <div class="pill-row">
                      ${item.isDefault ? pillHtml('default') : ''}
                      ${item.isActive ? pillHtml('active', 'good') : ''}
                      ${pillHtml(item.envExists ? '.env ok' : '.env missing', item.envExists ? 'good' : 'warn')}
                    </div>
                  </div>
                  <p>${escapeHtml(item.homePath)}</p>
                  <div class="meta-line">
                    <span>${escapeHtml(item.modelDefault || '未配置模型')}</span>
                    <span>${escapeHtml(`${item.aliases.length} alias · ${item.skillCount} skills`)}</span>
                  </div>
                </button>
              `).join('')}
            </div>
          `
          : emptyStateHtml('尚未发现 profile', '当前没有可管理的 Hermes profile。')
      }
    </section>
  `;
}

function renderWorkbench(view) {
  const selected = selectedProfile(view);
  const bundle = selectedRuntime(view);
  const installation = bundle?.installation ?? null;
  const warnings = selected && bundle ? runtimeHealthWarnings(selected, bundle) : [];
  const loading = runtimeLoading(view, selected?.name);
  const error = runtimeError(view, selected?.name);

  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">当前实例工作台</h2>
          <p class="config-section-desc">把 Finder、Terminal、官方向导和实例恢复点集中在一处，不再分散到多个页头说明里。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'goto-config', label: '配置中心', disabled: !selected })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展能力', disabled: !selected })}
          ${buttonHtml({ action: 'goto-logs', label: '日志查看', disabled: !selected })}
          ${buttonHtml({ action: 'refresh-selected-runtime', label: loading ? '刷新中…' : '刷新实例', kind: 'primary', disabled: !selected || loading || Boolean(view.runningAction) })}
        </div>
      </div>
      ${
        !selected
          ? emptyStateHtml('未选择实例', '从左侧选择一个 Hermes profile 后，这里会显示它的治理入口。')
          : `
            <div class="service-card">
              <div class="service-info">
                ${statusDotHtml(gatewayDot(selected.gatewayState))}
                <div>
                  <div class="service-name">${escapeHtml(selected.name)}</div>
                  <div class="service-desc service-path">${escapeHtml(selected.homePath)}</div>
                  <div class="pill-row top-gap">
                    ${selected.isDefault ? pillHtml('default') : ''}
                    ${selected.isActive ? pillHtml('active', 'good') : pillHtml('not default', 'warn')}
                    ${pillHtml(selected.envExists ? '.env ready' : '.env missing', selected.envExists ? 'good' : 'warn')}
                    ${pillHtml(selected.soulExists ? 'SOUL ready' : 'SOUL missing', selected.soulExists ? 'good' : 'warn')}
                    ${pillHtml(selected.gatewayState || 'gateway unknown', platformTone(selected.gatewayState))}
                  </div>
                </div>
              </div>
              <div class="service-actions">
                ${buttonHtml({ action: 'open-home', label: '打开目录', disabled: Boolean(view.runningAction) })}
                ${buttonHtml({ action: 'open-config', label: '定位配置', disabled: Boolean(view.runningAction) || !bundle })}
                ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: Boolean(view.runningAction) || !bundle })}
                ${buttonHtml({
                  action: 'set-default',
                  label: view.runningAction === `activate:${selected.name}` ? '同步中…' : selected.isActive ? '已是默认' : '设为默认',
                  kind: 'primary',
                  disabled: selected.isActive || Boolean(view.runningAction),
                })}
              </div>
            </div>
            ${
              loading && !bundle
                ? emptyStateHtml('正在读取实例运行态', 'dashboard / config / extensions / cron / installation 快照会一起同步。')
                : error && !bundle
                  ? emptyStateHtml('实例运行态读取失败', error)
                  : `
                    <div class="metrics-grid metrics-grid-tight top-gap">
                      <div class="metric-card">
                        <p class="metric-label">Sessions</p>
                        <div class="metric-value">${escapeHtml(String(selected.sessionCount))}</div>
                        <p class="metric-hint">当前实例已收集的会话数</p>
                      </div>
                      <div class="metric-card">
                        <p class="metric-label">Skills</p>
                        <div class="metric-value">${escapeHtml(String(selected.skillCount))}</div>
                        <p class="metric-hint">本地扫描到的技能数量</p>
                      </div>
                      <div class="metric-card">
                        <p class="metric-label">Alias</p>
                        <div class="metric-value">${escapeHtml(String(selected.aliases.length))}</div>
                        <p class="metric-hint">${escapeHtml(selected.aliasPath || '当前未识别主 alias')}</p>
                      </div>
                      <div class="metric-card">
                        <p class="metric-label">Warnings</p>
                        <div class="metric-value">${escapeHtml(String(warnings.length))}</div>
                        <p class="metric-hint">${escapeHtml(bundle ? `${remoteJobCount(bundle)} 个远端作业 · ${bundle.extensions.plugins.installedCount} 个插件` : '等待运行态。')}</p>
                      </div>
                    </div>

                    <div class="control-card-grid top-gap">
                      <section class="action-card action-card-compact">
                        <div class="action-card-header">
                          <div>
                            <p class="eyebrow">Bootstrap</p>
                            <h3 class="action-card-title">官方向导</h3>
                          </div>
                          ${pillHtml(installation?.binaryFound ? 'CLI ready' : 'CLI missing', installation?.binaryFound ? 'good' : 'bad')}
                        </div>
                        <p class="action-card-copy">继续使用 Hermes 官方 setup、model 与 gateway setup，客户端只做入口编排。</p>
                        <p class="command-line">${escapeHtml(installation ? `${installation.setupCommand} · ${installation.modelCommand} · ${installation.gatewaySetupCommand}` : '等待安装快照。')}</p>
                        <div class="toolbar">
                          ${buttonHtml({ action: 'terminal-setup', label: '全量 Setup', kind: 'primary', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                          ${buttonHtml({ action: 'terminal-model', label: '模型 / Provider', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                          ${buttonHtml({ action: 'terminal-gateway-setup', label: 'Gateway Setup', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                        </div>
                      </section>
                      <section class="action-card action-card-compact">
                        <div class="action-card-header">
                          <div>
                            <p class="eyebrow">Capability</p>
                            <h3 class="action-card-title">能力面接管</h3>
                          </div>
                          ${pillHtml(bundle ? `${enabledToolCount(bundle.extensions)} tools` : '等待读取', bundle && enabledToolCount(bundle.extensions) > 0 ? 'good' : 'warn')}
                        </div>
                        <p class="action-card-copy">围绕 tools、skills、memory 和 plugins 做 profile 级治理，不改 Hermes 本身。</p>
                        <p class="command-line">${escapeHtml(installation ? `${installation.toolsSetupCommand} · ${installation.skillsConfigCommand} · hermes memory setup · hermes plugins` : '等待安装快照。')}</p>
                        <div class="toolbar">
                          ${buttonHtml({ action: 'terminal-tools', label: '工具选择', kind: 'primary', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                          ${buttonHtml({ action: 'terminal-skills', label: '技能开关', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                          ${buttonHtml({ action: 'terminal-memory', label: '记忆 Provider', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                          ${buttonHtml({ action: 'terminal-plugins', label: '插件面板', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                        </div>
                      </section>
                      <section class="action-card action-card-compact">
                        <div class="action-card-header">
                          <div>
                            <p class="eyebrow">Artifacts</p>
                            <h3 class="action-card-title">恢复点与物料</h3>
                          </div>
                          ${pillHtml(warnings.length === 0 ? '姿态稳定' : `${warnings.length} 条提醒`, warnings.length === 0 ? 'good' : 'warn')}
                        </div>
                        <p class="action-card-copy">先确认关键文件是否齐全，再决定是迁移、导出还是回滚。</p>
                        <div class="pill-row">
                          ${pillHtml(installation?.configExists ? 'config.yaml' : 'config missing', installation?.configExists ? 'good' : 'warn')}
                          ${pillHtml(installation?.envExists ? '.env' : '.env missing', installation?.envExists ? 'good' : 'warn')}
                          ${pillHtml(installation?.stateDbExists ? 'state.db' : 'state missing', installation?.stateDbExists ? 'good' : 'warn')}
                          ${pillHtml(installation?.gatewayStateExists ? 'gateway_state' : 'gateway state missing', installation?.gatewayStateExists ? 'good' : 'warn')}
                          ${pillHtml(installation?.logsDirExists ? 'logs' : 'logs missing', installation?.logsDirExists ? 'good' : 'warn')}
                        </div>
                        <div class="toolbar top-gap">
                          ${buttonHtml({ action: 'open-state-db', label: '定位 state.db', disabled: Boolean(view.runningAction) || !installation?.stateDbExists })}
                          ${buttonHtml({ action: 'open-gateway-state', label: '定位网关状态', disabled: Boolean(view.runningAction) || !installation?.gatewayStateExists })}
                          ${buttonHtml({ action: 'open-logs-dir', label: '打开 logs', disabled: Boolean(view.runningAction) || !installation?.logsDirExists })}
                          ${buttonHtml({ action: 'terminal-status', label: '查看实例状态', disabled: Boolean(view.runningAction) || !installation?.binaryFound })}
                        </div>
                      </section>
                      <section class="action-card action-card-compact">
                        <div class="action-card-header">
                          <div>
                            <p class="eyebrow">Flow</p>
                            <h3 class="action-card-title">治理跳转</h3>
                          </div>
                          ${pillHtml(bundle?.dashboard.gateway?.gatewayState || 'unknown', platformTone(bundle?.dashboard.gateway?.gatewayState))}
                        </div>
                        <p class="action-card-copy">需要继续深入时，直接带着当前实例切换到配置、扩展、日志或诊断面。</p>
                        <p class="command-line">${escapeHtml(bundle ? `${bundle.config.summary.modelProvider || 'provider 未配置'} / ${bundle.config.summary.modelDefault || 'model 未配置'} · ${toolsetLabel(bundle)}` : '等待运行态摘要。')}</p>
                        <div class="toolbar">
                          ${buttonHtml({ action: 'goto-config', label: '配置中心', kind: 'primary' })}
                          ${buttonHtml({ action: 'goto-extensions', label: '扩展能力' })}
                          ${buttonHtml({ action: 'goto-logs', label: '日志查看' })}
                          ${buttonHtml({ action: 'goto-diagnostics', label: '诊断面板' })}
                        </div>
                      </section>
                    </div>
                  `
            }
          `
      }
    </section>
  `;
}

function renderRuntimeSection(view) {
  const selected = selectedProfile(view);
  const bundle = selectedRuntime(view);
  const loading = runtimeLoading(view, selected?.name);
  const error = runtimeError(view, selected?.name);
  const warnings = selected && bundle ? runtimeHealthWarnings(selected, bundle) : [];

  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">运行态画像</h2>
          <p class="config-section-desc">把 dashboard、config、extensions、cron 合在一起看，避免只剩“能读不能控”的半成品体验。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'goto-sessions', label: '会话浏览', disabled: !selected })}
          ${buttonHtml({ action: 'refresh-selected-runtime', label: loading ? '刷新中…' : '刷新运行态', kind: 'primary', disabled: !selected || loading || Boolean(view.runningAction) })}
        </div>
      </div>
      ${
        !selected
          ? emptyStateHtml('未选择实例', '先从左侧选择一个 profile。')
          : loading && !bundle
            ? emptyStateHtml('正在读取运行态', '即将展示 config、gateway、tools、plugins 与 cron。')
            : error && !bundle
              ? emptyStateHtml('运行态读取失败', error)
              : bundle
                ? `
                  <div class="metrics-grid">
                    <div class="metric-card">
                      <p class="metric-label">Tools</p>
                      <div class="metric-value">${escapeHtml(`${enabledToolCount(bundle.extensions)}/${totalToolCount(bundle.extensions)}`)}</div>
                      <p class="metric-hint">当前 profile 实际启用的工具总量</p>
                    </div>
                    <div class="metric-card">
                      <p class="metric-label">Runtime Skills</p>
                      <div class="metric-value">${escapeHtml(String(bundle.extensions.runtimeSkills.length))}</div>
                      <p class="metric-hint">来自 <code>hermes skills list</code> 的安装态</p>
                    </div>
                    <div class="metric-card">
                      <p class="metric-label">Plugins</p>
                      <div class="metric-value">${escapeHtml(String(bundle.extensions.plugins.installedCount))}</div>
                      <p class="metric-hint">当前运行态识别到的插件数</p>
                    </div>
                    <div class="metric-card">
                      <p class="metric-label">Cron / Remote</p>
                      <div class="metric-value">${escapeHtml(`${bundle.cron.jobs.length} / ${remoteJobCount(bundle)}`)}</div>
                      <p class="metric-hint">总作业数 / 依赖 gateway 的作业数</p>
                    </div>
                  </div>
                  <div class="health-grid top-gap">
                    <section class="health-card">
                      <div class="health-card-header">
                        <strong>Config Runtime</strong>
                        ${pillHtml(bundle.config.summary.terminalBackend || 'backend missing', bundle.config.summary.terminalBackend ? 'good' : 'warn')}
                      </div>
                      <p>${escapeHtml(`${bundle.config.summary.modelProvider || 'provider 未配置'} / ${bundle.config.summary.modelDefault || 'model 未配置'} · Memory ${bundle.config.summary.memoryProvider || 'builtin-file'}`)}</p>
                    </section>
                    <section class="health-card">
                      <div class="health-card-header">
                        <strong>Gateway Runtime</strong>
                        ${pillHtml(bundle.dashboard.gateway?.gatewayState || '未检测到', platformTone(bundle.dashboard.gateway?.gatewayState))}
                      </div>
                      <p>${escapeHtml(`Platforms ${bundle.dashboard.gateway?.platforms.length ?? 0} · Remote Jobs ${remoteJobCount(bundle)}`)}</p>
                    </section>
                    <section class="health-card">
                      <div class="health-card-header">
                        <strong>Toolsets</strong>
                        ${pillHtml(String(bundle.config.summary.toolsets.length), bundle.config.summary.toolsets.length > 0 ? 'good' : 'warn')}
                      </div>
                      <p>${escapeHtml(toolsetLabel(bundle))}</p>
                    </section>
                    <section class="health-card">
                      <div class="health-card-header">
                        <strong>Memory Surface</strong>
                        ${pillHtml(bundle.extensions.memoryRuntime.provider, bundle.extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good')}
                      </div>
                      <p>${escapeHtml(`Built-in ${bundle.extensions.memoryRuntime.builtInStatus} · Local Skills ${localRuntimeSkillCount(bundle.extensions)}`)}</p>
                    </section>
                  </div>
                  ${
                    warnings.length
                      ? `
                        <div class="warning-stack top-gap">
                          ${warnings.map((item) => `<div class="warning-item">${escapeHtml(item)}</div>`).join('')}
                        </div>
                      `
                      : emptyStateHtml('运行态较完整', '当前实例没有出现明显的结构性缺口，可以继续做迁移或对照。')
                  }
                `
                : emptyStateHtml('运行态暂未就绪', '可以先刷新实例，或直接从工作台进入官方向导。')
      }
    </section>
  `;
}

function renderCompareSection(view) {
  const leftProfile = selectedProfile(view);
  const leftBundle = selectedRuntime(view);
  const rightProfileValue = compareProfile(view);
  const rightBundle = compareRuntime(view);
  const rightLoading = runtimeLoading(view, rightProfileValue?.name);
  const drifts = leftProfile && leftBundle && rightProfileValue && rightBundle
    ? profileDrifts(leftProfile, leftBundle, rightProfileValue, rightBundle)
    : [];

  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">实例对照</h2>
          <p class="config-section-desc">多 profile 环境最核心的价值之一，就是把运行差异直接摊平做对照，而不是肉眼翻文件。</p>
        </div>
        <div class="toolbar">
          <select class="select-input" id="profiles-compare-select" ${!leftProfile || profileItems().length < 2 ? 'disabled' : ''}>
            ${
              leftProfile
                ? profileItems()
                  .filter((item) => item.name !== leftProfile.name)
                  .map((item) => `
                    <option value="${escapeHtml(item.name)}" ${item.name === view.compareName ? 'selected' : ''}>
                      ${escapeHtml(item.name)}
                    </option>
                  `).join('')
                : '<option value="">暂无对照目标</option>'
            }
          </select>
          ${buttonHtml({ action: 'refresh-compare-runtime', label: rightLoading ? '刷新中…' : '刷新对照', disabled: !rightProfileValue || rightLoading || Boolean(view.runningAction) })}
        </div>
      </div>
      ${
        leftProfile && leftBundle && rightProfileValue && rightBundle
          ? `
            <div class="two-column profile-actions-grid">
              <div class="list-card">
                <div class="list-card-title">
                  <strong>${escapeHtml(leftProfile.name)}</strong>
                  <div class="pill-row">
                    ${leftProfile.isActive ? pillHtml('active', 'good') : ''}
                    ${leftProfile.isDefault ? pillHtml('default') : ''}
                  </div>
                </div>
                ${keyValueRowsHtml([
                  { label: '模型', value: leftBundle.config.summary.modelDefault || '—' },
                  { label: 'Context', value: leftBundle.config.summary.contextEngine || '—' },
                  { label: 'Backend', value: leftBundle.config.summary.terminalBackend || '—' },
                  { label: 'Memory', value: leftBundle.config.summary.memoryProvider || 'builtin-file' },
                  { label: 'Toolsets', value: toolsetLabel(leftBundle) },
                  { label: '工具面', value: `${enabledToolCount(leftBundle.extensions)}/${totalToolCount(leftBundle.extensions)}` },
                  { label: '插件数', value: String(leftBundle.extensions.plugins.installedCount) },
                  { label: 'Cron / 远端', value: `${leftBundle.cron.jobs.length} / ${remoteJobCount(leftBundle)}` },
                ])}
              </div>
              <div class="list-card">
                <div class="list-card-title">
                  <strong>${escapeHtml(rightProfileValue.name)}</strong>
                  <div class="pill-row">
                    ${rightProfileValue.isActive ? pillHtml('active', 'good') : ''}
                    ${rightProfileValue.isDefault ? pillHtml('default') : ''}
                  </div>
                </div>
                ${keyValueRowsHtml([
                  { label: '模型', value: rightBundle.config.summary.modelDefault || '—' },
                  { label: 'Context', value: rightBundle.config.summary.contextEngine || '—' },
                  { label: 'Backend', value: rightBundle.config.summary.terminalBackend || '—' },
                  { label: 'Memory', value: rightBundle.config.summary.memoryProvider || 'builtin-file' },
                  { label: 'Toolsets', value: toolsetLabel(rightBundle) },
                  { label: '工具面', value: `${enabledToolCount(rightBundle.extensions)}/${totalToolCount(rightBundle.extensions)}` },
                  { label: '插件数', value: String(rightBundle.extensions.plugins.installedCount) },
                  { label: 'Cron / 远端', value: `${rightBundle.cron.jobs.length} / ${remoteJobCount(rightBundle)}` },
                ])}
              </div>
            </div>
            ${
              drifts.length
                ? `
                  <div class="warning-stack top-gap">
                    ${drifts.map((item) => `<div class="warning-item">${escapeHtml(item)}</div>`).join('')}
                  </div>
                `
                : emptyStateHtml('两侧运行态接近', '当前两个实例没有明显的配置或能力面漂移。')
            }
          `
          : emptyStateHtml('暂无可对照目标', '至少需要两个 profile，且两边运行态都读取完成后，才能做差异对照。')
      }
    </section>
  `;
}

function renderLifecycleSection(view) {
  const current = selectedProfile(view);

  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">生命周期动作台</h2>
          <p class="config-section-desc">创建、克隆、导入、导出、重命名都走 Hermes 原生命令，客户端只负责把动作闭环串起来。</p>
        </div>
      </div>
      <div class="two-column profile-actions-grid">
        <section class="panel panel-nested">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">创建 Profile</h3>
              <p class="panel-subtitle">支持空白新建、克隆配置、完整克隆。</p>
            </div>
            ${buttonHtml({ action: 'create-profile', label: view.runningAction === 'create-profile' ? '创建中…' : '创建', kind: 'primary', disabled: Boolean(view.runningAction) })}
          </div>
          <div class="form-grid">
            <label class="field-stack">
              <span>Profile 名称</span>
              <input class="search-input" id="profiles-create-name" value="${escapeHtml(view.createName)}" placeholder="ops / research / coding">
            </label>
            <label class="field-stack">
              <span>创建模式</span>
              <select class="select-input" id="profiles-create-mode">
                <option value="fresh" ${view.createMode === 'fresh' ? 'selected' : ''}>空白新建</option>
                <option value="clone" ${view.createMode === 'clone' ? 'selected' : ''}>克隆配置</option>
                <option value="clone-all" ${view.createMode === 'clone-all' ? 'selected' : ''}>完整克隆</option>
              </select>
            </label>
            <label class="field-stack">
              <span>克隆来源</span>
              <select class="select-input" id="profiles-clone-from" ${view.createMode === 'fresh' ? 'disabled' : ''}>
                ${profileItems().map((item) => `
                  <option value="${escapeHtml(item.name)}" ${item.name === view.cloneFrom ? 'selected' : ''}>
                    ${escapeHtml(item.name)}
                  </option>
                `).join('')}
              </select>
            </label>
            <label class="field-stack">
              <span>Alias 策略</span>
              <div class="checkbox-row single">
                <label>
                  <input type="checkbox" id="profiles-no-alias" ${view.noAlias ? 'checked' : ''}>
                  <span>跳过 wrapper alias 创建</span>
                </label>
              </div>
            </label>
          </div>
        </section>
        <section class="panel panel-nested">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">导入 Profile</h3>
              <p class="panel-subtitle">支持把归档实例导回 Hermes 环境。</p>
            </div>
            ${buttonHtml({ action: 'import-profile', label: view.runningAction === 'import-profile' ? '导入中…' : '导入', kind: 'primary', disabled: Boolean(view.runningAction) })}
          </div>
          <div class="form-grid">
            <label class="field-stack">
              <span>Archive 路径</span>
              <input class="search-input" id="profiles-import-archive" value="${escapeHtml(view.importArchive)}" placeholder="/Users/you/backups/ops.tar.gz">
            </label>
            <label class="field-stack">
              <span>导入名称</span>
              <input class="search-input" id="profiles-import-name" value="${escapeHtml(view.importName)}" placeholder="留空则由 Hermes 自动推断">
            </label>
          </div>
        </section>
        <section class="panel panel-nested">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">重命名 Profile</h3>
              <p class="panel-subtitle">仅支持非 default 实例。</p>
            </div>
            ${buttonHtml({ action: 'rename-profile', label: view.runningAction === 'rename-profile' ? '重命名中…' : '重命名', disabled: !current || current.isDefault || Boolean(view.runningAction) })}
          </div>
          <label class="field-stack">
            <span>新名称</span>
            <input class="search-input" id="profiles-rename-to" value="${escapeHtml(view.renameTo)}" ${!current || current.isDefault ? 'disabled' : ''} placeholder="新的 profile 名称">
          </label>
          ${current?.isDefault ? '<p class="helper-text">default 是 Hermes 保留实例，不能重命名。</p>' : ''}
        </section>
        <section class="panel panel-nested">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">导出 Profile</h3>
              <p class="panel-subtitle">归档后可用于迁移、备份或回滚。</p>
            </div>
            ${buttonHtml({ action: 'export-profile', label: view.runningAction === 'export-profile' ? '导出中…' : '导出', disabled: !current || Boolean(view.runningAction) })}
          </div>
          <label class="field-stack">
            <span>输出路径</span>
            <input class="search-input" id="profiles-export-output" value="${escapeHtml(view.exportOutput)}" ${!current ? 'disabled' : ''} placeholder="ops-backup.tar.gz">
          </label>
          <p class="helper-text">留空则由 Hermes 使用默认 &lt;name&gt;.tar.gz。</p>
        </section>
      </div>
    </section>
  `;
}

function renderAliasSection(view) {
  const current = selectedProfile(view);

  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">Alias 管理</h2>
          <p class="config-section-desc">直接接管 <code>hermes profile alias</code> 的创建与移除，让 wrapper alias 真正可治理。</p>
        </div>
      </div>
      ${
        !current
          ? emptyStateHtml('未选择实例', '选择一个 profile 后才能管理 alias。')
          : `
            ${
              current.aliases.length
                ? `
                  <div class="list-stack">
                    ${current.aliases.map((alias) => `
                      <div class="list-card">
                        <div class="list-card-title">
                          <strong>${escapeHtml(alias.name)}</strong>
                          <div class="pill-row">
                            ${alias.isPrimary ? pillHtml('primary') : ''}
                          </div>
                        </div>
                        <p>${escapeHtml(alias.path)}</p>
                        <div class="toolbar">
                          ${buttonHtml({ action: 'open-alias', label: 'Finder 中定位', attrs: { 'data-name': alias.name, 'data-path': alias.path } })}
                        </div>
                      </div>
                    `).join('')}
                  </div>
                `
                : emptyStateHtml('暂无 Alias', '当前实例还没有可用的 wrapper alias，可以直接在下面创建。')
            }
            <div class="two-column profile-actions-grid top-gap">
              <section class="panel panel-nested">
                <div class="panel-header">
                  <div>
                    <h3 class="panel-title">创建 / 更新 Alias</h3>
                    <p class="panel-subtitle">默认会回退到当前 profile 名称。</p>
                  </div>
                  ${buttonHtml({ action: 'create-alias', label: view.runningAction === 'create-alias' ? '创建中…' : '创建 / 更新', kind: 'primary', disabled: Boolean(view.runningAction) })}
                </div>
                <label class="field-stack">
                  <span>Alias 名称</span>
                  <input class="search-input" id="profiles-alias-name" value="${escapeHtml(view.aliasName)}" placeholder="留空时回退到 profile 名称">
                </label>
              </section>
              <section class="panel panel-nested">
                <div class="panel-header">
                  <div>
                    <h3 class="panel-title">删除 Alias</h3>
                    <p class="panel-subtitle">需要输入完整 alias 名称确认。</p>
                  </div>
                  ${buttonHtml({ action: 'delete-alias', label: view.runningAction === 'delete-alias' ? '删除中…' : '删除 Alias', kind: 'danger', disabled: !current.aliases.length || Boolean(view.runningAction) })}
                </div>
                <div class="danger-copy danger-copy-compact">
                  <strong>删除 wrapper alias</strong>
                  <p>只影响快捷命令入口，不会删除 profile 自身数据。</p>
                </div>
                <div class="form-grid">
                  <label class="field-stack">
                    <span>删除目标</span>
                    <select class="select-input" id="profiles-remove-alias" ${current.aliases.length === 0 ? 'disabled' : ''}>
                      ${
                        current.aliases.length
                          ? current.aliases.map((alias) => `
                            <option value="${escapeHtml(alias.name)}" ${alias.name === view.removeAliasName ? 'selected' : ''}>
                              ${escapeHtml(alias.name)}
                            </option>
                          `).join('')
                          : '<option value="">当前没有 alias</option>'
                      }
                    </select>
                  </label>
                  <label class="field-stack">
                    <span>确认名称</span>
                    <input class="search-input" id="profiles-remove-alias-confirm" value="${escapeHtml(view.removeAliasConfirm)}" ${current.aliases.length === 0 ? 'disabled' : ''} placeholder="${escapeHtml(view.removeAliasName || '选择一个 alias')}">
                  </label>
                </div>
              </section>
            </div>
          `
      }
    </section>
  `;
}

function renderDangerAndOutput(view) {
  const current = selectedProfile(view);

  return `
    <div class="two-column profile-actions-grid">
      <section class="panel panel-nested panel-danger">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">危险区</h3>
            <p class="panel-subtitle">删除前需要输入完整 profile 名称确认。</p>
          </div>
          ${buttonHtml({ action: 'delete-profile', label: view.runningAction === 'delete-profile' ? '删除中…' : '删除 Profile', kind: 'danger', disabled: !current || current.isDefault || Boolean(view.runningAction) })}
        </div>
        ${
          current
            ? `
              <div class="danger-copy danger-copy-compact">
                <strong>删除 Hermes profile</strong>
                <p>${escapeHtml(current.homePath)}</p>
                <p>会删除该实例目录及其会话、技能、配置、记忆和运行状态。</p>
              </div>
              <label class="field-stack">
                <span>确认名称</span>
                <input class="search-input" id="profiles-delete-confirm" value="${escapeHtml(view.deleteConfirm)}" ${current.isDefault ? 'disabled' : ''} placeholder="${escapeHtml(current.name)}">
              </label>
              ${current.isDefault ? '<p class="helper-text">default 是 Hermes 保留实例，客户端不允许删除。</p>' : ''}
            `
            : emptyStateHtml('未选择实例', '选择一个非 default profile 后才能进入删除确认。')
        }
      </section>
      <section class="panel panel-nested">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">命令输出</h3>
            <p class="panel-subtitle">保留最近一次 lifecycle、Finder 或 Terminal 接管结果。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行命令', '这里会显示 profile create、alias、rename、export、import、delete 的原始结果。')}
      </section>
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  syncSelection(view);
  pruneRuntimeCache(view);

  if (view.loading && !profileItems().length) {
    renderSkeleton(view);
    return;
  }

  if (view.error && !profileItems().length) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">Profile 管理</h1>
        </div>
        <p class="page-desc">以 profile 为核心做实例治理、迁移和能力面闭环。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">profile 工作台快照暂时不可用，可以直接重试。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 profile 快照', view.error)}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh-fleet', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">Profile 管理</h1>
        ${infoTipHtml('以实例为中心治理 Hermes profile，主操作集中在工作台、生命周期和对照区，说明文案尽量后置为提示。')}
      </div>
      <p class="page-desc">围绕实例切换、安装接管、导入导出、alias 和运行态差异做桌面闭环，不改 Hermes 本体。</p>
    </div>

    ${renderFleetCards(view)}

    <div class="two-column wide-left">
      ${renderProfileRail(view)}
      <div class="page-stack">
        ${renderWorkbench(view)}
        ${renderRuntimeSection(view)}
        ${renderCompareSection(view)}
        ${renderLifecycleSection(view)}
        ${renderAliasSection(view)}
        ${renderDangerAndOutput(view)}
      </div>
    </div>
  `;

  bindEvents(view);
  ensureVisibleRuntime(view);
}

async function loadRuntimeBundle(view, profileName, force = false, options = {}) {
  if (!profileName || view.destroyed) {
    return null;
  }

  if (!force && view.runtimeBundles[profileName]) {
    return view.runtimeBundles[profileName];
  }

  if (view.loadingRuntimeNames.includes(profileName)) {
    return null;
  }

  view.loadingRuntimeNames = [...view.loadingRuntimeNames, profileName];
  delete view.runtimeErrors[profileName];
  if (!options.quiet) {
    renderPage(view);
  }

  try {
    const [dashboard, config, extensions, cron, installation] = await Promise.all([
      api.getDashboardSnapshot(profileName),
      api.getConfigDocuments(profileName),
      api.getExtensionsSnapshot(profileName),
      api.getCronJobs(profileName),
      api.getInstallationSnapshot(profileName),
    ]);

    if (view.destroyed) {
      return null;
    }

    view.runtimeBundles[profileName] = {
      config,
      cron,
      dashboard,
      extensions,
      installation,
    };
    return view.runtimeBundles[profileName];
  } catch (reason) {
    if (!view.destroyed) {
      view.runtimeErrors[profileName] = String(reason);
      notify('error', `${profileName} 运行态读取失败：${String(reason)}`);
    }
    return null;
  } finally {
    view.loadingRuntimeNames = view.loadingRuntimeNames.filter((item) => item !== profileName);
    renderPage(view);
  }
}

function ensureVisibleRuntime(view) {
  uniqueNames([view.selectedName, view.compareName]).forEach((name) => {
    if (!view.runtimeBundles[name] && !view.loadingRuntimeNames.includes(name)) {
      void loadRuntimeBundle(view, name, false, { quiet: true });
    }
  });
}

async function loadData(view, options = {}) {
  const { includeProfiles = false, preferredProfile, silent = false } = options;
  const hasProfiles = profileItems().length > 0;

  if (!silent && !hasProfiles) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    if (includeProfiles) {
      await loadProfiles(preferredProfile ?? view.selectedName ?? view.profile);
    }

    view.profile = getPanelState().selectedProfile;
    syncSelection(view);
  } catch (reason) {
    if (!view.destroyed) {
      view.error = String(reason);
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
  const selectedChanged = shell.selectedProfile !== view.profile;

  view.profile = shell.selectedProfile;
  if (selectedChanged) {
    view.selectedName = shell.selectedProfile;
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

async function refreshProfileWorkspace(view, preferredProfile) {
  await loadData(view, {
    includeProfiles: true,
    preferredProfile,
    silent: true,
  });

  await Promise.all(
    uniqueNames([preferredProfile ?? view.selectedName, view.compareName]).map((name) => loadRuntimeBundle(view, name, true, { quiet: true })),
  );
}

async function openFinderAction(view, path, label, revealInFinder = false) {
  if (!path) {
    notify('error', `${label} 路径为空。`);
    return;
  }

  view.runningAction = `finder:${label}`;
  renderPage(view);
  try {
    await openFinderLocation({
      actionKey: `finder:${label}`,
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

async function openTerminalAction(view, profileName, actionKey, label, command, options = {}) {
  const bundle = profileName ? view.runtimeBundles[profileName] ?? null : null;

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
      profile: profileName,
      scope: options.scope,
      setBusy: (value) => {
        view.runningAction = value;
        renderPage(view);
      },
      workingDirectory: options.workingDirectory ?? (bundle?.installation.hermesHomeExists ? bundle.installation.hermesHome : null),
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function createProfileAction(view) {
  const normalizedName = view.createName.trim();
  if (!normalizedName) {
    notify('error', 'profile 名称不能为空。');
    return;
  }

  view.runningAction = 'create-profile';
  renderPage(view);

  try {
    const result = await api.createProfile({
      profileName: normalizedName,
      clone: view.createMode === 'clone',
      cloneAll: view.createMode === 'clone-all',
      cloneFrom: view.createMode === 'fresh' ? null : view.cloneFrom,
      noAlias: view.noAlias,
    });
    storeResult(view, `创建 Profile ${normalizedName}`, result);
    notify(result.success ? 'success' : 'error', `profile ${normalizedName} 创建命令已执行。`);
    if (result.success) {
      view.createName = '';
      view.createMode = 'fresh';
      view.noAlias = false;
      await refreshProfileWorkspace(view, normalizedName);
    } else {
      await refreshProfileWorkspace(view, view.selectedName ?? undefined);
    }
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function activateProfileAction(view, profileName) {
  view.runningAction = `activate:${profileName}`;
  renderPage(view);
  try {
    await api.setActiveProfile(profileName);
    await refreshProfileWorkspace(view, profileName);
    notify('success', `已将 ${profileName} 设为 Hermes 默认 profile。`);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function renameProfileAction(view) {
  const current = selectedProfile(view);
  if (!current || current.isDefault) {
    notify('error', 'default profile 不支持重命名。');
    return;
  }

  const nextName = view.renameTo.trim();
  if (!nextName || nextName === current.name) {
    notify('error', '请输入新的 profile 名称。');
    return;
  }

  view.runningAction = 'rename-profile';
  renderPage(view);

  try {
    const result = await api.renameProfile({
      oldName: current.name,
      newName: nextName,
    });
    storeResult(view, `重命名 Profile ${current.name}`, result);
    notify(result.success ? 'success' : 'error', `profile ${current.name} 重命名命令已执行。`);
    delete view.runtimeBundles[current.name];
    delete view.runtimeErrors[current.name];
    await refreshProfileWorkspace(view, result.success ? nextName : current.name);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function exportProfileAction(view) {
  const current = selectedProfile(view);
  if (!current) {
    return;
  }

  view.runningAction = 'export-profile';
  renderPage(view);

  try {
    const result = await api.exportProfile({
      output: view.exportOutput.trim() || null,
      profileName: current.name,
    });
    storeResult(view, `导出 Profile ${current.name}`, result);
    notify(result.success ? 'success' : 'error', `profile ${current.name} 导出命令已执行。`);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function importProfileAction(view) {
  const archive = view.importArchive.trim();
  if (!archive) {
    notify('error', 'archive 路径不能为空。');
    return;
  }

  view.runningAction = 'import-profile';
  renderPage(view);

  try {
    const preferredProfile = view.importName.trim() || undefined;
    const result = await api.importProfile({
      archive,
      importName: preferredProfile ?? null,
    });
    storeResult(view, `导入 Profile ${preferredProfile || archive}`, result);
    await refreshProfileWorkspace(view, result.success ? preferredProfile : view.selectedName ?? undefined);
    if (result.success) {
      view.importArchive = '';
      view.importName = '';
    }
    notify(result.success ? 'success' : 'error', 'profile 导入命令已执行。');
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function deleteProfileAction(view) {
  const current = selectedProfile(view);
  if (!current || current.isDefault) {
    notify('error', 'default profile 不支持删除。');
    return;
  }
  if (view.deleteConfirm.trim() !== current.name) {
    notify('error', '请先输入完整的 profile 名称完成确认。');
    return;
  }

  view.runningAction = 'delete-profile';
  renderPage(view);

  try {
    const result = await api.deleteProfile({
      confirmName: view.deleteConfirm.trim(),
      profileName: current.name,
    });
    storeResult(view, `删除 Profile ${current.name}`, result);
    notify(result.success ? 'success' : 'error', `profile ${current.name} 删除命令已执行。`);
    delete view.runtimeBundles[current.name];
    delete view.runtimeErrors[current.name];
    view.deleteConfirm = '';
    await refreshProfileWorkspace(view, result.success ? currentProfilesSnapshot()?.activeProfile ?? 'default' : current.name);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function createAliasAction(view) {
  const current = selectedProfile(view);
  if (!current) {
    return;
  }

  view.runningAction = 'create-alias';
  renderPage(view);

  try {
    const aliasName = view.aliasName.trim() || current.name;
    const result = await api.createProfileAlias({
      aliasName,
      profileName: current.name,
    });
    storeResult(view, `创建 Alias ${aliasName}`, result);
    notify(result.success ? 'success' : 'error', `profile ${current.name} alias 创建命令已执行。`);
    await refreshProfileWorkspace(view, current.name);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function deleteAliasAction(view) {
  const current = selectedProfile(view);
  if (!current) {
    return;
  }

  const aliasName = view.removeAliasName.trim();
  if (!aliasName) {
    notify('error', '请选择要删除的 alias。');
    return;
  }
  if (view.removeAliasConfirm.trim() !== aliasName) {
    notify('error', '请先输入完整的 alias 名称完成确认。');
    return;
  }

  view.runningAction = 'delete-alias';
  renderPage(view);

  try {
    const result = await api.deleteProfileAlias({
      aliasName,
      confirmName: view.removeAliasConfirm.trim(),
      profileName: current.name,
    });
    storeResult(view, `删除 Alias ${aliasName}`, result);
    if (result.success) {
      view.removeAliasConfirm = '';
    }
    await refreshProfileWorkspace(view, current.name);
    notify(result.success ? 'success' : 'error', result.success ? `alias ${aliasName} 已删除。` : `alias ${aliasName} 删除失败，请检查命令输出。`);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncInlineControls(view) {
  const current = selectedProfile(view);
  const createButton = view.page.querySelector('[data-action="create-profile"]');
  const importButton = view.page.querySelector('[data-action="import-profile"]');
  const renameButton = view.page.querySelector('[data-action="rename-profile"]');
  const exportButton = view.page.querySelector('[data-action="export-profile"]');
  const aliasCreateButton = view.page.querySelector('[data-action="create-alias"]');
  const aliasDeleteButton = view.page.querySelector('[data-action="delete-alias"]');
  const profileDeleteButton = view.page.querySelector('[data-action="delete-profile"]');

  if (createButton) {
    createButton.disabled = Boolean(view.runningAction) || !view.createName.trim();
  }
  if (importButton) {
    importButton.disabled = Boolean(view.runningAction) || !view.importArchive.trim();
  }
  if (renameButton) {
    renameButton.disabled = !current || current.isDefault || Boolean(view.runningAction) || !view.renameTo.trim() || view.renameTo.trim() === current.name;
  }
  if (exportButton) {
    exportButton.disabled = !current || Boolean(view.runningAction);
  }
  if (aliasCreateButton) {
    aliasCreateButton.disabled = !current || Boolean(view.runningAction);
  }
  if (aliasDeleteButton) {
    aliasDeleteButton.disabled = !current || !current.aliases.length || Boolean(view.runningAction) || view.removeAliasConfirm.trim() !== view.removeAliasName.trim();
  }
  if (profileDeleteButton) {
    profileDeleteButton.disabled = !current || current.isDefault || Boolean(view.runningAction) || view.deleteConfirm.trim() !== current.name;
  }
}

function bindEvents(view) {
  const createNameInput = view.page.querySelector('#profiles-create-name');
  const createModeSelect = view.page.querySelector('#profiles-create-mode');
  const cloneFromSelect = view.page.querySelector('#profiles-clone-from');
  const noAliasInput = view.page.querySelector('#profiles-no-alias');
  const renameInput = view.page.querySelector('#profiles-rename-to');
  const exportInput = view.page.querySelector('#profiles-export-output');
  const importArchiveInput = view.page.querySelector('#profiles-import-archive');
  const importNameInput = view.page.querySelector('#profiles-import-name');
  const aliasNameInput = view.page.querySelector('#profiles-alias-name');
  const removeAliasSelect = view.page.querySelector('#profiles-remove-alias');
  const removeAliasConfirmInput = view.page.querySelector('#profiles-remove-alias-confirm');
  const deleteConfirmInput = view.page.querySelector('#profiles-delete-confirm');
  const compareSelect = view.page.querySelector('#profiles-compare-select');

  if (createNameInput) {
    createNameInput.oninput = (event) => {
      view.createName = event.target.value;
      syncInlineControls(view);
    };
  }
  if (createModeSelect) {
    createModeSelect.onchange = (event) => {
      view.createMode = event.target.value;
      renderPage(view);
    };
  }
  if (cloneFromSelect) {
    cloneFromSelect.onchange = (event) => {
      view.cloneFrom = event.target.value;
      syncInlineControls(view);
    };
  }
  if (noAliasInput) {
    noAliasInput.onchange = (event) => {
      view.noAlias = event.target.checked;
    };
  }
  if (renameInput) {
    renameInput.oninput = (event) => {
      view.renameTo = event.target.value;
      syncInlineControls(view);
    };
  }
  if (exportInput) {
    exportInput.oninput = (event) => {
      view.exportOutput = event.target.value;
    };
  }
  if (importArchiveInput) {
    importArchiveInput.oninput = (event) => {
      view.importArchive = event.target.value;
      syncInlineControls(view);
    };
  }
  if (importNameInput) {
    importNameInput.oninput = (event) => {
      view.importName = event.target.value;
    };
  }
  if (aliasNameInput) {
    aliasNameInput.oninput = (event) => {
      view.aliasName = event.target.value;
    };
  }
  if (removeAliasSelect) {
    removeAliasSelect.onchange = (event) => {
      view.removeAliasName = event.target.value;
      view.removeAliasConfirm = '';
      renderPage(view);
    };
  }
  if (removeAliasConfirmInput) {
    removeAliasConfirmInput.oninput = (event) => {
      view.removeAliasConfirm = event.target.value;
      syncInlineControls(view);
    };
  }
  if (deleteConfirmInput) {
    deleteConfirmInput.oninput = (event) => {
      view.deleteConfirm = event.target.value;
      syncInlineControls(view);
    };
  }
  if (compareSelect) {
    compareSelect.onchange = (event) => {
      view.compareName = event.target.value || null;
      renderPage(view);
    };
  }

  syncInlineControls(view);

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      const current = selectedProfile(view);
      const bundle = selectedRuntime(view);
      const installation = bundle?.installation ?? null;

      switch (action) {
        case 'refresh-fleet':
          await loadData(view, {
            includeProfiles: true,
            preferredProfile: view.selectedName ?? view.profile,
            silent: true,
          });
          return;
        case 'select-profile':
          view.selectedName = element.getAttribute('data-name');
          renderPage(view);
          return;
        case 'refresh-selected-runtime':
          if (view.selectedName) {
            await loadRuntimeBundle(view, view.selectedName, true);
          }
          return;
        case 'refresh-compare-runtime':
          if (view.compareName) {
            await loadRuntimeBundle(view, view.compareName, true);
          }
          return;
        case 'set-default':
          if (current) {
            await activateProfileAction(view, current.name);
          }
          return;
        case 'open-home':
          if (current) {
            await openFinderAction(view, current.homePath, `${current.name} 目录`);
          }
          return;
        case 'open-config':
          if (bundle) {
            await openFinderAction(view, bundle.config.configPath, `${current.name} config.yaml`, true);
          }
          return;
        case 'open-env':
          if (bundle) {
            await openFinderAction(view, bundle.config.envPath, `${current.name} .env`, true);
          }
          return;
        case 'open-state-db':
          if (current) {
            await openFinderAction(view, `${current.homePath}/state.db`, `${current.name} state.db`, true);
          }
          return;
        case 'open-gateway-state':
          if (current) {
            await openFinderAction(view, `${current.homePath}/gateway_state.json`, `${current.name} gateway_state.json`, true);
          }
          return;
        case 'open-logs-dir':
          if (current) {
            await openFinderAction(view, `${current.homePath}/logs`, `${current.name} logs`);
          }
          return;
        case 'open-alias':
          await openFinderAction(
            view,
            element.getAttribute('data-path') || '',
            `${element.getAttribute('data-name') || 'Alias'} Alias`,
            true,
          );
          return;
        case 'terminal-setup':
          if (current && installation) {
            await openTerminalAction(view, current.name, 'profile:setup', '全量 Setup', installation.setupCommand);
          }
          return;
        case 'terminal-model':
          if (current && installation) {
            await openTerminalAction(view, current.name, 'profile:model', '模型 / Provider', installation.modelCommand);
          }
          return;
        case 'terminal-gateway-setup':
          if (current && installation) {
            await openTerminalAction(view, current.name, 'profile:gateway-setup', 'Gateway Setup', installation.gatewaySetupCommand);
          }
          return;
        case 'terminal-tools':
          if (current && installation) {
            await openTerminalAction(view, current.name, 'profile:tools-setup', '工具选择', installation.toolsSetupCommand);
          }
          return;
        case 'terminal-skills':
          if (current && installation) {
            await openTerminalAction(view, current.name, 'profile:skills-config', '技能开关', installation.skillsConfigCommand);
          }
          return;
        case 'terminal-memory':
          if (current) {
            await openTerminalAction(view, current.name, 'profile:memory-setup', '记忆 Provider', 'hermes memory setup');
          }
          return;
        case 'terminal-plugins':
          if (current) {
            await openTerminalAction(view, current.name, 'profile:plugins', '插件面板', 'hermes plugins');
          }
          return;
        case 'terminal-status':
          if (current) {
            await openTerminalAction(view, current.name, 'profile:status', '查看实例状态', 'hermes status --all');
          }
          return;
        case 'create-profile':
          await createProfileAction(view);
          return;
        case 'rename-profile':
          await renameProfileAction(view);
          return;
        case 'export-profile':
          await exportProfileAction(view);
          return;
        case 'import-profile':
          await importProfileAction(view);
          return;
        case 'create-alias':
          await createAliasAction(view);
          return;
        case 'delete-alias':
          await deleteAliasAction(view);
          return;
        case 'delete-profile':
          await deleteProfileAction(view);
          return;
        case 'goto-config':
          navigate('config');
          return;
        case 'goto-extensions':
          navigate('extensions');
          return;
        case 'goto-logs':
          navigate('logs');
          return;
        case 'goto-diagnostics':
          navigate('diagnostics');
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
    aliasName: '',
    compareName: null,
    createMode: 'fresh',
    createName: '',
    deleteConfirm: '',
    destroyed: false,
    error: null,
    exportOutput: '',
    importArchive: '',
    importName: '',
    lastResult: null,
    loading: true,
    loadingRuntimeNames: [],
    noAlias: false,
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    removeAliasConfirm: '',
    removeAliasName: '',
    renameTo: '',
    runningAction: null,
    runtimeBundles: {},
    runtimeErrors: {},
    selectedName: getPanelState().selectedProfile,
    unsubscribe: null,
    cloneFrom: currentProfilesSnapshot()?.activeProfile ?? 'default',
  };

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView, { includeProfiles: true });
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
