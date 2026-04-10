import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "@/lib/sentry";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional: custom fallback UI */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — Attrape les erreurs JS dans l'arbre React enfant
 * et affiche un écran de secours au lieu d'un écran blanc.
 *
 * FIA-01: CRIT-01 fix — prevents blank screen on uncaught errors.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Report to Sentry (no-op when SDK is not yet loaded or DSN is not configured)
    captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack ?? "" } },
    });

    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] Erreur attrapée :", error, errorInfo);
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8 text-destructive"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Une erreur est survenue</h1>
            <p className="text-muted-foreground text-sm">
              L'application a rencontré un problème inattendu. Veuillez recharger la page.
            </p>
            {this.state.error && (
              <pre className="mt-4 p-3 bg-muted rounded-md text-left text-xs text-muted-foreground overflow-auto max-h-40">
                {this.state.error.message}
                {"\n"}
                {this.state.error.stack?.split("\n").slice(0, 5).join("\n")}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Recharger
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
