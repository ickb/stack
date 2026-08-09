import { ccc } from "@ckb-ccc/ccc";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { byte32FromByte } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import type { getL1State } from "../../../src/query/queries.ts";
import type { WalletConfig } from "../../../src/shared/utils.ts";

export function walletConfigForState(
  lock: ccc.Script,
  state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>,
): Parameters<typeof getL1State>[0] {
  const cccClient = testClient();
  return {
    chain: "testnet",
    cccClient,
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    accountLocks: [lock],
    primaryLock: lock,
    sdk: stateSdk(state),
  };
}

export function stateSdk(
  state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>,
): Parameters<typeof getL1State>[0]["sdk"] {
  return new StateSdk(state);
}

export function testSigner(
  client: ccc.Client = new ccc.ClientPublicTestnet({ url: "https://example.invalid" }),
): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

export function testClient(): ccc.Client {
  return new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
}

export function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

export function cell(capacity: bigint, lock: ccc.Script, outputData = "0x"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData,
  });
}

class StateSdk extends IckbSdk {
  private readonly state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>;

  constructor(state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>) {
    const config = getConfig("testnet");
    super(
      config.managers.ickbUdt,
      config.managers.ownedOwner,
      config.managers.logic,
      config.managers.order,
      config.bots,
    );
    this.state = state;
  }

  public override async getL1AccountState(): ReturnType<
    WalletConfig["sdk"]["getL1AccountState"]
  > {
    await Promise.resolve();
    return this.state;
  }

  public override async buildConversionTransaction(): ReturnType<
    WalletConfig["sdk"]["buildConversionTransaction"]
  > {
    await Promise.resolve();
    return {
      ok: false,
      reason: "nothing-to-do",
      estimatedMaturity: this.state.system.tip.timestamp,
    };
  }

  public override async completeTransaction(
    txLike: ccc.TransactionLike,
  ): ReturnType<WalletConfig["sdk"]["completeTransaction"]> {
    await Promise.resolve();
    return ccc.Transaction.from(txLike);
  }
}
