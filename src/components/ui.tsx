import { memo, type PropsWithChildren, type ReactNode } from 'react';

export const Panel = memo(function Panel(
  props: PropsWithChildren<{
    title?: string;
    subtitle?: string;
    aside?: ReactNode;
    className?: string;
    tip?: ReactNode;
  }>
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
});

export const MetricCard = memo(function MetricCard(props: {
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
});

export const StatCard = memo(function StatCard(props: {
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
});

export const OverviewCard = memo(function OverviewCard(props: {
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
});

export const Pill = memo(function Pill(props: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  children: ReactNode;
}) {
  return <span className={`pill pill-${props.tone ?? 'neutral'}`}>{props.children}</span>;
});

export const EmptyState = memo(function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  );
});

export const LoadingState = memo(function LoadingState(props: {
  label?: string;
  skeleton?: boolean;
}) {
  if (props.skeleton) {
    return (
      <div className="loading-skeleton-wrapper">
        <div className="skeleton-stat-cards">
          <section className="skeleton-stat-card">
            <div className="skeleton-text skeleton-text-short" />
            <div className="skeleton-text skeleton-text-large" />
            <div className="skeleton-text skeleton-text-medium" />
          </section>
          <section className="skeleton-stat-card">
            <div className="skeleton-text skeleton-text-short" />
            <div className="skeleton-text skeleton-text-large" />
            <div className="skeleton-text skeleton-text-medium" />
          </section>
          <section className="skeleton-stat-card">
            <div className="skeleton-text skeleton-text-short" />
            <div className="skeleton-text skeleton-text-large" />
            <div className="skeleton-text skeleton-text-medium" />
          </section>
          <section className="skeleton-stat-card">
            <div className="skeleton-text skeleton-text-short" />
            <div className="skeleton-text skeleton-text-large" />
            <div className="skeleton-text skeleton-text-medium" />
          </section>
        </div>
        <section className="skeleton-panel">
          <header className="skeleton-panel-header">
            <div className="skeleton-text skeleton-text-large" />
            <div className="skeleton-text skeleton-text-medium" />
          </header>
          <div className="skeleton-panel-body">
            <div className="skeleton-row">
              <div className="skeleton-text skeleton-text-short" />
              <div className="skeleton-text skeleton-text-medium" />
            </div>
            <div className="skeleton-row">
              <div className="skeleton-text skeleton-text-short" />
              <div className="skeleton-text skeleton-text-medium" />
            </div>
          </div>
        </section>
        <style>{`
          .loading-skeleton-wrapper {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }
          .skeleton-stat-cards {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
          .skeleton-stat-card {
            padding: 16px;
            border-radius: 8px;
            background: var(--bg-secondary, #fafafa);
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .skeleton-panel {
            padding: 16px;
            border-radius: 8px;
            background: var(--bg-secondary, #fafafa);
          }
          .skeleton-panel-header {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
          }
          .skeleton-panel-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .skeleton-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .skeleton-text {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: skeleton-loading 1.5s ease-in-out infinite;
            border-radius: 4px;
          }
          .skeleton-text-short { height: 14px; width: 30%; }
          .skeleton-text-medium { height: 14px; width: 50%; }
          .skeleton-text-large { height: 20px; width: 60%; }
          @keyframes skeleton-loading {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          @media (prefers-color-scheme: dark) {
            .skeleton-stat-card, .skeleton-panel {
              background: #1a1a1a;
            }
            .skeleton-text {
              background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
              background-size: 200% 100%;
            }
          }
        `}</style>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <strong>加载中</strong>
      <p>{props.label ?? '正在读取 Hermes 本地状态。'}</p>
    </div>
  );
});

export const KeyValueRow = memo(function KeyValueRow(props: { label: string; value?: ReactNode }) {
  return (
    <div className="key-value-row">
      <span>{props.label}</span>
      <strong>{props.value ?? '—'}</strong>
    </div>
  );
});

export const Toolbar = memo(function Toolbar(props: PropsWithChildren<{ className?: string }>) {
  return <div className={`toolbar ${props.className ?? ''}`.trim()}>{props.children}</div>;
});

export const ContextBanner = memo(function ContextBanner(props: {
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
});

export const Button = memo(function Button(
  props: PropsWithChildren<{
    onClick?: () => void;
    kind?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
  }>
) {
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
});

export const InfoTip = memo(function InfoTip(props: { content: ReactNode; label?: string }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label="更多信息">
      <span className="info-tip-trigger">{props.label ?? '?'}</span>
      <span className="info-tip-bubble">{props.content}</span>
    </span>
  );
});
