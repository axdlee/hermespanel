import {
  CAPABILITY_DIAGNOSTIC_COMMANDS,
  RUNTIME_DIAGNOSTIC_COMMANDS,
  getDiagnosticCommand,
} from '../lib/diagnostics';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
} from '../lib/drilldown';
import { formatTimestamp } from '../lib/format';
import { buildRuntimePosture } from '../lib/posture';
import { consumePageIntent, getPageIntent, getPanelState, navigate, notify, subscribePanelState } from '../lib/panel-state';
import {
  enabledToolCount,
  hasCronFailure,
  isRemoteDelivery,
  pluginsCount,
  totalToolCount,
} from '../lib/runtime';
import { api } from '../lib/api';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
} from './native-helpers';
import { infoTipHtml } from './workbench-helpers';

let activeView = null;

const LOG_OPTIONS = [
  { key: 'gateway.error', label: 'gateway.error.log' },
  { key: 'gateway', label: 'gateway.log' },
  { key: 'errors', label: 'errors.log' },
  { key: 'agent', label: 'agent.log' },
];

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function pageLabel(page) {
  switch (page) {
    case 'config':
      return '配置页';
    case 'gateway':
      return '网关页';
    case 'extensions':
      return '扩展页';
    case 'memory':
      return '记忆页';
    case 'sessions':
      return '会话页';
    case 'diagnostics':
      return '诊断页';
    case 'logs':
      return '日志页';
    case 'skills':
      return '技能页';
    case 'cron':
      return 'Cron 页';
    case 'dashboard':
    default:
      return '控制中心';
  }
}

function postureButtonKind(tone) {
  if (tone === 'bad') {
    return 'danger';
  }
  if (tone === 'good') {
    return 'primary';
  }
  return 'secondary';
}

function diagnosticButtonKind(kind) {
  return kind === 'primary' ? 'primary' : 'secondary';
}

function surfaceTabHtml(activeKey, key, label) {
  return `
    <button type="button" class="tab ${activeKey === key ? 'active' : ''}" data-diagnostics-surface="${key}">
      ${escapeHtml(label)}
    </button>
  `;
}

function launcherCardHtml({ action, kicker, title, meta, tone = 'neutral', attrs = {} }) {
  const attrsHtml = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(' ');

  return `
    <button type="button" class="dashboard-jump-card dashboard-jump-card-${tone}" data-action="${escapeHtml(action)}" ${attrsHtml}>
      <span class="dashboard-jump-kicker">${escapeHtml(kicker)}</span>
      <strong class="dashboard-jump-title">${escapeHtml(title)}</strong>
      <span class="dashboard-jump-meta">${escapeHtml(meta)}</span>
    </button>
  `;
}

function storeResult(view, label, result, diagnosticKind = null) {
  view.lastKind = diagnosticKind;
  view.resultPayload = {
    label,
    result,
    finishedAt: new Date().toISOString(),
  };
}

function applyIntent(view, intent, announce = true) {
  if (!intent) {
    return;
  }

  view.investigation = intent;
  view.logName = intent.logName ?? 'gateway.error';
  view.surfaceView = intent.suggestedCommand ? 'repair' : 'artifacts';
  consumePageIntent();
  if (announce) {
    notify('info', `${intent.headline} 已带入诊断工作台。`);
  }
}

function relaySeed(view) {
  return view.investigation
    ? {
        sourcePage: 'diagnostics',
        headline: view.investigation.headline,
        description: view.investigation.description,
        context: view.investigation.context,
      }
    : {
        sourcePage: 'diagnostics',
        headline: '从诊断台继续修复',
        description: '继续围绕安装、配置、网关、技能、插件和记忆链路闭环。',
      };
}

function derivedState(view) {
  const jobs = view.cronSnapshot?.jobs ?? [];
  const skillNames = new Set((view.skills ?? []).map((item) => item.name));
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const failingJobs = jobs.filter(hasCronFailure);
  const missingReferencedSkills = Array.from(new Set(
    jobs.flatMap((job) => job.skills).filter((name) => !skillNames.has(name)),
  ));
  const posture = buildRuntimePosture({
    configDocuments: view.config,
    cronSnapshot: view.cronSnapshot,
    dashboard: view.snapshot,
    extensions: view.extensions,
    skills: view.skills,
  });
  const memoryRuntimeReady = view.extensions ? !view.extensions.memoryRuntime.provider.includes('none') : false;
  const warnings = [...(view.snapshot?.warnings ?? [])];

  posture.priorities.forEach((item) => warnings.push(`${item.title}：${item.detail}`));
  if (view.installation && !view.installation.binaryFound) {
    warnings.push('当前还没有检测到 Hermes 运行组件，很多问题在修复前都需要先完成安装或重新安装。');
  }
  if (missingReferencedSkills.length > 0) {
    warnings.push(`存在 ${missingReferencedSkills.length} 个被 jobs.json 引用但当前未扫描到的 skill：${missingReferencedSkills.join('、')}。`);
  }
  if (!(view.skills ?? []).length && jobs.some((job) => job.skills.length > 0)) {
    warnings.push('cron 作业声明了 skills，但当前 profile 没扫到任何本地技能，能力面很可能不完整。');
  }
  if (failingJobs.length > 0) {
    warnings.push(`当前已有 ${failingJobs.length} 个 cron 作业出现错误或投递异常，建议结合日志一起看。`);
  }

  return {
    actionBusy: Boolean(view.running || view.runningDesktopAction),
    combinedWarnings: Array.from(new Set(warnings)),
    failingJobs,
    lastCommand: view.lastKind ? getDiagnosticCommand(view.lastKind) : null,
    logsDir: view.logPreview?.filePath
      ? directoryOf(view.logPreview.filePath)
      : view.snapshot
        ? `${view.snapshot.hermesHome}/logs`
        : '',
    memoryRuntimeReady,
    missingReferencedSkills,
    posture,
    remoteJobs,
  };
}

function renderDiagnosticGrid(commands, view) {
  return `
    <div class="control-card-grid control-card-grid-dense">
      ${commands.map((item) => `
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">${item.scope === 'runtime' ? '封装诊断' : '能力核验'}</p>
              <h3 class="action-card-title">${escapeHtml(item.label)}</h3>
            </div>
            ${pillHtml(item.key, item.kind === 'primary' ? 'good' : item.scope === 'capability' ? 'neutral' : 'warn')}
          </div>
          <p class="action-card-copy">${escapeHtml(item.description)}</p>
          <p class="workspace-inline-meta">${escapeHtml(`底层动作：${item.cli}`)}</p>
          <div class="toolbar">
            ${buttonHtml({
              action: 'run-diagnostic',
              label: view.running === item.key ? `${item.label}…` : '运行诊断',
              kind: diagnosticButtonKind(item.kind),
              disabled: view.running !== null,
              attrs: { 'data-kind': item.key },
            })}
            ${buttonHtml({
              action: 'navigate-page',
              label: item.relatedPage === 'diagnostics' ? '留在诊断页' : `进入${pageLabel(item.relatedPage)}`,
              disabled: item.relatedPage === 'diagnostics',
              attrs: { 'data-page': item.relatedPage },
            })}
          </div>
        </section>
      `).join('')}
    </div>
  `;
}

function renderContextBanner(view) {
  if (!view.investigation) {
    return '';
  }

  return `
    <div class="context-banner context-banner-compact">
      <div class="context-banner-header">
        <div class="context-banner-copy">
          <span class="context-banner-label">排障上下文</span>
          <strong class="context-banner-title">${escapeHtml(view.investigation.headline)}</strong>
          <p class="context-banner-description">${escapeHtml(view.investigation.description)}</p>
        </div>
        <div class="context-banner-meta">
          ${view.investigation.suggestedCommand ? pillHtml(view.investigation.suggestedCommand, 'warn') : ''}
          ${pillHtml(view.investigation.logName ?? view.logName)}
          ${pillHtml(view.investigation.context?.source ?? 'sessions')}
        </div>
      </div>
      <div class="context-banner-actions toolbar">
        ${view.investigation.suggestedCommand ? buttonHtml({
          action: 'run-suggested',
          label: '运行建议诊断',
          kind: 'primary',
          disabled: view.running !== null,
        }) : ''}
        ${buttonHtml({ action: 'clear-investigation', label: '清除' })}
        ${buttonHtml({ action: 'goto-logs', label: '日志页' })}
      </div>
    </div>
  `;
}

function renderPostureHtml(posture) {
  return `
    <div class="result-header">
      <div>
        <p class="eyebrow">运行姿态</p>
        <h3 class="action-card-title">${escapeHtml(posture.headline)}</h3>
      </div>
      ${pillHtml(posture.tone === 'bad' ? '高风险' : posture.tone === 'warn' ? '关注' : posture.tone === 'neutral' ? '观察' : '稳定', posture.tone)}
    </div>
    <p class="helper-text">${escapeHtml(posture.summary)}</p>
    <div class="health-grid health-grid-dense top-gap">
      ${posture.items.map((item) => `
        <section class="health-card">
          <div class="health-card-header">
            <strong>${escapeHtml(item.title)}</strong>
            ${pillHtml(item.summary, item.tone)}
          </div>
          <p>${escapeHtml(item.detail)}</p>
          ${item.page ? `
            <div class="toolbar">
              ${buttonHtml({
                action: 'navigate-page',
                label: item.actionLabel || `进入${pageLabel(item.page)}`,
                kind: postureButtonKind(item.tone),
                attrs: { 'data-page': item.page },
              })}
            </div>
          ` : ''}
        </section>
      `).join('')}
    </div>
    ${
      posture.priorities.length > 0
        ? `
          <div class="warning-stack top-gap">
            ${posture.priorities.slice(0, 4).map((item) => `<div class="warning-item">${escapeHtml(`${item.title}：${item.detail}`)}</div>`).join('')}
          </div>
        `
        : `<p class="helper-text top-gap">当前没有新的高优先项，可以继续做能力核验或直接下钻到对应工作台。</p>`
    }
  `;
}

function renderFocusSurface(view, state) {
  const gatewayState = view.snapshot?.gateway?.gatewayState ?? '未检测到';
  const prioritiesCount = state.posture.priorities.length;
  const toolsEnabled = enabledToolCount(view.extensions);
  const toolsTotal = totalToolCount(view.extensions);
  const pluginCount = pluginsCount(view.extensions);
  const binaryFound = Boolean(view.installation?.binaryFound);
  const focusState = !binaryFound
    ? {
      description: '先把 Hermes 本体和基础依赖拉稳，再继续处理 Gateway、Skills、Memory 和 Plugins 闭环。',
      kicker: '先补底座',
      primary: buttonHtml({ action: 'install-cli', label: '安装 Hermes', kind: 'primary', disabled: state.actionBusy || !view.installation }),
      secondary: buttonHtml({ action: 'open-diagnostics-surface', label: '看修复台', attrs: { 'data-surface': 'repair' } }),
      title: '当前更适合先做安装和环境修复',
      tone: 'warn',
    }
    : prioritiesCount > 0
      ? {
        description: '已经定位出高优先项，默认层先给结论和去向，具体诊断命令与修复动作放到修复台。',
        kicker: '先修主链路',
        primary: buttonHtml({ action: 'open-diagnostics-surface', label: '进入修复台', kind: 'primary', attrs: { 'data-surface': 'repair' } }),
        secondary: buttonHtml({ action: 'open-diagnostics-surface', label: '看材料与回执', attrs: { 'data-surface': 'artifacts' } }),
        title: `${prioritiesCount} 个高优先项待处理`,
        tone: 'warn',
      }
      : state.remoteJobs.length > 0 && gatewayState !== 'running'
        ? {
          description: '远端作业已经存在，但 Gateway 还没真正跑稳，优先去修运行链路。',
          kicker: '先修运行面',
          primary: buttonHtml({ action: 'goto-gateway-workbench', label: '去 Gateway', kind: 'primary', disabled: state.actionBusy || !binaryFound }),
          secondary: buttonHtml({ action: 'open-diagnostics-surface', label: '进入修复台', attrs: { 'data-surface': 'repair' } }),
          title: 'Gateway 和远端投递还没闭环',
          tone: 'warn',
        }
        : state.missingReferencedSkills.length > 0
          ? {
            description: '当前编排引用了本地没有扫描到的技能，建议优先回能力面补齐。',
            kicker: '先补能力缺口',
            primary: buttonHtml({ action: 'goto-skills-workbench', label: '去技能工作台', kind: 'primary', disabled: state.actionBusy || !binaryFound }),
            secondary: buttonHtml({ action: 'goto-extensions-workbench', label: '去扩展治理', disabled: state.actionBusy || !binaryFound }),
            title: 'Skills 引用仍然存在缺口',
            tone: 'warn',
          }
          : {
            description: '查看当前诊断结论与最近信号。',
            kicker: '可以继续',
            primary: buttonHtml({ action: 'open-diagnostics-surface', label: '看材料与回执', kind: 'primary', attrs: { 'data-surface': 'artifacts' } }),
            secondary: buttonHtml({ action: 'open-diagnostics-surface', label: '进入修复台', attrs: { 'data-surface': 'repair' } }),
            title: '诊断面当前比较平稳',
            tone: 'good',
          };

  const focusSignals = [
    {
      label: '姿态',
      meta: state.posture.summary,
      value: prioritiesCount > 0 ? `${prioritiesCount} 项待收口` : '当前稳定',
    },
    {
      label: 'Gateway / 作业',
      meta: gatewayState === 'running' ? '运行面已经接通' : '运行面还需要继续处理',
      value: `${gatewayState} / ${state.remoteJobs.length} 作业`,
    },
    {
      label: '能力面',
      meta: `${view.skills.length} 个技能 · ${pluginCount} 个插件`,
      value: `${toolsEnabled}/${toolsTotal || 0}`,
    },
    {
      label: '最近材料',
      meta: view.resultPayload?.label || '还没有最近回执',
      value: view.logPreview?.lines?.length ? `${view.logPreview.lines.length} 行日志` : '日志待读取',
    },
  ];

  return `
    <section class="dashboard-focus-shell">
      <section class="dashboard-focus-card dashboard-focus-card-${focusState.tone}">
        <div class="dashboard-focus-head">
          <div class="dashboard-focus-copy">
            <span class="dashboard-focus-kicker">${escapeHtml(focusState.kicker)}</span>
            <h2 class="dashboard-focus-title">${escapeHtml(focusState.title)}</h2>
            <p class="dashboard-focus-desc">${escapeHtml(focusState.description)}</p>
          </div>
          <div class="dashboard-focus-pills">
            ${pillHtml(binaryFound ? '组件已接管' : '组件待安装', binaryFound ? 'good' : 'warn')}
            ${pillHtml(gatewayState === 'running' ? 'Gateway 已运行' : 'Gateway 待修复', gatewayState === 'running' ? 'good' : 'warn')}
            ${pillHtml(state.combinedWarnings.length > 0 ? `${state.combinedWarnings.length} 条提醒` : '当前稳定', state.combinedWarnings.length > 0 ? 'warn' : 'good')}
          </div>
        </div>
        <div class="dashboard-signal-grid">
          ${focusSignals.map((item) => `
            <section class="dashboard-signal-card">
              <span class="dashboard-signal-label">${escapeHtml(item.label)}</span>
              <strong class="dashboard-signal-value">${escapeHtml(item.value)}</strong>
              <span class="dashboard-signal-meta">${escapeHtml(item.meta)}</span>
            </section>
          `).join('')}
        </div>
        <div class="dashboard-focus-actions">
          ${focusState.primary}
          ${focusState.secondary}
          ${buttonHtml({ action: 'refresh-context', label: view.loading ? '刷新中…' : '刷新', disabled: view.loading })}
        </div>
      </section>

      <aside class="dashboard-jump-panel">
        <div class="workspace-main-header">
          <div>
            <strong>常用入口</strong>
            <p class="workspace-main-copy">打开最常用的 4 个工作区。</p>
          </div>
          ${pillHtml('高频 4 项', 'neutral')}
        </div>
        <div class="dashboard-jump-grid">
          ${launcherCardHtml({
            action: 'open-diagnostics-surface',
            attrs: { 'data-surface': 'repair' },
            kicker: 'Repair',
            title: '修复台',
            meta: prioritiesCount > 0 ? `${prioritiesCount} 个高优先项待处理` : '进入修复台做运行与能力诊断',
            tone: prioritiesCount > 0 ? 'warn' : 'neutral',
          })}
          ${launcherCardHtml({
            action: gatewayState === 'running' ? 'goto-gateway-workbench' : 'goto-config-model',
            kicker: 'Chain',
            title: gatewayState === 'running' ? 'Gateway 与投递' : '配置主链路',
            meta: gatewayState === 'running' ? `${state.remoteJobs.length} 个远端作业` : '先补模型、Provider 与关键凭证',
            tone: gatewayState === 'running' ? 'good' : 'warn',
          })}
          ${launcherCardHtml({
            action: state.missingReferencedSkills.length > 0 ? 'goto-skills-workbench' : 'goto-extensions-workbench',
            kicker: 'Capability',
            title: state.missingReferencedSkills.length > 0 ? '补 Skills 缺口' : '能力治理',
            meta: state.missingReferencedSkills.length > 0 ? `缺 ${state.missingReferencedSkills.length} 个技能引用` : `${toolsEnabled}/${toolsTotal || 0} 工具已接入`,
            tone: state.missingReferencedSkills.length > 0 ? 'warn' : 'neutral',
          })}
          ${launcherCardHtml({
            action: 'open-diagnostics-surface',
            attrs: { 'data-surface': 'artifacts' },
            kicker: 'Artifacts',
            title: '材料与回执',
            meta: view.resultPayload?.label || '查看最近回执、日志和本地上下文',
          })}
        </div>
      </aside>
    </section>

    <section class="config-section dashboard-quiet-card">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">概览</h2>
          <p class="config-section-desc">当前状态与建议操作。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.profile, 'neutral')}
        </div>
      </div>
      ${keyValueRowsHtml([
        { label: '当前焦点', value: focusState.title },
        { label: '运行面', value: `${gatewayState} · 远端作业 ${state.remoteJobs.length} 个` },
        { label: '能力面', value: `${toolsEnabled}/${toolsTotal || 0} 工具 · ${view.skills.length} 个技能 · ${pluginCount} 个插件` },
        { label: '建议操作', value: !binaryFound ? '先安装 Hermes' : prioritiesCount > 0 ? '进入修复台处理高优先项' : '按需查看材料或进入对应工作台' },
      ])}
    </section>
  `;
}

function renderRepairSurface(view, state) {
  return `
    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">修复入口</h2>
          <p class="config-section-desc">优先处理高优先项与修复动作。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(state.posture.priorities.length > 0 ? `${state.posture.priorities.length} 个高优先项` : '可继续体检', state.posture.priorities.length > 0 ? 'warn' : 'good')}
        </div>
      </div>
      <div class="control-card-grid control-card-grid-dense">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Bootstrap</p>
              <h3 class="action-card-title">安装 / 升级 / 重装</h3>
            </div>
            ${pillHtml(view.installation?.binaryFound ? '已接管' : '待安装', view.installation?.binaryFound ? 'good' : 'bad')}
          </div>
          <p class="action-card-copy">如果 Hermes 本体都不稳，后续 Gateway、Skills、Plugins 和 Memory 的问题很多都会是假问题。</p>
          <p class="workspace-inline-meta">可直接在客户端内执行安装与更新。</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'install-cli', label: view.runningDesktopAction === 'diagnostics:install' ? '安装中…' : (view.installation?.binaryFound ? '重新安装 Hermes' : '安装 Hermes'), kind: 'primary', disabled: state.actionBusy || !view.installation })}
            ${buttonHtml({ action: 'update-cli', label: view.runningDesktopAction === 'diagnostics:update' ? '升级中…' : '升级 Hermes', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'navigate-page', label: '控制中心', attrs: { 'data-page': 'dashboard' }, disabled: state.actionBusy })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Repair</p>
              <h3 class="action-card-title">配置 / 模型 / Gateway</h3>
            </div>
            ${pillHtml(view.snapshot?.gateway?.gatewayState ?? 'gateway 待修复', view.snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">大多数问题先回结构化配置中心和 Gateway 工作台，优先在客户端里完成修正。</p>
          <p class="workspace-inline-meta">${escapeHtml(view.installation ? `${view.config?.summary.modelProvider || 'provider 未配'} / ${view.config?.summary.modelDefault || 'model 未配'} · gateway ${view.snapshot?.gateway?.gatewayState || 'unknown'}` : '未读取配置摘要')}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-config-model', label: '配置工作台', kind: 'primary', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'goto-config-credentials', label: '凭证 / 通道', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'goto-gateway-workbench', label: 'Gateway 工作台', disabled: state.actionBusy || !view.installation?.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Capability</p>
              <h3 class="action-card-title">Toolsets / Skills / Memory / Plugins</h3>
            </div>
            ${pillHtml(enabledToolCount(view.extensions) > 0 ? `${enabledToolCount(view.extensions)} 个 tools` : '能力面待修', enabledToolCount(view.extensions) > 0 ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">能力面问题优先在工具、技能、记忆和扩展工作台处理。</p>
          <p class="workspace-inline-meta">${escapeHtml(view.installation ? `${view.config?.summary.toolsets?.join(', ') || '无 toolsets'} · memory ${view.config?.summary.memoryProvider || 'builtin-file'} · plugins ${pluginsCount(view.extensions)}` : '未读取能力面摘要')}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-config-toolsets', label: 'Toolsets', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'goto-skills-workbench', label: '技能工作台', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'goto-memory-config', label: '记忆配置', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'goto-extensions-workbench', label: '扩展插件', disabled: state.actionBusy || !view.installation?.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Artifacts</p>
              <h3 class="action-card-title">日志 / 配置 / 状态文件</h3>
            </div>
            ${pillHtml(state.combinedWarnings.length === 0 ? '上下文稳定' : `${state.combinedWarnings.length} 条风险`, state.combinedWarnings.length === 0 ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">诊断结果不够清楚时，直接回到实际文件和日志最有效，特别适合定位 platform、delivery 和 provider 侧问题。</p>
          <p class="workspace-inline-meta">${escapeHtml(`${view.config?.configPath || '未读取 config'} · ${view.config?.envPath || '未读取 env'} · ${state.logsDir || '未读取 logs'}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: state.actionBusy || !view.snapshot })}
            ${buttonHtml({ action: 'open-config', label: '定位 config.yaml', disabled: state.actionBusy || !view.config })}
            ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: state.actionBusy || !view.config })}
            ${buttonHtml({ action: 'open-logs-dir', label: '打开 logs', disabled: state.actionBusy || !state.logsDir })}
          </div>
        </section>
      </div>
    </section>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">运行诊断</h2>
            <p class="config-section-desc">优先解决 Hermes 当前有没有正常活着这件事。</p>
          </div>
        </div>
        ${renderDiagnosticGrid(RUNTIME_DIAGNOSTIC_COMMANDS, view)}
      </section>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">能力诊断</h2>
            <p class="config-section-desc">帮助排查“为什么明明装了却没生效”。</p>
          </div>
        </div>
        ${renderDiagnosticGrid(CAPABILITY_DIAGNOSTIC_COMMANDS, view)}
      </section>
    </div>

    <section class="workspace-main-card">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">风险与入口</h2>
          <p class="config-section-desc">这里保留当前最可能出问题的环节，方便继续下钻到对应工作台。</p>
        </div>
      </div>
      <div class="health-grid health-grid-dense">
        <section class="health-card">
          <div class="health-card-header">
            <strong>Gateway Delivery</strong>
            ${pillHtml(view.snapshot?.gateway?.gatewayState ?? '未检测到', view.snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
          </div>
          <p>${escapeHtml(state.remoteJobs.length > 0 ? `当前有 ${state.remoteJobs.length} 个远端投递作业依赖 gateway。` : '当前自动化以本地执行或本地投递为主。')}</p>
        </section>
        <section class="health-card">
          <div class="health-card-header">
            <strong>Context Engine</strong>
            ${pillHtml(view.config?.summary.contextEngine || '未配置', view.config?.summary.contextEngine ? 'good' : 'warn')}
          </div>
          <p>上下文编排最好显式可见，这样才能把模型、工具和记忆链路看清楚。</p>
        </section>
        <section class="health-card">
          <div class="health-card-header">
            <strong>Skills Surface</strong>
            ${pillHtml(state.missingReferencedSkills.length === 0 ? '已对齐' : '存在缺口', state.missingReferencedSkills.length === 0 ? 'good' : 'bad')}
          </div>
          <p>${escapeHtml(state.missingReferencedSkills.length === 0 ? 'cron 引用到的 skills 都能在本地扫描到。' : `缺失技能：${state.missingReferencedSkills.join('、')}`)}</p>
        </section>
        <section class="health-card">
          <div class="health-card-header">
            <strong>Memory Closure</strong>
            ${pillHtml(view.config?.summary.memoryEnabled && state.memoryRuntimeReady ? '已开启' : '待关注', view.config?.summary.memoryEnabled && state.memoryRuntimeReady ? 'good' : 'warn')}
          </div>
          <p>${escapeHtml(`配置 Provider ${view.config?.summary.memoryProvider || 'builtin-file'} · 运行态 ${view.extensions?.memoryRuntime.provider || '未读取'} · 用户画像 ${String(view.config?.summary.userProfileEnabled ?? false)}`)}</p>
        </section>
      </div>
      ${
        state.combinedWarnings.length > 0
          ? `
            <div class="warning-stack top-gap">
              ${state.combinedWarnings.slice(0, 6).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
            </div>
          `
          : emptyStateHtml('当前风险不高', '没有检测到明显的结构性问题，可以直接去材料层看日志回执，或继续下钻到对应工作台。')
      }
    </section>
  `;
}

function renderArtifactsSurface(view, state, lastCommand) {
  return `
    <div class="compact-overview-grid compact-overview-grid-dense">
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <strong>本地上下文</strong>
            <p class="shell-card-copy">这里展示的都是当前 profile 的真实本地状态，用来决定该去配置、网关还是能力工作台修。</p>
          </div>
          ${pillHtml(view.installation?.binaryFound ? '已接管' : '待安装', view.installation?.binaryFound ? 'good' : 'warn')}
        </div>
        ${view.snapshot && view.config
          ? keyValueRowsHtml([
              { label: 'Hermes Binary', value: view.snapshot.hermesBinary ?? '—' },
              { label: 'Hermes Home', value: view.snapshot.hermesHome ?? '—' },
              { label: 'Context Engine', value: view.config.summary.contextEngine ?? '—' },
              { label: '默认模型', value: view.config.summary.modelDefault ?? '—' },
              { label: '模型提供商', value: view.config.summary.modelProvider ?? '—' },
              { label: '记忆 Provider', value: view.config.summary.memoryProvider ?? 'builtin-file' },
              { label: '终端后端', value: view.config.summary.terminalBackend ?? '—' },
              { label: '工作目录', value: view.config.summary.terminalCwd ?? '—' },
            ])
          : emptyStateHtml('上下文未就绪', '暂时还没有读取到 dashboard、config 与安装摘要。')}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-config-model', label: '配置工作台', disabled: state.actionBusy || !view.installation?.binaryFound })}
          ${buttonHtml({ action: 'goto-gateway-workbench', label: 'Gateway 工作台', disabled: state.actionBusy || !view.installation?.binaryFound })}
          ${buttonHtml({ action: 'goto-logs', label: '日志页' })}
        </div>
      </section>
      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <strong>实际文件入口</strong>
            <p class="shell-card-copy">真正需要对照文件和目录时，从这里继续下钻，避免这些边界动作占满默认层。</p>
          </div>
          ${pillHtml(state.logsDir ? '可直接定位' : '路径未就绪', state.logsDir ? 'good' : 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: 'config.yaml', value: view.config?.configPath || '未读取' },
          { label: '.env', value: view.config?.envPath || '未读取' },
          { label: 'logs', value: state.logsDir || '未读取' },
          { label: '最近日志', value: view.logName || 'gateway.error' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: state.actionBusy || !view.snapshot })}
          ${buttonHtml({ action: 'open-config', label: '定位 config.yaml', disabled: state.actionBusy || !view.config })}
          ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: state.actionBusy || !view.config })}
          ${buttonHtml({ action: 'open-logs-dir', label: '打开 logs', disabled: state.actionBusy || !state.logsDir })}
        </div>
      </section>
    </div>

    <div class="workspace-bottom-grid workspace-bottom-grid-dense">
      <section class="workspace-main-card">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">最近回执</h2>
            <p class="config-section-desc">保留客户端动作与底层结果对照，方便继续排障时快速回看。</p>
          </div>
        </div>
        ${commandResultHtml(view.resultPayload, '尚未执行诊断', '先从修复台运行一次诊断或客户端动作，这里就会保留最近回执。')}
      </section>

      <section class="workspace-main-card">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">日志预览</h2>
            <p class="config-section-desc">诊断后会自动切到更相关的日志类型，帮助你把最近回执和运行期材料串起来看。</p>
          </div>
          <div class="toolbar">
            <select class="select-input" id="diagnostics-log-select">
              ${LOG_OPTIONS.map((item) => `
                <option value="${escapeHtml(item.key)}" ${item.key === view.logName ? 'selected' : ''}>
                  ${escapeHtml(item.label)}
                </option>
              `).join('')}
            </select>
            ${buttonHtml({ action: 'refresh-log-preview', label: view.logLoading ? '读取中…' : '刷新日志', disabled: view.logLoading })}
            ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
          </div>
        </div>
        ${
          view.logPreview
            ? `
              ${keyValueRowsHtml([
                { label: '文件', value: view.logPreview.filePath },
                { label: '返回行数', value: String(view.logPreview.lines.length) },
                { label: '最近动作', value: lastCommand?.label ?? view.resultPayload?.label ?? '未执行诊断' },
                { label: 'Gateway 更新时间', value: formatTimestamp(view.snapshot?.gateway?.updatedAt) },
              ])}
              <pre class="code-block diagnostics-log-block">${escapeHtml(view.logPreview.lines.join('\n') || '没有匹配到日志行。')}</pre>
            `
            : emptyStateHtml('暂无日志预览', '切换日志类型或刷新后，这里会展示相关日志尾部内容。')
        }
      </section>
    </div>
  `;
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">诊断工作台</h1>
      </div>
      <p class="page-desc">正在构建 Hermes 诊断上下文。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.snapshot && !view.config && !view.installation) {
    renderSkeleton(view);
    return;
  }

  const state = derivedState(view);
  const lastCommand = state.lastCommand;
  const surfaceView = view.surfaceView || 'focus';
  const pageDescription = surfaceView === 'repair'
    ? '修复动作、运行诊断与能力诊断。'
    : surfaceView === 'artifacts'
      ? '材料层统一收纳本地上下文、最近回执和日志预览。'
      : '查看当前诊断结论与常用入口。';
  const surfaceContent = surfaceView === 'repair'
    ? renderRepairSurface(view, state)
    : surfaceView === 'artifacts'
      ? renderArtifactsSurface(view, state, lastCommand)
      : renderFocusSurface(view, state);

  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">诊断工作台</h1>
      </div>
      <p class="page-desc">${pageDescription}</p>
    </div>

    <div class="tab-bar tab-bar-dense dashboard-workspace-tabs">
      ${surfaceTabHtml(surfaceView, 'focus', '常用')}
      ${surfaceTabHtml(surfaceView, 'repair', '修复台')}
      ${surfaceTabHtml(surfaceView, 'artifacts', '材料与回执')}
    </div>

    ${renderContextBanner(view)}

    ${surfaceContent}
  `;

  bindEvents(view);
}

async function loadContext(view, silent = false) {
  view.loading = true;
  if (!silent) {
    renderPage(view);
  }

  try {
    const [nextSnapshot, nextConfig, nextInstallation, nextCron, nextSkills, nextExtensions] = await Promise.all([
      api.getDashboardSnapshot(view.profile),
      api.getConfigDocuments(view.profile),
      api.getInstallationSnapshot(view.profile),
      api.getCronJobs(view.profile),
      api.listSkills(view.profile),
      api.getExtensionsSnapshot(view.profile),
    ]);
    if (view.destroyed) {
      return;
    }
    view.snapshot = nextSnapshot;
    view.config = nextConfig;
    view.installation = nextInstallation;
    view.cronSnapshot = nextCron;
    view.skills = nextSkills;
    view.extensions = nextExtensions;
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
  } finally {
    view.loading = false;
    renderPage(view);
  }
}

async function loadLogPreview(view, targetLog = view.logName, silent = false) {
  view.logLoading = true;
  if (!silent) {
    renderPage(view);
  }

  try {
    const next = await api.readLog(targetLog, 60, undefined, undefined, view.profile);
    if (view.destroyed) {
      return;
    }
    view.logPreview = next;
    view.logName = targetLog;
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
    view.logPreview = null;
  } finally {
    view.logLoading = false;
    renderPage(view);
  }
}

async function runDiagnostic(view, kind) {
  view.running = kind;
  renderPage(view);

  try {
    const result = await api.runDiagnostic(kind, view.profile);
    const command = getDiagnosticCommand(kind);
    storeResult(view, command?.label ?? kind, result, kind);
    const relatedLog = command?.relatedLog ?? 'errors';
    view.logName = relatedLog;
    view.surfaceView = 'artifacts';
    await Promise.all([
      loadContext(view, true),
      loadLogPreview(view, relatedLog, true),
    ]);
    notify(result.success ? 'success' : 'error', `${kind} 已执行。`);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.running = null;
    renderPage(view);
  }
}

async function openFinderAction(view, path, label, revealInFinder = false) {
  if (!path) {
    return;
  }

  await openFinderLocation({
    actionKey: `finder:${label}`,
    label,
    notify,
    onResult: (resultLabel, result) => {
      storeResult(view, resultLabel, result, null);
    },
    path,
    revealInFinder,
    setBusy: (value) => {
      view.runningDesktopAction = value;
      renderPage(view);
    },
  });
}

async function runInstallationAction(view, action, actionKey, label) {
  view.runningDesktopAction = actionKey;
  renderPage(view);

  try {
    const result = await api.runInstallationAction(action);
    storeResult(view, label, result, null);
    view.surfaceView = 'artifacts';
    notify(result.success ? 'success' : 'error', `${label} 已执行。`);
    await Promise.all([
      loadContext(view, true),
      loadLogPreview(view, view.logName, true),
    ]);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningDesktopAction = null;
    renderPage(view);
  }
}

function syncWithPanelState(view) {
  const nextProfile = getPanelState().selectedProfile;
  const intent = getPageIntent('diagnostics');

  if (intent) {
    applyIntent(view, intent);
    void loadLogPreview(view, view.logName, true);
    renderPage(view);
    return;
  }

  if (nextProfile !== view.profile) {
    view.profile = nextProfile;
    view.snapshot = null;
    view.config = null;
    view.installation = null;
    view.cronSnapshot = null;
    view.extensions = null;
    view.skills = [];
    view.resultPayload = null;
    view.lastKind = null;
    view.logPreview = null;
    view.logName = 'gateway.error';
    void Promise.all([
      loadContext(view, true),
      loadLogPreview(view, 'gateway.error', true),
    ]);
    return;
  }

  renderPage(view);
}

function bindEvents(view) {
  view.page.querySelectorAll('[data-diagnostics-surface]').forEach((element) => {
    element.onclick = () => {
      const nextView = element.getAttribute('data-diagnostics-surface');
      if (!nextView || nextView === view.surfaceView) {
        return;
      }
      view.surfaceView = nextView;
      renderPage(view);
    };
  });

  const logSelect = view.page.querySelector('#diagnostics-log-select');
  if (logSelect) {
    logSelect.onchange = (event) => {
      view.logName = event.target.value;
      void loadLogPreview(view, view.logName, true);
    };
  }

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      const state = derivedState(view);

      switch (action) {
        case 'open-diagnostics-surface':
          view.surfaceView = element.getAttribute('data-surface') || 'repair';
          renderPage(view);
          return;
        case 'refresh-context':
          await Promise.all([
            loadContext(view, true),
            loadLogPreview(view, view.logName, true),
          ]);
          return;
        case 'run-diagnostic':
          await runDiagnostic(view, element.getAttribute('data-kind') || 'doctor');
          return;
        case 'run-suggested':
          if (view.investigation?.suggestedCommand) {
            await runDiagnostic(view, view.investigation.suggestedCommand);
          }
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'refresh-log-preview':
          await loadLogPreview(view, view.logName);
          return;
        case 'goto-logs':
          navigate('logs');
          return;
        case 'navigate-page':
          navigate(element.getAttribute('data-page'));
          return;
        case 'open-home':
          if (view.snapshot) {
            await openFinderAction(view, view.snapshot.hermesHome, 'Hermes Home');
          }
          return;
        case 'open-config':
          if (view.config) {
            await openFinderAction(view, view.config.configPath, 'config.yaml', true);
          }
          return;
        case 'open-env':
          if (view.config) {
            await openFinderAction(view, view.config.envPath, '.env', true);
          }
          return;
        case 'open-logs-dir':
          if (state.logsDir) {
            await openFinderAction(view, state.logsDir, 'logs 目录');
          }
          return;
        case 'install-cli':
          if (view.installation) {
            await runInstallationAction(
              view,
              'install',
              'diagnostics:install',
              view.installation.binaryFound ? '重新安装 Hermes' : '安装 Hermes',
            );
          }
          return;
        case 'update-cli':
          if (view.installation) {
            await runInstallationAction(view, 'update', 'diagnostics:update', '升级 Hermes');
          }
          return;
        case 'goto-config-model':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心直接修改模型、provider 与默认链路，不再依赖 setup/model 命令。',
            focus: 'model',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-config-credentials':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心直接修改 API Key、消息通道和相关凭证。',
            focus: 'credentials',
            suggestedCommand: 'config-check',
          }));
          return;
        case 'goto-gateway-workbench':
          navigate('gateway', buildGatewayDrilldownIntent(relaySeed(view), {
            description: '继续在 Gateway 工作台处理 service、平台、策略和远端投递。',
          }));
          return;
        case 'goto-config-toolsets':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心直接核对和保存 toolsets / platform toolsets。',
            focus: 'toolsets',
            suggestedCommand: 'tools-summary',
          }));
          return;
        case 'goto-skills-workbench':
          navigate('skills');
          return;
        case 'goto-memory-config':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心直接处理 memory provider、开关和用户画像。',
            focus: 'memory',
            suggestedCommand: 'memory-status',
          }));
          return;
        case 'goto-extensions-workbench':
          navigate('extensions', buildExtensionsDrilldownIntent(relaySeed(view), {
            description: '继续在扩展工作台处理插件、tools runtime 和 memory runtime。',
            rawKind: 'plugins',
          }));
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
    config: null,
    cronSnapshot: null,
    destroyed: false,
    extensions: null,
    installation: null,
    investigation: null,
    lastKind: null,
    loading: true,
    logLoading: false,
    logName: 'gateway.error',
    logPreview: null,
    page,
    profile: getPanelState().selectedProfile,
    resultPayload: null,
    running: null,
    runningDesktopAction: null,
    surfaceView: 'focus',
    skills: [],
    snapshot: null,
    unsubscribe: null,
  };

  const intent = getPageIntent('diagnostics');
  if (intent) {
    applyIntent(activeView, intent, false);
  }

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await Promise.all([
    loadContext(activeView, true),
    loadLogPreview(activeView, activeView.logName, true),
  ]);
  renderPage(activeView);
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
