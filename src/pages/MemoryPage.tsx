import { useEffect, useMemo, useState } from 'react';

import { Button, ContextBanner, EmptyState, InfoTip, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
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
type MemoryRuntimeViewKey = 'control' | 'workspace' | 'summary' | 'output';

const MEMORY_TABS: Array<{ key: MemoryTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先看槽位、provider 和当前链路判断。' },
  { key: 'editor', label: '编辑槽位', hint: '集中编辑 SOUL / MEMORY / USER 槽位内容。' },
  { key: 'runtime', label: 'Provider 与材料', hint: '低频接管、插件操作和原始输出都收在这里。' },
];

const MEMORY_RUNTIME_VIEWS: Array<{
  key: MemoryRuntimeViewKey;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'control', label: '开关与 Provider', icon: '🧠', hint: '先看开关、Provider 和插件入口，CLI 接管继续后置在这里。' },
  { key: 'workspace', label: '记忆物料', icon: '🗂️', hint: '需要定位 HOME、当前文件或目录时，再进入这里。' },
  { key: 'summary', label: '当前运行判断', icon: '🔎', hint: '把 Provider、预算和链路提醒压成一层摘要。' },
  { key: 'output', label: '最近回执', icon: '🧾', hint: '最近一次体检或接管动作的回显继续收在这一层。' },
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

function memorySlotIcon(key: string) {
  if (key === 'soul') {
    return '🫧';
  }
  if (key === 'memory') {
    return '📚';
  }
  if (key === 'user') {
    return '🙂';
  }
  return '🧠';
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
  const [runningDesktopAction, setRunningDesktopAction] = useState<string | null>(null);
  const [lastCommandLabel, setLastCommandLabel] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryTabKey>('overview');
  const [runtimeView, setRuntimeView] = useState<MemoryRuntimeViewKey>('control');
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
    setRuntimeView('control');
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
  const memoryStartReadiness = summary?.memoryEnabled === false
    ? '先打开 Memory'
    : selectedKey === 'user' && summary?.userProfileEnabled === false
      ? '先打开画像'
      : !selectedSummary?.exists
        ? '先落盘槽位'
        : dirty
          ? '先保存校验'
          : providerLabel !== runtimeProviderLabel
            ? '核对 Provider'
            : warnings.length > 0
              ? '补做运行核对'
              : '可以继续维护';
  const memoryStartHint = summary?.memoryEnabled === false
    ? 'memory 开关关闭时，文件虽然还能编辑，但不会稳定进入 Hermes 的长期记忆链路。'
    : selectedKey === 'user' && summary?.userProfileEnabled === false
      ? '当前正在维护 USER 槽位，但 User Profile 开关未开启，建议先在配置中心打开。'
      : !selectedSummary?.exists
        ? `${detail?.label ?? selectedKey} 还没有落盘，先保存一次再做后续体检更稳妥。`
        : dirty
          ? '当前内容有改动，优先保存并校验，避免文件态和运行态对不上。'
          : providerLabel !== runtimeProviderLabel
            ? `配置声明 ${providerLabel}，但运行态回报 ${runtimeProviderLabel}，建议先核对配置与扩展侧。`
            : warnings.length > 0
              ? '当前仍有一些链路提醒，建议看完首页判断后再进入 Provider 与材料。'
              : '当前槽位、开关和 Provider 看起来都正常，可以继续编辑或做一次真实会话验证。';
  const overviewWarnings = warnings.slice(0, 4);
  const remainingWarningCount = Math.max(0, warnings.length - overviewWarnings.length);
  const overviewSection = (
    <>
      <Panel
        title="常用去向"
        subtitle="首页只保留最常用的 4 个入口，低频 Provider 接管、路径定位和原始输出都继续后置。"
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => setActiveTab('editor')}
          >
            <strong><span className="dashboard-shortcut-icon">✏️</span>编辑当前槽位</strong>
            <span>{detail ? `${detail.label} · ${detail.exists ? '已落盘，可直接续写' : '还未落盘，适合先保存一次'}` : '进入编辑器后再选择要维护的槽位'}</span>
          </button>
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => (dirty ? void save(true) : void runMemoryStatus())}
            disabled={actionBusy}
          >
            <strong><span className="dashboard-shortcut-icon">🩺</span>保存并校验</strong>
            <span>
              {dirty
                ? `当前有未保存修改 · ${content.length} 字符 / ${lineCount} 行`
                : warnings.length > 0
                  ? `${warnings.length} 条提醒待核对，适合先跑一次体检`
                  : '当前可以直接做一次记忆体检'}
            </span>
          </button>
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => navigate('config')}
          >
            <strong><span className="dashboard-shortcut-icon">⚙️</span>配置开关</strong>
            <span>
              {summary?.memoryEnabled
                ? `${providerLabel} · ${summary?.userProfileEnabled ? '画像已开启' : '画像待开启'}`
                : 'Memory 当前关闭，建议先去配置中心打开'}
            </span>
          </button>
          <button
            type="button"
            className="workspace-shortcut-card dashboard-shortcut-card"
            onClick={() => {
              setRuntimeView('control');
              setActiveTab('runtime');
            }}
          >
            <strong><span className="dashboard-shortcut-icon">🧠</span>Provider 与材料</strong>
            <span>{lastCommand ? `最近已有 ${outputLabel} 回执，可继续下钻` : '低频接管、工作材料和原始回显都收在这里'}</span>
          </button>
        </div>
        <p className="helper-text top-gap">首页不再直接堆长卡片和命令区，只保留起步入口。</p>
      </Panel>

      <div className="two-column wide-left">
        <Panel
          title="槽位速览"
          subtitle="SOUL / MEMORY / USER 只展示轻量状态卡，点一下再进入对应槽位。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            {items.map((item) => {
              const meta = memoryMeta(item.key);
              const runtimeLimit = limitForKey(item.key, summary);
              const userProfileOff = item.key === 'user' && summary?.userProfileEnabled === false;
              const isCurrent = selectedKey === item.key;

              return (
                <button
                  type="button"
                  key={item.key}
                  className={`workspace-shortcut-card dashboard-shortcut-card ${isCurrent ? 'active' : ''}`}
                  onClick={() => {
                    void selectItem(item.key);
                    setActiveTab('editor');
                  }}
                >
                  <strong><span className="dashboard-shortcut-icon">{memorySlotIcon(item.key)}</span>{item.label}</strong>
                  <span>
                    {item.exists
                      ? `${meta.description} · ${runtimeLimit == null ? '无预算上限' : `上限 ${runtimeLimit}`}${userProfileOff ? ' · 画像未开启' : ''}`
                      : '还未落盘，点进编辑器保存后即可加入记忆链路'}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="helper-text top-gap">点击卡片直接进入对应槽位编辑，首页不再展开详细字段和多按钮列表。</p>
        </Panel>

        <Panel
          title="当前判断"
          subtitle="把起步判断、Provider、预算和链路验证压成一层摘要，新手先看这里就够了。"
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">起步判断</span>
              <strong className="summary-mini-value">{memoryStartReadiness}</strong>
              <span className="summary-mini-meta">{memoryStartHint}</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Provider 对齐</span>
              <strong className="summary-mini-value">{runtimeProviderLabel}</strong>
              <span className="summary-mini-meta">
                {providerLabel === runtimeProviderLabel ? '配置与运行态一致' : `配置声明为 ${providerLabel}`}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">当前预算</span>
              <strong className="summary-mini-value">
                {remainingChars == null ? '无限制' : `${remainingChars}`}
              </strong>
              <span className="summary-mini-meta">
                {selectedLimit == null ? '当前槽位没有额外字符预算' : `预算上限 ${selectedLimit} 字符`}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">链路验证</span>
              <strong className="summary-mini-value">
                {snapshot?.gateway?.gatewayState === 'running' ? 'Gateway 已连通' : 'Gateway 待验证'}
              </strong>
              <span className="summary-mini-meta">
                {snapshot?.counts.sessions ?? 0} 条会话记录 · {extensions.plugins.installedCount} 个插件
              </span>
            </section>
          </div>

          {overviewWarnings.length > 0 ? (
            <>
              <div className="warning-stack top-gap">
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
            <p className="helper-text top-gap">当前没有额外提醒，记忆链路看起来是连通的，可以直接继续编辑或做一次真实会话验证。</p>
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
        title="运行与材料入口"
        subtitle="开关、工作材料、摘要判断和原始回显一次只展开一层，避免这一页重新变重。"
        tip={(
          <InfoTip content="Provider、开关和插件治理优先去配置中心与扩展页。CLI 接管只放在这里，避免首页被低频动作占满。"/>
        )}
      >
        <div className="workspace-shortcut-grid dashboard-launcher-grid">
          {MEMORY_RUNTIME_VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              className={`workspace-shortcut-card dashboard-shortcut-card ${runtimeView === view.key ? 'active' : ''}`}
              onClick={() => setRuntimeView(view.key)}
            >
              <strong><span className="dashboard-shortcut-icon">{view.icon}</span>{view.label}</strong>
              <span>{view.hint}</span>
            </button>
          ))}
        </div>
        <p className="helper-text top-gap">默认层不再把开关、路径、警告和原始输出一次全部铺开，只先让你选一个需要进入的子模块。</p>
      </Panel>

      {runtimeView === 'control' ? (
        <Panel
          title="开关与 Provider"
          subtitle="配置优先留在客户端，真正需要接管时再显式使用 CLI。"
          aside={(
            <Toolbar>
              <Button kind="primary" onClick={() => navigate('config')}>进入配置中心</Button>
              <Button onClick={() => navigate('extensions')}>管理插件</Button>
              <Button onClick={() => void runMemoryStatus()} disabled={actionBusy}>
                {runningDiagnostic ? '体检中…' : '状态体检'}
              </Button>
            </Toolbar>
          )}
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">运行 Provider</span>
              <strong className="summary-mini-value">{runtimeProviderLabel}</strong>
              <span className="summary-mini-meta">
                {providerLabel === runtimeProviderLabel ? '与配置一致' : `配置声明为 ${providerLabel}`}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Memory 开关</span>
              <strong className="summary-mini-value">{summary?.memoryEnabled ? '已开启' : '已关闭'}</strong>
              <span className="summary-mini-meta">关闭后文件不会稳定进入长期记忆链路</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">User 画像</span>
              <strong className="summary-mini-value">{summary?.userProfileEnabled ? '已开启' : '已关闭'}</strong>
              <span className="summary-mini-meta">决定 USER.md 是否真正参与建模</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">插件安装态</span>
              <strong className="summary-mini-value">{extensions.plugins.installedCount}</strong>
              <span className="summary-mini-meta">{extensions.memoryRuntime.installedPlugins.length} 个插件进入记忆运行态</span>
            </section>
          </div>
          <p className="helper-text top-gap">插件安装、Provider 选择和开关配置优先在客户端完成，CLI 接管只保留给异常场景。</p>
          <section className="action-card action-card-compact top-gap">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Terminal Handoff</p>
                <h3 className="action-card-title">需要时再接管 Hermes 命令</h3>
              </div>
              <Pill tone={installation.binaryFound ? 'good' : 'warn'}>
                {installation.binaryFound ? 'CLI 可用' : 'CLI 未检测到'}
              </Pill>
            </div>
            <p className="command-line">{'hermes memory setup / hermes memory off'}</p>
            <Toolbar>
              <Button
                onClick={() => void openInTerminal('memory:setup', '记忆 Provider', 'hermes memory setup')}
                disabled={actionBusy || !installation.binaryFound}
              >
                {runningDesktopAction === 'memory:setup' ? '接管中…' : 'CLI 接管'}
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
        </Panel>
      ) : null}

      {runtimeView === 'workspace' ? (
        <Panel
          title="记忆物料"
          subtitle="需要定位 Hermes Home、当前文件或目录时，再进入这一层。"
        >
          <div className="workspace-shortcut-grid dashboard-launcher-grid">
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => void openInFinder(config.hermesHome, 'Hermes Home')}
              disabled={actionBusy}
            >
              <strong><span className="dashboard-shortcut-icon">🏠</span>Hermes Home</strong>
              <span>{config.hermesHome}</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => detail?.path && void openInFinder(detail.path, detail.label, true)}
              disabled={actionBusy || !detail?.path}
            >
              <strong><span className="dashboard-shortcut-icon">📄</span>当前文件</strong>
              <span>{detail?.path || '当前槽位还没有落盘文件'}</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => detail?.path && void openInFinder(directoryOf(detail.path), '记忆目录')}
              disabled={actionBusy || !detail?.path}
            >
              <strong><span className="dashboard-shortcut-icon">🗂️</span>记忆目录</strong>
              <span>{detail?.path ? directoryOf(detail.path) : '当前没有可定位的目录'}</span>
            </button>
            <button
              type="button"
              className="workspace-shortcut-card dashboard-shortcut-card"
              onClick={() => setActiveTab('editor')}
            >
              <strong><span className="dashboard-shortcut-icon">✏️</span>回到编辑器</strong>
              <span>{detail?.label ? `继续维护 ${detail.label}` : '返回槽位编辑页继续修改内容'}</span>
            </button>
          </div>
          <div className="detail-list compact top-gap">
            <KeyValueRow label="当前槽位" value={detail?.label ?? selectedKey} />
            <KeyValueRow label="当前文件路径" value={detail?.path || '尚未落盘'} />
            <KeyValueRow label="Hermes Home" value={config.hermesHome} />
          </div>
        </Panel>
      ) : null}

      {runtimeView === 'summary' ? (
        <Panel
          title="当前运行判断"
          subtitle="把 Provider、开关、预算和链路提醒压成一眼能看懂的摘要。"
          aside={(
            <Toolbar>
              <Button onClick={() => void runMemoryStatus()} disabled={actionBusy}>
                {runningDiagnostic ? '刷新中…' : '刷新判断'}
              </Button>
              <Button onClick={() => navigate('config')}>去配置中心</Button>
            </Toolbar>
          )}
        >
          <div className="workspace-summary-strip">
            <section className="summary-mini-card">
              <span className="summary-mini-label">运行 Provider</span>
              <strong className="summary-mini-value">{runtimeProviderLabel}</strong>
              <span className="summary-mini-meta">
                {providerLabel === runtimeProviderLabel ? '与配置一致' : `配置是 ${providerLabel}`}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">Memory 开关</span>
              <strong className="summary-mini-value">{summary?.memoryEnabled ? '已开启' : '已关闭'}</strong>
              <span className="summary-mini-meta">关闭后文件不会稳定进入记忆链路</span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">当前预算</span>
              <strong className="summary-mini-value">{remainingChars == null ? '无限制' : `${remainingChars}`}</strong>
              <span className="summary-mini-meta">
                {selectedLimit == null ? '当前槽位没有预算限制' : `当前上限 ${selectedLimit} 字符`}
              </span>
            </section>
            <section className="summary-mini-card">
              <span className="summary-mini-label">链路验证</span>
              <strong className="summary-mini-value">
                {snapshot?.gateway?.gatewayState === 'running' ? 'Gateway 已连通' : 'Gateway 待验证'}
              </strong>
              <span className="summary-mini-meta">
                {snapshot?.counts.sessions ?? 0} 条会话记录 · {extensions.plugins.installedCount} 个插件
              </span>
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
          ) : (
            <p className="helper-text top-gap">当前没有明显的记忆侧阻塞项，更适合直接维护槽位或做一次真实会话验证。</p>
          )}
        </Panel>
      ) : null}

      {runtimeView === 'output' ? (
        <Panel
          title="最近回执"
          subtitle="这里只保留最近一次体检或接管动作的原始输出，不再和其他运行材料混排。"
          aside={(
            <Toolbar>
              <Button onClick={() => void runMemoryStatus()} disabled={actionBusy}>
                {runningDiagnostic ? '刷新中…' : '刷新回显'}
              </Button>
              <Button onClick={() => setRuntimeView('summary')}>查看判断</Button>
            </Toolbar>
          )}
        >
          {lastCommand ? (
            <div className="detail-list compact">
              <KeyValueRow label="标题" value={outputLabel} />
              <KeyValueRow label="命令" value={lastCommand.command} />
              <KeyValueRow label="结果" value={lastCommand.success ? 'success' : 'failed'} />
              <KeyValueRow label="退出码" value={lastCommand.exitCode} />
            </div>
          ) : (
            <div className="detail-list compact">
              <KeyValueRow label="当前显示" value={outputLabel} />
              <KeyValueRow label="来源" value="memory status 原始输出" />
            </div>
          )}
          <pre className="code-block compact-code top-gap">{outputText}</pre>
        </Panel>
      ) : null}
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
        <p className="helper-text">
          默认顺序：先看起步判断，再选槽位编辑，保存后做一次记忆体检，低频的 Provider 接管和原始回显都收在后面的子模块。
        </p>
        <div className="workspace-summary-strip">
          <section className="summary-mini-card">
            <span className="summary-mini-label">起步判断</span>
            <strong className="summary-mini-value">{memoryStartReadiness}</strong>
            <span className="summary-mini-meta">{memoryStartHint}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">当前槽位</span>
            <strong className="summary-mini-value">{detail?.label ?? selectedKey}</strong>
            <span className="summary-mini-meta">{currentMeta.description}</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">已就绪槽位</span>
            <strong className="summary-mini-value">{`${readyCount}/${items.length || 3}`}</strong>
            <span className="summary-mini-meta">SOUL / MEMORY / USER 已落盘数量</span>
          </section>
          <section className="summary-mini-card">
            <span className="summary-mini-label">运行 Provider</span>
            <strong className="summary-mini-value">{runtimeProviderLabel}</strong>
            <span className="summary-mini-meta">
              {warnings.length > 0 ? `${warnings.length} 条提醒待处理` : '当前没有额外提醒'}
            </span>
          </section>
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
