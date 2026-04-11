import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { formatEpoch, formatTimestamp } from '../lib/format';
import type { DashboardSnapshot } from '../types';
import { EmptyState, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar, Button } from '../components/ui';
import type { PageProps } from './types';

export function DashboardPage({ notify, profile }: PageProps) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getDashboardSnapshot(profile);
      setData(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profile]);

  if (loading) {
    return <LoadingState label="正在加载 HermesPanel 仪表盘。" />;
  }

  if (error || !data) {
    return (
      <Panel title="仪表盘">
        <EmptyState
          title="读取失败"
          description={error ?? '未能读取 Hermes 桌面快照。'}
        />
        <Toolbar>
          <Button onClick={() => void load()}>重试</Button>
        </Toolbar>
      </Panel>
    );
  }

  return (
    <div className="page-stack">
      <Panel
        title="Hermes 总览"
        subtitle="客户端只做本地封装，不改动 Hermes Agent 内部实现。"
        aside={
          <Toolbar>
            <Button
              onClick={() => {
                void load();
                notify('info', '已刷新仪表盘。');
              }}
            >
              刷新
            </Button>
          </Toolbar>
        }
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">本地桌面控制台</p>
            <p className="hero-subtitle">
              统一管理 `~/.hermes`、网关运行态、会话库、技能目录和记忆文件。
            </p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={data.profileName} />
              <KeyValueRow label="Hermes Home" value={data.hermesHome} />
              <KeyValueRow label="Hermes Binary" value={data.hermesBinary} />
              <KeyValueRow label="当前网关" value={data.gateway?.gatewayState ?? '未检测到'} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="会话数" value={data.counts.sessions} />
            <MetricCard label="技能数" value={data.counts.skills} />
            <MetricCard label="Cron 作业" value={data.counts.cronJobs} />
            <MetricCard label="日志文件" value={data.counts.logFiles} />
            <MetricCard label="平台配置" value={data.counts.configuredPlatforms} />
          </div>
        </div>
      </Panel>

      <div className="two-column">
        <Panel title="当前配置摘要">
          <div className="detail-list">
            <KeyValueRow label="默认模型" value={data.config.modelDefault} />
            <KeyValueRow label="提供商" value={data.config.modelProvider} />
            <KeyValueRow label="Base URL" value={data.config.modelBaseUrl ?? '—'} />
            <KeyValueRow label="终端后端" value={data.config.terminalBackend} />
            <KeyValueRow label="工作目录" value={data.config.terminalCwd} />
            <KeyValueRow label="人格" value={data.config.personality} />
            <KeyValueRow
              label="Toolsets"
              value={data.config.toolsets.length ? data.config.toolsets.join(', ') : '—'}
            />
          </div>
        </Panel>

        <Panel title="网关状态">
          {data.gateway ? (
            <div className="detail-list">
              <KeyValueRow
                label="运行状态"
                value={
                  <Pill tone={data.gateway.gatewayState === 'running' ? 'good' : 'warn'}>
                    {data.gateway.gatewayState}
                  </Pill>
                }
              />
              <KeyValueRow label="PID" value={data.gateway.pid ?? '—'} />
              <KeyValueRow label="活跃 Agent" value={data.gateway.activeAgents} />
              <KeyValueRow label="更新时间" value={formatTimestamp(data.gateway.updatedAt)} />
              {data.gateway.platforms.map((platform) => (
                <KeyValueRow
                  key={platform.name}
                  label={platform.name}
                  value={
                    <span>
                      <Pill tone={platform.state === 'connected' ? 'good' : platform.state === 'fatal' ? 'bad' : 'warn'}>
                        {platform.state}
                      </Pill>
                      {platform.errorMessage ? ` ${platform.errorMessage}` : ''}
                    </span>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState title="未检测到运行态" description="尚未读取到 gateway_state.json。" />
          )}
        </Panel>
      </div>

      <div className="two-column">
        <Panel title="最近会话">
          {data.recentSessions.length === 0 ? (
            <EmptyState title="暂无会话" description="先运行一次 Hermes 对话，会话库就会出现。" />
          ) : (
            <div className="list-stack">
              {data.recentSessions.map((session) => (
                <div className="list-card" key={session.id}>
                  <div className="list-card-title">
                    <strong>{session.title || session.preview || session.id}</strong>
                    <Pill>{session.source}</Pill>
                  </div>
                  <p>{session.preview || '无预览文本'}</p>
                  <div className="meta-line">
                    <span>{session.model || '未知模型'}</span>
                    <span>{formatEpoch(session.startedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="记忆文件">
          <div className="list-stack">
            {data.memoryFiles.map((item) => (
              <div className="list-card" key={item.key}>
                <div className="list-card-title">
                  <strong>{item.label}</strong>
                  <Pill tone={item.exists ? 'good' : 'warn'}>
                    {item.exists ? '已存在' : '缺失'}
                  </Pill>
                </div>
                <p>{item.path}</p>
                <div className="meta-line">
                  <span>{item.key}</span>
                  <span>{formatTimestamp(item.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="运行提醒">
        {data.warnings.length === 0 ? (
          <EmptyState title="状态健康" description="当前未发现明显的本地运行风险。" />
        ) : (
          <div className="warning-stack">
            {data.warnings.map((warning) => (
              <div className="warning-item" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        )}
        <pre className="code-block">{data.versionOutput}</pre>
      </Panel>
    </div>
  );
}
