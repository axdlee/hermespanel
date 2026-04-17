import { Button, InfoTip, Pill, Toolbar } from './ui';
import type { AppPageKey } from '../pages/types';
import type {
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  ProfilesSnapshot,
} from '../types';
import { PAGE_TITLES, PAGE_META, PAGE_HINTS, NAV_GROUPS } from '../lib/navigation';

interface AppTopbarProps {
  activePage: AppPageKey;
  selectedProfile: string;
  profiles: ProfilesSnapshot | null;
  shellDashboard: DashboardSnapshot | null;
  shellInstallation: InstallationSnapshot | null;
  shellExtensions: ExtensionsSnapshot | null;
  shellBusy: boolean;
  loadingProfiles: boolean;
  onProfileChange: (profile: string) => void;
  onRefreshProfiles: () => void;
  onRefreshShell: () => void;
}

export function AppTopbar({
  activePage,
  selectedProfile,
  profiles,
  shellDashboard,
  shellInstallation,
  shellExtensions,
  shellBusy,
  loadingProfiles,
  onProfileChange,
  onRefreshProfiles,
  onRefreshShell,
}: AppTopbarProps) {
  const activeGroup =
    NAV_GROUPS.find(group => group.items.some(item => item.key === activePage)) ?? NAV_GROUPS[0];
  const activeMeta = PAGE_META[activePage];
  const gatewayTone = shellDashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn';
  const cliTone = shellInstallation?.binaryFound ? 'good' : 'bad';
  const memoryTone = shellDashboard?.config.memoryEnabled ? 'good' : 'warn';

  const routeHint =
    activePage === 'dashboard'
      ? '推荐顺序：总览 → 配置 → 技能 → 通道'
      : activeGroup.id === 'starter'
        ? '先完成当前页，再回总览看下一步'
        : activeGroup.id === 'operations'
          ? '排查顺序：诊断 → 日志 → 通道'
          : '进阶内容按需展开，不影响日常使用';

  return (
    <header className="topbar">
      <div className="topbar-copy">
        <p className="topbar-kicker">
          {activeGroup.eyebrow} · {activeGroup.label}
        </p>
        <div className="topbar-title-row">
          <div>
            <h1>{PAGE_TITLES[activePage]}</h1>
            <p className="topbar-subtitle">{activeMeta.description}</p>
          </div>
          <InfoTip
            content={`当前页聚焦：${PAGE_HINTS[activePage]} 常用入口已前置，更深的资料和进阶能力可从"资料与进阶"继续展开。`}
          />
        </div>
        <div className="topbar-context">
          <Pill tone={cliTone}>CLI {shellInstallation?.binaryFound ? '已接管' : '待安装'}</Pill>
          <Pill tone={gatewayTone}>网关 {shellDashboard?.gateway?.gatewayState ?? 'unknown'}</Pill>
          <Pill tone={memoryTone}>
            记忆 {shellDashboard?.config.memoryEnabled ? '已开启' : '已关闭'}
          </Pill>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="topbar-control-card">
          <div className="profile-switcher">
            <span>实例</span>
            <select
              className="select-input"
              value={selectedProfile}
              onChange={event => onProfileChange(event.target.value)}
              disabled={loadingProfiles || !profiles}
            >
              {(profiles?.profiles ?? []).map(item => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {item.isActive ? ' · 默认' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="profile-meta">
            <strong>当前查看：{selectedProfile}</strong>
            <span>
              {routeHint}
              {profiles ? ` · 共 ${profiles.profiles.length} 个实例` : ''}
              {shellExtensions ? ` · 扩展 ${shellExtensions.plugins.installedCount}` : ''}
            </span>
          </div>
          <Toolbar className="shell-toolbar">
            <Button onClick={() => onRefreshProfiles()} disabled={loadingProfiles}>
              {loadingProfiles ? '刷新中…' : '刷新实例'}
            </Button>
            <Button onClick={() => onRefreshShell()} disabled={shellBusy}>
              {shellBusy ? '同步中…' : '刷新状态'}
            </Button>
          </Toolbar>
        </div>
      </div>
    </header>
  );
}
