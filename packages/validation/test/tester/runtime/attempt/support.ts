import { vi } from "vitest";

export { ccc } from "@ckb-ccc/core";
export { IckbSdk, OrderConversionRepresentabilityError } from "@ickb/sdk";
export { byte32FromByte, capacityCell, headerLike, script } from "@ickb/testkit";
export { planTesterAttempt } from "../../../../src/tester/planning/testerAttemptPlanning.ts";
export { buildSdkConversionTransaction } from "../../../../src/tester/runtime/runtime.ts";
export { runTesterAttempt } from "../../../../src/tester/runtime/testerAttempt.ts";
export { isRetryableTesterError } from "../../../../src/tester/runtime/testerErrors.ts";
export { runTesterTurn } from "../../../../src/tester/runtime/testerTurn.ts";
export {
  buildBaseTransactionMock,
  completeTransactionMock,
  requestInfo,
  requestMock,
  runtimeWithSdk,
  systemState,
  withdrawal,
} from "../../../support/runtime/runtime.ts";
export { runtimeDefaultSdk } from "../../../support/runtime/runtimeDefaultSdkFixture.ts";
export {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  CKB_TO_ICKB_DIRECTION,
  DUST_ICKB_CONVERSION_SCENARIO,
  ESTIMATED_TOO_SMALL_REASON,
  ICKB_TO_CKB_DIRECTION,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  matchableOrder,
  SDK_CONVERSION_SCENARIO,
  testerState,
  type TransactionResponse,
} from "../../../support/tester/index.ts";

export const LOW_CAPITAL_MESSAGE =
  "Not enough funds to continue testing, shutting down...";

export const captureStdout = (): {
  output: string[];
  stdoutWrite: { mockRestore: () => void };
} => {
  const output: string[] = [];
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  return { output, stdoutWrite };
};
