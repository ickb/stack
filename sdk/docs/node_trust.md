# Node Trust

Every node answer is untrusted. This page lists what the SDK checks and what a lying node can still cost. The send adds its own checks, in [signing and broadcast](signing_and_broadcast.md).

## The verified client

Every node read in `getL1AccountState` and `signAndSendTransaction` goes through a wrapper the SDK puts on the client it's given. So a consumer passes a plain client and can't forget the checks.

The wrapper checks:

- every header against its own hash;
- a header read by number against the number asked for;
- every transaction read by hash against the hash of its body.

It serves a cell from that verified body, cache first. A cache hit is hashed again, since a consumer cache doesn't have to key bodies by their hash.

Completion and signing read through the signer client, `waitTransaction` through the plain one. That's on purpose:

- the send checks every cell completion valued before signing;
- witnesses and cell deps belong to the signer;
- a transaction status has nothing to be checked against.

## What a header is worth

The DAO rate in a header sets the interest a withdrawal collects and the iCKB a deposit is worth. CCC fee completion values that interest through the signer client, which the SDK doesn't wrap, at whatever header the node names. So the send measures the fee from verified values and refuses one above what completion planned.

The header beside a transaction or a cell is pinned only to the block the node names for it. But the chain values a transaction at the headers it names in its deps. So the send refuses an input valued outside them. It also proves which block committed a withdrawal request.

## The tip parent

The state read is anchored at the parent of the tip, which is bound two ways:

- **Age:** it can't trail the local clock by more than the policy margin less its broadcast reserve: five minutes for the bot, thirty for a wallet. That catches an honest node that has fallen behind. The bound is on the parent, not the tip, because a fresh tip a node invented can name any old block as its parent.
- **Chain:** completion names the parent as a header dep. So a header a node invented prices nothing the chain accepts.

The send deadline check reads the live tip, under the same age bound.

Why the parent and not the tip: a tip can still lose a one-block race. A transaction naming it is then refused after signing, as a testnet order was on 2026-10-30. Every fork recorded as an uncle over about a day of each chain, to that date, was one block deep. So a header further back would only add staleness.

## The cache

The bot, the generator and the interface size their client caches with `CACHE_SIZES`. The CCC default cache keeps 128 blocks and 256 transaction bodies, fewer than a pool spans in deposits or a large book in order origins, so every read fetched most of them again. The larger cache holds 4,096 of each and fills only as far as needed. A cached header or body is still checked.

The SDK exports the numbers rather than a ready cache, because the cache belongs to the whole app: one that shares the client for other reads adds its own needs on top, or picks smaller sizes where memory matters. A helper returning the cache was replaced for that, and so was a helper taking the app's minimums: needs that share a cache add up, so a maximum of two sizes undercounts. The array is frozen, since every importer shares it.
