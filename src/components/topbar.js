import { NAV_GROUPS, PAGE_TITLES } from '../lib/panel-config';
import { getPanelState, loadProfiles, loadShell, setSelectedProfile } from '../lib/panel-state';

function activeGroupLabel(activePage) {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.key === activePage))?.label ?? '概览';
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

export function renderTopbar(el) {
  const state = getPanelState();
  const activeProfile = state.profiles?.activeProfile ?? 'default';
  const shellBusy = state.loadingProfiles || state.loadingShell || state.refreshingShell;
  const statuses = [
    {
      label: state.shellInstallation?.binaryFound ? '组件已接管' : '组件待安装',
      tone: state.shellInstallation?.binaryFound ? 'good' : 'bad',
    },
    {
      label: `${gatewayLabel(state.shellDashboard?.gateway?.gatewayState ?? 'unknown')} · ${state.shellDashboard?.config.memoryEnabled ? '记忆开' : '记忆关'}`,
      tone: state.shellDashboard?.config.memoryEnabled ? 'good' : 'warn',
    },
  ];

  el.innerHTML = `
    <div class="topbar-presence">
      <span class="topbar-kicker">${activeGroupLabel(state.activePage)} / ${PAGE_TITLES[state.activePage]}</span>
      <div class="topbar-route-line">
        <strong>${state.selectedProfile}</strong>
        <span>${state.selectedProfile === activeProfile ? '当前默认实例' : `默认实例 ${activeProfile}`}</span>
        <div class="topbar-health-strip topbar-health-strip-compact">
          ${statuses.map((item) => `
            <span class="topbar-health-item topbar-health-${item.tone}">
              <span class="topbar-health-dot"></span>
              ${item.label}
            </span>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="topbar-controls">
      <label class="profile-switcher">
        <span>实例</span>
        <select class="select-input" id="topbar-profile-select" ${state.loadingProfiles || !state.profiles ? 'disabled' : ''}>
          ${(state.profiles?.profiles ?? []).map((item) => `
            <option value="${item.name}" ${item.name === state.selectedProfile ? 'selected' : ''}>
              ${item.name}${item.isActive ? ' · 当前默认' : ''}
            </option>
          `).join('')}
        </select>
      </label>
      <div class="toolbar shell-toolbar">
        <button type="button" class="button button-secondary" id="topbar-refresh-all" ${shellBusy ? 'disabled' : ''}>
          ${shellBusy ? '同步中…' : '刷新'}
        </button>
      </div>
    </div>
  `;

  el.querySelector('#topbar-profile-select')?.addEventListener('change', (event) => {
    const value = event.target.value;
    void setSelectedProfile(value);
  });

  el.querySelector('#topbar-refresh-all')?.addEventListener('click', () => {
    void Promise.all([
      loadProfiles(state.selectedProfile),
      loadShell(state.selectedProfile, { silent: true }),
    ]);
  });
}
