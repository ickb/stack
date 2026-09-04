import assert from "node:assert/strict";
import test from "node:test";
import { runPreflight } from "../../../live/preflight/run.ts";
import {
  bigintReplacer,
  type ConfigDirContext,
  mockDependencies,
  type ProjectCall,
  type PublicClientCall,
  randomPrivateKey,
  withConfigDir,
} from "./support.ts";

void test("preflight run reports public evidence for a generated unfunded key", async () => {
  const privateKey = randomPrivateKey();
  const rawRpcUrl = "https://testnet.example/path?token=secret";
  const userOrders = [{ order: { isMatchable: (): boolean => true } }];
  const projectCalls: ProjectCall[] = [];
  await withConfigDir(
    {
      chain: "testnet",
      privateKey,
      rpcUrl: rawRpcUrl,
    },
    async ({ configPath, dir }: ConfigDirContext) => {
      const report = await runPreflight({
        configPath,
        root: dir,
        dependencies: {
          ...mockDependencies({ userOrders, projectCalls }),
          checkIgnored: () => true,
        },
      });
      const json = JSON.stringify(report, bigintReplacer);

      assert.equal(report.chain, "testnet");
      assert.deepEqual(report.rpcEndpoint, {
        mode: "exclusive",
        protocol: "https:",
        hostname: "testnet.example",
        port: "",
        pathname: "/path",
      });
      assert.equal(report.chainIdentity.matches.genesisHash, true);
      assert.equal(report.key.recommendedAddress, "ckt1generatedoffline");
      assert.deepEqual(report.key.primaryLock, {
        codeHash: `0x${"11".repeat(32)}`,
        hashType: "type",
        args: `0x${"22".repeat(20)}`,
      });
      assert.equal(report.balances.CKB.total, "0");
      assert.equal(report.balances.ICKB.available, "0");
      assert.equal(report.balances.ICKB.unavailable, "0");
      assert.equal(report.balances.ICKB.total, "0");
      assert.equal(report.balances.CKB.reserve, "100000000000");
      assert.equal(report.balances.CKB.spendable, "0");
      assert.equal(report.capital.depositCapacity, "10000000000000");
      assert.equal(report.capital.minimumCkbCapital, "10500000000000");
      assert.equal(report.capital.totalEquivalentCkb, "0");
      assert.equal(report.inventory.userOrderCount, 1);
      assert.equal(report.inventory.matchableUserOrderCount, 1);
      assert.equal(report.inventory.userOrderScan, "complete-global-scan");
      assert.equal(projectCalls.length, 1);
      const projectCall = projectCalls[0];
      assert(projectCall !== undefined);
      assert.equal(projectCall.userOrders, userOrders);
      assert.deepEqual(projectCall.projectionOptions, {
        collectedOrdersAvailable: true,
      });
      assert.equal(json.includes(privateKey), false);
      assert.doesNotMatch(json, /secret/u);
    },
  );
});

void test("preflight reports CKB reserve and spendable balance separately", async () => {
  const projection = {
    ckbAvailable: 190000000000n,
    ckbPending: 25000000000n,
    ickbAvailable: 20000000000n,
    ickbPending: 30000000000n,
    ckbBalance: 215000000000n,
    ickbBalance: 50000000000n,
    readyWithdrawals: [],
    pendingWithdrawals: [],
  };
  await withConfigDir(baseConfig(), async ({ configPath, dir }: ConfigDirContext) => {
    const dependencies = mockDependencies({ plainCkbBalance: 150000000000n, projection });
    const report = await runPreflight({
      configPath,
      root: dir,
      dependencies: { ...dependencies, checkIgnored: () => true },
    });

    assert.deepEqual(report.balances.CKB, {
      available: "150000000000",
      plainAvailable: "150000000000",
      projectedAvailable: "190000000000",
      reserve: "100000000000",
      spendable: "50000000000",
      unavailable: "25000000000",
      total: "215000000000",
    });
    assert.deepEqual(report.balances.ICKB, {
      available: "20000000000",
      unavailable: "30000000000",
      total: "50000000000",
    });
    assert.equal(report.capital.totalEquivalentCkb, "265000000000");
  });
});

void test("preflight reports shared reserve and spendable balance separately", async () => {
  const projection = {
    ckbAvailable: 280000000000n,
    ckbPending: 25000000000n,
    ickbAvailable: 20000000000n,
    ickbPending: 30000000000n,
    ckbBalance: 305000000000n,
    ickbBalance: 50000000000n,
    readyWithdrawals: [],
    pendingWithdrawals: [],
  };
  await withConfigDir(baseConfig(), async ({ configPath, dir }: ConfigDirContext) => {
    const dependencies = mockDependencies({ plainCkbBalance: 250000000000n, projection });
    const report = await runPreflight({
      configPath,
      root: dir,
      dependencies: { ...dependencies, checkIgnored: () => true },
    });

    assert.deepEqual(report.balances.CKB, {
      available: "250000000000",
      plainAvailable: "250000000000",
      projectedAvailable: "280000000000",
      reserve: "100000000000",
      spendable: "150000000000",
      unavailable: "25000000000",
      total: "305000000000",
    });
    assert.deepEqual(report.balances.ICKB, {
      available: "20000000000",
      unavailable: "30000000000",
      total: "50000000000",
    });
  });
});

void test("preflight run uses the required explicit RPC URL", async () => {
  const calls: PublicClientCall[] = [];
  await withConfigDir(baseConfig(), async ({ configPath, dir }: ConfigDirContext) => {
    const dependencies = mockDependencies({ createPublicClientCalls: calls });
    const report = await runPreflight({
      configPath,
      root: dir,
      dependencies: { ...dependencies, checkIgnored: () => true },
    });

    assert.deepEqual(report.rpcEndpoint, {
      mode: "exclusive",
      protocol: "https:",
      hostname: "testnet.example",
      port: "",
      pathname: "/",
    });
    assert.deepEqual(calls, [{ chain: "testnet", rpcUrl: "https://testnet.example/" }]);
  });
});

function baseConfig(): {
  chain: string;
  privateKey: string;
  rpcUrl: string;
} {
  return {
    chain: "testnet",
    privateKey: randomPrivateKey(),
    rpcUrl: "https://testnet.example/",
  };
}
