import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import type { LogReadResult } from '../types';
import { Button, EmptyState, LoadingState, Panel, Toolbar } from '../components/ui';
import type { PageProps } from './types';

const LOG_OPTIONS = ['agent', 'errors', 'gateway', 'gateway.error'];

export function LogsPage({ notify, profile }: PageProps) {
  const [logName, setLogName] = useState('agent');
  const [level, setLevel] = useState('');
  const [contains, setContains] = useState('');
  const [limit, setLimit] = useState('120');
  const [data, setData] = useState<LogReadResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const next = await api.readLog(
        logName,
        Number(limit) || 120,
        level || undefined,
        contains || undefined,
        profile,
      );
      setData(next);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profile]);

  if (loading && !data) {
    return <LoadingState label="正在读取日志文件。" />;
  }

  return (
    <Panel
      title="日志查看"
      subtitle="直接读取 Hermes 本地日志目录，支持简单级别过滤和关键词过滤。"
      aside={
        <Toolbar>
          <select className="select-input" value={logName} onChange={(event) => setLogName(event.target.value)}>
            {LOG_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input className="search-input narrow" placeholder="level" value={level} onChange={(event) => setLevel(event.target.value)} />
          <input className="search-input" placeholder="包含关键词" value={contains} onChange={(event) => setContains(event.target.value)} />
          <input className="search-input tiny" placeholder="120" value={limit} onChange={(event) => setLimit(event.target.value)} />
          <Button onClick={() => void load()}>读取</Button>
        </Toolbar>
      }
    >
      {data ? (
        <>
          <div className="detail-list compact">
            <div className="key-value-row"><span>文件</span><strong>{data.filePath}</strong></div>
            <div className="key-value-row"><span>返回行数</span><strong>{data.lines.length}</strong></div>
          </div>
          <pre className="code-block tall">{data.lines.join('\n') || '没有匹配到日志行。'}</pre>
        </>
      ) : (
        <EmptyState title="暂无日志" description="点击上方“读取”开始加载日志。" />
      )}
    </Panel>
  );
}
