/** A uniform random order: each item sorted by its own key from `random`. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  return items
    .map((item) => ({ item, key: random() }))
    .toSorted((left, right) => left.key - right.key)
    .map(({ item }) => item);
}
