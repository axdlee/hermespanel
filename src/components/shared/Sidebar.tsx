/**
 * HermesPanel 侧边栏组件
 *
 * Sidebar 设计：
 * - Logo + 品牌
 * - 导航分组
 * - 高级菜单折叠
 * - 底部状态显示
 */

import {
  LayoutDashboard,
  MessageSquare,
  Zap,
  ClipboardList,
  Settings,
  Plug,
  FolderOpen,
  Puzzle,
  Brain,
  Clock,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  Circle,
} from 'lucide-react';
import { useAppStore, useDashboardStore, type AppPageKey } from '@/stores';
import { cn } from '@/lib/utils';

const NAV_GROUPS = [
  {
    label: '核心',
    items: [
      { key: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
      { key: 'chat', label: '对话', icon: MessageSquare },
    ],
  },
  {
    label: '能力',
    items: [
      { key: 'skills', label: '技能', icon: Zap },
      { key: 'sessions', label: '会话', icon: ClipboardList },
    ],
  },
  {
    label: '设置',
    items: [
      { key: 'config', label: '配置', icon: Settings },
      { key: 'gateway', label: '网关', icon: Plug },
    ],
  },
];

const ADVANCED_NAV_ITEMS = [
  { key: 'profiles', label: '实例', icon: FolderOpen },
  { key: 'extensions', label: '扩展', icon: Puzzle },
  { key: 'memory', label: '记忆', icon: Brain },
  { key: 'cron', label: '任务', icon: Clock },
  { key: 'logs', label: '日志', icon: FileText },
  { key: 'diagnostics', label: '诊断', icon: Search },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { activePage, setPage, advancedExpanded, toggleAdvanced } = useAppStore();
  const { snapshot } = useDashboardStore();

  const gatewayState = snapshot?.gateway?.gatewayState;
  const model = snapshot?.config?.modelDefault;
  const isGatewayRunning = gatewayState === 'running';

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-slate-900/5 dark:bg-slate-900/30 backdrop-blur-sm border-r border-border transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* 头部 Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
          <Zap className="w-5 h-5" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-foreground tracking-tight">HermesPanel</span>
        )}
      </div>

      {/* 导航区 */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <div className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
            )}
            {group.items.map(item => (
              <button
                key={item.key}
                onClick={() => setPage(item.key as AppPageKey)}
                className={cn(
                  'flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm transition-colors',
                  activePage === item.key
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  collapsed && 'justify-center px-2'
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="w-5 h-5" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            ))}
          </div>
        ))}

        {/* 高级菜单 */}
        <div className="mb-4">
          {!collapsed && (
            <button
              onClick={toggleAdvanced}
              className="flex items-center justify-between w-full px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              <span>高级</span>
              {advancedExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          {advancedExpanded &&
            ADVANCED_NAV_ITEMS.map(item => (
              <button
                key={item.key}
                onClick={() => setPage(item.key as AppPageKey)}
                className={cn(
                  'flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm transition-colors',
                  activePage === item.key
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  collapsed && 'justify-center px-2',
                  !collapsed && 'ml-2'
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="w-5 h-5" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            ))}
        </div>
      </nav>

      {/* 底部状态 */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <Circle
            className={cn(
              'w-4 h-4',
              isGatewayRunning ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
            )}
          />
          {!collapsed && (
            <span className="text-sm text-muted-foreground truncate">{model || '未配置模型'}</span>
          )}
        </div>
      </div>
    </aside>
  );
}
