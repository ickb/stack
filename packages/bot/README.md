# iCKB bot

Currently the Bot is able to fully use only a single deposit worth of capital. More capital will not create issues, just it'll not be used effectively.

**Rule of thumb**: Initial bot funding capital should be between 125k CKB and 135k CKB.

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
pnpm run start;
```

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/bot) and it is released under the [MIT License](./LICENSE).