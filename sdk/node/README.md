# iCKB Node Actors

The bot that keeps iCKB liquid, plus two helpers to watch it work!

- **Bot:** `src/bot.ts` fills orders, collects ready funds and moves inventory between CKB and iCKB, one transaction per turn.
- **Generator:** `src/stimulus.ts` makes random testnet activity from its own account, so the bot always has orders to face.
- **Sampler:** `src/sampler.ts` samples mainnet headers to cross-check the rate chart of the interface.

The bot and the generator share preflight, configuration and logging in `src/shared/`. No entrypoint imports another.

## Run the bot

From the repository root, with the key file kept outside the checkout:

```bash
pnpm install
install -d -m 700 ~/.config/ickb-bot && (umask 077 && $EDITOR ~/.config/ickb-bot/testnet.key)
export BOT_CHAIN=testnet BOT_PRIVATE_KEY_FILE=~/.config/ickb-bot/testnet.key
export BOT_RPC_URL=https://testnet.ckb.dev/,https://testnet.ckbapp.dev/
pnpm --filter ./sdk/node bot
```

It runs from TypeScript source on the Node that `pnpm install` placed in `node_modules/node`. Stdout carries one JSON event per line. Stderr carries diagnostics.

## How the bot works

- **One turn, one transaction:** each turn reads committed state, builds at most one transaction, signs it, sends it, then checks for the commit two minutes later. The [bot policy](docs/policy.md) decides what goes in it.
- **Little spare iCKB:** the bot keeps its excess iCKB low, so more CKB is at hand when users redeem.
- **Restarts clean:** a turn starts every ten minutes. Any failure ends the process, as does an age of six hours, so systemd starts a fresh one ([the loop](docs/loop.md)).
- **Nodes aren't trusted:** the SDK checks every header and body it reads against its hash. A tip too far behind the host clock fails the turn.
- **Keys stay in a file:** a mode `0600` file holds the signing keys, one per line, the first one primary ([runtime config](docs/runtime_config.md)).
- **No second store:** the journal is the only record. A failed turn leaves nothing to clean up, since the next one reads the chain again.

## Read the output

Each line is one `bot.*` event. A process opens with one preflight. Each turn then shares one `runId` across its events: started, state read, then a skip, or a build, a send and a commit. A failure ends the turn at `bot.turn.failed` ([events](docs/events.md)).

Single failures are noise. Silence or a run of failures is worth an alert. Unfunded gains are normal: the bot refills by withdrawing pool deposits as they come up, or by depositing for iCKB, as on mainnet ([monitoring](docs/monitoring.md)).

## Deploy

Each network gets one hand-edited systemd user unit, running from a git checkout. The host must stay up: a deposit window the bot misses waits a full DAO cycle, about thirty days ([deployment](docs/deployment.md)).

## Docs

- [Bot policy](docs/policy.md): what one turn does, the thresholds, the reserve and the timing rules.
- [Runtime config](docs/runtime_config.md): the environment variables, the key file and the RPC list.
- [The loop](docs/loop.md): the cadence, the six-hour exit, the warm cache and the rejected designs.
- [Events](docs/events.md): every `bot.*` event, its fields and some `jq` queries.
- [Monitoring](docs/monitoring.md): what to alert on, what the journals should show.
- [Generator](docs/generator.md): how the testnet activity is drawn and logged.
- [Deployment](docs/deployment.md): systemd install, updates, host isolation.
- [Changing the key](docs/changing_the_key.md): moving the bot to a new key without a second unit.
