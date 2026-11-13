# The Bot Loop

One process connects once, then runs a turn every ten minutes, measured from the start of the previous turn. It stops when a turn fails or when the process is six hours old:

- **A failure:** exits `1`.
- **Six hours:** exits `0` right after a turn, so a send is never cut short.
- **Either way:** the unit sets `Restart=always`, so systemd starts a clean process after `RestartSec`, ten minutes in the unit. The fresh process also picks up an updated checkout. `on-failure` would leave the bot stopped after the clean exit.

A turn never holds. An underfunded account skips turn after turn until it's funded.

## Why ten minutes

Ten minutes leaves four turns in each forty-minute deposit window ([`BOT_LOCK_UP`](../../src/dao.ts)). An order then waits five minutes on average for a match. Users converting enough to wait for deposits already wait hours.

## The warm cache

The process keeps the CCC cache across turns. A warm turn still rescans the cells and reads the tip and fee rate, but it takes headers, origins and input bodies from the cache. The verified reads of the SDK take headers checked by hash. Cells come from transaction bodies that hash to their key. So a wrong cache entry can only refuse or skip.

One case remains. A header one endpoint invented under its own hash passes the hash check. The bot reads it again every turn, which keeps it cached. It can make the bot skip a ready withdrawal until the process ends, six hours at most. That's the price of a warm cache. Before the loop, it lasted one turn.

## Why six hours

A process that never fails keeps whatever no failure clears: a fallback endpoint it stays on while that node lags, a cached invented header, or a node whose indexer stopped, which only hides new orders. Six hours bounds that for four cold turns a day. Over a day, six hours cut the worst stall to a quarter for three more cold turns. A liveness review traced these restart cycles, which added the exit.

The unit sets `RuntimeMaxSec=7h`. It only backstops a turn that never ends, such as a node paging forever. A healthy process exits well before it. The accepted cost: a stall of up to seven hours. The restart then reshuffles the endpoint list.

## What it replaced

The loop replaced one process per turn, restarted every minute. Each one reloaded the code, about 0.75 s of a 1.3 s turn of CPU. Each one fetched every header and origin again: 669 calls on a cold testnet turn, measured 2026-10-29.

Rejected with it:

- **Looping on after a failure:** it keeps whatever state the failure left, then delays updates.
- **A timer per turn:** every CCC request already times out.
- **A random interval:** it lengthens the worst wait, while a competing matcher can watch every block anyway.
- **A cache file:** the memory of the loop makes it unnecessary.
- **An interval setting:** tried, then dropped. A faster bot buys little over a five-minute average wait. It loads the public nodes more. It keeps its cadence after a failure only if the operator also matches `RestartSec`.
