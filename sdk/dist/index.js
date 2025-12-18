"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolFabric = exports.TipLevel = void 0;
const web3_js_1 = require("@solana/web3.js");
const jito_1 = require("./jito");
__exportStar(require("./jito"), exports);
var TipLevel;
(function (TipLevel) {
    TipLevel[TipLevel["None"] = 0] = "None";
    TipLevel[TipLevel["Low"] = 1000] = "Low";
    TipLevel[TipLevel["Medium"] = 10000] = "Medium";
    TipLevel[TipLevel["High"] = 100000] = "High";
    TipLevel[TipLevel["VeryHigh"] = 1000000] = "VeryHigh";
    TipLevel[TipLevel["Turbo"] = 10000000] = "Turbo";
})(TipLevel || (exports.TipLevel = TipLevel = {}));
class SolFabric {
    constructor(config) {
        this.connection = new web3_js_1.Connection(config.endpoint);
        this.jitoUrl =
            config.jitoBlockEngineUrl || jito_1.JITO_BLOCK_ENGINE_URLS.mainnet;
        this.jitoRegion = config.jitoRegion || jito_1.JitoRegion.Default;
        this.maxRetries = config.maxRetries || 3;
        this.timeout = config.timeout || 30000;
    }
    /**
     * Get a random Jito tip account for the configured region
     */
    getRandomTipAccount() {
        const accounts = jito_1.JITO_TIP_ACCOUNTS[this.jitoRegion];
        const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];
        return new web3_js_1.PublicKey(randomAccount.address);
    }
    /**
     * Create a tip instruction for Jito bundles
     */
    createTipInstruction(payer, tipAmount = TipLevel.Medium) {
        const tipAccount = this.getRandomTipAccount();
        return web3_js_1.SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: tipAccount,
            lamports: tipAmount,
        });
    }
    /**
     * Calculate dynamic tip based on priority level and network conditions
     */
    calculateDynamicTip(priority, multiplier = 1) {
        return Math.floor(priority * multiplier);
    }
    /**
     * Simulates a bundle of transactions to verify they would succeed.
     * Useful for testing without a real Jito Key/Block Engine.
     */
    async simulateBundle(bundle) {
        console.log("Simulating verification of bundle...");
        for (const tx of bundle.transactions) {
            const result = await this.connection.simulateTransaction(tx);
            if (result.value.err) {
                console.error("Simulation failed for tx:", result.value.err);
                console.log("Logs:", result.value.logs);
                throw new jito_1.JitoError("Transaction simulation failed", "SIMULATION_FAILED", { error: result.value.err, logs: result.value.logs });
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
    async sendBundle(bundle, retryCount = 0) {
        console.log(`Providing Inclusion Assurance via SolFabric (attempt ${retryCount + 1}/${this.maxRetries + 1})...`);
        // Serialize transactions to base64
        const serializedTxs = bundle.transactions.map((tx) => Buffer.from(tx.serialize()).toString("base64"));
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
                throw new jito_1.JitoError(`Jito HTTP Error: ${response.status} ${response.statusText}`, `HTTP_${response.status}`, { body: errorText });
            }
            const data = await response.json();
            if (data.error) {
                // Check if this is a retriable error
                if (this.isRetriableError(data.error) &&
                    retryCount < this.maxRetries) {
                    console.warn(`Retriable error encountered: ${data.error.message}. Retrying...`);
                    await this.sleep(this.getBackoffDelay(retryCount));
                    return this.sendBundle(bundle, retryCount + 1);
                }
                throw new jito_1.JitoError(`Jito API Error: ${data.error.message}`, data.error.code?.toString(), data.error.data);
            }
            console.log("✓ Bundle accepted by Jito Block Engine");
            console.log(`  Bundle ID: ${data.result}`);
            return {
                bundleId: data.result,
                accepted: true,
            };
        }
        catch (error) {
            // Handle timeout
            if (error.name === "AbortError") {
                if (retryCount < this.maxRetries) {
                    console.warn("Request timed out. Retrying...");
                    await this.sleep(this.getBackoffDelay(retryCount));
                    return this.sendBundle(bundle, retryCount + 1);
                }
                throw new jito_1.JitoError("Request timed out", "TIMEOUT", {
                    attempts: retryCount + 1,
                });
            }
            // Handle network errors with retry
            if (this.isNetworkError(error) &&
                retryCount < this.maxRetries) {
                console.warn(`Network error: ${error.message}. Retrying...`);
                await this.sleep(this.getBackoffDelay(retryCount));
                return this.sendBundle(bundle, retryCount + 1);
            }
            // If it's already a JitoError, rethrow
            if (error instanceof jito_1.JitoError) {
                throw error;
            }
            // Wrap unknown errors
            throw new jito_1.JitoError(`SolFabric Bundle Error: ${error.message}`, "UNKNOWN_ERROR", { originalError: error, attempts: retryCount + 1 });
        }
    }
    /**
     * Check the status of a submitted bundle
     */
    async getBundleStatus(bundleId) {
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
                throw new jito_1.JitoError(`Failed to get bundle status: ${response.status}`, `HTTP_${response.status}`);
            }
            const data = await response.json();
            if (data.error) {
                throw new jito_1.JitoError(`Bundle status error: ${data.error.message}`, data.error.code?.toString());
            }
            const bundleStatus = data.result?.value?.[0];
            if (!bundleStatus) {
                return { status: "pending" };
            }
            // Map Jito status to our enum
            let status = "pending";
            if (bundleStatus.confirmation_status === "confirmed") {
                status = "landed";
            }
            else if (bundleStatus.err) {
                status = "failed";
            }
            return {
                status,
                landedSlot: bundleStatus.slot,
                transactions: bundleStatus.transactions,
                error: bundleStatus.err,
            };
        }
        catch (error) {
            if (error instanceof jito_1.JitoError) {
                throw error;
            }
            throw new jito_1.JitoError(`Failed to check bundle status: ${error.message}`, "STATUS_CHECK_FAILED");
        }
    }
    /**
     * Wait for a bundle to be confirmed (with timeout)
     */
    async confirmBundle(bundleId, timeoutMs = 60000, pollIntervalMs = 2000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const status = await this.getBundleStatus(bundleId);
            if (status.status === "landed") {
                console.log(`✓ Bundle confirmed at slot ${status.landedSlot}`);
                return status;
            }
            if (status.status === "failed" || status.status === "invalid") {
                throw new jito_1.JitoError(`Bundle ${status.status}`, status.status.toUpperCase(), { bundleId, error: status.error });
            }
            // Still pending, wait and retry
            await this.sleep(pollIntervalMs);
        }
        throw new jito_1.JitoError("Bundle confirmation timeout", "CONFIRMATION_TIMEOUT", { bundleId, timeoutMs });
    }
    /**
     * Subscribes to the ShredStream for low-latency updates.
     */
    async subscribeToShreds(callback) {
        // TODO: Implement gRPC connection
        console.log("Connecting to high-velocity ShredStream...");
        console.log("ShredStream implementation coming soon...");
    }
    // Helper methods
    isRetriableError(error) {
        const retriableCodes = [
            -32005, // Node is behind
            -32603, // Internal error
            429, // Rate limit
        ];
        return retriableCodes.includes(error.code);
    }
    isNetworkError(error) {
        return (error.code === "ECONNREFUSED" ||
            error.code === "ENOTFOUND" ||
            error.code === "ETIMEDOUT" ||
            error.message?.includes("fetch failed"));
    }
    getBackoffDelay(retryCount) {
        // Exponential backoff: 1s, 2s, 4s
        return Math.min(1000 * Math.pow(2, retryCount), 8000);
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.SolFabric = SolFabric;
