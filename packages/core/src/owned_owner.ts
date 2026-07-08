import { ccc } from "@ckb-ccc/core";
import { assertDaoOutputLimit, type DaoCellFromCache, type DaoManager } from "@ickb/dao";
import {
  collectPagedScan,
  defaultCellPageSize,
  unique,
  type ScriptDeps,
} from "@ickb/utils";
import { OwnerCell, WithdrawalGroup, type IckbDepositCell } from "./cells.ts";
import { OwnerData } from "./entities.ts";

/**
 * Builds and finds Owned Owner withdrawal groups for an iCKB deployment.
 *
 * @public
 */
export class OwnedOwnerManager implements ScriptDeps {
  /** The Owned Owner script used as owner marker type and withdrawal request lock. */
  public readonly script: ccc.Script;

  /** Cell dependencies required to execute the Owned Owner script. */
  public readonly cellDeps: ccc.CellDep[];

  /** DAO helper used to build and decode the underlying withdrawal requests. */
  public readonly daoManager: DaoManager;

  /**
   * Creates an Owned Owner manager for the script and DAO manager that belong to one deployment.
   */
  constructor(script: ccc.Script, cellDeps: ccc.CellDep[], daoManager: DaoManager) {
    this.script = script;
    this.cellDeps = cellDeps;
    this.daoManager = daoManager;
  }

  /**
   * Returns true when the cell is an owner marker for this manager's script.
   */
  public isOwner(cell: ccc.Cell): boolean {
    if (cell.cellOutput.type?.eq(this.script) !== true || cell.outputData.length < 10) {
      return false;
    }
    try {
      new OwnerCell(cell).getOwned();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the cell is a DAO withdrawal request locked by this manager's script.
   */
  public isOwned(cell: ccc.Cell): boolean {
    return (
      this.daoManager.isWithdrawalRequest(cell) && cell.cellOutput.lock.eq(this.script)
    );
  }

  /**
   * Adds DAO withdrawal request outputs and owner marker outputs for the selected deposits.
   *
   * @param options - Withdrawal options. `isReadyOnly` skips deposits that are not ready. `requiredLiveDeposits` adds live deposit anchors as cell deps while requested deposits are spent.
   * @returns The updated partial transaction.
   *
   * @remarks Required live deposits are not spent; they anchor the withdrawal
   * request as live cell deps. Duplicate anchors, duplicate deposits, and anchors
   * that are also being spent throw. Anchor readiness is not required here.
   * Caller must ensure UDT cellDeps are added to the transaction, for example
   * via `ickbUdt.addCellDeps(tx)`.
   */
  public async requestWithdrawal(
    ...[txLike, deposits, lock, client, options]: [
      txLike: ccc.TransactionLike | ccc.Transaction,
      deposits: IckbDepositCell[],
      lock: ccc.Script,
      client: ccc.Client,
      options?: {
        isReadyOnly?: boolean;
        requiredLiveDeposits?: IckbDepositCell[];
      },
    ]
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);
    const selectedDeposits =
      options?.isReadyOnly === true
        ? deposits.filter((deposit) => deposit.isReady)
        : deposits;
    if (selectedDeposits.length === 0) {
      return tx;
    }
    const spentOutPoints = withdrawalSpentOutPoints(tx, selectedDeposits);
    const requiredLiveDeposits = options?.requiredLiveDeposits ?? [];
    assertRequiredLiveDepositsUnspent(requiredLiveDeposits, spentOutPoints);
    // Readiness filtering, when requested, happened above; preserve the selected deposits here.
    const daoOptions = { isReadyOnly: false };

    const withdrawalOutputStart = tx.outputs.length;
    tx = await this.daoManager.requestWithdrawal(
      tx,
      selectedDeposits,
      this.script,
      client,
      daoOptions,
    );
    const withdrawalOutputs = withdrawalRequestOutputs(
      tx,
      withdrawalOutputStart,
      selectedDeposits.length,
    );
    tx.addCellDeps(this.cellDeps);
    addWithdrawalOwnerOutputs({
      tx,
      withdrawalOutputs,
      withdrawalOutputStart,
      lock,
      ownerScript: this.script,
      daoScript: this.daoManager.script,
    });

    for (const deposit of requiredLiveDeposits) {
      tx.addCellDeps({ outPoint: deposit.cell.outPoint, depType: "code" });
    }

    await assertDaoOutputLimit(tx, client);
    return tx;
  }

  /**
   * Adds owned withdrawal requests and their owner markers as inputs.
   *
   * @returns The updated partial transaction.
   *
   * @remarks Set `isReadyOnly` to spend only ready requests. Caller must ensure
   * UDT cellDeps are added to the transaction (e.g., via ickbUdt.addCellDeps(tx)).
   */
  public async withdraw(
    txLike: ccc.TransactionLike | ccc.Transaction,
    withdrawalGroups: WithdrawalGroup[],
    client: ccc.Client,
    options?: {
      isReadyOnly?: boolean;
    },
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);
    const selectedWithdrawalGroups =
      options?.isReadyOnly === true
        ? withdrawalGroups.filter((group) => group.owned.isReady)
        : withdrawalGroups;
    if (selectedWithdrawalGroups.length === 0) {
      return tx;
    }
    for (const group of selectedWithdrawalGroups) {
      assertWithdrawalGroupLinked(group);
    }

    tx.addCellDeps(this.cellDeps);

    const requests = selectedWithdrawalGroups.map((group) => group.owned);
    tx = await this.daoManager.withdraw(tx, requests, client);

    for (const { owner } of selectedWithdrawalGroups) {
      tx.addInput(cellInputLikeFrom(owner.cell));
    }

    // assertDaoOutputLimit already called inside daoManager.withdraw;
    // only owner inputs (not outputs) are added after, so no re-check needed.
    return tx;
  }

  /**
   * Finds owner marker cells for the given locks and yields valid owned withdrawal groups.
   *
   * @param options - Scan options. `tip` controls readiness calculations, `onChain` bypasses cached cell queries, and `pageSize` is per lock.
   * @remarks Header and transaction caches are scoped to one lock scan batch so related DAO cell conversions share the same reads.
   */
  public async *findWithdrawalGroups(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
      pageSize?: number;
    },
  ): AsyncGenerator<WithdrawalGroup> {
    const tip = options?.tip ?? (await client.getTipHeader());
    const pageSize = options?.pageSize ?? defaultCellPageSize;
    for (const lock of unique(locks)) {
      const findCellsArgs = [
        {
          script: lock,
          scriptType: "lock",
          filter: {
            script: this.script,
          },
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
      ] as const;

      const ownerCandidates = (
        await collectPagedScan(
          (scanPageSize) =>
            options?.onChain === true
              ? client.findCellsOnChain(...findCellsArgs, scanPageSize)
              : client.findCells(...findCellsArgs, scanPageSize),
          { pageSize },
        )
      )
        .filter((cell) => this.isOwner(cell) && cell.cellOutput.lock.eq(lock))
        .map((cell) => new OwnerCell(cell));

      const ownedCells = await Promise.all(
        ownerCandidates.map(async (owner) => client.getCell(owner.getOwned())),
      );

      const headerCache: DaoCellFromCache["headerCache"] = new Map();
      const transactionCache: DaoCellFromCache["transactionCache"] = new Map();
      const withdrawalGroups = await Promise.all(
        ownerCandidates.map(
          async (owner, index): Promise<WithdrawalGroup | undefined> => {
            const ownedCell = ownedCells[index];
            if (ownedCell === undefined || !this.isOwned(ownedCell)) {
              return undefined;
            }
            const owned = await this.daoManager.withdrawalRequestCellFrom(
              ownedCell,
              client,
              {
                tip,
                headerCache,
                transactionCache,
              },
            );
            return new WithdrawalGroup(owned, owner);
          },
        ),
      );

      for (const group of withdrawalGroups) {
        if (group !== undefined) {
          yield group;
        }
      }
    }
  }
}

function withdrawalSpentOutPoints(
  tx: ccc.Transaction,
  deposits: IckbDepositCell[],
): Set<string> {
  const spentOutPoints = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  const requestedDepositOutPoints = new Set<string>();
  for (const deposit of deposits) {
    const outPoint = deposit.cell.outPoint.toHex();
    if (requestedDepositOutPoints.has(outPoint)) {
      throw new Error("Withdrawal deposit is duplicated");
    }
    requestedDepositOutPoints.add(outPoint);
    if (spentOutPoints.has(outPoint)) {
      throw new Error("Withdrawal deposit is already being spent");
    }
    spentOutPoints.add(outPoint);
  }
  return spentOutPoints;
}

function assertRequiredLiveDepositsUnspent(
  requiredLiveDeposits: IckbDepositCell[],
  spentOutPoints: Set<string>,
): void {
  const requiredAnchorOutPoints = new Set<string>();
  for (const deposit of requiredLiveDeposits) {
    const outPoint = deposit.cell.outPoint.toHex();
    if (requiredAnchorOutPoints.has(outPoint)) {
      throw new Error("Withdrawal live deposit anchor is duplicated");
    }
    requiredAnchorOutPoints.add(outPoint);
    if (spentOutPoints.has(outPoint)) {
      throw new Error("Withdrawal live deposit anchor is also being spent");
    }
  }
}

function withdrawalRequestOutputs(
  tx: ccc.Transaction,
  withdrawalOutputStart: number,
  depositCount: number,
): ccc.CellOutput[] {
  const outputs = tx.outputs.slice(
    withdrawalOutputStart,
    withdrawalOutputStart + depositCount,
  );
  if (outputs.length !== depositCount) {
    throw new Error("DAO withdrawal request did not add expected outputs");
  }
  return outputs;
}

interface AddWithdrawalOwnerOutputsOptions {
  tx: ccc.Transaction;
  withdrawalOutputs: ccc.CellOutput[];
  withdrawalOutputStart: number;
  lock: ccc.Script;
  ownerScript: ccc.Script;
  daoScript: ccc.Script;
}

function addWithdrawalOwnerOutputs({
  tx,
  withdrawalOutputs,
  withdrawalOutputStart,
  lock,
  ownerScript,
  daoScript,
}: AddWithdrawalOwnerOutputsOptions): void {
  for (const [index, withdrawalOutput] of withdrawalOutputs.entries()) {
    assertWithdrawalRequestOutput(withdrawalOutput, ownerScript, daoScript);
    const ownerOutputIndex = tx.outputs.length;
    tx.addOutput(
      { lock, type: ownerScript },
      OwnerData.encode({
        // ownedDistance is negative because owner markers are appended after their withdrawal outputs.
        ownedDistance: BigInt(withdrawalOutputStart + index) - BigInt(ownerOutputIndex),
      }),
    );
  }
}

function assertWithdrawalRequestOutput(
  withdrawalOutput: ccc.CellOutput,
  ownerScript: ccc.Script,
  daoScript: ccc.Script,
): void {
  if (
    !withdrawalOutput.lock.eq(ownerScript) ||
    withdrawalOutput.type?.eq(daoScript) !== true
  ) {
    throw new Error("DAO withdrawal request output order changed");
  }
}

function assertWithdrawalGroupLinked(group: WithdrawalGroup): void {
  const ownedOutPoint = group.owned.cell.outPoint;
  const linkedOutPoint = group.owner.getOwned();
  if (!linkedOutPoint.eq(ownedOutPoint)) {
    throw new Error(
      `Withdrawal owner ${group.owner.cell.outPoint.toHex()} points to ${linkedOutPoint.toHex()} but group owned cell is ${ownedOutPoint.toHex()}`,
    );
  }
}

function cellInputLikeFrom(cell: ccc.Cell): ccc.CellInputLike {
  return {
    outPoint: cell.outPoint,
    cellOutput: {
      capacity: cell.cellOutput.capacity,
      lock: cell.cellOutput.lock,
      ...(cell.cellOutput.type === undefined ? {} : { type: cell.cellOutput.type }),
    },
    outputData: cell.outputData,
  };
}
