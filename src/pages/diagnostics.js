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
    warnings.push('当前还没有检测到 Hermes CLI，很多问题在修复前都需要先完成安装或重新安装。');
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
    <div class="workbench-grid">
      ${commands.map((item) => `
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">${item.scope === 'runtime' ? 'Runtime' : 'Capability'}</p>
              <h3 class="action-card-title">${escapeHtml(item.label)}</h3>
            </div>
            ${pillHtml(item.key, item.kind === 'primary' ? 'good' : item.scope === 'capability' ? 'neutral' : 'warn')}
          </div>
          <p class="action-card-copy">${escapeHtml(item.description)}</p>
          <p class="command-line">${escapeHtml(item.cli)}</p>
          <div class="toolbar">
            ${buttonHtml({
              action: 'run-diagnostic',
              label: view.running === item.key ? `${item.label}…` : `执行 ${item.label}`,
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

function renderPostureHtml(posture) {
  return `
    <div class="page-stack">
      <div class="result-header">
        <div>
          <p class="eyebrow">Runtime Posture</p>
          <h3 class="action-card-title">${escapeHtml(posture.headline)}</h3>
        </div>
        ${pillHtml(posture.tone === 'bad' ? '高风险' : posture.tone === 'warn' ? '关注' : posture.tone === 'neutral' ? '观察' : '稳定', posture.tone)}
      </div>
      <p class="helper-text">${escapeHtml(posture.summary)}</p>
      <div class="health-grid">
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
            <div class="warning-stack">
              ${posture.priorities.slice(0, 4).map((item) => `<div class="warning-item">${escapeHtml(`${item.title}：${item.detail}`)}</div>`).join('')}
            </div>
          `
          : emptyStateHtml('当前无需优先修正', '核心运行链路已具备继续验证与细化治理的基础。')
      }
    </div>
  `;
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
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

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">诊断工作台</h1>
        ${infoTipHtml('诊断页只保留体检、日志预览和客户端内修复动作；大段说明后置到提示里，不抢排障区。')}
      </div>
      <p class="page-desc">先诊断，再跳到真正能修问题的工作台，或直接在客户端里执行边界修复动作。</p>
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">运行总览</h2>
          <p class="config-section-desc">先看主链路姿态，再决定执行哪个命令或切去哪个修复入口。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'refresh-context', label: view.loading ? '刷新中…' : '刷新上下文', kind: 'primary', disabled: view.loading })}
        </div>
      </div>
      <div class="hero-grid">
        <div class="hero-copy">
          <p class="hero-title">Hermes Diagnostic Workbench</p>
          <p class="hero-subtitle">先汇总主链路风险，再执行命令。</p>
          ${keyValueRowsHtml([
            { label: '当前 Profile', value: view.snapshot?.profileName ?? view.profile },
            { label: 'Hermes Binary', value: view.snapshot?.hermesBinary ?? '—' },
            { label: 'Hermes Home', value: view.snapshot?.hermesHome ?? '—' },
            { label: 'Gateway', value: view.snapshot?.gateway?.gatewayState ?? '未检测到' },
            { label: 'Context Engine', value: view.config?.summary.contextEngine || '—' },
            { label: '记忆 Provider', value: view.config?.summary.memoryProvider || 'builtin-file' },
          ])}
        </div>
        <div class="metrics-grid">
          <div class="metric-card">
            <p class="metric-label">高优先项</p>
            <div class="metric-value">${escapeHtml(String(state.posture.priorities.length))}</div>
            <p class="metric-hint">共享运行姿态汇总后的优先修正项</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">远端作业</p>
            <div class="metric-value">${escapeHtml(String(state.remoteJobs.length))}</div>
            <p class="metric-hint">依赖 gateway / delivery 的 cron 作业</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">缺 Skill 引用</p>
            <div class="metric-value">${escapeHtml(String(state.missingReferencedSkills.length))}</div>
            <p class="metric-hint">jobs.json 引用了但本地没扫到</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">运行 Tools</p>
            <div class="metric-value">${escapeHtml(`${enabledToolCount(view.extensions)} / ${totalToolCount(view.extensions)}`)}</div>
            <p class="metric-hint">启用 tools / 全量 tools</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">本地技能 / 插件</p>
            <div class="metric-value">${escapeHtml(`${(view.skills ?? []).length} / ${pluginsCount(view.extensions)}`)}</div>
            <p class="metric-hint">目录扫描 skills / 插件层覆盖</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">日志预览</p>
            <div class="metric-value">${escapeHtml(String(view.logPreview?.lines.length ?? 0))}</div>
            <p class="metric-hint">${escapeHtml(LOG_OPTIONS.find((item) => item.key === view.logName)?.label || view.logName)}</p>
          </div>
        </div>
      </div>
    </section>

    ${
      view.investigation
        ? `
          <div class="context-banner">
            <div class="context-banner-header">
              <div class="context-banner-copy">
                <span class="context-banner-label">Session Drilldown</span>
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
                label: '执行建议命令',
                kind: 'primary',
                disabled: view.running !== null,
              }) : ''}
              ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
              ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
            </div>
          </div>
        `
        : ''
    }

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">运行姿态</h2>
          <p class="config-section-desc">把模型链、执行后端、能力面、记忆回路和网关交付收成同一套诊断语言。</p>
        </div>
      </div>
      ${renderPostureHtml(state.posture)}
    </section>

    <section class="config-section">
      <div class="config-section-header">
          <div>
            <h2 class="config-section-title">修复动作台</h2>
            <p class="config-section-desc">参考 clawpanel 的闭环思路，优先回结构化工作台；安装升级这类边界动作由客户端后端直接执行。</p>
          </div>
        </div>
      <div class="control-card-grid">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Bootstrap</p>
              <h3 class="action-card-title">安装 / 升级 / 重装</h3>
            </div>
            ${pillHtml(view.installation?.binaryFound ? 'CLI 可用' : 'CLI 缺失', view.installation?.binaryFound ? 'good' : 'bad')}
          </div>
          <p class="action-card-copy">如果 CLI 本体都不稳，后续 gateway、skills、plugins、memory 的问题很多都会是假问题。</p>
          <p class="command-line">客户端内执行安装脚本与更新命令，不再默认弹出 Terminal。</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'install-cli', label: view.runningDesktopAction === 'diagnostics:install' ? (view.installation?.binaryFound ? '重新安装 CLI…' : '一键安装 CLI…') : (view.installation?.binaryFound ? '重新安装 CLI' : '一键安装 CLI'), kind: 'primary', disabled: state.actionBusy || !view.installation })}
            ${buttonHtml({ action: 'update-cli', label: view.runningDesktopAction === 'diagnostics:update' ? '升级 CLI…' : '升级 CLI', disabled: state.actionBusy || !view.installation?.binaryFound })}
            ${buttonHtml({ action: 'navigate-page', label: '进入控制中心', attrs: { 'data-page': 'dashboard' }, disabled: state.actionBusy })}
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
          <p class="command-line">${escapeHtml(view.installation ? `${view.config?.summary.modelProvider || 'provider 未配'} / ${view.config?.summary.modelDefault || 'model 未配'} · gateway ${view.snapshot?.gateway?.gatewayState || 'unknown'}` : '未读取配置摘要')}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-config-model', label: '配置中心', kind: 'primary', disabled: state.actionBusy || !view.installation?.binaryFound })}
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
          <p class="action-card-copy">能力面问题优先回工具、技能、记忆和扩展工作台，不再打开交互式命令面板。</p>
          <p class="command-line">${escapeHtml(view.installation ? `${view.config?.summary.toolsets.join(', ') || '无 toolsets'} · memory ${view.config?.summary.memoryProvider || 'builtin-file'} · plugins ${pluginsCount(view.extensions)}` : '未读取能力面摘要')}</p>
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
          <p class="action-card-copy">命令结果看不清时，直接回到实际文件和日志最有效，特别适合定位 platform、delivery 和 provider 侧问题。</p>
          <p class="command-line">${escapeHtml(`${view.config?.configPath || '未读取 config'} · ${view.config?.envPath || '未读取 env'} · ${state.logsDir || '未读取 logs'}`)}</p>
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

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">排障上下文</h2>
            <p class="config-section-desc">这里展示的都是当前 profile 的真实本地状态，适合在执行命令前先扫一眼。</p>
          </div>
        </div>
        ${
          view.snapshot && view.config
            ? keyValueRowsHtml([
                { label: '当前 Profile', value: view.snapshot.profileName },
                { label: '默认模型', value: view.config.summary.modelDefault ?? '—' },
                { label: '提供商', value: view.config.summary.modelProvider ?? '—' },
                { label: 'Base URL', value: view.config.summary.modelBaseUrl ?? '—' },
                { label: '终端后端', value: view.config.summary.terminalBackend ?? '—' },
                { label: '工作目录', value: view.config.summary.terminalCwd ?? '—' },
                { label: 'Context Engine', value: view.config.summary.contextEngine ?? '—' },
                { label: 'Toolsets', value: view.config.summary.toolsets.length ? view.config.summary.toolsets.join(', ') : '—' },
                { label: '记忆功能', value: String(view.config.summary.memoryEnabled ?? false) },
                { label: '用户画像', value: String(view.config.summary.userProfileEnabled ?? false) },
                { label: 'MEMORY / USER 上限', value: `${view.config.summary.memoryCharLimit ?? '—'} / ${view.config.summary.userCharLimit ?? '—'}` },
                { label: '本地技能数', value: String((view.skills ?? []).length) },
                { label: '运行工具', value: `${enabledToolCount(view.extensions)} / ${totalToolCount(view.extensions)}` },
                { label: '插件数', value: String(pluginsCount(view.extensions)) },
                { label: 'Memory Runtime', value: view.extensions?.memoryRuntime.provider ?? '—' },
                { label: 'Cron 作业数', value: String((view.cronSnapshot?.jobs ?? []).length) },
                { label: '远端投递作业', value: String(state.remoteJobs.length) },
              ])
            : emptyStateHtml('上下文未就绪', '暂时还没有读取到 dashboard、config 与 cron 摘要。')
        }
      </section>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">风险与入口</h2>
            <p class="config-section-desc">先看当前最可能出问题的环节，再跳到更合适的页面或文件。</p>
          </div>
        </div>
        <div class="health-grid">
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
            <p>Hermes 的上下文编排引擎最好显式可见，这样才能把模型、工具和记忆链路看清楚。</p>
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
                ${state.combinedWarnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
              </div>
            `
            : emptyStateHtml('当前风险不高', '没有检测到明显的结构性问题，可以先执行能力诊断或直接去日志页看细节。')
        }
      </section>
    </div>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">原始输出</h2>
            <p class="config-section-desc">保留 Hermes 原生命令的 stdout / stderr，方便把客户端动作和底层结果对齐。</p>
          </div>
        </div>
        ${commandResultHtml(view.resultPayload, '尚未执行命令', '先从上面的运行诊断或能力诊断里选一项，这里就会保留 Hermes 原始输出。')}
      </section>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">相关日志预览</h2>
            <p class="config-section-desc">命令执行后会自动切到更相关的日志类型，帮助你把原始结果和运行期日志串起来看。</p>
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
                { label: '当前命令', value: lastCommand?.label ?? view.resultPayload?.label ?? '未执行命令' },
                { label: 'Gateway 更新时间', value: formatTimestamp(view.snapshot?.gateway?.updatedAt) },
              ])}
              <pre class="code-block tall">${escapeHtml(view.logPreview.lines.join('\n') || '没有匹配到日志行。')}</pre>
            `
            : emptyStateHtml('暂无日志预览', '切换日志类型或刷新后，这里会展示相关日志尾部内容。')
        }
      </section>
    </div>
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
              view.installation.binaryFound ? '重新安装 CLI' : '一键安装 CLI',
            );
          }
          return;
        case 'update-cli':
          if (view.installation) {
            await runInstallationAction(view, 'update', 'diagnostics:update', '升级 CLI');
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
