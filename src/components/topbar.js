import { NAV_GROUPS, PAGE_HINTS, PAGE_TITLES } from '../lib/panel-config';
import { getPanelState, loadProfiles, loadShell, setSelectedProfile } from '../lib/panel-state';

function activeGroupLabel(activePage) {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.key === activePage))?.label ?? '概览';
}

export function renderTopbar(el) {
  const state = getPanelState();
  const activeProfile = state.profiles?.activeProfile ?? 'default';
  const viewedProfile = state.profiles?.profiles.find((item) => item.name === state.selectedProfile) ?? null;
  const shellBusy = state.loadingProfiles || state.loadingShell || state.refreshingShell;
  const gatewayTone = state.shellDashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn';
  const cliTone = state.shellInstallation?.binaryFound ? 'good' : 'bad';
  const memoryTone = state.shellDashboard?.config.memoryEnabled ? 'good' : 'warn';

  el.innerHTML = `
    <div class="topbar-copy">
      <span class="topbar-kicker">${activeGroupLabel(state.activePage)} / ${PAGE_TITLES[state.activePage]}</span>
      <div class="topbar-profile-brief">
        <strong>${state.selectedProfile}</strong>
        <span>${state.selectedProfile === activeProfile ? '当前默认实例' : `默认实例 ${activeProfile}`}</span>
      </div>
    </div>
    <div class="topbar-actions">
      <div class="topbar-status-pills">
        <span class="pill pill-${cliTone}">CLI ${state.shellInstallation?.binaryFound ? 'Ready' : 'Missing'}</span>
        <span class="pill pill-${gatewayTone}">Gateway ${state.shellDashboard?.gateway?.gatewayState ?? 'unknown'}</span>
        <span class="pill pill-${memoryTone}">Memory ${state.shellDashboard?.config.memoryEnabled ? 'On' : 'Off'}</span>
        <span class="pill pill-${viewedProfile?.envExists ? 'good' : 'warn'}">Env ${viewedProfile?.envExists ? 'Ready' : 'Missing'}</span>
      </div>
      <div class="profile-switcher">
        <span>实例</span>
        <select class="select-input" id="topbar-profile-select" ${state.loadingProfiles || !state.profiles ? 'disabled' : ''}>
          ${(state.profiles?.profiles ?? []).map((item) => `
            <option value="${item.name}" ${item.name === state.selectedProfile ? 'selected' : ''}>
              ${item.name}${item.isActive ? ' · active' : ''}
            </option>
          `).join('')}
        </select>
      </div>
      <div class="toolbar shell-toolbar">
        <button type="button" class="button button-secondary" id="topbar-refresh-profiles" ${state.loadingProfiles ? 'disabled' : ''}>
          ${state.loadingProfiles ? '刷新中…' : '刷新实例'}
        </button>
        <button type="button" class="button button-secondary" id="topbar-refresh-shell" ${shellBusy ? 'disabled' : ''}>
          ${shellBusy ? '同步中…' : '刷新状态'}
        </button>
        <span class="info-tip" tabindex="0" aria-label="更多信息">
          <span class="info-tip-trigger">?</span>
          <span class="info-tip-bubble">当前页聚焦：${PAGE_HINTS[state.activePage]}。这条顶部栏只保留实例切换和全局健康信号，避免重复占用主工作区。</span>
        </span>
      </div>
    </div>
  `;

  el.querySelector('#topbar-profile-select')?.addEventListener('change', (event) => {
    const value = event.target.value;
    void setSelectedProfile(value);
  });

  el.querySelector('#topbar-refresh-profiles')?.addEventListener('click', () => {
    void loadProfiles(state.selectedProfile);
  });

  el.querySelector('#topbar-refresh-shell')?.addEventListener('click', () => {
    void loadShell(state.selectedProfile, { silent: true });
  });
}
