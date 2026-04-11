import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import type { CommandRunResult, DashboardSnapshot } from '../types';
import { Button, EmptyState, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import type { PageProps } from './types';

export function GatewayPage({ notify, profile }: PageProps) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [diagnostic, setDiagnostic] = useState<CommandRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const snapshot = await api.getDashboardSnapshot(profile);
      setData(snapshot);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: string) {
    setRunningAction(action);
    try {
      const result = await api.runGatewayAction(action, profile);
      setDiagnostic(result);
      notify(result.success ? 'success' : 'error', `gateway ${action} 已执行。`);
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function refreshDiagnostic() {
    try {
      const result = await api.runDiagnostic('gateway-status', profile);
      setDiagnostic(result);
    } catch (reason) {
      notify('error', String(reason));
    }
  }

  useEffect(() => {
    void load();
    void refreshDiagnostic();
  }, [profile]);

  if (loading || !data) {
    return <LoadingState label="正在加载网关状态。" />;
  }

  const gateway = data.gateway;

  return (
    <div className="page-stack">
      <Panel
        title="消息网关控制"
        subtitle="通过 Hermes CLI 控制 gateway，客户端本身不接管任何内部实现。"
        aside={
          <Toolbar>
            <Button onClick={() => void load()}>刷新状态</Button>
            <Button onClick={() => void refreshDiagnostic()}>刷新诊断</Button>
          </Toolbar>
        }
      >
        <div className="toolbar">
          <Button kind="primary" onClick={() => void runAction('start')} disabled={!!runningAction}>
            {runningAction === 'start' ? '启动中…' : '启动'}
          </Button>
          <Button onClick={() => void runAction('restart')} disabled={!!runningAction}>
            {runningAction === 'restart' ? '重启中…' : '重启'}
          </Button>
          <Button kind="danger" onClick={() => void runAction('stop')} disabled={!!runningAction}>
            {runningAction === 'stop' ? '停止中…' : '停止'}
          </Button>
        </div>

        {gateway ? (
          <div className="detail-list">
            <KeyValueRow
              label="Gateway"
              value={
                <Pill tone={gateway.gatewayState === 'running' ? 'good' : 'warn'}>
                  {gateway.gatewayState}
                </Pill>
              }
            />
            <KeyValueRow label="PID" value={gateway.pid ?? '—'} />
            <KeyValueRow label="活跃 Agent" value={gateway.activeAgents} />
            <KeyValueRow label="更新时间" value={formatTimestamp(gateway.updatedAt)} />
            <KeyValueRow label="退出原因" value={gateway.exitReason ?? '—'} />
          </div>
        ) : (
          <EmptyState title="未检测到网关运行态" description="客户端没有读取到 gateway_state.json。" />
        )}
      </Panel>

      <Panel title="平台连接">
        {gateway?.platforms.length ? (
          <div className="list-stack">
            {gateway.platforms.map((platform) => (
              <div className="list-card" key={platform.name}>
                <div className="list-card-title">
                  <strong>{platform.name}</strong>
                  <Pill tone={platform.state === 'connected' ? 'good' : platform.state === 'fatal' ? 'bad' : 'warn'}>
                    {platform.state}
                  </Pill>
                </div>
                <p>{platform.errorMessage || '无额外错误信息'}</p>
                <div className="meta-line">
                  <span>{platform.name}</span>
                  <span>{formatTimestamp(platform.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无平台状态" description="启动并配置消息平台后，这里会显示各平台连接状态。" />
        )}
      </Panel>

      <Panel title="CLI 诊断输出">
        {diagnostic ? (
          <>
            <div className="detail-list compact">
              <KeyValueRow label="命令" value={diagnostic.command} />
              <KeyValueRow label="退出码" value={diagnostic.exitCode} />
              <KeyValueRow
                label="结果"
                value={<Pill tone={diagnostic.success ? 'good' : 'bad'}>{diagnostic.success ? '成功' : '失败'}</Pill>}
              />
            </div>
            <pre className="code-block">{diagnostic.stdout || diagnostic.stderr || '无输出'}</pre>
          </>
        ) : (
          <EmptyState title="暂无诊断输出" description="点击上方“刷新诊断”读取 `hermes gateway status` 输出。" />
        )}
      </Panel>
    </div>
  );
}
