import { ccc } from "@ckb-ccc/core";
import { StubClient } from "@ickb/testkit";
import { vi } from "vitest";

export const SEND_AND_WAIT_SUITE = "sendAndWaitForCommit";

export function transactionStatus(
  status: string,
  reason?: string,
): TransactionStatusFixture {
  return {
    tx_status: {
      status,
      ...(reason === undefined ? {} : { reason }),
    },
    transaction: null,
  };
}

export interface TransactionStatusFixture {
  tx_status: {
    status: string;
    reason?: string;
  };
  transaction: null;
}

export class TransactionStatusStubClient extends StubClient {
  public readonly request: (method: string, params: unknown[]) => Promise<unknown>;
  public readonly clear = vi.fn(noopAsync);

  constructor(
    request: (method: string, params: unknown[]) => Promise<unknown>,
    cache?: ccc.ClientCache,
  ) {
    super({});
    this.request = request;
    Object.defineProperty(this, "requestor", {
      value: new ccc.RequestorJsonRpc("https://example.invalid", {
        transport: {
          request: async (
            payload,
          ): Promise<{ id: number; result: unknown; error: null }> => {
            await Promise.resolve();
            if (!Array.isArray(payload.params)) {
              throw new TypeError("Expected JSON-RPC array params");
            }
            return {
              id: payload.id,
              result: await this.request(payload.method, payload.params),
              error: null,
            };
          },
        },
      }),
    });
    if (cache !== undefined) {
      this.cache = cache;
    }
  }
}

export class NoRequestorStubClient extends StubClient {
  constructor() {
    super({});
    Object.defineProperty(this, "requestor", { value: undefined });
  }
}

export class ClearableCache extends ccc.ClientCache {
  private readonly clearHandler: () => Promise<void>;

  constructor(clear: () => Promise<void>) {
    super();
    this.clearHandler = clear;
  }

  public override async clear(): Promise<void> {
    await this.clearHandler();
  }

  public override async markUsableNoCache(): Promise<void> {
    await Promise.resolve();
  }

  public override async markUnusable(): Promise<void> {
    await Promise.resolve();
  }

  public override async *findCells(): AsyncGenerator<ccc.Cell> {
    yield* none<ccc.Cell>();
  }

  public override async isUnusable(): Promise<boolean> {
    await Promise.resolve();
    return false;
  }
}

export async function noopAsync(): Promise<void> {
  await Promise.resolve();
}

async function* none<T>(): AsyncGenerator<T> {
  const values: T[] = [];
  yield* values;
  await Promise.resolve();
}
