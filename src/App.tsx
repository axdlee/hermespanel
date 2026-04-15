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
  id: 'starter' | 'operations' | 'advanced';
  label: string;
  eyebrow: string;
  summary: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  items: Array<{
    key: AppPageKey;
    label: string;
    eyebrow: string;
    description: string;
    badge?: string;
    mark: string;
  }>;
}> = [
  {
    id: 'starter',
    label: '常用工作台',
    eyebrow: '新手先看',
    summary: '把最常用的状态查看、实例切换、配置维护和技能启用放在最前面。',
    items: [
      { key: 'dashboard', label: '总览', eyebrow: 'Overview', description: '先看 Hermes 是否可用、哪里需要处理。', badge: '常用', mark: '总' },
      { key: 'profiles', label: '实例', eyebrow: 'Profiles', description: '切换默认实例，进入对应工作台。', badge: '常用', mark: '例' },
      { key: 'config', label: '配置', eyebrow: 'Config', description: '模型、通道和基础参数都在这里。', badge: '常用', mark: '配' },
      { key: 'skills', label: '技能', eyebrow: 'Skills', description: '安装、整理和编写技能，做能力闭环。', badge: '常用', mark: '技' },
    ],
  },
  {
    id: 'operations',
    label: '运行与排障',
    eyebrow: '运行中用',
    summary: '遇到链路异常、平台问题或状态不一致时，直接在这里闭环定位与修复。',
    items: [
      { key: 'gateway', label: '通道与网关', eyebrow: 'Gateway', description: '平台接入、通道状态和运行控制。', mark: '网' },
      { key: 'diagnostics', label: '诊断与修复', eyebrow: 'Doctor', description: '执行体检、比对运行态并快速回路。', mark: '诊' },
      { key: 'logs', label: '日志与回放', eyebrow: 'Logs', description: '集中查看输出、错误和最近回执。', mark: '志' },
    ],
  },
  {
    id: 'advanced',
    label: '更多能力与资料',
    eyebrow: '按需展开',
    summary: '扩展、记忆、会话和定时任务按需展开，不打扰首次上手，需要时也能随时进入。',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { key: 'extensions', label: '扩展与插件', eyebrow: 'Extensions', description: '管理插件、扩展和能力依赖。', badge: '进阶', mark: '扩' },
      { key: 'memory', label: '记忆与资料', eyebrow: 'Memory', description: '维护记忆文件、Provider 和关联材料。', badge: '进阶', mark: '忆' },
      { key: 'sessions', label: '会话浏览', eyebrow: 'Sessions', description: '查看历史轨迹、链路和上下文。', mark: '会' },
      { key: 'cron', label: '定时任务', eyebrow: 'Scheduler', description: '管理自动投递和计划任务。', mark: '定' },
    ],
  },
];

const PAGE_META = Object.fromEntries(
  NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => [
      item.key,
      {
        ...item,
        groupId: group.id,
        groupLabel: group.label,
        groupEyebrow: group.eyebrow,
        groupSummary: group.summary,
      },
    ]),
  ),
) as Record<AppPageKey, {
  key: AppPageKey;
  label: string;
  eyebrow: string;
  description: string;
  badge?: string;
  mark: string;
  groupId: 'starter' | 'operations' | 'advanced';
  groupLabel: string;
  groupEyebrow: string;
  groupSummary: string;
}>;

const PAGE_TITLES: Record<AppPageKey, string> = {
  config: '配置工作台',
  cron: '定时任务',
  dashboard: 'Hermes 总览',
  diagnostics: '诊断与修复',
  extensions: '扩展与插件',
  gateway: '通道与网关',
  logs: '日志与回放',
  memory: '记忆与资料',
  profiles: '实例工作台',
  sessions: '会话浏览',
  skills: '技能工作台',
};

const PAGE_HINTS: Record<AppPageKey, string> = {
  config: '直接维护模型、Provider、toolsets、env 与关键配置，不必先去终端再回来。',
  cron: '把定时触发、远端投递和周期任务收进同一处，不让自动化散落在外部。',
  dashboard: '先判断 CLI、Gateway、模型与记忆是否形成可用闭环，再决定下一步去哪里。',
  diagnostics: '针对运行异常、能力缺失和链路不一致做结构化体检，并把结果收回当前客户端。',
  extensions: '查看插件、扩展和能力依赖的安装态与运行态，避免“装了但没接上”。',
  gateway: '集中处理平台接入、通道状态、服务控制和相关材料，减少跨页跳转成本。',
  logs: '把错误、输出和关键动作回执集中到一处，方便回放和问题定位。',
  memory: '统一查看记忆文件、Provider 和关联材料，方便核对长期记忆链路。',
  profiles: '面向多实例、多 alias 和差异治理，先选对实例，再进入对应工作台做事。',
  sessions: '回看历史会话轨迹、链路线索和上下文材料，辅助复盘与排障。',
  skills: '围绕技能安装、更新、扫描和本地治理做闭环，不再只停留在读取层。',
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
  const [collapsedNavGroups, setCollapsedNavGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      NAV_GROUPS.filter((group) => group.defaultCollapsed).map((group) => [group.id, true]),
    ),
  );
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
    () => NAV_GROUPS.find((group) => group.items.some((item) => item.key === activePage)) ?? NAV_GROUPS[0],
    [activePage],
  );
  const activeMeta = PAGE_META[activePage];
  const shellBusy = loadingProfiles || loadingShell || refreshingShell;
  const gatewayTone = shellDashboard?.gateway?.gatewayState === 'running' ? 'good' : 'warn';
  const cliTone = shellInstallation?.binaryFound ? 'good' : 'bad';
  const memoryTone = shellDashboard?.config.memoryEnabled ? 'good' : 'warn';
  const pluginCount = shellExtensions?.plugins.installedCount ?? 0;
  const envTone = viewedProfile?.envExists ? 'good' : 'warn';

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

  function toggleNavGroup(groupId: string) {
    setCollapsedNavGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`}>
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
            <strong>先做常用，再按需展开高级功能</strong>
            <p>先从常用工作台开始，遇到问题再进运行与排障，更多能力和资料默认收起，避免第一次就被复杂配置淹没。</p>
          </div>
        ) : null}

        <div className="sidebar-scroller">
          {NAV_GROUPS.map((group) => (
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
              {!collapsedNavGroups[group.id] || group.items.some((item) => item.key === activePage) ? (
                <>
                  <p className="sidebar-section-summary">{group.summary}</p>
                  <nav className="sidebar-nav">
                    {group.items.map((item) => (
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
                          <small>{item.description}</small>
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
                {selectedProfile === activeProfile ? '正在查看默认实例。' : '当前是浏览实例，不会影响默认实例。'}
              </p>
            </div>
            <Pill tone={selectedProfile === activeProfile ? 'good' : 'neutral'}>
              {selectedProfile === activeProfile ? '默认实例' : '浏览中'}
            </Pill>
          </div>
          <div className="sidebar-status-grid">
            <div className="sidebar-status-item">
              <span>模型</span>
              <strong>{viewedProfile?.modelDefault ?? shellDashboard?.config.modelDefault ?? '—'}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>网关</span>
              <strong>{viewedProfile?.gatewayState ?? shellDashboard?.gateway?.gatewayState ?? '—'}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>会话</span>
              <strong>{viewedProfile?.sessionCount ?? shellDashboard?.counts.sessions ?? 0}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>技能</span>
              <strong>{viewedProfile?.skillCount ?? shellDashboard?.counts.skills ?? 0}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>环境</span>
              <strong>{viewedProfile?.envExists ? '已就绪' : '待补齐'}</strong>
            </div>
            <div className="sidebar-status-item">
              <span>插件</span>
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
          <p>常用前置，高级后置</p>
          <span>模型、实例、技能前置展示；扩展、记忆、会话与定时任务收进高级区。</span>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="topbar-kicker">{activeGroup.eyebrow} · {activeGroup.label}</p>
            <div className="topbar-title-row">
              <div>
                <h1>{PAGE_TITLES[activePage]}</h1>
                <p className="topbar-subtitle">{activeMeta.description}</p>
              </div>
              <InfoTip content={`当前页聚焦：${PAGE_HINTS[activePage]} 常用入口已前置，高级能力可从“高级与资料”继续展开。`} />
            </div>
            <div className="topbar-context">
              <Pill tone={cliTone}>CLI {shellInstallation?.binaryFound ? '已接管' : '待安装'}</Pill>
              <Pill tone={gatewayTone}>网关 {shellDashboard?.gateway?.gatewayState ?? 'unknown'}</Pill>
              <Pill tone={memoryTone}>记忆 {shellDashboard?.config.memoryEnabled ? '已开启' : '已关闭'}</Pill>
              <Pill tone={envTone}>环境 {viewedProfile?.envExists ? '已就绪' : '待补齐'}</Pill>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-control-card">
              <div className="profile-switcher">
                <span>实例</span>
                <select
                  className="select-input"
                  value={selectedProfile}
                  onChange={(event) => setSelectedProfile(event.target.value)}
                  disabled={loadingProfiles || !profiles}
                >
                  {(profiles?.profiles ?? []).map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}{item.isActive ? ' · 默认' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="topbar-status">
                <div className="topbar-badge">{activeGroup.label}</div>
                <div className="profile-meta">
                  <strong>默认实例：{activeProfile}</strong>
                  <span>
                    当前查看：{selectedProfile}
                    {profiles ? ` · 共 ${profiles.profiles.length} 个实例` : ''}
                  </span>
                </div>
              </div>
              <div className="profile-meta">
                <strong>{activePage === 'dashboard' ? '推荐入口：总览 → 实例 → 配置 → 技能' : `当前页：${PAGE_TITLES[activePage]}`}</strong>
                <span>{activeGroup.summary}</span>
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
