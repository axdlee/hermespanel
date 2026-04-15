import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, KeyValueRow, LoadingState, Panel, Pill, Toolbar } from '../components/ui';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildGatewayDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { api } from '../lib/api';
import { formatEpoch, truncate } from '../lib/format';
import type { DashboardSnapshot, SessionDetail, SessionMessage, SessionRecord } from '../types';
import type {
  AppPageKey,
  ConfigFocus,
  ConfigPageIntent,
  DiagnosticsPageIntent,
  ExtensionsPageIntent,
  GatewayPageIntent,
  LogsPageIntent,
  MemoryPageIntent,
  PageIntent,
  PageProps,
  SessionNavigationContext,
} from './types';

type RecentFilter = 'all' | '24h' | '7d' | '30d';
type MessageFilter = 'all' | 'user' | 'assistant' | 'tool';
type SignalTone = 'good' | 'warn' | 'bad' | 'neutral';
type SessionsTabKey = 'overview' | 'analysis' | 'messages';

interface SessionSignal {
  key: string;
  label: string;
  tone: SignalTone;
  description: string;
  page?: AppPageKey;
  actionLabel?: string;
}

interface SessionAssessment {
  tone: SignalTone;
  score: number;
  primaryLabel: string;
  signals: SessionSignal[];
}

interface SessionPortrait {
  total: number;
  userCount: number;
  assistantCount: number;
  toolCount: number;
  otherCount: number;
  uniqueTools: number;
  blankCount: number;
  toolRatio: number;
  nonUserRatio: number;
  firstToolAt?: number | null;
  lastToolAt?: number | null;
  lastRole: string;
}

interface ToolAggregate {
  name: string;
  count: number;
  firstAt?: number | null;
  lastAt?: number | null;
}

interface ToolEvent {
  key: string;
  name: string;
  role: string;
  timestamp?: number | null;
  preview: string;
}

const TOOL_HEAVY_THRESHOLD = 6;
const LONG_CONVERSATION_THRESHOLD = 14;
const UNTITLED_COMPLEX_MESSAGE_THRESHOLD = 10;
const UNTITLED_COMPLEX_TOOL_THRESHOLD = 4;
const GATEWAY_SOURCE_PATTERN = /(gateway|telegram|discord|slack|feishu|dingtalk|wechat|wecom|line|whatsapp|remote|bot)/i;
const MEMORY_PATTERN = /(memory|memories|user|profile|soul)/i;

const SESSIONS_TABS: Array<{ key: SessionsTabKey; label: string; hint: string }> = [
  { key: 'overview', label: '常用总览', hint: '先筛选会话、锁定目标，再看建议去向。' },
  { key: 'analysis', label: '风险与联动', hint: '查看工具聚合、风险信号和联动建议。' },
  { key: 'messages', label: '消息与回放', hint: '只看最终消息正文和内容筛选。' },
];

function withinRecentWindow(startedAt: number, filter: RecentFilter) {
  if (filter === 'all') {
    return true;
  }

  const now = Date.now();
  const value = startedAt * 1000;
  const windows: Record<Exclude<RecentFilter, 'all'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  return now - value <= windows[filter];
}

function normalizeRole(role?: string | null) {
  return role?.trim().toLowerCase() ?? '';
}

function isToolMessage(message: SessionMessage) {
  return normalizeRole(message.role) === 'tool' || Boolean(message.toolName?.trim());
}

function toolDisplayName(message: SessionMessage) {
  return message.toolName?.trim() || '未命名工具';
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function isGatewayLikeSource(source: string) {
  return GATEWAY_SOURCE_PATTERN.test(source);
}

function pageLabel(page: AppPageKey) {
  switch (page) {
    case 'dashboard':
      return '总览页';
    case 'profiles':
      return 'Profiles';
    case 'gateway':
      return 'Gateway';
    case 'config':
      return '配置页';
    case 'sessions':
      return 'Sessions';
    case 'skills':
      return 'Skills';
    case 'extensions':
      return '扩展页';
    case 'cron':
      return 'Cron';
    case 'logs':
      return '日志页';
    case 'memory':
      return '记忆页';
    case 'diagnostics':
      return '诊断页';
    default:
      return '工作台';
  }
}

function signalToneLabel(tone: SignalTone) {
  switch (tone) {
    case 'good':
      return '稳定';
    case 'warn':
      return '关注';
    case 'bad':
      return '高风险';
    case 'neutral':
    default:
      return '观察';
  }
}

function buttonKindForTone(tone: SignalTone): 'primary' | 'secondary' | 'danger' {
  if (tone === 'bad') {
    return 'danger';
  }
  if (tone === 'good') {
    return 'primary';
  }
  return 'secondary';
}

function uniqueSignals(signals: SessionSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    if (seen.has(signal.key)) {
      return false;
    }
    seen.add(signal.key);
    return true;
  });
}

function buildRecordSignals(session: SessionRecord): SessionSignal[] {
  const signals: SessionSignal[] = [];

  if (session.toolCallCount >= TOOL_HEAVY_THRESHOLD) {
    signals.push({
      key: 'tool-heavy',
      label: '高工具调用',
      tone: session.toolCallCount >= 12 ? 'bad' : 'warn',
      description: `这次会话累计调用 ${session.toolCallCount} 次工具，值得回到扩展层核对 tool 启停和平台摘要。`,
      page: 'extensions',
      actionLabel: '查看扩展面',
    });
  }

  if (!session.title && (session.messageCount >= UNTITLED_COMPLEX_MESSAGE_THRESHOLD || session.toolCallCount >= UNTITLED_COMPLEX_TOOL_THRESHOLD)) {
    signals.push({
      key: 'untitled-complex',
      label: '无标题复杂会话',
      tone: 'warn',
      description: '没有标题，但消息量或工具调用已经不低，这通常是一段值得标注和回放的真实运行轨迹。',
      page: 'sessions',
      actionLabel: '继续深挖',
    });
  }

  if (session.messageCount >= LONG_CONVERSATION_THRESHOLD && session.toolCallCount === 0) {
    signals.push({
      key: 'long-no-tool',
      label: '长对话无工具',
      tone: 'warn',
      description: '消息已经很多，但没有任何 tool call，更像是配置层、模型层或上下文编排层的问题。',
      page: 'config',
      actionLabel: '核对配置',
    });
  }

  if (!session.endedAt && session.messageCount >= 6) {
    signals.push({
      key: 'missing-end',
      label: '结束信号缺失',
      tone: 'warn',
      description: '会话没有记录 ended_at，可能仍在运行，也可能中断在一次不完整的执行链路上。',
      page: 'diagnostics',
      actionLabel: '做运行体检',
    });
  }

  return signals;
}

function assessSession(session: SessionRecord): SessionAssessment {
  const signals = buildRecordSignals(session);
  const score = signals.length;
  const tone: SignalTone = score >= 2 ? 'bad' : score === 1 ? 'warn' : 'good';

  return {
    tone,
    score,
    primaryLabel: signals[0]?.label ?? '未见明显异常',
    signals,
  };
}

function buildSessionPortrait(messages: SessionMessage[]): SessionPortrait {
  let userCount = 0;
  let assistantCount = 0;
  let toolCount = 0;
  let otherCount = 0;
  let blankCount = 0;
  let firstToolAt: number | null = null;
  let lastToolAt: number | null = null;
  const toolNames = new Set<string>();

  for (const message of messages) {
    const role = normalizeRole(message.role);
    const toolLike = isToolMessage(message);

    if (!message.content.trim()) {
      blankCount += 1;
    }

    if (toolLike) {
      toolCount += 1;
      toolNames.add(toolDisplayName(message));
      if (firstToolAt === null) {
        firstToolAt = message.timestamp;
      }
      lastToolAt = message.timestamp;
      continue;
    }

    if (role === 'user') {
      userCount += 1;
    } else if (role === 'assistant') {
      assistantCount += 1;
    } else {
      otherCount += 1;
    }
  }

  const total = messages.length;
  const lastRole = normalizeRole(messages.at(-1)?.role) || 'unknown';

  return {
    total,
    userCount,
    assistantCount,
    toolCount,
    otherCount,
    uniqueTools: toolNames.size,
    blankCount,
    toolRatio: total > 0 ? toolCount / total : 0,
    nonUserRatio: total > 0 ? (total - userCount) / total : 0,
    firstToolAt,
    lastToolAt,
    lastRole,
  };
}

function summarizeTools(messages: SessionMessage[]) {
  const aggregates = new Map<string, ToolAggregate>();
  const events: ToolEvent[] = [];

  for (const message of messages) {
    if (!isToolMessage(message)) {
      continue;
    }

    const name = toolDisplayName(message);
    const current = aggregates.get(name);
    if (current) {
      current.count += 1;
      current.lastAt = message.timestamp;
    } else {
      aggregates.set(name, {
        name,
        count: 1,
        firstAt: message.timestamp,
        lastAt: message.timestamp,
      });
    }

    events.push({
      key: `${message.id}:${name}`,
      name,
      role: normalizeRole(message.role) || 'tool',
      timestamp: message.timestamp,
      preview: truncate(message.content || '(空内容)', 96),
    });
  }

  return {
    aggregates: Array.from(aggregates.values()).sort(
      (left, right) => right.count - left.count || (right.lastAt ?? 0) - (left.lastAt ?? 0) || left.name.localeCompare(right.name),
    ),
    recentEvents: events.slice(-8).reverse(),
  };
}

function buildDetailSignals(
  detail: SessionDetail,
  portrait: SessionPortrait,
  snapshot: DashboardSnapshot | null,
): SessionSignal[] {
  const signals = [...buildRecordSignals(detail.session)];

  if (portrait.total >= 6 && portrait.nonUserRatio >= 0.85) {
    signals.push({
      key: 'non-user-dense',
      label: '非用户消息占比过高',
      tone: portrait.userCount === 0 ? 'bad' : 'warn',
      description: `当前非 user 消息占比 ${formatPercent(portrait.nonUserRatio)}，这更像一段 agent 自循环或工具密集流程，而不是普通问答。`,
      page: 'diagnostics',
      actionLabel: '进入诊断页',
    });
  }

  if (detail.session.toolCallCount > 0 && portrait.lastRole === 'tool') {
    signals.push({
      key: 'ended-on-tool',
      label: '会话停在工具侧',
      tone: 'bad',
      description: '最后一条消息仍然是 tool，说明可能中断在工具执行后、模型回填前，应该联动日志一起看。',
      page: 'logs',
      actionLabel: '查看日志',
    });
  }

  if (detail.session.toolCallCount === 0 && detail.session.messageCount >= LONG_CONVERSATION_THRESHOLD && (snapshot?.config.toolsets.length ?? 0) > 0) {
    signals.push({
      key: 'configured-but-unused-tools',
      label: '已声明 toolsets 但未触达工具层',
      tone: 'warn',
      description: '当前 profile 明明有 toolsets，但这次长会话完全没有进入工具层，建议核对模型、backend 和 toolsets 编排。',
      page: 'config',
      actionLabel: '核对配置',
    });
  }

  if (portrait.blankCount >= 2) {
    signals.push({
      key: 'blank-messages',
      label: '存在空内容消息',
      tone: 'warn',
      description: `检测到 ${portrait.blankCount} 条空内容消息，可能是工具返回异常、消息截断，或者落盘过程不完整。`,
      page: 'logs',
      actionLabel: '看日志细节',
    });
  }

  if (portrait.uniqueTools >= 3) {
    signals.push({
      key: 'multi-tool-chain',
      label: '多工具串联',
      tone: 'warn',
      description: `本次会话至少串联了 ${portrait.uniqueTools} 种工具，更适合回到扩展面核对能力层组合是否符合预期。`,
      page: 'extensions',
      actionLabel: '查看扩展面',
    });
  }

  return uniqueSignals(signals);
}

function buildRecommendations(
  detail: SessionDetail,
  portrait: SessionPortrait,
  tools: ToolAggregate[],
  snapshot: DashboardSnapshot | null,
): SessionSignal[] {
  const recommendations: SessionSignal[] = [];

  if (portrait.toolCount > 0) {
    recommendations.push({
      key: 'recommend-extensions',
      label: '先核对扩展运行态',
      tone: 'good',
      description: `这次会话出现了 ${portrait.toolCount} 条工具消息，最近活跃工具是 ${tools.slice(0, 3).map((item) => item.name).join('、') || '工具层'}。`,
      page: 'extensions',
      actionLabel: '进入扩展页',
    });
  }

  if (isGatewayLikeSource(detail.session.source)) {
    recommendations.push({
      key: 'recommend-gateway',
      label: '回到 Gateway 链路核对入口',
      tone: snapshot?.gateway?.gatewayState === 'running' ? 'warn' : 'bad',
      description: `source = ${detail.session.source}，这更像来自 gateway 或消息平台入口，需要对照连接态和投递态一起判断。`,
      page: 'gateway',
      actionLabel: '进入 Gateway',
    });
  }

  if (
    tools.some((item) => MEMORY_PATTERN.test(item.name))
    || MEMORY_PATTERN.test(detail.session.preview)
    || MEMORY_PATTERN.test(detail.session.title ?? '')
  ) {
    recommendations.push({
      key: 'recommend-memory',
      label: '检查记忆轨迹',
      tone: 'warn',
      description: '会话里有 memory / profile / soul 相关痕迹，建议对照记忆文件与 provider 生效状态一起看。',
      page: 'memory',
      actionLabel: '进入记忆页',
    });
  }

  if (detail.session.toolCallCount === 0) {
    recommendations.push({
      key: 'recommend-config',
      label: '核对配置编排',
      tone: 'warn',
      description: snapshot?.config.toolsets.length
        ? '当前 profile 已声明 toolsets，但这次会话没有进入工具层，优先排查 model / backend / toolsets 配置。'
        : '当前没有任何工具调用，先确认模型、上下文引擎和 toolsets 是否准备完整。',
      page: 'config',
      actionLabel: '进入配置页',
    });
  }

  if (!detail.session.endedAt || portrait.lastRole === 'tool' || portrait.blankCount > 0) {
    recommendations.push({
      key: 'recommend-diagnostics',
      label: '补一轮运行体检',
      tone: 'warn',
      description: '这次会话带有中断或异常信号，联动 Diagnostics 和 Logs 更容易判定问题是在环境层还是能力层。',
      page: 'diagnostics',
      actionLabel: '进入诊断页',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      key: 'recommend-dashboard',
      label: '回到总览继续观察',
      tone: 'good',
      description: '当前没有发现特别突出的异常，会话更像一次正常运行记录，可以回 Dashboard 看整体运行态。',
      page: 'dashboard',
      actionLabel: '进入总览页',
    });
  }

  return uniqueSignals(recommendations);
}

function sessionDisplayTitle(session: SessionRecord) {
  return session.title || truncate(session.preview || session.id, 48);
}

function buildSessionContext(detail: SessionDetail, tools: ToolAggregate[], reason: string): SessionNavigationContext {
  return {
    sessionId: detail.session.id,
    title: `${sessionDisplayTitle(detail.session)} · ${reason}`,
    source: detail.session.source,
    model: detail.session.model,
    preview: truncate(detail.session.preview || detail.session.id, 120),
    toolNames: tools.slice(0, 4).map((item) => item.name),
  };
}

function suggestLogName(detail: SessionDetail, portrait: SessionPortrait) {
  if (isGatewayLikeSource(detail.session.source)) {
    return 'gateway.error';
  }
  if (portrait.lastRole === 'tool' || detail.session.toolCallCount > 0) {
    return 'agent';
  }
  return 'errors';
}

function suggestLogContains(detail: SessionDetail, tools: ToolAggregate[]) {
  if (isGatewayLikeSource(detail.session.source)) {
    return detail.session.source;
  }
  if (tools.length > 0) {
    return tools[0].name;
  }
  if (detail.session.toolCallCount === 0) {
    return 'error';
  }
  return '';
}

function suggestDiagnostic(detail: SessionDetail) {
  if (isGatewayLikeSource(detail.session.source)) {
    return 'gateway-status';
  }
  if (detail.session.toolCallCount === 0) {
    return 'config-check';
  }
  return 'doctor';
}

function detectMemorySlot(detail: SessionDetail, tools: ToolAggregate[]): MemoryPageIntent['selectedKey'] {
  const combined = [detail.session.title ?? '', detail.session.preview, ...tools.map((item) => item.name)]
    .join(' ')
    .toLowerCase();
  if (/(user|profile)/.test(combined)) {
    return 'user';
  }
  if (/(soul|persona|identity)/.test(combined)) {
    return 'soul';
  }
  return 'memory';
}

function suggestConfigFocus(detail: SessionDetail, portrait: SessionPortrait): ConfigFocus {
  if (detail.session.toolCallCount === 0) {
    return 'toolsets';
  }
  if (portrait.toolCount > 0 && portrait.uniqueTools > 1) {
    return 'context';
  }
  return 'memory';
}

function buildSessionPageIntent(
  page: AppPageKey,
  detail: SessionDetail,
  portrait: SessionPortrait,
  tools: ToolAggregate[],
  reason: string,
): PageIntent | null {
  const context = buildSessionContext(detail, tools, reason);
  const headline = `来自 Sessions 的会话下钻`;
  const logName = suggestLogName(detail, portrait);
  const contains = suggestLogContains(detail, tools);
  const seed = {
    sourcePage: 'sessions' as const,
    headline,
    description: reason,
    context,
  };

  if (page === 'logs') {
    return buildLogsDrilldownIntent(seed, {
      logName,
      contains,
      level: '',
      limit: '160',
    });
  }

  if (page === 'diagnostics') {
    return buildDiagnosticsDrilldownIntent(seed, {
      suggestedCommand: suggestDiagnostic(detail),
      logName,
    });
  }

  if (page === 'extensions') {
    return buildExtensionsDrilldownIntent(seed, {
      rawKind: 'tools',
      query: tools.map((item) => item.name).join(' '),
      toolNames: tools.slice(0, 4).map((item) => item.name),
    });
  }

  if (page === 'memory') {
    const intent: MemoryPageIntent = {
      kind: 'memory',
      sourcePage: 'sessions',
      headline,
      description: reason,
      context,
      selectedKey: detectMemorySlot(detail, tools),
    };
    return intent;
  }

  if (page === 'config') {
    return buildConfigDrilldownIntent(seed, {
      focus: suggestConfigFocus(detail, portrait),
      suggestedCommand: 'config-check',
    });
  }

  if (page === 'gateway') {
    return buildGatewayDrilldownIntent(seed, {
      platformName: detail.session.source,
    });
  }

  return null;
}

export function SessionsPage({ notify, profile, navigate }: PageProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selected, setSelected] = useState<SessionDetail | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<SessionsTabKey>('overview');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all');
  const [messageQuery, setMessageQuery] = useState('');
  const [messageFilter, setMessageFilter] = useState<MessageFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadList() {
    setLoading(true);
    try {
      const [nextSessions, nextSnapshot] = await Promise.all([
        api.listSessions(120, profile),
        api.getDashboardSnapshot(profile),
      ]);
      setSessions(nextSessions);
      setSnapshot(nextSnapshot);

      const fallbackId = nextSessions.find((item) => item.id === selected?.session.id)?.id ?? nextSessions[0]?.id;
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
    setLoadingDetail(true);
    try {
      const detail = await api.getSessionDetail(sessionId, profile);
      setSelected(detail);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoadingDetail(false);
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
    void loadList();
  }, [profile]);

  useEffect(() => {
    setActiveTab('overview');
  }, [profile]);

  const sourceOptions = useMemo(
    () => ['all', ...Array.from(new Set(sessions.map((item) => item.source))).sort()],
    [sessions],
  );
  const modelOptions = useMemo(
    () => ['all', ...Array.from(new Set(sessions.map((item) => item.model).filter(Boolean) as string[])).sort()],
    [sessions],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sessions.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) {
        return false;
      }
      if (modelFilter !== 'all' && (item.model ?? '—') !== modelFilter) {
        return false;
      }
      if (!withinRecentWindow(item.startedAt, recentFilter)) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [item.id, item.title ?? '', item.preview, item.source, item.model ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [modelFilter, query, recentFilter, sessions, sourceFilter]);

  const filteredMessages = useMemo(() => {
    if (!selected) {
      return [];
    }

    const term = messageQuery.trim().toLowerCase();
    return selected.messages.filter((message) => {
      const toolLike = isToolMessage(message);
      const role = normalizeRole(message.role);
      if (messageFilter === 'user' && role !== 'user') {
        return false;
      }
      if (messageFilter === 'assistant' && role !== 'assistant') {
        return false;
      }
      if (messageFilter === 'tool' && !toolLike) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [message.role, message.toolName ?? '', message.content]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [messageFilter, messageQuery, selected]);

  const sessionAssessments = useMemo(
    () => new Map(sessions.map((session) => [session.id, assessSession(session)])),
    [sessions],
  );
  const riskySessions = filtered.filter((item) => (sessionAssessments.get(item.id)?.score ?? 0) > 0);
  const toolHeavySessions = filtered.filter((item) => item.toolCallCount >= TOOL_HEAVY_THRESHOLD);
  const longNoToolSessions = filtered.filter((item) => item.messageCount >= LONG_CONVERSATION_THRESHOLD && item.toolCallCount === 0);
  const gatewayLikeSessions = filtered.filter((item) => isGatewayLikeSource(item.source));
  const stateDbPath = snapshot ? `${snapshot.hermesHome}/state.db` : '';

  const selectedAssessment = useMemo(
    () => (selected ? assessSession(selected.session) : null),
    [selected],
  );
  const selectedPortrait = useMemo(
    () => (selected ? buildSessionPortrait(selected.messages) : null),
    [selected],
  );
  const selectedTools = useMemo(
    () => summarizeTools(selected?.messages ?? []),
    [selected],
  );
  const selectedSignals = useMemo(
    () => (selected && selectedPortrait ? buildDetailSignals(selected, selectedPortrait, snapshot) : []),
    [selected, selectedPortrait, snapshot],
  );
  const selectedRecommendations = useMemo(
    () => (selected && selectedPortrait ? buildRecommendations(selected, selectedPortrait, selectedTools.aggregates, snapshot) : []),
    [selected, selectedPortrait, selectedTools.aggregates, snapshot],
  );
  const overviewWarnings = [
    filtered.length === 0 ? '当前筛选条件下没有任何会话，建议先恢复筛选范围，再重新定位问题。' : null,
    riskySessions.length > 0 ? `当前筛选结果里有 ${riskySessions.length} 条高风险会话，建议优先处理这些记录。` : null,
    longNoToolSessions.length > 0 ? `有 ${longNoToolSessions.length} 条长对话没有进入工具层，更适合先回配置中心核对模型、backend 和 toolsets。` : null,
    gatewayLikeSessions.length > 0 && snapshot?.gateway?.gatewayState !== 'running'
      ? `有 ${gatewayLikeSessions.length} 条会话看起来来自 Gateway 或消息平台入口，但当前 Gateway 还不是 running。`
      : null,
    selected && selectedSignals.length > 0
      ? `当前焦点会话命中了 ${selectedSignals.length} 个风险信号，建议继续查看“风险与联动”或直接去日志与诊断页。`
      : null,
  ].filter((item): item is string => Boolean(item));
  const visibleOverviewWarnings = overviewWarnings.slice(0, 4);
  const remainingOverviewWarningCount = Math.max(0, overviewWarnings.length - visibleOverviewWarnings.length);

  function resetListFilters() {
    setQuery('');
    setSourceFilter('all');
    setModelFilter('all');
    setRecentFilter('all');
    notify('info', '已恢复全部会话筛选条件。');
  }

  function navigateFromSelection(page: AppPageKey, reason: string) {
    if (!selected || !selectedPortrait) {
      navigate(page);
      return;
    }

    const intent = buildSessionPageIntent(page, selected, selectedPortrait, selectedTools.aggregates, reason);
    navigate(page, intent);
  }

  if (loading) {
    return <LoadingState label="正在读取 Hermes 会话数据库。" />;
  }
  const currentSessionSection = (
    <Panel
      title="当前焦点"
      subtitle={selected ? '先确认这次会话的来源、工具调用和最适合继续追查的方向。' : '先从会话列表里选一条记录。'}
      aside={selected ? (
        <Toolbar>
          <Button onClick={() => navigateFromSelection('logs', '查看当前会话的相关日志输出。')}>查看日志</Button>
          <Button onClick={() => navigateFromSelection('diagnostics', '结合会话风险信号继续做运行态诊断。')}>做诊断</Button>
          <Button onClick={() => navigateFromSelection('memory', '核对这次会话可能涉及的记忆槽位。')}>看记忆</Button>
        </Toolbar>
      ) : undefined}
    >
      {selected && selectedPortrait ? (
        <div className="two-column">
          <div className="detail-list">
            <KeyValueRow label="ID" value={selected.session.id} />
            <KeyValueRow label="来源" value={selected.session.source} />
            <KeyValueRow label="模型" value={selected.session.model || '—'} />
            <KeyValueRow label="开始时间" value={formatEpoch(selected.session.startedAt)} />
            <KeyValueRow label="结束时间" value={formatEpoch(selected.session.endedAt)} />
          </div>
          <div className="detail-list">
            <KeyValueRow label="消息数" value={selected.session.messageCount} />
            <KeyValueRow label="工具调用" value={selected.session.toolCallCount} />
            <KeyValueRow label="工具种类" value={selectedPortrait.uniqueTools} />
            <KeyValueRow label="风险信号" value={selectedSignals.length} />
            <KeyValueRow
              label="当前状态"
              value={(
                <Pill tone={loadingDetail ? 'warn' : selectedAssessment?.tone ?? 'good'}>
                  {loadingDetail ? '读取中' : selectedAssessment?.primaryLabel ?? '已加载'}
                </Pill>
              )}
            />
          </div>
        </div>
      ) : (
        <EmptyState title="未选择会话" description="从下方会话列表选择一条记录后，这里会显示当前摘要和推荐去向。" />
      )}
    </Panel>
  );

  const overviewSection = (
    <div className="page-stack">
      <Panel
        title="推荐下一步"
        subtitle="先缩小范围并锁定一条会话，再决定是看风险联动，还是直接回放消息。"
      >
        <div className="list-stack">
          <div className="list-card">
            <div className="list-card-title">
              <strong>先缩小范围并锁定一条会话</strong>
              <Pill tone={filtered.length > 0 ? 'good' : 'warn'}>
                {filtered.length > 0 ? `${filtered.length} 条命中` : '暂无命中'}
              </Pill>
            </div>
            <p>先按来源、模型、时间窗和关键词缩小范围，避免还没选中目标就掉进消息和工具细节里。</p>
            <div className="meta-line">
              <span>{sourceFilter === 'all' ? '全部来源' : sourceFilter}</span>
              <span>{modelFilter === 'all' ? '全部模型' : modelFilter}</span>
              <span>{recentFilter === 'all' ? '全部时间' : recentFilter}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => setActiveTab('overview')}>
                查看会话列表
              </Button>
              <Button onClick={resetListFilters}>
                恢复全部筛选
              </Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>优先关注高风险或工具密集的记录</strong>
              <Pill tone={riskySessions.length > 0 ? 'warn' : 'good'}>
                {riskySessions.length > 0 ? `${riskySessions.length} 条待优先处理` : '当前较平稳'}
              </Pill>
            </div>
            <p>如果当前筛选结果里已经出现高风险、高工具调用或 Gateway 来源的会话，通常更值得优先排查。</p>
            <div className="meta-line">
              <span>高风险 {riskySessions.length}</span>
              <span>高工具 {toolHeavySessions.length}</span>
              <span>Gateway 来源 {gatewayLikeSessions.length}</span>
            </div>
            <Toolbar>
              <Button kind="primary" onClick={() => setActiveTab('analysis')}>
                查看风险与联动
              </Button>
              <Button onClick={() => navigate('diagnostics')}>
                进入诊断页
              </Button>
            </Toolbar>
          </div>

          <div className="list-card">
            <div className="list-card-title">
              <strong>选中后再决定去哪个工作台</strong>
              <Pill tone={selected ? 'good' : 'neutral'}>
                {selected ? sessionDisplayTitle(selected.session) : '等待选择'}
              </Pill>
            </div>
            <p>{selectedRecommendations[0]?.description ?? '选择一条会话后，这里会给出最适合继续下钻的页面。'}</p>
            <div className="meta-line">
              <span>{selected?.session.source ?? '未选来源'}</span>
              <span>{selected?.session.model || '未选模型'}</span>
            </div>
            <Toolbar>
              {selectedRecommendations[0]?.page ? (
                <Button
                  kind={buttonKindForTone(selectedRecommendations[0].tone)}
                  onClick={() => navigateFromSelection(selectedRecommendations[0].page!, selectedRecommendations[0].description)}
                >
                  {selectedRecommendations[0].actionLabel ?? `进入${pageLabel(selectedRecommendations[0].page!)}`}
                </Button>
              ) : (
                <Button onClick={() => setActiveTab('messages')} disabled={!selected}>
                  查看消息与回放
                </Button>
              )}
              <Button onClick={() => setActiveTab('analysis')} disabled={!selected}>
                查看风险与联动
              </Button>
            </Toolbar>
          </div>
        </div>
      </Panel>

      <Panel
        title="当前判断"
        subtitle="先用会话摘要做一轮轻量归类，再决定哪些记录值得进消息级深挖。"
      >
        <div className="health-grid">
          <section className="health-card">
            <div className="health-card-header">
              <strong>高风险会话</strong>
              <Pill tone={riskySessions.length > 0 ? 'bad' : 'good'}>{riskySessions.length}</Pill>
            </div>
            <p>命中过至少一个风险信号的会话数量，适合作为优先排查队列。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>高工具调用</strong>
              <Pill tone={toolHeavySessions.length > 0 ? 'warn' : 'good'}>{toolHeavySessions.length}</Pill>
            </div>
            <p>工具调用大于等于 {TOOL_HEAVY_THRESHOLD} 次，通常意味着问题更接近工具面或多工具编排。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>长对话无工具</strong>
              <Pill tone={longNoToolSessions.length > 0 ? 'warn' : 'good'}>{longNoToolSessions.length}</Pill>
            </div>
            <p>消息很多却没进入工具层，更值得回到 Config 看模型、backend 和 context 编排。</p>
          </section>
          <section className="health-card">
            <div className="health-card-header">
              <strong>Gateway 来源</strong>
              <Pill tone={gatewayLikeSessions.length > 0 ? 'warn' : 'neutral'}>{gatewayLikeSessions.length}</Pill>
            </div>
            <p>source 看起来来自 gateway 或消息平台入口，排障时要同时看会话与连接链路。</p>
          </section>
        </div>
        {visibleOverviewWarnings.length > 0 ? (
          <>
            <div className="warning-stack top-gap">
              {visibleOverviewWarnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
            {remainingOverviewWarningCount > 0 ? (
              <p className="helper-text top-gap">其余 {remainingOverviewWarningCount} 条提醒继续收在“风险与联动”和“消息与回放”里。</p>
            ) : null}
          </>
        ) : null}
      </Panel>

      <div className="two-column wide-left">
        <Panel title="会话列表" subtitle="先定位哪一次对话值得深挖，再进入右侧子模块做分析或看消息流。">
          {filtered.length === 0 ? (
            <EmptyState title="没有匹配会话" description="换个关键词、来源、模型或时间窗再试试。" />
          ) : (
            <div className="list-stack">
              {filtered.map((session) => {
                const assessment = sessionAssessments.get(session.id) ?? assessSession(session);
                return (
                  <button
                    className={`list-card session-card ${selected?.session.id === session.id ? 'selected' : ''}`}
                    key={session.id}
                    onClick={() => void selectSession(session.id)}
                    type="button"
                  >
                    <div className="list-card-title">
                      <strong>{session.title || truncate(session.preview || session.id, 44)}</strong>
                      <div className="pill-row">
                        <Pill>{session.source}</Pill>
                        <Pill tone={session.toolCallCount > 0 ? 'good' : 'neutral'}>
                          tool {session.toolCallCount}
                        </Pill>
                        <Pill tone={assessment.tone}>
                          {assessment.score > 0 ? `${assessment.score} 个信号` : '平稳'}
                        </Pill>
                      </div>
                    </div>
                    <p>{truncate(session.preview || '无预览文本', 96)}</p>
                    <div className="meta-line">
                      <span>{session.model || '未知模型'}</span>
                      <span>{session.messageCount} 条消息</span>
                      <span>{assessment.primaryLabel}</span>
                      <span>{formatEpoch(session.startedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        {currentSessionSection}
      </div>
    </div>
  );

  const analysisSection = (
    <Panel title="风险与联动" subtitle="查看工具调用、风险信号和会话结构，判断问题更像模型、工具还是环境层。">
      {selected && selectedPortrait ? (
        <div className="page-stack">
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>角色分布</strong>
                <Pill tone={selectedPortrait.userCount > 0 ? 'good' : 'warn'}>
                  {selectedPortrait.userCount}/{selectedPortrait.assistantCount}/{selectedPortrait.toolCount}
                </Pill>
              </div>
              <p>
                user {selectedPortrait.userCount} · assistant {selectedPortrait.assistantCount} · tool {selectedPortrait.toolCount}
                {selectedPortrait.otherCount > 0 ? ` · other ${selectedPortrait.otherCount}` : ''}
              </p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>工具覆盖</strong>
                <Pill tone={selectedPortrait.toolCount > 0 ? 'good' : 'warn'}>
                  {formatPercent(selectedPortrait.toolRatio)}
                </Pill>
              </div>
              <p>
                首次工具 {formatEpoch(selectedPortrait.firstToolAt)} · 最近工具 {formatEpoch(selectedPortrait.lastToolAt)} · 共 {selectedPortrait.uniqueTools} 种工具
              </p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>交互密度</strong>
                <Pill tone={selectedPortrait.nonUserRatio >= 0.85 ? 'bad' : selectedPortrait.nonUserRatio >= 0.65 ? 'warn' : 'good'}>
                  {formatPercent(selectedPortrait.nonUserRatio)}
                </Pill>
              </div>
              <p>非 user 消息占比越高，越像 agent 自主运行或工具密集链路。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>消息洁净度</strong>
                <Pill tone={selectedPortrait.blankCount > 0 ? 'warn' : 'good'}>
                  空消息 {selectedPortrait.blankCount}
                </Pill>
              </div>
              <p>当前消息过滤后还能看到 {filteredMessages.length} 条记录，适合继续做消息级检索。</p>
            </section>
          </div>

          <div className="two-column">
            <div className="page-stack">
              <Panel className="panel-nested" title="工具调用聚合" subtitle="按工具名聚合调用频次，帮助你看清这次会话真正依赖了哪些能力。">
                {selectedTools.aggregates.length === 0 ? (
                  <EmptyState title="没有工具轨迹" description="这次会话没有解析到 tool 消息，可以优先回配置页核对工具面。" />
                ) : (
                  <div className="list-stack">
                    {selectedTools.aggregates.slice(0, 8).map((item) => (
                      <div className="list-card" key={item.name}>
                        <div className="list-card-title">
                          <strong>{item.name}</strong>
                          <Pill tone={item.count >= 3 ? 'warn' : 'good'}>{item.count} 次</Pill>
                        </div>
                        <div className="meta-line">
                          <span>首次 {formatEpoch(item.firstAt)}</span>
                          <span>最近 {formatEpoch(item.lastAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel className="panel-nested" title="最近工具时间线" subtitle="结合最后几次 tool 事件，快速判断会话停在了哪一层。">
                {selectedTools.recentEvents.length === 0 ? (
                  <EmptyState title="暂无工具事件" description="当前会话没有 tool 时间线，重点去看模型和配置层。" />
                ) : (
                  <div className="list-stack">
                    {selectedTools.recentEvents.map((event) => (
                      <div className="list-card" key={event.key}>
                        <div className="list-card-title">
                          <strong>{event.name}</strong>
                          <Pill tone={event.role === 'tool' ? 'warn' : 'neutral'}>{event.role}</Pill>
                        </div>
                        <p>{event.preview}</p>
                        <div className="meta-line">
                          <span>{formatEpoch(event.timestamp)}</span>
                          <span>{selected.session.source}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            <div className="page-stack">
              <Panel className="panel-nested" title="风险信号" subtitle="这些判断基于摘要字段和消息结构，只负责提示，不替代原始日志。">
                {selectedSignals.length === 0 ? (
                  <EmptyState title="没有明显风险信号" description="当前会话更像一次正常运行记录，可以直接看消息流或返回总览。" />
                ) : (
                  <div className="list-stack">
                    {selectedSignals.map((signal) => (
                      <div className="list-card" key={signal.key}>
                        <div className="list-card-title">
                          <strong>{signal.label}</strong>
                          <Pill tone={signal.tone}>{signalToneLabel(signal.tone)}</Pill>
                        </div>
                        <p>{signal.description}</p>
                        {signal.page ? (
                          <Toolbar>
                            <Button kind={buttonKindForTone(signal.tone)} onClick={() => navigateFromSelection(signal.page!, signal.description)}>
                              {signal.actionLabel ?? `进入${pageLabel(signal.page)}`}
                            </Button>
                          </Toolbar>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel className="panel-nested" title="联动建议" subtitle="根据来源、工具和记忆痕迹，给出最可能继续深挖的工作台入口。">
                <div className="list-stack">
                  {selectedRecommendations.map((item) => (
                    <div className="list-card" key={item.key}>
                      <div className="list-card-title">
                        <strong>{item.label}</strong>
                        <Pill tone={item.tone}>{pageLabel(item.page ?? 'dashboard')}</Pill>
                      </div>
                      <p>{item.description}</p>
                      {item.page ? (
                        <Toolbar>
                          <Button kind={buttonKindForTone(item.tone)} onClick={() => navigateFromSelection(item.page!, item.description)}>
                            {item.actionLabel ?? `进入${pageLabel(item.page)}`}
                          </Button>
                        </Toolbar>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="未选择会话" description="先在“会话总览”里选择一条记录，再来这里看风险和工具细节。" />
      )}
    </Panel>
  );

  const messagesSection = (
    <Panel
      title="消息流"
      subtitle="只保留消息正文和筛选器，适合专注回放一次会话到底发生了什么。"
      aside={(
        <Toolbar>
          <input
            className="search-input"
            placeholder="搜索消息内容或工具名"
            value={messageQuery}
            onChange={(event) => setMessageQuery(event.target.value)}
            disabled={!selected}
          />
          <select
            className="select-input"
            value={messageFilter}
            onChange={(event) => setMessageFilter(event.target.value as MessageFilter)}
            disabled={!selected}
          >
            <option value="all">全部消息</option>
            <option value="user">仅 user</option>
            <option value="assistant">仅 assistant</option>
            <option value="tool">仅 tool</option>
          </select>
        </Toolbar>
      )}
    >
      {selected ? (
        filteredMessages.length === 0 ? (
          <EmptyState title="没有匹配消息" description="试试调整消息筛选器，或直接查看全部消息。" />
        ) : (
          <div className="page-stack">
            <div className="detail-list compact">
              <KeyValueRow label="当前会话" value={sessionDisplayTitle(selected.session)} />
              <KeyValueRow label="来源" value={selected.session.source} />
              <KeyValueRow label="模型" value={selected.session.model || '—'} />
              <KeyValueRow label="返回消息" value={filteredMessages.length} />
            </div>
            <div className="transcript">
              {filteredMessages.map((message: SessionMessage) => (
                <article className={`message-bubble role-${normalizeRole(message.role)}`} key={message.id}>
                  <div className="message-meta">
                    <span>{normalizeRole(message.role) || 'unknown'}</span>
                    <span>{formatEpoch(message.timestamp)}</span>
                  </div>
                  {message.toolName && <p className="message-tool">工具: {message.toolName}</p>}
                  <pre>{message.content || '(空内容)'}</pre>
                </article>
              ))}
            </div>
          </div>
        )
      ) : (
        <EmptyState title="未选择会话" description="先在“会话总览”里选择一条记录，再来这里看消息流。" />
      )}
    </Panel>
  );

  return (
    <div className="page-stack">
      <Panel
        title="会话工作台"
        subtitle="先用常用总览锁定一条会话，再按需进入风险联动或消息回放，避免一开始就掉进细节里。"
        aside={(
          <Toolbar>
            <Button onClick={() => void loadList()}>刷新</Button>
            <Button onClick={() => stateDbPath && void openInFinder(stateDbPath, 'state.db', true)} disabled={!stateDbPath}>
              定位 state.db
            </Button>
          </Toolbar>
        )}
      >
        <p className="helper-text">
          这里展示的是 Hermes 已落盘的真实会话，不依赖 Gateway 在线状态，也不改写任何原始记录。默认顺序：先筛选，再锁定焦点，最后按需看风险或消息。
        </p>
        <div className="detail-list compact top-gap">
          <KeyValueRow label="当前 Profile" value={profile} />
          <KeyValueRow label="State DB" value={stateDbPath || '—'} />
          <KeyValueRow label="当前命中" value={filtered.length} />
          <KeyValueRow label="高风险会话" value={riskySessions.length} />
          <KeyValueRow label="Gateway" value={snapshot?.gateway?.gatewayState ?? '未检测到'} />
          <KeyValueRow label="默认模型" value={snapshot?.config.modelDefault ?? '—'} />
        </div>
      </Panel>

      <div className="tab-bar">
        {SESSIONS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.hint}
          >
            {tab.label}
            {tab.key === 'analysis' && selectedSignals.length > 0 ? <span className="tab-dirty-dot" /> : null}
            {tab.key === 'messages' && (messageQuery.trim() || messageFilter !== 'all') ? <span className="tab-dirty-dot" /> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewSection : null}
      {activeTab === 'analysis' ? analysisSection : null}
      {activeTab === 'messages' ? messagesSection : null}
    </div>
  );
}
