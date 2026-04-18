/**
 * HermesPanel 会话历史页面
 *
 * Sessions 设计：
 * - 会话列表展示
 * - 搜索过滤
 * - 会话详情查看
 */

import { useState, useEffect } from 'react';
import {
  ClipboardList,
  Search,
  RefreshCw,
  MessageSquare,
  Clock,
  Bot,
  ChevronRight,
} from 'lucide-react';
import { useAppStore, toast } from '@/stores';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Skeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { SessionRecord, SessionDetail } from '@/types';

export function SessionsPage() {
  const { setPage } = useAppStore();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const sessionList = await api.listSessions(50);
      setSessions(sessionList);
    } catch {
      toast.error('加载会话失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleViewDetail = async (sessionId: string) => {
    try {
      const detail = await api.getSessionDetail(sessionId);
      setSelectedSession(detail);
      setDetailOpen(true);
    } catch (err) {
      toast.error(`获取详情失败: ${err}`);
    }
  };

  const filteredSessions = sessions.filter(session => {
    return (
      !searchQuery ||
      session.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.preview?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <ClipboardList className="w-6 h-6" />
            会话历史
          </h1>
          <p className="text-muted-foreground mt-1">{sessions.length} 个会话记录</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setPage('chat')}>
            <MessageSquare className="w-4 h-4 mr-2" />
            新对话
          </Button>
        </div>
      </header>

      {/* 搜索栏 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 会话列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredSessions.length > 0 ? (
        <div className="space-y-3">
          {filteredSessions.map(session => (
            <Card
              key={session.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleViewDetail(session.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{session.id.slice(0, 8)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(session.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-foreground mt-2">
                  {session.title || session.preview || '无摘要'}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  <div className="flex items-center gap-1">
                    <Bot className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {session.model || '未知模型'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {session.endedAt
                        ? `${Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)}秒`
                        : '进行中'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">暂无会话记录</p>
            <Button className="mt-4" onClick={() => setPage('chat')}>
              开始对话
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 会话详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>会话详情</DialogTitle>
            <DialogDescription>{selectedSession?.session.id.slice(0, 8)}</DialogDescription>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">模型</span>
                  <Badge variant="secondary">{selectedSession.session.model || '未知'}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">开始时间</span>
                  <span className="text-sm">
                    {new Date(selectedSession.session.startedAt).toLocaleString()}
                  </span>
                </div>
              </div>
              {selectedSession.session.title && (
                <div>
                  <h4 className="text-sm font-medium mb-1">摘要</h4>
                  <p className="text-sm text-muted-foreground">{selectedSession.session.title}</p>
                </div>
              )}
              {selectedSession.messages && selectedSession.messages.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">消息记录</h4>
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {selectedSession.messages.slice(0, 10).map((msg, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'p-2 rounded-lg',
                          msg.role === 'user' ? 'bg-primary/10' : 'bg-muted'
                        )}
                      >
                        <Badge variant="outline" className="text-xs">
                          {msg.role}
                        </Badge>
                        <p className="text-sm mt-1">{msg.content?.slice(0, 200)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
