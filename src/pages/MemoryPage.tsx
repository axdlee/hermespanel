import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import type { MemoryFileDetail, MemoryFileSummary } from '../types';
import { Button, EmptyState, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import type { PageProps } from './types';

export function MemoryPage({ notify, profile }: PageProps) {
  const [items, setItems] = useState<MemoryFileSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState('soul');
  const [detail, setDetail] = useState<MemoryFileDetail | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadList(nextKey?: string) {
    setLoading(true);
    try {
      const files = await api.listMemoryFiles(profile);
      setItems(files);
      const chosen = nextKey ?? selectedKey ?? files[0]?.key ?? 'soul';
      setSelectedKey(chosen);
      const nextDetail = await api.readMemoryFile(chosen, profile);
      setDetail(nextDetail);
      setContent(nextDetail.content);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function selectItem(key: string) {
    setSelectedKey(key);
    try {
      const next = await api.readMemoryFile(key, profile);
      setDetail(next);
      setContent(next.content);
    } catch (reason) {
      notify('error', String(reason));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.writeMemoryFile(selectedKey, content, profile);
      notify('success', `${selectedKey} 已保存。`);
      await loadList(selectedKey);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, [profile]);

  if (loading && !detail) {
    return <LoadingState label="正在读取记忆文件。" />;
  }

  return (
    <div className="two-column wide-left">
      <Panel
        title="记忆文件"
        subtitle="编辑 SOUL / MEMORY / USER 三类长期文件。"
        aside={
          <Toolbar>
            <Button onClick={() => void loadList(selectedKey)}>刷新</Button>
          </Toolbar>
        }
      >
        <div className="list-stack">
          {items.map((item) => (
            <button
              type="button"
              className={`list-card session-card ${selectedKey === item.key ? 'selected' : ''}`}
              key={item.key}
              onClick={() => void selectItem(item.key)}
            >
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
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title={detail?.label ?? '记忆内容'}
        aside={
          <Toolbar>
            <Button kind="primary" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存文件'}
            </Button>
          </Toolbar>
        }
      >
        {detail ? (
          <>
            <div className="detail-list compact">
              <div className="key-value-row"><span>路径</span><strong>{detail.path}</strong></div>
              <div className="key-value-row"><span>存在</span><strong>{String(detail.exists)}</strong></div>
            </div>
            <textarea
              className="editor large"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              spellCheck={false}
            />
          </>
        ) : (
          <EmptyState title="未选择文件" description="从左侧选择一类记忆文件开始编辑。" />
        )}
      </Panel>
    </div>
  );
}
