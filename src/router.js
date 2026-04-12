const routes = {};
let contentEl = null;
let currentCleanup = null;
let initialized = false;
let defaultRoute = '/dashboard';
let loadId = 0;

export function registerRoute(path, loader) {
  routes[path] = loader;
}

export function setDefaultRoute(path) {
  defaultRoute = path;
}

export function getCurrentRoute() {
  return window.location.hash.slice(1) || defaultRoute;
}

export function navigateHash(path) {
  window.location.hash = path;
}

export async function initRouter(host) {
  contentEl = host;
  if (!initialized) {
    window.addEventListener('hashchange', () => {
      void loadRoute();
    });
    initialized = true;
  }
  await loadRoute();
}

export async function reloadCurrentRoute() {
  await loadRoute();
}

async function loadRoute() {
  if (!contentEl) {
    return;
  }

  const routePath = getCurrentRoute().split('?')[0];
  const loader = routes[routePath] ?? routes[defaultRoute];
  if (!loader) {
    return;
  }

  const currentLoadId = ++loadId;

  if (currentCleanup) {
    try {
      currentCleanup();
    } catch {
      // noop
    }
    currentCleanup = null;
  }

  contentEl.innerHTML = `
    <div class="empty-state">
      <strong>加载中</strong>
      <p>正在装载页面内容。</p>
    </div>
  `;

  try {
    const mod = await loader();
    if (currentLoadId !== loadId) {
      return;
    }

    const renderResult = mod.render ? await mod.render() : mod.default ? await mod.default() : mod;
    if (currentLoadId !== loadId) {
      return;
    }

    contentEl.innerHTML = '';
    if (typeof renderResult === 'string') {
      contentEl.innerHTML = renderResult;
    } else if (renderResult instanceof HTMLElement) {
      contentEl.appendChild(renderResult);
    }

    currentCleanup = typeof mod.cleanup === 'function' ? mod.cleanup : null;
  } catch (reason) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <strong>页面加载失败</strong>
        <p>${String(reason)}</p>
      </div>
    `;
  }
}
