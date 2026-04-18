/**
 * HermesPanel 主仪表盘页面
 *
 * Dashboard 页面设计：
 * - 状态总览卡片
 * - 概览指标
 * - 技能展示
 * - 快捷操作入口
 */

import { useEffect, useState } from 'react';
import {
  Zap,
  ClipboardList,
  Clock,
  FileText,
  MessageSquare,
  Settings,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore, useDashboardStore, getAppStatusFromSnapshot } from '@/stores';
import { api } from '@/lib/api';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { SkillItem } from '@/types';

const RECOMMENDED_SKILLS = [
  { name: 'browser', description: '让 AI 能读懂网页内容', icon: '🌐' },
  { name: 'search', description: '搜索电脑上的文件和内容', icon: '🔍' },
  { name: 'code', description: '帮你写代码、找问题', icon: '🛠️' },
];

export function DashboardPage() {
  const { snapshot, installation, loading, loadAll, startPolling, stopPolling } =
    useDashboardStore();
  const { setPage } = useAppStore();
  const [skills, setSkills] = useState<SkillItem[]>([]);

  const loadSkills = async () => {
    try {
      const skillList = await api.listSkills();
      setSkills(skillList);
    } catch {
      // 安静失败
    }
  };

  useEffect(() => {
    loadAll();
    loadSkills();
    startPolling(10000);
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = getAppStatusFromSnapshot(snapshot, installation);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-muted-foreground">正在加载...</span>
      </div>
    );
  }

  const getStatusInfo = () => {
    switch (status) {
      case 'ready':
        return {
          icon: CheckCircle2,
          label: '系统就绪',
          color: 'text-green-500',
          bg: 'bg-green-500/10',
        };
      case 'not_installed':
        return {
          icon: AlertTriangle,
          label: 'Hermes 未安装',
          color: 'text-amber-500',
          bg: 'bg-amber-500/10',
        };
      case 'no_model':
        return {
          icon: AlertTriangle,
          label: '请配置 AI 模型',
          color: 'text-amber-500',
          bg: 'bg-amber-500/10',
        };
      case 'no_ability':
        return {
          icon: AlertTriangle,
          label: '请添加技能',
          color: 'text-amber-500',
          bg: 'bg-amber-500/10',
        };
      default:
        return { icon: XCircle, label: '系统异常', color: 'text-red-500', bg: 'bg-red-500/10' };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  return (
    <div className="p-8 space-y-8">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">仪表盘</h1>
          <p className="text-muted-foreground mt-1">系统状态总览</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAll()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage('config')}>
            <Settings className="w-4 h-4 mr-2" />
            配置
          </Button>
        </div>
      </header>

      {/* 状态卡片 */}
      <Card
        className={cn(
          'border-l-4',
          status === 'ready' ? 'border-l-green-500' : 'border-l-amber-500'
        )}
      >
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className={cn('p-3 rounded-lg', statusInfo.bg)}>
              <StatusIcon className={cn('w-6 h-6', statusInfo.color)} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{statusInfo.label}</h2>
              {status === 'ready' && snapshot && (
                <p className="text-sm text-muted-foreground mt-1">
                  {snapshot.config?.modelDefault} · {snapshot.counts?.skills || 0} 技能 ·
                  {snapshot.gateway?.gatewayState === 'running'
                    ? 'Gateway 运行中'
                    : 'Gateway 待启动'}
                  {snapshot.config?.memoryEnabled && ' · 记忆开启'}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 概览指标 */}
      {status === 'ready' && snapshot && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <ClipboardList className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-2xl font-bold text-foreground">
                    {snapshot.counts?.sessions || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">会话</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-2xl font-bold text-foreground">
                    {snapshot.counts?.skills || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">技能</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-2xl font-bold text-foreground">
                    {snapshot.counts?.cronJobs || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">定时任务</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-2xl font-bold text-foreground">
                    {snapshot.counts?.logFiles || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">日志文件</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 技能展示 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            技能中心
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setPage('skills')}>
            添加更多
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {skills.length > 0
              ? skills.slice(0, 3).map(skill => (
                  <Card key={skill.filePath} className="bg-muted/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-primary" />
                        <h4 className="font-medium text-foreground">{skill.name}</h4>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {skill.description || '暂无描述'}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setPage('chat')}
                      >
                        开启对话
                      </Button>
                    </CardContent>
                  </Card>
                ))
              : RECOMMENDED_SKILLS.map(skill => (
                  <Card key={skill.name} className="bg-muted/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{skill.icon}</span>
                        <h4 className="font-medium text-foreground">{skill.name}</h4>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{skill.description}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setPage('skills')}
                      >
                        添加
                      </Button>
                    </CardContent>
                  </Card>
                ))}
          </div>
        </CardContent>
      </Card>

      {/* 快捷操作 */}
      <div className="grid grid-cols-4 gap-4">
        <Button variant="outline" className="h-12" onClick={() => setPage('chat')}>
          <MessageSquare className="w-4 h-4 mr-2" />
          新对话
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('skills')}>
          <Zap className="w-4 h-4 mr-2" />
          装技能
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('config')}>
          <Settings className="w-4 h-4 mr-2" />
          配置
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('diagnostics')}>
          <Search className="w-4 h-4 mr-2" />
          诊断
        </Button>
      </div>
    </div>
  );
}
