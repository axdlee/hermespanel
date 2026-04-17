import { useEffect } from 'react';
import type { NoticeState } from '../types';

interface NoticeToastProps {
  notice: NoticeState | null;
  onClear: () => void;
}

export function NoticeToast({ notice, onClear }: NoticeToastProps) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onClear, 3600);
    return () => window.clearTimeout(timer);
  }, [notice, onClear]);

  if (!notice) return null;

  return (
    <div className={`notice notice-${notice.tone}`} role="alert">
      <strong>
        {notice.tone === 'success' ? '成功' : notice.tone === 'error' ? '错误' : '提示'}
      </strong>
      <span>{notice.message}</span>
    </div>
  );
}
