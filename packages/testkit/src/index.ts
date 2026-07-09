/**
 * Shared test fixtures for iCKB Stack packages.
 *
 * @packageDocumentation
 */

import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "./bytes.ts";

export { byte32FromByte } from "./bytes.ts";

type ClientMethod<K extends keyof ccc.Client> = Extract<
  ccc.Client[K],
  (...args: never[]) => unknown
>;

interface StubClientHandlers {
  addressPrefix?: string;
  cache?: ccc.Client["cache"];
  findCells?: ClientMethod<"findCells">;
  findCellsOnChain?: ClientMethod<"findCellsOnChain">;
  getCell?: ClientMethod<"getCell">;
  getHeaderByNumber?: ClientMethod<"getHeaderByNumber">;
  getTipHeader?: ClientMethod<"getTipHeader">;
  getTransaction?: ClientMethod<"getTransaction">;
  getTransactionWithHeader?: ClientMethod<"getTransactionWithHeader">;
  sendTransactionDry?: ClientMethod<"sendTransactionDry">;
}

export type CommittedTransactionResponseOverrides = Partial<
  Omit<ccc.ClientTransactionResponseLike, "transaction" | "status">
>;

export interface TransactionWithHeader {
  transaction: ccc.ClientTransactionResponse;
  header: ccc.ClientBlockHeader;
}

/**
 * CCC client test double with per-method handler overrides.
 *
 * @remarks
 * Unspecified methods fall back to `ClientPublicTestnet`, whose URL is an
 * invalid host. Tests should override every method expected to cross the RPC
 * boundary.
 */
export class StubClient extends ccc.ClientPublicTestnet {
  private readonly handlers: StubClientHandlers;
  private readonly findCellsHandler: ClientMethod<"findCells">;
  private readonly findCellsOnChainHandler: ClientMethod<"findCellsOnChain">;
  private readonly getCellHandler: ClientMethod<"getCell">;
  private readonly getHeaderByNumberHandler: ClientMethod<"getHeaderByNumber">;
  private readonly getTransactionHandler: ClientMethod<"getTransaction">;
  private readonly getTransactionWithHeaderHandler: ClientMethod<"getTransactionWithHeader">;
  declare public getTipHeader: ClientMethod<"getTipHeader">;
  declare public sendTransactionDry: ClientMethod<"sendTransactionDry">;

  /**
   * Creates a stub client using the supplied method overrides.
   */
  constructor(handlers: StubClientHandlers = {}) {
    super({ url: "https://example.invalid" });
    this.handlers = handlers;
    if (handlers.cache !== undefined) {
      this.cache = handlers.cache;
    }
    this.findCellsHandler = handlers.findCells ?? super.findCells.bind(this);
    this.findCellsOnChainHandler =
      handlers.findCellsOnChain ?? super.findCellsOnChain.bind(this);
    this.getCellHandler = handlers.getCell ?? super.getCell.bind(this);
    this.getHeaderByNumberHandler =
      handlers.getHeaderByNumber ?? super.getHeaderByNumber.bind(this);
    this.getTransactionHandler =
      handlers.getTransaction ?? super.getTransaction.bind(this);
    this.getTransactionWithHeaderHandler =
      handlers.getTransactionWithHeader ?? super.getTransactionWithHeader.bind(this);
    if (handlers.getTipHeader !== undefined) {
      this.getTipHeader = handlers.getTipHeader;
    }
    if (handlers.sendTransactionDry !== undefined) {
      this.sendTransactionDry = handlers.sendTransactionDry;
    }
  }

  /** Address prefix override used by address formatting tests. */
  public override get addressPrefix(): string {
    return this.handlers.addressPrefix ?? super.addressPrefix;
  }

  /** Delegates cell scans to the configured handler or the base client. */
  public override findCells(
    ...args: Parameters<ClientMethod<"findCells">>
  ): ReturnType<ClientMethod<"findCells">> {
    return this.findCellsHandler(...args);
  }

  /** Delegates on-chain cell scans to the configured handler or the base client. */
  public override findCellsOnChain(
    ...args: Parameters<ClientMethod<"findCellsOnChain">>
  ): ReturnType<ClientMethod<"findCellsOnChain">> {
    return this.findCellsOnChainHandler(...args);
  }

  /** Delegates single-cell lookup to the configured handler or the base client. */
  public override async getCell(
    ...args: Parameters<ClientMethod<"getCell">>
  ): ReturnType<ClientMethod<"getCell">> {
    return this.getCellHandler(...args);
  }

  /** Delegates block-header lookup to the configured handler or the base client. */
  public override async getHeaderByNumber(
    ...args: Parameters<ClientMethod<"getHeaderByNumber">>
  ): ReturnType<ClientMethod<"getHeaderByNumber">> {
    return this.getHeaderByNumberHandler(...args);
  }

  /** Delegates transaction lookup to the configured handler or the base client. */
  public override async getTransaction(
    ...args: Parameters<ClientMethod<"getTransaction">>
  ): ReturnType<ClientMethod<"getTransaction">> {
    return this.getTransactionHandler(...args);
  }

  /** Delegates transaction-with-header lookup to the configured handler or the base client. */
  public override async getTransactionWithHeader(
    ...args: Parameters<ClientMethod<"getTransactionWithHeader">>
  ): ReturnType<ClientMethod<"getTransactionWithHeader">> {
    return this.getTransactionWithHeaderHandler(...args);
  }
}

/**
 * Creates a type-hash script whose code hash is a repeated byte.
 *
 * @param codeHashByte - Two hex characters repeated to form the 32-byte code hash.
 * @param args - Script args hex string.
 */
export function script(codeHashByte: string, args = "0x"): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args,
  });
}

/**
 * Creates an out point whose transaction hash is a repeated byte.
 *
 * @param txHashByte - Two hex characters repeated to form the 32-byte tx hash.
 * @param index - Output index for the out point.
 */
export function outPoint(txHashByte: string, index = 0n): ccc.OutPoint {
  return ccc.OutPoint.from({
    txHash: byte32FromByte(txHashByte),
    index,
  });
}

/**
 * Creates a live-cell-shaped capacity cell fixture with empty data.
 *
 * @param capacity - Cell capacity in shannons.
 * @param lock - Lock script assigned to the cell output.
 * @param txHashByte - Two hex characters repeated to form the out point tx hash.
 */
export function capacityCell(
  capacity: bigint,
  lock: ccc.Script,
  txHashByte: string,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}

/**
 * Async form of {@link passthroughTransaction} for client handler tests.
 */
export async function asyncPassthroughTransaction(
  txLike: ccc.TransactionLike,
): Promise<ccc.Transaction> {
  await Promise.resolve();
  return passthroughTransaction(txLike);
}

/**
 * Normalizes a transaction-like value into a CCC transaction.
 */
export function passthroughTransaction(txLike: ccc.TransactionLike): ccc.Transaction {
  return ccc.Transaction.from(txLike);
}

/**
 * Creates a committed transaction response fixture.
 */
export function committedTransactionResponse(
  transaction: ccc.TransactionLike,
  overrides: CommittedTransactionResponseOverrides = {},
): ccc.ClientTransactionResponse {
  return ccc.ClientTransactionResponse.from({
    transaction,
    status: "committed",
    ...overrides,
  });
}

/**
 * Creates a transaction-with-header response using a default committed transaction.
 */
export function transactionWithHeader(
  header: ccc.ClientBlockHeader,
): TransactionWithHeader {
  return {
    transaction: committedTransactionResponse(ccc.Transaction.default()),
    header,
  };
}

/**
 * Creates a block-header fixture with deterministic defaults.
 *
 * @param overrides - Header fields to replace after defaults are applied.
 */
export function headerLike(
  overrides: Partial<ccc.ClientBlockHeaderLike> = {},
): ccc.ClientBlockHeader {
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
    epoch: [181n, 0n, 1n],
    extraHash: byte32FromByte("aa"),
    hash: byte32FromByte("bb"),
    nonce: 0n,
    number: 3n,
    parentHash: byte32FromByte("cc"),
    proposalsHash: byte32FromByte("dd"),
    timestamp: 0n,
    transactionsRoot: byte32FromByte("ee"),
    version: 0n,
    ...overrides,
  });
}
