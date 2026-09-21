import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The wallet page: the header in the title block's mount, then three equal sections. The
 * button follows the form; the chart is context and comes last (decisions amendment 52(ag)).
 */
export function WalletPage({
  header,
  form,
  action,
  chart,
}: Readonly<{
  header: ReactNode;
  form: ReactNode;
  action: ReactNode;
  chart: ReactNode;
}>): JSX.Element {
  const mount = document.getElementById("wallet-header");
  return (
    <>
      {mount === null ? null : createPortal(header, mount)}
      <div className="grid h-full grid-rows-3 divide-y divide-ickb-border/70">
        <div className="ickb-wallet-section min-h-0">{form}</div>
        <div className="ickb-wallet-section min-h-0">{action}</div>
        <div className="ickb-wallet-section min-h-0">{chart}</div>
      </div>
    </>
  );
}
