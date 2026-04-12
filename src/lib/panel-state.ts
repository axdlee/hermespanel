import { api } from './api';
import { pageFromRoute, routeFromPage } from './panel-config';
import { showToast } from '../components/toast';
import type { AppPageKey, PageIntent } from '../pages/types';
import type {
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  NoticeTone,
  ProfilesSnapshot,
} from '../types';

type PanelListener = () => void;

interface PendingIntent {
  target: AppPageKey;
  payload: PageIntent;
}

interface PanelState {
  activePage: AppPageKey;
  loadingProfiles: boolean;
  loadingShell: boolean;
  notice: null;
  pageIntent: PendingIntent | null;
  profiles: ProfilesSnapshot | null;
  refreshingShell: boolean;
  selectedProfile: string;
  shellDashboard: DashboardSnapshot | null;
  shellExtensions: ExtensionsSnapshot | null;
  shellInstallation: InstallationSnapshot | null;
  sidebarCollapsed: boolean;
  syncingActive: boolean;
}

const listeners = new Set<PanelListener>();
const state: PanelState = {
  activePage: 'dashboard',
  loadingProfiles: true,
  loadingShell: true,
  notice: null,
  pageIntent: null,
  profiles: null,
  refreshingShell: false,
  selectedProfile: 'default',
  shellDashboard: null,
  shellExtensions: null,
  shellInstallation: null,
  sidebarCollapsed: false,
  syncingActive: false,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function preferredProfileName(snapshot: ProfilesSnapshot, preferred?: string) {
  if (preferred && snapshot.profiles.some((item) => item.name === preferred)) {
    return preferred;
  }
  if (snapshot.profiles.some((item) => item.name === snapshot.activeProfile)) {
    return snapshot.activeProfile;
  }
  return snapshot.profiles[0]?.name ?? 'default';
}

export function subscribePanelState(listener: PanelListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPanelState() {
  return { ...state };
}

export function notify(tone: NoticeTone, message: string) {
  showToast({ tone, message });
}

export async function loadShell(profileName = state.selectedProfile, options?: { silent?: boolean }) {
  if (options?.silent) {
    state.refreshingShell = true;
  } else {
    state.loadingShell = true;
  }
  emit();

  try {
    const [dashboard, installation, extensions] = await Promise.all([
      api.getDashboardSnapshot(profileName),
      api.getInstallationSnapshot(profileName),
      api.getExtensionsSnapshot(profileName),
    ]);
    state.shellDashboard = dashboard;
    state.shellInstallation = installation;
    state.shellExtensions = extensions;
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    state.loadingShell = false;
    state.refreshingShell = false;
    emit();
  }
}

export async function loadProfiles(preferredProfile?: string) {
  state.loadingProfiles = true;
  emit();

  try {
    const snapshot = await api.getProfilesSnapshot();
    state.profiles = snapshot;
    state.selectedProfile = preferredProfileName(snapshot, preferredProfile ?? state.selectedProfile);
    emit();
    await loadShell(state.selectedProfile, { silent: true });
    return snapshot;
  } catch (reason) {
    notify('error', String(reason));
    return null;
  } finally {
    state.loadingProfiles = false;
    emit();
  }
}

export async function setSelectedProfile(profileName: string) {
  if (state.selectedProfile === profileName) {
    return;
  }

  state.selectedProfile = profileName;
  emit();
  await loadShell(profileName, { silent: true });
}

export async function makeSelectedProfileActive() {
  if (!state.selectedProfile || state.selectedProfile === (state.profiles?.activeProfile ?? 'default')) {
    return;
  }

  state.syncingActive = true;
  emit();

  try {
    const snapshot = await api.setActiveProfile(state.selectedProfile);
    state.profiles = snapshot;
    notify('success', `已将 ${state.selectedProfile} 设为 Hermes 默认 profile。`);
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    state.syncingActive = false;
    emit();
  }
}

export function initializePanelState() {
  try {
    state.sidebarCollapsed = window.localStorage.getItem('hermespanel_sidebar_collapsed') === '1';
  } catch {
    state.sidebarCollapsed = false;
  }
  emit();
  return loadProfiles();
}

export function setSidebarCollapsed(next: boolean) {
  state.sidebarCollapsed = next;
  try {
    window.localStorage.setItem('hermespanel_sidebar_collapsed', next ? '1' : '0');
  } catch {
    // noop
  }
  emit();
}

export function toggleSidebar() {
  setSidebarCollapsed(!state.sidebarCollapsed);
}

export function syncRoute(route: string) {
  state.activePage = pageFromRoute(route);
  emit();
}

export function navigate(page: AppPageKey, intent?: PageIntent | null) {
  state.activePage = page;
  state.pageIntent = intent ? { target: page, payload: intent } : null;
  emit();

  const nextRoute = routeFromPage(page);
  if (window.location.hash.slice(1) === nextRoute) {
    return;
  }
  window.location.hash = nextRoute;
}

export function getPageIntent(target: AppPageKey) {
  return state.pageIntent?.target === target ? state.pageIntent.payload : null;
}

export function consumePageIntent() {
  state.pageIntent = null;
  emit();
}
