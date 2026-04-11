export function formatEpoch(seconds?: number | null) {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString('zh-CN', {
    hour12: false,
  });
}

export function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function truncate(value: string, max = 120) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
