/**
 * HermesPanel 配置中心页面
 *
 * Config 设计：
 * - 模型配置
 * - 工具开关
 * - API 密钥管理
 */

import { useState, useEffect } from 'react';
import {
  Settings,
  Bot,
  Brain,
  RefreshCw,
  Terminal,
  FileText,
  Key,
  Plug,
  Wrench,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { useAppStore, useDashboardStore, toast } from '@/stores';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ConfigDocuments } from '@/types';

const MODEL_OPTIONS = [
  { id: 'claude', name: 'Claude', desc: '最智能，理解能力最强' },
  { id: 'gpt-4', name: 'GPT-4', desc: '很智能，功能丰富' },
  { id: 'gpt-3.5', name: 'GPT-3.5', desc: '性价比高' },
  { id: 'gemini', name: 'Gemini', desc: 'Google AI' },
];

export function ConfigPage() {
  const { snapshot, loadAll } = useDashboardStore();
  const { setPage } = useAppStore();
  const [configDocs, setConfigDocs] = useState<ConfigDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const docs = await api.getConfigDocuments();
      setConfigDocs(docs);
    } catch (err) {
      toast.error(`加载配置失败: ${err}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSaveConfig = async () => {
    if (!editing) return;
    try {
      if (editing === 'yaml') {
        await api.saveConfigYaml(editContent);
      } else if (editing === 'env') {
        await api.saveEnvFile(editContent);
      }
      toast.success('配置已保存');
      setEditDialogOpen(false);
      setEditing(null);
      loadConfig();
      loadAll();
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    }
  };

  const handleOpenTerminalConfig = async () => {
    try {
      await api.openInTerminal({ command: 'hermes config', workingDirectory: null });
      toast.success('已打开终端配置');
    } catch (err) {
      toast.error(`打开失败: ${err}`);
    }
  };

  const openEditDialog = (type: string, content: string) => {
    setEditing(type);
    setEditContent(content);
    setEditDialogOpen(true);
  };

  const model = snapshot?.config?.modelDefault;
  const memoryEnabled = snapshot?.config?.memoryEnabled;

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6" />
            配置中心
          </h1>
          <p className="text-muted-foreground mt-1">管理 Hermes 设置</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadConfig} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={handleOpenTerminalConfig}>
            <Terminal className="w-4 h-4 mr-2" />
            终端配置
          </Button>
        </div>
      </header>

      {/* 模型配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            AI 模型
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">当前模型:</span>
            <Badge variant="secondary">{model || '未配置'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {MODEL_OPTIONS.map(opt => (
              <Card
                key={opt.id}
                className={cn(
                  'cursor-pointer transition-all',
                  model?.includes(opt.id) && 'border-primary'
                )}
                onClick={handleOpenTerminalConfig}
              >
                <CardContent className="p-3">
                  <p className="font-medium text-foreground">{opt.name}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 记忆配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            记忆设置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">记忆功能</p>
              <p className="text-sm text-muted-foreground">AI 可以记住你的偏好和历史对话</p>
            </div>
            <div className="flex items-center gap-2">
              {memoryEnabled ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground" />
              )}
              <Badge variant={memoryEnabled ? 'success' : 'outline'}>
                {memoryEnabled ? '已开启' : '未开启'}
              </Badge>
            </div>
          </div>
          <Button variant="outline" onClick={handleOpenTerminalConfig}>
            在终端中配置
          </Button>
        </CardContent>
      </Card>

      {/* 配置文件 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            配置文件
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {configDocs && (
            <>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">config.yaml</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog('yaml', configDocs.configYaml || '')}
                >
                  编辑
                </Button>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">.env</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog('env', configDocs.envFile || '')}
                >
                  编辑
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 快捷操作 */}
      <div className="grid grid-cols-3 gap-4">
        <Button variant="outline" className="h-12" onClick={() => setPage('gateway')}>
          <Plug className="w-4 h-4 mr-2" />
          网关设置
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('memory')}>
          <Brain className="w-4 h-4 mr-2" />
          记忆管理
        </Button>
        <Button variant="outline" className="h-12" onClick={() => setPage('diagnostics')}>
          <Wrench className="w-4 h-4 mr-2" />
          运行诊断
        </Button>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑 {editing === 'yaml' ? 'config.yaml' : '.env'}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={16}
            className="font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveConfig}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
