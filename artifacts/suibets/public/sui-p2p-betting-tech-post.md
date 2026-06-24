# How We Built Trustless P2P Sports Betting on Sui — No House, No Edge, Pure Order Book

*A deep technical breakdown of SuiBets: escrow via owned objects, parallel parlay settlement, and HIP-4 inspired volume tiers — all on Sui mainnet.*

---

## Why Sui for P2P Betting?

Most blockchain betting protocols solve the wrong problem. They port the traditional casino model on-chain: a smart contract acts as the house, users bet against a treasury, and the protocol takes a margin. You still lose to the house — it's just a transparent house now.

We wanted something different: **pure peer-to-peer wagering where the protocol is a matchmaker, not a counterparty**. No treasury to drain. No house edge. Odds set by the market. When the better read the game, they win. When they misread it, their counterpart wins.

Sui's object model and parallel transaction execution make this architecture dramatically cleaner than it would be on EVM chains.

---

## The Core Design: Order Book on Chain

SuiBets is a **limit-order-book for sports bets**. A creator posts an offer:

```
Creator stakes: 0.10 SUI
Prediction: Manchester United wins (home)
Odds: 2.5x
Taker must stake: 0.10 × (2.5 − 1) = 0.15 SUI
```

The taker who accepts gets 0.15 SUI exposure on "Manchester United does NOT win." Both sides are locked in a symmetric, zero-sum bet with no house profit. The platform takes a 2% fee from the winner — that's it.

### The P2POffer Object

When a creator posts a bet, the Sui Move contract mints a `P2POffer` **shared object**:

```move
public struct P2POffer has key {
    id: UID,
    creator: address,
    event_id: String,
    prediction: String,      // "home" | "away" | "draw"
    odds: u64,               // scaled 1e6 (e.g. 2500000 = 2.5x)
    creator_stake: u64,      // in MIST
    taker_stake: u64,        // creator_stake × (odds − 1e6)
    escrow: Coin<SUI>,       // creator's funds locked in the object itself
    status: u8,              // 0 = open, 1 = filled, 2 = settled, 3 = voided
    taker: Option<address>,
    registry_id: ID,
}
```

The creator's SUI is immediately transferred into the object's `escrow` field at creation time. This is a key Sui primitive: **coins live inside objects, not in separate escrow contracts**. There's no `approve()` dance, no ERC-20 allowance to manage. The funds are provably locked the moment the transaction executes.

### Accepting a Bet: Atomic State Transition

When a taker accepts, a single Move transaction:

1. Takes the taker's `Coin<SUI>` as input
2. Verifies taker_stake matches the offer's required amount
3. Sets `offer.taker = Some(taker_address)`
4. Sets `offer.status = Filled`
5. Merges taker's coin into the offer's escrow: `coin::join(&mut offer.escrow, taker_coin)`

No intermediate state. Either the entire operation succeeds atomically or it reverts. The filled `P2POffer` object now holds **both sides' stakes** — a self-contained escrow capsule.

---

## Settlement: Oracle-Driven, Verifiable

Settlement is where most decentralized betting protocols compromise. They either rely on a centralized oracle (trusting one party) or use a prediction market mechanism (complex, slow, expensive).

We use a two-layer approach:

### Layer 1: Sports Data Aggregation

Our backend continuously polls ESPN's free API and API-Sports, normalizing results into a `settled_events` table:

```sql
CREATE TABLE settled_events (
  event_id TEXT UNIQUE,
  home_score INTEGER,
  away_score INTEGER,
  result TEXT,          -- 'home' | 'away' | 'draw'
  settled_at TIMESTAMP
);
```

Every 5 minutes, the P2P settlement worker queries:

```typescript
const pendingMatches = await db
  .select()
  .from(p2pBetMatches)
  .leftJoin(p2pBetOffers, eq(p2pBetMatches.offerId, p2pBetOffers.id))
  .where(and(
    eq(p2pBetMatches.status, 'active'),
    lt(p2pBetOffers.matchDate, new Date()),
  ));

for (const match of pendingMatches) {
  const result = await lookupEventResult(match.offer.eventId);
  if (!result) continue; // not yet settled
  
  const winner = determineWinner(match.offer.prediction, result);
  await settleMatch(match, winner);
}
```

### Layer 2: On-Chain Payout

Settlement calls the Move contract's `settle_bet` function using an **Oracle Capability** — a Sui owned object held by the platform admin:

```move
public fun settle_bet(
    oracle_cap: &OracleCap,     // proves caller is authorized oracle
    config: &BettingConfig,
    registry: &mut BettingRegistry,
    offer: &mut P2POffer,
    winner: address,
    ctx: &mut TxContext,
) {
    assert!(offer.status == STATUS_FILLED, ENotFilled);
    
    let total_pot = coin::value(&offer.escrow);
    let fee = total_pot * config.platform_fee_bps / 10_000;
    let payout = total_pot - fee;
    
    // Transfer payout to winner
    let payout_coin = coin::split(&mut offer.escrow, payout, ctx);
    transfer::public_transfer(payout_coin, winner);
    
    // Fee to treasury
    if (fee > 0) {
        let fee_coin = coin::split(&mut offer.escrow, fee, ctx);
        transfer::public_transfer(fee_coin, config.treasury);
    }
    
    offer.status = STATUS_SETTLED;
}
```

The `OracleCap` pattern is a Sui-native authorization primitive. Because it's an **owned object** (not a shared object), accessing it requires no consensus overhead — it's validated at the per-object level. Only the wallet holding that cap can call `settle_bet`. This gives us centralized oracle speed with cryptographic ownership guarantees.

---

## P2P Parlays: Sui Parallel Execution Shines

Parlays are the most technically interesting part. A parlay bet has multiple legs — the creator must win all legs, the taker needs just one creator loss.

In traditional EVM contracts, you'd need a sequential loop to check each leg, or a complex state machine that waits for all results. On Sui, we exploit **parallel transaction execution**.

### Leg Structure

Each parlay is a `P2PParlayOffer` shared object containing an array of legs:

```move
public struct ParlayLeg has store {
    event_id: String,
    prediction: String,
    odds: u64,
    status: u8,   // 0 = pending, 1 = won, 2 = lost
}

public struct P2PParlayOffer has key {
    id: UID,
    creator: address,
    taker: Option<address>,
    legs: vector<ParlayLeg>,
    total_odds: u64,          // product of all leg odds
    creator_stake: u64,
    taker_stake: u64,
    escrow: Coin<SUI>,
    legs_settled: u8,
    status: u8,
}
```

### Independent Leg Settlement

Each leg can be settled **independently and in parallel** because:

1. Legs reference different events (`event_id` is unique per match)
2. Each settlement transaction touches only the specific leg index
3. Sui's object-level parallelism allows concurrent transactions on the same shared object for **commutative operations** (incrementing `legs_settled` is not commutative, but leg status writes to separate vector indices are)

In practice, our settlement worker fires parallel transactions for each leg that's ready:

```typescript
const legSettlements = pendingLegs.map(leg => 
  settleParlayLeg(parlayOffer, leg.legIndex, result)
);

// All execute concurrently — Sui handles the ordering
await Promise.all(legSettlements);
```

Once all legs have status ≠ pending, a final `finalize_parlay` call determines the winner:
- If any leg is LOST → taker wins the entire pot
- If all legs are WON → creator wins the entire pot

The total odds represent the creator's edge: betting 0.10 SUI at 2.5 × 3.0 × 1.8 = 13.5x means the taker stakes 1.25 SUI against the creator's 0.10 SUI. The payout math is always zero-sum.

---

## HIP-4 Inspired: Volume Fee Tiers

We took inspiration from Hyperliquid's HIP-4 proposal (volume-based maker rebates) and adapted it for P2P sports betting.

Every wallet accrues lifetime volume across both maker (creator) and taker positions. Higher volume unlocks lower fees and eventually negative maker fees (rebates):

| Tier | Maker Volume | Taker Fee | Maker Fee |
|------|-------------|-----------|-----------|
| Bronze | < 100 SUI | 2.0% | 0% |
| Silver | 100–500 SUI | 1.5% | −0.1% |
| Gold | 500–2000 SUI | 1.25% | −0.25% |
| Platinum | 2000–10k SUI | 1.0% | −0.4% |
| Elite | > 10k SUI | 0.75% | −0.5% |

At Elite tier, **makers earn a 0.5% rebate** for posting liquidity to the order book. This creates a flywheel: active offer creators are incentivized, order book depth grows, takers get better odds diversity, volume increases.

The fee calculation runs off-chain (for gas efficiency) and is verified against the wallet's `p2p_volume_stats` record before each bet:

```typescript
export function getFeeTier(lifetimeVolume: number): FeeTier {
  if (lifetimeVolume >= 10_000) return TIERS.elite;
  if (lifetimeVolume >= 2_000)  return TIERS.platinum;
  if (lifetimeVolume >= 500)    return TIERS.gold;
  if (lifetimeVolume >= 100)    return TIERS.silver;
  return TIERS.bronze;
}

export function calcSingleMatchPayout(
  creatorStake: number,
  odds: number,
  takerStake: number,
  creatorTier: FeeTier,
  takerTier: FeeTier,
): PayoutResult {
  const grossPot = creatorStake + takerStake;
  // Creator wins: taker pays fee, maker gets rebate
  const creatorWinPayout = grossPot
    - (takerStake * takerTier.takerFeeRate)
    + (creatorStake * Math.abs(Math.min(0, creatorTier.makerFeeRate)));
  // Taker wins: taker pays fee on their side
  const takerWinPayout = grossPot
    - (creatorStake * takerTier.takerFeeRate);
  return { creatorWinPayout, takerWinPayout, grossPot };
}
```

---

## What We Didn't Build (And Why)

### No AMM / CPMM

Automated market makers work well for token swaps but poorly for sports betting because implied probabilities are dynamic. A 2.0x odds offer posted 72 hours before kickoff is stale data after the starting lineup drops. The order book model lets participants update or cancel their offers — AMM positions can't be repriced.

### No Prediction Market Token

We don't mint YES/NO tokens per event. Tokens require liquidity bootstrapping, create secondary market complexity, and add smart contract surface area. The direct P2P escrow model has a simpler security model: the only thing that can go wrong is the oracle reporting the wrong result.

### No zkProofs for Oracle Verification

ZK-based oracle verification (proving off-chain sports data matches an on-chain commitment) is theoretically appealing but practically overkill for this use case. The oracle attack surface is: "What if the platform reports the wrong winner?" The answer is: reputation + on-chain settlement history. Every settled bet's result is publicly verifiable on Suiscan. Systematic oracle manipulation would be instantly detectable and self-defeating.

---

## What's Live on Mainnet

As of today:

- **Package**: `0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59`
- **Config**: `0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf`
- **Registry**: `0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d`

A fully automated E2E test creates a real on-chain offer and accepts it end-to-end in under 10 seconds:

```
✅ On-chain TX: 77cEoE3LPCqpxhiUbYcTUBsJmy4qpGz4tDJjGy56FuGC
✅ P2POffer object: 0xd38b18baabce52db61d8392172ca513897fbde8c4b8be456bac7676fbb6896cd
✅ Offer created in DB — id=3, status=open
✅ Offer accepted — match id=2, status=active, stake=0.01
✅ Creator's offer found (status=filled)
✅ Taker's match found (status=active)

ALL STEPS PASSED
```

Both transactions are visible on [Suiscan](https://suiscan.xyz/mainnet/tx/77cEoE3LPCqpxhiUbYcTUBsJmy4qpGz4tDJjGy56FuGC) with no intermediary.

---

## The Road Ahead

- **Oracle decentralization**: Integrate Pyth or Switchboard for sports results to remove the single-point oracle trust assumption
- **Partial fills**: Allow takers to fill a fraction of an offer (e.g., take 0.05 SUI of a 0.10 SUI offer), enabling larger market depth
- **On-chain settlement verification**: Move the winner determination logic into the Move contract with a Merkle proof of the sports result
- **Cross-chain offers**: Wormhole-bridged offers where the creator stakes SUI and the taker stakes ETH, with atomic cross-chain settlement

---

*SuiBets is open for betting at [www.suibets.com](https://www.suibets.com). The order book is live on Sui mainnet. Post an offer, find a counterparty, and let the match decide.*
