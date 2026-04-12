import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import { buildDiagnosticsDrilldownIntent, buildLogsDrilldownIntent } from '../lib/drilldown';
import { formatTimestamp, truncate } from '../lib/format';
import { getPanelState, navigate, notify, subscribePanelState } from '../lib/panel-state';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  firstLine,
  keyValueRowsHtml,
  pillHtml,
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

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function categoryOptions(skills) {
  return ['all', ...Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean))).sort()];
}

function filteredSkills(view) {
  const query = view.query.trim().toLowerCase();
  return view.skills.filter((skill) => {
    if (view.categoryFilter !== 'all' && skill.category !== view.categoryFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [skill.name, skill.description, skill.category, skill.relativePath, skill.preview]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

function currentSkill(view, filtered) {
  return filtered.find((skill) => skill.filePath === view.selectedPath)
    ?? view.skills.find((skill) => skill.filePath === view.selectedPath)
    ?? filtered[0]
    ?? view.skills[0]
    ?? null;
}

function selectedJobs(view, skill) {
  if (!skill || !view.cron) {
    return [];
  }
  return view.cron.jobs.filter((job) => job.skills.includes(skill.name));
}

function skillUsageNames(view) {
  return new Set((view.cron?.jobs ?? []).flatMap((job) => job.skills));
}

function runtimeLocalSkillCount(view) {
  return view.extensions?.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
}

function runtimeSkillMismatch(view) {
  return runtimeLocalSkillCount(view) !== view.skills.length;
}

function capabilityWarnings(view, skill, jobs) {
  const warnings = [];
  const dashboard = view.dashboard;
  const extensions = view.extensions;
  const usedNames = skillUsageNames(view);
  const currentToolsets = dashboard?.config.toolsets ?? [];

  if (!view.skills.length) {
    warnings.push('当前 profile 没有扫描到任何技能文件，能力面会退化到纯工具调用。');
  }
  if (!currentToolsets.length) {
    warnings.push('当前没有配置任何 toolsets，目录里的技能未必真正暴露给模型。');
  }
  if (dashboard?.config.memoryEnabled === false) {
    warnings.push('记忆当前关闭，skills 与长期记忆的闭环会明显变弱。');
  }
  if (dashboard?.gateway?.gatewayState !== 'running' && (view.cron?.jobs ?? []).some((job) => job.deliver !== 'local' && job.deliver !== 'origin')) {
    warnings.push('存在远端投递作业，但 Gateway 未运行，消息平台侧链路还没闭环。');
  }
  if (skill && jobs.length === 0 && (view.cron?.jobs.length ?? 0) > 0) {
    warnings.push(`当前选中的技能 ${skill.name} 还没有被任何 cron 作业显式引用。`);
  }
  if (extensions && runtimeSkillMismatch(view)) {
    warnings.push(`CLI 运行态 local skills 为 ${runtimeLocalSkillCount(view)} 个，本地目录扫描为 ${view.skills.length} 个。`);
  }
  if (!usedNames.size && (view.cron?.jobs.length ?? 0) > 0) {
    warnings.push('当前 cron 作业存在，但没有显式绑定任何技能，建议回 cron 页复核编排。');
  }

  return warnings;
}

function relaySeed(view, skill) {
  return {
    sourcePage: 'skills',
    headline: skill ? `围绕技能 ${skill.name} 继续下钻` : '围绕技能层继续下钻',
    description: skill
      ? `继续围绕 ${skill.name} 的目录态、运行态与自动化接入做排查。`
      : '继续围绕技能目录、运行态与自动化接入做排查。',
    context: skill
      ? {
          sessionId: `skill:${skill.name}`,
          title: skill.name,
          source: skill.category || 'skills',
          preview: truncate(skill.description || skill.preview || skill.relativePath, 120),
          toolNames: [skill.name],
        }
      : undefined,
  };
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">技能工作台</h1>
      </div>
      <p class="page-desc">正在同步技能目录、运行态、安装面和自动化引用。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function renderSkillList(view, filtered, skill) {
  if (!filtered.length) {
    return emptyStateHtml('未匹配到技能', '调整关键词或分类后再试。');
  }

  return `
    <div class="list-stack workspace-list-scroll">
      ${filtered.map((item) => {
        const referenced = (view.cron?.jobs ?? []).some((job) => job.skills.includes(item.name));
        return `
          <button
            type="button"
            class="list-card session-card ${skill?.filePath === item.filePath ? 'selected' : ''}"
            data-action="select-skill"
            data-path="${escapeHtml(item.filePath)}"
          >
            <div class="list-card-title">
              <strong>${escapeHtml(item.name)}</strong>
              <div class="pill-row">
                ${pillHtml(item.category || 'uncategorized', 'neutral')}
                ${referenced ? pillHtml('Cron 中', 'good') : pillHtml('未编排', 'neutral')}
              </div>
            </div>
            <p>${escapeHtml(item.description || 'CLI 未返回描述。')}</p>
            <p class="helper-text">${escapeHtml(truncate(firstLine(item.preview, '无预览'), 84))}</p>
            <div class="meta-line">
              <span>${escapeHtml(item.relativePath)}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderCronJobs(jobs) {
  if (!jobs.length) {
    return emptyStateHtml('尚未接入自动化', '这个技能当前还没有被任何 cron 作业显式引用。');
  }

  return `
    <div class="list-stack">
      ${jobs.map((job) => `
        <div class="list-card">
          <div class="list-card-title">
            <strong>${escapeHtml(job.name)}</strong>
            <div class="pill-row">
              ${pillHtml(job.state, job.state === 'scheduled' ? 'good' : job.state === 'paused' ? 'warn' : 'bad')}
              ${pillHtml(job.deliver, job.deliver === 'local' || job.deliver === 'origin' ? 'neutral' : 'warn')}
            </div>
          </div>
          <p>${escapeHtml(truncate(job.prompt || '无 prompt', 120))}</p>
          <div class="meta-line">
            <span>${escapeHtml(job.scheduleDisplay || '未提供调度表达式')}</span>
            <span>${escapeHtml(formatTimestamp(job.nextRunAt))}</span>
          </div>
        </div>
      `).join('')}
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

  if (view.error || !view.dashboard || !view.installation || !view.extensions || !view.cron) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">技能工作台</h1>
        </div>
        <p class="page-desc">围绕 skills 的目录态、安装态与运行态做统一治理。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">技能快照暂时不可用，可以重新拉取状态后再继续治理。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
          </div>
        </div>
        ${emptyStateHtml('未能读取技能工作台快照', view.error || '请稍后重试。')}
      </section>
    `;
    bindEvents(view);
    return;
  }

  const filtered = filteredSkills(view);
  const skill = currentSkill(view, filtered);
  const jobs = selectedJobs(view, skill);
  const usedNames = skillUsageNames(view);
  const warnings = capabilityWarnings(view, skill, jobs);
  const categories = categoryOptions(view.skills);
  const currentToolsets = view.dashboard.config.toolsets ?? [];
  const runtimeLocal = runtimeLocalSkillCount(view);
  const selectedExistsInRuntime = skill ? view.extensions.runtimeSkills.some((item) => item.name === skill.name) : false;
  const seed = relaySeed(view, skill);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    logName: 'agent',
    contains: skill?.name ?? view.query ?? '',
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    suggestedCommand: skill ? 'tools-summary' : 'doctor',
    logName: 'agent',
  });

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">技能工作台</h1>
        ${infoTipHtml('这里不再堆大段说明。核心只保留技能目录、安装动作、运行态差异和自动化引用，跨页入口尽量收敛到少量真正有用的跳转。')}
      </div>
      <p class="page-desc">浏览、安装、核对运行态，再把技能接入 cron 和日志排查链路。</p>
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">运行摘要</h2>
          <p class="config-section-desc">目录态和运行态放在同一层看，避免只读扫描信息掩盖真实可用性。</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', kind: 'primary', disabled: view.refreshing || Boolean(view.runningAction) })}
        </div>
      </div>
      <div class="compact-overview-grid">
        <div class="shell-card">
          <div class="shell-card-header">
            <strong>当前 Profile</strong>
            <div class="pill-row">
              ${pillHtml(view.dashboard.config.memoryEnabled ? 'Memory On' : 'Memory Off', view.dashboard.config.memoryEnabled ? 'good' : 'warn')}
              ${pillHtml(view.dashboard.gateway?.gatewayState ?? 'Gateway ?', view.dashboard.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
            </div>
          </div>
          ${keyValueRowsHtml([
            { label: 'Profile', value: view.profile },
            { label: '终端后端', value: view.dashboard.config.terminalBackend || '—' },
            { label: '默认模型', value: view.dashboard.config.modelDefault || '—' },
            { label: 'Provider', value: view.dashboard.config.modelProvider || '—' },
            { label: 'Toolsets', value: currentToolsets.length ? currentToolsets.join(', ') : '—' },
          ])}
        </div>
        <div class="metrics-grid metrics-grid-tight">
          <div class="metric-card">
            <p class="metric-label">目录技能</p>
            <div class="metric-value">${escapeHtml(String(view.skills.length))}</div>
            <p class="metric-hint">扫描自 Hermes skills 目录</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">运行态 Local</p>
            <div class="metric-value">${escapeHtml(String(runtimeLocal))}</div>
            <p class="metric-hint">${runtimeSkillMismatch(view) ? 'CLI 与目录存在偏差' : 'CLI 与目录已对齐'}</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">分类数</p>
            <div class="metric-value">${escapeHtml(String(new Set(view.skills.map((item) => item.category)).size))}</div>
            <p class="metric-hint">当前本地技能分类簇</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">Cron 引用</p>
            <div class="metric-value">${escapeHtml(String(usedNames.size))}</div>
            <p class="metric-hint">${escapeHtml(`${view.cron.jobs.length} 个作业里显式引用技能`)}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">治理动作</h2>
          <p class="config-section-desc">尽量沿用 Hermes 官方命令，桌面端只负责把常见操作收拢成闭环。</p>
        </div>
      </div>
      <div class="control-card-grid">
        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Registry</p>
              <h3 class="action-card-title">浏览与治理</h3>
            </div>
            ${pillHtml(view.installation.binaryFound ? 'CLI 就绪' : 'CLI 缺失', view.installation.binaryFound ? 'good' : 'bad')}
          </div>
          <p class="command-line">hermes skills browse · ${escapeHtml(view.installation.skillsConfigCommand)} · hermes skills check · hermes skills update</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'skills-browse', label: view.runningAction === 'skills:browse' ? '技能浏览器…' : '技能浏览器', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
            ${buttonHtml({ action: 'skills-config', label: view.runningAction === 'skills:config' ? '技能开关…' : '技能开关', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
            ${buttonHtml({ action: 'skills-check', label: view.runningAction === 'skills:check' ? '检查更新…' : '检查更新', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
            ${buttonHtml({ action: 'skills-update', label: view.runningAction === 'skills:update' ? '更新中…' : '更新已装技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Install</p>
              <h3 class="action-card-title">搜索 / 预检 / 安装</h3>
            </div>
            ${pillHtml(view.installTarget.trim() || '等待输入 ID', view.installTarget.trim() ? 'good' : 'warn')}
          </div>
          <div class="form-grid">
            <label class="field-stack">
              <span>搜索关键词</span>
              <input class="search-input" id="skills-registry-query" placeholder="react / kubernetes / official/security/1password">
            </label>
            <label class="field-stack">
              <span>技能 ID</span>
              <input class="search-input" id="skills-install-target" placeholder="official/security/1password">
            </label>
          </div>
          <p class="command-line">
            ${escapeHtml(view.registryQuery.trim() ? `hermes skills search ${view.registryQuery.trim()}` : '先输入关键词执行 skills search')}
            ·
            ${escapeHtml(view.installTarget.trim() ? `hermes skills inspect ${view.installTarget.trim()} / hermes skills install ${view.installTarget.trim()}` : '输入技能 ID 后可 inspect / install')}
          </p>
          <div class="toolbar">
            ${buttonHtml({ action: 'skills-search', label: view.runningAction === 'skills:search' ? '搜索中…' : '搜索技能', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.registryQuery.trim() })}
            ${buttonHtml({ action: 'skills-inspect', label: view.runningAction === 'skills:inspect' ? '预检中…' : '预检技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.installTarget.trim() })}
            ${buttonHtml({ action: 'skills-install', label: view.runningAction === 'skills:install' ? '安装中…' : '安装技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.installTarget.trim() })}
            ${buttonHtml({ action: 'skills-audit', label: view.runningAction === 'skills:audit' ? '审计中…' : '审计已装技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          </div>
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Runtime</p>
              <h3 class="action-card-title">目录态 vs 运行态</h3>
            </div>
            ${pillHtml(selectedExistsInRuntime ? '运行态可见' : '运行态未见', selectedExistsInRuntime ? 'good' : 'warn')}
          </div>
          <p class="command-line">
            ${escapeHtml(`toolsets [${currentToolsets.length ? currentToolsets.join(', ') : '未配置'}] · gateway ${view.dashboard.gateway?.gatewayState ?? 'unknown'} · memory ${view.dashboard.config.memoryEnabled ? 'on' : 'off'}`)}
          </p>
          ${keyValueRowsHtml([
            { label: '运行态 Local', value: String(runtimeLocal) },
            { label: '目录扫描', value: String(view.skills.length) },
            { label: 'Cron 作业', value: String(view.cron.jobs.length) },
            { label: '已编排技能', value: String(usedNames.size) },
          ])}
        </section>

        <section class="action-card action-card-compact">
          <div class="action-card-header">
            <div>
              <p class="eyebrow">Workspace</p>
              <h3 class="action-card-title">目录与物料</h3>
            </div>
            ${pillHtml(skill ? '已选中' : '未选择', skill ? 'good' : 'warn')}
          </div>
          <p class="command-line">${escapeHtml(skill?.filePath || view.dashboard.hermesHome)}</p>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-skill-file', label: '定位技能文件', disabled: Boolean(view.runningAction) || !skill })}
            ${buttonHtml({ action: 'open-skill-dir', label: '打开技能目录', disabled: Boolean(view.runningAction) || !skill })}
            ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) })}
            ${buttonHtml({ action: 'goto-diagnostics', label: '去做诊断' })}
          </div>
        </section>
      </div>
    </section>

    <div class="workspace-shell">
      <section class="workspace-rail">
        <div class="workspace-rail-header">
          <div>
            <h2 class="config-section-title">技能列表</h2>
            <p class="config-section-desc">优先定位当前 profile 真正在用、或者最值得验证的技能。</p>
          </div>
          ${infoTipHtml('这里聚焦目录文件，不重复展示扩展页已经有的 runtime source 全景。左侧先找到技能，右侧再看运行态差异、cron 引用和目录定位。')}
        </div>
        <div class="workspace-rail-toolbar">
          <input class="search-input" id="skills-query" placeholder="搜索名称、分类、描述、路径">
          <select class="select-input" id="skills-category-filter">
            ${categories.map((item) => `
              <option value="${escapeHtml(item)}" ${item === view.categoryFilter ? 'selected' : ''}>
                ${escapeHtml(item === 'all' ? '全部分类' : item)}
              </option>
            `).join('')}
          </select>
        </div>
        ${renderSkillList(view, filtered, skill)}
      </section>

      <div class="workspace-main">
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <div class="panel-title-row">
                <h2 class="config-section-title">${escapeHtml(skill?.name || '技能详情')}</h2>
                ${skill ? pillHtml(skill.category || 'uncategorized', 'neutral') : ''}
                ${skill ? pillHtml(selectedExistsInRuntime ? 'runtime ok' : 'runtime drift', selectedExistsInRuntime ? 'good' : 'warn') : ''}
              </div>
              <p class="workspace-main-copy">${escapeHtml(skill?.description || '从左侧选择一个技能后，这里会展示文件详情、运行态差异和自动化引用。')}</p>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'goto-logs', label: '查看日志', disabled: !skill })}
              ${buttonHtml({ action: 'goto-cron', label: '查看 Cron' })}
              ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
            </div>
          </div>
          ${
            skill
              ? `
                ${keyValueRowsHtml([
                  { label: '名称', value: skill.name },
                  { label: '分类', value: skill.category || 'uncategorized' },
                  { label: '相对路径', value: skill.relativePath },
                  { label: '文件路径', value: skill.filePath },
                  { label: '运行态可见', value: selectedExistsInRuntime ? 'true' : 'false' },
                  { label: '被 Cron 引用', value: String(jobs.length) },
                ])}
                <pre class="code-block compact-code skill-detail-preview top-gap">${escapeHtml(skill.preview || '无预览内容')}</pre>
              `
              : emptyStateHtml('未选择技能', '从左侧选择一个技能查看详情。')
          }
        </section>

        <div class="workspace-bottom-grid">
          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <h2 class="config-section-title">自动化引用</h2>
                <p class="config-section-desc">被 cron 显式引用的技能更接近真实生产链路。</p>
              </div>
              ${pillHtml(skill ? `${jobs.length} 个作业` : '等待选择', skill && jobs.length > 0 ? 'good' : 'warn')}
            </div>
            ${skill ? renderCronJobs(jobs) : emptyStateHtml('未选择技能', '先从左侧选择一个技能。')}
          </section>

          <section class="workspace-main-card">
            <div class="workspace-main-header">
              <div>
                <h2 class="config-section-title">最近动作与原始输出</h2>
                <p class="config-section-desc">保留最近一次命令回显，同时可直接对照 Hermes 的 skills 原始快照。</p>
              </div>
              ${pillHtml(view.lastResult ? '最近动作' : 'CLI 快照', view.lastResult ? 'good' : 'neutral')}
            </div>
            ${commandResultHtml(view.lastResult, '尚未执行命令', '执行技能搜索、安装或治理动作后，这里会保留最近一次结果。')}
            <pre class="code-block compact-code top-gap">${escapeHtml(view.extensions.skillsRawOutput || '当前没有可展示的 skills 原始输出。')}</pre>
          </section>
        </div>
      </div>
    </div>

    ${
      warnings.length > 0
        ? `
          <section class="config-section">
            <div class="config-section-header">
              <div>
                <h2 class="config-section-title">当前提醒</h2>
                <p class="config-section-desc">只保留会影响技能闭环的关键信号，不再把说明文案铺满页面。</p>
              </div>
            </div>
            <div class="warning-stack">
              ${warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
            </div>
          </section>
        `
        : ''
    }
  `;

  bindEvents(view, { diagnosticsIntent, logsIntent, skill });

  const queryInput = view.page.querySelector('#skills-query');
  const categorySelect = view.page.querySelector('#skills-category-filter');
  const registryInput = view.page.querySelector('#skills-registry-query');
  const installInput = view.page.querySelector('#skills-install-target');

  if (queryInput) {
    queryInput.value = view.query;
  }
  if (categorySelect) {
    categorySelect.value = view.categoryFilter;
  }
  if (registryInput) {
    registryInput.value = view.registryQuery;
  }
  if (installInput) {
    installInput.value = view.installTarget;
  }
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.dashboard && view.installation && view.extensions && view.cron);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [skills, dashboard, installation, extensions, cron] = await Promise.all([
      api.listSkills(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getExtensionsSnapshot(profile),
      api.getCronJobs(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.skills = skills;
    view.dashboard = dashboard;
    view.installation = installation;
    view.extensions = extensions;
    view.cron = cron;
    view.selectedPath = skills.some((item) => item.filePath === view.selectedPath)
      ? view.selectedPath
      : skills[0]?.filePath ?? null;
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

async function openInTerminal(view, actionKey, label, command) {
  view.runningAction = actionKey;
  renderPage(view);
  try {
    await handoffToTerminal({
      actionKey,
      command,
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
      workingDirectory: view.installation?.hermesHomeExists ? view.installation.hermesHome : null,
    });
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
  const nextProfile = getPanelState().selectedProfile;
  if (nextProfile !== view.profile) {
    view.profile = nextProfile;
    view.dashboard = null;
    view.installation = null;
    view.extensions = null;
    view.cron = null;
    view.skills = [];
    view.error = null;
    view.lastResult = null;
    void loadData(view);
    return;
  }

  renderPage(view);
}

function bindEvents(view, intents = {}) {
  const queryInput = view.page.querySelector('#skills-query');
  const categorySelect = view.page.querySelector('#skills-category-filter');
  const registryInput = view.page.querySelector('#skills-registry-query');
  const installInput = view.page.querySelector('#skills-install-target');

  if (queryInput) {
    queryInput.oninput = (event) => {
      view.query = event.target.value;
      renderPage(view);
    };
  }

  if (categorySelect) {
    categorySelect.onchange = (event) => {
      view.categoryFilter = event.target.value;
      renderPage(view);
    };
  }

  if (registryInput) {
    registryInput.oninput = (event) => {
      view.registryQuery = event.target.value;
      renderPage(view);
    };
    registryInput.onkeydown = (event) => {
      if (event.key === 'Enter' && view.registryQuery.trim()) {
        event.preventDefault();
        void openInTerminal(view, 'skills:search', '搜索技能', `hermes skills search ${view.registryQuery.trim()}`);
      }
    };
  }

  if (installInput) {
    installInput.oninput = (event) => {
      view.installTarget = event.target.value;
      renderPage(view);
    };
    installInput.onkeydown = (event) => {
      if (event.key === 'Enter' && view.installTarget.trim()) {
        event.preventDefault();
        void openInTerminal(view, 'skills:inspect', '预检技能', `hermes skills inspect ${view.installTarget.trim()}`);
      }
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
        case 'select-skill':
          view.selectedPath = element.getAttribute('data-path');
          renderPage(view);
          return;
        case 'skills-browse':
          await openInTerminal(view, 'skills:browse', '技能浏览器', 'hermes skills browse');
          return;
        case 'skills-config':
          await openInTerminal(view, 'skills:config', '技能开关', view.installation.skillsConfigCommand);
          return;
        case 'skills-check':
          await openInTerminal(view, 'skills:check', '检查技能更新', 'hermes skills check');
          return;
        case 'skills-update':
          await openInTerminal(view, 'skills:update', '更新已装技能', 'hermes skills update');
          return;
        case 'skills-search':
          await openInTerminal(view, 'skills:search', '搜索技能', `hermes skills search ${view.registryQuery.trim()}`);
          return;
        case 'skills-inspect':
          await openInTerminal(view, 'skills:inspect', '预检技能', `hermes skills inspect ${view.installTarget.trim()}`);
          return;
        case 'skills-install':
          await openInTerminal(view, 'skills:install', '安装技能', `hermes skills install ${view.installTarget.trim()}`);
          return;
        case 'skills-audit':
          await openInTerminal(view, 'skills:audit', '审计已安装技能', 'hermes skills audit');
          return;
        case 'open-skill-file':
          if (intents.skill) {
            await openInFinder(view, intents.skill.filePath, `${intents.skill.name} 技能文件`, true);
          }
          return;
        case 'open-skill-dir':
          if (intents.skill) {
            await openInFinder(view, directoryOf(intents.skill.filePath), `${intents.skill.name} 技能目录`);
          }
          return;
        case 'open-home':
          await openInFinder(view, view.dashboard.hermesHome, 'Hermes Home');
          return;
        case 'goto-logs':
          navigate('logs', intents.logsIntent);
          return;
        case 'goto-cron':
          navigate('cron');
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', intents.diagnosticsIntent);
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
    categoryFilter: 'all',
    cron: null,
    dashboard: null,
    destroyed: false,
    error: null,
    extensions: null,
    installation: null,
    lastResult: null,
    loading: true,
    page,
    profile: getPanelState().selectedProfile,
    query: '',
    refreshing: false,
    registryQuery: '',
    runningAction: null,
    selectedPath: null,
    skills: [],
    installTarget: '',
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
