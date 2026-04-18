/**
 * HermesPanel Dashboard 状态管理
 *
 * 管理仪表盘数据：
 * - Dashboard 快照数据
 * - 安装状态快照
 * - 扩展快照
 * - Gateway 状态轮询
 */

import { create } from 'zustand';
import { api } from '../lib/api';
import type { DashboardSnapshot, InstallationSnapshot, ExtensionsSnapshot } from '../types';

interface DashboardState {
  // 数据快照
  snapshot: DashboardSnapshot | null;
  installation: InstallationSnapshot | null;
  extensions: ExtensionsSnapshot | null;

  // 加载状态
  loading: boolean;
  refreshing: boolean;
  error: string | null;

  // 轮询控制
  pollingIntervalId: number | null;

  // Profile 选择
  selectedProfile: string;
  setSelectedProfile: (profile: string) => void;
}

interface DashboardActions {
  // 数据加载
  loadAll: (profile?: string) => Promise<void>;
  refresh: (profile?: string) => Promise<void>;
  loadInstallation: (profile?: string) => Promise<void>;

  // 轮询控制
  startPolling: (interval?: number) => void;
  stopPolling: () => void;

  // 错误处理
  clearError: () => void;
}

export const useDashboardStore = create<DashboardState & DashboardActions>((set, get) => ({
  // 数据快照
  snapshot: null,
  installation: null,
  extensions: null,

  // 加载状态
  loading: false,
  refreshing: false,
  error: null,

  // 轮询控制
  pollingIntervalId: null,

  // Profile 选择
  selectedProfile: 'default',
  setSelectedProfile: profile => {
    set({ selectedProfile: profile });
    get().loadAll(profile);
  },

  // 数据加载
  loadAll: async profile => {
    const targetProfile = profile ?? get().selectedProfile;
    set({ loading: true, error: null });

    try {
      const [snapshot, installation, extensions] = await Promise.all([
        api.getDashboardSnapshot(targetProfile),
        api.getInstallationSnapshot(targetProfile),
        api.getExtensionsSnapshot(targetProfile),
      ]);

      set({
        snapshot,
        installation,
        extensions,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: String(err),
      });
    }
  },

  refresh: async profile => {
    const targetProfile = profile ?? get().selectedProfile;
    set({ refreshing: true });

    try {
      const snapshot = await api.getDashboardSnapshot(targetProfile);
      set({ snapshot, refreshing: false });
    } catch {
      set({ refreshing: false });
    }
  },

  loadInstallation: async profile => {
    const targetProfile = profile ?? get().selectedProfile;
    try {
      const installation = await api.getInstallationSnapshot(targetProfile);
      set({ installation });
    } catch {
      // 安静失败，不更新错误状态
    }
  },

  // 轮询控制
  startPolling: (interval = 10000) => {
    const existing = get().pollingIntervalId;
    if (existing) {
      clearInterval(existing);
    }

    // 立即刷新一次
    get().refresh();

    // 启动轮询
    const intervalId = window.setInterval(() => {
      // 检查页面可见性
      if (!document.hidden) {
        get().refresh();
      }
    }, interval);

    set({ pollingIntervalId: intervalId });
  },

  stopPolling: () => {
    const existing = get().pollingIntervalId;
    if (existing) {
      clearInterval(existing);
    }
    set({ pollingIntervalId: null });
  },

  clearError: () => set({ error: null }),
}));

// 辅助函数：从快照获取系统状态
export function getAppStatusFromSnapshot(
  snapshot: DashboardSnapshot | null,
  installation: InstallationSnapshot | null
): 'loading' | 'not_installed' | 'no_model' | 'no_ability' | 'ready' | 'error' {
  if (!snapshot || !installation) {
    return 'loading';
  }

  if (!installation.binaryFound) {
    return 'not_installed';
  }

  if (!snapshot.config?.modelDefault) {
    return 'no_model';
  }

  if (snapshot.counts?.skills === 0) {
    return 'no_ability';
  }

  return 'ready';
}
