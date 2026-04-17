import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  NoticeState,
  NoticeTone,
  ProfilesSnapshot,
} from '../types';
import type { AppPageKey, PageIntent } from '../pages/types';
import { api } from '../lib/api';

interface AppState {
  // 导航状态
  activePage: AppPageKey;
  pageIntent: { target: AppPageKey; payload: PageIntent } | null;

  // Profile 状态
  profiles: ProfilesSnapshot | null;
  selectedProfile: string;
  activeProfile: string;
  loadingProfiles: boolean;
  syncingActive: boolean;

  // Shell 数据
  shellDashboard: DashboardSnapshot | null;
  shellInstallation: InstallationSnapshot | null;
  shellExtensions: ExtensionsSnapshot | null;
  loadingShell: boolean;
  refreshingShell: boolean;

  // UI 状态
  sidebarCollapsed: boolean;
  collapsedNavGroups: Record<string, boolean>;
  notice: NoticeState | null;

  // Actions
  navigate: (page: AppPageKey, intent?: PageIntent | null) => void;
  consumePageIntent: () => void;

  setSelectedProfile: (profile: string) => void;
  loadProfiles: (preferredProfile?: string) => Promise<void>;
  makeProfileActive: () => Promise<void>;

  loadShell: (profile?: string, options?: { silent?: boolean }) => Promise<void>;

  toggleSidebar: () => void;
  toggleNavGroup: (groupId: string) => void;

  notify: (tone: NoticeTone, message: string) => void;
  clearNotice: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // 初始状态
      activePage: 'dashboard',
      pageIntent: null,

      profiles: null,
      selectedProfile: 'default',
      activeProfile: 'default',
      loadingProfiles: true,
      syncingActive: false,

      shellDashboard: null,
      shellInstallation: null,
      shellExtensions: null,
      loadingShell: true,
      refreshingShell: false,

      sidebarCollapsed: false,
      collapsedNavGroups: {},
      notice: null,

      // 导航 Actions
      navigate: (page, intent) => {
        set({
          activePage: page,
          pageIntent: intent ? { target: page, payload: intent } : null,
        });
      },

      consumePageIntent: () => {
        set({ pageIntent: null });
      },

      // Profile Actions
      setSelectedProfile: profile => {
        set({ selectedProfile: profile });
      },

      loadProfiles: async preferredProfile => {
        set({ loadingProfiles: true });
        try {
          const snapshot = await api.getProfilesSnapshot();
          const state = get();
          const preferred = preferredProfile ?? state.selectedProfile;
          const nextSelected = snapshot.profiles.some(item => item.name === preferred)
            ? preferred
            : snapshot.profiles.some(item => item.name === snapshot.activeProfile)
              ? snapshot.activeProfile
              : (snapshot.profiles[0]?.name ?? 'default');
          set({
            profiles: snapshot,
            selectedProfile: nextSelected,
            activeProfile: snapshot.activeProfile,
            loadingProfiles: false,
          });
        } catch (reason) {
          set({ loadingProfiles: false });
          get().notify('error', String(reason));
        }
      },

      makeProfileActive: async () => {
        set({ syncingActive: true });
        try {
          const state = get();
          const snapshot = await api.setActiveProfile(state.selectedProfile);
          set({
            profiles: snapshot,
            activeProfile: state.selectedProfile,
            syncingActive: false,
          });
          await get().loadShell(state.selectedProfile, { silent: true });
          get().notify('success', `已将 ${state.selectedProfile} 设为 Hermes 默认 profile。`);
        } catch (reason) {
          set({ syncingActive: false });
          get().notify('error', String(reason));
        }
      },

      // Shell Actions
      loadShell: async (profile, options) => {
        const state = get();
        const profileName = profile ?? state.selectedProfile;

        if (options?.silent) {
          set({ refreshingShell: true });
        } else {
          set({ loadingShell: true });
        }

        try {
          const [dashboard, installation, extensions] = await Promise.all([
            api.getDashboardSnapshot(profileName),
            api.getInstallationSnapshot(profileName),
            api.getExtensionsSnapshot(profileName),
          ]);
          set({
            shellDashboard: dashboard,
            shellInstallation: installation,
            shellExtensions: extensions,
            loadingShell: false,
            refreshingShell: false,
          });
        } catch (reason) {
          set({
            loadingShell: false,
            refreshingShell: false,
          });
          get().notify('error', String(reason));
        }
      },

      // UI Actions
      toggleSidebar: () => {
        const next = !get().sidebarCollapsed;
        set({ sidebarCollapsed: next });
        try {
          window.localStorage.setItem('hermespanel_sidebar_collapsed', next ? '1' : '0');
        } catch {
          // noop
        }
      },

      toggleNavGroup: (groupId: string) => {
        const current = get().collapsedNavGroups;
        const next = { ...current, [groupId]: !current[groupId] };
        set({ collapsedNavGroups: next });
        try {
          window.localStorage.setItem('hermespanel_nav_groups_collapsed', JSON.stringify(next));
        } catch {
          // noop
        }
      },

      // Notification Actions
      notify: (tone, message) => {
        set({ notice: { tone, message } });
        // 自动清除
        setTimeout(() => {
          if (get().notice?.message === message) {
            set({ notice: null });
          }
        }, 3600);
      },

      clearNotice: () => {
        set({ notice: null });
      },
    }),
    {
      name: 'hermespanel-storage',
      partialize: state => ({
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedNavGroups: state.collapsedNavGroups,
        selectedProfile: state.selectedProfile,
      }),
    }
  )
);

// 初始化加载
export function initializeStore() {
  const store = useAppStore.getState();

  // 从 localStorage 恢复 UI 状态
  try {
    const stored = window.localStorage.getItem('hermespanel_sidebar_collapsed');
    if (stored === '1') {
      useAppStore.setState({ sidebarCollapsed: true });
    }
    const groupsStored = window.localStorage.getItem('hermespanel_nav_groups_collapsed');
    if (groupsStored) {
      useAppStore.setState({ collapsedNavGroups: JSON.parse(groupsStored) });
    }
  } catch {
    // noop
  }

  // 初始化数据加载
  void store.loadProfiles();
}
