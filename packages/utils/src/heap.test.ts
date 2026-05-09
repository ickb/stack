import { describe, expect, it } from "vitest";
import { MinHeap } from "./heap.js";

describe("MinHeap.remove", () => {
  it("removes the requested non-root element", () => {
    const heap = MinHeap.from(compareNumbers, [1, 2, 3]);

    expect(heap.remove(1)).toBe(2);
    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBe(3);
  });

  it("ignores negative indexes", () => {
    const heap = MinHeap.from(compareNumbers, [1, 2, 3]);

    expect(heap.remove(-1)).toBeUndefined();
    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBe(2);
    expect(heap.pop()).toBe(3);
  });
});

function compareNumbers(items: number[], i: number, j: number): boolean {
  const left = items.at(i);
  const right = items.at(j);
  if (left === undefined || right === undefined) {
    throw new Error("Heap comparator index out of bounds");
  }

  return left < right;
}
