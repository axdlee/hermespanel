import { useCallback, useState, useMemo } from 'react';

import { LoadingState } from './components/ui';
import { AppSidebar } from './components/AppSidebar';
import { AppTopbar } from './components/AppTopbar';
import { NoticeToast } from './components/NoticeToast';
import { PageErrorBoundary } from './components/ErrorBoundary';
import { useAppShell } from './hooks/useAppShell';
import { useSidebar } from './hooks/useSidebar';
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

function renderPage(
  key: AppPageKey,
  profile: string,
  profiles: ReturnType<typeof useAppShell>['profiles'],
  refreshProfiles: (preferredProfile?: string) => Promise<void>,
  notify: (tone: 'success' | 'error' | 'info', message: string) => void,
  navigate: (page: AppPageKey, intent?: PageIntent | null) => void,
  pageIntent: PageIntent | null,
  consumePageIntent: () => void
) {
  switch (key) {
    case 'profiles':
      return (
        <ProfilesPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'gateway':
      return (
        <GatewayPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'config':
      return (
        <ConfigPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'sessions':
      return (
        <SessionsPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'skills':
      return (
        <SkillsPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'extensions':
      return (
        <ExtensionsPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'cron':
      return (
        <CronPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'logs':
      return (
        <LogsPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'memory':
      return (
        <MemoryPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'diagnostics':
      return (
        <DiagnosticsPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
    case 'dashboard':
    default:
      return (
        <DashboardPage
          notify={notify}
          profile={profile}
          profiles={profiles}
          refreshProfiles={refreshProfiles}
          navigate={navigate}
          pageIntent={pageIntent}
          consumePageIntent={consumePageIntent}
        />
      );
  }
}

export default function App() {
  const [activePage, setActivePage] = useState<AppPageKey>('dashboard');
  const [pageIntent, setPageIntent] = useState<{ target: AppPageKey; payload: PageIntent } | null>(
    null
  );

  const shell = useAppShell();
  const sidebar = useSidebar();

  const navigate = useCallback((page: AppPageKey, intent?: PageIntent | null) => {
    setActivePage(page);
    setPageIntent(intent ? { target: page, payload: intent } : null);
  }, []);

  const consumePageIntent = useCallback(() => {
    setPageIntent(null);
  }, []);

  const handleRefreshShell = useCallback(() => {
    void shell.loadShell(shell.selectedProfile, { silent: true });
  }, [shell]);

  const handleMakeProfileActive = useCallback(() => {
    void shell.makeProfileActive();
  }, [shell]);

  const handleProfileChange = useCallback(
    (profile: string) => {
      shell.setSelectedProfile(profile);
    },
    [shell]
  );

  const handleRefreshProfiles = useCallback(
    (preferredProfile?: string) => {
      return shell.loadProfiles(preferredProfile ?? shell.selectedProfile);
    },
    [shell]
  );

  const viewedProfile = useMemo(() => {
    return shell.profiles?.profiles.find(item => item.name === shell.selectedProfile) ?? null;
  }, [shell.profiles, shell.selectedProfile]);

  return (
    <div className={`app-shell ${sidebar.sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`}>
      <AppSidebar
        activePage={activePage}
        navigate={navigate}
        selectedProfile={shell.selectedProfile}
        activeProfile={shell.activeProfile}
        profiles={shell.profiles}
        shellDashboard={shell.shellDashboard}
        shellInstallation={shell.shellInstallation}
        shellBusy={shell.shellBusy}
        syncingActive={shell.syncingActive}
        viewedProfile={viewedProfile}
        onRefreshShell={handleRefreshShell}
        onMakeProfileActive={handleMakeProfileActive}
        sidebarCollapsed={sidebar.sidebarCollapsed}
        toggleSidebar={sidebar.toggleSidebar}
        collapsedNavGroups={sidebar.collapsedNavGroups}
        toggleNavGroup={sidebar.toggleNavGroup}
      />

      <div className="content-shell">
        <AppTopbar
          activePage={activePage}
          selectedProfile={shell.selectedProfile}
          profiles={shell.profiles}
          shellDashboard={shell.shellDashboard}
          shellInstallation={shell.shellInstallation}
          shellExtensions={shell.shellExtensions}
          shellBusy={shell.shellBusy}
          loadingProfiles={shell.loadingProfiles}
          onProfileChange={handleProfileChange}
          onRefreshProfiles={() => handleRefreshProfiles()}
          onRefreshShell={handleRefreshShell}
        />

        <main className="content-area">
          {shell.loadingProfiles && !shell.profiles ? (
            <LoadingState label="正在同步 Hermes profile 列表。" skeleton />
          ) : (
            <PageErrorBoundary>
              <div key={`${activePage}:${shell.selectedProfile}`}>
                {renderPage(
                  activePage,
                  shell.selectedProfile,
                  shell.profiles,
                  handleRefreshProfiles,
                  shell.notify,
                  navigate,
                  pageIntent?.target === activePage ? pageIntent.payload : null,
                  consumePageIntent
                )}
              </div>
            </PageErrorBoundary>
          )}
        </main>
      </div>

      <NoticeToast notice={shell.notice} onClear={shell.clearNotice} />
    </div>
  );
}
