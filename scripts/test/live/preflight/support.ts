import { randomBytes } from "node:crypto";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publicRpcEndpointIdentity } from "../../../../packages/node-utils/src/index.ts";
import type {
  AccountState,
  CccLike,
  ChainIdentity,
  CoreLike,
  L1AccountState,
  Projection,
  RuntimeConfigLike,
  ScriptLike,
  SdkLike,
} from "../../../live/preflight/report.ts";
import type { NodeUtilsRuntimeLike } from "../../../live/preflight/run.ts";

export interface ConfigDirContext {
  configPath: string;
  dir: string;
}

export interface ProjectCall {
  account: AccountState;
  projectionOptions: { collectedOrdersAvailable: boolean };
  userOrders: readonly unknown[];
}

export interface PublicClientCall {
  chain: string;
  rpcUrl: string;
}

interface RuntimeConfigJson {
  chain: string;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  privateKey: string;
  rpcUrl: string;
  sleepIntervalSeconds: number;
}

interface MockOptions {
  createPublicClientCalls?: PublicClientCall[];
  plainCkbBalance?: bigint;
  projectCalls?: ProjectCall[];
  projection?: Projection;
  userOrders?: ReadonlyArray<{ order: { isMatchable: () => boolean } }>;
}

interface MockPublicClient {
  addressPrefix: string;
  getFeeRate: () => Promise<bigint>;
  getTipHeader: () => Promise<{ hash: string; number: bigint; timestamp: bigint }>;
  url: string;
}

type JsonReplacerInput = JsonReplacerValue | bigint;

type JsonReplacerValue =
  Record<string, unknown> | boolean | null | number | string | unknown[] | undefined;

export interface MockDependencies {
  ccc: CccLike;
  core: CoreLike;
  nodeUtils: NodeUtilsRuntimeLike;
  sdk: SdkLike;
}

export async function withConfigDir<T>(
  config: unknown,
  callback: (context: ConfigDirContext) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = path.join(dir, "config.json");
    await writeText(configPath, JSON.stringify(config));
    return await callback({ configPath, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function randomPrivateKey(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

export function mockDependencies(options: MockOptions = {}): MockDependencies {
  const expectedGenesis =
    "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
  const primaryLock = {
    codeHash: `0x${"11".repeat(32)}`,
    hashType: "type",
    args: `0x${"22".repeat(20)}`,
  };
  return {
    nodeUtils: mockNodeUtils(options, expectedGenesis),
    ccc: mockCcc(primaryLock),
    sdk: mockSdk(options),
    core: mockCore(),
  };
}

export function bigintReplacer(
  _key: string,
  value: JsonReplacerInput,
): JsonReplacerValue {
  return typeof value === "bigint" ? value.toString() : value;
}

function mockNodeUtils(
  options: MockOptions,
  expectedGenesis: string,
): NodeUtilsRuntimeLike {
  return {
    readRuntimeConfigEnv: async (configPath: string): Promise<RuntimeConfigLike> => {
      const parsed = parseRuntimeConfigJson(await readText(configPath));
      return {
        ...parsed,
        rpcUrl: parsed.rpcUrl,
        sleepIntervalMs: parsed.sleepIntervalSeconds * 1000,
        maxRetryableAttempts: parsed.maxRetryableAttempts,
      };
    },
    createPublicClient: (chain: string, rpcUrl: string): MockPublicClient => {
      options.createPublicClientCalls?.push({ chain, rpcUrl });
      return {
        url: "mock",
        addressPrefix: "ckt",
        getTipHeader: async (): Promise<{
          hash: string;
          number: bigint;
          timestamp: bigint;
        }> => {
          await Promise.resolve();
          return {
            hash: `0x${"44".repeat(32)}`,
            number: 3n,
            timestamp: 4n,
          };
        },
        getFeeRate: async (): Promise<bigint> => {
          await Promise.resolve();
          return 1000n;
        },
      };
    },
    verifyChainPreflight: async (): Promise<ChainIdentity> => {
      await Promise.resolve();
      return {
        chain: "testnet",
        expected: { genesisHash: expectedGenesis, addressPrefix: "ckt" },
        observed: {
          genesisHash: expectedGenesis,
          addressPrefix: "ckt",
          tip: { hash: `0x${"33".repeat(32)}`, number: 1n, timestamp: 2n },
        },
        matches: { genesisHash: true, addressPrefix: true },
      };
    },
    isRetryableRpcTransportError: () => false,
    publicRpcEndpointIdentity,
    signerAccountLocks: async (
      _signer: unknown,
      primaryLock: ScriptLike,
    ): Promise<ScriptLike[]> => {
      await Promise.resolve();
      return [primaryLock];
    },
    accountPlainCkbBalance: () => options.plainCkbBalance ?? 0n,
    formatCkb: (value: bigint) => value.toString(),
  };
}

function mockCcc(primaryLock: ScriptLike): CccLike {
  return {
    SignerCkbPrivateKey: class {
      public async getRecommendedAddressObj(): Promise<{
        script: ScriptLike;
        toString: () => string;
      }> {
        await Promise.resolve();
        return {
          script: primaryLock,
          toString: () => "ckt1generatedoffline",
        };
      }
    },
  };
}

function mockSdk(options: MockOptions): SdkLike {
  return {
    getConfig: () => ({}),
    IckbSdk: {
      fromConfig: () => ({
        getL1AccountState: async (): Promise<L1AccountState> => {
          await Promise.resolve();
          return {
            system: {
              tip: { hash: `0x${"44".repeat(32)}`, number: 3n, timestamp: 4n },
              feeRate: 1000n,
              exchangeRatio: { ckbScale: 1n, udtScale: 1n },
            },
            user: { orders: options.userOrders ?? [] },
            account: { capacityCells: [], receipts: [] },
          };
        },
      }),
    },
    projectAccountAvailability: (
      account: AccountState,
      userOrders: readonly unknown[],
      projectionOptions: { collectedOrdersAvailable: boolean },
    ): Projection => {
      options.projectCalls?.push({ account, userOrders, projectionOptions });
      return options.projection ?? emptyProjection();
    },
  };
}

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function writeText(filePath: string, data: string): Promise<void> {
  await fsWriteFile(filePath, data);
}

function parseRuntimeConfigJson(text: string): RuntimeConfigJson {
  const parsed: unknown = JSON.parse(text);
  if (isRuntimeConfigJson(parsed)) {
    return parsed;
  }
  throw new Error("Expected runtime config JSON");
}

function isRuntimeConfigJson(value: unknown): value is RuntimeConfigJson {
  return (
    isRecord(value) &&
    typeof value["chain"] === "string" &&
    typeof value["privateKey"] === "string" &&
    typeof value["sleepIntervalSeconds"] === "number" &&
    optionalNumber(value["maxIterations"]) &&
    optionalNumber(value["maxRetryableAttempts"]) &&
    typeof value["rpcUrl"] === "string"
  );
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mockCore(): CoreLike {
  return {
    ICKB_DEPOSIT_CAP: 10000000000000n,
    convert: (_toIckb, value) => value,
  };
}

function emptyProjection(): Projection {
  return {
    ckbAvailable: 0n,
    ckbPending: 0n,
    ckbBalance: 0n,
    ickbAvailable: 0n,
    ickbPending: 0n,
    ickbBalance: 0n,
    readyWithdrawals: [],
    pendingWithdrawals: [],
  };
}
