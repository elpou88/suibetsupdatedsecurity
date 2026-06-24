# SuiBets Technical Thread v3 — 10 More Novel Patterns (All Live on Mainnet)

---

**Tweet 1 — Hook**

went deeper into the SuiBets P2P contract.

found 10 more patterns i haven't seen anywhere else on Sui.

none of these were in the last thread.

contract: 0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59

🧵

---

**Tweet 2 — UMA-style Optimistic Dispute Window in Move**

1/ the UMA oracle pattern. in Move. on Sui.

when the oracle settles a bet, it doesn't pay immediately. it opens a 2-hour challenge window:

```move
public entry fun queue_settlement<T>(
    _oracle_cap: &OracleCap,
    bet: &mut P2PMatchedBet<T>,
    winner: address,
    clock: &Clock,
) {
    bet.status         = STATUS_SETTLING;
    bet.pending_winner = option::some(winner);
    bet.settle_queued_at = clock::timestamp_ms(clock);

    event::emit(BetSettleQueued {
        bet_id:       object::id(bet),
        pending_winner: winner,
        settle_due_ms: now + config.dispute_window_ms,
        timestamp:    now,
    });
}
```

during the window anyone — any wallet — can dispute:

```move
public entry fun dispute_settlement<T>(
    bet: &mut P2PMatchedBet<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(bet.status == STATUS_SETTLING, EBetNotSettling);
    assert!(!bet.disputed, EBetAlreadyDisputed);

    bet.disputed = true;
    bet.disputer = option::some(ctx.sender());
    bet.status   = STATUS_DISPUTED;

    event::emit(BetDisputed { bet_id: object::id(bet), disputer: ctx.sender(), ... });
}
```

oracle resolves the flag and resets the window. if no dispute: anyone calls `claim_settlement` to release funds.

the window is admin-configurable down to 0ms (instant mode) without redeploying.

UMA does this on Polygon with a 2-day window. we do it in Move in 2 hours.

---

**Tweet 3 — Per-Wallet Volume as Dynamic Fields on Shared Object**

2/ fee tiers computed fully on-chain. no off-chain oracle. no separate contract.

every wallet's lifetime volume lives as a dynamic field directly on the shared `P2PConfig` object:

```move
public struct VolumeKey has copy, drop, store { addr: address }

public struct WalletVolume has store {
    maker_volume: u64,
    taker_volume: u64,
    total_bets:   u64,
    wins:         u64,
}

fun add_taker_volume(config: &mut P2PConfig, wallet: address, amount: u64) {
    if (!dynamic_field::exists_(&config.id, VolumeKey { addr: wallet })) {
        dynamic_field::add(
            &mut config.id,
            VolumeKey { addr: wallet },
            WalletVolume { maker_volume: 0, taker_volume: amount, total_bets: 1, wins: 0 }
        );
    } else {
        let wv = dynamic_field::borrow_mut<VolumeKey, WalletVolume>(
            &mut config.id, VolumeKey { addr: wallet }
        );
        wv.taker_volume = wv.taker_volume + amount;
        wv.total_bets   = wv.total_bets + 1;
    }
}
```

at fill time the contract reads the volume and computes the fee tier atomically in the same transaction:

```move
fun get_taker_fee_bps(config: &P2PConfig, wallet: address): u64 {
    taker_fee_for_volume(get_wallet_volume(config, wallet))
}
```

no external call. no indexer round-trip. the ledger IS the fee schedule.

Hyperliquid's HIP-4 lives in a centralised order router. ours is fully on-chain.

---

**Tweet 4 — PENDING Sentinel as Distributed Lock**

3/ how do you prevent double-refunds in a crash-recovery loop without transactions?

a 3-state sentinel in one atomic SQL update.

```sql
-- Step 1: claim the refund slot atomically
UPDATE p2p_bet_offers
SET status         = 'cancelled',
    refund_tx_hash = 'PENDING'          -- distributed lock
WHERE id           = $offerId
  AND status       = 'open'
  AND refund_tx_hash IS NULL            -- only one thread wins
RETURNING id, creator_stake, creator_tx_hash
```

three states:
- `NULL` — not started, safe to attempt
- `'PENDING'` — in flight, another worker owns it
- `actual_tx_hash` — done, skip forever

if the blockchain call succeeds: overwrite PENDING with real tx hash.
if it fails: clear PENDING back to NULL (admin retry picks it up).

```sql
-- success
UPDATE p2p_bet_offers
SET refund_tx_hash = $realTxHash
WHERE id = $offerId AND refund_tx_hash = 'PENDING'

-- failure — unlock for retry
UPDATE p2p_bet_offers
SET refund_tx_hash = NULL
WHERE id = $offerId AND refund_tx_hash = 'PENDING'
```

crash mid-flight? PENDING stays. cron retries clear it. zero double-spend possible.

---

**Tweet 5 — Atomic Accept: Race-Condition-Free Taker Fill**

4/ two users hit "accept offer" at the same instant. both see `status=open`. who wins?

one SQL statement decides. no locks. no queues. no optimistic retry.

```sql
UPDATE p2p_bet_offers
SET
  filled_stake = COALESCE(filled_stake, 0) + $stake,
  status = CASE
    WHEN COALESCE(filled_stake, 0) + $stake >= taker_stake - 0.0001
    THEN 'filled' ELSE 'open'
  END
WHERE id             = $offerId
  AND status         = 'open'
  AND expires_at     > NOW()
  AND creator_wallet != $takerWallet           -- no self-bet
  AND taker_stake - COALESCE(filled_stake, 0) >= $stake - 0.0001
  AND (creator_tx_hash IS NOT NULL              -- creator must have funded
    OR onchain_offer_id IS NOT NULL)
  AND NOT EXISTS (                             -- no duplicate taker match
    SELECT 1 FROM p2p_bet_matches
    WHERE offer_id = $offerId AND taker_wallet = $takerWallet
  )
RETURNING *
```

first request gets 1 row back and proceeds to blockchain.
second gets 0 rows and throws instantly.

seven invariants enforced in one atomic write. no two-phase locking. pure Postgres.

---

**Tweet 6 — Gas Sponsorship: Dual-Signature Same Byte Sequence**

5/ users who hold zero SUI can still place bets.

the trick: both parties sign the EXACT same serialised transaction bytes.

```
frontend flow:
1. build PTB with tx.setSponsor(adminAddress)
   → gas payment resolved from admin wallet
   → tx.build({ client }) produces fixed bytes

2. POST those bytes to /api/p2p/sponsor
   → admin signs as GAS OWNER:
```

```typescript
async sponsorTransaction(txBytesBase64: string): Promise<{
    sponsorSig: string;
    sponsorAddress: string;
}> {
    const keypair  = buildAdminKeypair();
    const txBytes  = new Uint8Array(Buffer.from(txBytesBase64, 'base64'));
    const { signature } = await keypair.signTransaction(txBytes);
    return { sponsorSig: signature, sponsorAddress: keypair.getPublicKey().toSuiAddress() };
}
```

```
3. user wallet signs the same bytes as SENDER
4. submit: [userSig, sponsorSig]
```

because both parties sign the same byte sequence — no mismatch possible. the gas object is already embedded in the bytes at build time, not injected later.

USDC and SBETS holders bet without touching SUI for gas.

---

**Tweet 7 — 19 On-Chain Event Types: Full Event-Sourced Audit Trail**

6/ the entire platform history is readable from any Sui indexer. no DB required.

every lifecycle transition emits a typed Move event:

```
PlatformCreated       → contract deployed
OracleCapMinted       → oracle key issued
OfferPosted           → maker posts order
OfferFilled           → taker fills (partial or full)
OfferCancelled        → maker cancels before fill
OfferExpired          → deadline passed, refunded
BetSettleQueued       → oracle queues result, window starts
BetDisputed           → challenger flags incorrect result
BetDisputeResolved    → oracle overrides dispute, window resets
BetSettled            → winner paid from escrow
BetVoided             → match cancelled, both refunded
ParlayPosted          → multi-leg offer created
ParlayAccepted        → taker locks in
ParlayLegSettled      → single leg result recorded
ParlayLegVoided       → single leg voided
ParlaySettleQueued    → all legs done, dispute window opens
ParlayDisputed        → challenger flags parlay result
ParlaySettled         → winner paid
WithdrawalExecuted    → fee vault drained (requires two keys)
```

19 event types. every state change. every address. every timestamp.

you could rebuild the entire order book from events alone. no API. no indexer. just the chain.

---

**Tweet 8 — Type-Tagged WithdrawalProposal (Multi-Sig Without Generics)**

7/ the fee vault holds multiple coin types via a Bag. how do you propose a typed withdrawal in a two-key flow without putting generics on the proposal struct?

you store the type as bytes.

```move
public struct WithdrawalProposal has key {
    id:          UID,
    config_id:   ID,
    coin_type:   vector<u8>,   // type_name bytes — self-describing
    amount:      u64,
    recipient:   address,
    proposed_at: u64,
    executed:    bool,
}
```

at execution time the oracle's tx provides `<T>`. the contract rehydrates the type and asserts it matches:

```move
public entry fun execute_withdrawal<T>(
    _oracle_cap: &OracleCap,
    config:      &mut P2PConfig,
    proposal:    &mut WithdrawalProposal,
    ...
) {
    let key            = type_name::get<T>();
    let coin_type_bytes = std::ascii::into_bytes(type_name::into_string(key));
    assert!(coin_type_bytes == proposal.coin_type, EConfigMismatch);  // type check

    let vault = bag::borrow_mut<TypeName, Balance<T>>(&mut config.fee_vault, key);
    let fee_bal = balance::split(vault, proposal.amount);
    transfer::public_transfer(coin::from_balance(fee_bal, ctx), proposal.recipient);
    proposal.executed = true;
}
```

the proposal is a shared object. anyone can read which coin type is being withdrawn. AdminCap proposes. OracleCap executes. neither key alone drains the vault.

---

**Tweet 9 — Cross-Table Tx Hash Deduplication**

8/ an attacker deposits once and tries to use the same txHash to fund two separate bets.

one UNION query across 5 tables blocks it:

```typescript
async function isTxHashAlreadyUsed(txHash: string): Promise<boolean> {
    const result = await db.execute(sql`
        SELECT 1 FROM (
            SELECT creator_tx_hash AS h
              FROM p2p_bet_offers    WHERE creator_tx_hash = ${txHash}
            UNION ALL
            SELECT taker_tx_hash
              FROM p2p_bet_matches   WHERE taker_tx_hash   = ${txHash}
            UNION ALL
            SELECT creator_tx_hash
              FROM p2p_parlay_offers WHERE creator_tx_hash = ${txHash}
            UNION ALL
            SELECT taker_tx_hash
              FROM p2p_parlay_offers WHERE taker_tx_hash   = ${txHash}
            UNION ALL
            SELECT tx_hash
              FROM bets              WHERE tx_hash          = ${txHash}
        ) AS used
        LIMIT 1
    `);
    return rows.length > 0;
}
```

this runs before every bet write. five tables. one round-trip. zero false negatives.

the same on-chain transaction can never fund two separate bets regardless of which path the attacker tries.

---

**Tweet 10 — Zero-PENDING Gate on Parlay Finalization**

9/ a parlay has 4 legs. 3 settled. 1 still pending. can the oracle queue finalization early?

no. the contract counts:

```move
fun count_leg_status(statuses: &vector<u8>, target: u8): u64 {
    let len = vector::length(statuses);
    let mut count = 0u64;
    let mut i = 0;
    while (i < len) {
        if (*vector::borrow(statuses, i) == target) { count = count + 1 };
        i = i + 1;
    };
    count
}

public entry fun queue_finalize_parlay<T>(
    _oracle_cap: &OracleCap,
    config:      &P2PConfig,
    parlay:      &mut P2PParlay<T>,
    clock:       &Clock,
) {
    let pending = count_leg_status(&parlay.leg_statuses, LEG_PENDING);
    assert!(pending == 0, ENotAllLegsSettled);  // hard gate

    let lost       = count_leg_status(&parlay.leg_statuses, LEG_LOST);
    let maker_wins = lost == 0;                  // all legs must win for maker

    parlay.pending_maker_wins = maker_wins;
    parlay.status             = STATUS_SETTLING;
}
```

you physically cannot enter the dispute window with an unsettled leg.

no missing-leg exploit. no early payout. the vector traversal is the proof.

---

**Tweet 11 — HMAC-SHA256 Oracle Anti-Tamper with Timing-Safe Comparison**

10/ every settlement outcome is signed before it touches the blockchain.

canonical JSON (sorted keys, no whitespace variance) so signature is deterministic:

```typescript
signSettlementData(data: SettlementData): SignedSettlement {
    const canonical = JSON.stringify({
        betId:     data.betId,
        eventId:   data.eventId,
        outcome:   data.outcome,   // 'won' | 'lost' | 'void'
        payout:    data.payout,
        timestamp: data.timestamp,
    });

    const hmac = crypto.createHmac('sha256', this.oraclePrivateKey);
    hmac.update(canonical);
    const signature = hmac.digest('hex');

    return { data, signature, oraclePublicKey: this.oraclePublicKey, verified: false };
}
```

verification uses `timingSafeEqual` — not `===`. prevents timing side-channel attacks where an attacker measures response time to brute-force the key:

```typescript
verifySettlementSignature(signed: SignedSettlement): boolean {
    const hmac = crypto.createHmac('sha256', this.oraclePrivateKey);
    hmac.update(canonical);
    const expected = hmac.digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signed.signature, 'hex'),
        Buffer.from(expected,         'hex'),
    );
}
```

backend manipulation of payout data is detectable before the transaction is signed and submitted.

---

**Tweet 12 — Close**

that's 10 more patterns.

all live. all verifiable on-chain.

none of these are theoretical. they're running P2P bets right now at www.suibets.com

if you're building on Sui and want to steal any of this — do it.

that's why we ship open.
