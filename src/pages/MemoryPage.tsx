import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, InfoTip, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import { formatTimestamp } from '../lib/format';
import type {
  CommandRunResult,
  ConfigDocuments,
  DashboardSnapshot,
  ExtensionsSnapshot,
  InstallationSnapshot,
  MemoryFileDetail,
  MemoryFileSummary,
} from '../types';
import { isMemoryPageIntent, type MemoryPageIntent, type PageProps } from './types';

type MemoryTabKey = 'overview' | 'editor' | 'runtime';

const MEMORY_TABS: Array<{ key: MemoryTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看槽位、provider 和当前链路判断。' },
  { key: 'editor', label: '编辑槽位', hint: '集中编辑 SOUL / MEMORY / USER 槽位内容。' },
  { key: 'runtime', label: 'Provider 与材料', hint: '低频接管、插件操作和原始输出都收在这里。' },
];

const MEMORY_BLUEPRINT = {
  soul: {
    eyebrow: 'Identity',
    description: '系统身份层。',
  },
  memory: {
    eyebrow: 'Persistent',
    description: '长期事实与稳定偏好。',
  },
  user: {
    eyebrow: 'User Profile',
    description: '用户画像与交互偏好。',
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

function commandOutput(result: CommandRunResult | null) {
  if (!result) {
    return '';
  }
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n') || '命令没有返回输出。';
}

export function MemoryPage({ notify, profile, navigate, pageIntent, consumePageIntent }: PageProps) {
  const [items, setItems] = useState<MemoryFileSummary[]>([]);
  const [config, setConfig] = useState<ConfigDocuments | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [investigation, setInvestigation] = useState<MemoryPageIntent | null>(null);
  const [selectedKey, setSelectedKey] = useState('soul');
  const [detail, setDetail] = useState<MemoryFileDetail | null>(null);
  const [content, setContent] = useState('');
  const [pluginInput, setPluginInput] = useState('');
  const [runningDesktopAction, setRunningDesktopAction] = useState<string | null>(null);
  const [lastCommandLabel, setLastCommandLabel] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryTabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'save' | 'verify' | null>(null);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);

  async function load(nextKey?: string) {
    setLoading(true);
    try {
      const [files, nextConfig, nextSnapshot, nextInstallation, nextExtensions] = await Promise.all([
        api.listMemoryFiles(profile),
        api.getConfigDocuments(profile),
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.getExtensionsSnapshot(profile),
      ]);

      setItems(files);
      setConfig(nextConfig);
      setSnapshot(nextSnapshot);
      setInstallation(nextInstallation);
      setExtensions(nextExtensions);
      setPluginInput((current) =>
        current.trim()
        || nextExtensions.plugins.items[0]
        || nextExtensions.memoryRuntime.installedPlugins[0]?.name
        || '',
      );

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

  async function runMemoryStatus(options?: { quiet?: boolean }) {
    setRunningDiagnostic(true);
    try {
      const result = await api.runDiagnostic('memory-status', profile);
      setLastCommandLabel('记忆状态体检');
      setLastCommand(result);
      if (!options?.quiet) {
        notify(result.success ? 'success' : 'error', result.success ? '记忆状态体检已完成。' : '记忆状态体检失败，请查看输出。');
      }
      await load(selectedKey);
      return result;
    } catch (reason) {
      notify('error', String(reason));
      return null;
    } finally {
      setRunningDiagnostic(false);
    }
  }

  async function save(verify = false) {
    setSaving(verify ? 'verify' : 'save');
    try {
      await api.writeMemoryFile(selectedKey, content, profile);
      await load(selectedKey);
      notify('success', verify ? `${selectedKey} 已保存，开始体检记忆运行态。` : `${selectedKey} 已保存。`);
      if (verify) {
        await runMemoryStatus({ quiet: true });
      }
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `memory:finder:${label}`,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastCommandLabel(resultLabel);
        setLastCommand(result);
      },
      path,
      revealInFinder,
      setBusy: setRunningDesktopAction,
    });
  }

  async function openInTerminal(actionKey: string, label: string, command: string, confirmMessage?: string) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastCommandLabel(resultLabel);
        setLastCommand(result);
      },
      profile,
      setBusy: setRunningDesktopAction,
      workingDirectory: installation?.hermesHomeExists ? installation.hermesHome : null,
    });
  }

  useEffect(() => {
    setLastCommand(null);
    setLastCommandLabel(null);
    setActiveTab('overview');
    void load();
  }, [profile]);

  useEffect(() => {
    if (!isMemoryPageIntent(pageIntent)) {
      return;
    }

    setInvestigation(pageIntent);
    setActiveTab(pageIntent.selectedKey ? 'editor' : 'overview');
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
  const runtimeProviderLabel = extensions?.memoryRuntime.provider || providerLabel;
  const selectedLimit = limitForKey(selectedKey, summary);
  const remainingChars = selectedLimit == null ? null : selectedLimit - content.length;
  const dirty = detail ? content !== detail.content : false;
  const lineCount = content ? content.split(/\r?\n/).length : 0;
  const readyCount = items.filter((item) => item.exists).length;
  const pluginTerminalName = pluginInput.trim();
  const warnings: string[] = [];

  if (summary?.memoryEnabled === false) {
    warnings.push('memory.memory_enabled 为 false，文件可编辑但运行态不会稳定使用。');
  }
  if (selectedKey === 'user' && summary?.userProfileEnabled === false) {
    warnings.push('USER 画像当前关闭，USER.md 不会完整进入用户建模。');
  }
  if (selectedKey !== 'soul' && remainingChars != null && remainingChars < 0) {
    warnings.push(`${detail?.label ?? selectedKey} 已超出字符预算。`);
  }
  if (!selectedSummary?.exists) {
    warnings.push(`${detail?.label ?? selectedKey} 当前缺失，首次保存后才会落盘。`);
  }
  if ((snapshot?.counts.sessions ?? 0) === 0) {
    warnings.push('当前还没有历史会话，记忆链路尚未经过真实使用验证。');
  }
  if (snapshot?.gateway?.gatewayState !== 'running') {
    warnings.push('Gateway 未运行，消息平台侧记忆注入尚未验证。');
  }
  if (
    summary?.memoryProvider
    && extensions
    && !runtimeProviderLabel.toLowerCase().includes(summary.memoryProvider.toLowerCase())
  ) {
    warnings.push(`配置声明 provider=${summary.memoryProvider}，运行态回报为 ${runtimeProviderLabel}。`);
  }

  if (loading || !config || !installation || !extensions) {
    return <LoadingState label="正在构建 Hermes 记忆工作台。" />;
  }

  const actionBusy = runningDesktopAction !== null || saving !== null || runningDiagnostic;
  const outputLabel = lastCommandLabel ?? 'memory status';
  const outputText = lastCommand ? commandOutput(lastCommand) : extensions.memoryRuntime.rawOutput || '暂无输出';
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);
  const overviewSection = (
    <>
      <Panel
        title="推荐下一步"
        subtitle="先选槽位、再保存并校验，低频 Provider 接管和原始输出都已经后置到后面的子模块。"
      >
        <div className="list-stack">
          <div className="list-card">
            <div className="list-card-title">
              <strong>先确认当前要维护的槽位</strong>
              <Pill tone={selectedSummary?.exists ? 'good' : 'warn'}>
                {detail?.label ?? selectedKey}
              </Pill>
            </div>
            <p>{detail ? `${detail.label} ${detail.exists ? '已经落盘' : '还未落盘'}，现在可以直接继续编辑。` : '先选一个槽位，再决定要不要进入编辑器。'}</p>
            <div className="meta-line">
              <span>{currentMeta.eyebrow}</span>
              <span>{formatTimestamp(selectedSummary?.updatedAt)}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => setActiveTab('editor')}>
                编辑当前槽位
              </Button>
              <Button onClick={() => detail?.path && void openInFinder(detail.path, detail.label, true)} disabled={!detail?.path || actionBusy}>
                定位当前文件
              </Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>保存后优先做一次记忆体检</strong>
              <Pill tone={dirty ? 'warn' : warnings.length > 0 ? 'warn' : 'good'}>
                {dirty ? '有未保存内容' : '可以直接体检'}
              </Pill>
            </div>
            <p>先保存并校验，就能确认文件层、Provider 和运行态是不是对得上。</p>
            <div className="meta-line">
              <span>{content.length} 字符 / {lineCount} 行</span>
              <span>{remainingChars == null ? '无预算限制' : `剩余 ${remainingChars}`}</span>
            </div>
            <Toolbar>
              <Button
                kind="primary"
                onClick={() => (dirty ? void save(true) : void runMemoryStatus())}
                disabled={actionBusy}
              >
                {dirty ? (saving === 'verify' ? '保存并校验…' : '保存并校验') : (runningDiagnostic ? '体检中…' : '运行记忆体检')}
              </Button>
              <Button onClick={() => setActiveTab('runtime')}>
                打开 Provider 与材料
              </Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>Provider、开关和用户画像优先在客户端里核对</strong>
              <Pill tone={providerLabel === runtimeProviderLabel ? 'good' : 'warn'}>
                {runtimeProviderLabel}
              </Pill>
            </div>
            <p>记忆 Provider、memory 开关和 USER 画像都应先在客户端里确认，再决定是否进入命令接管层。</p>
            <div className="meta-line">
              <span>{summary?.memoryEnabled ? 'Memory 已开启' : 'Memory 已关闭'}</span>
              <span>{summary?.userProfileEnabled ? 'User Profile 已开启' : 'User Profile 已关闭'}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => navigate('config')}>
                进入配置中心
              </Button>
              <Button onClick={() => setActiveTab('runtime')}>
                查看运行态材料
              </Button>
            </Toolbar>
          </div>
        </div>
      </Panel>

      <div className="two-column wide-left">
        <Panel
          title="槽位速览"
          subtitle="只保留 SOUL / MEMORY / USER 的关键状态和编辑入口，不把整个编辑器直接堆到首页。"
        >
          <div className="list-stack">
            {items.map((item) => {
              const meta = memoryMeta(item.key);
              const runtimeLimit = limitForKey(item.key, summary);
              const userProfileOff = item.key === 'user' && summary?.userProfileEnabled === false;
              const isCurrent = selectedKey === item.key;

              return (
                <div className="list-card" key={item.key}>
                  <div className="list-card-title">
                    <strong>{item.label}</strong>
                    <div className="pill-row">
                      <Pill tone={item.exists ? 'good' : 'warn'}>
                        {item.exists ? '已存在' : '缺失'}
                      </Pill>
                      {isCurrent ? <Pill tone="neutral">当前</Pill> : null}
                    </div>
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
                  <Toolbar>
                    <Button
                      kind="primary"
                      onClick={() => {
                        void selectItem(item.key);
                        setActiveTab('editor');
                      }}
                    >
                      编辑 {item.label}
                    </Button>
                    <Button onClick={() => item.key !== selectedKey && void selectItem(item.key)}>
                      设为当前
                    </Button>
                  </Toolbar>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="当前判断"
          subtitle="把 provider、预算、会话和网关状态收成摘要，新手先看这里就能判断记忆链路是不是通的。"
        >
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Provider</strong>
                <Pill tone={providerLabel === runtimeProviderLabel ? 'good' : 'warn'}>
                  {runtimeProviderLabel}
                </Pill>
              </div>
              <p>配置声明 {providerLabel}，运行态回报 {runtimeProviderLabel}。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Memory Switch</strong>
                <Pill tone={summary?.memoryEnabled ? 'good' : 'warn'}>
                  {summary?.memoryEnabled ? '已开启' : '已关闭'}
                </Pill>
              </div>
              <p>关闭后文件仍可编辑，但不会稳定参与记忆闭环。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>User Profile</strong>
                <Pill tone={summary?.userProfileEnabled ? 'good' : 'warn'}>
                  {summary?.userProfileEnabled ? '已开启' : '已关闭'}
                </Pill>
              </div>
              <p>USER.md 是否参与建模，完全由这个开关决定。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>当前预算</strong>
                <Pill tone={remainingChars != null && remainingChars < 0 ? 'bad' : remainingChars != null && remainingChars < 160 ? 'warn' : 'good'}>
                  {remainingChars ?? '—'}
                </Pill>
              </div>
              <p>{detail?.label ?? selectedKey} 当前剩余 {remainingChars ?? '—'} 字符。</p>
            </section>
          </div>

          <div className="detail-list compact top-gap">
            <KeyValueRow label="当前槽位" value={detail?.label ?? selectedKey} />
            <KeyValueRow label="当前 Profile" value={profile} />
            <KeyValueRow label="会话数" value={snapshot?.counts.sessions ?? 0} />
            <KeyValueRow label="Gateway" value={snapshot?.gateway?.gatewayState ?? '未检测到'} />
            <KeyValueRow label="插件数" value={extensions.plugins.installedCount} />
            <KeyValueRow label="字符数 / 行数" value={`${content.length} / ${lineCount}`} />
          </div>

          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack">
                {overviewWarnings.map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
              {remainingWarningCount > 0 ? (
                <p className="helper-text top-gap">其余 {remainingWarningCount} 条提醒继续收在“编辑槽位”和“Provider 与材料”里。</p>
              ) : null}
            </>
          ) : (
            <EmptyState title="当前没有额外提醒" description="记忆链路看起来是连通的，可以继续进入编辑器完善内容。" />
          )}
        </Panel>
      </div>
    </>
  );

  const editorSection = (
    <>
      <div className="two-column wide-left">
        <Panel
          title="记忆槽位"
          subtitle="SOUL / MEMORY / USER"
          tip={<InfoTip content="槽位只负责文件层；是否真正生效，还要看 provider、开关、预算和会话链路。"/>}
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
          title={detail?.label ?? '记忆内容'}
          subtitle={currentMeta.description}
          tip={<InfoTip content="保存后不会直接改 Hermes 本体，只会更新当前 profile 下的记忆文件。建议优先使用“保存并校验”，确认运行态与文件态一致。"/>}
          aside={(
            <Toolbar>
              {dirty ? <Pill tone="warn">未保存</Pill> : null}
              {remainingChars != null ? (
                <Pill tone={remainingChars < 0 ? 'bad' : remainingChars < 160 ? 'warn' : 'good'}>
                  剩余 {remainingChars}
                </Pill>
              ) : null}
              <Button onClick={() => void save(false)} disabled={actionBusy}>
                {saving === 'save' ? '保存中…' : '仅保存'}
              </Button>
              <Button kind="primary" onClick={() => void save(true)} disabled={actionBusy}>
                {saving === 'verify' ? '保存并校验…' : '保存并校验'}
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
                <KeyValueRow label="Provider" value={runtimeProviderLabel} />
              </div>
              <textarea
                className="editor large"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
              />
            </>
          ) : (
            <EmptyState title="未选择文件" description="从左侧槽位中选择一个文件开始编辑。" />
          )}
        </Panel>
      </div>
    </>
  );

  const runtimeSection = (
    <>
      <Panel
        title="记忆接管动作"
        subtitle="setup、off、plugins、Finder"
        tip={(
          <InfoTip content="只保留闭环动作，不在页内重复摆满跨页导航。真正需要的说明交给悬浮提示和命令回显。"/>
        )}
      >
        <div className="control-card-grid">
          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Provider</p>
                <h3 className="action-card-title">记忆 Provider</h3>
              </div>
              <Pill tone={summary?.memoryEnabled ? 'good' : 'warn'}>
                {summary?.memoryEnabled ? 'Enabled' : 'Disabled'}
              </Pill>
            </div>
            <p className="command-line">hermes memory setup · hermes memory status · hermes memory off</p>
            <Toolbar>
              <Button
                kind="primary"
                onClick={() => void openInTerminal('memory:setup', '记忆 Provider', 'hermes memory setup')}
                disabled={actionBusy || !installation.binaryFound}
              >
                {runningDesktopAction === 'memory:setup' ? 'Provider…' : 'Provider 向导'}
              </Button>
              <Button onClick={() => void runMemoryStatus()} disabled={actionBusy}>
                {runningDiagnostic ? '体检中…' : '状态体检'}
              </Button>
              <Button
                kind="danger"
                onClick={() => void openInTerminal('memory:off', '关闭记忆', 'hermes memory off', '确定关闭当前 profile 的记忆功能吗？')}
                disabled={actionBusy || !installation.binaryFound}
              >
                {runningDesktopAction === 'memory:off' ? '关闭中…' : '关闭记忆'}
              </Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Plugins</p>
                <h3 className="action-card-title">插件与扩展 Provider</h3>
              </div>
              <Pill tone={extensions.plugins.installedCount > 0 ? 'good' : 'neutral'}>
                {extensions.plugins.installedCount > 0 ? `${extensions.plugins.installedCount} 个` : '未安装'}
              </Pill>
            </div>
            <label className="field-stack">
              <span>插件名</span>
              <input
                className="search-input"
                value={pluginInput}
                onChange={(event) => setPluginInput(event.target.value)}
                placeholder="byterover / owner/repo"
                disabled={actionBusy}
              />
            </label>
            <p className="command-line">
              {pluginTerminalName
                ? `hermes plugins install ${pluginTerminalName} · hermes plugins update ${pluginTerminalName} · hermes plugins remove ${pluginTerminalName}`
                : 'hermes plugins · 输入插件名后可 install / update / remove'}
            </p>
            <Toolbar>
              <Button
                onClick={() => void openInTerminal('memory:plugins-panel', '插件面板', 'hermes plugins')}
                disabled={actionBusy || !installation.binaryFound}
              >
                {runningDesktopAction === 'memory:plugins-panel' ? '插件面板…' : '插件面板'}
              </Button>
              <Button
                kind="primary"
                onClick={() => void openInTerminal('memory:plugin-install', '安装插件', `hermes plugins install ${pluginTerminalName}`)}
                disabled={actionBusy || !installation.binaryFound || !pluginTerminalName}
              >
                {runningDesktopAction === 'memory:plugin-install' ? '安装中…' : '安装'}
              </Button>
              <Button
                onClick={() => void openInTerminal('memory:plugin-update', '更新插件', `hermes plugins update ${pluginTerminalName}`)}
                disabled={actionBusy || !installation.binaryFound || !pluginTerminalName}
              >
                {runningDesktopAction === 'memory:plugin-update' ? '更新中…' : '更新'}
              </Button>
              <Button
                kind="danger"
                onClick={() => void openInTerminal('memory:plugin-remove', '移除插件', `hermes plugins remove ${pluginTerminalName}`, `确定移除插件 ${pluginTerminalName || ''} 吗？`)}
                disabled={actionBusy || !installation.binaryFound || !pluginTerminalName}
              >
                {runningDesktopAction === 'memory:plugin-remove' ? '移除中…' : '移除'}
              </Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Workspace</p>
                <h3 className="action-card-title">记忆物料</h3>
              </div>
              <Pill tone={detail?.exists ? 'good' : 'warn'}>
                {detail?.exists ? '已落盘' : '未落盘'}
              </Pill>
            </div>
            <p className="command-line">{detail?.path || config.hermesHome}</p>
            <Toolbar>
              <Button onClick={() => void openInFinder(config.hermesHome, 'Hermes Home')} disabled={actionBusy}>
                打开 Home
              </Button>
              <Button onClick={() => detail?.path && void openInFinder(detail.path, detail.label, true)} disabled={actionBusy || !detail?.path}>
                定位当前文件
              </Button>
              <Button onClick={() => detail?.path && void openInFinder(directoryOf(detail.path), '记忆目录')} disabled={actionBusy || !detail?.path}>
                打开目录
              </Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Runtime</p>
                <h3 className="action-card-title">运行态信号</h3>
              </div>
              <Pill tone={warnings.length === 0 ? 'good' : 'warn'}>
                {warnings.length === 0 ? '稳定' : `${warnings.length} 条`}
              </Pill>
            </div>
            <p className="command-line">
              provider {runtimeProviderLabel} · sessions {snapshot?.counts.sessions ?? 0} · gateway {snapshot?.gateway?.gatewayState ?? 'unknown'}
            </p>
            {warnings.length > 0 ? (
              <div className="warning-stack">
                {warnings.slice(0, 2).map((warning) => (
                  <div className="warning-item" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
            ) : (
              <p className="helper-text">当前没有明显的记忆侧阻塞项。</p>
            )}
          </section>
        </div>
      </Panel>

      <Panel
        title="运行态与回显"
        subtitle="provider、预算、原始输出"
        tip={<InfoTip content="这里保留最近一次记忆命令或 memory status 的真实输出，方便你对照结构化卡片，避免再跳到别页找上下文。"/>}
      >
        <div className="health-grid">
          <section className="health-card">
            <div className="health-card-header">
              <strong>Provider</strong>
              <Pill tone={runtimeProviderLabel === 'builtin-file' ? 'good' : 'neutral'}>{runtimeProviderLabel}</Pill>
            </div>
            <p>配置声明 {providerLabel}，运行态回报 {runtimeProviderLabel}。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Memory Switch</strong>
              <Pill tone={summary?.memoryEnabled ? 'good' : 'warn'}>
                {summary?.memoryEnabled ? '已开启' : '已关闭'}
              </Pill>
            </div>
            <p>关闭后文件仍可编辑，但不会稳定参与记忆闭环。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>User Profile</strong>
              <Pill tone={summary?.userProfileEnabled ? 'good' : 'warn'}>
                {summary?.userProfileEnabled ? '已开启' : '已关闭'}
              </Pill>
            </div>
            <p>USER.md 是否参与建模，完全由这个开关决定。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Budget</strong>
              <Pill tone={remainingChars != null && remainingChars < 0 ? 'bad' : 'good'}>
                {selectedLimit ?? '—'}
              </Pill>
            </div>
            <p>当前编辑对象剩余 {remainingChars ?? '—'} 字符。</p>
          </section>
        </div>

        {warnings.length > 0 ? (
          <div className="warning-stack top-gap">
            {warnings.map((warning) => (
              <div className="warning-item" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        <Panel
          className="panel-nested top-gap"
          title={outputLabel}
          subtitle={lastCommand ? '最近一次命令回显' : '当前 memory status 原始输出'}
        >
          {lastCommand ? (
            <div className="detail-list compact">
              <KeyValueRow label="命令" value={lastCommand.command} />
              <KeyValueRow label="结果" value={lastCommand.success ? 'success' : 'failed'} />
              <KeyValueRow label="退出码" value={lastCommand.exitCode} />
            </div>
          ) : null}
          <pre className="code-block compact-code">{outputText}</pre>
        </Panel>
      </Panel>
    </>
  );

  return (
    <div className="page-stack">
      <Panel
        title="记忆工作台"
        subtitle="先选槽位，再决定是编辑内容还是核对 Provider 与运行材料。"
        tip={(
          <InfoTip content="这里不再用大段介绍抢位置。核心操作保留在主区，说明细节放到悬浮提示里。交互式命令仍交给 Terminal，状态核对直接回面板。"/>
        )}
        aside={(
          <Toolbar>
            <Button onClick={() => void load(selectedKey)} disabled={actionBusy}>刷新</Button>
            <Button kind="primary" onClick={() => void runMemoryStatus()} disabled={actionBusy}>
              {runningDiagnostic ? '体检中…' : '记忆体检'}
            </Button>
          </Toolbar>
        )}
      >
        <div className="compact-overview-grid">
          <div className="shell-card">
            <div className="shell-card-header">
              <strong>运行摘要</strong>
              <div className="pill-row">
                <Pill tone={summary?.memoryEnabled ? 'good' : 'warn'}>{summary?.memoryEnabled ? 'Memory On' : 'Memory Off'}</Pill>
                <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {snapshot?.gateway?.gatewayState ?? 'Gateway ?'}
                </Pill>
              </div>
            </div>
            <div className="detail-list compact">
              <KeyValueRow label="当前 Profile" value={profile} />
              <KeyValueRow label="Provider" value={runtimeProviderLabel} />
              <KeyValueRow label="User Profile" value={summary?.userProfileEnabled ? 'On' : 'Off'} />
              <KeyValueRow label="会话数" value={snapshot?.counts.sessions ?? 0} />
              <KeyValueRow label="插件数" value={extensions.plugins.installedCount} />
            </div>
          </div>
          <div className="metrics-grid metrics-grid-tight">
            <MetricCard label="槽位" value={`${readyCount}/${items.length || 3}`} hint="SOUL / MEMORY / USER" />
            <MetricCard label="Provider" value={runtimeProviderLabel} hint={providerLabel === runtimeProviderLabel ? '配置与运行态一致' : '配置与运行态需核对'} />
            <MetricCard label="Plugins" value={extensions.plugins.installedCount} hint="plugins list" />
            <MetricCard label="Warnings" value={warnings.length} hint="预算、provider、gateway、会话" />
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
              <Button onClick={() => setActiveTab('editor')}>进入编辑器</Button>
              <Button onClick={() => setInvestigation(null)}>清除上下文</Button>
              <Button onClick={() => navigate('sessions')}>返回会话</Button>
            </Toolbar>
          )}
        />
      ) : null}

      <div className="tab-bar">
        {MEMORY_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'editor' && dirty ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'runtime' && (warnings.length > 0 || lastCommand) ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewSection : activeTab === 'editor' ? editorSection : runtimeSection}
    </div>
  );
}
