import { ccc } from "@ckb-ccc/core";
import {
  defaultFindCellsLimit,
  unique,
  type ScriptDeps,
} from "@ickb/utils";
import { daoCellFrom, DaoManager } from "@ickb/dao";
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
    options = { ...options, isReadyOnly: false }; // non isReady deposits already filtered

    tx = await this.daoManager.requestWithdrawal(
      tx,
      deposits,
      this.script,
      client,
      options,
    );
    tx.addCellDeps(this.cellDeps);

    const outputData = OwnerData.encode({ ownedDistance: -deposits.length });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of deposits) {
      tx.addOutput(
        {
          lock: lock,
          type: this.script,
        },
        outputData,
      );
    }

    await ccc.assertDaoOutputLimit(tx, client);
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
   *   - the corresponding DAO withdrawal cell (`DaoCell`)
   *
   * @remarks
   * - Deduplicates `locks` via `unique(locks)`.
   * - Applies an RPC filter with:
   *     • `script: this.script` (DAO type script)
   * - Skips any cell that:
   *     1. Fails `this.isOwner(cell)`
   *     2. Has a non-matching lock script
   * - For each owner cell:
   *     1. Construct an `OwnerCell` instance
   *     2. Fetch the owned DAO withdrawal cell via `daoCellFrom({ outpoint, isDeposit: false, client, tip })`
   *     3. Yield a new `WithdrawalGroup(ownedDaoCell, ownerCell)`
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
        limit,
      ] as const;

      for await (const cell of options?.onChain
        ? client.findCellsOnChain(...findCellsArgs)
        : client.findCells(...findCellsArgs)) {
        if (!this.isOwner(cell) || !cell.cellOutput.lock.eq(lock)) {
          continue;
        }

        const owner = new OwnerCell(cell);
        const owned = await daoCellFrom({
          outpoint: owner.getOwned(),
          isDeposit: false,
          client,
          tip,
        });
        yield new WithdrawalGroup(owned, owner);
      }
    }
  }
}
