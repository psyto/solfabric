import { VersionedTransaction } from "@solana/web3.js";

export interface JitoBundle {
    transactions: VersionedTransaction[];
    tip?: number; // Lamports
}

export interface BundleResult {
    bundleId: string;
    accepted: boolean;
    signature?: string;
    error?: string;
}
