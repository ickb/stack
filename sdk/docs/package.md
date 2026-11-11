# Package Shape

How the SDK is laid out, what it depends on and how it's versioned. The public surface follows one workflow (read the state, build, sign and send, wait) plus the types its signatures need. Managers and raw deployment configuration stay internal.

## Layout

The script modules sit at the top of `src/`:

- `udt.ts`: the iCKB token.
- `logic.ts`: deposits and receipts.
- `owned_owner.ts`: withdrawal requests and withdrawals.
- `dao.ts`: the Nervos DAO rules they share.

The other files and folders hold one concern each:

- `state.ts`: `readState`, the one public read, over the internal raw read the bot calls with its own policy.
- `build.ts`: `buildConversionTransaction`, which walks the candidate plans, and the internal `buildBaseTransaction` every own transaction starts from. They're plain functions: the SDK holds no state and serves every chain, so an instance had nothing to carry.
- `complete.ts`: completion, which funds a built transaction and pays its fee, and the walk that completes the first fundable candidate.
- `order/`: limit orders and matching.
- `conversion/`: the state projection, estimates, plans and the withdrawal ring.
- `send/`: signing, broadcast and confirmation.
- `utils/`: shared readers, codecs and signer helpers.

The signer combinator in `utils/` is general CCC code, not iCKB code, so it lives here rather than in `sdk/node`. It stays out of the public entry until an integrator needs it or CCC takes it upstream.

There's no separate DAO manager layer: it had one caller per operation and nobody calling raw DAO operations. So those operations live with the iCKB script that uses them.

## One barrel, two names

`src/barrel.ts` is the only barrel. `src/index.ts` exports it twice, as CCC does with `ccc`:

```ts
import { ickb } from "@ickb/sdk"; // the whole surface, as in ickb.readyAt(...)
import { readyAt } from "@ickb/sdk"; // or one name at a time
```

The namespace takes the library name, as CCC does. The word also names the protocol and the token, but amounts are spelled `ickbValue` or `ickbAvailable`. So before a dot it can only mean the SDK. Rejected names: `isdk`, `icc` and `stack`. More barrels or entry points would only add boundaries nobody needs.

## CCC as a peer

The package has no Node built-ins and one dependency: `@ckb-ccc/core`, declared as a peer. The integrator installs it and the SDK runs on that copy. So every CCC object passed in or out comes from the CCC the integrator installed.

A regular dependency was rejected. When the two version ranges resolve apart, it installs a second copy. A CCC object from one copy then fails `instanceof` against the classes of the other. The cost is one install line where the package manager doesn't add peers by itself (npm 7 and later do, pnpm too).

A second copy can still show up through a wallet connector, or an integrator who installs two. So the SDK and the interface recognize the CCC requestor, duplicate-send error and wait timeout by shape, not by class. The SDK keeps a development copy of CCC for its own tests and build.

## Runtime

The SDK targets ES2024. The newest built-ins it calls are `Promise.withResolvers` and the copying array methods like `toSorted`. So it needs Node 22 or later, or a browser that ships them.

A web app should list its browser targets, for example `"browserslist": ["baseline widely available"]`, instead of trusting a bundler default that may be older. The package declares no `engines` field: the bot gets its Node from the repository pin. The language level is the real requirement.

## Versioning

The repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). The [release policy](../../README.md#releases) explains where this rewrite started.

A breaking change takes the next major version. Consumers like NervDAO pin a version, so a major bump is their signal to check.

No API report is committed. API Extractor already rejects a forgotten export, so every type reachable from the entry point can be imported. A generated report would be one more file to refresh on every change, without telling anything the version doesn't.
