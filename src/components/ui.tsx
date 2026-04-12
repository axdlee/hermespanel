import type { PropsWithChildren, ReactNode } from 'react';

export function Panel(
  props: PropsWithChildren<{
    title?: string;
    subtitle?: string;
    aside?: ReactNode;
    className?: string;
    tip?: ReactNode;
  }>,
) {
  return (
    <section className={`panel ${props.className ?? ''}`.trim()}>
      {(props.title || props.subtitle || props.aside) && (
        <header className="panel-header">
          <div>
            {props.title && (
              <div className="panel-title-row">
                <h2 className="panel-title">{props.title}</h2>
                {props.tip}
              </div>
            )}
            {props.subtitle && <p className="panel-subtitle">{props.subtitle}</p>}
          </div>
          {props.aside}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function MetricCard(props: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="metric-card">
      <p className="metric-label">{props.label}</p>
      <strong className="metric-value">{props.value}</strong>
      {props.hint && <span className="metric-hint">{props.hint}</span>}
    </div>
  );
}

export function StatCard(props: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: 'running' | 'stopped' | 'warning';
  actions?: ReactNode;
}) {
  return (
    <section className="stat-card">
      <div className="stat-card-header">
        <span className="stat-card-label">{props.label}</span>
        {props.tone ? <span className={`status-dot ${props.tone}`} /> : null}
      </div>
      <div className="stat-card-value">{props.value}</div>
      {props.meta ? <div className="stat-card-meta">{props.meta}</div> : null}
      {props.actions ? <div className="stat-card-actions">{props.actions}</div> : null}
    </section>
  );
}

export function OverviewCard(props: {
  title: string;
  value: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overview-card ${props.className ?? ''}`.trim()}>
      <div className="overview-card-body">
        <div className="overview-card-title">{props.title}</div>
        <div className="overview-card-value">{props.value}</div>
        {props.meta ? <div className="overview-card-meta">{props.meta}</div> : null}
        {props.actions ? <div className="overview-card-actions">{props.actions}</div> : null}
      </div>
    </section>
  );
}

export function Pill(props: { tone?: 'neutral' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`pill pill-${props.tone ?? 'neutral'}`}>{props.children}</span>;
}

export function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  );
}

export function LoadingState(props: { label?: string }) {
  return (
    <div className="empty-state">
      <strong>加载中</strong>
      <p>{props.label ?? '正在读取 Hermes 本地状态。'}</p>
    </div>
  );
}

export function KeyValueRow(props: { label: string; value?: ReactNode }) {
  return (
    <div className="key-value-row">
      <span>{props.label}</span>
      <strong>{props.value ?? '—'}</strong>
    </div>
  );
}

export function Toolbar(props: PropsWithChildren<{ className?: string }>) {
  return <div className={`toolbar ${props.className ?? ''}`.trim()}>{props.children}</div>;
}

export function ContextBanner(props: {
  label?: string;
  title: string;
  description: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="context-banner">
      <div className="context-banner-header">
        <div className="context-banner-copy">
          <span className="context-banner-label">{props.label ?? 'Context'}</span>
          <strong className="context-banner-title">{props.title}</strong>
          <p className="context-banner-description">{props.description}</p>
        </div>
        {props.meta ? <div className="context-banner-meta">{props.meta}</div> : null}
      </div>
      {props.actions ? <div className="context-banner-actions">{props.actions}</div> : null}
    </div>
  );
}

export function Button(props: PropsWithChildren<{
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}>) {
  return (
    <button
      type="button"
      className={`button button-${props.kind ?? 'secondary'}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function InfoTip(props: { content: ReactNode; label?: string }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label="更多信息">
      <span className="info-tip-trigger">{props.label ?? '?'}</span>
      <span className="info-tip-bubble">{props.content}</span>
    </span>
  );
}
