import type { AppPageKey } from '../pages/types';

export const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ key: AppPageKey; label: string; eyebrow: string; icon: string }>;
}> = [
  {
    label: '概览',
    items: [
      { key: 'dashboard', label: '仪表盘', eyebrow: 'Dashboard', icon: 'dashboard' },
      { key: 'profiles', label: '实例管理', eyebrow: 'Profiles', icon: 'profiles' },
      { key: 'gateway', label: 'Gateway', eyebrow: 'Gateway', icon: 'gateway' },
      { key: 'diagnostics', label: '系统诊断', eyebrow: 'Diagnostics', icon: 'diagnostics' },
    ],
  },
  {
    label: '配置',
    items: [
      { key: 'config', label: '配置中心', eyebrow: 'Config', icon: 'config' },
      { key: 'extensions', label: '扩展工具', eyebrow: 'Extensions', icon: 'extensions' },
      { key: 'skills', label: '技能工作台', eyebrow: 'Skills', icon: 'skills' },
      { key: 'sessions', label: '会话浏览', eyebrow: 'Sessions', icon: 'sessions' },
      { key: 'logs', label: '日志查看', eyebrow: 'Logs', icon: 'logs' },
    ],
  },
  {
    label: '数据',
    items: [
      { key: 'memory', label: '记忆文件', eyebrow: 'Memory', icon: 'memory' },
      { key: 'cron', label: '定时任务', eyebrow: 'Scheduler', icon: 'cron' },
    ],
  },
];

export const PAGE_TITLES: Record<AppPageKey, string> = {
  config: '配置中心',
  cron: '定时任务',
  dashboard: '仪表盘',
  diagnostics: '系统诊断',
  extensions: '扩展工具',
  gateway: 'Gateway',
  logs: '日志查看',
  memory: '记忆文件',
  profiles: '实例管理',
  sessions: '会话浏览',
  skills: '技能工作台',
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
