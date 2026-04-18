/**
 * HermesPanel 主布局组件
 *
 * MainLayout 设计：
 * - 侧边栏导航
 * - 主内容区
 * - 可折叠侧边栏
 */

import { ReactNode } from 'react';
import { useAppStore } from '@/stores';
import { Sidebar } from './Sidebar';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children: ReactNode;
  sidebar?: boolean;
}

export function MainLayout({ children, sidebar = true }: MainLayoutProps) {
  const sidebarCollapsed = useAppStore(state => state.sidebarCollapsed);

  return (
    <div className="flex h-screen bg-background">
      {sidebar && <Sidebar collapsed={sidebarCollapsed} />}
      <main
        className={cn(
          'flex-1 overflow-auto transition-all duration-300',
          sidebarCollapsed ? 'ml-0' : 'ml-0'
        )}
      >
        {children}
      </main>
    </div>
  );
}
