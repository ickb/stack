# Patches

Dependency patches pnpm applies at install (`patchedDependencies` in `pnpm-workspace.yaml`, which carries each patch's reason).

- `@joyid__ckb@1.1.4.patch`: JoyID 1.1.4 imports `cross-fetch`, which loads `node-fetch@2` and Node's deprecated `punycode` when the workspace runs from source. The patch uses `globalThis.fetch`, which every supported runtime has, until JoyID publishes the same change. `scripts/test/build/native-source-smoke.ts` guards it.
