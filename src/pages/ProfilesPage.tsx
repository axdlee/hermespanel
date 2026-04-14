import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, KeyValueRow, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
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
import { isRemoteDelivery, platformTone } from '../lib/runtime';
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
import type { AppPageKey, MemoryPageIntent, PageIntent, PageProps } from './types';

type CreateMode = 'fresh' | 'clone' | 'clone-all';

interface ProfileRuntimeBundle {
  dashboard: DashboardSnapshot;
  config: ConfigDocuments;
  extensions: ExtensionsSnapshot;
  cron: CronJobsSnapshot;
  installation: InstallationSnapshot;
}

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

  const selectedRuntime = selectedProfile ? runtimeBundles[selectedProfile.name] : undefined;
  const compareRuntime = compareProfile ? runtimeBundles[compareProfile.name] : undefined;
  const selectedRuntimeLoading = selectedProfile ? loadingRuntimeNames.includes(selectedProfile.name) : false;
  const compareRuntimeLoading = compareProfile ? loadingRuntimeNames.includes(compareProfile.name) : false;
  const selectedWarnings = selectedProfile && selectedRuntime ? runtimeHealthWarnings(selectedProfile, selectedRuntime) : [];
  const compareWarnings = selectedProfile && selectedRuntime && compareProfile && compareRuntime
    ? profileDrifts(selectedProfile, selectedRuntime, compareProfile, compareRuntime)
    : [];
  const selectedInstallation = selectedRuntime?.installation;
  const selectedRelaySeed = selectedProfile ? profileRelaySeed(selectedProfile.name, selectedRuntime ?? null) : null;
  const configModelIntent = selectedProfile && selectedRelaySeed
    ? buildConfigDrilldownIntent(selectedRelaySeed, {
        description: `继续在 ${selectedProfile.name} 的配置中心直接调整模型、provider 和默认链路。`,
        focus: 'model',
        suggestedCommand: 'config-check',
      })
    : null;
  const configCredentialsIntent = selectedProfile && selectedRelaySeed
    ? buildConfigDrilldownIntent(selectedRelaySeed, {
        description: `继续在 ${selectedProfile.name} 的配置中心直接核对 API Key、通道和运行超时。`,
        focus: 'credentials',
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
  const memoryWorkbenchIntent: MemoryPageIntent | null = selectedProfile
    ? {
        kind: 'memory',
        sourcePage: 'profiles',
        headline: `从 Profile 管理继续治理 ${selectedProfile.name}`,
        description: `继续在 ${selectedProfile.name} 的记忆工作台核对 SOUL、长期记忆与用户画像。`,
        selectedKey: selectedRuntime?.config.summary.memoryEnabled === false ? 'soul' : 'memory',
      }
    : null;

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

  return (
    <div className="two-column wide-left">
      <Panel
        title="Profile 管理"
        subtitle="多实例治理思路，把 Hermes profile 从“目录列表”升级成“运行态工作区”来管理。"
        aside={
          <Toolbar>
            <Button onClick={() => void refreshProfileWorkspace()}>刷新列表</Button>
          </Toolbar>
        }
      >
        {profileItems.length === 0 ? (
          <EmptyState title="未发现 profile" description="当前还没有可管理的 Hermes profile。" />
        ) : (
          <div className="list-stack profile-rail">
            {profileItems.map((item) => (
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
      </Panel>

      <div className="page-stack">
        <Panel
          title="Profile 详情"
          subtitle={selectedProfile?.homePath}
          aside={
            selectedProfile ? (
              <Toolbar>
                <Button
                  disabled={runningAction !== null}
                  onClick={() => void openInFinder(selectedProfile.homePath, `${selectedProfile.name} 目录`)}
                >
                  打开目录
                </Button>
                <Button
                  disabled={runningAction !== null || !selectedRuntime}
                  onClick={() => selectedRuntime && void openInFinder(selectedRuntime.config.configPath, `${selectedProfile.name} config.yaml`, true)}
                >
                  定位配置
                </Button>
                <Button
                  disabled={runningAction !== null || !selectedRuntime}
                  onClick={() => selectedRuntime && void openInFinder(selectedRuntime.config.envPath, `${selectedProfile.name} .env`, true)}
                >
                  定位 .env
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
            <div className="detail-list">
              <KeyValueRow label="名称" value={selectedProfile.name} />
              <KeyValueRow label="默认实例" value={String(selectedProfile.isDefault)} />
              <KeyValueRow label="当前活跃" value={String(selectedProfile.isActive)} />
              <KeyValueRow label="模型" value={selectedProfile.modelDefault || '—'} />
              <KeyValueRow label="Gateway" value={selectedProfile.gatewayState || '—'} />
              <KeyValueRow label="会话数" value={selectedProfile.sessionCount} />
              <KeyValueRow label="技能数" value={selectedProfile.skillCount} />
              <KeyValueRow label=".env" value={selectedProfile.envExists ? 'exists' : 'missing'} />
              <KeyValueRow label="SOUL.md" value={selectedProfile.soulExists ? 'exists' : 'missing'} />
              <KeyValueRow label="主 Alias" value={selectedProfile.aliasPath || '—'} />
              <KeyValueRow label="Alias 数量" value={selectedProfile.aliases.length} />
            </div>
          ) : (
            <EmptyState title="未选择 profile" description="从左侧选择一个 Hermes profile 查看详情。" />
          )}
        </Panel>

        <Panel
          title="实例工作台"
          subtitle="把模型、通道、扩展、技能、记忆与诊断入口收回到客户端里，优先走结构化治理页面。"
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
            <div className="control-card-grid">
              <section className="action-card action-card-compact">
                <div className="action-card-header">
                  <div>
                    <p className="eyebrow">Workspace</p>
                    <h3 className="action-card-title">实例主卡</h3>
                  </div>
                  <Pill tone={selectedProfile.isActive ? 'good' : 'warn'}>
                    {selectedProfile.isActive ? '当前默认' : '独立实例'}
                  </Pill>
                </div>
                <p className="action-card-copy">
                  先把这个 profile 的 home、config、env 和基础状态核准，再决定是否切换默认实例或进入专项工作台。
                </p>
                <div className="detail-list compact">
                  <KeyValueRow label="Home" value={selectedProfile.homePath} />
                  <KeyValueRow label="模型" value={selectedRuntime?.config.summary.modelDefault || selectedProfile.modelDefault || '—'} />
                  <KeyValueRow label="Gateway" value={selectedRuntime?.dashboard.gateway?.gatewayState || selectedProfile.gatewayState || '—'} />
                </div>
                <Toolbar>
                  <Button onClick={() => void openInFinder(selectedProfile.homePath, `${selectedProfile.name} 目录`)} disabled={runningAction !== null}>
                    打开目录
                  </Button>
                  <Button
                    onClick={() => void openInFinder(selectedRuntime?.config.configPath ?? '', `${selectedProfile.name} config.yaml`, true)}
                    disabled={runningAction !== null || !selectedRuntime}
                  >
                    定位配置
                  </Button>
                  <Button
                    onClick={() => void openInFinder(selectedRuntime?.config.envPath ?? '', `${selectedProfile.name} .env`, true)}
                    disabled={runningAction !== null || !selectedRuntime}
                  >
                    定位 .env
                  </Button>
                  <Button
                    kind="primary"
                    disabled={selectedProfile.isActive || runningAction !== null}
                    onClick={() => void activateProfile(selectedProfile.name)}
                  >
                    {runningAction === `activate:${selectedProfile.name}` ? '同步中…' : selectedProfile.isActive ? '已是默认' : '设为默认'}
                  </Button>
                </Toolbar>
              </section>

              <section className="action-card action-card-compact">
                <div className="action-card-header">
                  <div>
                    <p className="eyebrow">Workbench</p>
                    <h3 className="action-card-title">配置 / Gateway / 扩展</h3>
                  </div>
                  <Pill tone={selectedRuntime?.config.summary.modelDefault ? 'good' : 'warn'}>
                    {selectedRuntime?.config.summary.modelDefault || '模型待配置'}
                  </Pill>
                </div>
                <p className="action-card-copy">
                  模型、provider、凭证、通道和 toolsets 优先在结构化页面里治理，不再把常用接管动作丢给命令行向导。
                </p>
                <Toolbar>
                  <Button
                    kind="primary"
                    onClick={() => void enterProfileWorkbench('config', {
                      actionKey: 'profile:goto-config-model',
                      intent: configModelIntent,
                    })}
                    disabled={runningAction !== null || !configModelIntent}
                  >
                    {runningAction === 'profile:goto-config-model' ? '进入配置中心…' : '模型配置'}
                  </Button>
                  <Button
                    onClick={() => void enterProfileWorkbench('config', {
                      actionKey: 'profile:goto-config-credentials',
                      intent: configCredentialsIntent,
                    })}
                    disabled={runningAction !== null || !configCredentialsIntent}
                  >
                    {runningAction === 'profile:goto-config-credentials' ? '进入配置中心…' : '凭证 / 通道'}
                  </Button>
                  <Button
                    onClick={() => void enterProfileWorkbench('gateway', {
                      actionKey: 'profile:goto-gateway',
                      intent: gatewayWorkbenchIntent,
                    })}
                    disabled={runningAction !== null || !gatewayWorkbenchIntent}
                  >
                    {runningAction === 'profile:goto-gateway' ? '进入 Gateway…' : 'Gateway 工作台'}
                  </Button>
                  <Button
                    onClick={() => void enterProfileWorkbench('extensions', {
                      actionKey: 'profile:goto-extensions',
                      intent: extensionsWorkbenchIntent,
                    })}
                    disabled={runningAction !== null || !extensionsWorkbenchIntent}
                  >
                    {runningAction === 'profile:goto-extensions' ? '进入扩展页…' : '扩展工作台'}
                  </Button>
                </Toolbar>
              </section>

              <section className="action-card action-card-compact">
                <div className="action-card-header">
                  <div>
                    <p className="eyebrow">Capability</p>
                    <h3 className="action-card-title">技能 / 记忆 / 诊断 / 日志</h3>
                  </div>
                  <Pill tone={selectedRuntime && selectedRuntime.extensions.runtimeSkills.length > 0 ? 'good' : 'warn'}>
                    {selectedRuntime ? `${selectedRuntime.extensions.runtimeSkills.length} 个运行时技能` : '能力面待读取'}
                  </Pill>
                </div>
                <p className="action-card-copy">
                  把技能安装态、记忆文件、系统诊断和日志追踪都收进客户端闭环，异常再顺着页面间 intent 继续追。
                </p>
                <Toolbar>
                  <Button
                    kind="primary"
                    onClick={() => void enterProfileWorkbench('skills', {
                      actionKey: 'profile:goto-skills',
                    })}
                    disabled={runningAction !== null}
                  >
                    {runningAction === 'profile:goto-skills' ? '进入技能页…' : '技能工作台'}
                  </Button>
                  <Button
                    onClick={() => void enterProfileWorkbench('memory', {
                      actionKey: 'profile:goto-memory',
                      intent: memoryWorkbenchIntent,
                    })}
                    disabled={runningAction !== null || !memoryWorkbenchIntent}
                  >
                    {runningAction === 'profile:goto-memory' ? '进入记忆页…' : '记忆工作台'}
                  </Button>
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
              </section>

              <section className="action-card action-card-compact">
                <div className="action-card-header">
                  <div>
                    <p className="eyebrow">Artifacts</p>
                    <h3 className="action-card-title">运行物料与恢复点</h3>
                  </div>
                  <Pill tone={selectedWarnings.length === 0 ? 'good' : 'warn'}>
                    {selectedWarnings.length === 0 ? '完整' : `${selectedWarnings.length} 条提醒`}
                  </Pill>
                </div>
                <p className="action-card-copy">
                  当某个实例状态漂移时，优先确认核心文件和运行物料是否齐全，再决定是否导出、迁移或回滚。
                </p>
                <div className="pill-row">
                  <Pill tone={selectedInstallation?.configExists ? 'good' : 'warn'}>config.yaml</Pill>
                  <Pill tone={selectedInstallation?.envExists ? 'good' : 'warn'}>.env</Pill>
                  <Pill tone={selectedInstallation?.stateDbExists ? 'good' : 'warn'}>state.db</Pill>
                  <Pill tone={selectedInstallation?.gatewayStateExists ? 'good' : 'warn'}>gateway_state.json</Pill>
                  <Pill tone={selectedInstallation?.logsDirExists ? 'good' : 'warn'}>logs</Pill>
                </div>
                <Toolbar>
                  <Button
                    onClick={() => void openInFinder(`${selectedProfile.homePath}/state.db`, `${selectedProfile.name} state.db`, true)}
                    disabled={runningAction !== null || !selectedInstallation?.stateDbExists}
                  >
                    定位 state.db
                  </Button>
                  <Button
                    onClick={() => void openInFinder(`${selectedProfile.homePath}/gateway_state.json`, `${selectedProfile.name} gateway_state.json`, true)}
                    disabled={runningAction !== null || !selectedInstallation?.gatewayStateExists}
                  >
                    定位网关状态
                  </Button>
                  <Button
                    onClick={() => void openInFinder(`${selectedProfile.homePath}/logs`, `${selectedProfile.name} logs`)}
                    disabled={runningAction !== null || !selectedInstallation?.logsDirExists}
                  >
                    打开 logs
                  </Button>
                  <Button
                    onClick={() => void enterProfileWorkbench('diagnostics', {
                      actionKey: 'profile:goto-artifact-diagnostics',
                      intent: diagnosticsWorkbenchIntent,
                    })}
                    disabled={runningAction !== null || !diagnosticsWorkbenchIntent}
                  >
                    {runningAction === 'profile:goto-artifact-diagnostics' ? '进入诊断页…' : '进入诊断页'}
                  </Button>
                </Toolbar>
              </section>
            </div>
          ) : (
            <EmptyState title="请选择 profile" description="选中一个 profile 后，这里会显示它的客户端治理入口、运行物料和实例级工作台。" />
          )}
        </Panel>

        <Panel
          title="运行态画像"
          subtitle="把 config / extensions / cron / gateway 合在一起看，这才更像真正的桌面管理客户端。"
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
              <div className="metrics-grid">
                <MetricCard label="工具面" value={`${enabledToolCount(selectedRuntime)}/${totalToolCount(selectedRuntime)}`} hint="当前 profile 实际启用的 tools 总量" />
                <MetricCard label="运行时技能" value={selectedRuntime.extensions.runtimeSkills.length} hint="来自 `hermes skills list` 的安装态" />
                <MetricCard label="插件数" value={selectedRuntime.extensions.plugins.installedCount} hint="来自 `hermes plugins list`" />
                <MetricCard label="Cron / 远端" value={`${selectedRuntime.cron.jobs.length} / ${remoteJobCount(selectedRuntime)}`} hint="总作业数 / 依赖 gateway 的作业数" />
              </div>
              <div className="health-grid">
                <section className="health-card">
                  <div className="health-card-header">
                    <strong>Config Runtime</strong>
                    <Pill tone={selectedRuntime.config.summary.terminalBackend ? 'good' : 'warn'}>
                      {selectedRuntime.config.summary.terminalBackend || '未配置 backend'}
                    </Pill>
                  </div>
                  <p>
                    {selectedRuntime.config.summary.modelProvider || '未配置 provider'} / {selectedRuntime.config.summary.modelDefault || '未配置 model'}
                    {' · '}
                    Memory {selectedRuntime.config.summary.memoryProvider || 'builtin-file'}
                  </p>
                </section>
                <section className="health-card">
                  <div className="health-card-header">
                    <strong>Gateway Runtime</strong>
                    <Pill tone={platformTone(selectedRuntime.dashboard.gateway?.gatewayState)}>
                      {selectedRuntime.dashboard.gateway?.gatewayState ?? '未检测到'}
                    </Pill>
                  </div>
                  <p>Connected Platforms {selectedRuntime.dashboard.gateway?.platforms.length ?? 0} · 远端作业 {remoteJobCount(selectedRuntime)}</p>
                </section>
                <section className="health-card">
                  <div className="health-card-header">
                    <strong>Toolsets</strong>
                    <Pill tone={selectedRuntime.config.summary.toolsets.length > 0 ? 'good' : 'warn'}>
                      {selectedRuntime.config.summary.toolsets.length}
                    </Pill>
                  </div>
                  <p>{toolsetLabel(selectedRuntime)}</p>
                </section>
                <section className="health-card">
                  <div className="health-card-header">
                    <strong>Memory Surface</strong>
                    <Pill tone={selectedRuntime.extensions.memoryRuntime.provider.includes('none') ? 'warn' : 'good'}>
                      {selectedRuntime.extensions.memoryRuntime.provider}
                    </Pill>
                  </div>
                  <p>Built-in {selectedRuntime.extensions.memoryRuntime.builtInStatus} · Local Skills {localRuntimeSkillCount(selectedRuntime)}</p>
                </section>
              </div>
              {selectedWarnings.length > 0 ? (
                <div className="warning-stack">
                  {selectedWarnings.map((warning) => (
                    <div className="warning-item" key={warning}>
                      {warning}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="运行态较完整" description="当前 profile 没有出现明显的结构性缺口，可以继续做对照或生命周期管理。" />
              )}
            </>
          ) : (
            <EmptyState
              title={selectedRuntimeLoading ? '正在读取运行态' : '运行态未就绪'}
              description={selectedProfile ? '将自动读取当前 profile 的 dashboard / config / extensions / cron 快照。' : '先从左侧选择一个 profile。'}
            />
          )}
        </Panel>

        <Panel
          title="Profile 对照"
          subtitle="把多 profile 的运行差异直接拉平来看，更适合做环境隔离、迁移和回归检查。"
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
          {selectedProfile && selectedRuntime && compareProfile && compareRuntime ? (
            <>
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
            </>
          ) : (
            <EmptyState
              title="暂无可对照目标"
              description="至少需要两个 profile，且两边运行态都读取完成后，才能做差异对照。"
            />
          )}
        </Panel>

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
    </div>
  );
}
