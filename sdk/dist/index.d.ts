import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { JitoBundle, BundleResult, BundleStatusResponse, JitoRegion } from "./jito";
export * from "./jito";
export interface SolFabricConfig {
    endpoint: string;
    jitoBlockEngineUrl?: string;
    jitoRegion?: JitoRegion;
    jitoAuthKeypair?: Uint8Array;
    maxRetries?: number;
    timeout?: number;
    authKeypair?: Uint8Array;
}
export declare enum TipLevel {
    None = 0,
    Low = 1000,// 0.000001 SOL
    Medium = 10000,// 0.00001 SOL
    High = 100000,// 0.0001 SOL
    VeryHigh = 1000000,// 0.001 SOL
    Turbo = 10000000
}
export declare class SolFabric {
    private connection;
    private jitoUrl;
    private jitoRegion;
    private maxRetries;
    private timeout;
    constructor(config: SolFabricConfig);
    /**
     * Get a random Jito tip account for the configured region
     */
    getRandomTipAccount(): PublicKey;
    /**
     * Create a tip instruction for Jito bundles
     */
    createTipInstruction(payer: PublicKey, tipAmount?: number): TransactionInstruction;
    /**
     * Calculate dynamic tip based on priority level and network conditions
     */
    calculateDynamicTip(priority: TipLevel, multiplier?: number): number;
    /**
     * Simulates a bundle of transactions to verify they would succeed.
     * Useful for testing without a real Jito Key/Block Engine.
     */
    simulateBundle(bundle: JitoBundle): Promise<void>;
    /**
     * Sends a bundle of transactions via Jito Block Engine for atomic execution.
     * Includes automatic retry logic with exponential backoff.
     * @param bundle - Array of transactions to execute atomically
     * @param retryCount - Current retry attempt (used internally)
     */
    sendBundle(bundle: JitoBundle, retryCount?: number): Promise<BundleResult>;
    /**
     * Check the status of a submitted bundle
     */
    getBundleStatus(bundleId: string): Promise<BundleStatusResponse>;
    /**
     * Wait for a bundle to be confirmed (with timeout)
     */
    confirmBundle(bundleId: string, timeoutMs?: number, pollIntervalMs?: number): Promise<BundleStatusResponse>;
    /**
     * Subscribes to the ShredStream for low-latency updates.
     */
    subscribeToShreds(callback: (shred: any) => void): Promise<void>;
    private isRetriableError;
    private isNetworkError;
    private getBackoffDelay;
    private sleep;
}
