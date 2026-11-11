import { ccc, mol } from "@ckb-ccc/core";
import { DAO, OWNED_OWNER } from "./constants.ts";
import { isDaoWithdrawalRequest, pushHeaderDep } from "./dao.ts";
import type { DepositCell } from "./logic.ts";
import { ickbValue } from "./udt.ts";
import { CheckedInt32LE, CheckedUint64LE } from "./utils/codec.ts";
import {
  headersByNumber,
  type ScannedCell,
  type ValueComponents,
} from "./utils/utils.ts";

/**
 * A live Nervos DAO withdrawal request cell, valued at the two headers it spans.
 */
export interface DaoWithdrawalRequestCell {
  /** The DAO withdrawal request cell. */
  cell: ccc.Cell;
  /** The deposit header and the request's own header. */
  headers: [ccc.ClientBlockHeader, ccc.ClientBlockHeader];
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
export class OwnerCell {
  /** The live owner marker cell whose output data points to the owned request. */
  public cell: ccc.Cell;

  /** Creates an owner marker wrapper for a live cell. */
  constructor(cell: ccc.Cell) {
    this.cell = cell;
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
    return ickbValue(this.owned.cell.capacityFree, this.owned.headers[0]);
  }
}

/** Whether the cell is an owner marker: typed by Owned Owner, with a readable payload. */
export function isOwner(cell: ccc.Cell): boolean {
  // getOwned refuses data too short for an owner payload.
  if (cell.cellOutput.type?.eq(OWNED_OWNER) !== true) {
    return false;
  }
  try {
    new OwnerCell(cell).getOwned();
    return true;
  } catch {
    return false;
  }
}

/** Whether the cell is a DAO withdrawal request locked by Owned Owner. */
export function isOwned(cell: ccc.Cell): boolean {
  return isDaoWithdrawalRequest(cell, DAO) && cell.cellOutput.lock.eq(OWNED_OWNER);
}

/**
 * Spends the deposits into DAO withdrawal requests locked by the Owned Owner script,
 * each followed by an owner marker locked by `lock` that points back at it.
 *
 * @remarks Completion (`completeTransaction`) adds the dep group that resolves
 * the Owned Owner, DAO and xUDT scripts.
 */
export function requestWithdrawal(
  txLike: ccc.TransactionLike,
  deposits: DepositCell[],
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
  const requestStart = tx.outputs.length;
  for (const { cell, header } of deposits) {
    if (cell.cellOutput.lock.args.length !== OWNED_OWNER.args.length) {
      throw new Error("Withdrawal request lock args has different size from deposit");
    }
    pushHeaderDep(tx, header.hash);
    tx.addInput(cell);
    tx.addOutput(
      { capacity: cell.cellOutput.capacity, lock: OWNED_OWNER, type: DAO },
      CheckedUint64LE.encode(header.number),
    );
  }
  for (let index = 0; index < deposits.length; index += 1) {
    tx.addOutput(
      { lock, type: OWNED_OWNER },
      // Negative: owner markers are appended after their withdrawal outputs.
      encodeOwnerData({
        ownedDistance: BigInt(requestStart + index - tx.outputs.length),
      }),
    );
  }
  return tx;
}

/**
 * Spends the owned withdrawal requests and their owner markers, with the DAO header deps,
 * since, and witness each request needs.
 *
 * @remarks The distinct deposit headers are moved to the front of the header deps and
 * the withdrawal headers appended, so a deposit header's index is its rank among the
 * collected withdrawals. Completion (`completeTransaction`) adds the dep group.
 */
export function withdraw(
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
  }
  // Only this step names a header by index, and the deployed script reads that index as
  // one byte, so the deposit headers go first, ahead of whatever the requests and receipts
  // pushed: the limit then counts these alone. Safe because nothing else in the stack reads
  // a header by position and every built transaction passes here once.
  const depositHashes = [
    ...new Set(withdrawalGroups.map(({ owned }) => owned.headers[0].hash)),
  ];
  tx.headerDeps = [
    ...depositHashes,
    ...tx.headerDeps.filter((hash) => !depositHashes.includes(hash)),
  ];
  for (const { owned } of withdrawalGroups) {
    pushHeaderDep(tx, owned.headers[1].hash);
  }
  for (const { owned } of withdrawalGroups) {
    // The deployed dao.c reads one byte of the u64 index field (RFC 0023 erratum,
    // nervosnetwork/rfcs pull 456). The account projection caps a batch at
    // `DAO_HEADER_INDEX_LIMIT` ready withdrawals, whose deposit headers lead, so every index
    // fits; a wrong one only the node can refuse.
    const headerIndex = tx.headerDeps.indexOf(owned.headers[0].hash);
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
  return tx;
}

/**
 * The owner markers among `cells` paired with their owned withdrawal requests, which live
 * in the marker's own transaction at the encoded distance, so the marker's block is the
 * request's. Markers whose target is not an owned withdrawal request are skipped. Each
 * header is read once per batch.
 */
export async function withdrawalGroupsFrom(
  client: ccc.Client,
  cells: readonly ScannedCell[],
  tip: ccc.ClientBlockHeader,
): Promise<WithdrawalGroup[]> {
  const owners = cells
    .filter(({ cell }) => isOwner(cell))
    .map(({ cell, blockNumber }) => ({ owner: new OwnerCell(cell), blockNumber }));
  const ownedCells = await Promise.all(
    owners.map(async ({ owner }) => client.getCell(owner.getOwned())),
  );
  const pairs = owners.flatMap(({ owner, blockNumber }, index) => {
    const owned = ownedCells[index];
    return owned !== undefined && isOwned(owned)
      ? [{ owner, owned, blockNumber, depositBlockNumber: depositBlockNumberOf(owned) }]
      : [];
  });
  const headers = await headersByNumber(
    client,
    pairs.flatMap((pair) => [pair.depositBlockNumber, pair.blockNumber]),
  );
  return pairs.map(
    ({ owner, owned, blockNumber, depositBlockNumber }) =>
      new WithdrawalGroup(
        withdrawalRequestCell(
          owned,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- both headers were read above.
          headers.get(depositBlockNumber)!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- both headers were read above.
          headers.get(blockNumber)!,
          tip,
        ),
        owner,
      ),
  );
}

/** Values a DAO withdrawal request at its two headers and judges it claimable at the tip. */
export function withdrawalRequestCell(
  cell: ccc.Cell,
  depositHeader: ccc.ClientBlockHeader,
  requestHeader: ccc.ClientBlockHeader,
  tip: ccc.ClientBlockHeader,
): DaoWithdrawalRequestCell {
  const interests = ccc.calcDaoProfit(cell.capacityFree, depositHeader, requestHeader);
  const maturity = ccc.calcDaoClaimEpoch(depositHeader, requestHeader);
  return {
    cell,
    headers: [depositHeader, requestHeader],
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
