import { useCallback, useEffect, useState } from 'react';

export function useSidebar() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedNavGroups, setCollapsedNavGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('hermespanel_sidebar_collapsed');
      setSidebarCollapsed(stored === '1');
      const groupsStored = window.localStorage.getItem('hermespanel_nav_groups_collapsed');
      if (groupsStored) {
        setCollapsedNavGroups(JSON.parse(groupsStored));
      }
    } catch {
      setSidebarCollapsed(false);
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(current => {
      const next = !current;
      try {
        window.localStorage.setItem('hermespanel_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // noop
      }
      return next;
    });
  }, []);

  const toggleNavGroup = useCallback((groupId: string) => {
    setCollapsedNavGroups(current => {
      const next = { ...current, [groupId]: !current[groupId] };
      try {
        window.localStorage.setItem('hermespanel_nav_groups_collapsed', JSON.stringify(next));
      } catch {
        // noop
      }
      return next;
    });
  }, []);

  return {
    sidebarCollapsed,
    toggleSidebar,
    collapsedNavGroups,
    toggleNavGroup,
  };
}
