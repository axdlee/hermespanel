import './skeleton.css';

interface SkeletonProps {
  variant?: 'text' | 'card' | 'stat' | 'sidebar' | 'table' | 'list';
  count?: number;
  className?: string;
}

export function Skeleton({ variant = 'text', count = 1, className = '' }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (variant === 'sidebar') {
    return (
      <aside className={`skeleton-sidebar ${className}`}>
        <div className="skeleton-sidebar-brand">
          <div className="skeleton-circle" />
          <div className="skeleton-text skeleton-text-medium" />
        </div>
        <div className="skeleton-sidebar-nav">
          {items.map(i => (
            <div key={i} className="skeleton-nav-item">
              <div className="skeleton-circle skeleton-circle-small" />
              <div className="skeleton-text skeleton-text-short" />
            </div>
          ))}
        </div>
        <div className="skeleton-sidebar-status">
          <div className="skeleton-text skeleton-text-medium" />
          <div className="skeleton-pill-row">
            <div className="skeleton-pill" />
            <div className="skeleton-pill" />
            <div className="skeleton-pill" />
          </div>
        </div>
      </aside>
    );
  }

  if (variant === 'stat') {
    return (
      <section className={`skeleton-stat-card ${className}`}>
        <div className="skeleton-text skeleton-text-short" />
        <div className="skeleton-text skeleton-text-large" />
        <div className="skeleton-text skeleton-text-medium" />
      </section>
    );
  }

  if (variant === 'card') {
    return (
      <section className={`skeleton-panel ${className}`}>
        <header className="skeleton-panel-header">
          <div className="skeleton-text skeleton-text-large" />
          <div className="skeleton-text skeleton-text-medium" />
        </header>
        <div className="skeleton-panel-body">
          {items.map(i => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-text skeleton-text-short" />
              <div className="skeleton-text skeleton-text-medium" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (variant === 'table') {
    return (
      <div className={`skeleton-table ${className}`}>
        <header className="skeleton-table-header">
          {items.slice(0, 4).map(i => (
            <div key={i} className="skeleton-text skeleton-text-short" />
          ))}
        </header>
        {items.slice(0, 5).map(i => (
          <div key={i} className="skeleton-table-row">
            <div className="skeleton-text skeleton-text-short" />
            <div className="skeleton-text skeleton-text-medium" />
            <div className="skeleton-text skeleton-text-short" />
            <div className="skeleton-pill" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={`skeleton-list ${className}`}>
        {items.map(i => (
          <div key={i} className="skeleton-list-item">
            <div className="skeleton-text skeleton-text-medium" />
            <div className="skeleton-text skeleton-text-long" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`skeleton-text skeleton-text-default ${className}`}>
      {items.map(i => (
        <div key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="page-stack skeleton-page">
      <div className="skeleton-stat-cards">
        <Skeleton variant="stat" count={4} />
      </div>
      <Skeleton variant="card" count={2} />
      <Skeleton variant="table" count={5} />
    </div>
  );
}

export function SkeletonShell() {
  return (
    <div className="app-shell">
      <Skeleton variant="sidebar" count={6} />
      <div className="content-shell skeleton-content-shell">
        <header className="skeleton-topbar">
          <div className="skeleton-text skeleton-text-large" />
          <div className="skeleton-text skeleton-text-medium" />
        </header>
        <main className="content-area">
          <SkeletonPage />
        </main>
      </div>
    </div>
  );
}
