import { attrsToString, escapeHtml } from './native-helpers';

export function infoTipHtml(content) {
  return `
    <span class="info-tip" tabindex="0" aria-label="更多信息">
      <span class="info-tip-trigger">?</span>
      <span class="info-tip-bubble">${escapeHtml(content)}</span>
    </span>
  `;
}

export function shortcutCardHtml({ action, label, meta, active = false, attrs = {} }) {
  return `
    <button
      type="button"
      class="workspace-shortcut-card${active ? ' active' : ''}"
      data-action="${escapeHtml(action)}"
      ${attrsToString(attrs)}
    >
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(meta)}</span>
    </button>
  `;
}
