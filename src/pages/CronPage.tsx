import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import { formatTimestamp, truncate } from '../lib/format';
import { cronTone, hasCronFailure, isRemoteDelivery } from '../lib/runtime';
import type {
  CommandRunResult,
  CronCreateRequest,
  CronDeleteRequest,
  CronJobItem,
  CronJobsSnapshot,
  CronUpdateRequest,
  DashboardSnapshot,
  SkillItem,
} from '../types';
import { Button, EmptyState, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import type { PageProps } from './types';

type EditorMode = 'create' | 'edit' | null;
type CronTabKey = 'overview' | 'jobs' | 'editor';
type CronOverviewViewKey = 'launch' | 'status' | 'links';
type CronJobViewKey = 'summary' | 'closure' | 'prompt' | 'history';
type CronJobsWorkspaceViewKey = 'pick' | 'focus';
type CronEditorViewKey = 'form' | 'danger' | 'output';

interface CronEditorDraft {
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
  repeat: string;
  skills: string;
  script: string;
  clearSkills: boolean;
  clearScript: boolean;
}

const EMPTY_DRAFT: CronEditorDraft = {
  name: '',
  schedule: '',
  prompt: '',
  deliver: 'local',
  repeat: '',
  skills: '',
  script: '',
  clearSkills: false,
  clearScript: false,
};

const CRON_TABS: Array<{ key: CronTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先判断自动化链路是否完整，再决定下一步。' },
  { key: 'jobs', label: '作业与闭环', hint: '筛选作业、看详情，并直接触发常用动作。' },
  { key: 'editor', label: '编辑与回执', hint: '低频编辑、删除确认和原始回执统一收在这里。' },
];

const DEFAULT_VISIBLE_CRON_JOBS = 8;

const CRON_OVERVIEW_VIEWS: Array<{
  key: CronOverviewViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'launch', label: '常用入口', icon: '🧭', hint: '只保留最常用的入口，先决定要去作业、技能还是日志。' },
  { key: 'status', label: '当前判断', icon: '🩺', hint: '把自动化规模、远端投递、技能缺口和记忆状态压成一个工作面。' },
  { key: 'links', label: '辅助入口', icon: '🧰', hint: '文件定位和跨页联动继续后置，需要时再展开。' },
];

const CRON_JOB_VIEWS: Array<{
  key: CronJobViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'summary', label: '基础摘要', icon: '🧭', hint: '先看调度、投递和最近运行时间，确认是不是这条任务本身有问题。' },
  { key: 'closure', label: '闭环关系', icon: '🔗', hint: '需要判断 skills、memory、gateway 是否同一条链路时，再展开这里。' },
  { key: 'prompt', label: 'Prompt', icon: '📝', hint: '只有在你真要读任务正文时，再看完整 prompt。' },
  { key: 'history', label: '运行痕迹', icon: '🧾', hint: '把 last status、错误和重复次数收在这一层，不再默认铺满。' },
];

const CRON_EDITOR_VIEWS: Array<{
  key: CronEditorViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'form', label: '编辑表单', icon: '✏️', hint: '新建和修改都只在这一层完成，避免平时被低频表单打断。' },
  { key: 'danger', label: '删除确认', icon: '🧯', hint: '危险操作后置到单独层级，只有明确要删作业时再进入。' },
  { key: 'output', label: '命令回执', icon: '🧾', hint: '创建、修改、删除和立即触发的 Hermes 原始输出统一收在这里。' },
];

function parseSkills(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDraftFromJob(job: CronJobItem): CronEditorDraft {
  return {
    name: job.name,
    schedule: job.scheduleInput || job.scheduleDisplay,
    prompt: job.prompt,
    deliver: job.deliver,
    repeat: job.repeatTimes == null ? '' : String(job.repeatTimes),
    skills: job.skills.join(', '),
    script: job.script ?? '',
    clearSkills: false,
    clearScript: false,
  };
}

function extractCreatedJobId(result: CommandRunResult) {
  const match = result.stdout.match(/Created job:\s*([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

export function CronPage({ notify, profile, navigate }: PageProps) {
  const [snapshot, setSnapshot] = useState<CronJobsSnapshot | null>(null);
  const [runtime, setRuntime] = useState<DashboardSnapshot | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [draft, setDraft] = useState<CronEditorDraft>(EMPTY_DRAFT);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [activeTab, setActiveTab] = useState<CronTabKey>('overview');
  const [overviewView, setOverviewView] = useState<CronOverviewViewKey>('launch');
  const [jobsWorkspaceView, setJobsWorkspaceView] = useState<CronJobsWorkspaceViewKey>('pick');
  const [jobView, setJobView] = useState<CronJobViewKey>('summary');
  const [editorView, setEditorView] = useState<CronEditorViewKey>('form');
  const [showFilters, setShowFilters] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);

  async function load(preferredJobId?: string) {
    setLoading(true);
    try {
      const [nextCron, nextRuntime, nextSkills] = await Promise.all([
        api.getCronJobs(profile),
        api.getDashboardSnapshot(profile),
        api.listSkills(profile),
      ]);
      setSnapshot(nextCron);
      setRuntime(nextRuntime);
      setSkills(nextSkills);
      setSelectedId((current) => {
        const candidate = preferredJobId ?? current;
        if (candidate && nextCron.jobs.some((job) => job.id === candidate)) {
          return candidate;
        }
        return nextCron.jobs[0]?.id ?? null;
      });
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    setEditorMode(null);
    setDraft(EMPTY_DRAFT);
    setDeleteConfirm('');
    setActiveTab('overview');
    setOverviewView('launch');
    setJobsWorkspaceView('pick');
    setJobView('summary');
    setEditorView('form');
    setShowFilters(false);
    setShowAllJobs(false);
  }, [profile]);

  const jobs = snapshot?.jobs ?? [];
  const skillNameSet = useMemo(() => new Set(skills.map((item) => item.name)), [skills]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesState = stateFilter === 'all' || job.state === stateFilter;
      const matchesQuery = !normalizedQuery
        || [
          job.id,
          job.name,
          job.prompt,
          job.deliver,
          job.skills.join(' '),
          job.scheduleDisplay,
          job.script ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesState && matchesQuery;
    });
  }, [jobs, query, stateFilter]);

  const selectedJob = filteredJobs.find((job) => job.id === selectedId)
    ?? jobs.find((job) => job.id === selectedId)
    ?? filteredJobs[0]
    ?? null;

  useEffect(() => {
    if (!selectedJob) {
      setSelectedId(null);
      return;
    }
    if (selectedId !== selectedJob.id) {
      setSelectedId(selectedJob.id);
    }
  }, [selectedId, selectedJob]);

  useEffect(() => {
    setDeleteConfirm('');
    setJobView('summary');
  }, [selectedJob?.id]);

  const enabledCount = jobs.filter((job) => job.enabled && job.state !== 'paused').length;
  const failingJobs = jobs.filter(hasCronFailure);
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const jobsWithSkills = jobs.filter((job) => job.skills.length > 0);
  const referencedSkillNames = Array.from(new Set(jobs.flatMap((job) => job.skills)));
  const missingReferencedSkills = referencedSkillNames.filter((name) => !skillNameSet.has(name));
  const selectedMissingSkills = selectedJob?.skills.filter((name) => !skillNameSet.has(name)) ?? [];
  const selectedMatchedSkills = selectedJob
    ? skills.filter((skill) => selectedJob.skills.includes(skill.name))
    : [];
  const runtimeWarnings: string[] = [];

  if (!jobs.length) {
    runtimeWarnings.push('当前 profile 还没有任何 cron 作业，自动化闭环还没真正建立。');
  }
  if (missingReferencedSkills.length > 0) {
    runtimeWarnings.push(`存在 ${missingReferencedSkills.length} 个被作业引用但当前未扫描到的 skill：${missingReferencedSkills.join('、')}。`);
  }
  if (runtime?.gateway?.gatewayState !== 'running' && remoteJobs.length > 0) {
    runtimeWarnings.push(`当前有 ${remoteJobs.length} 个远端投递作业，但 gateway 未运行，消息平台投递链路大概率不可用。`);
  }
  if (runtime?.config.memoryEnabled === false && jobsWithSkills.length > 0) {
    runtimeWarnings.push('memory 当前关闭，自动化任务虽然还能跑，但很难积累长期偏好和工作记忆。');
  }
  if (!skills.length && jobsWithSkills.length > 0) {
    runtimeWarnings.push('当前没有扫描到本地 skills，但已有 cron 作业声明了 skills，说明运行能力面可能不完整。');
  }
  const overviewWarnings = runtimeWarnings.slice(0, 4);
  const remainingOverviewWarningCount = Math.max(0, runtimeWarnings.length - overviewWarnings.length);
  const cronStartReadiness = !jobs.length
    ? '先创建第一条自动化'
    : runtime?.gateway?.gatewayState !== 'running' && remoteJobs.length > 0
      ? '先修远端投递链路'
      : missingReferencedSkills.length > 0
        ? '先补齐技能引用'
        : failingJobs.length > 0
          ? '先处理异常作业'
          : runtime?.config.memoryEnabled === false && jobsWithSkills.length > 0
            ? '建议补上记忆能力'
            : '自动化主链路稳定';
  const cronStartHint = !jobs.length
    ? '先新建一条最小可运行任务，再回来检查技能、投递和记忆是否连通。'
    : runtime?.gateway?.gatewayState !== 'running' && remoteJobs.length > 0
      ? '当前已有远端投递任务，先把 gateway 恢复起来，再看日志与平台通道。'
      : missingReferencedSkills.length > 0
        ? '作业已引用技能但本地不完整，先补齐能力面，避免任务名义上能跑、实际无法闭环。'
        : failingJobs.length > 0
          ? '当前已经有异常作业，先锁定一条任务核对日志和最近回执。'
          : runtime?.config.memoryEnabled === false && jobsWithSkills.length > 0
            ? '调度和技能基本在位，但记忆关闭后长期偏好和上下文难以沉淀。'
            : '可以直接在“作业与闭环”里挑一条任务做验证或继续优化。';
  const visibleJobs = showAllJobs ? filteredJobs : filteredJobs.slice(0, DEFAULT_VISIBLE_CRON_JOBS);
  const hiddenJobCount = Math.max(0, filteredJobs.length - visibleJobs.length);
  const activeOverviewView = CRON_OVERVIEW_VIEWS.find((item) => item.key === overviewView) ?? CRON_OVERVIEW_VIEWS[0];
  const activeJobView = CRON_JOB_VIEWS.find((item) => item.key === jobView) ?? CRON_JOB_VIEWS[0];
  const activeEditorView = CRON_EDITOR_VIEWS.find((item) => item.key === editorView) ?? CRON_EDITOR_VIEWS[0];

  function openCreateEditor() {
    setEditorMode('create');
    setDraft(EMPTY_DRAFT);
    setActiveTab('editor');
    setEditorView('form');
  }

  function openEditEditor() {
    if (!selectedJob) return;
    setEditorMode('edit');
    setDraft(buildDraftFromJob(selectedJob));
    setActiveTab('editor');
    setEditorView('form');
  }

  function closeEditor(nextView: CronEditorViewKey = 'form') {
    setEditorMode(null);
    setDraft(EMPTY_DRAFT);
    setEditorView(nextView);
  }

  async function runAction(action: 'pause' | 'resume' | 'run') {
    if (!selectedJob) return;
    setRunningAction(action);
    try {
      const result = await api.runCronAction(action, selectedJob.id, profile);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `cron ${action} 已执行。`);
      await load(selectedJob.id);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function submitEditor() {
    const schedule = draft.schedule.trim();
    if (!schedule) {
      notify('error', 'schedule 不能为空。');
      return;
    }

    setRunningAction(editorMode === 'create' ? 'create' : 'edit');
    try {
      const skillsValue = parseSkills(draft.skills);
      const repeatValue = draft.repeat.trim();
      const repeat = repeatValue ? Number.parseInt(repeatValue, 10) : null;
      if (repeatValue && Number.isNaN(repeat)) {
        notify('error', 'repeat 必须是整数。');
        return;
      }

      let result: CommandRunResult;
      if (editorMode === 'create') {
        const request: CronCreateRequest = {
          schedule,
          prompt: draft.prompt.trim() ? draft.prompt : null,
          name: draft.name.trim() ? draft.name : null,
          deliver: draft.deliver.trim() ? draft.deliver : null,
          repeat,
          skills: skillsValue,
          script: draft.script.trim() ? draft.script : null,
        };
        result = await api.createCronJob(request, profile);
      } else if (editorMode === 'edit' && selectedJob) {
        const request: CronUpdateRequest = {
          jobId: selectedJob.id,
          schedule,
          prompt: draft.prompt,
          name: draft.name.trim() ? draft.name : null,
          deliver: draft.deliver.trim() ? draft.deliver : null,
          repeat,
          skills: draft.clearSkills ? null : skillsValue,
          clearSkills: draft.clearSkills,
          script: draft.clearScript ? null : (draft.script.trim() ? draft.script : null),
          clearScript: draft.clearScript,
        };
        result = await api.updateCronJob(request, profile);
      } else {
        return;
      }

      setLastCommand(result);
      notify(
        result.success ? 'success' : 'error',
        editorMode === 'create' ? 'cron 作业已创建。' : 'cron 作业已更新。',
      );

      const createdId = editorMode === 'create' ? extractCreatedJobId(result) : selectedJob?.id;
      await load(createdId ?? undefined);
      closeEditor('output');
      setActiveTab('editor');
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function deleteJob() {
    if (!selectedJob) {
      return;
    }
    if (deleteConfirm.trim() !== selectedJob.id) {
      notify('error', '请先输入完整的 job_id 完成确认。');
      return;
    }

    setRunningAction('delete');
    try {
      const request: CronDeleteRequest = {
        jobId: selectedJob.id,
        confirmId: deleteConfirm.trim(),
      };
      const result = await api.deleteCronJob(request, profile);
      setLastCommand(result);
      if (result.success) {
        closeEditor('output');
        setDeleteConfirm('');
      }
      notify(
        result.success ? 'success' : 'error',
        result.success ? `cron ${selectedJob.name} 已删除。` : `cron ${selectedJob.name} 删除失败，请检查命令输出。`,
      );
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    setRunningAction(`open:${label}`);
    try {
      const result = await api.openInFinder({ path, revealInFinder });
      setLastCommand(result);
      notify(
        result.success ? 'success' : 'error',
        result.success ? `${label} 已在 Finder 中打开。` : `${label} 打开失败，请检查命令输出。`,
      );
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  if (loading && !snapshot) {
    return <LoadingState label="正在构建 Hermes 自动化编排视图。" />;
  }

  const overviewSection = (
    <div className="page-stack">
      <Panel title="总览入口" subtitle="总览页只保留一个主工作面，其他信息继续后置。">
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {CRON_OVERVIEW_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${overviewView === item.key ? 'active' : ''}`}
              onClick={() => setOverviewView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeOverviewView.hint}</p>
      </Panel>

      {overviewView === 'launch' ? (
        <Panel title="常用去向" subtitle="总览页只显式保留最常见的 4 个入口，避免一上来掉进长列表、长表单和原始回执。">
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => {
                setJobsWorkspaceView('focus');
                setActiveTab('jobs');
              }}
            >
              <strong><span className="dashboard-shortcut-icon">⏱️</span>查看焦点作业</strong>
              <span>{selectedJob ? `${selectedJob.name} · ${selectedJob.state} · ${selectedJob.scheduleDisplay}` : jobs.length > 0 ? '进入作业页后锁定最值得先看的任务' : '当前还没有作业，适合先新建一条'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={openCreateEditor}>
              <strong><span className="dashboard-shortcut-icon">➕</span>新建作业</strong>
              <span>{jobs.length === 0 ? '先创建一条最小可运行任务，再回来做闭环检查' : '新增自动化任务时，表单和回执都会收进编辑层'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('skills')}>
              <strong><span className="dashboard-shortcut-icon">🧩</span>核对能力面</strong>
              <span>{missingReferencedSkills.length > 0 ? `${missingReferencedSkills.length} 个技能引用缺口待补齐` : `skills 已扫描 ${skills.length} 个，适合继续看记忆或扩展`}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('logs')}>
              <strong><span className="dashboard-shortcut-icon">🪵</span>看日志排障</strong>
              <span>{failingJobs.length > 0 ? `${failingJobs.length} 条异常作业更适合先去日志页追原因` : remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业可继续联动网关排查` : '当前以本地链路为主，日志按需查看即可'}</span>
            </button>
          </div>
          <p className="helper-text top-gap">首页不再直接铺推荐长卡和材料命令卡，只保留真正高频的动作入口。</p>
        </Panel>
      ) : null}

      {overviewView === 'status' ? (
        <Panel title="当前判断" subtitle="把自动化链路的起步判断、规模、投递和能力缺口压成一层摘要，小白先看这里就够了。">
          <div className="workspace-summary-strip">
            <div className="summary-mini-card">
              <span className="summary-mini-label">起步判断</span>
              <strong className="summary-mini-value">{cronStartReadiness}</strong>
              <span className="summary-mini-meta">{cronStartHint}</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">调度规模</span>
              <strong className="summary-mini-value">{jobs.length === 0 ? '还没有作业' : `${enabledCount}/${jobs.length} 已启用`}</strong>
              <span className="summary-mini-meta">{failingJobs.length > 0 ? `${failingJobs.length} 条异常待处理` : '当前没有明显失败作业'}</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">投递链路</span>
              <strong className="summary-mini-value">{runtime?.gateway?.gatewayState ?? '未检测到'}</strong>
              <span className="summary-mini-meta">{remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业依赖 gateway` : '当前以本地执行或本地投递为主'}</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">能力闭环</span>
              <strong className="summary-mini-value">{missingReferencedSkills.length === 0 ? '技能引用已对齐' : `${missingReferencedSkills.length} 个缺口`}</strong>
              <span className="summary-mini-meta">Memory {runtime?.config.memoryEnabled ? '已开启' : '已关闭'} · {runtime?.config.memoryProvider || 'builtin-file'}</span>
            </div>
          </div>
          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack top-gap">
                {overviewWarnings.map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
              {remainingOverviewWarningCount > 0 ? <p className="helper-text top-gap">其余 {remainingOverviewWarningCount} 条提醒继续收在“作业与闭环”和“编辑与回执”里。</p> : null}
            </>
          ) : (
            <p className="helper-text top-gap">当前自动化链路没有明显结构性问题，可以继续挑一条任务做验证或优化 prompt。</p>
          )}
        </Panel>
      ) : null}

      {overviewView === 'links' ? (
        <Panel title="辅助入口" subtitle="文件定位和跨工作台联动都收在这里，需要时再点进对应页面，不再占主流程。">
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => snapshot?.jobsPath && void openInFinder(snapshot.jobsPath, 'jobs.json', true)}
              disabled={!snapshot?.jobsPath || runningAction !== null}
            >
              <strong><span className="dashboard-shortcut-icon">📄</span>定位 jobs.json</strong>
              <span>{snapshot?.jobsPath || '当前还没有定位到 jobs.json'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('extensions')}>
              <strong><span className="dashboard-shortcut-icon">🛠️</span>看扩展与工具</strong>
              <span>{runtime?.config.toolsets.length ? runtime.config.toolsets.join(' / ') : 'toolsets 还未配置'} · provider {runtime?.config.memoryProvider || 'builtin-file'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('gateway')}>
              <strong><span className="dashboard-shortcut-icon">📡</span>看网关与投递</strong>
              <span>{remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业可能继续依赖 Gateway` : '当前没有明显的远端投递压力'}</span>
            </button>
            <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={() => navigate('diagnostics')}>
              <strong><span className="dashboard-shortcut-icon">🩺</span>继续做诊断</strong>
              <span>{failingJobs.length > 0 ? '先把当前失败作业带去诊断页继续排查' : '需要更深判断时，再去诊断页做完整体检'}</span>
            </button>
          </div>
          <p className="helper-text top-gap">这些都是按需入口，不再以大段 action card 的方式堆满总览页。</p>
        </Panel>
      ) : null}
    </div>
  );

  const jobsSection = (
    <div className="page-stack">
      <Panel
        title="作业工作面"
        subtitle="列表选择和焦点详情不再同屏摊开，先选一种工作模式再继续。"
        aside={(
          <Toolbar>
            <Button kind="primary" onClick={openCreateEditor}>新建作业</Button>
            <Button
              onClick={() => {
                setEditorView('output');
                setActiveTab('editor');
              }}
            >
              最近回执
            </Button>
          </Toolbar>
        )}
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          <button
            type="button"
            className={`workspace-shortcut-card dashboard-shortcut-card ${jobsWorkspaceView === 'pick' ? 'active' : ''}`}
            onClick={() => setJobsWorkspaceView('pick')}
          >
            <strong><span className="dashboard-shortcut-icon">🗂️</span>选择作业</strong>
            <span>{filteredJobs.length > 0 ? `${filteredJobs.length} 条候选作业，先锁定一条再看详情` : '当前没有匹配作业'}</span>
          </button>
          <button
            type="button"
            className={`workspace-shortcut-card dashboard-shortcut-card ${jobsWorkspaceView === 'focus' ? 'active' : ''}`}
            onClick={() => setJobsWorkspaceView('focus')}
          >
            <strong><span className="dashboard-shortcut-icon">🎯</span>查看焦点</strong>
            <span>{selectedJob ? `${selectedJob.name} · ${selectedJob.state}` : filteredJobs.length > 0 ? '先从列表选择一条作业' : '当前没有可查看的焦点任务'}</span>
          </button>
          <button type="button" className="workspace-shortcut-card dashboard-shortcut-card" onClick={openCreateEditor}>
            <strong><span className="dashboard-shortcut-icon">➕</span>新建作业</strong>
            <span>新增自动化任务时，表单和风险操作都继续收在“编辑与回执”里</span>
          </button>
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => {
              setShowFilters((current) => !current);
              setJobsWorkspaceView('pick');
            }}
          >
            <strong><span className="dashboard-shortcut-icon">🔎</span>高频筛选</strong>
            <span>{showFilters ? '当前已展开名称 / skill / delivery / 状态筛选' : '只在需要缩小范围时再展开筛选器'}</span>
          </button>
        </div>
        <p className="helper-text top-gap">
          默认顺序：先在“选择作业”里锁定目标，再切到“查看焦点”；只有在需要改写或删除时，才切到“编辑与回执”。
        </p>
      </Panel>

      {jobsWorkspaceView === 'pick' ? (
        <Panel
          title="作业列表"
          subtitle="默认只显示最值得先看的前几条任务，筛选器也只在需要时展开。"
          aside={(
            <Toolbar>
              {filteredJobs.length > DEFAULT_VISIBLE_CRON_JOBS ? (
                <Button onClick={() => setShowAllJobs((current) => !current)}>
                  {showAllJobs ? '收起列表' : `展开更多${hiddenJobCount > 0 ? `（${hiddenJobCount}）` : ''}`}
                </Button>
              ) : null}
              <Button onClick={() => void load(selectedJob?.id ?? undefined)}>刷新列表</Button>
            </Toolbar>
          )}
        >
          {showFilters ? (
            <Toolbar>
              <input
                className="search-input"
                placeholder="搜索名称、prompt、skill、delivery"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                className="select-input"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="all">全部状态</option>
                <option value="scheduled">scheduled</option>
                <option value="paused">paused</option>
                <option value="completed">completed</option>
                <option value="error">error</option>
              </select>
            </Toolbar>
          ) : null}

          <div className="workspace-summary-strip">
            <div className="summary-mini-card">
              <span className="summary-mini-label">当前命中</span>
              <strong className="summary-mini-value">{`${filteredJobs.length}/${jobs.length}`}</strong>
              <span className="summary-mini-meta">先收窄范围，再锁定最值得先验证的一条任务</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">已启用</span>
              <strong className="summary-mini-value">{enabledCount}</strong>
              <span className="summary-mini-meta">暂停态不会参与当前自动化主流程</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">远端投递</span>
              <strong className="summary-mini-value">{remoteJobs.length}</strong>
              <span className="summary-mini-meta">涉及消息平台时，优先联动网关和日志</span>
            </div>
            <div className="summary-mini-card">
              <span className="summary-mini-label">异常作业</span>
              <strong className="summary-mini-value">{failingJobs.length}</strong>
              <span className="summary-mini-meta">已有异常时，建议优先看最近一条失败任务</span>
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <EmptyState
              title="暂无 cron 作业"
              description="如果当前 profile 还没有 jobs.json 或没有任何作业，这里会保持空态。"
            />
          ) : (
            <div className="list-stack">
              {visibleJobs.map((job) => {
                const missingSkills = job.skills.filter((name) => !skillNameSet.has(name));
                return (
                  <button
                    className={`list-card session-card ${selectedJob?.id === job.id ? 'selected' : ''}`}
                    key={job.id}
                    onClick={() => {
                      setSelectedId(job.id);
                      setJobsWorkspaceView('focus');
                    }}
                    type="button"
                  >
                    <div className="list-card-title">
                      <strong>{job.name}</strong>
                      <div className="pill-row">
                        <Pill tone={cronTone(job)}>{job.state}</Pill>
                        <Pill tone={isRemoteDelivery(job.deliver) ? 'warn' : 'neutral'}>{job.deliver}</Pill>
                        {missingSkills.length > 0 ? <Pill tone="bad">缺 skill</Pill> : null}
                      </div>
                    </div>
                    <p>{truncate(job.prompt || '无 prompt', 108)}</p>
                    <div className="meta-line">
                      <span>{job.scheduleDisplay}</span>
                      <span>{formatTimestamp(job.nextRunAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {hiddenJobCount > 0 && !showAllJobs ? (
            <p className="helper-text top-gap">其余 {hiddenJobCount} 条任务已收起，需要时再展开查看。</p>
          ) : null}
        </Panel>
      ) : null}

      {jobsWorkspaceView === 'focus' ? (
        <Panel
          title="当前焦点作业"
          subtitle={selectedJob ? '这里只保留当前作业的简明摘要和一个按需展开的子模块。' : '先从左侧列表选一条作业，再继续看详情。'}
          aside={selectedJob ? (
            <Toolbar>
              <Button onClick={openEditEditor} disabled={runningAction !== null}>编辑</Button>
              <Button
                onClick={() => void runAction('run')}
                disabled={runningAction !== null}
                kind="primary"
              >
                {runningAction === 'run' ? '触发中…' : '立即触发'}
              </Button>
              <Button
                onClick={() => void runAction('pause')}
                disabled={runningAction !== null || !selectedJob.enabled || selectedJob.state === 'paused'}
              >
                {runningAction === 'pause' ? '暂停中…' : '暂停'}
              </Button>
              <Button
                onClick={() => void runAction('resume')}
                disabled={runningAction !== null || selectedJob.state !== 'paused'}
              >
                {runningAction === 'resume' ? '恢复中…' : '恢复'}
              </Button>
            </Toolbar>
          ) : undefined}
        >
          {selectedJob ? (
            <div className="page-stack">
              <div className="workspace-summary-strip">
                <div className="summary-mini-card">
                  <span className="summary-mini-label">状态</span>
                  <strong className="summary-mini-value">{selectedJob.state}</strong>
                  <span className="summary-mini-meta">{selectedJob.enabled ? '当前处于启用态' : '当前未启用'}</span>
                </div>
                <div className="summary-mini-card">
                  <span className="summary-mini-label">调度</span>
                  <strong className="summary-mini-value">{selectedJob.scheduleDisplay}</strong>
                  <span className="summary-mini-meta">下次 {formatTimestamp(selectedJob.nextRunAt)}</span>
                </div>
                <div className="summary-mini-card">
                  <span className="summary-mini-label">投递</span>
                  <strong className="summary-mini-value">{selectedJob.deliver}</strong>
                  <span className="summary-mini-meta">{isRemoteDelivery(selectedJob.deliver) ? '远端投递更依赖 Gateway 和平台连通性' : '当前更偏本地执行或原地输出'}</span>
                </div>
                <div className="summary-mini-card">
                  <span className="summary-mini-label">技能</span>
                  <strong className="summary-mini-value">{selectedJob.skills.length === 0 ? '未绑定' : `${selectedMatchedSkills.length}/${selectedJob.skills.length}`}</strong>
                  <span className="summary-mini-meta">{selectedMissingSkills.length > 0 ? `${selectedMissingSkills.length} 个技能未匹配` : '当前技能引用已对齐'}</span>
                </div>
              </div>

              <div className="workspace-shortcut-grid dashboard-launcher-grid">
                {CRON_JOB_VIEWS.map((item) => {
                  const meta = item.key === 'summary'
                    ? `${selectedJob.id} · ${selectedJob.scheduleInput || selectedJob.scheduleDisplay}`
                    : item.key === 'closure'
                      ? (selectedMissingSkills.length > 0 ? `${selectedMissingSkills.length} 个技能缺口待补齐` : 'skills / memory / gateway 关系可继续核对')
                      : item.key === 'prompt'
                        ? truncate(selectedJob.prompt || '当前没有 prompt 内容', 72)
                        : (selectedJob.lastError || selectedJob.lastDeliveryError || selectedJob.lastStatus || '当前没有新的错误或运行痕迹');

                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`workspace-shortcut-card dashboard-shortcut-card ${jobView === item.key ? 'active' : ''}`}
                      onClick={() => setJobView(item.key)}
                    >
                      <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                      <span>{meta}</span>
                    </button>
                  );
                })}
              </div>
              <p className="helper-text top-gap">{activeJobView.hint}</p>

              {jobView === 'summary' ? (
                <Panel className="panel-nested" title="基础摘要" subtitle="这里只保留最常用的调度字段和最近运行信息。">
                  <div className="detail-list compact">
                    <KeyValueRow label="ID" value={selectedJob.id} />
                    <KeyValueRow label="调度输入" value={selectedJob.scheduleInput || '—'} />
                    <KeyValueRow label="上次运行" value={formatTimestamp(selectedJob.lastRunAt)} />
                    <KeyValueRow label="重复次数" value={selectedJob.repeatTimes == null ? '∞' : `${selectedJob.repeatCompleted}/${selectedJob.repeatTimes}`} />
                    <KeyValueRow label="脚本" value={selectedJob.script || '—'} />
                    <KeyValueRow label="最后状态" value={selectedJob.lastStatus || '—'} />
                  </div>
                </Panel>
              ) : null}

              {jobView === 'closure' ? (
                <Panel className="panel-nested" title="自动化闭环" subtitle="需要判断 Prompt、Skills、Memory 和 Delivery 是不是同一条链路时，再展开这里。">
                  <div className="health-grid">
                    <section className="health-card">
                      <div className="health-card-header">
                        <strong>Prompt / Script</strong>
                        <Pill tone={selectedJob.prompt || selectedJob.script ? 'good' : 'warn'}>
                          {selectedJob.script ? '带脚本' : selectedJob.prompt ? 'Prompt 驱动' : '空'}
                        </Pill>
                      </div>
                      <p>{selectedJob.script ? `脚本: ${selectedJob.script}` : '当前以 Hermes prompt 作为任务主体。'}</p>
                    </section>
                    <section className="health-card">
                      <div className="health-card-header">
                        <strong>Skills</strong>
                        <Pill tone={selectedJob.skills.length === 0 ? 'neutral' : selectedMissingSkills.length === 0 ? 'good' : 'bad'}>
                          {selectedJob.skills.length === 0 ? '未绑定' : `${selectedMatchedSkills.length}/${selectedJob.skills.length} 已匹配`}
                        </Pill>
                      </div>
                      <p>{selectedJob.skills.length === 0 ? '当前没有显式 skill 绑定。' : selectedJob.skills.join('、')}</p>
                    </section>
                    <section className="health-card">
                      <div className="health-card-header">
                        <strong>Memory</strong>
                        <Pill tone={runtime?.config.memoryEnabled ? 'good' : 'warn'}>
                          {runtime?.config.memoryEnabled ? '已开启' : '已关闭'}
                        </Pill>
                      </div>
                      <p>Provider {runtime?.config.memoryProvider || 'builtin-file'} · 用户画像 {String(runtime?.config.userProfileEnabled ?? false)}</p>
                    </section>
                    <section className="health-card">
                      <div className="health-card-header">
                        <strong>Delivery / Gateway</strong>
                        <Pill tone={!isRemoteDelivery(selectedJob.deliver) || runtime?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                          {isRemoteDelivery(selectedJob.deliver) ? '远端投递' : '本地投递'}
                        </Pill>
                      </div>
                      <p>{isRemoteDelivery(selectedJob.deliver) ? '远端投递通常依赖 gateway 和平台连接。' : '当前作业更偏本地执行或原地输出。'}</p>
                    </section>
                  </div>

                  {selectedMissingSkills.length > 0 ? (
                    <div className="warning-stack top-gap">
                      <div className="warning-item">
                        这条作业引用了缺失技能：{selectedMissingSkills.join('、')}。建议先去技能页或 Finder 确认 skill 文件是否存在。
                      </div>
                    </div>
                  ) : null}

                  <Toolbar>
                    <Button onClick={() => navigate('skills')}>查看 Skills</Button>
                    <Button onClick={() => navigate('memory')}>查看 Memory</Button>
                    <Button onClick={() => navigate('logs')}>查看 Logs</Button>
                    <Button onClick={() => navigate('diagnostics')}>查看 Diagnostics</Button>
                  </Toolbar>
                </Panel>
              ) : null}

              {jobView === 'prompt' ? (
                <Panel className="panel-nested" title="Prompt" subtitle="这里只保留任务正文，不和其他运行信息混排。">
                  <pre className="code-block">{selectedJob.prompt || '无 prompt 内容'}</pre>
                </Panel>
              ) : null}

              {jobView === 'history' ? (
                <Panel className="panel-nested" title="运行痕迹" subtitle="最近状态、错误和投递异常都集中在这里。">
                  <div className="detail-list compact">
                    <KeyValueRow label="最后状态" value={selectedJob.lastStatus || '—'} />
                    <KeyValueRow label="最后错误" value={selectedJob.lastError || '—'} />
                    <KeyValueRow label="投递错误" value={selectedJob.lastDeliveryError || '—'} />
                    <KeyValueRow label="上次运行" value={formatTimestamp(selectedJob.lastRunAt)} />
                    <KeyValueRow label="下次运行" value={formatTimestamp(selectedJob.nextRunAt)} />
                    <KeyValueRow label="重复进度" value={selectedJob.repeatTimes == null ? '∞' : `${selectedJob.repeatCompleted}/${selectedJob.repeatTimes}`} />
                  </div>
                </Panel>
              ) : null}
            </div>
          ) : (
            <div className="page-stack">
              <EmptyState title="未选择作业" description="先切回“选择作业”锁定一条 cron 任务，再回来查看详情与闭环关系。" />
              <Toolbar>
                <Button kind="primary" onClick={() => setJobsWorkspaceView('pick')}>回到选择作业</Button>
              </Toolbar>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );

  const editorSection = (
    <div className="page-stack">
      <Panel
        title="编辑与回执入口"
        subtitle="表单、删除确认和原始回执默认一次只展开一个子模块，避免高风险操作和长输出同时挤在眼前。"
        aside={(
          <Toolbar>
            <Button kind="primary" onClick={openCreateEditor}>新建作业</Button>
            <Button onClick={openEditEditor} disabled={!selectedJob}>编辑当前</Button>
            <Button onClick={() => setActiveTab('jobs')} disabled={!selectedJob}>回到作业页</Button>
          </Toolbar>
        )}
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {CRON_EDITOR_VIEWS.map((item) => {
            const meta = item.key === 'form'
              ? (editorMode ? `${editorMode === 'create' ? '正在新建' : '正在编辑'} ${selectedJob?.name ?? '作业'}` : selectedJob ? `当前焦点：${selectedJob.name}` : '先新建或选中一条作业')
              : item.key === 'danger'
                ? (selectedJob ? `删除确认会要求输入 ${selectedJob.id}` : '先选择一条作业')
                : (lastCommand ? `${lastCommand.command} · exit ${lastCommand.exitCode}` : '最近还没有 Hermes CLI 回执');

            return (
              <button
                key={item.key}
                type="button"
                className={`workspace-shortcut-card dashboard-shortcut-card ${editorView === item.key ? 'active' : ''}`}
                onClick={() => setEditorView(item.key)}
              >
                <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                <span>{meta}</span>
              </button>
            );
          })}
        </div>
        <p className="helper-text top-gap">{activeEditorView.hint}</p>
      </Panel>

      {editorView === 'form' ? (
        <Panel
          title={editorMode === 'create' ? '新建作业' : editorMode === 'edit' ? '编辑作业' : '作业编辑器'}
          subtitle={editorMode
            ? '新增和修改都只在这里完成，避免把表单、删除确认和回执输出混在一起。'
            : '只有在需要调整 jobs.json 内容时，再进入这一层做编辑。'}
          className="panel-nested"
          aside={(
            <Toolbar>
              {editorMode ? <Button onClick={() => closeEditor()} disabled={runningAction !== null}>取消</Button> : null}
              <Button kind="primary" onClick={() => void submitEditor()} disabled={runningAction !== null || editorMode === null}>
                {runningAction === 'create' || runningAction === 'edit' ? '提交中…' : editorMode === 'create' ? '创建' : '保存修改'}
              </Button>
            </Toolbar>
          )}
        >
          {editorMode ? (
            <>
              <div className="form-grid">
                <label className="field-stack">
                  <span>名称</span>
                  <input
                    className="search-input"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="日报汇总"
                  />
                </label>

                <label className="field-stack">
                  <span>调度</span>
                  <input
                    className="search-input"
                    value={draft.schedule}
                    onChange={(event) => setDraft((current) => ({ ...current, schedule: event.target.value }))}
                    placeholder="every 2h / 0 9 * * * / 2026-04-12T09:00:00"
                  />
                </label>

                <label className="field-stack">
                  <span>交付</span>
                  <input
                    className="search-input"
                    value={draft.deliver}
                    onChange={(event) => setDraft((current) => ({ ...current, deliver: event.target.value }))}
                    placeholder="local / origin / telegram:chat_id"
                  />
                </label>

                <label className="field-stack">
                  <span>重复次数</span>
                  <input
                    className="search-input"
                    value={draft.repeat}
                    onChange={(event) => setDraft((current) => ({ ...current, repeat: event.target.value }))}
                    placeholder="留空表示无限或保持现状"
                  />
                </label>

                <label className="field-stack">
                  <span>技能</span>
                  <input
                    className="search-input"
                    value={draft.skills}
                    onChange={(event) => setDraft((current) => ({ ...current, skills: event.target.value }))}
                    placeholder="skill-a, skill-b"
                    disabled={draft.clearSkills}
                  />
                </label>

                <label className="field-stack">
                  <span>脚本</span>
                  <input
                    className="search-input"
                    value={draft.script}
                    onChange={(event) => setDraft((current) => ({ ...current, script: event.target.value }))}
                    placeholder="/absolute/path/to/script.py"
                    disabled={draft.clearScript}
                  />
                </label>
              </div>

              <div className="checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.clearSkills}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      clearSkills: event.target.checked,
                    }))}
                  />
                  <span>清空技能列表</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.clearScript}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      clearScript: event.target.checked,
                    }))}
                  />
                  <span>清空脚本</span>
                </label>
              </div>

              <label className="field-stack">
                <span>Prompt</span>
                <textarea
                  className="editor"
                  value={draft.prompt}
                  onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                  spellCheck={false}
                  placeholder="输入自包含 prompt，或搭配 skill 作为任务说明。"
                />
              </label>

              <p className="helper-text">
                `schedule` 直接对齐 Hermes CLI，支持 `30m`、`every 2h`、`0 9 * * *` 和 ISO 时间。
              </p>
            </>
          ) : (
            <div className="page-stack">
              <EmptyState
                title="编辑器待命"
                description="先从作业页选中一条任务再编辑，或者直接新建一条新的自动化任务。"
              />
              {selectedJob ? (
                <div className="detail-list compact">
                  <KeyValueRow label="当前作业" value={selectedJob.name} />
                  <KeyValueRow label="调度" value={selectedJob.scheduleDisplay} />
                  <KeyValueRow label="交付" value={selectedJob.deliver} />
                  <KeyValueRow label="技能" value={selectedJob.skills.length ? selectedJob.skills.join(', ') : '—'} />
                </div>
              ) : null}
              <Toolbar>
                <Button onClick={() => navigate('config')}>核对配置页</Button>
                <Button onClick={() => navigate('skills')}>核对 Skills</Button>
                <Button onClick={() => navigate('logs')}>查看 Logs</Button>
              </Toolbar>
            </div>
          )}
        </Panel>
      ) : null}

      {editorView === 'danger' ? (
        <Panel
          title="危险区"
          className="panel-nested panel-danger"
          aside={(
            <Toolbar>
              <Button
                kind="danger"
                onClick={() => void deleteJob()}
                disabled={!selectedJob || deleteConfirm.trim() !== selectedJob.id || runningAction !== null}
              >
                {runningAction === 'delete' ? '删除中…' : '删除作业'}
              </Button>
            </Toolbar>
          )}
        >
          {selectedJob ? (
            <>
              <div className="danger-copy">
                <strong>⚠️ 危险操作检测！</strong>
                <p>操作类型：删除 Hermes cron 作业</p>
                <p>影响范围：{snapshot?.jobsPath ?? '当前 profile 的 cron/jobs.json'}</p>
                <p>风险评估：会从当前 profile 的调度列表中移除 `{selectedJob.name}`，后续将不再按计划执行。</p>
              </div>
              <label className="field-stack">
                <span>请输入 `{selectedJob.id}` 以确认删除</span>
                <input
                  className="search-input"
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  placeholder={selectedJob.id}
                />
              </label>
              <p className="helper-text">
                这个确认只存在于 HermesPanel 包装层，底层仍然调用原生 `hermes cron remove {selectedJob.id}`。
              </p>
            </>
          ) : (
            <EmptyState title="未选择作业" description="选择一条 cron 作业后才能进入删除确认。" />
          )}
        </Panel>
      ) : null}

      {editorView === 'output' ? (
        <Panel title="命令输出" className="panel-nested">
          {lastCommand ? (
            <>
              <div className="detail-list compact">
                <KeyValueRow label="命令" value={lastCommand.command} />
                <KeyValueRow label="退出码" value={lastCommand.exitCode} />
                <KeyValueRow label="结果" value={String(lastCommand.success)} />
              </div>
              <pre className="code-block">{lastCommand.stdout || lastCommand.stderr || '无输出'}</pre>
            </>
          ) : (
            <EmptyState title="尚未执行操作" description="这里会显示 create / edit / pause / resume / run / delete 的 Hermes CLI 输出。" />
          )}
        </Panel>
      ) : null}
    </div>
  );

  return (
    <div className="page-stack">
      <Panel
        title="自动化编排台"
        subtitle="先用常用总览判断自动化链路，再去作业与闭环，最后才进编辑与回执。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load(selectedJob?.id ?? undefined)}>刷新</Button>
            <Button kind="primary" onClick={openCreateEditor}>新建作业</Button>
          </Toolbar>
        )}
      >
        <p className="helper-text">
          一个 cron 作业真正跑通，不只是调度时间正确，还要看技能引用是否存在、memory 是否开启、gateway 是否能把结果投递出去。
        </p>
        <div className="workspace-summary-strip top-gap">
          <div className="summary-mini-card">
            <span className="summary-mini-label">起步判断</span>
            <strong className="summary-mini-value">{cronStartReadiness}</strong>
            <span className="summary-mini-meta">{cronStartHint}</span>
          </div>
          <div className="summary-mini-card">
            <span className="summary-mini-label">当前 Profile</span>
            <strong className="summary-mini-value">{profile}</strong>
            <span className="summary-mini-meta">{snapshot?.jobsPath ?? 'jobs.json 尚未定位'}</span>
          </div>
          <div className="summary-mini-card">
            <span className="summary-mini-label">作业规模</span>
            <strong className="summary-mini-value">{jobs.length === 0 ? '尚无作业' : `${jobs.length} 条作业`}</strong>
            <span className="summary-mini-meta">{enabledCount} 已启用 · {failingJobs.length} 条异常</span>
          </div>
          <div className="summary-mini-card">
            <span className="summary-mini-label">远端与技能</span>
            <strong className="summary-mini-value">{remoteJobs.length} 远端 / {missingReferencedSkills.length} 缺口</strong>
            <span className="summary-mini-meta">
              {runtime?.config.memoryEnabled ? '记忆已开启' : '记忆关闭'} · {runtime?.config.memoryProvider || 'builtin-file'}
            </span>
          </div>
        </div>
      </Panel>

      <div className="tab-bar">
        {CRON_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'overview' && runtimeWarnings.length > 0 ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'jobs' && (failingJobs.length > 0 || missingReferencedSkills.length > 0) ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'editor' && (editorMode !== null || lastCommand !== null) ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewSection : null}
      {activeTab === 'jobs' ? jobsSection : null}
      {activeTab === 'editor' ? editorSection : null}
    </div>
  );
}
