/**
 * HermesPanel 技能市场页面
 *
 * SkillsPage 设计：
 * - 搜索过滤
 * - 技能卡片展示
 * - 安装/启用操作
 */

import { useState, useEffect } from 'react';
import {
  Zap,
  Search,
  Globe,
  FolderOpen,
  Wrench,
  FileText,
  MessageSquare,
  RefreshCw,
  Loader2,
  Terminal,
  Settings,
} from 'lucide-react';
import { useAppStore, useDashboardStore, toast } from '@/stores';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Input, Badge, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { SkillItem } from '@/types';

const CATEGORIES = [
  { key: 'all', label: '全部', icon: Zap },
  { key: 'browser', label: '网页', icon: Globe },
  { key: 'search', label: '搜索', icon: Search },
  { key: 'code', label: '开发', icon: Wrench },
  { key: 'file', label: '文件', icon: FolderOpen },
  { key: 'doc', label: '文档', icon: FileText },
];

const RECOMMENDED_SKILLS = [
  { name: 'browser', description: '让 AI 能读懂网页内容，帮你总结', reason: '最常用' },
  { name: 'search', description: '搜索电脑上的文件和内容', reason: '很实用' },
  { name: 'code', description: '帮你写代码、找问题', reason: '开发必备' },
];

export function SkillsPage() {
  const { loadAll } = useDashboardStore();
  const { setPage } = useAppStore();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [installing, setInstalling] = useState<string | null>(null);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const skillList = await api.listSkills();
      setSkills(skillList);
    } catch {
      toast.error('加载技能失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const handleInstall = async (skillName: string) => {
    setInstalling(skillName);
    try {
      await api.openInTerminal({
        command: `hermes skills install ${skillName}`,
        workingDirectory: null,
      });
      toast.success(`正在安装 ${skillName}...`);
      setTimeout(() => {
        loadSkills();
        loadAll();
      }, 3000);
    } catch {
      toast.error('安装失败');
    }
    setInstalling(null);
  };

  const filteredSkills = skills.filter(skill => {
    const matchesSearch =
      !searchQuery ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'all' ||
      skill.category?.toLowerCase().includes(selectedCategory.toLowerCase());
    return matchesSearch && matchesCategory;
  });

  const totalCount = skills.length;

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6" />
            技能市场
          </h1>
          <p className="text-muted-foreground mt-1">{totalCount} 个技能可用</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadSkills} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setPage('chat')}>
            <MessageSquare className="w-4 h-4 mr-2" />
            开启对话
          </Button>
        </div>
      </header>

      {/* 搜索栏 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜索技能..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 分类标签 */}
      <div className="flex items-center gap-2">
        {CATEGORIES.map(cat => (
          <Button
            key={cat.key}
            variant={selectedCategory === cat.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory(cat.key)}
          >
            <cat.icon className="w-4 h-4 mr-1" />
            {cat.label}
          </Button>
        ))}
      </div>

      {/* 推荐技能 */}
      {skills.length === 0 && !loading && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-medium text-foreground">推荐技能</h3>
            <div className="space-y-3">
              {RECOMMENDED_SKILLS.map(skill => (
                <div
                  key={skill.name}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-foreground">{skill.name}</p>
                    <p className="text-sm text-muted-foreground">{skill.description}</p>
                    <Badge variant="secondary" className="mt-1">
                      {skill.reason}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleInstall(skill.name)}
                    disabled={installing === skill.name}
                  >
                    {installing === skill.name ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        安装中...
                      </>
                    ) : (
                      '安装'
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 技能列表 */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredSkills.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          {filteredSkills.map(skill => (
            <Card key={skill.filePath} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <h4 className="font-medium text-foreground">{skill.name}</h4>
                </div>
                <p className="text-sm text-muted-foreground">{skill.description || '暂无描述'}</p>
                {skill.category && <Badge variant="outline">{skill.category}</Badge>}
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1"
                    onClick={() => setPage('chat')}
                  >
                    使用
                  </Button>
                  <Button variant="outline" size="sm">
                    详情
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">没有找到匹配的技能</p>
            <Button variant="outline" className="mt-4" onClick={() => setSearchQuery('')}>
              查看全部
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 底部操作 */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => api.openInTerminal({ command: 'hermes skills', workingDirectory: null })}
        >
          <Terminal className="w-4 h-4 mr-2" />
          打开终端管理
        </Button>
        <Button variant="outline" onClick={() => setPage('config')}>
          <Settings className="w-4 h-4 mr-2" />
          配置技能目录
        </Button>
      </div>
    </div>
  );
}
