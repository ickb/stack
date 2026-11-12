# Withdrawal Timing

When the bot requests a withdrawal, when it checks for the commit, what a restart costs.

## The window

The bot uses [`BOT_LOCK_UP`](../../src/dao.ts): it selects deposits whose claim is 20 to 60 minutes out, then sends while 15 minutes remain. Its selection window and broadcast reserve are in epochs; the minutes assume a nominal four-hour epoch.

A fresh tip read after signing refuses an expired request before broadcast, because committing after the claim can lock the deposit for another cycle. CKB has no transaction expiry that could enforce this after broadcast.

## The step after the send

Two minutes after the send, the bot takes one more step of the commit, so its journal can join a send to a commit. Two minutes covers every commit the testnet bot journalled from 15 October to 11 November 2026: 526 commits, 89 s at most. A transaction still pending with no failure ends the turn as `unresolved`; any failure exits. Either way the next turn rebuilds from committed state. A rebuild can repair a dropped request, or replace one still pending when it pays enough more. The delay lives in [`commit.ts`](../src/shared/commit.ts).

## The restart cost

A failure exits at the step, two minutes after the send. The ten-minute restart then dominates the time to rebuild: the next turn starts about 12 minutes after the send. Selection needs the claim at least 20 minutes out, so a request selected with its claim less than about 32 minutes out can no longer be requested again after a failure; the one-minute restart left room down to about 23. An `unresolved` turn ends without exiting, so the next turn starts ten minutes after it started, and the room reaches down to about 30. A deposit past that line waits a cycle: the accepted cost of the restart cadence ([the loop](loop.md)).
