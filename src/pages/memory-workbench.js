import { formatTimestamp } from '../lib/format';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  keyValueRowsHtml,
  pillHtml,
} from './native-helpers';
import { infoTipHtml } from './workbench-helpers';

const MEMORY_BLUEPRINT = {
  soul: {
    eyebrow: '身份层',
    description: '系统身份层。',
  },
  memory: {
    eyebrow: '长期记忆',
    description: '长期事实与稳定偏好。',
  },
  user: {
    eyebrow: '用户画像',
    description: '用户画像与交互偏好。',
  },
};

export function cloneWorkspace(workspace = {}) {
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

function gatewayLabel(state) {
  if (state === 'running') {
    return '网关运行中';
  }
  if (state === 'starting' || state === 'pending') {
    return '网关启动中';
  }
  if (state === 'error') {
    return '网关异常';
  }
  return '网关待启动';
}

function toggleLabel(enabled, on = '已开启', off = '已关闭') {
  return enabled ? on : off;
}

function yesNoLabel(value) {
  return value ? '是' : '否';
}

function runtimeProviderLabel(view) {
  return view.extensions?.memoryRuntime?.provider || providerLabel(view);
}

function selectedLimit(view) {
  return limitForKey(view.selectedKey, view.config?.summary ?? null);
}

export function remainingChars(view) {
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
    warnings.push('网关未运行，消息平台侧记忆注入尚未验证。');
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
              ${itemLimit != null ? pillHtml(`上限 ${itemLimit}`, 'neutral') : ''}
              ${userProfileOff ? pillHtml('画像停用', 'warn') : ''}
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

export function deriveMemoryWorkbenchState(view) {
  const summary = view.config?.summary ?? null;
  const selected = selectedSummary(view);
  const warnings = warningList(view);
  const current = currentMeta(view);
  const runtimeProvider = runtimeProviderLabel(view);
  const budgetRemaining = remainingChars(view);
  const dirty = view.detail ? view.content !== view.detail.content : false;
  const lineCount = view.content ? view.content.split(/\r?\n/).length : 0;
  const readyCount = view.items.filter((item) => item.exists).length;
  const actionBusy = Boolean(view.runningAction) || view.runningDiagnostic || Boolean(view.saving);
  const outputText = view.lastResult ? commandText(view.lastResult.result) : (view.extensions?.memoryRuntime?.rawOutput || '暂无输出');
  const outputLabel = view.lastResult?.label || '记忆状态';

  return {
    actionBusy,
    budgetRemaining,
    current,
    dirty,
    lineCount,
    outputLabel,
    outputText,
    readyCount,
    runtimeProvider,
    selected,
    summary,
    warnings,
  };
}

export function renderMemoryWorkbench(view, state) {
  const {
    actionBusy,
    budgetRemaining,
    current,
    dirty,
    lineCount,
    outputLabel,
    outputText,
    readyCount,
    runtimeProvider,
    selected,
    summary,
    warnings,
  } = state;

  return `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">记忆工作台</h1>
        ${infoTipHtml('主区只保留槽位、编辑器、Provider 和校验动作。说明信息尽量后置，不再抢编辑区和闭环动作的位置。')}
      </div>
      <p class="page-desc">编辑槽位、核对 Provider，并把运行态偏差收口到一个工作台里。</p>
    </div>

    <section class="workspace-summary-strip workspace-summary-strip-dense">
      <section class="summary-mini-card">
        <span class="summary-mini-label">当前实例</span>
        <strong class="summary-mini-value">${escapeHtml(view.profile)}</strong>
        <span class="summary-mini-meta">${escapeHtml(`${toggleLabel(summary?.memoryEnabled)} · ${gatewayLabel(view.dashboard.gateway?.gatewayState)}`)}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">运行 Provider</span>
        <strong class="summary-mini-value">${escapeHtml(runtimeProvider)}</strong>
        <span class="summary-mini-meta">${escapeHtml(providerLabel(view) === runtimeProvider ? '配置与运行态已对齐' : `配置 ${providerLabel(view)}，运行 ${runtimeProvider}`)}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">槽位覆盖</span>
        <strong class="summary-mini-value">${escapeHtml(`${readyCount}/${view.items.length || 3}`)}</strong>
        <span class="summary-mini-meta">${escapeHtml(`用户画像 ${toggleLabel(summary?.userProfileEnabled)} · 插件 ${view.extensions.plugins.installedCount} 个`)}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">最近回执</span>
        <strong class="summary-mini-value">${escapeHtml(view.lastResult?.label || '待执行')}</strong>
        <span class="summary-mini-meta">${escapeHtml(warnings.length === 0 ? '当前没有明显阻塞项' : `${warnings.length} 条风险待收口`)}</span>
      </section>
    </section>

    ${
      view.investigation
        ? `
          <div class="context-banner context-banner-compact">
            <div class="context-banner-header">
              <div class="context-banner-copy">
                <span class="context-banner-label">会话联动</span>
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
          <p class="config-section-desc">开关写回、插件治理和文件定位都在这里直接处理。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', disabled: actionBusy || view.refreshing })}
          ${buttonHtml({ action: 'memory-status', label: view.runningDiagnostic ? '体检中…' : '记忆体检', kind: 'primary', disabled: actionBusy })}
        </div>
      </div>
      <div class="control-card-grid control-card-grid-dense">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">配置写回</p>
              <h3 class="action-card-title">记忆接入</h3>
            </div>
            ${pillHtml(toggleLabel(summary?.memoryEnabled), summary?.memoryEnabled ? 'good' : 'warn')}
          </div>
          <p class="workspace-inline-meta">${escapeHtml(`开关 ${summary?.memoryEnabled ? '开启' : '关闭'} · 配置 ${providerLabel(view)} · 运行 ${runtimeProvider}`)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'memory-setup', label: '调整配置', kind: 'primary', disabled: actionBusy })}
            ${buttonHtml({ action: 'memory-status', label: view.runningDiagnostic ? '体检中…' : '状态体检', disabled: actionBusy })}
            ${buttonHtml({ action: 'memory-off', label: view.runningAction === 'memory:off' ? '关闭中…' : '关闭记忆', kind: 'danger', disabled: actionBusy })}
          </div>
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">插件治理</p>
              <h3 class="action-card-title">插件与扩展</h3>
            </div>
            ${pillHtml(view.extensions.plugins.installedCount > 0 ? `${view.extensions.plugins.installedCount} 个` : '未安装', view.extensions.plugins.installedCount > 0 ? 'good' : 'neutral')}
          </div>
          <label class="field-stack">
            <span>插件名</span>
            <input class="search-input" id="memory-plugin-input" placeholder="byterover / owner/repo">
          </label>
          <p class="workspace-inline-meta">${escapeHtml(view.pluginInput.trim() || '先输入插件名，再直接安装 / 更新 / 移除或跳到扩展页继续治理。')}</p>
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
              <p class="eyebrow">物料定位</p>
              <h3 class="action-card-title">文件与目录</h3>
            </div>
            ${pillHtml(view.detail?.exists ? '已落盘' : '未落盘', view.detail?.exists ? 'good' : 'warn')}
          </div>
          <p class="workspace-inline-meta">${escapeHtml(view.detail?.path || view.config.hermesHome)}</p>
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
              <p class="eyebrow">运行闭环</p>
              <h3 class="action-card-title">风险收口</h3>
            </div>
            ${pillHtml(warnings.length === 0 ? '稳定' : `${warnings.length} 条`, warnings.length === 0 ? 'good' : 'warn')}
          </div>
          <p class="workspace-inline-meta">${escapeHtml(`运行 ${runtimeProvider} · 会话 ${view.dashboard.counts.sessions ?? 0} · ${gatewayLabel(view.dashboard.gateway?.gatewayState)}`)}</p>
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

    <div class="workspace-shell workspace-shell-editor workspace-shell-dense">
      <section class="workspace-rail">
        <div class="workspace-rail-header">
          <div>
            <h2 class="config-section-title">记忆槽位</h2>
            <p class="config-section-desc">只保留 3 个核心槽位，优先把空间让给编辑区。</p>
          </div>
          ${infoTipHtml('槽位卡片只负责文件层。是否真正参与运行时注入，还要结合 Provider、开关、字符预算和网关状态一起判断。')}
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
                <div class="detail-list compact detail-list-dense">
                  <div class="key-value-row"><span>路径</span><strong>${escapeHtml(view.detail.path)}</strong></div>
                  <div class="key-value-row"><span>已落盘</span><strong>${escapeHtml(yesNoLabel(view.detail.exists))}</strong></div>
                  <div class="key-value-row"><span>最近修改</span><strong>${escapeHtml(formatTimestamp(selected?.updatedAt))}</strong></div>
                  <div class="key-value-row"><span>字符数</span><strong id="memory-char-count">${escapeHtml(String(view.content.length))}</strong></div>
                  <div class="key-value-row"><span>行数</span><strong id="memory-line-count">${escapeHtml(String(lineCount))}</strong></div>
                  <div class="key-value-row"><span>字符上限</span><strong>${escapeHtml(selectedLimit(view) == null ? '不限' : String(selectedLimit(view)))}</strong></div>
                  <div class="key-value-row"><span>运行 Provider</span><strong>${escapeHtml(runtimeProvider)}</strong></div>
                </div>
                <textarea class="workspace-editor" id="memory-editor" spellcheck="false"></textarea>
              `
              : emptyStateHtml('未选择文件', '从左侧选择一个槽位开始编辑。')
          }
        </section>

        <div class="workspace-bottom-grid workspace-bottom-grid-dense">
          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <h2 class="config-section-title">Provider 与预算</h2>
                <p class="config-section-desc">把配置声明、运行回执和字符预算放在一起核对。</p>
              </div>
              ${pillHtml(runtimeProvider, runtimeProvider === 'builtin-file' ? 'good' : 'neutral')}
            </div>
            <div class="health-grid health-grid-dense">
              <section class="health-card">
                <div class="health-card-header">
                  <strong>Provider 对齐</strong>
                  ${pillHtml(runtimeProvider, providerLabel(view) === runtimeProvider ? 'good' : 'warn')}
                </div>
                <p>${escapeHtml(`配置声明 ${providerLabel(view)}，运行态回报 ${runtimeProvider}。`)}</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>记忆开关</strong>
                  ${pillHtml(toggleLabel(summary?.memoryEnabled), summary?.memoryEnabled ? 'good' : 'warn')}
                </div>
                <p>关闭后文件仍可编辑，但不会稳定参与记忆闭环。</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>用户画像</strong>
                  ${pillHtml(toggleLabel(summary?.userProfileEnabled), summary?.userProfileEnabled ? 'good' : 'warn')}
                </div>
                <p>USER.md 是否参与建模，完全由这个开关决定。</p>
              </section>
              <section class="health-card">
                <div class="health-card-header">
                  <strong>字符预算</strong>
                  ${pillHtml(selectedLimit(view) == null ? '不限' : String(selectedLimit(view)), budgetRemaining != null && budgetRemaining < 0 ? 'bad' : 'good')}
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
                <h2 class="config-section-title">最近回执与原始输出</h2>
                <p class="config-section-desc">保留最近一次写回、插件治理或状态体检结果。</p>
              </div>
              ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
            </div>
            ${commandResultHtml(view.lastResult, '尚未执行动作', '保存记忆、插件治理或状态体检后，这里会保留最近一次结果。')}
            <div class="top-gap">
              <div class="detail-list compact detail-list-dense">
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
}
