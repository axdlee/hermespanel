import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type {
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  NoticeState,
  NoticeTone,
  ProfilesSnapshot,
} from '../types';

export function useAppShell() {
  const [profiles, setProfiles] = useState<ProfilesSnapshot | null>(null);
  const [selectedProfile, setSelectedProfile] = useState('default');
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [syncingActive, setSyncingActive] = useState(false);
  const [shellDashboard, setShellDashboard] = useState<DashboardSnapshot | null>(null);
  const [shellInstallation, setShellInstallation] = useState<InstallationSnapshot | null>(null);
  const [shellExtensions, setShellExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [refreshingShell, setRefreshingShell] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const notify = useCallback((tone: NoticeTone, message: string) => {
    setNotice({ tone, message });
  }, []);

  async function loadShell(profileName = selectedProfile, options?: { silent?: boolean }) {
    if (options?.silent) {
      setRefreshingShell(true);
    } else {
      setLoadingShell(true);
    }

    try {
      const [dashboard, installation, extensions] = await Promise.all([
        api.getDashboardSnapshot(profileName),
        api.getInstallationSnapshot(profileName),
        api.getExtensionsSnapshot(profileName),
      ]);
      setShellDashboard(dashboard);
      setShellInstallation(installation);
      setShellExtensions(extensions);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoadingShell(false);
      setRefreshingShell(false);
    }
  }

  async function loadProfiles(preferredProfile?: string) {
    setLoadingProfiles(true);
    try {
      const snapshot = await api.getProfilesSnapshot();
      setProfiles(snapshot);
      const preferred = preferredProfile ?? selectedProfile;
      const nextSelected = snapshot.profiles.some(item => item.name === preferred)
        ? preferred
        : snapshot.profiles.some(item => item.name === snapshot.activeProfile)
          ? snapshot.activeProfile
          : (snapshot.profiles[0]?.name ?? 'default');
      setSelectedProfile(nextSelected);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoadingProfiles(false);
    }
  }

  async function makeProfileActive() {
    setSyncingActive(true);
    try {
      const snapshot = await api.setActiveProfile(selectedProfile);
      setProfiles(snapshot);
      void loadShell(selectedProfile, { silent: true });
      notify('success', `已将 ${selectedProfile} 设为 Hermes 默认 profile。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSyncingActive(false);
    }
  }

  useEffect(() => {
    // 初始化加载 profiles - 仅在组件挂载时执行一次
    void loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loadingProfiles || !profiles) {
      return;
    }
    // 当 profile 变化时重新加载 shell 数据
    void loadShell(selectedProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingProfiles, profiles, selectedProfile]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const shellBusy = loadingProfiles || loadingShell || refreshingShell;
  const activeProfile = profiles?.activeProfile ?? 'default';
  const viewedProfile = profiles?.profiles.find(item => item.name === selectedProfile) ?? null;

  return {
    profiles,
    selectedProfile,
    setSelectedProfile,
    activeProfile,
    viewedProfile,
    loadingProfiles,
    shellBusy,
    shellDashboard,
    shellInstallation,
    shellExtensions,
    syncingActive,
    notice,
    notify,
    loadProfiles,
    loadShell,
    makeProfileActive,
    clearNotice: () => setNotice(null),
  };
}
