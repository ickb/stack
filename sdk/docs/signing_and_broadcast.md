# Signing and Broadcast

`signAndSendTransaction(signer, { tx, plannedFee, broadcastBefore? })` signs locally, checks the result, then sends it. It takes the build result whole, as `buildConversionTransaction` returns it, so passing it on can't drop the deadline. A hand-built `{ tx, plannedFee }` still leaves it out.

Nothing is sent unless every check below passes. It returns `{ ok: true, txHash }`, or one of three outcomes a caller has its own next step for: `not-signed`, `expired` and `maybe-sent`. A failed check throws: it's a defect, a node or signer answer that can't be trusted.

## Signing

CCC's `signTransaction` is `prepareTransaction` then `signOnlyTransaction`; the send calls the two itself. Only a rejected `signOnlyTransaction` is an outcome, `not-signed` with the rejection as `cause`: a user declining in the wallet, or the wallet failing to sign. Preparing reads nodes and services for the signer, so its failure throws like any read that can't answer.

## Inputs

Every input is checked before signing. Its creating transaction is read, client cache first. It's accepted only when its hash is the one the `OutPoint` names. So the output at that index is the real cell. A planned cell that differs from it in capacity, lock, type or data is refused. An input without its cell attached is valued from that output.

Why: the default lock signs each input as its `OutPoint` only. Without this check, a node understating the capacity of a plain cell, or an iCKB amount, would turn the difference into fee or a burn, on a transaction that passes every other check. It costs one `get_transaction` per creating transaction not already cached.

## The body

The signed transaction must keep the same ordered inputs, outputs and outputs data. Witnesses, `cellDeps` and `headerDeps` belong to the signer.

The fee check values the verified inputs. It values the interest of each phase-2 DAO input at the deposit and request headers the transaction names in its deps. CCC values that interest from headers it reads again, which a node can answer with another real block. The chain reads the deps, so an input valued at a header outside them is refused. In a withdrawal of several requests, a node could still swap which named request header values which input: see [request header proof](request_header_proof.md).

## The fee

The chain fee must not go past `plannedFee`, which is `tx.estimateFee(feeRate)` from completion, met exactly by the CCC fee completion. Completion computes it once and returns it beside the transaction, so no caller prices it again.

Why: completion valued phase-2 interest at whatever header the node named. A header that hashes right can still be one the chain doesn't use. A lower rate there shortens the change. Checking only the CCC maximum fee rate let that difference go to the miner, up to about 0.1 CKB per kB. Amounts are compared, not rates, so the signed size doesn't matter. Re-pricing through a verified client was rejected: it reads the same node answer CCC read, so it only catches a node that changes its answer between two reads.

The check also replaces the CCC maximum fee rate, which `sendTransactionNoCache` skips. CCC caps the sampled rate at that maximum, so a fee planned from the state read is within it, unless the caller passes its own `maxFeeRate`, which replaces that ceiling on purpose. The sampled rate is a node statistic with no proof: the bot caps it with `BOT_MAX_FEE_RATE`. A wallet shows the fee before the user signs.

## The deadline

A withdrawal plan carries `broadcastBefore`: the earliest chosen claim, less the policy reserve. After signing and the fee check, one fresh tip read returns `expired` for a plan the tip has reached, without sending it. It carries no epochs: the next step is a rebuild, which reads the tip again.

Why epochs: CKB has no transaction expiry. A request committed after its claim can lock the deposit for another cycle. That tip isn't a header dep, so a node can show a fresh tip from before the deadline and let an expired plan through. The cost is that extra cycle: time, not CKB, which is accepted. Checking the priced header plus the elapsed local time would close it, at the cost of estimating epochs from time.

## The hash

The local hash, `signed.hash()`, is the identity. No hash a node returns replaces it: checking it could only refuse after the node already has the transaction. A duplicate answer counts as accepted only when it names the local hash.

Every other send failure is unknown and returns `maybe-sent` with `txHash` and the failure as `cause`. So a caller watches that hash instead of sending again.

A callback that handed out the hash before the send was removed. It only let a caller record the hash while the send was in flight. The `maybe-sent` outcome already carries it for a send that never answers. So the interface records a pending hash once the send answers. A remount during the send shows the action held instead of a retry.

Rejected:

- returning the hash without the error, which loses the cause the bot journals when the node keeps no reject record;
- a separate sign and broadcast.

The send never marks the client cache.
