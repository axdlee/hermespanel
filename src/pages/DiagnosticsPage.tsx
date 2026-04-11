import { useState } from 'react';

import { api } from '../lib/api';
import type { CommandRunResult } from '../types';
import { Button, EmptyState, Panel, Toolbar } from '../components/ui';
import type { PageProps } from './types';

const COMMANDS = [
  { key: 'version', label: 'Hermes 版本' },
  { key: 'status', label: '全量状态' },
  { key: 'gateway-status', label: '网关状态' },
  { key: 'dump', label: '安装摘要' },
  { key: 'doctor', label: '健康检查' },
];

export function DiagnosticsPage({ notify, profile }: PageProps) {
  const [result, setResult] = useState<CommandRunResult | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  async function run(kind: string) {
    setRunning(kind);
    try {
      const next = await api.runDiagnostic(kind, profile);
      setResult(next);
      notify(next.success ? 'success' : 'error', `${kind} 已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="page-stack">
      <Panel
        title="诊断面板"
        subtitle="复用 Hermes CLI 原生命令输出，避免自行伪造诊断逻辑。"
        aside={
          <Toolbar>
            {COMMANDS.map((item) => (
              <Button
                key={item.key}
                onClick={() => void run(item.key)}
                disabled={running !== null}
                kind={item.key === 'doctor' ? 'primary' : 'secondary'}
              >
                {running === item.key ? `${item.label}…` : item.label}
              </Button>
            ))}
          </Toolbar>
        }
      >
        {result ? (
          <>
            <div className="detail-list compact">
              <div className="key-value-row"><span>命令</span><strong>{result.command}</strong></div>
              <div className="key-value-row"><span>退出码</span><strong>{result.exitCode}</strong></div>
              <div className="key-value-row"><span>成功</span><strong>{String(result.success)}</strong></div>
            </div>
            <pre className="code-block tall">{result.stdout || result.stderr || '无输出'}</pre>
          </>
        ) : (
          <EmptyState title="尚未执行命令" description="点击上方任一按钮即可复用 Hermes 原生命令做诊断。" />
        )}
      </Panel>
    </div>
  );
}
