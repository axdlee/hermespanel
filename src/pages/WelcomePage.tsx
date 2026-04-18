/**
 * HermesPanel 欢迎页面
 *
 * Welcome 页面设计：
 * - 温暖欢迎 + 安全确认
 * - Checkbox 确认列表
 * - 用户必须勾选才能继续
 */

import { useState } from 'react';
import { Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface WelcomePageProps {
  onConfirm: () => void;
}

const CONFIRM_ITEMS = [
  { id: 'understand', label: '我理解 Hermes 会操作我的电脑' },
  { id: 'read', label: '我已阅读安全说明' },
  { id: 'agree', label: '我同意授权 Hermes 执行任务' },
];

export function WelcomePage({ onConfirm }: WelcomePageProps) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({
    understand: false,
    read: false,
    agree: false,
  });

  const allConfirmed = Object.values(confirmed).every(v => v);

  const toggleConfirm = (id: string) => {
    setConfirmed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-8">
        {/* Logo */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4">
            <Zap className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">HermesPanel</h1>
          <p className="text-muted-foreground">让 AI 助手帮你工作</p>
        </div>

        {/* 安全提醒卡片 */}
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-border p-6 space-y-6">
          <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="font-semibold text-lg text-foreground">使用前请确认</h2>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            Hermes 是一个 AI 助手，可以帮你打开文件、搜索内容、执行命令、自动化任务。
            为了正常工作，它需要以下权限：
          </p>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              读取和修改文件
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              执行系统命令
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              连接互联网
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              访问你的 API 密钥（用于调用 AI 服务）
            </li>
          </ul>

          <div className="bg-amber-50 dark:bg-amber-500/10 rounded-lg p-4 text-sm text-amber-700 dark:text-amber-400">
            ⚠️ 使用 AI 服务可能产生费用，具体取决于你选择的服务商和使用量。
          </div>
        </div>

        {/* 确认勾选 */}
        <div className="space-y-3">
          {CONFIRM_ITEMS.map(item => (
            <label
              key={item.id}
              className={cn(
                'flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors',
                confirmed[item.id]
                  ? 'bg-primary/5 border-primary/20 border'
                  : 'bg-white/50 dark:bg-slate-800/50 border border-border hover:bg-accent'
              )}
            >
              <input
                type="checkbox"
                checked={confirmed[item.id]}
                onChange={() => toggleConfirm(item.id)}
                className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
              />
              <span
                className={cn(
                  'text-sm',
                  confirmed[item.id] ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {item.label}
              </span>
            </label>
          ))}
        </div>

        {/* 继续按钮 */}
        <Button className="w-full h-12 text-base" disabled={!allConfirmed} onClick={onConfirm}>
          {allConfirmed ? '开始使用 Hermes' : '请先确认以上内容'}
        </Button>

        {/* 版本信息 */}
        <p className="text-center text-xs text-muted-foreground">
          HermesPanel v0.1.0 · 首次使用需要环境检测
        </p>
      </div>
    </div>
  );
}
