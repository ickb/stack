import { ccc } from "@ckb-ccc/core";
import type { ScriptDeps } from "../utils/index.ts";
import { OwnerCell, WithdrawalGroup, type IckbDepositCell } from "./cells.ts";
import type { DaoManager } from "./dao.ts";
import type { DaoCellFromCache } from "./dao_cells.ts";
import { assertDaoOutputLimit } from "./dao_output_limit.ts";
import { OwnerData } from "./entities.ts";

/**
 * Builds and finds Owned Owner withdrawal groups for an iCKB deployment.
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
   * @returns The updated partial transaction.
   *
   * @remarks Duplicate deposits and deposits already spent by the transaction throw.
   * Caller must ensure UDT cellDeps are added to the transaction, for example
   * via `ickbUdt.addCellDeps(tx)`.
   */
  public requestWithdrawal(
    txLike: ccc.TransactionLike | ccc.Transaction,
    deposits: IckbDepositCell[],
    lock: ccc.Script,
  ): ccc.Transaction {
    let tx = ccc.Transaction.from(txLike);
    if (deposits.length === 0) {
      return tx;
    }
    assertWithdrawalDepositsUnspent(tx, deposits);

    const withdrawalOutputStart = tx.outputs.length;
    tx = this.daoManager.requestWithdrawal(tx, deposits, this.script);
    const withdrawalOutputs = withdrawalRequestOutputs(
      tx,
      withdrawalOutputStart,
      deposits.length,
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

    assertDaoOutputLimit(tx, this.daoManager.script);
    return tx;
  }

  /**
   * Adds owned withdrawal requests and their owner markers as inputs.
   *
   * @returns The updated partial transaction.
   *
   * @remarks Caller must ensure UDT cellDeps are added to the transaction
   * (e.g., via ickbUdt.addCellDeps(tx)).
   */
  public withdraw(
    txLike: ccc.TransactionLike | ccc.Transaction,
    withdrawalGroups: WithdrawalGroup[],
  ): ccc.Transaction {
    let tx = ccc.Transaction.from(txLike);
    if (withdrawalGroups.length === 0) {
      return tx;
    }
    for (const group of withdrawalGroups) {
      assertWithdrawalGroupLinked(group);
    }

    tx.addCellDeps(this.cellDeps);

    const requests = withdrawalGroups.map((group) => group.owned);
    tx = this.daoManager.withdraw(tx, requests);

    for (const { owner } of withdrawalGroups) {
      tx.addInput(cellInputLikeFrom(owner.cell));
    }

    return tx;
  }

  /**
   * Resolves the owner markers among `cells` into withdrawal groups.
   *
   * @remarks The caller enumerates the account's cells once; this only recognizes
   * owner markers and fetches each owned withdrawal request, which lives in the
   * marker's own transaction at the encoded distance. Markers whose target is not an
   * owned withdrawal request are skipped. Header and transaction caches span the batch.
   */
  public async withdrawalGroupsFrom(
    client: ccc.Client,
    cells: readonly ccc.Cell[],
    tip: ccc.ClientBlockHeader,
  ): Promise<WithdrawalGroup[]> {
    const headerCache: DaoCellFromCache["headerCache"] = new Map();
    const transactionCache: DaoCellFromCache["transactionCache"] = new Map();
    const owners = cells
      .filter((cell) => this.isOwner(cell))
      .map((cell) => new OwnerCell(cell));
    const ownedCells = await Promise.all(
      owners.map(async (owner) => client.getCell(owner.getOwned())),
    );
    const groups = await Promise.all(
      owners.map(async (owner, index): Promise<WithdrawalGroup | undefined> => {
        const ownedCell = ownedCells[index];
        if (ownedCell === undefined || !this.isOwned(ownedCell)) {
          return undefined;
        }
        const owned = await this.daoManager.withdrawalRequestCellFrom(ownedCell, client, {
          tip,
          headerCache,
          transactionCache,
        });
        return new WithdrawalGroup(owned, owner);
      }),
    );
    return groups.filter((group) => group !== undefined);
  }
}

function assertWithdrawalDepositsUnspent(
  tx: ccc.Transaction,
  deposits: IckbDepositCell[],
): void {
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
