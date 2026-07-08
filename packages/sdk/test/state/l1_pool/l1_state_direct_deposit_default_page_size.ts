import { defaultCellPageSize } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  none,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";
import {
  directDepositPageSizeFixture,
  L1_STATE_SUITE,
} from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("passes the default page size to direct deposit scanning", async () => {
    const { logicManager, ownedOwnerManager, sdk } = directDepositPageSizeFixture();
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(headerLike(1n)),
      findCellsOnChain: emptyCellScan,
    });

    await sdk.getL1State(client, []);

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      pageSize: defaultCellPageSize,
    });
  });
});
