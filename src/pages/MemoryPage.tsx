import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import type { ConfigDocuments, DashboardSnapshot, MemoryFileDetail, MemoryFileSummary } from '../types';
import { Button, ContextBanner, EmptyState, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import { isMemoryPageIntent, type MemoryPageIntent, type PageProps } from './types';

const MEMORY_BLUEPRINT = {
  soul: {
    eyebrow: 'Identity',
    description: 'SOUL.md 是 Hermes 的主身份文件，会进入 system prompt 的最前面一层。',
  },
  memory: {
    eyebrow: 'Persistent',
    description: 'MEMORY.md 用来沉淀长期事实和稳定偏好，是 persistent memory 的主文件。',
  },
  user: {
    eyebrow: 'User Profile',
    description: 'USER.md 用来维护用户画像和交互偏好，受 user_profile_enabled 开关控制。',
  },
} as const;

function directoryOf(path: string) {
  const normalized = path.trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function limitForKey(key: string, summary?: ConfigDocuments['summary'] | null) {
  if (!summary) {
    return null;
  }
  if (key === 'memory') {
    return summary.memoryCharLimit ?? null;
  }
  if (key === 'user') {
    return summary.userCharLimit ?? null;
  }
  return null;
}

function memoryMeta(key: string) {
  return MEMORY_BLUEPRINT[key as keyof typeof MEMORY_BLUEPRINT] ?? MEMORY_BLUEPRINT.soul;
}

export function MemoryPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [items, setItems] = useState<MemoryFileSummary[]>([]);
  const [config, setConfig] = useState<ConfigDocuments | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [investigation, setInvestigation] = useState<MemoryPageIntent | null>(null);
  const [selectedKey, setSelectedKey] = useState('soul');
  const [detail, setDetail] = useState<MemoryFileDetail | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load(nextKey?: string) {
    setLoading(true);
    try {
      const [files, nextConfig, nextSnapshot] = await Promise.all([
        api.listMemoryFiles(profile),
        api.getConfigDocuments(profile),
        api.getDashboardSnapshot(profile),
      ]);
      setItems(files);
      setConfig(nextConfig);
      setSnapshot(nextSnapshot);

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
      await load(selectedKey);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    try {
      const result = await api.openInFinder({ path, revealInFinder });
      notify(
        result.success ? 'success' : 'error',
        result.success ? `${label} 已在 Finder 中打开。` : `${label} 打开失败，请检查命令输出。`,
      );
    } catch (reason) {
      notify('error', String(reason));
    }
  }

  useEffect(() => {
    void load();
  }, [profile]);

  useEffect(() => {
    if (!isMemoryPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    if (pageIntent.selectedKey) {
      void selectItem(pageIntent.selectedKey);
    }
    notify('info', `${pageIntent.headline} 已带入记忆工作台。`);
    consumePageIntent();
  }, [consumePageIntent, notify, pageIntent]);

  const summary = config?.summary ?? null;
  const selectedSummary = useMemo(
    () => items.find((item) => item.key === selectedKey) ?? null,
    [items, selectedKey],
  );
  const currentMeta = memoryMeta(selectedKey);
  const providerLabel = summary?.memoryProvider || 'builtin-file';
  const selectedLimit = limitForKey(selectedKey, summary);
  const remainingChars = selectedLimit == null ? null : selectedLimit - content.length;
  const dirty = detail ? content !== detail.content : false;
  const lineCount = content ? content.split(/\r?\n/).length : 0;
  const readyCount = items.filter((item) => item.exists).length;
  const warnings: string[] = [];

  if (summary?.memoryEnabled === false) {
    warnings.push('memory.memory_enabled 当前为 false，Hermes 运行时不会稳定使用文件记忆闭环。');
  }
  if (selectedKey === 'user' && summary?.userProfileEnabled === false) {
    warnings.push('当前 profile 关闭了 USER 画像，USER.md 即使存在也不会完整参与用户建模。');
  }
  if (selectedKey !== 'soul' && remainingChars != null && remainingChars < 0) {
    warnings.push(`${detail?.label ?? selectedKey} 已超出当前配置的字符预算，建议收缩内容或提高上限。`);
  }
  if (!selectedSummary?.exists) {
    warnings.push(`${detail?.label ?? selectedKey} 当前缺失，首次保存后才会形成稳定基线。`);
  }
  if ((snapshot?.counts.sessions ?? 0) === 0) {
    warnings.push('当前没有历史会话，记忆文件虽然可编辑，但还没有经过真实会话链路验证。');
  }
  if (snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push('gateway 当前未运行，消息平台侧的记忆注入效果还没有被验证。');
  }

  if (loading && !detail) {
    return <LoadingState label="正在构建 Hermes 记忆编排工作区。" />;
  }

  return (
    <div className="page-stack">
      <Panel
        title="记忆编排台"
        subtitle="参考 ClawPanel 的工作台组织方式，但这里聚焦 Hermes 自身的 persistent memory：`SOUL.md / MEMORY.md / USER.md / memory.*`。"
        aside={(
          <Toolbar>
            <Button onClick={() => void load(selectedKey)}>刷新</Button>
            <Button onClick={() => navigate('config')}>进入配置页</Button>
            <Button onClick={() => navigate('diagnostics')}>进入诊断页</Button>
          </Toolbar>
        )}
      >
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-title">从文件编辑升级到记忆运行态</p>
            <p className="hero-subtitle">
              Hermes 的记忆不只有三个 Markdown 文件，还包括 `memory.provider`、`user_profile_enabled` 和字符预算。
              这个页面把这些配置和文件状态放到一起看，方便你判断“记忆是否真的在工作”。
            </p>
            <div className="detail-list">
              <KeyValueRow label="当前 Profile" value={profile} />
              <KeyValueRow label="记忆 Provider" value={providerLabel} />
              <KeyValueRow label="终端后端" value={summary?.terminalBackend ?? '—'} />
              <KeyValueRow
                label="Toolsets"
                value={summary?.toolsets.length ? summary.toolsets.join(', ') : '—'}
              />
              <KeyValueRow label="Gateway" value={snapshot?.gateway?.gatewayState ?? '未检测到'} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="记忆槽位" value={`${readyCount}/${items.length || 3}`} hint="SOUL / MEMORY / USER 是否齐备" />
            <MetricCard label="Memory" value={summary?.memoryEnabled ? 'On' : 'Off'} hint="memory.memory_enabled" />
            <MetricCard label="User Profile" value={summary?.userProfileEnabled ? 'On' : 'Off'} hint="user_profile_enabled" />
            <MetricCard
              label="字符预算"
              value={`${summary?.memoryCharLimit ?? '—'} / ${summary?.userCharLimit ?? '—'}`}
              hint="MEMORY / USER 上限"
            />
          </div>
        </div>
      </Panel>

      {investigation ? (
        <ContextBanner
          label="Session Drilldown"
          title={investigation.headline}
          description={investigation.description}
          meta={(
            <div className="pill-row">
              <Pill tone="warn">{investigation.selectedKey ?? selectedKey}</Pill>
              <Pill>{investigation.context?.source ?? 'sessions'}</Pill>
            </div>
          )}
          actions={(
            <Toolbar>
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>回到会话页</Button>
              <Button onClick={() => navigate('config')}>核对配置</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="two-column wide-left">
        <Panel
          title="记忆槽位"
          subtitle="左边选文件，右边看运行态。这里的三个槽位对应 Hermes 官方文档中的记忆层次。"
        >
          <div className="list-stack">
            {items.map((item) => {
              const meta = memoryMeta(item.key);
              const runtimeLimit = limitForKey(item.key, summary);
              const userProfileOff = item.key === 'user' && summary?.userProfileEnabled === false;

              return (
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
                  <p>{meta.description}</p>
                  <div className="pill-row">
                    <Pill tone="neutral">{meta.eyebrow}</Pill>
                    {runtimeLimit != null ? <Pill tone="neutral">{runtimeLimit} chars</Pill> : null}
                    {userProfileOff ? <Pill tone="warn">runtime off</Pill> : null}
                  </div>
                  <div className="meta-line">
                    <span>{item.key}</span>
                    <span>{formatTimestamp(item.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="运行态摘要"
          subtitle="文件是否存在只是第一层，真正影响记忆闭环的是 provider、开关、预算、会话和 gateway。"
        >
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Provider</strong>
                <Pill tone={providerLabel === 'builtin-file' ? 'good' : 'neutral'}>{providerLabel}</Pill>
              </div>
              <p>空值表示 Hermes 使用内建文件记忆；非空值通常意味着还叠加了插件或外部 provider。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Memory Switch</strong>
                <Pill tone={summary?.memoryEnabled ? 'good' : 'warn'}>
                  {summary?.memoryEnabled ? '已开启' : '已关闭'}
                </Pill>
              </div>
              <p>关闭后，Markdown 文件仍可编辑，但不会稳定参与 Hermes 的运行态记忆回路。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>User Profile</strong>
                <Pill tone={summary?.userProfileEnabled ? 'good' : 'warn'}>
                  {summary?.userProfileEnabled ? '已开启' : '已关闭'}
                </Pill>
              </div>
              <p>USER.md 是否参与用户建模，直接由这个开关决定。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Gateway / Sessions</strong>
                <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {snapshot?.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p>{snapshot?.counts.sessions ?? 0} 条会话记录，可用来验证记忆是否已经进入真实工作流。</p>
            </section>
          </div>

          <Toolbar>
            <Button
              onClick={() => config && void openInFinder(config.hermesHome, 'Hermes Home')}
              disabled={!config}
            >
              打开 Home
            </Button>
            <Button
              onClick={() => detail?.path && void openInFinder(detail.path, detail.label, true)}
              disabled={!detail?.exists}
            >
              定位当前文件
            </Button>
            <Button
              onClick={() => detail?.path && void openInFinder(directoryOf(detail.path), '记忆目录')}
              disabled={!detail?.path}
            >
              打开所在目录
            </Button>
            <Button onClick={() => navigate('skills')}>进入技能页</Button>
          </Toolbar>

          {warnings.length > 0 ? (
            <div className="warning-stack">
              {warnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <p className="helper-text">
              当前没有明显记忆侧风险。下一步更适合回到诊断页执行 `status / doctor`，确认运行态和文件状态一致。
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title={detail?.label ?? '记忆内容'}
        subtitle={currentMeta.description}
        aside={(
          <Toolbar>
            {dirty ? <Pill tone="warn">未保存</Pill> : null}
            {remainingChars != null ? (
              <Pill tone={remainingChars < 0 ? 'bad' : remainingChars < 160 ? 'warn' : 'good'}>
                剩余 {remainingChars}
              </Pill>
            ) : null}
            <Button kind="primary" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存文件'}
            </Button>
          </Toolbar>
        )}
      >
        {detail ? (
          <>
            <div className="detail-list compact">
              <KeyValueRow label="路径" value={detail.path} />
              <KeyValueRow label="存在" value={String(detail.exists)} />
              <KeyValueRow label="最近修改" value={formatTimestamp(selectedSummary?.updatedAt)} />
              <KeyValueRow label="字符数" value={content.length} />
              <KeyValueRow label="行数" value={lineCount} />
              <KeyValueRow label="字符预算" value={selectedLimit ?? '—'} />
              <KeyValueRow label="记忆 Provider" value={providerLabel} />
            </div>
            <textarea
              className="editor large"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              spellCheck={false}
            />
          </>
        ) : (
          <EmptyState title="未选择文件" description="从上面的记忆槽位里选择一个文件开始查看或编辑。" />
        )}
      </Panel>
    </div>
  );
}
