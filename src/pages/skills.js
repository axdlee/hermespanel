import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
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

const EMPTY_SKILL_DRAFT = {
  category: 'custom',
  content: '',
  description: '',
  name: '',
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

function cloneSkillDraft(draft = EMPTY_SKILL_DRAFT) {
  return {
    category: draft.category || 'custom',
    content: draft.content || '',
    description: draft.description || '',
    name: draft.name || '',
  };
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
        const runtimeVisible = (view.extensions?.runtimeSkills ?? []).some((runtimeItem) => runtimeItem.name === item.name);
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
                ${runtimeVisible ? pillHtml('runtime ok', 'good') : pillHtml('local only', 'warn')}
              </div>
            </div>
            <p class="skill-list-copy">${escapeHtml(truncate(item.description || firstLine(item.preview, 'CLI 未返回描述。'), 92))}</p>
            <div class="meta-line">
              <span>${escapeHtml(item.relativePath)}</span>
              <span>${escapeHtml(runtimeVisible ? '已进入运行面' : '仅目录可见')}</span>
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

function renderSkillWorkbenchTabs(view) {
  const tabs = [
    { key: 'overview', label: '详情' },
    { key: 'registry', label: '安装治理' },
    { key: 'studio', label: '本地编修' },
  ];

  return `
    <div class="tab-bar">
      ${tabs.map((tab) => `
        <button
          type="button"
          class="tab ${view.workspaceTab === tab.key ? 'active' : ''}"
          data-action="switch-workspace-tab"
          data-tab="${escapeHtml(tab.key)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderSkillOutputCard(view) {
  return `
    <section class="workspace-main-card">
      <div class="workspace-main-header">
        <div>
          <h2 class="config-section-title">最近动作与原始输出</h2>
          <p class="config-section-desc">执行 search / inspect / install / audit 后，原始输出会留在这里。</p>
        </div>
        ${pillHtml(view.lastResult ? '最近动作' : 'CLI 快照', view.lastResult ? 'good' : 'neutral')}
      </div>
      ${commandResultHtml(view.lastResult, '尚未执行动作', '先在安装治理页执行一次动作，这里会保留最近结果。')}
      <pre class="code-block compact-code top-gap">${escapeHtml(view.extensions.skillsRawOutput || '当前没有可展示的 skills 原始输出。')}</pre>
    </section>
  `;
}

function renderSkillOverviewWorkspace(view, skill, jobs, selectedExistsInRuntime, warnings) {
  return `
    <section class="workspace-main-card">
      <div class="workspace-main-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">${escapeHtml(skill?.name || '技能详情')}</h2>
            ${skill ? pillHtml(skill.category || 'uncategorized', 'neutral') : ''}
            ${skill ? pillHtml(selectedExistsInRuntime ? 'runtime ok' : 'runtime drift', selectedExistsInRuntime ? 'good' : 'warn') : ''}
          </div>
          <p class="workspace-main-copy">${escapeHtml(skill?.description || '从左侧选择技能后，这里会展示目录态、运行态和自动化引用。')}</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'use-selected-skill-name', label: '带入治理', kind: 'primary', disabled: !skill })}
          ${buttonHtml({ action: 'goto-logs', label: '日志', disabled: !skill })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展面' })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '诊断' })}
        </div>
      </div>
      ${
        skill
          ? `
            ${keyValueRowsHtml([
              { label: '名称', value: skill.name },
              { label: '分类', value: skill.category || 'uncategorized' },
              { label: '相对路径', value: skill.relativePath },
              { label: '运行态可见', value: selectedExistsInRuntime ? 'true' : 'false' },
              { label: 'Cron 引用', value: String(jobs.length) },
              { label: '文件路径', value: skill.filePath },
            ])}
            <pre class="code-block compact-code skill-detail-preview top-gap">${escapeHtml(skill.preview || '无预览内容')}</pre>
          `
          : emptyStateHtml('未选择技能', '先从左侧选择一个技能。')
      }
    </section>

    <div class="workspace-bottom-grid">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <h2 class="config-section-title">自动化引用</h2>
            <p class="config-section-desc">优先核对真正被 cron 显式引用的技能。</p>
          </div>
          ${pillHtml(skill ? `${jobs.length} 个作业` : '等待选择', skill && jobs.length > 0 ? 'good' : 'warn')}
        </div>
        ${skill ? renderCronJobs(jobs) : emptyStateHtml('未选择技能', '先从左侧选择一个技能。')}
      </section>

      ${renderSkillOutputCard(view)}
    </div>

    ${warnings.length > 0
      ? `
        <section class="workspace-main-card">
          <div class="workspace-main-header">
            <div>
              <h2 class="config-section-title">关键提醒</h2>
              <p class="config-section-desc">只保留会影响技能闭环的信号，不抢主操作位。</p>
            </div>
            ${pillHtml(`${warnings.length} 条`, 'warn')}
          </div>
          <div class="warning-stack">
            ${warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
          </div>
        </section>
      `
      : ''}
  `;
}

function renderSkillRegistryWorkspace(view, skill, jobs, selectedExistsInRuntime, currentToolsets, runtimeLocal, usedNames) {
  return `
    <div class="compact-overview-grid">
      <section class="shell-card">
        <div class="shell-card-header">
          <div>
            <div class="panel-title-row">
              <strong>搜索 / 预检 / 安装</strong>
              ${infoTipHtml('调用的是 Tauri 后端封装的 Hermes skills 动作，不把你甩去外部 Terminal。')}
            </div>
            <p class="shell-card-copy">先搜关键词，再对目标 skill 做 inspect / install。</p>
          </div>
          ${pillHtml(view.installTarget.trim() || '等待目标', view.installTarget.trim() ? 'good' : 'warn')}
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>搜索关键词</span>
            <input class="search-input" id="skills-registry-query" placeholder="react / security / browser">
          </label>
          <label class="field-stack">
            <span>技能 ID</span>
            <input class="search-input" id="skills-install-target" placeholder="official/security/1password">
          </label>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'skills-search', label: view.runningAction === 'skills:search' ? '搜索中…' : '搜索技能', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.registryQuery.trim() })}
          ${buttonHtml({ action: 'skills-inspect', label: view.runningAction === 'skills:inspect' ? '预检中…' : '预检技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.installTarget.trim() })}
          ${buttonHtml({ action: 'skills-install', label: view.runningAction === 'skills:install' ? '安装中…' : '安装技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound || !view.installTarget.trim() })}
          ${buttonHtml({ action: 'use-selected-skill-name', label: '使用当前技能', disabled: Boolean(view.runningAction) || !skill })}
        </div>
      </section>

      <section class="shell-card">
        <div class="shell-card-header">
          <div>
            <strong>治理与布线</strong>
            <p class="shell-card-copy">更新、审计和布线核查集中在一处，避免在多个页面重复露出。</p>
          </div>
          ${pillHtml(view.installation.binaryFound ? 'CLI 就绪' : 'CLI 缺失', view.installation.binaryFound ? 'good' : 'bad')}
        </div>
        ${keyValueRowsHtml([
          { label: 'Toolsets', value: currentToolsets.length ? currentToolsets.join(', ') : '—' },
          { label: '运行态 Local', value: String(runtimeLocal) },
          { label: '已编排技能', value: String(usedNames.size) },
          { label: '当前技能可见', value: skill ? (selectedExistsInRuntime ? 'true' : 'false') : '—' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'skills-check', label: view.runningAction === 'skills:check' ? '检查中…' : '检查更新', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          ${buttonHtml({ action: 'skills-update', label: view.runningAction === 'skills:update' ? '更新中…' : '更新技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          ${buttonHtml({ action: 'skills-audit', label: view.runningAction === 'skills:audit' ? '审计中…' : '审计已装技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          ${buttonHtml({ action: 'goto-config-toolsets', label: '核对 Toolsets' })}
          ${buttonHtml({ action: 'goto-config-memory', label: '核对 Memory' })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展运行态' })}
        </div>
      </section>
    </div>

    <div class="workspace-bottom-grid top-gap">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <h2 class="config-section-title">当前目标布线</h2>
            <p class="config-section-desc">把目录技能、runtime 可见性和自动化引用放在一起核对。</p>
          </div>
          ${skill ? pillHtml(skill.name, 'neutral') : pillHtml('等待选择', 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: '当前技能', value: skill?.name || '—' },
          { label: '分类', value: skill?.category || '—' },
          { label: 'runtime', value: skill ? (selectedExistsInRuntime ? 'ok' : 'drift') : '—' },
          { label: 'Cron 显式引用', value: skill ? String(jobs.length) : '0' },
          { label: '目录路径', value: skill?.relativePath || '—' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-cron', label: '查看 Cron' })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志', disabled: !skill })}
          ${buttonHtml({ action: 'goto-diagnostics', label: '进入诊断页' })}
        </div>
      </section>

      ${renderSkillOutputCard(view)}
    </div>
  `;
}

function renderSkillStudio(view, skill) {
  const skillDirty = Boolean(skill && view.skillFile && view.skillFile.content !== view.skillFileSavedContent);
  const draft = view.createDraft ?? cloneSkillDraft();

  return `
    <div class="compact-overview-grid">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <h2 class="config-section-title">新建本地 Skill</h2>
              ${infoTipHtml('本地 skill 直接写入当前 Hermes skills 目录，适合团队私有能力和快速原型。')}
            </div>
            <p class="workspace-main-copy">保持最小表单，只保留真正创建 skill 所需的信息。</p>
          </div>
          ${pillHtml(draft.category || 'custom', 'neutral')}
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>名称</span>
            <input class="search-input" id="skill-create-name" value="${escapeHtml(draft.name)}" placeholder="Release Notes">
          </label>
          <label class="field-stack">
            <span>分类</span>
            <input class="search-input" id="skill-create-category" value="${escapeHtml(draft.category)}" placeholder="ops / coding / custom">
          </label>
        </div>
        <label class="field-stack">
          <span>描述</span>
          <input class="search-input" id="skill-create-description" value="${escapeHtml(draft.description)}" placeholder="生成版本发布说明并整理亮点">
        </label>
        <label class="field-stack top-gap">
          <span>内容模板</span>
          <textarea class="editor compact-control-editor" id="skill-create-content" placeholder="# Release Notes&#10;&#10;## 目标&#10;&#10;在这里编写 skill 具体内容。">${escapeHtml(draft.content)}</textarea>
        </label>
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'create-local-skill', label: view.runningAction === 'skills:create-local' ? '创建中…' : '创建本地 Skill', kind: 'primary', disabled: Boolean(view.runningAction) || !draft.name.trim(), attrs: { id: 'skill-create-submit' } })}
          ${buttonHtml({ action: 'reset-local-skill-draft', label: '清空草稿', disabled: Boolean(view.runningAction) })}
          ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) })}
        </div>
      </section>

      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <h2 class="config-section-title">当前 Skill 文件</h2>
              ${skill ? `${pillHtml(skill.category || 'uncategorized', 'neutral')}` : ''}
            </div>
            <p class="workspace-main-copy">${escapeHtml(skill ? '直接编辑本地 SKILL.md，不再强制跳回 CLI。' : '先从左侧选择一个技能，再进入本地编修。')}</p>
          </div>
          ${skill ? `<span id="skill-file-dirty-pill">${pillHtml(skillDirty ? '未保存' : '已同步', skillDirty ? 'warn' : 'good')}</span>` : pillHtml('等待选择', 'neutral')}
        </div>
        ${
          skill
            ? `
              <p class="command-line">${escapeHtml(view.skillFile?.filePath || skill.filePath)}</p>
              <label class="field-stack">
                <span>SKILL.md</span>
                <textarea class="editor compact-skill-editor" id="skill-content-editor" placeholder="正在读取技能文件…">${escapeHtml(view.skillFile?.content || '')}</textarea>
              </label>
              <div class="toolbar top-gap">
                ${buttonHtml({ action: 'save-skill-file', label: view.runningAction === 'skills:save-file' ? '保存中…' : '保存 Skill', kind: 'primary', disabled: Boolean(view.runningAction) || !view.skillFile })}
                ${buttonHtml({ action: 'reload-skill-file', label: view.runningAction === 'skills:reload-file' ? '刷新中…' : '重新读取', disabled: Boolean(view.runningAction) || !skill })}
                ${buttonHtml({ action: 'open-skill-file', label: '定位文件', disabled: Boolean(view.runningAction) || !skill })}
                ${buttonHtml({ action: 'open-skill-dir', label: '打开目录', disabled: Boolean(view.runningAction) || !skill })}
              </div>
            `
            : emptyStateHtml('未选择技能', '从左侧选择一个技能后，这里会直接加载并允许编辑对应的 SKILL.md。')
        }
      </section>
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
        <p class="page-desc">围绕 skills 的目录、安装和运行态做统一治理。</p>
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
  const quickCategories = categories.filter((item) => item !== 'all').slice(0, 6);
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
  const configToolsetsIntent = buildConfigDrilldownIntent(seed, {
    description: '继续在配置中心核对 toolsets、外部 skills 目录和技能暴露范围。',
    focus: 'toolsets',
  });
  const configMemoryIntent = buildConfigDrilldownIntent(seed, {
    description: '继续在配置中心核对记忆开关、provider 与长期记忆链路。',
    focus: 'memory',
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(seed, {
    description: skill
      ? `继续核对技能 ${skill.name} 关联的 runtime source、插件和扩展状态。`
      : '继续核对技能层关联的 runtime source、插件和扩展状态。',
    rawKind: 'skills',
    query: skill?.name ?? view.query,
    sourceFilter: view.extensions.runtimeSkills.some((item) => item.source === 'local') ? 'local' : 'all',
  });
  const workspaceMain = view.workspaceTab === 'registry'
    ? renderSkillRegistryWorkspace(view, skill, jobs, selectedExistsInRuntime, currentToolsets, runtimeLocal, usedNames)
    : view.workspaceTab === 'studio'
      ? renderSkillStudio(view, skill)
      : renderSkillOverviewWorkspace(view, skill, jobs, selectedExistsInRuntime, warnings);

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">技能工作台</h1>
        ${infoTipHtml('这里不再堆大段说明。核心只保留技能目录、安装动作、运行态差异和自动化引用，跨页入口尽量收敛到少量真正有用的跳转。')}
      </div>
      <p class="page-desc">目录、安装治理和本地编修在这里合流。</p>
    </div>

    <section class="workspace-summary-strip">
      <section class="summary-mini-card">
        <span class="summary-mini-label">目录技能</span>
        <strong class="summary-mini-value">${escapeHtml(String(view.skills.length))}</strong>
        <span class="summary-mini-meta">当前 profile 扫描到的本地技能</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">运行态 Local</span>
        <strong class="summary-mini-value">${escapeHtml(String(runtimeLocal))}</strong>
        <span class="summary-mini-meta">${runtimeSkillMismatch(view) ? 'CLI 与目录存在偏差' : 'CLI 与目录已对齐'}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">当前目标</span>
        <strong class="summary-mini-value">${escapeHtml(view.installTarget.trim() || skill?.name || '未指定')}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.registryQuery.trim() || '优先在这里搜索、预检、安装技能')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">最近动作</span>
        <strong class="summary-mini-value">${escapeHtml(view.lastResult?.label || '待执行')}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.lastResult?.result?.success ? '最近一次命令成功' : view.lastResult ? '最近一次命令失败' : '执行 search / install / audit 后会显示')}</span>
      </section>
    </section>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">Skills Workbench</h2>
            ${infoTipHtml('左侧只保留筛选、技能列表和少量关键动作；右侧通过页内标签切换详情、安装治理和本地编修。')}
          </div>
          <p class="config-section-desc">尽量像 clawpanel 那样让一个主工作台承接闭环，而不是把说明和重复按钮铺满页面。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workspaceTab === 'overview' ? '详情' : view.workspaceTab === 'registry' ? '安装治理' : '本地编修', 'neutral')}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', kind: 'primary', disabled: view.refreshing || Boolean(view.runningAction) })}
        </div>
      </div>
      ${renderSkillWorkbenchTabs(view)}
      <div class="workspace-shell workspace-shell-editor">
        <section class="workspace-rail">
          <div class="workspace-rail-header">
            <div>
              <h2 class="config-section-title">技能目录</h2>
              <p class="config-section-desc">优先定位当前 profile 真正在用，或者最值得治理的技能。</p>
            </div>
            ${skill ? pillHtml(skill.name, 'neutral') : pillHtml('等待选择', 'warn')}
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
          ${quickCategories.length > 0 ? `
            <div class="selection-chip-grid top-gap">
              ${buttonHtml({ action: 'filter-category', label: '全部分类', className: `selection-chip${view.categoryFilter === 'all' ? ' selection-chip-active' : ''}`, attrs: { 'data-value': 'all' } })}
              ${quickCategories.map((item) => buttonHtml({
                action: 'filter-category',
                label: item,
                className: `selection-chip${view.categoryFilter === item ? ' selection-chip-active' : ''}`,
                attrs: { 'data-value': item },
              })).join('')}
            </div>
          ` : ''}
          <section class="workspace-rail-section">
            <div class="workspace-rail-section-header">
              <span class="workspace-rail-section-title">当前目标</span>
              ${pillHtml(skill ? (selectedExistsInRuntime ? 'runtime ok' : 'runtime drift') : '等待选择', skill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral')}
            </div>
            ${keyValueRowsHtml([
              { label: '当前技能', value: skill?.name || '—' },
              { label: '分类', value: skill?.category || '—' },
              { label: 'Cron', value: skill ? String(jobs.length) : '0' },
              { label: 'runtime', value: skill ? (selectedExistsInRuntime ? 'ok' : 'drift') : '—' },
            ])}
            <div class="workspace-rail-toolbar workspace-rail-toolbar-grid top-gap">
              ${buttonHtml({ action: 'use-selected-skill-name', label: '带入治理', kind: 'primary', disabled: Boolean(view.runningAction) || !skill })}
              ${buttonHtml({ action: 'open-skill-dir', label: '打开目录', disabled: Boolean(view.runningAction) || !skill })}
              ${buttonHtml({ action: 'goto-extensions', label: '扩展面' })}
              ${buttonHtml({ action: 'goto-config-toolsets', label: 'Toolsets' })}
            </div>
          </section>
          ${warnings.length > 0 && view.workspaceTab !== 'overview' ? `
            <div class="warning-stack top-gap">
              ${warnings.slice(0, 3).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
            </div>
          ` : ''}
          ${renderSkillList(view, filtered, skill)}
        </section>

        <div class="workspace-main">
          ${workspaceMain}
        </div>
      </div>
    </section>
  `;

  bindEvents(view, {
    configMemoryIntent,
    configToolsetsIntent,
    diagnosticsIntent,
    extensionsIntent,
    logsIntent,
    skill,
  });

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

    if (view.selectedPath) {
      await loadSkillFile(view, view.selectedPath, { silent: true });
    } else {
      view.skillFile = null;
      view.skillFileSavedContent = '';
    }
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

async function loadSkillFile(view, filePath, options = {}) {
  const { silent = false } = options;
  if (!filePath) {
    view.skillFile = null;
    view.skillFileSavedContent = '';
    renderPage(view);
    return;
  }

  view.skillFileLoading = true;
  if (!silent) {
    renderPage(view);
  }
  try {
    const detail = await api.readSkillFile(filePath, view.profile);
    if (view.destroyed) {
      return;
    }
    if (filePath !== view.selectedPath) {
      return;
    }
    view.skillFile = detail;
    view.skillFileSavedContent = detail.content;
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
  } finally {
    view.skillFileLoading = false;
    renderPage(view);
  }
}

function storeResult(view, label, result) {
  view.lastResult = {
    label,
    result,
  };
}

async function executeSkillAction(view, action, value, options = {}) {
  const actionId = options.actionId ?? `skills:${action}`;
  const label = options.label ?? `skills ${action}`;

  view.runningAction = actionId;
  renderPage(view);
  try {
    const result = await api.runSkillAction(action, value || null, view.profile);
    storeResult(view, label, result);
    notify(
      result.success ? 'success' : 'error',
      result.success
        ? `${label} 已在客户端执行。`
        : `${label} 执行失败，请查看命令输出。`,
    );
    if (options.refresh) {
      await Promise.all([
        loadShell(view.profile, { silent: true }),
        loadData(view, { silent: true }),
      ]);
    }
  } catch (reason) {
    notify('error', String(reason));
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

async function saveSkillFile(view) {
  if (!view.skillFile) {
    notify('error', '请先选择要保存的技能文件。');
    return;
  }

  view.runningAction = 'skills:save-file';
  renderPage(view);
  try {
    const detail = await api.saveSkillFile({
      content: view.skillFile.content,
      filePath: view.skillFile.filePath,
    }, view.profile);
    view.skillFile = detail;
    view.skillFileSavedContent = detail.content;
    notify('success', `${detail.name} 已保存。`);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function createLocalSkill(view) {
  const draft = view.createDraft ?? cloneSkillDraft();
  if (!draft.name.trim()) {
    notify('error', '请先填写技能名称。');
    return;
  }

  view.runningAction = 'skills:create-local';
  renderPage(view);
  try {
    const detail = await api.createSkill({
      category: draft.category.trim() || 'custom',
      content: draft.content,
      description: draft.description.trim(),
      name: draft.name.trim(),
      overwrite: false,
    }, view.profile);
    notify('success', `${detail.name} 已创建到本地 skills 目录。`);
    view.createDraft = cloneSkillDraft();
    view.selectedPath = detail.filePath;
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
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
    view.skillFile = null;
    view.skillFileSavedContent = '';
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
        void executeSkillAction(view, 'search', view.registryQuery.trim(), {
          actionId: 'skills:search',
          label: `搜索技能 · ${view.registryQuery.trim()}`,
        });
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
        void executeSkillAction(view, 'inspect', view.installTarget.trim(), {
          actionId: 'skills:inspect',
          label: `预检技能 · ${view.installTarget.trim()}`,
        });
      }
    };
  }

  view.page.querySelector('#skill-create-name')?.addEventListener('input', (event) => {
    view.createDraft.name = event.target.value;
    const submit = view.page.querySelector('#skill-create-submit');
    if (submit) {
      submit.disabled = Boolean(view.runningAction) || !view.createDraft.name.trim();
    }
  });
  view.page.querySelector('#skill-create-category')?.addEventListener('input', (event) => {
    view.createDraft.category = event.target.value;
  });
  view.page.querySelector('#skill-create-description')?.addEventListener('input', (event) => {
    view.createDraft.description = event.target.value;
  });
  view.page.querySelector('#skill-create-content')?.addEventListener('input', (event) => {
    view.createDraft.content = event.target.value;
  });
  view.page.querySelector('#skill-content-editor')?.addEventListener('input', (event) => {
    if (view.skillFile) {
      view.skillFile.content = event.target.value;
      const dirtyPill = view.page.querySelector('#skill-file-dirty-pill');
      if (dirtyPill) {
        dirtyPill.innerHTML = pillHtml(view.skillFile.content !== view.skillFileSavedContent ? '未保存' : '已同步', view.skillFile.content !== view.skillFileSavedContent ? 'warn' : 'good');
      }
    }
  });

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
        case 'switch-workspace-tab':
          view.workspaceTab = element.getAttribute('data-tab') || 'overview';
          renderPage(view);
          return;
        case 'select-skill':
          view.selectedPath = element.getAttribute('data-path');
          await loadSkillFile(view, view.selectedPath);
          return;
        case 'filter-category':
          view.categoryFilter = element.getAttribute('data-value') || 'all';
          renderPage(view);
          return;
        case 'create-local-skill':
          await createLocalSkill(view);
          return;
        case 'reset-local-skill-draft':
          view.createDraft = cloneSkillDraft();
          renderPage(view);
          return;
        case 'save-skill-file':
          await saveSkillFile(view);
          return;
        case 'reload-skill-file':
          await loadSkillFile(view, view.selectedPath);
          return;
        case 'skills-check':
          await executeSkillAction(view, 'check', null, {
            actionId: 'skills:check',
            label: '检查技能更新',
          });
          return;
        case 'skills-update':
          await executeSkillAction(view, 'update', null, {
            actionId: 'skills:update',
            label: '更新已装技能',
            refresh: true,
          });
          return;
        case 'skills-search':
          await executeSkillAction(view, 'search', view.registryQuery.trim(), {
            actionId: 'skills:search',
            label: `搜索技能 · ${view.registryQuery.trim()}`,
          });
          return;
        case 'skills-inspect':
          await executeSkillAction(view, 'inspect', view.installTarget.trim(), {
            actionId: 'skills:inspect',
            label: `预检技能 · ${view.installTarget.trim()}`,
          });
          return;
        case 'skills-install':
          await executeSkillAction(view, 'install', view.installTarget.trim(), {
            actionId: 'skills:install',
            label: `安装技能 · ${view.installTarget.trim()}`,
            refresh: true,
          });
          return;
        case 'skills-audit':
          await executeSkillAction(view, 'audit', null, {
            actionId: 'skills:audit',
            label: '审计已装技能',
          });
          return;
        case 'use-selected-skill-name':
          if (intents.skill) {
            view.registryQuery = intents.skill.name;
            view.installTarget = intents.skill.name;
            renderPage(view);
          }
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
        case 'goto-config-toolsets':
          navigate('config', intents.configToolsetsIntent);
          return;
        case 'goto-config-memory':
          navigate('config', intents.configMemoryIntent);
          return;
        case 'goto-extensions':
          navigate('extensions', intents.extensionsIntent);
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
    createDraft: cloneSkillDraft(),
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
    skillFile: null,
    skillFileLoading: false,
    skillFileSavedContent: '',
    skills: [],
    installTarget: '',
    unsubscribe: null,
    workspaceTab: 'overview',
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
