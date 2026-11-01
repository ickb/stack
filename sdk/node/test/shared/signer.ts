import { ccc } from "@ckb-ccc/core";
import { StubClient, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { keyAccount } from "../../src/shared/signer.ts";

const FIRST_KEY: `0x${string}` = `0x${"11".repeat(32)}`;
const SECOND_KEY: `0x${string}` = `0x${"22".repeat(32)}`;

describe("keyAccount", () => {
  it("signs for every key and names the first key's lock as primary", async () => {
    // No anyone-can-pay cells: each key's address list is its secp256k1 lock alone.
    const client = new StubClient({ cells: (): readonly StubCell[] => [] });
    const first = await new ccc.SignerCkbPrivateKey(
      client,
      FIRST_KEY,
    ).getRecommendedAddressObj();
    const second = await new ccc.SignerCkbPrivateKey(
      client,
      SECOND_KEY,
    ).getRecommendedAddressObj();

    const account = await keyAccount(client, [FIRST_KEY, SECOND_KEY]);

    expect(account.address).toBe(first.toString());
    expect(account.primaryLock).toEqual(first.script);
    expect(account.accountLocks).toEqual([first.script, second.script]);
    expect((await account.signer.getAddressObjs()).map(({ script }) => script)).toEqual(
      account.accountLocks,
    );
  });
});
