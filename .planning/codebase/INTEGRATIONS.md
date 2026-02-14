# External Integrations

**Analysis Date:** 2026-02-14

## APIs & External Services

### CKB Blockchain RPC (Primary Integration)

All interaction with the Nervos CKB Layer 1 blockchain happens via JSON-RPC 2.0. This is the single external service the project depends on.

**New CCC-based clients:**
- `ccc.ClientPublicTestnet()` - Public CKB testnet RPC endpoint
  - Used in: `apps/faucet/src/index.ts`, `apps/interface/src/main.tsx`
- `ccc.ClientPublicMainnet()` - Public CKB mainnet RPC endpoint
  - Used in: `apps/sampler/src/index.ts`, `apps/interface/src/main.tsx`
- Custom RPC URL supported via env var in bot

**Legacy Lumos-based clients (DEPRECATED):**
- `chainConfigFrom(CHAIN, RPC_URL, true, getIckbScriptConfigs)` - Configures Lumos RPC client
  - Used in: `apps/bot/src/index.ts`, `apps/interface/src/main.tsx`
- Public endpoints used: `https://testnet.ckb.dev/`, `https://mainnet.ckb.dev/`
- `rpc.getCellsByLock()`, `rpc.getTransaction()`, `rpc.getHeaderByNumber()`, `rpc.sendTransaction()` - Direct Lumos RPC calls in `apps/bot/src/index.ts`
- `rpc.createBatchRequest()` - Batch RPC requests for efficiency in `apps/bot/src/index.ts`

**CCC Client RPC methods used by new packages:**
- `client.findCells()` / `client.findCellsOnChain()` - Cell queries with script/type filters
  - Used in: `packages/utils/src/capacity.ts`, `packages/utils/src/udt.ts`, `packages/dao/src/dao.ts`, `packages/order/src/order.ts`, `packages/core/src/logic.ts`, `packages/core/src/owned_owner.ts`
- `client.getTipHeader()` - Get latest block header
  - Used in: `packages/sdk/src/sdk.ts`, `packages/dao/src/dao.ts`, `packages/core/src/owned_owner.ts`
- `client.getHeaderByNumber()` / `client.getHeaderByHash()` - Get block headers
  - Used in: `packages/utils/src/utils.ts`, `apps/sampler/src/index.ts`
- `client.getHeaderByNumberNoCache()` - Uncached header fetch
  - Used in: `apps/faucet/src/index.ts`
- `client.getTransactionWithHeader()` - Get transaction with its block header
  - Used in: `packages/utils/src/utils.ts`
- `client.getCell()` - Get individual cell by outpoint
  - Used in: `packages/order/src/order.ts`
- `client.getKnownScript()` - Get well-known scripts (NervosDAO)
  - Used in: `packages/utils/src/transaction.ts`
- `client.getFeeRate()` - Get current fee rate
  - Used in: `packages/sdk/src/sdk.ts`
- `signer.sendTransaction()` - Submit signed transactions
  - Used in: `apps/faucet/src/index.ts`, `apps/interface/src/Connector.tsx`

### CKB Public RPC Endpoints

**Testnet:**
- URL: `https://testnet.ckb.dev/`
- Used by: `apps/interface/src/main.tsx`, `apps/bot` (configurable)

**Mainnet:**
- URL: `https://mainnet.ckb.dev/`
- Used by: `apps/interface/src/main.tsx`, `apps/bot` (configurable)

**Custom:**
- Configurable via `RPC_URL` env var in `apps/bot`
- CCC public clients wrap official public endpoints by default

### Nervos Explorer (Links Only)

- Used for user-facing links in `apps/interface`
- Pattern: `https://[testnet.]explorer.nervos.org/address/{address}`
- No API integration, just URL construction

## Data Storage

**Databases:**
- None. All state is read directly from the CKB L1 blockchain via RPC queries. There is no database.

**File Storage:**
- Local filesystem only. No cloud storage.
- `apps/bot`: Logs to `log_${CHAIN}_$(date +%F_%H-%M-%S).json` via stdout pipe to `tee`
- `apps/sampler`: Outputs CSV to `rate.csv` via stdout pipe to `tee`

**Caching:**
- CCC Client Cache (in-memory): CCC caches block headers and cell data internally. This is the primary cache mechanism for the new packages.
- SmartTransaction headers cache: `packages/utils/src/transaction.ts` maintains a `Map<string, ccc.ClientBlockHeader>` for header lookups during transaction building. NOTE: SmartTransaction's header caching was the abandoned concept; CCC's built-in Client Cache is the replacement.
- TanStack React Query (in-memory, client-side): `apps/interface` uses React Query for frontend state caching
- Lumos in-memory caching: `apps/bot/src/index.ts` maintains `_knownHeaders` and `_knownTxsOutputs` maps for cross-iteration caching

## Authentication & Identity

**Wallet Signing (CCC-based):**
- `ccc.SignerCkbPrivateKey` - Private key signer for programmatic signing
  - Used in: `apps/faucet/src/index.ts` (generates random ephemeral keys)
- JoyId Signer - Browser wallet integration
  - Used in: `apps/interface/src/main.tsx` via `JoyId.getJoyIdSigners()`
  - CCC's `@ckb-ccc/ccc` package provides wallet connector framework
- `signer.connect()`, `signer.isConnected()`, `signer.getRecommendedAddress()`, `signer.getAddressObjs()` - Wallet connection flow
  - Used in: `apps/interface/src/Connector.tsx`
- `signer.prepareTransaction()`, `signer.sendTransaction()` - Transaction signing and submission
  - Used in: `apps/interface/src/Connector.tsx`

**Legacy Signing (Lumos-based, DEPRECATED):**
- secp256k1_blake160 signing via `@ckb-lumos/hd`
  - Used in: `apps/bot/src/index.ts` - `key.privateToPublic()`, `key.signRecoverable()`
  - `prepareSigningEntries()` + `sealTransaction()` from `@ckb-lumos/helpers`

**Key Management:**
- `BOT_PRIVATE_KEY` env var - Bot's signing private key (`apps/bot`)
- Ephemeral keys - `apps/faucet` generates random 32-byte keys via `crypto.getRandomValues()`
- Browser wallets - `apps/interface` delegates to connected wallet (JoyId)
- No centralized key storage

## Smart Contracts (On-Chain Scripts)

The project interacts with several on-chain CKB scripts defined in `packages/sdk/src/constants.ts`:

**NervosDAO:**
- Code hash: `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e`
- Hash type: `type`
- Purpose: Deposit/withdraw CKB with interest (Nervos DAO)
- Managed by: `DaoManager` in `packages/dao/src/dao.ts`

**iCKB UDT (User Defined Token):**
- Code hash: `0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95`
- Hash type: `data1`
- Purpose: The iCKB token type script
- Managed by: `IckbUdtManager` in `packages/core/src/udt.ts`

**iCKB Logic:**
- Code hash: `0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3`
- Hash type: `data1`
- Purpose: Core iCKB deposit/receipt logic
- Managed by: `LogicManager` in `packages/core/src/logic.ts`

**Owned Owner:**
- Code hash: `0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0`
- Hash type: `data1`
- Purpose: Withdrawal ownership tracking
- Managed by: `OwnedOwnerManager` in `packages/core/src/owned_owner.ts`

**Order (Limit Order):**
- Code hash: `0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a`
- Hash type: `data1`
- Purpose: On-chain limit orders for CKB/iCKB exchange
- Managed by: `OrderManager` in `packages/order/src/order.ts`

**Deployment Groups (Cell Dependencies):**
- Mainnet dep group: TX `0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed165` index 0
- Testnet dep group: TX `0xf7ece4fb33d8378344cab11fcd6a4c6f382fd4207ac921cf5821f30712dcd311` index 0
- Known bot scripts: one mainnet bot, one testnet bot (lock scripts in `packages/sdk/src/constants.ts`)

**Network configuration:** `IckbSdk.from("mainnet" | "testnet")` in `packages/sdk/src/sdk.ts` selects the appropriate script hashes and dep groups.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, Rollbar, or similar error tracking service.

**Logging:**
- JSON structured logs to stdout
  - `apps/bot/src/index.ts`: Logs `{ startTime, balance, ratio, actions, txFee, txHash, error, ElapsedSeconds }` each iteration
  - `apps/faucet/src/index.ts`: Logs `{ startTime, balance, error, txHash, elapsedSeconds }` each iteration
  - `apps/sampler/src/index.ts`: Outputs CSV rows `BlockNumber, Date, Value, Note`
- No log aggregation service

**Metrics:**
- No metrics service. Bot logs balance and transaction data for manual monitoring.

## CI/CD & Deployment

**Hosting:**
- Self-hosted / not specified. No deployment configuration in the repo.
- `apps/interface` produces static build in `apps/interface/dist/` for deployment to any static host
- `apps/interface` has its own `.github/workflows/` directory (likely GitHub Pages deployment, separate repo origin)

**CI Pipeline:**
- Scripts available: `pnpm test:ci`, `pnpm build:all`, `pnpm lint`
- `@changesets/changelog-github` suggests GitHub Actions integration for releases

**Publishing:**
- `pnpm change` - Create changeset
- `pnpm version` - Apply changeset versions
- `pnpm publish` - Publish all packages to npm (`pnpm publish -r`)

## Environment Configuration

**Required env vars by app:**

| App | Variable | Required | Description |
|-----|----------|----------|-------------|
| `apps/bot` | `CHAIN` | Yes | Network: "mainnet", "testnet", "devnet" |
| `apps/bot` | `RPC_URL` | No | Custom RPC endpoint (overrides default) |
| `apps/bot` | `BOT_PRIVATE_KEY` | Yes | Hex-encoded private key for signing |
| `apps/bot` | `BOT_SLEEP_INTERVAL` | Yes | Polling interval in seconds (min 1) |
| `apps/faucet` | `ADDRESS` | Yes | Target CKB address for fund transfer |
| `apps/tester` | `CHAIN` | Yes | Network identifier |

**Env file locations:**
- `apps/bot/env/devnet/.env` - Bot devnet config (exists, not read)
- `apps/tester/env/devnet/.env` - Tester devnet config (exists, not read)
- Loading mechanism: Node.js `--env-file=env/${CHAIN}/.env` flag in start scripts

## Webhooks & Callbacks

**Incoming:**
- None. No HTTP servers or webhook endpoints.

**Outgoing:**
- None. All communication is blockchain RPC calls.

## CCC Upstream Dependency Details

CCC (`@ckb-ccc/core`) is the most critical external dependency. Key capabilities used:

- **Client abstraction:** `ccc.Client`, `ccc.ClientPublicTestnet`, `ccc.ClientPublicMainnet` for blockchain access
- **Transaction building:** `ccc.Transaction`, `ccc.CellInput`, `ccc.CellOutput`, `ccc.CellDep`, `ccc.WitnessArgs`
- **Script handling:** `ccc.Script`, `ccc.KnownScript.NervosDao`, `ccc.Address`
- **Signing:** `ccc.Signer`, `ccc.SignerCkbPrivateKey`
- **Molecule codec:** `mol.Uint64LE`, `mol.Uint128LE`, `mol.Codec`, `mol.Entity` for on-chain data serialization
- **Numeric types:** `ccc.Num`, `ccc.FixedPoint`, `ccc.Hex`, `ccc.fixedPointFrom()`, `ccc.fixedPointToString()`
- **DAO calculations:** `ccc.calcDaoProfit()`, `ccc.calcDaoClaimEpoch()`
- **UDT support:** `ccc.udtBalanceFrom()` (merged upstream from maintainer's PR)
- **Epoch support:** `ccc.Epoch`, `ccc.epochFromHex()`, `ccc.epochToHex()` (merged upstream from maintainer's PR)
- **Async utilities:** `ccc.reduceAsync()` for async iteration with accumulation
- **Cell queries:** `ccc.Cell`, `client.findCells()`, `client.findCellsOnChain()` with filter support

---

*Integration audit: 2026-02-14*
