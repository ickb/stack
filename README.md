# iCKB Stack

iCKB Stack is the TypeScript SDK, liquidity bot and browser interface for iCKB, built on [CCC](https://github.com/ckb-devrel/ccc).

## Where to start

- [SDK](sdk/README.md): read account state, build a funded conversion, sign, send and wait.
- [Node actors](sdk/node/README.md): run the bot, testnet stimulus generator or rate sampler.
- [Bot policy](sdk/node/docs/policy.md): matching, rebalancing, funding and their tradeoffs.
- [Interface](interface/README.md): run the app and understand its wallet and conversion model.
- [Maturity estimates](sdk/docs/pool_maturity_estimates.md): how the interface estimates when funds return.
- [Test kit](testkit/README.md) and [scripts](scripts/README.md): test helpers and repository tooling.
- [Working agreement](AGENTS.md): how to change and validate this tree.

Design rationale lives with the feature it explains: a reason comment for a branch or constant, or a section in its owning documentation for a choice spanning several functions. Follow the links above for both behavior and the reasons behind it.

## Workspace boundaries

`sdk/` is the only published package, `@ickb/sdk`. It has one public entry point and depends at runtime only on `@ckb-ccc/core`. It contains no Node built-ins and never imports `sdk/node`, so integrators can use it in the browser.

`sdk/node/`, `interface/` and `testkit/` are private workspaces. The three Node entrypoints share preflight, configuration and logging under `sdk/node/src/shared/`; they never import each other. Development, tests and bot deployments run from TypeScript source. The SDK's build emits `dist/` for publishing, not for local workspace execution.

The former library boundaries separated concepts rather than independent consumer contracts. One package removes the cost of maintaining several entry points and releases; its internal layering is a convention rather than a second dependency graph. There are no `advanced` or `internal` public entry points. The [SDK layout](sdk/README.md#layout) follows the on-chain scripts and the conversion workflow.

### User locks

Stack assumes user-owned cells have [locks whose signatures bind the whole transaction](https://github.com/ickb/contracts/blob/master/ICKB-Audit-Report.md#authorization-boundary), as standard sighash wallet flows do. An output lock does not execute when the output is created, so it cannot itself protect the recipient of that newly created output. Passing a raw `ccc.Script` is safe only when its lock provides the same input, output and recipient binding. Delegated-signature and OTX-style integrations must establish that separately.

## Dependencies and checks

Use Node 22.19 or later and the pinned pnpm 12.4.2. From a plain checkout:

```bash
pnpm install --frozen-lockfile
CI=true pnpm check
```

CCC is an ordinary dependency resolved through the catalog in `pnpm-workspace.yaml` and the lockfile. No local fork, build step or workspace alias is required. The catalog range is also what the published SDK gives integrators, so an exact catalog pin would constrain them too.

The lockfile holds the CCC 1.23.0 set. CCC 1.23 made `mol.union` dynamic-size, so the order master pointer uses `mol.fixedUnion`, whose two variants are the same 36 bytes. The gate exercises core and the SDK paths; connector changes are only exercised by live wallet testing, so a CCC update that moves the connector is followed by one.

TypeScript stays on 6. The 7.x package ships the native compiler only, without the JavaScript compiler API that typescript-eslint and `scripts/tooling/dead-members.ts` use, and typescript-eslint declares `typescript <6.1.0`. Type checking already runs on the native preview.

pnpm 12 supplies the trusted-publishing support the previous pin lacked. Its lockfile format is not backward-compatible with pnpm 10. The seven-day release age gives newly published dependencies time to be scrutinized; build-script permissions and advisory exceptions live beside their entries in [pnpm-workspace.yaml](pnpm-workspace.yaml).

`pnpm check` runs the audit, full lint suite and interface build against installed dependencies. CI first installs from the pinned lockfile, then runs the same gate on the declared Node floor. [Tooling](scripts/README.md#what-the-gate-enforces) explains the checks worth maintaining.

## Releases

A push to the default branch releases a package only when its version differs from the previous commit. The reviewed version change is the release decision:

- A change to `sdk/package.json` publishes `@ickb/sdk` to npm through trusted publishing, with provenance and no registry token in the workflow.
- A change to `interface/package.json` deploys the bundle that the check job built to GitHub Pages at `ickb.org`.

Both jobs require the gate to pass. Other merges release nothing. This assumes each reviewed change lands as a squash commit, so comparing with the previous commit covers it. Tags, a manual trigger or a second confirmation environment would add another release step for the same maintainer without another reviewer. A mistaken publish still consumes a version number and needs a bump.

The rewrite's versioned packages start at `9000.0.0`, above the old `@ickb/sdk` line at `1000.0.82`. The new API is not a patch of the old one, and keeping the package name avoids changing integrators' install lines. The high version preserves increasing version order; it is not a stability claim. A future lower-numbered line would need deliberate dist-tag management and would not satisfy a consumer's `^9000` range.

### First release setup

The maintainer must configure the external services before the release merge:

1. Register the npm trusted publisher for `@ickb/sdk`: organization `ickb`, repository `stack`, workflow `check.yaml`, no environment. Configure the package to require two-factor authentication and disallow tokens.
2. Enable GitHub Pages with GitHub Actions as its source. Move the `ickb.org` domain from `ickb/legacy-lumos-interface` to this repository, then archive the old repository after the new site is live.

Whether to deprecate the old `1000.x` SDK line and its companion packages remains optional. The [workflow](.github/workflows/check.yaml) owns the release mechanics; the [interface README](interface/README.md#deployment) owns the site setup.

## Live testnet validation

Each actor runs one turn and prints JSON to stdout. The operator reads the outcome and decides the next action; systemd supplies continuous cadence when wanted. See [runtime configuration and deployment](sdk/node/README.md) for the units and key-file setup.

To exercise matching, run a stimulus turn, then a bot turn. Correlate the generator's committed order outpoints with the bot's matched orders and committed transaction; a generator draw can also be skipped or produce an order the bot cannot profitably fill. The [journal guide](sdk/node/README.md#what-the-journals-should-show) names the preconditions for each observable case.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and released under the [MIT License](LICENSE).
