/**
 * Shared test fixtures for iCKB Stack packages.
 *
 * @packageDocumentation
 */

import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";

export {
  AR_0,
  ckbMinMatchFromLog,
  depositToIckb,
  ICKB_SOFT_CAP,
  validateMatch,
  type OracleInfo,
  type OracleRatio,
  type OracleVerdict,
  type OrderState,
} from "./contract_oracle.ts";
export { FakeCkbSigner } from "./fake_signer.ts";

export type ClientMethod<K extends keyof ccc.Client> = Extract<
  ccc.Client[K],
  (...args: never[]) => unknown
>;

/** The client methods a test may script; every other call stays off the network. */
export interface StubClientHandlers {
  addressPrefix?: string;
  cache?: ccc.Client["cache"];
  /** The cells the node's raw `get_cells` serves for a search key, paged by the stub. */
  cells?: (key: cccA.JsonRpcIndexerSearchKey) => readonly StubCell[];
  getCell?: ClientMethod<"getCell">;
  getCellWithHeader?: ClientMethod<"getCellWithHeader">;
  getHeaderByNumber?: ClientMethod<"getHeaderByNumber">;
  getTipHeader?: ClientMethod<"getTipHeader">;
  getTransaction?: ClientMethod<"getTransaction">;
  /** The node's status for a transaction, as the raw status poll reads it; absent, unknown. */
  transactionStatus?: (
    txHash: ccc.Hex,
  ) => Promise<{ status: string; reason?: string } | undefined>;
  getTransactionWithHeader?: ClientMethod<"getTransactionWithHeader">;
  sendTransactionDry?: ClientMethod<"sendTransactionDry">;
}

/**
 * Creates a 32-byte hex string by repeating one byte.
 *
 * @param hexByte - Exactly two hex characters.
 */
export function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }

  return `0x${hexByte.repeat(32)}`;
}

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
/**
 * A block number past any tip: an order group dated by it is as fresh as an order gets,
 * for tests whose orders' age does not matter.
 */
export const FRESH_BLOCK = 2n ** 64n;

/** A transport that rejects every request: for clients a test never lets reach the network. */
export function offlineTransport(): ccc.JsonRpcTransport {
  return {
    request: async (payload): Promise<ccc.JsonRpcResponse> => {
      await Promise.resolve();
      throw new Error(`Offline test client received ${payload.method}`);
    },
  };
}

/**
 * Answers the SDK's raw reads from the stub's scripted handlers, so a test stubs one typed
 * method, not the wire: `get_cells` from `cells`, and the status-only `get_transaction`
 * from `transactionStatus`. Everything else is offline.
 */
function stubTransport(raw: {
  client?: StubClient;
  scripted?: StubClientHandlers;
}): ccc.JsonRpcTransport {
  return {
    request: async (payload): Promise<ccc.JsonRpcResponse> => {
      if (payload.method === "get_cells" && raw.scripted?.cells !== undefined) {
        return {
          id: payload.id,
          jsonrpc: "2.0",
          result: cellsPage(raw.scripted.cells, payload.params),
        };
      }
      const txHash = Array.isArray(payload.params) ? payload.params[0] : undefined;
      if (
        raw.client === undefined ||
        payload.method !== "get_transaction" ||
        typeof txHash !== "string"
      ) {
        return offlineTransport().request(payload);
      }
      const status = await rawStatus(raw, txHash);
      return {
        id: payload.id,
        jsonrpc: "2.0",
        result: { transaction: null, tx_status: status },
      };
    },
  };
}

async function rawStatus(
  raw: { client?: StubClient; scripted?: StubClientHandlers },
  txHash: string,
): Promise<object> {
  if (raw.client === undefined) {
    return { status: "unknown" };
  }
  if (raw.scripted?.transactionStatus !== undefined) {
    return (
      (await raw.scripted.transactionStatus(ccc.hexFrom(txHash))) ?? {
        status: "unknown",
      }
    );
  }
  return offlineTransport().request({
    id: 0,
    jsonrpc: "2.0",
    method: "get_transaction",
    params: [txHash],
  });
}

/** A testnet client on the offline transport. */
export function offlineTestnetClient(): ccc.ClientPublicTestnet {
  return ccc.ClientPublicTestnet.new({ transport: offlineTransport() });
}

export class StubClient extends ccc.ClientPublicTestnet {
  private readonly prefix: string | undefined;

  /**
   * Creates a stub client using the supplied method overrides. Each handler becomes the
   * instance's own method, ahead of the class's, so an unscripted method still runs CCC's
   * real code down to the offline transport.
   */
  constructor({ addressPrefix, cache, ...handlers }: StubClientHandlers = {}) {
    const raw: { client?: StubClient; scripted?: StubClientHandlers } = {};
    // A subclass has no factory, so the deprecated constructor is the only super call; the
    // offline transport keeps every unstubbed method off the network.
    // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated -- No non-deprecated constructor exists for a subclass.
    super({
      requestor: ccc.RequestorJsonRpc.new({
        transport: stubTransport(raw),
      }),
    });
    raw.client = this;
    raw.scripted = handlers;
    this.prefix = addressPrefix;
    if (cache !== undefined) {
      this.cache = cache;
    }
    Object.assign(this, handlers);
  }

  /** Address prefix override used by address formatting tests. */
  public override get addressPrefix(): string {
    return this.prefix ?? super.addressPrefix;
  }
}

/** A scanned cell, in block 0 unless the test names its block. */
export type StubCell = ccc.Cell | { cell: ccc.Cell; blockNumber: ccc.Num };

/**
 * One raw `get_cells` page over the scripted list, sliced the way the SDK's `findCells`
 * reads it: the cursor is the count served so far, so a short page ends the scan.
 */
function cellsPage(
  cells: NonNullable<StubClientHandlers["cells"]>,
  params: unknown,
): object {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- the SDK sends key, order, limit, cursor.
  const [key, , limit, after] = params as [
    cccA.JsonRpcIndexerSearchKey,
    string,
    ccc.Hex,
    ccc.Hex | null | undefined,
  ];
  const offset = after === null || after === undefined ? 0 : Number(after);
  const page = cells(key).slice(offset, offset + Number(limit));
  return {
    last_cursor: ccc.numToHex(offset + page.length),
    objects: page.map((scanned) => {
      const { cell, blockNumber } =
        scanned instanceof ccc.Cell ? { cell: scanned, blockNumber: 0n } : scanned;
      return {
        out_point: cccA.JsonRpcTransformers.outPointFrom(cell.outPoint),
        output: cccA.JsonRpcTransformers.cellOutputFrom(cell.cellOutput),
        output_data: cell.outputData,
        block_number: ccc.numToHex(blockNumber),
      };
    }),
  };
}

// @ts-expect-error TS2655: the abstract members are forwarded by the Proxy at runtime, as in the connector.
class ComposedClient extends ccc.Proxy.Base(ccc.Client) {}

/**
 * The client the connector hands the interface: a composition proxy over the public
 * client (`ClientWithFeeRate`), an instance of `ccc.Client` but not of `ccc.ClientJsonRpc`
 * that still forwards the requestor the SDK's raw reads need. Tests check that through this.
 */
export function composedClient(inner: ccc.Client): ccc.Client {
  return new ComposedClient(inner);
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
 * Creates a committed transaction response fixture.
 */
export function committedTransactionResponse(
  transaction: ccc.TransactionLike,
  overrides: Partial<
    Omit<ccc.ClientTransactionResponseLike, "transaction" | "status">
  > = {},
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
