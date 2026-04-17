import { useMemo } from 'react';
import type { AppPageKey } from '../pages/types';

export interface NavGroup {
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
}

export interface PageMeta {
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
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'starter',
    label: '开始使用',
    eyebrow: '先做这几步',
    summary: '先看总览，再处理实例、配置和技能，这一组就是日常最高频入口。',
    items: [
      {
        key: 'dashboard',
        label: '总览',
        eyebrow: 'Overview',
        description: '先看 Hermes 是否可用、哪里需要处理。',
        badge: '常用',
        mark: '总',
      },
      {
        key: 'profiles',
        label: '实例',
        eyebrow: 'Profiles',
        description: '切换默认实例，进入对应工作台。',
        badge: '常用',
        mark: '例',
      },
      {
        key: 'config',
        label: '配置',
        eyebrow: 'Config',
        description: '模型、通道和基础参数都在这里。',
        badge: '常用',
        mark: '配',
      },
      {
        key: 'skills',
        label: '技能',
        eyebrow: 'Skills',
        description: '安装、整理和编写技能，做能力闭环。',
        badge: '常用',
        mark: '技',
      },
    ],
  },
  {
    id: 'operations',
    label: '排查与恢复',
    eyebrow: '有问题再来',
    summary: '当链路异常、状态不一致或平台接入失败时，再来这里集中排查。',
    items: [
      {
        key: 'gateway',
        label: '通道与网关',
        eyebrow: 'Gateway',
        description: '平台接入、通道状态和运行控制。',
        mark: '网',
      },
      {
        key: 'diagnostics',
        label: '诊断与修复',
        eyebrow: 'Doctor',
        description: '执行体检、比对运行态并快速回路。',
        mark: '诊',
      },
      {
        key: 'logs',
        label: '日志与回放',
        eyebrow: 'Logs',
        description: '集中查看输出、错误和最近回执。',
        mark: '志',
      },
    ],
  },
  {
    id: 'advanced',
    label: '资料与进阶',
    eyebrow: '需要时再开',
    summary: '扩展、记忆、会话和定时任务都收在这里，不打扰第一次使用，需要时再打开。',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      {
        key: 'extensions',
        label: '扩展与插件',
        eyebrow: 'Extensions',
        description: '管理插件、扩展和能力依赖。',
        badge: '进阶',
        mark: '扩',
      },
      {
        key: 'memory',
        label: '记忆与资料',
        eyebrow: 'Memory',
        description: '维护记忆文件、Provider 和关联材料。',
        badge: '进阶',
        mark: '忆',
      },
      {
        key: 'sessions',
        label: '会话浏览',
        eyebrow: 'Sessions',
        description: '查看历史轨迹、链路和上下文。',
        mark: '会',
      },
      {
        key: 'cron',
        label: '定时任务',
        eyebrow: 'Scheduler',
        description: '管理自动投递和计划任务。',
        mark: '定',
      },
    ],
  },
];

export const PAGE_META: Record<AppPageKey, PageMeta> = Object.fromEntries(
  NAV_GROUPS.flatMap(group =>
    group.items.map(item => [
      item.key,
      {
        ...item,
        groupId: group.id,
        groupLabel: group.label,
        groupEyebrow: group.eyebrow,
        groupSummary: group.summary,
      },
    ])
  )
) as Record<AppPageKey, PageMeta>;

export const PAGE_TITLES: Record<AppPageKey, string> = {
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

export const PAGE_HINTS: Record<AppPageKey, string> = {
  config: '直接维护模型、Provider、toolsets、env 与关键配置，不必先去终端再回来。',
  cron: '把定时触发、远端投递和周期任务收进同一处，不让自动化散落在外部。',
  dashboard: '先判断 CLI、Gateway、模型与记忆是否形成可用闭环，再决定下一步去哪里。',
  diagnostics: '针对运行异常、能力缺失和链路不一致做结构化体检，并把结果收回当前客户端。',
  extensions: '查看插件、扩展和能力依赖的安装态与运行态，避免"装了但没接上"。',
  gateway: '集中处理平台接入、通道状态、服务控制和相关材料，减少跨页跳转成本。',
  logs: '把错误、输出和关键动作回执集中到一处，方便回放和问题定位。',
  memory: '统一查看记忆文件、Provider 和关联材料，方便核对长期记忆链路。',
  profiles: '面向多实例、多 alias 和差异治理，先选对实例，再进入对应工作台做事。',
  sessions: '回看历史会话轨迹、链路线索和上下文材料，辅助复盘与排障。',
  skills: '围绕技能安装、更新、扫描和本地治理做闭环，不再只停留在读取层。',
};

export function useNavigation(activePage: AppPageKey) {
  const activeGroup = useMemo(
    () =>
      NAV_GROUPS.find(group => group.items.some(item => item.key === activePage)) ?? NAV_GROUPS[0],
    [activePage]
  );

  const activeMeta = PAGE_META[activePage];
  const activeTitle = PAGE_TITLES[activePage];
  const activeHint = PAGE_HINTS[activePage];

  return {
    activeGroup,
    activeMeta,
    activeTitle,
    activeHint,
    navGroups: NAV_GROUPS,
    pageMeta: PAGE_META,
    pageTitles: PAGE_TITLES,
    pageHints: PAGE_HINTS,
  };
}
