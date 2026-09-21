import { ccc } from "@ckb-ccc/core";
import { headerLike, script } from "@ickb/testkit";
import { depositData } from "../../../src/dao.ts";
import type { IckbDepositCell } from "../../../src/logic.ts";

export const TIP = headerLike();

/** A deposit whose claim date is `maturityUnix`, keyed by its out point. */
export function readyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
  key = `ready-${String(maturityUnix)}`,
): IckbDepositCell {
  return deposit(udtValue, epochAtUnix(maturityUnix), key);
}

/** A deposit at a whole epoch, for ring segment tests. */
export function ringDeposit(
  udtValue: bigint,
  epoch: bigint,
  options?: { key?: string },
): IckbDepositCell {
  return deposit(
    udtValue,
    ccc.Epoch.from([epoch, 0n, 1n]),
    options?.key ?? `ring-${String(epoch)}-${String(udtValue)}`,
  );
}

function deposit(udtValue: bigint, claimEpoch: ccc.Epoch, key: string): IckbDepositCell {
  const logic = script("22");
  const cell = ccc.Cell.from({
    outPoint: { txHash: ccc.hashCkb(ccc.bytesFrom(key, "utf8")), index: 0n },
    cellOutput: { capacity: udtValue, lock: logic, type: script("33") },
    outputData: depositData(),
  });
  return {
    cell,
    headers: [{ header: TIP, txHash: cell.outPoint.txHash }, { header: TIP }],
    interests: 0n,
    claimEpoch,
    ckbValue: udtValue,
    udtValue,
  };
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
