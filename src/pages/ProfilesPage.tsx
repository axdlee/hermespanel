import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, KeyValueRow, Panel, Pill, Toolbar } from '../components/ui';
import { api } from '../lib/api';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  buildLogsDrilldownIntent,
  type DrilldownSeed,
} from '../lib/drilldown';
import { openFinderLocation } from '../lib/desktop';
import { isRemoteDelivery } from '../lib/runtime';
import type {
  CommandRunResult,
  ConfigDocuments,
  CronJobsSnapshot,
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  ProfileAliasCreateRequest,
  ProfileAliasDeleteRequest,
  ProfileCreateRequest,
  ProfileDeleteRequest,
  ProfileExportRequest,
  ProfileImportRequest,
  ProfileRenameRequest,
  ProfileSummary,
} from '../types';
import type { AppPageKey, PageIntent, PageProps } from './types';

type CreateMode = 'fresh' | 'clone' | 'clone-all';
type ProfilesTabKey = 'overview' | 'compare' | 'manage';
type ProfilesOverviewViewKey = 'launch' | 'status' | 'focus';
type ProfileCompareViewKey = 'summary' | 'drifts';
type ProfileManageViewKey = 'create' | 'transfer' | 'alias' | 'danger';

interface ProfileRuntimeBundle {
  dashboard: DashboardSnapshot;
  config: ConfigDocuments;
  extensions: ExtensionsSnapshot;
  cron: CronJobsSnapshot;
  installation: InstallationSnapshot;
}

const PROFILE_TABS: Array<{ key: ProfilesTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看当前实例摘要和常用工作台，再决定是否下钻。' },
  { key: 'compare', label: '差异对照', hint: '把两个 profile 的运行差异直接拉平来看。' },
  { key: 'manage', label: '高级治理', hint: '低频创建、迁移、Alias 与删除操作统一收在这里。' },
];

const DEFAULT_PROFILE_RAIL_LIMIT = 6;

const PROFILES_OVERVIEW_VIEWS: Array<{
  key: ProfilesOverviewViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'launch', label: '常用入口', icon: '🧭', hint: '只保留最常用的去向，先决定下一步要进哪个工作台。' },
  { key: 'status', label: '当前判断', icon: '🩺', hint: '把模型、Gateway、能力面和自动化压成一个状态工作面。' },
  { key: 'focus', label: '实例详情', icon: '📍', hint: '需要确认当前实例材料和目录时，再展开这层。' },
];

const PROFILE_COMPARE_VIEWS: Array<{
  key: ProfileCompareViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'summary', label: '基础对照', icon: '🪞', hint: '只看两边的核心指标，快速判断是不是同一套运行面。' },
  { key: 'drifts', label: '差异提醒', icon: '📎', hint: '只有要追踪漂移原因时，再看完整差异列表。' },
];

const PROFILE_MANAGE_VIEWS: Array<{
  key: ProfileManageViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'create', label: '创建 / 导入', icon: '🌱', hint: '新建实例、克隆配置和从归档导入都收在这一层。' },
  { key: 'transfer', label: '重命名 / 导出', icon: '📦', hint: '需要做备份、迁移或整理命名时，再进入这里处理。' },
  { key: 'alias', label: 'Alias 管理', icon: '🔗', hint: 'wrapper alias 默认不展开，需要时再查看或删除。' },
  { key: 'danger', label: '危险区 / 回执', icon: '🧯', hint: '删除确认和动作输出继续后置，避免平时干扰。' },
];

function chooseCompareName(
  selectedName: string | null,
  items: ProfileSummary[],
  activeProfile?: string | null,
) {
  if (!selectedName) {
    return null;
  }
  const candidates = items.filter((item) => item.name !== selectedName);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.find((item) => item.name === activeProfile)?.name ?? candidates[0].name;
}

function enabledToolCount(bundle?: ProfileRuntimeBundle | null) {
  if (!bundle) return 0;
  return bundle.extensions.toolPlatforms.reduce((sum, item) => sum + item.enabledCount, 0);
}

function totalToolCount(bundle?: ProfileRuntimeBundle | null) {
  if (!bundle) return 0;
  return bundle.extensions.toolPlatforms.reduce((sum, item) => sum + item.totalCount, 0);
}

function remoteJobCount(bundle?: ProfileRuntimeBundle | null) {
  if (!bundle) return 0;
  return bundle.cron.jobs.filter((job) => isRemoteDelivery(job.deliver)).length;
}

function localRuntimeSkillCount(bundle?: ProfileRuntimeBundle | null) {
  return bundle?.extensions.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
}

function toolsetLabel(bundle?: ProfileRuntimeBundle | null) {
  return bundle?.config.summary.toolsets.join(', ') || '—';
}

function profileDrifts(
  selectedProfile: ProfileSummary,
  selectedBundle: ProfileRuntimeBundle,
  compareProfile: ProfileSummary,
  compareBundle: ProfileRuntimeBundle,
) {
  const drifts: string[] = [];

  if (selectedBundle.config.summary.modelDefault !== compareBundle.config.summary.modelDefault) {
    drifts.push(`模型默认值不同：${selectedProfile.name} 使用 ${selectedBundle.config.summary.modelDefault || '未配置'}，${compareProfile.name} 使用 ${compareBundle.config.summary.modelDefault || '未配置'}。`);
  }
  if (selectedBundle.config.summary.contextEngine !== compareBundle.config.summary.contextEngine) {
    drifts.push(`context.engine 不同：${selectedProfile.name} 为 ${selectedBundle.config.summary.contextEngine || '未配置'}，${compareProfile.name} 为 ${compareBundle.config.summary.contextEngine || '未配置'}。`);
  }
  if (selectedBundle.config.summary.terminalBackend !== compareBundle.config.summary.terminalBackend) {
    drifts.push(`terminal.backend 不同：${selectedProfile.name} 为 ${selectedBundle.config.summary.terminalBackend || '未配置'}，${compareProfile.name} 为 ${compareBundle.config.summary.terminalBackend || '未配置'}。`);
  }
  if (selectedBundle.config.summary.memoryProvider !== compareBundle.config.summary.memoryProvider) {
    drifts.push(`memory.provider 不同：${selectedProfile.name} 为 ${selectedBundle.config.summary.memoryProvider || 'builtin-file'}，${compareProfile.name} 为 ${compareBundle.config.summary.memoryProvider || 'builtin-file'}。`);
  }
  if (toolsetLabel(selectedBundle) !== toolsetLabel(compareBundle)) {
    drifts.push(`toolsets 不同：${selectedProfile.name} 为 [${toolsetLabel(selectedBundle)}]，${compareProfile.name} 为 [${toolsetLabel(compareBundle)}]。`);
  }
  if (enabledToolCount(selectedBundle) !== enabledToolCount(compareBundle)) {
    drifts.push(`可用工具面存在差异：${selectedProfile.name} 启用 ${enabledToolCount(selectedBundle)} 个，${compareProfile.name} 启用 ${enabledToolCount(compareBundle)} 个。`);
  }
  if (selectedBundle.extensions.plugins.installedCount !== compareBundle.extensions.plugins.installedCount) {
    drifts.push(`插件安装态不同：${selectedProfile.name} 为 ${selectedBundle.extensions.plugins.installedCount} 个，${compareProfile.name} 为 ${compareBundle.extensions.plugins.installedCount} 个。`);
  }
  if (selectedBundle.cron.jobs.length !== compareBundle.cron.jobs.length) {
    drifts.push(`自动化规模不同：${selectedProfile.name} 有 ${selectedBundle.cron.jobs.length} 个 cron 作业，${compareProfile.name} 有 ${compareBundle.cron.jobs.length} 个。`);
  }
  if (remoteJobCount(selectedBundle) !== remoteJobCount(compareBundle)) {
    drifts.push(`远端交付依赖不同：${selectedProfile.name} 有 ${remoteJobCount(selectedBundle)} 个远端作业，${compareProfile.name} 有 ${remoteJobCount(compareBundle)} 个。`);
  }
  if (selectedProfile.aliases.length !== compareProfile.aliases.length) {
    drifts.push(`Alias 策略不同：${selectedProfile.name} 有 ${selectedProfile.aliases.length} 个 alias，${compareProfile.name} 有 ${compareProfile.aliases.length} 个。`);
  }
  if (selectedProfile.envExists !== compareProfile.envExists) {
    drifts.push(`.env 完整性不同：${selectedProfile.name} 为 ${selectedProfile.envExists ? 'exists' : 'missing'}，${compareProfile.name} 为 ${compareProfile.envExists ? 'exists' : 'missing'}。`);
  }

  return drifts;
}

function runtimeHealthWarnings(profile: ProfileSummary, bundle: ProfileRuntimeBundle) {
  const warnings: string[] = [];
  if (!profile.envExists) {
    warnings.push('当前 profile 缺少 `.env`，很多 provider 或 gateway 平台认证不会真正生效。');
  }
  if (!profile.soulExists) {
    warnings.push('当前 profile 缺少 `SOUL.md`，agent 身份基线不完整。');
  }
  if (bundle.dashboard.gateway?.gatewayState !== 'running' && remoteJobCount(bundle) > 0) {
    warnings.push('存在依赖 gateway 的远端 cron 作业，但当前 gateway 不在 running 状态。');
  }
  if (bundle.config.summary.memoryEnabled === false && bundle.cron.jobs.length > 0) {
    warnings.push('memory 当前关闭，但 profile 已有自动化作业，长期记忆闭环会变弱。');
  }
  if (localRuntimeSkillCount(bundle) !== profile.skillCount) {
    warnings.push(`CLI 运行态 local skill 为 ${localRuntimeSkillCount(bundle)} 个，本地扫描为 ${profile.skillCount} 个，存在“安装态 / 文件态”偏差。`);
  }
  if (bundle.config.summary.memoryProvider && bundle.extensions.memoryRuntime.provider.includes('none')) {
    warnings.push(`配置声明了 memory provider「${bundle.config.summary.memoryProvider}」，但运行态仍显示 built-in only。`);
  }
  return warnings;
}

function profileRelaySeed(profileName: string, bundle?: ProfileRuntimeBundle | null): DrilldownSeed {
  const toolNames = Array.from(
    new Set((bundle?.extensions.toolPlatforms ?? []).flatMap((item) => item.enabledTools)),
  );

  return {
    sourcePage: 'profiles',
    headline: `从 Profile 管理继续治理 ${profileName}`,
    description: `继续围绕 ${profileName} 的配置、Gateway、扩展和运行物料做闭环。`,
    context: bundle
      ? {
          sessionId: `profile:${profileName}`,
          title: `${profileName} profile`,
          source: bundle.dashboard.gateway?.platforms[0]?.name || 'profiles',
          model: bundle.config.summary.modelDefault || null,
          preview: `${bundle.config.summary.modelProvider || 'provider 未配置'} / ${bundle.config.summary.contextEngine || 'context 未配置'}`,
          toolNames,
        }
      : undefined,
  };
}

export function ProfilesPage({ notify, profile, profiles, refreshProfiles, navigate }: PageProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [compareName, setCompareName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfilesTabKey>('overview');
  const [overviewView, setOverviewView] = useState<ProfilesOverviewViewKey>('launch');
  const [compareView, setCompareView] = useState<ProfileCompareViewKey>('summary');
  const [manageView, setManageView] = useState<ProfileManageViewKey>('create');
  const [showAllProfiles, setShowAllProfiles] = useState(false);

  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<CreateMode>('fresh');
  const [cloneFrom, setCloneFrom] = useState('default');
  const [noAlias, setNoAlias] = useState(false);

  const [renameTo, setRenameTo] = useState('');
  const [exportOutput, setExportOutput] = useState('');
  const [importArchive, setImportArchive] = useState('');
  const [importName, setImportName] = useState('');
  const [aliasName, setAliasName] = useState('');
  const [removeAliasName, setRemoveAliasName] = useState('');
  const [removeAliasConfirm, setRemoveAliasConfirm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastCommandLabel, setLastCommandLabel] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [runtimeBundles, setRuntimeBundles] = useState<Record<string, ProfileRuntimeBundle>>({});
  const [loadingRuntimeNames, setLoadingRuntimeNames] = useState<string[]>([]);

  const profileItems = profiles?.profiles ?? [];

  useEffect(() => {
    if (!profileItems.length) {
      setSelectedName(null);
      return;
    }
    if (!selectedName || !profileItems.some((item) => item.name === selectedName)) {
      const preferred = profileItems.some((item) => item.name === profile)
        ? profile
        : profileItems.some((item) => item.name === profiles?.activeProfile)
          ? profiles?.activeProfile
          : profileItems[0]?.name;
      setSelectedName(preferred ?? null);
    }
  }, [profileItems, profile, profiles?.activeProfile, selectedName]);

  const selectedProfile = useMemo<ProfileSummary | null>(() => (
    profileItems.find((item) => item.name === selectedName)
    ?? profileItems[0]
    ?? null
  ), [profileItems, selectedName]);

  const compareProfile = useMemo<ProfileSummary | null>(() => (
    profileItems.find((item) => item.name === compareName) ?? null
  ), [compareName, profileItems]);

  useEffect(() => {
    setCompareName((current) => {
      if (!selectedProfile) {
        return null;
      }
      if (current && current !== selectedProfile.name && profileItems.some((item) => item.name === current)) {
        return current;
      }
      return chooseCompareName(selectedProfile.name, profileItems, profiles?.activeProfile);
    });
  }, [selectedProfile?.name, profileItems, profiles?.activeProfile]);

  useEffect(() => {
    setRenameTo(selectedProfile && !selectedProfile.isDefault ? selectedProfile.name : '');
    setDeleteConfirm('');
    setExportOutput(selectedProfile ? `${selectedProfile.name}.tar.gz` : '');
    setAliasName(selectedProfile?.name ?? '');
  }, [selectedProfile?.isDefault, selectedProfile?.name]);

  useEffect(() => {
    setRemoveAliasName((current) => {
      if (!selectedProfile) {
        return '';
      }
      if (selectedProfile.aliases.some((alias) => alias.name === current)) {
        return current;
      }
      return selectedProfile.aliases[0]?.name ?? '';
    });
  }, [selectedProfile]);

  useEffect(() => {
    setRemoveAliasConfirm('');
  }, [removeAliasName]);

  async function loadRuntimeBundle(profileName: string, force = false) {
    if (!profileName) {
      return;
    }
    if (!force && runtimeBundles[profileName]) {
      return;
    }

    setLoadingRuntimeNames((current) => (current.includes(profileName) ? current : [...current, profileName]));
    try {
      const [dashboard, config, extensions, cron, installation] = await Promise.all([
        api.getDashboardSnapshot(profileName),
        api.getConfigDocuments(profileName),
        api.getExtensionsSnapshot(profileName),
        api.getCronJobs(profileName),
        api.getInstallationSnapshot(profileName),
      ]);
      setRuntimeBundles((current) => ({
        ...current,
        [profileName]: { dashboard, config, extensions, cron, installation },
      }));
    } catch (reason) {
      notify('error', `${profileName} 运行态读取失败：${String(reason)}`);
    } finally {
      setLoadingRuntimeNames((current) => current.filter((item) => item !== profileName));
    }
  }

  useEffect(() => {
    if (selectedProfile?.name) {
      void loadRuntimeBundle(selectedProfile.name);
    }
  }, [selectedProfile?.name]);

  useEffect(() => {
    if (compareProfile?.name) {
      void loadRuntimeBundle(compareProfile.name);
    }
  }, [compareProfile?.name]);

  useEffect(() => {
    setActiveTab('overview');
    setOverviewView('launch');
    setCompareView('summary');
  }, [profile]);

  const selectedRuntime = selectedProfile ? runtimeBundles[selectedProfile.name] : undefined;
  const compareRuntime = compareProfile ? runtimeBundles[compareProfile.name] : undefined;
  const selectedRuntimeLoading = selectedProfile ? loadingRuntimeNames.includes(selectedProfile.name) : false;
  const compareRuntimeLoading = compareProfile ? loadingRuntimeNames.includes(compareProfile.name) : false;
  const selectedWarnings = selectedProfile && selectedRuntime ? runtimeHealthWarnings(selectedProfile, selectedRuntime) : [];
  const compareWarnings = selectedProfile && selectedRuntime && compareProfile && compareRuntime
    ? profileDrifts(selectedProfile, selectedRuntime, compareProfile, compareRuntime)
    : [];
  const overviewWarnings = selectedWarnings.slice(0, 3);
  const remainingOverviewWarningCount = Math.max(0, selectedWarnings.length - overviewWarnings.length);
  const selectedInstallation = selectedRuntime?.installation;
  const profileStartReadiness = !selectedProfile
    ? '先选择实例'
    : !selectedProfile.isActive
      ? '先确认默认实例'
      : !(selectedRuntime?.config.summary.modelDefault && selectedRuntime?.config.summary.modelProvider)
        ? '先补基础配置'
        : selectedRuntime?.dashboard.gateway?.gatewayState !== 'running' && remoteJobCount(selectedRuntime) > 0
          ? '先恢复网关'
          : selectedWarnings.length > 0
            ? '继续处理提醒'
            : '可以直接使用';
  const profileStartHint = !selectedProfile
    ? '先从左侧列表选中一个 Hermes 实例，再决定要进哪个工作台。'
    : !selectedProfile.isActive
      ? '多实例场景下最容易出错的是改到了错误实例，建议先确认是否要把当前实例设为默认。'
      : !(selectedRuntime?.config.summary.modelDefault && selectedRuntime?.config.summary.modelProvider)
        ? '当前实例还没补齐默认模型或 Provider，建议先去配置中心处理基础链路。'
        : selectedRuntime?.dashboard.gateway?.gatewayState !== 'running' && remoteJobCount(selectedRuntime) > 0
          ? '当前实例存在依赖 Gateway 的远端作业，但 Gateway 还没恢复。'
          : selectedWarnings.length > 0
            ? '当前实例还有一些运行态提醒，适合先看首页判断再进入具体工作台。'
            : '当前实例的基础配置、能力面和运行链路看起来都比较完整，可以直接继续工作。';
  const selectedRelaySeed = selectedProfile ? profileRelaySeed(selectedProfile.name, selectedRuntime ?? null) : null;
  const configModelIntent = selectedProfile && selectedRelaySeed
    ? buildConfigDrilldownIntent(selectedRelaySeed, {
        description: `继续在 ${selectedProfile.name} 的配置中心直接调整模型、provider 和默认链路。`,
        focus: 'model',
        suggestedCommand: 'config-check',
      })
    : null;
  const gatewayWorkbenchIntent = selectedProfile && selectedRelaySeed
    ? buildGatewayDrilldownIntent(selectedRelaySeed, {
        description: `继续在 ${selectedProfile.name} 的 Gateway 工作台处理 service、平台接入和投递链路。`,
      })
    : null;
  const extensionsWorkbenchIntent = selectedProfile && selectedRelaySeed
    ? buildExtensionsDrilldownIntent(selectedRelaySeed, {
        description: `继续在 ${selectedProfile.name} 的扩展工作台治理 plugins、tools 和运行能力面。`,
        rawKind: 'plugins',
      })
    : null;
  const diagnosticsWorkbenchIntent = selectedProfile && selectedRelaySeed
    ? buildDiagnosticsDrilldownIntent(selectedRelaySeed, {
        description: `继续围绕 ${selectedProfile.name} 的安装、配置、能力面和 Gateway 做诊断。`,
        suggestedCommand: selectedInstallation?.binaryFound ? 'doctor' : 'dump',
      })
    : null;
  const logsWorkbenchIntent = selectedProfile && selectedRelaySeed
    ? buildLogsDrilldownIntent(selectedRelaySeed, {
        description: `继续查看 ${selectedProfile.name} 的运行日志、治理回执和异常输出。`,
        logName: remoteJobCount(selectedRuntime) > 0 ? 'gateway.error' : undefined,
      })
    : null;
  const visibleProfileItems = useMemo(() => {
    if (showAllProfiles || profileItems.length <= DEFAULT_PROFILE_RAIL_LIMIT) {
      return profileItems;
    }

    const compactItems = profileItems.slice(0, DEFAULT_PROFILE_RAIL_LIMIT);
    if (!selectedProfile || compactItems.some((item) => item.name === selectedProfile.name)) {
      return compactItems;
    }

    return [...compactItems, selectedProfile];
  }, [profileItems, selectedProfile, showAllProfiles]);
  const hiddenProfileCount = Math.max(0, profileItems.length - visibleProfileItems.length);
  const activeOverviewView = PROFILES_OVERVIEW_VIEWS.find((item) => item.key === overviewView) ?? PROFILES_OVERVIEW_VIEWS[0];
  const activeCompareView = PROFILE_COMPARE_VIEWS.find((item) => item.key === compareView) ?? PROFILE_COMPARE_VIEWS[0];
  const activeManageView = PROFILE_MANAGE_VIEWS.find((item) => item.key === manageView) ?? PROFILE_MANAGE_VIEWS[0];

  async function refreshProfileWorkspace(forceName?: string) {
    const target = forceName ?? selectedProfile?.name;
    await refreshProfiles(target);
    if (target) {
      await loadRuntimeBundle(target, true);
    }
    if (compareProfile?.name) {
      await loadRuntimeBundle(compareProfile.name, true);
    }
  }

  async function createProfile() {
    const normalizedName = createName.trim();
    if (!normalizedName) {
      notify('error', 'profile 名称不能为空。');
      return;
    }

    setRunningAction('create-profile');
    try {
      const request: ProfileCreateRequest = {
        profileName: normalizedName,
        clone: createMode === 'clone',
        cloneAll: createMode === 'clone-all',
        cloneFrom: createMode === 'fresh' ? null : cloneFrom,
        noAlias,
      };
      const result = await api.createProfile(request);
      setLastCommandLabel(`创建 Profile ${normalizedName}`);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `profile ${normalizedName} 创建命令已执行。`);
      await refreshProfiles(normalizedName);
      setSelectedName(normalizedName);
      setCreateName('');
      setCreateMode('fresh');
      setCloneFrom('default');
      setNoAlias(false);
      await loadRuntimeBundle(normalizedName, true);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function activateProfile(name: string) {
    setRunningAction(`activate:${name}`);
    try {
      await api.setActiveProfile(name);
      setLastCommandLabel(`切换默认 Profile ${name}`);
      await refreshProfiles(name);
      await loadRuntimeBundle(name, true);
      notify('success', `已将 ${name} 设为 Hermes 默认 profile。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function renameProfile() {
    if (!selectedProfile || selectedProfile.isDefault) {
      notify('error', 'default profile 不支持重命名。');
      return;
    }

    const normalizedName = renameTo.trim();
    if (!normalizedName || normalizedName === selectedProfile.name) {
      notify('error', '请输入新的 profile 名称。');
      return;
    }

    setRunningAction('rename-profile');
    try {
      const request: ProfileRenameRequest = {
        oldName: selectedProfile.name,
        newName: normalizedName,
      };
      const result = await api.renameProfile(request);
      setLastCommandLabel(`重命名 Profile ${selectedProfile.name}`);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `profile ${selectedProfile.name} 重命名命令已执行。`);
      setRuntimeBundles((current) => {
        const next = { ...current };
        const runtime = next[selectedProfile.name];
        delete next[selectedProfile.name];
        if (runtime) {
          next[normalizedName] = runtime;
        }
        return next;
      });
      await refreshProfiles(normalizedName);
      setSelectedName(normalizedName);
      await loadRuntimeBundle(normalizedName, true);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function exportProfile() {
    if (!selectedProfile) return;

    setRunningAction('export-profile');
    try {
      const request: ProfileExportRequest = {
        profileName: selectedProfile.name,
        output: exportOutput.trim() || null,
      };
      const result = await api.exportProfile(request);
      setLastCommandLabel(`导出 Profile ${selectedProfile.name}`);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `profile ${selectedProfile.name} 导出命令已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function importProfile() {
    const archive = importArchive.trim();
    if (!archive) {
      notify('error', 'archive 路径不能为空。');
      return;
    }

    setRunningAction('import-profile');
    try {
      const request: ProfileImportRequest = {
        archive,
        importName: importName.trim() || null,
      };
      const result = await api.importProfile(request);
      setLastCommandLabel(`导入 Profile ${importName.trim() || archive}`);
      setLastCommand(result);
      const preferredProfile = importName.trim() || undefined;
      await refreshProfiles(preferredProfile);
      if (preferredProfile) {
        setSelectedName(preferredProfile);
        await loadRuntimeBundle(preferredProfile, true);
      }
      setImportArchive('');
      setImportName('');
      notify(result.success ? 'success' : 'error', 'profile 导入命令已执行。');
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function deleteProfile() {
    if (!selectedProfile || selectedProfile.isDefault) {
      notify('error', 'default profile 不支持删除。');
      return;
    }
    if (deleteConfirm.trim() !== selectedProfile.name) {
      notify('error', '请先输入完整的 profile 名称完成确认。');
      return;
    }

    setRunningAction('delete-profile');
    try {
      const request: ProfileDeleteRequest = {
        profileName: selectedProfile.name,
        confirmName: deleteConfirm.trim(),
      };
      const result = await api.deleteProfile(request);
      setLastCommandLabel(`删除 Profile ${request.profileName}`);
      setLastCommand(result);
      setRuntimeBundles((current) => {
        const next = { ...current };
        delete next[selectedProfile.name];
        return next;
      });
      await refreshProfiles(profiles?.activeProfile ?? 'default');
      setDeleteConfirm('');
      notify(result.success ? 'success' : 'error', `profile ${request.profileName} 删除命令已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function createAlias() {
    if (!selectedProfile) {
      return;
    }

    const normalizedAliasName = aliasName.trim() || selectedProfile.name;

    setRunningAction('create-alias');
    try {
      const request: ProfileAliasCreateRequest = {
        profileName: selectedProfile.name,
        aliasName: normalizedAliasName,
      };
      const result = await api.createProfileAlias(request);
      setLastCommandLabel(`创建 Alias ${normalizedAliasName}`);
      setLastCommand(result);
      await refreshProfiles(selectedProfile.name);
      notify(result.success ? 'success' : 'error', `profile ${selectedProfile.name} alias 创建命令已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function deleteAlias() {
    if (!selectedProfile) {
      return;
    }

    const normalizedAliasName = removeAliasName.trim();
    if (!normalizedAliasName) {
      notify('error', '请选择要删除的 alias。');
      return;
    }
    if (removeAliasConfirm.trim() !== normalizedAliasName) {
      notify('error', '请先输入完整的 alias 名称完成确认。');
      return;
    }

    setRunningAction('delete-alias');
    try {
      const request: ProfileAliasDeleteRequest = {
        profileName: selectedProfile.name,
        aliasName: normalizedAliasName,
        confirmName: removeAliasConfirm.trim(),
      };
      const result = await api.deleteProfileAlias(request);
      setLastCommandLabel(`删除 Alias ${normalizedAliasName}`);
      setLastCommand(result);
      if (result.success) {
        setRemoveAliasConfirm('');
      }
      await refreshProfiles(selectedProfile.name);
      notify(
        result.success ? 'success' : 'error',
        result.success
          ? `alias ${normalizedAliasName} 已删除。`
          : `alias ${normalizedAliasName} 删除失败，请检查命令输出。`,
      );
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `open:${label}`,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastCommandLabel(resultLabel);
        setLastCommand(result);
      },
      path,
      revealInFinder,
      setBusy: setRunningAction,
    });
  }

  async function enterProfileWorkbench(page: AppPageKey, options?: { actionKey?: string; intent?: PageIntent | null }) {
    if (!selectedProfile) {
      return;
    }

    const actionKey = options?.actionKey ?? `goto:${selectedProfile.name}:${page}`;
    setRunningAction(actionKey);
    try {
      await refreshProfiles(selectedProfile.name);
      navigate(page, options?.intent ?? null);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  const focusShell = (
    <Panel
      title="当前实例锚点"
      subtitle={selectedProfile ? '这里只保留身份确认和最高频操作，详细信息已经后置到下方工作面。' : '先从左侧选择一个 Hermes profile。'}
      aside={
        selectedProfile ? (
          <Toolbar>
            <Button
              disabled={runningAction !== null || selectedRuntimeLoading}
              onClick={() => void refreshProfileWorkspace(selectedProfile.name)}
            >
              {selectedRuntimeLoading ? '刷新中…' : '刷新实例'}
            </Button>
            <Button
              disabled={runningAction !== null}
              onClick={() => void openInFinder(selectedProfile.homePath, `${selectedProfile.name} 目录`)}
            >
              打开目录
            </Button>
            <Button
              kind="primary"
              disabled={selectedProfile.isActive || runningAction !== null}
              onClick={() => void activateProfile(selectedProfile.name)}
            >
              {runningAction === `activate:${selectedProfile.name}` ? '同步中…' : selectedProfile.isActive ? '已是默认' : '设为默认'}
            </Button>
          </Toolbar>
        ) : undefined
      }
    >
      {selectedProfile ? (
        <>
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">当前实例</span>
              <strong className="summary-mini-value">{selectedProfile.name}</strong>
              <span className="summary-mini-meta">
                {selectedProfile.isDefault ? 'default 保留实例' : '普通实例'} · {selectedProfile.isActive ? '当前活跃' : '尚未设为默认'}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">现在能不能直接用</span>
              <strong className="summary-mini-value">{profileStartReadiness}</strong>
              <span className="summary-mini-meta">{profileStartHint}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">模型与通道</span>
              <strong className="summary-mini-value">{selectedRuntime?.config.summary.modelDefault || selectedProfile.modelDefault || '未配置模型'}</strong>
              <span className="summary-mini-meta">
                {selectedRuntime?.config.summary.modelProvider || 'provider 未配置'} · {selectedRuntime?.dashboard.gateway?.gatewayState || selectedProfile.gatewayState || 'Gateway 未检测到'}
              </span>
            </section>
          </div>
        </>
      ) : (
        <EmptyState title="未选择 profile" description="从左侧选择一个 Hermes profile 查看详情。" />
      )}
    </Panel>
  );

  const overviewSection = (
    <div className="page-stack">
      <Panel
        title="总览入口"
        subtitle="总览页也改成二级工作面，默认一次只展开一个主区块。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {PROFILES_OVERVIEW_VIEWS.map((item) => (
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
      <Panel
        title="常用去向"
        subtitle="默认只显式放最常用的 4 个入口，其他治理动作继续收进标签页或子工作台。"
        aside={
          selectedProfile ? (
            <Toolbar>
              <Button
                onClick={() => void refreshProfileWorkspace(selectedProfile.name)}
                disabled={runningAction !== null || selectedRuntimeLoading}
              >
                {selectedRuntimeLoading ? '刷新中…' : '刷新实例'}
              </Button>
            </Toolbar>
          ) : undefined
        }
      >
        {selectedProfile ? (
          <>
            <div className="workspace-shortcut-grid dashboard-launcher-grid">
              <button
                type="button"
                className="workspace-shortcut-card dashboard-shortcut-card"
                onClick={() => void enterProfileWorkbench('config', {
                  actionKey: 'profile:goto-config-model',
                  intent: configModelIntent,
                })}
                disabled={runningAction !== null || !configModelIntent}
              >
                <strong><span className="dashboard-shortcut-icon">🤖</span>配置与模型</strong>
                <span>
                  {selectedRuntime?.config.summary.modelDefault
                    ? `${selectedRuntime.config.summary.modelProvider || 'provider 未配置'} / ${selectedRuntime.config.summary.modelDefault}`
                    : '先补模型、provider 和基础链路'}
                </span>
              </button>
              <button
                type="button"
                className="workspace-shortcut-card dashboard-shortcut-card"
                onClick={() => void enterProfileWorkbench('gateway', {
                  actionKey: 'profile:goto-gateway',
                  intent: gatewayWorkbenchIntent,
                })}
                disabled={runningAction !== null || !gatewayWorkbenchIntent}
              >
                <strong><span className="dashboard-shortcut-icon">🌉</span>Gateway 与通道</strong>
                <span>
                  {selectedRuntime?.dashboard.gateway?.gatewayState ?? '未检测到'} · {remoteJobCount(selectedRuntime)} 个远端作业
                </span>
              </button>
              <button
                type="button"
                className="workspace-shortcut-card dashboard-shortcut-card"
                onClick={() => void enterProfileWorkbench('extensions', {
                  actionKey: 'profile:goto-extensions',
                  intent: extensionsWorkbenchIntent,
                })}
                disabled={runningAction !== null || !extensionsWorkbenchIntent}
              >
                <strong><span className="dashboard-shortcut-icon">🧩</span>扩展与能力</strong>
                <span>
                  {enabledToolCount(selectedRuntime)}/{totalToolCount(selectedRuntime)} tools · {selectedRuntime?.extensions.plugins.installedCount ?? 0} 个插件
                </span>
              </button>
              <button
                type="button"
                className="workspace-shortcut-card dashboard-shortcut-card"
                onClick={() => setActiveTab('compare')}
                disabled={profileItems.length < 2}
              >
                <strong><span className="dashboard-shortcut-icon">🪞</span>差异对照</strong>
                <span>{compareProfile ? `与 ${compareProfile.name} 快速比对差异` : '至少需要两个实例后才能对照'}</span>
              </button>
            </div>
            <p className="helper-text top-gap">
              凭证细节、记忆资料、日志追踪、Alias 和危险操作已经继续后置，不再堆在当前总览页。
            </p>
          </>
        ) : (
          <EmptyState title="请选择 profile" description="选中一个 profile 后，这里会显示它的客户端治理入口、运行物料和实例级工作台。" />
        )}
      </Panel>
      ) : null}

      {overviewView === 'status' ? (
      <Panel
        title="当前判断"
        subtitle="把 config / extensions / cron / gateway 合在一起看，新手先看这里就能判断这个实例是否健康。"
        aside={
          selectedProfile ? (
            <Toolbar>
              <Button disabled={runningAction !== null || selectedRuntimeLoading} onClick={() => void loadRuntimeBundle(selectedProfile.name, true)}>
                {selectedRuntimeLoading ? '刷新中…' : '刷新运行态'}
              </Button>
            </Toolbar>
          ) : undefined
        }
      >
        {selectedProfile && selectedRuntime ? (
          <>
            <div className="workspace-summary-strip">
              <section className="summary-mini-card">
                <span className="summary-mini-label">模型链路</span>
                <strong className="summary-mini-value">
                  {selectedRuntime.config.summary.modelProvider || '未配置 provider'} / {selectedRuntime.config.summary.modelDefault || '未配置 model'}
                </strong>
                <span className="summary-mini-meta">
                  {selectedRuntime.config.summary.terminalBackend || 'terminal backend 未配置'}
                </span>
              </section>
              <section className="summary-mini-card">
                <span className="summary-mini-label">Gateway 与远端</span>
                <strong className="summary-mini-value">{selectedRuntime.dashboard.gateway?.gatewayState ?? '未检测到'}</strong>
                <span className="summary-mini-meta">
                  {selectedRuntime.dashboard.gateway?.platforms.length ?? 0} 个平台 · {remoteJobCount(selectedRuntime)} 个远端作业
                </span>
              </section>
              <section className="summary-mini-card">
                <span className="summary-mini-label">能力面</span>
                <strong className="summary-mini-value">
                  {enabledToolCount(selectedRuntime)}/{totalToolCount(selectedRuntime)} tools
                </strong>
                <span className="summary-mini-meta">
                  {selectedRuntime.extensions.runtimeSkills.length} 个运行时技能 · {selectedRuntime.extensions.plugins.installedCount} 个插件
                </span>
              </section>
              <section className="summary-mini-card">
                <span className="summary-mini-label">记忆与自动化</span>
                <strong className="summary-mini-value">{selectedRuntime.extensions.memoryRuntime.provider}</strong>
                <span className="summary-mini-meta">
                  {selectedRuntime.cron.jobs.length} 个 Cron 作业 · local skills {localRuntimeSkillCount(selectedRuntime)}
                </span>
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
                  <p className="helper-text top-gap">其余 {remainingOverviewWarningCount} 条提醒继续收在“差异对照”和“高级治理”里。</p>
                ) : null}
              </>
            ) : (
              <EmptyState title="运行态较完整" description="当前 profile 没有出现明显的结构性缺口，可以继续做对照或生命周期管理。" />
            )}
            <Toolbar>
              <Button
                onClick={() => void enterProfileWorkbench('diagnostics', {
                  actionKey: 'profile:goto-diagnostics',
                  intent: diagnosticsWorkbenchIntent,
                })}
                disabled={runningAction !== null || !diagnosticsWorkbenchIntent}
              >
                {runningAction === 'profile:goto-diagnostics' ? '进入诊断页…' : '系统诊断'}
              </Button>
              <Button
                onClick={() => void enterProfileWorkbench('logs', {
                  actionKey: 'profile:goto-logs',
                  intent: logsWorkbenchIntent,
                })}
                disabled={runningAction !== null || !logsWorkbenchIntent}
              >
                {runningAction === 'profile:goto-logs' ? '进入日志页…' : '日志查看'}
              </Button>
            </Toolbar>
          </>
        ) : (
          <EmptyState
            title={selectedRuntimeLoading ? '正在读取运行态' : '运行态未就绪'}
            description={selectedProfile ? '将自动读取当前 profile 的 dashboard / config / extensions / cron 快照。' : '先从左侧选择一个 profile。'}
          />
        )}
      </Panel>
      ) : null}

      {overviewView === 'focus' ? (
        <Panel
          title="实例详情"
          subtitle="需要确认目录、材料、能力规模和关联工作台时，再展开这一层。"
          aside={
            selectedProfile ? (
              <Toolbar>
                <Button
                  disabled={runningAction !== null || selectedRuntimeLoading}
                  onClick={() => void refreshProfileWorkspace(selectedProfile.name)}
                >
                  {selectedRuntimeLoading ? '刷新中…' : '刷新实例'}
                </Button>
                <Button
                  disabled={runningAction !== null}
                  onClick={() => void openInFinder(selectedProfile.homePath, `${selectedProfile.name} 目录`)}
                >
                  打开目录
                </Button>
              </Toolbar>
            ) : undefined
          }
        >
          {selectedProfile ? (
            <>
              <div className="workspace-summary-strip">
                <section className="summary-mini-card">
                  <span className="summary-mini-label">基础材料</span>
                  <strong className="summary-mini-value">{selectedProfile.envExists && selectedProfile.soulExists ? '基础齐备' : '有缺口'}</strong>
                  <span className="summary-mini-meta">
                    .env {selectedProfile.envExists ? 'ok' : 'missing'} · SOUL {selectedProfile.soulExists ? 'ok' : 'missing'}
                  </span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">Alias</span>
                  <strong className="summary-mini-value">{selectedProfile.aliases.length}</strong>
                  <span className="summary-mini-meta">
                    {selectedProfile.aliases.length > 0 ? selectedProfile.aliases.map((alias) => alias.name).slice(0, 2).join(' / ') : '当前还没有 wrapper alias'}
                  </span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">能力规模</span>
                  <strong className="summary-mini-value">{enabledToolCount(selectedRuntime)}/{totalToolCount(selectedRuntime)} tools</strong>
                  <span className="summary-mini-meta">
                    {selectedRuntime?.extensions.plugins.installedCount ?? 0} 个插件 · {selectedRuntime?.extensions.runtimeSkills.length ?? 0} 个运行时技能
                  </span>
                </section>
                <section className="summary-mini-card">
                  <span className="summary-mini-label">自动化</span>
                  <strong className="summary-mini-value">{selectedRuntime?.cron.jobs.length ?? 0} 条</strong>
                  <span className="summary-mini-meta">
                    远端 {remoteJobCount(selectedRuntime)} · Memory {selectedRuntime?.config.summary.memoryProvider || 'builtin-file'}
                  </span>
                </section>
              </div>

              <div className="detail-list compact top-gap">
                <KeyValueRow label="实例目录" value={selectedProfile.homePath} />
                <KeyValueRow label="Toolsets" value={toolsetLabel(selectedRuntime)} />
                <KeyValueRow label="Context Engine" value={selectedRuntime?.config.summary.contextEngine || '—'} />
                <KeyValueRow label="Terminal Backend" value={selectedRuntime?.config.summary.terminalBackend || '—'} />
              </div>

              <Toolbar>
                <Button
                  kind="primary"
                  disabled={selectedProfile.isActive || runningAction !== null}
                  onClick={() => void activateProfile(selectedProfile.name)}
                >
                  {runningAction === `activate:${selectedProfile.name}` ? '同步中…' : selectedProfile.isActive ? '已是默认' : '设为默认'}
                </Button>
                <Button onClick={() => setActiveTab('manage')}>进入高级治理</Button>
                <Button disabled={profileItems.length < 2} onClick={() => setActiveTab('compare')}>去做差异对照</Button>
              </Toolbar>
            </>
          ) : (
            <EmptyState title="未选择 profile" description="选择一个 profile 后再查看实例详情。" />
          )}
        </Panel>
      ) : null}
    </div>
  );

  const compareSection = (
    <div className="page-stack">
      <Panel
        title="对照入口"
        subtitle="对照页也只保留一个主工作面，需要时再切到差异提醒。"
        aside={
          selectedProfile && compareName ? (
            <Toolbar>
              <select
                className="select-input"
                value={compareName}
                onChange={(event) => setCompareName(event.target.value || null)}
                disabled={runningAction !== null}
              >
                {profileItems
                  .filter((item) => item.name !== selectedProfile.name)
                  .map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <Button
                disabled={!compareProfile || compareRuntimeLoading}
                onClick={() => compareProfile && void loadRuntimeBundle(compareProfile.name, true)}
              >
                {compareRuntimeLoading ? '刷新中…' : '刷新对照'}
              </Button>
            </Toolbar>
          ) : undefined
        }
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {PROFILE_COMPARE_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${compareView === item.key ? 'active' : ''}`}
              onClick={() => setCompareView(item.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">{activeCompareView.hint}</p>
      </Panel>

      {selectedProfile && selectedRuntime && compareProfile && compareRuntime ? (
        <>
          {compareView === 'summary' ? (
            <Panel title="基础对照" subtitle="这里只保留两边最关键的运行指标。">
              <div className="two-column profile-actions-grid">
                <div className="list-card">
                  <div className="list-card-title">
                    <strong>{selectedProfile.name}</strong>
                    <div className="pill-row">
                      {selectedProfile.isActive && <Pill tone="good">active</Pill>}
                      {selectedProfile.isDefault && <Pill>default</Pill>}
                    </div>
                  </div>
                  <div className="detail-list compact">
                    <KeyValueRow label="模型" value={selectedRuntime.config.summary.modelDefault || '—'} />
                    <KeyValueRow label="Context" value={selectedRuntime.config.summary.contextEngine || '—'} />
                    <KeyValueRow label="Backend" value={selectedRuntime.config.summary.terminalBackend || '—'} />
                    <KeyValueRow label="Memory Provider" value={selectedRuntime.config.summary.memoryProvider || 'builtin-file'} />
                    <KeyValueRow label="Toolsets" value={toolsetLabel(selectedRuntime)} />
                    <KeyValueRow label="工具面" value={`${enabledToolCount(selectedRuntime)}/${totalToolCount(selectedRuntime)}`} />
                    <KeyValueRow label="插件数" value={selectedRuntime.extensions.plugins.installedCount} />
                    <KeyValueRow label="Cron / 远端" value={`${selectedRuntime.cron.jobs.length} / ${remoteJobCount(selectedRuntime)}`} />
                  </div>
                </div>
                <div className="list-card">
                  <div className="list-card-title">
                    <strong>{compareProfile.name}</strong>
                    <div className="pill-row">
                      {compareProfile.isActive && <Pill tone="good">active</Pill>}
                      {compareProfile.isDefault && <Pill>default</Pill>}
                    </div>
                  </div>
                  <div className="detail-list compact">
                    <KeyValueRow label="模型" value={compareRuntime.config.summary.modelDefault || '—'} />
                    <KeyValueRow label="Context" value={compareRuntime.config.summary.contextEngine || '—'} />
                    <KeyValueRow label="Backend" value={compareRuntime.config.summary.terminalBackend || '—'} />
                    <KeyValueRow label="Memory Provider" value={compareRuntime.config.summary.memoryProvider || 'builtin-file'} />
                    <KeyValueRow label="Toolsets" value={toolsetLabel(compareRuntime)} />
                    <KeyValueRow label="工具面" value={`${enabledToolCount(compareRuntime)}/${totalToolCount(compareRuntime)}`} />
                    <KeyValueRow label="插件数" value={compareRuntime.extensions.plugins.installedCount} />
                    <KeyValueRow label="Cron / 远端" value={`${compareRuntime.cron.jobs.length} / ${remoteJobCount(compareRuntime)}`} />
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}

          {compareView === 'drifts' ? (
            <Panel title="差异提醒" subtitle="只有在你真正要排查环境漂移时，再看这一层。">
              {compareWarnings.length > 0 ? (
                <div className="warning-stack">
                  {compareWarnings.map((warning) => (
                    <div className="warning-item" key={warning}>
                      {warning}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="两侧运行态接近" description="当前选中的两个 profile 没有明显的配置或能力面漂移。" />
              )}
            </Panel>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="暂无可对照目标"
          description="至少需要两个 profile，且两边运行态都读取完成后，才能做差异对照。"
        />
      )}
    </div>
  );

  const manageCreateSection = (
    <div className="two-column profile-actions-grid">
      <Panel
        title="创建 Profile"
        className="panel-nested"
        aside={
          <Toolbar>
            <Button kind="primary" onClick={() => void createProfile()} disabled={runningAction !== null}>
              {runningAction === 'create-profile' ? '创建中…' : '创建'}
            </Button>
          </Toolbar>
        }
      >
        <div className="form-grid">
          <label className="field-stack">
            <span>Profile 名称</span>
            <input
              className="search-input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="ops / research / coding"
            />
          </label>

          <label className="field-stack">
            <span>创建模式</span>
            <select
              className="select-input"
              value={createMode}
              onChange={(event) => setCreateMode(event.target.value as CreateMode)}
            >
              <option value="fresh">空白新建</option>
              <option value="clone">克隆配置</option>
              <option value="clone-all">完整克隆</option>
            </select>
          </label>

          <label className="field-stack">
            <span>克隆来源</span>
            <select
              className="select-input"
              value={cloneFrom}
              onChange={(event) => setCloneFrom(event.target.value)}
              disabled={createMode === 'fresh'}
            >
              {profileItems.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack">
            <span>Alias 策略</span>
            <div className="checkbox-row single">
              <label>
                <input
                  type="checkbox"
                  checked={noAlias}
                  onChange={(event) => setNoAlias(event.target.checked)}
                />
                <span>跳过 wrapper alias 创建</span>
              </label>
            </div>
          </label>
        </div>

        <p className="helper-text">
          `克隆配置` 对齐 `hermes profile create --clone`，`完整克隆` 对齐 `--clone-all`。
        </p>
      </Panel>

      <Panel
        title="导入 Profile"
        className="panel-nested"
        aside={
          <Toolbar>
            <Button
              kind="primary"
              onClick={() => void importProfile()}
              disabled={runningAction !== null}
            >
              {runningAction === 'import-profile' ? '导入中…' : '导入'}
            </Button>
          </Toolbar>
        }
      >
        <div className="form-grid">
          <label className="field-stack">
            <span>Archive 路径</span>
            <input
              className="search-input"
              value={importArchive}
              onChange={(event) => setImportArchive(event.target.value)}
              placeholder="/Users/you/backups/ops.tar.gz"
            />
          </label>

          <label className="field-stack">
            <span>导入名称</span>
            <input
              className="search-input"
              value={importName}
              onChange={(event) => setImportName(event.target.value)}
              placeholder="留空则由 Hermes 自动推断"
            />
          </label>
        </div>
      </Panel>
    </div>
  );

  const manageTransferSection = (
    <div className="two-column profile-actions-grid">
      <Panel
        title="重命名 Profile"
        className="panel-nested"
        aside={
          <Toolbar>
            <Button
              onClick={() => void renameProfile()}
              disabled={!selectedProfile || selectedProfile.isDefault || runningAction !== null}
            >
              {runningAction === 'rename-profile' ? '重命名中…' : '重命名'}
            </Button>
          </Toolbar>
        }
      >
        <label className="field-stack">
          <span>新名称</span>
          <input
            className="search-input"
            value={renameTo}
            onChange={(event) => setRenameTo(event.target.value)}
            disabled={!selectedProfile || selectedProfile.isDefault}
            placeholder="新的 profile 名称"
          />
        </label>
        {selectedProfile?.isDefault && (
          <p className="helper-text">`default` 是 Hermes 保留实例，不能重命名。</p>
        )}
      </Panel>

      <Panel
        title="导出 Profile"
        className="panel-nested"
        aside={
          <Toolbar>
            <Button
              onClick={() => void exportProfile()}
              disabled={!selectedProfile || runningAction !== null}
            >
              {runningAction === 'export-profile' ? '导出中…' : '导出'}
            </Button>
          </Toolbar>
        }
      >
        <label className="field-stack">
          <span>输出路径</span>
          <input
            className="search-input"
            value={exportOutput}
            onChange={(event) => setExportOutput(event.target.value)}
            placeholder="ops-backup.tar.gz"
          />
        </label>
        <p className="helper-text">留空则交给 Hermes 使用默认 `&lt;name&gt;.tar.gz`。</p>
      </Panel>
    </div>
  );

  const manageAliasSection = (
    <Panel title="Alias 管理" className="panel-nested">
      {selectedProfile ? (
        <div className="page-stack">
          {selectedProfile.aliases.length > 0 ? (
            <div className="list-stack">
              {selectedProfile.aliases.map((alias) => (
                <div className="list-card session-card" key={alias.path}>
                  <div className="list-card-title">
                    <strong>{alias.name}</strong>
                    <div className="pill-row">
                      {alias.isPrimary && <Pill>primary</Pill>}
                    </div>
                  </div>
                  <p>{alias.path}</p>
                  <Toolbar>
                    <Button
                      disabled={runningAction !== null}
                      onClick={() => void openInFinder(alias.path, `${alias.name} Alias`, true)}
                    >
                      在 Finder 中定位
                    </Button>
                  </Toolbar>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无 Alias"
              description="当前 profile 还没有可用的 wrapper alias，可以在下面直接创建。"
            />
          )}

          <div className="two-column profile-actions-grid">
            <div className="page-stack">
              <label className="field-stack">
                <span>Alias 名称</span>
                <input
                  className="search-input"
                  value={aliasName}
                  onChange={(event) => setAliasName(event.target.value)}
                  placeholder="留空时会回退到 profile 名称"
                />
              </label>
              <p className="helper-text">
                这里直接复用 `hermes profile alias {selectedProfile.name} --name &lt;alias&gt;`。
              </p>
              <Toolbar>
                <Button
                  kind="primary"
                  onClick={() => void createAlias()}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'create-alias' ? '创建中…' : '创建 / 更新 Alias'}
                </Button>
              </Toolbar>
            </div>

            <div className="page-stack">
              <div className="danger-copy">
                <strong>⚠️ 危险操作检测！</strong>
                <p>操作类型：删除 wrapper alias</p>
                <p>影响范围：当前 profile 在 `~/.local/bin` 下的启动脚本</p>
                <p>风险评估：删除后不会影响 profile 数据，但会失去对应快捷命令入口。</p>
              </div>
              <label className="field-stack">
                <span>删除目标</span>
                <select
                  className="select-input"
                  value={removeAliasName}
                  onChange={(event) => setRemoveAliasName(event.target.value)}
                  disabled={selectedProfile.aliases.length === 0}
                >
                  {selectedProfile.aliases.length === 0 ? (
                    <option value="">当前没有 alias</option>
                  ) : (
                    selectedProfile.aliases.map((alias) => (
                      <option key={alias.name} value={alias.name}>
                        {alias.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="field-stack">
                <span>请输入 `{removeAliasName || 'alias 名称'}` 以确认删除</span>
                <input
                  className="search-input"
                  value={removeAliasConfirm}
                  onChange={(event) => setRemoveAliasConfirm(event.target.value)}
                  disabled={selectedProfile.aliases.length === 0}
                  placeholder={removeAliasName || '选择一个 alias'}
                />
              </label>
              <Toolbar>
                <Button
                  kind="danger"
                  onClick={() => void deleteAlias()}
                  disabled={
                    selectedProfile.aliases.length === 0
                    || removeAliasConfirm.trim() !== removeAliasName.trim()
                    || runningAction !== null
                  }
                >
                  {runningAction === 'delete-alias' ? '删除中…' : '删除 Alias'}
                </Button>
              </Toolbar>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="未选择 profile" description="选择一个 profile 后才能管理 alias。" />
      )}
    </Panel>
  );

  const manageDangerSection = (
    <div className="two-column profile-actions-grid">
      <Panel
        title="危险区"
        className="panel-nested panel-danger"
        aside={
          <Toolbar>
            <Button
              kind="danger"
              onClick={() => void deleteProfile()}
              disabled={
                !selectedProfile
                || selectedProfile.isDefault
                || deleteConfirm.trim() !== selectedProfile.name
                || runningAction !== null
              }
            >
              {runningAction === 'delete-profile' ? '删除中…' : '删除 Profile'}
            </Button>
          </Toolbar>
        }
      >
        {selectedProfile ? (
          <>
            <div className="danger-copy">
              <strong>⚠️ 危险操作检测！</strong>
              <p>操作类型：删除 Hermes profile</p>
              <p>影响范围：{selectedProfile.homePath}</p>
              <p>风险评估：会删除该 profile 目录及其会话、技能、配置、记忆和运行状态。</p>
            </div>
            <label className="field-stack">
              <span>请输入 `{selectedProfile.name}` 以确认删除</span>
              <input
                className="search-input"
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                disabled={selectedProfile.isDefault}
                placeholder={selectedProfile.name}
              />
            </label>
            {selectedProfile.isDefault && (
              <p className="helper-text">`default` 是 Hermes 的保留 profile，客户端不允许删除。</p>
            )}
          </>
        ) : (
          <EmptyState title="未选择 profile" description="选择一个非 default profile 后才能进入删除确认。" />
        )}
      </Panel>

      <Panel title="动作回执" className="panel-nested">
        {lastCommand ? (
          <>
            <div className="detail-list compact">
              <KeyValueRow label="动作" value={lastCommandLabel || '治理动作'} />
              <KeyValueRow label="命令" value={lastCommand.command} />
              <KeyValueRow label="退出码" value={lastCommand.exitCode} />
              <KeyValueRow label="结果" value={<Pill tone={lastCommand.success ? 'good' : 'bad'}>{String(lastCommand.success)}</Pill>} />
            </div>
            <pre className="code-block">{lastCommand.stdout || lastCommand.stderr || '无输出'}</pre>
          </>
        ) : (
          <EmptyState title="尚无动作回执" description="这里会显示创建、重命名、导入导出、Alias 管理和桌面文件动作的执行结果。" />
        )}
      </Panel>
    </div>
  );

  const manageSection = (
    <div className="page-stack">
      <Panel
        title="高级治理入口"
        subtitle="默认一次只展开一个低频子模块，避免把创建、迁移、Alias、删除和输出同时摊满页面。"
        aside={
          lastCommand ? (
            <Toolbar>
              <Button onClick={() => setManageView('danger')}>最近回执</Button>
            </Toolbar>
          ) : undefined
        }
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {PROFILE_MANAGE_VIEWS.map((item) => {
            const meta = item.key === 'create'
              ? '新建实例、克隆配置和导入归档'
              : item.key === 'transfer'
                ? (selectedProfile ? `当前焦点：${selectedProfile.name}` : '先选择一个实例')
                : item.key === 'alias'
                  ? (selectedProfile ? `${selectedProfile.aliases.length} 个 alias 可管理` : '先选择一个实例')
                  : (lastCommand ? `最近动作：${lastCommandLabel || '治理动作'}` : '删除确认和动作输出');

            return (
              <button
                key={item.key}
                type="button"
                className={`workspace-shortcut-card dashboard-shortcut-card ${manageView === item.key ? 'active' : ''}`}
                onClick={() => setManageView(item.key)}
              >
                <strong><span className="dashboard-shortcut-icon">{item.icon}</span>{item.label}</strong>
                <span>{meta}</span>
              </button>
            );
          })}
        </div>
        <p className="helper-text top-gap">{activeManageView.hint}</p>
      </Panel>

      {manageView === 'create' ? manageCreateSection : null}
      {manageView === 'transfer' ? manageTransferSection : null}
      {manageView === 'alias' ? manageAliasSection : null}
      {manageView === 'danger' ? manageDangerSection : null}
    </div>
  );

  return (
    <div className="two-column wide-left">
      <Panel
        title="实例列表"
        subtitle="默认只展开最常用的一小部分实例，避免左侧列表本身就变成信息墙。"
        aside={
          <Toolbar>
            {profileItems.length > DEFAULT_PROFILE_RAIL_LIMIT ? (
              <Button onClick={() => setShowAllProfiles((current) => !current)}>
                {showAllProfiles ? '收起列表' : `展开更多${hiddenProfileCount > 0 ? `（${hiddenProfileCount}）` : ''}`}
              </Button>
            ) : null}
            <Button onClick={() => void refreshProfileWorkspace()}>刷新列表</Button>
          </Toolbar>
        }
      >
        {profileItems.length === 0 ? (
          <EmptyState title="未发现 profile" description="当前还没有可管理的 Hermes profile。" />
        ) : (
          <div className={`list-stack profile-rail ${showAllProfiles ? 'profile-rail-scroll' : ''}`}>
            {visibleProfileItems.map((item) => (
              <button
                key={item.name}
                type="button"
                className={`list-card session-card ${selectedProfile?.name === item.name ? 'selected' : ''}`}
                onClick={() => setSelectedName(item.name)}
              >
                <div className="list-card-title">
                  <strong>{item.name}</strong>
                  <div className="pill-row">
                    {item.isDefault && <Pill>default</Pill>}
                    {item.isActive && <Pill tone="good">active</Pill>}
                    <Pill tone={item.envExists ? 'good' : 'warn'}>{item.envExists ? '.env ok' : '.env missing'}</Pill>
                  </div>
                </div>
                <p>{item.homePath}</p>
                <div className="meta-line">
                  <span>{item.modelDefault || '未配置模型'}</span>
                  <span>{item.gatewayState || 'gateway unknown'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {hiddenProfileCount > 0 && !showAllProfiles ? (
          <p className="helper-text top-gap">其余 {hiddenProfileCount} 个实例已暂时收起，需要时再展开查看。</p>
        ) : null}
      </Panel>

      <div className="page-stack">
        {focusShell}

        <div className="tab-bar">
          {PROFILE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              title={tab.hint}
            >
              {tab.label}
              {tab.key === 'overview' && selectedWarnings.length > 0 ? <span className="tab-dirty-dot" /> : null}
              {tab.key === 'compare' && compareWarnings.length > 0 ? <span className="tab-dirty-dot" /> : null}
              {tab.key === 'manage' && lastCommand !== null ? <span className="tab-dirty-dot" /> : null}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? overviewSection : null}
        {activeTab === 'compare' ? compareSection : null}
        {activeTab === 'manage' ? manageSection : null}
      </div>
    </div>
  );
}
