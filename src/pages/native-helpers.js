export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function attrsToString(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => (value === true ? key : `${key}="${escapeHtml(value)}"`))
    .join(' ');
}

export function buttonHtml({
  action,
  label,
  kind = 'secondary',
  disabled = false,
  className = '',
  attrs = {},
}) {
  const classes = `button button-${kind}${className ? ` ${className}` : ''}`;
  return `
    <button
      type="button"
      class="${escapeHtml(classes)}"
      data-action="${escapeHtml(action)}"
      ${disabled ? 'disabled' : ''}
      ${attrsToString(attrs)}
    >
      ${escapeHtml(label)}
    </button>
  `;
}

export function pillHtml(label, tone = 'neutral') {
  return `<span class="pill pill-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

export function statusDotHtml(tone = 'warning') {
  return `<span class="status-dot ${escapeHtml(tone)}"></span>`;
}

export function emptyStateHtml(title, description) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

export function keyValueRowsHtml(items) {
  return `
    <div class="detail-list compact">
      ${items.map((item) => `
        <div class="key-value-row">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

export function commandResultHtml(payload, emptyTitle, emptyDescription) {
  if (!payload) {
    return emptyStateHtml(emptyTitle, emptyDescription);
  }

  return `
    <div class="result-stack">
      ${keyValueRowsHtml([
        { label: '动作', value: payload.label || '命令执行' },
        { label: '命令', value: payload.result.command || '—' },
        { label: '退出码', value: String(payload.result.exitCode ?? '—') },
        { label: '结果', value: payload.result.success ? '成功' : '失败' },
      ])}
      <pre class="code-block compact-code">${escapeHtml(payload.result.stdout || 'stdout 为空')}</pre>
      ${payload.result.stderr ? `<pre class="code-block compact-code">${escapeHtml(payload.result.stderr)}</pre>` : ''}
    </div>
  `;
}

export function firstLine(value, fallback = '—') {
  const line = String(value ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);

  return line || fallback;
}
