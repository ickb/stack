import type { ickb } from "@ickb/sdk";

/**
 * Reads the options of a recorded SDK wait call.
 *
 * The SDK also accepts a positional call form, so this asserts that the
 * interface always passes its bounded window and cancellation signal together.
 */
export function waitCallOptions(
  call: Parameters<typeof ickb.waitTransaction> | undefined,
): ickb.WaitTransactionOptions {
  const options = call?.[2];
  if (typeof options !== "object") {
    throw new TypeError(
      "Expected ickb.waitTransaction to be called with an options object",
    );
  }
  return options;
}
