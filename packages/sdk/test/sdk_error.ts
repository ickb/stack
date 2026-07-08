import { describe, expect, it } from "vitest";
import { errorOf } from "../src/client/sdk_error.ts";

describe("errorOf", () => {
  it("preserves thrown strings as error messages", () => {
    const error = errorOf("plain failure");

    expect(error.message).toBe("plain failure");
    expect(error.cause).toBe("plain failure");
  });

  it("serializes bigint and date values in object errors", () => {
    const thrown = {
      amount: 42n,
      validDate: new Date("2026-01-02T03:04:05.000Z"),
      invalidDate: new Date(Number.NaN),
    };
    const error = errorOf(thrown);

    expect(error.message).toBe(
      '{"amount":"42","validDate":"2026-01-02T03:04:05.000Z","invalidDate":null}',
    );
    expect(error.cause).toBe(thrown);
  });
});
