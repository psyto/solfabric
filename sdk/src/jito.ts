import { VersionedTransaction } from "@solana/web3.js";

export interface JitoBundle {
    transactions: VersionedTransaction[];
    tip?: number; // Lamports (optional, will use default if not provided)
}

export interface BundleResult {
    bundleId: string;
    accepted: boolean;
    signatures?: string[];
    error?: string;
    confirmedAt?: number; // Slot number when confirmed
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

export enum JitoRegion {
    Default = "default",
    Amsterdam = "amsterdam",
    Frankfurt = "frankfurt",
    NewYork = "ny",
    Tokyo = "tokyo",
}

export interface JitoConfig {
    blockEngineUrl: string;
    region?: JitoRegion;
    maxRetries?: number;
    timeout?: number; // milliseconds
}

// Jito tip accounts per region (mainnet-beta)
export const JITO_TIP_ACCOUNTS: Record<JitoRegion, JitoTipAccount[]> = {
    [JitoRegion.Default]: [
        {
            address: "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
            name: "Jito Tip 1",
        },
        {
            address: "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
            name: "Jito Tip 2",
        },
        {
            address: "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
            name: "Jito Tip 3",
        },
        {
            address: "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
            name: "Jito Tip 4",
        },
        {
            address: "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
            name: "Jito Tip 5",
        },
        {
            address: "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
            name: "Jito Tip 6",
        },
        {
            address: "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
            name: "Jito Tip 7",
        },
        {
            address: "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
            name: "Jito Tip 8",
        },
    ],
    [JitoRegion.Amsterdam]: [
        {
            address: "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
            name: "Amsterdam Tip 1",
        },
    ],
    [JitoRegion.Frankfurt]: [
        {
            address: "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
            name: "Frankfurt Tip 1",
        },
    ],
    [JitoRegion.NewYork]: [
        {
            address: "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
            name: "New York Tip 1",
        },
    ],
    [JitoRegion.Tokyo]: [
        {
            address: "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
            name: "Tokyo Tip 1",
        },
    ],
};

// Jito Block Engine URLs
export const JITO_BLOCK_ENGINE_URLS = {
    mainnet: "https://mainnet.block-engine.jito.wtf",
    devnet: "https://dallas.devnet.block-engine.jito.wtf",
};

export class JitoError extends Error {
    constructor(
        message: string,
        public code?: string,
        public details?: any
    ) {
        super(message);
        this.name = "JitoError";
    }
}
