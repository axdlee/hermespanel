/**
 * HermesPanel 扩展详情页面
 *
 * 管理 Hermes 扩展：
 * - 工具列表
 * - 插件列表
 * - 启用/禁用操作
 */

import { useState, useEffect } from 'react';
import {
  Puzzle,
  Wrench,
  Plug,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Zap,
} from 'lucide-react';
import { useAppStore, useDashboardStore, toast } from '@/stores';
import { api } from '@/lib/api';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ExtensionsSnapshot } from '@/types';

export function ExtensionsPage() {
  const { loadAll } = useDashboardStore();
  const { setPage } = useAppStore();
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const loadExtensions = async () => {
    setLoading(true);
    try {
      const snapshot = await api.getExtensionsSnapshot();
      setExtensions(snapshot);
    } catch {
      toast.error('加载扩展失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadExtensions();
  }, []);

  const handleToolAction = async (
    action: 'enable' | 'disable',
    platform: string,
    names: string[]
  ) => {
    try {
      await api.runToolAction(action, platform, names);
      toast.success(`${action === 'enable' ? '已启用' : '已禁用'} 工具`);
      loadExtensions();
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handlePluginAction = async (
    action: 'enable' | 'disable' | 'install' | 'remove',
    name: string
  ) => {
    try {
      await api.runPluginAction(action, name);
      toast.success(`插件 ${action} 成功`);
      loadExtensions();
      loadAll();
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const toolPlatforms = extensions?.toolInventory || [];
  const pluginItems = extensions?.plugins?.items || [];

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Puzzle className="w-6 h-6" />
            扩展详情
          </h1>
          <p className="text-muted-foreground mt-1">工具和插件管理</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadExtensions} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          刷新
        </Button>
      </header>

      {/* 工具列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            工具
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : toolPlatforms.length > 0 ? (
            <div className="space-y-4">
              {toolPlatforms.map(platform => (
                <div key={platform.platformKey}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {platform.displayName}
                  </h4>
                  <div className="space-y-2">
                    {platform.items.map(
                      (item: { name: string; enabled: boolean; description: string }) => (
                        <Card
                          key={item.name}
                          className={cn('bg-muted/50', item.enabled && 'border-green-500/30')}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium text-foreground">{item.name}</span>
                                <Badge variant={item.enabled ? 'success' : 'outline'}>
                                  {item.enabled ? '启用' : '禁用'}
                                </Badge>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleToolAction(
                                    item.enabled ? 'disable' : 'enable',
                                    platform.platformKey,
                                    [item.name]
                                  )
                                }
                              >
                                {item.enabled ? (
                                  <ToggleLeft className="w-4 h-4" />
                                ) : (
                                  <ToggleRight className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {item.description}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Wrench className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">暂无工具</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 插件列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5" />
            插件
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pluginItems.length > 0 ? (
            <div className="space-y-2">
              {pluginItems.map((pluginName: string) => (
                <Card key={pluginName} className="bg-muted/50">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Plug className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">{pluginName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm">
                          <ToggleLeft className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePluginAction('remove', pluginName)}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Plug className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">暂无插件</p>
              <Button variant="outline" className="mt-4" onClick={() => setPage('skills')}>
                <Zap className="w-4 h-4 mr-2" />
                安装技能
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
