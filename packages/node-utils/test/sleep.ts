import { describe, expect, it, vi } from "vitest";
import { sleep } from "../src/index.ts";

describe("sleep", () => {
  it("resolves after the requested timeout", async () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      const promise = markDoneAfterSleep(done);

      await vi.advanceTimersByTimeAsync(24);
      expect(done).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function markDoneAfterSleep(done: () => unknown): Promise<void> {
  await sleep(25);
  done();
}
