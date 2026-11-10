import { ccc } from "@ckb-ccc/core";
import { StubClient, type StubClientHandlers } from "@ickb/testkit";

import { headerLike } from "../../../transaction/base/support/sdk_core_support.ts";

export class FeeRateStubClient extends StubClient {
  public override async getFeeRate(): Promise<bigint> {
    await Promise.resolve();
    return 1n;
  }
}

/** Serves `anchor` as the parent of a fresh tip, the header a state read anchors at. */
export function anchoredAt(
  anchor: ccc.ClientBlockHeader,
  headers = new Map<bigint, ccc.ClientBlockHeader>(),
): Pick<StubClientHandlers, "getTipHeader" | "getHeaderByNumber"> {
  const tip = headerLike(anchor.number + 1n, {
    parentHash: anchor.hash,
    timestamp: BigInt(Date.now()),
  });
  return {
    getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
      await Promise.resolve();
      return tip;
    },
    getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      const key = ccc.numFrom(number);
      return key === anchor.number ? anchor : headers.get(key);
    },
  };
}
