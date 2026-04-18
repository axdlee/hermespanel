/**
 * HermesPanel Toast 通知管理
 *
 * 管理全局 Toast 通知：
 * - 添加/移除 Toast
 * - 自动消失
 * - 多种类型（success/error/warning/info）
 */

import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  createdAt: number;
}

interface ToastOptions {
  type: ToastType;
  message: string;
  duration?: number; // 默认 5000ms
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (options: ToastOptions) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

// 生成唯一 ID
function generateToastId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: options => {
    const id = generateToastId();
    const duration = options.duration ?? 5000;

    const toast: ToastItem = {
      id,
      type: options.type,
      message: options.message,
      duration,
      createdAt: Date.now(),
    };

    set(state => ({
      toasts: [...state.toasts, toast],
    }));

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }

    return id;
  },

  removeToast: id => {
    set(state => ({
      toasts: state.toasts.filter(t => t.id !== id),
    }));
  },

  clearAll: () => {
    set({ toasts: [] });
  },
}));

// 便捷方法
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'success', message, duration }),
  error: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'error', message, duration }),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'warning', message, duration }),
  info: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'info', message, duration }),
};
