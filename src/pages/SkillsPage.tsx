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
import { truncate } from '../lib/format';
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
type SkillsOverviewViewKey = 'launch' | 'focus' | 'warnings';
type SkillsRailViewKey = 'pick' | 'focus';
type SkillsRegistryViewKey = 'install' | 'governance' | 'wiring' | 'output';
type SkillsStudioViewKey = 'frontmatter' | 'content' | 'localops' | 'sources';

const WORKSPACE_TABS: Array<{ key: WorkspaceTab; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看推荐路径、当前技能摘要和关键提醒。' },
  { key: 'registry', label: '安装与启用', hint: '优先做搜索、预检、安装和常用布线核对。' },
  { key: 'studio', label: '本地维护', hint: '需要编辑 SKILL.md、导入或删除目录时再展开。' },
];

const OVERVIEW_VIEWS: Array<{ key: SkillsOverviewViewKey; label: string; icon: string; hint: string }> = [
  { key: 'launch', label: '常用去向', icon: '🚀', hint: '先决定去安装启用、扩展运行态、自动化编排还是本地维护。' },
  { key: 'focus', label: '当前焦点', icon: '🌤️', hint: '只看当前技能的一层摘要和下一步动作，不把提醒区一起铺开。' },
  { key: 'warnings', label: '关键提醒', icon: '⚠️', hint: '真正影响技能闭环的提醒单独收成一层，需要时再看。' },
];

const RAIL_VIEWS: Array<{ key: SkillsRailViewKey; label: string; icon: string; hint: string }> = [
  { key: 'pick', label: '选择技能', icon: '🗂️', hint: '先搜索和筛选，再从短列表锁定一个技能。' },
  { key: 'focus', label: '当前焦点', icon: '🎯', hint: '只看当前技能摘要和快捷动作，不和长列表同屏。' },
];

const REGISTRY_VIEWS: Array<{ key: SkillsRegistryViewKey; label: string; icon: string; hint: string }> = [
  { key: 'install', label: '搜索与安装', icon: '📦', hint: '默认先做搜索、预检和安装，不把低频治理动作堆在首页。' },
  { key: 'governance', label: '更新与核对', icon: '🧭', hint: '更新、审计和配置链路核对统一收进这一层。' },
  { key: 'wiring', label: '目标布线', icon: '🔗', hint: '只在需要确认目录、运行态和编排是否闭环时再看。' },
  { key: 'output', label: '最近回执', icon: '🧾', hint: '原始输出后置到单独一层，避免主视图被日志占满。' },
];

const STUDIO_VIEWS: Array<{ key: SkillsStudioViewKey; label: string; icon: string; hint: string }> = [
  { key: 'frontmatter', label: '基本信息', icon: '🏷️', hint: '只接管名称和描述，适合快速整理技能门面。' },
  { key: 'content', label: 'SKILL.md', icon: '📝', hint: '正文编修和文件定位只在这一层出现。' },
  { key: 'localops', label: '目录控制', icon: '🧯', hint: '危险操作与目录定位继续后置，避免误触。' },
  { key: 'sources', label: '导入与新建', icon: '🧰', hint: '导入现成技能或新建私有技能时，再进入这里。' },
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
  const [railView, setRailView] = useState<SkillsRailViewKey>('pick');
  const [overviewView, setOverviewView] = useState<SkillsOverviewViewKey>('launch');
  const [registryView, setRegistryView] = useState<SkillsRegistryViewKey>('install');
  const [studioView, setStudioView] = useState<SkillsStudioViewKey>('frontmatter');
  const [skillFile, setSkillFile] = useState<SkillFileDetail | null>(null);
  const [skillFileSavedContent, setSkillFileSavedContent] = useState('');
  const [skillFileLoading, setSkillFileLoading] = useState(false);
  const [skillFrontmatterDraft, setSkillFrontmatterDraft] = useState<SkillFrontmatterDraft | null>(null);
  const [skillDeleteConfirm, setSkillDeleteConfirm] = useState('');
  const [createDraft, setCreateDraft] = useState<SkillDraft>(cloneSkillDraft());
  const [importDraft, setImportDraft] = useState<SkillImportDraft>(cloneSkillImportDraft());
  const [lastImportedSkill, setLastImportedSkill] = useState<SkillImportResult | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAllFilteredSkills, setShowAllFilteredSkills] = useState(false);
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

  function openRegistryInstall(nextSkill?: SkillItem | null) {
    if (nextSkill) {
      setRegistryQuery(nextSkill.name);
      setInstallTarget(nextSkill.name);
    }
    setRegistryView('install');
    setWorkspaceTab('registry');
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
      setStudioView('content');
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
      setStudioView('sources');
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
    setRailView('pick');
    setOverviewView('launch');
    setRegistryView('install');
    setStudioView('frontmatter');
    setShowFilters(false);
    setShowAllFilteredSkills(false);
    void load();
  }, [profile]);

  useEffect(() => {
    setShowFilters(false);
    setShowAllFilteredSkills(false);
  }, [query, categoryFilter]);

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
  const visibleFilteredSkills = showAllFilteredSkills ? filtered : filtered.slice(0, 8);

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
  const activeOverviewView = OVERVIEW_VIEWS.find((item) => item.key === overviewView) ?? OVERVIEW_VIEWS[0];
  const activeRailView = RAIL_VIEWS.find((item) => item.key === railView) ?? RAIL_VIEWS[0];
  const activeRegistryView = REGISTRY_VIEWS.find((item) => item.key === registryView) ?? REGISTRY_VIEWS[0];
  const activeStudioView = STUDIO_VIEWS.find((item) => item.key === studioView) ?? STUDIO_VIEWS[0];
  const hiddenFilteredSkillCount = Math.max(0, filtered.length - visibleFilteredSkills.length);
  const hasActiveFilters = Boolean(query.trim()) || categoryFilter !== 'all';
  const selectedSkillSummary = selectedSkill
    ? truncate(selectedSkill.description || selectedSkill.preview || '当前技能暂无更多摘要。', 92)
    : '';
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
                <h2 className="config-section-title">技能侧栏</h2>
                <p className="config-section-desc">左侧也拆成二级工作面，避免搜索、焦点和长列表同时堆叠。</p>
              </div>
              <Pill tone={selectedSkill ? 'neutral' : 'warn'}>{selectedSkill?.name || '等待选择'}</Pill>
            </div>

            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              {RAIL_VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`workspace-shortcut-card dashboard-shortcut-card ${railView === item.key ? 'active' : ''}`}
                  onClick={() => setRailView(item.key)}
                >
                  <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                  <span>{item.key === 'focus' ? (selectedSkill ? selectedSkill.name : '先从列表里选一个技能') : item.hint}</span>
                </button>
              ))}
            </div>
            <p className="helper-text top-gap">{activeRailView.hint}</p>

            {railView === 'pick' ? (
              <>
                <div className="workspace-rail-toolbar">
                  <input
                    className="search-input"
                    placeholder="搜索名称、分类、描述、路径"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button onClick={() => setShowFilters((current) => !current)}>
                    {showFilters ? '收起筛选' : hasActiveFilters ? '筛选已启用' : '更多筛选'}
                  </Button>
                </div>

                {showFilters ? (
                  <>
                    <div className="workspace-rail-toolbar top-gap">
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
                  </>
                ) : (
                  <p className="helper-text top-gap">
                    {hasActiveFilters
                      ? `当前筛选：${categoryFilter === 'all' ? '全部分类' : categoryFilter}${query.trim() ? ` · ${query.trim()}` : ''}`
                      : '默认只露出搜索框，分类筛选收进“更多筛选”。'}
                  </p>
                )}

                <section className="workspace-rail-section">
                  <div className="workspace-rail-section-header">
                    <span className="workspace-rail-section-title">技能列表</span>
                    <Pill>{filtered.length}</Pill>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="top-gap">
                      <EmptyState title="未匹配到技能" description="调整关键词或分类后再试。" />
                    </div>
                  ) : (
                    <>
                      <div className="list-stack workspace-list-scroll top-gap">
                        {visibleFilteredSkills.map((skill) => {
                          const referenced = jobs.some((job) => job.skills.includes(skill.name));
                          const runtimeVisible = extensions.runtimeSkills.some((item) => item.name === skill.name);
                          return (
                            <button
                              type="button"
                              className={`list-card session-card ${selectedSkill?.filePath === skill.filePath ? 'selected' : ''}`}
                              key={skill.filePath}
                              onClick={() => {
                                setSelectedPath(skill.filePath);
                                setRailView('focus');
                              }}
                            >
                              <div className="list-card-title">
                                <strong>{skill.name}</strong>
                                <div className="pill-row">
                                  <Pill>{categoryLabel(skill.category)}</Pill>
                                  <Pill tone={runtimeVisible ? 'good' : 'warn'}>{runtimeVisible ? '运行面可见' : '待进入运行面'}</Pill>
                                </div>
                              </div>
                              <p className="skill-list-copy">{truncate(skill.description || skill.preview || '底层未返回描述。', 72)}</p>
                              <div className="meta-line">
                                <span>{skill.relativePath}</span>
                                <span>{referenced ? '已编排' : '未编排'}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {filtered.length > visibleFilteredSkills.length ? (
                        <div className="workspace-rail-toolbar top-gap">
                          <Button onClick={() => setShowAllFilteredSkills((current) => !current)}>
                            {showAllFilteredSkills ? '收起技能列表' : `展开更多技能（剩余 ${hiddenFilteredSkillCount} 项）`}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              </>
            ) : null}

            {railView === 'focus' ? (
              <>
                <section className="workspace-rail-section">
                  <div className="workspace-rail-section-header">
                    <span className="workspace-rail-section-title">当前焦点</span>
                    <Pill tone={selectedSkill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral'}>
                      {selectedSkill ? (selectedExistsInRuntime ? '运行面已接入' : '运行面待同步') : '等待选择'}
                    </Pill>
                  </div>
                  {selectedSkill ? (
                    <>
                      <button
                        type="button"
                        className="list-card session-card selected top-gap"
                        onClick={() => setSelectedPath(selectedSkill.filePath)}
                      >
                        <div className="list-card-title">
                          <strong>{selectedSkill.name}</strong>
                          <div className="pill-row">
                            <Pill>{categoryLabel(selectedSkill.category)}</Pill>
                            <Pill tone={skillUsageJobs.length > 0 ? 'warn' : 'neutral'}>
                              {skillUsageJobs.length > 0 ? `${skillUsageJobs.length} 个作业` : '未编排'}
                            </Pill>
                          </div>
                        </div>
                        <p className="skill-list-copy">{selectedSkillSummary}</p>
                        <div className="meta-line">
                          <span>{selectedSkill.relativePath}</span>
                          <span>{selectedExistsInRuntime ? '运行面可见' : '等待同步'}</span>
                        </div>
                      </button>
                      <div className="workspace-rail-toolbar workspace-rail-toolbar-grid top-gap">
                        <Button
                          kind="primary"
                          disabled={runningAction !== null || !selectedSkill}
                          onClick={() => openRegistryInstall(selectedSkill)}
                        >
                          去安装启用
                        </Button>
                        <Button
                          disabled={runningAction !== null || !selectedSkill}
                          onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}
                        >
                          打开目录
                        </Button>
                        <Button onClick={() => setRailView('pick')}>
                          回到列表
                        </Button>
                      </div>
                      <p className="helper-text top-gap">默认只回答“当前是谁、状态怎样、下一步去哪”，其他细节继续留在右侧主区。</p>
                    </>
                  ) : (
                    <div className="top-gap">
                      <EmptyState title="还没选中技能" description="先切回“选择技能”，再从短列表点一个目标。" />
                    </div>
                  )}
                </section>

                {warnings.length > 0 && workspaceTab !== 'overview' ? (
                  <div className="warning-stack top-gap">
                    {warnings.slice(0, 1).map((warning) => (
                      <div className="warning-item" key={warning}>
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <div className="workspace-main">
            {workspaceTab === 'overview' ? (
              <>
                <section className="workspace-main-card">
                  <div className="workspace-main-header">
                    <div>
                      <div className="panel-title-row">
                        <h2 className="config-section-title">总览入口</h2>
                        <Pill>{activeOverviewView.label}</Pill>
                      </div>
                      <p className="workspace-main-copy">
                        总览主区继续拆成二级工作面，默认只展开一个主模块，减少右侧主区的拥挤感。
                      </p>
                    </div>
                  </div>
                  <div className="workspace-shortcut-grid dashboard-launcher-grid">
                    {OVERVIEW_VIEWS.map((item) => (
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
                </section>

                {overviewView === 'launch' ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">常用去向</h2>
                        <p className="config-section-desc">首页只保留最常用的四条路径，安装、运行态、编排和本地维护分开露出。</p>
                      </div>
                    </div>
                    <div className="workspace-shortcut-grid dashboard-launcher-grid">
                      <button
                        type="button"
                        className="workspace-shortcut-card dashboard-shortcut-card"
                        disabled={!selectedSkill}
                        onClick={() => openRegistryInstall(selectedSkill)}
                      >
                        <strong><span className="dashboard-shortcut-icon">📦</span>安装与启用</strong>
                        <span>{selectedSkill ? `${selectedSkill.name} ${selectedExistsInRuntime ? '可继续核对安装态' : '建议先做启用或预检'}` : '先从左侧选择一个技能'}</span>
                      </button>
                      <button
                        type="button"
                        className="workspace-shortcut-card dashboard-shortcut-card"
                        disabled={!selectedSkill}
                        onClick={() => navigate('extensions', extensionsIntent)}
                      >
                        <strong><span className="dashboard-shortcut-icon">🧩</span>运行态核对</strong>
                        <span>{selectedSkill ? (selectedExistsInRuntime ? '当前技能已进入运行态，可继续核对来源' : '当前技能还没进入运行态') : '先选技能再看扩展运行态'}</span>
                      </button>
                      <button
                        type="button"
                        className="workspace-shortcut-card dashboard-shortcut-card"
                        onClick={() => navigate('cron')}
                      >
                        <strong><span className="dashboard-shortcut-icon">⏱️</span>自动化编排</strong>
                        <span>{selectedSkill ? `${skillUsageJobs.length} 个作业显式引用当前技能` : `${jobs.length} 个作业可继续核对技能布线`}</span>
                      </button>
                      <button
                        type="button"
                        className="workspace-shortcut-card dashboard-shortcut-card"
                        disabled={!selectedSkill}
                        onClick={() => {
                          setStudioView('frontmatter');
                          setWorkspaceTab('studio');
                        }}
                      >
                        <strong><span className="dashboard-shortcut-icon">📝</span>本地维护</strong>
                        <span>{selectedSkill ? (skillFile ? 'frontmatter 与正文已经可编辑' : '正文正在准备接管') : '需要时再进入本地维护'}</span>
                      </button>
                    </div>
                    <p className="helper-text top-gap">常用总览只负责决定下一步去哪里，不再直接铺开大量技能细节与编辑块。</p>
                  </section>
                ) : null}

                {overviewView === 'focus' ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">当前焦点技能</h2>
                        <p className="config-section-desc">默认只保留一层摘要和少量后续动作，避免总览页继续变成信息墙。</p>
                      </div>
                      <Pill tone={selectedSkill ? (selectedExistsInRuntime ? 'good' : 'warn') : 'neutral'}>
                        {selectedSkill ? (selectedExistsInRuntime ? '运行面已接入' : '运行面待同步') : '等待选择'}
                      </Pill>
                    </div>
                    {selectedSkill ? (
                      <>
                        <div className="workspace-summary-strip">
                          <section className="summary-mini-card">
                            <span className="summary-mini-label">名称</span>
                            <strong className="summary-mini-value">{selectedSkill.name}</strong>
                            <span className="summary-mini-meta">{categoryLabel(selectedSkill.category)}</span>
                          </section>
                          <section className="summary-mini-card">
                            <span className="summary-mini-label">运行态</span>
                            <strong className="summary-mini-value">{selectedExistsInRuntime ? '已接入' : '待同步'}</strong>
                            <span className="summary-mini-meta">{selectedExistsInRuntime ? '当前实例已能看到它' : '建议先做启用或运行态核对'}</span>
                          </section>
                          <section className="summary-mini-card">
                            <span className="summary-mini-label">编排引用</span>
                            <strong className="summary-mini-value">{skillUsageJobs.length}</strong>
                            <span className="summary-mini-meta">{skillUsageJobs.length > 0 ? '当前技能已进入 cron 编排' : '当前还没有进入自动化编排'}</span>
                          </section>
                          <section className="summary-mini-card">
                            <span className="summary-mini-label">目录路径</span>
                            <strong className="summary-mini-value">{selectedSkill.relativePath}</strong>
                            <span className="summary-mini-meta">{skillFile ? '正文已接管' : '正文待读取'}</span>
                          </section>
                        </div>
                        <p className="helper-text top-gap">{selectedSkill.preview || '当前技能没有更多预览内容。'}</p>
                        <Toolbar className="top-gap">
                          <Button kind="primary" disabled={runningAction !== null || !selectedSkill} onClick={() => openRegistryInstall(selectedSkill)}>
                            去安装启用
                          </Button>
                          <Button disabled={!selectedSkill} onClick={() => navigate('logs', logsIntent)}>
                            查看日志
                          </Button>
                          <Button disabled={!selectedSkill} onClick={() => navigate('extensions', extensionsIntent)}>
                            扩展运行态
                          </Button>
                          <Button disabled={!selectedSkill} onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}>
                            技能目录
                          </Button>
                        </Toolbar>
                      </>
                    ) : (
                      <EmptyState title="未选择技能" description="先从左侧选择一个技能。" />
                    )}
                  </section>
                ) : null}

                {overviewView === 'warnings' ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">关键提醒</h2>
                        <p className="config-section-desc">只保留会影响技能闭环的信号，不抢主操作位。</p>
                      </div>
                      <Pill tone="warn">{warnings.length} 条</Pill>
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
                        {remainingWarningCount > 0 ? <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在安装与启用、本地维护等子模块里。</p> : null}
                      </>
                    ) : (
                      <EmptyState title="当前提醒不多" description="技能层暂时没有新的结构性风险，可以继续去安装启用或消息日志做下一步核对。" />
                    )}
                  </section>
                ) : null}
              </>
            ) : null}

            {workspaceTab === 'registry' ? (
              <>
                <section className="workspace-main-card">
                  <div className="workspace-main-header">
                    <div>
                      <div className="panel-title-row">
                        <h2 className="config-section-title">安装与启用入口</h2>
                        <InfoTip content="搜索、更新、布线和回执分成单独子视图，避免安装页一上来就是一整面表单和日志。" />
                      </div>
                      <p className="config-section-desc">这里只先决定当前要做哪类动作，具体内容一次只展开一层。</p>
                    </div>
                    <Pill tone={installTarget.trim() ? 'good' : 'neutral'}>{installTarget.trim() || selectedSkill?.name || '等待目标'}</Pill>
                  </div>
                  <div className="workspace-shortcut-grid dashboard-launcher-grid">
                    {REGISTRY_VIEWS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`workspace-shortcut-card dashboard-shortcut-card ${registryView === item.key ? 'active' : ''}`}
                        onClick={() => setRegistryView(item.key)}
                      >
                        <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                        <span>{item.hint}</span>
                      </button>
                    ))}
                  </div>
                  <p className="helper-text top-gap">{activeRegistryView.hint}</p>
                </section>

                {registryView === 'install' ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">搜索、预检与安装</h2>
                        <p className="config-section-desc">先搜关键词，再对目标技能做预检或安装，这是最常走的技能接入路径。</p>
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
                    <Toolbar className="top-gap">
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
                      <Button disabled={runningAction !== null || !selectedSkill} onClick={() => selectedSkill && openRegistryInstall(selectedSkill)}>
                        使用当前技能
                      </Button>
                    </Toolbar>
                    <p className="helper-text top-gap">调用的是桌面端封装动作，不会把你甩回外部终端。</p>
                  </section>
                ) : null}

                {registryView === 'governance' ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">更新与核对</h2>
                        <p className="config-section-desc">更新、审计和配置链路核查继续留在这里，不再和常用安装动作混在一起。</p>
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
                    {warnings.length > 0 ? (
                      <div className="warning-stack top-gap">
                        {warnings.slice(0, 3).map((warning) => (
                          <div className="warning-item" key={warning}>
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {registryView === 'wiring' ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">当前目标布线</h2>
                        <p className="config-section-desc">把目录技能、运行态可见性和自动化引用放在一起核对。</p>
                      </div>
                      <Pill tone={selectedSkill ? 'neutral' : 'warn'}>{selectedSkill?.name || '等待选择'}</Pill>
                    </div>
                    <div className="workspace-summary-strip">
                      <section className="summary-mini-card">
                        <span className="summary-mini-label">当前技能</span>
                        <strong className="summary-mini-value">{selectedSkill?.name || '—'}</strong>
                        <span className="summary-mini-meta">{selectedSkill ? categoryLabel(selectedSkill.category) : '先在左侧选技能'}</span>
                      </section>
                      <section className="summary-mini-card">
                        <span className="summary-mini-label">运行态</span>
                        <strong className="summary-mini-value">{selectedSkill ? (selectedExistsInRuntime ? '已进入' : '待同步') : '—'}</strong>
                        <span className="summary-mini-meta">{selectedSkill ? (selectedExistsInRuntime ? '当前实例已可见' : '建议先做预检或安装') : '等待目标'}</span>
                      </section>
                      <section className="summary-mini-card">
                        <span className="summary-mini-label">编排显式引用</span>
                        <strong className="summary-mini-value">{selectedSkill ? skillUsageJobs.length : 0}</strong>
                        <span className="summary-mini-meta">{skillUsageJobs.length > 0 ? skillUsageJobs.map((job) => job.name).slice(0, 2).join('、') : '当前还没有 cron 引用'}</span>
                      </section>
                      <section className="summary-mini-card">
                        <span className="summary-mini-label">目录路径</span>
                        <strong className="summary-mini-value">{selectedSkill?.relativePath || '—'}</strong>
                        <span className="summary-mini-meta">{selectedSkill ? '当前目录来源' : '等待目标'}</span>
                      </section>
                    </div>
                    <Toolbar className="top-gap">
                      <Button onClick={() => navigate('cron')}>查看编排</Button>
                      <Button disabled={!selectedSkill} onClick={() => navigate('logs', logsIntent)}>
                        查看日志
                      </Button>
                      <Button disabled={!selectedSkill} onClick={() => navigate('extensions', extensionsIntent)}>
                        扩展运行态
                      </Button>
                    </Toolbar>
                  </section>
                ) : null}

                {registryView === 'output' ? <div className="top-gap">{renderResultCard()}</div> : null}
              </>
            ) : null}

            {workspaceTab === 'studio' ? (
              <>
                <section className="workspace-main-card">
                  <div className="workspace-main-header">
                    <div>
                      <div className="panel-title-row">
                        <h2 className="config-section-title">本地维护入口</h2>
                        <InfoTip content="把基本信息、正文、危险操作、导入与新建拆成单独子视图，避免本地维护页一上来就出现整面 disclosure。" />
                      </div>
                      <p className="config-section-desc">先选一个维护目标，再进入对应子模块；默认不把所有编辑器和危险区同时摊开。</p>
                    </div>
                    <Pill tone={selectedSkill ? 'good' : 'warn'}>{selectedSkill?.name || '等待目标'}</Pill>
                  </div>
                  <div className="workspace-shortcut-grid dashboard-launcher-grid">
                    {STUDIO_VIEWS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`workspace-shortcut-card dashboard-shortcut-card ${studioView === item.key ? 'active' : ''}`}
                        onClick={() => setStudioView(item.key)}
                      >
                        <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                        <span>{item.hint}</span>
                      </button>
                    ))}
                  </div>
                  <p className="helper-text top-gap">{activeStudioView.hint}</p>
                </section>

                {!selectedSkill && studioView !== 'sources' ? (
                  <section className="workspace-main-card top-gap">
                    <EmptyState title="还没选治理目标" description="先从左侧技能目录选择一个 skill，本地治理区才会接管基本信息、正文和目录控制。" />
                  </section>
                ) : null}

                {studioView === 'frontmatter' && selectedSkill ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">Frontmatter 接管</h2>
                        <p className="config-section-desc">只接管 <code>name / description</code>，其他 frontmatter 字段保持原样。</p>
                      </div>
                      <div className="pill-row">
                        <Pill tone={frontmatterDirty ? 'warn' : 'good'}>{frontmatterDirty ? '未保存' : '已同步'}</Pill>
                        <Pill>{selectedSkill.category}</Pill>
                      </div>
                    </div>
                    {skillFileLoading ? (
                      <EmptyState title="正在读取技能 frontmatter" description="稍后会把技能名称和描述直接填进表单。" />
                    ) : !skillFrontmatterDraft ? (
                      <EmptyState title="等待技能文件" description="先读取当前技能文件，再继续做结构化接管。" />
                    ) : (
                      <>
                        <div className="detail-list compact">
                          <KeyValueRow label="分类" value={selectedSkill.category || '—'} />
                          <KeyValueRow label="相对路径" value={selectedSkill.relativePath || '—'} />
                          <KeyValueRow label="技能文件" value={skillFile?.filePath || selectedSkill.filePath} />
                        </div>
                        <div className="form-grid form-grid-compact top-gap">
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
                        <Toolbar className="top-gap">
                          <Button
                            kind="primary"
                            disabled={runningAction !== null || !skillFrontmatterDraft.name.trim()}
                            onClick={() => void saveSkillFrontmatter()}
                          >
                            {runningAction === 'skills:save-frontmatter' ? '保存中…' : '保存 frontmatter'}
                          </Button>
                          <Button disabled={runningAction !== null} onClick={() => skillFile && applySkillFileDetail(skillFile)}>
                            重置
                          </Button>
                          <Button disabled={!selectedSkill} onClick={() => navigate('logs', logsIntent)}>
                            查看日志
                          </Button>
                        </Toolbar>
                      </>
                    )}
                  </section>
                ) : null}

                {studioView === 'content' && selectedSkill ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">SKILL.md 正文编修</h2>
                        <p className="config-section-desc">直接维护本地 <code>SKILL.md</code> 正文，不再跳外部终端。</p>
                      </div>
                      <div className="pill-row">
                        <Pill tone={skillFileDirty ? 'warn' : 'good'}>{skillFileDirty ? '未保存' : '已同步'}</Pill>
                        <Pill tone={skillFileLoading ? 'warn' : 'neutral'}>{skillFileLoading ? '读取中' : '正文'}</Pill>
                      </div>
                    </div>
                    <div className="detail-list compact">
                      <KeyValueRow label="技能文件" value={skillFile?.filePath || selectedSkill.filePath} />
                      <KeyValueRow label="相对路径" value={selectedSkill.relativePath || '—'} />
                    </div>
                    <label className="field-stack top-gap">
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
                    <Toolbar className="top-gap">
                      <Button
                        kind="primary"
                        disabled={runningAction !== null || !skillFile}
                        onClick={() => void saveSkillFile()}
                      >
                        {runningAction === 'skills:save-file' ? '保存中…' : '保存技能文件'}
                      </Button>
                      <Button disabled={runningAction !== null || !selectedSkill} onClick={() => setSelectedPath(selectedSkill.filePath)}>
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
                  </section>
                ) : null}

                {studioView === 'localops' && selectedSkill ? (
                  <section className="workspace-main-card top-gap">
                    <div className="workspace-main-header">
                      <div>
                        <h2 className="config-section-title">本地目录控制</h2>
                        <p className="config-section-desc">把定位、确认和删除都收进这一层，避免和主治理动作挤在一起。</p>
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
                    <div className="detail-list compact">
                      <KeyValueRow label="技能目录" value={directoryOf(skillFile?.filePath || selectedSkill.filePath) || '—'} />
                      <KeyValueRow label="相对路径" value={selectedSkill.relativePath || '—'} />
                      <KeyValueRow label="技能文件" value={skillFile?.filePath || selectedSkill.filePath || '—'} />
                      <KeyValueRow label="运行态" value={selectedExistsInRuntime ? '已进入运行面' : '仅目录可见'} />
                    </div>
                    <div className="danger-copy-compact top-gap">
                      <strong>本地危险操作</strong>
                      <p>
                        {skillUsageJobs.length > 0
                          ? `当前技能仍被 ${skillUsageJobs.length} 个 cron 作业引用。先解除编排绑定，再删除本地目录。`
                          : selectedExistsInRuntime
                            ? '当前技能已经进入运行面。删除目录后，下次刷新运行态会失去该技能来源。'
                            : '删除只影响当前 profile 的本地 skills 目录，不会触碰其他 profile。'}
                      </p>
                    </div>
                    <label className="field-stack top-gap">
                      <span>删除确认</span>
                      <input
                        className="search-input"
                        value={skillDeleteConfirm}
                        placeholder={`输入 ${selectedSkill.name} 以确认删除`}
                        disabled={runningAction !== null}
                        onChange={(event) => setSkillDeleteConfirm(event.target.value)}
                      />
                    </label>
                    <Toolbar className="top-gap">
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
                      <Button disabled={!selectedSkill} onClick={() => navigate('cron')}>
                        查看编排
                      </Button>
                      <Button
                        kind="danger"
                        disabled={runningAction !== null || skillUsageJobs.length > 0 || skillDeleteConfirm.trim() !== selectedSkill.name}
                        onClick={() => void deleteLocalSkill(selectedSkill, skillUsageJobs)}
                      >
                        {runningAction === 'skills:delete-local' ? '删除中…' : '删除本地目录'}
                      </Button>
                    </Toolbar>
                  </section>
                ) : null}

                {studioView === 'sources' ? (
                  <div className="page-stack top-gap">
                    <section className="workspace-main-card">
                      <div className="workspace-main-header">
                        <div>
                          <h2 className="config-section-title">导入现成技能</h2>
                          <p className="config-section-desc">需要接入现有技能目录或单个 <code>SKILL.md</code> 时，再进入这一层。</p>
                        </div>
                        <div className="pill-row">
                          <Pill tone={lastImportedSkill ? 'good' : 'neutral'}>
                            {lastImportedSkill ? `${lastImportedSkill.copiedFiles} 个文件` : '等待导入'}
                          </Pill>
                          <Pill>{importDraft.category || '自动归类'}</Pill>
                        </div>
                      </div>
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
                        <Button disabled={runningAction !== null} onClick={() => setImportDraft(cloneSkillImportDraft())}>
                          清空路径
                        </Button>
                        <Button
                          disabled={runningAction !== null || !selectedSkill}
                          onClick={() => selectedSkill && setImportDraft((current) => ({ ...current, category: selectedSkill.category || current.category }))}
                        >
                          带入当前分类
                        </Button>
                        <Button disabled={runningAction !== null} onClick={() => snapshot && void openInFinder(snapshot.hermesHome, 'Hermes Home')}>
                          打开 Home
                        </Button>
                      </Toolbar>
                    </section>

                    <section className="workspace-main-card">
                      <div className="workspace-main-header">
                        <div>
                          <h2 className="config-section-title">新建本地技能</h2>
                          <p className="config-section-desc">只有在需要定制私有能力时，再展开创建脚手架。</p>
                        </div>
                        <div className="pill-row">
                          <Pill>{createDraft.category || 'custom'}</Pill>
                          <Pill tone={createDraft.name.trim() ? 'good' : 'neutral'}>{createDraft.name.trim() ? '草稿已填写' : '空白草稿'}</Pill>
                        </div>
                      </div>
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
                      <label className="field-stack top-gap">
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
                        <Button disabled={runningAction !== null} onClick={() => setCreateDraft(cloneSkillDraft())}>
                          清空草稿
                        </Button>
                      </Toolbar>
                    </section>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}
