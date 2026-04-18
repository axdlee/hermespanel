/**
 * HermesPanel 环境检测页面
 *
 * EnvCheck 页面设计：
 * - 三步检测流程（Hermes → 模型 → Gateway）
 * - 状态可视化
 * - 自动检测 + 手动重试
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Bot,
  Plug,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

type CheckState = 'pending' | 'checking' | 'ok' | 'warning' | 'error';

type StepKey = 'hermes' | 'model' | 'gateway';

interface StepState {
  hermes: CheckState;
  model: CheckState;
  gateway: CheckState;
}

const STEPS: Array<{ key: StepKey; label: string; icon: React.ElementType; desc: string }> = [
  { key: 'hermes', label: 'Hermes 程序', icon: Package, desc: '检查 Hermes 是否已安装' },
  { key: 'model', label: 'AI 模型', icon: Bot, desc: '检查 AI 模型是否已配置' },
  { key: 'gateway', label: 'Gateway 服务', icon: Plug, desc: '检查 Gateway 是否运行' },
];

export function EnvCheckPage({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStates, setStepStates] = useState<StepState>({
    hermes: 'pending',
    model: 'pending',
    gateway: 'pending',
  });
  const [stepDetails, setStepDetails] = useState<Record<string, string>>({});

  const checkStep = useCallback(
    async (stepKey: string) => {
      setStepStates(prev => ({ ...prev, [stepKey]: 'checking' }));

      try {
        let state: CheckState = 'ok';
        let detail = '';

        if (stepKey === 'hermes') {
          const installation = await api.getInstallationSnapshot();
          state = installation.binaryFound ? 'ok' : 'error';
          detail = installation.binaryFound
            ? `版本: ${installation.versionOutput || '已安装'}`
            : 'Hermes 程序未安装，请点击"一键安装"';
        } else if (stepKey === 'model') {
          const dashboard = await api.getDashboardSnapshot();
          state = dashboard.config?.modelDefault ? 'ok' : 'warning';
          detail = dashboard.config?.modelDefault
            ? `模型: ${dashboard.config.modelDefault}`
            : 'AI 模型未配置，请选择一个模型';
        } else if (stepKey === 'gateway') {
          const dashboard = await api.getDashboardSnapshot();
          state = dashboard.gateway?.gatewayState === 'running' ? 'ok' : 'warning';
          detail =
            dashboard.gateway?.gatewayState === 'running'
              ? 'Gateway 运行中'
              : 'Gateway 未运行，可以稍后启动';
        }

        setStepStates(prev => ({ ...prev, [stepKey]: state }));
        setStepDetails(prev => ({ ...prev, [stepKey]: detail }));

        if (state === 'ok' && currentStep < STEPS.length - 1) {
          setTimeout(() => setCurrentStep(prev => prev + 1), 500);
        }
      } catch (err) {
        setStepStates(prev => ({ ...prev, [stepKey]: 'error' }));
        setStepDetails(prev => ({ ...prev, [stepKey]: String(err) }));
      }
    },
    [currentStep]
  );

  // 自动检测
  useEffect(() => {
    if (currentStep < STEPS.length) {
      checkStep(STEPS[currentStep].key);
    }
  }, [currentStep, checkStep]);

  const allOk = STEPS.every(step => stepStates[step.key] === 'ok');
  const hasError = STEPS.some(step => stepStates[step.key] === 'error');

  const handleRetry = () => {
    setCurrentStep(0);
    setStepStates({ hermes: 'pending', model: 'pending', gateway: 'pending' });
    setStepDetails({});
  };

  const handleInstall = async () => {
    try {
      await api.runInstallationAction('install');
      checkStep('hermes');
    } catch (err) {
      setStepDetails(prev => ({ ...prev, hermes: `安装失败: ${err}` }));
    }
  };

  const getStateIcon = (state: CheckState) => {
    switch (state) {
      case 'ok':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'checking':
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      default:
        return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  const getStateBadge = (state: CheckState) => {
    switch (state) {
      case 'ok':
        return <Badge variant="success">正常</Badge>;
      case 'error':
        return <Badge variant="error">异常</Badge>;
      case 'warning':
        return <Badge variant="warning">需配置</Badge>;
      case 'checking':
        return <Badge variant="secondary">检测中...</Badge>;
      default:
        return <Badge variant="outline">待检测</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* 标题 */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4">
            <RefreshCw className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">环境检测</h1>
          <p className="text-muted-foreground">正在检查 Hermes 运行环境</p>
        </div>

        {/* 步骤指示器 */}
        <div className="flex items-center justify-center gap-4">
          {STEPS.map((step, idx) => (
            <div key={step.key} className="flex items-center">
              <div
                className={cn(
                  'flex items-center justify-center w-12 h-12 rounded-full transition-colors',
                  idx === currentStep && 'bg-primary/10 border-2 border-primary',
                  stepStates[step.key] === 'ok' && 'bg-green-500/10',
                  stepStates[step.key] === 'error' && 'bg-red-500/10',
                  stepStates[step.key] === 'warning' && 'bg-amber-500/10'
                )}
              >
                <step.icon
                  className={cn(
                    'w-6 h-6',
                    stepStates[step.key] === 'ok'
                      ? 'text-green-500'
                      : stepStates[step.key] === 'error'
                        ? 'text-red-500'
                        : stepStates[step.key] === 'warning'
                          ? 'text-amber-500'
                          : idx === currentStep
                            ? 'text-primary'
                            : 'text-muted-foreground'
                  )}
                />
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'w-8 h-1 mx-2 rounded',
                    stepStates[step.key] === 'ok' ? 'bg-green-500' : 'bg-border'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* 当前步骤详情 */}
        <div className="space-y-4">
          {STEPS.map(step => (
            <Card
              key={step.key}
              className={cn(
                'transition-all',
                stepStates[step.key] === 'ok' && 'border-green-500/30',
                stepStates[step.key] === 'error' && 'border-red-500/30',
                stepStates[step.key] === 'warning' && 'border-amber-500/30'
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStateIcon(stepStates[step.key])}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{step.label}</span>
                        {getStateBadge(stepStates[step.key])}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {stepDetails[step.key] || step.desc}
                      </p>
                    </div>
                  </div>
                  {step.key === 'hermes' && stepStates[step.key] === 'error' && (
                    <Button variant="default" size="sm" onClick={handleInstall}>
                      一键安装
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" onClick={handleRetry}>
            <RefreshCw className="w-4 h-4 mr-2" />
            重新检测
          </Button>
          <Button disabled={!allOk} onClick={onComplete}>
            {allOk ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                检测完成，继续
              </>
            ) : hasError ? (
              '请先解决异常'
            ) : (
              '等待检测完成'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
