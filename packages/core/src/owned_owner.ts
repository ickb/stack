import { ccc } from "@ckb-ccc/core";
import {
  collectCompleteScan,
  defaultFindCellsLimit,
  unique,
  type ScriptDeps,
} from "@ickb/utils";
import {
  assertDaoOutputLimit,
  DaoManager,
  type DaoCellFromCache,
} from "@ickb/dao";
import { OwnerData } from "./entities.js";
import { OwnerCell, WithdrawalGroup, type IckbDepositCell } from "./cells.js";

/**
 * Manages ownership and withdrawal operations for owned cells.
 * Implements the ScriptDeps interface.
 */
export class OwnedOwnerManager implements ScriptDeps {
  /**
   * Creates an instance of OwnedOwnerManager.
   *
   * @param script - The script associated with the OwnedOwner script.
   * @param cellDeps - The cell dependencies for the OwnedOwner script.
   * @param daoManager - The DAO manager for handling withdrawal requests.
   */
  constructor(
    public readonly script: ccc.Script,
    public readonly cellDeps: ccc.CellDep[],
    public readonly daoManager: DaoManager,
  ) {}

  /**
   * Checks if the specified cell is an owner cell.
   *
   * @param cell - The cell to check against.
   * @returns True if the cell is an owner cell, otherwise false.
   */
  isOwner(cell: ccc.Cell): boolean {
    return (
      Boolean(cell.cellOutput.type?.eq(this.script)) &&
      cell.outputData.length >= 10
    );
  }

  /**
   * Checks if the specified cell is an owned cell and is a withdrawal request.
   *
   * @param cell - The cell to check against.
   * @returns True if the cell is owned cell, otherwise false.
   */
  isOwned(cell: ccc.Cell): boolean {
    return (
      this.daoManager.isWithdrawalRequest(cell) &&
      cell.cellOutput.lock.eq(this.script)
    );
  }

  /**
   * Requests a withdrawal for the specified deposits.
   *
   * @param txLike - The transaction to add the withdrawal request to.
   * @param deposits - The deposits to withdraw.
   * @param lock - The lock script for the output.
   * @param options - Optional parameters for the withdrawal request.
   * @param options.isReadyOnly - Whether to only process ready deposits (default: false).
   * @param options.requiredLiveDeposits - Live deposit anchors that must remain resolvable while requested deposits are spent.
   * @returns void
   *
   * @remarks Caller must ensure UDT cellDeps are added to the transaction
   * (e.g., via ickbUdt.addCellDeps(tx)).
   */
  async requestWithdrawal(
    txLike: ccc.TransactionLike,
    deposits: IckbDepositCell[],
    lock: ccc.Script,
    client: ccc.Client,
    options?: {
      isReadyOnly?: boolean;
      requiredLiveDeposits?: IckbDepositCell[];
    },
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);
    const isReadyOnly = options?.isReadyOnly ?? false;
    if (isReadyOnly) {
      deposits = deposits.filter((d) => d.isReady);
    }
    if (deposits.length === 0) {
      return tx;
    }
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

    const requiredLiveDeposits = options?.requiredLiveDeposits ?? [];
    const requiredAnchorOutPoints = new Set<string>();
    for (const deposit of requiredLiveDeposits) {
      if (!deposit.isReady) {
        throw new Error("Withdrawal live deposit anchor is not ready");
      }
      const outPoint = deposit.cell.outPoint.toHex();
      if (requiredAnchorOutPoints.has(outPoint)) {
        throw new Error("Withdrawal live deposit anchor is duplicated");
      }
      requiredAnchorOutPoints.add(outPoint);
      if (spentOutPoints.has(outPoint)) {
        throw new Error("Withdrawal live deposit anchor is also being spent");
      }
    }
    const daoOptions = { isReadyOnly: false }; // non isReady deposits already filtered

    const withdrawalOutputStart = tx.outputs.length;
    tx = await this.daoManager.requestWithdrawal(
      tx,
      deposits,
      this.script,
      client,
      daoOptions,
    );
    if (tx.outputs.length < withdrawalOutputStart + deposits.length) {
      throw new Error("DAO withdrawal request did not add expected outputs");
    }
    tx.addCellDeps(this.cellDeps);

    for (let index = 0; index < deposits.length; index += 1) {
      const withdrawalOutput = tx.outputs[withdrawalOutputStart + index];
      if (
        !withdrawalOutput?.lock.eq(this.script) ||
        withdrawalOutput.type?.eq(this.daoManager.script) !== true
      ) {
        throw new Error("DAO withdrawal request output order changed");
      }

      const ownerOutputIndex = tx.outputs.length;
      tx.addOutput(
        {
          lock: lock,
          type: this.script,
        },
        OwnerData.encode({
          ownedDistance: BigInt(withdrawalOutputStart + index) - BigInt(ownerOutputIndex),
        }),
      );
    }

    for (const deposit of requiredLiveDeposits) {
      tx.addCellDeps({ outPoint: deposit.cell.outPoint, depType: "code" });
    }

    await assertDaoOutputLimit(tx, client);
    return tx;
  }

  /**
   * Completes the withdrawals of the specified withdrawal groups.
   *
   * @param txLike - The transaction to add the withdrawals to.
   * @param withdrawalGroups - The withdrawal groups to process.
   * @param options - Optional parameters for the withdrawal process.
   * @param options.isReadyOnly - Whether to only process ready withdrawal groups (default: false).
   * @returns void
   *
   * @remarks Caller must ensure UDT cellDeps are added to the transaction
   * (e.g., via ickbUdt.addCellDeps(tx)).
   */
  async withdraw(
    txLike: ccc.TransactionLike,
    withdrawalGroups: WithdrawalGroup[],
    client: ccc.Client,
    options?: {
      isReadyOnly?: boolean;
    },
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);
    const isReadyOnly = options?.isReadyOnly ?? false;
    if (isReadyOnly) {
      withdrawalGroups = withdrawalGroups.filter((g) => g.owned.isReady);
    }
    if (withdrawalGroups.length === 0) {
      return tx;
    }

    tx.addCellDeps(this.cellDeps);

    const requests = withdrawalGroups.map((g) => g.owned);
    tx = await this.daoManager.withdraw(tx, requests, client);

    for (const { owner } of withdrawalGroups) {
      tx.addInput(owner.cell);
    }

    // assertDaoOutputLimit already called inside daoManager.withdraw;
    // only owner inputs (not outputs) are added after, so no re-check needed.
    return tx;
  }

  /**
   * Async generator that finds and yields withdrawal groups for the specified lock scripts.
   *
   * A "withdrawal group" pairs an owner cell with its corresponding DAO withdrawal cell.
   *
   * @param client
   *   A CKB client instance providing:
   *   - `findCells(query, order, limit)` for cached searches
   *   - `findCellsOnChain(query, order, limit)` for on-chain searches
   *   - `getTipHeader()` to fetch the latest block header
   *
   * @param locks
   *   An array of lock scripts. Only owner cells whose `cellOutput.lock` exactly
   *   matches one of these scripts will be considered.
   *
   * @param options
   *   Optional parameters to refine the search:
   *   - `tip?: ClientBlockHeader`
   *       Reference block header for epoch and block-number lookups.
   *       Defaults to `await client.getTipHeader()`.
   *   - `onChain?: boolean`
   *       If `true`, uses `findCellsOnChain`; otherwise, uses `findCells`.
   *       Default: `false`.
   *   - `limit?: number`
   *       Maximum number of cells to fetch per lock script.
   *       Defaults to `defaultFindCellsLimit` (400).
   *
   * @yields
   *   {@link WithdrawalGroup} objects, each containing:
   *   - the owner cell (`OwnerCell`)
   *   - the corresponding DAO withdrawal request cell
   *
   * @remarks
   * - Deduplicates `locks` via `unique(locks)`.
   * - Applies an RPC filter with:
   *     • `script: this.script` (DAO type script)
   * - Skips any cell that:
   *     1. Fails `this.isOwner(cell)`
   *     2. Has a non-matching lock script
   * - For each owner cell:
   *     1. Construct an `OwnerCell` instance.
   *     2. Fetch the referenced cell and skip it unless it is an Owned Owner withdrawal request.
   *     3. Decode the validated withdrawal request and yield a `WithdrawalGroup`.
   */
  async *findWithdrawalGroups(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
      limit?: number;
    },
  ): AsyncGenerator<WithdrawalGroup> {
    const tip = options?.tip ?? (await client.getTipHeader());
    const limit = options?.limit ?? defaultFindCellsLimit;
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

      const ownerCandidates = (await collectCompleteScan(
        (scanLimit) => options?.onChain
          ? client.findCellsOnChain(...findCellsArgs, scanLimit)
          : client.findCells(...findCellsArgs, scanLimit),
        { limit, label: "owner cell" },
      ))
        .filter((cell) => this.isOwner(cell) && cell.cellOutput.lock.eq(lock))
        .map((cell) => new OwnerCell(cell));

      const ownedCells = await Promise.all(
        ownerCandidates.map((owner) => client.getCell(owner.getOwned())),
      );

      const headerCache: DaoCellFromCache["headerCache"] = new Map();
      const transactionCache: DaoCellFromCache["transactionCache"] = new Map();
      const withdrawalGroups = await Promise.all(
        ownerCandidates.map(async (owner, index) => {
          const ownedCell = ownedCells[index];
          if (!ownedCell || !this.isOwned(ownedCell)) {
            return;
          }
          const owned = await this.daoManager.withdrawalRequestCellFrom(
            ownedCell,
            client,
            { tip, headerCache, transactionCache },
          );
          return new WithdrawalGroup(owned, owner);
        }),
      );

      for (const group of withdrawalGroups) {
        if (group) {
          yield group;
        }
      }
    }
  }
}
