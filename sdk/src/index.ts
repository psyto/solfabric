import { Connection, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import {
    JitoBundle,
    BundleResult,
    BundleStatusResponse,
    JitoError,
    JITO_TIP_ACCOUNTS,
    JitoRegion,
    JITO_BLOCK_ENGINE_URLS,
} from "./jito";

export * from "./jito";

export interface SolFabricConfig {
    endpoint: string;
    jitoBlockEngineUrl?: string;
    jitoRegion?: JitoRegion;
    jitoAuthKeypair?: Uint8Array;
    maxRetries?: number;
    timeout?: number;
    authKeypair?: Uint8Array; // For ShredStream auth
}

export enum TipLevel {
    None = 0,
    Low = 1000, // 0.000001 SOL
    Medium = 10000, // 0.00001 SOL
    High = 100000, // 0.0001 SOL
    VeryHigh = 1000000, // 0.001 SOL
    Turbo = 10000000, // 0.01 SOL
}

export class SolFabric {
    private connection: Connection;
    private jitoUrl: string;
    private jitoRegion: JitoRegion;
    private maxRetries: number;
    private timeout: number;

    constructor(config: SolFabricConfig) {
        this.connection = new Connection(config.endpoint);
        this.jitoUrl =
            config.jitoBlockEngineUrl || JITO_BLOCK_ENGINE_URLS.mainnet;
        this.jitoRegion = config.jitoRegion || JitoRegion.Default;
        this.maxRetries = config.maxRetries || 3;
        this.timeout = config.timeout || 30000;
    }

    /**
     * Get a random Jito tip account for the configured region
     */
    getRandomTipAccount(): PublicKey {
        const accounts = JITO_TIP_ACCOUNTS[this.jitoRegion];
        const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];
        return new PublicKey(randomAccount.address);
    }

    /**
     * Create a tip instruction for Jito bundles
     */
    createTipInstruction(
        payer: PublicKey,
        tipAmount: number = TipLevel.Medium
    ): TransactionInstruction {
        const tipAccount = this.getRandomTipAccount();

        return SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: tipAccount,
            lamports: tipAmount,
        });
    }

    /**
     * Calculate dynamic tip based on priority level and network conditions
     */
    calculateDynamicTip(priority: TipLevel, multiplier: number = 1): number {
        return Math.floor(priority * multiplier);
    }

    /**
     * Simulates a bundle of transactions to verify they would succeed.
     * Useful for testing without a real Jito Key/Block Engine.
     */
    async simulateBundle(bundle: JitoBundle): Promise<void> {
        console.log("Simulating verification of bundle...");

        for (const tx of bundle.transactions) {
            const result = await this.connection.simulateTransaction(tx);
            if (result.value.err) {
                console.error("Simulation failed for tx:", result.value.err);
                console.log("Logs:", result.value.logs);
                throw new JitoError(
                    "Transaction simulation failed",
                    "SIMULATION_FAILED",
                    { error: result.value.err, logs: result.value.logs }
                );
            }
        }
        console.log("Bundle simulation passed.");
    }

    /**
     * Sends a bundle of transactions via Jito Block Engine for atomic execution.
     * Includes automatic retry logic with exponential backoff.
     * @param bundle - Array of transactions to execute atomically
     * @param retryCount - Current retry attempt (used internally)
     */
    async sendBundle(
        bundle: JitoBundle,
        retryCount: number = 0
    ): Promise<BundleResult> {
        console.log(
            `Providing Inclusion Assurance via SolFabric (attempt ${retryCount + 1}/${this.maxRetries + 1})...`
        );

        // Serialize transactions to base64
        const serializedTxs = bundle.transactions.map((tx) =>
            Buffer.from(tx.serialize()).toString("base64")
        );

        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [serializedTxs],
        };

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(`${this.jitoUrl}/api/v1/bundles`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new JitoError(
                    `Jito HTTP Error: ${response.status} ${response.statusText}`,
                    `HTTP_${response.status}`,
                    { body: errorText }
                );
            }

            const data = await response.json();

            if (data.error) {
                // Check if this is a retriable error
                if (
                    this.isRetriableError(data.error) &&
                    retryCount < this.maxRetries
                ) {
                    console.warn(
                        `Retriable error encountered: ${data.error.message}. Retrying...`
                    );
                    await this.sleep(this.getBackoffDelay(retryCount));
                    return this.sendBundle(bundle, retryCount + 1);
                }

                throw new JitoError(
                    `Jito API Error: ${data.error.message}`,
                    data.error.code?.toString(),
                    data.error.data
                );
            }

            console.log("✓ Bundle accepted by Jito Block Engine");
            console.log(`  Bundle ID: ${data.result}`);

            return {
                bundleId: data.result,
                accepted: true,
            };
        } catch (error: any) {
            // Handle timeout
            if (error.name === "AbortError") {
                if (retryCount < this.maxRetries) {
                    console.warn("Request timed out. Retrying...");
                    await this.sleep(this.getBackoffDelay(retryCount));
                    return this.sendBundle(bundle, retryCount + 1);
                }
                throw new JitoError("Request timed out", "TIMEOUT", {
                    attempts: retryCount + 1,
                });
            }

            // Handle network errors with retry
            if (
                this.isNetworkError(error) &&
                retryCount < this.maxRetries
            ) {
                console.warn(`Network error: ${error.message}. Retrying...`);
                await this.sleep(this.getBackoffDelay(retryCount));
                return this.sendBundle(bundle, retryCount + 1);
            }

            // If it's already a JitoError, rethrow
            if (error instanceof JitoError) {
                throw error;
            }

            // Wrap unknown errors
            throw new JitoError(
                `SolFabric Bundle Error: ${error.message}`,
                "UNKNOWN_ERROR",
                { originalError: error, attempts: retryCount + 1 }
            );
        }
    }

    /**
     * Check the status of a submitted bundle
     */
    async getBundleStatus(bundleId: string): Promise<BundleStatusResponse> {
        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "getBundleStatuses",
            params: [[bundleId]],
        };

        try {
            const response = await fetch(`${this.jitoUrl}/api/v1/bundles`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new JitoError(
                    `Failed to get bundle status: ${response.status}`,
                    `HTTP_${response.status}`
                );
            }

            const data = await response.json();

            if (data.error) {
                throw new JitoError(
                    `Bundle status error: ${data.error.message}`,
                    data.error.code?.toString()
                );
            }

            const bundleStatus = data.result?.value?.[0];

            if (!bundleStatus) {
                return { status: "pending" };
            }

            // Map Jito status to our enum
            let status: BundleStatusResponse["status"] = "pending";
            if (bundleStatus.confirmation_status === "confirmed") {
                status = "landed";
            } else if (bundleStatus.err) {
                status = "failed";
            }

            return {
                status,
                landedSlot: bundleStatus.slot,
                transactions: bundleStatus.transactions,
                error: bundleStatus.err,
            };
        } catch (error: any) {
            if (error instanceof JitoError) {
                throw error;
            }
            throw new JitoError(
                `Failed to check bundle status: ${error.message}`,
                "STATUS_CHECK_FAILED"
            );
        }
    }

    /**
     * Wait for a bundle to be confirmed (with timeout)
     */
    async confirmBundle(
        bundleId: string,
        timeoutMs: number = 60000,
        pollIntervalMs: number = 2000
    ): Promise<BundleStatusResponse> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const status = await this.getBundleStatus(bundleId);

            if (status.status === "landed") {
                console.log(
                    `✓ Bundle confirmed at slot ${status.landedSlot}`
                );
                return status;
            }

            if (status.status === "failed" || status.status === "invalid") {
                throw new JitoError(
                    `Bundle ${status.status}`,
                    status.status.toUpperCase(),
                    { bundleId, error: status.error }
                );
            }

            // Still pending, wait and retry
            await this.sleep(pollIntervalMs);
        }

        throw new JitoError(
            "Bundle confirmation timeout",
            "CONFIRMATION_TIMEOUT",
            { bundleId, timeoutMs }
        );
    }

    /**
     * Subscribes to the ShredStream for low-latency updates.
     */
    async subscribeToShreds(callback: (shred: any) => void): Promise<void> {
        // TODO: Implement gRPC connection
        console.log("Connecting to high-velocity ShredStream...");
        console.log("ShredStream implementation coming soon...");
    }

    // Helper methods

    private isRetriableError(error: any): boolean {
        const retriableCodes = [
            -32005, // Node is behind
            -32603, // Internal error
            429, // Rate limit
        ];
        return retriableCodes.includes(error.code);
    }

    private isNetworkError(error: any): boolean {
        return (
            error.code === "ECONNREFUSED" ||
            error.code === "ENOTFOUND" ||
            error.code === "ETIMEDOUT" ||
            error.message?.includes("fetch failed")
        );
    }

    private getBackoffDelay(retryCount: number): number {
        // Exponential backoff: 1s, 2s, 4s
        return Math.min(1000 * Math.pow(2, retryCount), 8000);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
