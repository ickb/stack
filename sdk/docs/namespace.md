# The `ickb` Namespace

The SDK has one entry point, exporting one name.

## One barrel, one name

`src/barrel.ts` is the only barrel. `src/index.ts` exports it once, as the `ickb` namespace:

```ts
import { ickb } from "@ickb/sdk"; // the whole surface, as in ickb.datesOf(...)
```

There are no flat named exports, so every call site says which library it uses. Measured on the production build of the interface (vite, 2026-11-11), the namespace-only entry left the bundle unchanged before and after: 1,725.12 kB raw, 546.94 kB gzip in all; the main chunk 1,108.19 kB, 354.66 kB gzip. Flat exports beside it, as CCC offers with `ccc`, were dropped: two ways to name one thing, while the flat one hides where a name comes from.

The namespace takes the library name, as CCC does. The word also names the protocol and the token, but amounts are spelled `ickbAvailable` or `ickbBalance`. So before a dot it can only mean the SDK. Rejected names: `isdk`, `icc`, `stack`. More barrels or entry points would only add boundaries nobody needs.
