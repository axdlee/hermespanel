import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import { formatTimestamp, truncate } from '../lib/format';
import { cronTone, hasCronFailure, isRemoteDelivery, uniqueCount } from '../lib/runtime';
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

  function openCreateEditor() {
    setEditorMode('create');
    setDraft(EMPTY_DRAFT);
    setActiveTab('editor');
  }

  function openEditEditor() {
    if (!selectedJob) return;
    setEditorMode('edit');
    setDraft(buildDraftFromJob(selectedJob));
    setActiveTab('editor');
  }

  function closeEditor() {
    setEditorMode(null);
    setDraft(EMPTY_DRAFT);
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
      closeEditor();
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
        closeEditor();
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
      <div className="two-column wide-left">
        <Panel title="当前判断" subtitle="把健康判断收敛到 Hermes 自动化链路本身，新手先看这里就能知道先修哪一层。">
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Gateway</strong>
                <Pill tone={runtime?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {runtime?.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p>{remoteJobs.length > 0 ? `当前有 ${remoteJobs.length} 个远端投递作业依赖 gateway。` : '当前作业以内投递或本地执行为主。'}</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Skills Coverage</strong>
                <Pill tone={missingReferencedSkills.length === 0 ? 'good' : 'warn'}>
                  {jobs.length === 0 ? '暂无作业' : `${jobsWithSkills.length}/${jobs.length} 个作业声明了 skills`}
                </Pill>
              </div>
              <p>{missingReferencedSkills.length === 0 ? '已引用的技能都能在本地目录中找到。' : `缺失技能：${missingReferencedSkills.join('、')}`}</p>
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
                <strong>Delivery</strong>
                <Pill tone={failingJobs.length === 0 ? 'good' : 'bad'}>
                  {uniqueCount(jobs.map((job) => job.deliver))} 类目标
                </Pill>
              </div>
              <p>{failingJobs.length === 0 ? '最近没有明显失败作业。' : `${failingJobs.length} 个作业带有错误或投递异常。`}</p>
            </section>
          </div>
          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack">
                {overviewWarnings.map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
              {remainingOverviewWarningCount > 0 ? (
                <p className="helper-text top-gap">其余 {remainingOverviewWarningCount} 条提醒继续收在“作业与闭环”和“编辑与回执”里。</p>
              ) : null}
            </>
          ) : (
            <EmptyState title="闭环较完整" description="当前自动化链路没有明显结构性问题，可以继续关注单个作业的 prompt 和投递策略。" />
          )}
        </Panel>

        <Panel title="推荐下一步" subtitle="把新手最常走的自动化路径前置，减少一上来就掉进长列表或原始回执。">
          <div className="list-stack">
            <div className="list-card">
              <div className="list-card-title">
                <strong>先确认作业能不能闭环运行</strong>
                <Pill tone={jobs.length > 0 ? 'good' : 'warn'}>
                  {jobs.length > 0 ? `${jobs.length} 条作业` : '建议先创建'}
                </Pill>
              </div>
              <p>先去作业与闭环里看当前最重要的一条任务，再决定是立即触发、修调度，还是补技能与通道。</p>
              <Toolbar>
                <Button kind="primary" onClick={() => setActiveTab('jobs')}>进入作业工作台</Button>
                <Button onClick={openCreateEditor}>新建作业</Button>
              </Toolbar>
            </div>

            <div className="list-card">
              <div className="list-card-title">
                <strong>再补技能、记忆和模型能力面</strong>
                <Pill tone={missingReferencedSkills.length === 0 && runtime?.config.memoryEnabled ? 'good' : 'warn'}>
                  {missingReferencedSkills.length === 0 ? '能力面可用' : '建议先补齐'}
                </Pill>
              </div>
              <p>自动化不是只有调度，还要确认 skills 能找到、memory 已打开、模型和 provider 能稳定响应。</p>
              <Toolbar>
                <Button onClick={() => navigate('skills')}>技能工作台</Button>
                <Button onClick={() => navigate('memory')}>记忆工作台</Button>
                <Button onClick={() => navigate('config')}>配置中心</Button>
              </Toolbar>
            </div>

            <div className="list-card">
              <div className="list-card-title">
                <strong>最后再看日志和投递链路</strong>
                <Pill tone={runtime?.gateway?.gatewayState === 'running' || remoteJobs.length === 0 ? 'good' : 'warn'}>
                  {remoteJobs.length > 0 ? `${remoteJobs.length} 个远端作业` : '本地为主'}
                </Pill>
              </div>
              <p>如果任务没跑通，优先去日志页和诊断页看结果，再决定是否回到这里改调度或删作业。</p>
              <Toolbar>
                <Button onClick={() => navigate('logs')}>日志查看</Button>
                <Button onClick={() => navigate('diagnostics')}>诊断页</Button>
                <Button onClick={() => navigate('gateway')}>网关工作台</Button>
              </Toolbar>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="关键材料与去向" subtitle="低频的文件定位和辅助入口收在这里，需要时再下钻，不占主流程。">
        <div className="control-card-grid">
          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Artifacts</p>
                <h3 className="action-card-title">作业文件与目录</h3>
              </div>
              <Pill tone={snapshot?.jobsPath ? 'good' : 'warn'}>
                {snapshot?.jobsPath ? '已发现' : '未检测到'}
              </Pill>
            </div>
            <p className="action-card-copy">
              需要核对原始文件时，再去定位 `jobs.json` 和 cron 目录，避免新手一开始就被文件路径打断。
            </p>
            <Toolbar>
              <Button
                onClick={() => snapshot?.jobsPath && void openInFinder(snapshot.jobsPath, 'jobs.json', true)}
                disabled={!snapshot?.jobsPath || runningAction !== null}
              >
                定位 jobs.json
              </Button>
              <Button
                onClick={() => snapshot?.jobsPath && void openInFinder(snapshot.jobsPath.replace(/\/jobs\.json$/, ''), 'cron 目录')}
                disabled={!snapshot?.jobsPath || runningAction !== null}
              >
                打开 cron 目录
              </Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Health</p>
                <h3 className="action-card-title">能力面与依赖</h3>
              </div>
              <Pill tone={missingReferencedSkills.length === 0 ? 'good' : 'warn'}>
                {missingReferencedSkills.length === 0 ? '基础稳定' : '需要补齐'}
              </Pill>
            </div>
            <p className="action-card-copy">
              当前 toolsets 为 {runtime?.config.toolsets.length ? runtime.config.toolsets.join(', ') : '—'}，记忆 Provider 为 {runtime?.config.memoryProvider || 'builtin-file'}。
            </p>
            <Toolbar>
              <Button onClick={() => navigate('extensions')}>扩展工作台</Button>
              <Button onClick={() => navigate('skills')}>查看 Skills</Button>
              <Button onClick={() => navigate('memory')}>查看 Memory</Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Delivery</p>
                <h3 className="action-card-title">日志与排障</h3>
              </div>
              <Pill tone={failingJobs.length === 0 ? 'good' : 'bad'}>
                {failingJobs.length === 0 ? '暂无明显失败' : `${failingJobs.length} 条异常`}
              </Pill>
            </div>
            <p className="action-card-copy">
              远端投递通常要和 Gateway、平台连接、日志回执一起看，排障时优先走客户端联动页面。
            </p>
            <Toolbar>
              <Button onClick={() => navigate('logs')}>查看 Logs</Button>
              <Button onClick={() => navigate('diagnostics')}>查看 Diagnostics</Button>
              <Button onClick={() => navigate('gateway')}>查看 Gateway</Button>
            </Toolbar>
          </section>
        </div>
      </Panel>
    </div>
  );

  const jobsSection = (
    <div className="page-stack">
      <Panel
        title="作业筛选与入口"
        subtitle="先缩小范围，再决定是立即触发、补技能、修调度，还是去日志和诊断页继续追。"
        aside={(
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
        )}
      >
        <div className="detail-list compact">
          <KeyValueRow label="当前命中" value={`${filteredJobs.length}/${jobs.length}`} />
          <KeyValueRow label="已启用" value={enabledCount} />
          <KeyValueRow label="远端投递" value={remoteJobs.length} />
          <KeyValueRow label="异常作业" value={failingJobs.length} />
        </div>
        <Toolbar>
          <Button onClick={() => navigate('logs')}>查看 Logs</Button>
          <Button onClick={() => navigate('diagnostics')}>查看 Diagnostics</Button>
          <Button onClick={() => navigate('config')}>检查 Config</Button>
          {lastCommand ? <Button onClick={() => setActiveTab('editor')}>查看最近回执</Button> : null}
        </Toolbar>
        <p className="helper-text">
          推荐顺序：先在这里锁定一条作业，再看它和 skills、memory、gateway 的关系；只有在需要改写或删除时，才切到“新建与命令输出”。
        </p>
      </Panel>

      <div className="two-column wide-left">
        <Panel title="作业列表" subtitle="优先定位当前 profile 里最值得先验证，或最可能出问题的一条作业。">
          {filteredJobs.length === 0 ? (
            <EmptyState
              title="暂无 cron 作业"
              description="如果当前 profile 还没有 jobs.json 或没有任何作业，这里会保持空态。"
            />
          ) : (
            <div className="list-stack">
              {filteredJobs.map((job) => {
                const missingSkills = job.skills.filter((name) => !skillNameSet.has(name));
                return (
                  <button
                    className={`list-card session-card ${selectedJob?.id === job.id ? 'selected' : ''}`}
                    key={job.id}
                    onClick={() => {
                      setSelectedId(job.id);
                      setActiveTab('jobs');
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
        </Panel>

        <Panel
          title="作业详情与闭环"
          subtitle="除了调度信息，这里还会展示这条作业和 skills、memory、gateway 之间的关系。"
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
              <div className="detail-list">
                <KeyValueRow label="ID" value={selectedJob.id} />
                <KeyValueRow label="状态" value={selectedJob.state} />
                <KeyValueRow label="启用" value={String(selectedJob.enabled)} />
                <KeyValueRow label="调度" value={selectedJob.scheduleDisplay} />
                <KeyValueRow label="调度输入" value={selectedJob.scheduleInput || '—'} />
                <KeyValueRow label="下次运行" value={formatTimestamp(selectedJob.nextRunAt)} />
                <KeyValueRow label="上次运行" value={formatTimestamp(selectedJob.lastRunAt)} />
                <KeyValueRow label="交付目标" value={selectedJob.deliver} />
                <KeyValueRow label="技能" value={selectedJob.skills.length ? selectedJob.skills.join(', ') : '—'} />
                <KeyValueRow
                  label="重复次数"
                  value={selectedJob.repeatTimes == null ? '∞' : `${selectedJob.repeatCompleted}/${selectedJob.repeatTimes}`}
                />
                <KeyValueRow label="脚本" value={selectedJob.script || '—'} />
                <KeyValueRow label="最后状态" value={selectedJob.lastStatus || '—'} />
                <KeyValueRow label="最后错误" value={selectedJob.lastError || '—'} />
                <KeyValueRow label="投递错误" value={selectedJob.lastDeliveryError || '—'} />
              </div>

              <Panel className="panel-nested" title="自动化闭环">
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
                  <div className="warning-stack">
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

              <Panel className="panel-nested" title="Prompt">
                <pre className="code-block">{selectedJob.prompt || '无 prompt 内容'}</pre>
              </Panel>
            </div>
          ) : (
            <EmptyState title="未选择作业" description="从左侧列表选择一条 cron 作业查看详情与闭环关系。" />
          )}
        </Panel>
      </div>
    </div>
  );

  const editorSection = (
    <div className="page-stack">
      <Panel
        title={editorMode === 'create' ? '新建作业' : editorMode === 'edit' ? '编辑作业' : '作业编辑器'}
        subtitle={editorMode
          ? '把新增、修改和删除确认统一收在这里，避免把高风险操作混在主工作流里。'
          : '只有在需要调整 jobs.json 内容、删除作业或核对原始回执时，再进入这里。'}
        className="panel-nested"
        aside={editorMode ? (
          <Toolbar>
            <Button onClick={closeEditor} disabled={runningAction !== null}>取消</Button>
            <Button kind="primary" onClick={() => void submitEditor()} disabled={runningAction !== null}>
              {runningAction === 'create' || runningAction === 'edit'
                ? '提交中…'
                : editorMode === 'create' ? '创建' : '保存修改'}
            </Button>
          </Toolbar>
        ) : (
          <Toolbar>
            <Button kind="primary" onClick={openCreateEditor}>新建作业</Button>
            <Button onClick={openEditEditor} disabled={!selectedJob}>编辑当前</Button>
            <Button onClick={() => setActiveTab('jobs')} disabled={!selectedJob}>回到作业列表</Button>
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
              description="先从作业列表选中一条任务再编辑，或者直接新建一条新的自动化任务。"
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

      <div className="two-column wide-left">
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
      </div>
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
        <div className="detail-list compact top-gap">
          <KeyValueRow label="当前 Profile" value={profile} />
          <KeyValueRow label="jobs.json" value={snapshot?.jobsPath ?? '—'} />
          <KeyValueRow label="作业总数" value={jobs.length} />
          <KeyValueRow label="已启用" value={enabledCount} />
          <KeyValueRow label="远端投递" value={remoteJobs.length} />
          <KeyValueRow label="缺失 Skill 引用" value={missingReferencedSkills.length} />
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
