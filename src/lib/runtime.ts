import type { CronJobItem, ExtensionsSnapshot, GatewayPlatformState } from '../types';

export type RuntimeTone = 'good' | 'warn' | 'bad' | 'neutral';

const LOCAL_DELIVERY_TARGETS = new Set(['', 'local', 'origin', 'stdout', 'console']);

export function isRemoteDelivery(deliver: string) {
  return !LOCAL_DELIVERY_TARGETS.has(deliver.trim().toLowerCase());
}

export function hasCronFailure(job: CronJobItem) {
  return Boolean(job.lastError || job.lastDeliveryError || job.state === 'error');
}

export function cronTone(job: CronJobItem): RuntimeTone {
  if (!job.enabled || job.state === 'paused') return 'warn';
  if (hasCronFailure(job)) return 'bad';
  if (job.state === 'scheduled') return 'good';
  return 'neutral';
}

export function platformTone(state?: string | null): RuntimeTone {
  const normalized = state?.trim().toLowerCase();
  if (!normalized) return 'neutral';
  if (['connected', 'running', 'ok', 'healthy'].includes(normalized)) return 'good';
  if (['fatal', 'error', 'failed', 'disconnected'].includes(normalized)) return 'bad';
  if (['connecting', 'paused', 'stopped', 'degraded'].includes(normalized)) return 'warn';
  return 'neutral';
}

export function countConnectedPlatforms(platforms: GatewayPlatformState[]) {
  return platforms.filter(platform => platformTone(platform.state) === 'good').length;
}

export function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

export function enabledToolCount(extensions?: ExtensionsSnapshot | null) {
  return extensions?.toolPlatforms.reduce((sum, item) => sum + item.enabledCount, 0) ?? 0;
}

export function totalToolCount(extensions?: ExtensionsSnapshot | null) {
  return extensions?.toolPlatforms.reduce((sum, item) => sum + item.totalCount, 0) ?? 0;
}

export function localRuntimeSkillCount(extensions?: ExtensionsSnapshot | null) {
  return extensions?.skillSourceCounts.find(item => item.name === 'local')?.count ?? 0;
}

export function pluginsCount(extensions?: ExtensionsSnapshot | null) {
  return extensions?.plugins.installedCount ?? 0;
}
