## Technical Specification: High-Performance DeFi Module Integration

This specification outlines the data flow and API interactions between the Lending liquidation engine (**Atomliq**), the Yield tokenization primitive (**YieldSplitter**), and the B2D infrastructure layer (**SolFabric**).

### 1. The SolFabric Execution Pipeline

**SolFabric** provides the underlying connectivity and execution assurance. It abstracts the complexity of Jito Block Engines and custom RPC nodes into a unified developer interface.

* **gRPC ShredStream:** Provides sub-millisecond market data by streaming partial blocks (shreds) before they are fully processed by standard RPCs.
* **Bundle Management:** SolFabric handles the construction, simulation, and submission of Jito Bundles to ensure transaction atomicity.
* **Warrantied Inclusion:** A reservation-based API that guarantees block space through direct validator coordination.

### 2. Atomliq: Atomic Liquidation Workflow

**Atomliq** leverages SolFabric to ensure that liquidations are never front-run and always execute at the intended price.

#### **The Execution Loop:**

1. **Monitor:** Atomliq uses SolFabric’s gRPC stream to monitor account health in real-time.
2. **Pull Price:** When a trigger is detected, it pulls the latest price from **Pyth** via a Pull Oracle request.
3. **Bundle Construction:** Atomliq constructs a 3-step bundle:
* **Tx 1:** Update Oracle price (Pull update).
* **Tx 2:** Execute Liquidation instruction.
* **Tx 3:** Jito Tip (to SolFabric’s tip account).


4. **Execute:** The bundle is sent via `SolFabric.sendBundle()`, guaranteeing the liquidation happens exactly at the price pulled in Tx 1.

### 3. YieldSplitter: Yield Stripping & AMM Management

**YieldSplitter** uses SolFabric to maintain its high-frequency SY-PT (Standard Yield to Principal Token) AMM.

* **Dynamic Curve Adjustment:** As SOL staking rates or MEV rewards fluctuate, YieldSplitter must adjust its AMM bonding curves.
* **Atomic Swaps:** Traders can swap between SOL and PT/YT. SolFabric ensures these multi-hop swaps are atomic, preventing the "partial fill" risk common in legacy cross-program invocations (CPI).
* **MEV-Aware Yields:** YieldSplitter explicitly tokenizes the MEV-boosted yields of **JitoSOL**, providing a pure "Fixed MEV Rate" product for institutional investors.

### 4. Integration Summary Table

| Feature | Atomliq (Lending) | YieldSplitter (Derivatives) | SolFabric (Infrastructure) |
| --- | --- | --- | --- |
| **Data Source** | Pyth Pull Oracle | JitoSOL / LST Staking Rates | gRPC ShredStream |
| **Execution Tool** | Jito Bundles (via SolFabric) | Parallel Swap Coordinator | Custom RPC / Block Engine |
| **Key Value** | Zero TOCTTOU Liquidation | Fixed-Rate Staking Yields | P99 Latency Stability |
| **Target User** | Lending Protocols / Bot Ops | Institutional Hedgers | Solo & Professional Devs |

---

### Strategic Roadmap: From Niche to Standard

1. **Phase 1 (SolFabric Alpha):** Launch dedicated RPCs with ShredStream access for HFT teams.
2. **Phase 2 (Atomliq Launch):** Integrate SolFabric with lending protocols to replace legacy "push" liquidation bots.
3. **Phase 3 (YieldSplitter Ecosystem):** Introduce PT/YT markets for JitoSOL, creating the first on-chain sovereign yield curve for Solana.
