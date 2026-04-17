import { Button, Pill, Toolbar } from './ui';
import type { AppPageKey, PageIntent } from '../pages/types';
import type { DashboardSnapshot, InstallationSnapshot, ProfilesSnapshot } from '../types';
import { NAV_GROUPS } from '../lib/navigation';

interface AppSidebarProps {
  activePage: AppPageKey;
  navigate: (page: AppPageKey, intent?: PageIntent | null) => void;
  selectedProfile: string;
  activeProfile: string;
  profiles: ProfilesSnapshot | null;
  shellDashboard: DashboardSnapshot | null;
  shellInstallation: InstallationSnapshot | null;
  shellBusy: boolean;
  syncingActive: boolean;
  viewedProfile: {
    modelDefault?: string | null;
    gatewayState?: string | null;
    skillCount?: number;
    envExists?: boolean;
  } | null;
  onRefreshShell: () => void;
  onMakeProfileActive: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  collapsedNavGroups: Record<string, boolean>;
  toggleNavGroup: (groupId: string) => void;
}

export function AppSidebar({
  activePage,
  navigate,
  selectedProfile,
  activeProfile,
  profiles: _profiles,
  shellDashboard,
  shellInstallation,
  shellBusy,
  syncingActive,
  viewedProfile,
  onRefreshShell,
  onMakeProfileActive,
  sidebarCollapsed,
  toggleSidebar,
  collapsedNavGroups,
  toggleNavGroup,
}: AppSidebarProps) {
  const gatewayTone = shellDashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn';
  const cliTone = shellInstallation?.binaryFound ? 'good' : 'bad';
  const memoryTone = shellDashboard?.config.memoryEnabled ? 'good' : 'warn';
  const profileSummaryLine = [
    viewedProfile?.modelDefault ?? shellDashboard?.config.modelDefault ?? '模型待配置',
    viewedProfile?.gatewayState ?? shellDashboard?.gateway?.gatewayState ?? '网关待确认',
    `${viewedProfile?.skillCount ?? shellDashboard?.counts.skills ?? 0} skills`,
    viewedProfile?.envExists ? '环境已就绪' : '环境待补齐',
  ].join(' · ');

  const activeGroup =
    NAV_GROUPS.find(group => group.items.some(item => item.key === activePage)) ?? NAV_GROUPS[0];

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">HP</span>
        <div className="sidebar-brand-copy">
          <p>HermesPanel</p>
          <span>Hermes 轻量工作台</span>
        </div>
        <button type="button" className="sidebar-collapse-btn" onClick={toggleSidebar}>
          {sidebarCollapsed ? '»' : '«'}
        </button>
      </div>

      {!sidebarCollapsed ? (
        <div className="sidebar-guide-card">
          <strong>先走"总览 → 配置 → 技能"</strong>
          <p>默认只保留高频入口，排查和资料都继续后置。</p>
        </div>
      ) : null}

      <div className="sidebar-scroller">
        {NAV_GROUPS.map(group => (
          <section className="sidebar-section" key={group.id}>
            <div className="sidebar-section-header">
              <div className="sidebar-group-copy">
                <span className="sidebar-section-eyebrow">{group.eyebrow}</span>
                <div className="sidebar-section-label">{group.label}</div>
              </div>
              {group.collapsible ? (
                <button
                  type="button"
                  className="sidebar-section-toggle"
                  onClick={() => toggleNavGroup(group.id)}
                >
                  {collapsedNavGroups[group.id] ? '展开' : '收起'}
                </button>
              ) : (
                <span className="sidebar-section-count">{group.items.length} 项</span>
              )}
            </div>
            {!collapsedNavGroups[group.id] || group.items.some(item => item.key === activePage) ? (
              <>
                {activeGroup.id === group.id ? (
                  <p className="sidebar-section-summary">{group.summary}</p>
                ) : null}
                <nav className="sidebar-nav">
                  {group.items.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      className={`nav-item ${activePage === item.key ? 'active' : ''}`}
                      onClick={() => navigate(item.key)}
                      title={`${item.label} · ${item.description}`}
                    >
                      <span className={`nav-item-mark nav-item-mark-${group.id}`}>{item.mark}</span>
                      <span className="nav-item-copy">
                        <span className="nav-item-eyebrow">{item.eyebrow}</span>
                        <strong>{item.label}</strong>
                        {activePage === item.key ? <small>{item.description}</small> : null}
                      </span>
                      {item.badge ? <span className="nav-item-badge">{item.badge}</span> : null}
                    </button>
                  ))}
                </nav>
              </>
            ) : null}
          </section>
        ))}
      </div>

      <section className="sidebar-status-card">
        <div className="sidebar-status-head">
          <div>
            <span className="sidebar-card-label">当前实例</span>
            <strong className="sidebar-status-name">{selectedProfile}</strong>
            <p className="sidebar-status-copy">
              {selectedProfile === activeProfile
                ? '正在查看默认实例。'
                : '当前是浏览实例，不会影响默认实例。'}
            </p>
          </div>
          <Pill tone={selectedProfile === activeProfile ? 'good' : 'neutral'}>
            {selectedProfile === activeProfile ? '默认实例' : '浏览中'}
          </Pill>
        </div>
        <div className="sidebar-pill-row">
          <Pill tone={cliTone}>CLI {shellInstallation?.binaryFound ? '已接管' : '待安装'}</Pill>
          <Pill tone={gatewayTone}>
            网关 {viewedProfile?.gatewayState ?? shellDashboard?.gateway?.gatewayState ?? '—'}
          </Pill>
          <Pill tone={memoryTone}>
            记忆 {shellDashboard?.config.memoryEnabled ? '已开启' : '已关闭'}
          </Pill>
        </div>
        <p className="sidebar-status-copy">{profileSummaryLine}</p>
        <Toolbar className="sidebar-status-toolbar">
          <Button onClick={() => onRefreshShell()} disabled={shellBusy}>
            {shellBusy ? '同步中…' : '刷新摘要'}
          </Button>
          <Button
            kind="primary"
            onClick={() => onMakeProfileActive()}
            disabled={syncingActive || selectedProfile === activeProfile}
          >
            {syncingActive ? '同步中…' : selectedProfile === activeProfile ? '已默认' : '设为默认'}
          </Button>
        </Toolbar>
      </section>

      <div className="sidebar-note sidebar-footnote">
        <p>先把常用走通</p>
        <span>总览、实例、配置、技能优先；资料与进阶默认收起。</span>
      </div>
    </aside>
  );
}
