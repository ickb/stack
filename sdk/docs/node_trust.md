# Node Trust

Every node answer is untrusted: what the SDK checks, then what a lying node can still cost. The send adds its own checks, in [signing and broadcast](signing_and_broadcast.md).

## The verified client

Every node read in `readState` and in the checks of `commitTransaction` goes through a wrapper the SDK puts on the client it's given, so a consumer can't forget the checks.

The wrapper checks:

- every header against its own hash;
- a header read by number against the number asked for;
- every transaction read by hash against the hash of its body.

It serves a cell from that verified body, cache first. The history and the order scan read whole bodies the same way. A cache hit is hashed again, since a consumer cache doesn't have to key bodies by their hash.

Concurrent reads of one block header, or of one creating transaction, share a request. A wrapper lives for one state read or one send, so nothing it shares crosses a reorg into the next read. A shared read that fails fails that read as a whole; the next one asks again.

Completion, signing and the status reads go through the signer client unwrapped. That's on purpose:

- the send checks every cell completion valued before signing;
- witnesses and cell deps belong to the signer;
- a transaction status has nothing to be checked against.

## What a header is worth

The DAO rate in a header sets the interest a withdrawal collects, as well as the iCKB a deposit is worth. CCC fee completion values that interest through the signer client, which the SDK doesn't wrap, at whatever header the node names. So the send measures the fee from verified values. It refuses one above what completion planned.

The header beside a transaction or a cell is pinned only to the block the node names for it. But the chain values a transaction at the headers it names in its deps. So the send refuses an input valued outside them. It also proves which block committed a withdrawal request.

## The tip parent

The state read is anchored at the parent of the tip, which is bound two ways:

- **Age:** it can't trail the local clock by more than the policy margin less its broadcast reserve: five minutes for the bot, thirty for a wallet. That catches an honest node that has fallen behind. The bound is on the parent, not the tip, because a fresh tip a node invented can name any old block as its parent.
- **Chain:** completion names the parent as a header dep. So a header a node invented prices nothing the chain accepts.

The send deadline check reads the live tip, under the same age bound.

Why the parent, not the tip: a tip can still lose a one-block race. A transaction naming it is then refused after signing, as a testnet order was on 2026-10-30. Every fork recorded as an uncle over about a day of each chain, to that date, was one block deep. So a header further back would only add staleness.

## Pool and APY

`state.poolCkb` and `state.poolIckb` sum the pool deposits the node lists, each read from a verified body: a node can only leave deposits out. `state.apyPercent` reads the DAO rate of the live tip and its parent, both checked against their hashes and linked by the parent hash. A node can still invent a consistent pair, so the APY is for display: nothing plans or signs from it.

## The cache

The bot, the generator and the interface size their client caches with `CACHE_SIZES`. The CCC default cache keeps 128 blocks plus 256 transaction bodies: fewer than a pool spans in deposits, or a large book in order origins. So every read fetched most of them again. The larger cache holds 4,096 of each, filling only as far as needed. Cached entries are still checked.

The SDK exports the numbers rather than a ready cache, because the cache belongs to the whole app. One that shares the client for other reads adds its own needs on top, or picks smaller sizes where memory matters. A helper returning the cache was replaced for that. So was a helper taking the minimums of the app: needs that share a cache add up, so a maximum of two sizes undercounts. The array is frozen, since every importer shares it.

## History

`readHistory` reads the transaction index of the node, which nothing checks. A node can leave entries out, add records of transactions that never touched the account, or order them wrongly.

The transaction bodies and block headers behind the entries are read through the verified client, checked against their hashes. The amounts come from those bodies alone. So a lying node can't change what a real listed conversion did. It can hide one, misdate it, or list a transaction it invented whole, since a body that hashes right need not be on chain. The history is display only: nothing plans or signs from it.
