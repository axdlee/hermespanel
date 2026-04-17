import { useRef, useMemo, useCallback, useState } from 'react';

interface VirtualScrollProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
}

export function VirtualScroll<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  onLoadMore,
  hasMore = false,
  loading = false,
}: VirtualScrollProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleRange = useMemo(() => {
    const startIdx = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const endIdx = startIdx + visibleCount;

    return {
      start: Math.max(0, startIdx - overscan),
      end: Math.min(items.length, endIdx + overscan),
    };
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan]);

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end);
  }, [items, visibleRange]);

  const totalHeight = items.length * itemHeight;
  const offsetY = visibleRange.start * itemHeight;

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      setScrollTop(target.scrollTop);

      // 检测是否接近底部，触发加载更多
      if (hasMore && onLoadMore && !loading) {
        const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
        if (scrollBottom < itemHeight * 5) {
          onLoadMore();
        }
      }
    },
    [hasMore, onLoadMore, loading, itemHeight]
  );

  return (
    <div
      ref={containerRef}
      className="virtual-scroll-container"
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={handleScroll}
    >
      <div
        className="virtual-scroll-content"
        style={{
          height: totalHeight,
          position: 'relative',
        }}
      >
        <div
          className="virtual-scroll-items"
          style={{
            position: 'absolute',
            top: offsetY,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, index) => renderItem(item, visibleRange.start + index))}
        </div>
        {loading && (
          <div
            className="virtual-scroll-loading"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '8px',
              textAlign: 'center',
            }}
          >
            加载中...
          </div>
        )}
      </div>
    </div>
  );
}

// 简化版本 - 用于固定高度的列表项
interface SimpleVirtualListProps<T> extends VirtualScrollProps<T> {
  className?: string;
}

export function SimpleVirtualList<T>({
  items,
  itemHeight = 40,
  containerHeight = 400,
  renderItem,
  className: _className = '',
  ...rest
}: SimpleVirtualListProps<T>) {
  return (
    <VirtualScroll
      items={items}
      itemHeight={itemHeight}
      containerHeight={containerHeight}
      renderItem={renderItem}
      {...rest}
    />
  );
}

// 日志虚拟列表
interface LogItem {
  id: number;
  line: string;
  timestamp?: number;
  level?: string;
}

export function VirtualLogList({
  logs,
  height = 300,
  lineHeight = 22,
}: {
  logs: LogItem[];
  height?: number;
  lineHeight?: number;
}) {
  return (
    <VirtualScroll
      items={logs}
      itemHeight={lineHeight}
      containerHeight={height}
      renderItem={(log, index) => (
        <div
          key={log.id ?? index}
          className={`log-line log-${log.level ?? 'info'}`}
          style={{
            height: lineHeight,
            lineHeight: `${lineHeight}px`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: '13px',
            padding: '0 8px',
          }}
        >
          {log.line}
        </div>
      )}
    />
  );
}

// 会话虚拟列表
interface SessionItem {
  id: string;
  title?: string;
  source: string;
  startedAt: number;
  preview?: string;
}

export function VirtualSessionList({
  sessions,
  height = 400,
  onItemClick,
}: {
  sessions: SessionItem[];
  height?: number;
  onItemClick?: (session: SessionItem) => void;
}) {
  return (
    <VirtualScroll
      items={sessions}
      itemHeight={64}
      containerHeight={height}
      renderItem={(session, index) => (
        <div
          key={session.id}
          className="session-item"
          style={{
            height: 64,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color, #e0e0e0)',
            cursor: onItemClick ? 'pointer' : 'default',
          }}
          onClick={() => onItemClick?.(session)}
        >
          <div style={{ fontWeight: 600, fontSize: '14px' }}>
            {session.title ?? `Session ${index + 1}`}
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {session.source} · {new Date(session.startedAt).toLocaleString()}
          </div>
          {session.preview && (
            <div
              style={{
                fontSize: '13px',
                color: '#888',
                marginTop: '4px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {session.preview}
            </div>
          )}
        </div>
      )}
    />
  );
}
