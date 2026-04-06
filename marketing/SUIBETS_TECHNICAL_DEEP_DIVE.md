# How We Built the Most Technically Advanced Decentralized Sportsbook on Sui

![SuiBets](https://suibets.com/images/suibets-logo.png)

**SuiBets** — The first fully on-chain sports betting platform built natively on Sui Network.

Every bet. Every payout. Every settlement. Executed directly on the Sui blockchain.

---

## The Problem With Crypto Betting Today

Most "crypto betting" platforms are Web2 sportsbooks with a token slapped on:

- Your funds sit in a centralized wallet you don't control
- Settlement is manual — some admin clicks "pay" days later
- "Decentralized" means they have a token, not decentralized infrastructure
- You can't verify if odds were fair or if payouts were correct

**We fixed all of it.**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   SuiBets Platform                       │
├────────────┬──────────────┬──────────────┬──────────────┤
│  Frontend  │  API Server  │  Settlement  │  Streaming   │
│  React/TS  │  Express 5   │   Engine     │   Service    │
│  Walrus    │  PostgreSQL  │  10+ APIs    │  15+ Sports  │
├────────────┴──────┬───────┴──────────────┴──────────────┤
│                   │                                      │
│    Sui Mainnet    │    Move Smart Contracts (v3)         │
│    PTBs           │    $SUI / $SBETS / $USDSUI          │
│    On-Chain Bets  │    Dynamic Fields / UpgradeCap      │
└───────────────────┴──────────────────────────────────────┘
```

---

## On-Chain Bet Objects

When you place a bet on SuiBets, we don't write a row in a database. We create a **real Move object** on Sui's mainnet.

This object contains:
- **Your wallet address** as the object owner
- **Stake amount** locked inside the object
- **Odds** frozen at the moment of placement
- **Unique `betObjectId`** verifiable on any Sui explorer

Your bet exists independently of our platform. It's not an IOU. It's a blockchain object that proves exactly what you bet, when you bet it, and at what odds — before the game even starts.

### Smart Contract Evolution

We've deployed **three versions** of our Move smart contracts via Sui's `UpgradeCap` mechanism:

| Version | What It Added |
|---------|--------------|
| **v1** | Core betting: `place_bet`, `settle_bet`, `void_bet` for SUI |
| **v2** | Multi-currency: SBETS token support with dedicated functions |
| **v3** | USDSUI (6 decimals) via `UsdsuiKey`/`UsdsuiState` dynamic field pattern |

Each upgrade was executed on-chain. Each is auditable. Each is immutable.

**Contract addresses:**
```
Package v3:  0x2e354642a3c00571832c03c42575587a0ca38cfe02e4f84cb3404cc9eab403d3
Platform:    0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9
SBETS Token: 0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502
USDSUI:      0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1
```

---

## Programmable Transaction Blocks (PTBs)

Sui's PTBs are arguably the most underutilized feature in the ecosystem. Most projects use them for simple transfers. **We compose complex multi-step operations into single atomic transactions.**

**Bet Placement (1 TX):**
```
Lock stake → Create bet object → Emit event
```

**Settlement (1 TX):**
```
Verify result → Transfer payout → Update state
```

If any step fails, everything reverts. There are no partial states. No stuck funds. No edge cases where your money is in limbo. Ever.

---

## Automated Settlement Engine

This is the engineering challenge that separates real sportsbooks from toy projects.

### Data Pipeline

Our backend polls **10+ sports data providers** covering:
- ⚽ Football (400+ fixtures with real bookmaker odds)
- 🏀 Basketball (NBA, EuroLeague, international)
- 🏎️ Formula 1 (race results, qualifying, sprint)
- 🎾 Tennis (ATP, WTA, Grand Slams)
- 🏏 Cricket (international, IPL, T20)
- 🥊 MMA/UFC
- 🏒 Ice Hockey (NHL, international)
- ⚾ Baseball (MLB, international)
- 🎮 Esports (League of Legends, Dota 2)
- 🏈 American Football, Rugby, Handball, Volleyball, AFL

**900+ live markets** tracked simultaneously.

### The Team Matching Problem

Nobody talks about this, but it's one of the hardest problems in sports betting:

"Manchester United" vs "Man Utd" vs "Man United" — how do you match teams across different data sources?

Our settlement engine uses:

1. **Unicode NFD Normalization** — `ç→c`, `é→e`, `ï→i` (Beşiktaş → Besiktas)
2. **Year Suffix Stripping** — "FC Porto 1893" → "FC Porto"
3. **Suffix Removal** — "Minas W" → "Minas" (women's team markers)
4. **Fuzzy Word-Overlap Matching** — Handles partial names, abbreviations, alternate spellings
5. **Cup Match Logic** — PEN/AET → winner forced to "draw" for 1X2 markets (only fulltime score used), while preserving actual scores for O/U, BTTS, and Correct Score markets

### Settlement Flow

```
Game Finishes
     │
     ▼
Score Data Verified (multiple source cross-check)
     │
     ▼
Team Names Matched (NFD normalization + fuzzy matching)
     │
     ▼
Bet Outcome Determined (market-specific logic)
     │
     ▼
On-Chain Settlement TX Submitted (PTB)
     │
     ▼
Payout Transferred → Directly to Winner's Wallet
```

**No admin approval. No delays. Fully automated.**

### Score Extraction

Sports APIs return scores in wildly different formats. Our `extractNumericScore()` handler processes:
- Plain numbers
- Objects with `.total`, `.score`, `.points`
- Sum of individual period/set keys when `.total` is null
- Volleyball-specific set counting (comparing per-set point scores rather than summing total points)

---

## Parlay Engine

### Cross-Sport, Multi-Day Parlays

Combine **up to 10 legs** across ANY sport in one bet slip:

```
Leg 1: Manchester City to win (Football)        @ 1.80
Leg 2: Verstappen to win (F1)                    @ 2.10
Leg 3: Lakers to win (NBA)                       @ 1.65
Leg 4: T1 to win (League of Legends)             @ 1.45
────────────────────────────────────────────────────────
Combined Odds: 8.97x  |  10,000 SBETS → 89,700 SBETS
```

Each leg settles independently as games finish.

### Live Cashout with Time-Aware Decay

Our cashout system tracks per-leg status in real-time. The formula:

```
cashOutValue = stake × wonOddsProduct × (wonWeight + pendingWeight × impliedProb) × hedgeFactor
```

Where:
- `wonWeight` scales from 0.40 (no legs won) to 0.85 (all-but-one won)
- `impliedProb = 1 / pendingOddsProduct`
- `hedgeFactor = 0.85` (15% house edge on cashout)

**Time decay mirrors real sportsbooks:**

| Bet Age | Decay |
|---------|-------|
| 0-2 hours | ~0% (minimal) |
| 2-12 hours | 5-15% |
| 12-48 hours | 15-30% |
| 48+ hours | Up to 50% (floor) |

**Won legs dynamically increase cashout value.** If you hit 3 out of 4 legs, your cashout is significantly higher than after just 1 leg.

### Atomic Cashout Execution

```
1. Calculate cashout amount (with time decay + leg status)
2. Deduct 2% platform fee
3. Update bet status to 'cashed_out' in DB (ATOMIC — prevents double-payout)
4. Submit on-chain payout TX to user's wallet
5. If TX fails before submission → revert to 'pending' (user can retry)
6. If TX submitted but unconfirmed → keep 'cashed_out' (admin verifies)
```

Double-payouts are **mathematically impossible**.

---

## Real-Time Odds

### API-Sports Ultra Plan

We pay for premium data. The odds you see on SuiBets come from **real bookmaker markets** — not algorithms generating fake numbers.

- **1,900+ fixtures** with pre-match odds cached across 5 days
- **Bulk live in-play odds** fetched every 30 seconds (single API call for all live fixtures)
- **Score-based fallback odds** for events without API coverage — winning team dynamically gets lower odds based on score differential + match minute
- **Security caps**: Floor at 1.01, ceiling at 51.00 — no manipulation possible

### Odds Pipeline

```
API-Sports Ultra Plan
        │
        ▼
Pre-match Odds Cache (1,900+ fixtures, 5-day window)
        │
        ▼
Live In-Play Odds (bulk fetch every 30s)
        │
        ▼
Score-Based Fallback (for uncovered events)
        │
        ▼
Security Caps (1.01 floor, 51.00 ceiling)
        │
        ▼
User sees REAL odds
```

---

## Security Architecture

We built SuiBets assuming adversarial conditions from day one.

### Defense In Depth

| Layer | Protection |
|-------|-----------|
| **Oracle** | Bets are oracle-signed — stake limits + odds caps validated before signing. Rejected if `betAmountMist > maxStake` |
| **Database** | Atomic balance checks with DB-level race condition prevention. Concurrent withdrawals cannot overdraw |
| **Settlement** | Caps at 15M SBETS / 150 SUI per cycle (defense-in-depth) |
| **State Machine** | `pending → won/lost/void/cashed_out` with SQL-level transition validation. No invalid state changes possible |
| **API** | Rate limiting on all endpoints, CORS whitelist, CSP frame-ancestors, full input sanitization |
| **Contract** | Immutable Move logic, UpgradeCap controlled, audited |

### Bet State Machine

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
          ┌──────┐  ┌──────┐  ┌──────────┐
          │ won  │  │ lost │  │   void   │
          └──────┘  └──────┘  └──────────┘
              │
              ▼
        ┌───────────┐
        │ cashed_out│  (only from pending/in_play)
        └───────────┘
```

All transitions are validated at the database level. Attempting an invalid transition (e.g., `lost → won`) is rejected atomically.

---

## Live Streaming Integration

We integrated live sports streaming across **15+ sports**:

- **Primary:** SportsRC API — free, CORS-enabled, no API key
- **Fallback:** WeStream — used when primary is unavailable
- **Multi-level iframe chain following** (up to 3 levels deep) with `<base href>` injection
- **Ad stripping engine:** Removes tracking scripts, ad-domain content, popup scripts while preserving player functionality
- **Security:** Server-side URL validation, CSP restrictions, rate limiting on embed routes

---

## Decentralized Frontend on Walrus

Our entire frontend is deployed on **Walrus Sites** (`.wal.app`).

Not on AWS. Not on Vercel. On **Sui's own decentralized storage network**.

Even if our primary domain goes down, the app lives on Walrus — fully decentralized, fully unstoppable.

### Dual-Domain Architecture

```
suibets.com (primary)
       │
       ├── API requests → API server
       │
       ▼
*.wal.app (Walrus fallback)
       │
       ├── Automatic API routing to main domain
       │
       ▼
Same app, always available
```

---

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| **Blockchain** | Sui Mainnet (Move smart contracts, PTBs) |
| **Currencies** | $SUI, $SBETS, $USDSUI (all native on Sui) |
| **Frontend** | React + TypeScript + Vite |
| **Backend** | Express 5 + PostgreSQL + Drizzle ORM |
| **Validation** | Zod schemas with runtime type coercion |
| **Sports Data** | API-Sports Ultra Plan (10+ providers) |
| **Streaming** | SportsRC + WeStream (15+ sports) |
| **Frontend Hosting** | Walrus Sites (decentralized) |
| **Package Manager** | pnpm monorepo workspace |

---

## Numbers

| Metric | Value |
|--------|-------|
| Live Markets | 900+ |
| Sports Covered | 8 + Esports |
| Settlement Time | Sub-second |
| On-Chain Verification | 100% |
| Contract Versions | 3 (all on mainnet) |
| Odds Sources | Real bookmaker data |
| Max Parlay Legs | 10 |
| Currencies | 3 native on Sui |

---

## Links

- **App:** [suibets.com](https://suibets.com)
- **Walrus Frontend:** Available on `.wal.app`
- **Contract (v3):** [View on Sui Explorer](https://suiscan.xyz/mainnet/object/0x2e354642a3c00571832c03c42575587a0ca38cfe02e4f84cb3404cc9eab403d3)
- **SBETS Token:** [View on Sui Explorer](https://suiscan.xyz/mainnet/object/0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502)

---

## Built on Sui. Settled on Sui. Verified on Sui.

No custody. No middlemen. Just pure on-chain sports betting.

**$SUI | $SBETS | @SuiNetwork | @SuiFoundation**

---

*This article is part of the SuiBets technical documentation. For more information, visit [suibets.com](https://suibets.com).*
