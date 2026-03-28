import { Component, type ReactNode, type ErrorInfo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorDetails({ error }: { error: Error | null }) {
  const [showStack, setShowStack] = useState(false);
  if (!error) return null;

  return (
    <div className="mt-3 text-left w-full max-w-sm mx-auto">
      <button
        onClick={() => setShowStack(!showStack)}
        className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors"
      >
        {showStack ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Show Details
      </button>
      {showStack && (
        <pre className="mt-2 p-3 text-[11px] font-mono text-danger/80 bg-danger/5 border border-danger/10 rounded-btn overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
          {error.stack || error.message}
        </pre>
      )}
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[${this.props.name || 'Component'}] render error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-6 h-full min-h-[120px]">
          <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center mb-3">
            <AlertTriangle size={20} className="text-danger" />
          </div>
          <p className="text-sm font-medium text-ink">Something went wrong</p>
          <p className="text-xs text-muted mt-1 max-w-xs text-center">
            {this.state.error?.message || 'An unexpected error occurred in this section.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-btn border border-primary/20 text-primary hover:bg-primary/5 transition-colors"
          >
            <RotateCw size={12} />
            Try Again
          </button>
          <ErrorDetails error={this.state.error} />
        </div>
      );
    }
    return this.props.children;
  }
}
