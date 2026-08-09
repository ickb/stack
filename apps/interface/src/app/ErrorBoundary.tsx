import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";
import { buttonClass } from "../shared/buttonStyles.ts";
import { errorMessageOf } from "../shared/utils.ts";

export default class ErrorBoundary extends Component<
  Readonly<{
    children: ReactNode;
    onRetry?: () => void;
  }>,
  {
    error: unknown;
  }
> {
  public override state: { error: unknown } = { error: undefined };

  public static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  public override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error(error, errorInfo.componentStack);
  }

  public override render(): ReactElement {
    if (this.state.error !== undefined) {
      return (
        <div className="flex h-full flex-col justify-center space-y-4 overflow-y-auto rounded border border-ickb-action-soft p-4 text-center">
          <p>Unable to render the wallet app.</p>
          <p className="text-sm break-words text-ickb-muted">
            {errorMessageOf(this.state.error)}
          </p>
          <button
            className={buttonClass}
            onClick={() => {
              this.props.onRetry?.();
              this.setState({ error: undefined });
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}
