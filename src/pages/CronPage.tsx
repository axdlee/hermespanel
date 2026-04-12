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
import { Button, EmptyState, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import type { PageProps } from './types';

type EditorMode = 'create' | 'edit' | null;

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

  function openCreateEditor() {
    setEditorMode('create');
    setDraft(EMPTY_DRAFT);
  }

  function openEditEditor() {
    if (!selectedJob) return;
    setEditorMode('edit');
    setDraft(buildDraftFromJob(selectedJob));
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

  return (
    <div className="page-stack">
      <Panel
        title="自动化编排台"
        subtitle="把 Hermes 的 `cron/jobs.json / skills / memory / gateway / delivery` 放到同一个桌面工作区里看，帮助你验证真正的自动化闭环。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load(selectedJob?.id ?? undefined)}>刷新</Button>
            <Button kind="primary" onClick={openCreateEditor}>新建作业</Button>
            <Button onClick={() => navigate('skills')}>进入技能页</Button>
            <Button onClick={() => navigate('memory')}>进入记忆页</Button>
          </Toolbar>
        )}
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">Hermes Automation Loop</p>
            <p className="hero-subtitle">
              一个 cron 作业真正跑通，不只是调度时间正确，还要看技能引用是否存在、memory 是否开启、gateway 是否能把结果投递出去。
            </p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={profile} />
              <KeyValueRow label="jobs.json" value={snapshot?.jobsPath ?? '—'} />
              <KeyValueRow label="Gateway" value={runtime?.gateway?.gatewayState ?? '未检测到'} />
              <KeyValueRow label="记忆 Provider" value={runtime?.config.memoryProvider || 'builtin-file'} />
              <KeyValueRow
                label="Toolsets"
                value={runtime?.config.toolsets.length ? runtime.config.toolsets.join(', ') : '—'}
              />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="作业总数" value={jobs.length} hint="当前 profile 的调度对象总量" />
            <MetricCard label="已启用" value={enabledCount} hint="未暂停且处于活动态的作业" />
            <MetricCard label="远端投递" value={remoteJobs.length} hint="需要 gateway 或外部渠道交付的作业" />
            <MetricCard label="缺失 Skill 引用" value={missingReferencedSkills.length} hint="jobs.json 引用了但当前未扫描到的技能" />
          </div>
        </div>
      </Panel>

      <div className="two-column wide-left">
        <Panel title="闭环健康" subtitle="参考 ClawPanel 的工作台摘要，但把健康判断收敛到 Hermes 自动化链路本身。">
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
          {runtimeWarnings.length > 0 ? (
            <div className="warning-stack">
              {runtimeWarnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="闭环较完整" description="当前自动化链路没有明显结构性问题，可以继续关注单个作业的 prompt 和投递策略。" />
          )}
        </Panel>

        <Panel
          title="筛选与入口"
          subtitle="先缩小范围，再决定是去改调度、补 skill、开 memory，还是去看 logs 和 diagnostics。"
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
            <Button onClick={() => navigate('logs')}>查看 Logs</Button>
            <Button onClick={() => navigate('diagnostics')}>查看 Diagnostics</Button>
            <Button onClick={() => navigate('config')}>检查 Config</Button>
          </Toolbar>
          <p className="helper-text">
            推荐顺序：先看这里的闭环健康，再选一条作业看技能和投递链路，最后去日志页或诊断页验证运行结果。
          </p>
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel title="作业列表" subtitle="优先定位当前 profile 里最可能有问题，或者最值得先验证的一条作业。">
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
                    onClick={() => setSelectedId(job.id)}
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

      {editorMode && (
        <Panel
          title={editorMode === 'create' ? '新建作业' : '编辑作业'}
          className="panel-nested"
          aside={(
            <Toolbar>
              <Button onClick={closeEditor} disabled={runningAction !== null}>取消</Button>
              <Button kind="primary" onClick={() => void submitEditor()} disabled={runningAction !== null}>
                {runningAction === 'create' || runningAction === 'edit'
                  ? '提交中…'
                  : editorMode === 'create' ? '创建' : '保存修改'}
              </Button>
            </Toolbar>
          )}
        >
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
        </Panel>
      )}

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
}
