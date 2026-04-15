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
      label: state.shellInstallation?.binaryFound ? '运行组件已接管' : '运行组件待安装',
      tone: state.shellInstallation?.binaryFound ? 'good' : 'bad',
    },
    {
      label: gatewayLabel(state.shellDashboard?.gateway?.gatewayState ?? 'unknown'),
      tone: state.shellDashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn',
    },
    {
      label: state.shellDashboard?.config.memoryEnabled ? '记忆已开启' : '记忆已关闭',
      tone: state.shellDashboard?.config.memoryEnabled ? 'good' : 'warn',
    },
  ];

  el.innerHTML = `
    <div class="topbar-presence">
      <span class="topbar-kicker">${activeGroupLabel(state.activePage)}</span>
      <div class="topbar-route-line">
        <strong>${state.selectedProfile}</strong>
        <span>${state.selectedProfile === activeProfile ? `当前默认实例 · ${PAGE_TITLES[state.activePage]}` : `默认实例 ${activeProfile} · ${PAGE_TITLES[state.activePage]}`}</span>
        <span class="info-tip" tabindex="0" aria-label="更多信息">
          <span class="info-tip-trigger">?</span>
          <span class="info-tip-bubble">当前页是 ${PAGE_TITLES[state.activePage]}。顶栏只保留实例切换和全局健康信号，把主要操作位让给工作区。</span>
        </span>
      </div>
    </div>
    <div class="topbar-actions">
      <div class="topbar-health-strip">
        ${statuses.map((item) => `
          <span class="topbar-health-item topbar-health-${item.tone}">
            <span class="topbar-health-dot"></span>
            ${item.label}
          </span>
        `).join('')}
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
          <button type="button" class="button button-secondary" id="topbar-refresh-profiles" ${state.loadingProfiles ? 'disabled' : ''}>
            ${state.loadingProfiles ? '刷新中…' : '刷新实例列表'}
          </button>
          <button type="button" class="button button-secondary" id="topbar-refresh-shell" ${shellBusy ? 'disabled' : ''}>
            ${shellBusy ? '同步中…' : '刷新状态'}
          </button>
        </div>
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
