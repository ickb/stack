import { createElement, Suspense, useState, type JSX } from "react";
import ErrorBoundary from "./ErrorBoundary.tsx";
import {
  createInterface,
  loadInterface,
  reloadInterface,
  type InterfaceLoader,
} from "./lazyInterface.ts";

export function InterfaceRoot({
  loader = loadInterface,
}: Readonly<{ loader?: InterfaceLoader }>): JSX.Element {
  const [Interface] = useState(() => createInterface(loader));

  return (
    <ErrorBoundary onRetry={reloadInterface}>
      <Suspense fallback={<InterfaceLoading />}>
        <div className="ickb-app-content">{createElement(Interface)}</div>
      </Suspense>
    </ErrorBoundary>
  );
}

export function InterfaceLoading(): JSX.Element {
  return (
    <div
      className="ickb-app-content grid place-items-center px-4 text-center text-ickb-muted"
      role="status"
      aria-live="polite"
    >
      Loading wallet interface...
    </div>
  );
}
