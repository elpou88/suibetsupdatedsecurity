# SuiBets — Trustless P2P Sports Betting on Sui

> **No house. No edge. Pure peer-to-peer.**  
> Every bet is a Move object. Every settlement executes on-chain. Every payout is atomic.

**[Live App](https://suibets.com)** · **[Whitepaper](https://suibets.com/whitepaper)** · **[Technical Deep Dive](https://suibets.com/tech)** · **[SuiVision](https://suivision.xyz/)**

---

## Sui Overflow 2026

| Field | Value |
|---|---|
| **Track** | DeFi · Consumer |
| **Network** | Sui Mainnet |
| **Status** | Live in production |
| **Demo video** | [`sbets.mp4`](./sbets.mp4) |
| **Contracts** | 4 Move packages deployed on mainnet (see below) |

---

## What is SuiBets?

SuiBets is the first fully trustless P2P sports betting exchange on any blockchain. Users bet **against each other** at maker-defined odds — the platform is a matchmaker, not a counterparty. No treasury. No house edge. No admin settlement.

When a user places a bet, the Sui Move runtime mints a **real on-chain object** that locks their stake, freezes their odds, and records their wallet address — all verifiable on SuiVision before the game even starts.

---

## The Problem

Most "DeFi" betting platforms are centralised sportsbooks with a token added:

- Funds sit in wallets users don't control
- Settlement is manual — an admin clicks "pay"
- "Decentralised" means there's a token, not decentralised infrastructure
- Users cannot verify odds fairness or settlement correctness

**We fixed all of it by making the bet itself a blockchain object.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SuiBets Platform                              │
├─────────────────┬─────────────────────┬──────────────────────────────── ┤
│  React + Vite   │  Express 5 + PG     │  Sui Mainnet                    │
│  ZK Login auth  │  Drizzle ORM        │  4 Move packages                │
│  Walrus Sites   │  Sports data feeds  │  PTBs + TTO + Hot Potato        │
│  SuiNS names    │  Settlement engine  │  ZK Login · Walrus · DeepBook   │
└─────────────────┴─────────────────────┴─────────────────────────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
       p2p_betting           WARP              FLUX / PULSE
       (order book)     (batch settle)    (fractional fill / AMM)
```

---

## The Three Engines

### p2p_betting — The Core Order Book
The base layer. A creator posts a `P2POffer<T>` shared object with their stake locked inside at creation time (no ERC-20 `approve()` dance). A taker accepts with a matching `Coin<T>`. Oracle signs settlement. Winner receives funds directly from the escrow field via PTB.

**Key innovations:**
- `P2POffer<T>` — generic over any Sui coin (SUI, SBETS, USDC)
- `P2PMatchedBet<T>` — independent per-fill objects (partial fills native)
- `P2PParlay<T>` — multi-leg wager in a single object, all legs settled in parallel
- `P2PRegistry` — fully on-chain order book (shared object, every open offer ID)
- HIP-4 maker rebates — 5 volume tiers, Elite tier pays makers negative net fees
- SuiNS-gated offers — private challenges only a specific `.sui` name can accept
- Live-bet anti-courtsiding — score snapshot on offer creation, auto-cancel on goal

### WARP Engine — Weighted Atomic Resolution Protocol
`0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747`

**Transfer-to-Object (TTO) payouts:** Each user has a `WarpEscrow` owned object. Winnings are delivered via `sui::transfer::receive` — no shared-object consensus. Settlement executes at single-validator speed (~50 ms).

**Batch PTB settlement:** One oracle PTB settles up to 512 bets paying a single gas fee. A failed bet rolls back the entire batch — the PTB execution model makes partial settlement a type error, not a runtime bug. Gas savings: ~95% at scale.

**`warp_spend_from_escrow` returns `Coin<T>`:** A public (non-entry) function chains escrow → coin → post_offer in one PTB signature. An 8-leg parlay that used to require 10 transactions is now 1.

### FLUX Engine — Fractional Liquidity Utilization eXchange
`0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018`

**`FluxFillReceipt` hot potato:** The receipt has zero abilities — no `store`, no `copy`, no `drop`. It **must** be consumed in the same PTB it's created in. Impossible to leave funds stuck mid-fill. EVM requires two transactions for this; Sui PTBs are one atomic envelope.

**FluxShards:** One large maker offer fragments into N micro-positions. 100 takers × 10 SUI each fill a 1,000 SUI offer in minutes.

**`flux_batch_close`:** WARP-style batch settlement. 512 shards → 1 oracle TX → ~99% gas reduction.

### PULSE Engine — Pari-mutuel Under-Liquidity Shifting Engine
`0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238`

**On-chain AMM for sports:** Dynamic odds are a live on-chain function of demand — `side_odds = total_pool / side_pool` — repriced every single bet. No house, no order book, no market maker.

**`PulsePosition<T>` tradeable NFT:** Your sports bet is a liquid owned object with `store`. List it on BlueMove mid-game and sell your position before the match ends. First tradeable bet NFT on any blockchain.

---

## Sui Primitives Used in Production

| Primitive | How SuiBets Uses It |
|---|---|
| **PTBs** | Atomic bet placement + batch settlement (512 bets / 1 gas) |
| **Transfer-to-Object (TTO)** | Oracle credits winnings to owned escrow — zero shared-object consensus |
| **Hot Potato** | `FluxFillReceipt` — structurally impossible to leave fills incomplete |
| **Move 2024 Enums** | `OfferStatus`, `BetStatus`, `LegStatus` — typed over u8, upgrade-safe |
| **Dynamic Fields** | Multi-coin escrow via `Bag`, HIP-4 volume stats, USDSUI 6-decimal state |
| **UpgradeCap** | 3 p2p_betting contract versions deployed; WARP/FLUX/PULSE as satellites |
| **Generic Types** | `P2POffer<T>`, `P2PMatchedBet<T>`, `WarpEscrow<T>` accept any Sui coin |
| **Shared Objects** | `P2PRegistry` (order book), `P2PConfig` (fee vault), all pool objects |
| **Owned Objects** | `WarpEscrow`, `PulsePosition` NFTs, `OracleCap` — no consensus for oracle ops |
| **Cross-package auth** | `p2p_betting::OracleCap` passed by reference into WARP, FLUX, and PULSE |
| **ZK Login** | Google + Apple onboarding — wallet from OAuth in ~15 seconds |
| **Passkeys** | `PasskeyKeypair` with `BrowserPasskeyProvider` — Face ID / Touch ID signing |
| **Walrus Storage** | All settled bet receipts archived as immutable blobs (blobId + checkpointSeq) |
| **Walrus Sites** | Decentralised frontend hosting on `.wal.app` |
| **SuiNS** | Human-readable `.sui` names on leaderboards + VIP-gated private challenges |
| **DeepBook v3** | Every P2P offer mirrored as a limit order for on-chain price discovery |
| **Mysticeti v2** | DAG-based BFT consensus — 35% throughput boost leveraged by batch PTBs |
| **sui::clock** | Offer expiry enforced on-chain (cannot accept an expired offer) |
| **sui::event** | Every lifecycle event emitted — full transparent audit trail |

No other project in the Sui ecosystem uses this many Sui-native primitives in a single production system.

---

## Deployed Contracts (Mainnet)

| Contract | Package ID | Explorer |
|---|---|---|
| **p2p_betting** (v2) | `0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59` | [SuiScan](https://suiscan.xyz/mainnet/object/0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59) |
| **WARP Engine** | `0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747` | [SuiScan](https://suiscan.xyz/mainnet/object/0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747) |
| **FLUX Engine** | `0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018` | [SuiScan](https://suiscan.xyz/mainnet/object/0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018) |
| **PULSE Engine** | `0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238` | [SuiScan](https://suiscan.xyz/mainnet/object/0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238) |

### Shared Objects

| Object | ID |
|---|---|
| P2P Registry | `0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d` |
| P2P Config | `0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf` |
| WARP Stats | `0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367` |
| FLUX Stats | `0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320` |
| PULSE Stats | `0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff` |
| Oracle Cap | `0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55` |

---

## Features

- **P2P Order Book** — maker posts offer at custom odds; taker fills opposite side
- **P2P Parlays** — multi-leg parlays with Sui parallel execution per leg
- **WARP Batch Settlement** — 512 bets settled in one PTB, TTO payouts
- **FLUX Fractional Fills** — one large offer filled by N independent takers
- **PULSE Pari-mutuel AMM** — dynamic odds pool, no order book, no house
- **ZK Login** — sign in with Google/Apple, wallet created in 15 seconds
- **Passkeys** — Face ID / Touch ID with PasskeyKeypair (Secure Enclave)
- **Walrus Receipts** — every settled bet permanently archived as an NFT-mintable blob
- **SuiNS VIP Gating** — offers only claimable by holders of specific `.sui` names
- **DeepBook Bridge** — P2P offers mirrored on-chain for price discovery
- **Live Anti-courtsiding** — score snapshots prevent oracle front-running mid-game
- **Leaderboard + Activity Feed** — real-time on-chain transparency
- **Settlement Transparency Dashboard** — every payout publicly auditable

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Smart Contracts** | Sui Move 2024 — 4 packages, ~3,800 lines |
| **Frontend** | React + Vite + TypeScript + TailwindCSS |
| **Backend** | Node.js + Express 5 + TypeScript |
| **Database** | PostgreSQL + Drizzle ORM |
| **Blockchain SDK** | `@mysten/sui` v2.13.4 |
| **Auth** | ZK Login (Google/Apple) + PasskeyKeypair |
| **Storage** | Walrus (decentralised bet receipts) |
| **DEX** | DeepBook v3 (on-chain price discovery) |
| **Naming** | SuiNS (`@mysten/suins`) |
| **Sports Data** | ESPN free API + API-Sports (10+ providers) |
| **Build** | esbuild + pnpm workspaces monorepo |

---

## Repository Structure

```
contracts/
├── p2p_betting/        # Core P2P order book (~1,900 lines Move)
├── warp_engine/        # Batch settlement + TTO escrow (~470 lines)
├── flux_engine/        # Fractional fills + hot potato (~700 lines)
└── pulse_engine/       # Pari-mutuel AMM + tradeable NFT positions (~740 lines)
artifacts/
├── api-server/         # Express 5 backend (settlement, sports data, WebSocket)
└── suibets/            # React frontend
shared/
└── schema.ts           # Drizzle ORM schema (single source of truth)
```

---

## Running Locally

**Prerequisites:** Node.js 20+, pnpm, PostgreSQL

```bash
# 1. Install dependencies
pnpm install

# 2. Set environment variables
#    DATABASE_URL, ADMIN_PRIVATE_KEY, ADMIN_WALLET_ADDRESS

# 3. Run database migrations
cd artifacts/api-server && node scripts/migrate.js

# 4. Start API server (port 8080)
pnpm --filter @workspace/api-server run dev

# 5. Start frontend (port 5000)
pnpm --filter @workspace/suibets run dev
```

---

## Why This Wins

**Technical depth:** Four independently deployed Move packages using TTO, hot potato, generic types, cross-package capability passing, PTB chaining, and Move 2024 enums — simultaneously in production.

**Mainnet-live:** Not a testnet demo. Real users. Real stakes. Every bet object verifiable on SuiVision right now.

**Primitive density:** No other project uses ZK Login + Passkeys + Walrus + SuiNS + DeepBook + PTB batch settlement + TTO + hot potato in a single system.

**P2P model:** The smart contract is a matchmaker, not a counterparty. There is no house. There is no treasury to drain. The protocol cannot be insolvent.

---

## Team

Solo developer. Full-stack: Move smart contracts, React frontend, Node.js backend, infrastructure, sports data pipelines, and blockchain integrations — all built and maintained by one person.

---

## Links

- **Live app:** https://suibets.com
- **Technical deep dive:** https://suibets.com/tech
- **Whitepaper:** https://suibets.com/whitepaper
- **X (Twitter):** [@SuiBets](https://x.com/SuiBets)
- **Settlement transparency:** https://suibets.com/settlement
- **Demo video:** [`sbets.mp4`](./sbets.mp4)
