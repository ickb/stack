# Changing the Key

To move the bot to a new key, put the new key on the first line of its key file, keep the old key on a later line, then restart the unit. This writes a new random key above the old ones; a missing file stops it before the move:

```bash
KEY=~/.config/ickb-bot/testnet.key
(umask 077 && { printf '0x%s\n' "$(openssl rand -hex 32)"; cat "$KEY"; } > "$KEY.new" && mv "$KEY.new" "$KEY")
systemctl --user restart ickb-bot-testnet.service
```

Back up the new key as the [first one](deployment.md#the-key). Its address is in the next `bot.chain.preflight` line.

The process signs for every key in the file. The account read covers the locks of every key each turn:

- **Spending:** each transaction spends the plain CKB and iCKB cells of the other keys with those of the primary key. Its change goes to the primary lock as always. Receipts and matured withdrawals at the lock of another key are collected the same way.
- **A reason to send:** a liquid cell at any lock but the primary one is a reason to send on its own; cells already at the primary lock aren't. The next fundable turn moves them, up to the share of one transaction for each kind ([limits of one transaction](../../docs/transaction_limits.md)). Later turns move the rest. The rule covers anyone-can-pay cells of the primary key too, if it has any.
- **Fees:** the CKB of the primary key pays them, so another key holding only iCKB still moves.
- **Withdrawals in flight:** a withdrawal request still converting at the lock of another key stays there until it matures. Its collection then moves it.

An emptied key can stay in the file. Each of its locks costs one scan per turn that finds nothing. Its explorer page shows when the locks are empty. While the lock of another key holds cells, each transaction that spends them carries one more secp256k1 lock group: about 1.65M cycles for some 140 bytes. Once cycles set the weight of a transaction, miners and a full pool see a lower fee rate than the one planned, since the node admits it by size alone.

## Rejected: a unit per old key

A separate unit per old key, sending everything to the new key through a `BOT_DESTINATION` address, was rejected. It adds a unit and a setting per key. Its destination must own every output, change included. The old key must also pay its own fees, so an old key holding only iCKB, in cells with no capacity to spare, couldn't move at all.
