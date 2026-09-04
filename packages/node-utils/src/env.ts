/** Keeps only the environment a child process needs; never forwards secrets. */
export function minimalProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    ["PATH", "HOME", "LANG", "LC_ALL", "TERM"].flatMap((key) => {
      const value = env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}
