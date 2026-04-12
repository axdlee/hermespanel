import { useEffect, useMemo, useState } from 'react';

import { Button, InfoTip, LoadingState, Pill, Toolbar } from './components/ui';
import { api } from './lib/api';
import { CronPage } from './pages/CronPage';
import { ConfigPage } from './pages/ConfigPage';
import { DashboardPage } from './pages/DashboardPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { ExtensionsPage } from './pages/ExtensionsPage';
import { GatewayPage } from './pages/GatewayPage';
import { LogsPage } from './pages/LogsPage';
import { MemoryPage } from './pages/MemoryPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { SessionsPage } from './pages/SessionsPage';
import { SkillsPage } from './pages/SkillsPage';
import type { AppPageKey, PageIntent } from './pages/types';
import type {
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  NoticeState,
  NoticeTone,
  ProfilesSnapshot,
} from './types';

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ key: AppPageKey; label: string; eyebrow: string }>;
}> = [
  {
    label: 'Control',
    items: [
      { key: 'dashboard', label: '控制中心', eyebrow: 'Mission Control' },
      { key: 'profiles', label: 'Profile 管理', eyebrow: 'Instances' },
      { key: 'gateway', label: '网关控制', eyebrow: 'Gateway' },
      { key: 'diagnostics', label: '诊断面板', eyebrow: 'Doctor' },
    ],
  },
  {
    label: 'Runtime',
    items: [
      { key: 'config', label: '配置中心', eyebrow: 'Config' },
      { key: 'extensions', label: '扩展能力', eyebrow: 'Extensions' },
      { key: 'skills', label: '技能目录', eyebrow: 'Skills' },
      { key: 'sessions', label: '会话浏览', eyebrow: 'Sessions' },
      { key: 'logs', label: '日志查看', eyebrow: 'Logs' },
    ],
  },
  {
    label: 'Data',
    items: [
      { key: 'memory', label: '记忆编排', eyebrow: 'Memory' },
      { key: 'cron', label: 'Cron 作业', eyebrow: 'Scheduler' },
    ],
  },
];

const PAGE_TITLES: Record<AppPageKey, string> = {
  config: '配置中心',
  cron: 'Cron 作业',
  dashboard: 'Hermes 控制中心',
  diagnostics: '诊断面板',
  extensions: '扩展能力台',
  gateway: '消息网关控制',
  logs: '日志查看',
  memory: '记忆编排台',
  profiles: 'Profile 管理',
  sessions: '会话浏览',
  skills: '技能目录',
};

const PAGE_HINTS: Record<AppPageKey, string> = {
  config: '模型、backend、toolsets、provider',
  cron: '自动化调度与投递',
  dashboard: '安装、运行、修复总控',
  diagnostics: '诊断、核对、修复接力',
  extensions: 'tools、skills、plugins、memory',
  gateway: '部署、安装、服务控制',
  logs: '日志、输出、问题回放',
  memory: '文件、provider、插件、校验',
  profiles: '多实例、alias、差异治理',
  sessions: '会话轨迹与链路判读',
  skills: '技能安装、编排、扫描',
};

function renderPage(
  key: AppPageKey,
  profile: string,
  profiles: ProfilesSnapshot | null,
  refreshProfiles: (preferredProfile?: string) => Promise<void>,
  notify: (tone: NoticeTone, message: string) => void,
  navigate: (page: AppPageKey, intent?: PageIntent | null) => void,
  pageIntent: PageIntent | null,
  consumePageIntent: () => void,
) {
  switch (key) {
    case 'profiles':
      return <ProfilesPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'gateway':
      return <GatewayPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'config':
      return <ConfigPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'sessions':
      return <SessionsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'skills':
      return <SkillsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'extensions':
      return <ExtensionsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'cron':
      return <CronPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'logs':
      return <LogsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'memory':
      return <MemoryPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'diagnostics':
      return <DiagnosticsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
    case 'dashboard':
    default:
      return <DashboardPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} navigate={navigate} pageIntent={pageIntent} consumePageIntent={consumePageIntent} />;
  }
}

export default function App() {
  const [activePage, setActivePage] = useState<AppPageKey>('dashboard');
  const [pageIntent, setPageIntent] = useState<{ target: AppPageKey; payload: PageIntent } | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [profiles, setProfiles] = useState<ProfilesSnapshot | null>(null);
  const [selectedProfile, setSelectedProfile] = useState('default');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [syncingActive, setSyncingActive] = useState(false);
  const [shellDashboard, setShellDashboard] = useState<DashboardSnapshot | null>(null);
  const [shellInstallation, setShellInstallation] = useState<InstallationSnapshot | null>(null);
  const [shellExtensions, setShellExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [refreshingShell, setRefreshingShell] = useState(false);

  function notify(tone: NoticeTone, message: string) {
    setNotice({ tone, message });
  }

  function navigate(page: AppPageKey, intent?: PageIntent | null) {
    setActivePage(page);
    setPageIntent(intent ? { target: page, payload: intent } : null);
  }

  function consumePageIntent() {
    setPageIntent(null);
  }

  async function loadShell(profileName = selectedProfile, options?: { silent?: boolean }) {
    if (options?.silent) {
      setRefreshingShell(true);
    } else {
      setLoadingShell(true);
    }

    try {
      const [dashboard, installation, extensions] = await Promise.all([
        api.getDashboardSnapshot(profileName),
        api.getInstallationSnapshot(profileName),
        api.getExtensionsSnapshot(profileName),
      ]);
      setShellDashboard(dashboard);
      setShellInstallation(installation);
      setShellExtensions(extensions);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoadingShell(false);
      setRefreshingShell(false);
    }
  }

  async function loadProfiles(preferredProfile?: string) {
    setLoadingProfiles(true);
    try {
      const snapshot = await api.getProfilesSnapshot();
      setProfiles(snapshot);
      const preferred = preferredProfile ?? selectedProfile;
      const nextSelected = snapshot.profiles.some((item) => item.name === preferred)
        ? preferred
        : snapshot.profiles.some((item) => item.name === snapshot.activeProfile)
          ? snapshot.activeProfile
          : snapshot.profiles[0]?.name ?? 'default';
      setSelectedProfile(nextSelected);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoadingProfiles(false);
    }
  }

  async function makeProfileActive() {
    setSyncingActive(true);
    try {
      const snapshot = await api.setActiveProfile(selectedProfile);
      setProfiles(snapshot);
      void loadShell(selectedProfile, { silent: true });
      notify('success', `已将 ${selectedProfile} 设为 Hermes 默认 profile。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSyncingActive(false);
    }
  }

  useEffect(() => {
    void loadProfiles();
  }, []);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem('hermespanel_sidebar_collapsed') === '1');
    } catch {
      setSidebarCollapsed(false);
    }
  }, []);

  useEffect(() => {
    if (loadingProfiles || !profiles) {
      return;
    }
    void loadShell(selectedProfile);
  }, [loadingProfiles, profiles, selectedProfile]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeProfile = profiles?.activeProfile ?? 'default';
  const viewedProfile = profiles?.profiles.find((item) => item.name === selectedProfile) ?? null;
  const activeGroup = useMemo(
    () => NAV_GROUPS.find((group) => group.items.some((item) => item.key === activePage))?.label ?? 'Control',
    [activePage],
  );
  const shellBusy = loadingProfiles || loadingShell || refreshingShell;
  const gatewayTone = shellDashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn';
  const cliTone = shellInstallation?.binaryFound ? 'good' : 'bad';
  const memoryTone = shellDashboard?.config.memoryEnabled ? 'good' : 'warn';
  const pluginCount = shellExtensions?.plugins.installedCount ?? 0;

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('hermespanel_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // noop
      }
      return next;
    });
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">HP</span>
          <div>
            <p>HermesPanel</p>
            <span>Native control client</span>
          </div>
          <button type="button" className="sidebar-collapse-btn" onClick={toggleSidebar}>
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>

        <div className="sidebar-scroller">
          {NAV_GROUPS.map((group) => (
            <section className="sidebar-section" key={group.label}>
              <div className="sidebar-section-label">{group.label}</div>
              <nav className="sidebar-nav">
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`nav-item ${activePage === item.key ? 'active' : ''}`}
                    onClick={() => navigate(item.key)}
                  >
                    <span>{item.eyebrow}</span>
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </nav>
            </section>
          ))}
        </div>

        <section className="sidebar-status-card">
          <div className="sidebar-status-head">
            <div>
              <span className="sidebar-section-label">Profile Digest</span>
              <strong className="sidebar-status-name">{selectedProfile}</strong>
            </div>
            <Pill tone={selectedProfile === activeProfile ? 'good' : 'warn'}>
              {selectedProfile === activeProfile ? 'Default' : 'Viewing'}
            </Pill>
          </div>
          <div className="sidebar-status-grid">
            <div className="sidebar-status-item">
              <span>Model</span>
              <strong>{viewedProfile?.modelDefault ?? shellDashboard?.config.modelDefault ?? '—'}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>Gateway</span>
              <strong>{viewedProfile?.gatewayState ?? shellDashboard?.gateway?.gatewayState ?? '—'}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>Sessions</span>
              <strong>{viewedProfile?.sessionCount ?? shellDashboard?.counts.sessions ?? 0}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>Skills</span>
              <strong>{viewedProfile?.skillCount ?? shellDashboard?.counts.skills ?? 0}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>Env</span>
              <strong>{viewedProfile?.envExists ? 'Ready' : 'Missing'}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>Plugins</span>
              <strong>{pluginCount}</strong>
            </div>
          </div>
          <Toolbar className="sidebar-status-toolbar">
            <Button onClick={() => void loadShell(selectedProfile, { silent: true })} disabled={shellBusy}>
              {shellBusy ? '同步中…' : '刷新摘要'}
            </Button>
            <Button
              kind="primary"
              onClick={() => void makeProfileActive()}
              disabled={syncingActive || selectedProfile === activeProfile}
            >
              {syncingActive ? '同步中…' : selectedProfile === activeProfile ? '已默认' : '设为默认'}
            </Button>
          </Toolbar>
        </section>

        <div className="sidebar-note sidebar-footnote">
          <p>0 侵入治理</p>
          <span>只包装 CLI、配置、日志、`state.db` 与 `gateway_state.json`。</span>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">{activeGroup}</p>
            <div className="topbar-title-row">
              <h1>{PAGE_TITLES[activePage]}</h1>
              <InfoTip content={`当前页聚焦：${PAGE_HINTS[activePage]}。说明信息已后置到悬浮提示和状态摘要，避免抢占主要操作区。`} />
            </div>
            <div className="topbar-context">
              <Pill tone={cliTone}>CLI {shellInstallation?.binaryFound ? 'Ready' : 'Missing'}</Pill>
              <Pill tone={gatewayTone}>Gateway {shellDashboard?.gateway?.gatewayState ?? 'unknown'}</Pill>
              <Pill tone={memoryTone}>Memory {shellDashboard?.config.memoryEnabled ? 'On' : 'Off'}</Pill>
              <Pill tone={viewedProfile?.envExists ? 'good' : 'warn'}>Env {viewedProfile?.envExists ? 'Ready' : 'Missing'}</Pill>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="profile-switcher">
              <span>Profile</span>
              <select
                className="select-input"
                value={selectedProfile}
                onChange={(event) => setSelectedProfile(event.target.value)}
                disabled={loadingProfiles || !profiles}
              >
                {(profiles?.profiles ?? []).map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}{item.isActive ? ' · active' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="topbar-status">
              <div className="topbar-badge">Wrapper Client</div>
              <div className="profile-meta">
                <strong>活跃: {activeProfile}</strong>
                <span>查看中: {selectedProfile}</span>
              </div>
              <Toolbar className="shell-toolbar">
                <Button onClick={() => void loadProfiles(selectedProfile)} disabled={loadingProfiles}>
                  {loadingProfiles ? '刷新中…' : '刷新实例'}
                </Button>
                <Button onClick={() => void loadShell(selectedProfile, { silent: true })} disabled={shellBusy}>
                  {shellBusy ? '同步中…' : '刷新状态'}
                </Button>
              </Toolbar>
            </div>
          </div>
        </header>

        <main className="content-area">
          {loadingProfiles && !profiles ? (
            <LoadingState label="正在同步 Hermes profile 列表。" />
          ) : (
            <div key={`${activePage}:${selectedProfile}`}>
              {renderPage(
                activePage,
                selectedProfile,
                profiles,
                loadProfiles,
                notify,
                navigate,
                pageIntent?.target === activePage ? pageIntent.payload : null,
                consumePageIntent,
              )}
            </div>
          )}
        </main>
      </div>

      {notice && (
        <div className={`notice notice-${notice.tone}`}>
          <strong>{notice.tone === 'success' ? '成功' : notice.tone === 'error' ? '错误' : '提示'}</strong>
          <span>{notice.message}</span>
        </div>
      )}
    </div>
  );
}
