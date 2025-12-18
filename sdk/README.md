# SolFabric SDK

High-performance infrastructure SDK for Solana DeFi applications, providing guaranteed transaction execution through Jito Block Engine integration.

## Features

- **Jito Bundle Integration**: Atomic transaction execution with MEV protection
- **Automatic Retry Logic**: Exponential backoff for transient failures
- **Dynamic Tip Calculation**: Priority-based tip amounts for optimal inclusion
- **Bundle Status Tracking**: Real-time confirmation monitoring
- **Multi-Region Support**: Connect to Jito block engines in different regions
- **Type-Safe**: Full TypeScript support with comprehensive types

## Installation

```bash
cd sdk
yarn install
yarn build
```

## Quick Start

```typescript
import { SolFabric, TipLevel, JITO_BLOCK_ENGINE_URLS } from "./sdk/src";

// Initialize SolFabric
const solFabric = new SolFabric({
    endpoint: "https://api.mainnet-beta.solana.com",
    jitoBlockEngineUrl: JITO_BLOCK_ENGINE_URLS.mainnet,
    maxRetries: 3,
    timeout: 30000,
});

// Create tip instruction
const tipIx = solFabric.createTipInstruction(
    payer.publicKey,
    TipLevel.High
);

// Add tip to your transaction
const transaction = new VersionedTransaction(message);
transaction.sign([payer]);

// Submit as bundle
const result = await solFabric.sendBundle({
    transactions: [transaction],
});

// Wait for confirmation
const status = await solFabric.confirmBundle(result.bundleId);
```

## Configuration

### SolFabricConfig

```typescript
interface SolFabricConfig {
    endpoint: string; // Solana RPC endpoint
    jitoBlockEngineUrl?: string; // Jito Block Engine URL (defaults to mainnet)
    jitoRegion?: JitoRegion; // Region for tip accounts
    maxRetries?: number; // Max retry attempts (default: 3)
    timeout?: number; // Request timeout in ms (default: 30000)
}
```

### Jito Regions

```typescript
enum JitoRegion {
    Default = "default",
    Amsterdam = "amsterdam",
    Frankfurt = "frankfurt",
    NewYork = "ny",
    Tokyo = "tokyo",
}
```

### Tip Levels

```typescript
enum TipLevel {
    None = 0, // No tip
    Low = 1000, // 0.000001 SOL
    Medium = 10000, // 0.00001 SOL
    High = 100000, // 0.0001 SOL
    VeryHigh = 1000000, // 0.001 SOL
    Turbo = 10000000, // 0.01 SOL
}
```

## API Reference

### Core Methods

#### `sendBundle(bundle: JitoBundle): Promise<BundleResult>`

Submits a bundle of transactions to Jito Block Engine with automatic retry.

**Parameters:**
- `bundle.transactions`: Array of VersionedTransaction
- `bundle.tip`: Optional tip amount in lamports

**Returns:**
- `bundleId`: Unique identifier for the bundle
- `accepted`: Whether bundle was accepted
- `error`: Error message if rejected

**Example:**
```typescript
const result = await solFabric.sendBundle({
    transactions: [tx1, tx2],
    tip: TipLevel.High,
});

if (result.accepted) {
    console.log("Bundle ID:", result.bundleId);
}
```

#### `getBundleStatus(bundleId: string): Promise<BundleStatusResponse>`

Checks the current status of a submitted bundle.

**Returns:**
- `status`: "pending" | "landed" | "failed" | "invalid"
- `landedSlot`: Slot number where bundle landed
- `transactions`: Array of transaction signatures
- `error`: Error details if failed

#### `confirmBundle(bundleId: string, timeoutMs?: number, pollIntervalMs?: number): Promise<BundleStatusResponse>`

Waits for bundle confirmation with timeout.

**Parameters:**
- `bundleId`: Bundle identifier from sendBundle
- `timeoutMs`: Max wait time (default: 60000)
- `pollIntervalMs`: Polling interval (default: 2000)

#### `simulateBundle(bundle: JitoBundle): Promise<void>`

Simulates bundle execution without submitting.

**Throws:** `JitoError` if simulation fails

### Utility Methods

#### `createTipInstruction(payer: PublicKey, tipAmount?: number): TransactionInstruction`

Creates a tip instruction for Jito bundles.

```typescript
const tipIx = solFabric.createTipInstruction(
    payer.publicKey,
    TipLevel.High
);
```

#### `getRandomTipAccount(): PublicKey`

Returns a random tip account for the configured region.

#### `calculateDynamicTip(priority: TipLevel, multiplier?: number): number`

Calculates tip amount with optional multiplier.

```typescript
const tip = solFabric.calculateDynamicTip(TipLevel.High, 2); // 2x
```

## Error Handling

The SDK provides a custom `JitoError` class with detailed error information:

```typescript
try {
    const result = await solFabric.sendBundle(bundle);
} catch (error) {
    if (error instanceof JitoError) {
        console.error("Error code:", error.code);
        console.error("Details:", error.details);
    }
}
```

### Common Error Codes

- `SIMULATION_FAILED`: Transaction simulation failed
- `TIMEOUT`: Request timed out
- `CONFIRMATION_TIMEOUT`: Bundle didn't land within timeout
- `HTTP_XXX`: HTTP error from Jito API
- `UNKNOWN_ERROR`: Unexpected error

## Advanced Usage

### Atomliq Liquidation Example

```typescript
// 1. Create price update instruction (Pyth)
const priceUpdateIx = createPriceUpdateInstruction(priceData);

// 2. Create liquidation instruction
const liquidationIx = await atomliqProgram.methods
    .executeLiquidation(amount)
    .accounts({...})
    .instruction();

// 3. Add Jito tip
const tipIx = solFabric.createTipInstruction(
    liquidator.publicKey,
    TipLevel.VeryHigh
);

// 4. Build and submit atomic bundle
const message = new TransactionMessage({
    payerKey: liquidator.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [priceUpdateIx, liquidationIx, tipIx],
}).compileToV0Message();

const tx = new VersionedTransaction(message);
tx.sign([liquidator]);

const result = await solFabric.sendBundle({ transactions: [tx] });
const status = await solFabric.confirmBundle(result.bundleId);
```

### Multi-Transaction Bundle

```typescript
// Bundle multiple transactions atomically
const bundle = {
    transactions: [
        createSwapTx(),
        createArbitrageTx(),
        createTipTx(),
    ],
    tip: TipLevel.Turbo,
};

const result = await solFabric.sendBundle(bundle);
```

### Network-Aware Tip Calculation

```typescript
// Get current network conditions
const recentPriorityFees = await connection.getRecentPrioritizationFees();
const avgFee = recentPriorityFees.reduce((a, b) => a + b.prioritizationFee, 0) / recentPriorityFees.length;

// Calculate tip based on network congestion
const multiplier = avgFee > 10000 ? 3 : 1;
const tip = solFabric.calculateDynamicTip(TipLevel.High, multiplier);
```

## Testing

Run SDK tests:

```bash
anchor test
```

The test suite includes:
- Bundle construction and serialization
- Simulation validation
- Error handling
- Retry logic verification

## Production Considerations

### 1. Tip Strategy

- **Arbitrage**: Use `TipLevel.Turbo` or higher
- **Liquidations**: Use `TipLevel.VeryHigh` minimum
- **Regular transactions**: `TipLevel.Medium` is sufficient
- **Time-sensitive**: Calculate dynamic tips based on urgency

### 2. Retry Configuration

```typescript
const solFabric = new SolFabric({
    endpoint: rpcUrl,
    maxRetries: 5, // Increase for mission-critical operations
    timeout: 60000, // Longer timeout for complex bundles
});
```

### 3. Monitoring

Always check bundle status after submission:

```typescript
const result = await solFabric.sendBundle(bundle);
const status = await solFabric.confirmBundle(result.bundleId);

if (status.status !== "landed") {
    // Handle failure - retry or alert
}
```

### 4. MEV Protection

Bundle transactions atomically to prevent front-running:

```typescript
// Bad: Separate transactions can be front-run
await sendTransaction(priceUpdate);
await sendTransaction(arbitrage);

// Good: Atomic bundle prevents MEV
await solFabric.sendBundle({
    transactions: [priceUpdate, arbitrage, tip],
});
```

## Jito Block Engine URLs

### Mainnet
- Default: `https://mainnet.block-engine.jito.wtf`

### Devnet
- Dallas: `https://dallas.devnet.block-engine.jito.wtf`

## Contributing

See the main repository README for contribution guidelines.

## License

MIT

## Links

- [Jito Documentation](https://jito-labs.gitbook.io/mev/)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- [Anchor Framework](https://www.anchor-lang.com/)

## Support

For issues and questions:
- GitHub Issues: [psyto/solfabric](https://github.com/psyto/solfabric/issues)
- Documentation: See `/docs` directory
