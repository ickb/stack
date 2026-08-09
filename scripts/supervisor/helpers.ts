const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_TIMER_DELAY_SECONDS = Math.floor(MAX_TIMER_DELAY_MS / 1000);

export function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parsePositiveTimerSeconds(value: string, flag: string): number {
  return assertTimerSeconds(parsePositiveInteger(value, flag), flag);
}

export function parseNonNegativeTimerSeconds(value: string, flag: string): number {
  return assertTimerSeconds(parseNonNegativeInteger(value, flag), flag);
}

export function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

export function maxTimerDelaySeconds(): number {
  return MAX_TIMER_DELAY_SECONDS;
}

function assertTimerSeconds(seconds: number, flag: string): number {
  if (seconds > MAX_TIMER_DELAY_SECONDS) {
    throw new Error(
      `Invalid ${flag}: expected at most ${String(MAX_TIMER_DELAY_SECONDS)} seconds`,
    );
  }
  return seconds;
}
