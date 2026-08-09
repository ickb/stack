import { fileURLToPath } from "node:url";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  AUTO_TESTER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  type TesterScenarioSelection,
} from "../../../testerContract.ts";
export {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  AUTO_TESTER_SCENARIO as AUTO_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  DEFAULT_TESTER_FEE_POLICY,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
} from "../../../testerContract.ts";

export const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

export const CKB = 100000000n;

export const CKB_SPENDING_STIMULUS_BUFFER = 2000n;

export const ICKB_STIMULUS_MIN_ICKB = 100n;

export const MATURITY_FEE_MULTIPLIER = 10n;

export const BOUNDED_ICKB_TO_CKB_FEE_POLICY = { fee: "1", feeBase: "1000" };

export const EXTRA_LARGE_LIMIT_ORDER_DEPOSIT_MULTIPLIER = 2n;

export const DEFAULT_LOG_ROOT = "log";

export const DEFAULT_BOT_LIVE_CONFIG = "config/bot-live-testnet.json";

export const DEFAULT_TESTER_CONFIG = "config/tester-testnet.json";

export const DEFAULT_POLL_SECONDS = 5;

export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 15 * 60;

export const DEFAULT_PREFLIGHT_TIMEOUT_SECONDS = 2 * 60;

export const MAX_EVENT_READ_BYTES = 16 * 1024 * 1024;

export const MAX_PENDING_EVENT_TEXT_BYTES = 64 * 1024;

export const MAX_UNMATCHED_ITERATIONS = 256;

export const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export const LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS = [
  AUTO_TESTER_SCENARIO,
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
] as const satisfies readonly TesterScenarioSelection[];

export const TESTER_ORDER_CREATED = "tester_order_created";

export const SESSION_ROOT_FLAG = "--session-root";

export const SUPERVISOR_DIR = "supervisor";

export const SUMMARY_JSON = "summary.json";

export const BOT_TRANSACTION_BUILT_EVENT = "bot.transaction.built";

export const BOT_TRANSACTION_COMMITTED_EVENT = "bot.transaction.committed";

export const BOT_DECISION_SKIPPED_EVENT = "bot.decision.skipped";

export const BOT_TRANSACTION_FAILED_EVENT = "bot.transaction.failed";

export const BOT_ITERATION_FAILED_EVENT = "bot.iteration.failed";

export const LAUNCHER_STARTED_EVENT = "launcher.started";

export const BOT_CHAIN_PREFLIGHT_EVENT = "bot.chain.preflight";

export const PUBLIC_STATE_FIELDS = [
  "orders",
  "match",
  "rebalance",
  "poolDeposits",
] as const;
