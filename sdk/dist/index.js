"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolFabric = void 0;
const web3_js_1 = require("@solana/web3.js");
class SolFabric {
    constructor(config) {
        this.connection = new web3_js_1.Connection(config.endpoint);
        this.jitoUrl = config.jitoBlockEngineUrl;
    }
    /**
     * Sends a bundle of transactions via Jito Block Engine for atomic execution.
     * @param bundle - Array of transactions to execute atomically
     */
    async sendBundle(bundle) {
        console.log("Providing Inclusion Assurance via SolFabric...");
        // Serialize transactions to base64
        const serializedTxs = bundle.transactions.map(tx => Buffer.from(tx.serialize()).toString('base64'));
        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [serializedTxs]
        };
        try {
            const response = await fetch(`${this.jitoUrl}/api/v1/bundles`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Jito Error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (data.error) {
                return {
                    bundleId: "",
                    accepted: false,
                    error: data.error.message
                };
            }
            return {
                bundleId: data.result,
                accepted: true
            };
        }
        catch (error) {
            console.error("SolFabric Bundle Error:", error);
            return {
                bundleId: "",
                accepted: false,
                error: error.message || "Unknown error"
            };
        }
    }
    /**
     * Subscribes to the ShredStream for low-latency updates.
     */
    async subscribeToShreds(callback) {
        // TODO: Implement gRPC connection
        console.log("Connecting to high-velocity ShredStream...");
    }
}
exports.SolFabric = SolFabric;
