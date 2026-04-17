import type { AppPageKey } from '../pages/types';

export const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ key: AppPageKey; label: string; eyebrow: string; icon: string }>;
}> = [
  {
    label: '开始',
    items: [
      { key: 'dashboard', label: '仪表盘', eyebrow: 'Dashboard', icon: 'dashboard' },
      { key: 'profiles', label: '实例', eyebrow: 'Profiles', icon: 'profiles' },
      { key: 'config', label: '配置', eyebrow: 'Config', icon: 'config' },
    ],
  },
  {
    label: '运行',
    items: [
      { key: 'sessions', label: '会话', eyebrow: 'Sessions', icon: 'sessions' },
      { key: 'logs', label: '日志', eyebrow: 'Logs', icon: 'logs' },
      { key: 'diagnostics', label: '诊断', eyebrow: 'Diagnostics', icon: 'diagnostics' },
      { key: 'gateway', label: '网关', eyebrow: 'Gateway', icon: 'gateway' },
      { key: 'cron', label: '自动化', eyebrow: 'Scheduler', icon: 'cron' },
    ],
  },
  {
    label: '能力',
    items: [
      { key: 'skills', label: '技能', eyebrow: 'Skills', icon: 'skills' },
      { key: 'extensions', label: '扩展', eyebrow: 'Extensions', icon: 'extensions' },
      { key: 'memory', label: '记忆', eyebrow: 'Memory', icon: 'memory' },
    ],
  },
];

export const PAGE_TITLES: Record<AppPageKey, string> = {
  config: '配置中心',
  cron: '定时任务',
  dashboard: '仪表盘',
  diagnostics: '系统诊断',
  extensions: '扩展',
  gateway: 'Gateway',
  logs: '日志',
  memory: '记忆',
  profiles: '实例',
  sessions: '会话',
  skills: '技能',
};

export const PAGE_HINTS: Record<AppPageKey, string> = {
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

export const PAGE_ROUTES: Record<AppPageKey, string> = {
  config: '/config',
  cron: '/cron',
  dashboard: '/dashboard',
  diagnostics: '/diagnostics',
  extensions: '/extensions',
  gateway: '/gateway',
  logs: '/logs',
  memory: '/memory',
  profiles: '/profiles',
  sessions: '/sessions',
  skills: '/skills',
};

const ROUTE_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_ROUTES).map(([key, route]) => [route, key as AppPageKey]),
) as Record<string, AppPageKey>;

export function pageFromRoute(route: string): AppPageKey {
  return ROUTE_TO_PAGE[route] ?? 'dashboard';
}

export function routeFromPage(page: AppPageKey): string {
  return PAGE_ROUTES[page] ?? '/dashboard';
}
