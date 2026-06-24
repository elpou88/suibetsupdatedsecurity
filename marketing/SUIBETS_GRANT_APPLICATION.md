# SuiBets — Sui Foundation Grant Application

## Project Name
SuiBets — Decentralized Sportsbook on Sui

## Project URL
https://suibets.com

## Category
DeFi / Consumer Application / Sports Betting

## Requested Amount
$100,000 USD (Developer Grant — upper tier)

---

## Executive Summary

SuiBets is the first fully on-chain sports betting platform built natively on Sui Network. Every bet creates a real Move object on Sui mainnet. Every settlement executes on-chain. Every bet is verifiable on SuiVision. We are live on mainnet with 900+ simultaneous markets, covering 8+ sports plus esports.

SuiBets is a showcase of Sui's technical capabilities — we use more Sui primitives in production than arguably any other project in the ecosystem: ZK Login, Walrus Storage, Walrus Sites, SuiNS, PTBs, UpgradeCap, Dynamic Fields, on-chain objects, oracle signing, and three native currencies (SUI, SBETS, USDSUI).

---

## Problem Statement

Existing crypto betting platforms are Web2 sportsbooks with a token added. Funds sit in centralized wallets users don't control. Settlement is manual. Odds can be manipulated without transparency. Users cannot verify if payouts were fair or if the house played fair.

Traditional sports betting is a $200B+ global industry dominated by opaque, centralized operators. Users have no way to verify odds fairness, bet settlement, or fund custody.

---

## Solution — What We Built

### On-Chain Bet Objects
When a user places a bet, we create a real Move object on Sui mainnet containing:
- Wallet address as owner
- Stake amount locked inside
- Odds frozen at placement
- Match details and unique betObjectId
- Fully viewable and verifiable on SuiVision

### Smart Contract Evolution (3 versions via UpgradeCap)
- **v1**: Core betting — place_bet, settle_bet, void_bet (SUI only)
- **v2**: Multi-currency support with SBETS token
- **v3**: USDSUI stablecoin with 6-decimal precision via Dynamic Field patterns

### Walrus Storage — Permanent Bet Records
All bet data stored on Walrus — Sui's decentralized storage layer. Dual-layer data permanence: on-chain bet object + Walrus storage. Censorship-resistant. Walrus Receipts provide shareable proof of every bet.

### ZK Login — Frictionless Onboarding
Sign in with Google, Facebook, or Twitch. Zero seed phrases. Zero wallet downloads. Zero-to-betting in under 30 seconds.

### SuiNS Integration
Human-readable .sui names across leaderboards, profiles, bet history, and chat.

### Full Feature Set (all live on mainnet):
- **Gift Bets** — Send bets to any wallet as gifts
- **Copy Bet** — One-tap copy of any bet from leaderboards or shared links
- **Shared Bets / Social Betting** — Every bet shareable as a public link
- **P2P Chat / Messaging** — Built-in messaging system
- **Hot Potato P2E** — Play-to-earn game mode with on-chain treasury
- **Prediction Markets** — Crypto prices, Sui events, sports milestones
- **AI Betting Intelligence** — 9 analysis modules (arbitrage, sharp money, value bets, odds movement, auto-betting)
- **NFT Trophies** — On-chain achievement NFTs
- **Bonuses / Promotions** — Welcome bonus, signup bonus, risk-free bets, VIP tiers, referral program, affiliate program
- **SBETS Buyback & Burn** — Automated deflationary mechanism via Cetus DEX
- **Dividends** — Real yield from platform revenue to SBETS holders
- **Parlay Engine** — Up to 10-leg parlays with live cashout
- **Live Streaming** — 15+ sports with ad stripping
- **Leaderboard & Activity Feed** — Real-time platform activity
- **Settlement Transparency Dashboard** — Every settlement visible and auditable

### Automated Settlement Engine
- 10+ sports data providers
- 400+ football fixtures with real bookmaker odds
- NBA, EuroLeague, F1, tennis, cricket, MMA, hockey, baseball, esports, American football, rugby, handball, volleyball, AFL
- 900+ markets tracked simultaneously
- Advanced team matching (Unicode NFD normalization, fuzzy word-overlap, cup match logic)
- Fully automated: game finishes → score verified → on-chain TX → payout to wallet

---

## Sui Ecosystem Integration Depth

| Sui Feature | How SuiBets Uses It |
|---|---|
| Move Objects | Every bet is an on-chain Move object |
| PTBs (Programmable Transaction Blocks) | Atomic bet placement + settlement |
| UpgradeCap | 3 smart contract versions deployed |
| Dynamic Fields | USDSUI 6-decimal precision support |
| ZK Login | Google/Facebook/Twitch onboarding |
| Walrus Storage | Permanent decentralized bet records |
| Walrus Sites | Decentralized frontend hosting |
| Walrus Receipts | Shareable bet proof documents |
| SuiNS | Human-readable names platform-wide |
| SuiVision | Every bet verifiable by betObjectId |
| SBETS Token | Native platform token with buyback/burn |
| USDSUI | Stablecoin betting with 6-decimal precision |

No other project in the Sui ecosystem uses this many Sui-native primitives in production.

---

## Technical Architecture

### Frontend
- React + Vite + TypeScript
- Deployed on Walrus Sites (.wal.app) with custom domain (suibets.com)
- Responsive design with real-time data

### Backend
- Node.js + Express + TypeScript
- PostgreSQL with Drizzle ORM (parameterized queries, zero SQL injection)
- Real-time sports data aggregation from 10+ providers

### Smart Contracts
- Sui Move language
- 3 deployed versions on mainnet via UpgradeCap
- Oracle-signed bet validation
- Atomic settlement with impossibility of double payouts

### Security
- Oracle-signed bets with stake limits and odds caps
- Atomic database-level balance checks
- Settlement caps (15M SBETS / 150 SUI per cycle)
- SQL-level state machine for bet transitions
- Rate limiting, CORS whitelist, CSP headers
- Full input sanitization
- Clean security audit (0 critical findings)

---

## Market Opportunity

- Global sports betting market: $200B+ annually
- Crypto betting growing 40%+ YoY
- Sui's sub-second finality makes it uniquely suited for live betting
- No credible fully on-chain competitor exists

---

## Team

Solo developer with full-stack expertise covering blockchain, frontend, backend, smart contracts, and infrastructure. Months of continuous development producing a production-ready platform live on mainnet.

---

## Use of Funds

| Allocation | Amount | Purpose |
|---|---|---|
| Liquidity Bootstrap | $40,000 | Seed liquidity for SUI/SBETS/USDSUI markets |
| Infrastructure | $20,000 | Servers, API subscriptions (sports data), Walrus storage |
| Security Audit | $15,000 | Professional Move contract audit |
| Marketing & Growth | $15,000 | Community building, partnerships, events |
| Development | $10,000 | Continued feature development and maintenance |

---

## Milestones

| Milestone | Timeline | Deliverable |
|---|---|---|
| M1: Liquidity Stabilization | Month 1 | Stable markets with sufficient depth |
| M2: Professional Audit | Month 2 | Completed Move contract audit report |
| M3: User Growth to 1,000 | Month 3 | 1,000 active wallets with organic growth |
| M4: Cross-ecosystem Partnerships | Month 4 | Integrations with 3+ Sui ecosystem projects |
| M5: Mobile App Launch | Month 5 | React Native mobile app on mainnet |

---

## Why Sui Foundation Should Fund SuiBets

1. **Deepest Sui integration** — We use more Sui primitives than any other project
2. **Live on mainnet** — Not a whitepaper, not a testnet demo. Live with 900+ markets.
3. **Showcase value** — SuiBets demonstrates what's possible on Sui to developers, investors, and users
4. **Consumer-facing** — Sports betting brings mainstream users to Sui
5. **ZK Login adoption** — We drive ZK Login usage, proving Sui's UX advantage
6. **Walrus adoption** — We're an active Walrus storage consumer
7. **Revenue-generating** — Built-in house edge, buyback/burn, and dividend model

---

## Links

- **Website**: https://suibets.com
- **Walrus Sites**: Available on .wal.app
- **Technical Deep Dive**: https://suibets.hashnode.dev/how-we-built-the-most-advanced-decentralized-sportsbook-on-sui
- **Technical Article**: https://telegra.ph/SuiBets--The-Most-Advanced-Decentralized-Sportsbook-on-Sui-04-06

---

## Contact

Available via X (Twitter), Discord, and email for any follow-up questions or technical deep dives.
