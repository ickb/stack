import { ccc } from "@ckb-ccc/core";
import { headerLike } from "@ickb/testkit";

export const TIP = headerLike();

export interface TestDeposit {
  cell: { outPoint: { toHex: () => string } };
  isReady: boolean;
  udtValue: bigint;
  maturity: ccc.Epoch;
}

export function readyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
  key = `ready-${String(maturityUnix)}`,
): TestDeposit {
  return {
    cell: depositCell(key),
    isReady: true,
    udtValue,
    maturity: epochAtUnix(maturityUnix),
  };
}

export function ringDeposit(
  udtValue: bigint,
  epoch: bigint,
  options?: { isReady?: boolean; key?: string },
): TestDeposit {
  return {
    cell: depositCell(options?.key ?? `ring-${String(epoch)}-${String(udtValue)}`),
    isReady: options?.isReady ?? true,
    udtValue,
    maturity: ccc.Epoch.from([epoch, 0n, 1n]),
  };
}

export function depositCell(key: string): { outPoint: { toHex: () => string } } {
  return { outPoint: { toHex: () => key } };
}

function epochAtUnix(maturityUnix: bigint): ccc.Epoch {
  const relativeMs = maturityUnix - TIP.timestamp;
  const epochMs = 4n * 60n * 60n * 1000n;
  const integer = relativeMs / epochMs;
  const numerator = relativeMs % epochMs;
  return ccc.Epoch.from({
    integer: TIP.epoch.integer + integer,
    numerator,
    denominator: epochMs,
  });
}
