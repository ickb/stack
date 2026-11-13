# systemd Deployment

The actors run as the operator user under systemd 255 or later, from an ordinary git checkout with an absolute Node path. One hand-edited unit per network owns configuration. Git owns revisions.

This trades isolation per network user, along with atomic updates, for a procedure that stops the checkout to update it. A root installer, a release-directory swap or a template/drop-in hierarchy would add deployment concepts without changing that model.

## The host must stay up

The bot requests a deposit only while its claim is twenty to sixty minutes out ([`BOT_LOCK_UP`](../../src/dao.ts)). Every deposit whose window passes while the bot or its node is down waits a full cycle, about thirty days. The sellers it would have served wait with it. A suspended laptop, a reboot of forty minutes or a node outage that long costs exactly that. The availability of the node bounds the one of the bot.

A user unit can't order itself after the network target of the system. So the first turn after boot can fail on DNS. It retries ten minutes later, a quarter of a forty-minute deposit window.

## Install

The tracked examples `sdk/node/ickb-bot-testnet.service` and `sdk/node/ickb-stimulus-testnet.service` are the whole configuration for one network each. Copy one under a name per network, edit every path and the RPC URL, keep the rest:

```bash
pnpm install --frozen-lockfile
install -d -m 700 ~/.config/ickb-bot ~/.config/systemd/user
(set -C && umask 077 && printf '0x%s\n' "$(openssl rand -hex 32)" > ~/.config/ickb-bot/testnet.key)
cp sdk/node/ickb-bot-testnet.service ~/.config/systemd/user/
$EDITOR ~/.config/systemd/user/ickb-bot-testnet.service
systemd-analyze --user verify ~/.config/systemd/user/ickb-bot-testnet.service
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now ickb-bot-testnet.service
journalctl --user -u ickb-bot-testnet.service -f -o cat
```

Things the unit file needs:

- **Node path:** `ExecStart` needs the absolute path of the node binary, since the user manager never sees the shell PATH. Point it at `node_modules/node/bin/node` in the checkout, the version the lockfile pins, which `pnpm install` keeps current.
- **Percent signs:** a literal `%` in any value is written `%%`.
- **Linger:** it keeps the user manager running without a login session, so the unit survives logout and starts at boot.
- **Mainnet:** a mainnet bot unit is the same file with `mainnet` values, its own key file and `Environment=BOT_MAX_FEE_RATE=1000` ([the fee cap](runtime_config.md#the-fee-cap)). The generator refuses any chain but testnet.

Funding and indexer needs are in the [operating assumptions](operating_assumptions.md) of the policy.

### The key

The install writes a new random key straight into its file, never to the screen. `set -C` refuses to overwrite an existing one. To check the file, printing only how many well-formed keys it holds:

```bash
grep -cE '^0x[0-9a-f]{64}$' ~/.config/ickb-bot/testnet.key
```

Back the key up before funding it. A lost key file loses everything at its lock, and nothing here can recover it. For paper, copy it in eight groups of eight. `less` draws on the alternate screen by default, so quitting it leaves no key in the scrollback:

```bash
head -n1 ~/.config/ickb-bot/testnet.key | cut -c3- | fold -w8 | less
```

Then type it back from the paper. `read -s` keeps it off the screen and out of the history:

```bash
read -rsp 'Key from paper: ' typed; echo
typed="${typed//[[:space:]]/}"; typed="${typed,,}"
[ "0x$typed" = "$(head -n1 ~/.config/ickb-bot/testnet.key)" ] && echo match || echo MISMATCH
unset typed
```

A mismatch is usually a look-alike pair, such as `b` and `6`. Fund the address in the first `bot.chain.preflight` line of the journal. The bot logs it before reading any balance, so it shows on an empty account too.

## Operate

```bash
systemctl --user status ickb-bot-testnet.service
systemctl --user restart ickb-bot-testnet.service
```

To update, stop every unit that shares the checkout, move the checkout to the reviewed revision, run `pnpm install --frozen-lockfile`, then start them again. A turn must never see a half-updated tree. After editing a unit, run `systemd-analyze --user verify`, then `systemctl --user daemon-reload`, then restart that unit: a reload alone keeps the running process.

The unit sets `LimitCORE=0`, so crash diagnosis uses the journal rather than a core file. Journald owns event and stderr retention through its normal limits. Reading the journal history of a user without `sudo` needs persistent split journals. To see why a unit keeps skipping or failing, read its [last events](monitoring.md#why-a-unit-keeps-skipping-or-failing).

## Host isolation

A mode `0600` key file excludes other users, not other processes under the same UID. The operator sets the mode; the runtime doesn't check it. `LoadCredential` would copy the same readable file of the user without a new boundary. Local encryption without a separate key boundary would leave both on the same disk.

The intended mainnet boundary is a separate production VM with no agent running as the account that owns the key. Model-steered testnet work belongs on the testnet desktop. Export production journals over SSH for inspection. When one host must serve both, mainnet needs a separate OS account with its own user manager: otherwise a same-UID agent holds mainnet signing authority. A separate signing service would add a component and an IPC protocol where host and account isolation already supply the boundary.
