import React, { useEffect, useCallback } from 'react';

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // 页面导航 (Cmd/Ctrl + 数字)
  {
    key: '1',
    meta: isMac,
    ctrl: !isMac,
    description: '跳转到总览',
    action: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'dashboard' })),
  },
  {
    key: '2',
    meta: isMac,
    ctrl: !isMac,
    description: '跳转到实例',
    action: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'profiles' })),
  },
  {
    key: '3',
    meta: isMac,
    ctrl: !isMac,
    description: '跳转到配置',
    action: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'config' })),
  },
  {
    key: '4',
    meta: isMac,
    ctrl: !isMac,
    description: '跳转到技能',
    action: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'skills' })),
  },
  {
    key: 'g',
    meta: isMac,
    ctrl: !isMac,
    description: '跳转到网关',
    action: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'gateway' })),
  },
  {
    key: 'l',
    meta: isMac,
    ctrl: !isMac,
    description: '跳转到日志',
    action: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'logs' })),
  },

  // 侧边栏
  {
    key: 'b',
    meta: isMac,
    ctrl: !isMac,
    description: '切换侧边栏',
    action: () => window.dispatchEvent(new CustomEvent('toggle-sidebar')),
  },

  // 刷新
  {
    key: 'r',
    meta: isMac,
    ctrl: !isMac,
    description: '刷新当前页',
    action: () => window.dispatchEvent(new CustomEvent('refresh')),
  },

  // 搜索
  {
    key: 'k',
    meta: isMac,
    ctrl: !isMac,
    description: '打开搜索',
    action: () => window.dispatchEvent(new CustomEvent('open-search')),
  },

  // ESC 关闭
  {
    key: 'Escape',
    description: '关闭弹窗/返回',
    action: () => window.dispatchEvent(new CustomEvent('escape')),
  },
];

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[] = DEFAULT_SHORTCUTS) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      // 在输入框中只处理 Escape
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        if (event.key === 'Escape') {
          event.preventDefault();
          shortcuts.find(s => s.key === 'Escape')?.action();
        }
        return;
      }

      // 检查快捷键匹配
      for (const shortcut of shortcuts) {
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey;
        const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey;
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = shortcut.alt ? event.altKey : !event.altKey;

        if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export function KeyboardShortcutsHelp() {
  return (
    <div className="shortcuts-help">
      <h3>键盘快捷键</h3>
      <div className="shortcuts-grid">
        {DEFAULT_SHORTCUTS.map((shortcut, index) => (
          <div key={index} className="shortcut-item">
            <span className="shortcut-keys">
              {shortcut.ctrl && <kbd>Ctrl</kbd>}
              {shortcut.meta && <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>}
              {shortcut.shift && <kbd>Shift</kbd>}
              {shortcut.alt && <kbd>Alt</kbd>}
              <kbd>{shortcut.key === 'Escape' ? 'Esc' : shortcut.key}</kbd>
            </span>
            <span className="shortcut-description">{shortcut.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
