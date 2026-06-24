# X Thread — SuiBets P2P Tech Drop

---

**[1/14]**
we built trustless P2P sports betting on @SuiNetwork with no house, no edge, pure order book

here's the full technical breakdown 🧵

---

**[2/14]**
most "defi betting" is just a casino on-chain

the house takes margin. you still lose to it. the only thing that changed is the treasury is a smart contract instead of a Vegas vault

we wanted something different: pure P2P. the protocol is a matchmaker, not a counterparty

---

**[3/14]**
the design: a limit order book for sports bets

creator posts:
→ 0.10 SUI on Man Utd to win
→ odds: 2.5x
→ taker must stake: 0.10 × (2.5 − 1) = 0.15 SUI

taker takes the opposite side. zero-sum. no house profit. platform charges 2% from the winner only

---

**[4/14]**
when a creator posts a bet, our Move contract mints a P2POffer shared object

the creator's SUI goes directly into an `escrow: Coin<SUI>` field on the object itself

no approve() dance. no ERC-20 allowance. funds are provably locked the moment the TX executes

this is Sui's object model doing exactly what it was designed for

---

**[5/14]**
when a taker accepts:

1. their Coin<SUI> comes in as TX input
2. contract verifies stake matches required amount
3. `coin::join(&mut offer.escrow, taker_coin)`
4. offer.status = Filled

one atomic TX. the filled P2POffer now holds BOTH sides' stakes — a self-contained escrow capsule

---

**[6/14]**
settlement uses an OracleCap pattern

OracleCap is an owned object held by our admin wallet. because it's owned (not shared), accessing it requires zero consensus overhead — validated at the per-object level

only the wallet holding the cap can call settle_bet. centralized oracle speed, cryptographic ownership proof

---

**[7/14]**
sports results come from ESPN free API + API-Sports, normalized into a settled_events table

every 5 min our settlement worker scans active matches, looks up results, determines winner, calls settle_bet on-chain

every settled result is publicly verifiable on suiscan — systematic oracle manipulation is instantly detectable and self-defeating

---

**[8/14]**
parlays are where Sui really shines

each leg references a different event_id. each leg can be settled independently using separate TX inputs

Sui's object-level parallelism lets our settlement worker fire concurrent TXs for all ready legs simultaneously

```ts
const legSettlements = pendingLegs.map(leg =>
  settleParlayLeg(parlayOffer, leg.legIndex, result)
)
await Promise.all(legSettlements) // Sui handles ordering
```

on EVM this would be a sequential loop. on Sui it's parallel execution

---

**[9/14]**
parlay logic:

creator must win ALL legs → creator wins the pot
any single leg lost by creator → taker wins the entire pot

total odds = product of all leg odds. 2.5 × 3.0 × 1.8 = 13.5x

taker stakes 0.10 × (13.5 − 1) = 1.25 SUI against creator's 0.10 SUI. fully symmetric. no house edge

---

**[10/14]**
fee model inspired by HIP-4 (Hyperliquid's maker rebate proposal)

volume tier table:

Bronze  (< 100 SUI): taker 2.0%, maker 0%
Silver  (100-500):   taker 1.5%, maker −0.1%  ← rebate starts
Gold    (500-2k):    taker 1.25%, maker −0.25%
Platinum (2k-10k):  taker 1.0%, maker −0.4%
Elite   (> 10k SUI): taker 0.75%, maker −0.5%

at Elite, offer creators EARN 0.5% for posting liquidity

---

**[11/14]**
what we deliberately did NOT build:

❌ AMM/CPMM — sports odds are dynamic, AMM can't reprice mid-game
❌ YES/NO prediction tokens — adds liquidity bootstrapping complexity + extra attack surface
❌ ZK oracle verification — overkill. every settled bet is on-chain & auditable

simple > complex when the security model holds

---

**[12/14]**
live on @SuiNetwork mainnet right now

Package: 0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59
Config:  0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf

---

**[13/14]**
automated E2E test creates a real on-chain offer and accepts it in < 10 seconds

✅ post_offer TX on mainnet
✅ P2POffer object minted
✅ offer registered in DB
✅ taker accepts — match created
✅ both wallets verify activity

latest test TX: suiscan.xyz/mainnet/tx/CE6rU5chy7EuiUU4tSkBNpD4j4kgNS45QALVnJPzpt9w

---

**[14/14]**
the full technical deep-dive covers:

→ P2POffer object model
→ OracleCap settlement
→ parallel parlay execution
→ HIP-4 fee tier math with code
→ why we didn't use AMMs or ZK

SuiBets is live. place your first P2P bet 👇

www.suibets.com

/end
