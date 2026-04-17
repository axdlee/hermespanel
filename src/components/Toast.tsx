import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
  createdAt: number;
}

interface ToastOptions {
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
}

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const DEFAULT_DURATION = 4000;
const MAX_TOASTS = 3;

// 全局 toast 状态
let toastId = 0;
const toastListeners: Array<(toasts: ToastItem[]) => void> = [];
let currentToasts: ToastItem[] = [];

function notifyToastChange() {
  toastListeners.forEach(listener => listener(currentToasts));
}

export function showToast(options: ToastOptions): string {
  const id = `toast-${++toastId}`;
  const newToast: ToastItem = {
    id,
    type: options.type,
    message: options.message,
    title: options.title,
    duration: options.duration ?? DEFAULT_DURATION,
    createdAt: Date.now(),
  };

  // 限制最大数量
  if (currentToasts.length >= MAX_TOASTS) {
    currentToasts = currentToasts.slice(-MAX_TOASTS + 1);
  }

  currentToasts = [...currentToasts, newToast];
  notifyToastChange();

  // 自动移除
  setTimeout(() => {
    dismissToast(id);
  }, newToast.duration);

  return id;
}

export function dismissToast(id: string) {
  currentToasts = currentToasts.filter(t => t.id !== id);
  notifyToastChange();
}

export function clearAllToasts() {
  currentToasts = [];
  notifyToastChange();
}

// 快捷方法
export const toast = {
  success: (message: string, title?: string) => showToast({ type: 'success', message, title }),
  error: (message: string, title?: string) => showToast({ type: 'error', message, title }),
  warning: (message: string, title?: string) => showToast({ type: 'warning', message, title }),
  info: (message: string, title?: string) => showToast({ type: 'info', message, title }),
  dismiss: dismissToast,
  clear: clearAllToasts,
};

// Toast 容器组件
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>(currentToasts);

  useEffect(() => {
    const listener = (newToasts: ToastItem[]) => {
      setToasts([...newToasts]);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners.splice(toastListeners.indexOf(listener), 1);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="通知">
      {toasts.map(toast => (
        <ToastMessage key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
      <style>{`
        .toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 400px;
        }
        .toast-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 8px;
          background: var(--toast-bg, #fff);
          border: 1px solid var(--toast-border, #e0e0e0);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          animation: toast-slide-in 0.3s ease-out;
        }
        .toast-item.toast-success {
          --toast-bg: #e8f5e9;
          --toast-border: #4caf50;
          --toast-icon-bg: #4caf50;
        }
        .toast-item.toast-error {
          --toast-bg: #ffebee;
          --toast-border: #f44336;
          --toast-icon-bg: #f44336;
        }
        .toast-item.toast-warning {
          --toast-bg: #fff8e1;
          --toast-border: #ff9800;
          --toast-icon-bg: #ff9800;
        }
        .toast-item.toast-info {
          --toast-bg: #e3f2fd;
          --toast-border: #2196f3;
          --toast-icon-bg: #2196f3;
        }
        .toast-icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--toast-icon-bg);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .toast-content {
          flex: 1;
          min-width: 0;
        }
        .toast-title {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-primary, #1a1a1a);
          margin-bottom: 4px;
        }
        .toast-message {
          font-size: 13px;
          color: var(--text-secondary, #666);
          line-height: 1.4;
        }
        .toast-close {
          cursor: pointer;
          color: var(--text-secondary, #999);
          font-size: 18px;
          flex-shrink: 0;
          padding: 2px;
          border-radius: 4px;
          transition: background 0.2s;
        }
        .toast-close:hover {
          background: rgba(0, 0, 0, 0.05);
        }
        @keyframes toast-slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @media (prefers-color-scheme: dark) {
          .toast-item {
            --toast-bg: #2a2a2a;
            --toast-border: #444;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          }
          .toast-item.toast-success {
            --toast-bg: #1a3a1a;
            --toast-border: #4caf50;
          }
          .toast-item.toast-error {
            --toast-bg: #3a1a1a;
            --toast-border: #f44336;
          }
          .toast-item.toast-warning {
            --toast-bg: #3a2a1a;
            --toast-border: #ff9800;
          }
          .toast-item.toast-info {
            --toast-bg: #1a2a3a;
            --toast-border: #2196f3;
          }
          .toast-title {
            color: #fff;
          }
          .toast-message {
            color: #aaa;
          }
        }
        @media (max-width: 480px) {
          .toast-container {
            left: 16px;
            right: 16px;
            bottom: 16px;
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
}

function ToastMessage({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const title =
    toast.title ??
    (toast.type === 'success'
      ? '成功'
      : toast.type === 'error'
        ? '错误'
        : toast.type === 'warning'
          ? '警告'
          : '提示');

  return (
    <div className={`toast-item toast-${toast.type}`} role="alert">
      <div className="toast-icon">{TOAST_ICONS[toast.type]}</div>
      <div className="toast-content">
        <div className="toast-title">{title}</div>
        <div className="toast-message">{toast.message}</div>
      </div>
      <button className="toast-close" onClick={onDismiss} aria-label="关闭">
        ×
      </button>
    </div>
  );
}
