import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, InfoTip, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import { api } from '../lib/api';
import {
  buildConfigDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
  type DrilldownSeed,
} from '../lib/drilldown';
import { openFinderLocation } from '../lib/desktop';
import { formatTimestamp, truncate } from '../lib/format';
import type {
  CommandRunResult,
  CronJobsSnapshot,
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  SkillFileDetail,
  SkillImportResult,
  SkillItem,
} from '../types';
import type { PageProps } from './types';

type WorkspaceTab = 'overview' | 'studio' | 'registry';

const WORKSPACE_TABS: Array<{ key: WorkspaceTab; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看推荐路径、当前技能摘要和关键提醒。' },
  { key: 'registry', label: '安装与启用', hint: '优先做搜索、预检、安装和常用布线核对。' },
  { key: 'studio', label: '本地维护', hint: '需要编辑 SKILL.md、导入或删除目录时再展开。' },
];

interface SkillDraft {
  name: string;
  category: string;
  description: string;
  content: string;
}

interface SkillImportDraft {
  sourcePath: string;
  category: string;
  overwrite: boolean;
}

interface SkillFrontmatterDraft {
  filePath: string;
  name: string;
  description: string;
}

const EMPTY_SKILL_DRAFT: SkillDraft = {
  category: 'custom',
  content: '',
  description: '',
  name: '',
};

const EMPTY_SKILL_IMPORT_DRAFT: SkillImportDraft = {
  category: '',
  overwrite: false,
  sourcePath: '',
};

function directoryOf(path: string) {
  const normalized = path.trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function categoryLabel(value: string) {
  return value || '未分类';
}

function cloneSkillDraft(draft: Partial<SkillDraft> = {}): SkillDraft {
  return {
    category: draft.category || 'custom',
    content: draft.content || '',
    description: draft.description || '',
    name: draft.name || '',
  };
}

function cloneSkillImportDraft(draft: Partial<SkillImportDraft> = {}): SkillImportDraft {
  return {
    category: draft.category || '',
    overwrite: Boolean(draft.overwrite),
    sourcePath: draft.sourcePath || '',
  };
}

function buildSkillRelaySeed(profile: string, skill: SkillItem | null, query: string): DrilldownSeed {
  return {
    sourcePage: 'skills',
    headline: skill ? `围绕技能 ${skill.name} 继续下钻` : `围绕 ${profile} 的技能层继续下钻`,
    description: skill
      ? `继续围绕 ${skill.name} 的目录态、运行态与自动化接入做排查。`
      : `继续围绕 ${profile} 的技能目录、运行态与自动化接入做排查。`,
    context: skill
      ? {
          sessionId: `skill:${skill.name}`,
          title: skill.name,
          source: skill.category || 'skills',
          preview: truncate(skill.description || skill.preview || skill.relativePath, 120),
          toolNames: [skill.name],
        }
      : query.trim()
        ? {
            sessionId: `skill-search:${query.trim()}`,
            title: query.trim(),
            source: 'skills',
            preview: `围绕关键词 ${query.trim()} 继续核对技能运行态。`,
            toolNames: [query.trim()],
          }
        : undefined,
  };
}

function syntheticResult(command: string, stdout: string): CommandRunResult {
  return {
    command,
    exitCode: 0,
    stderr: '',
    stdout,
    success: true,
  };
}

export function SkillsPage({ notify, profile, navigate }: PageProps) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [cronSnapshot, setCronSnapshot] = useState<CronJobsSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [registryQuery, setRegistryQuery] = useState('');
  const [installTarget, setInstallTarget] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
  const [skillFile, setSkillFile] = useState<SkillFileDetail | null>(null);
  const [skillFileSavedContent, setSkillFileSavedContent] = useState('');
  const [skillFileLoading, setSkillFileLoading] = useState(false);
  const [skillFrontmatterDraft, setSkillFrontmatterDraft] = useState<SkillFrontmatterDraft | null>(null);
  const [skillDeleteConfirm, setSkillDeleteConfirm] = useState('');
  const [createDraft, setCreateDraft] = useState<SkillDraft>(cloneSkillDraft());
  const [importDraft, setImportDraft] = useState<SkillImportDraft>(cloneSkillImportDraft());
  const [lastImportedSkill, setLastImportedSkill] = useState<SkillImportResult | null>(null);
  const [frontmatterExpanded, setFrontmatterExpanded] = useState(true);
  const [contentExpanded, setContentExpanded] = useState(true);
  const [localOpsExpanded, setLocalOpsExpanded] = useState(false);
  const [importExpanded, setImportExpanded] = useState(false);
  const [createExpanded, setCreateExpanded] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastCommandLabel, setLastCommandLabel] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [loading, setLoading] = useState(true);

  function applySkillFileDetail(detail: SkillFileDetail) {
    setSkillFile(detail);
    setSkillFileSavedContent(detail.content);
    setSkillFrontmatterDraft({
      filePath: detail.filePath,
      name: detail.name,
      description: detail.description,
    });
    setSkillDeleteConfirm('');
  }

  function storeResult(label: string, result: CommandRunResult) {
    setLastCommandLabel(label);
    setLastCommand(result);
  }

  async function load() {
    setLoading(true);
    try {
      const [nextSkills, nextSnapshot, nextInstallation, nextExtensions, nextCron] = await Promise.all([
        api.listSkills(profile),
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.getExtensionsSnapshot(profile),
        api.getCronJobs(profile),
      ]);
      setSkills(nextSkills);
      setSnapshot(nextSnapshot);
      setInstallation(nextInstallation);
      setExtensions(nextExtensions);
      setCronSnapshot(nextCron);

      setSelectedPath((current) => {
        if (current && nextSkills.some((item) => item.filePath === current)) {
          return current;
        }
        return nextSkills[0]?.filePath ?? null;
      });
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `skills:finder:${label}`,
      label,
      notify,
      onResult: (resultLabel, result) => {
        storeResult(resultLabel, result);
      },
      path,
      revealInFinder,
      setBusy: setRunningAction,
    });
  }

  async function executeSkillAction(
    action: 'search' | 'inspect' | 'install' | 'check' | 'update' | 'audit',
    value: string | null,
    options?: { actionId?: string; label?: string; refresh?: boolean },
  ) {
    const actionId = options?.actionId ?? `skills:${action}`;
    const label = options?.label ?? `skills ${action}`;

    setRunningAction(actionId);
    try {
      const result = await api.runSkillAction(action, value || null, profile);
      storeResult(label, result);
      notify(
        result.success ? 'success' : 'error',
        result.success
          ? `${label} 已在客户端执行。`
          : `${label} 执行失败，请查看动作回执。`,
      );
      if (options?.refresh) {
        await load();
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function saveSkillFrontmatter() {
    if (!skillFrontmatterDraft) {
      notify('error', '请先选择要接管的技能。');
      return;
    }
    if (!skillFrontmatterDraft.name.trim()) {
      notify('error', '技能名称不能为空。');
      return;
    }

    setRunningAction('skills:save-frontmatter');
    try {
      const detail = await api.saveSkillFrontmatter({
        filePath: skillFrontmatterDraft.filePath,
        name: skillFrontmatterDraft.name.trim(),
        description: skillFrontmatterDraft.description.trim(),
      }, profile);
      applySkillFileDetail(detail);
      storeResult(
        `保存 frontmatter · ${detail.name}`,
        syntheticResult(
          'local://skills/frontmatter',
          `name: ${detail.name}\ndescription: ${detail.description}\nfile: ${detail.filePath}`,
        ),
      );
      notify('success', `${detail.name} 的 frontmatter 已保存。`);
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function saveSkillFile() {
    if (!skillFile) {
      notify('error', '请先选择要保存的技能文件。');
      return;
    }

    setRunningAction('skills:save-file');
    try {
      const detail = await api.saveSkillFile({
        filePath: skillFile.filePath,
        content: skillFile.content,
      }, profile);
      applySkillFileDetail(detail);
      storeResult(
        `保存技能文件 · ${detail.name}`,
        syntheticResult(
          'local://skills/save',
          `file: ${detail.filePath}\ncontentLength: ${detail.content.length}`,
        ),
      );
      notify('success', `${detail.name} 已保存。`);
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function createLocalSkill() {
    if (!createDraft.name.trim()) {
      notify('error', '请先填写技能名称。');
      return;
    }

    setRunningAction('skills:create-local');
    try {
      const detail = await api.createSkill({
        category: createDraft.category.trim() || 'custom',
        content: createDraft.content,
        description: createDraft.description.trim(),
        name: createDraft.name.trim(),
        overwrite: false,
      }, profile);
      applySkillFileDetail(detail);
      storeResult(
        `创建本地技能 · ${detail.name}`,
        syntheticResult(
          'local://skills/create',
          `name: ${detail.name}\ncategory: ${detail.category}\nfile: ${detail.filePath}`,
        ),
      );
      notify('success', `${detail.name} 已创建到当前实例的本地 skills 目录。`);
      setCreateDraft(cloneSkillDraft());
      setSelectedPath(detail.filePath);
      setWorkspaceTab('studio');
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function importLocalSkill() {
    if (!importDraft.sourcePath.trim()) {
      notify('error', '请先填写技能目录或 SKILL.md 路径。');
      return;
    }

    setRunningAction('skills:import-local');
    try {
      const result = await api.importSkill({
        category: importDraft.category.trim(),
        overwrite: importDraft.overwrite,
        sourcePath: importDraft.sourcePath.trim(),
      }, profile);
      setLastImportedSkill(result);
      storeResult(
        `导入技能 · ${result.imported.name}`,
        syntheticResult(
          'local://skills/import',
          `source: ${result.sourcePath}\ntarget: ${result.targetDirectory}\nfiles: ${result.copiedFiles}`,
        ),
      );
      notify('success', `${result.imported.name} 已导入，复制了 ${result.copiedFiles} 个文件。`);
      setImportDraft(cloneSkillImportDraft({ category: result.imported.category }));
      setSelectedPath(result.imported.filePath);
      setWorkspaceTab('studio');
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function deleteLocalSkill(selectedSkill: SkillItem | null, selectedJobs: CronJobsSnapshot['jobs']) {
    if (!selectedSkill) {
      notify('error', '请先选择要删除的技能。');
      return;
    }
    if (selectedJobs.length > 0) {
      notify('error', '当前技能仍被 cron 作业引用，请先解除编排绑定。');
      return;
    }
    if (skillDeleteConfirm.trim() !== selectedSkill.name) {
      notify('error', `请输入 ${selectedSkill.name} 以确认删除。`);
      return;
    }

    setRunningAction('skills:delete-local');
    try {
      const result = await api.deleteLocalSkill({
        filePath: selectedSkill.filePath,
        name: selectedSkill.name,
      }, profile);
      storeResult(
        `删除本地技能 · ${result.name}`,
        syntheticResult(
          'local://skills/delete',
          `name: ${result.name}\ndirectory: ${result.directoryPath}\nfiles: ${result.removedFiles}`,
        ),
      );
      notify('success', `${result.name} 已从当前实例删除。`);
      setSelectedPath(null);
      setSkillFile(null);
      setSkillFileSavedContent('');
      setSkillFrontmatterDraft(null);
      setSkillDeleteConfirm('');
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  useEffect(() => {
    setLastCommand(null);
    setLastCommandLabel(null);
    setSkillFile(null);
    setSkillFileSavedContent('');
    setSkillFrontmatterDraft(null);
    setLastImportedSkill(null);
    setSelectedPath(null);
    setSkillDeleteConfirm('');
    setWorkspaceTab('overview');
    void load();
  }, [profile]);

  useEffect(() => {
    if (!selectedPath) {
      setSkillFile(null);
      setSkillFileSavedContent('');
      setSkillFrontmatterDraft(null);
      setSkillDeleteConfirm('');
      return;
    }

    const filePath = selectedPath;
    let cancelled = false;

    async function run() {
      setSkillFileLoading(true);
      try {
        const detail = await api.readSkillFile(filePath, profile);
        if (!cancelled) {
          applySkillFileDetail(detail);
        }
      } catch (reason) {
        if (!cancelled) {
          notify('error', String(reason));
        }
      } finally {
        if (!cancelled) {
          setSkillFileLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [profile, selectedPath]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean))).sort()],
    [skills],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (categoryFilter !== 'all' && skill.category !== categoryFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [skill.name, skill.description, skill.category, skill.relativePath, skill.preview]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [categoryFilter, query, skills]);

  const selectedSkill = useMemo(
    () => filtered.find((skill) => skill.filePath === selectedPath)
      ?? skills.find((skill) => skill.filePath === selectedPath)
      ?? filtered[0]
      ?? skills[0]
      ?? null,
    [filtered, selectedPath, skills],
  );

  const jobs = cronSnapshot?.jobs ?? [];
  const skillUsageJobs = useMemo(
    () => (selectedSkill ? jobs.filter((job) => job.skills.includes(selectedSkill.name)) : []),
    [jobs, selectedSkill],
  );
  const usedSkillNames = useMemo(() => new Set(jobs.flatMap((job) => job.skills)), [jobs]);
  const uniqueCategories = useMemo(() => new Set(skills.map((skill) => skill.category).filter(Boolean)).size, [skills]);
  const currentToolsets = snapshot?.config.toolsets ?? [];
  const runtimeLocalSkills = extensions?.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
  const runtimeMismatch = runtimeLocalSkills !== skills.length;
  const selectedExistsInRuntime = selectedSkill
    ? (extensions?.runtimeSkills ?? []).some((item) => item.name === selectedSkill.name)
    : false;
  const quickCategories = categories.filter((item) => item !== 'all').slice(0, 6);
  const workspaceTabLabel = WORKSPACE_TABS.find((tab) => tab.key === workspaceTab)?.label ?? '常用总览';
  const warnings = useMemo(() => {
    const nextWarnings: string[] = [];

    if (!skills.length) {
      nextWarnings.push('当前实例没有扫描到任何技能文件，能力面会退化到纯工具调用。');
    }
    if (!currentToolsets.length) {
      nextWarnings.push('当前没有配置任何工具集，目录里的技能未必真正暴露给模型。');
    }
    if (snapshot?.config.memoryEnabled === false) {
      nextWarnings.push('记忆当前关闭，技能与长期记忆的闭环会明显变弱。');
    }
    if (snapshot?.gateway?.gatewayState !== 'running' && jobs.some((job) => job.deliver !== 'local' && job.deliver !== 'origin')) {
      nextWarnings.push('存在远端投递作业，但网关未运行，消息平台侧链路还没闭环。');
    }
    if (selectedSkill && skillUsageJobs.length === 0 && jobs.length > 0) {
      nextWarnings.push(`当前选中的技能 ${selectedSkill.name} 还没有被任何 cron 作业显式引用。`);
    }
    if (extensions && runtimeMismatch) {
      nextWarnings.push(`运行态本地技能为 ${runtimeLocalSkills} 个，本地目录扫描为 ${skills.length} 个。`);
    }
    if (!usedSkillNames.size && jobs.length > 0) {
      nextWarnings.push('当前 cron 作业存在，但没有显式绑定任何技能，建议回 Cron 页复核编排。');
    }

    return nextWarnings;
  }, [currentToolsets.length, extensions, jobs, runtimeLocalSkills, runtimeMismatch, selectedSkill, skillUsageJobs.length, skills.length, snapshot?.config.memoryEnabled, snapshot?.gateway?.gatewayState, usedSkillNames]);
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);

  const frontmatterDirty = Boolean(
    selectedSkill
      && skillFrontmatterDraft
      && skillFrontmatterDraft.filePath === selectedSkill.filePath
      && (
        skillFrontmatterDraft.name.trim() !== (skillFile?.name || selectedSkill.name || '').trim()
        || skillFrontmatterDraft.description.trim() !== (skillFile?.description || selectedSkill.description || '').trim()
      ),
  );

  const skillFileDirty = Boolean(
    selectedSkill
      && skillFile
      && skillFile.filePath === selectedSkill.filePath
      && skillFile.content !== skillFileSavedContent,
  );

  const relaySeed = buildSkillRelaySeed(profile, selectedSkill, query);
  const logsIntent = buildLogsDrilldownIntent(relaySeed, {
    logName: 'agent',
    contains: selectedSkill?.name ?? query.trim(),
    limit: '160',
  });
  const configToolsetsIntent = buildConfigDrilldownIntent(relaySeed, {
    description: '继续在配置中心核对 toolsets、外部 skills 目录和技能暴露范围。',
    focus: 'toolsets',
  });
  const configMemoryIntent = buildConfigDrilldownIntent(relaySeed, {
    description: '继续在配置中心核对记忆开关、provider 与长期记忆链路。',
    focus: 'memory',
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(relaySeed, {
    description: selectedSkill
      ? `继续核对技能 ${selectedSkill.name} 关联的 runtime source、插件和扩展状态。`
      : '继续核对技能层关联的 runtime source、插件和扩展状态。',
    rawKind: 'skills',
    query: selectedSkill?.name ?? query.trim(),
    sourceFilter: (extensions?.runtimeSkills ?? []).some((item) => item.source === 'local') ? 'local' : 'all',
  });

  function renderResultCard() {
    return (
      <section className="workspace-main-card">
        <div className="workspace-main-header">
          <div>
            <h2 className="config-section-title">最近回执与原始输出</h2>
            <p className="config-section-desc">执行搜索、预检、安装或审计后，回执会保留在这里。</p>
          </div>
          <Pill tone={lastCommand ? 'good' : 'neutral'}>{lastCommand ? '最近回执' : '底层快照'}</Pill>
        </div>
        {lastCommand ? (
          <>
            <div className="detail-list compact">
              <KeyValueRow label="动作" value={lastCommandLabel || '技能动作'} />
              <KeyValueRow label="命令" value={lastCommand.command} />
              <KeyValueRow label="退出码" value={lastCommand.exitCode} />
              <KeyValueRow label="结果" value={<Pill tone={lastCommand.success ? 'good' : 'bad'}>{String(lastCommand.success)}</Pill>} />
            </div>
            <pre className="code-block compact-code top-gap">{lastCommand.stdout || lastCommand.stderr || '无输出'}</pre>
          </>
        ) : (
          <EmptyState title="尚未执行动作" description="先在“安装与启用”或“本地维护”里执行一次动作，这里会保留最近结果。" />
        )}
        <pre className="code-block compact-code top-gap">{extensions?.skillsRawOutput || '当前没有可展示的技能原始输出。'}</pre>
      </section>
    );
  }

  function renderCronJobs() {
    if (!selectedSkill) {
      return <EmptyState title="未选择技能" description="先从左侧选择一个技能。" />;
    }
    if (!skillUsageJobs.length) {
      return <EmptyState title="尚未接入自动化" description="这个技能当前还没有被任何 cron 作业显式引用。" />;
    }
    return (
      <div className="list-stack">
        {skillUsageJobs.map((job) => (
          <div className="list-card" key={job.id}>
            <div className="list-card-title">
              <strong>{job.name}</strong>
              <div className="pill-row">
                <Pill tone={job.state === 'scheduled' ? 'good' : job.state === 'paused' ? 'warn' : 'bad'}>
                  {job.state}
                </Pill>
                <Pill tone={job.deliver === 'local' || job.deliver === 'origin' ? 'neutral' : 'warn'}>
                  {job.deliver}
                </Pill>
              </div>
            </div>
            <p>{truncate(job.prompt || '无 prompt', 120)}</p>
            <div className="meta-line">
              <span>{job.scheduleDisplay || '未提供调度表达式'}</span>
              <span>{formatTimestamp(job.nextRunAt)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (loading || !snapshot || !installation || !extensions || !cronSnapshot) {
    return <LoadingState label="正在读取技能目录、运行态与安装治理快照。" />;
  }

  return (
    <div className="page-stack">
      <Panel
        title="技能工作台"
        subtitle="先选技能，再决定是安装启用还是本地维护。"
        tip={<InfoTip content="这里不再堆大段说明。核心只保留技能目录、安装动作、运行态差异和自动化引用，跨页入口尽量收敛到少量真正有用的跳转。" />}
        aside={(
          <Toolbar>
            <Button onClick={() => void load()}>{loading ? '同步中…' : '刷新'}</Button>
          </Toolbar>
        )}
      >
        <div className="workspace-summary-strip workspace-summary-strip-dense">
          <section className="summary-mini-card">
            <span className="summary-mini-label">目录技能</span>
            <strong className="summary-mini-value">{skills.length}</strong>
            <span className="summary-mini-meta">当前实例扫描到的本地技能，共 {uniqueCategories} 个分类</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">本地运行面</span>
            <strong className="summary-mini-value">{runtimeLocalSkills}</strong>
            <span className="summary-mini-meta">{runtimeMismatch ? '运行面与目录存在偏差' : '运行面与目录已对齐'}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">当前目标</span>
            <strong className="summary-mini-value">{installTarget.trim() || selectedSkill?.name || '未指定'}</strong>
            <span className="summary-mini-meta">{registryQuery.trim() || '优先在这里搜索、预检、安装技能'}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">最近动作</span>
            <strong className="summary-mini-value">{lastCommandLabel || '待执行'}</strong>
            <span className="summary-mini-meta">
              {lastCommand ? (lastCommand.success ? '最近一次动作成功' : '最近一次动作失败') : '执行搜索、安装或审计后会显示'}
            </span>
          </section>
        </div>
      </Panel>

      <Panel
        title="技能主工作台"
        subtitle="左侧只做选择，右侧优先呈现常用路径，低频编辑和危险操作继续后置。"
        tip={<InfoTip content="参考 ClawPanel 的轻卡片工作台，把真正高频的动作压进主区，把危险操作和低频编辑收进 disclosure。"/>}
        aside={(
          <Toolbar>
            <Pill>{workspaceTabLabel}</Pill>
            <Button kind="primary" onClick={() => void load()} disabled={runningAction !== null}>
              {loading ? '同步中…' : '刷新状态'}
            </Button>
          </Toolbar>
        )}
      >
        <div className="tab-bar tab-bar-dense">
          {WORKSPACE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tab ${workspaceTab === tab.key ? 'active' : ''}`}
              onClick={() => setWorkspaceTab(tab.key as WorkspaceTab)}
              title={tab.hint}
            >
              {tab.label}
              {tab.key === 'registry' && (!currentToolsets.length || runtimeMismatch || Boolean(lastCommand)) ? <span className="tab-dirty-dot" /> : null}
              {tab.key === 'studio' && (frontmatterDirty || skillFileDirty || Boolean(lastImportedSkill)) ? <span className="tab-dirty-dot" /> : null}
            </button>
          ))}
        </div>

        <div className="workspace-shell workspace-shell-editor workspace-shell-dense top-gap">
          <section className="workspace-rail">
            <div className="workspace-rail-header">
              <div>
                <h2 className="config-section-title">选择技能</h2>
                <p className="config-section-desc">先选一个技能，再在右侧继续安装启用或本地维护。</p>
              </div>
              <Pill tone={selectedSkill ? 'neutral' : 'warn'}>{selectedSkill?.name || '等待选择'}</Pill>
            </div>

            <div className="workspace-rail-toolbar">
              <input
                className="search-input"
                placeholder="搜索名称、分类、描述、路径"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                className="select-input"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item === 'all' ? '全部分类' : item}
                  </option>
                ))}
              </select>
            </div>

            {quickCategories.length > 0 ? (
              <div className="selection-chip-grid top-gap">
                <button
                  type="button"
                  className={`button button-secondary selection-chip ${categoryFilter === 'all' ? 'selection-chip-active' : ''}`.trim()}
                  onClick={() => setCategoryFilter('all')}
                >
                  全部分类
                </button>
                {quickCategories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`button button-secondary selection-chip ${categoryFilter === item ? 'selection-chip-active' : ''}`.trim()}
                    onClick={() => setCategoryFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            <section className="workspace-rail-section">
              <div className="workspace-rail-section-header">
                <span className="workspace-rail-section-title">当前摘要</span>
                <Pill tone={selectedSkill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral'}>
                  {selectedSkill ? (selectedExistsInRuntime ? '运行面已接入' : '运行面待同步') : '等待选择'}
                </Pill>
              </div>
              <div className="detail-list compact">
                <KeyValueRow label="当前技能" value={selectedSkill?.name || '—'} />
                <KeyValueRow label="分类" value={selectedSkill ? categoryLabel(selectedSkill.category) : '—'} />
                <KeyValueRow label="编排" value={selectedSkill ? skillUsageJobs.length : 0} />
                <KeyValueRow label="运行态" value={selectedSkill ? (selectedExistsInRuntime ? '已进入' : '待同步') : '—'} />
              </div>
              <div className="workspace-rail-toolbar workspace-rail-toolbar-grid top-gap">
                <Button
                  kind="primary"
                  disabled={runningAction !== null || !selectedSkill}
                  onClick={() => {
                    if (!selectedSkill) return;
                    setRegistryQuery(selectedSkill.name);
                    setInstallTarget(selectedSkill.name);
                    setWorkspaceTab('registry');
                  }}
                >
                  去安装启用
                </Button>
                <Button
                  disabled={runningAction !== null || !selectedSkill}
                  onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}
                >
                  打开目录
                </Button>
                <Button
                  disabled={!selectedSkill}
                  onClick={() => navigate('logs', logsIntent)}
                >
                  查看日志
                </Button>
                <Button onClick={() => navigate('extensions', extensionsIntent)}>
                  扩展运行态
                </Button>
              </div>
            </section>

            {warnings.length > 0 && workspaceTab !== 'overview' ? (
              <div className="warning-stack top-gap">
                {warnings.slice(0, 3).map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}

            {filtered.length === 0 ? (
              <EmptyState title="未匹配到技能" description="调整关键词或分类后再试。" />
            ) : (
              <div className="list-stack workspace-list-scroll">
                {filtered.map((skill) => {
                  const referenced = jobs.some((job) => job.skills.includes(skill.name));
                  const runtimeVisible = extensions.runtimeSkills.some((item) => item.name === skill.name);
                  return (
                    <button
                      type="button"
                      className={`list-card session-card ${selectedSkill?.filePath === skill.filePath ? 'selected' : ''}`}
                      key={skill.filePath}
                      onClick={() => setSelectedPath(skill.filePath)}
                    >
                      <div className="list-card-title">
                        <strong>{skill.name}</strong>
                        <div className="pill-row">
                          <Pill>{categoryLabel(skill.category)}</Pill>
                          {referenced ? <Pill tone="good">Cron 中</Pill> : <Pill tone="neutral">未编排</Pill>}
                          <Pill tone={runtimeVisible ? 'good' : 'warn'}>{runtimeVisible ? '运行面可见' : '待进入运行面'}</Pill>
                        </div>
                      </div>
                      <p className="skill-list-copy">{truncate(skill.description || skill.preview || '底层未返回描述。', 92)}</p>
                      <div className="meta-line">
                        <span>{skill.relativePath}</span>
                        <span>{runtimeVisible ? '已进入运行面' : '仅目录可见'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="workspace-main">
            {workspaceTab === 'overview' ? (
              <>
                <section className="workspace-main-card">
                  <div className="workspace-main-header">
                    <div>
                      <div className="panel-title-row">
                        <h2 className="config-section-title">推荐下一步</h2>
                        <Pill tone={warnings.length > 0 ? 'warn' : 'good'}>
                          {warnings.length > 0 ? `${warnings.length} 条提醒` : '当前稳定'}
                        </Pill>
                      </div>
                      <p className="workspace-main-copy">
                        把最常走的技能路径放前面，小白先顺着做，熟手再进入安装启用和本地维护。
                      </p>
                    </div>
                  </div>
                  <div className="list-stack">
                    <div className="list-card">
                      <div className="list-card-title">
                        <strong>先确认当前技能有没有真正接入运行面</strong>
                        <Pill tone={selectedSkill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral'}>
                          {selectedSkill ? (selectedExistsInRuntime ? '已接入' : '待启用') : '等待选择'}
                        </Pill>
                      </div>
                      <p>{selectedSkill ? `${selectedSkill.name} ${selectedExistsInRuntime ? '已经' : '还没有'}出现在当前运行态。` : '先从左侧选一个技能，再判断它是否已经接入当前实例。'}</p>
                      <div className="meta-line">
                        <span>{selectedSkill ? categoryLabel(selectedSkill.category) : '未选择技能'}</span>
                        <span>{selectedSkill ? selectedSkill.relativePath : '等待目录目标'}</span>
                      </div>
                      <Toolbar>
                        <Button
                          kind="primary"
                          disabled={runningAction !== null || !selectedSkill}
                          onClick={() => {
                            if (!selectedSkill) return;
                            setRegistryQuery(selectedSkill.name);
                            setInstallTarget(selectedSkill.name);
                            setWorkspaceTab('registry');
                          }}
                        >
                          去安装启用
                        </Button>
                        <Button disabled={!selectedSkill} onClick={() => navigate('extensions', extensionsIntent)}>
                          查看扩展运行态
                        </Button>
                      </Toolbar>
                    </div>

                    <div className="list-card">
                      <div className="list-card-title">
                        <strong>再核对自动化和日志</strong>
                        <Pill tone={selectedSkill && skillUsageJobs.length > 0 ? 'good' : 'warn'}>
                          {selectedSkill ? `${skillUsageJobs.length} 个作业` : '等待选择'}
                        </Pill>
                      </div>
                      <p>确认这个技能有没有被 cron 显式引用，再决定是继续布线还是只做本地维护。</p>
                      <div className="meta-line">
                        <span>{usedSkillNames.size} 个技能已进入编排</span>
                        <span>{jobs.length} 个作业</span>
                      </div>
                      <Toolbar>
                        <Button kind="primary" onClick={() => navigate('cron')}>查看编排</Button>
                        <Button disabled={!selectedSkill} onClick={() => navigate('logs', logsIntent)}>
                          查看日志
                        </Button>
                      </Toolbar>
                    </div>

                    <div className="list-card">
                      <div className="list-card-title">
                        <strong>需要改 SKILL.md 时再进入本地维护</strong>
                        <Pill tone={selectedSkill ? 'neutral' : 'warn'}>
                          {selectedSkill ? '可以继续' : '等待目标'}
                        </Pill>
                      </div>
                      <p>frontmatter、正文、导入和删除都已收进本地维护，不在常用总览里默认铺开。</p>
                      <div className="meta-line">
                        <span>{selectedSkill ? (skillFile ? '正文已接管' : '正文待读取') : '还没选择技能'}</span>
                        <span>{lastImportedSkill ? `最近导入 ${lastImportedSkill.imported.name}` : '暂无最近导入'}</span>
                      </div>
                      <Toolbar>
                        <Button kind="primary" disabled={!selectedSkill} onClick={() => setWorkspaceTab('studio')}>
                          进入本地维护
                        </Button>
                        <Button disabled={!selectedSkill} onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}>
                          打开目录
                        </Button>
                      </Toolbar>
                    </div>
                  </div>
                </section>

                <div className="workspace-bottom-grid workspace-bottom-grid-dense top-gap">
                  <section className="workspace-main-card">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">当前技能摘要</h2>
                        <p className="config-section-desc">只保留当前技能最重要的目录态、运行态和布线信息。</p>
                      </div>
                      <Pill tone={selectedSkill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral'}>
                        {selectedSkill ? (selectedExistsInRuntime ? '运行面已接入' : '运行面待同步') : '等待选择'}
                      </Pill>
                    </div>
                    {selectedSkill ? (
                      <>
                        <div className="detail-list compact">
                          <KeyValueRow label="名称" value={selectedSkill.name} />
                          <KeyValueRow label="分类" value={categoryLabel(selectedSkill.category)} />
                          <KeyValueRow label="相对路径" value={selectedSkill.relativePath} />
                          <KeyValueRow label="运行态可见" value={selectedExistsInRuntime ? '是' : '否'} />
                          <KeyValueRow label="编排引用" value={skillUsageJobs.length} />
                          <KeyValueRow label="文件路径" value={selectedSkill.filePath} />
                        </div>
                        <pre className="code-block compact-code skill-detail-preview top-gap">{selectedSkill.preview || '无预览内容'}</pre>
                        <Toolbar className="top-gap">
                          <Button
                            kind="primary"
                            disabled={runningAction !== null || !selectedSkill}
                            onClick={() => {
                              if (!selectedSkill) return;
                              setRegistryQuery(selectedSkill.name);
                              setInstallTarget(selectedSkill.name);
                              setWorkspaceTab('registry');
                            }}
                          >
                            去安装启用
                          </Button>
                          <Button disabled={!selectedSkill} onClick={() => navigate('extensions', extensionsIntent)}>
                            扩展运行态
                          </Button>
                        </Toolbar>
                      </>
                    ) : (
                      <EmptyState title="未选择技能" description="先从左侧选择一个技能。" />
                    )}
                  </section>

                  {renderResultCard()}
                </div>

                <section className="workspace-main-card top-gap">
                  <div className="workspace-main-header">
                    <div>
                      <h2 className="config-section-title">自动化引用</h2>
                      <p className="config-section-desc">优先核对真正被 cron 显式引用的技能。</p>
                    </div>
                    <Pill tone={selectedSkill && skillUsageJobs.length > 0 ? 'good' : 'warn'}>
                      {selectedSkill ? `${skillUsageJobs.length} 个作业` : '等待选择'}
                    </Pill>
                  </div>
                  {renderCronJobs()}
                </section>

                {overviewWarnings.length > 0 ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">关键提醒</h2>
                        <p className="config-section-desc">只保留会影响技能闭环的信号，不抢主操作位。</p>
                      </div>
                      <Pill tone="warn">{warnings.length} 条</Pill>
                    </div>
                    <div className="warning-stack">
                      {overviewWarnings.map((warning) => (
                        <div className="warning-item" key={warning}>
                          {warning}
                        </div>
                      ))}
                    </div>
                    {remainingWarningCount > 0 ? <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在安装与启用、本地维护等子模块里。</p> : null}
                  </section>
                ) : null}
              </>
            ) : null}

            {workspaceTab === 'registry' ? (
              <>
                <div className="compact-overview-grid compact-overview-grid-dense">
                  <section className="shell-card shell-card-dense">
                    <div className="shell-card-header">
                      <div>
                        <div className="panel-title-row">
                          <strong>常用安装与启用</strong>
                          <InfoTip content="调用的是桌面端封装的技能动作，不会把你甩回外部终端。" />
                        </div>
                        <p className="shell-card-copy">先搜关键词，再对目标技能做预检或安装，这是最常走的技能接入路径。</p>
                      </div>
                      <Pill tone={installTarget.trim() ? 'good' : 'warn'}>{installTarget.trim() || '等待目标'}</Pill>
                    </div>
                    <div className="form-grid">
                      <label className="field-stack">
                        <span>搜索关键词</span>
                        <input
                          className="search-input"
                          value={registryQuery}
                          onChange={(event) => setRegistryQuery(event.target.value)}
                          placeholder="react / security / browser"
                          disabled={runningAction !== null}
                        />
                      </label>
                      <label className="field-stack">
                        <span>技能 ID</span>
                        <input
                          className="search-input"
                          value={installTarget}
                          onChange={(event) => setInstallTarget(event.target.value)}
                          placeholder="official/security/1password"
                          disabled={runningAction !== null}
                        />
                      </label>
                    </div>
                    <Toolbar>
                      <Button
                        kind="primary"
                        disabled={runningAction !== null || !registryQuery.trim()}
                        onClick={() => void executeSkillAction('search', registryQuery.trim(), {
                          actionId: 'skills:search',
                          label: `搜索技能 · ${registryQuery.trim()}`,
                        })}
                      >
                        {runningAction === 'skills:search' ? '搜索中…' : '搜索技能'}
                      </Button>
                      <Button
                        disabled={runningAction !== null || !installTarget.trim()}
                        onClick={() => void executeSkillAction('inspect', installTarget.trim(), {
                          actionId: 'skills:inspect',
                          label: `预检技能 · ${installTarget.trim()}`,
                        })}
                      >
                        {runningAction === 'skills:inspect' ? '预检中…' : '预检技能'}
                      </Button>
                      <Button
                        disabled={runningAction !== null || !installTarget.trim()}
                        onClick={() => void executeSkillAction('install', installTarget.trim(), {
                          actionId: 'skills:install',
                          label: `安装技能 · ${installTarget.trim()}`,
                          refresh: true,
                        })}
                      >
                        {runningAction === 'skills:install' ? '安装中…' : '安装技能'}
                      </Button>
                      <Button
                        disabled={runningAction !== null || !selectedSkill}
                        onClick={() => {
                          if (!selectedSkill) return;
                          setRegistryQuery(selectedSkill.name);
                          setInstallTarget(selectedSkill.name);
                        }}
                      >
                        使用当前技能
                      </Button>
                    </Toolbar>
                  </section>

                  <section className="shell-card shell-card-dense">
                    <div className="shell-card-header">
                      <div>
                        <strong>进阶治理与核对</strong>
                        <p className="shell-card-copy">更新、审计和配置链路核查继续留在这里，不再和常用安装动作混在一起。</p>
                      </div>
                      <Pill tone={installation.binaryFound ? 'good' : 'bad'}>
                        {installation.binaryFound ? '底层已就绪' : '底层待安装'}
                      </Pill>
                    </div>
                    <div className="detail-list compact">
                      <KeyValueRow label="工具集" value={currentToolsets.length ? currentToolsets.join(', ') : '—'} />
                      <KeyValueRow label="本地运行态" value={runtimeLocalSkills} />
                      <KeyValueRow label="已编排技能" value={usedSkillNames.size} />
                      <KeyValueRow label="当前技能可见" value={selectedSkill ? (selectedExistsInRuntime ? '是' : '否') : '—'} />
                    </div>
                    <Toolbar className="top-gap">
                      <Button
                        kind="primary"
                        disabled={runningAction !== null}
                        onClick={() => void executeSkillAction('check', null, {
                          actionId: 'skills:check',
                          label: '检查技能更新',
                        })}
                      >
                        {runningAction === 'skills:check' ? '检查中…' : '检查更新'}
                      </Button>
                      <Button
                        disabled={runningAction !== null}
                        onClick={() => void executeSkillAction('update', null, {
                          actionId: 'skills:update',
                          label: '更新技能',
                          refresh: true,
                        })}
                      >
                        {runningAction === 'skills:update' ? '更新中…' : '更新技能'}
                      </Button>
                      <Button
                        disabled={runningAction !== null}
                        onClick={() => void executeSkillAction('audit', null, {
                          actionId: 'skills:audit',
                          label: '审计已装技能',
                        })}
                      >
                        {runningAction === 'skills:audit' ? '审计中…' : '审计已装技能'}
                      </Button>
                      <Button onClick={() => navigate('config', configToolsetsIntent)}>
                        核对工具集
                      </Button>
                      <Button onClick={() => navigate('config', configMemoryIntent)}>
                        核对记忆链路
                      </Button>
                      <Button onClick={() => navigate('extensions', extensionsIntent)}>
                        扩展运行态
                      </Button>
                    </Toolbar>
                  </section>
                </div>

                <div className="workspace-bottom-grid workspace-bottom-grid-dense top-gap">
                  <section className="workspace-main-card">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">当前目标布线</h2>
                        <p className="config-section-desc">把目录技能、运行态可见性和自动化引用放在一起核对。</p>
                      </div>
                      <Pill tone={selectedSkill ? 'neutral' : 'warn'}>{selectedSkill?.name || '等待选择'}</Pill>
                    </div>
                    <div className="detail-list compact">
                      <KeyValueRow label="当前技能" value={selectedSkill?.name || '—'} />
                      <KeyValueRow label="分类" value={selectedSkill ? categoryLabel(selectedSkill.category) : '—'} />
                      <KeyValueRow label="运行态" value={selectedSkill ? (selectedExistsInRuntime ? '已进入' : '待同步') : '—'} />
                      <KeyValueRow label="编排显式引用" value={selectedSkill ? skillUsageJobs.length : 0} />
                      <KeyValueRow label="目录路径" value={selectedSkill?.relativePath || '—'} />
                    </div>
                    <Toolbar className="top-gap">
                      <Button onClick={() => navigate('cron')}>查看编排</Button>
                      <Button disabled={!selectedSkill} onClick={() => navigate('logs', logsIntent)}>
                        查看日志
                      </Button>
                    </Toolbar>
                  </section>

                  {renderResultCard()}
                </div>
              </>
            ) : null}

            {workspaceTab === 'studio' ? (
              <>
                <section className="shell-card shell-card-dense plugin-focus-card">
                  <div className="shell-card-header plugin-focus-head">
                    <div className="plugin-focus-title-wrap">
                      <div>
                        <div className="panel-title-row">
                          <strong>本地治理目标</strong>
                          <InfoTip content="这里优先承接技能的本地闭环：frontmatter、正文、目录控制都收进一个主卡，导入和新建退到下方辅助区。" />
                        </div>
                        <p className="shell-card-copy">让当前技能的接管、编辑和删除都在一个主卡里完成。</p>
                      </div>
                      {selectedSkill ? (
                        <div className="plugin-focus-title">
                          <span className="plugin-card-icon">Skill</span>
                          <div className="plugin-focus-title-copy">
                            <strong className="plugin-focus-name">{selectedSkill.name}</strong>
                            <div className="plugin-tile-badges">
                              <Pill>{selectedSkill.category || '未分类'}</Pill>
                              <Pill tone={selectedExistsInRuntime ? 'good' : 'warn'}>
                                {selectedExistsInRuntime ? '运行面已接入' : '运行面待同步'}
                              </Pill>
                              <Pill tone={skillFile ? 'good' : 'warn'}>{skillFile ? '正文已接管' : '等待文件'}</Pill>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <Pill tone={selectedSkill ? 'good' : 'warn'}>{selectedSkill?.name || '等待目标'}</Pill>
                  </div>

                  {selectedSkill ? (
                    <>
                      <div className="plugin-signal-grid top-gap">
                        <section className="plugin-signal-card">
                          <span className="plugin-signal-label">目录</span>
                          <strong className="plugin-signal-value">{selectedSkill.relativePath || '—'}</strong>
                          <span className="plugin-signal-meta">{selectedSkill.category || '未分类'}</span>
                        </section>
                        <section className="plugin-signal-card">
                          <span className="plugin-signal-label">运行态</span>
                          <strong className="plugin-signal-value">{selectedExistsInRuntime ? '已接入' : '待同步'}</strong>
                          <span className={`plugin-signal-meta ${selectedExistsInRuntime ? 'plugin-signal-meta-good' : 'plugin-signal-meta-warn'}`}>
                            {selectedExistsInRuntime ? '当前已暴露给运行面' : '仍只存在于本地目录'}
                          </span>
                        </section>
                        <section className="plugin-signal-card">
                          <span className="plugin-signal-label">自动化</span>
                          <strong className="plugin-signal-value">{skillUsageJobs.length ? `${skillUsageJobs.length} 个作业` : '未绑定'}</strong>
                          <span className={`plugin-signal-meta ${skillUsageJobs.length ? 'plugin-signal-meta-warn' : 'plugin-signal-meta-good'}`}>
                            {skillUsageJobs.length ? '删除前建议先解除 cron 引用' : '当前没有显式编排引用'}
                          </span>
                        </section>
                        <section className="plugin-signal-card">
                          <span className="plugin-signal-label">文件</span>
                          <strong className="plugin-signal-value">{skillFileLoading ? '读取中' : skillFile ? '已接管' : '待读取'}</strong>
                          <span className="plugin-signal-meta">{skillFile?.filePath || selectedSkill.filePath}</span>
                        </section>
                      </div>

                      {warnings.length ? (
                        <section className="plugin-focus-section top-gap">
                          <div className="plugin-focus-section-head">
                            <strong>当前提醒</strong>
                            <span>{warnings.length} 条</span>
                          </div>
                          <div className="warning-stack">
                            {warnings.slice(0, 3).map((warning) => (
                              <div className="warning-item" key={warning}>
                                {warning}
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      <div className="compact-disclosure-stack top-gap">
                        <details
                          className="compact-disclosure skill-frontmatter-disclosure"
                          open={frontmatterExpanded}
                          onToggle={(event) => setFrontmatterExpanded((event.currentTarget as HTMLDetailsElement).open)}
                        >
                          <summary className="compact-disclosure-summary">
                            <div className="compact-disclosure-head">
                              <div className="compact-disclosure-copy">
                                <strong className="compact-disclosure-title">Frontmatter 接管</strong>
                                <span className="preset-card-copy">只接管 <code>name / description</code>，其他 frontmatter 字段保持原样。</span>
                              </div>
                              <div className="pill-row">
                                <Pill tone={frontmatterDirty ? 'warn' : 'good'}>{frontmatterDirty ? '未保存' : '已同步'}</Pill>
                                <Pill>{selectedSkill.category}</Pill>
                              </div>
                            </div>
                          </summary>
                          <div className="compact-disclosure-body">
                            {skillFileLoading ? (
                              <EmptyState title="正在读取技能 frontmatter" description="稍后会把技能名称和描述直接填进表单。" />
                            ) : !skillFrontmatterDraft ? (
                              <EmptyState title="等待技能文件" description="先读取当前技能文件，再继续做结构化接管。" />
                            ) : (
                              <div className="plugin-manifest-grid">
                                <div className="plugin-manifest-meta">
                                  <span>frontmatter</span>
                                  <code>{skillFile?.filePath || selectedSkill.filePath}</code>
                                </div>
                                <div className="detail-list compact">
                                  <KeyValueRow label="分类" value={selectedSkill.category || '—'} />
                                  <KeyValueRow label="相对路径" value={selectedSkill.relativePath || '—'} />
                                </div>
                                <div className="form-grid form-grid-compact">
                                  <label className="field-stack">
                                    <span>技能名称</span>
                                    <input
                                      className="search-input"
                                      value={skillFrontmatterDraft.name}
                                      placeholder="例如 Browser QA"
                                      disabled={runningAction !== null}
                                      onChange={(event) => setSkillFrontmatterDraft((current) => (
                                        current ? { ...current, name: event.target.value } : current
                                      ))}
                                    />
                                  </label>
                                  <label className="field-stack">
                                    <span>描述</span>
                                    <input
                                      className="search-input"
                                      value={skillFrontmatterDraft.description}
                                      placeholder="一句话说明 skill 的用途"
                                      disabled={runningAction !== null}
                                      onChange={(event) => setSkillFrontmatterDraft((current) => (
                                        current ? { ...current, description: event.target.value } : current
                                      ))}
                                    />
                                  </label>
                                </div>
                                <Toolbar>
                                  <Button
                                    kind="primary"
                                    disabled={runningAction !== null || !skillFrontmatterDraft.name.trim()}
                                    onClick={() => void saveSkillFrontmatter()}
                                  >
                                    {runningAction === 'skills:save-frontmatter' ? '保存中…' : '保存 frontmatter'}
                                  </Button>
                                  <Button
                                    disabled={runningAction !== null}
                                    onClick={() => skillFile && applySkillFileDetail(skillFile)}
                                  >
                                    重置
                                  </Button>
                                </Toolbar>
                              </div>
                            )}
                          </div>
                        </details>

                        <details
                          className="compact-disclosure skill-content-disclosure"
                          open={contentExpanded}
                          onToggle={(event) => setContentExpanded((event.currentTarget as HTMLDetailsElement).open)}
                        >
                          <summary className="compact-disclosure-summary">
                            <div className="compact-disclosure-head">
                              <div className="compact-disclosure-copy">
                                <strong className="compact-disclosure-title">SKILL.md 正文编修</strong>
                                <span className="preset-card-copy">直接维护本地 <code>SKILL.md</code> 正文，不再跳外部终端。</span>
                              </div>
                              <div className="pill-row">
                                <Pill tone={skillFileDirty ? 'warn' : 'good'}>{skillFileDirty ? '未保存' : '已同步'}</Pill>
                                <Pill tone={skillFileLoading ? 'warn' : 'neutral'}>{skillFileLoading ? '读取中' : '正文'}</Pill>
                              </div>
                            </div>
                          </summary>
                          <div className="compact-disclosure-body">
                            <div className="plugin-manifest-grid">
                              <div className="plugin-manifest-meta">
                                <span>skill file</span>
                                <code>{skillFile?.filePath || selectedSkill.filePath}</code>
                              </div>
                              <label className="field-stack">
                                <span>SKILL.md</span>
                                <textarea
                                  className="editor compact-skill-editor"
                                  placeholder="正在读取技能文件…"
                                  disabled={runningAction !== null}
                                  value={skillFile?.content || ''}
                                  onChange={(event) => setSkillFile((current) => (
                                    current ? { ...current, content: event.target.value } : current
                                  ))}
                                />
                              </label>
                              <Toolbar>
                                <Button
                                  kind="primary"
                                  disabled={runningAction !== null || !skillFile}
                                  onClick={() => void saveSkillFile()}
                                >
                                  {runningAction === 'skills:save-file' ? '保存中…' : '保存技能文件'}
                                </Button>
                                <Button
                                  disabled={runningAction !== null || !selectedSkill}
                                  onClick={() => setSelectedPath(selectedSkill?.filePath ?? null)}
                                >
                                  重新读取
                                </Button>
                                <Button
                                  disabled={runningAction !== null || !selectedSkill}
                                  onClick={() => selectedSkill && void openInFinder(selectedSkill.filePath, `${selectedSkill.name} 技能文件`, true)}
                                >
                                  定位文件
                                </Button>
                                <Button
                                  disabled={runningAction !== null || !selectedSkill}
                                  onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}
                                >
                                  打开目录
                                </Button>
                              </Toolbar>
                            </div>
                          </div>
                        </details>

                        <details
                          className="compact-disclosure skill-localops-disclosure"
                          open={localOpsExpanded}
                          onToggle={(event) => setLocalOpsExpanded((event.currentTarget as HTMLDetailsElement).open)}
                        >
                          <summary className="compact-disclosure-summary">
                            <div className="compact-disclosure-head">
                              <div className="compact-disclosure-copy">
                                <strong className="compact-disclosure-title">本地目录控制</strong>
                                <span className="preset-card-copy">把定位、确认和删除收进危险区，避免和主治理动作挤在一起。</span>
                              </div>
                              <div className="pill-row">
                                <Pill tone={selectedExistsInRuntime ? 'warn' : 'good'}>
                                  {selectedExistsInRuntime ? '运行面已接入' : '仅目录可见'}
                                </Pill>
                                <Pill tone={skillUsageJobs.length ? 'warn' : 'neutral'}>
                                  {skillUsageJobs.length ? `${skillUsageJobs.length} 个编排引用` : '未绑定编排'}
                                </Pill>
                              </div>
                            </div>
                          </summary>
                          <div className="compact-disclosure-body">
                            <div className="detail-list compact">
                              <KeyValueRow label="技能目录" value={directoryOf(skillFile?.filePath || selectedSkill.filePath) || '—'} />
                              <KeyValueRow label="相对路径" value={selectedSkill.relativePath || '—'} />
                              <KeyValueRow label="技能文件" value={skillFile?.filePath || selectedSkill.filePath || '—'} />
                              <KeyValueRow label="运行态" value={selectedExistsInRuntime ? '已进入运行面' : '仅目录可见'} />
                            </div>
                            <div className="danger-copy-compact">
                              <strong>本地危险操作</strong>
                              <p>
                                {skillUsageJobs.length > 0
                                  ? `当前技能仍被 ${skillUsageJobs.length} 个 cron 作业引用。先解除编排绑定，再删除本地目录。`
                                  : selectedExistsInRuntime
                                    ? '当前技能已经进入运行面。删除目录后，下次刷新运行态会失去该技能来源。'
                                    : '删除只影响当前 profile 的本地 skills 目录，不会触碰其他 profile。'}
                              </p>
                            </div>
                            <label className="field-stack">
                              <span>删除确认</span>
                              <input
                                className="search-input"
                                value={skillDeleteConfirm}
                                placeholder={`输入 ${selectedSkill.name} 以确认删除`}
                                disabled={runningAction !== null}
                                onChange={(event) => setSkillDeleteConfirm(event.target.value)}
                              />
                            </label>
                            <Toolbar>
                              <Button
                                disabled={runningAction !== null || !selectedSkill}
                                onClick={() => selectedSkill && void openInFinder(selectedSkill.filePath, `${selectedSkill.name} 技能文件`, true)}
                              >
                                定位文件
                              </Button>
                              <Button
                                disabled={runningAction !== null || !selectedSkill}
                                onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}
                              >
                                打开目录
                              </Button>
                              <Button
                                kind="danger"
                                disabled={runningAction !== null || skillUsageJobs.length > 0 || skillDeleteConfirm.trim() !== selectedSkill.name}
                                onClick={() => void deleteLocalSkill(selectedSkill, skillUsageJobs)}
                              >
                                {runningAction === 'skills:delete-local' ? '删除中…' : '删除本地目录'}
                              </Button>
                            </Toolbar>
                          </div>
                        </details>
                      </div>

                      <Toolbar className="top-gap">
                        <Button disabled={!selectedSkill} onClick={() => navigate('logs', logsIntent)}>查看日志</Button>
                        <Button onClick={() => navigate('cron')}>查看编排</Button>
                        <Button onClick={() => navigate('extensions', extensionsIntent)}>扩展运行态</Button>
                      </Toolbar>
                    </>
                  ) : (
                    <div className="top-gap">
                      <EmptyState title="还没选治理目标" description="先从左侧技能目录选择一个 skill，本地治理卡就会接管 frontmatter、正文和目录控制。" />
                    </div>
                  )}
                </section>

                <div className="compact-disclosure-stack top-gap">
                  <details
                    className="compact-disclosure"
                    open={importExpanded}
                    onToggle={(event) => setImportExpanded((event.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="compact-disclosure-summary">
                      <div className="compact-disclosure-head">
                        <div className="compact-disclosure-copy">
                          <strong className="compact-disclosure-title">导入现成技能</strong>
                          <span className="preset-card-copy">需要接入现有技能目录或单个 SKILL.md 时，再展开这一层。</span>
                        </div>
                        <div className="pill-row">
                          <Pill tone={lastImportedSkill ? 'good' : 'neutral'}>
                            {lastImportedSkill ? `${lastImportedSkill.copiedFiles} 个文件` : '等待导入'}
                          </Pill>
                          <Pill>{importDraft.category || '自动归类'}</Pill>
                        </div>
                      </div>
                    </summary>
                    <div className="compact-disclosure-body">
                      <div className="form-grid">
                        <label className="field-stack">
                          <span>源路径</span>
                          <input
                            className="search-input"
                            value={importDraft.sourcePath}
                            placeholder="~/Downloads/release-notes 或 /tmp/demo/SKILL.md"
                            onChange={(event) => setImportDraft((current) => ({ ...current, sourcePath: event.target.value }))}
                          />
                        </label>
                        <label className="field-stack">
                          <span>归档分类</span>
                          <input
                            className="search-input"
                            value={importDraft.category}
                            placeholder="留空沿用源分类，否则归入 imported"
                            onChange={(event) => setImportDraft((current) => ({ ...current, category: event.target.value }))}
                          />
                        </label>
                      </div>
                      <div className="checkbox-row top-gap">
                        <label>
                          <input
                            type="checkbox"
                            checked={importDraft.overwrite}
                            onChange={(event) => setImportDraft((current) => ({ ...current, overwrite: event.target.checked }))}
                          />
                          覆盖当前实例中已存在的同名目标
                        </label>
                      </div>
                      {lastImportedSkill ? (
                        <div className="detail-list compact top-gap">
                          <KeyValueRow label="最近导入" value={lastImportedSkill.imported.name} />
                          <KeyValueRow label="来源" value={lastImportedSkill.sourcePath} />
                          <KeyValueRow label="目标目录" value={lastImportedSkill.targetDirectory} />
                          <KeyValueRow label="归档分类" value={lastImportedSkill.imported.category} />
                        </div>
                      ) : null}
                      <Toolbar className="top-gap">
                        <Button
                          kind="primary"
                          disabled={runningAction !== null || !importDraft.sourcePath.trim()}
                          onClick={() => void importLocalSkill()}
                        >
                          {runningAction === 'skills:import-local' ? '导入中…' : '导入到当前实例'}
                        </Button>
                        <Button
                          disabled={runningAction !== null}
                          onClick={() => setImportDraft(cloneSkillImportDraft())}
                        >
                          清空路径
                        </Button>
                        <Button
                          disabled={runningAction !== null || !selectedSkill}
                          onClick={() => selectedSkill && setImportDraft((current) => ({ ...current, category: selectedSkill.category || current.category }))}
                        >
                          带入当前分类
                        </Button>
                        <Button
                          disabled={runningAction !== null}
                          onClick={() => snapshot && void openInFinder(snapshot.hermesHome, 'Hermes Home')}
                        >
                          打开 Home
                        </Button>
                      </Toolbar>
                    </div>
                  </details>

                  <details
                    className="compact-disclosure"
                    open={createExpanded}
                    onToggle={(event) => setCreateExpanded((event.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="compact-disclosure-summary">
                      <div className="compact-disclosure-head">
                        <div className="compact-disclosure-copy">
                          <strong className="compact-disclosure-title">新建本地技能</strong>
                          <span className="preset-card-copy">只有在需要定制私有能力时，再展开创建脚手架。</span>
                        </div>
                        <div className="pill-row">
                          <Pill>{createDraft.category || 'custom'}</Pill>
                          <Pill tone={createDraft.name.trim() ? 'good' : 'neutral'}>{createDraft.name.trim() ? '草稿已填写' : '空白草稿'}</Pill>
                        </div>
                      </div>
                    </summary>
                    <div className="compact-disclosure-body">
                      <div className="form-grid">
                        <label className="field-stack">
                          <span>名称</span>
                          <input
                            className="search-input"
                            value={createDraft.name}
                            placeholder="Release Notes"
                            onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
                          />
                        </label>
                        <label className="field-stack">
                          <span>分类</span>
                          <input
                            className="search-input"
                            value={createDraft.category}
                            placeholder="ops / coding / custom"
                            onChange={(event) => setCreateDraft((current) => ({ ...current, category: event.target.value }))}
                          />
                        </label>
                      </div>
                      <label className="field-stack">
                        <span>描述</span>
                        <input
                          className="search-input"
                          value={createDraft.description}
                          placeholder="生成版本发布说明并整理亮点"
                          onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                        />
                      </label>
                      <label className="field-stack top-gap">
                        <span>内容模板</span>
                        <textarea
                          className="editor compact-control-editor"
                          value={createDraft.content}
                          placeholder={'# Release Notes\n\n## 目标\n\n在这里编写 skill 具体内容。'}
                          onChange={(event) => setCreateDraft((current) => ({ ...current, content: event.target.value }))}
                        />
                      </label>
                      <Toolbar className="top-gap">
                        <Button
                          kind="primary"
                          disabled={runningAction !== null || !createDraft.name.trim()}
                          onClick={() => void createLocalSkill()}
                        >
                          {runningAction === 'skills:create-local' ? '创建中…' : '创建本地技能'}
                        </Button>
                        <Button
                          disabled={runningAction !== null}
                          onClick={() => setCreateDraft(cloneSkillDraft())}
                        >
                          清空草稿
                        </Button>
                      </Toolbar>
                    </div>
                  </details>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}
