/**
 * Example: How to use SolFabric SDK with Jito Bundles
 *
 * This example demonstrates:
 * 1. Creating a SolFabric instance with Jito configuration
 * 2. Building transactions with tip instructions
 * 3. Submitting bundles with automatic retry
 * 4. Checking bundle status and confirmation
 */

import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionMessage,
    VersionedTransaction,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    SolFabric,
    TipLevel,
    JitoRegion,
    JITO_BLOCK_ENGINE_URLS,
} from "../src";

async function main() {
    // 1. Initialize SolFabric with configuration
    const solFabric = new SolFabric({
        endpoint: "https://api.mainnet-beta.solana.com",
        jitoBlockEngineUrl: JITO_BLOCK_ENGINE_URLS.mainnet,
        jitoRegion: JitoRegion.Default,
        maxRetries: 3,
        timeout: 30000,
    });

    console.log("SolFabric SDK initialized");
    console.log("Region:", JitoRegion.Default);
    console.log("Block Engine:", JITO_BLOCK_ENGINE_URLS.mainnet);

    // 2. Create example keypairs (in production, use your actual keys)
    const payer = Keypair.generate();
    const recipient = Keypair.generate();

    console.log("\nPayer:", payer.publicKey.toBase58());
    console.log("Recipient:", recipient.publicKey.toBase58());

    // 3. Create a transaction
    const connection = new Connection("https://api.mainnet-beta.solana.com");
    const latestBlockhash = await connection.getLatestBlockhash();

    // Example transfer instruction
    const transferIx = SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
    });

    // 4. Add Jito tip instruction (CRITICAL for bundle inclusion)
    const tipIx = solFabric.createTipInstruction(
        payer.publicKey,
        TipLevel.High // 0.0001 SOL tip for high priority
    );

    console.log("\nTip Account:", solFabric.getRandomTipAccount().toBase58());
    console.log("Tip Amount:", TipLevel.High, "lamports");

    // 5. Build the transaction
    const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [transferIx, tipIx],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    transaction.sign([payer]);

    // 6. Create bundle
    const bundle = {
        transactions: [transaction],
        tip: TipLevel.High,
    };

    console.log("\n=== Bundle Created ===");
    console.log("Transactions:", bundle.transactions.length);

    // 7. Simulate bundle (optional but recommended)
    try {
        await solFabric.simulateBundle(bundle);
        console.log("✓ Bundle simulation passed");
    } catch (error) {
        console.error("✗ Bundle simulation failed:", error);
        return;
    }

    // 8. Submit bundle with automatic retry
    console.log("\n=== Submitting Bundle ===");
    try {
        const result = await solFabric.sendBundle(bundle);

        if (result.accepted) {
            console.log("✓ Bundle accepted!");
            console.log("  Bundle ID:", result.bundleId);

            // 9. Wait for confirmation
            console.log("\n=== Waiting for Confirmation ===");
            const status = await solFabric.confirmBundle(
                result.bundleId,
                60000, // 60s timeout
                2000 // Poll every 2s
            );

            console.log("✓ Bundle confirmed!");
            console.log("  Status:", status.status);
            console.log("  Landed at slot:", status.landedSlot);
            console.log("  Transactions:", status.transactions?.length);
        } else {
            console.error("✗ Bundle rejected:", result.error);
        }
    } catch (error: any) {
        console.error("✗ Bundle submission failed:", error.message);
        if (error.code) {
            console.error("  Error code:", error.code);
        }
        if (error.details) {
            console.error("  Details:", error.details);
        }
    }
}

// Usage examples for different scenarios

/**
 * Example 1: High-priority arbitrage transaction
 */
async function arbitrageExample() {
    const solFabric = new SolFabric({
        endpoint: "https://api.mainnet-beta.solana.com",
        jitoBlockEngineUrl: JITO_BLOCK_ENGINE_URLS.mainnet,
        jitoRegion: JitoRegion.Default,
    });

    // Use Turbo tip for critical arbitrage
    const tipAmount = solFabric.calculateDynamicTip(TipLevel.Turbo, 2); // 2x multiplier
    console.log("Arbitrage tip:", tipAmount / LAMPORTS_PER_SOL, "SOL");
}

/**
 * Example 2: Liquidation with Atomliq
 */
async function liquidationExample() {
    const solFabric = new SolFabric({
        endpoint: "https://api.mainnet-beta.solana.com",
        jitoBlockEngineUrl: JITO_BLOCK_ENGINE_URLS.mainnet,
    });

    // Create bundle with:
    // 1. Pyth price update
    // 2. Liquidation instruction
    // 3. Jito tip

    const tipIx = solFabric.createTipInstruction(
        Keypair.generate().publicKey,
        TipLevel.VeryHigh // Ensure liquidation lands
    );

    console.log("Liquidation bundle ready with tip instruction");
}

/**
 * Example 3: Development/Testing with Devnet
 */
async function devnetExample() {
    const solFabric = new SolFabric({
        endpoint: "https://api.devnet.solana.com",
        jitoBlockEngineUrl: JITO_BLOCK_ENGINE_URLS.devnet,
        jitoRegion: JitoRegion.Default,
        maxRetries: 5, // More retries for devnet
    });

    console.log("Connected to Jito Devnet Block Engine");
}

// Run main example
if (require.main === module) {
    main()
        .then(() => {
            console.log("\n✓ Example completed successfully");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n✗ Example failed:", error);
            process.exit(1);
        });
}

export { main, arbitrageExample, liquidationExample, devnetExample };
