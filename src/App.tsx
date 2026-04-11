import { useEffect, useState } from 'react';

import { LoadingState } from './components/ui';
import { api } from './lib/api';
import { CronPage } from './pages/CronPage';
import { ConfigPage } from './pages/ConfigPage';
import { DashboardPage } from './pages/DashboardPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { GatewayPage } from './pages/GatewayPage';
import { LogsPage } from './pages/LogsPage';
import { MemoryPage } from './pages/MemoryPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { SessionsPage } from './pages/SessionsPage';
import { SkillsPage } from './pages/SkillsPage';
import type { NoticeState, NoticeTone, ProfilesSnapshot } from './types';

type PageKey =
  | 'dashboard'
  | 'profiles'
  | 'gateway'
  | 'config'
  | 'sessions'
  | 'skills'
  | 'cron'
  | 'logs'
  | 'memory'
  | 'diagnostics';

const NAV_ITEMS: Array<{ key: PageKey; label: string; eyebrow: string }> = [
  { key: 'dashboard', label: '仪表盘', eyebrow: 'Overview' },
  { key: 'profiles', label: 'Profile 管理', eyebrow: 'Instances' },
  { key: 'gateway', label: '网关控制', eyebrow: 'Gateway' },
  { key: 'config', label: '配置中心', eyebrow: 'Config' },
  { key: 'sessions', label: '会话浏览', eyebrow: 'Sessions' },
  { key: 'skills', label: '技能目录', eyebrow: 'Skills' },
  { key: 'cron', label: 'Cron 作业', eyebrow: 'Scheduler' },
  { key: 'logs', label: '日志查看', eyebrow: 'Logs' },
  { key: 'memory', label: '记忆文件', eyebrow: 'Memory' },
  { key: 'diagnostics', label: '诊断面板', eyebrow: 'Doctor' },
];

const PAGE_TITLES: Record<PageKey, string> = {
  config: '配置中心',
  cron: 'Cron 作业',
  dashboard: 'HermesPanel',
  diagnostics: '诊断面板',
  gateway: '消息网关控制',
  logs: '日志查看',
  memory: '记忆文件',
  profiles: 'Profile 管理',
  sessions: '会话浏览',
  skills: '技能目录',
};

function renderPage(
  key: PageKey,
  profile: string,
  profiles: ProfilesSnapshot | null,
  refreshProfiles: (preferredProfile?: string) => Promise<void>,
  notify: (tone: NoticeTone, message: string) => void,
) {
  switch (key) {
    case 'profiles':
      return <ProfilesPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'gateway':
      return <GatewayPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'config':
      return <ConfigPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'sessions':
      return <SessionsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'skills':
      return <SkillsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'cron':
      return <CronPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'logs':
      return <LogsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'memory':
      return <MemoryPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'diagnostics':
      return <DiagnosticsPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
    case 'dashboard':
    default:
      return <DashboardPage notify={notify} profile={profile} profiles={profiles} refreshProfiles={refreshProfiles} />;
  }
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [profiles, setProfiles] = useState<ProfilesSnapshot | null>(null);
  const [selectedProfile, setSelectedProfile] = useState('default');
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [syncingActive, setSyncingActive] = useState(false);

  function notify(tone: NoticeTone, message: string) {
    setNotice({ tone, message });
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
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeProfile = profiles?.activeProfile ?? 'default';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">HP</span>
          <div>
            <p>HermesPanel</p>
            <span>Native desktop client</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${activePage === item.key ? 'active' : ''}`}
              onClick={() => setActivePage(item.key)}
            >
              <span>{item.eyebrow}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <p>0 侵入包装</p>
          <span>只读取 `~/.hermes` 与调用 `hermes` CLI，不修改 Hermes Agent 源码。</span>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Hermes Desktop Console</p>
            <h1>{PAGE_TITLES[activePage]}</h1>
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
              <button
                type="button"
                className="topbar-link"
                onClick={() => void loadProfiles(selectedProfile)}
                disabled={loadingProfiles}
              >
                刷新列表
              </button>
            </div>
            <div className="topbar-status">
              <div className="topbar-badge">Client Wrapper</div>
              <div className="profile-meta">
                <strong>活跃: {activeProfile}</strong>
                <span>查看中: {selectedProfile}</span>
              </div>
              <button
                type="button"
                className="topbar-link"
                onClick={() => void makeProfileActive()}
                disabled={syncingActive || selectedProfile === activeProfile}
              >
                {syncingActive ? '同步中…' : selectedProfile === activeProfile ? '已是默认' : '设为默认'}
              </button>
            </div>
          </div>
        </header>

        <main className="content-area">
          {loadingProfiles && !profiles ? (
            <LoadingState label="正在同步 Hermes profile 列表。" />
          ) : (
            <div key={`${activePage}:${selectedProfile}`}>
              {renderPage(activePage, selectedProfile, profiles, loadProfiles, notify)}
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
