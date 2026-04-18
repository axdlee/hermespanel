/**
 * HermesPanel 实例管理页面
 *
 * 管理 Hermes 多实例配置：
 * - 实例列表
 * - 创建/删除实例
 * - 切换激活实例
 */

import { useState, useEffect } from 'react';
import { FolderOpen, Target, Plus, RefreshCw, Trash2, Check } from 'lucide-react';
import { useDashboardStore, toast } from '@/stores';
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
  Skeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ProfilesSnapshot } from '@/types';

export function ProfilesPage() {
  const { loadAll } = useDashboardStore();
  const [profiles, setProfiles] = useState<ProfilesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [newProfileName, setNewProfileName] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const snapshot = await api.getProfilesSnapshot();
      setProfiles(snapshot);
    } catch {
      toast.error('加载实例失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleSetActive = async (profileName: string) => {
    try {
      await api.setActiveProfile(profileName);
      toast.success(`已切换到 ${profileName}`);
      loadProfiles();
      loadAll();
    } catch (err) {
      toast.error(`切换失败: ${err}`);
    }
  };

  const handleCreate = async () => {
    if (!newProfileName.trim()) return;
    try {
      await api.createProfile({
        profileName: newProfileName.trim(),
        clone: false,
        cloneAll: false,
        noAlias: true,
      });
      toast.success(`已创建实例 ${newProfileName}`);
      setCreateDialogOpen(false);
      setNewProfileName('');
      loadProfiles();
    } catch (err) {
      toast.error(`创建失败: ${err}`);
    }
  };

  const handleDelete = async (profileName: string) => {
    if (profileName === 'default') {
      toast.warning('不能删除 default 实例');
      return;
    }
    try {
      await api.deleteProfile({
        profileName,
        confirmName: profileName,
      });
      toast.success(`已删除实例 ${profileName}`);
      loadProfiles();
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <FolderOpen className="w-6 h-6" />
            实例管理
          </h1>
          <p className="text-muted-foreground mt-1">{profiles?.profiles?.length || 0} 个实例</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadProfiles} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            创建实例
          </Button>
        </div>
      </header>

      {/* 当前实例 */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-primary" />
            <div>
              <span className="text-sm text-muted-foreground">当前激活实例:</span>
              <Badge variant="default" className="ml-2">
                {profiles?.activeProfile || 'default'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 实例列表 */}
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
      ) : profiles && profiles.profiles && profiles.profiles.length > 0 ? (
        <div className="space-y-3">
          {profiles.profiles.map(profile => (
            <Card
              key={profile.name}
              className={cn(profile.name === profiles.activeProfile && 'border-primary')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">{profile.name}</p>
                      {profile.aliases && profile.aliases.length > 0 && (
                        <Badge variant="outline" className="text-xs mt-1">
                          别名: {profile.aliases[0].name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {profile.name === profiles.activeProfile && (
                      <Badge variant="success">
                        <Check className="w-3 h-3 mr-1" />
                        当前
                      </Badge>
                    )}
                    {profile.name !== profiles.activeProfile && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetActive(profile.name)}
                      >
                        激活
                      </Button>
                    )}
                    {profile.name !== 'default' && (
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(profile.name)}>
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">暂无实例</p>
          </CardContent>
        </Card>
      )}

      {/* 创建实例弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>创建新实例</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">实例名称</label>
              <Input
                placeholder="例如: work, personal"
                value={newProfileName}
                onChange={e => setNewProfileName(e.target.value)}
                className="mt-2"
              />
            </div>
            <p className="text-sm text-muted-foreground">实例可以拥有独立的配置、技能和记忆。</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!newProfileName.trim()}>
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
