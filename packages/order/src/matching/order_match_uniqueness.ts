import type { Match } from "./match_types.ts";

export function hasUniquePartialOrderOutPoints(partials: Match["partials"]): boolean {
  const outPoints = new Set<string>();
  for (const partial of partials) {
    const key = partial.order.cell.outPoint.toHex();
    if (outPoints.has(key)) {
      return false;
    }
    outPoints.add(key);
  }

  return true;
}

export function partialOutPointKeys(partials: Match["partials"]): Set<string> {
  return new Set(partials.map((partial) => partial.order.cell.outPoint.toHex()));
}
