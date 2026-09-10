import type { JSX } from "react";
import { buttonClass } from "../shared/buttonStyles.ts";

export function CkbSignerRequired({
  open,
}: Readonly<{ open: () => unknown }>): JSX.Element {
  return (
    <div className="flex flex-col space-y-4">
      <p>iCKB requires a CKB signer.</p>
      <button
        className={buttonClass}
        onClick={() => {
          open();
        }}
      >
        Choose CKB signer
      </button>
    </div>
  );
}

export function UnsupportedNetwork({
  addressPrefix,
  open,
}: Readonly<{
  addressPrefix: string;
  open: () => unknown;
}>): JSX.Element {
  return (
    <div className="flex flex-col space-y-4">
      <p className="break-words">Unsupported CKB address prefix: {addressPrefix}</p>
      <button
        className={buttonClass}
        onClick={() => {
          open();
        }}
      >
        Switch network
      </button>
    </div>
  );
}

export function SwitchingWalletNetwork({
  open,
}: Readonly<{ open: () => unknown }>): JSX.Element {
  return (
    <div className="flex flex-col space-y-4">
      <p>Switching wallet network...</p>
      <button
        className={buttonClass}
        onClick={() => {
          open();
        }}
      >
        Open wallet connector
      </button>
    </div>
  );
}
