export function memoryStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> & {
  keys: () => string[];
} {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key): void => {
      data.delete(key);
    },
    setItem: (key, value): void => {
      data.set(key, value);
    },
    keys: () => [...data.keys()],
  };
}
