# iCKB Stack

iCKB Stack is the monorepo for the current TypeScript iCKB libraries and apps built on top of [CCC](https://github.com/ckb-devrel/ccc).

The Stack rewrite is in progress. The [rewrite overview](docs/stack-rewrite/README.md) explains the target architecture, completed foundations, remaining phases, and open design findings. The rest of this README describes the current repository.

## Transaction Completion Boundary

`IckbSdk.buildConversionTransaction(...)` returns a completed transaction: the SDK completes each candidate plan against the signer's committed cells and returns the first fundable one, so a caller only signs and sends. The lower-level builders (`buildBaseTransaction`, `request`, `collect`, and the package managers) still return partial transactions; a caller composing them calls `sdk.completeTransaction(...)` before sending.

Withdrawal requests built from public pool ready deposits may include `requiredLiveDeposits`. `@ickb/sdk` adds those cells as live `cell_dep` checks so a transaction fails if a protected pool anchor disappears before inclusion.

## Scan Page Size Boundary

Stack cell scans that feed account state, pool state, order books, or maturity estimates use a per-request page size. SDK state APIs expose it as `cellPageSize`; lower-level scan wrappers expose it as `pageSize` and pass it to CCC as `limit`.

## User Lock Assumption

Current stack flows assume user-owned cells are protected by locks whose signatures bind the whole transaction, such as standard `sighash` wallet flows. Passing a raw `ccc.Script` is only safe when that lock gives the same output and recipient binding. Delegated-signature or OTX-style locks are integration-specific and must account for the weak-lock boundary documented in the iCKB whitepaper and contracts audit.

## Workspace Map

Apps:

- `apps/node`: the bot, the testnet tester, and the mainnet rate sampler, three entrypoints in one Node workspace sharing chain preflight, config, and logging.
- `apps/interface`: Browser interface for CCC wallet connection, conversion previews, transaction completion, signing, sending, and confirmation.

Apps are private workspace runtimes and run from source under Node 22.19+ or Vite. The supported reusable API surface lives in the packages below. Stack package `build` scripts emit `dist/` for publishing reusable packages only; local development, tests, live supervisor runs, and bot deployments use TypeScript source directly.

Packages:

- `packages/sdk`: the one published package. `src/core` holds the iCKB protocol primitives, cells, and transaction builders; `src/dao` the Nervos DAO cell classification and deposit, request, and withdrawal helpers; `src/order` the UDT limit-order entities, matching, minting, and melting; `src/utils` the bounded paged scans and shared helpers; and the top level composes them into account state, conversion planning with completion, sending, and confirmation.
- `packages/testkit`: Private test helpers and fixtures for workspace tests.

## Dependencies

CCC packages are normal package dependencies resolved through `pnpm-workspace.yaml` catalog entries and `pnpm-lock.yaml`. From a plain checkout, run `pnpm install`; no local CCC fork, build step, or workspace alias is required.

`pnpm check` is the validation gate: the audit, the full `pnpm lint` (typecheck, format, duplication, knip, architecture, API surface, publish check, coverage, ESLint, Node script tests), and the interface build, all with `CI=true`. It runs against the installed dependencies; CI installs them from the pinned lockfile in a fresh checkout first.

## Live Testnet Validation

Validation is operator-driven. Each actor runs one turn as a process and exits with its outcome; the operator, a person or a model, reads the JSON on stdout and decides the next action. There is no launcher, supervisor, summary, or automated cadence.

The bot reads `BOT_CHAIN`, `BOT_RPC_URL`, and the key file named by `BOT_PRIVATE_KEY_FILE`; the tester reads the same three under `TESTER_`. Key files under the ignored `config/` directory hold one lowercase `0x` key each. The RPC URL is exclusive, with no CCC public fallbacks. Private keys are for signing only and never reach events, errors, or logs.

```bash
export BOT_CHAIN=testnet BOT_RPC_URL=https://testnet.ckb.dev/ BOT_PRIVATE_KEY_FILE=config/bot-testnet.key
export TESTER_CHAIN=testnet TESTER_RPC_URL=https://testnet.ckb.dev/ TESTER_PRIVATE_KEY_FILE=config/tester-testnet.key
mkdir -p log/bot
node apps/node/src/bot.ts >> log/bot/events.ndjson
TESTER_SCENARIO=auto node apps/node/src/tester.ts
```

Each turn identifies itself first: the bot's `bot.chain.preflight` event and the tester's `identity` field carry the recommended address, the primary lock, the credential-free RPC endpoint, and the chain preflight evidence. Fund that address. An unfunded turn stops before acting: the bot with `bot.decision.skipped` reason `capital_below_minimum` and its `deficit`, the tester with its low-capital error, both with exit code `2`; the turn's balances are in `bot.state.read` and the tester's `balance`.

To exercise the bot, run the tester once, then run a bot turn and look for the correlated `bot.transaction.committed` followed by a `bot.decision.skipped` with no market orders. Under systemd each actor's stream is its unit's journal; see `apps/node/README.md`.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and it is released under the [MIT License](./LICENSE).
