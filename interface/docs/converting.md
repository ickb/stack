# Converting and collecting

## Dates

The app describes conversions by when funds return: direct deposits and withdrawals have a claim date, orders depend on a bot. One [estimated date](../../sdk/docs/pool_maturity_estimates.md) covers the converting funds of the wallet plus the new request. A position list or completed-history index would add protocol bookkeeping without another action the user needs here.

## Quotes and order price

Form quotes use `conversionQuote` in [`src/view/formState.ts`](../src/view/formState.ts), at the SDK [default order fee](../../sdk/src/order/conversion.ts). So every order from the app asks the same price, apart from a [dust order](balances.md#dust-orders). None can buy priority: a [bot fills by price](../../sdk/node/docs/matching.md), at equal price in an order of its choosing, only while it holds the other side. So no order is promised eventual service. An order the bot wouldn't take whole comes back with the next transaction ([collection](#collection)). The intent line says "when a bot fills it" for that reason.

The completed preview shows the actual plan: a standing order, alone or beside direct deposits or withdrawals. Every conversion mints one ([always an order](../../sdk/docs/transaction_completion.md#always-an-order)). Its rounded output can differ from the form quote. The SDK chooses the [first fundable direct-first plan](../../sdk/docs/transaction_completion.md#the-plan-walk), not the plan with the earliest estimated completion.

## Collection

Every transaction also collects fulfilled orders, receipts and matured withdrawals, within the SDK batch limits. Setting the amount to zero collects what's ready without requesting a new conversion.

The intent line of a collection says whether a withdrawal or order stays converting after it. The button reads the same either way. The "converting" word of the balance row alone went unnoticed when a receipt was collected while its sibling order was still open.

## Orders no bot would fill

Live orders join that collection when the current whole-fill profitability rule of the bot refuses them in both directions. The rule is judged at the fee rate the wallet picker chose:

- **Auto:** the sampled rate of the node.
- **Economy:** the 1000 floor.
- **Custom:** whatever the user typed.

A bot that caps its rate lower than the chosen one may still fill an order this rule collects. The user gets the funds back less the fee, so the app doesn't guess at the cap of any bot. A fee spike refuses a sell as it refuses a buy.

No age cutoff backs the rule: one would refund only a fillable order the bot has stopped filling. The bot is watched.

The SDK applies the rule when it projects the state, so the app and the generator can't disagree. It lives in [`isCollectable`](../../sdk/src/order/fill.ts). Neither cancels an ordinary live conversion just because the user signs again or its estimated date passes: an outage mustn't make collection silently cancel every waiting order.
