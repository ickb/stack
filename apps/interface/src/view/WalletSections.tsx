import type { JSX, ReactNode } from "react";

export function WalletSections({
  children,
}: Readonly<{
  children: ReactNode;
}>): JSX.Element {
  return (
    <div className="grid h-full grid-rows-3 divide-y divide-ickb-border/70">
      {children}
    </div>
  );
}

export function WalletSection({
  children,
}: Readonly<{
  children: ReactNode;
}>): JSX.Element {
  return <div className="ickb-wallet-section min-h-0">{children}</div>;
}
