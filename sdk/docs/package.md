# Package Shape

How the SDK is laid out, what it depends on, how it's versioned. Its one public name is in [the `ickb` namespace](namespace.md). The public surface follows one workflow (read the state, build, sign and send, wait) plus the types its signatures need. The script builders and the raw deployment configuration stay internal.

## Layout

The script modules sit at the top of `src/`:

- `udt.ts`: the iCKB token.
- `logic.ts`: deposits and receipts.
- `owned_owner.ts`: withdrawal requests and withdrawals.
- `dao.ts`: the Nervos DAO rules they share.

The other files and folders hold one concern each:

- `state.ts`: `readState`, the one public read, over the internal raw read the bot calls with its own policy.
- `build.ts`: `buildConversionTransaction`, which walks the candidate plans, plus the internal `buildBaseTransaction` every own transaction starts from. They're plain functions: the SDK holds no state, serving every chain, so an instance had nothing to carry.
- `complete.ts`: completion, which funds a built transaction then pays its fee, plus the walk that completes the first fundable candidate.
- `order/`: limit orders and matching.
- `conversion/`: the state projection, estimates, plans and the withdrawal ring.
- `send/`: signing, broadcast and confirmation.
- `utils/`: shared readers, codecs and signer helpers.

The signer combinator in `utils/` is general CCC code, not iCKB code, so it lives here rather than in `sdk/node`. It stays out of the public entry until an integrator needs it or CCC takes it upstream.

There's no separate DAO manager layer: it had one caller per operation, with nobody calling raw DAO operations. So those operations live with the iCKB script that uses them.

## CCC as a peer

The package has no Node built-ins and one dependency: `@ckb-ccc/core`, declared as a peer. The integrator installs it, then the SDK runs on that copy. So every CCC object passed in or out comes from the CCC the integrator installed.

A regular dependency was rejected. When the two version ranges resolve apart, it installs a second copy. A CCC object from one copy then fails `instanceof` against the classes of the other. The cost is one install line where the package manager doesn't add peers by itself (npm 7 and later do, pnpm too).

A second copy can still show up through a wallet connector, or an integrator who installs two. So the SDK and the interface recognize the CCC requestor and duplicate-send error by shape, not by class. The SDK keeps a development copy of CCC for its own tests and build.

## Runtime

The SDK targets ES2023. The newest built-in it calls is `toSorted`, one of the copying array methods. So it runs on every supported Node, or Safari 16, Chrome 110, Firefox 115 and newer. The build checks the SDK source against the ES2023 library, so a newer built-in fails it.

ES2024 was rejected: bundlers still target Safari 16.4 to 17.3 by default. Those browsers broke after a send while the SDK called `Promise.withResolvers`.

A web app should list its browser targets, for example `"browserslist": ["baseline widely available"]`, instead of trusting a bundler default that may be older. The package declares no `engines` field: the bot gets its Node from the repository pin. The language level is the real requirement.

## Versioning

The repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). The versions start at 9000, above the old `1000.x` line of the same package, so they sort after it. The new API isn't a patch of the old one. A new package name was rejected: keeping the name keeps the install line of every integrator.

9000 isn't a stability claim: it only keeps the version order increasing. A future lower-numbered line would need deliberate dist-tag management. It also wouldn't satisfy a `^9000` range.

A breaking change takes the next major version. Consumers like NervDAO pin a version, so a major bump is their signal to check.

No API report is committed. API Extractor already rejects a forgotten export, so every type reachable from the entry point can be imported. A generated report would be one more file to refresh on every change, without telling anything the version doesn't.
