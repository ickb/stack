# Balances

## In wallet

CKB "in wallet" counts the capacity of both plain cells and iCKB cells. Counting only plain cells showed zero for accounts whose iCKB cells could fund the transaction. The figure matches liquid capacity, not an amount that can all be converted: change, an order master and fees still need CKB.

## Max

CKB Max uses the SDK `ckbConvertible`, which sets those aside. iCKB Max uses `ickbConvertible`. Both include collectable funds, up to what one transaction is offered. While there's no CKB to convert, testnet shows the faucet in place of CKB Max.

An iCKB amount past Max but within the balance fails as "More than one transaction can convert": only the share of one transaction binds there, and the next transactions merge the cells. Past CKB Max the reason keeps its own message, since that gap is mostly the cells and the fee every transaction pays.

## Rounding

Balances show two decimals, truncated so a figure never exceeds what the wallet holds. The accessible label keeps the exact value. Full precision made wide screens read like "400,333.11456155 in wallet".

Phones compact from 100,000 ("123.45K") to fit a third of the card. The constant `PHONE_COMPACT_FROM` in [`src/view/Form.tsx`](../src/view/Form.tsx) records the measurement.

## Order capacity

An order holds its own cell space beside the amount it converts: a 2,000 CKB order showed 2,295 CKB converting, then 295 CKB collectable. Nothing on screen said why.

The status of a preview that mints an order names that capacity (the SDK `orderOccupiedCapacity`). It also says collection returns it. The balance figures still count it, since the wallet holds it.

## Dust orders

For iCKB-to-CKB requests below the normal order threshold, the SDK can build a discounted dust order when it finds actionable terms. When none exist, it asks for a larger amount. A dust order can help recover the CKB capacity backing a small iCKB cell.

Its order fee is about ten times the fee rate in shannons (0.0001 CKB at the 1,000 floor), above the default fee. So the form quote overstates its output by that difference. The status doesn't name those terms: for the 0.003 iCKB remainder of a 100,000 iCKB withdrawal, naming them spent a sentence on a negligible part. The preview already shows the transaction fee.
