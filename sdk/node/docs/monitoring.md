# Monitoring

Neither program carries a notification channel: anything worth attention is a run of turns, which only the journal sees.

## What to alert on

A single `bot.turn.failed` is noise: a DNS or RPC failure ends the process, then the restarted one builds from committed state. Worth forwarding:

- **Silence:** no bot event for twenty minutes.
- **Failures:** a run of failed turns.

A watcher on the same host can't see silence, since it dies with the host. Check silence from another machine over SSH. A Telegram or ntfy URL carries the token, so put the destination in an environment file with mode `0600` next to the key. Let `curl` encode the message:

```bash
# From another host: the newest bot event must be under twenty minutes old.
last=$(ssh "$HOST" journalctl --user -u ickb-bot-testnet.service -o cat -n 50 | grep '^{' | tail -n 1 | jq -r '.timestamp // empty')
[ -n "$last" ] && [ $(( $(date +%s) - $(date -d "$last" +%s) )) -lt 1200 ] \
  || curl -sG --data-urlencode "text=bot silent since ${last:-unknown}" "$ALERT_URL" >/dev/null
```

## Why a unit keeps skipping or failing

Look at the last events and the exit status:

```bash
journalctl --user -u ickb-bot-testnet.service -o cat -n 2000 --no-pager | grep '^{' | jq -c 'select(.type == "bot.decision.skipped" or .type == "bot.turn.failed")'
systemctl --user show ickb-bot-testnet.service -p ActiveState -p Result -p ExecMainStatus
```

## What the journals should show

The reasons of the bot are lossy: any nonempty match is `matched`, whatever was rejected on the way. Some branches need pool or maturity state no order can create. So a missing reason means its precondition never occurred, not that the generator failed. Tally both journals, then read the table:

```bash
BOT=$(mktemp) && journalctl --user -u ickb-bot-testnet.service -o cat | grep '^{' > "$BOT"
STIMULUS=$(mktemp) && journalctl --user -u ickb-stimulus-testnet.service -o cat | grep '^{' > "$STIMULUS"
jq -r 'select(.decision) | .decision.match.reason' "$BOT" | sort | uniq -c
jq -r 'select(.decision) | "\(.decision.core.kind) \(.decision.rebalance.deposit // "-") \(.decision.rebalance.withdrawal.stress // "-")"' "$BOT" | sort | uniq -c
jq -r 'select(.type == "bot.decision.skipped") | .reason' "$BOT" | sort | uniq -c
jq -r 'select(.decision.match.reason == "matched") | "\(.decision.match.partialCount) \(.decision.match.candidates)"' "$BOT" | sort | uniq -c
jq -r '"\(.outcome) \(.draw.kind // "-") \(.draw.direction // "-") \(.skip.reason // "-") \(.collectSkip.reason // "-")"' "$STIMULUS" | sort | uniq -c
```

| Bot variant                            | Precondition                                                                              | Evidence                                                                     | Owner                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Profitable match, one or many partials | Payable orders above the ten-fee floor                                                    | `match.reason` `matched`, `partialCount`                                     | unattended                                                                               |
| Unprofitable or dust-only book         | Fee `0` orders only, or dust below ten fees; the generator collects them a turn later     | `match.reason` `no_gain`, `match.candidates` above zero                      | unattended                                                                               |
| Gains the balances can't pay           | Buyers with no iCKB to serve them, or sellers with no CKB                                 | `match.reason` `unfunded_gain`, `match.gains` above zero                     | expected: the bot refills by withdrawal or deposit; topping up only serves sooner        |
| Partial cap                            | Fifty-nine or more live eligible orders                                                   | `match.partialCount` `58` with orders left on the book                       | operator: stop the bot and lower `RestartSec` of the generator until the orders are live |
| Empty book                             | Nothing live                                                                              | `match.reason` `no_market_orders`                                            | unattended                                                                               |
| Deposit                                | Under 2,000 iCKB; or the ring segment of the tip thin, with two deposits of CKB spendable | `core.kind` `deposit`, `rebalance.deposit` `low_ickb` or `ring_coverage`     | operator: fund or drain the bot; wait for maturity                                       |
| Withdrawal requests                    | Over 120,000 iCKB with ready surplus deposits                                             | `core.kind` `withdraw`, `actions.withdrawalRequests`, `rebalance.withdrawal` | operator: fund the bot with iCKB; wait for maturity                                      |
| Anchors under stress                   | CKB in hand and in flight, reserve included, under the cost of one deposit                | `rebalance.withdrawal.stress` `true`                                         | operator: drain CKB from the bot                                                         |
| Nothing fundable                       | No core, match, or collection completes                                                   | skip `no_fundable_candidate`, `core.attempts`                                | operator: a thin bot                                                                     |
