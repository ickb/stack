import { isRecord } from "../../../packages/node-utils/src/index.ts";
import {
  fixed8DecimalToUnits,
  parseCanonicalUnsignedInteger,
} from "../../../packages/validation/src/supervisor/stimulus/shared/stimulusArithmetic.ts";
import { runNode, spawnErrorMessage } from "./command.ts";
import {
  DEFAULT_RAW_ORDER_FEE,
  DEFAULT_RAW_ORDER_FEE_BASE,
  INVALID_PREFLIGHT_BALANCES_REASON,
  type DynamicArgs,
  type DynamicLoopDependencies,
  type JsonParseResult,
  type OptionalParsedBalanceField,
  type ParsedPreflightBalances,
  type PreflightBalanceText,
  type RawOrderFeePolicy,
  type RequiredParsedBalanceField,
  type TesterPreflightFailure,
  type TesterPreflightResult,
  type TextCommandResult,
} from "./model.ts";

export async function runTesterPreflight(
  args: DynamicArgs,
  root: string,
  dependencies: DynamicLoopDependencies,
): Promise<TesterPreflightResult> {
  const result = await runNode(
    [args.preflightScript, "--config", args.testerConfig],
    root,
    dependencies,
    { timeout: args.preflightTimeoutSeconds * 1000 },
  );
  if (result.error !== undefined || result.status !== 0) {
    return preflightCommandFailure(result);
  }
  const parsed = parsePreflightJson(result.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 1,
      signal: null,
      stderr: result.stderr,
      reason: "preflight returned invalid JSON",
      retryableStatusOne: false,
    };
  }
  return preflightSuccessFromText(preflightBalanceText(parsed.value), result.stderr);
}

function preflightCommandFailure(result: TextCommandResult): TesterPreflightFailure {
  const spawnError = spawnErrorMessage(result);
  return {
    ok: false,
    status: result.status,
    signal: result.signal,
    stderr: result.stderr,
    reason:
      spawnError === undefined
        ? "preflight command failed"
        : `preflight command failed: ${spawnError}`,
    retryableStatusOne:
      result.error === undefined && result.status === 1 && result.signal === null,
  };
}

function parsePreflightJson(stdout: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(stdout) };
  } catch {
    return { ok: false };
  }
}

function preflightBalanceText(parsed: unknown): PreflightBalanceText {
  const balances = recordField(parsed, "balances");
  const ckbBalances = recordField(balances, "CKB");
  const ickbBalances = recordField(balances, "ICKB");
  const system = recordField(parsed, "system");
  return {
    ckbText: optionalString(ckbBalances?.["available"]),
    plainCkbText: optionalString(ckbBalances?.["plainAvailable"]),
    projectedCkbText: optionalString(ckbBalances?.["projectedAvailable"]),
    ickbText: optionalString(ickbBalances?.["available"]),
    ickbUnavailableText: optionalString(ickbBalances?.["unavailable"]),
    ickbTotalText: optionalString(ickbBalances?.["total"]),
    feeRateText: optionalString(system?.["feeRate"]),
  };
}

function preflightSuccessFromText(
  text: PreflightBalanceText,
  stderr: string,
): TesterPreflightResult {
  const { ckbText, ickbText } = text;
  if (ckbText === undefined || ickbText === undefined) {
    return invalidPreflightBalances(stderr);
  }
  const balances = parsedPreflightBalances(text);
  if (balances === undefined) {
    return invalidPreflightBalances(stderr);
  }
  return {
    ok: true,
    ...balances,
    ckbText,
    plainCkbText: text.plainCkbText,
    projectedCkbText: text.projectedCkbText,
    ickbText,
    ickbUnavailableText: text.ickbUnavailableText,
    ickbTotalText: text.ickbTotalText,
  };
}

function parsedPreflightBalances(
  text: PreflightBalanceText,
): ParsedPreflightBalances | undefined {
  const ckb = requiredFixed8(text.ckbText);
  const plainCkb = optionalFixed8(text.plainCkbText);
  const ickb = requiredFixed8(text.ickbText);
  const ickbUnavailable = optionalFixed8(text.ickbUnavailableText);
  const ickbTotal = optionalFixed8(text.ickbTotalText);
  const feeRate = parseCanonicalUnsignedInteger(text.feeRateText);
  if (
    feeRate === undefined ||
    !ckb.ok ||
    !plainCkb.ok ||
    !ickb.ok ||
    !ickbUnavailable.ok ||
    !ickbTotal.ok
  ) {
    return undefined;
  }
  return {
    ckb: ckb.value,
    plainCkb: plainCkb.value,
    ickb: ickb.value,
    ickbUnavailable: ickbUnavailable.value,
    ickbTotal: ickbTotal.value,
    feeRate,
  };
}

function requiredFixed8(value: string | undefined): RequiredParsedBalanceField {
  const parsed = fixed8DecimalToUnits(value);
  return parsed === undefined ? { ok: false } : { ok: true, value: parsed };
}

function optionalFixed8(value: string | undefined): OptionalParsedBalanceField {
  return value === undefined ? { ok: true } : requiredFixed8(value);
}

function invalidPreflightBalances(stderr: string): TesterPreflightFailure {
  return {
    ok: false,
    status: 1,
    signal: null,
    stderr,
    reason: INVALID_PREFLIGHT_BALANCES_REASON,
    retryableStatusOne: false,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return isRecord(field) ? field : undefined;
}

export function testerFeePolicyFromSupervisorArgs(
  supervisorArgs: readonly string[],
): RawOrderFeePolicy {
  let fee = DEFAULT_RAW_ORDER_FEE;
  let feeBase = DEFAULT_RAW_ORDER_FEE_BASE;
  for (let index = 0; index < supervisorArgs.length; index += 1) {
    const arg = supervisorArgs[index];
    if (arg === "--tester-fee") {
      fee = parseCanonicalUnsignedInteger(supervisorArgs[index + 1]) ?? fee;
      index += 1;
      continue;
    }
    if (arg === "--tester-fee-base") {
      feeBase = parseCanonicalUnsignedInteger(supervisorArgs[index + 1]) ?? feeBase;
      index += 1;
    }
  }
  return { fee, feeBase };
}
