/**
 * HermesPanel 日志查看页面
 *
 * 查看 Hermes 运行日志：
 * - 日志列表
 * - 日志级别过滤
 * - 搜索日志内容
 */

import { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Search, Plug, Wrench } from 'lucide-react';
import { useAppStore, toast } from '@/stores';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  Skeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { LogReadResult } from '@/types';

const LOG_TYPES = [
  { key: 'gateway', label: 'Gateway' },
  { key: 'session', label: '会话' },
  { key: 'cron', label: '任务' },
  { key: 'error', label: '错误' },
];

const LOG_LEVELS = [
  { key: 'all', label: '全部' },
  { key: 'info', label: 'INFO' },
  { key: 'warn', label: 'WARN' },
  { key: 'error', label: 'ERROR' },
];

export function LogsPage() {
  const { setPage } = useAppStore();
  const [selectedLog, setSelectedLog] = useState('gateway');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState<LogReadResult | null>(null);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.readLog(
        selectedLog,
        100,
        selectedLevel === 'all' ? undefined : selectedLevel,
        searchQuery || undefined
      );
      setLogs(result);
    } catch {
      toast.error('读取日志失败');
    }
    setLoading(false);
  }, [selectedLog, selectedLevel, searchQuery]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleSearch = () => {
    loadLogs();
  };

  const getLogLevelStyle = (line: string) => {
    if (line.includes('ERROR')) return 'text-red-500';
    if (line.includes('WARN')) return 'text-amber-500';
    if (line.includes('INFO')) return 'text-blue-500';
    return 'text-muted-foreground';
  };

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <FileText className="w-6 h-6" />
            日志查看
          </h1>
          <p className="text-muted-foreground mt-1">系统运行日志</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          刷新
        </Button>
      </header>

      {/* 日志类型选择 */}
      <Tabs value={selectedLog} onValueChange={setSelectedLog}>
        <TabsList>
          {LOG_TYPES.map(type => (
            <TabsTrigger key={type.key} value={type.key}>
              {type.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 过滤和搜索 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {LOG_LEVELS.map(level => (
                <Button
                  key={level.key}
                  variant={selectedLevel === level.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedLevel(level.key)}
                >
                  {level.label}
                </Button>
              ))}
            </div>
            <div className="flex-1 flex items-center gap-2">
              <Input
                placeholder="搜索日志内容..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <Button variant="outline" onClick={handleSearch}>
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 日志内容 */}
      <Card>
        <CardContent className="p-4">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : logs?.lines && logs.lines.length > 0 ? (
            <div className="space-y-1 font-mono text-sm max-h-96 overflow-auto">
              {logs.lines.map((line, idx) => (
                <div key={idx} className={cn('py-1', getLogLevelStyle(line))}>
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">暂无日志记录</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 快捷操作 */}
      <div className="grid grid-cols-2 gap-4">
        <Button variant="outline" className="h-12" onClick={() => setPage('gateway')}>
          <Plug className="w-4 h-4 mr-2" />
          Gateway 管理
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('diagnostics')}>
          <Wrench className="w-4 h-4 mr-2" />
          运行诊断
        </Button>
      </div>
    </div>
  );
}
