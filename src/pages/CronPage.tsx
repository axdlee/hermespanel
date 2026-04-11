import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import { formatTimestamp, truncate } from '../lib/format';
import type {
  CommandRunResult,
  CronCreateRequest,
  CronDeleteRequest,
  CronJobItem,
  CronJobsSnapshot,
  CronUpdateRequest,
} from '../types';
import { Button, EmptyState, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
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

function cronTone(job: CronJobItem): 'good' | 'warn' | 'bad' | 'neutral' {
  if (!job.enabled || job.state === 'paused') return 'warn';
  if (job.lastError || job.lastDeliveryError) return 'bad';
  if (job.state === 'scheduled') return 'good';
  return 'neutral';
}

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

export function CronPage({ notify, profile }: PageProps) {
  const [snapshot, setSnapshot] = useState<CronJobsSnapshot | null>(null);
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
      const next = await api.getCronJobs(profile);
      setSnapshot(next);
      setSelectedId((current) => {
        const candidate = preferredJobId ?? current;
        if (candidate && next.jobs.some((job) => job.id === candidate)) {
          return candidate;
        }
        return next.jobs[0]?.id ?? null;
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

  const filteredJobs = useMemo(() => {
    const jobs = snapshot?.jobs ?? [];
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
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesState && matchesQuery;
    });
  }, [query, snapshot?.jobs, stateFilter]);

  const selectedJob = filteredJobs.find((job) => job.id === selectedId)
    ?? snapshot?.jobs.find((job) => job.id === selectedId)
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
      const skills = parseSkills(draft.skills);
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
          skills,
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
          skills: draft.clearSkills ? null : skills,
          clearSkills: draft.clearSkills,
          script: draft.clearScript ? null : (draft.script.trim() ? draft.script : null),
          clearScript: draft.clearScript,
        };
        result = await api.updateCronJob(request, profile);
      } else {
        return;
      }

      setLastCommand(result);
      notify(result.success ? 'success' : 'error', editorMode === 'create' ? 'cron 作业已创建。' : 'cron 作业已更新。');

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

  if (loading && !snapshot) {
    return <LoadingState label="正在读取 cron 作业列表。" />;
  }

  return (
    <div className="two-column wide-left">
      <Panel
        title="Cron 作业"
        subtitle="读取当前 Hermes profile 下的 `cron/jobs.json`，并复用 Hermes CLI 做创建、编辑、执行与带确认删除。"
        aside={
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
            <Button onClick={() => void load(selectedJob?.id ?? undefined)}>刷新</Button>
            <Button kind="primary" onClick={openCreateEditor}>新建作业</Button>
          </Toolbar>
        }
      >
        {filteredJobs.length === 0 ? (
          <EmptyState
            title="暂无 cron 作业"
            description="如果当前 profile 还没有 jobs.json 或没有任何作业，这里会保持空态。"
          />
        ) : (
          <div className="list-stack">
            {filteredJobs.map((job) => (
              <button
                className={`list-card session-card ${selectedJob?.id === job.id ? 'selected' : ''}`}
                key={job.id}
                onClick={() => setSelectedId(job.id)}
                type="button"
              >
                <div className="list-card-title">
                  <strong>{job.name}</strong>
                  <Pill tone={cronTone(job)}>{job.state}</Pill>
                </div>
                <p>{truncate(job.prompt || '无 prompt', 108)}</p>
                <div className="meta-line">
                  <span>{job.scheduleDisplay}</span>
                  <span>{formatTimestamp(job.nextRunAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <div className="page-stack">
        <Panel
          title="作业详情"
          subtitle={snapshot?.jobsPath}
          aside={
            selectedJob ? (
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
            ) : undefined
          }
        >
          {selectedJob ? (
            <div className="page-stack">
              <div className="detail-list">
                <div className="key-value-row"><span>ID</span><strong>{selectedJob.id}</strong></div>
                <div className="key-value-row"><span>状态</span><strong>{selectedJob.state}</strong></div>
                <div className="key-value-row"><span>启用</span><strong>{String(selectedJob.enabled)}</strong></div>
                <div className="key-value-row"><span>调度</span><strong>{selectedJob.scheduleDisplay}</strong></div>
                <div className="key-value-row"><span>调度输入</span><strong>{selectedJob.scheduleInput || '—'}</strong></div>
                <div className="key-value-row"><span>下次运行</span><strong>{formatTimestamp(selectedJob.nextRunAt)}</strong></div>
                <div className="key-value-row"><span>上次运行</span><strong>{formatTimestamp(selectedJob.lastRunAt)}</strong></div>
                <div className="key-value-row"><span>交付目标</span><strong>{selectedJob.deliver}</strong></div>
                <div className="key-value-row"><span>技能</span><strong>{selectedJob.skills.length ? selectedJob.skills.join(', ') : '—'}</strong></div>
                <div className="key-value-row"><span>重复次数</span><strong>{selectedJob.repeatTimes == null ? '∞' : `${selectedJob.repeatCompleted}/${selectedJob.repeatTimes}`}</strong></div>
                <div className="key-value-row"><span>脚本</span><strong>{selectedJob.script || '—'}</strong></div>
                <div className="key-value-row"><span>最后状态</span><strong>{selectedJob.lastStatus || '—'}</strong></div>
                <div className="key-value-row"><span>最后错误</span><strong>{selectedJob.lastError || '—'}</strong></div>
                <div className="key-value-row"><span>投递错误</span><strong>{selectedJob.lastDeliveryError || '—'}</strong></div>
              </div>
              <pre className="code-block">{selectedJob.prompt || '无 prompt 内容'}</pre>
            </div>
          ) : (
            <EmptyState title="未选择作业" description="从左侧列表选择一条 cron 作业查看详情。" />
          )}
        </Panel>

        {editorMode && (
          <Panel
            title={editorMode === 'create' ? '新建作业' : '编辑作业'}
            className="panel-nested"
            aside={
              <Toolbar>
                <Button onClick={closeEditor} disabled={runningAction !== null}>取消</Button>
                <Button kind="primary" onClick={() => void submitEditor()} disabled={runningAction !== null}>
                  {runningAction === 'create' || runningAction === 'edit'
                    ? '提交中…'
                    : editorMode === 'create' ? '创建' : '保存修改'}
                </Button>
              </Toolbar>
            }
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
                <div className="key-value-row"><span>命令</span><strong>{lastCommand.command}</strong></div>
                <div className="key-value-row"><span>退出码</span><strong>{lastCommand.exitCode}</strong></div>
                <div className="key-value-row"><span>结果</span><strong>{String(lastCommand.success)}</strong></div>
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
