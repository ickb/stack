import { readyDeposit, type TestDeposit } from "./withdrawal_selection_support.ts";

export type ScoredTestDeposit = TestDeposit & { score: bigint };

export function scoredReadyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
  score: bigint,
): ScoredTestDeposit {
  return { ...readyDeposit(udtValue, maturityUnix), score };
}
