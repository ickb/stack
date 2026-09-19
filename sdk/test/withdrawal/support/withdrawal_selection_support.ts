import { ccc } from "@ckb-ccc/core";
import { headerLike, script } from "@ickb/testkit";
import { ickbDepositCellFrom } from "../../../src/core/cells.ts";
import { DaoManager, type IckbDepositCell } from "../../../src/core/index.ts";

export const TIP = headerLike();

/** A ready deposit whose claim date is `maturityUnix`, keyed by its out point. */
export function readyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
  key = `ready-${String(maturityUnix)}`,
): IckbDepositCell {
  return deposit(udtValue, epochAtUnix(maturityUnix), true, key);
}

/** A deposit at a whole epoch, for ring segment tests. */
export function ringDeposit(
  udtValue: bigint,
  epoch: bigint,
  options?: { isReady?: boolean; key?: string },
): IckbDepositCell {
  return deposit(
    udtValue,
    ccc.Epoch.from([epoch, 0n, 1n]),
    options?.isReady ?? true,
    options?.key ?? `ring-${String(epoch)}-${String(udtValue)}`,
  );
}

function deposit(
  udtValue: bigint,
  maturity: ccc.Epoch,
  isReady: boolean,
  key: string,
): IckbDepositCell {
  const logic = script("22");
  const cell = ccc.Cell.from({
    outPoint: { txHash: ccc.hashCkb(ccc.bytesFrom(key, "utf8")), index: 0n },
    cellOutput: { capacity: udtValue, lock: logic, type: script("33") },
    outputData: DaoManager.depositData(),
  });
  const result = ickbDepositCellFrom(
    {
      cell,
      headers: [{ header: TIP, txHash: cell.outPoint.txHash }, { header: TIP }],
      interests: 0n,
      maturity,
      isReady,
      isDeposit: true,
      ckbValue: udtValue,
      udtValue: 0n,
    },
    logic,
  );
  Object.assign(result, { udtValue });
  return result;
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
