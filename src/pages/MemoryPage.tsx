/**
 * HermesPanel 记忆管理页面
 *
 * 管理 Hermes 记忆文件：
 * - 记忆文件列表
 * - 查看/编辑记忆
 */

import { useState, useEffect } from 'react';
import { Brain, FileText, RefreshCw, Settings, Clock, Save } from 'lucide-react';
import { useAppStore, toast } from '@/stores';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Textarea,
  Skeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MemoryFileSummary, MemoryFileDetail } from '@/types';

export function MemoryPage() {
  const { setPage } = useAppStore();
  const [memories, setMemories] = useState<MemoryFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMemory, setSelectedMemory] = useState<MemoryFileDetail | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const memoryList = await api.listMemoryFiles();
      setMemories(memoryList);
    } catch {
      toast.error('加载记忆失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMemories();
  }, []);

  const handleViewMemory = async (key: string) => {
    try {
      const detail = await api.readMemoryFile(key);
      setSelectedMemory(detail);
      setEditContent(detail.content || '');
      setEditDialogOpen(true);
    } catch (err) {
      toast.error(`读取失败: ${err}`);
    }
  };

  const handleSaveMemory = async () => {
    if (!selectedMemory) return;
    try {
      await api.writeMemoryFile(selectedMemory.key, editContent);
      toast.success('记忆已保存');
      setEditDialogOpen(false);
      setSelectedMemory(null);
      loadMemories();
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6" />
            记忆管理
          </h1>
          <p className="text-muted-foreground mt-1">{memories.length} 个记忆文件</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadMemories} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          刷新
        </Button>
      </header>

      {/* 记忆介绍 */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-medium text-foreground">记忆功能</h3>
              <p className="text-sm text-muted-foreground mt-1">
                AI 可以记住你的偏好、习惯和历史对话，让交互更加个性化。
                记忆文件存储在本地，你可以查看和编辑。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 记忆文件列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : memories.length > 0 ? (
        <div className="space-y-3">
          {memories.map(memory => (
            <Card
              key={memory.key}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleViewMemory(memory.key)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">{memory.key}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {memory.updatedAt ? new Date(memory.updatedAt).toLocaleDateString() : ''}
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
            <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">暂无记忆文件</p>
            <p className="text-sm text-muted-foreground mt-2">
              开启记忆功能后，AI 会自动创建记忆文件
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setPage('config')}>
              <Settings className="w-4 h-4 mr-2" />
              开启记忆
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 编辑记忆弹窗 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {selectedMemory?.key}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveMemory}>
              <Save className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
