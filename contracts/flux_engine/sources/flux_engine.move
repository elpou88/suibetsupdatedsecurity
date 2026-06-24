#[allow(duplicate_alias, unused_const, lint(public_entry), deprecated_usage, unused_use)]
/// FLUX Engine — Fractional Liquidity Utilization eXchange
///
/// The first fractional-fill P2P betting engine on any blockchain.
/// Solves the P2P liquidity crisis: a single large offer can now fill
/// across N independent takers instead of waiting for one whale.
///
/// ── Engine Overview ──────────────────────────────────────────────────────────
///
///   • WARP Engine  — batch settlement (up to 512 bets per PTB, 99% gas reduction)
///   • FLUX Engine  — fractional fill  (one offer → N shards → N takers)
///   • PULSE Engine — dynamic odds pool (pari-mutuel AMM, real-time odds)
///
///   All three engines share the SAME oracle wallet and p2p_betting::OracleCap.
///   One capability object governs the entire SuiBets settlement layer.
///
/// ── FLUX Core Innovations ────────────────────────────────────────────────────
///
/// 1. FluxShard — fractional taker positions (SHARED objects)
///    One large maker offer shatters into N micro-positions.
///    100 takers × 10 SUI each fill a 1,000 SUI offer in minutes.
///
/// 2. FluxFillReceipt — hot potato atomic fill guarantee
///    The receipt has NO abilities — it MUST be consumed in the same PTB.
///    Structurally impossible to leave funds stuck between fill and confirm.
///    EVM requires two separate transactions; Sui PTBs are one atomic envelope.
///
/// 3. flux_batch_close — WARP-style batch settlement marker
///    Up to 512 shards settled in one oracle PTB. One failure = whole batch reverts.
///    100 positions → 1 TX → ~99% gas reduction.
///
/// ── Oracle Integration ───────────────────────────────────────────────────────
///   FLUX uses p2p_betting::OracleCap for ALL oracle-gated functions.
///   The same oracle wallet that settles P2P bets and WARP batches also settles
///   FLUX shards — zero extra key management, zero confusion.
///
module flux_engine::flux_engine {

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::clock::Clock;
    use sui::event;
    use std::type_name::{Self, TypeName};

    use p2p_betting::p2p_betting::OracleCap;
    use openzeppelin_math::math as oz_math;

    // ── Error codes ──────────────────────────────────────────────────────────

    const EOfferNotOpen:        u64 = 300;
    const EShardTooSmall:       u64 = 301;
    const EOfferFull:           u64 = 302;
    const EWrongOffer:          u64 = 303;
    const EShardNotPending:     u64 = 304;
    const EOfferExpired:        u64 = 305;
    const EInsufficientBalance: u64 = 306;
    const EInvalidOdds:         u64 = 307;
    const EBatchEmpty:          u64 = 308;
    const EBatchTooLarge:       u64 = 309;
    const EOfferHasShards:      u64 = 310;
    const EOfferStillActive:    u64 = 311;
    const EUnauthorized:        u64 = 312;

    // ── Status constants ─────────────────────────────────────────────────────

    const OFFER_OPEN:    u8 = 0;
    const OFFER_FULL:    u8 = 1;
    const OFFER_SETTLED: u8 = 2;
    const OFFER_VOIDED:  u8 = 3;

    const SHARD_PENDING: u8 = 0;
    const SHARD_WON:     u8 = 1;
    const SHARD_LOST:    u8 = 2;
    const SHARD_VOID:    u8 = 3;

    // ── Platform constants ───────────────────────────────────────────────────

    const MAX_BATCH_SIZE:   u64 = 512;
    const DEFAULT_EXPIRY_MS: u64 = 604_800_000; // 7 days
    const MIN_SHARD_STAKE:  u64 = 10_000_000;   // 0.01 SUI in MIST
    const PLATFORM_FEE_BPS: u64 = 200;
    const BPS_DENOM:        u64 = 10_000;

    // ── Macros ───────────────────────────────────────────────────────────────

    macro fun require_maker($sender: address, $maker: address) {
        assert!($sender == $maker, EUnauthorized)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// FluxOffer<T> — SHARED
    /// Holds the maker's unfilled stake. Any taker can partially fill it.
    /// As shards are confirmed, maker_stake shrinks; filled_maker grows.
    public struct FluxOffer<phantom T> has key {
        id:              UID,
        maker:           address,
        event_id:        vector<u8>,
        prediction:      vector<u8>,
        /// odds × 10_000 — e.g. 2.0x = 20_000, 2.5x = 25_000
        odds_bps:        u64,
        maker_stake:     Balance<T>,
        maker_total:     u64,
        filled_maker:    u64,
        shard_count:     u64,
        settled_count:   u64,
        /// minimum taker stake per shard (anti-dust)
        min_shard_taker: u64,
        status:          u8,
        created_at:      u64,
        expires_at:      u64,
        coin_type:       TypeName,
    }

    /// FluxShard<T> — SHARED
    /// Each shard is an independent position. 100 takers = 100 shard objects.
    /// Oracle settles each via the shared oracle cap — no taker signature needed.
    /// Vault holds both taker + maker stake until oracle resolves.
    public struct FluxShard<phantom T> has key {
        id:           UID,
        offer_id:     ID,
        shard_index:  u64,
        maker:        address,
        taker:        address,
        vault:        Balance<T>,
        taker_amount: u64,
        maker_amount: u64,
        status:       u8,
        filled_at:    u64,
        settled_at:   u64,
    }

    /// FluxFillReceipt<T> — HOT POTATO (zero abilities)
    ///
    /// Carries both stakes in-flight between flux_fill_shard and
    /// flux_confirm_fill / flux_cancel_fill. Because Balance<T> has no `drop`,
    /// this struct cannot be dropped either — the VM aborts if it is not consumed.
    ///
    /// PTB pattern:
    ///   [receipt] ← flux_fill_shard(offer, taker_coin, clock)
    ///   flux_confirm_fill(offer, receipt, stats, clock)   ← success path
    ///   OR
    ///   flux_cancel_fill(offer, receipt)                  ← abort path
    public struct FluxFillReceipt<phantom T> {
        offer_id:      ID,
        maker_reserve: Balance<T>,
        taker_balance: Balance<T>,
        taker_amount:  u64,
        maker_amount:  u64,
        taker_addr:    address,
        maker_addr:    address,
    }

    /// FluxStats — SHARED
    /// Global throughput metrics. Off-chain indexers poll this object.
    public struct FluxStats has key {
        id:             UID,
        total_offers:   u64,
        total_shards:   u64,
        total_settled:  u64,
        total_voided:   u64,
        total_volume:   u64,
        total_batches:  u64,
        max_batch_size: u64,
        last_batch_ts:  u64,
    }

    /// FluxAdminCap — OWNED
    /// Only needed for minting extra oracle caps in emergency — oracle settlement
    /// uses the shared p2p_betting::OracleCap, not this.
    public struct FluxAdminCap has key, store { id: UID }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    public struct FluxOfferCreated has copy, drop {
        offer_id:        ID,
        maker:           address,
        event_id:        vector<u8>,
        prediction:      vector<u8>,
        odds_bps:        u64,
        maker_stake:     u64,
        min_shard_taker: u64,
        coin_type:       vector<u8>,
        expires_at:      u64,
        timestamp:       u64,
    }

    public struct FluxShardFilled has copy, drop {
        offer_id:     ID,
        shard_id:     ID,
        shard_index:  u64,
        taker:        address,
        taker_amount: u64,
        maker_amount: u64,
        timestamp:    u64,
    }

    public struct FluxShardSettled has copy, drop {
        offer_id:    ID,
        shard_id:    ID,
        shard_index: u64,
        taker_won:   bool,
        payout:      u64,
        fee:         u64,
        timestamp:   u64,
    }

    public struct FluxShardVoided has copy, drop {
        offer_id:     ID,
        shard_id:     ID,
        shard_index:  u64,
        taker_refund: u64,
        maker_refund: u64,
        timestamp:    u64,
    }

    /// Emitted by flux_batch_close once per oracle batch PTB.
    public struct FluxBatchSettled has copy, drop {
        batch_id:  u64,
        count:     u64,
        voided:    u64,
        timestamp: u64,
    }

    public struct FluxOfferCancelled has copy, drop {
        offer_id:  ID,
        maker:     address,
        refund:    u64,
        timestamp: u64,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════════════════

    fun init(ctx: &mut TxContext) {
        let deployer = ctx.sender();

        let stats = FluxStats {
            id:             object::new(ctx),
            total_offers:   0,
            total_shards:   0,
            total_settled:  0,
            total_voided:   0,
            total_volume:   0,
            total_batches:  0,
            max_batch_size: 0,
            last_batch_ts:  0,
        };

        let admin = FluxAdminCap { id: object::new(ctx) };

        transfer::share_object(stats);
        transfer::transfer(admin, deployer);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OFFER CREATION
    // ═══════════════════════════════════════════════════════════════════════════

    /// Create a fractional P2P offer.
    ///
    /// odds_bps: decimal odds × 10_000
    ///   2.0x = 20_000 | 2.5x = 25_000 | 1.5x = 15_000 — must be > 10_000
    ///
    /// min_shard_taker: pass 0 to use global default (0.01 SUI).
    public entry fun flux_create_offer<T>(
        stake:           Coin<T>,
        event_id:        vector<u8>,
        prediction:      vector<u8>,
        odds_bps:        u64,
        min_shard_taker: u64,
        stats:           &mut FluxStats,
        clock:           &Clock,
        ctx:             &mut TxContext,
    ) {
        let maker     = ctx.sender();
        let amount    = stake.value();
        let now       = clock.timestamp_ms();
        let coin_type = type_name::get<T>();

        assert!(amount > 0,       EInsufficientBalance);
        assert!(odds_bps > 10_000, EInvalidOdds);

        let min_shard = if (min_shard_taker == 0) { MIN_SHARD_STAKE } else { min_shard_taker };

        let offer = FluxOffer<T> {
            id:              object::new(ctx),
            maker,
            event_id,
            prediction,
            odds_bps,
            maker_stake:     stake.into_balance(),
            maker_total:     amount,
            filled_maker:    0,
            shard_count:     0,
            settled_count:   0,
            min_shard_taker: min_shard,
            status:          OFFER_OPEN,
            created_at:      now,
            expires_at:      now + DEFAULT_EXPIRY_MS,
            coin_type,
        };

        stats.total_offers = stats.total_offers + 1;
        stats.total_volume = stats.total_volume + amount;

        event::emit(FluxOfferCreated {
            offer_id:        object::id(&offer),
            maker,
            event_id:        offer.event_id,
            prediction:      offer.prediction,
            odds_bps,
            maker_stake:     amount,
            min_shard_taker: min_shard,
            coin_type:       coin_type.into_string().into_bytes(),
            expires_at:      offer.expires_at,
            timestamp:       now,
        });

        transfer::share_object(offer);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TWO-STEP HOT POTATO FILL
    // ═══════════════════════════════════════════════════════════════════════════

    /// Step 1 — initiate fill. Returns hot potato FluxFillReceipt.
    ///
    /// Maker's allocation is pulled from the offer immediately. The receipt
    /// carries both stakes and MUST be consumed in the same PTB.
    ///
    /// Maker allocation: taker_amt × 10_000 / (odds_bps − 10_000)
    ///   At 2.0x: maker_alloc = taker_amt × 1.0  (equal risk)
    ///   At 2.5x: maker_alloc = taker_amt × 0.67 (maker risks less)
    ///   At 1.5x: maker_alloc = taker_amt × 2.0  (maker risks more)
    public fun flux_fill_shard<T>(
        offer:      &mut FluxOffer<T>,
        taker_coin: Coin<T>,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ): FluxFillReceipt<T> {
        let taker     = ctx.sender();
        let taker_amt = taker_coin.value();
        let now       = clock.timestamp_ms();

        assert!(offer.status == OFFER_OPEN,         EOfferNotOpen);
        assert!(now < offer.expires_at,             EOfferExpired);
        assert!(taker_amt >= offer.min_shard_taker, EShardTooSmall);

        // Guard: odds must be strictly above 1.0x (10_000 bps) so the denominator
        // is positive. Without this, subtraction underflows (Move runtime abort with
        // a generic error). EInvalidOdds gives callers a descriptive abort code.
        assert!(offer.odds_bps > 10_000, EInvalidOdds);
        // OpenZeppelin Math: overflow-safe maker allocation = taker_amt * 10_000 / (odds_bps - 10_000)
        let maker_alloc = oz_math::mul_div(taker_amt, 10_000, offer.odds_bps - 10_000);

        assert!(maker_alloc <= offer.maker_stake.value(), EOfferFull);

        let maker_reserve = offer.maker_stake.split(maker_alloc);
        let taker_balance = taker_coin.into_balance();

        FluxFillReceipt<T> {
            offer_id:      object::id(offer),
            maker_reserve,
            taker_balance,
            taker_amount:  taker_amt,
            maker_amount:  maker_alloc,
            taker_addr:    taker,
            maker_addr:    offer.maker,
        }
    }

    /// Step 2a — confirm fill. Consumes hot potato → creates FluxShard (SHARED).
    ///
    /// Both stakes merged into shard vault. Oracle will settle from the vault.
    /// If remaining maker stake < min_shard_taker, offer flips to OFFER_FULL.
    public fun flux_confirm_fill<T>(
        offer:   &mut FluxOffer<T>,
        receipt: FluxFillReceipt<T>,
        stats:   &mut FluxStats,
        clock:   &Clock,
        ctx:     &mut TxContext,
    ) {
        let FluxFillReceipt {
            offer_id,
            maker_reserve,
            taker_balance,
            taker_amount,
            maker_amount,
            taker_addr,
            maker_addr,
        } = receipt;

        assert!(offer_id == object::id(offer), EWrongOffer);

        let now         = clock.timestamp_ms();
        let shard_index = offer.shard_count;

        let mut vault = maker_reserve;
        vault.join(taker_balance);

        let shard = FluxShard<T> {
            id:           object::new(ctx),
            offer_id,
            shard_index,
            maker:        maker_addr,
            taker:        taker_addr,
            vault,
            taker_amount,
            maker_amount,
            status:       SHARD_PENDING,
            filled_at:    now,
            settled_at:   0,
        };

        let shard_id = object::id(&shard);

        offer.filled_maker = offer.filled_maker + maker_amount;
        offer.shard_count  = offer.shard_count  + 1;

        if (offer.maker_stake.value() < offer.min_shard_taker) {
            offer.status = OFFER_FULL;
        };

        stats.total_shards = stats.total_shards + 1;

        event::emit(FluxShardFilled {
            offer_id,
            shard_id,
            shard_index,
            taker: taker_addr,
            taker_amount,
            maker_amount,
            timestamp: now,
        });

        transfer::share_object(shard);
    }

    /// Step 2b — cancel fill. Consumes hot potato → refunds both parties.
    ///
    /// Maker's reserve returned to offer. Taker's coin returned to taker.
    /// Offer stays OPEN — other takers can still fill it.
    public fun flux_cancel_fill<T>(
        offer:   &mut FluxOffer<T>,
        receipt: FluxFillReceipt<T>,
        ctx:     &mut TxContext,
    ) {
        let FluxFillReceipt {
            offer_id,
            maker_reserve,
            taker_balance,
            taker_amount:  _,
            maker_amount:  _,
            taker_addr,
            maker_addr:    _,
        } = receipt;

        assert!(offer_id == object::id(offer), EWrongOffer);

        offer.maker_stake.join(maker_reserve);

        let refund = taker_balance.into_coin(ctx);
        transfer::public_transfer(refund, taker_addr);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ORACLE SETTLEMENT — uses p2p_betting::OracleCap
    // ═══════════════════════════════════════════════════════════════════════════

    /// Settle one FluxShard. Oracle specifies whether the taker won.
    ///
    /// Payout = total vault − 2% platform fee.
    /// Fee goes to ctx.sender() (the oracle/platform wallet).
    ///
    /// Batch settlement PTB pattern (TypeScript):
    ///   for shard of shards:
    ///     tx.moveCall({ target: `${FLUX_PKG}::flux_engine::flux_settle_shard`, ... })
    ///   tx.moveCall({ target: `${FLUX_PKG}::flux_engine::flux_batch_close`, ... })
    ///   // → all shards settle atomically or none do
    public entry fun flux_settle_shard<T>(
        _oracle_cap: &OracleCap,
        shard:       &mut FluxShard<T>,
        taker_won:   bool,
        stats:       &mut FluxStats,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        assert!(shard.status == SHARD_PENDING, EShardNotPending);

        let now    = clock.timestamp_ms();
        let total  = shard.vault.value();
        let fee    = oz_math::mul_div(total, PLATFORM_FEE_BPS, BPS_DENOM);
        let payout = total - fee;

        let fee_coin    = shard.vault.split(fee).into_coin(ctx);
        let payout_coin = shard.vault.split(payout).into_coin(ctx);
        let winner      = if (taker_won) { shard.taker } else { shard.maker };

        shard.status     = if (taker_won) { SHARD_WON } else { SHARD_LOST };
        shard.settled_at = now;

        transfer::public_transfer(fee_coin,    ctx.sender());
        transfer::public_transfer(payout_coin, winner);

        stats.total_settled = stats.total_settled + 1;

        event::emit(FluxShardSettled {
            offer_id:    shard.offer_id,
            shard_id:    object::id(shard),
            shard_index: shard.shard_index,
            taker_won,
            payout,
            fee,
            timestamp:   now,
        });
    }

    /// Void one FluxShard — refund both parties. Used for cancelled events.
    public entry fun flux_void_shard<T>(
        _oracle_cap: &OracleCap,
        shard:       &mut FluxShard<T>,
        stats:       &mut FluxStats,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        assert!(shard.status == SHARD_PENDING, EShardNotPending);

        let now = clock.timestamp_ms();

        shard.status     = SHARD_VOID;
        shard.settled_at = now;

        let taker_refund = shard.vault.split(shard.taker_amount).into_coin(ctx);
        let remaining    = shard.vault.value();
        let maker_refund = shard.vault.split(remaining).into_coin(ctx);

        transfer::public_transfer(taker_refund, shard.taker);
        transfer::public_transfer(maker_refund, shard.maker);

        stats.total_voided = stats.total_voided + 1;

        event::emit(FluxShardVoided {
            offer_id:     shard.offer_id,
            shard_id:     object::id(shard),
            shard_index:  shard.shard_index,
            taker_refund: shard.taker_amount,
            maker_refund: remaining,
            timestamp:    now,
        });
    }

    /// Oracle updates offer's settled_count after each shard is resolved.
    /// When all shards are settled and no maker stake remains, offer → SETTLED.
    public entry fun flux_mark_shard_settled<T>(
        _oracle_cap: &OracleCap,
        offer:       &mut FluxOffer<T>,
        _clock:      &Clock,
    ) {
        offer.settled_count = offer.settled_count + 1;
        if (offer.settled_count == offer.shard_count &&
            offer.maker_stake.value() == 0) {
            offer.status = OFFER_SETTLED;
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WARP-STYLE BATCH MARKER
    // ═══════════════════════════════════════════════════════════════════════════

    /// Oracle calls this ONCE per batch PTB, after all flux_settle_shard calls.
    ///
    /// count  = shards settled in this PTB
    /// voided = shards voided in this PTB
    ///
    /// Emits FluxBatchSettled — off-chain indexers watch this event.
    /// Requires OracleCap to prevent fake batch inflation.
    public entry fun flux_batch_close(
        _oracle_cap: &OracleCap,
        stats:       &mut FluxStats,
        count:       u64,
        voided:      u64,
        clock:       &Clock,
    ) {
        assert!(count  > 0,             EBatchEmpty);
        assert!(count  <= MAX_BATCH_SIZE, EBatchTooLarge);
        assert!(voided <= MAX_BATCH_SIZE, EBatchTooLarge);

        stats.total_batches = stats.total_batches + 1;
        stats.last_batch_ts = clock.timestamp_ms();

        let batch_total = count + voided;
        if (batch_total > stats.max_batch_size) {
            stats.max_batch_size = batch_total;
        };

        event::emit(FluxBatchSettled {
            batch_id:  stats.total_batches,
            count,
            voided,
            timestamp: stats.last_batch_ts,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OFFER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /// Maker cancels an open offer and reclaims unfilled stake.
    /// Only allowed when shard_count == 0 (no takers yet).
    public entry fun flux_cancel_offer<T>(
        offer: &mut FluxOffer<T>,
        clock: &Clock,
        ctx:   &mut TxContext,
    ) {
        require_maker!(ctx.sender(), offer.maker);
        assert!(
            offer.status == OFFER_OPEN || offer.status == OFFER_FULL,
            EOfferNotOpen,
        );
        assert!(offer.shard_count == 0, EOfferHasShards);

        let now        = clock.timestamp_ms();
        let refund_amt = offer.maker_stake.value();

        offer.status = OFFER_VOIDED;

        let refund = offer.maker_stake.split(refund_amt).into_coin(ctx);
        transfer::public_transfer(refund, offer.maker);

        event::emit(FluxOfferCancelled {
            offer_id:  object::id(offer),
            maker:     offer.maker,
            refund:    refund_amt,
            timestamp: now,
        });
    }

    /// Maker reclaims unfilled stake after all shards are fully settled.
    /// Handles partial fill: if only 60 SUI of 100 SUI was filled, 40 SUI returns here.
    public entry fun flux_reclaim_unfilled<T>(
        offer: &mut FluxOffer<T>,
        clock: &Clock,
        ctx:   &mut TxContext,
    ) {
        require_maker!(ctx.sender(), offer.maker);
        assert!(offer.settled_count == offer.shard_count, EOfferStillActive);

        let now       = clock.timestamp_ms();
        let remaining = offer.maker_stake.value();

        if (remaining > 0) {
            let reclaim = offer.maker_stake.split(remaining).into_coin(ctx);
            transfer::public_transfer(reclaim, offer.maker);
        };

        offer.status = OFFER_SETTLED;

        event::emit(FluxOfferCancelled {
            offer_id:  object::id(offer),
            maker:     offer.maker,
            refund:    remaining,
            timestamp: now,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    public fun offer_maker<T>(o: &FluxOffer<T>): address         { o.maker }
    public fun offer_odds_bps<T>(o: &FluxOffer<T>): u64          { o.odds_bps }
    public fun offer_maker_total<T>(o: &FluxOffer<T>): u64       { o.maker_total }
    public fun offer_filled_maker<T>(o: &FluxOffer<T>): u64      { o.filled_maker }
    public fun offer_shard_count<T>(o: &FluxOffer<T>): u64       { o.shard_count }
    public fun offer_settled_count<T>(o: &FluxOffer<T>): u64     { o.settled_count }
    public fun offer_remaining<T>(o: &FluxOffer<T>): u64         { o.maker_stake.value() }
    public fun offer_status<T>(o: &FluxOffer<T>): u8             { o.status }
    public fun offer_expires_at<T>(o: &FluxOffer<T>): u64        { o.expires_at }
    public fun offer_min_shard_taker<T>(o: &FluxOffer<T>): u64   { o.min_shard_taker }

    public fun shard_offer_id<T>(s: &FluxShard<T>): ID           { s.offer_id }
    public fun shard_index<T>(s: &FluxShard<T>): u64             { s.shard_index }
    public fun shard_maker<T>(s: &FluxShard<T>): address         { s.maker }
    public fun shard_taker<T>(s: &FluxShard<T>): address         { s.taker }
    public fun shard_taker_amount<T>(s: &FluxShard<T>): u64      { s.taker_amount }
    public fun shard_maker_amount<T>(s: &FluxShard<T>): u64      { s.maker_amount }
    public fun shard_vault_value<T>(s: &FluxShard<T>): u64       { s.vault.value() }
    public fun shard_status<T>(s: &FluxShard<T>): u8             { s.status }
    public fun shard_filled_at<T>(s: &FluxShard<T>): u64         { s.filled_at }
    public fun shard_settled_at<T>(s: &FluxShard<T>): u64        { s.settled_at }

    public fun stats_total_offers(s: &FluxStats):   u64          { s.total_offers }
    public fun stats_total_shards(s: &FluxStats):   u64          { s.total_shards }
    public fun stats_total_settled(s: &FluxStats):  u64          { s.total_settled }
    public fun stats_total_voided(s: &FluxStats):   u64          { s.total_voided }
    public fun stats_total_volume(s: &FluxStats):   u64          { s.total_volume }
    public fun stats_total_batches(s: &FluxStats):  u64          { s.total_batches }
    public fun stats_max_batch_size(s: &FluxStats): u64          { s.max_batch_size }
    public fun stats_last_batch_ts(s: &FluxStats):  u64          { s.last_batch_ts }
}
