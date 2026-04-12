let container: HTMLDivElement | null = null;

function ensureContainer() {
  if (container) {
    return container;
  }

  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

interface ToastPayload {
  tone: 'success' | 'error' | 'info';
  message: string;
}

export function showToast({ tone, message }: ToastPayload) {
  const host = ensureContainer();
  const notice = document.createElement('div');
  notice.className = `notice notice-${tone}`;
  notice.innerHTML = `
    <strong>${tone === 'success' ? '成功' : tone === 'error' ? '错误' : '提示'}</strong>
    <span>${message}</span>
  `;
  host.appendChild(notice);

  window.setTimeout(() => {
    notice.remove();
    if (container && container.childElementCount === 0) {
      container.remove();
      container = null;
    }
  }, 3600);
}
