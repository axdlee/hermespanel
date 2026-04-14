import { formatTimestamp, truncate } from '../lib/format';
import {
  buttonHtml,
  commandResultHtml,
  emptyStateHtml,
  escapeHtml,
  firstLine,
  keyValueRowsHtml,
  pillHtml,
} from './native-helpers';
import { infoTipHtml } from './workbench-helpers';

const EMPTY_SKILL_DRAFT = {
  category: 'custom',
  content: '',
  description: '',
  name: '',
};

const EMPTY_SKILL_IMPORT_DRAFT = {
  category: '',
  overwrite: false,
  sourcePath: '',
};

function categoryLabel(value) {
  return value || '未分类';
}

function runtimeVisibilityMeta(visible) {
  return visible ? '已进入运行面' : '仅目录可见';
}

function runtimeVisibilityPill(visible) {
  return visible ? pillHtml('运行面可见', 'good') : pillHtml('待进入运行面', 'warn');
}

function runtimeStateText(visible) {
  return visible ? '已进入' : '待同步';
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

export function cloneSkillDraft(draft = EMPTY_SKILL_DRAFT) {
  return {
    category: draft.category || 'custom',
    content: draft.content || '',
    description: draft.description || '',
    name: draft.name || '',
  };
}

export function cloneSkillImportDraft(draft = EMPTY_SKILL_IMPORT_DRAFT) {
  return {
    category: draft.category || '',
    overwrite: Boolean(draft.overwrite),
    sourcePath: draft.sourcePath || '',
  };
}

function capabilityWarnings(view, skill, jobs) {
  const warnings = [];
  const dashboard = view.dashboard;
  const extensions = view.extensions;
  const usedNames = skillUsageNames(view);
  const currentToolsets = dashboard?.config.toolsets ?? [];

  if (!view.skills.length) {
    warnings.push('当前实例没有扫描到任何技能文件，能力面会退化到纯工具调用。');
  }
  if (!currentToolsets.length) {
    warnings.push('当前没有配置任何工具集，目录里的技能未必真正暴露给模型。');
  }
  if (dashboard?.config.memoryEnabled === false) {
    warnings.push('记忆当前关闭，技能与长期记忆的闭环会明显变弱。');
  }
  if (dashboard?.gateway?.gatewayState !== 'running' && (view.cron?.jobs ?? []).some((job) => job.deliver !== 'local' && job.deliver !== 'origin')) {
    warnings.push('存在远端投递作业，但网关未运行，消息平台侧链路还没闭环。');
  }
  if (skill && jobs.length === 0 && (view.cron?.jobs.length ?? 0) > 0) {
    warnings.push(`当前选中的技能 ${skill.name} 还没有被任何 cron 作业显式引用。`);
  }
  if (extensions && runtimeSkillMismatch(view)) {
    warnings.push(`运行态本地技能为 ${runtimeLocalSkillCount(view)} 个，本地目录扫描为 ${view.skills.length} 个。`);
  }
  if (!usedNames.size && (view.cron?.jobs.length ?? 0) > 0) {
    warnings.push('当前 cron 作业存在，但没有显式绑定任何技能，建议回 cron 页复核编排。');
  }

  return warnings;
}

export function relaySeed(view, skill) {
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
                ${pillHtml(categoryLabel(item.category), 'neutral')}
                ${referenced ? pillHtml('Cron 中', 'good') : pillHtml('未编排', 'neutral')}
                ${runtimeVisibilityPill(runtimeVisible)}
              </div>
            </div>
            <p class="skill-list-copy">${escapeHtml(truncate(item.description || firstLine(item.preview, '底层未返回描述。'), 92))}</p>
            <div class="meta-line">
              <span>${escapeHtml(item.relativePath)}</span>
              <span>${escapeHtml(runtimeVisibilityMeta(runtimeVisible))}</span>
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
    { key: 'overview', label: '概览' },
    { key: 'studio', label: '本地治理' },
    { key: 'registry', label: '安装治理' },
  ];

  return `
    <div class="tab-bar tab-bar-dense">
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
          <h2 class="config-section-title">最近回执与原始输出</h2>
          <p class="config-section-desc">执行搜索、预检、安装或审计后，回执会保留在这里。</p>
        </div>
        ${pillHtml(view.lastResult ? '最近回执' : '底层快照', view.lastResult ? 'good' : 'neutral')}
      </div>
      ${commandResultHtml(view.lastResult, '尚未执行动作', '先在安装治理页执行一次动作，这里会保留最近结果。')}
      <pre class="code-block compact-code top-gap">${escapeHtml(view.extensions.skillsRawOutput || '当前没有可展示的技能原始输出。')}</pre>
    </section>
  `;
}

function renderSkillOverviewWorkspace(view, state) {
  const { jobs, selectedExistsInRuntime, skill, warnings } = state;

  return `
    <section class="workspace-main-card">
      <div class="workspace-main-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">${escapeHtml(skill?.name || '技能详情')}</h2>
            ${skill ? pillHtml(categoryLabel(skill.category), 'neutral') : ''}
            ${skill ? pillHtml(selectedExistsInRuntime ? '运行面已接入' : '运行面待同步', selectedExistsInRuntime ? 'good' : 'warn') : ''}
          </div>
          <p class="workspace-main-copy">${escapeHtml(skill?.description || '从左侧选择技能后，这里会展示目录态、运行态和自动化引用。')}</p>
        </div>
        <div class="toolbar">
          ${buttonHtml({ action: 'use-selected-skill-name', label: '带入治理', kind: 'primary', disabled: !skill })}
          ${buttonHtml({ action: 'goto-logs', label: '日志', disabled: !skill })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展运行态' })}
        </div>
      </div>
      ${
        skill
          ? `
            ${keyValueRowsHtml([
              { label: '名称', value: skill.name },
              { label: '分类', value: categoryLabel(skill.category) },
              { label: '相对路径', value: skill.relativePath },
              { label: '运行态可见', value: selectedExistsInRuntime ? '是' : '否' },
              { label: '编排引用', value: String(jobs.length) },
              { label: '文件路径', value: skill.filePath },
            ])}
            <pre class="code-block compact-code skill-detail-preview top-gap">${escapeHtml(skill.preview || '无预览内容')}</pre>
          `
          : emptyStateHtml('未选择技能', '先从左侧选择一个技能。')
      }
    </section>

    <div class="workspace-bottom-grid workspace-bottom-grid-dense">
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

function renderSkillRegistryWorkspace(view, state) {
  const {
    currentToolsets,
    jobs,
    runtimeLocal,
    selectedExistsInRuntime,
    skill,
    usedNames,
  } = state;

  return `
    <div class="compact-overview-grid compact-overview-grid-dense">
      <section class="shell-card shell-card-dense">
          <div class="shell-card-header">
            <div>
              <div class="panel-title-row">
                <strong>搜索 / 预检 / 安装</strong>
                ${infoTipHtml('调用的是桌面端封装的技能动作，不会把你甩回外部终端。')}
              </div>
            <p class="shell-card-copy">先搜关键词，再对目标技能做预检或安装。</p>
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

      <section class="shell-card shell-card-dense">
        <div class="shell-card-header">
          <div>
            <strong>治理与布线</strong>
            <p class="shell-card-copy">更新、审计和布线核查集中在一处，避免在多个页面重复露出。</p>
          </div>
          ${pillHtml(view.installation.binaryFound ? '底层已就绪' : '底层待安装', view.installation.binaryFound ? 'good' : 'bad')}
        </div>
        ${keyValueRowsHtml([
          { label: '工具集', value: currentToolsets.length ? currentToolsets.join(', ') : '—' },
          { label: '本地运行态', value: String(runtimeLocal) },
          { label: '已编排技能', value: String(usedNames.size) },
          { label: '当前技能可见', value: skill ? (selectedExistsInRuntime ? '是' : '否') : '—' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'skills-check', label: view.runningAction === 'skills:check' ? '检查中…' : '检查更新', kind: 'primary', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          ${buttonHtml({ action: 'skills-update', label: view.runningAction === 'skills:update' ? '更新中…' : '更新技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          ${buttonHtml({ action: 'skills-audit', label: view.runningAction === 'skills:audit' ? '审计中…' : '审计已装技能', disabled: Boolean(view.runningAction) || !view.installation.binaryFound })}
          ${buttonHtml({ action: 'goto-config-toolsets', label: '核对工具集' })}
          ${buttonHtml({ action: 'goto-config-memory', label: '核对记忆链路' })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展运行态' })}
        </div>
      </section>
    </div>

    <div class="workspace-bottom-grid workspace-bottom-grid-dense top-gap">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <h2 class="config-section-title">当前目标布线</h2>
            <p class="config-section-desc">把目录技能、运行态可见性和自动化引用放在一起核对。</p>
          </div>
          ${skill ? pillHtml(skill.name, 'neutral') : pillHtml('等待选择', 'warn')}
        </div>
        ${keyValueRowsHtml([
          { label: '当前技能', value: skill?.name || '—' },
          { label: '分类', value: skill ? categoryLabel(skill.category) : '—' },
          { label: '运行态', value: skill ? runtimeStateText(selectedExistsInRuntime) : '—' },
          { label: '编排显式引用', value: skill ? String(jobs.length) : '0' },
          { label: '目录路径', value: skill?.relativePath || '—' },
        ])}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-cron', label: '查看编排' })}
          ${buttonHtml({ action: 'goto-logs', label: '查看日志', disabled: !skill })}
        </div>
      </section>

      ${renderSkillOutputCard(view)}
    </div>
  `;
}

function skillDirectoryPath(filePath) {
  const normalized = String(filePath || '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function skillContentDirty(view, skill) {
  return Boolean(skill && view.skillFile && view.skillFile.content !== view.skillFileSavedContent);
}

function skillFrontmatterDirty(view, skill) {
  const draft = view.skillFrontmatterDraft;
  if (!skill || !draft || draft.filePath !== skill.filePath) {
    return false;
  }

  const currentName = String(view.skillFile?.name || skill.name || '').trim();
  const currentDescription = String(view.skillFile?.description || skill.description || '').trim();

  return draft.name.trim() !== currentName || draft.description.trim() !== currentDescription;
}

function renderSkillSignalCard(label, value, meta, tone = 'neutral') {
  return `
    <section class="plugin-signal-card">
      <span class="plugin-signal-label">${escapeHtml(label)}</span>
      <strong class="plugin-signal-value">${escapeHtml(value)}</strong>
      <span class="plugin-signal-meta plugin-signal-meta-${escapeHtml(tone)}">${escapeHtml(meta)}</span>
    </section>
  `;
}

function renderSkillFrontmatterEditor(view, state) {
  const { skill } = state;
  if (!skill) {
    return '';
  }

  const draft = view.skillFrontmatterDraft && view.skillFrontmatterDraft.filePath === skill.filePath
    ? view.skillFrontmatterDraft
    : null;
  const frontmatterDirty = skillFrontmatterDirty(view, skill);

  return `
    <details class="compact-disclosure skill-frontmatter-disclosure" id="skills-frontmatter-disclosure" ${view.skillFrontmatterExpanded ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">Frontmatter 接管</strong>
            <span class="preset-card-copy">只接管 <code>name / description</code>，其他 frontmatter 字段保持原样。</span>
          </div>
          <div class="pill-row">
            <span id="skill-frontmatter-dirty-pill">${pillHtml(frontmatterDirty ? '未保存' : '已同步', frontmatterDirty ? 'warn' : 'good')}</span>
            ${pillHtml(skill.category, 'neutral')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${view.skillFileLoading ? `
          <div class="plugin-manifest-state">
            <strong>正在读取技能 frontmatter…</strong>
            <p>稍后会把技能名称和描述直接填进表单。</p>
          </div>
        ` : !draft ? `
          <div class="plugin-manifest-state">
            <strong>等待技能文件</strong>
            <p>先读取当前技能文件，再继续做结构化接管。</p>
          </div>
        ` : `
          <div class="plugin-manifest-grid">
            <div class="plugin-manifest-meta">
              <span>frontmatter</span>
              <code>${escapeHtml(view.skillFile?.filePath || skill.filePath)}</code>
            </div>
            ${keyValueRowsHtml([
              { label: '分类', value: skill.category || '—' },
              { label: '相对路径', value: skill.relativePath || '—' },
            ])}
            <div class="form-grid form-grid-compact">
              <label class="field-stack">
                <span>技能名称</span>
                <input class="search-input" id="skill-frontmatter-name" value="${escapeHtml(draft.name)}" placeholder="例如 Browser QA" ${view.runningAction ? 'disabled' : ''}>
              </label>
              <label class="field-stack">
                <span>描述</span>
                <input class="search-input" id="skill-frontmatter-description" value="${escapeHtml(draft.description)}" placeholder="一句话说明 skill 的用途" ${view.runningAction ? 'disabled' : ''}>
              </label>
            </div>
            <div class="toolbar">
              ${buttonHtml({ action: 'save-skill-frontmatter', label: view.runningAction === 'skills:save-frontmatter' ? '保存中…' : '保存 frontmatter', kind: 'primary', disabled: Boolean(view.runningAction) || !draft.name.trim(), attrs: { id: 'skill-frontmatter-save' } })}
              ${buttonHtml({ action: 'reset-skill-frontmatter', label: '重置', disabled: Boolean(view.runningAction) || !view.skillFile })}
            </div>
          </div>
        `}
      </div>
    </details>
  `;
}

function renderSkillContentEditor(view, state) {
  const { skill } = state;
  if (!skill) {
    return '';
  }

  const contentDirty = skillContentDirty(view, skill);

  return `
    <details class="compact-disclosure skill-content-disclosure" id="skills-content-disclosure" ${view.skillContentExpanded ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">SKILL.md 正文编修</strong>
            <span class="preset-card-copy">直接维护本地 <code>SKILL.md</code> 正文，不再跳外部终端。</span>
          </div>
          <div class="pill-row">
            <span id="skill-file-dirty-pill">${pillHtml(contentDirty ? '未保存' : '已同步', contentDirty ? 'warn' : 'good')}</span>
            ${pillHtml(view.skillFileLoading ? '读取中' : '正文', view.skillFileLoading ? 'warn' : 'neutral')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${skill
          ? `
            <div class="plugin-manifest-grid">
              <div class="plugin-manifest-meta">
                <span>skill file</span>
                <code>${escapeHtml(view.skillFile?.filePath || skill.filePath)}</code>
              </div>
              <label class="field-stack">
                <span>SKILL.md</span>
                <textarea class="editor compact-skill-editor" id="skill-content-editor" placeholder="正在读取技能文件…" ${view.runningAction ? 'disabled' : ''}>${escapeHtml(view.skillFile?.content || '')}</textarea>
              </label>
              <div class="toolbar">
                ${buttonHtml({ action: 'save-skill-file', label: view.runningAction === 'skills:save-file' ? '保存中…' : '保存技能文件', kind: 'primary', disabled: Boolean(view.runningAction) || !view.skillFile, attrs: { id: 'skill-file-save' } })}
                ${buttonHtml({ action: 'reload-skill-file', label: view.runningAction === 'skills:reload-file' ? '刷新中…' : '重新读取', disabled: Boolean(view.runningAction) || !skill })}
                ${buttonHtml({ action: 'open-skill-file', label: '定位文件', disabled: Boolean(view.runningAction) || !skill })}
                ${buttonHtml({ action: 'open-skill-dir', label: '打开目录', disabled: Boolean(view.runningAction) || !skill })}
              </div>
            </div>
          `
          : emptyStateHtml('未选择技能', '从左侧选择技能后，这里会直接展开本地 SKILL.md。')}
      </div>
    </details>
  `;
}

function renderSkillLocalOps(view, state) {
  const { jobs, selectedExistsInRuntime, skill } = state;
  if (!skill) {
    return '';
  }

  const filePath = view.skillFile?.filePath || skill.filePath;
  const directoryPath = skillDirectoryPath(filePath);
  const confirmMatched = view.skillDeleteConfirm.trim() === skill.name;
  const deleteBlocked = jobs.length > 0;

  return `
    <details class="compact-disclosure skill-localops-disclosure" id="skills-localops-disclosure" ${view.skillLocalOpsExpanded ? 'open' : ''}>
      <summary class="compact-disclosure-summary">
        <div class="compact-disclosure-head">
          <div class="compact-disclosure-copy">
            <strong class="compact-disclosure-title">本地目录控制</strong>
            <span class="preset-card-copy">把定位、确认和删除收进危险区，避免和主治理动作挤在一起。</span>
          </div>
          <div class="pill-row">
            ${pillHtml(selectedExistsInRuntime ? '运行面已接入' : '仅目录可见', selectedExistsInRuntime ? 'warn' : 'good')}
            ${pillHtml(jobs.length ? `${jobs.length} 个编排引用` : '未绑定编排', jobs.length ? 'warn' : 'neutral')}
          </div>
        </div>
      </summary>
      <div class="compact-disclosure-body">
        ${keyValueRowsHtml([
          { label: '技能目录', value: directoryPath || '—' },
          { label: '相对路径', value: skill.relativePath || '—' },
          { label: '技能文件', value: filePath || '—' },
          { label: '运行态', value: selectedExistsInRuntime ? '已进入运行面' : '仅目录可见' },
        ])}
        <div class="danger-copy-compact">
          <strong>本地危险操作</strong>
          <p>${escapeHtml(
            deleteBlocked
              ? `当前技能仍被 ${jobs.length} 个 cron 作业引用。先解除编排绑定，再删除本地目录。`
              : selectedExistsInRuntime
                ? '当前技能已经进入运行面。删除目录后，下次刷新运行态会失去该技能来源。'
                : '删除只影响当前 profile 的本地 skills 目录，不会触碰其他 profile。'
          )}</p>
        </div>
        <label class="field-stack">
          <span>删除确认</span>
          <input class="search-input" id="skill-delete-confirm" value="${escapeHtml(view.skillDeleteConfirm)}" placeholder="输入 ${escapeHtml(skill.name)} 以确认删除" ${view.runningAction ? 'disabled' : ''}>
        </label>
        <div class="toolbar">
          ${buttonHtml({ action: 'open-skill-file', label: '定位文件', disabled: Boolean(view.runningAction) || !skill })}
          ${buttonHtml({ action: 'open-skill-dir', label: '打开目录', disabled: Boolean(view.runningAction) || !skill })}
          ${buttonHtml({ action: 'delete-local-skill', label: view.runningAction === 'skills:delete-local' ? '删除中…' : '删除本地目录', kind: 'danger', disabled: Boolean(view.runningAction) || deleteBlocked || !confirmMatched, attrs: { id: 'skill-delete-submit' } })}
        </div>
      </div>
    </details>
  `;
}

function renderSkillStudio(view, state) {
  const { jobs, selectedExistsInRuntime, skill, warnings } = state;
  const skillDirty = skillContentDirty(view, skill);
  const draft = view.createDraft ?? cloneSkillDraft();
  const importDraft = view.importDraft ?? cloneSkillImportDraft();
  const lastImported = view.lastImportedSkill;

  return `
    <section class="shell-card shell-card-dense plugin-focus-card">
      <div class="shell-card-header plugin-focus-head">
        <div class="plugin-focus-title-wrap">
          <div>
            <div class="panel-title-row">
              <strong>本地治理目标</strong>
              ${infoTipHtml('这里优先承接技能的本地闭环：frontmatter、正文、目录控制都收进一个治理卡，导入和新建退到下方辅助区。')}
            </div>
            <p class="shell-card-copy">让当前技能的接管、编辑和删除都在一个主卡里完成。</p>
          </div>
          ${skill ? `
            <div class="plugin-focus-title">
              <span class="plugin-card-icon">🧠</span>
              <div class="plugin-focus-title-copy">
                <strong class="plugin-focus-name">${escapeHtml(skill.name)}</strong>
                <div class="plugin-tile-badges">
                  ${pillHtml(skill.category || '未分类', 'neutral')}
                  ${pillHtml(selectedExistsInRuntime ? '运行面已接入' : '运行面待同步', selectedExistsInRuntime ? 'good' : 'warn')}
                  ${skillDirty ? pillHtml('正文有改动', 'warn') : pillHtml('正文已同步', 'good')}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
        ${pillHtml(skill ? skill.name : '等待目标', skill ? 'good' : 'warn')}
      </div>

      ${skill ? `
        <div class="plugin-signal-grid top-gap">
          ${renderSkillSignalCard('目录', skill.relativePath || '—', skill.category || '未分类', 'neutral')}
          ${renderSkillSignalCard('运行态', selectedExistsInRuntime ? '已接入' : '待同步', selectedExistsInRuntime ? '当前已暴露给运行面' : '仍只存在于本地目录', selectedExistsInRuntime ? 'good' : 'warn')}
          ${renderSkillSignalCard('自动化', jobs.length ? `${jobs.length} 个作业` : '未绑定', jobs.length ? '删除前建议先解除 cron 引用' : '当前没有显式编排引用', jobs.length ? 'warn' : 'good')}
          ${renderSkillSignalCard('文件', skillDirty ? '正文未保存' : '正文已同步', view.skillFile?.filePath || skill.filePath || '等待读取技能文件', skillDirty ? 'warn' : 'neutral')}
        </div>
        ${warnings.length
          ? `
            <section class="plugin-focus-section top-gap">
              <div class="plugin-focus-section-head">
                <strong>当前提醒</strong>
                <span>${escapeHtml(`${warnings.length} 条`)}</span>
              </div>
              <div class="warning-stack">
                ${warnings.slice(0, 3).map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}
              </div>
            </section>
          `
          : ''}
        <div class="compact-disclosure-stack top-gap">
          ${renderSkillFrontmatterEditor(view, state)}
          ${renderSkillContentEditor(view, state)}
          ${renderSkillLocalOps(view, state)}
        </div>
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'goto-logs', label: '查看日志', disabled: Boolean(view.runningAction) || !skill })}
          ${buttonHtml({ action: 'goto-cron', label: '查看编排', disabled: Boolean(view.runningAction) })}
          ${buttonHtml({ action: 'goto-extensions', label: '扩展运行态', disabled: Boolean(view.runningAction) })}
        </div>
      ` : `
        <div class="top-gap">
          ${emptyStateHtml('还没选治理目标', '先从左侧技能目录选择一个 skill，本地治理卡就会接管 frontmatter、正文和目录控制。')}
        </div>
      `}
    </section>

    <div class="compact-overview-grid compact-overview-grid-dense top-gap">
      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <h2 class="config-section-title">导入现成技能</h2>
              ${infoTipHtml('支持导入一个完整技能目录，或直接导入单个 SKILL.md。能复制的内容会直接落到当前 profile 的 skills 目录。')}
            </div>
            <p class="workspace-main-copy">优先接本地目录，再继续治理。</p>
          </div>
          ${lastImported ? pillHtml(`${lastImported.copiedFiles} 个文件`, 'good') : pillHtml(importDraft.category || '自动归类', 'neutral')}
        </div>
        <div class="form-grid">
          <label class="field-stack">
            <span>源路径</span>
            <input class="search-input" id="skill-import-source" value="${escapeHtml(importDraft.sourcePath)}" placeholder="~/Downloads/release-notes 或 /tmp/demo/SKILL.md">
          </label>
          <label class="field-stack">
            <span>归档分类</span>
            <input class="search-input" id="skill-import-category" value="${escapeHtml(importDraft.category)}" placeholder="留空沿用源分类，否则归入 imported">
          </label>
        </div>
        <div class="checkbox-row top-gap">
          <label>
            <input type="checkbox" id="skill-import-overwrite" ${importDraft.overwrite ? 'checked' : ''}>
            覆盖当前 profile 中已存在的同名目标
          </label>
        </div>
        ${lastImported
          ? `
            <div class="top-gap">
              ${keyValueRowsHtml([
                { label: '最近导入', value: lastImported.imported.name },
                { label: '来源', value: lastImported.sourcePath },
                { label: '目标目录', value: lastImported.targetDirectory },
                { label: '归档分类', value: lastImported.imported.category },
              ])}
            </div>
          `
          : ''}
        <div class="toolbar top-gap">
          ${buttonHtml({ action: 'import-local-skill', label: view.runningAction === 'skills:import-local' ? '导入中…' : '导入到当前实例', kind: 'primary', disabled: Boolean(view.runningAction) || !importDraft.sourcePath.trim(), attrs: { id: 'skill-import-submit' } })}
          ${buttonHtml({ action: 'reset-skill-import-draft', label: '清空路径', disabled: Boolean(view.runningAction) })}
          ${buttonHtml({ action: 'use-selected-skill-category', label: '带入当前分类', disabled: Boolean(view.runningAction) || !skill })}
          ${buttonHtml({ action: 'open-home', label: '打开 Home', disabled: Boolean(view.runningAction) })}
        </div>
      </section>

      <section class="workspace-main-card">
        <div class="workspace-main-header">
          <div>
            <div class="panel-title-row">
              <h2 class="config-section-title">新建本地技能</h2>
              ${infoTipHtml('需要定制私有能力时，再直接在客户端里创建 skill 脚手架。')}
            </div>
            <p class="workspace-main-copy">只保留建立 skill 真正需要的最小字段。</p>
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
          ${buttonHtml({ action: 'create-local-skill', label: view.runningAction === 'skills:create-local' ? '创建中…' : '创建本地技能', kind: 'primary', disabled: Boolean(view.runningAction) || !draft.name.trim(), attrs: { id: 'skill-create-submit' } })}
          ${buttonHtml({ action: 'reset-local-skill-draft', label: '清空草稿', disabled: Boolean(view.runningAction) })}
        </div>
      </section>
    </div>
  `;
}

export function deriveSkillsWorkbenchState(view) {
  const filtered = filteredSkills(view);
  const skill = currentSkill(view, filtered);
  const jobs = selectedJobs(view, skill);
  const usedNames = skillUsageNames(view);
  const warnings = capabilityWarnings(view, skill, jobs);
  const categories = categoryOptions(view.skills);
  const quickCategories = categories.filter((item) => item !== 'all').slice(0, 6);
  const currentToolsets = view.dashboard?.config.toolsets ?? [];
  const runtimeLocal = runtimeLocalSkillCount(view);
  const selectedExistsInRuntime = skill ? view.extensions.runtimeSkills.some((item) => item.name === skill.name) : false;

  return {
    categories,
    currentToolsets,
    filtered,
    jobs,
    quickCategories,
    runtimeLocal,
    runtimeMismatch: runtimeSkillMismatch(view),
    selectedExistsInRuntime,
    skill,
    usedNames,
    warnings,
  };
}

export function renderSkillsWorkbench(view, state) {
  const {
    categories,
    filtered,
    jobs,
    quickCategories,
    runtimeLocal,
    runtimeMismatch,
    selectedExistsInRuntime,
    skill,
    warnings,
  } = state;

  const workspaceMain = view.workspaceTab === 'registry'
    ? renderSkillRegistryWorkspace(view, state)
    : view.workspaceTab === 'studio'
      ? renderSkillStudio(view, state)
      : renderSkillOverviewWorkspace(view, state);

  return `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">技能工作台</h1>
        ${infoTipHtml('这里不再堆大段说明。核心只保留技能目录、安装动作、运行态差异和自动化引用，跨页入口尽量收敛到少量真正有用的跳转。')}
      </div>
      <p class="page-desc">技能目录、本地治理和安装动作在这里合流。</p>
    </div>

    <section class="workspace-summary-strip workspace-summary-strip-dense">
      <section class="summary-mini-card">
        <span class="summary-mini-label">目录技能</span>
        <strong class="summary-mini-value">${escapeHtml(String(view.skills.length))}</strong>
        <span class="summary-mini-meta">当前实例扫描到的本地技能</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">本地运行面</span>
        <strong class="summary-mini-value">${escapeHtml(String(runtimeLocal))}</strong>
        <span class="summary-mini-meta">${runtimeMismatch ? '运行面与目录存在偏差' : '运行面与目录已对齐'}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">当前目标</span>
        <strong class="summary-mini-value">${escapeHtml(view.installTarget.trim() || skill?.name || '未指定')}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.registryQuery.trim() || '优先在这里搜索、预检、安装技能')}</span>
      </section>
      <section class="summary-mini-card">
        <span class="summary-mini-label">最近动作</span>
        <strong class="summary-mini-value">${escapeHtml(view.lastResult?.label || '待执行')}</strong>
        <span class="summary-mini-meta">${escapeHtml(view.lastResult?.result?.success ? '最近一次命令成功' : view.lastResult ? '最近一次命令失败' : '执行搜索、安装或审计后会显示')}</span>
      </section>
    </section>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <div class="panel-title-row">
            <h2 class="config-section-title">技能主工作台</h2>
            ${infoTipHtml('左侧只保留筛选、技能列表和少量关键动作；右侧通过页内标签切换概览、本地治理和安装治理。')}
          </div>
          <p class="config-section-desc">把主操作收进一个工作台，不再到处重复露出。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workspaceTab === 'overview' ? '概览' : view.workspaceTab === 'registry' ? '安装治理' : '本地治理', 'neutral')}
          ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新状态', kind: 'primary', disabled: view.refreshing || Boolean(view.runningAction) })}
        </div>
      </div>
      ${renderSkillWorkbenchTabs(view)}
      <div class="workspace-shell workspace-shell-editor workspace-shell-dense">
        <section class="workspace-rail">
          <div class="workspace-rail-header">
            <div>
              <h2 class="config-section-title">技能目录</h2>
              <p class="config-section-desc">先选一个要治理的技能，再在右侧继续接管。</p>
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
              ${pillHtml(skill ? (selectedExistsInRuntime ? '运行面已接入' : '运行面待同步') : '等待选择', skill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral')}
            </div>
            ${keyValueRowsHtml([
              { label: '当前技能', value: skill?.name || '—' },
              { label: '分类', value: skill ? categoryLabel(skill.category) : '—' },
              { label: '编排', value: skill ? String(jobs.length) : '0' },
              { label: '运行态', value: skill ? runtimeStateText(selectedExistsInRuntime) : '—' },
            ])}
            <div class="workspace-rail-toolbar workspace-rail-toolbar-grid top-gap">
              ${buttonHtml({ action: 'use-selected-skill-name', label: '带入治理', kind: 'primary', disabled: Boolean(view.runningAction) || !skill })}
              ${buttonHtml({ action: 'open-skill-dir', label: '打开目录', disabled: Boolean(view.runningAction) || !skill })}
              ${buttonHtml({ action: 'goto-logs', label: '查看日志', disabled: !skill })}
              ${buttonHtml({ action: 'goto-extensions', label: '扩展运行态' })}
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
}
