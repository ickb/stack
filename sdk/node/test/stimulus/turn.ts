import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, committedTransactionResponse } from "@ickb/testkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IckbError } from "../../../src/conversion/sdk_error.ts";
import { DEFAULT_ORDER_FEE_BASE } from "../../../src/conversion/sdk_estimate.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "../../../src/send/sign_and_send_transaction.ts";
import {
  TransactionWaitError,
  waitTransaction,
} from "../../../src/send/wait_transaction.ts";
import { expectedChainIdentity } from "../../../src/utils/index.ts";
import type { Override } from "../../src/stimulus/draw.ts";
import { MAX_LIVE_ORDERS, type Runtime } from "../../src/stimulus/state.ts";
import {
  runStimulusTurn,
  type StimulusIdentity,
  type StimulusLog,
} from "../../src/stimulus/turn.ts";
import {
  accountState,
  CKB,
  order,
  plainCell,
  PRIMARY_LOCK,
  receipt,
  runtime,
} from "./support/fixtures.ts";

vi.mock(
  import("../../../src/send/sign_and_send_transaction.ts"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    signAndSendTransaction: vi.fn(),
  }),
);
vi.mock(import("../../../src/send/wait_transaction.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  waitTransaction: vi.fn(),
}));

const sendMock = vi.mocked(signAndSendTransaction);
const waitMock = vi.mocked(waitTransaction);
const TX_HASH = byte32FromByte("46");
const identity: StimulusIdentity = {
  chain: "testnet",
  address: "ckt1stimulus",
  primaryLock: { codeHash: PRIMARY_LOCK.codeHash, hashType: "type", args: "0x" },
  rpcEndpoint: {
    mode: "exclusive",
    protocol: "https:",
    hostname: "testnet.example",
    port: "",
    pathname: "/",
  },
  preflight: {
    expected: expectedChainIdentity("testnet"),
    observed: {
      genesisHash: expectedChainIdentity("testnet").genesisHash,
      addressPrefix: "ckt",
      tip: { hash: byte32FromByte("02"), number: 1n, timestamp: 0n },
    },
    matches: { genesisHash: true, addressPrefix: true },
  },
};
const FUNDED_CKB = 6000n * CKB;
const fundedAccount = accountState({ capacityCells: [plainCell(FUNDED_CKB, "b1")] });
const orderDraw: Override = {
  kind: "order",
  direction: "ckb-to-ickb",
  amount: 5n * CKB,
  fee: 1n,
};
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk): boolean => {
    lines.push(String(chunk));
    return true;
  });
  sendMock.mockReset();
  sendMock.mockImplementation(async (_signer, _tx, recordTxHash) => {
    await Promise.resolve();
    recordTxHash?.(TX_HASH);
    return TX_HASH;
  });
  waitMock.mockReset();
  waitMock.mockResolvedValue(committedTransactionResponse(ccc.Transaction.default()));
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

/** A completion that spends the funded cell and returns `change` CKB to the account. */
function completing(change: bigint): Partial<Runtime["sdk"]> {
  return {
    completeTransaction: async (txLike): Promise<ccc.Transaction> => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike).clone();
      tx.addInput(plainCell(FUNDED_CKB, "b1"));
      tx.addOutput({ capacity: change, lock: PRIMARY_LOCK });
      return tx;
    },
  };
}

async function turn(target: Runtime, override: Override = {}): Promise<StimulusLog> {
  await runStimulusTurn({ runtime: target, identity, override, random: () => 0.5 });
  expect(lines).toHaveLength(1);
  const parsed: unknown = JSON.parse(lines[0] ?? "");
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Expected one log object");
  }
  return parsed;
}

describe("runStimulusTurn", () => {
  it("stops minting at the live-order cap and still collects", async () => {
    const fresh = await order("a2", true);
    const live = Array.from({ length: MAX_LIVE_ORDERS }, () => fresh);
    const request = vi.fn<Runtime["sdk"]["request"]>();
    const buildConversionTransaction = vi.fn<
      Runtime["sdk"]["buildConversionTransaction"]
    >(async (_txLike, options) => {
      await Promise.resolve();
      expect(options).toMatchObject({ amount: 0n, context: { receipts: [{}] } });
      return {
        ok: true,
        tx: ccc.Transaction.default(),
        estimatedMaturity: 0n,
        conversion: { kind: "collect-only" },
      };
    });
    const log = await turn(
      runtime({
        account: accountState({
          capacityCells: [plainCell(FUNDED_CKB, "b1")],
          receipts: [receipt("c1", 100n * CKB, 50n * CKB)],
        }),
        orders: live,
        originBlocks: new Map([[fresh.origin.cell.outPoint.txHash, 1_000_000n]]),
        sdk: { request, buildConversionTransaction },
      }),
      orderDraw,
    );

    expect(request).not.toHaveBeenCalled();
    expect(log).toMatchObject({
      outcome: "committed",
      orders: { live: MAX_LIVE_ORDERS, fulfilled: 0, refused: 0, stale: 0 },
      skip: { reason: "live-order-cap", live: MAX_LIVE_ORDERS },
      draw: { kind: "collect-only" },
      balance: { CKB: { budget: "5100" }, ICKB: { budget: "50" } },
    });
  });

  it("skips when nothing is spendable and nothing is collectable", async () => {
    const log = await turn(
      runtime({
        account: accountState({ capacityCells: [plainCell(6000n * CKB, "b1")] }),
      }),
      { direction: "ickb-to-ckb" },
    );

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "nothing-to-spend" },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("mints one order on the collection base and commits", async () => {
    const fulfilled = await order("a1", false);
    const request = vi.fn<Runtime["sdk"]["request"]>(
      async (txLike, _lock, info, amounts) => {
        await Promise.resolve();
        const tx = ccc.Transaction.from(txLike);
        expect(info.ckbToUdt.isPopulated()).toBe(true);
        expect(amounts).toEqual({ ckbValue: 5n * CKB, udtValue: 0n });
        tx.addOutput({ capacity: 200n * CKB, lock: PRIMARY_LOCK });
        tx.addOutput({ capacity: 74n * CKB, lock: PRIMARY_LOCK });
        return tx;
      },
    );
    const target = runtime({
      account: fundedAccount,
      orders: [fulfilled],
      sdk: { request, ...completing(5500n * CKB) },
    });

    const log = await turn(target, orderDraw);

    expect(log).toMatchObject({
      type: "stimulus.turn",
      timestamp: new Date(log.timestamp ?? "").toISOString(),
      outcome: "committed",
      orders: { live: 0, fulfilled: 1, refused: 0, stale: 0 },
      draw: { kind: "order", direction: "ckb-to-ickb", amount: "500000000", fee: "1" },
      action: { order: { outputs: [0, 1] } },
      transactionShape: { inputs: 3, outputs: 3 },
      txHash: TX_HASH,
    });
    expect(log).not.toHaveProperty("skip");
    // The base carries the fulfilled order's two melt inputs before the mint.
    expect(request.mock.calls[0]?.[0]).toMatchObject({ inputs: [{}, {}] });
    expect(waitMock).toHaveBeenCalledWith(target.client, TX_HASH, { timeout: 600_000 });
    expect(process.exitCode).toBeUndefined();
  });

  it("mints an iCKB-to-CKB order through the real mint when the amount is pinned", async () => {
    const log = await turn(
      runtime({ account: fundedAccount, sdk: completing(5500n * CKB) }),
      {
        ...orderDraw,
        direction: "ickb-to-ckb",
        fee: 0n,
      },
    );

    expect(log).toMatchObject({
      outcome: "committed",
      draw: { kind: "order", direction: "ickb-to-ckb", fee: "0" },
      action: { order: { outputs: [0, 1] } },
      transactionShape: { inputs: 1, outputs: 3 },
    });
  });

  it("falls back to collecting when the drawn action is refused", async () => {
    const stale = await order("a3", true);
    const buildConversionTransaction = vi.fn<
      Runtime["sdk"]["buildConversionTransaction"]
    >(async (_txLike, options) => {
      await Promise.resolve();
      expect(options).toMatchObject({
        amount: 0n,
        context: { availableOrders: [stale] },
      });
      const tx = ccc.Transaction.default();
      tx.addInput(stale.order.cell);
      tx.addOutput({ capacity: 2050n * CKB, lock: PRIMARY_LOCK });
      return {
        ok: true,
        tx,
        estimatedMaturity: 0n,
        conversion: { kind: "collect-only" },
      };
    });
    const log = await turn(
      runtime({
        account: fundedAccount,
        orders: [stale],
        originBlocks: new Map([[stale.origin.cell.outPoint.txHash, 1n]]),
        sdk: { ...completing(500n * CKB), buildConversionTransaction },
      }),
      { ...orderDraw, amount: 0n },
    );

    expect(log).toMatchObject({
      outcome: "committed",
      draw: { kind: "collect-only" },
      skip: { reason: "unrepresentable-amount" },
      action: { conversion: { kind: "collect-only" } },
    });
  });

  it("collects the receipts alone when the drawn conversion is refused", async () => {
    // Adopted from the astra audit: the fallback fires on receipts, not only on orders.
    const target = runtime({
      account: accountState({ receipts: [receipt("c2", 300n * CKB, ICKB_DEPOSIT_CAP)] }),
    });
    const build = vi.spyOn(target.sdk, "buildConversionTransaction");
    vi.spyOn(target.sdk, "completeTransaction").mockRejectedValue(
      new IckbError("no cells", { code: "insufficient_capacity" }),
    );

    const log = await turn(target, {
      kind: "conversion",
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP + 1n,
    });

    expect(build.mock.calls.map(([, options]) => options.amount)).toEqual([
      ICKB_DEPOSIT_CAP + 1n,
      0n,
    ]);
    expect(log).toMatchObject({ outcome: "skipped", draw: { kind: "collect-only" } });
  });

  it("skips amounts the order format cannot represent", async () => {
    const log = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      amount: 0n,
    });

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "unrepresentable-amount" },
    });
  });

  it("skips what the completer cannot fund, from either builder", async () => {
    const insufficient = new IckbError("short", { code: "insufficient_capacity" });
    const orderLog = await turn(
      runtime({
        account: fundedAccount,
        sdk: {
          completeTransaction: async () => {
            await Promise.resolve();
            throw insufficient;
          },
        },
      }),
      orderDraw,
    );
    lines = [];
    const conversionLog = await turn(
      runtime({
        account: fundedAccount,
        sdk: {
          buildConversionTransaction: async () => {
            await Promise.resolve();
            throw new ccc.ErrorTransactionInsufficientCapacity(1n);
          },
        },
      }),
      { ...orderDraw, kind: "conversion" },
    );

    expect(orderLog).toMatchObject({
      outcome: "skipped",
      skip: {
        reason: "unfundable",
        error: { name: "IckbError", code: "insufficient_capacity" },
      },
    });
    expect(conversionLog).toMatchObject({
      outcome: "skipped",
      skip: {
        reason: "unfundable",
        error: { amount: "1", isForChange: false },
      },
    });
  });

  it("logs the SDK's planning refusal as a skip", async () => {
    const log = await turn(
      runtime({
        account: fundedAccount,
        sdk: {
          buildConversionTransaction: async (_txLike, options) => {
            await Promise.resolve();
            return {
              ok: false,
              reason: "amount-too-small",
              estimatedMaturity: options.context.estimatedMaturity,
            };
          },
        },
      }),
      { ...orderDraw, kind: "conversion" },
    );

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "conversion-not-buildable", conversion: "amount-too-small" },
    });
  });

  it("fails with exit 1 on any other error", async () => {
    const invalidFee = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      fee: DEFAULT_ORDER_FEE_BASE,
    });
    lines = [];
    const log = await turn(
      runtime({
        account: fundedAccount,
        sdk: {
          completeTransaction: async () => {
            await Promise.resolve();
            throw new TypeError("fetch failed");
          },
        },
      }),
      orderDraw,
    );

    expect(invalidFee).toMatchObject({
      outcome: "failed",
      error: { message: "Fee too big relative to feeBase" },
    });
    expect(log).toMatchObject({ outcome: "failed", error: { message: "fetch failed" } });
    expect(process.exitCode).toBe(1);
  });

  it("waits on the known hash after an ambiguous broadcast and reports the terminal status", async () => {
    sendMock.mockRejectedValue(new TransactionBroadcastError(TX_HASH, {}));
    waitMock.mockRejectedValue(new TransactionWaitError(TX_HASH, { status: "rejected" }));
    const rejected = await turn(
      runtime({ account: fundedAccount, sdk: completing(5500n * CKB) }),
      orderDraw,
    );
    lines = [];
    process.exitCode = undefined;
    sendMock.mockRejectedValue(new TypeError("signer offline"));
    const offline = await turn(
      runtime({ account: fundedAccount, sdk: completing(5500n * CKB) }),
      orderDraw,
    );
    lines = [];
    process.exitCode = undefined;
    sendMock.mockResolvedValue(TX_HASH);
    waitMock.mockRejectedValue(new ccc.ErrorClientWaitTransactionTimeout(600_000));
    const unresolved = await turn(
      runtime({ account: fundedAccount, sdk: completing(5500n * CKB) }),
      orderDraw,
    );

    expect(rejected).toMatchObject({
      outcome: "rejected",
      error: { name: "TransactionWaitError" },
    });
    expect(rejected).not.toHaveProperty("txHash");
    expect(waitMock).toHaveBeenCalledWith(expect.anything(), TX_HASH, {
      timeout: 600_000,
    });
    expect(offline).toMatchObject({
      outcome: "failed",
      error: { message: "signer offline" },
    });
    expect(unresolved).toMatchObject({ outcome: "unresolved" });
    expect(process.exitCode).toBe(1);
  });
});
