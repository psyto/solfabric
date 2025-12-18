import { VersionedTransaction } from "@solana/web3.js";
export interface JitoBundle {
    transactions: VersionedTransaction[];
    tip?: number;
}
export interface BundleResult {
    bundleId: string;
    accepted: boolean;
    signatures?: string[];
    error?: string;
    confirmedAt?: number;
}
export interface BundleStatusResponse {
    status: "pending" | "landed" | "failed" | "invalid";
    landedSlot?: number;
    transactions?: string[];
    error?: string;
}
export interface JitoTipAccount {
    address: string;
    name: string;
}
export declare enum JitoRegion {
    Default = "default",
    Amsterdam = "amsterdam",
    Frankfurt = "frankfurt",
    NewYork = "ny",
    Tokyo = "tokyo"
}
export interface JitoConfig {
    blockEngineUrl: string;
    region?: JitoRegion;
    maxRetries?: number;
    timeout?: number;
}
export declare const JITO_TIP_ACCOUNTS: Record<JitoRegion, JitoTipAccount[]>;
export declare const JITO_BLOCK_ENGINE_URLS: {
    mainnet: string;
    devnet: string;
};
export declare class JitoError extends Error {
    code?: string | undefined;
    details?: any | undefined;
    constructor(message: string, code?: string | undefined, details?: any | undefined);
}
