import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
} from '../lib/drilldown';
import { formatTimestamp } from '../lib/format';
import {
  consumePageIntent,
  getPageIntent,
  getPanelState,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
} from './native-helpers';

let activeView = null;

const MEMORY_BLUEPRINT = {
  soul: {
    eyebrow: 'Identity',
    description: '系统身份层。',
  },
  memory: {
    eyebrow: 'Persistent',
    description: '长期事实与稳定偏好。',
  },
  user: {
    eyebrow: 'User Profile',
    description: '用户画像与交互偏好。',
  },
};

function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
}

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function cloneWorkspace(workspace = {}) {
  return {
    ...workspace,
    toolsets: [...(workspace.toolsets ?? [])],
    platformToolsets: (workspace.platformToolsets ?? []).map((item) => ({
      ...item,
      toolsets: [...(item.toolsets ?? [])],
    })),
    skillsExternalDirs: [...(workspace.skillsExternalDirs ?? [])],
  };
}

function memoryMeta(key) {
  return MEMORY_BLUEPRINT[key] ?? MEMORY_BLUEPRINT.soul;
}

function limitForKey(key, summary) {
  if (!summary) {
    return null;
  }
  if (key === 'memory') {
    return summary.memoryCharLimit ?? null;
  }
  if (key === 'user') {
    return summary.userCharLimit ?? null;
  }
  return null;
}

function commandText(result) {
  if (!result) {
    return '';
  }
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n') || '命令没有返回输出。';
}

function selectedSummary(view) {
  return view.items.find((item) => item.key === view.selectedKey) ?? null;
}

function currentMeta(view) {
  return memoryMeta(view.selectedKey);
}

function providerLabel(view) {
  return view.config?.summary?.memoryProvider || 'builtin-file';
}

function runtimeProviderLabel(view) {
  return view.extensions?.memoryRuntime?.provider || providerLabel(view);
}

function selectedLimit(view) {
  return limitForKey(view.selectedKey, view.config?.summary ?? null);
}

function remainingChars(view) {
  const limit = selectedLimit(view);
  return limit == null ? null : limit - view.content.length;
}

function warningList(view) {
  const summary = view.config?.summary ?? null;
  const warnings = [];
  const selected = selectedSummary(view);
  const remaining = remainingChars(view);
  const runtimeProvider = runtimeProviderLabel(view);

  if (summary?.memoryEnabled === false) {
    warnings.push('memory.memory_enabled 为 false，文件可编辑但运行态不会稳定使用。');
  }
  if (view.selectedKey === 'user' && summary?.userProfileEnabled === false) {
    warnings.push('USER 画像当前关闭，USER.md 不会完整进入用户建模。');
  }
  if (view.selectedKey !== 'soul' && remaining != null && remaining < 0) {
    warnings.push(`${view.detail?.label ?? view.selectedKey} 已超出字符预算。`);
  }
  if (!selected?.exists) {
    warnings.push(`${view.detail?.label ?? view.selectedKey} 当前缺失，首次保存后才会落盘。`);
  }
  if ((view.dashboard?.counts.sessions ?? 0) === 0) {
    warnings.push('当前还没有历史会话，记忆链路尚未经过真实使用验证。');
  }
  if (view.dashboard?.gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 未运行，消息平台侧记忆注入尚未验证。');
  }
  if (
    summary?.memoryProvider
    && view.extensions
    && !runtimeProvider.toLowerCase().includes(summary.memoryProvider.toLowerCase())
  ) {
    warnings.push(`配置声明 provider=${summary.memoryProvider}，运行态回报为 ${runtimeProvider}。`);
  }

  return warnings;
}

function relaySeed(view) {
  return {
    sourcePage: 'memory',
    headline: view.detail?.label
      ? `围绕 ${view.detail.label} 继续下钻`
      : '围绕记忆工作台继续下钻',
    description: view.investigation?.description
      || '继续围绕 provider、槽位文件、字符预算和运行态一致性做排查。',
    context: view.investigation?.context,
  };
}

function applyIntent(view, intent, announce = true) {
  if (!intent || intent.kind !== 'memory') {
    return;
  }

  view.investigation = intent;
  if (intent.selectedKey) {
    view.selectedKey = intent.selectedKey;
  }
  consumePageIntent();
  if (announce) {
    notify('info', `${intent.headline} 已带入记忆工作台。`);
  }
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">记忆工作台</h1>
      </div>
      <p class="page-desc">正在同步记忆槽位、provider、插件和运行态信号。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function renderSlots(view) {
  if (!view.items.length) {
    return emptyStateHtml('暂无槽位', '当前没有读取到可管理的记忆文件。');
  }

  const summary = view.config?.summary ?? null;

  return `
    <div class="list-stack workspace-list-scroll">
      ${view.items.map((item) => {
        const meta = memoryMeta(item.key);
        const itemLimit = limitForKey(item.key, summary);
        const userProfileOff = item.key === 'user' && summary?.userProfileEnabled === false;
        return `
          <button
            type="button"
            class="list-card session-card ${view.selectedKey === item.key ? 'selected' : ''}"
            data-action="select-slot"
            data-key="${escapeHtml(item.key)}"
          >
            <div class="list-card-title">
              <strong>${escapeHtml(item.label)}</strong>
              <div class="pill-row">
                ${pillHtml(item.exists ? '已存在' : '缺失', item.exists ? 'good' : 'warn')}
                ${pillHtml(meta.eyebrow, 'neutral')}
              </div>
            </div>
            <p>${escapeHtml(meta.description)}</p>
            <div class="pill-row">
              ${itemLimit != null ? pillHtml(`${itemLimit} chars`, 'neutral') : ''}
              ${userProfileOff ? pillHtml('runtime off', 'warn') : ''}
            </div>
            <div class="meta-line">
              <span>${escapeHtml(item.key)}</span>
              <span>${escapeHtml(formatTimestamp(item.updatedAt))}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function updateEditorIndicators(view) {
  const dirtyPill = view.page.querySelector('#memory-dirty-pill');
  const budgetPill = view.page.querySelector('#memory-budget-pill');
  const charValue = view.page.querySelector('#memory-char-count');
  const lineValue = view.page.querySelector('#memory-line-count');

  const dirty = view.detail ? view.content !== view.detail.content : false;
  const remaining = remainingChars(view);
  const lineCount = view.content ? view.content.split(/\r?\n/).length : 0;

  if (dirtyPill) {
    dirtyPill.textContent = dirty ? '未保存' : '已同步';
    dirtyPill.className = `pill pill-${dirty ? 'warn' : 'good'}`;
  }

  if (budgetPill) {
    if (remaining == null) {
      budgetPill.textContent = '无限制';
      budgetPill.className = 'pill pill-neutral';
    } else {
      budgetPill.textContent = `剩余 ${remaining}`;
      budgetPill.className = `pill pill-${remaining < 0 ? 'bad' : remaining < 160 ? 'warn' : 'good'}`;
    }
  }

  if (charValue) {
    charValue.textContent = String(view.content.length);
  }
  if (lineValue) {
    lineValue.textContent = String(lineCount);
  }
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.config) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.config || !view.dashboard || !view.installation || !view.extensions) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">记忆工作台</h1>
        </div>
        <p class="page-desc">围绕记忆文件、provider、插件和校验动作做统一治理。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">记忆工作台快照暂时不可用，可以重新同步后再继续。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
          </div>
        </div>
        ${emptyStateHtml('未能读取记忆工作台快照', view.error || '请稍后再试。')}
      </section>
    `;
    bindEvents(view, {});
    return;
  }

  const summary = view.config.summary ?? null;
  const selected = selectedSummary(view);
  const warnings = warningList(view);
  const current = currentMeta(view);
  const runtimeProvider = runtimeProviderLabel(view);
  const budgetRemaining = remainingChars(view);
  const dirty = view.detail ? view.content !== view.detail.content : false;
  const lineCount = view.content ? view.content.split(/\r?\n/).length : 0;
  const readyCount = view.items.filter((item) => item.exists).length;
  const actionBusy = Boolean(view.runningAction) || view.runningDiagnostic || Boolean(view.saving);
  const outputText = view.lastResult ? commandText(view.lastResult.result) : (view.extensions.memoryRuntime.rawOutput || '暂无输出');
  const outputLabel = view.lastResult?.label || 'memory status';
  const seed = relaySeed(view);
  const configIntent = buildConfigDrilldownIntent(seed, {
    focus: 'memory',
    suggestedCommand: 'memory-status',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    suggestedCommand: 'memory-status',
    logName: 'agent',
  });

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">记忆工作台</h1>
        ${infoTipHtml('页面主区只保留槽位、编辑器、provider 和校验动作。说明信息尽量后置为提示，不再让文案抢掉编辑区和闭环动作的位置。')}
      </div>
      <p class="page-desc">编辑 SOUL / MEMORY / USER，核对 provider，再用体检和原始输出收口。</p>
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">运行摘要</h2>
          <p class="config-section-desc">把文件层、provider 与运行态信号放在同一视野里看。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', disabled: actionBusy || view.refreshing })}
          ${buttonHtml({ action: 'memory-status', label: view.runningDiagnostic ? '体检中…' : '记忆体检', kind: 'primary', disabled: actionBusy })}
        </div>
      </div>
      <div class="compact-overview-grid">
        <div class="shell-card">
          <div class="shell-card-header">
            <strong>当前 Profile</strong>
            <div class="pill-row">
              ${pillHtml(summary?.memoryEnabled ? 'Memory On' : 'Memory Off', summary?.memoryEnabled ? 'good' : 'warn')}
              ${pillHtml(view.dashboard.gateway?.gatewayState ?? 'Gateway ?', view.dashboard.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
            </div>
          </div>
          ${keyValueRowsHtml([
            { label: 'Profile', value: view.profile },
            { label: 'Provider', value: runtimeProvider },
            { label: 'User Profile', value: summary?.userProfileEnabled ? 'On' : 'Off' },
            { label: '会话数', value: String(view.dashboard.counts.sessions ?? 0) },
            { label: '插件数', value: String(view.extensions.plugins.installedCount) },
          ])}
        </div>
        <div class="metrics-grid metrics-grid-tight">
          <div class="metric-card">
            <p class="metric-label">槽位</p>
            <div class="metric-value">${escapeHtml(`${readyCount}/${view.items.length || 3}`)}</div>
            <p class="metric-hint">SOUL / MEMORY / USER</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">Provider</p>
            <div class="metric-value">${escapeHtml(runtimeProvider)}</div>
            <p class="metric-hint">${escapeHtml(providerLabel(view) === runtimeProvider ? '配置与运行态一致' : '配置与运行态待核对')}</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">插件</p>
            <div class="metric-value">${escapeHtml(String(view.extensions.plugins.installedCount))}</div>
            <p class="metric-hint">plugins list 识别结果</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">Warnings</p>
            <div class="metric-value">${escapeHtml(String(warnings.length))}</div>
            <p class="metric-hint">预算、provider、gateway、会话</p>
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
                ${pillHtml(view.investigation.selectedKey ?? view.selectedKey, 'warn')}
                ${pillHtml(view.investigation.context?.source ?? 'sessions')}
              </div>
            </div>
            <div class="context-banner-actions toolbar">
              ${buttonHtml({ action: 'clear-investigation', label: '清除上下文' })}
              ${buttonHtml({ action: 'goto-config', label: '回到配置页' })}
            </div>
          </div>
        `
        : ''
    }

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">闭环动作</h2>
          <p class="config-section-desc">Provider、插件和文件编辑直接回到结构化工作台，不再停留在只读摘要。</p>
        </div>
      </div>
      <div class="control-card-grid">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Provider</p>
              <h3 class="action-card-title">记忆 Provider</h3>
            </div>
            ${pillHtml(summary?.memoryEnabled ? 'Enabled' : 'Disabled', summary?.memoryEnabled ? 'good' : 'warn')}
          </div>
          <p class="command-line">${escapeHtml(`memory ${summary?.memoryEnabled ? 'on' : 'off'} · provider ${providerLabel(view)} · runtime ${runtimeProvider}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'memory-setup', label: '进入记忆配置', kind: 'primary', disabled: actionBusy })}
            ${buttonHtml({ action: 'memory-status', label: view.runningDiagnostic ? '体检中…' : '状态体检', disabled: actionBusy })}
            ${buttonHtml({ action: 'memory-off', label: view.runningAction === 'memory:off' ? '关闭中…' : '关闭记忆', kind: 'danger', disabled: actionBusy })}
          </div>
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Plugins</p>
              <h3 class="action-card-title">插件与扩展 Provider</h3>
            </div>
            ${pillHtml(view.extensions.plugins.installedCount > 0 ? `${view.extensions.plugins.installedCount} 个` : '未安装', view.extensions.plugins.installedCount > 0 ? 'good' : 'neutral')}
          </div>
          <label class="field-stack">
            <span>插件名</span>
            <input class="search-input" id="memory-plugin-input" placeholder="byterover / owner/repo">
          </label>
          <p class="command-line">${escapeHtml(view.pluginInput.trim() || '先输入插件名，再直接安装 / 更新 / 移除或跳到扩展页继续治理。')}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'plugins-panel', label: '扩展工作台', disabled: actionBusy })}
            ${buttonHtml({ action: 'plugin-install', label: view.runningAction === 'memory:plugin-install' ? '安装中…' : '安装', kind: 'primary', disabled: actionBusy || !view.installation.binaryFound || !view.pluginInput.trim() })}
            ${buttonHtml({ action: 'plugin-update', label: view.runningAction === 'memory:plugin-update' ? '更新中…' : '更新', disabled: actionBusy || !view.installation.binaryFound || !view.pluginInput.trim() })}
            ${buttonHtml({ action: 'plugin-remove', label: view.runningAction === 'memory:plugin-remove' ? '移除中…' : '移除', kind: 'danger', disabled: actionBusy || !view.installation.binaryFound || !view.pluginInput.trim() })}
          </div>
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Workspace</p>
              <h3 class="action-card-title">记忆物料</h3>
            </div>
            ${pillHtml(view.detail?.exists ? '已落盘' : '未落盘', view.detail?.exists ? 'good' : 'warn')}
          </div>
          <p class="command-line">${escapeHtml(view.detail?.path || view.config.hermesHome)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: actionBusy })}
            ${buttonHtml({ action: 'open-current-file', label: '定位当前文件', disabled: actionBusy || !view.detail?.path })}
            ${buttonHtml({ action: 'open-current-dir', label: '打开目录', disabled: actionBusy || !view.detail?.path })}
            ${buttonHtml({ action: 'goto-diagnostics', label: '去做诊断' })}
          </div>
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Runtime</p>
              <h3 class="action-card-title">运行态信号</h3>
            </div>
            ${pillHtml(warnings.length === 0 ? '稳定' : `${warnings.length} 条`, warnings.length === 0 ? 'good' : 'warn')}
          </div>
          <p class="command-line">${escapeHtml(`provider ${runtimeProvider} · sessions ${view.dashboard.counts.sessions ?? 0} · gateway ${view.dashboard.gateway?.gatewayState ?? 'unknown'}`)}</p>
          ${
            warnings.length > 0
              ? `
                <div class="warning-stack">
                  ${warnings.slice(0, 2).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
                </div>
              `
              : '<p class="helper-text">当前没有明显的记忆侧阻塞项。</p>'
          }
        </section>
      </div>
    </section>

    <div class="workspace-shell workspace-shell-editor">
      <section class="workspace-rail">
        <div class="workspace-rail-header">
          <div>
            <h2 class="config-section-title">记忆槽位</h2>
            <p class="config-section-desc">只保留 SOUL / MEMORY / USER 三个核心槽位，优先把编辑区让给内容本身。</p>
          </div>
          ${infoTipHtml('槽位卡片只负责文件层。是否真正参与运行时注入，还要结合 provider、开关、字符预算和 gateway 状态一起判断。')}
        </div>
        ${renderSlots(view)}
      </section>

      <div class="workspace-main">
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <div class="panel-title-row">
                <h2 class="config-section-title">${escapeHtml(view.detail?.label || '记忆内容')}</h2>
                ${pillHtml(current.eyebrow, 'neutral')}
                <span id="memory-budget-pill" class="pill pill-${budgetRemaining == null ? 'neutral' : budgetRemaining < 0 ? 'bad' : budgetRemaining < 160 ? 'warn' : 'good'}">
                  ${escapeHtml(budgetRemaining == null ? '无限制' : `剩余 ${budgetRemaining}`)}
                </span>
                <span id="memory-dirty-pill" class="pill pill-${dirty ? 'warn' : 'good'}">
                  ${dirty ? '未保存' : '已同步'}
                </span>
              </div>
              <p class="workspace-main-copy">${escapeHtml(current.description)}</p>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'save', label: view.saving === 'save' ? '保存中…' : '仅保存', disabled: actionBusy || !view.detail })}
              ${buttonHtml({ action: 'save-verify', label: view.saving === 'verify' ? '保存并校验…' : '保存并校验', kind: 'primary', disabled: actionBusy || !view.detail })}
            </div>
          </div>
          ${
            view.detail
              ? `
                <div class="detail-list compact">
                  <div class="key-value-row"><span>路径</span><strong>${escapeHtml(view.detail.path)}</strong></div>
                  <div class="key-value-row"><span>存在</span><strong>${escapeHtml(String(view.detail.exists))}</strong></div>
                  <div class="key-value-row"><span>最近修改</span><strong>${escapeHtml(formatTimestamp(selected?.updatedAt))}</strong></div>
                  <div class="key-value-row"><span>字符数</span><strong id="memory-char-count">${escapeHtml(String(view.content.length))}</strong></div>
                  <div class="key-value-row"><span>行数</span><strong id="memory-line-count">${escapeHtml(String(lineCount))}</strong></div>
                  <div class="key-value-row"><span>字符预算</span><strong>${escapeHtml(selectedLimit(view) == null ? '—' : String(selectedLimit(view)))}</strong></div>
                  <div class="key-value-row"><span>Provider</span><strong>${escapeHtml(runtimeProvider)}</strong></div>
                </div>
                <textarea class="workspace-editor" id="memory-editor" spellcheck="false"></textarea>
              `
              : emptyStateHtml('未选择文件', '从左侧选择一个槽位开始编辑。')
          }
        </section>

        <div class="workspace-bottom-grid">
          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <h2 class="config-section-title">运行态与预算</h2>
                <p class="config-section-desc">配置声明、运行态 provider 和字符预算放在一起核对。</p>
              </div>
              ${pillHtml(runtimeProvider, runtimeProvider === 'builtin-file' ? 'good' : 'neutral')}
            </div>
            <div class="health-grid">
              <section class="health-card">
                <div class="health-card-header">
                  <strong>Provider</strong>
                  ${pillHtml(runtimeProvider, providerLabel(view) === runtimeProvider ? 'good' : 'warn')}
                </div>
                <p>${escapeHtml(`配置声明 ${providerLabel(view)}，运行态回报 ${runtimeProvider}。`)}</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>Memory Switch</strong>
                  ${pillHtml(summary?.memoryEnabled ? '已开启' : '已关闭', summary?.memoryEnabled ? 'good' : 'warn')}
                </div>
                <p>关闭后文件仍可编辑，但不会稳定参与记忆闭环。</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>User Profile</strong>
                  ${pillHtml(summary?.userProfileEnabled ? '已开启' : '已关闭', summary?.userProfileEnabled ? 'good' : 'warn')}
                </div>
                <p>USER.md 是否参与建模，完全由这个开关决定。</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>Budget</strong>
                  ${pillHtml(selectedLimit(view) == null ? '—' : String(selectedLimit(view)), budgetRemaining != null && budgetRemaining < 0 ? 'bad' : 'good')}
                </div>
                <p>${escapeHtml(`当前编辑对象剩余 ${budgetRemaining == null ? '—' : budgetRemaining} 字符。`)}</p>
              </section>
            </div>
            ${
              warnings.length > 0
                ? `
                  <div class="warning-stack top-gap">
                    ${warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
                  </div>
                `
                : ''
            }
          </section>

          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <h2 class="config-section-title">最近动作与原始输出</h2>
                <p class="config-section-desc">保留最近一次保存、插件动作或状态体检结果。</p>
              </div>
              <div class="toolbar">
                ${buttonHtml({ action: 'goto-config', label: '回到配置页' })}
                ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
              </div>
            </div>
            ${commandResultHtml(view.lastResult, '尚未执行动作', '保存记忆、插件治理或状态体检后，这里会保留最近一次结果。')}
            <div class="top-gap">
              <div class="detail-list compact">
                <div class="key-value-row"><span>当前显示</span><strong>${escapeHtml(outputLabel)}</strong></div>
                <div class="key-value-row"><span>运行态 Provider</span><strong>${escapeHtml(runtimeProvider)}</strong></div>
                <div class="key-value-row"><span>插件数</span><strong>${escapeHtml(String(view.extensions.plugins.installedCount))}</strong></div>
              </div>
              <pre class="code-block compact-code top-gap">${escapeHtml(outputText)}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  bindEvents(view, { configIntent, diagnosticsIntent });

  const pluginInput = view.page.querySelector('#memory-plugin-input');
  const editor = view.page.querySelector('#memory-editor');

  if (pluginInput) {
    pluginInput.value = view.pluginInput;
  }
  if (editor) {
    editor.value = view.content;
  }
  updateEditorIndicators(view);
}

async function loadDetail(view, key, options = {}) {
  try {
    const detail = await api.readMemoryFile(key, view.profile);
    if (view.destroyed) {
      return;
    }
    view.selectedKey = key;
    view.detail = detail;
    view.content = detail.content;
    if (!options.quiet) {
      renderPage(view);
    }
  } catch (reason) {
    notify('error', String(reason));
  }
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.config && view.dashboard && view.installation && view.extensions);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [items, config, dashboard, installation, extensions] = await Promise.all([
      api.listMemoryFiles(profile),
      api.getConfigDocuments(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getExtensionsSnapshot(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.items = items;
    view.config = config;
    view.dashboard = dashboard;
    view.installation = installation;
    view.extensions = extensions;
    view.pluginInput = view.pluginInput.trim()
      || extensions.plugins.items[0]
      || extensions.memoryRuntime.installedPlugins[0]?.name
      || '';

    const nextKey = items.some((item) => item.key === view.selectedKey)
      ? view.selectedKey
      : items[0]?.key ?? 'soul';
    await loadDetail(view, nextKey, { quiet: true });
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
  view.lastResult = {
    label,
    result,
  };
}

async function runMemoryStatus(view, options = {}) {
  view.runningDiagnostic = true;
  renderPage(view);
  try {
    const result = await api.runDiagnostic('memory-status', view.profile);
    storeResult(view, '记忆状态体检', result);
    if (!options.quiet) {
      notify(result.success ? 'success' : 'error', result.success ? '记忆状态体检已完成。' : '记忆状态体检失败，请查看输出。');
    }
    await loadData(view, { silent: true });
    return result;
  } catch (reason) {
    notify('error', String(reason));
    return null;
  } finally {
    view.runningDiagnostic = false;
    renderPage(view);
  }
}

async function saveCurrent(view, verify = false) {
  view.saving = verify ? 'verify' : 'save';
  renderPage(view);
  try {
    await api.writeMemoryFile(view.selectedKey, view.content, view.profile);
    await loadData(view, { silent: true });
    notify('success', verify ? `${view.selectedKey} 已保存，开始体检记忆运行态。` : `${view.selectedKey} 已保存。`);
    if (verify) {
      await runMemoryStatus(view, { quiet: true });
    }
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.saving = null;
    renderPage(view);
  }
}

async function saveMemoryWorkspace(view, mutate, successMessage) {
  view.runningAction = 'memory:save-workspace';
  renderPage(view);
  try {
    const request = cloneWorkspace(view.config?.workspace ?? {});
    mutate(request);
    const nextConfig = await api.saveStructuredConfig(request, view.profile);
    if (view.destroyed) {
      return;
    }
    view.config = nextConfig;
    storeResult(view, successMessage, {
      command: 'save_structured_config',
      exitCode: 0,
      success: true,
      stdout: successMessage,
      stderr: '',
    });
    notify('success', successMessage);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function executePluginAction(view, action, name) {
  const normalized = String(name ?? '').trim();
  if (!normalized) {
    notify('error', '请先输入插件名。');
    return;
  }

  const actionKey = `memory:plugin-${action}`;
  view.runningAction = actionKey;
  renderPage(view);
  try {
    const result = await api.runPluginAction(action, normalized, view.profile);
    storeResult(view, `${action} ${normalized}`, result);
    notify(result.success ? 'success' : 'error', `${normalized} ${action} 已执行。`);
    await loadData(view, { silent: true });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function openInFinder(view, path, label, revealInFinder = false) {
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

function syncWithPanelState(view) {
  const intent = getPageIntent('memory');
  if (intent) {
    applyIntent(view, intent);
    void loadData(view, { silent: true });
    return;
  }

  const nextProfile = getPanelState().selectedProfile;
  if (nextProfile !== view.profile) {
    view.profile = nextProfile;
    view.config = null;
    view.dashboard = null;
    view.installation = null;
    view.extensions = null;
    view.detail = null;
    view.items = [];
    view.content = '';
    view.error = null;
    view.lastResult = null;
    void loadData(view);
    return;
  }

  renderPage(view);
}

function bindEvents(view, intents) {
  const pluginInput = view.page.querySelector('#memory-plugin-input');
  const editor = view.page.querySelector('#memory-editor');

  if (pluginInput) {
    pluginInput.oninput = (event) => {
      view.pluginInput = event.target.value;
      renderPage(view);
    };
    pluginInput.onkeydown = (event) => {
      if (event.key === 'Enter' && view.pluginInput.trim()) {
        event.preventDefault();
        void executePluginAction(view, 'install', view.pluginInput);
      }
    };
  }

  if (editor) {
    editor.oninput = (event) => {
      view.content = event.target.value;
      updateEditorIndicators(view);
    };
  }

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      switch (action) {
        case 'refresh':
          await loadData(view);
          return;
        case 'memory-status':
          await runMemoryStatus(view);
          return;
        case 'clear-investigation':
          view.investigation = null;
          renderPage(view);
          return;
        case 'select-slot':
          await loadDetail(view, element.getAttribute('data-key'));
          return;
        case 'memory-setup':
          navigate('config', buildConfigDrilldownIntent(relaySeed(view), {
            description: '继续在配置中心直接调整 memory provider、记忆开关与用户画像，不再回终端跑 provider 向导。',
            focus: 'memory',
            suggestedCommand: 'memory-status',
          }));
          return;
        case 'memory-off':
          if (!window.confirm('确定关闭当前 profile 的记忆功能吗？')) {
            return;
          }
          await saveMemoryWorkspace(view, (request) => {
            request.memoryEnabled = false;
            request.userProfileEnabled = false;
            request.memoryProvider = '';
            request.toolsets = request.toolsets.filter((item) => item !== 'memory');
            request.platformToolsets = request.platformToolsets.map((item) => ({
              ...item,
              toolsets: item.toolsets.filter((toolset) => toolset !== 'memory'),
            }));
          }, '记忆功能已关闭，配置已直接写回。');
          return;
        case 'plugins-panel':
          navigate('extensions', buildExtensionsDrilldownIntent(relaySeed(view), {
            description: '继续在扩展工作台直接管理插件、memory runtime 和相关依赖。',
            pluginName: view.pluginInput.trim() || undefined,
            rawKind: 'plugins',
          }));
          return;
        case 'plugin-install':
          await executePluginAction(view, 'install', view.pluginInput);
          return;
        case 'plugin-update':
          await executePluginAction(view, 'update', view.pluginInput);
          return;
        case 'plugin-remove':
          if (!window.confirm(`确定移除插件 ${view.pluginInput.trim()} 吗？`)) {
            return;
          }
          await executePluginAction(view, 'remove', view.pluginInput);
          return;
        case 'open-home':
          await openInFinder(view, view.config.hermesHome, 'Hermes Home');
          return;
        case 'open-current-file':
          if (view.detail?.path) {
            await openInFinder(view, view.detail.path, view.detail.label, true);
          }
          return;
        case 'open-current-dir':
          if (view.detail?.path) {
            await openInFinder(view, directoryOf(view.detail.path), '记忆目录');
          }
          return;
        case 'goto-config':
          navigate('config', intents.configIntent);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', intents.diagnosticsIntent);
          return;
        case 'save':
          await saveCurrent(view, false);
          return;
        case 'save-verify':
          await saveCurrent(view, true);
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
    content: '',
    dashboard: null,
    detail: null,
    destroyed: false,
    error: null,
    extensions: null,
    installation: null,
    investigation: null,
    items: [],
    lastResult: null,
    loading: true,
    page,
    pluginInput: '',
    profile: getPanelState().selectedProfile,
    refreshing: false,
    runningAction: null,
    runningDiagnostic: false,
    saving: null,
    selectedKey: 'soul',
    unsubscribe: null,
  };

  const intent = getPageIntent('memory');
  if (intent) {
    applyIntent(activeView, intent, false);
  }

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
