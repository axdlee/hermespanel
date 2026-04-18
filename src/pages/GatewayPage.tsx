/**
 * HermesPanel 网关管理页面
 *
 * Gateway 设计：
 * - Gateway 状态监控
 * - 启动/停止控制
 * - 平台状态展示
 */

import { useState, useEffect } from 'react';
import {
  Plug,
  Circle,
  Play,
  Square,
  RotateCw,
  RefreshCw,
  Settings,
  FileText,
  Wrench,
  Search,
  Terminal,
  Loader2,
} from 'lucide-react';
import { useAppStore, useDashboardStore, toast } from '@/stores';
import { api } from '@/lib/api';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

const PLATFORMS = [
  { key: 'feishu', label: '飞书' },
  { key: 'wecom', label: '企微' },
  { key: 'dingtalk', label: '钉钉' },
  { key: 'qqbot', label: 'QQ' },
  { key: 'wechat', label: '微信' },
];

export function GatewayPage() {
  const { snapshot, refreshing, refresh, startPolling, stopPolling } = useDashboardStore();
  const { setPage } = useAppStore();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    startPolling(5000);
    return () => stopPolling();
  }, [refresh, startPolling, stopPolling]);

  const gatewayState = snapshot?.gateway?.gatewayState;
  const platforms = snapshot?.gateway?.platforms || [];
  const isRunning = gatewayState === 'running';
  const isStopped = gatewayState === 'stopped' || !gatewayState;

  const handleGatewayAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action);
    try {
      await api.runGatewayAction(action);
      toast.success(`Gateway ${action} 成功`);
      setTimeout(() => refresh(), 1000);
    } catch (err) {
      toast.error(`${action} 失败: ${err}`);
    }
    setActionLoading(null);
  };

  const handleDiagnose = async () => {
    setActionLoading('diagnose');
    try {
      const result = await api.runDiagnostic('doctor');
      if (result.success) {
        toast.success('诊断完成，系统正常');
      } else {
        toast.warning('诊断发现问题，请查看日志');
      }
    } catch (err) {
      toast.error(`诊断失败: ${err}`);
    }
    setActionLoading(null);
  };

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Plug className="w-6 h-6" />
            网关管理
          </h1>
          <p className="text-muted-foreground mt-1">{isRunning ? '运行中' : '已停止'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing}>
          <RefreshCw className={cn('w-4 h-4 mr-2', refreshing && 'animate-spin')} />
          刷新
        </Button>
      </header>

      {/* Gateway 状态卡片 */}
      <Card className={cn('border-l-4', isRunning ? 'border-l-green-500' : 'border-l-red-500')}>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Circle
              className={cn(
                'w-6 h-6',
                isRunning ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
              )}
            />
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Gateway {isRunning ? '运行中' : '已停止'}
              </h2>
              <Badge variant={isRunning ? 'success' : 'error'} className="mt-1">
                {gatewayState || '未知'}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            {isStopped && (
              <Button onClick={() => handleGatewayAction('start')} disabled={!!actionLoading}>
                {actionLoading === 'start' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    启动中...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    启动 Gateway
                  </>
                )}
              </Button>
            )}
            {isRunning && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => handleGatewayAction('stop')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'stop' ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      停止中...
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4 mr-2" />
                      停止
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleGatewayAction('restart')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'restart' ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      重启中...
                    </>
                  ) : (
                    <>
                      <RotateCw className="w-4 h-4 mr-2" />
                      重启
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 平台状态 */}
      <Card>
        <CardHeader>
          <CardTitle>消息渠道</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {PLATFORMS.map(({ key, label }) => {
              const platform = platforms.find(p => p.name === key);
              const isConnected = platform?.state === 'connected';
              return (
                <Card
                  key={key}
                  className={cn(isConnected ? 'border-green-500/30' : 'border-border')}
                >
                  <CardContent className="p-3 text-center">
                    <p className="font-medium text-foreground">{label}</p>
                    <Badge variant={isConnected ? 'success' : 'outline'} className="mt-2">
                      {isConnected ? '已连接' : '未配置'}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Button
            variant="outline"
            onClick={() =>
              api.openInTerminal({ command: 'hermes gateway', workingDirectory: null })
            }
          >
            <Terminal className="w-4 h-4 mr-2" />
            在终端配置渠道
          </Button>
        </CardContent>
      </Card>

      {/* 诊断工具 */}
      <Card>
        <CardHeader>
          <CardTitle>诊断工具</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            运行诊断可以检查系统配置是否正确，发现潜在问题。
          </p>
          <Button
            variant="outline"
            onClick={handleDiagnose}
            disabled={actionLoading === 'diagnose'}
          >
            {actionLoading === 'diagnose' ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                诊断中...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                运行诊断
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 快捷操作 */}
      <div className="grid grid-cols-3 gap-4">
        <Button variant="outline" className="h-12" onClick={() => setPage('config')}>
          <Settings className="w-4 h-4 mr-2" />
          配置设置
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('logs')}>
          <FileText className="w-4 h-4 mr-2" />
          查看日志
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('diagnostics')}>
          <Wrench className="w-4 h-4 mr-2" />
          系统诊断
        </Button>
      </div>
    </div>
  );
}
