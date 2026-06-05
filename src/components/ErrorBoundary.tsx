import React, { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-100 dark:bg-red-900/20 rounded-xl border border-red-500/30 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
            <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Component Crashed</h2>
            <p className="text-sm opacity-80 mb-4">{this.state.error?.message || "An unexpected error occurred."}</p>
            <button
                onClick={() => this.setState({ hasError: false })}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-bold shadow hover:bg-red-600 transition"
            >
                Thử Lại (Retry)
            </button>
        </div>
      );
    }

    return this.props.children;
  }
}
