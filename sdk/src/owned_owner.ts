import { ccc, mol } from "@ckb-ccc/core";
import {
  assertDaoOutputLimit,
  DAO_HEADER_INDEX_LIMIT,
  DaoHeaderIndexError,
  isDaoWithdrawalRequest,
  pushHeaderDep,
} from "./dao.ts";
import type { IckbDepositCell } from "./logic.ts";
import { ickbValue } from "./udt.ts";
import { CheckedInt32LE, CheckedUint64LE } from "./utils/codec.ts";
import { headersByNumber, transactionHeaders } from "./utils/transaction_header.ts";
import type { ScriptDeps, TransactionHeader, ValueComponents } from "./utils/utils.ts";

/**
 * A live Nervos DAO withdrawal request cell, valued at the two headers it spans.
 */
export interface DaoWithdrawalRequestCell {
  /** The DAO withdrawal request cell. */
  cell: ccc.Cell;
  /** The deposit header and the request's own header. */
  headers: [TransactionHeader, TransactionHeader];
  /** The DAO interest accrued between the two headers. */
  interests: ccc.Num;
  /** The DAO claim epoch of the request. */
  maturity: ccc.Epoch;
  /** Whether the claim epoch is at or before the tip: the request can be withdrawn. */
  isReady: boolean;
  /** The capacity the withdrawal returns: the cell's plus the interest. */
  ckbValue: ccc.FixedPoint;
}

/** The owner marker payload: where its owned cell sits in their shared transaction. */
export interface OwnerData {
  /** Signed output-index distance from the owner marker to the owned cell. */
  ownedDistance: ccc.Num;
}

const OwnerDataCodec = mol.struct({
  ownedDistance: CheckedInt32LE,
});
// An owner marker's fixed prefix: a signed 32-bit distance.
const ownerDataBytes = 4;

/** Encodes an owner marker payload. */
export function encodeOwnerData(data: OwnerData): ccc.Bytes {
  return OwnerDataCodec.encode(data);
}

/**
 * Decodes the fixed owner-data prefix and ignores trailing cell payload bytes.
 *
 * @remarks The owner data prefix is 4 bytes after the `0x` marker: a signed little-endian
 * relative output-index distance to the owned cell. Later bytes belong to other protocol
 * data and are intentionally tolerated here.
 */
export function decodeOwnerData(outputData: ccc.Hex): OwnerData {
  const { ownedDistance } = OwnerDataCodec.decode(
    outputData.slice(0, 2 + 2 * ownerDataBytes),
  );
  return { ownedDistance: ccc.numFrom(ownedDistance) };
}

/**
 * Wraps an owner marker cell that references an owned withdrawal request.
 */
export class OwnerCell implements ValueComponents {
  /** The live owner marker cell whose output data points to the owned request. */
  public cell: ccc.Cell;

  /** Owner marker cells carry no UDT value. */
  public readonly udtValue = 0n;

  /** Creates an owner marker wrapper for a live cell. */
  constructor(cell: ccc.Cell) {
    this.cell = cell;
  }

  /** Returns the CKB capacity held by the owner marker cell. */
  public get ckbValue(): ccc.FixedPoint {
    return this.cell.cellOutput.capacity;
  }

  /**
   * Returns the owned withdrawal request out point referenced by this owner marker.
   *
   * @remarks Owner data stores a signed output-index distance. The owned cell is resolved
   * on the same transaction hash as the owner marker cell.
   */
  public getOwned(): ccc.OutPoint {
    const { txHash, index } = this.cell.outPoint;
    let ownedDistance: ccc.Num;
    try {
      ({ ownedDistance } = decodeOwnerData(this.cell.outputData));
    } catch (error) {
      throw new Error(
        `Invalid owner marker payload at ${this.cell.outPoint.toHex()}: ${this.cell.outputData}`,
        { cause: error },
      );
    }
    const ownedIndex = index + ownedDistance;
    if (ownedIndex < 0n) {
      throw new Error(
        `Owner marker ${this.cell.outPoint.toHex()} points before output 0 with distance ${String(ownedDistance)}`,
      );
    }
    return new ccc.OutPoint(txHash, ownedIndex);
  }
}

/**
 * Pairs an owned DAO withdrawal request with the owner marker cell that points to it.
 */
export class WithdrawalGroup implements ValueComponents {
  /** The decoded DAO withdrawal request controlled by this owner marker. */
  public owned: DaoWithdrawalRequestCell;

  /** The owner marker cell that references the owned withdrawal request. */
  public owner: OwnerCell;

  /** Creates a withdrawal group from a decoded request and its owner marker. */
  constructor(owned: DaoWithdrawalRequestCell, owner: OwnerCell) {
    this.owned = owned;
    this.owner = owner;
  }

  /** Returns the total CKB capacity in the owned withdrawal and owner marker cells. */
  public get ckbValue(): ccc.FixedPoint {
    return this.owned.ckbValue + this.owner.cell.cellOutput.capacity;
  }

  /** Returns the iCKB amount represented by the owned withdrawal request. */
  public get udtValue(): ccc.FixedPoint {
    return ickbValue(this.owned.cell.capacityFree, this.owned.headers[0].header);
  }
}

/**
 * Builds and finds Owned Owner withdrawal groups for an iCKB deployment.
 */
export class OwnedOwnerManager implements ScriptDeps {
  /** The Owned Owner script used as owner marker type and withdrawal request lock. */
  public readonly script: ccc.Script;

  /** Cell dependencies required to execute the Owned Owner script. */
  public readonly cellDeps: ccc.CellDep[];

  /** The Nervos DAO script the withdrawal requests carry, with its cell deps. */
  public readonly dao: ScriptDeps;

  /** Creates the manager for one Owned Owner deployment over one DAO deployment. */
  constructor(script: ccc.Script, cellDeps: ccc.CellDep[], dao: ScriptDeps) {
    this.script = script;
    this.cellDeps = cellDeps;
    this.dao = dao;
  }

  /** Whether the cell is an owner marker for this manager's script. */
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

  /** Whether the cell is a DAO withdrawal request locked by this manager's script. */
  public isOwned(cell: ccc.Cell): boolean {
    return (
      isDaoWithdrawalRequest(cell, this.dao.script) &&
      cell.cellOutput.lock.eq(this.script)
    );
  }

  /**
   * Spends the deposits into DAO withdrawal requests locked by the Owned Owner script,
   * each followed by an owner marker locked by `lock` that points back at it.
   *
   * @remarks Caller must ensure UDT cellDeps are added to the transaction, for example
   * via `ickbUdt.addCellDeps(tx)`.
   */
  public requestWithdrawal(
    txLike: ccc.TransactionLike,
    deposits: IckbDepositCell[],
    lock: ccc.Script,
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (deposits.length === 0) {
      return tx;
    }
    // The DAO script pairs each request output with the input at the same index.
    if (
      tx.inputs.length !== tx.outputs.length ||
      tx.outputs.length !== tx.outputsData.length
    ) {
      throw new Error("Transaction has different inputs and outputs lengths");
    }
    tx.addCellDeps(this.cellDeps);
    tx.addCellDeps(this.dao.cellDeps);
    const requestStart = tx.outputs.length;
    for (const { cell, headers } of deposits) {
      const depositHeader = headers[0];
      if (depositHeader.txHash !== cell.outPoint.txHash) {
        throw new Error(
          `DAO deposit ${cell.outPoint.toHex()} header txHash ${String(depositHeader.txHash)} does not match cell txHash ${cell.outPoint.txHash}`,
        );
      }
      if (cell.cellOutput.lock.args.length !== this.script.args.length) {
        throw new Error("Withdrawal request lock args has different size from deposit");
      }
      pushHeaderDep(tx, depositHeader.header.hash);
      tx.addInput(cell);
      tx.addOutput(
        { capacity: cell.cellOutput.capacity, lock: this.script, type: this.dao.script },
        CheckedUint64LE.encode(depositHeader.header.number),
      );
    }
    for (let index = 0; index < deposits.length; index += 1) {
      tx.addOutput(
        { lock, type: this.script },
        // Negative: owner markers are appended after their withdrawal outputs.
        encodeOwnerData({
          ownedDistance: BigInt(requestStart + index - tx.outputs.length),
        }),
      );
    }
    assertDaoOutputLimit(tx, this.dao.script);
    return tx;
  }

  /**
   * Spends the owned withdrawal requests and their owner markers, with the DAO header deps,
   * since, and witness each request needs.
   *
   * @remarks The distinct deposit headers are moved to the front of the header deps and
   * the withdrawal headers appended, so a deposit header's index is its rank among the
   * collected withdrawals. Caller must ensure UDT cellDeps are added to the transaction.
   */
  public withdraw(
    txLike: ccc.TransactionLike,
    withdrawalGroups: WithdrawalGroup[],
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (withdrawalGroups.length === 0) {
      return tx;
    }
    for (const group of withdrawalGroups) {
      const ownedOutPoint = group.owned.cell.outPoint;
      const linkedOutPoint = group.owner.getOwned();
      if (!linkedOutPoint.eq(ownedOutPoint)) {
        throw new Error(
          `Withdrawal owner ${group.owner.cell.outPoint.toHex()} points to ${linkedOutPoint.toHex()} but group owned cell is ${ownedOutPoint.toHex()}`,
        );
      }
      const { cell, headers } = group.owned;
      if (headers[1].txHash !== cell.outPoint.txHash) {
        throw new Error(
          `DAO withdrawal request ${cell.outPoint.toHex()} header txHash ${String(headers[1].txHash)} does not match cell txHash ${cell.outPoint.txHash}`,
        );
      }
    }
    tx.addCellDeps(this.cellDeps);
    tx.addCellDeps(this.dao.cellDeps);
    // Only this step names a header by index, and the deployed script reads that index as
    // one byte, so the deposit headers go first, ahead of whatever the requests and receipts
    // pushed: the limit then counts these alone. Safe because nothing else in the stack reads
    // a header by position and every built transaction passes here once (52(an)).
    const depositHashes = [
      ...new Set(withdrawalGroups.map(({ owned }) => owned.headers[0].header.hash)),
    ];
    tx.headerDeps = [
      ...depositHashes,
      ...tx.headerDeps.filter((hash) => !depositHashes.includes(hash)),
    ];
    for (const { owned } of withdrawalGroups) {
      pushHeaderDep(tx, owned.headers[1].header.hash);
    }
    for (const { owned } of withdrawalGroups) {
      const headerIndex = tx.headerDeps.indexOf(owned.headers[0].header.hash);
      // The deployed dao.c reads one byte of the u64 index field (RFC 0023 erratum,
      // nervosnetwork/rfcs pull 456), so index 256 would be read as 0.
      if (headerIndex >= DAO_HEADER_INDEX_LIMIT) {
        throw new DaoHeaderIndexError(headerIndex);
      }
      const inputIndex =
        tx.addInput({
          outPoint: owned.cell.outPoint,
          cellOutput: owned.cell.cellOutput,
          outputData: owned.cell.outputData,
          since: { relative: "absolute", metric: "epoch", value: owned.maturity.toNum() },
        }) - 1;
      const witness = tx.getWitnessArgs(inputIndex) ?? ccc.WitnessArgs.from({});
      if ((witness.inputType ?? "") !== "") {
        throw new Error("Witnesses of withdrawal request already in use");
      }
      witness.inputType = ccc.hexFrom(CheckedUint64LE.encode(headerIndex));
      tx.setWitnessArgs(inputIndex, witness);
    }
    for (const { owner } of withdrawalGroups) {
      tx.addInput(owner.cell);
    }
    assertDaoOutputLimit(tx, this.dao.script);
    return tx;
  }

  /**
   * The owner markers among `cells` paired with their owned withdrawal requests, which live
   * in the marker's own transaction at the encoded distance. Markers whose target is not an
   * owned withdrawal request are skipped. Each header is read once per batch.
   */
  public async withdrawalGroupsFrom(
    client: ccc.Client,
    cells: readonly ccc.Cell[],
    tip: ccc.ClientBlockHeader,
  ): Promise<WithdrawalGroup[]> {
    const owners = cells
      .filter((cell) => this.isOwner(cell))
      .map((cell) => new OwnerCell(cell));
    const ownedCells = await Promise.all(
      owners.map(async (owner) => client.getCell(owner.getOwned())),
    );
    const pairs = owners.flatMap((owner, index) => {
      const owned = ownedCells[index];
      return owned !== undefined && this.isOwned(owned)
        ? [{ owner, owned, depositBlockNumber: depositBlockNumberOf(owned) }]
        : [];
    });
    const [depositHeaders, requestHeaders] = await Promise.all([
      headersByNumber(
        client,
        pairs.map((pair) => pair.depositBlockNumber),
      ),
      transactionHeaders(
        client,
        pairs.map((pair) => pair.owned.outPoint.txHash),
      ),
    ]);
    return pairs.map(({ owner, owned, depositBlockNumber }) => {
      const { txHash } = owned.outPoint;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- both headers were read above.
      const depositHeader = depositHeaders.get(depositBlockNumber)!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- both headers were read above.
      const requestHeader = requestHeaders.get(txHash)!;
      return new WithdrawalGroup(
        withdrawalRequestCell(
          owned,
          depositHeader,
          { header: requestHeader, txHash },
          tip,
        ),
        owner,
      );
    });
  }
}

/** Values a DAO withdrawal request at its two headers and judges it claimable at the tip. */
export function withdrawalRequestCell(
  cell: ccc.Cell,
  depositHeader: ccc.ClientBlockHeader,
  requestHeader: TransactionHeader,
  tip: ccc.ClientBlockHeader,
): DaoWithdrawalRequestCell {
  const interests = ccc.calcDaoProfit(
    cell.capacityFree,
    depositHeader,
    requestHeader.header,
  );
  const maturity = ccc.calcDaoClaimEpoch(depositHeader, requestHeader.header);
  return {
    cell,
    headers: [{ header: depositHeader }, requestHeader],
    interests,
    maturity,
    isReady: maturity.compare(tip.epoch) <= 0,
    ckbValue: cell.cellOutput.capacity + interests,
  };
}

/** The deposit block number a withdrawal request records in its data. */
function depositBlockNumberOf(cell: ccc.Cell): ccc.Num {
  try {
    return CheckedUint64LE.decode(cell.outputData);
  } catch (error) {
    throw new Error(
      `Invalid DAO withdrawal request payload at ${cell.outPoint.toHex()}: ${cell.outputData}`,
      { cause: error },
    );
  }
}
