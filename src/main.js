window._jsLoaded = true;

import './styles.css';

import { renderSidebar } from './components/sidebar.js';
import { renderTopbar } from './components/topbar.js';
import { SessionsPage } from './pages/SessionsPage';
import { createLegacyRoute } from './lib/create-legacy-route';
import {
  getPanelState,
  initializePanelState,
  subscribePanelState,
  syncRoute,
} from './lib/panel-state';
import { getCurrentRoute, initRouter, registerRoute, setDefaultRoute } from './router.js';

function registerLegacyRoutes() {
  registerRoute('/sessions', createLegacyRoute(SessionsPage, 'sessions'));
}

function registerNativeRoutes() {
  registerRoute('/dashboard', () => import('./pages/dashboard.js'));
  registerRoute('/profiles', () => import('./pages/profiles.js'));
  registerRoute('/gateway', () => import('./pages/gateway.js'));
  registerRoute('/config', () => import('./pages/config.js'));
  registerRoute('/skills', () => import('./pages/skills.js'));
  registerRoute('/extensions', () => import('./pages/extensions.js'));
  registerRoute('/logs', () => import('./pages/logs.js'));
  registerRoute('/memory', () => import('./pages/memory.js'));
  registerRoute('/diagnostics', () => import('./pages/diagnostics.js'));
  registerRoute('/cron', () => import('./pages/cron.js'));
}

function createShell(root) {
  root.innerHTML = `
    <div class="app-shell" id="app-shell">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="content-shell">
        <header class="topbar" id="topbar"></header>
        <main class="content-area" id="content">
          <div class="empty-state">
            <strong>启动中</strong>
            <p>正在同步 Hermes 运行态与本地管理壳层。</p>
          </div>
        </main>
      </div>
    </div>
  `;

  return {
    content: root.querySelector('#content'),
    shell: root.querySelector('#app-shell'),
    sidebar: root.querySelector('#sidebar'),
    topbar: root.querySelector('#topbar'),
  };
}

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('HermesPanel 根节点不存在');
  }

  const { shell, sidebar, topbar, content } = createShell(root);
  if (!shell || !sidebar || !topbar || !content) {
    throw new Error('HermesPanel 壳层挂载失败');
  }

  const renderChrome = () => {
    const state = getPanelState();
    shell.className = `app-shell ${state.sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`;
    renderSidebar(sidebar);
    renderTopbar(topbar);
  };

  subscribePanelState(renderChrome);

  const syncActiveRoute = () => {
    syncRoute(getCurrentRoute().split('?')[0]);
  };

  setDefaultRoute('/dashboard');
  registerNativeRoutes();
  registerLegacyRoutes();
  renderChrome();
  syncActiveRoute();
  window.addEventListener('hashchange', syncActiveRoute);

  await initializePanelState();
  await initRouter(content);
  renderChrome();
}

void bootstrap();
