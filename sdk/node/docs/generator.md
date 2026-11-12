# Stimulus Generator

The generator draws one random action per turn from its own testnet account. Orders pile up across turns, so a single action already changes the book the bot sees.

```bash
export STIMULUS_CHAIN=testnet STIMULUS_PRIVATE_KEY_FILE=~/.config/ickb-bot/stimulus-testnet.key
export STIMULUS_RPC_URL=https://testnet.ckb.dev/,https://testnet.ckbapp.dev/
pnpm --filter ./sdk/node stimulus
```

It reads its variables like the bot ([runtime config](runtime_config.md)), but refuses any chain but testnet before it builds a signer. It signs for every key in its file, as the bot does. It spends the liquid cells of the other keys in whatever it sends, up to the share of one transaction.

## One turn

Each turn reads the account, then:

1. Draws a kind, a direction, an amount and, for an order, a fee ([the draw](#the-draw)).
2. Mints the order, or asks the SDK for the conversion. Either transaction also collects the fulfilled orders of the account. It cancels live orders the bot won't take: those the matcher of the bot would refuse to fill whole today in either direction. With five hundred own orders live, it stops minting (testnet hygiene, not safety) and only collects.
3. Skips a transaction the completer can't fund or fit in one transaction, as the bot does. The log names it as `skip.failure`. It also skips an amount the order format can't represent. When the drawn action is refused but anything is collectable (fulfilled or refused orders, receipts, ready withdrawals), it sends the collection alone.
4. Signs and sends, then follows the commit for up to two minutes, as the bot does. It exits `0` on a commit, a skip or a transaction still pending with no failure at two minutes, `1` on any failure, as soon as a step finds it.

## The draw

- **Kind:** `order` three times in four, otherwise `conversion`.
- **Direction:** weighted by the CKB value spendable on each side: the Maxes of one transaction, `ckbConvertible` less the reserve, `ickbConvertible`.
- **Amount:** the smallest positive one in one draw out of eight, the whole budget in another. The rest spread evenly across the decades from one CKB up, so dust, mid-size and whole-balance stimulus all recur.
- **Fee:** a numerator over `100000`, from `{0, 10, 100}` for a sell, `{10, 100}` for a buy, `10` twice as likely as `100`. A zero-fee buy is one the bot never takes.

Each knob pins one draw, leaving the rest random:

- `STIMULUS_KIND=order|conversion`
- `STIMULUS_DIRECTION=ckb-to-ickb|ickb-to-ckb`
- `STIMULUS_AMOUNT=<CKB or iCKB, up to eight decimals>|max`
- `STIMULUS_FEE=<numerator below 100000>`

A pinned amount is used as drawn, even past the budget: the refusal of the completer is then the evidence. `max` on a side with nothing to spend skips the draw as `nothing-to-spend`, as an unpinned amount does.

Collection follows the [collect rule of the SDK](../../src/order/fill.ts), shared with the interface. A zero-fee sell becomes profitable only once DAO growth covers the fill cost of the bot, so most are collected unfilled at the next turn. A second profitability rule in the generator could disagree with the bot. Dust and low-fee draws stay, because seeing the bot skip them is part of the test.

## The cadence

`RestartSec` sets the cadence: an hour in the unit. The longest normal gap of the bot is about twenty minutes, so every order gets a bot turn. A zero-fee sell gets an hour of DAO growth before the next turn collects it, if the bot still refuses it. On testnet, at about 33,000 shannons per kB with 2.1% a year, that fills a sell of about 450 CKB or more: 48% of the sell draws, against 42% at thirty minutes. The cost is at most 24 generator transactions a day. A one-minute cadence made 125 to 240 (2026-11-04 to 2026-11-08), when most turns skipped with their budget locked in live orders.

Named scenario planners and transaction batches added machinery without being needed for the pile-up of orders. Pool maturity and inventory still need their own preconditions ([what the journals should show](monitoring.md#what-the-journals-should-show)).

## Its log

Each turn writes one JSON line with `type` `stimulus.turn` and `timestamp`:

- **`identity`:** the chain, recommended address, primary lock and endpoint identities, logged as the bot logs them.
- **What it drew:** `balance`, `orders` (live, fulfilled and refused counts) and `draw`.
- **`outcome`:** `committed`, `unresolved`, `rejected`, `skipped` or `failed`.

`draw` stays the drawn action. `skip` says why it wasn't built, also when a collection replaces it. That collection is sent with `action.conversionKind` `collect-only`, or names in `collectSkip` why it wasn't built either.

A sent transaction carries `action` (the output indices of the minted order and master, or the conversion kind), `transactionShape`, `txFee` and `txHash`. Only `committed` proves it reached the chain. `unresolved` without an `error` is a transaction still pending two minutes after the send; with one, a read that failed or a send abandoned at its deadline. Join that hash and output index to `decision.match.matchedOrderOutPoints` of the bot.
