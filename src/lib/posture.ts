import {
  enabledToolCount,
  hasCronFailure,
  isRemoteDelivery,
  localRuntimeSkillCount,
  platformTone,
  totalToolCount,
  type RuntimeTone,
} from './runtime';
import type {
  ConfigDocuments,
  ConfigSummary,
  CronJobsSnapshot,
  DashboardSnapshot,
  ExtensionsSnapshot,
  SkillItem,
} from '../types';

export type RuntimePostureTargetPage =
  | 'dashboard'
  | 'config'
  | 'gateway'
  | 'extensions'
  | 'memory'
  | 'sessions'
  | 'diagnostics'
  | 'logs';

export type RuntimePostureTone = RuntimeTone;

export interface RuntimePostureItem {
  key: string;
  title: string;
  tone: RuntimePostureTone;
  summary: string;
  detail: string;
  page?: RuntimePostureTargetPage;
  actionLabel?: string;
}

export interface RuntimePostureSnapshot {
  tone: RuntimePostureTone;
  headline: string;
  summary: string;
  items: RuntimePostureItem[];
  priorities: RuntimePostureItem[];
}

interface RuntimePostureInput {
  dashboard: DashboardSnapshot | null;
  configDocuments?: ConfigDocuments | null;
  extensions?: ExtensionsSnapshot | null;
  cronSnapshot?: CronJobsSnapshot | null;
  skills?: SkillItem[] | null;
}

const DEFAULT_CONFIG: ConfigSummary = {
  toolsets: [],
};

function severity(tone: RuntimePostureTone) {
  switch (tone) {
    case 'bad':
      return 3;
    case 'warn':
      return 2;
    case 'neutral':
      return 1;
    case 'good':
    default:
      return 0;
  }
}

function summaryOrDefault(configDocuments?: ConfigDocuments | null, dashboard?: DashboardSnapshot | null) {
  return configDocuments?.summary ?? dashboard?.config ?? DEFAULT_CONFIG;
}

function postureHeadline(items: RuntimePostureItem[]) {
  const badCount = items.filter((item) => item.tone === 'bad').length;
  const warnCount = items.filter((item) => item.tone === 'warn').length;
  const worst = items.reduce<RuntimePostureTone>(
    (current, item) => (severity(item.tone) > severity(current) ? item.tone : current),
    'good',
  );

  if (worst === 'bad') {
    return {
      tone: 'bad' as const,
      headline: '运行姿态存在高风险',
      summary: `${badCount} 个高风险维度需要先处理，${warnCount} 个维度还需继续关注。`,
    };
  }
  if (worst === 'warn') {
    return {
      tone: 'warn' as const,
      headline: '运行姿态需要关注',
      summary: `${warnCount} 个维度仍有明显不确定性，建议先处理优先项。`,
    };
  }
  return {
    tone: 'good' as const,
    headline: '运行姿态总体稳定',
    summary: '核心链路当前没有明显结构性缺口，可以继续围绕会话与能力面做细化治理。',
  };
}

export function buildRuntimePosture(input: RuntimePostureInput): RuntimePostureSnapshot {
  const config = summaryOrDefault(input.configDocuments, input.dashboard);
  const dashboard = input.dashboard;
  const extensions = input.extensions;
  const skills = input.skills ?? [];
  const jobs = input.cronSnapshot?.jobs ?? [];
  const remoteJobs = jobs.filter((job) => isRemoteDelivery(job.deliver));
  const failingRemoteJobs = remoteJobs.filter(hasCronFailure);
  const gateway = dashboard?.gateway ?? null;
  const gatewayPlatforms = gateway?.platforms ?? [];
  const unhealthyPlatforms = gatewayPlatforms.filter((platform) => platformTone(platform.state) !== 'good');
  const enabledTools = enabledToolCount(extensions);
  const totalTools = totalToolCount(extensions);
  const runtimeLocalSkills = localRuntimeSkillCount(extensions);
  const missingMemoryFiles = dashboard?.memoryFiles.filter((item) => !item.exists) ?? [];
  const sessionsCount = dashboard?.counts.sessions ?? 0;
  const toolsets = config.toolsets ?? [];
  const providerReady = Boolean(config.modelProvider && config.modelDefault);
  const contextReady = Boolean(config.contextEngine);
  const terminalReady = Boolean(config.terminalBackend);
  const cwdReady = Boolean(config.terminalCwd);
  const memoryEnabled = config.memoryEnabled !== false;
  const userProfileEnabled = config.userProfileEnabled !== false;
  const memoryProvider = config.memoryProvider || 'builtin-file';
  const memoryRuntimeMismatch = Boolean(
    config.memoryProvider
    && extensions
    && extensions.memoryRuntime.provider.toLowerCase().includes('none'),
  );
  const localSkillMismatch = Boolean(extensions && skills.length > 0 && runtimeLocalSkills !== skills.length);

  const items: RuntimePostureItem[] = [
    {
      key: 'model',
      title: 'Model Chain',
      tone: providerReady ? 'good' : 'bad',
      summary: providerReady
        ? `${config.modelProvider} / ${config.modelDefault}`
        : 'provider 或默认模型缺失',
      detail: config.modelBaseUrl
        ? `当前请求将优先走 ${config.modelBaseUrl}。`
        : '未显式声明 Base URL，将退回 provider 默认地址。',
      page: 'config',
      actionLabel: '核对模型配置',
    },
    {
      key: 'runtime',
      title: 'Execution Runtime',
      tone: !terminalReady ? 'bad' : !contextReady || !cwdReady ? 'warn' : 'good',
      summary: `${config.terminalBackend || '未配置 backend'} / ${config.contextEngine || '未配置 context'}`,
      detail: !terminalReady
        ? '终端执行后端为空，很多文件与命令类工具没有稳定运行语义。'
        : !cwdReady
          ? '工作目录未显式声明，长链路任务更容易出现上下文漂移。'
          : `工作目录 ${config.terminalCwd}`,
      page: 'config',
      actionLabel: '检查运行后端',
    },
    {
      key: 'capability',
      title: 'Capability Surface',
      tone: toolsets.length === 0 ? 'warn' : extensions && enabledTools === 0 ? 'bad' : localSkillMismatch ? 'warn' : 'good',
      summary: `${toolsets.length} 个 toolsets / ${enabledTools}${extensions ? ` / ${totalTools}` : ''} 个运行中 tools`,
      detail: toolsets.length === 0
        ? '当前没有配置 toolsets，模型看到的能力面会明显收窄。'
        : extensions
          ? localSkillMismatch
            ? `CLI local skills = ${runtimeLocalSkills}，本地目录扫描 = ${skills.length}，安装态与文件态存在差异。`
            : `运行时 skills ${extensions.runtimeSkills.length} 个，插件 ${extensions.plugins.installedCount} 个。`
          : '首页未加载扩展运行态，这里只展示配置侧能力声明。',
      page: 'extensions',
      actionLabel: '查看能力面',
    },
    {
      key: 'memory',
      title: 'Memory Loop',
      tone: !memoryEnabled ? 'warn' : memoryRuntimeMismatch ? 'bad' : missingMemoryFiles.length > 0 || !userProfileEnabled ? 'warn' : 'good',
      summary: `${memoryProvider} / memory ${memoryEnabled ? 'on' : 'off'} / user ${userProfileEnabled ? 'on' : 'off'}`,
      detail: !memoryEnabled
        ? '记忆能力当前关闭，长期人格与用户偏好不会稳定进入运行闭环。'
        : memoryRuntimeMismatch
          ? `配置声明了 ${memoryProvider}，但运行态未识别到对应 provider。`
          : missingMemoryFiles.length > 0
            ? `缺失记忆文件：${missingMemoryFiles.map((item) => item.label).join('、')}。`
            : 'SOUL / MEMORY / USER 文件与配置开关基本一致。',
      page: 'memory',
      actionLabel: '检查记忆环路',
    },
    {
      key: 'gateway',
      title: 'Gateway Delivery',
      tone:
        remoteJobs.length > 0 && gateway?.gatewayState !== 'running'
          ? 'bad'
          : unhealthyPlatforms.length > 0
            ? 'bad'
            : !gateway
              ? 'warn'
              : gateway.gatewayState === 'running'
                ? 'good'
                : 'warn',
      summary: !gateway
        ? '未读取到 gateway 运行态'
        : `${gateway.gatewayState} / ${gatewayPlatforms.length ? gatewayPlatforms.length : 0} 个平台 / ${remoteJobs.length} 个远端作业`,
      detail: !gateway
        ? '尚未发现 gateway_state.json，消息平台侧链路仍然不可判读。'
        : failingRemoteJobs.length > 0
          ? `${failingRemoteJobs.length} 个远端作业已经出现交付异常。`
          : unhealthyPlatforms.length > 0
            ? `异常平台：${unhealthyPlatforms.map((platform) => platform.name).join('、')}。`
            : remoteJobs.length > 0
              ? '远端投递链路存在，建议持续联动日志与平台状态。'
              : '当前主要以前台 CLI / 本地链路为主，网关压力相对可控。',
      page: 'gateway',
      actionLabel: '查看网关链路',
    },
    {
      key: 'closure',
      title: 'Validation Closure',
      tone: sessionsCount === 0 ? 'warn' : (dashboard?.counts.logFiles ?? 0) === 0 ? 'warn' : 'good',
      summary: `${sessionsCount} 个 sessions / ${dashboard?.counts.logFiles ?? 0} 个日志文件`,
      detail: sessionsCount === 0
        ? '当前还没有真实会话回放，很多配置和能力面无法在本地完成闭环验证。'
        : `最近已有会话与日志落盘，适合继续从 Sessions 与 Logs 做取证和回放。`,
      page: 'sessions',
      actionLabel: '查看会话闭环',
    },
  ];

  const priorities = [...items]
    .filter((item) => item.tone === 'bad' || item.tone === 'warn')
    .sort((left, right) => severity(right.tone) - severity(left.tone));
  const headline = postureHeadline(items);

  return {
    tone: headline.tone,
    headline: headline.headline,
    summary: headline.summary,
    items,
    priorities,
  };
}
