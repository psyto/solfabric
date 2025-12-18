"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JitoError = exports.JITO_BLOCK_ENGINE_URLS = exports.JITO_TIP_ACCOUNTS = exports.JitoRegion = void 0;
var JitoRegion;
(function (JitoRegion) {
    JitoRegion["Default"] = "default";
    JitoRegion["Amsterdam"] = "amsterdam";
    JitoRegion["Frankfurt"] = "frankfurt";
    JitoRegion["NewYork"] = "ny";
    JitoRegion["Tokyo"] = "tokyo";
})(JitoRegion || (exports.JitoRegion = JitoRegion = {}));
// Jito tip accounts per region (mainnet-beta)
exports.JITO_TIP_ACCOUNTS = {
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
exports.JITO_BLOCK_ENGINE_URLS = {
    mainnet: "https://mainnet.block-engine.jito.wtf",
    devnet: "https://dallas.devnet.block-engine.jito.wtf",
};
class JitoError extends Error {
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "JitoError";
    }
}
exports.JitoError = JitoError;
