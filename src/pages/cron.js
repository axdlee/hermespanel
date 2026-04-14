import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { formatTimestamp, truncate } from '../lib/format';
import {
  getPanelState,
  loadShell,
  navigate,
  notify,
  subscribePanelState,
} from '../lib/panel-state';
import { cronTone, hasCronFailure, isRemoteDelivery, uniqueCount } from '../lib/runtime';
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

const EMPTY_DRAFT = {
  clearScript: false,
  clearSkills: false,
  deliver: 'local',
  name: '',
  prompt: '',
  repeat: '',
  schedule: '',
  script: '',
  skills: '',
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
  const value = String(path ?? '').trim();
  const index = value.lastIndexOf('/');
  return index > 0 ? value.slice(0, index) : value;
}

function parseSkills(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDraftFromJob(job) {
  return {
    clearScript: false,
    clearSkills: false,
    deliver: job.deliver,
    name: job.name,
    prompt: job.prompt,
    repeat: job.repeatTimes == null ? '' : String(job.repeatTimes),
    schedule: job.scheduleInput || job.scheduleDisplay,
    script: job.script ?? '',
    skills: job.skills.join(', '),
  };
}

function extractCreatedJobId(result) {
  const match = result?.stdout?.match(/Created job:\s*([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function relaySeed(view, selectedJob = null) {
  return {
    sourcePage: 'cron',
    headline: selectedJob ? `围绕作业 ${selectedJob.name} 继续下钻` : '围绕 Hermes 自动化调度继续下钻',
    description: selectedJob
      ? `继续围绕 ${selectedJob.deliver} 投递、skills 引用、gateway 与配置链路做核对。`
      : '继续围绕自动化调度、投递和运行链路做核对。',
    context: selectedJob
      ? {
          preview: truncate(selectedJob.prompt || selectedJob.script || '无 prompt', 120),
          sessionId: selectedJob.id,
          source: selectedJob.deliver,
          title: selectedJob.name,
          toolNames: selectedJob.skills,
        }
      : undefined,
  };
}

function deriveState(view) {
  const jobs = view.snapshot?.jobs ?? [];
  const query = view.query.trim().toLowerCase();
  const skillNames = new Set((view.skills ?? []).map((item) => item.name));
  const filteredJobs = jobs.filter((job) => {
    const stateMatch = view.stateFilter === 'all' || job.state === view.stateFilter;
    const queryMatch = !query
      || [
        job.id,
        job.name,
        job.prompt,
        job.deliver,
        job.scheduleDisplay,
        job.script ?? '',
        job.skills.join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    return stateMatch && queryMatch;
  });
  const selectedJob = filteredJobs.find((job) => job.id === view.selectedId)
    ?? jobs.find((job) => job.id === view.selectedId)
    ?? filteredJobs[0]
    ?? null;
  const enabledCount = jobs.filter((job) => job.enabled && job.state !== 'paused').length;
  const failingJobs = jobs.filter(hasCronFailure);
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const jobsWithSkills = jobs.filter((job) => job.skills.length > 0);
  const referencedSkillNames = Array.from(new Set(jobs.flatMap((job) => job.skills)));
  const missingReferencedSkills = referencedSkillNames.filter((name) => !skillNames.has(name));
  const selectedMissingSkills = selectedJob?.skills.filter((name) => !skillNames.has(name)) ?? [];
  const selectedMatchedSkills = selectedJob
    ? view.skills.filter((skill) => selectedJob.skills.includes(skill.name))
    : [];
  const warnings = [];

  if (!view.installation?.binaryFound) {
    warnings.push('当前没有检测到 Hermes CLI，cron 调度虽然可查看，但无法完成真正的创建、编辑和触发闭环。');
  }
  if (!jobs.length) {
    warnings.push('当前 profile 还没有任何 cron 作业，自动化闭环尚未真正建立。');
  }
  if (missingReferencedSkills.length > 0) {
    warnings.push(`存在 ${missingReferencedSkills.length} 个被作业引用但当前未扫描到的 skill：${missingReferencedSkills.join('、')}。`);
  }
  if (view.dashboard?.gateway?.gatewayState !== 'running' && remoteJobs.length > 0) {
    warnings.push(`当前有 ${remoteJobs.length} 个远端投递作业，但 Gateway 未运行，消息平台投递链路大概率不可用。`);
  }
  if (view.dashboard?.config.memoryEnabled === false && jobsWithSkills.length > 0) {
    warnings.push('memory 当前关闭，自动化任务虽然还能跑，但很难积累长期偏好和工作记忆。');
  }
  if (!view.skills.length && jobsWithSkills.length > 0) {
    warnings.push('当前没有扫描到本地 skills，但已有 cron 作业声明了 skills，说明运行能力面可能不完整。');
  }

  return {
    enabledCount,
    failingJobs,
    filteredJobs,
    jobs,
    jobsWithSkills,
    missingReferencedSkills,
    referencedSkillNames,
    remoteJobs,
    selectedJob,
    selectedMatchedSkills,
    selectedMissingSkills,
    skillNames,
    warnings,
  };
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">定时任务</h1>
      </div>
      <p class="page-desc">正在同步 Hermes 自动化调度、skills 引用和投递链路。</p>
    </div>
    <div class="stat-cards stat-cards-4">
      ${Array.from({ length: 4 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function renderWorkbenchTabs(view) {
  const tabs = [
    { key: 'detail', label: '作业详情' },
    { key: 'editor', label: '编辑器' },
    { key: 'output', label: '最近输出' },
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

function renderJobList(view, state) {
  if (!state.filteredJobs.length) {
    return emptyStateHtml('暂无匹配作业', '当前筛选条件下没有匹配的 cron 作业。');
  }

  return `
    <div class="list-stack workspace-list-scroll">
      ${state.filteredJobs.map((job) => {
        const missingSkills = job.skills.filter((name) => !state.skillNames.has(name));
        return `
          <button
            type="button"
            class="list-card session-card ${state.selectedJob?.id === job.id ? 'selected' : ''}"
            data-action="select-job"
            data-id="${escapeHtml(job.id)}"
          >
            <div class="list-card-title">
              <strong>${escapeHtml(job.name)}</strong>
              <div class="pill-row">
                ${pillHtml(job.state, cronTone(job))}
                ${pillHtml(job.deliver, isRemoteDelivery(job.deliver) ? 'warn' : 'neutral')}
                ${missingSkills.length > 0 ? pillHtml('缺 skill', 'bad') : ''}
              </div>
            </div>
            <p>${escapeHtml(truncate(job.prompt || job.script || '无 prompt', 108))}</p>
            <div class="meta-line">
              <span>${escapeHtml(job.scheduleDisplay)}</span>
              <span>${escapeHtml(formatTimestamp(job.nextRunAt))}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderDetailWorkspace(view, state) {
  const job = state.selectedJob;
  if (!job) {
    return emptyStateHtml('未选择作业', '从左侧列表选择一条 cron 作业查看详情与闭环关系。');
  }

  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>${escapeHtml(job.name)}</strong>
            <p class="workspace-main-copy">${escapeHtml(job.id)} · ${escapeHtml(job.scheduleDisplay)}</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-edit-editor', label: '编辑', disabled: Boolean(view.runningAction) })}
            ${buttonHtml({ action: 'run-job', label: view.runningAction === 'cron:run' ? '触发中…' : '立即触发', kind: 'primary', disabled: Boolean(view.runningAction) })}
            ${buttonHtml({ action: 'pause-job', label: view.runningAction === 'cron:pause' ? '暂停中…' : '暂停', disabled: Boolean(view.runningAction) || !job.enabled || job.state === 'paused' })}
            ${buttonHtml({ action: 'resume-job', label: view.runningAction === 'cron:resume' ? '恢复中…' : '恢复', disabled: Boolean(view.runningAction) || job.state !== 'paused' })}
          </div>
        </div>
        ${keyValueRowsHtml([
          { label: 'ID', value: job.id },
          { label: '状态', value: job.state },
          { label: '启用', value: String(job.enabled) },
          { label: '调度输入', value: job.scheduleInput || '—' },
          { label: '下次运行', value: formatTimestamp(job.nextRunAt) },
          { label: '上次运行', value: formatTimestamp(job.lastRunAt) },
          { label: '交付目标', value: job.deliver },
          { label: '技能', value: job.skills.length ? job.skills.join(', ') : '—' },
          { label: '重复次数', value: job.repeatTimes == null ? '∞' : `${job.repeatCompleted}/${job.repeatTimes}` },
          { label: '脚本', value: job.script || '—' },
          { label: '最后错误', value: job.lastDeliveryError || job.lastError || '—' },
        ])}
      </section>

      <div class="workspace-bottom-grid">
        <section class="panel panel-nested">
          <div class="workspace-main-header">
            <div>
              <strong>自动化闭环</strong>
              <p class="workspace-main-copy">不仅看调度，还看 skills、memory、gateway 和 delivery 是否真的能接起来。</p>
            </div>
            ${pillHtml(job.deliver, isRemoteDelivery(job.deliver) ? 'warn' : 'neutral')}
          </div>
          <div class="health-grid">
            <section class="health-card">
              <div class="health-card-header">
                <strong>Prompt / Script</strong>
                ${pillHtml(job.script ? '脚本驱动' : job.prompt ? 'Prompt 驱动' : '空', job.script || job.prompt ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(job.script ? `脚本: ${job.script}` : '当前以 Hermes prompt 作为任务主体。')}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Skills</strong>
                ${pillHtml(job.skills.length === 0 ? '未绑定' : `${state.selectedMatchedSkills.length}/${job.skills.length}`, job.skills.length === 0 ? 'neutral' : state.selectedMissingSkills.length === 0 ? 'good' : 'bad')}
              </div>
              <p>${escapeHtml(job.skills.length === 0 ? '当前没有显式 skill 绑定。' : job.skills.join('、'))}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Memory</strong>
                ${pillHtml(view.dashboard?.config.memoryEnabled ? '已开启' : '已关闭', view.dashboard?.config.memoryEnabled ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(`Provider ${view.dashboard?.config.memoryProvider || 'builtin-file'} · 用户画像 ${String(view.dashboard?.config.userProfileEnabled ?? false)}`)}</p>
            </section>
            <section class="health-card">
              <div class="health-card-header">
                <strong>Delivery / Gateway</strong>
                ${pillHtml(!isRemoteDelivery(job.deliver) || view.dashboard?.gateway?.gatewayState === 'running' ? '已满足' : '待修复', !isRemoteDelivery(job.deliver) || view.dashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(isRemoteDelivery(job.deliver) ? '远端投递通常依赖 Gateway 和平台连接。' : '当前作业更偏本地执行或原地输出。')}</p>
            </section>
          </div>
          ${
            state.selectedMissingSkills.length > 0
              ? `<div class="warning-stack top-gap"><div class="warning-item">${escapeHtml(`这条作业引用了缺失技能：${state.selectedMissingSkills.join('、')}。`)}</div></div>`
              : ''
          }
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'goto-skills', label: 'Skills' })}
            ${buttonHtml({ action: 'goto-memory', label: 'Memory' })}
            ${buttonHtml({ action: 'goto-gateway', label: 'Gateway' })}
            ${buttonHtml({ action: 'goto-logs', label: 'Logs' })}
            ${buttonHtml({ action: 'goto-diagnostics', label: 'Diagnostics' })}
          </div>
        </section>

        <section class="panel panel-nested">
          <div class="workspace-main-header">
            <div>
              <strong>Prompt</strong>
              <p class="workspace-main-copy">原始任务描述，便于快速判断这条自动化作业到底在做什么。</p>
            </div>
          </div>
          <pre class="code-block">${escapeHtml(job.prompt || '无 prompt 内容')}</pre>
        </section>
      </div>
    </div>
  `;
}

function renderEditorWorkspace(view, state) {
  const editing = view.editorMode !== null;
  const title = view.editorMode === 'create' ? '新建作业' : '编辑作业';

  return `
    <div class="page-stack">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>${editing ? title : '作业编辑器'}</strong>
            <p class="workspace-main-copy">${editing ? '所有写操作仍然走 Hermes 原生命令，只在桌面端做表单包装。' : '先选一条作业点击编辑，或者新建一条新的自动化任务。'}</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'open-create-editor', label: '新建作业', kind: 'primary', disabled: Boolean(view.runningAction) })}
            ${buttonHtml({ action: 'open-edit-editor', label: '编辑当前', disabled: Boolean(view.runningAction) || !state.selectedJob })}
            ${buttonHtml({ action: 'close-editor', label: '清空表单', disabled: Boolean(view.runningAction) || !editing })}
          </div>
        </div>
        ${editing ? `
          <div class="form-grid">
            <label class="field-stack">
              <span>名称</span>
              <input class="search-input" id="cron-draft-name" value="${escapeHtml(view.draft.name)}" placeholder="日报汇总">
            </label>
            <label class="field-stack">
              <span>调度</span>
              <input class="search-input" id="cron-draft-schedule" value="${escapeHtml(view.draft.schedule)}" placeholder="every 2h / 0 9 * * *">
            </label>
            <label class="field-stack">
              <span>交付</span>
              <input class="search-input" id="cron-draft-deliver" value="${escapeHtml(view.draft.deliver)}" placeholder="local / telegram:chat_id">
            </label>
            <label class="field-stack">
              <span>重复次数</span>
              <input class="search-input" id="cron-draft-repeat" value="${escapeHtml(view.draft.repeat)}" placeholder="留空表示无限或保持现状">
            </label>
            <label class="field-stack">
              <span>技能</span>
              <input class="search-input" id="cron-draft-skills" value="${escapeHtml(view.draft.skills)}" placeholder="skill-a, skill-b" ${view.draft.clearSkills ? 'disabled' : ''}>
            </label>
            <label class="field-stack">
              <span>脚本</span>
              <input class="search-input" id="cron-draft-script" value="${escapeHtml(view.draft.script)}" placeholder="/absolute/path/to/script.py" ${view.draft.clearScript ? 'disabled' : ''}>
            </label>
          </div>
          <div class="checkbox-row">
            <label>
              <input type="checkbox" id="cron-draft-clear-skills" ${view.draft.clearSkills ? 'checked' : ''}>
              <span>清空技能列表</span>
            </label>
            <label>
              <input type="checkbox" id="cron-draft-clear-script" ${view.draft.clearScript ? 'checked' : ''}>
              <span>清空脚本</span>
            </label>
          </div>
          <label class="field-stack">
            <span>Prompt</span>
            <textarea class="editor" id="cron-draft-prompt" spellcheck="false" placeholder="输入自包含 prompt，或搭配 skill 作为任务说明。">${escapeHtml(view.draft.prompt)}</textarea>
          </label>
          <div class="toolbar top-gap">
            ${buttonHtml({ action: 'submit-editor', label: view.runningAction === 'cron:create' || view.runningAction === 'cron:update' ? '提交中…' : view.editorMode === 'create' ? '创建作业' : '保存修改', kind: 'primary', disabled: Boolean(view.runningAction) })}
            ${buttonHtml({ action: 'goto-config', label: '核对配置页' })}
            ${buttonHtml({ action: 'goto-skills', label: '核对 Skills' })}
          </div>
          <p class="helper-text">\`schedule\` 直接对齐 Hermes CLI，支持 \`30m\`、\`every 2h\`、\`0 9 * * *\` 和 ISO 时间。</p>
        ` : emptyStateHtml('编辑器待命', '点击“新建作业”或“编辑当前”，在这里完成 create / update 闭环。')}
      </section>
    </div>
  `;
}

function renderOutputWorkspace(view, state) {
  const selectedJob = state.selectedJob;
  const deleteReady = selectedJob && view.deleteConfirm.trim() === selectedJob.id;

  return `
    <div class="workspace-bottom-grid">
      <section class="panel panel-nested">
        <div class="workspace-main-header">
          <div>
            <strong>最近命令输出</strong>
            <p class="workspace-main-copy">create / edit / run / pause / resume / delete 的原始结果会保留在这里。</p>
          </div>
        </div>
        ${commandResultHtml(view.lastResult, '尚未执行操作', '这里会显示 Hermes CLI 的原始输出。')}
      </section>

      <section class="panel panel-nested panel-danger">
        <div class="workspace-main-header">
          <div>
            <strong>危险区</strong>
            <p class="workspace-main-copy">删除会直接修改当前 profile 的 jobs.json，请先核对完整 job_id。</p>
          </div>
          ${selectedJob ? pillHtml(selectedJob.id, 'warn') : ''}
        </div>
        ${
          selectedJob
            ? `
              <div class="danger-copy-compact">
                <strong>删除 ${escapeHtml(selectedJob.name)}</strong>
                <p>影响范围：${escapeHtml(view.snapshot?.jobsPath || '当前 profile 的 cron/jobs.json')}</p>
              </div>
              <label class="field-stack top-gap">
                <span>请输入 ${escapeHtml(selectedJob.id)} 以确认删除</span>
                <input class="search-input" id="cron-delete-confirm" value="${escapeHtml(view.deleteConfirm)}" placeholder="${escapeHtml(selectedJob.id)}">
              </label>
              <div class="toolbar top-gap">
                ${buttonHtml({ action: 'delete-job', label: view.runningAction === 'cron:delete' ? '删除中…' : '删除作业', kind: 'danger', disabled: Boolean(view.runningAction) || !deleteReady })}
                ${buttonHtml({ action: 'open-edit-editor', label: '改为编辑', disabled: Boolean(view.runningAction) })}
              </div>
              <p class="helper-text">底层仍然调用 Hermes 原生删除命令，HermesPanel 只补这一层确认。</p>
            `
            : emptyStateHtml('未选择作业', '先从左侧选中一条作业，才能进入删除确认。')
        }
      </section>
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.snapshot) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.snapshot || !view.dashboard || !view.installation) {
    view.page.innerHTML = `
      <div class="page-header">
        <div class="panel-title-row">
          <h1 class="page-title">定时任务</h1>
        </div>
        <p class="page-desc">围绕 Hermes 自动化调度、skills、gateway 和 delivery 做统一治理。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">cron 工作台快照暂时不可用，可以直接重试。</p>
          </div>
        </div>
        ${emptyStateHtml('未能读取 cron 工作台', view.error || '请稍后再试。')}
        <div class="quick-actions">
          ${buttonHtml({ action: 'refresh', label: '重新读取', kind: 'primary' })}
        </div>
      </section>
    `;
    bindEvents(view);
    return;
  }

  const state = deriveState(view);
  const selectedJob = state.selectedJob;
  const workbenchMain = view.workspaceTab === 'detail'
    ? renderDetailWorkspace(view, state)
    : view.workspaceTab === 'editor'
      ? renderEditorWorkspace(view, state)
      : renderOutputWorkspace(view, state);
  const seed = relaySeed(view, selectedJob);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    contains: selectedJob?.id || selectedJob?.deliver || selectedJob?.skills[0] || '',
    description: selectedJob ? `查看作业 ${selectedJob.name} 相关日志。` : '继续核对自动化作业相关日志。',
    logName: selectedJob && isRemoteDelivery(selectedJob.deliver) ? 'gateway.error' : 'agent',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    description: selectedJob ? `围绕作业 ${selectedJob.name} 继续做自动化体检。` : '继续做自动化调度体检。',
    suggestedCommand: selectedJob && isRemoteDelivery(selectedJob.deliver) ? 'gateway-status-deep' : 'config-check',
  });
  const configIntent = buildConfigDrilldownIntent(seed, {
    focus: selectedJob?.skills.length ? 'toolsets' : 'context',
    suggestedCommand: 'config-check',
  });
  const gatewayIntent = buildGatewayDrilldownIntent(seed, {
    platformName: selectedJob && isRemoteDelivery(selectedJob.deliver) ? selectedJob.deliver : undefined,
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(seed, {
    query: selectedJob?.skills.join(' ') || '',
    rawKind: selectedJob?.skills.length ? 'skills' : 'tools',
    toolNames: selectedJob?.skills ?? [],
  });

  view.page.innerHTML = `
    <div class="page-header">
      <div class="panel-title-row">
        <h1 class="page-title">定时任务</h1>
        ${infoTipHtml('这里不只是读取 jobs.json，而是把调度、skills、memory、gateway、delivery 串成真正可操作的自动化工作台。')}
      </div>
      <p class="page-desc">围绕 Hermes 的 cron/jobs.json、skills、memory、gateway 与 delivery 做闭环治理。</p>
    </div>

    <div class="stat-cards stat-cards-4">
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">作业总数</span>
          ${statusDotHtml(state.jobs.length > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(String(state.jobs.length))}</div>
        <div class="stat-card-meta">${escapeHtml(view.snapshot.jobsPath || 'jobs.json 未解析')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">已启用</span>
          ${statusDotHtml(state.enabledCount > 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(String(state.enabledCount))}</div>
        <div class="stat-card-meta">未暂停且处于活动态的作业</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">远端投递</span>
          ${statusDotHtml(state.remoteJobs.length === 0 || view.dashboard.gateway?.gatewayState === 'running' ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(String(state.remoteJobs.length))}</div>
        <div class="stat-card-meta">${escapeHtml(view.dashboard.gateway?.gatewayState === 'running' ? 'Gateway 已运行' : 'Gateway 未运行')}</div>
      </section>
      <section class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">缺失 Skills</span>
          ${statusDotHtml(state.missingReferencedSkills.length === 0 ? 'running' : 'warning')}
        </div>
        <div class="stat-card-value">${escapeHtml(String(state.missingReferencedSkills.length))}</div>
        <div class="stat-card-meta">${escapeHtml(`已引用 skill ${state.referencedSkillNames.length} 个 · 目标 ${uniqueCount(state.jobs.map((job) => job.deliver))} 类`)}</div>
      </section>
    </div>

    <div class="quick-actions">
      ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '刷新', kind: 'primary', disabled: view.refreshing || Boolean(view.runningAction) })}
      ${buttonHtml({ action: 'open-create-editor', label: '新建作业', disabled: Boolean(view.runningAction) })}
      ${buttonHtml({ action: 'open-jobs-file', label: '定位 jobs.json', disabled: Boolean(view.runningAction) || !view.snapshot.jobsPath })}
      ${buttonHtml({ action: 'open-cron-dir', label: '打开 cron 目录', disabled: Boolean(view.runningAction) || !view.snapshot.jobsPath })}
      ${buttonHtml({ action: 'goto-skills', label: 'Skills' })}
      ${buttonHtml({ action: 'goto-logs', label: 'Logs' })}
    </div>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">自动化总览</h2>
          <p class="config-section-desc">总控视图，但内容完全围绕 Hermes 的自动化链路来组织。</p>
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
            { label: 'jobs.json', value: view.snapshot.jobsPath || '—' },
            { label: 'Gateway', value: view.dashboard.gateway?.gatewayState ?? '未检测到' },
            { label: '记忆 Provider', value: view.dashboard.config.memoryProvider || 'builtin-file' },
            { label: 'Toolsets', value: view.dashboard.config.toolsets.length ? view.dashboard.config.toolsets.join(', ') : '—' },
          ])}
        </div>
        <div class="metrics-grid metrics-grid-tight">
          <div class="metric-card">
            <p class="metric-label">失败作业</p>
            <div class="metric-value">${escapeHtml(String(state.failingJobs.length))}</div>
            <p class="metric-hint">last_error / delivery_error / error state</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">声明 Skills</p>
            <div class="metric-value">${escapeHtml(String(state.jobsWithSkills.length))}</div>
            <p class="metric-hint">显式绑定能力面的作业</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">Warnings</p>
            <div class="metric-value">${escapeHtml(String(state.warnings.length))}</div>
            <p class="metric-hint">skills / gateway / memory / cli</p>
          </div>
          <div class="metric-card">
            <p class="metric-label">CLI</p>
            <div class="metric-value">${escapeHtml(view.installation.binaryFound ? 'Ready' : 'Missing')}</div>
            <p class="metric-hint">${escapeHtml(view.installation.hermesBinary || '未检测到 hermes 可执行文件')}</p>
          </div>
        </div>
      </div>
      ${
        state.warnings.length > 0
          ? `<div class="warning-stack top-gap">${state.warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('')}</div>`
          : ''
      }
    </section>

    <section class="config-section">
      <div class="config-section-header">
        <div>
          <h2 class="config-section-title">调度工作台</h2>
          <p class="config-section-desc">主区域只保留作业本身，筛选、列表和跳转入口放到侧边轨道。</p>
        </div>
        <div class="toolbar">
          ${pillHtml(view.workspaceTab, 'neutral')}
          ${selectedJob ? pillHtml(selectedJob.name, 'good') : ''}
        </div>
      </div>
      ${renderWorkbenchTabs(view)}
      <div class="workspace-shell workspace-shell-editor">
        <aside class="workspace-rail">
          <div class="workspace-rail-header">
            <div>
              <strong>作业列表</strong>
              <p class="workspace-main-copy">先筛选，再决定是编辑、立即触发，还是下钻到 logs / diagnostics。</p>
            </div>
            ${pillHtml(`${state.filteredJobs.length}/${state.jobs.length}`, state.filteredJobs.length > 0 ? 'good' : 'warn')}
          </div>
          <div class="workspace-rail-toolbar">
            <input class="search-input" id="cron-query" value="${escapeHtml(view.query)}" placeholder="搜索名称、prompt、skill、delivery">
            <select class="select-input" id="cron-state-filter">
              <option value="all" ${view.stateFilter === 'all' ? 'selected' : ''}>全部状态</option>
              <option value="scheduled" ${view.stateFilter === 'scheduled' ? 'selected' : ''}>scheduled</option>
              <option value="paused" ${view.stateFilter === 'paused' ? 'selected' : ''}>paused</option>
              <option value="completed" ${view.stateFilter === 'completed' ? 'selected' : ''}>completed</option>
              <option value="error" ${view.stateFilter === 'error' ? 'selected' : ''}>error</option>
            </select>
            ${buttonHtml({ action: 'apply-filter', label: '应用筛选', kind: 'primary' })}
            ${buttonHtml({ action: 'clear-filter', label: '清空筛选' })}
          </div>
          ${renderJobList(view, state)}
        </aside>
        <div class="workspace-main-card">
          ${workbenchMain}
        </div>
      </div>
    </section>
  `;

  bindEvents(view, {
    configIntent,
    diagnosticsIntent,
    extensionsIntent,
    gatewayIntent,
    logsIntent,
  });
}

async function loadData(view, options = {}) {
  const { preferredJobId = null, silent = false } = options;
  const hasData = Boolean(view.snapshot && view.dashboard && view.installation);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [snapshot, dashboard, installation, skills] = await Promise.all([
      api.getCronJobs(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.listSkills(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.snapshot = snapshot;
    view.dashboard = dashboard;
    view.installation = installation;
    view.skills = skills;
    view.selectedId = preferredJobId && snapshot.jobs.some((job) => job.id === preferredJobId)
      ? preferredJobId
      : snapshot.jobs.some((job) => job.id === view.selectedId)
        ? view.selectedId
        : snapshot.jobs[0]?.id ?? null;
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

async function refreshShellAndPage(view, preferredJobId = null) {
  await Promise.all([
    loadShell(view.profile, { silent: true }),
    loadData(view, { preferredJobId, silent: true }),
  ]);
}

async function runJobAction(view, action) {
  const state = deriveState(view);
  const job = state.selectedJob;
  if (!job) {
    notify('error', '请先选择一条作业。');
    return;
  }

  view.runningAction = `cron:${action}`;
  renderPage(view);
  try {
    const result = await api.runCronAction(action, job.id, view.profile);
    storeResult(view, `cron ${action}`, result);
    view.workspaceTab = 'output';
    notify(result.success ? 'success' : 'error', result.success ? `cron ${action} 已执行。` : `cron ${action} 失败，请查看输出。`);
    await refreshShellAndPage(view, job.id);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function submitEditor(view) {
  const schedule = view.draft.schedule.trim();
  if (!schedule) {
    notify('error', 'schedule 不能为空。');
    return;
  }

  view.runningAction = view.editorMode === 'create' ? 'cron:create' : 'cron:update';
  renderPage(view);
  try {
    const repeatValue = view.draft.repeat.trim();
    const repeat = repeatValue ? Number.parseInt(repeatValue, 10) : null;
    if (repeatValue && Number.isNaN(repeat)) {
      notify('error', 'repeat 必须是整数。');
      return;
    }

    let result = null;
    let preferredJobId = null;

    if (view.editorMode === 'create') {
      result = await api.createCronJob({
        deliver: view.draft.deliver.trim() ? view.draft.deliver.trim() : null,
        name: view.draft.name.trim() ? view.draft.name.trim() : null,
        prompt: view.draft.prompt.trim() ? view.draft.prompt : null,
        repeat,
        schedule,
        script: view.draft.script.trim() ? view.draft.script.trim() : null,
        skills: parseSkills(view.draft.skills),
      }, view.profile);
      preferredJobId = extractCreatedJobId(result);
    } else {
      const state = deriveState(view);
      const selectedJob = state.selectedJob;
      if (!selectedJob) {
        notify('error', '请先选择要编辑的作业。');
        return;
      }
      result = await api.updateCronJob({
        clearScript: view.draft.clearScript,
        clearSkills: view.draft.clearSkills,
        deliver: view.draft.deliver.trim() ? view.draft.deliver.trim() : null,
        jobId: selectedJob.id,
        name: view.draft.name.trim() ? view.draft.name.trim() : null,
        prompt: view.draft.prompt,
        repeat,
        schedule,
        script: view.draft.clearScript ? null : (view.draft.script.trim() ? view.draft.script.trim() : null),
        skills: view.draft.clearSkills ? null : parseSkills(view.draft.skills),
      }, view.profile);
      preferredJobId = selectedJob.id;
    }

    storeResult(view, view.editorMode === 'create' ? '创建作业' : '更新作业', result);
    notify(result.success ? 'success' : 'error', result.success ? (view.editorMode === 'create' ? 'cron 作业已创建。' : 'cron 作业已更新。') : 'cron 写入失败，请查看输出。');
    view.workspaceTab = 'output';
    view.editorMode = null;
    view.draft = { ...EMPTY_DRAFT };
    await refreshShellAndPage(view, preferredJobId);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function deleteJob(view) {
  const state = deriveState(view);
  const job = state.selectedJob;
  if (!job) {
    notify('error', '请先选择要删除的作业。');
    return;
  }
  if (view.deleteConfirm.trim() !== job.id) {
    notify('error', '请输入完整的 job_id 完成确认。');
    return;
  }

  view.runningAction = 'cron:delete';
  renderPage(view);
  try {
    const result = await api.deleteCronJob({
      confirmId: view.deleteConfirm.trim(),
      jobId: job.id,
    }, view.profile);
    storeResult(view, '删除作业', result);
    notify(result.success ? 'success' : 'error', result.success ? `cron ${job.name} 已删除。` : `cron ${job.name} 删除失败，请检查命令输出。`);
    view.deleteConfirm = '';
    view.workspaceTab = 'output';
    await refreshShellAndPage(view);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncWithPanelState(view) {
  const shell = getPanelState();
  if (shell.selectedProfile !== view.profile) {
    view.profile = shell.selectedProfile;
    view.snapshot = null;
    view.dashboard = null;
    view.installation = null;
    view.skills = [];
    view.error = null;
    view.selectedId = null;
    void loadData(view);
    return;
  }

  if (!view.loading) {
    renderPage(view);
  }
}

function bindEditorInputs(view) {
  const bindValue = (selector, key) => {
    const node = view.page.querySelector(selector);
    if (!node) {
      return;
    }
    node.addEventListener('input', (event) => {
      view.draft[key] = event.target.value;
    });
  };

  bindValue('#cron-draft-name', 'name');
  bindValue('#cron-draft-schedule', 'schedule');
  bindValue('#cron-draft-deliver', 'deliver');
  bindValue('#cron-draft-repeat', 'repeat');
  bindValue('#cron-draft-skills', 'skills');
  bindValue('#cron-draft-script', 'script');
  bindValue('#cron-draft-prompt', 'prompt');

  view.page.querySelector('#cron-draft-clear-skills')?.addEventListener('change', (event) => {
    view.draft.clearSkills = event.target.checked;
    renderPage(view);
  });

  view.page.querySelector('#cron-draft-clear-script')?.addEventListener('change', (event) => {
    view.draft.clearScript = event.target.checked;
    renderPage(view);
  });
}

function bindEvents(view, intents = {}) {
  bindEditorInputs(view);

  view.page.querySelector('#cron-delete-confirm')?.addEventListener('input', (event) => {
    view.deleteConfirm = event.target.value;
    const button = view.page.querySelector('[data-action="delete-job"]');
    const state = deriveState(view);
    const ready = state.selectedJob && view.deleteConfirm.trim() === state.selectedJob.id;
    if (button) {
      button.disabled = Boolean(view.runningAction) || !ready;
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
          await refreshShellAndPage(view, deriveState(view).selectedJob?.id ?? null);
          return;
        case 'switch-workspace-tab':
          view.workspaceTab = element.getAttribute('data-tab') || 'detail';
          renderPage(view);
          return;
        case 'select-job':
          view.selectedId = element.getAttribute('data-id') || null;
          if (view.workspaceTab !== 'editor') {
            view.workspaceTab = 'detail';
          }
          renderPage(view);
          return;
        case 'apply-filter':
          view.query = view.page.querySelector('#cron-query')?.value ?? view.query;
          view.stateFilter = view.page.querySelector('#cron-state-filter')?.value ?? view.stateFilter;
          renderPage(view);
          return;
        case 'clear-filter':
          view.query = '';
          view.stateFilter = 'all';
          renderPage(view);
          return;
        case 'open-create-editor':
          view.editorMode = 'create';
          view.draft = { ...EMPTY_DRAFT };
          view.workspaceTab = 'editor';
          renderPage(view);
          return;
        case 'open-edit-editor': {
          const state = deriveState(view);
          if (!state.selectedJob) {
            notify('error', '请先选择要编辑的作业。');
            return;
          }
          view.editorMode = 'edit';
          view.draft = buildDraftFromJob(state.selectedJob);
          view.workspaceTab = 'editor';
          renderPage(view);
          return;
        }
        case 'close-editor':
          view.editorMode = null;
          view.draft = { ...EMPTY_DRAFT };
          renderPage(view);
          return;
        case 'submit-editor':
          await submitEditor(view);
          return;
        case 'run-job':
          await runJobAction(view, 'run');
          return;
        case 'pause-job':
          await runJobAction(view, 'pause');
          return;
        case 'resume-job':
          await runJobAction(view, 'resume');
          return;
        case 'delete-job':
          await deleteJob(view);
          return;
        case 'open-jobs-file':
          await openFinderLocation({
            actionKey: 'cron:open-jobs-file',
            label: 'jobs.json',
            notify,
            onResult: (label, result) => {
              storeResult(view, label, result);
            },
            path: view.snapshot?.jobsPath || '',
            revealInFinder: true,
            setBusy: (value) => {
              view.runningAction = value;
              renderPage(view);
            },
          });
          return;
        case 'open-cron-dir':
          await openFinderLocation({
            actionKey: 'cron:open-dir',
            label: 'cron 目录',
            notify,
            onResult: (label, result) => {
              storeResult(view, label, result);
            },
            path: directoryOf(view.snapshot?.jobsPath || ''),
            revealInFinder: false,
            setBusy: (value) => {
              view.runningAction = value;
              renderPage(view);
            },
          });
          return;
        case 'goto-skills':
          navigate('skills');
          return;
        case 'goto-memory':
          navigate('memory');
          return;
        case 'goto-logs':
          navigate('logs', intents.logsIntent);
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', intents.diagnosticsIntent);
          return;
        case 'goto-config':
          navigate('config', intents.configIntent);
          return;
        case 'goto-gateway':
          navigate('gateway', intents.gatewayIntent);
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
    dashboard: null,
    deleteConfirm: '',
    destroyed: false,
    draft: { ...EMPTY_DRAFT },
    editorMode: null,
    error: null,
    installation: null,
    lastResult: null,
    loading: true,
    page,
    profile: getPanelState().selectedProfile,
    query: '',
    refreshing: false,
    runningAction: null,
    selectedId: null,
    skills: [],
    snapshot: null,
    stateFilter: 'all',
    unsubscribe: null,
    workspaceTab: 'detail',
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
