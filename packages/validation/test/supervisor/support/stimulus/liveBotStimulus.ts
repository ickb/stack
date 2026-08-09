import path from "node:path";

import { expect } from "vitest";

import type {
  balancesFromPreflight,
  ParsedStimulusArgs,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";

import {
  BOT_TRANSACTION_BUILT_EVENT,
  BOT_TRANSACTION_COMMITTED_EVENT,
  SUMMARY_JSON,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusConstants.ts";
import { txHash } from "./liveBotStimulusFixture.ts";

export {
  botEvent,
  launcherStartedRecord,
  liveBotStimulusDependencies,
  matchedCommitEventText,
  matchedOrderDecision,
  processIdentityFixture,
  TEST_LAUNCH_IDENTITY,
  testBotIdentity,
  txHash,
} from "./liveBotStimulusFixture.ts";

const { join } = path;

export const ckb = 100000000n;

export const LIVE_BOT_STIMULUS_SUITE = "live bot stimulus test";

export const BOUNDED_ICKB_TO_CKB_LIMIT_ORDER = "bounded-ickb-to-ckb-limit-order";

export const EXTRA_LARGE_LIMIT_ORDER = "extra-large-limit-order";

export const BOT_TRANSACTION_BUILT = BOT_TRANSACTION_BUILT_EVENT;

export const BOT_TRANSACTION_COMMITTED = BOT_TRANSACTION_COMMITTED_EVENT;

export const TEST_SESSION = "test-session";

export { SUMMARY_JSON };

export function expectStimulusRunResult({
  tmpRoot,
  supervisorArgs,
  stdout,
  writes,
  appended,
}: {
  tmpRoot: string;
  supervisorArgs: string[][];
  stdout: ReturnType<typeof textWriter>;
  writes: Map<string, string>;
  appended: Map<string, string>;
}): void {
  expect(supervisorArgs[0]).toContain("tester-only");
  expect(supervisorArgs[0]).toContain("tester_order_created");
  expect(supervisorArgs[0]).not.toContain("bot-only");
  expect(supervisorArgs[0]).toEqual(
    expect.arrayContaining(["--max-cycles", "1", "--stop-after-tx-count", "1"]),
  );
  expect(stdout.text).toContain("live bot stimulus cycle passed");
  expect(
    JSON.parse(
      writes.get(join(tmpRoot, "validation", TEST_SESSION, SUMMARY_JSON)) ?? "{}",
    ),
  ).toMatchObject({
    result: { status: "passed", wait: { evidence: { txHash: txHash("cc") } } },
  });
  expect(
    appended.has(
      join(tmpRoot, "validation", TEST_SESSION, "supervisor", "events.ndjson"),
    ),
  ).toBe(true);
}

export function testArgs(
  overrides: Partial<ParsedStimulusArgs> = {},
): ParsedStimulusArgs {
  return {
    help: false,
    keepGoing: false,
    logRoot: "log",
    sessionRoot: "log/validation/test-session",
    botLiveConfig: "config/bot-live-testnet.json",
    testerConfig: "config/tester-testnet.json",
    testerScenario: "auto",
    pollSeconds: 5,
    commandTimeoutSeconds: 900,
    preflightTimeoutSeconds: 120,
    ...overrides,
  };
}

export function balances(
  overrides: Partial<ReturnType<typeof balancesFromPreflight>>,
): ReturnType<typeof balancesFromPreflight> {
  return {
    depositCapacity: 0n,
    projectedCkb: 0n,
    ickbAvailable: 0n,
    feeRate: 0n,
    ...overrides,
  };
}

export function textWriter(): { text: string; write: (chunk: string) => true } {
  return {
    text: "",
    write(chunk): true {
      this.text += chunk;
      return true;
    },
  };
}

export function expectParsedArgs(args: ParsedStimulusArgs): void {
  expect(args).toMatchObject({
    help: false,
    keepGoing: false,
    logRoot: "log/custom",
    sessionRoot: "log/custom/validation/manual",
    botLiveConfig: "config/bot-live.json",
    testerConfig: "config/tester.json",
    testerScenario: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
    testerFee: "1",
    testerFeeBase: "1000",
    waitSeconds: 12,
    pollSeconds: 3,
    commandTimeoutSeconds: 99,
    preflightTimeoutSeconds: 7,
  });
}
