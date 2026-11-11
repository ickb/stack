# Withdrawal Timing

When the bot requests a withdrawal, how long it waits for the commit, what a restart costs.

## The window

The bot uses [`BOT_LOCK_UP`](../../src/dao.ts): it selects deposits whose claim is 20 to 60 minutes out, then sends while 15 minutes remain. Its selection window and broadcast reserve are in epochs; the minutes assume a nominal four-hour epoch.

A fresh tip read after signing refuses an expired request before broadcast, because committing after the claim can lock the deposit for another cycle. CKB has no transaction expiry that could enforce this after broadcast.

## The wait

The bot waits up to two minutes, so its journal can join a send to a commit. It rebuilds the next turn whether that wait succeeds or not. A rebuild can repair a dropped or replaceable request, not speed up one still pending. The timeout and the interval live in [`turn.ts`](../src/bot/turn.ts).

## The restart cost

A failed send exits. The ten-minute restart then dominates the time to rebuild. A request selected with its claim less than about 31 minutes out can no longer be requested again after a failure; the one-minute restart left room down to about 23. That deposit waits a cycle: the accepted cost of the restart cadence ([the loop](loop.md)).
