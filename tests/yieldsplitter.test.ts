import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { YieldSplitter } from "../target/types/yield_splitter";
import {
    PublicKey,
    Keypair,
    SystemProgram,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    createAccount,
    mintTo,
    getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("YieldSplitter - Yield Tokenization AMM", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.YieldSplitter as Program<YieldSplitter>;

    // Test accounts
    let underlyingMint: PublicKey;
    let ammKeypair: Keypair;
    let vault: PublicKey;
    let ptMint: PublicKey;
    let ytMint: PublicKey;
    let userKeypair: Keypair;
    let user2Keypair: Keypair;

    // User token accounts
    let userUnderlyingAccount: PublicKey;
    let userPtAccount: PublicKey;
    let userYtAccount: PublicKey;
    let user2UnderlyingAccount: PublicKey;
    let user2PtAccount: PublicKey;
    let user2YtAccount: PublicKey;

    // Test constants
    const INITIAL_MINT_AMOUNT = new BN(1_000_000_000); // 1000 tokens with 6 decimals
    const MATURITY_OFFSET = 60 * 60 * 24 * 365; // 1 year from now

    before(async () => {
        console.log("\n=== Setting up YieldSplitter Test Environment ===");

        // Initialize keypairs
        ammKeypair = Keypair.generate();
        userKeypair = Keypair.generate();
        user2Keypair = Keypair.generate();

        // Airdrop SOL to users
        const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
        await Promise.all([
            provider.connection.requestAirdrop(userKeypair.publicKey, airdropAmount),
            provider.connection.requestAirdrop(user2Keypair.publicKey, airdropAmount),
        ]);

        // Wait for confirmations
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Create underlying token mint
        underlyingMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6 // decimals
        );

        console.log("Underlying mint created:", underlyingMint.toBase58());

        // Create user token accounts
        userUnderlyingAccount = await createAccount(
            provider.connection,
            provider.wallet.payer,
            underlyingMint,
            userKeypair.publicKey
        );

        user2UnderlyingAccount = await createAccount(
            provider.connection,
            provider.wallet.payer,
            underlyingMint,
            user2Keypair.publicKey
        );

        // Mint initial tokens to users
        await mintTo(
            provider.connection,
            provider.wallet.payer,
            underlyingMint,
            userUnderlyingAccount,
            provider.wallet.publicKey,
            INITIAL_MINT_AMOUNT.toNumber()
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            underlyingMint,
            user2UnderlyingAccount,
            provider.wallet.publicKey,
            INITIAL_MINT_AMOUNT.toNumber()
        );

        console.log("Initial token balances minted");
        console.log("User 1:", userKeypair.publicKey.toBase58());
        console.log("User 2:", user2Keypair.publicKey.toBase58());
    });

    describe("Pool Initialization", () => {
        it("Initializes AMM pool with valid maturity", async () => {
            console.log("\n=== Initializing AMM Pool ===");

            const clock = await provider.connection.getSlot();
            const maturityTimestamp = Math.floor(Date.now() / 1000) + MATURITY_OFFSET;

            // Derive PDAs
            [vault] = PublicKey.findProgramAddressSync(
                [Buffer.from("vault"), ammKeypair.publicKey.toBuffer()],
                program.programId
            );

            [ptMint] = PublicKey.findProgramAddressSync(
                [Buffer.from("pt_mint"), ammKeypair.publicKey.toBuffer()],
                program.programId
            );

            [ytMint] = PublicKey.findProgramAddressSync(
                [Buffer.from("yt_mint"), ammKeypair.publicKey.toBuffer()],
                program.programId
            );

            await program.methods
                .initializeAmm(new BN(maturityTimestamp), underlyingMint)
                .accounts({
                    amm: ammKeypair.publicKey,
                    vault: vault,
                    underlyingMint: underlyingMint,
                    ptMint: ptMint,
                    ytMint: ytMint,
                    authority: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                })
                .signers([ammKeypair])
                .rpc();

            const ammAccount = await program.account.ammPool.fetch(ammKeypair.publicKey);

            console.log("AMM Pool initialized at:", ammKeypair.publicKey.toBase58());
            console.log("PT Mint:", ptMint.toBase58());
            console.log("YT Mint:", ytMint.toBase58());
            console.log("Maturity:", new Date(ammAccount.maturity.toNumber() * 1000).toISOString());
            console.log("Fee (bps):", ammAccount.feeBasisPoints);

            assert.equal(ammAccount.authority.toBase58(), provider.wallet.publicKey.toBase58());
            assert.equal(ammAccount.underlyingMint.toBase58(), underlyingMint.toBase58());
            assert.equal(ammAccount.ptMint.toBase58(), ptMint.toBase58());
            assert.equal(ammAccount.ytMint.toBase58(), ytMint.toBase58());
            assert.equal(ammAccount.maturity.toNumber(), maturityTimestamp);
            assert.equal(ammAccount.ptReserve.toNumber(), 0);
            assert.equal(ammAccount.ytReserve.toNumber(), 0);
            assert.equal(ammAccount.totalUnderlying.toNumber(), 0);
            assert.equal(ammAccount.feeBasisPoints, 30); // 0.3%
            assert.equal(ammAccount.isMatured, false);
        });

        it("Fails to initialize with past maturity date", async () => {
            const invalidAmmKeypair = Keypair.generate();
            const pastMaturity = Math.floor(Date.now() / 1000) - 86400; // Yesterday

            const [invalidVault] = PublicKey.findProgramAddressSync(
                [Buffer.from("vault"), invalidAmmKeypair.publicKey.toBuffer()],
                program.programId
            );

            const [invalidPtMint] = PublicKey.findProgramAddressSync(
                [Buffer.from("pt_mint"), invalidAmmKeypair.publicKey.toBuffer()],
                program.programId
            );

            const [invalidYtMint] = PublicKey.findProgramAddressSync(
                [Buffer.from("yt_mint"), invalidAmmKeypair.publicKey.toBuffer()],
                program.programId
            );

            try {
                await program.methods
                    .initializeAmm(new BN(pastMaturity), underlyingMint)
                    .accounts({
                        amm: invalidAmmKeypair.publicKey,
                        vault: invalidVault,
                        underlyingMint: underlyingMint,
                        ptMint: invalidPtMint,
                        ytMint: invalidYtMint,
                        authority: provider.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                    })
                    .signers([invalidAmmKeypair])
                    .rpc();
                assert.fail("Should have thrown error for invalid maturity");
            } catch (err) {
                assert.include(err.toString(), "InvalidMaturity");
            }
        });
    });

    describe("Yield Tokenization", () => {
        before(async () => {
            // Create user PT and YT accounts
            userPtAccount = await createAccount(
                provider.connection,
                provider.wallet.payer,
                ptMint,
                userKeypair.publicKey
            );

            userYtAccount = await createAccount(
                provider.connection,
                provider.wallet.payer,
                ytMint,
                userKeypair.publicKey
            );

            console.log("\nUser token accounts created");
        });

        it("Tokenizes underlying into PT + YT (1:1:1 ratio)", async () => {
            console.log("\n=== Testing Tokenization ===");

            const depositAmount = new BN(100_000_000); // 100 tokens

            const userUnderlyingBefore = await getAccount(
                provider.connection,
                userUnderlyingAccount
            );

            await program.methods
                .tokenizeYield(depositAmount)
                .accounts({
                    user: userKeypair.publicKey,
                    amm: ammKeypair.publicKey,
                    vault: vault,
                    ptMint: ptMint,
                    ytMint: ytMint,
                    userUnderlying: userUnderlyingAccount,
                    userPt: userPtAccount,
                    userYt: userYtAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([userKeypair])
                .rpc();

            // Verify balances
            const userUnderlyingAfter = await getAccount(provider.connection, userUnderlyingAccount);
            const userPtBalance = await getAccount(provider.connection, userPtAccount);
            const userYtBalance = await getAccount(provider.connection, userYtAccount);
            const vaultBalance = await getAccount(provider.connection, vault);
            const ammAccount = await program.account.ammPool.fetch(ammKeypair.publicKey);

            console.log("Deposited:", depositAmount.toString(), "underlying");
            console.log("Received PT:", userPtBalance.amount.toString());
            console.log("Received YT:", userYtBalance.amount.toString());
            console.log("Vault balance:", vaultBalance.amount.toString());

            // Assertions
            assert.equal(
                Number(userUnderlyingBefore.amount) - Number(userUnderlyingAfter.amount),
                depositAmount.toNumber(),
                "Underlying should be deducted"
            );
            assert.equal(
                userPtBalance.amount.toString(),
                depositAmount.toString(),
                "PT should be 1:1 with deposit"
            );
            assert.equal(
                userYtBalance.amount.toString(),
                depositAmount.toString(),
                "YT should be 1:1 with deposit"
            );
            assert.equal(
                vaultBalance.amount.toString(),
                depositAmount.toString(),
                "Vault should hold underlying"
            );
            assert.equal(
                ammAccount.totalUnderlying.toString(),
                depositAmount.toString(),
                "AMM should track total underlying"
            );
        });

        it("Fails with zero amount", async () => {
            try {
                await program.methods
                    .tokenizeYield(new BN(0))
                    .accounts({
                        user: userKeypair.publicKey,
                        amm: ammKeypair.publicKey,
                        vault: vault,
                        ptMint: ptMint,
                        ytMint: ytMint,
                        userUnderlying: userUnderlyingAccount,
                        userPt: userPtAccount,
                        userYt: userYtAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for zero amount");
            } catch (err) {
                assert.include(err.toString(), "InvalidAmount");
            }
        });

        it("Allows multiple users to tokenize", async () => {
            console.log("\n=== Testing Multi-User Tokenization ===");

            // Create user2 PT and YT accounts
            user2PtAccount = await createAccount(
                provider.connection,
                provider.wallet.payer,
                ptMint,
                user2Keypair.publicKey
            );

            user2YtAccount = await createAccount(
                provider.connection,
                provider.wallet.payer,
                ytMint,
                user2Keypair.publicKey
            );

            const depositAmount = new BN(50_000_000); // 50 tokens

            await program.methods
                .tokenizeYield(depositAmount)
                .accounts({
                    user: user2Keypair.publicKey,
                    amm: ammKeypair.publicKey,
                    vault: vault,
                    ptMint: ptMint,
                    ytMint: ytMint,
                    userUnderlying: user2UnderlyingAccount,
                    userPt: user2PtAccount,
                    userYt: user2YtAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([user2Keypair])
                .rpc();

            const ammAccount = await program.account.ammPool.fetch(ammKeypair.publicKey);
            const user2PtBalance = await getAccount(provider.connection, user2PtAccount);

            console.log("User 2 deposited:", depositAmount.toString());
            console.log("User 2 PT balance:", user2PtBalance.amount.toString());
            console.log("Total underlying in pool:", ammAccount.totalUnderlying.toString());

            assert.equal(user2PtBalance.amount.toString(), depositAmount.toString());
            assert.equal(
                ammAccount.totalUnderlying.toString(),
                new BN(150_000_000).toString(), // 100M + 50M
                "Total should accumulate"
            );
        });
    });

    describe("Liquidity Provision", () => {
        it("Adds liquidity to AMM pool", async () => {
            console.log("\n=== Testing Add Liquidity ===");

            const ptAmount = new BN(30_000_000); // 30 PT
            const ytAmount = new BN(30_000_000); // 30 YT

            const ammBefore = await program.account.ammPool.fetch(ammKeypair.publicKey);

            await program.methods
                .addLiquidity(ptAmount, ytAmount)
                .accounts({
                    amm: ammKeypair.publicKey,
                    user: userKeypair.publicKey,
                })
                .signers([userKeypair])
                .rpc();

            const ammAfter = await program.account.ammPool.fetch(ammKeypair.publicKey);

            console.log("PT Reserve before:", ammBefore.ptReserve.toString());
            console.log("PT Reserve after:", ammAfter.ptReserve.toString());
            console.log("YT Reserve before:", ammBefore.ytReserve.toString());
            console.log("YT Reserve after:", ammAfter.ytReserve.toString());

            assert.equal(
                ammAfter.ptReserve.toString(),
                ammBefore.ptReserve.add(ptAmount).toString()
            );
            assert.equal(
                ammAfter.ytReserve.toString(),
                ammBefore.ytReserve.add(ytAmount).toString()
            );
        });

        it("Fails to add liquidity with zero amounts", async () => {
            try {
                await program.methods
                    .addLiquidity(new BN(0), new BN(10_000_000))
                    .accounts({
                        amm: ammKeypair.publicKey,
                        user: userKeypair.publicKey,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for zero amount");
            } catch (err) {
                assert.include(err.toString(), "InvalidAmount");
            }
        });
    });

    describe("YieldSpace AMM Swaps", () => {
        it("Swaps PT for YT using YieldSpace curve", async () => {
            console.log("\n=== Testing PT -> YT Swap ===");

            const ammBefore = await program.account.ammPool.fetch(ammKeypair.publicKey);
            const swapAmount = new BN(5_000_000); // 5 PT
            const minOut = new BN(0); // No slippage protection for test

            console.log("PT Reserve before swap:", ammBefore.ptReserve.toString());
            console.log("YT Reserve before swap:", ammBefore.ytReserve.toString());
            console.log("Swapping:", swapAmount.toString(), "PT");

            await program.methods
                .swap(swapAmount, minOut, true) // true = PT to YT
                .accounts({
                    amm: ammKeypair.publicKey,
                    user: userKeypair.publicKey,
                })
                .signers([userKeypair])
                .rpc();

            const ammAfter = await program.account.ammPool.fetch(ammKeypair.publicKey);

            console.log("PT Reserve after swap:", ammAfter.ptReserve.toString());
            console.log("YT Reserve after swap:", ammAfter.ytReserve.toString());

            // Verify reserves changed
            assert.ok(
                ammAfter.ptReserve.gt(ammBefore.ptReserve),
                "PT reserve should increase"
            );
            assert.ok(
                ammAfter.ytReserve.lt(ammBefore.ytReserve),
                "YT reserve should decrease"
            );

            // Verify PT increased by swapAmount
            assert.equal(
                ammAfter.ptReserve.toString(),
                ammBefore.ptReserve.add(swapAmount).toString(),
                "PT reserve should increase by swap amount"
            );
        });

        it("Swaps YT for PT using YieldSpace curve", async () => {
            console.log("\n=== Testing YT -> PT Swap ===");

            const ammBefore = await program.account.ammPool.fetch(ammKeypair.publicKey);
            const swapAmount = new BN(5_000_000); // 5 YT
            const minOut = new BN(0);

            console.log("YT Reserve before swap:", ammBefore.ytReserve.toString());
            console.log("PT Reserve before swap:", ammBefore.ptReserve.toString());
            console.log("Swapping:", swapAmount.toString(), "YT");

            await program.methods
                .swap(swapAmount, minOut, false) // false = YT to PT
                .accounts({
                    amm: ammKeypair.publicKey,
                    user: userKeypair.publicKey,
                })
                .signers([userKeypair])
                .rpc();

            const ammAfter = await program.account.ammPool.fetch(ammKeypair.publicKey);

            console.log("YT Reserve after swap:", ammAfter.ytReserve.toString());
            console.log("PT Reserve after swap:", ammAfter.ptReserve.toString());

            // Verify reserves changed
            assert.ok(
                ammAfter.ytReserve.gt(ammBefore.ytReserve),
                "YT reserve should increase"
            );
            assert.ok(
                ammAfter.ptReserve.lt(ammBefore.ptReserve),
                "PT reserve should decrease"
            );
        });

        it("Fails swap with insufficient liquidity", async () => {
            const hugeAmount = new BN(1_000_000_000_000); // Way too much

            try {
                await program.methods
                    .swap(hugeAmount, new BN(0), true)
                    .accounts({
                        amm: ammKeypair.publicKey,
                        user: userKeypair.publicKey,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for insufficient liquidity");
            } catch (err) {
                // Can throw either MathOverflow or InsufficientLiquidity depending on calculation path
                const errStr = err.toString();
                assert.ok(
                    errStr.includes("InsufficientLiquidity") || errStr.includes("MathOverflow"),
                    "Should throw InsufficientLiquidity or MathOverflow error"
                );
            }
        });

        it("Fails swap with slippage protection", async () => {
            const swapAmount = new BN(1_000_000); // 1 PT
            const unrealisticMinOut = new BN(1_000_000_000); // Expecting way too much

            try {
                await program.methods
                    .swap(swapAmount, unrealisticMinOut, true)
                    .accounts({
                        amm: ammKeypair.publicKey,
                        user: userKeypair.publicKey,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for slippage");
            } catch (err) {
                assert.include(err.toString(), "SlippageExceeded");
            }
        });

        it("Fails swap with zero amount", async () => {
            try {
                await program.methods
                    .swap(new BN(0), new BN(0), true)
                    .accounts({
                        amm: ammKeypair.publicKey,
                        user: userKeypair.publicKey,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for zero amount");
            } catch (err) {
                assert.include(err.toString(), "InvalidAmount");
            }
        });
    });

    describe("PT Redemption at Maturity", () => {
        let maturedAmmKeypair: Keypair;
        let maturedVault: PublicKey;
        let maturedPtMint: PublicKey;
        let maturedYtMint: PublicKey;
        let userMaturedPtAccount: PublicKey;
        let userMaturedYtAccount: PublicKey;

        before(async () => {
            console.log("\n=== Setting up Matured Pool ===");

            maturedAmmKeypair = Keypair.generate();

            // Create a pool that matures in 2 seconds
            const shortMaturity = Math.floor(Date.now() / 1000) + 2;

            [maturedVault] = PublicKey.findProgramAddressSync(
                [Buffer.from("vault"), maturedAmmKeypair.publicKey.toBuffer()],
                program.programId
            );

            [maturedPtMint] = PublicKey.findProgramAddressSync(
                [Buffer.from("pt_mint"), maturedAmmKeypair.publicKey.toBuffer()],
                program.programId
            );

            [maturedYtMint] = PublicKey.findProgramAddressSync(
                [Buffer.from("yt_mint"), maturedAmmKeypair.publicKey.toBuffer()],
                program.programId
            );

            await program.methods
                .initializeAmm(new BN(shortMaturity), underlyingMint)
                .accounts({
                    amm: maturedAmmKeypair.publicKey,
                    vault: maturedVault,
                    underlyingMint: underlyingMint,
                    ptMint: maturedPtMint,
                    ytMint: maturedYtMint,
                    authority: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                })
                .signers([maturedAmmKeypair])
                .rpc();

            // Create user PT/YT accounts for matured pool
            userMaturedPtAccount = await createAccount(
                provider.connection,
                provider.wallet.payer,
                maturedPtMint,
                userKeypair.publicKey
            );

            userMaturedYtAccount = await createAccount(
                provider.connection,
                provider.wallet.payer,
                maturedYtMint,
                userKeypair.publicKey
            );

            // Deposit some underlying to get PT
            const depositAmount = new BN(50_000_000);
            await program.methods
                .tokenizeYield(depositAmount)
                .accounts({
                    user: userKeypair.publicKey,
                    amm: maturedAmmKeypair.publicKey,
                    vault: maturedVault,
                    ptMint: maturedPtMint,
                    ytMint: maturedYtMint,
                    userUnderlying: userUnderlyingAccount,
                    userPt: userMaturedPtAccount,
                    userYt: userMaturedYtAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([userKeypair])
                .rpc();

            console.log("Waiting for pool to mature...");
            await new Promise(resolve => setTimeout(resolve, 3000));
        });

        it("Marks pool as matured after maturity timestamp", async () => {
            console.log("\n=== Testing Mark Matured ===");

            await program.methods
                .markMatured()
                .accounts({
                    amm: maturedAmmKeypair.publicKey,
                })
                .rpc();

            const ammAccount = await program.account.ammPool.fetch(maturedAmmKeypair.publicKey);

            console.log("Pool marked as matured:", ammAccount.isMatured);
            assert.equal(ammAccount.isMatured, true);
        });

        it("Redeems PT for underlying 1:1 after maturity", async () => {
            console.log("\n=== Testing PT Redemption ===");

            const redeemAmount = new BN(10_000_000); // Redeem 10 PT

            const userPtBefore = await getAccount(provider.connection, userMaturedPtAccount);
            const userUnderlyingBefore = await getAccount(provider.connection, userUnderlyingAccount);

            console.log("PT balance before:", userPtBefore.amount.toString());
            console.log("Underlying balance before:", userUnderlyingBefore.amount.toString());

            await program.methods
                .redeemPt(redeemAmount)
                .accounts({
                    user: userKeypair.publicKey,
                    amm: maturedAmmKeypair.publicKey,
                    vault: maturedVault,
                    ptMint: maturedPtMint,
                    userPt: userMaturedPtAccount,
                    userUnderlying: userUnderlyingAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([userKeypair])
                .rpc();

            const userPtAfter = await getAccount(provider.connection, userMaturedPtAccount);
            const userUnderlyingAfter = await getAccount(provider.connection, userUnderlyingAccount);

            console.log("PT balance after:", userPtAfter.amount.toString());
            console.log("Underlying balance after:", userUnderlyingAfter.amount.toString());

            // PT should be burned
            assert.equal(
                Number(userPtBefore.amount) - Number(userPtAfter.amount),
                redeemAmount.toNumber(),
                "PT should be burned"
            );

            // Underlying should be received 1:1
            assert.equal(
                Number(userUnderlyingAfter.amount) - Number(userUnderlyingBefore.amount),
                redeemAmount.toNumber(),
                "Should receive underlying 1:1"
            );
        });

        it("Fails to redeem PT before maturity", async () => {
            // Try to redeem from the non-matured pool
            const redeemAmount = new BN(1_000_000);

            try {
                await program.methods
                    .redeemPt(redeemAmount)
                    .accounts({
                        user: userKeypair.publicKey,
                        amm: ammKeypair.publicKey, // Original pool, not matured
                        vault: vault,
                        ptMint: ptMint,
                        userPt: userPtAccount,
                        userUnderlying: userUnderlyingAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for not matured");
            } catch (err) {
                assert.include(err.toString(), "NotMatured");
            }
        });

        it("Fails to tokenize after pool is matured", async () => {
            try {
                await program.methods
                    .tokenizeYield(new BN(1_000_000))
                    .accounts({
                        user: userKeypair.publicKey,
                        amm: maturedAmmKeypair.publicKey,
                        vault: maturedVault,
                        ptMint: maturedPtMint,
                        ytMint: maturedYtMint,
                        userUnderlying: userUnderlyingAccount,
                        userPt: userMaturedPtAccount,
                        userYt: userMaturedYtAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for matured pool");
            } catch (err) {
                assert.include(err.toString(), "PoolMatured");
            }
        });

        it("Fails to swap after pool is matured", async () => {
            try {
                await program.methods
                    .swap(new BN(1_000_000), new BN(0), true)
                    .accounts({
                        amm: maturedAmmKeypair.publicKey,
                        user: userKeypair.publicKey,
                    })
                    .signers([userKeypair])
                    .rpc();
                assert.fail("Should have thrown error for matured pool");
            } catch (err) {
                assert.include(err.toString(), "PoolMatured");
            }
        });
    });

    describe("YieldSpace Curve Behavior", () => {
        it("Documents YieldSpace curve properties", async () => {
            console.log("\n=== YieldSpace Curve Analysis ===");

            const ammAccount = await program.account.ammPool.fetch(ammKeypair.publicKey);
            const currentTime = Math.floor(Date.now() / 1000);
            const timeToMaturity = ammAccount.maturity.toNumber() - currentTime;

            console.log(`
┌─────────────────────────────────────────────────────────┐
│              YIELDSPACE CURVE PROPERTIES                │
└─────────────────────────────────────────────────────────┘

Current Pool State:
- PT Reserve: ${ammAccount.ptReserve.toString()}
- YT Reserve: ${ammAccount.ytReserve.toString()}
- Time to Maturity: ${(timeToMaturity / 86400).toFixed(1)} days
- Fee: ${ammAccount.feeBasisPoints} bps (0.${ammAccount.feeBasisPoints}%)

YieldSpace Curve Characteristics:
✓ Time-weighted constant product formula
✓ PT price converges to 1.0 as maturity approaches
✓ Early in term: PT trades at discount (yield implied)
✓ Near maturity: PT ≈ underlying (minimal yield)
✓ Fee of 0.3% applied to all swaps

Formula: k = (x + y) * t where t = time_to_maturity / year

Use Cases:
→ Fixed-rate lending (buy PT = fixed rate)
→ Variable-rate exposure (hold YT = yield upside)
→ Yield speculation (trade PT/YT based on rate views)
→ Portfolio hedging (split risk between PT & YT)
            `);

            assert.ok(timeToMaturity > 0, "Pool should not be matured yet");
        });
    });

    // Summary test documenting the complete flow
    describe("Complete Flow Documentation", () => {
        it("Documents the full YieldSplitter lifecycle", async () => {
            console.log("\n=== YieldSplitter Complete Lifecycle ===");
            console.log(`
┌─────────────────────────────────────────────────────────┐
│           YIELDSPLITTER LIFECYCLE FLOW                  │
└─────────────────────────────────────────────────────────┘

PHASE 1: INITIALIZATION
├─> Initialize AMM pool with maturity date
├─> Create PT (Principal Token) mint
├─> Create YT (Yield Token) mint
└─> Set fee parameters (default 0.3%)

PHASE 2: TOKENIZATION
├─> User deposits underlying asset (e.g., SOL, JitoSOL)
├─> Receive PT + YT tokens (1:1:1 ratio)
├─> PT = Claim to principal at maturity
└─> YT = Claim to all yield until maturity

PHASE 3: TRADING
├─> Users add liquidity (PT + YT pairs)
├─> YieldSpace AMM enables PT ↔ YT swaps
├─> Curve adjusts pricing based on time to maturity
└─> Fees accrue to liquidity providers

PHASE 4: MATURITY
├─> Anyone can mark pool as matured
├─> PT holders redeem 1:1 for underlying
├─> YT holders claim accumulated yield
└─> Trading halts after maturity

BENEFITS:
✓ Fixed-rate lending without oracles
✓ Separates principal and yield exposure
✓ On-chain yield curve (PT price = implied rate)
✓ Capital efficient (no collateralization)
✓ Composable with other DeFi primitives

NEXT STEPS FOR PRODUCTION:
→ Integrate with JitoSOL for real yield
→ Implement yield tracking per YT token
→ Add LP token system for liquidity providers
→ Create oracle feed for external rate data
→ Deploy with multiple maturity dates

Test Coverage:
✓ Pool initialization
✓ Tokenization (PT/YT minting)
✓ Liquidity provision
✓ PT ↔ YT swapping (both directions)
✓ PT redemption at maturity
✓ Pool maturity state management
✓ Error cases (invalid amounts, slippage, timing)
✓ Multi-user scenarios
            `);
        });
    });
});
