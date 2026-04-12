import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
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
import { enabledToolCount, isRemoteDelivery, localRuntimeSkillCount, pluginsCount, totalToolCount } from '../lib/runtime';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  pillHtml,
  statusDotHtml,
} from './native-helpers';

const CONFIG_WORKBENCH_KEYS = ['config-check', 'doctor', 'memory-status', 'gateway-status'];

let activeView = null;

function runtimeWarnings(data, snapshot, skills, extensions, cronSnapshot) {
  const warnings = [];
  const jobs = cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
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
    warnings.push(`配置声明了 memory provider「${data.summary.memoryProvider}」，但运行态仍像 built-in only。`);
  }
  if (data.summary.toolsets.length > 0 && extensions && enabledToolCount(extensions) === 0) {
    warnings.push('配置里声明了 toolsets，但运行态没解析出已启用 tools，建议立刻体检。');
  }
  if (remoteJobs.length > 0 && snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push(`当前有 ${remoteJobs.length} 个远端作业依赖 Gateway，但网关不在 running 状态。`);
  }
  if (runtimeLocalSkills !== skills.length) {
    warnings.push(`CLI 运行态 local skills 为 ${runtimeLocalSkills} 个，本地目录扫描到 ${skills.length} 个，存在安装态偏差。`);
  }

  return Array.from(new Set(warnings));
}

function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
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
        description: '继续围绕模型、toolsets、provider 和 Gateway 关联配置做排查。',
      };
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">配置中心</h1>
      </div>
      <p class="page-desc">正在同步 Hermes 配置文件、运行态摘要和扩展闭环信号。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:124px"></div>').join('')}
    </div>
  `;
}

function renderWorkbenchCommands(view) {
  return CONFIG_WORKBENCH_KEYS
    .map((key) => getDiagnosticCommand(key))
    .filter(Boolean)
    .map((command) => `
      <section class="action-card">
        <div class="action-card-header">
          <div>
            <p class="eyebrow">${escapeHtml(command.scope === 'capability' ? 'Capability' : 'Runtime')}</p>
            <h3 class="action-card-title">${escapeHtml(command.label)}</h3>
          </div>
          ${pillHtml(command.key, command.kind === 'primary' ? 'good' : 'neutral')}
        </div>
        <p class="action-card-copy">${escapeHtml(command.description)}</p>
        <p class="command-line">${escapeHtml(command.cli)}</p>
        <div class="toolbar">
          ${buttonHtml({
            action: `diagnostic-${command.key}`,
            label: view.runningDiagnostic === command.key ? `${command.label}…` : `执行${command.label}`,
            kind: command.kind,
            disabled: Boolean(view.runningDiagnostic),
          })}
          ${buttonHtml({
            action: 'goto-related-page',
            label: '进入相关页',
            attrs: { 'data-page': command.relatedPage },
          })}
        </div>
      </section>
    `)
    .join('');
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
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">配置中心</h1>
        </div>
        <p class="page-desc">配置编辑、官方向导接管和运行体检都收在这里。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">配置工作台快照暂时不可用，可以直接重试。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 Hermes 配置工作台', view.error || '请稍后再试。')}
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
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const enabledTools = enabledToolCount(extensions);
  const totalTools = totalToolCount(extensions);
  const localSkills = localRuntimeSkillCount(extensions);
  const pluginTotal = pluginsCount(extensions);
  const configDirty = view.configYaml !== data.configYaml;
  const envDirty = view.envFile !== data.envFile;
  const actionBusy = Boolean(view.saving || view.runningDiagnostic || view.runningAction);
  const seed = relaySeed(view);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    description: '继续核对配置相关命令输出和运行日志。',
    logName: snapshot?.gateway?.gatewayState === 'running' ? 'agent' : 'errors',
    contains: view.investigation?.context?.source || '',
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    description: '继续围绕配置完整性、provider 和 Gateway 关联链路做体检。',
    suggestedCommand: view.investigation?.suggestedCommand || 'config-check',
    logName: 'errors',
  });
  const gatewayIntent = buildGatewayDrilldownIntent(seed, {
    description: '带着当前配置上下文继续看 Gateway 和平台链路。',
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(seed, {
    description: '继续核对 toolsets、skills、plugins 和 memory provider。',
    rawKind: view.investigation?.focus === 'memory' ? 'memory' : 'tools',
    query: view.investigation?.focus === 'toolsets' ? data.summary.toolsets.join(' ') : '',
  });

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">配置中心</h1>
        ${infoTipHtml('配置页只保留文件编辑、官方向导接管和运行体检，说明信息后置到提示里，避免抢主操作区。')}
      </div>
      <p class="page-desc">文件层、官方向导和运行体检在这里合流，不额外改 Hermes 本体。</p>
    </div>

    ${view.investigation ? `
      <div class="context-banner">
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
          ${view.investigation.suggestedCommand
            ? buttonHtml({
                action: 'run-intent-diagnostic',
                label: '执行建议体检',
                kind: 'primary',
                disabled: Boolean(view.runningDiagnostic),
              })
            : ''}
          ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
          ${buttonHtml({ action: 'goto-extensions', label: '进入扩展页' })}
          ${buttonHtml({ action: 'goto-gateway', label: '进入 Gateway' })}
        </div>
      </div>
    ` : ''}

    <div class="stat-cards">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Model</span>
          ${statusDotHtml(data.summary.modelDefault && data.summary.modelProvider ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(data.summary.modelDefault || '待配置')}</div>
        <div class="stat-card-meta">${escapeHtml(data.summary.modelProvider || 'provider 未配置')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Terminal</span>
          ${statusDotHtml(data.summary.terminalBackend ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(data.summary.terminalBackend || '未配置')}</div>
        <div class="stat-card-meta">${escapeHtml(data.summary.terminalCwd || '当前未声明工作目录')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Toolsets / Tools</span>
          ${statusDotHtml(enabledTools > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${data.summary.toolsets.length} / ${enabledTools}`)}</div>
        <div class="stat-card-meta">${escapeHtml(`声明的 toolsets / 运行态启用 tools（总数 ${totalTools}）`)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gateway</span>
          ${statusDotHtml(snapshot?.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(snapshot?.gateway?.gatewayState || '未检测到')}</div>
        <div class="stat-card-meta">${escapeHtml(remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业依赖 Gateway` : '当前没有远端交付作业')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Memory / Plugins</span>
          ${statusDotHtml(data.summary.memoryEnabled ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(data.summary.memoryProvider || 'builtin-file')}</div>
        <div class="stat-card-meta">${escapeHtml(`插件 ${pluginTotal} 个 · runtime provider ${extensions?.memoryRuntime.provider || '未读取'}`)}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Skills</span>
          ${statusDotHtml(localSkills === skills.length ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(`${localSkills}/${skills.length}`)}</div>
        <div class="stat-card-meta">CLI 运行态 local skills / 本地目录扫描</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
      ${buttonHtml({ action: 'diagnostic-config-check', label: view.runningDiagnostic === 'config-check' ? '配置体检…' : '配置体检', disabled: actionBusy })}
      ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: actionBusy })}
      ${buttonHtml({ action: 'open-config', label: '定位 config.yaml', disabled: actionBusy })}
      ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: actionBusy })}
      ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">接管动作台</h2>
          <p class="config-section-desc">把 setup、tools、skills、memory provider 和 Gateway 相关官方命令收进同一页。</p>
        </div>
      </div>
      <div class="control-card-grid">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Onboarding</p>
              <h3 class="action-card-title">Setup / Model / Migration</h3>
            </div>
            ${pillHtml(installation.binaryFound ? 'CLI 就绪' : 'CLI 缺失', installation.binaryFound ? 'good' : 'bad')}
          </div>
          <p class="action-card-copy">首次接管或 provider 大改时，优先走 Hermes 官方向导，而不是直接硬改 YAML。</p>
          <p class="command-line">${escapeHtml(`${installation.setupCommand} · ${installation.modelCommand} · ${installation.configMigrateCommand} · ${installation.clawMigrateCommand}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-setup', label: view.runningAction === 'config:setup' ? '全量 Setup…' : '全量 Setup', kind: 'primary', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-model', label: view.runningAction === 'config:model' ? '模型 / Provider…' : '模型 / Provider', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-config-migrate', label: '迁移配置', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-claw-migrate', label: '导入 OpenClaw', disabled: actionBusy || !installation.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Capability</p>
              <h3 class="action-card-title">Terminal / Tools / Skills</h3>
            </div>
            ${pillHtml(data.summary.toolsets.length > 0 ? `${data.summary.toolsets.length} 个 toolset` : '待配置', data.summary.toolsets.length > 0 ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">能力面不止是文件声明，还要通过 terminal backend、tools 和 skills 交互式确认。</p>
          <p class="command-line">${escapeHtml(`${installation.terminalSetupCommand} · ${installation.toolsSetupCommand} · ${installation.skillsConfigCommand}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-backend', label: '终端后端', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-tools', label: '工具选择', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-skills', label: '技能开关', disabled: actionBusy || !installation.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Provider</p>
              <h3 class="action-card-title">Memory / Plugins / Gateway</h3>
            </div>
            ${pillHtml(snapshot?.gateway?.gatewayState || 'gateway 待接管', snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">记忆 provider、context engine 和平台接入都仍走官方命令，客户端只负责本地桌面包装。</p>
          <p class="command-line">${escapeHtml(`hermes memory setup · hermes plugins · ${installation.gatewaySetupCommand}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'terminal-memory', label: '记忆 Provider', kind: 'primary', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-plugins', label: '插件 / Context Engine', disabled: actionBusy || !installation.binaryFound })}
            ${buttonHtml({ action: 'terminal-gateway-setup', label: 'Gateway Setup', disabled: actionBusy || !installation.binaryFound })}
          </div>
        </section>
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Workspace</p>
              <h3 class="action-card-title">文件与验证</h3>
            </div>
            ${pillHtml(warnings.length === 0 ? '姿态稳定' : `${warnings.length} 条提醒`, warnings.length === 0 ? 'good' : 'warn')}
          </div>
          <p class="action-card-copy">推荐先做接管动作，再回来保存和体检，避免只改文件不验证运行态。</p>
          <p class="command-line">hermes config check · hermes memory status · hermes gateway status · hermes doctor</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: actionBusy })}
            ${buttonHtml({ action: 'open-config', label: '定位 config.yaml', disabled: actionBusy })}
            ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: actionBusy })}
            ${buttonHtml({ action: 'diagnostic-config-check', label: '立即体检', disabled: actionBusy })}
          </div>
        </section>
      </div>
      <p class="helper-text">macOS 下交互式命令会转交给 Terminal 持续执行，完成后回面板刷新就能看到最新姿态。</p>
    </section>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">闭环信号</h2>
            <p class="config-section-desc">比原始 YAML 更适合快速判断当前 profile 能不能真正跑起来。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-extensions', label: '核对扩展' })}
            ${buttonHtml({ action: 'goto-gateway', label: '核对 Gateway' })}
          </div>
        </div>
        <div class="health-grid">
          <section class="health-card">
            <div class="health-card-header">
              <strong>Provider / Model</strong>
              ${pillHtml(data.summary.modelDefault && data.summary.modelProvider ? '已就绪' : '缺失', data.summary.modelDefault && data.summary.modelProvider ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(`${data.summary.modelProvider || '未配置 provider'} / ${data.summary.modelDefault || '未配置 model'}`)}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Terminal Backend</strong>
              ${pillHtml(data.summary.terminalBackend || '未配置', data.summary.terminalBackend ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(data.summary.terminalCwd || '当前未声明工作目录，工具执行上下文可能不稳定。')}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Toolsets / Tools</strong>
              ${pillHtml(`${enabledTools}/${totalTools}`, enabledTools > 0 ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(data.summary.toolsets.join(', ') || '当前没有配置 toolsets。')}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Context / Memory</strong>
              ${pillHtml(data.summary.contextEngine || '未配置', data.summary.contextEngine ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(`Memory ${data.summary.memoryProvider || 'builtin-file'} · 用户画像 ${String(data.summary.userProfileEnabled ?? false)} · 流式输出 ${String(data.summary.streamingEnabled ?? false)}`)}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Gateway Delivery</strong>
              ${pillHtml(snapshot?.gateway?.gatewayState || '未检测到', remoteJobs.length === 0 || snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
            </div>
            <p>${escapeHtml(remoteJobs.length > 0 ? `当前有 ${remoteJobs.length} 个远端作业依赖 Gateway。` : '当前没有依赖 Gateway 的远端投递作业。')}</p>
          </section>
          <section class="health-card">
            <div class="health-card-header">
              <strong>Skill Closure</strong>
              ${pillHtml(`${localSkills}/${skills.length}`, localSkills === skills.length ? 'good' : 'warn')}
            </div>
            <p>CLI 运行态 local skills / 本地目录扫描，用来发现安装态与文件态的偏差。</p>
          </section>
        </div>
        ${warnings.length > 0 ? `
          <div class="warning-stack top-gap">
            ${warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
          </div>
        ` : emptyStateHtml('配置较完整', '当前没有明显的结构性风险，可以继续去扩展或日志页验证闭环。')}
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">诊断工作台</h2>
            <p class="config-section-desc">把常用配置诊断命令收成一组顺手路径，避免跨页找入口。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-diagnostics', label: '打开诊断页' })}
            ${buttonHtml({ action: 'goto-logs', label: '查看日志' })}
          </div>
        </div>
        <div class="workbench-grid">
          ${renderWorkbenchCommands(view)}
        </div>
        <p class="helper-text">推荐顺序：保存后先做 <code>config-check</code>，再看 <code>memory-status</code> 和 <code>gateway-status</code>，如果还不清楚就执行 <code>doctor</code>。</p>
      </section>
    </div>

    <div class="two-column wide-left">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">最近命令回显</h2>
            <p class="config-section-desc">保留 Hermes 原生命令输出，避免把客户端做成另一层解释器。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行命令', '保存、体检或交接 Terminal 后，这里会保留最近一次原始结果。')}
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">运行材料</h2>
            <p class="config-section-desc">关键路径、日志联动和扩展关联放在右侧，主区域只留核心动作。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'goto-logs', label: '进入日志页' })}
            ${buttonHtml({ action: 'goto-extensions', label: '进入扩展页' })}
          </div>
        </div>
        <div class="service-stack">
          <div class="service-card">
            <div class="service-info">
              ${statusDotHtml(installation.hermesHomeExists ? 'running' : 'warning')}
              <div>
                <div class="service-name">Hermes Home</div>
                <div class="service-desc">${installation.hermesHomeExists ? '工作区目录已就绪。' : '还没有检测到 Hermes Home。'}</div>
                <div class="service-desc service-path">${escapeHtml(data.hermesHome)}</div>
              </div>
            </div>
            <div class="service-actions">
              ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: actionBusy })}
            </div>
          </div>
          <div class="service-card">
            <div class="service-info">
              ${statusDotHtml(installation.configExists ? 'running' : 'warning')}
              <div>
                <div class="service-name">config.yaml / .env</div>
                <div class="service-desc">快速定位配置文件，便于和 Terminal/Finder 接管动作来回切换。</div>
                <div class="service-desc service-path">${escapeHtml(`${data.configPath} · ${data.envPath}`)}</div>
              </div>
            </div>
            <div class="service-actions">
              ${buttonHtml({ action: 'open-config', label: '定位 config.yaml', disabled: actionBusy })}
              ${buttonHtml({ action: 'open-env', label: '定位 .env', disabled: actionBusy })}
            </div>
          </div>
          <div class="service-card">
            <div class="service-info">
              ${statusDotHtml(snapshot?.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
              <div>
                <div class="service-name">Gateway / 扩展联动</div>
                <div class="service-desc">如果 provider、tools 或远端 delivery 需要联动验证，继续下钻到 Gateway、日志和扩展页。</div>
                <div class="service-desc service-path">${escapeHtml(`Gateway ${snapshot?.gateway?.gatewayState || 'unknown'} · runtime provider ${extensions?.memoryRuntime.provider || '未读取'}`)}</div>
              </div>
            </div>
            <div class="service-actions">
              ${buttonHtml({ action: 'goto-gateway', label: '进入 Gateway' })}
              ${buttonHtml({ action: 'goto-extensions', label: '进入扩展页' })}
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="two-column">
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">config.yaml</h2>
            <p class="config-section-desc">${escapeHtml(data.configPath)}</p>
          </div>
          <div class="toolbar">
            <span id="config-dirty-pill" class="pill pill-warn" ${configDirty ? '' : 'style="display:none"'}>未保存</span>
            ${buttonHtml({ action: 'save-config', label: view.saving === 'config' ? '保存中…' : '保存 YAML', kind: 'primary', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })}
            ${buttonHtml({ action: 'save-config-verify', label: view.saving === 'config' ? '保存中…' : '保存并体检', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })}
          </div>
        </div>
        <textarea class="editor large" data-editor="config" spellcheck="false"></textarea>
      </section>

      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">.env</h2>
            <p class="config-section-desc">${escapeHtml(data.envPath)}</p>
          </div>
          <div class="toolbar">
            <span id="env-dirty-pill" class="pill pill-warn" ${envDirty ? '' : 'style="display:none"'}>未保存</span>
            ${buttonHtml({ action: 'save-env', label: view.saving === 'env' ? '保存中…' : '保存 ENV', kind: 'primary', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })}
            ${buttonHtml({ action: 'save-env-verify', label: view.saving === 'env' ? '保存中…' : '保存并体检', disabled: Boolean(view.saving) || Boolean(view.runningDiagnostic) })}
          </div>
        </div>
        <textarea class="editor large" data-editor="env" spellcheck="false"></textarea>
      </section>
    </div>
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
    const [nextConfig, nextSnapshot, nextInstallation, nextSkills, nextExtensions, nextCron] = await Promise.all([
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

    const keepConfigDraft = !refreshEditors && previousData ? previousConfig !== previousData.configYaml : false;
    const keepEnvDraft = !refreshEditors && previousData ? previousEnv !== previousData.envFile : false;

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

function syncDirtyPills(view) {
  const configDirtyPill = view.page.querySelector('#config-dirty-pill');
  const envDirtyPill = view.page.querySelector('#env-dirty-pill');
  if (configDirtyPill) {
    configDirtyPill.style.display = view.data && view.configYaml !== view.data.configYaml ? 'inline-flex' : 'none';
  }
  if (envDirtyPill) {
    envDirtyPill.style.display = view.data && view.envFile !== view.data.envFile ? 'inline-flex' : 'none';
  }
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
    view.envFile = '';
    void loadData(view);
    return;
  }

  const nextIntent = getPageIntent('config');
  if (nextIntent) {
    view.investigation = nextIntent;
    consumePageIntent();
    renderPage(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindEvents(view) {
  const configEditor = view.page.querySelector('[data-editor="config"]');
  const envEditor = view.page.querySelector('[data-editor="env"]');

  if (configEditor) {
    configEditor.oninput = (event) => {
      view.configYaml = event.target.value;
      syncDirtyPills(view);
    };
  }

  if (envEditor) {
    envEditor.oninput = (event) => {
      view.envFile = event.target.value;
      syncDirtyPills(view);
    };
  }

  view.page.querySelectorAll('[data-action]').forEach((element) => {
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
        case 'save-config-verify':
          await saveDocument(view, 'config', true);
          return;
        case 'save-env':
          await saveDocument(view, 'env', false);
          return;
        case 'save-env-verify':
          await saveDocument(view, 'env', true);
          return;
        case 'terminal-setup':
          await runTerminalAction(view, 'config:setup', '全量 Setup', view.installation.setupCommand);
          return;
        case 'terminal-model':
          await runTerminalAction(view, 'config:model', '模型 / Provider', view.installation.modelCommand);
          return;
        case 'terminal-config-migrate':
          await runTerminalAction(view, 'config:migrate', '迁移配置', view.installation.configMigrateCommand);
          return;
        case 'terminal-claw-migrate':
          await runTerminalAction(view, 'config:claw-migrate', '导入 OpenClaw', view.installation.clawMigrateCommand);
          return;
        case 'terminal-backend':
          await runTerminalAction(view, 'config:terminal-backend', '终端后端', view.installation.terminalSetupCommand);
          return;
        case 'terminal-tools':
          await runTerminalAction(view, 'config:tools-setup', '工具选择', view.installation.toolsSetupCommand);
          return;
        case 'terminal-skills':
          await runTerminalAction(view, 'config:skills-config', '技能开关', view.installation.skillsConfigCommand);
          return;
        case 'terminal-memory':
          await runTerminalAction(view, 'config:memory-setup', '记忆 Provider', 'hermes memory setup');
          return;
        case 'terminal-plugins':
          await runTerminalAction(view, 'config:plugins', '插件 / Context Engine', 'hermes plugins');
          return;
        case 'terminal-gateway-setup':
          await runTerminalAction(view, 'config:gateway-setup', 'Gateway Setup', view.installation.gatewaySetupCommand);
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
    cachedIntents: null,
    configYaml: '',
    cronSnapshot: null,
    data: null,
    destroyed: false,
    envFile: '',
    error: null,
    extensions: null,
    installation: null,
    investigation: getPageIntent('config'),
    lastResult: null,
    loading: true,
    page,
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    runningDiagnostic: null,
    saving: null,
    skills: [],
    snapshot: null,
    unsubscribe: null,
  };

  if (activeView.investigation) {
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
