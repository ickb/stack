# iCKB bot

Currently the Bot tries to minimize the amount of iCKB holdings, actively looking to convert them to CKB. This is to maximize the CKB liquidity that the bot can offer in case of a iCKB to CKB liquidity crunch, such as [when the redemptions overcome the short term availability of mature deposits](https://talk.nervos.org/t/dis-ickb-dckb-rescuer-funding-proposal-non-coding-expenses/8369/14).

**Rule of thumb**: Initial bot funding capital should be at least 130k CKB.

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

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/bot) and it is released under the [MIT License](./LICENSE).