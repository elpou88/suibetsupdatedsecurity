#[allow(duplicate_alias, unused_const, lint(public_entry), deprecated_usage, unused_use)]
/// PULSE Engine — Pari-mutuel Under-Liquidity Shifting Engine
///
/// The first on-chain AMM-style dynamic odds betting pool on any blockchain.
/// Solves fixed-odds P2P's core flaw: imbalanced books where one side gets
/// no takers. PULSE automatically reprices in real time as volume flows in.
///
/// ── Engine Overview ──────────────────────────────────────────────────────────
///
///   • WARP Engine  — batch settlement  (up to 512 bets per PTB, 99% gas savings)
///   • FLUX Engine  — fractional fill   (1 offer → N shards → N takers)
///   • PULSE Engine — dynamic odds pool (pari-mutuel AMM, live repricing)
///
///   All three engines share ONE oracle wallet and p2p_betting::OracleCap.
///
/// ── How PULSE Works ──────────────────────────────────────────────────────────
///
///   1. A pool creator seeds two sides of an event with initial liquidity.
///      e.g. "Arsenal vs Chelsea: 50 SUI on Arsenal | 30 SUI on Chelsea"
///
///   2. Takers join either side. Each join shifts the live odds on-chain.
///      Odds at any moment:
///        Side A odds = total_pool / side_a_pool
///        Side B odds = total_pool / side_b_pool
///
///   3. Oracle locks the pool before the match starts. No new positions.
///
///   4. Oracle settles: announces winner side. Platform fee (2%) extracted.
///
///   5. Each winner brings their PulsePosition NFT and claims proportional
///      share of the total pool. Position is burned on claim — no double-claim.
///
/// ── Why PULSE Is Novel ───────────────────────────────────────────────────────
///
///   Traditional sportsbooks: house sets fixed odds, takes margin.
///   P2P fixed-odds: maker sets odds, waits for one exact counterparty.
///   PULSE: odds are a live on-chain function of demand — no house, no maker.
///
///   On EVM: pari-mutuel pools exist off-chain (e.g. horse racing totes).
///   On Sui: the pool IS a shared object. Every stake updates it atomically.
///   Oracle need only announce the winner — no result calculation off-chain.
///
/// ── PulsePosition as Tradeable NFT ───────────────────────────────────────────
///
///   PulsePosition<T> has `key + store` — it can be listed on Sui NFT markets,
///   transferred peer-to-peer, or used as collateral. A live-traded secondary
///   market for sports bet positions, on-chain, with instant settlement.
///
/// ── Oracle Integration ───────────────────────────────────────────────────────
///   Uses p2p_betting::OracleCap — same oracle key as WARP + FLUX.
///   Zero extra key management, zero confusion.
///
module pulse_engine::pulse_engine {

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::clock::Clock;
    use sui::event;
    use std::type_name::{Self, TypeName};

    use p2p_betting::p2p_betting::OracleCap;

    // ── Error codes ──────────────────────────────────────────────────────────

    const EPoolNotOpen:         u64 = 400;
    const EPoolNotLocked:       u64 = 401;
    const EPoolNotSettled:      u64 = 402;
    const EPoolNotVoided:       u64 = 403;
    const EInvalidSide:         u64 = 404;
    const EStakeTooSmall:       u64 = 405;
    const EWrongPool:           u64 = 406;
    const EAlreadyClaimed:      u64 = 407;
    const ENotWinningSide:      u64 = 408;
    const EInsufficientBalance: u64 = 409;
    const EBatchEmpty:          u64 = 410;
    const EBatchTooLarge:       u64 = 411;
    const EUnauthorized:        u64 = 412;
    const EEmptyPool:           u64 = 413;

    // ── Pool / position status ───────────────────────────────────────────────

    const POOL_OPEN:    u8 = 0;   // accepting positions
    const POOL_LOCKED:  u8 = 1;   // event started — no new positions
    const POOL_SETTLED: u8 = 2;   // winner announced, claims open
    const POOL_VOIDED:  u8 = 3;   // event cancelled, refunds open

    const SIDE_A: u8 = 0;
    const SIDE_B: u8 = 1;
    const NO_WINNER: u8 = 255;    // sentinel — pool not yet settled

    // ── Platform constants ───────────────────────────────────────────────────

    const MAX_BATCH_SIZE:   u64 = 512;
    const MIN_STAKE:        u64 = 10_000_000;  // 0.01 SUI in MIST
    const PLATFORM_FEE_BPS: u64 = 200;         // 2%
    const BPS_DENOM:        u64 = 10_000;

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// PulsePool<T> — SHARED
    ///
    /// The live AMM-style betting pool. Both sides' stakes live here until
    /// settlement. Odds at any moment = total_pool / side_pool.
    ///
    /// After settlement: payout_vault holds the winner's claimable funds.
    /// After void:       side_a_pool + side_b_pool hold refunds.
    public struct PulsePool<phantom T> has key {
        id:              UID,
        creator:         address,
        event_id:        vector<u8>,
        side_a_name:     vector<u8>,
        side_b_name:     vector<u8>,
        coin_type:       TypeName,

        // Live balances — both grow as takers join
        side_a_pool:     Balance<T>,
        side_b_pool:     Balance<T>,

        // Post-settlement: merged pool minus fee, paid to winners on claim
        payout_vault:    Balance<T>,

        // Running totals (never decrease — used for proportional calc at settle)
        total_a_staked:  u64,
        total_b_staked:  u64,
        position_count:  u64,
        claimed_count:   u64,

        // Set at settlement time
        winner:               u8,   // SIDE_A, SIDE_B, or NO_WINNER
        winning_side_total:   u64,  // total stake on winning side (for ratio)
        settled_payout_pool:  u64,  // total available to all winners (post fee)

        status:     u8,
        created_at: u64,
        locked_at:  u64,
        settled_at: u64,
    }

    /// PulsePosition<T> — OWNED + transferable (key + store)
    ///
    /// Represents a taker's stake in one side of a PulsePool.
    /// Tradeable on Sui NFT marketplaces — holders can exit early by selling.
    ///
    /// Burned (deleted) on claim or void refund — no double-claim possible.
    ///
    /// snapshot_total / snapshot_side: odds snapshot at join time for UI display.
    ///   indicative_odds = snapshot_total / snapshot_side
    ///   These are NOT guaranteed — final payout uses settlement-time pool ratios.
    public struct PulsePosition<phantom T> has key, store {
        id:              UID,
        pool_id:         ID,
        holder:          address,
        side:            u8,      // SIDE_A or SIDE_B
        stake:           u64,
        snapshot_total:  u64,     // total_pool at join time
        snapshot_side:   u64,     // side_pool at join time (for odds display)
        joined_at:       u64,
    }

    /// PulseStats — SHARED
    public struct PulseStats has key {
        id:              UID,
        total_pools:     u64,
        total_positions: u64,
        total_settled:   u64,
        total_voided:    u64,
        total_volume:    u64,
        total_batches:   u64,
        max_batch_size:  u64,
        last_batch_ts:   u64,
    }

    /// PulseAdminCap — OWNED
    public struct PulseAdminCap has key, store { id: UID }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    public struct PulsePoolCreated has copy, drop {
        pool_id:      ID,
        creator:      address,
        event_id:     vector<u8>,
        side_a_name:  vector<u8>,
        side_b_name:  vector<u8>,
        seed_a:       u64,
        seed_b:       u64,
        coin_type:    vector<u8>,
        timestamp:    u64,
    }

    public struct PulsePositionTaken has copy, drop {
        pool_id:         ID,
        position_id:     ID,
        taker:           address,
        side:            u8,
        stake:           u64,
        live_odds_num:   u64,   // total_pool at join (indicative odds numerator)
        live_odds_den:   u64,   // side_pool at join (indicative odds denominator)
        timestamp:       u64,
    }

    public struct PulsePoolLocked has copy, drop {
        pool_id:   ID,
        total_a:   u64,
        total_b:   u64,
        timestamp: u64,
    }

    public struct PulsePoolSettled has copy, drop {
        pool_id:      ID,
        winner:       u8,
        payout_pool:  u64,
        fee:          u64,
        winning_side: u64,
        timestamp:    u64,
    }

    public struct PulseWinningsClaimed has copy, drop {
        pool_id:     ID,
        position_id: ID,
        winner:      address,
        stake:       u64,
        payout:      u64,
        timestamp:   u64,
    }

    public struct PulseVoidRefunded has copy, drop {
        pool_id:     ID,
        position_id: ID,
        holder:      address,
        refund:      u64,
        timestamp:   u64,
    }

    public struct PulsePoolVoided has copy, drop {
        pool_id:   ID,
        timestamp: u64,
    }

    public struct PulseBatchSettled has copy, drop {
        batch_id:  u64,
        count:     u64,
        voided:    u64,
        timestamp: u64,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════════════════

    fun init(ctx: &mut TxContext) {
        let stats = PulseStats {
            id:              object::new(ctx),
            total_pools:     0,
            total_positions: 0,
            total_settled:   0,
            total_voided:    0,
            total_volume:    0,
            total_batches:   0,
            max_batch_size:  0,
            last_batch_ts:   0,
        };

        let admin = PulseAdminCap { id: object::new(ctx) };

        transfer::share_object(stats);
        transfer::transfer(admin, ctx.sender());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // POOL CREATION
    // ═══════════════════════════════════════════════════════════════════════════

    /// Create a PULSE pool for a two-outcome event.
    ///
    /// Creator seeds BOTH sides with initial liquidity. This prevents zero-division
    /// on first taker (odds always defined) and demonstrates creator confidence.
    ///
    /// seed_a_coin: initial SUI on side A (e.g. 10 SUI for Arsenal)
    /// seed_b_coin: initial SUI on side B (e.g. 10 SUI for Chelsea)
    ///
    /// Live odds after seeding:
    ///   Side A odds = (seed_a + seed_b) / seed_a
    ///   Side B odds = (seed_a + seed_b) / seed_b
    ///
    /// Creator's seed is at risk — they are betting on both sides simultaneously.
    /// This is intentional: creator skin-in-the-game prevents fake pools.
    public entry fun pulse_create_pool<T>(
        seed_a_coin: Coin<T>,
        seed_b_coin: Coin<T>,
        event_id:    vector<u8>,
        side_a_name: vector<u8>,
        side_b_name: vector<u8>,
        stats:       &mut PulseStats,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        let seed_a = seed_a_coin.value();
        let seed_b = seed_b_coin.value();

        assert!(seed_a >= MIN_STAKE, EStakeTooSmall);
        assert!(seed_b >= MIN_STAKE, EStakeTooSmall);

        let now       = clock.timestamp_ms();
        let coin_type = type_name::get<T>();
        let creator   = ctx.sender();

        let pool = PulsePool<T> {
            id:              object::new(ctx),
            creator,
            event_id,
            side_a_name,
            side_b_name,
            coin_type,
            side_a_pool:          seed_a_coin.into_balance(),
            side_b_pool:          seed_b_coin.into_balance(),
            payout_vault:         balance::zero<T>(),
            total_a_staked:       seed_a,
            total_b_staked:       seed_b,
            position_count:       0,
            claimed_count:        0,
            winner:               NO_WINNER,
            winning_side_total:   0,
            settled_payout_pool:  0,
            status:               POOL_OPEN,
            created_at:           now,
            locked_at:            0,
            settled_at:           0,
        };

        stats.total_pools  = stats.total_pools  + 1;
        stats.total_volume = stats.total_volume + seed_a + seed_b;

        event::emit(PulsePoolCreated {
            pool_id:     object::id(&pool),
            creator,
            event_id:    pool.event_id,
            side_a_name: pool.side_a_name,
            side_b_name: pool.side_b_name,
            seed_a,
            seed_b,
            coin_type:   coin_type.into_string().into_bytes(),
            timestamp:   now,
        });

        transfer::share_object(pool);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TAKE POSITION
    // ═══════════════════════════════════════════════════════════════════════════

    /// Take a position in the pool on side A (0) or side B (1).
    ///
    /// Returns a PulsePosition NFT representing your stake.
    /// The position records live odds at join time for UI display.
    ///
    /// Actual payout is computed at settlement based on final pool ratio —
    /// not the indicative odds shown here. This is pari-mutuel: the more
    /// people bet your side, the lower your payout (and vice versa).
    ///
    /// Live odds formula at any point in time:
    ///   Your side:   takes a share of the losing side's pool
    ///   Effective multiplier = total_pool / your_side_pool
    ///   (includes your own stake in the denominator)
    public entry fun pulse_take_position<T>(
        pool:    &mut PulsePool<T>,
        coin:    Coin<T>,
        side:    u8,
        stats:   &mut PulseStats,
        clock:   &Clock,
        ctx:     &mut TxContext,
    ) {
        assert!(pool.status == POOL_OPEN, EPoolNotOpen);
        assert!(side == SIDE_A || side == SIDE_B, EInvalidSide);

        let stake  = coin.value();
        let now    = clock.timestamp_ms();
        let taker  = ctx.sender();

        assert!(stake >= MIN_STAKE, EStakeTooSmall);

        // Snapshot current pool state for indicative odds display
        let snap_a = pool.side_a_pool.value();
        let snap_b = pool.side_b_pool.value();
        let (snapshot_total, snapshot_side) = if (side == SIDE_A) {
            (snap_a + snap_b + stake, snap_a + stake)  // post-join totals
        } else {
            (snap_a + snap_b + stake, snap_b + stake)
        };

        // Deposit stake into correct side
        if (side == SIDE_A) {
            pool.side_a_pool.join(coin.into_balance());
            pool.total_a_staked = pool.total_a_staked + stake;
        } else {
            pool.side_b_pool.join(coin.into_balance());
            pool.total_b_staked = pool.total_b_staked + stake;
        };

        pool.position_count = pool.position_count + 1;

        let position = PulsePosition<T> {
            id:             object::new(ctx),
            pool_id:        object::id(pool),
            holder:         taker,
            side,
            stake,
            snapshot_total,
            snapshot_side,
            joined_at:      now,
        };

        let position_id = object::id(&position);

        stats.total_positions = stats.total_positions + 1;
        stats.total_volume    = stats.total_volume + stake;

        event::emit(PulsePositionTaken {
            pool_id:       object::id(pool),
            position_id,
            taker,
            side,
            stake,
            live_odds_num: snapshot_total,
            live_odds_den: snapshot_side,
            timestamp:     now,
        });

        transfer::public_transfer(position, taker);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ORACLE — LOCK / SETTLE / VOID
    // ═══════════════════════════════════════════════════════════════════════════

    /// Lock the pool before the event starts. No new positions after this.
    /// Oracle calls this when the match kicks off.
    public entry fun pulse_lock_pool<T>(
        _oracle_cap: &OracleCap,
        pool:        &mut PulsePool<T>,
        clock:       &Clock,
    ) {
        assert!(pool.status == POOL_OPEN, EPoolNotOpen);

        let now = clock.timestamp_ms();

        pool.status    = POOL_LOCKED;
        pool.locked_at = now;

        event::emit(PulsePoolLocked {
            pool_id:   object::id(pool),
            total_a:   pool.side_a_pool.value(),
            total_b:   pool.side_b_pool.value(),
            timestamp: now,
        });
    }

    /// Settle the pool: announce winner, extract fee, open claims.
    ///
    /// Oracle specifies winner = 0 (SIDE_A) or 1 (SIDE_B).
    ///
    /// Payout calculation at settle time:
    ///   total_pool = side_a + side_b
    ///   fee        = total_pool × 2%
    ///   payout     = total_pool − fee
    ///
    /// Winners' individual payout = stake × payout / winning_side_total
    ///
    /// The payout_vault is loaded here. Each winner drains from it on claim.
    public entry fun pulse_settle_pool<T>(
        _oracle_cap: &OracleCap,
        pool:        &mut PulsePool<T>,
        winner:      u8,
        stats:       &mut PulseStats,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        assert!(pool.status == POOL_LOCKED, EPoolNotLocked);
        assert!(winner == SIDE_A || winner == SIDE_B, EInvalidSide);

        let now     = clock.timestamp_ms();
        let total_a = pool.side_a_pool.value();
        let total_b = pool.side_b_pool.value();
        let total   = total_a + total_b;

        assert!(total > 0, EEmptyPool);

        let fee     = (total * PLATFORM_FEE_BPS) / BPS_DENOM;
        let payout  = total - fee;

        // Record settlement state
        pool.winner              = winner;
        pool.settled_payout_pool = payout;
        pool.status              = POOL_SETTLED;
        pool.settled_at          = now;

        // Record which side was winning and its total stake
        pool.winning_side_total = if (winner == SIDE_A) { pool.total_a_staked } else { pool.total_b_staked };

        // Drain both sides into one merged pool, extract fee to oracle wallet
        let mut combined = pool.side_a_pool.split(total_a);
        combined.join(pool.side_b_pool.split(total_b));

        let fee_coin = combined.split(fee).into_coin(ctx);
        transfer::public_transfer(fee_coin, ctx.sender());

        // Store remaining in payout_vault — winners claim from here
        pool.payout_vault.join(combined);

        stats.total_settled = stats.total_settled + 1;

        event::emit(PulsePoolSettled {
            pool_id:      object::id(pool),
            winner,
            payout_pool:  payout,
            fee,
            winning_side: pool.winning_side_total,
            timestamp:    now,
        });
    }

    /// Void the pool (event cancelled / postponed).
    /// Winners can claim full stake refund after this.
    public entry fun pulse_void_pool<T>(
        _oracle_cap: &OracleCap,
        pool:        &mut PulsePool<T>,
        stats:       &mut PulseStats,
        clock:       &Clock,
    ) {
        assert!(
            pool.status == POOL_OPEN || pool.status == POOL_LOCKED,
            EPoolNotOpen,
        );

        let now = clock.timestamp_ms();
        pool.status     = POOL_VOIDED;
        pool.settled_at = now;

        stats.total_voided = stats.total_voided + 1;

        event::emit(PulsePoolVoided {
            pool_id:   object::id(pool),
            timestamp: now,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLAIM WINNINGS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Winner claims their proportional payout.
    ///
    /// Consumes the PulsePosition NFT (burns it) — no double-claim possible.
    ///
    /// Payout = position.stake × pool.settled_payout_pool / pool.winning_side_total
    ///
    /// Example:
    ///   Pool: 100 SUI on A, 80 SUI on B = 180 SUI total
    ///   Fee: 3.6 SUI (2%) → payout_pool = 176.4 SUI
    ///   Side A wins. total_a_staked = 100 SUI.
    ///   Position with 10 SUI stake on A:
    ///   → payout = 10 × 176.4 / 100 = 17.64 SUI  (1.764x return)
    public entry fun pulse_claim_winnings<T>(
        pool:     &mut PulsePool<T>,
        position: PulsePosition<T>,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        assert!(pool.status == POOL_SETTLED, EPoolNotSettled);

        let PulsePosition {
            id,
            pool_id,
            holder,
            side,
            stake,
            snapshot_total: _,
            snapshot_side:  _,
            joined_at:      _,
        } = position;

        assert!(pool_id == object::id(pool), EWrongPool);
        assert!(side == pool.winner,         ENotWinningSide);
        assert!(ctx.sender() == holder,      EUnauthorized);

        // Proportional payout from settled_payout_pool
        let num    = (stake as u128) * (pool.settled_payout_pool as u128);
        let den    = pool.winning_side_total as u128;
        let payout = ((num / den) as u64);

        let position_id = id.to_inner();
        object::delete(id);

        pool.claimed_count = pool.claimed_count + 1;

        let now         = clock.timestamp_ms();
        let payout_coin = pool.payout_vault.split(payout).into_coin(ctx);
        transfer::public_transfer(payout_coin, holder);

        event::emit(PulseWinningsClaimed {
            pool_id:     object::id(pool),
            position_id,
            winner:      holder,
            stake,
            payout,
            timestamp:   now,
        });
    }

    /// Holder claims full stake refund from a voided pool.
    ///
    /// Consumes the PulsePosition NFT (burns it) — no double-claim possible.
    /// Works for both sides: everyone gets their exact stake back.
    public entry fun pulse_claim_void_refund<T>(
        pool:     &mut PulsePool<T>,
        position: PulsePosition<T>,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        assert!(pool.status == POOL_VOIDED, EPoolNotVoided);

        let PulsePosition {
            id,
            pool_id,
            holder,
            side,
            stake,
            snapshot_total: _,
            snapshot_side:  _,
            joined_at:      _,
        } = position;

        assert!(pool_id == object::id(pool), EWrongPool);
        assert!(ctx.sender() == holder,      EUnauthorized);

        let position_id = id.to_inner();
        object::delete(id);

        pool.claimed_count = pool.claimed_count + 1;

        let now         = clock.timestamp_ms();
        let refund_coin = if (side == SIDE_A) {
            pool.side_a_pool.split(stake).into_coin(ctx)
        } else {
            pool.side_b_pool.split(stake).into_coin(ctx)
        };

        transfer::public_transfer(refund_coin, holder);

        event::emit(PulseVoidRefunded {
            pool_id:     object::id(pool),
            position_id,
            holder,
            refund:      stake,
            timestamp:   now,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WARP-STYLE BATCH MARKER
    // ═══════════════════════════════════════════════════════════════════════════

    /// Oracle calls this once per batch PTB after settling multiple pools.
    ///
    /// count  = pools settled in this PTB
    /// voided = pools voided in this PTB
    ///
    /// Requires OracleCap — prevents fake batch inflation.
    public entry fun pulse_batch_close(
        _oracle_cap: &OracleCap,
        stats:       &mut PulseStats,
        count:       u64,
        voided:      u64,
        clock:       &Clock,
    ) {
        assert!(count  > 0,              EBatchEmpty);
        assert!(count  <= MAX_BATCH_SIZE, EBatchTooLarge);
        assert!(voided <= MAX_BATCH_SIZE, EBatchTooLarge);

        stats.total_batches = stats.total_batches + 1;
        stats.last_batch_ts = clock.timestamp_ms();

        let batch_total = count + voided;
        if (batch_total > stats.max_batch_size) {
            stats.max_batch_size = batch_total;
        };

        event::emit(PulseBatchSettled {
            batch_id:  stats.total_batches,
            count,
            voided,
            timestamp: stats.last_batch_ts,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    public fun pool_status<T>(p: &PulsePool<T>): u8             { p.status }
    public fun pool_winner<T>(p: &PulsePool<T>): u8             { p.winner }
    public fun pool_total_a<T>(p: &PulsePool<T>): u64           { p.side_a_pool.value() }
    public fun pool_total_b<T>(p: &PulsePool<T>): u64           { p.side_b_pool.value() }
    public fun pool_total_staked<T>(p: &PulsePool<T>): u64      { p.total_a_staked + p.total_b_staked }
    public fun pool_position_count<T>(p: &PulsePool<T>): u64    { p.position_count }
    public fun pool_claimed_count<T>(p: &PulsePool<T>): u64     { p.claimed_count }
    public fun pool_payout_vault<T>(p: &PulsePool<T>): u64      { p.payout_vault.value() }
    public fun pool_winning_side_total<T>(p: &PulsePool<T>): u64 { p.winning_side_total }
    public fun pool_settled_payout<T>(p: &PulsePool<T>): u64    { p.settled_payout_pool }
    public fun pool_created_at<T>(p: &PulsePool<T>): u64        { p.created_at }
    public fun pool_settled_at<T>(p: &PulsePool<T>): u64        { p.settled_at }

    /// Indicative live odds numerator for a given side (total pool)
    public fun live_odds_num<T>(p: &PulsePool<T>): u64 {
        p.side_a_pool.value() + p.side_b_pool.value()
    }
    /// Indicative live odds denominator for side A
    public fun live_odds_den_a<T>(p: &PulsePool<T>): u64 { p.side_a_pool.value() }
    /// Indicative live odds denominator for side B
    public fun live_odds_den_b<T>(p: &PulsePool<T>): u64 { p.side_b_pool.value() }

    public fun position_pool_id<T>(pos: &PulsePosition<T>): ID  { pos.pool_id }
    public fun position_holder<T>(pos: &PulsePosition<T>): address { pos.holder }
    public fun position_side<T>(pos: &PulsePosition<T>): u8     { pos.side }
    public fun position_stake<T>(pos: &PulsePosition<T>): u64   { pos.stake }
    public fun position_joined_at<T>(pos: &PulsePosition<T>): u64 { pos.joined_at }
    /// Indicative odds at join time: snapshot_total / snapshot_side
    public fun position_snap_odds_num<T>(pos: &PulsePosition<T>): u64 { pos.snapshot_total }
    public fun position_snap_odds_den<T>(pos: &PulsePosition<T>): u64 { pos.snapshot_side }

    public fun stats_total_pools(s: &PulseStats): u64      { s.total_pools }
    public fun stats_total_positions(s: &PulseStats): u64  { s.total_positions }
    public fun stats_total_settled(s: &PulseStats): u64    { s.total_settled }
    public fun stats_total_voided(s: &PulseStats): u64     { s.total_voided }
    public fun stats_total_volume(s: &PulseStats): u64     { s.total_volume }
    public fun stats_total_batches(s: &PulseStats): u64    { s.total_batches }
    public fun stats_max_batch_size(s: &PulseStats): u64   { s.max_batch_size }
    public fun stats_last_batch_ts(s: &PulseStats): u64    { s.last_batch_ts }
}
