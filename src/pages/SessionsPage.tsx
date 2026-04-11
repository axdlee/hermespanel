import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { formatEpoch, truncate } from '../lib/format';
import type { SessionDetail, SessionRecord } from '../types';
import { EmptyState, LoadingState, Panel, Pill, Toolbar, Button } from '../components/ui';
import type { PageProps } from './types';

export function SessionsPage({ notify, profile }: PageProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selected, setSelected] = useState<SessionDetail | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadList() {
    setLoading(true);
    try {
      const next = await api.listSessions(120, profile);
      setSessions(next);
      const fallbackId = next.find((item) => item.id === selected?.session.id)?.id ?? next[0]?.id;
      if (fallbackId) {
        const detail = await api.getSessionDetail(fallbackId, profile);
        setSelected(detail);
      } else {
        setSelected(null);
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function selectSession(sessionId: string) {
    try {
      const detail = await api.getSessionDetail(sessionId, profile);
      setSelected(detail);
    } catch (reason) {
      notify('error', String(reason));
    }
  }

  useEffect(() => {
    void loadList();
  }, [profile]);

  const filtered = sessions.filter((item) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return [item.id, item.title ?? '', item.preview, item.source, item.model ?? '']
      .join(' ')
      .toLowerCase()
      .includes(term);
  });

  if (loading) {
    return <LoadingState label="正在读取会话数据库。" />;
  }

  return (
    <div className="two-column wide-left">
      <Panel
        title="会话浏览"
        subtitle="读取 `state.db`，只做查询展示，不直接篡改会话数据。"
        aside={
          <Toolbar>
            <input
              className="search-input"
              placeholder="搜索标题、预览、模型、来源"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button onClick={() => void loadList()}>刷新</Button>
          </Toolbar>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState title="没有匹配会话" description="换个关键词试试，或先让 Hermes 产生一些会话。" />
        ) : (
          <div className="list-stack">
            {filtered.map((session) => (
              <button
                className={`list-card session-card ${selected?.session.id === session.id ? 'selected' : ''}`}
                key={session.id}
                onClick={() => void selectSession(session.id)}
                type="button"
              >
                <div className="list-card-title">
                  <strong>{session.title || truncate(session.preview || session.id, 44)}</strong>
                  <Pill>{session.source}</Pill>
                </div>
                <p>{truncate(session.preview || '无预览文本', 88)}</p>
                <div className="meta-line">
                  <span>{session.model || '未知模型'}</span>
                  <span>{formatEpoch(session.startedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="会话详情">
        {selected ? (
          <div className="page-stack">
            <div className="detail-list">
              <div className="key-value-row"><span>ID</span><strong>{selected.session.id}</strong></div>
              <div className="key-value-row"><span>标题</span><strong>{selected.session.title || '—'}</strong></div>
              <div className="key-value-row"><span>来源</span><strong>{selected.session.source}</strong></div>
              <div className="key-value-row"><span>模型</span><strong>{selected.session.model || '—'}</strong></div>
              <div className="key-value-row"><span>开始时间</span><strong>{formatEpoch(selected.session.startedAt)}</strong></div>
            </div>

            <div className="transcript">
              {selected.messages.map((message) => (
                <article className={`message-bubble role-${message.role}`} key={message.id}>
                  <div className="message-meta">
                    <span>{message.role}</span>
                    <span>{formatEpoch(message.timestamp)}</span>
                  </div>
                  {message.toolName && <p className="message-tool">工具: {message.toolName}</p>}
                  <pre>{message.content || '(空内容)'}</pre>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="未选择会话" description="从左侧列表选择一条会话查看详细消息。" />
        )}
      </Panel>
    </div>
  );
}
