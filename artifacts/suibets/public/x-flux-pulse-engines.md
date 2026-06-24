# SuiBets — FLUX + PULSE Engine Drop (Tech Thread)

---

**Tweet 1 — Hook**

just shipped two new Move engines to Sui mainnet.

FLUX: fractional-fill order book. any number of takers split a maker's stake.
PULSE: pari-mutuel pools. odds shift in real time. zero house margin.

both live. both verified on-chain. thread 🧵

---

**Tweet 2 — FLUX: the problem it solves**

1/ classic P2P betting has a liquidity problem.

maker posts 100 SUI at 2x. taker needs 100 SUI to fill it. 99% of users can't participate.

FLUX fixes this with fractional fills.

one maker offer. unlimited takers. each fills whatever size they want. each gets their own FluxShard on-chain.

```move
public entry fun flux_create_offer<T>(
    stake:      Coin<T>,      // maker's full stake — escrowed on-chain
    event_id:   vector<u8>,
    prediction: vector<u8>,
    odds_bps:   u64,          // 20_000 = 2.0x
    min_shard:  u64,          // 0 = any size allowed
    stats:      &mut FluxStats,
    clock:      &Clock,
    ctx:        &mut TxContext,
)
```

the offer is a shared object. any wallet on Sui can fill it concurrently. Sui's parallel execution handles the contention.

---

**Tweet 3 — FLUX: fill → settle flow**

2/ the fill path is a two-step PTB chain.

`flux_fill_shard` returns a `FluxFillReceipt` — a PTB result object. you pipe it directly into `flux_confirm_fill` in the same transaction. one atomic round-trip.

```move
// Step 1: fill — returns PTB receipt (non-entry, chainable)
public fun flux_fill_shard<T>(
    offer:  &mut FluxOffer<T>,
    stake:  Coin<T>,
    clock:  &Clock,
    ctx:    &mut TxContext,
): FluxFillReceipt

// Step 2: confirm — consumes receipt, records fill on offer
public entry fun flux_confirm_fill<T>(
    offer:    &mut FluxOffer<T>,
    receipt:  FluxFillReceipt,
    stats:    &mut FluxStats,
    clock:    &Clock,
)
```

the `FluxFillReceipt` is a hot-potato: has no `drop`, no `store`. it MUST be consumed in the same PTB or the transaction aborts. impossible to fill without confirming.

settlement is shard-by-shard. oracle calls `flux_settle_shard` per shard. if 20 takers filled one offer, 20 independent settlements. each one atomic.

---

**Tweet 4 — PULSE: pari-mutuel on Sui**

3/ PULSE is a different model entirely.

no fixed odds. no maker. just two pools: SIDE_A and SIDE_B.

anyone stakes on either side. the pool ratio IS the odds. winner's pool splits the loser's pool proportionally at settlement.

if side_a = 100 SUI, side_b = 400 SUI:
- side_a wins → each side_a staker gets 4× their stake
- side_b wins → each side_b staker gets 1.25× their stake

market-clearing pricing. zero house margin. fully on-chain.

```move
public entry fun pulse_take_position<T>(
    pool:  &mut PulsePool<T>,
    stake: Coin<T>,
    side:  u8,               // 0 = SIDE_A, 1 = SIDE_B
    stats: &mut PulseStats,
    clock: &Clock,
    ctx:   &mut TxContext,
)
```

the pool is a shared object. concurrent stakes from any number of wallets hit Sui's shared-object consensus. the pool balance updates atomically after each fill.

---

**Tweet 5 — PULSE: the OracleCap version-race problem**

4/ the trickiest part of PULSE was settlement.

naive approach: two separate TXs — `pulse_lock_pool` then `pulse_settle_pool`.

problem: both functions take `&OracleCap`. an owned object. between TX 1 and TX 2, the OracleCap's version increments. TX 2 arrives with the old version reference — rejected by validators.

fix: combine both calls into ONE PTB. same `OracleCap` reference. one consensus round.

```typescript
const tx = new Transaction();

// lock + settle in one atomic PTB — same OracleCap ref, zero version race
tx.moveCall({
  target: `${PULSE_PKG}::pulse_engine::pulse_lock_pool`,
  arguments: [tx.object(ORACLE_CAP), tx.object(poolId), tx.object(CLOCK)],
});
tx.moveCall({
  target: `${PULSE_PKG}::pulse_engine::pulse_settle_pool`,
  arguments: [tx.object(ORACLE_CAP), tx.object(poolId), tx.pure.u8(0), ...],
});
// single executeTransactionBlock → atomic
```

both commands reference the same `ORACLE_CAP` object ID. PTB semantics guarantee they see the same version. no race. no retry logic needed.

this pattern applies to any owned capability object across sequential operations.

---

**Tweet 6 — Sui gas accumulator: the hidden footgun**

5/ deploying these found a Sui internals edge case worth documenting.

our oracle wallet uses a **gas accumulator** — a `dynamic_field::Field<accumulator::Key<Balance<SUI>>, U128>` — not a classic `Coin<SUI>`.

problem: after any settlement TX that sends SUI back to the oracle wallet, the payout lands as a new `Coin<SUI>` object. on the next TX, the Sui SDK auto-smashes ALL SUI coin objects into `gasData.payment`.

validator sees: `requested = full_combined_balance > available = balance − storage_rebates`. rejects with `InvalidWithdrawReservation`.

```typescript
// WRONG — SDK smashes payout coin into gas payment → reservation error
const tx = new Transaction();
const [coinA, coinB] = tx.splitCoins(tx.gas, [SEED_A, SEED_B]);
tx.moveCall({ ... pulse_create_pool, coinA, coinB ... });
```

fix: list payout coins as **explicit PTB inputs** before the split. explicit inputs are excluded from gas-payment smashing.

```typescript
// CORRECT — merge loose coins as explicit inputs first
const looseCoins = await getOwnedSuiCoinIds(address);
const tx = new Transaction();
if (looseCoins.length > 0) {
  // explicit input → SDK won't add to gasData.payment
  tx.mergeCoins(tx.gas, looseCoins.map(id => tx.object(id)));
}
const splitResult = tx.splitCoins(tx.gas, [SEED_A, SEED_B]);
const coinA = splitResult[0];   // index, not array destructure
const coinB = splitResult[1];
```

not documented anywhere. cost us hours. now it is.

---

**Tweet 7 — Three engines, one oracle**

6/ all three engines share one oracle wallet and one OracleCap:

```
WARP  — 0x9c36e734…  (batch settlement, 512 bets/PTB)
FLUX  — 0xfa76c707…  (fractional fills, per-shard atomic settle)
PULSE — 0x6ac71a60…  (pari-mutuel pools, dynamic odds)

OracleCap — 0x4319c676…  (non-copyable capability, all 3 engines)
Oracle    — 0xa93e1f30…  (one wallet signs for all settlement)
```

the `OracleCap` struct has no `copy`, no `store` — it can't be duplicated or stored in another object. every settlement across all three engines passes through the same physical key.

live verification: 11 on-chain TXs, 3 engines, one test run, 13.5 seconds.

WARP WarpStats: https://suiscan.xyz/mainnet/object/0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367
FLUX FluxStats: https://suiscan.xyz/mainnet/object/0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320
PULSE PulseStats: https://suiscan.xyz/mainnet/object/0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff

---

**Tweet 8 — Closing**

7/ what this enables:

WARP → high-frequency house settlement (512 bets/tx, 67% gas reduction)
FLUX → deep liquidity without whale-size requirements
PULSE → permissionless prediction markets with on-chain odds discovery

three settlement primitives. one P2P sports betting app. no house edge.

whitepaper: suibets.app/whitepaper
contracts verified on suiscan.

@SuiNetwork @MystenLabs

$SUI
