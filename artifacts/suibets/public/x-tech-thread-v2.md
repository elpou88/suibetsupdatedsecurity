# SuiBets Technical Thread v2 — Patterns Never Seen on Sui Before

---

**Tweet 1 — Hook**

we shipped 5 on-chain patterns on Sui that i've never seen anyone else do.

not theoretical. all live on mainnet.

contract: 0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59

thread 🧵

---

**Tweet 2 — Generic Coin Type P2P Order Book**

1/ generic coin-type order book

```move
public fun create_offer<T>(
  config: &mut P2PConfig,
  registry: &mut P2PRegistry,
  stake: Coin<T>,
  odds_bps: u64,
  clock: &Clock,
  ctx: &mut TxContext,
): P2POffer<T>
```

one contract handles SUI, USDC, SBETS, any future token.
no separate deployments per asset.
the type parameter IS the asset selector.

---

**Tweet 3 — Individual Escrow Objects Per Bet**

2/ individual matched-bet objects

every accepted offer creates its own `P2PMatchedBet<T>` object on-chain.

not a mapping. not an array index. a real Sui object with its own ID.

this means:
→ taker gets a receipt they own
→ settlement targets the object directly
→ no shared mutable state between bets

zero contention between concurrent settlements.

---

**Tweet 4 — Parallel Parlay Execution**

3/ parlays that actually use Sui's parallel execution

in every other chain a parlay is a serial loop.
on Sui, each leg is an independent object.

```move
// These can be submitted in parallel PTBs — no ordering required
settle_parlay_leg<T>(oracle_cap, parlay, leg_index=0, won=true, clock)
settle_parlay_leg<T>(oracle_cap, parlay, leg_index=1, won=false, clock)
settle_parlay_leg<T>(oracle_cap, parlay, leg_index=2, won=true, clock)

// Then finalize once all legs are done
instant_settle_parlay<T>(oracle_cap, config, registry, parlay, maker_wins, clock)
```

a 5-leg parlay settles as fast as a 1-leg parlay.
that's sui parallel execution doing real work, not just marketing.

---

**Tweet 5 — HIP-4 Volume Tier Maker Rebates**

4/ on-chain maker rebates via volume tiers (HIP-4)

fee isn't flat. it's determined by your 90-day volume:

Bronze: taker pays 2.00%, maker +0%
Silver: taker pays 1.50%, maker +0%
Gold:   taker pays 1.00%, maker −0.10% rebate
Diamond:taker pays 0.75%, maker −0.20% rebate
Elite:  taker pays 0.50%, maker −0.30% rebate

the maker's net fee can go NEGATIVE.
high-volume market makers get PAID to post liquidity.

this is central-limit-order-book economics on a Move smart contract.

---

**Tweet 6 — Multi-Sig Fee Withdrawal**

5/ two-key fee withdrawal without multisig wallets

most protocols use a single admin key for treasury.
we use two separate capabilities:

```move
// Step 1: AdminCap proposes withdrawal → creates shared WithdrawalProposal
propose_withdrawal<T>(admin_cap, config, amount, recipient, clock)

// Step 2: OracleCap executes it (different key, different hardware)
execute_withdrawal<T>(oracle_cap, config, proposal, clock)
```

neither key alone can move funds.
both keys compromised simultaneously = only then can an attacker withdraw.

treasury security without multisig infrastructure.

---

**Tweet 7 — Bag-Based Multi-Token Fee Vault**

6/ one vault, every token

fee accumulation uses Sui's `Bag` — a heterogeneous map typed by coin type:

```move
struct P2PConfig has key, store {
  fee_vault: Bag,  // Bag<TypeTag, Balance<T>>
  ...
}
```

when you settle a SUI bet, SUI fees go into fee_vault.
when you settle a USDC bet, USDC fees accumulate separately.
one config object. all tokens. no separate treasury per asset.

---

**Tweet 8 — Stale Object Version Auto-Retry**

7/ stale object version retry at the service layer

Sui shared objects (P2PConfig, P2PRegistry) get version-bumped every transaction.
concurrent settlement calls hit "object version unavailable for consumption."

we fixed this without changing the contract:

```typescript
for (let attempt = 1; attempt <= 3; attempt++) {
  if (attempt > 1) await delay(1500 * attempt);
  const tx = new Transaction(); // fresh TX = fresh object version fetch
  tx.moveCall({ target: '...::instant_settle_parlay', ... });
  const result = await signAndExecute(tx);
  if (result.success) return result;
  if (!isVersionMismatch(result.error)) return result; // real error, don't retry
}
```

rebuilding the Transaction object forces the SDK to re-fetch the latest version from RPC.
zero contract changes. zero downtime. works across ALL our on-chain calls now.

---

**Tweet 9 — Instant Settlement via OracleCap**

8/ oracle bypasses the dispute window

standard flow: settle → 2h dispute → claim
oracle flow: instant_settle_bet → paid immediately

```move
public fun instant_settle_bet<T>(
  _cap: &OracleCap,  // capability gates this path
  config: &mut P2PConfig,
  registry: &mut P2PRegistry,
  bet: P2PMatchedBet<T>,
  maker_wins: bool,
  clock: &Clock,
  ctx: &mut TxContext,
)
```

OracleCap is a separate object from AdminCap.
oracle can settle instantly. oracle cannot withdraw fees.
principle of least privilege, in Move.

---

**Tweet 10 — The Bigger Picture**

this isn't theoretical.

all 8 patterns are running on Sui mainnet right now,
settling real bets, paying real winners.

no AMM. no house edge. no treasury risk.
just two people, a Move contract, and a match result.

www.suibets.com
contract: 0xd51fe1...b2e59

if you're building on Sui and any of these patterns help you —
use them. that's the point.

/end
