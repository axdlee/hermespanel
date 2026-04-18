/**
 * HermesPanel 定时任务页面
 *
 * 管理 Hermes 定时任务：
 * - 任务列表
 * - 创建/编辑/删除任务
 */

import { useState, useEffect } from 'react';
import { Clock, RefreshCw, Plus, Play, Trash2, Calendar } from 'lucide-react';
import { toast } from '@/stores';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  Input,
  Textarea,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { CronJobsSnapshot } from '@/types';

export function CronPage() {
  const [cronJobs, setCronJobs] = useState<CronJobsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', schedule: '', prompt: '' });

  const loadCronJobs = async () => {
    setLoading(true);
    try {
      const snapshot = await api.getCronJobs();
      setCronJobs(snapshot);
    } catch (err) {
      toast.error(`加载任务失败: ${err}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCronJobs();
  }, []);

  const handleCreateJob = async () => {
    if (!newJob.name.trim() || !newJob.schedule.trim() || !newJob.prompt.trim()) {
      toast.warning('请填写完整信息');
      return;
    }
    try {
      await api.createCronJob({
        name: newJob.name,
        schedule: newJob.schedule,
        prompt: newJob.prompt,
        skills: [],
      });
      toast.success('任务创建成功');
      setCreateDialogOpen(false);
      setNewJob({ name: '', schedule: '', prompt: '' });
      loadCronJobs();
    } catch (err) {
      toast.error(`创建失败: ${err}`);
    }
  };

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    try {
      await api.deleteCronJob({ jobId, confirmId: jobName });
      toast.success('任务已删除');
      loadCronJobs();
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  const handleRunJob = async (jobId: string) => {
    try {
      await api.runCronAction('run', jobId);
      toast.success('任务已执行');
    } catch (err) {
      toast.error(`执行失败: ${err}`);
    }
  };

  const jobs = cronJobs?.jobs || [];

  return (
    <div className="p-8 space-y-6">
      {/* 页面头部 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Clock className="w-6 h-6" />
            定时任务
          </h1>
          <p className="text-muted-foreground mt-1">{jobs.length} 个任务</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadCronJobs} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            创建任务
          </Button>
        </div>
      </header>

      {/* 任务介绍 */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-medium text-foreground">自动化任务</h3>
              <p className="text-sm text-muted-foreground mt-1">
                创建定时任务，让 Hermes 自动执行重复性工作。支持 cron 表达式配置执行时间。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 任务列表 */}
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
      ) : jobs.length > 0 ? (
        <div className="space-y-3">
          {jobs.map(job => (
            <Card key={job.id} className={cn(job.enabled && 'border-green-500/30')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">{job.name}</p>
                      <Badge variant="outline" className="mt-1">
                        {job.scheduleDisplay}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleRunJob(job.id)}>
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteJob(job.id, job.name)}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                {job.prompt && <p className="text-sm text-muted-foreground mt-2">{job.prompt}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">暂无定时任务</p>
            <Button className="mt-4" onClick={() => setCreateDialogOpen(true)}>
              创建任务
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 创建任务弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>创建定时任务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">任务名称</label>
              <Input
                placeholder="例如: 每日报告"
                value={newJob.name}
                onChange={e => setNewJob(prev => ({ ...prev, name: e.target.value }))}
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">执行时间 (cron 表达式)</label>
              <Input
                placeholder="例如: 0 9 * * * (每天 9:00)"
                value={newJob.schedule}
                onChange={e => setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">执行内容</label>
              <Textarea
                placeholder="例如: 发送每日报告"
                value={newJob.prompt}
                onChange={e => setNewJob(prev => ({ ...prev, prompt: e.target.value }))}
                rows={3}
                className="mt-2"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateJob}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
