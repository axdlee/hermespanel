import { useRef, useCallback, useEffect, useState } from 'react';

interface SmartPollingOptions {
  interval?: number;
  minInterval?: number;
  maxInterval?: number;
  backoffFactor?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
  leading?: boolean;
}

interface SmartPollingState {
  isPolling: boolean;
  currentInterval: number;
  errorCount: number;
  lastError: unknown | null;
}

/**
 * 智能轮询 hook
 * - 支持动态调整轮询间隔
 * - 错误时自动退避（增加间隔）
 * - 成功后恢复正常间隔
 * - 支持暂停/恢复
 */
export function useSmartPolling(fetchFn: () => Promise<void>, options: SmartPollingOptions = {}) {
  const {
    interval = 15000,
    // minInterval = 5000, // 保留最小间隔概念，暂不使用
    maxInterval = 60000,
    backoffFactor = 2,
    enabled = true,
    onError,
    onSuccess,
    leading = true,
  } = options;

  const [state, setState] = useState<SmartPollingState>({
    isPolling: enabled,
    currentInterval: interval,
    errorCount: 0,
    lastError: null,
  });

  const timerRef = useRef<number | null>(null);
  const abortRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(
    (customInterval?: number) => {
      if (abortRef.current || !state.isPolling) return;

      const nextInterval = customInterval ?? state.currentInterval;
      timerRef.current = setTimeout(async () => {
        if (abortRef.current) return;

        try {
          await fetchFn();
          setState(prev => ({
            ...prev,
            errorCount: 0,
            lastError: null,
            currentInterval: interval,
          }));
          onSuccess?.();
          scheduleNext(interval);
        } catch (error) {
          const newErrorCount = state.errorCount + 1;
          const newInterval = Math.min(maxInterval, state.currentInterval * backoffFactor);

          setState(prev => ({
            ...prev,
            errorCount: newErrorCount,
            lastError: error,
            currentInterval: newInterval,
          }));

          onError?.(error);
          scheduleNext(newInterval);
        }
      }, nextInterval);
    },
    [fetchFn, state, interval, maxInterval, backoffFactor, onSuccess, onError]
  );

  const start = useCallback(() => {
    abortRef.current = false;
    setState(prev => ({ ...prev, isPolling: true }));

    if (leading) {
      void fetchFn();
    }
    scheduleNext(leading ? interval : 0);
  }, [fetchFn, scheduleNext, leading, interval]);

  const stop = useCallback(() => {
    abortRef.current = true;
    clearTimer();
    setState(prev => ({ ...prev, isPolling: false }));
  }, [clearTimer]);

  const reset = useCallback(() => {
    setState({
      isPolling: enabled,
      currentInterval: interval,
      errorCount: 0,
      lastError: null,
    });
  }, [enabled, interval]);

  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }

    return () => {
      abortRef.current = true;
      clearTimer();
    };
  }, [enabled, start, stop, clearTimer]);

  return {
    ...state,
    start,
    stop,
    reset,
    isHealthy: state.errorCount < 3,
  };
}

// 简化版本 - 固定间隔
export function usePolling(
  fetchFn: () => Promise<void>,
  interval: number,
  enabled: boolean = true
) {
  return useSmartPolling(fetchFn, {
    interval,
    minInterval: interval,
    maxInterval: interval,
    enabled,
  });
}

// 可见性感知轮询 - 页面隐藏时暂停
export function useVisibilityPolling(
  fetchFn: () => Promise<void>,
  options: SmartPollingOptions = {}
) {
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined' ? !document.hidden : true
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return useSmartPolling(fetchFn, {
    ...options,
    enabled: options.enabled && isVisible,
  });
}

// 活动感知轮询 - 用户不活动时降低频率
export function useActivityPolling(
  fetchFn: () => Promise<void>,
  options: SmartPollingOptions & { idleTimeout?: number; idleInterval?: number } = {}
) {
  const { idleTimeout = 30000, idleInterval = 60000, ...pollingOptions } = options;
  const [isIdle, setIsIdle] = useState(false);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      setIsIdle(false);
    };

    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivityRef.current > idleTimeout) {
        setIsIdle(true);
      }
    }, idleTimeout / 2);

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      clearInterval(idleCheck);
    };
  }, [idleTimeout]);

  const effectiveInterval = isIdle ? idleInterval : pollingOptions.interval;

  return useSmartPolling(fetchFn, {
    ...pollingOptions,
    interval: effectiveInterval,
    minInterval: pollingOptions.minInterval ?? effectiveInterval,
  });
}
