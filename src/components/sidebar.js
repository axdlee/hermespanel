import { NAV_GROUPS } from '../lib/panel-config';
import { getPanelState, makeSelectedProfileActive, navigate, toggleSidebar } from '../lib/panel-state';
import { version as APP_VERSION } from '../../package.json';

const ICONS = {
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  cron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  diagnostics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  extensions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  gateway: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
  profiles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  sessions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  skills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pillHtml(label, tone = 'neutral') {
  return `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
}

function gatewayTone(state) {
  if (state === 'running') {
    return 'good';
  }
  if (state === 'stopped' || state === 'error') {
    return 'warn';
  }
  return 'neutral';
}

function gatewayLabel(state) {
  if (state === 'running') {
    return 'Gateway 运行中';
  }
  if (state === 'stopped') {
    return 'Gateway 待启动';
  }
  if (state === 'error') {
    return 'Gateway 异常';
  }
  return 'Gateway 未检测';
}

export function renderSidebar(el) {
  const state = getPanelState();
  const activeProfile = state.profiles?.activeProfile ?? 'default';
  const viewedProfile = state.profiles?.profiles.find((item) => item.name === state.selectedProfile) ?? null;
  const pluginCount = state.shellExtensions?.plugins.installedCount ?? 0;
  const cliReady = state.shellInstallation?.binaryFound ?? false;
  const gatewayState = viewedProfile?.gatewayState ?? state.shellDashboard?.gateway?.gatewayState ?? 'gateway ?';
  const envReady = viewedProfile?.envExists ?? false;
  const profileMode = state.selectedProfile === activeProfile ? '默认实例' : '浏览实例';
  const modelLabel = viewedProfile?.modelDefault ?? state.shellDashboard?.config?.modelDefault ?? '模型待配置';

  el.className = `sidebar ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}`;
  el.innerHTML = `
    <div class="sidebar-brand">
      <span class="brand-mark">HP</span>
      <div class="sidebar-brand-copy">
        <p>HermesPanel</p>
        <span>桌面管理客户端</span>
      </div>
      <button type="button" class="sidebar-collapse-btn" id="sidebar-collapse-btn">
        ${state.sidebarCollapsed ? '»' : '«'}
      </button>
    </div>

    <div class="sidebar-scroller">
      ${NAV_GROUPS.map((group) => `
        <section class="sidebar-section">
          <div class="sidebar-section-label">${group.label}</div>
          <nav class="sidebar-nav">
            ${group.items.map((item) => `
              <button
                type="button"
                class="nav-item ${state.activePage === item.key ? 'active' : ''}"
                data-page="${item.key}"
                title="${item.label}"
              >
                <span class="nav-item-icon">${ICONS[item.icon] ?? ''}</span>
                <span class="nav-item-copy">
                  <strong>${item.label}</strong>
                </span>
              </button>
            `).join('')}
          </nav>
        </section>
      `).join('')}
    </div>

    <section class="sidebar-footer-lite">
      <div class="sidebar-summary-row">
        <div class="sidebar-summary-copy">
          <strong>${esc(state.selectedProfile)}</strong>
          <span>${profileMode}</span>
        </div>
        ${pillHtml(cliReady ? '已接管' : '待安装', cliReady ? 'good' : 'bad')}
      </div>
      <div class="sidebar-pill-row">
        ${pillHtml(envReady ? 'Env 已就绪' : 'Env 缺失', envReady ? 'good' : 'warn')}
        ${pillHtml(gatewayLabel(gatewayState), gatewayTone(gatewayState))}
      </div>
      <div class="sidebar-footer-meta">
        <span>${esc(modelLabel)}</span>
        <span>${pluginCount} 个插件</span>
      </div>
      <div class="sidebar-status-toolbar toolbar">
        <button type="button" class="button button-secondary" id="sidebar-make-active" ${state.syncingActive || state.selectedProfile === activeProfile ? 'disabled' : ''}>
          ${state.syncingActive ? '同步中…' : state.selectedProfile === activeProfile ? '已是默认' : '设为默认'}
        </button>
      </div>
      <div class="sidebar-meta sidebar-footnote">
        <span class="sidebar-meta-label">0 侵入封装</span>
        <span class="sidebar-meta-version">v${esc(APP_VERSION)}</span>
      </div>
    </section>
  `;

  el.querySelector('#sidebar-collapse-btn')?.addEventListener('click', () => {
    toggleSidebar();
  });

  el.querySelectorAll('[data-page]').forEach((node) => {
    node.addEventListener('click', () => {
      navigate(node.getAttribute('data-page'));
    });
  });

  el.querySelector('#sidebar-make-active')?.addEventListener('click', () => {
    void makeSelectedProfileActive();
  });
}
