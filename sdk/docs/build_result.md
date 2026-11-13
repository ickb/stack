# What a Build Returns

What `buildConversionTransaction` hands back, which lock owns its outputs, what an amount of zero does. How it picks the plan is in [building a conversion](transaction_completion.md).

## The result

A built conversion carries:

- `tx`: the completed transaction, funded from the cells of its state read. It never looks for more inputs while trying candidates.
- `plannedFee`: the fee completion priced, the limit the [send](signing_and_broadcast.md) refuses to exceed.
- `estimatedMaturity`: when this conversion alone is collectable, from the tip: its direct claims plus its order estimate, or the tip for a collection.
- `conversionKind`: `order`, `direct-plus-order`, or `collect-only` for a collection.
- `orderOccupiedCapacity`: the CKB the minted order and master cells take beyond the amount, which collecting the order returns. Zero for a collection.
- `broadcastBefore`: the deadline to send it by when it requests withdrawals, else undefined.

Every field is present on every result: one with nothing to say holds zero or undefined.

Pass the whole result to `commitTransaction`, so the deadline can't get lost on the way.

## Who owns the outputs

Every cell it creates for the user, the conversion outputs plus the change, belongs to `state.changeLock`. That's the recommended lock of the signer, read once with the state: the build and completion take it from there rather than asking the signer again. Max was sized for the cells of that lock, so it still holds. A recommendation that changes between the read and the build can't send the outputs of one transaction to one lock, its change to another.

The stack assumes every user-owned cell has a [lock whose signature binds the whole transaction](https://github.com/ickb/contracts/blob/master/ICKB-Audit-Report.md#authorization-boundary), as standard sighash wallets do. An output lock doesn't run when the output is created, so it can't protect the recipient of a new output. A raw `ccc.Script` is safe only when its lock gives the same input, output and recipient binding: a delegated-signature or OTX-style integration needs its own check.

A destination lock chosen by the caller was removed. The change plus up to 1,000 swept cells went with it, so a conversion "sent to a friend" moved the own funds of the user too. Its one use, a send-everything for key-only wallets without an xUDT transfer screen, didn't justify that. Rejected: a destination only at amount zero, combined signers or a transfer built by the interface. Those wallets lose that exit in the stack interface.

## Composing with other actions

The build takes no cells from the caller: it starts from an empty transaction. So an app composes a conversion with its own actions in separate transactions, each committed before the next is built. A conversion yields nothing spendable in its own transaction anyway: a deposit gives a receipt for the next one, an order waits for its fill, a withdrawal for its claim. Using what it yields takes three transactions: the conversion, the collection, the use.

Rejected:

- **Caller inputs:** every plan would have to leave room for them in the [input shares](transaction_limits.md#shares-of-the-inputs), which add up to exactly the 2,048 inputs the iCKB xUDT script allows. Completion would price the fee for the witnesses of one signer only. A contended input of another protocol would get the whole conversion rejected. Only a lock owned by a script that must spend a companion cell in every transaction needs them.
- **Caller outputs only:** completion already funds the iCKB and the capacity of every output, so this would merge the collection with the use. It saves one transaction without unblocking anything. Max would stop holding. A `rejected` or `expired` conversion would also cancel the action of the app.

The cost is one more transaction to use what a conversion yields. Reopen when an app is blocked, not merely slowed.

## Amount zero

An amount of zero builds the collection alone. The projection sets `state.hasCollectable` when there's anything to collect (an available order, a receipt or a ready withdrawal). The interface, the generator and the bot read that one field.

With nothing to collect the build throws: a transaction that would only compact the account isn't worth its fee. The caller can tell beforehand. A negative amount throws too. So does a direction other than the two, even at amount zero, since a typo from a plain-JS caller would otherwise read as iCKB to CKB.

The failure values left:

- `insufficient-ckb`;
- `insufficient-ickb`;
- `amount-too-small` with its `minimum`;
- `insufficient-capacity` from completion, with the CCC capacity error as its `cause`.
