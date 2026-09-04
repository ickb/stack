import type { Dependencies } from "../../../../src/supervisor/index.ts";

export const SUPERVISOR_CLI_SUITE = "supervisor CLI";

export const CLASSIFICATION_SUITE = "classification";

export const DETERMINISTIC_INCIDENT_SUITE = "deterministic incident handling";

export const VALIDATION_RUN_DIR =
  "log/validation/dynamic-test/chunks/chunk-0001/run-0001";

export const EXTERNAL_VALIDATION_PARENT =
  "/workspaces/research/forks/ickb_stack/repo/.scratch/ickb-log/validation";

export const EXTERNAL_VALIDATION_RUN_DIR = `${EXTERNAL_VALIDATION_PARENT}/dynamic-test/chunks/chunk-0001/run-0001`;

export const BOT_CONFIG_FLAG = "--bot-config";

export const BOT_CONFIG_PATH = "config/bot-testnet.json";

export const TESTER_CONFIG_FLAG = "--tester-config";

export const TESTER_CONFIG_PATH = "config/tester-testnet.json";

export const MAX_CYCLES_FLAG = "--max-cycles";

export const STOP_AFTER_TX_COUNT_FLAG = "--stop-after-tx-count";

export const SCENARIO_FLAG = "--scenario";

export const FRESH_SKIP_TWO_PASS_SCENARIO = "tester-fresh-skip-two-pass";

export const TESTER_SCENARIO_FLAG = "--tester-scenario";

export const TESTER_OWNED_TX_HASH_FLAG = "--owned-tx-hash";

export const TESTER_FEE_FLAG = "--tester-fee";

export const TESTER_FEE_BASE_FLAG = "--tester-fee-base";

export const TARGET_OUTCOME_FLAG = "--target-outcome";

export const BOT_MATCH_COMMITTED = "bot_match_committed";

export const SDK_CONVERSION_SCENARIO = "sdk-conversion";

export const TWO_CKB_TO_ICKB_SCENARIO = "two-ckb-to-ickb-limit-orders";

export const TWO_ICKB_TO_CKB_SCENARIO = "two-ickb-to-ckb-limit-orders";

export const BOUNDED_ICKB_TO_CKB_SCENARIO = "bounded-ickb-to-ckb-limit-order";

export const MIXED_DIRECTION_SCENARIO = "mixed-direction-limit-orders";

export const MULTI_ORDER_SCENARIO = "multi-order-limit-orders";

export const COMMAND_TIMEOUT_SECONDS_FLAG = "--command-timeout-seconds";

export const INVALID_OUT_DIR_MESSAGE =
  "Supervisor output directory must be under log/live-supervisor/ or a validation session run directory";

export const LIVE_SUPERVISOR_TEST_DIR = "log/live-supervisor/test";

export const BOT_DECISION_SKIPPED = "bot.decision.skipped";

export const BOT_ENTRYPOINT = "packages/bot/src/index.ts";

export const TESTER_ENTRYPOINT = "packages/validation/src/tester/index.ts";

export const TEST_ACTOR_ENTRYPOINTS = {
  bot: BOT_ENTRYPOINT,
  tester: TESTER_ENTRYPOINT,
} as const;

export const RANDOM_ORDER_SCENARIO = "random-order";

export const STANDARD_CYCLE_SCENARIO = "standard-cycle";

export const BOT_TRANSACTION_BUILT = "bot.transaction.built";

export const BOT_TRANSACTION_COMMITTED = "bot.transaction.committed";

export const INCIDENT_CLASSIFICATION = "incident classification";

export const ICKB_TO_CKB_SCENARIO = "ickb-to-ckb-limit-order";

export const FRESH_MATCHABLE_ORDER = "fresh-matchable-order";

export const SUMMARY_AGGREGATE_COUNTS = "summary aggregate counts";

export const PREFLIGHT_CKB_AVAILABLE = "2853.99897309";

export const PREFLIGHT_ICKB_AVAILABLE = "250838.31219989";

export const POST_TX_CKB_RESERVE = "post-tx-ckb-reserve";

export const INCIDENT_JSON_SUFFIX = "incident.json";

export const MALFORMED_JSON_LINE = "{not-json}";

export const INVALID_TX_HASH = "not-a-tx-hash";

export const DUST_CKB_CONVERSION_SCENARIO = "dust-ckb-conversion";

export const DUST_AMOUNT = "0.00000001";

export const CKB_TO_ICKB_DIRECTION = "ckb-to-ickb";

export const BOT_STATE_READ = "bot.state.read";

export const BOT_ITERATION_FAILED = "bot.iteration.failed";

export const FETCH_FAILED = "fetch failed";

export const BOT_TRANSACTION_FAILED = "bot.transaction.failed";

export const TRANSACTION_CONFIRMATION_TIMEOUT = "Transaction confirmation timed out";

export const PREFLIGHT_RETRYABLE_FAILURE =
  "Live preflight retryable failure: fetch failed\n";

export const MAX_WALL_CLOCK_SECONDS_FLAG = "--max-wall-clock-seconds";

export const TESTER_ONLY_SCENARIO = "tester-only";

export const SUMMARY_TX_HASHES = "summary tx hashes";

export type SupervisorSpawn = NonNullable<Dependencies["spawnCommand"]>;

export type SupervisorSpawnSync = NonNullable<Dependencies["spawnSyncCommand"]>;

export function txHash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
