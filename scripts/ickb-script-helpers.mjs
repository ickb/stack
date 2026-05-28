const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export function valueAfter(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parsePositiveInteger(value, flag) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

export function parseNonNegativeInteger(value, flag) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}
