import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
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
import {
  enabledToolCount,
  isRemoteDelivery,
  localRuntimeSkillCount,
  pluginsCount,
  totalToolCount,
} from '../lib/runtime';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';
import { infoTipHtml } from './workbench-helpers';
import {
  cloneEnvWorkspace,
  cloneWorkspace,
  currentEditorBadge,
  envPresetReady,
  getChannelPreset,
  getMemoryPreset,
  getProviderPreset,
  getTerminalPreset,
  getToolsetPreset,
  normalizePlatformBindings,
  parseOptionalNumber,
  renderConfigRail,
  renderEditorTabs,
  renderStructuredControls,
  renderStructuredEnvControls,
  splitLineValues,
  uniqueValues,
} from './config-workbench';

let activeView = null;

function structuredConfigDirty(view) {
  if (!view.data?.workspace || !view.controlDraft) {
    return false;
  }
  return JSON.stringify(view.controlDraft) !== JSON.stringify(cloneWorkspace(view.data.workspace));
}

function structuredEnvDirty(view) {
  if (!view.data?.envWorkspace || !view.envDraft) {
    return false;
  }
  return (
    JSON.stringify(view.envDraft) !== JSON.stringify(cloneEnvWorkspace(view.data.envWorkspace))
  );
}

function runtimeWarnings(data, snapshot, skills, extensions, cronSnapshot) {
  const warnings = [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter(job => isRemoteDelivery(job.deliver));
  const runtimeLocalSkills = localRuntimeSkillCount(extensions);

  if (!data.summary.modelDefault || !data.summary.modelProvider) {
    warnings.push('默认模型或 provider 缺失，主对话链路还不稳定。');
  }
  if (!data.summary.contextEngine) {
    warnings.push('当前没有显式声明 context.engine，能力编排很难一眼判断。');
  }
  if (!data.summary.terminalBackend) {
    warnings.push('终端后端为空，很多命令与文件类工具会缺乏稳定执行语义。');
  }
  if (!data.summary.toolsets.length) {
    warnings.push('当前没有配置 toolsets，模型可见能力面偏窄。');
  }
  if (!skills.length) {
    warnings.push('当前 profile 下没有扫描到本地 skills，闭环能力会明显下降。');
  }
  if (data.summary.memoryEnabled === false) {
    warnings.push('记忆功能关闭后，长期 persona 和记忆闭环会被削弱。');
  }
  if (data.summary.memoryEnabled && data.summary.userProfileEnabled === false) {
    warnings.push('USER 画像记忆当前关闭，长期个体偏好跟踪会偏弱。');
  }
  if (snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 当前未运行，配置改动还没有在消息链路上得到验证。');
  }
  if (data.summary.memoryProvider && extensions?.memoryRuntime.provider.includes('none')) {
    warnings.push(
      `配置声明了 memory provider「${data.summary.memoryProvider}」，但运行态仍像 built-in only。`
    );
  }
  if (data.summary.toolsets.length > 0 && extensions && enabledToolCount(extensions) === 0) {
    warnings.push('配置里声明了 toolsets，但运行态没解析出已启用 tools，建议立刻体检。');
  }
  if (remoteJobs.length > 0 && snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端作业依赖 Gateway，但网关不在 running 状态。`);
  }
  if (runtimeLocalSkills !== skills.length) {
    warnings.push(
      `运行态 local skills 为 ${runtimeLocalSkills} 个，本地目录扫描到 ${skills.length} 个，存在安装态偏差。`
    );
  }

  return Array.from(new Set(warnings));
}

function investigationPrimaryAction(view) {
  const focus = view.investigation?.focus;
  switch (focus) {
    case 'model':
      return buttonHtml({
        action: 'focus-workspace',
        label: '定位模型面',
        kind: 'primary',
        attrs: { 'data-tab': 'control', 'data-section': 'model-governance' },
      });
    case 'toolsets':
      return buttonHtml({ action: 'goto-extensions', label: '打开扩展页', kind: 'primary' });
    case 'memory':
      return buttonHtml({ action: 'goto-memory', label: '打开记忆页', kind: 'primary' });
    case 'context':
      return buttonHtml({ action: 'goto-gateway', label: '打开 Gateway', kind: 'primary' });
    case 'credentials':
      return buttonHtml({
        action: 'focus-workspace',
        label: '定位凭证面',
        kind: 'primary',
        attrs: { 'data-tab': 'credentials', 'data-section': 'provider-credentials' },
      });
    default:
      return buttonHtml({
        action: 'focus-workspace',
        label: '回到控制面',
        kind: 'primary',
        attrs: { 'data-tab': 'control', 'data-section': 'model-governance' },
      });
  }
}

function surfaceTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-config-surface="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function verifyTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-verify-view="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

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

function workspaceSectionFromFocus(focus) {
  switch (focus) {
    case 'model':
      return { tab: 'control', sectionId: 'model-governance' };
    case 'credentials':
      return { tab: 'credentials', sectionId: 'provider-credentials' };
    case 'toolsets':
      return { tab: 'control', sectionId: 'toolsets-overview' };
    case 'memory':
      return { tab: 'control', sectionId: 'memory-presets' };
    case 'context':
      return { tab: 'credentials', sectionId: 'channel-credentials' };
    default:
      return null;
  }
}

function applyWorkspaceSubviewForSection(view, sectionId) {
  switch (sectionId) {
    case 'model-governance':
      view.controlModelView = 'status';
      return;
    case 'model-presets':
      view.controlModelView = 'connect';
      return;
    case 'model-detail':
      view.controlModelView = 'detail';
      return;
    case 'toolsets-overview':
      view.controlToolsetView = 'status';
      return;
    case 'toolsets-presets':
      view.controlToolsetView = 'presets';
      return;
    case 'toolsets-manual':
      view.controlToolsetView = 'manual';
      return;
    case 'toolsets-detail':
      view.controlToolsetView = 'platform';
      return;
    default:
      return;
  }
}

function queueWorkspaceFocus(view, tab, sectionId, behavior = 'smooth') {
  view.surfaceView = 'workspace';
  view.editorTab = tab;
  view.activeWorkspaceSection = sectionId || null;
  applyWorkspaceSubviewForSection(view, sectionId || '');
  view.pendingSectionFocus = sectionId ? { tab, sectionId, behavior } : null;
  renderPage(view);
}

function flushPendingSectionFocus(view) {
  const pending = view.pendingSectionFocus;
  if (!pending || pending.tab !== view.editorTab) {
    return;
  }

  view.pendingSectionFocus = null;
  if (!pending.sectionId) {
    return;
  }

  const target = view.page.querySelector(`[data-workspace-section="${pending.sectionId}"]`);
  if (!target) {
    return;
  }

  requestAnimationFrame(() => {
    target.scrollIntoView({
      behavior: pending.behavior || 'smooth',
      block: 'start',
    });
  });
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'config',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'config',
        headline: '来自配置中心的链路下钻',
        description: '围绕模型、toolsets、provider 和 Gateway 关联配置继续排查。',
      };
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">配置中心</h1>
      </div>
      <p class="page-desc">正在同步 Hermes 配置文件、运行态摘要和扩展闭环信号。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 })
        .map(() => '<div class="stat-card loading-placeholder" style="min-height:124px"></div>')
        .join('')}
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.data) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.data || !view.installation) {
    view.page.innerHTML = `
      <div class="page-header page-header-compact">
        <div class="panel-title-row">
          <h1 class="page-title">配置中心</h1>
        </div>
        <p class="page-desc">模型、凭证、通道与能力配置。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">配置快照暂时不可用。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取配置快照', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const { data, snapshot, installation, extensions, cronSnapshot, skills } = view;
  const warnings = runtimeWarnings(data, snapshot, skills, extensions, cronSnapshot);
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter(job => isRemoteDelivery(job.deliver));
  const enabledTools = enabledToolCount(extensions);
  const totalTools = totalToolCount(extensions);
  const localSkills = localRuntimeSkillCount(extensions);
  const pluginTotal = pluginsCount(extensions);
  const env = data.envWorkspace ?? {};
  const credentialsCount = [
    env.openaiApiKey,
    env.openrouterApiKey,
    env.anthropicApiKey,
    env.googleApiKey,
    env.hfToken,
    env.hermesGatewayToken,
  ].filter(value => String(value ?? '').trim()).length;
  const channelCount = [
    env.telegramBotToken,
    env.telegramHomeChannel,
    env.discordBotToken,
    env.discordHomeChannel,
    env.slackBotToken,
  ].filter(value => String(value ?? '').trim()).length;
  const configDirty = view.configYaml !== data.configYaml;
  const envDirty = view.envFile !== data.envFile;
  const structuredDirty = structuredConfigDirty(view);
  const credentialsDirty = structuredEnvDirty(view);
  const actionBusy = Boolean(view.saving || view.runningDiagnostic || view.runningAction);
  const seed = relaySeed(view);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    description: '核对配置相关回执和运行日志。',
    logName: snapshot?.gateway?.gatewayState === 'running' ? 'agent' : 'errors',
    contains: view.investigation?.context?.source || '',
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    description: '围绕配置完整性、provider 和 Gateway 关联链路做体检。',
    suggestedCommand: view.investigation?.suggestedCommand || 'config-check',
    logName: 'errors',
  });
  const gatewayIntent = buildGatewayDrilldownIntent(seed, {
    description: '带着当前配置上下文查看 Gateway 和平台链路。',
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(seed, {
    description: '核对 toolsets、skills、plugins 和 memory provider。',
    rawKind: view.investigation?.focus === 'memory' ? 'memory' : 'tools',
    query: view.investigation?.focus === 'toolsets' ? data.summary.toolsets.join(' ') : '',
  });
  const surfaceView = view.surfaceView || 'focus';
  const verifyView = view.verifyView || 'status';
  const modelReady = Boolean(data.summary.modelDefault && data.summary.modelProvider);
  const gatewayRunning = snapshot?.gateway?.gatewayState === 'running';
  const focusTone = modelReady && warnings.length === 0 ? 'good' : 'warn';
  const configFocusShell = `
    <div class="dashboard-focus-shell">
      <section class="dashboard-focus-card dashboard-focus-card-${focusTone}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${modelReady ? '就绪' : '配置'}</span>
            <h2 class="dashboard-focus-title">${modelReady ? '主要配置已可用' : '先完成基础配置'}</h2>
            <p class="dashboard-focus-desc">${modelReady ? '可以联调和验证。' : '先补齐 Provider、模型和关键凭证。'}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(modelReady ? '模型已就绪' : '模型待补齐', modelReady ? 'good' : 'warn')}
            ${pillHtml(gatewayRunning ? 'Gateway 已运行' : 'Gateway 待验证', gatewayRunning ? 'good' : 'warn')}
            ${pillHtml(`${warnings.length} 条提醒`, warnings.length === 0 ? 'good' : 'warn')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">对话</span>
            <strong class="dashboard-signal-value">${escapeHtml(modelReady ? '已可用' : '待补齐')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(modelReady ? '主对话链路已经成形，仍可微调。' : '先补 provider、默认模型和关键凭证。')}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">消息</span>
            <strong class="dashboard-signal-value">${escapeHtml(gatewayRunning ? '可验证' : '待验证')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业等待链路验证。` : `${channelCount} 项通道参数已露出，可按需补齐。`)}</span>
          </section>
          <section class="dashboard-signal-card">
            <span class="dashboard-signal-label">能力</span>
            <strong class="dashboard-signal-value">${escapeHtml(data.summary.toolsets.length > 0 ? `${data.summary.toolsets.length} 组已整理` : '待整理')}</strong>
            <span class="dashboard-signal-meta">${escapeHtml(`运行工具 ${enabledTools}/${totalTools} · 本地技能 ${localSkills}/${skills.length} · 插件 ${pluginTotal} 个`)}</span>
          </section>
        </div>
        <div class="dashboard-focus-actions">
          ${buttonHtml({ action: 'focus-workspace', label: modelReady ? '模型设置' : '完成模型设置', kind: 'primary', attrs: { 'data-tab': 'control', 'data-section': 'model-governance' }, disabled: actionBusy })}
          ${buttonHtml({ action: 'focus-workspace', label: '凭证与通道', attrs: { 'data-tab': 'credentials', 'data-section': 'provider-credentials' }, disabled: actionBusy })}
          ${buttonHtml({ action: 'goto-gateway', label: '验证 Gateway', disabled: actionBusy })}
          ${buttonHtml({ action: 'diagnostic-config-check', label: view.runningDiagnostic === 'config-check' ? '配置体检…' : '配置体检', disabled: actionBusy })}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', disabled: view.refreshing || actionBusy })}
        </div>
      </section>

      <aside class="dashboard-jump-panel">
        <div class="workspace-main-header">
          <div>
            <strong>快捷入口</strong>
            <p class="workspace-main-copy">只放最常用的 4 项。</p>
          </div>
          ${pillHtml('高频 4 项', 'neutral')}
        </div>
        <div class="dashboard-jump-grid">
          ${launcherCardHtml({
            action: 'focus-workspace',
            attrs: { 'data-tab': 'control', 'data-section': 'model-governance' },
            kicker: '模型',
            title: '模型与 Provider',
            meta: modelReady ? '主链路已经可用。' : '默认模型和 Provider 还没补齐。',
            tone: modelReady ? 'good' : 'warn',
          })}
          ${launcherCardHtml({
            action: 'focus-workspace',
            attrs: { 'data-tab': 'credentials', 'data-section': 'provider-credentials' },
            kicker: '凭证',
            title: '钥匙与通道',
            meta:
              credentialsCount > 0
                ? `${credentialsCount} 项关键凭证已写入。`
                : '先把关键凭证和通道变量补齐。',
            tone: credentialsCount > 0 ? 'good' : 'warn',
          })}
          ${launcherCardHtml({
            action: 'focus-workspace',
            attrs: { 'data-tab': 'control', 'data-section': 'toolsets-overview' },
            kicker: '能力',
            title: 'Toolsets 与记忆',
            meta:
              data.summary.toolsets.length > 0
                ? `${data.summary.toolsets.length} 组能力已配置。`
                : '把工具面、记忆和外部技能目录理顺。',
          })}
          ${launcherCardHtml({
            action: 'goto-gateway',
            kicker: '验证',
            title: 'Gateway 与消息',
            meta: gatewayRunning ? 'Gateway 已在运行。' : '配置完成后到 Gateway 或诊断页验证。',
            tone: gatewayRunning ? 'good' : 'warn',
          })}
        </div>
      </aside>
    </div>
  `;
  const focusContent = `
    ${configFocusShell}

    <section class="config-section dashboard-quiet-card">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">当前状态</h2>
          <p class="config-section-desc">关键状态与建议。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(warnings.length > 0 ? `${warnings.length} 条提醒` : '正常', warnings.length > 0 ? 'warn' : 'good')}
        </div>
      </div>
      <div class="detail-list compact">
        ${[
          { label: '状态', value: modelReady ? '主配置已可用。' : '主配置尚未完成。' },
          {
            label: '提醒',
            value:
              warnings[0] ||
              (credentialsCount > 0 ? '可以整理能力与记忆。' : '请先补关键凭证和消息入口。'),
          },
          {
            label: '建议',
            value: !gatewayRunning ? '进入 Gateway 验证消息链路。' : '按需打开编辑页或验证页。',
          },
        ]
          .map(
            item => `
          <div class="key-value-row">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
  const workspaceContent = `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">配置编辑</h2>
          <p class="config-section-desc">这里直接修改配置。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(currentEditorBadge(view), 'neutral')}
          ${warnings.length > 0 ? pillHtml(`${warnings.length} 条提醒`, 'warn') : pillHtml('可直接编辑', 'good')}
        </div>
      </div>
      <div class="workspace-shell workspace-shell-editor workspace-shell-dense">
        <aside class="workspace-rail">
          ${renderConfigRail(view, {
            actionBusy,
            data,
            enabledTools,
            installation,
            localSkills,
            remoteJobs,
            skills,
            snapshot,
            totalTools,
            warnings,
          })}
        </aside>
        <div class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <strong>${escapeHtml(view.editorTab === 'control' ? '结构化控制' : view.editorTab === 'credentials' ? '凭证与通道' : '配置编辑')}</strong>
              <p class="workspace-main-copy">${escapeHtml(view.editorTab === 'config' ? data.configPath : view.editorTab === 'env' ? data.envPath : view.editorTab === 'credentials' ? data.envPath : '直接修改高频配置项并同步写回 config.yaml')}</p>
            </div>
            <div class="toolbar">
              ${
                view.editorTab === 'control'
                  ? `<span id="structured-dirty-pill" class="pill pill-warn" ${structuredDirty ? '' : 'style="display:none"'}>未保存</span>`
                  : view.editorTab === 'credentials'
                    ? `<span id="credentials-dirty-pill" class="pill pill-warn" ${credentialsDirty ? '' : 'style="display:none"'}>未保存</span>`
                    : view.editorTab === 'config'
                      ? `<span id="config-dirty-pill" class="pill pill-warn" ${configDirty ? '' : 'style="display:none"'}>未保存</span>`
                      : `<span id="env-dirty-pill" class="pill pill-warn" ${envDirty ? '' : 'style="display:none"'}>未保存</span>`
              }
              ${
                view.editorTab === 'control'
                  ? buttonHtml({
                      action: 'save-structured-config',
                      label: view.saving === 'structured' ? '保存中…' : '保存控制面',
                      kind: 'primary',
                      disabled:
                        Boolean(view.saving) ||
                        Boolean(view.runningDiagnostic) ||
                        Boolean(view.runningAction),
                    })
                  : view.editorTab === 'credentials'
                    ? buttonHtml({
                        action: 'save-structured-env',
                        label: view.saving === 'structured-env' ? '保存中…' : '保存凭证面',
                        kind: 'primary',
                        disabled:
                          Boolean(view.saving) ||
                          Boolean(view.runningDiagnostic) ||
                          Boolean(view.runningAction),
                      })
                    : view.editorTab === 'config'
                      ? buttonHtml({
                          action: 'save-config',
                          label: view.saving === 'config' ? '保存中…' : '保存 YAML',
                          kind: 'primary',
                          disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic),
                        })
                      : buttonHtml({
                          action: 'save-env',
                          label: view.saving === 'env' ? '保存中…' : '保存 ENV',
                          kind: 'primary',
                          disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic),
                        })
              }
              ${
                view.editorTab === 'control'
                  ? buttonHtml({
                      action: 'reset-structured-config',
                      label: '重置草稿',
                      disabled:
                        Boolean(view.saving) || Boolean(view.runningDiagnostic) || !structuredDirty,
                    })
                  : view.editorTab === 'credentials'
                    ? buttonHtml({
                        action: 'reset-structured-env',
                        label: '重置草稿',
                        disabled:
                          Boolean(view.saving) ||
                          Boolean(view.runningDiagnostic) ||
                          !credentialsDirty,
                      })
                    : view.editorTab === 'config'
                      ? buttonHtml({
                          action: 'save-config-verify',
                          label: view.saving === 'config' ? '保存中…' : '保存并体检',
                          disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic),
                        })
                      : buttonHtml({
                          action: 'save-env-verify',
                          label: view.saving === 'env' ? '保存中…' : '保存并体检',
                          disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic),
                        })
              }
              ${
                view.editorTab === 'control'
                  ? buttonHtml({
                      action: 'switch-editor-tab',
                      label: '查看 YAML',
                      attrs: { 'data-tab': 'config' },
                    })
                  : view.editorTab === 'credentials'
                    ? buttonHtml({
                        action: 'switch-editor-tab',
                        label: '查看 .env',
                        attrs: { 'data-tab': 'env' },
                      })
                    : view.editorTab === 'config'
                      ? buttonHtml({
                          action: 'open-config',
                          label: '定位 config.yaml',
                          disabled: actionBusy,
                        })
                      : buttonHtml({ action: 'open-env', label: '定位 .env', disabled: actionBusy })
              }
            </div>
          </div>
          ${renderEditorTabs(view, configDirty, envDirty, structuredDirty, credentialsDirty)}
          <div ${view.editorTab === 'control' ? '' : 'style="display:none"'}>
            ${renderStructuredControls(view)}
          </div>
          <div ${view.editorTab === 'credentials' ? '' : 'style="display:none"'}>
            ${renderStructuredEnvControls(view)}
          </div>
          <textarea class="editor large" data-editor="config" spellcheck="false" ${view.editorTab === 'config' ? '' : 'style="display:none"'}></textarea>
          <textarea class="editor large" data-editor="env" spellcheck="false" ${view.editorTab === 'env' ? '' : 'style="display:none"'}></textarea>
          ${
            view.editorTab === 'config'
              ? '<p class="helper-text config-editor-hint">保存 YAML 后建议立刻做一次配置体检。</p>'
              : view.editorTab === 'env'
                ? '<p class="helper-text config-editor-hint">ENV 保存后建议立刻验证。</p>'
                : ''
          }
        </div>
      </div>
    </section>
  `;
  const verifyBody =
    verifyView === 'result'
      ? `
      <section class="config-section">
          <div class="config-section-header">
            <div>
              <h2 class="config-section-title">最近动作回执</h2>
              <p class="config-section-desc">查看最近一次操作结果。</p>
            </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行动作', '保存、体检或执行历史迁移动作后，这里会保留最近一次原始回执。')}
      </section>
    `
      : verifyView === 'links'
        ? `
        <section class="config-section">
          <div class="config-section-header">
            <div>
              <h2 class="config-section-title">闭环入口</h2>
              <p class="config-section-desc">改完后从这里继续验证。</p>
            </div>
          </div>
          <div class="health-grid">
            <section class="action-card action-card-compact">
              <div class="health-card-header">
                <strong>扩展与插件</strong>
                ${pillHtml(enabledTools > 0 ? '可继续' : '待核对', enabledTools > 0 ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(pluginTotal > 0 ? `当前已有 ${pluginTotal} 个插件目录，可继续整理工具和能力面。` : '先去扩展页核对工具面、插件和运行态。')}</p>
              <div class="toolbar">
                ${buttonHtml({ action: 'goto-extensions', label: '扩展页' })}
              </div>
            </section>
            <section class="action-card action-card-compact">
              <div class="health-card-header">
                <strong>Gateway 与通道</strong>
                ${pillHtml(snapshot?.gateway?.gatewayState === 'running' ? '可验证' : '待验证', snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(remoteJobs.length > 0 ? `当前有 ${remoteJobs.length} 个远端作业依赖消息链路。` : '当前没有远端投递阻塞，可以按需再去验证。')}</p>
              <div class="toolbar">
                ${buttonHtml({ action: 'goto-gateway', label: 'Gateway' })}
              </div>
            </section>
            <section class="action-card action-card-compact">
              <div class="health-card-header">
                <strong>记忆与技能</strong>
                ${pillHtml(localSkills === skills.length ? '基本对齐' : '待核对', localSkills === skills.length ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(localSkills === skills.length ? '记忆和本地技能数量基本对齐。' : `运行态本地技能 ${localSkills} 个，目录有 ${skills.length} 个，建议继续核对。`)}</p>
              <div class="toolbar">
                ${buttonHtml({ action: 'goto-memory', label: '记忆页' })}
              </div>
            </section>
          </div>
        </section>
      `
        : `
        <div class="stat-cards stat-cards-4">
          <section class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">对话</span>
              ${statusDotHtml(data.summary.modelDefault && data.summary.modelProvider ? 'running' : 'warning')}
            </div>
            <div class="stat-card-value">${escapeHtml(modelReady ? '已可用' : '待补齐')}</div>
            <div class="stat-card-meta">${escapeHtml(modelReady ? '主对话链路已经成形，可以继续细调。' : '先补默认模型、provider 和关键凭证。')}</div>
          </section>
          <section class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">执行</span>
              ${statusDotHtml(data.summary.terminalBackend ? 'running' : 'warning')}
            </div>
            <div class="stat-card-value">${escapeHtml(data.summary.terminalBackend ? '已接通' : '待补齐')}</div>
            <div class="stat-card-meta">${escapeHtml(data.summary.terminalBackend ? data.summary.terminalCwd || '终端后端已声明' : '终端后端为空，很多工具动作会不稳定。')}</div>
          </section>
          <section class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">联动</span>
              ${statusDotHtml(snapshot?.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
            </div>
            <div class="stat-card-value">${escapeHtml(snapshot?.gateway?.gatewayState === 'running' ? '可验证' : '待验证')}</div>
            <div class="stat-card-meta">${escapeHtml(snapshot?.gateway?.gatewayState === 'running' ? '消息链路已经在线，可以继续做闭环验证。' : '建议改完后先去 Gateway 看真实运行结果。')}</div>
          </section>
        </div>
      `;

  const verifyContent = `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">验证</h2>
          <p class="config-section-desc">查看状态、回执和联动入口。</p>
        </div>
        ${pillHtml(verifyView === 'status' ? '状态' : verifyView === 'result' ? '回执' : '去向', 'neutral')}
      </div>
      <div class="tab-bar tab-bar-dense">
        ${verifyTabHtml(verifyView, 'status', '状态')}
        ${verifyTabHtml(verifyView, 'result', '回执')}
        ${verifyTabHtml(verifyView, 'links', '去向')}
      </div>
    </section>
    ${verifyBody}
  `;
  const surfaceContent =
    surfaceView === 'focus'
      ? focusContent
      : surfaceView === 'verify'
        ? verifyContent
        : workspaceContent;

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">配置中心</h1>
      </div>
      <p class="page-desc">模型、凭证、通道与能力配置。</p>
    </div>

    ${
      view.investigation
        ? `
      <div class="context-banner context-banner-compact">
        <div class="context-banner-header">
          <div class="context-banner-copy">
            <span class="context-banner-label">Drilldown</span>
            <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
            <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
          </div>
          <div class="context-banner-meta">
            ${view.investigation.focus ? pillHtml(view.investigation.focus, 'warn') : ''}
            ${view.investigation.suggestedCommand ? pillHtml(view.investigation.suggestedCommand, 'neutral') : ''}
            ${view.investigation.context?.source ? pillHtml(view.investigation.context.source, 'neutral') : ''}
          </div>
        </div>
        <div class="context-banner-actions toolbar">
          ${
            view.investigation.suggestedCommand
              ? buttonHtml({
                  action: 'run-intent-diagnostic',
                  label: '执行建议体检',
                  kind: 'primary',
                  disabled: Boolean(view.runningDiagnostic),
                })
              : ''
          }
          ${investigationPrimaryAction(view)}
          ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
        </div>
      </div>
    `
        : ''
    }

    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(surfaceView, 'focus', '常用')}
      ${surfaceTabHtml(surfaceView, 'workspace', '编辑')}
      ${surfaceTabHtml(surfaceView, 'verify', '验证')}
    </div>

    ${surfaceContent}
  `;

  bindEvents(view);

  const configEditor = view.page.querySelector('[data-editor="config"]');
  const envEditor = view.page.querySelector('[data-editor="env"]');
  if (configEditor) {
    configEditor.value = view.configYaml;
  }
  if (envEditor) {
    envEditor.value = view.envFile;
  }

  view.cachedIntents = {
    diagnosticsIntent,
    extensionsIntent,
    gatewayIntent,
    logsIntent,
  };
  flushPendingSectionFocus(view);
}

async function loadData(view, options = {}) {
  const { refreshEditors = true, silent = false } = options;
  const hasData = Boolean(view.data && view.installation);
  const previousData = view.data;
  const previousConfig = view.configYaml;
  const previousEnv = view.envFile;

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [nextConfig, nextSnapshot, nextInstallation, nextSkills, nextExtensions, nextCron] =
      await Promise.all([
        api.getConfigDocuments(profile),
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.listSkills(profile),
        api.getExtensionsSnapshot(profile),
        api.getCronJobs(profile),
      ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.data = nextConfig;
    view.snapshot = nextSnapshot;
    view.installation = nextInstallation;
    view.skills = nextSkills;
    view.extensions = nextExtensions;
    view.cronSnapshot = nextCron;
    view.controlDraft = cloneWorkspace(nextConfig.workspace);
    view.envDraft = cloneEnvWorkspace(nextConfig.envWorkspace);

    const keepConfigDraft =
      !refreshEditors && previousData ? previousConfig !== previousData.configYaml : false;
    const keepEnvDraft =
      !refreshEditors && previousData ? previousEnv !== previousData.envFile : false;

    view.configYaml = keepConfigDraft ? previousConfig : nextConfig.configYaml;
    view.envFile = keepEnvDraft ? previousEnv : nextConfig.envFile;
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

function storeResult(view, label, result) {
  view.lastResult = { label, result };
}

async function runDiagnostic(view, kind, options = {}) {
  const label = getDiagnosticCommand(kind)?.label || kind;
  view.runningDiagnostic = kind;
  renderPage(view);
  try {
    const result = await api.runDiagnostic(kind, view.profile);
    storeResult(view, label, result);
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: false, silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningDiagnostic = null;
    renderPage(view);
  }
}

async function saveDocument(view, target, verify = false) {
  view.saving = target;
  renderPage(view);
  try {
    if (target === 'config') {
      await api.saveConfigYaml(view.configYaml, view.profile);
      notify('success', verify ? 'config.yaml 已保存，开始执行配置体检。' : 'config.yaml 已保存。');
    } else {
      await api.saveEnvFile(view.envFile, view.profile);
      notify('success', verify ? '.env 已保存，开始执行配置体检。' : '.env 已保存。');
    }
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
    ]);
    if (verify) {
      await runDiagnostic(view, 'config-check');
      return;
    }
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function saveStructuredConfig(view) {
  if (view.configYaml !== view.data?.configYaml) {
    notify('error', '你已经手动改动了 YAML 草稿，请先保存或重置 YAML，再使用结构化控制面。');
    return;
  }

  view.saving = 'structured';
  renderPage(view);
  try {
    const sanitizedDraft = {
      ...view.controlDraft,
      toolsets: uniqueValues(view.controlDraft.toolsets),
      platformToolsets: normalizePlatformBindings(view.controlDraft.platformToolsets),
    };
    const nextConfig = await api.saveStructuredConfig(sanitizedDraft, view.profile);
    notify('success', '结构化配置已保存到 config.yaml。');
    view.data = nextConfig;
    view.configYaml = nextConfig.configYaml;
    view.envFile = nextConfig.envFile;
    view.controlDraft = cloneWorkspace(nextConfig.workspace);
    view.platformBindingPlatformInput = '';
    view.platformBindingToolsetsInput = '';
    view.toolsetEntryInput = '';
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function saveStructuredEnv(view) {
  if (view.envFile !== view.data?.envFile) {
    notify('error', '你已经手动改动了 ENV 草稿，请先保存或重置 .env，再使用凭证控制面。');
    return;
  }

  view.saving = 'structured-env';
  renderPage(view);
  try {
    const nextConfig = await api.saveStructuredEnv(view.envDraft, view.profile);
    notify('success', '凭证与通道配置已保存到 .env。');
    view.data = nextConfig;
    view.configYaml = nextConfig.configYaml;
    view.envFile = nextConfig.envFile;
    view.controlDraft = cloneWorkspace(nextConfig.workspace);
    view.envDraft = cloneEnvWorkspace(nextConfig.envWorkspace);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function runConfigCompatAction(view, actionKey, action, label) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    const result = await api.runConfigCompatAction(action, view.profile);
    storeResult(view, label, result);
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    await Promise.all([
      loadShell(view.profile, { silent: true }),
      loadData(view, { refreshEditors: true, silent: true }),
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
      setBusy: value => {
        view.runningAction = value;
        renderPage(view);
      },
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncDirtyPills(view) {
  const configDirtyPill = view.page.querySelector('#config-dirty-pill');
  const envDirtyPill = view.page.querySelector('#env-dirty-pill');
  const structuredDirtyPill = view.page.querySelector('#structured-dirty-pill');
  const credentialsDirtyPill = view.page.querySelector('#credentials-dirty-pill');
  if (configDirtyPill) {
    configDirtyPill.style.display =
      view.data && view.configYaml !== view.data.configYaml ? 'inline-flex' : 'none';
  }
  if (envDirtyPill) {
    envDirtyPill.style.display =
      view.data && view.envFile !== view.data.envFile ? 'inline-flex' : 'none';
  }
  if (structuredDirtyPill) {
    structuredDirtyPill.style.display = structuredConfigDirty(view) ? 'inline-flex' : 'none';
  }
  if (credentialsDirtyPill) {
    credentialsDirtyPill.style.display = structuredEnvDirty(view) ? 'inline-flex' : 'none';
  }
}

function replaceSkillExternalDirs(view, values) {
  view.controlDraft.skillsExternalDirs = uniqueValues(values);
  syncDirtyPills(view);
}

function appendSkillExternalDirs(view, values) {
  const normalized = splitLineValues(values.join('\n'));
  if (!normalized.length) {
    notify('info', '先输入至少一个 Skills 目录。');
    return false;
  }

  const before = view.controlDraft.skillsExternalDirs.length;
  replaceSkillExternalDirs(view, [...view.controlDraft.skillsExternalDirs, ...normalized]);
  const added = view.controlDraft.skillsExternalDirs.length - before;
  notify(
    'success',
    added > 0 ? `已加入 ${added} 个外部 Skills 目录。` : '目录已存在，未重复加入。'
  );
  return true;
}

function replaceTopToolsets(view, values) {
  view.controlDraft.toolsets = uniqueValues(values);
  syncDirtyPills(view);
}

function toggleTopToolset(view, value) {
  const target = String(value ?? '').trim();
  if (!target) {
    return;
  }
  const selected = uniqueValues(view.controlDraft.toolsets);
  replaceTopToolsets(
    view,
    selected.includes(target) ? selected.filter(item => item !== target) : [...selected, target]
  );
}

function replacePlatformBindings(view, bindings) {
  view.controlDraft.platformToolsets = [...(bindings ?? [])].map(item => ({
    platform: String(item?.platform ?? ''),
    toolsets: uniqueValues(item?.toolsets ?? []),
  }));
  syncDirtyPills(view);
}

function updatePlatformBinding(view, index, patch) {
  const bindings = [...(view.controlDraft.platformToolsets ?? [])];
  const current = bindings[index];
  if (!current) {
    return;
  }
  bindings[index] = {
    ...current,
    ...patch,
  };
  replacePlatformBindings(view, bindings);
}

function addPlatformBinding(view, platformValue, toolsetsValue) {
  const platform = String(platformValue ?? '').trim();
  const toolsets = Array.isArray(toolsetsValue)
    ? uniqueValues(toolsetsValue)
    : splitLineValues(String(toolsetsValue ?? ''));

  if (!platform) {
    notify('info', '先填写平台标识，再加入绑定。');
    return false;
  }

  if (!toolsets.length) {
    notify('info', '至少补一组 toolset，平台绑定才能生效。');
    return false;
  }

  const bindings = [...(view.controlDraft.platformToolsets ?? [])];
  const existingIndex = bindings.findIndex(
    item =>
      String(item?.platform ?? '')
        .trim()
        .toLowerCase() === platform.toLowerCase()
  );
  if (existingIndex >= 0) {
    bindings[existingIndex] = {
      ...bindings[existingIndex],
      platform,
      toolsets: uniqueValues([...(bindings[existingIndex]?.toolsets ?? []), ...toolsets]),
    };
  } else {
    bindings.push({ platform, toolsets });
  }
  replacePlatformBindings(view, bindings);
  return true;
}

function removePlatformBinding(view, index) {
  replacePlatformBindings(
    view,
    (view.controlDraft.platformToolsets ?? []).filter((_, itemIndex) => itemIndex !== index)
  );
}

function toggleBindingToolset(view, index, value) {
  const target = String(value ?? '').trim();
  if (!target) {
    return;
  }
  const current = view.controlDraft.platformToolsets?.[index];
  if (!current) {
    return;
  }
  const nextToolsets = uniqueValues(current.toolsets ?? []);
  updatePlatformBinding(view, index, {
    toolsets: nextToolsets.includes(target)
      ? nextToolsets.filter(item => item !== target)
      : [...nextToolsets, target],
  });
}

function syncWithPanelState(view) {
  const shell = getPanelState();
  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.data = null;
    view.snapshot = null;
    view.installation = null;
    view.extensions = null;
    view.cronSnapshot = null;
    view.skills = [];
    view.error = null;
    view.configYaml = '';
    view.controlModelView = 'status';
    view.controlToolsetView = 'status';
    view.controlDraft = cloneWorkspace();
    view.envDraft = cloneEnvWorkspace();
    view.envFile = '';
    view.platformBindingPlatformInput = '';
    view.platformBindingToolsetsInput = '';
    view.skillDirBulkInput = '';
    view.skillDirInput = '';
    view.showSkillDirBulk = false;
    view.toolsetEntryInput = '';
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('config');
  if (nextIntent) {
    view.investigation = nextIntent;
    view.surfaceView = 'workspace';
    if (nextIntent.focus === 'credentials') {
      view.editorTab = 'credentials';
    } else if (nextIntent.focus) {
      view.editorTab = 'control';
    }
    const focusTarget = workspaceSectionFromFocus(nextIntent.focus);
    if (focusTarget) {
      view.activeWorkspaceSection = focusTarget.sectionId;
      applyWorkspaceSubviewForSection(view, focusTarget.sectionId);
    }
    consumePageIntent();
    renderPage(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindEvents(view) {
  view.page.querySelectorAll('[data-config-surface]').forEach(element => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-config-surface');
      if (!nextView || nextView === view.surfaceView) {
        return;
      }
      view.surfaceView = nextView;
      renderPage(view);
    };
  });

  view.page.querySelectorAll('[data-verify-view]').forEach(element => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-verify-view');
      if (!nextView || nextView === view.verifyView) {
        return;
      }
      view.verifyView = nextView;
      renderPage(view);
    };
  });

  view.page.querySelectorAll('[data-control-model-view]').forEach(element => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-control-model-view');
      if (!nextView || nextView === view.controlModelView) {
        return;
      }
      view.controlModelView = nextView;
      view.editorTab = 'control';
      view.activeWorkspaceSection =
        nextView === 'connect'
          ? 'model-presets'
          : nextView === 'detail'
            ? 'model-detail'
            : 'model-governance';
      renderPage(view);
    };
  });

  view.page.querySelectorAll('[data-control-toolset-view]').forEach(element => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-control-toolset-view');
      if (!nextView || nextView === view.controlToolsetView) {
        return;
      }
      view.controlToolsetView = nextView;
      view.editorTab = 'control';
      view.activeWorkspaceSection =
        nextView === 'platform'
          ? 'toolsets-detail'
          : nextView === 'manual'
            ? 'toolsets-manual'
            : nextView === 'presets'
              ? 'toolsets-presets'
              : 'toolsets-overview';
      renderPage(view);
    };
  });

  const configEditor = view.page.querySelector('[data-editor="config"]');
  const envEditor = view.page.querySelector('[data-editor="env"]');

  if (configEditor) {
    configEditor.oninput = event => {
      view.configYaml = event.target.value;
      syncDirtyPills(view);
    };
  }

  if (envEditor) {
    envEditor.oninput = event => {
      view.envFile = event.target.value;
      syncDirtyPills(view);
    };
  }

  const bindControlValue = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('input', event => {
      view.controlDraft[key] = event.target.value;
      syncDirtyPills(view);
    });
  };

  const bindControlCheckbox = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('change', event => {
      view.controlDraft[key] = event.target.checked;
      syncDirtyPills(view);
    });
  };

  const bindEnvValue = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('input', event => {
      view.envDraft[key] = event.target.value;
      syncDirtyPills(view);
    });
  };

  const bindEnvCheckbox = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('change', event => {
      view.envDraft[key] = event.target.checked;
      syncDirtyPills(view);
    });
  };

  bindControlValue('#control-model-default', 'modelDefault');
  bindControlValue('#control-model-provider', 'modelProvider');
  bindControlValue('#control-model-base-url', 'modelBaseUrl');
  bindControlValue('#control-context-engine', 'contextEngine');
  bindControlValue('#control-terminal-backend', 'terminalBackend');
  bindControlValue('#control-terminal-cwd', 'terminalCwd');
  bindControlValue('#control-personality', 'personality');
  bindControlValue('#control-memory-provider', 'memoryProvider');
  bindControlValue('#control-discord-free-response', 'discordFreeResponseChannels');
  bindControlValue('#control-discord-allowed', 'discordAllowedChannels');

  bindControlCheckbox('#control-streaming-enabled', 'streamingEnabled');
  bindControlCheckbox('#control-memory-enabled', 'memoryEnabled');
  bindControlCheckbox('#control-user-profile-enabled', 'userProfileEnabled');
  bindControlCheckbox('#control-discord-require-mention', 'discordRequireMention');
  bindControlCheckbox('#control-discord-auto-thread', 'discordAutoThread');
  bindControlCheckbox('#control-discord-reactions', 'discordReactions');

  view.page.querySelector('#control-memory-char-limit')?.addEventListener('input', event => {
    view.controlDraft.memoryCharLimit = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-user-char-limit')?.addEventListener('input', event => {
    view.controlDraft.userCharLimit = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-approvals-timeout')?.addEventListener('input', event => {
    view.controlDraft.approvalsTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#control-approvals-mode')?.addEventListener('change', event => {
    view.controlDraft.approvalsMode = event.target.value;
    syncDirtyPills(view);
  });

  const toolsetEntry = view.page.querySelector('#control-toolset-entry');
  if (toolsetEntry) {
    toolsetEntry.addEventListener('input', event => {
      view.toolsetEntryInput = event.target.value;
    });
    toolsetEntry.addEventListener('keydown', event => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      const value = String(view.toolsetEntryInput || '').trim();
      if (!value) {
        notify('info', '先输入一个自定义 toolset。');
        return;
      }
      toggleTopToolset(view, value);
      view.toolsetEntryInput = '';
      renderPage(view);
    });
  }

  const platformBindingPlatform = view.page.querySelector('#control-platform-binding-platform');
  if (platformBindingPlatform) {
    platformBindingPlatform.addEventListener('input', event => {
      view.platformBindingPlatformInput = event.target.value;
    });
  }

  const platformBindingToolsets = view.page.querySelector('#control-platform-binding-toolsets');
  if (platformBindingToolsets) {
    platformBindingToolsets.addEventListener('input', event => {
      view.platformBindingToolsetsInput = event.target.value;
    });
    platformBindingToolsets.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      if (
        addPlatformBinding(
          view,
          view.platformBindingPlatformInput,
          view.platformBindingToolsetsInput
        )
      ) {
        view.platformBindingPlatformInput = '';
        view.platformBindingToolsetsInput = '';
        renderPage(view);
      }
    });
  }

  view.page.querySelectorAll('[data-binding-platform-index]').forEach(element => {
    element.addEventListener('input', event => {
      const index = Number.parseInt(
        event.target.getAttribute('data-binding-platform-index') || '',
        10
      );
      if (Number.isNaN(index)) {
        return;
      }
      updatePlatformBinding(view, index, { platform: event.target.value });
    });
  });

  view.page.querySelectorAll('[data-binding-toolsets-index]').forEach(element => {
    element.addEventListener('input', event => {
      const index = Number.parseInt(
        event.target.getAttribute('data-binding-toolsets-index') || '',
        10
      );
      if (Number.isNaN(index)) {
        return;
      }
      updatePlatformBinding(view, index, { toolsets: splitLineValues(event.target.value) });
    });
  });

  const skillDirEntry = view.page.querySelector('#control-skill-dir-entry');
  if (skillDirEntry) {
    skillDirEntry.addEventListener('input', event => {
      view.skillDirInput = event.target.value;
    });
    skillDirEntry.addEventListener('keydown', event => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      const added = appendSkillExternalDirs(view, splitLineValues(view.skillDirInput || ''));
      if (added) {
        view.skillDirInput = '';
        renderPage(view);
      }
    });
  }

  const skillDirBulk = view.page.querySelector('#control-skill-dir-bulk');
  if (skillDirBulk) {
    skillDirBulk.addEventListener('input', event => {
      view.skillDirBulkInput = event.target.value;
    });
    skillDirBulk.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      const added = appendSkillExternalDirs(view, splitLineValues(view.skillDirBulkInput || ''));
      if (added) {
        view.skillDirBulkInput = '';
        view.showSkillDirBulk = false;
        renderPage(view);
      }
    });
  }

  bindEnvValue('#env-openai-api-key', 'openaiApiKey');
  bindEnvValue('#env-openrouter-api-key', 'openrouterApiKey');
  bindEnvValue('#env-anthropic-api-key', 'anthropicApiKey');
  bindEnvValue('#env-google-api-key', 'googleApiKey');
  bindEnvValue('#env-hf-token', 'hfToken');
  bindEnvValue('#env-anyrouter2-api-key', 'anyrouter2ApiKey');
  bindEnvValue('#env-crs-api-key', 'crsApiKey');
  bindEnvValue('#env-siliconflow-api-key', 'siliconflowApiKey');
  bindEnvValue('#env-hermes-gateway-token', 'hermesGatewayToken');
  bindEnvValue('#env-telegram-bot-token', 'telegramBotToken');
  bindEnvValue('#env-telegram-home-channel', 'telegramHomeChannel');
  bindEnvValue('#env-telegram-reply-to-mode', 'telegramReplyToMode');
  bindEnvValue('#env-discord-bot-token', 'discordBotToken');
  bindEnvValue('#env-discord-home-channel', 'discordHomeChannel');
  bindEnvValue('#env-discord-reply-to-mode', 'discordReplyToMode');
  bindEnvValue('#env-slack-bot-token', 'slackBotToken');
  bindEnvValue('#env-terminal-modal-image', 'terminalModalImage');
  bindEnvCheckbox('#env-whatsapp-enabled', 'whatsappEnabled');

  view.page.querySelector('#env-terminal-timeout')?.addEventListener('input', event => {
    view.envDraft.terminalTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#env-terminal-lifetime-seconds')?.addEventListener('input', event => {
    view.envDraft.terminalLifetimeSeconds = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#env-browser-session-timeout')?.addEventListener('input', event => {
    view.envDraft.browserSessionTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelector('#env-browser-inactivity-timeout')?.addEventListener('input', event => {
    view.envDraft.browserInactivityTimeout = parseOptionalNumber(event.target.value);
    syncDirtyPills(view);
  });

  view.page.querySelectorAll('[data-action]').forEach(element => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'refresh') {
        await Promise.all([
          loadShell(view.profile, { silent: true }),
          loadData(view, { refreshEditors: true, silent: true }),
        ]);
        return;
      }

      if (!view.installation || !view.data) {
        return;
      }

      switch (action) {
        case 'focus-workspace':
          queueWorkspaceFocus(
            view,
            element.getAttribute('data-tab') || 'control',
            element.getAttribute('data-section') || ''
          );
          return;
        case 'toggle-compatibility-actions':
          view.showCompatibilityActions = !view.showCompatibilityActions;
          renderPage(view);
          return;
        case 'switch-editor-tab':
          view.pendingSectionFocus = null;
          view.activeWorkspaceSection = null;
          view.editorTab = element.getAttribute('data-tab') || 'config';
          renderPage(view);
          return;
        case 'apply-provider-preset': {
          const preset = getProviderPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.modelProvider = preset.provider;
          view.controlDraft.modelBaseUrl = preset.baseUrl;
          renderPage(view);
          notify('success', `已应用 ${preset.label} Provider 预设。`);
          if (preset.envKey && !envPresetReady(view, preset.envKey)) {
            notify('info', `还需要在凭证页补齐 ${preset.envLabel}。`);
          }
          return;
        }
        case 'apply-model-preset': {
          const preset = getProviderPreset(element.getAttribute('data-preset'));
          const model = String(element.getAttribute('data-model') || '').trim();
          if (!preset || !model) {
            return;
          }
          view.controlDraft.modelProvider = preset.provider;
          view.controlDraft.modelBaseUrl = preset.baseUrl;
          view.controlDraft.modelDefault = model;
          renderPage(view);
          notify('success', `默认模型已切到 ${model}。`);
          if (preset.envKey && !envPresetReady(view, preset.envKey)) {
            notify('info', `还需要在凭证页补齐 ${preset.envLabel}。`);
          }
          return;
        }
        case 'apply-context-preset': {
          const value = String(element.getAttribute('data-value') || '').trim();
          view.controlDraft.contextEngine = value;
          renderPage(view);
          notify('success', `上下文引擎已切到 ${value || '默认值'}。`);
          return;
        }
        case 'toggle-streaming-output':
          view.controlDraft.streamingEnabled = !view.controlDraft.streamingEnabled;
          renderPage(view);
          notify(
            'success',
            view.controlDraft.streamingEnabled ? '已开启流式输出。' : '已关闭流式输出。'
          );
          return;
        case 'apply-base-url-value': {
          view.controlDraft.modelBaseUrl = String(element.getAttribute('data-value') || '').trim();
          renderPage(view);
          notify(
            'success',
            view.controlDraft.modelBaseUrl
              ? 'Base URL 已更新。'
              : '已清空 Base URL，改为跟随 provider 默认值。'
          );
          return;
        }
        case 'apply-toolset-preset': {
          const preset = getToolsetPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.toolsets = uniqueValues(preset.toolsets);
          view.controlDraft.platformToolsets = normalizePlatformBindings(preset.platformToolsets);
          renderPage(view);
          notify('success', `已应用 ${preset.label} 能力预设。`);
          return;
        }
        case 'apply-memory-preset': {
          const preset = getMemoryPreset(view, element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.memoryEnabled = Boolean(preset.memoryEnabled);
          view.controlDraft.userProfileEnabled = Boolean(
            preset.userProfileEnabled && preset.memoryEnabled
          );
          view.controlDraft.memoryProvider = preset.memoryEnabled
            ? String(preset.provider || '')
            : '';
          if (preset.memoryEnabled) {
            view.controlDraft.toolsets = uniqueValues([...view.controlDraft.toolsets, 'memory']);
          } else {
            view.controlDraft.toolsets = view.controlDraft.toolsets.filter(
              item => item !== 'memory'
            );
          }
          renderPage(view);
          notify(
            'success',
            preset.memoryEnabled ? `已切换到 ${preset.label}。` : '已关闭记忆与用户画像。'
          );
          return;
        }
        case 'apply-terminal-preset': {
          const preset = getTerminalPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          view.controlDraft.terminalBackend = preset.backend;
          view.controlDraft.terminalCwd = preset.cwd;
          view.envDraft.terminalTimeout = preset.terminalTimeout;
          view.envDraft.terminalLifetimeSeconds = preset.terminalLifetimeSeconds;
          if (preset.terminalModalImage) {
            view.envDraft.terminalModalImage = preset.terminalModalImage;
          }
          renderPage(view);
          notify('success', `已应用 ${preset.label} terminal backend 预设。`);
          if (preset.partial) {
            notify('info', '如果还要补镜像、主机或资源配额等细项，可以继续在 YAML 页精修。');
          }
          return;
        }
        case 'apply-channel-preset': {
          const preset = getChannelPreset(element.getAttribute('data-preset'));
          if (!preset) {
            return;
          }
          if (preset.modeKey && !String(view.envDraft[preset.modeKey] ?? '').trim()) {
            view.envDraft[preset.modeKey] = preset.modeDefault;
          }
          renderPage(view);
          notify('success', `已应用 ${preset.label} 通道骨架。`);
          if (!envPresetReady(view, preset.tokenKey)) {
            notify('info', `还需要补齐 ${preset.tokenLabel}。`);
          }
          return;
        }
        case 'run-intent-diagnostic':
          if (view.investigation?.suggestedCommand) {
            await runDiagnostic(view, view.investigation.suggestedCommand);
          }
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'diagnostic-config-check':
          await runDiagnostic(view, 'config-check');
          return;
        case 'diagnostic-doctor':
          await runDiagnostic(view, 'doctor');
          return;
        case 'diagnostic-memory-status':
          await runDiagnostic(view, 'memory-status');
          return;
        case 'diagnostic-gateway-status':
          await runDiagnostic(view, 'gateway-status');
          return;
        case 'save-config':
          await saveDocument(view, 'config', false);
          return;
        case 'save-structured-config':
          await saveStructuredConfig(view);
          return;
        case 'save-structured-env':
          await saveStructuredEnv(view);
          return;
        case 'toggle-top-toolset':
          toggleTopToolset(view, element.getAttribute('data-value'));
          renderPage(view);
          return;
        case 'add-top-toolset': {
          const value = String(view.toolsetEntryInput || '').trim();
          if (!value) {
            notify('info', '先输入一个自定义 toolset。');
            return;
          }
          toggleTopToolset(view, value);
          view.toolsetEntryInput = '';
          renderPage(view);
          return;
        }
        case 'clear-top-toolsets':
          replaceTopToolsets(view, []);
          renderPage(view);
          return;
        case 'add-platform-binding': {
          if (
            addPlatformBinding(
              view,
              view.platformBindingPlatformInput,
              view.platformBindingToolsetsInput
            )
          ) {
            view.platformBindingPlatformInput = '';
            view.platformBindingToolsetsInput = '';
            renderPage(view);
          }
          return;
        }
        case 'add-platform-binding-preset': {
          const presetId = String(element.getAttribute('data-preset') || '').trim();
          const presetMap = {
            'cli-default': { platform: 'cli', toolsets: ['hermes-cli'] },
            'cli-dev': {
              platform: 'cli',
              toolsets: [
                'web',
                'browser',
                'terminal',
                'file',
                'skills',
                'todo',
                'memory',
                'session_search',
                'code_execution',
              ],
            },
            'telegram-link': { platform: 'telegram', toolsets: ['hermes-telegram'] },
            'discord-link': { platform: 'discord', toolsets: ['hermes-discord'] },
            'slack-link': { platform: 'slack', toolsets: ['hermes-slack'] },
          };
          const suggestion = presetMap[presetId];
          if (suggestion && addPlatformBinding(view, suggestion.platform, suggestion.toolsets)) {
            renderPage(view);
          }
          return;
        }
        case 'remove-platform-binding': {
          const index = Number.parseInt(element.getAttribute('data-index') || '', 10);
          if (Number.isNaN(index)) {
            return;
          }
          removePlatformBinding(view, index);
          renderPage(view);
          return;
        }
        case 'clear-platform-bindings':
          replacePlatformBindings(view, []);
          renderPage(view);
          return;
        case 'toggle-binding-toolset': {
          const index = Number.parseInt(element.getAttribute('data-index') || '', 10);
          if (Number.isNaN(index)) {
            return;
          }
          toggleBindingToolset(view, index, element.getAttribute('data-value'));
          renderPage(view);
          return;
        }
        case 'add-skill-external-dir': {
          const added = appendSkillExternalDirs(view, splitLineValues(view.skillDirInput || ''));
          if (added) {
            view.skillDirInput = '';
            renderPage(view);
          }
          return;
        }
        case 'add-skill-external-suggestion': {
          const path = String(element.getAttribute('data-value') || '').trim();
          if (!path) {
            return;
          }
          if (appendSkillExternalDirs(view, [path])) {
            renderPage(view);
          }
          return;
        }
        case 'remove-skill-external-dir': {
          const path = String(element.getAttribute('data-path') || '').trim();
          if (!path) {
            return;
          }
          replaceSkillExternalDirs(
            view,
            view.controlDraft.skillsExternalDirs.filter(item => item !== path)
          );
          notify('success', '已从外部 Skills 目录列表移除。');
          renderPage(view);
          return;
        }
        case 'open-skill-external-dir': {
          const path = String(element.getAttribute('data-path') || '').trim();
          if (!path) {
            return;
          }
          await runFinderAction(
            view,
            'finder:skills-external-dir',
            '外部 Skills 目录',
            path,
            false
          );
          return;
        }
        case 'toggle-skill-dir-bulk':
          view.showSkillDirBulk = !view.showSkillDirBulk;
          renderPage(view);
          return;
        case 'merge-skill-external-bulk': {
          const added = appendSkillExternalDirs(
            view,
            splitLineValues(view.skillDirBulkInput || '')
          );
          if (added) {
            view.skillDirBulkInput = '';
            view.showSkillDirBulk = false;
            renderPage(view);
          }
          return;
        }
        case 'clear-skill-dir-bulk':
          view.skillDirBulkInput = '';
          renderPage(view);
          return;
        case 'reset-structured-config':
          view.controlDraft = cloneWorkspace(view.data.workspace);
          view.platformBindingPlatformInput = '';
          view.platformBindingToolsetsInput = '';
          view.skillDirInput = '';
          view.skillDirBulkInput = '';
          view.showSkillDirBulk = false;
          view.toolsetEntryInput = '';
          renderPage(view);
          return;
        case 'reset-structured-env':
          view.envDraft = cloneEnvWorkspace(view.data.envWorkspace);
          renderPage(view);
          return;
        case 'save-config-verify':
          await saveDocument(view, 'config', true);
          return;
        case 'save-env':
          await saveDocument(view, 'env', false);
          return;
        case 'save-env-verify':
          await saveDocument(view, 'env', true);
          return;
        case 'compat-config-migrate':
          await runConfigCompatAction(
            view,
            'config:compat-migrate',
            'config-migrate',
            '迁移旧配置'
          );
          return;
        case 'compat-claw-migrate':
          await runConfigCompatAction(view, 'config:claw-migrate', 'claw-migrate', '导入 OpenClaw');
          return;
        case 'open-home':
          await runFinderAction(view, 'finder:home', 'Hermes Home', view.data.hermesHome, false);
          return;
        case 'open-config':
          await runFinderAction(view, 'finder:config', 'config.yaml', view.data.configPath, true);
          return;
        case 'open-env':
          await runFinderAction(view, 'finder:env', '.env', view.data.envPath, true);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', view.cachedIntents?.diagnosticsIntent);
          return;
        case 'goto-extensions':
          navigate('extensions', view.cachedIntents?.extensionsIntent);
          return;
        case 'goto-gateway':
          navigate('gateway', view.cachedIntents?.gatewayIntent);
          return;
        case 'goto-logs':
          navigate('logs', view.cachedIntents?.logsIntent);
          return;
        case 'goto-memory':
          navigate('memory');
          return;
        case 'goto-related-page':
          navigate(element.getAttribute('data-page'));
          return;
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
    activeWorkspaceSection: null,
    cachedIntents: null,
    configYaml: '',
    controlModelView: 'status',
    controlToolsetView: 'status',
    controlDraft: cloneWorkspace(),
    cronSnapshot: null,
    data: null,
    destroyed: false,
    editorTab: 'control',
    envDraft: cloneEnvWorkspace(),
    envFile: '',
    error: null,
    extensions: null,
    installation: null,
    investigation: getPageIntent('config'),
    lastResult: null,
    loading: true,
    page,
    pendingSectionFocus: null,
    platformBindingPlatformInput: '',
    platformBindingToolsetsInput: '',
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    runningDiagnostic: null,
    saving: null,
    skills: [],
    surfaceView: 'focus',
    verifyView: 'status',
    skillDirBulkInput: '',
    skillDirInput: '',
    showCompatibilityActions: false,
    showSkillDirBulk: false,
    snapshot: null,
    toolsetEntryInput: '',
    unsubscribe: null,
  };

  if (activeView.investigation) {
    const focusTarget = workspaceSectionFromFocus(activeView.investigation.focus);
    if (focusTarget) {
      activeView.editorTab = focusTarget.tab;
      activeView.activeWorkspaceSection = focusTarget.sectionId;
      applyWorkspaceSubviewForSection(activeView, focusTarget.sectionId);
      activeView.pendingSectionFocus = {
        ...focusTarget,
        behavior: 'auto',
      };
    } else if (activeView.investigation.focus === 'credentials') {
      activeView.editorTab = 'credentials';
    } else if (activeView.investigation.focus) {
      activeView.editorTab = 'control';
    }
    consumePageIntent();
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView, { refreshEditors: true });
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
