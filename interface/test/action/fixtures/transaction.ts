import { ccc } from "@ckb-ccc/ccc";
import {
  type ConversionTransactionContext,
  type ConversionTransactionFailureReason,
  type ConversionTransactionResult,
  IckbSdk,
  Ratio,
} from "@ickb/sdk";

import { byte32FromByte, headerLike, offlineTestnetClient } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { buildTransactionPreview } from "../../../src/action/transaction.ts";
import type { WalletConfig } from "../../../src/shared/utils.ts";

type BuildConversionTransactionMock = ReturnType<
  typeof vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>
>;
type SuccessfulPlan = Extract<ConversionTransactionResult, { ok: true }>;
type FailedPlan = Extract<ConversionTransactionResult, { ok: false }>;

export function walletConfigWith(
  overrides: WalletConfigTestOverrides,
): Parameters<typeof buildTransactionPreview>[4] {
  const base = walletConfig();
  return walletConfig({
    sdk: testSdk({
      buildConversionTransaction:
        overrides.sdk?.buildConversionTransaction ??
        base.sdk.buildConversionTransaction.bind(base.sdk),
    }),
  });
}

function walletConfig(
  overrides: Partial<Parameters<typeof buildTransactionPreview>[4]> = {},
): Parameters<typeof buildTransactionPreview>[4] {
  const cccClient = testClient();
  return {
    chain: "testnet",
    cccClient,
    resetClient: vi.fn<() => void>(),
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    accountLocks: [script("11")],
    primaryLock: script("11"),
    sdk: testSdk(),
    ...overrides,
  };
}

export function buildConversionTransactionMock(
  result?: ConversionTransactionResult,
): BuildConversionTransactionMock {
  return vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>().mockResolvedValue(
    result ?? {
      ok: true,
      tx: txWithInput("aa"),
      estimatedMaturity: 0n,
      conversion: { kind: "order" },
    },
  );
}

export function successfulPlan(overrides: Partial<SuccessfulPlan> = {}): SuccessfulPlan {
  return {
    ok: true,
    tx: txWithInput("aa"),
    estimatedMaturity: 0n,
    conversion: { kind: "order" },
    ...overrides,
  };
}

export function failedPlan(
  reason: ConversionTransactionFailureReason,
  estimatedMaturity = 0n,
): FailedPlan {
  return { ok: false, reason, estimatedMaturity };
}

export function txWithInput(txHashByte: string): ccc.Transaction {
  const tx = ccc.Transaction.default();
  tx.inputs.push(
    ccc.CellInput.from({
      previousOutput: {
        txHash: byte32FromByte(txHashByte),
        index: 0n,
      },
    }),
  );
  return tx;
}

export function context(
  overrides: Partial<ConversionTransactionContext> = {},
): ConversionTransactionContext {
  return {
    system: {
      feeRate: 1n,
      tip: headerLike({ timestamp: 0n }),
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      poolDeposits: [],
    },
    cells: [],
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function testClient(): ccc.Client {
  return offlineTestnetClient();
}

function testSigner(client: ccc.Client): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

function testSdk(
  options: {
    buildConversionTransaction?: WalletConfig["sdk"]["buildConversionTransaction"];
  } = {},
): WalletConfig["sdk"] {
  const sdk = IckbSdk.fromChain("testnet");
  vi.spyOn(sdk, "buildConversionTransaction").mockImplementation(
    options.buildConversionTransaction ??
      vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>().mockResolvedValue({
        ok: true,
        tx: ccc.Transaction.default(),
        estimatedMaturity: 0n,
        conversion: { kind: "order" },
      }),
  );
  return sdk;
}

interface WalletConfigTestOverrides {
  sdk?: {
    buildConversionTransaction?: WalletConfig["sdk"]["buildConversionTransaction"];
  };
}
