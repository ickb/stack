# iCKB/Bot

Currently the Bot tries to minimize the amount of iCKB holdings, actively looking to convert them to CKB. This is to maximize the CKB liquidity that the bot can offer in case of a iCKB to CKB liquidity crunch, such as [when the redemptions overcome the short term availability of mature deposits](https://talk.nervos.org/t/dis-ickb-dckb-rescuer-funding-proposal-non-coding-expenses/8369/14).

**Rules of thumb**:

- Distribute liquidity across multiple isolated bots (each holding only a fraction) to keep potential hack losses manageable.
- Each bot liquidity must be at least 130k CKB.

## Docs

The docs directory aims to host comprehensive documentation outlining the inner workings of the iCKB Fulfillment Bot. As a living document, it will be continuously updated to reflect the Bot’s evolution and ongoing improvements:

- [iCKB Deposit Pool Rebalancing Algorithm](pool_rebalancing.md)
- [iCKB Deposit Pool Snapshot Encoding](pool_snapshot.md)

## Run the limit order fulfillment bot on testnet

1. Download this repo in a folder of your choice:  

```bash
git clone https://github.com/ickb/bot.git
```

2. Enter into the repo folder:

```bash
cd bot
```

3. Install dependencies:

```bash
pnpm install
```

4. Build project:

```bash
pnpm build
```

5. Define a `env/testnet/.env` file, for example:

```
CHAIN=testnet
BOT_PRIVATE_KEY=0x-YOUR-SECP256K1-BLAKE160-PRIVATE-KEY
BOT_SLEEP_INTERVAL=60
```

Optionally the property `RPC_URL` can also be specified:

```
RPC_URL=http://127.0.0.1:8114/
```

6. Start matching user limit orders:

```bash
export CHAIN=testnet;
pnpm run forcestart;
```

## Questions

For questions or comments, please join the discussion via [GitHub Issues](https://github.com/ickb/bot/issues), the [Nervos Nation iCKB channel](https://t.me/NervosNation/307406/378182), or the [Nervos Talk thread](https://talk.nervos.org/t/dis-ickb-dckb-rescuer-funding-proposal-non-coding-expenses/8369).


## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/bot) and it is released under the [MIT License](./LICENSE).