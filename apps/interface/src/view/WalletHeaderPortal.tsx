import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";

export function WalletHeaderPortal({
  children,
}: {
  children: ReactNode;
}): JSX.Element | null {
  const element = document.getElementById("wallet-header");
  return element !== null ? createPortal(children, element) : null;
}
