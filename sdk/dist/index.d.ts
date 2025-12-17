import { JitoBundle, BundleResult } from "./jito";
export interface SolFabricConfig {
    endpoint: string;
    jitoBlockEngineUrl: string;
    authKeypair?: Uint8Array;
}
export declare class SolFabric {
    private connection;
    private jitoUrl;
    constructor(config: SolFabricConfig);
    /**
     * Simulates a bundle of transactions to verify they would succeed.
     * Useful for testing without a real Jito Key/Block Engine.
     */
    simulateBundle(bundle: JitoBundle): Promise<void>;
    /**
     * Sends a bundle of transactions via Jito Block Engine for atomic execution.
     * @param bundle - Array of transactions to execute atomically
     */
    sendBundle(bundle: JitoBundle): Promise<BundleResult>;
    /**
     * Subscribes to the ShredStream for low-latency updates.
     */
    subscribeToShreds(callback: (shred: any) => void): Promise<void>;
}
