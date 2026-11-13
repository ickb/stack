# Patches

Dependency patches pnpm applies at install. `patchedDependencies` in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) lists them with the reason for each.

- `@joyid__ckb@1.1.4.patch`: JoyID 1.1.4 imports `cross-fetch`, which loads `node-fetch@2` and the deprecated Node built-in `punycode` when the workspace runs from source. The patch uses `globalThis.fetch`, which every supported runtime has, until JoyID publishes the same change. [`native-source-smoke.ts`](../scripts/test/build/native-source-smoke.ts) guards it.
