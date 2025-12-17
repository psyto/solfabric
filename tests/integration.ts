import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Atomliq } from "../target/types/atomliq";
import { SolFabric, SolFabricConfig } from "../sdk/src"; // Importing directly from source for now
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assert } from "chai";

describe("SolFabric Integration", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Atomliq as Program<Atomliq>;

    // SDK Setup
    const config: SolFabricConfig = {
        endpoint: provider.connection.rpcEndpoint,
        jitoBlockEngineUrl: "http://localhost:8899", // Mock URL
    };
    const solFabric = new SolFabric(config);

    it("Executes a liquidaton bundle (Simulated)", async () => {
        // 1. Setup Context
        const liquidator = provider.wallet;
        // Mock price update account (just a random key for now since program mocks it)
        const priceUpdate = new PublicKey("11111111111111111111111111111111");

        // Airdrop SOL to liquidator
        console.log("Requesting airdrop for:", liquidator.publicKey.toBase58());
        const signature = await provider.connection.requestAirdrop(liquidator.publicKey, 10 * 1000000000);
        const latestBlockhashAirdrop = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({
            signature,
            blockhash: latestBlockhashAirdrop.blockhash,
            lastValidBlockHeight: latestBlockhashAirdrop.lastValidBlockHeight
        }, "confirmed");

        const balance = await provider.connection.getBalance(liquidator.publicKey);
        console.log("Liquidator Balance:", balance / 1000000000, "SOL");


        // 2. Create the Liquidation Instruction
        const ix = await program.methods
            .executeLiquidation(new anchor.BN(5000))
            .accounts({
                priceUpdate: priceUpdate,
                signer: liquidator.publicKey,
            })
            .instruction();

        // 3. Construct Transaction
        const latestBlockhash = await provider.connection.getLatestBlockhash();
        const msg = new TransactionMessage({
            payerKey: liquidator.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [ix],
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([liquidator.payer]);

        // debug: try sending it directly first to confirm it works
        console.log("Verifying transaction directly...");
        try {
            const sig = await provider.connection.sendTransaction(tx);
            await provider.connection.confirmTransaction(sig, "confirmed");
            console.log("Direct transaction successful:", sig);
        } catch (e) {
            console.error("Direct transaction failed:", e);
            throw e;
        }

        // 4. Construct Bundle (Re-sign or recreate if needed, but signature reuse is fine for testing if blockhash valid)
        // Actually, let's create a NEW transaction for the bundle to avoid "already processed" error if needed
        // But since this is simulation, it should be fine. Or we can just simulate the SAME tx.
        const bundle = {
            transactions: [tx],
            tip: 1000 // Mock tip
        };

        // 5. Verify via SDK Simulation
        // This proves the SDK can accept our bundle and the program can execute it
        try {
            await solFabric.simulateBundle(bundle);
        } catch (e) {
            assert.fail("Simulation failed: " + e);
        }
    });
});
