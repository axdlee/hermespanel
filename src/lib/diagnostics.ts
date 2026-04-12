export type DiagnosticKind =
  | 'doctor'
  | 'status'
  | 'status-deep'
  | 'gateway-status'
  | 'gateway-status-deep'
  | 'config-check'
  | 'tools-summary'
  | 'skills-list'
  | 'plugins-list'
  | 'memory-status'
  | 'dump'
  | 'version';

export interface DiagnosticCommandDefinition {
  key: DiagnosticKind;
  label: string;
  cli: string;
  description: string;
  relatedLog: 'agent' | 'errors' | 'gateway' | 'gateway.error';
  kind: 'primary' | 'secondary';
  scope: 'runtime' | 'capability';
  relatedPage: 'dashboard' | 'gateway' | 'config' | 'skills' | 'extensions' | 'memory' | 'logs' | 'cron' | 'diagnostics';
}

export const DIAGNOSTIC_COMMANDS: DiagnosticCommandDefinition[] = [
  {
    key: 'doctor',
    label: '健康检查',
    cli: 'hermes doctor',
    description: '优先检查 Hermes 当前环境、依赖和常见异常。',
    relatedLog: 'errors',
    kind: 'primary',
    scope: 'runtime',
    relatedPage: 'diagnostics',
  },
  {
    key: 'status',
    label: '全量状态',
    cli: 'hermes status --all',
    description: '查看 profile、gateway、skills、memory 的整体状态。',
    relatedLog: 'agent',
    kind: 'secondary',
    scope: 'runtime',
    relatedPage: 'dashboard',
  },
  {
    key: 'status-deep',
    label: '深度状态',
    cli: 'hermes status --deep',
    description: '做更重一点的状态检查，适合怀疑运行态和表层摘要不一致时使用。',
    relatedLog: 'errors',
    kind: 'secondary',
    scope: 'runtime',
    relatedPage: 'dashboard',
  },
  {
    key: 'gateway-status',
    label: '网关状态',
    cli: 'hermes gateway status',
    description: '确认 gateway 是否存活，以及平台连接有没有明显异常。',
    relatedLog: 'gateway.error',
    kind: 'secondary',
    scope: 'runtime',
    relatedPage: 'gateway',
  },
  {
    key: 'gateway-status-deep',
    label: '网关深检',
    cli: 'hermes gateway status --deep',
    description: '对 gateway 做更细的状态检测，适合投递异常但表层状态看起来正常时使用。',
    relatedLog: 'gateway.error',
    kind: 'secondary',
    scope: 'runtime',
    relatedPage: 'gateway',
  },
  {
    key: 'dump',
    label: '安装摘要',
    cli: 'hermes dump',
    description: '查看 Hermes 当前安装和本地文件布局摘要。',
    relatedLog: 'errors',
    kind: 'secondary',
    scope: 'runtime',
    relatedPage: 'dashboard',
  },
  {
    key: 'version',
    label: 'Hermes 版本',
    cli: 'hermes version',
    description: '快速确认当前 CLI 版本与构建信息。',
    relatedLog: 'agent',
    kind: 'secondary',
    scope: 'runtime',
    relatedPage: 'dashboard',
  },
  {
    key: 'config-check',
    label: '配置体检',
    cli: 'hermes config check',
    description: '检查当前 profile 的配置缺项、迁移项和明显风险。',
    relatedLog: 'errors',
    kind: 'secondary',
    scope: 'capability',
    relatedPage: 'config',
  },
  {
    key: 'tools-summary',
    label: '工具摘要',
    cli: 'hermes tools --summary',
    description: '查看 Hermes 当前已启用的工具面和平台工具汇总。',
    relatedLog: 'agent',
    kind: 'secondary',
    scope: 'capability',
    relatedPage: 'extensions',
  },
  {
    key: 'skills-list',
    label: '技能清单',
    cli: 'hermes skills list',
    description: '读取 Hermes 已安装技能清单，辅助核对技能目录与运行态是否一致。',
    relatedLog: 'agent',
    kind: 'secondary',
    scope: 'capability',
    relatedPage: 'skills',
  },
  {
    key: 'plugins-list',
    label: '插件清单',
    cli: 'hermes plugins list',
    description: '列出已安装插件，确认当前 profile 有没有额外扩展层。',
    relatedLog: 'agent',
    kind: 'secondary',
    scope: 'capability',
    relatedPage: 'extensions',
  },
  {
    key: 'memory-status',
    label: '记忆状态',
    cli: 'hermes memory status',
    description: '查看当前 memory provider、生效状态和外部记忆配置。',
    relatedLog: 'agent',
    kind: 'secondary',
    scope: 'capability',
    relatedPage: 'memory',
  },
];

const GATEWAY_DIAGNOSTIC_KEYS = new Set<DiagnosticKind>([
  'gateway-status',
  'gateway-status-deep',
  'doctor',
  'config-check',
]);

export const RUNTIME_DIAGNOSTIC_COMMANDS = DIAGNOSTIC_COMMANDS.filter((item) => item.scope === 'runtime');

export const CAPABILITY_DIAGNOSTIC_COMMANDS = DIAGNOSTIC_COMMANDS.filter((item) => item.scope === 'capability');

export const GATEWAY_DIAGNOSTIC_COMMANDS = DIAGNOSTIC_COMMANDS.filter((item) => GATEWAY_DIAGNOSTIC_KEYS.has(item.key));

export function getDiagnosticCommand(key: string) {
  return DIAGNOSTIC_COMMANDS.find((item) => item.key === key);
}
