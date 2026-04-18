/**
 * HermesPanel 应用状态管理
 *
 * 管理全局应用状态：
 * - 导航状态（当前页面）
 * - 侧边栏状态（折叠、高级菜单展开）
 * - 环境检测状态（欢迎确认、环境检测完成）
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 页面类型定义
export type AppPageKey =
  | 'welcome'
  | 'envcheck'
  | 'dashboard'
  | 'chat'
  | 'skills'
  | 'sessions'
  | 'config'
  | 'gateway'
  | 'profiles'
  | 'extensions'
  | 'memory'
  | 'cron'
  | 'logs'
  | 'diagnostics';

// 安全的 localStorage storage（兼容 Tauri）
function safeLocalStorage() {
  try {
    // 测试 localStorage 是否可用
    const testKey = '__test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return createJSONStorage(() => localStorage);
  } catch {
    // localStorage 不可用，使用内存存储
    const memoryStorage: Record<string, string> = {};
    return createJSONStorage(() => ({
      getItem: (name: string) => memoryStorage[name] || null,
      setItem: (name: string, value: string) => {
        memoryStorage[name] = value;
      },
      removeItem: (name: string) => {
        delete memoryStorage[name];
      },
    }));
  }
}

interface AppState {
  // 导航状态
  activePage: AppPageKey;
  setPage: (page: AppPageKey) => void;

  // 侧边栏状态
  sidebarCollapsed: boolean;
  advancedExpanded: boolean;
  toggleSidebar: () => void;
  toggleAdvanced: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // 环境检测状态
  welcomeConfirmed: boolean;
  envChecked: boolean;
  setWelcomeConfirmed: (confirmed: boolean) => void;
  setEnvChecked: (checked: boolean) => void;

  // 全局 loading
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      // 导航状态
      activePage: 'welcome',
      setPage: page => set({ activePage: page }),

      // 侧边栏状态
      sidebarCollapsed: false,
      advancedExpanded: false,
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleAdvanced: () => set(state => ({ advancedExpanded: !state.advancedExpanded })),
      setSidebarCollapsed: collapsed => set({ sidebarCollapsed: collapsed }),

      // 环境检测状态
      welcomeConfirmed: false,
      envChecked: false,
      setWelcomeConfirmed: confirmed => set({ welcomeConfirmed: confirmed }),
      setEnvChecked: checked => set({ envChecked: checked }),

      // 全局 loading
      globalLoading: false,
      setGlobalLoading: loading => set({ globalLoading: loading }),
    }),
    {
      name: 'hermespanel-app-state',
      storage: safeLocalStorage(),
      partialize: state => ({
        sidebarCollapsed: state.sidebarCollapsed,
        welcomeConfirmed: state.welcomeConfirmed,
        envChecked: state.envChecked,
      }),
    }
  )
);

// 导航分组配置
export const NAV_GROUPS = [
  {
    label: '核心',
    items: [
      { key: 'dashboard', label: '仪表盘', icon: '📊' },
      { key: 'chat', label: '对话', icon: '💬' },
    ],
  },
  {
    label: '能力',
    items: [
      { key: 'skills', label: '技能', icon: '⚡' },
      { key: 'sessions', label: '会话', icon: '📋' },
    ],
  },
  {
    label: '设置',
    items: [
      { key: 'config', label: '配置', icon: '⚙️' },
      { key: 'gateway', label: '网关', icon: '🔌' },
    ],
  },
];

// 高级导航配置
export const ADVANCED_NAV_ITEMS = [
  { key: 'profiles', label: '实例', icon: '📁' },
  { key: 'extensions', label: '扩展', icon: '🔧' },
  { key: 'memory', label: '记忆', icon: '📝' },
  { key: 'cron', label: '任务', icon: '⏰' },
  { key: 'logs', label: '日志', icon: '📄' },
  { key: 'diagnostics', label: '诊断', icon: '🔍' },
];
