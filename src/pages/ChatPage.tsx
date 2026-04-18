/**
 * HermesPanel 对话入口页面
 *
 * ChatPage 设计：
 * - Gateway 状态显示 + 模型切换
 * - 自然语言输入区
 * - 执行结果展示
 */

import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Circle,
  Settings,
  RefreshCw,
  FolderOpen,
  Search,
  Wrench,
  BookOpen,
  Rocket,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react';
import { useAppStore, useDashboardStore, toast } from '@/stores';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Textarea, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

interface ExecutionResult {
  success: boolean;
  message: string;
  details?: string;
  duration?: number;
}

const COMMAND_SUGGESTIONS = [
  { text: '帮我打开桌面的报告.xlsx', icon: FolderOpen },
  { text: '搜索项目中包含"config"的文件', icon: Search },
  { text: '帮我写一个 Python 脚本', icon: Wrench },
  { text: '总结这篇网页内容', icon: BookOpen },
];

export function ChatPage() {
  const { snapshot, refreshing, refresh, startPolling, stopPolling } = useDashboardStore();
  const { setPage } = useAppStore();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [history, setHistory] = useState<
    Array<{ time: string; command: string; result: ExecutionResult }>
  >([]);

  useEffect(() => {
    refresh();
    startPolling(10000);
    return () => stopPolling();
  }, [refresh, startPolling, stopPolling]);

  const gatewayState = snapshot?.gateway?.gatewayState;
  const model = snapshot?.config?.modelDefault;
  const isGatewayRunning = gatewayState === 'running';

  const handleExecute = useCallback(async () => {
    if (!input.trim()) return;

    setLoading(true);
    const startTime = Date.now();

    try {
      let executionResult: ExecutionResult;
      const cmd = input.toLowerCase();

      if (cmd.includes('打开') || cmd.includes('open')) {
        await api.openInTerminal({ command: `hermes exec "${input}"`, workingDirectory: null });
        executionResult = {
          success: true,
          message: '正在打开...',
          duration: Date.now() - startTime,
        };
      } else if (cmd.includes('搜索') || cmd.includes('search') || cmd.includes('找')) {
        await api.openInTerminal({ command: `hermes exec "${input}"`, workingDirectory: null });
        executionResult = {
          success: true,
          message: '正在搜索...',
          duration: Date.now() - startTime,
        };
      } else if (cmd.includes('诊断') || cmd.includes('检查') || cmd.includes('diagnose')) {
        const res = await api.runDiagnostic('doctor');
        executionResult = {
          success: res.success,
          message: res.success ? '诊断完成' : '诊断发现问题',
          details: res.stdout,
          duration: Date.now() - startTime,
        };
      } else {
        await api.openInTerminal({ command: `hermes exec "${input}"`, workingDirectory: null });
        executionResult = {
          success: true,
          message: '已发送到终端执行',
          duration: Date.now() - startTime,
        };
      }

      setResult(executionResult);
      setHistory(prev => [
        ...prev,
        { time: new Date().toLocaleTimeString(), command: input, result: executionResult },
      ]);
      setInput('');
    } catch (err) {
      const executionResult = {
        success: false,
        message: `执行出错: ${err}`,
        duration: Date.now() - startTime,
      };
      setResult(executionResult);
      toast.error(String(err));
    }

    setLoading(false);
  }, [input]);

  const handleStartGateway = async () => {
    try {
      await api.runGatewayAction('start');
      refresh();
      toast.success('Gateway 启动成功');
    } catch (err) {
      toast.error(`启动失败: ${err}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <MessageSquare className="w-6 h-6" />
            对话入口
          </h1>
          <p className="text-muted-foreground mt-1">输入你想让 AI 做的事</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing}>
          <RefreshCw className={cn('w-4 h-4 mr-2', refreshing && 'animate-spin')} />
          刷新
        </Button>
      </header>

      {/* Gateway 状态栏 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Circle
                  className={cn(
                    'w-4 h-4',
                    isGatewayRunning ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
                  )}
                />
                <span className="text-sm text-muted-foreground">Gateway:</span>
                <Badge variant={isGatewayRunning ? 'success' : 'error'}>
                  {isGatewayRunning ? '运行中' : '已停止'}
                </Badge>
                {!isGatewayRunning && (
                  <Button variant="outline" size="sm" onClick={handleStartGateway}>
                    启动
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">模型:</span>
              <Badge variant="secondary">{model || '未配置'}</Badge>
              <Button variant="ghost" size="sm" onClick={() => setPage('config')}>
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 输入区 */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <Textarea
            placeholder="输入你想让 AI 做的事..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || !isGatewayRunning}
            rows={3}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              按 Enter 发送，Shift+Enter 换行
              {!isGatewayRunning && ' · Gateway 未运行，请先启动'}
            </p>
            <Button
              onClick={handleExecute}
              disabled={loading || !input.trim() || !isGatewayRunning}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  执行中...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4 mr-2" />
                  执行
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 命令提示 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">你可以这样说</h3>
        <div className="grid grid-cols-2 gap-3">
          {COMMAND_SUGGESTIONS.map((suggestion, idx) => (
            <Button
              key={idx}
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => setInput(suggestion.text)}
              disabled={loading}
            >
              <suggestion.icon className="w-4 h-4 mr-2 text-muted-foreground" />
              <span className="text-sm">{suggestion.text}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* 执行结果 */}
      {result && (
        <Card
          className={cn('border-l-4', result.success ? 'border-l-green-500' : 'border-l-red-500')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {result.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              <div>
                <p className="font-medium text-foreground">{result.message}</p>
                {result.details && (
                  <pre className="mt-2 text-sm text-muted-foreground bg-muted p-2 rounded-lg overflow-auto">
                    {result.details}
                  </pre>
                )}
                {result.duration && (
                  <p className="text-xs text-muted-foreground mt-1">
                    执行时间: {result.duration}ms
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 历史记录 */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Clock className="w-4 h-4" />
            执行历史
          </h3>
          <div className="space-y-2">
            {history.slice(-5).map((item, idx) => (
              <Card key={idx} className="bg-muted/50">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                    <Badge variant={item.result.success ? 'success' : 'error'} className="text-xs">
                      {item.result.success ? '成功' : '失败'}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground mt-1">{item.command}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
