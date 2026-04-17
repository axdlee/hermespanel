import { Component, type ReactNode } from 'react';
import { Button } from './ui';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack: string } | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    this.setState({ errorInfo });
    // 可以在这里记录错误到日志服务
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-boundary-icon">⚠️</div>
            <h2 className="error-boundary-title">出现了一些问题</h2>
            <p className="error-boundary-description">
              HermesPanel 遇到了意外错误。您可以尝试刷新页面或返回总览。
            </p>
            {this.state.error && (
              <details className="error-boundary-details">
                <summary>错误详情</summary>
                <pre className="error-boundary-stack">{this.state.error.message}</pre>
                {this.state.errorInfo && (
                  <pre className="error-boundary-stack">{this.state.errorInfo.componentStack}</pre>
                )}
              </details>
            )}
            <div className="error-boundary-actions">
              <Button kind="primary" onClick={this.handleReset}>
                重试
              </Button>
              <Button onClick={() => window.location.reload()}>刷新页面</Button>
            </div>
          </div>
          <style>{`
            .error-boundary {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 400px;
              padding: 24px;
            }
            .error-boundary-content {
              max-width: 480px;
              text-align: center;
            }
            .error-boundary-icon {
              font-size: 48px;
              margin-bottom: 16px;
            }
            .error-boundary-title {
              font-size: 24px;
              font-weight: 600;
              margin-bottom: 8px;
              color: var(--text-primary, #1a1a1a);
            }
            .error-boundary-description {
              font-size: 14px;
              color: var(--text-secondary, #666);
              margin-bottom: 24px;
            }
            .error-boundary-details {
              margin-bottom: 24px;
              text-align: left;
            }
            .error-boundary-details summary {
              cursor: pointer;
              font-size: 14px;
              color: var(--text-secondary, #666);
            }
            .error-boundary-stack {
              font-size: 12px;
              padding: 12px;
              background: var(--bg-secondary, #f5f5f5);
              border-radius: 8px;
              overflow: auto;
              margin-top: 8px;
              white-space: pre-wrap;
              word-break: break-word;
            }
            .error-boundary-actions {
              display: flex;
              gap: 12px;
              justify-content: center;
            }
            @media (prefers-color-scheme: dark) {
              .error-boundary-title {
                color: #fff;
              }
              .error-boundary-description,
              .error-boundary-details summary {
                color: #aaa;
              }
              .error-boundary-stack {
                background: #2a2a2a;
              }
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onReset={() => {
        // 可以在这里执行页面重置逻辑
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
