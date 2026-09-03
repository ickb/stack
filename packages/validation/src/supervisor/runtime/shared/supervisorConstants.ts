import pathModule from "node:path";
import { fileURLToPath } from "node:url";
import { RANDOM_ORDER_SCENARIO, type TesterScenario } from "../../../testerContract.ts";
export {
  CKB_TO_ICKB,
  GIVE_CKB_FIELD,
  GIVE_ICKB_FIELD,
  ICKB_TO_CKB,
  isIckbToCkbTesterScenario,
  isSdkConversionTesterScenario,
  isTesterScenarioSelection,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  TAKE_CKB_FIELD,
  TAKE_ICKB_FIELD,
  TESTER_FEE_FIELD,
  TESTER_OWNED_TX_HASH_FLAG,
  TESTER_SCENARIO_FIELD,
  TESTER_SCENARIO_SELECTIONS,
  TESTER_SCENARIOS,
  testerScenarioSelectionErrorText,
  testerScenarioSelectionListText,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  type TesterDirection,
  type TesterScenario,
  type TesterScenarioSelection,
} from "../../../testerContract.ts";

export const { dirname, isAbsolute, join, parse, relative } = pathModule;

export const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 15 * 60;

export const DEFAULT_COMMAND_KILL_GRACE_MS = 5 * 1000;

export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export const COMMAND_START_GRACE_MS = 60 * 1000;

export const DEFAULT_BOT_CONFIG_PATH = "config/bot-testnet.json";

export const DEFAULT_TESTER_CONFIG_PATH = "config/tester-testnet.json";

export const STOP_EXIT_CODE = 2;

export const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export const SUPERVISOR_OUTPUT_ROOT = "log/live-supervisor/";

export const OUTCOME_KINDS = [
  "tester_order_created",
  "tester_dust_order_created",
  "tester_conversion_created",
  "tester_fresh_order_skip",
  "tester_sampled_too_small_skip",
  "tester_estimated_too_small_skip",
  "tester_reserve_skip",
  "tester_retryable_error",
  "tester_deterministic_pre_broadcast_error",
  "bot_no_action_skip",
  "bot_retryable_error",
  "bot_terminal_error",
  "bot_reserve_skip",
  "bot_match_committed",
  "bot_match_plus_deposit_committed",
  "bot_receipt_completion_committed",
  "bot_deposit_only_committed",
  "bot_withdrawal_request_committed",
  "bot_withdrawal_completion_committed",
  "economic_loss",
  "low_capital_stop",
  "confirmation_timeout",
  "terminal_chain_rejection",
  "post_broadcast_unresolved",
  "wrong_chain",
  "malformed_evidence",
  "command_timeout",
  "preflight_retryable_error",
  "nonzero_exit",
  "unknown",
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export type Actor = "bot" | "tester";

export const TESTER_FRESH_SKIP_TWO_PASS_SCENARIO = "tester-fresh-skip-two-pass";

export const SCENARIO_NAMES = [
  "standard-cycle",
  "tester-only",
  "bot-only",
  TESTER_FRESH_SKIP_TWO_PASS_SCENARIO,
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export interface ScenarioStep {
  actor: Actor;
  label?: string;
  testerScenario?: TesterScenario;
}

export const TESTER_ORDER_CREATED: OutcomeKind = "tester_order_created";

export const TESTER_CONVERSION_CREATED: OutcomeKind = "tester_conversion_created";

export const TESTER_FRESH_ORDER_SKIP: OutcomeKind = "tester_fresh_order_skip";

export const TESTER_SAMPLED_TOO_SMALL_SKIP: OutcomeKind = "tester_sampled_too_small_skip";

export const BOT_NO_ACTION_SKIP: OutcomeKind = "bot_no_action_skip";

export const BOT_MATCH_COMMITTED: OutcomeKind = "bot_match_committed";

export const BOT_MATCH_PLUS_DEPOSIT_COMMITTED: OutcomeKind =
  "bot_match_plus_deposit_committed";

export const BOT_RECEIPT_COMPLETION_COMMITTED: OutcomeKind =
  "bot_receipt_completion_committed";

export const BOT_DEPOSIT_ONLY_COMMITTED: OutcomeKind = "bot_deposit_only_committed";

export const BOT_WITHDRAWAL_REQUEST_COMMITTED: OutcomeKind =
  "bot_withdrawal_request_committed";

export const BOT_WITHDRAWAL_COMPLETION_COMMITTED: OutcomeKind =
  "bot_withdrawal_completion_committed";

export const BOT_TRANSACTION_COMMITTED_EVENT = "bot.transaction.committed";

export const BOT_TRANSACTION_BUILT_EVENT = "bot.transaction.built";

export const BOT_STATE_READ_EVENT = "bot.state.read";

export const BOT_ITERATION_FAILED_EVENT = "bot.iteration.failed";

export const BOT_DECISION_SKIPPED_EVENT = "bot.decision.skipped";

export const BOT_TRANSACTION_FAILED_EVENT = "bot.transaction.failed";

export const BOT_DECISION_PUBLIC_STATE_EVENTS = new Set([
  BOT_DECISION_SKIPPED_EVENT,
  BOT_TRANSACTION_BUILT_EVENT,
]);

export const SCENARIO_STEPS: Record<ScenarioName, ScenarioStep[]> = {
  "standard-cycle": [{ actor: "tester" }, { actor: "bot" }],
  "tester-only": [{ actor: "tester" }],
  "bot-only": [{ actor: "bot" }],
  // Pass one must leave a fresh owned order for pass two to skip on; an explicit
  // --tester-scenario overrides both steps and forfeits that guarantee.
  [TESTER_FRESH_SKIP_TWO_PASS_SCENARIO]: [
    { actor: "tester", label: "tester-pass-1", testerScenario: RANDOM_ORDER_SCENARIO },
    { actor: "tester", label: "tester-pass-2", testerScenario: RANDOM_ORDER_SCENARIO },
  ],
};

export const TX_CREATING_OUTCOMES: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>([
  TESTER_ORDER_CREATED,
  "tester_dust_order_created",
  TESTER_CONVERSION_CREATED,
  BOT_MATCH_COMMITTED,
  BOT_MATCH_PLUS_DEPOSIT_COMMITTED,
  BOT_RECEIPT_COMPLETION_COMMITTED,
  BOT_DEPOSIT_ONLY_COMMITTED,
  BOT_WITHDRAWAL_REQUEST_COMMITTED,
  BOT_WITHDRAWAL_COMPLETION_COMMITTED,
  "economic_loss",
  "confirmation_timeout",
  "terminal_chain_rejection",
  "post_broadcast_unresolved",
]);
