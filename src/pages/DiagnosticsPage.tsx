/**
 * HermesPanel 系统诊断页面
 *
 * 运行系统诊断：
 * - doctor 诊断
 * - 显示诊断结果
 * - 提供修复建议
 */

import { useState } from 'react';
import {
  Search,
  RefreshCw,
  Wrench,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Circle,
} from 'lucide-react';
import { useDashboardStore, toast } from '@/stores';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { CommandRunResult } from '@/types';
import type { DiagnosticKind } from '@/lib/diagnostics';

const DIAGNOSTIC_TYPES = [
  { key: 'doctor', label: '全面诊断', desc: '检查所有系统组件' },
  { key: 'gateway-status', label: 'Gateway 诊断', desc: '检查网关状态' },
  { key: 'config-check', label: '配置诊断', desc: '检查配置文件' },
];

export function DiagnosticsPage() {
  const { snapshot, installation, loadAll } = useDashboardStore();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<CommandRunResult | null>(null);
  const [diagnosticHistory, setDiagnosticHistory] = useState<
    Array<{ type: string; time: string; result: CommandRunResult }>
  >([]);

  const handleRunDiagnostic = async (type: string) => {
    setRunning(type);
    try {
      const res = await api.runDiagnostic(type as DiagnosticKind);
      setResult(res);
      setDiagnosticHistory(prev => [
        ...prev,
        { type, time: new Date().toLocaleString(), result: res },
      ]);
      if (res.success) {
        toast.success('诊断完成');
      } else {
        toast.warning('发现问题，请查看详情');
      }
      loadAll();
    } catch (err) {
      toast.error(`诊断失败: ${err}`);
    }
    setRunning(null);
  };

  const handleOpenTerminal = async () => {
    try {
      await api.openInTerminal({ command: 'hermes doctor', workingDirectory: null });
      toast.success('已打开终端');
    } catch (err) {
      toast.error(`打开失败: ${err}`);
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Search className="w-6 h-6" />
            系统诊断
          </h1>
          <p className="text-muted-foreground mt-1">检查系统健康状态</p>
        </div>
        <Button onClick={() => handleRunDiagnostic('doctor')} disabled={!!running}>
          {running ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              诊断中...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              全面诊断
            </>
          )}
        </Button>
      </header>

      {/* 当前状态 */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">系统状态概览</h3>
          <div className="grid grid-cols-4 gap-4">
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-center">
                <Circle
                  className={cn(
                    'w-4 h-4 mx-auto mb-2',
                    snapshot?.gateway?.gatewayState === 'running'
                      ? 'fill-green-500 text-green-500'
                      : 'fill-red-500 text-red-500'
                  )}
                />
                <p className="text-sm font-medium text-foreground">Gateway</p>
                <Badge
                  variant={snapshot?.gateway?.gatewayState === 'running' ? 'success' : 'error'}
                  className="mt-1"
                >
                  {snapshot?.gateway?.gatewayState || '未知'}
                </Badge>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-center">
                <Circle
                  className={cn(
                    'w-4 h-4 mx-auto mb-2',
                    snapshot?.config?.modelDefault
                      ? 'fill-green-500 text-green-500'
                      : 'fill-red-500 text-red-500'
                  )}
                />
                <p className="text-sm font-medium text-foreground">模型</p>
                <Badge
                  variant={snapshot?.config?.modelDefault ? 'success' : 'error'}
                  className="mt-1"
                >
                  {snapshot?.config?.modelDefault || '未配置'}
                </Badge>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-center">
                <Circle
                  className={cn(
                    'w-4 h-4 mx-auto mb-2',
                    (snapshot?.counts?.skills || 0) > 0
                      ? 'fill-green-500 text-green-500'
                      : 'fill-red-500 text-red-500'
                  )}
                />
                <p className="text-sm font-medium text-foreground">技能</p>
                <Badge
                  variant={(snapshot?.counts?.skills || 0) > 0 ? 'success' : 'error'}
                  className="mt-1"
                >
                  {snapshot?.counts?.skills || 0} 个
                </Badge>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-center">
                <Circle
                  className={cn(
                    'w-4 h-4 mx-auto mb-2',
                    installation?.binaryFound
                      ? 'fill-green-500 text-green-500'
                      : 'fill-red-500 text-red-500'
                  )}
                />
                <p className="text-sm font-medium text-foreground">Hermes</p>
                <Badge variant={installation?.binaryFound ? 'success' : 'error'} className="mt-1">
                  {installation?.binaryFound ? '已安装' : '未安装'}
                </Badge>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* 诊断选项 */}
      <div className="grid grid-cols-3 gap-4">
        {DIAGNOSTIC_TYPES.map(type => (
          <Card key={type.key} className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-4 text-center">
              <Wrench className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <h4 className="font-medium text-foreground">{type.label}</h4>
              <p className="text-sm text-muted-foreground mt-1">{type.desc}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => handleRunDiagnostic(type.key)}
                disabled={!!running}
              >
                {running === type.key ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    运行中...
                  </>
                ) : (
                  '运行'
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 诊断结果 */}
      {result && (
        <Card
          className={cn('border-l-4', result.success ? 'border-l-green-500' : 'border-l-red-500')}
        >
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              {result.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              <h3 className="font-medium text-foreground">
                {result.success ? '系统正常' : '发现问题'}
              </h3>
            </div>
            {result.stdout && (
              <pre className="bg-muted p-3 rounded-lg text-sm text-muted-foreground overflow-auto max-h-48">
                {result.stdout}
              </pre>
            )}
            {result.stderr && (
              <pre className="bg-red-500/10 p-3 rounded-lg text-sm text-red-500 mt-2 overflow-auto max-h-48">
                {result.stderr}
              </pre>
            )}
            {!result.success && (
              <Button variant="outline" className="mt-4" onClick={handleOpenTerminal}>
                <Terminal className="w-4 h-4 mr-2" />
                打开终端修复
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 诊断历史 */}
      {diagnosticHistory.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              诊断历史
            </h3>
            <div className="space-y-2">
              {diagnosticHistory.slice(-5).map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                >
                  <Badge variant="outline">{item.type}</Badge>
                  <span className="text-sm text-muted-foreground">{item.time}</span>
                  <Badge variant={item.result.success ? 'success' : 'error'}>
                    {item.result.success ? '正常' : '有问题'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
