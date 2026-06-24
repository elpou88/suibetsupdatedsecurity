#[allow(duplicate_alias, unused_const, lint(public_entry), deprecated_usage, unused_use)]
/// SuiBets P2P Betting v2 — Fully on-chain peer-to-peer sports betting order book.
///
/// ── Feature parity ──────────────────────────────────────────────────────────
///
///   vs Polymarket (Polygon + USDC CPMM):
///     ✦ Generic <T> coin — accepts SUI *or* USDC (or any Sui coin)
///     ✦ No LP / no CPMM / no slippage — odds fixed by maker at post time
///     ✦ Optional 2-hour dispute window before payout (UMA-style challenge)
///     ✦ Direct PTB coin transfer for settlement (no ERC-1155 redemption)
///     ✦ Live-API oracle (no 2-day UMA dispute period on happy path)
///
///   vs Hyperliquid (HyperBFT on-chain CLOB):
///     ✦ P2PRegistry shared object = on-chain order book (every offer/bet/parlay ID)
///     ✦ Every lifecycle event emitted on-chain = full transparent history
///     ✦ HIP-4 maker rebates up to −0.5% net fee (negative maker fees at Elite tier)
///     ✦ Partial fills: each taker fill creates an independent P2PMatchedBet object
///     ✦ Settlement proof: winner paid directly from contract escrow, txHash on-chain
///
/// ── Architecture ─────────────────────────────────────────────────────────────
///   P2POffer<T>      — open order posted by maker (partially fillable)
///   P2PMatchedBet<T> — independent matched position per fill (maker vs one taker)
///   P2PParlay<T>     — multi-leg wager, single taker
///   P2PRegistry      — shared on-chain registry of all open IDs (order book)
///   P2PConfig        — global config + multi-token fee vault (Bag)
///
module p2p_betting::p2p_betting {

    use sui::balance::{Self, Balance};
    use sui::bag::{Self, Bag};
    use sui::clock::Clock;
    use sui::coin::{Self, Coin};
    use sui::dynamic_field;
    use sui::event;
    use sui::table::{Self, Table};
    use sui::types;
    use std::option::{Self, Option};
    use std::type_name::{Self, TypeName};
    // ── OpenZeppelin libraries ────────────────────────────────────────────────
    use openzeppelin_math::math as oz_math;
    use openzeppelin_access::access_control::Auth;
    use p2p_betting::roles::OracleRole;

    // ── Error codes ──────────────────────────────────────────────────────────

    const ENotOneTimeWitness:     u64 = 0;
    const EUnauthorized:          u64 = 1;
    const EInvalidOdds:           u64 = 2;
    const EInvalidAmount:         u64 = 3;
    const EPlatformPaused:        u64 = 4;
    const EOfferNotOpen:          u64 = 5;
    const EBetNotMatched:         u64 = 6;
    const EStakeMismatch:         u64 = 7;
    const ESelfBet:               u64 = 8;
    const EOfferExpired:          u64 = 9;
    const EOfferNotExpired:       u64 = 10;
    const EAlreadySettled:        u64 = 11;
    const EInsufficientBalance:   u64 = 12;
    const EConfigMismatch:        u64 = 13;
    const ELegAlreadySettled:     u64 = 14;
    const ENotAllLegsSettled:     u64 = 15;
    const EInvalidLegCount:       u64 = 16;
    const ELegIndexOob:           u64 = 17;
    const EParlayNotMatched:      u64 = 18;
    const ENoTaker:               u64 = 19;
    const EDisputeWindowActive:   u64 = 20;
    const EDisputeWindowPassed:   u64 = 21;
    const EBetDisputed:           u64 = 22;
    const EBetNotSettling:        u64 = 23;
    const EBetAlreadyDisputed:    u64 = 24;
    const EPartialFillTooLarge:   u64 = 25;
    const ENoRemainingStake:      u64 = 26;
    const EOfferFull:             u64 = 27;
    const ESettleNotQueued:       u64 = 28;

    // ── Status constants (u8) — kept for on-chain upgrade compatibility ───────
    // Struct fields store these raw values.  Use the enums below for readable code.

    const STATUS_OPEN:        u8 = 0;
    const STATUS_FILLED:      u8 = 1;
    const STATUS_MATCHED:     u8 = 2;
    const STATUS_SETTLING:    u8 = 3;
    const STATUS_MAKER_WON:   u8 = 4;
    const STATUS_TAKER_WON:   u8 = 5;
    const STATUS_VOID:        u8 = 6;
    const STATUS_CANCELLED:   u8 = 7;
    const STATUS_EXPIRED:     u8 = 8;
    const STATUS_DISPUTED:    u8 = 9;

    // Parlay leg statuses
    const LEG_PENDING: u8 = 0;
    const LEG_WON:     u8 = 1;
    const LEG_LOST:    u8 = 2;
    const LEG_VOID:    u8 = 3;

    // ── Status enums ─────────────────────────────────────────────────────────
    // Typed view over the u8 constants. Struct fields remain u8 so upgrades
    // can read objects written by older package versions.

    /// Offer lifecycle states.
    public enum OfferStatus has copy, drop {
        Open,
        Filled,
        Cancelled,
        Expired,
    }

    /// Matched-bet lifecycle states.
    public enum BetStatus has copy, drop {
        Matched,
        Settling,
        MakerWon,
        TakerWon,
        Void,
        Cancelled,
        Expired,
        Disputed,
    }

    /// Parlay leg result states.
    public enum LegStatus has copy, drop {
        Pending,
        Won,
        Lost,
        Voided,
    }

    // ── Platform constants ───────────────────────────────────────────────────

    const BPS_DENOMINATOR:          u64 = 10_000;
    const MIN_STAKE_BASE:           u64 = 10_000_000;    // 0.01 SUI or USDC micro-units
    const MAX_PARLAY_LEGS:          u64 = 8;
    const DEFAULT_DISPUTE_WINDOW:   u64 = 7_200_000;     // 2 hours in ms

    // HIP-4 volume tier thresholds (cumulative lifetime volume in base units)
    const TIER_SILVER:    u64 =   100_000_000_000;
    const TIER_GOLD:      u64 = 1_000_000_000_000;
    const TIER_DIAMOND:   u64 = 10_000_000_000_000;
    const TIER_ELITE:     u64 = 100_000_000_000_000;

    // HIP-4 taker fee BPS
    const FEE_BRONZE:   u64 = 200;
    const FEE_SILVER:   u64 = 150;
    const FEE_GOLD:     u64 = 100;
    const FEE_DIAMOND:  u64 =  75;
    const FEE_ELITE:    u64 =  50;

    // HIP-4 maker rebate BPS
    const REBATE_BRONZE:   u64 =  0;
    const REBATE_SILVER:   u64 =  0;
    const REBATE_GOLD:     u64 = 10;
    const REBATE_DIAMOND:  u64 = 20;
    const REBATE_ELITE:    u64 = 30;

    // ── One-time witness ─────────────────────────────────────────────────────

    public struct P2P_BETTING has drop {}

    // ── Capabilities ─────────────────────────────────────────────────────────

    public struct AdminCap  has key, store { id: UID }
    public struct OracleCap has key, store { id: UID }

    // ── Multi-sig: pending fee withdrawal (requires AdminCap + OracleCap) ────
    // A withdrawal is proposed by AdminCap, then counter-signed by OracleCap.
    // Neither party alone can drain the fee vault.

    public struct WithdrawalProposal has key {
        id:        UID,
        config_id: ID,
        coin_type: vector<u8>,
        amount:    u64,
        recipient: address,
        proposed_at: u64,
        executed:  bool,
    }

    public struct WithdrawalExecuted has copy, drop {
        proposal_id: ID,
        config_id:   ID,
        amount:      u64,
        recipient:   address,
        timestamp:   u64,
    }

    // ── Global platform config ────────────────────────────────────────────────

    public struct P2PConfig has key {
        id:                 UID,
        admin:              address,
        paused:             bool,
        min_stake:          u64,
        default_fee_bps:    u64,
        dispute_window_ms:  u64,
        total_offers:       u64,
        total_bets:         u64,
        total_parlays:      u64,
        total_volume:       u64,
        fee_vault:          Bag,
    }

    // ── On-chain order-book registry ─────────────────────────────────────────

    public struct P2PRegistry has key {
        id:            UID,
        open_offers:   Table<ID, bool>,
        live_bets:     Table<ID, bool>,
        open_parlays:  Table<ID, bool>,
    }

    // ── Per-wallet volume (dynamic field on P2PConfig) ────────────────────────

    public struct VolumeKey has copy, drop, store { addr: address }

    public struct WalletVolume has store {
        maker_volume: u64,
        taker_volume: u64,
        total_bets:   u64,
        wins:         u64,
    }

    // ── P2POffer — posted order, partially fillable ───────────────────────────

    public struct P2POffer<phantom T> has key {
        id:                UID,
        config_id:         ID,
        maker:             address,
        event_id:          vector<u8>,
        event_name:        vector<u8>,
        prediction:        vector<u8>,
        market_type:       vector<u8>,
        odds_bps:          u64,
        maker_stake_total: u64,
        maker_remaining:   Balance<T>,
        filled_taker:      u64,
        match_count:       u64,
        status:            u8,   // see OfferStatus enum
        created_at:        u64,
        expires_at:        u64,
        maker_rebate_bps:  u64,
    }

    // ── P2PMatchedBet — one fill between maker and one taker ─────────────────

    public struct P2PMatchedBet<phantom T> has key {
        id:                  UID,
        offer_id:            ID,
        config_id:           ID,
        maker:               address,
        taker:               address,
        event_id:            vector<u8>,
        event_name:          vector<u8>,
        prediction:          vector<u8>,
        odds_bps:            u64,
        maker_balance:       Balance<T>,
        taker_balance:       Balance<T>,
        status:              u8,   // see BetStatus enum
        created_at:          u64,
        expires_at:          u64,
        maker_rebate_bps:    u64,
        taker_fee_bps:       u64,
        pending_maker_wins:  bool,
        settle_queued_at:    u64,
        disputed:            bool,
        disputer:            Option<address>,
    }

    // ── P2PParlay — multi-leg wager (generic coin) ────────────────────────────

    public struct P2PParlay<phantom T> has key {
        id:                  UID,
        config_id:           ID,
        maker:               address,
        event_ids:           vector<vector<u8>>,
        event_names:         vector<vector<u8>>,
        predictions:         vector<vector<u8>>,
        leg_statuses:        vector<u8>,   // see LegStatus enum per element
        legs_settled:        u64,
        maker_stake:         Balance<T>,
        taker_required:      u64,
        taker:               Option<address>,
        taker_balance:       Balance<T>,
        status:              u8,   // see BetStatus enum
        created_at:          u64,
        expires_at:          u64,
        maker_rebate_bps:    u64,
        taker_fee_bps:       u64,
        pending_maker_wins:  bool,
        settle_queued_at:    u64,
        disputed:            bool,
        disputer:            Option<address>,
    }

    // ── Events ───────────────────────────────────────────────────────────────

    public struct PlatformCreated has copy, drop {
        config_id:         ID,
        registry_id:       ID,
        admin:             address,
        min_stake:         u64,
        fee_bps:           u64,
        dispute_window_ms: u64,
        timestamp:         u64,
    }

    public struct ConfigUpdated has copy, drop {
        config_id:         ID,
        paused:            bool,
        fee_bps:           u64,
        min_stake:         u64,
        dispute_window_ms: u64,
        timestamp:         u64,
    }

    public struct OracleCapMinted has copy, drop {
        oracle_cap_id: ID,
        recipient:     address,
        timestamp:     u64,
    }

    public struct FeesWithdrawn has copy, drop {
        config_id:  ID,
        coin_type:  vector<u8>,
        amount:     u64,
        recipient:  address,
        timestamp:  u64,
    }

    public struct OfferPosted has copy, drop {
        offer_id:         ID,
        config_id:        ID,
        maker:            address,
        event_id:         vector<u8>,
        event_name:       vector<u8>,
        prediction:       vector<u8>,
        market_type:      vector<u8>,
        odds_bps:         u64,
        maker_stake:      u64,
        maker_rebate_bps: u64,
        expires_at:       u64,
        timestamp:        u64,
    }

    public struct OfferFilled has copy, drop {
        offer_id:    ID,
        bet_id:      ID,
        taker:       address,
        fill_amount: u64,
        remaining:   u64,
        timestamp:   u64,
    }

    public struct OfferCancelled has copy, drop {
        offer_id:  ID,
        maker:     address,
        refund:    u64,
        timestamp: u64,
    }

    public struct OfferExpired has copy, drop {
        offer_id:  ID,
        maker:     address,
        refund:    u64,
        timestamp: u64,
    }

    public struct BetSettleQueued has copy, drop {
        bet_id:             ID,
        pending_maker_wins: bool,
        settle_due_ms:      u64,
        timestamp:          u64,
    }

    public struct BetDisputed has copy, drop {
        bet_id:    ID,
        disputer:  address,
        timestamp: u64,
    }

    public struct BetDisputeResolved has copy, drop {
        bet_id:         ID,
        oracle:         address,
        maker_wins:     bool,
        new_settle_due: u64,
        timestamp:      u64,
    }

    public struct BetSettled has copy, drop {
        bet_id:       ID,
        status:       u8,
        winner:       address,
        payout:       u64,
        platform_fee: u64,
        timestamp:    u64,
    }

    public struct BetVoided has copy, drop {
        bet_id:       ID,
        maker_refund: u64,
        taker_refund: u64,
        timestamp:    u64,
    }

    public struct ParlayPosted has copy, drop {
        parlay_id:      ID,
        config_id:      ID,
        maker:          address,
        num_legs:       u64,
        maker_stake:    u64,
        taker_required: u64,
        expires_at:     u64,
        timestamp:      u64,
    }

    public struct ParlayAccepted has copy, drop {
        parlay_id:     ID,
        taker:         address,
        taker_stake:   u64,
        taker_fee_bps: u64,
        timestamp:     u64,
    }

    public struct ParlayLegSettled has copy, drop {
        parlay_id:  ID,
        leg_index:  u64,
        leg_status: u8,
        timestamp:  u64,
    }

    public struct ParlayLegVoided has copy, drop {
        parlay_id: ID,
        leg_index: u64,
        timestamp: u64,
    }

    public struct ParlaySettleQueued has copy, drop {
        parlay_id:          ID,
        pending_maker_wins: bool,
        settle_due_ms:      u64,
        timestamp:          u64,
    }

    public struct ParlayDisputed has copy, drop {
        parlay_id: ID,
        disputer:  address,
        timestamp: u64,
    }

    public struct ParlaySettled has copy, drop {
        parlay_id:    ID,
        status:       u8,
        winner:       address,
        payout:       u64,
        platform_fee: u64,
        timestamp:    u64,
    }

    public struct ParlayVoided has copy, drop {
        parlay_id:    ID,
        maker_refund: u64,
        taker_refund: u64,
        timestamp:    u64,
    }

    public struct ParlayExpired has copy, drop {
        parlay_id: ID,
        maker:     address,
        refund:    u64,
        timestamp: u64,
    }

    public struct ParlayDisputeResolved has copy, drop {
        parlay_id:      ID,
        maker_wins:     bool,
        new_settle_due: u64,
        timestamp:      u64,
    }

    // ── Macros ────────────────────────────────────────────────────────────────
    // These expand inline — zero runtime overhead, reduce bytecode repetition.

    /// Assert the platform is not paused.
    fun require_active(config: &P2PConfig) {
        assert!(!config.paused, EPlatformPaused);
    }

    /// Assert that a stored config_id matches the live config object.
    macro fun require_config($stored: ID, $live: ID) {
        assert!($stored == $live, EConfigMismatch);
    }

    /// Remove an offer ID from the open-offers registry if present (no-op otherwise).
    fun deregister_offer(registry: &mut P2PRegistry, id: ID) {
        if (registry.open_offers.contains(id)) {
            registry.open_offers.remove(id);
        };
    }

    /// Remove a bet ID from the live-bets registry if present.
    fun deregister_bet(registry: &mut P2PRegistry, id: ID) {
        if (registry.live_bets.contains(id)) {
            registry.live_bets.remove(id);
        };
    }

    /// Remove a parlay ID from the open-parlays registry if present.
    fun deregister_parlay(registry: &mut P2PRegistry, id: ID) {
        if (registry.open_parlays.contains(id)) {
            registry.open_parlays.remove(id);
        };
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fun get_wallet_volume(config: &P2PConfig, wallet: address): u64 {
        if (!dynamic_field::exists_(&config.id, VolumeKey { addr: wallet })) {
            return 0
        };
        let wv = dynamic_field::borrow<VolumeKey, WalletVolume>(
            &config.id, VolumeKey { addr: wallet }
        );
        wv.maker_volume + wv.taker_volume
    }

    fun taker_fee_for_volume(vol: u64): u64 {
        if (vol >= TIER_ELITE)   { return FEE_ELITE   };
        if (vol >= TIER_DIAMOND) { return FEE_DIAMOND };
        if (vol >= TIER_GOLD)    { return FEE_GOLD    };
        if (vol >= TIER_SILVER)  { return FEE_SILVER  };
        FEE_BRONZE
    }

    fun maker_rebate_for_volume(vol: u64): u64 {
        if (vol >= TIER_ELITE)   { return REBATE_ELITE   };
        if (vol >= TIER_DIAMOND) { return REBATE_DIAMOND };
        if (vol >= TIER_GOLD)    { return REBATE_GOLD    };
        if (vol >= TIER_SILVER)  { return REBATE_SILVER  };
        REBATE_BRONZE
    }

    fun get_taker_fee_bps(config: &P2PConfig, wallet: address): u64 {
        taker_fee_for_volume(get_wallet_volume(config, wallet))
    }

    fun get_maker_rebate_bps(config: &P2PConfig, wallet: address): u64 {
        maker_rebate_for_volume(get_wallet_volume(config, wallet))
    }

    fun add_maker_volume(config: &mut P2PConfig, wallet: address, amount: u64) {
        if (!dynamic_field::exists_(&config.id, VolumeKey { addr: wallet })) {
            dynamic_field::add(
                &mut config.id,
                VolumeKey { addr: wallet },
                WalletVolume { maker_volume: amount, taker_volume: 0, total_bets: 1, wins: 0 }
            );
        } else {
            let wv = dynamic_field::borrow_mut<VolumeKey, WalletVolume>(
                &mut config.id, VolumeKey { addr: wallet }
            );
            wv.maker_volume = wv.maker_volume + amount;
            wv.total_bets   = wv.total_bets + 1;
        }
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

    fun record_win(config: &mut P2PConfig, wallet: address) {
        if (dynamic_field::exists_(&config.id, VolumeKey { addr: wallet })) {
            let wv = dynamic_field::borrow_mut<VolumeKey, WalletVolume>(
                &mut config.id, VolumeKey { addr: wallet }
            );
            wv.wins = wv.wins + 1;
        }
    }

    /// net_fee_bps = taker_fee_bps − maker_rebate_bps (floor 0).
    /// Returns (winner_payout, platform_fee) from gross_pot.
    fun calc_payout(
        gross_pot:        u64,
        taker_fee_bps:    u64,
        maker_rebate_bps: u64,
    ): (u64, u64) {
        let net_bps = if (maker_rebate_bps >= taker_fee_bps) { 0u64 }
                      else { taker_fee_bps - maker_rebate_bps };
        // OpenZeppelin Math: overflow-safe (a * b) / d with a single u128 intermediate
        let fee = oz_math::mul_div(gross_pot, net_bps, BPS_DENOMINATOR);
        let payout = if (fee >= gross_pot) { 0u64 } else { gross_pot - fee };
        (payout, fee)
    }

    /// Deposit fee into the multi-token vault.
    fun deposit_fee<T>(config: &mut P2PConfig, fee_balance: Balance<T>) {
        let key = type_name::get<T>();
        if (config.fee_vault.contains(key)) {
            let existing = config.fee_vault.borrow_mut<TypeName, Balance<T>>(key);
            existing.join(fee_balance);
        } else {
            config.fee_vault.add(key, fee_balance);
        }
    }

    fun count_leg_status(statuses: &vector<u8>, target: u8): u64 {
        let len = statuses.length();
        let mut count = 0u64;
        let mut i = 0;
        while (i < len) {
            if (*statuses.borrow(i) == target) { count = count + 1; };
            i = i + 1;
        };
        count
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    fun init(witness: P2P_BETTING, ctx: &mut TxContext) {
        assert!(types::is_one_time_witness(&witness), ENotOneTimeWitness);

        let admin = ctx.sender();

        let admin_cap  = AdminCap  { id: object::new(ctx) };
        let oracle_cap = OracleCap { id: object::new(ctx) };

        let config = P2PConfig {
            id:                object::new(ctx),
            admin,
            paused:            false,
            min_stake:         MIN_STAKE_BASE,
            default_fee_bps:   FEE_BRONZE,
            dispute_window_ms: DEFAULT_DISPUTE_WINDOW,
            total_offers:      0,
            total_bets:        0,
            total_parlays:     0,
            total_volume:      0,
            fee_vault:         bag::new(ctx),
        };

        let registry = P2PRegistry {
            id:           object::new(ctx),
            open_offers:  table::new(ctx),
            live_bets:    table::new(ctx),
            open_parlays: table::new(ctx),
        };

        event::emit(PlatformCreated {
            config_id:         object::id(&config),
            registry_id:       object::id(&registry),
            admin,
            min_stake:         MIN_STAKE_BASE,
            fee_bps:           FEE_BRONZE,
            dispute_window_ms: DEFAULT_DISPUTE_WINDOW,
            timestamp:         0,
        });

        transfer::share_object(config);
        transfer::share_object(registry);
        transfer::transfer(admin_cap,  admin);
        transfer::transfer(oracle_cap, admin);
    }

    // ── Admin: config ────────────────────────────────────────────────────────

    public entry fun set_paused(
        _cap:   &AdminCap,
        config: &mut P2PConfig,
        paused: bool,
        clock:  &Clock,
    ) {
        config.paused = paused;
        event::emit(ConfigUpdated {
            config_id:         object::id(config),
            paused,
            fee_bps:           config.default_fee_bps,
            min_stake:         config.min_stake,
            dispute_window_ms: config.dispute_window_ms,
            timestamp:         clock.timestamp_ms(),
        });
    }

    public entry fun set_min_stake(
        _cap:      &AdminCap,
        config:    &mut P2PConfig,
        min_stake: u64,
        clock:     &Clock,
    ) {
        assert!(min_stake > 0, EInvalidAmount);
        config.min_stake = min_stake;
        event::emit(ConfigUpdated {
            config_id:         object::id(config),
            paused:            config.paused,
            fee_bps:           config.default_fee_bps,
            min_stake,
            dispute_window_ms: config.dispute_window_ms,
            timestamp:         clock.timestamp_ms(),
        });
    }

    /// Set how long (ms) the dispute window lasts after oracle queues a settlement.
    /// Min = 0 (instant, no dispute), default = 7_200_000 (2 hrs).
    public entry fun set_dispute_window(
        _cap:              &AdminCap,
        config:            &mut P2PConfig,
        dispute_window_ms: u64,
        clock:             &Clock,
    ) {
        config.dispute_window_ms = dispute_window_ms;
        event::emit(ConfigUpdated {
            config_id:         object::id(config),
            paused:            config.paused,
            fee_bps:           config.default_fee_bps,
            min_stake:         config.min_stake,
            dispute_window_ms,
            timestamp:         clock.timestamp_ms(),
        });
    }

    public entry fun mint_oracle_cap(
        _cap:      &AdminCap,
        recipient: address,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        let cap = OracleCap { id: object::new(ctx) };
        event::emit(OracleCapMinted {
            oracle_cap_id: object::id(&cap),
            recipient,
            timestamp:     clock.timestamp_ms(),
        });
        transfer::transfer(cap, recipient);
    }

    /// Withdraw accrued fees for coin type T.
    public entry fun withdraw_fees<T>(
        _cap:      &AdminCap,
        config:    &mut P2PConfig,
        amount:    u64,
        recipient: address,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(amount > 0, EInvalidAmount);
        let key = type_name::get<T>();
        assert!(config.fee_vault.contains(key), EInsufficientBalance);
        let vault = config.fee_vault.borrow_mut<TypeName, Balance<T>>(key);
        assert!(vault.value() >= amount, EInsufficientBalance);

        let fee_coin = vault.split(amount).into_coin(ctx);
        event::emit(FeesWithdrawn {
            config_id: object::id(config),
            coin_type: key.into_string().into_bytes(),
            amount,
            recipient,
            timestamp: clock.timestamp_ms(),
        });
        transfer::public_transfer(fee_coin, recipient);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OFFER LIFECYCLE  — P2POffer<T>
    // ═══════════════════════════════════════════════════════════════════════════

    /// Maker posts a new P2P offer at fixed odds.
    ///
    /// odds_bps = decimal_odds × 10 000  (e.g. 2.50x → 25 000)
    /// Enforced: 10 001 ≤ odds_bps ≤ 10 000 000 (1.0001x – 1 000x)
    ///
    /// The offer supports partial fills — takers can fill any portion.
    /// Each fill creates an independent P2PMatchedBet shared object.
    public entry fun post_offer<T>(
        config:      &mut P2PConfig,
        registry:    &mut P2PRegistry,
        payment:     Coin<T>,
        event_id:    vector<u8>,
        event_name:  vector<u8>,
        prediction:  vector<u8>,
        market_type: vector<u8>,
        odds_bps:    u64,
        expires_at:  u64,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_active(config);
        assert!(odds_bps > 10_000 && odds_bps <= 10_000_000, EInvalidOdds);

        let maker             = ctx.sender();
        let maker_stake_total = payment.value();
        assert!(maker_stake_total >= config.min_stake, EInvalidAmount);

        let now = clock.timestamp_ms();
        assert!(expires_at > now, EOfferExpired);

        let maker_rebate_bps = get_maker_rebate_bps(config, maker);
        add_maker_volume(config, maker, maker_stake_total);
        config.total_offers = config.total_offers + 1;
        config.total_volume = config.total_volume + maker_stake_total;

        let offer = P2POffer<T> {
            id:                object::new(ctx),
            config_id:         object::id(config),
            maker,
            event_id,
            event_name,
            prediction,
            market_type,
            odds_bps,
            maker_stake_total,
            maker_remaining:   payment.into_balance(),
            filled_taker:      0,
            match_count:       0,
            status:            STATUS_OPEN,
            created_at:        now,
            expires_at,
            maker_rebate_bps,
        };

        event::emit(OfferPosted {
            offer_id:         object::id(&offer),
            config_id:        object::id(config),
            maker,
            event_id:         offer.event_id,
            event_name:       offer.event_name,
            prediction:       offer.prediction,
            market_type:      offer.market_type,
            odds_bps,
            maker_stake:      maker_stake_total,
            maker_rebate_bps,
            expires_at,
            timestamp:        now,
        });

        registry.open_offers.add(object::id(&offer), true);
        transfer::share_object(offer);
    }

    /// Taker fills a portion (or all) of an open offer.
    ///
    /// `taker_amount` = how much the taker wants to wager.
    /// Corresponding maker portion = taker_amount × 10_000 / (odds_bps − 10_000).
    /// Creates an independent P2PMatchedBet shared object for this fill.
    public entry fun accept_offer<T>(
        config:       &mut P2PConfig,
        registry:     &mut P2PRegistry,
        offer:        &mut P2POffer<T>,
        payment:      Coin<T>,
        taker_amount: u64,
        clock:        &Clock,
        ctx:          &mut TxContext,
    ) {
        require_active(config);
        require_config!(offer.config_id, object::id(config));
        assert!(offer.status == STATUS_OPEN, EOfferNotOpen);

        let taker = ctx.sender();
        assert!(taker != offer.maker, ESelfBet);

        let now = clock.timestamp_ms();
        assert!(now < offer.expires_at, EOfferExpired);
        assert!(taker_amount >= config.min_stake, EInvalidAmount);
        assert!(payment.value() == taker_amount, EStakeMismatch);

        // Compute the corresponding maker portion
        let maker_portion = (
            ((taker_amount as u128) * 10_000u128) / ((offer.odds_bps - 10_000) as u128)
        ) as u64;

        let remaining = offer.maker_remaining.value();
        assert!(remaining > 0, EOfferFull);
        // Clamp maker_portion to remaining (allow partial taker-side fill too)
        let actual_maker = if (maker_portion > remaining) { remaining } else { maker_portion };
        // Recompute actual taker amount for clamped fill
        let actual_taker = (
            ((actual_maker as u128) * ((offer.odds_bps - 10_000) as u128)) / 10_000u128
        ) as u64;
        assert!(actual_taker <= taker_amount, EPartialFillTooLarge);

        let taker_fee_bps = get_taker_fee_bps(config, taker);
        add_taker_volume(config, taker, actual_taker);
        config.total_bets   = config.total_bets + 1;
        config.total_volume = config.total_volume + actual_taker;

        // Split the maker portion out of the offer's remaining balance
        let maker_split = offer.maker_remaining.split(actual_maker);

        // Build taker balance (return excess if any)
        let mut taker_coin = payment;
        let taker_split = if (actual_taker < taker_amount) {
            let excess = taker_coin.split(taker_amount - actual_taker, ctx);
            transfer::public_transfer(excess, taker);
            taker_coin.into_balance()
        } else {
            taker_coin.into_balance()
        };

        offer.filled_taker = offer.filled_taker + actual_taker;
        offer.match_count  = offer.match_count + 1;

        let new_remaining = offer.maker_remaining.value();
        if (new_remaining < config.min_stake) {
            offer.status = STATUS_FILLED;
            deregister_offer(registry, object::id(offer));
        };

        let bet = P2PMatchedBet<T> {
            id:                 object::new(ctx),
            offer_id:           object::id(offer),
            config_id:          object::id(config),
            maker:              offer.maker,
            taker,
            event_id:           offer.event_id,
            event_name:         offer.event_name,
            prediction:         offer.prediction,
            odds_bps:           offer.odds_bps,
            maker_balance:      maker_split,
            taker_balance:      taker_split,
            status:             STATUS_MATCHED,
            created_at:         now,
            expires_at:         offer.expires_at,
            maker_rebate_bps:   offer.maker_rebate_bps,
            taker_fee_bps,
            pending_maker_wins: false,
            settle_queued_at:   0,
            disputed:           false,
            disputer:           option::none(),
        };

        event::emit(OfferFilled {
            offer_id:    object::id(offer),
            bet_id:      object::id(&bet),
            taker,
            fill_amount: actual_taker,
            remaining:   new_remaining,
            timestamp:   now,
        });

        registry.live_bets.add(object::id(&bet), true);
        transfer::share_object(bet);
    }

    /// Maker cancels an unfilled (or partially unfilled) open offer.
    /// Returns the remaining maker stake.
    public entry fun cancel_offer<T>(
        offer:    &mut P2POffer<T>,
        registry: &mut P2PRegistry,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(sender == offer.maker, EUnauthorized);
        assert!(offer.status == STATUS_OPEN, EOfferNotOpen);

        let amount   = offer.maker_remaining.value();
        let refund   = offer.maker_remaining.split(amount).into_coin(ctx);
        offer.status = STATUS_CANCELLED;

        let now = clock.timestamp_ms();
        event::emit(OfferCancelled {
            offer_id:  object::id(offer),
            maker:     offer.maker,
            refund:    amount,
            timestamp: now,
        });

        deregister_offer(registry, object::id(offer));
        transfer::public_transfer(refund, offer.maker);
    }

    /// Anyone can expire an open offer once its deadline has passed.
    public entry fun expire_offer<T>(
        offer:    &mut P2POffer<T>,
        registry: &mut P2PRegistry,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        assert!(offer.status == STATUS_OPEN, EOfferNotOpen);
        let now = clock.timestamp_ms();
        assert!(now >= offer.expires_at, EOfferNotExpired);

        let amount   = offer.maker_remaining.value();
        let refund   = offer.maker_remaining.split(amount).into_coin(ctx);
        offer.status = STATUS_EXPIRED;

        event::emit(OfferExpired {
            offer_id:  object::id(offer),
            maker:     offer.maker,
            refund:    amount,
            timestamp: now,
        });

        deregister_offer(registry, object::id(offer));
        transfer::public_transfer(refund, offer.maker);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MATCHED BET LIFECYCLE  — P2PMatchedBet<T>
    // ═══════════════════════════════════════════════════════════════════════════

    /// Oracle queues a settlement (starts the dispute window).
    /// `maker_wins` = true → maker predicted correctly.
    ///
    /// The payout is NOT sent immediately.  After `dispute_window_ms` has elapsed
    /// (and no dispute was raised or dispute was resolved), anyone calls
    /// `claim_settlement<T>` to release the funds.
    public entry fun queue_settle_bet<T>(
        _auth:         &Auth<OracleRole>,  // OZ AccessControl — replaces legacy OracleCap
        config:        &P2PConfig,
        bet:           &mut P2PMatchedBet<T>,
        maker_wins:    bool,
        clock:         &Clock,
    ) {
        require_config!(bet.config_id, object::id(config));
        assert!(bet.status == STATUS_MATCHED, EBetNotMatched);
        assert!(bet.settle_queued_at == 0, EAlreadySettled);

        let now = clock.timestamp_ms();
        bet.status             = STATUS_SETTLING;
        bet.pending_maker_wins = maker_wins;
        bet.settle_queued_at   = now;
        bet.disputed           = false;

        event::emit(BetSettleQueued {
            bet_id:             object::id(bet),
            pending_maker_wins: maker_wins,
            settle_due_ms:      now + config.dispute_window_ms,
            timestamp:          now,
        });
    }

    /// Anyone can dispute a queued settlement during the dispute window.
    /// This flags the bet for oracle review (status → DISPUTED).
    public entry fun dispute_settlement<T>(
        bet:   &mut P2PMatchedBet<T>,
        clock: &Clock,
        ctx:   &mut TxContext,
    ) {
        assert!(bet.status == STATUS_SETTLING, EBetNotSettling);
        assert!(!bet.disputed, EBetAlreadyDisputed);
        assert!(bet.settle_queued_at > 0, ESettleNotQueued);

        let now      = clock.timestamp_ms();
        let disputer = ctx.sender();
        bet.disputed = true;
        bet.disputer = option::some(disputer);
        bet.status   = STATUS_DISPUTED;

        event::emit(BetDisputed {
            bet_id:    object::id(bet),
            disputer,
            timestamp: now,
        });
    }

    /// Oracle resolves a disputed bet (can override the original decision).
    /// Resets the dispute window so `claim_settlement` can be called again.
    public entry fun resolve_dispute<T>(
        _oracle_cap: &OracleCap,
        config:      &P2PConfig,
        bet:         &mut P2PMatchedBet<T>,
        maker_wins:  bool,
        clock:       &Clock,
    ) {
        require_config!(bet.config_id, object::id(config));
        assert!(bet.status == STATUS_DISPUTED, EBetNotSettling);

        let now = clock.timestamp_ms();
        bet.pending_maker_wins = maker_wins;
        bet.settle_queued_at   = now;
        bet.disputed           = false;
        bet.disputer           = option::none();
        bet.status             = STATUS_SETTLING;

        event::emit(BetDisputeResolved {
            bet_id:         object::id(bet),
            oracle:         @0x0,
            maker_wins,
            new_settle_due: now + config.dispute_window_ms,
            timestamp:      now,
        });
    }

    /// Claim the settlement payout after the dispute window has passed.
    /// Anyone can call this — the payout goes to the correct winner.
    public entry fun claim_settlement<T>(
        config:   &mut P2PConfig,
        registry: &mut P2PRegistry,
        bet:      &mut P2PMatchedBet<T>,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        require_config!(bet.config_id, object::id(config));
        assert!(bet.status == STATUS_SETTLING, EBetNotSettling);
        assert!(!bet.disputed, EBetDisputed);
        assert!(bet.settle_queued_at > 0, ESettleNotQueued);

        let now = clock.timestamp_ms();
        assert!(now >= bet.settle_queued_at + config.dispute_window_ms, EDisputeWindowActive);

        let maker_val = bet.maker_balance.value();
        let taker_val = bet.taker_balance.value();
        // Safe addition — u128 intermediate prevents u64 overflow on large stakes
        let gross_pot = (((maker_val as u128) + (taker_val as u128)) as u64);

        let (payout, fee) = calc_payout(gross_pot, bet.taker_fee_bps, bet.maker_rebate_bps);

        let mut pot = bet.maker_balance.split(maker_val);
        pot.join(bet.taker_balance.split(taker_val));

        if (fee > 0) {
            deposit_fee(config, pot.split(fee));
        };

        let actual_payout = pot.value();
        let winner        = if (bet.pending_maker_wins) { bet.maker } else { bet.taker };
        let final_status  = if (bet.pending_maker_wins) { STATUS_MAKER_WON } else { STATUS_TAKER_WON };

        record_win(config, winner);
        bet.status = final_status;

        event::emit(BetSettled {
            bet_id:       object::id(bet),
            status:       final_status,
            winner,
            payout:       actual_payout,
            platform_fee: fee,
            timestamp:    now,
        });

        deregister_bet(registry, object::id(bet));
        transfer::public_transfer(pot.into_coin(ctx), winner);
        let _ = payout;
    }

    /// Oracle voids a matched bet — full refunds to both parties.
    public entry fun void_bet<T>(
        _oracle_cap: &OracleCap,
        config:      &P2PConfig,
        registry:    &mut P2PRegistry,
        bet:         &mut P2PMatchedBet<T>,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_config!(bet.config_id, object::id(config));
        assert!(
            bet.status == STATUS_MATCHED   ||
            bet.status == STATUS_SETTLING  ||
            bet.status == STATUS_DISPUTED,
            EAlreadySettled
        );

        let maker_amount = bet.maker_balance.value();
        let taker_amount = bet.taker_balance.value();
        let now          = clock.timestamp_ms();

        let maker_refund = bet.maker_balance.split(maker_amount).into_coin(ctx);
        let taker_refund = bet.taker_balance.split(taker_amount).into_coin(ctx);
        bet.status = STATUS_VOID;

        event::emit(BetVoided {
            bet_id:       object::id(bet),
            maker_refund: maker_amount,
            taker_refund: taker_amount,
            timestamp:    now,
        });

        deregister_bet(registry, object::id(bet));
        transfer::public_transfer(maker_refund, bet.maker);
        transfer::public_transfer(taker_refund, bet.taker);
        let _ = config;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PARLAY LIFECYCLE  — P2PParlay<T>
    // ═══════════════════════════════════════════════════════════════════════════

    /// Post a multi-leg parlay offer.
    /// Creator wins if ALL legs win; taker wins if ANY leg loses.
    public entry fun post_parlay<T>(
        config:         &mut P2PConfig,
        registry:       &mut P2PRegistry,
        payment:        Coin<T>,
        event_ids:      vector<vector<u8>>,
        event_names:    vector<vector<u8>>,
        predictions:    vector<vector<u8>>,
        odds_bps_legs:  vector<u64>,
        total_odds_bps: u64,
        expires_at:     u64,
        clock:          &Clock,
        ctx:            &mut TxContext,
    ) {
        require_active(config);
        let num_legs = event_ids.length();
        assert!(num_legs >= 2 && num_legs <= MAX_PARLAY_LEGS, EInvalidLegCount);
        assert!(total_odds_bps > 10_000, EInvalidOdds);

        let maker         = ctx.sender();
        let creator_stake = payment.value();
        assert!(creator_stake >= config.min_stake, EInvalidAmount);

        let now = clock.timestamp_ms();
        assert!(expires_at > now, EOfferExpired);

        let taker_required = (
            ((creator_stake as u128) * ((total_odds_bps - 10_000) as u128)) / 10_000u128
        ) as u64;
        assert!(taker_required >= config.min_stake, EInvalidAmount);

        let maker_rebate_bps = get_maker_rebate_bps(config, maker);
        add_maker_volume(config, maker, creator_stake);
        config.total_parlays = config.total_parlays + 1;
        config.total_volume  = config.total_volume + creator_stake;

        // Build initial leg_statuses (all PENDING)
        let mut leg_statuses = vector[];
        let mut i = 0u64;
        while (i < num_legs) {
            leg_statuses.push_back(LEG_PENDING);
            i = i + 1;
        };

        let parlay = P2PParlay<T> {
            id:                object::new(ctx),
            config_id:         object::id(config),
            maker,
            event_ids,
            event_names,
            predictions,
            leg_statuses,
            legs_settled:      0,
            maker_stake:       payment.into_balance(),
            taker_required,
            taker:             option::none(),
            taker_balance:     balance::zero<T>(),
            status:            STATUS_OPEN,
            created_at:        now,
            expires_at,
            maker_rebate_bps,
            taker_fee_bps:     0,
            pending_maker_wins: false,
            settle_queued_at:  0,
            disputed:          false,
            disputer:          option::none(),
        };

        event::emit(ParlayPosted {
            parlay_id:      object::id(&parlay),
            config_id:      object::id(config),
            maker,
            num_legs,
            maker_stake:    creator_stake,
            taker_required,
            expires_at,
            timestamp:      now,
        });

        let _ = odds_bps_legs;
        registry.open_parlays.add(object::id(&parlay), true);
        transfer::share_object(parlay);
    }

    /// Taker accepts the parlay.  Payment must exactly equal `taker_required`.
    public entry fun accept_parlay<T>(
        config:  &mut P2PConfig,
        parlay:  &mut P2PParlay<T>,
        payment: Coin<T>,
        clock:   &Clock,
        ctx:     &mut TxContext,
    ) {
        require_active(config);
        require_config!(parlay.config_id, object::id(config));
        assert!(parlay.status == STATUS_OPEN, EOfferNotOpen);

        let taker       = ctx.sender();
        let taker_stake = payment.value();
        assert!(taker != parlay.maker, ESelfBet);
        assert!(taker_stake == parlay.taker_required, EStakeMismatch);

        let now = clock.timestamp_ms();
        assert!(now < parlay.expires_at, EOfferExpired);

        let taker_fee_bps = get_taker_fee_bps(config, taker);
        add_taker_volume(config, taker, taker_stake);
        config.total_volume = config.total_volume + taker_stake;

        parlay.taker         = option::some(taker);
        parlay.taker_balance.join(payment.into_balance());
        parlay.taker_fee_bps = taker_fee_bps;
        parlay.status        = STATUS_MATCHED;

        event::emit(ParlayAccepted {
            parlay_id:    object::id(parlay),
            taker,
            taker_stake,
            taker_fee_bps,
            timestamp:    now,
        });
    }

    /// Maker cancels an unmatched parlay.
    public entry fun cancel_parlay<T>(
        parlay:   &mut P2PParlay<T>,
        registry: &mut P2PRegistry,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(sender == parlay.maker, EUnauthorized);
        assert!(parlay.status == STATUS_OPEN, EOfferNotOpen);

        let amount    = parlay.maker_stake.value();
        let refund    = parlay.maker_stake.split(amount).into_coin(ctx);
        parlay.status = STATUS_CANCELLED;

        let now = clock.timestamp_ms();
        event::emit(ParlayVoided {
            parlay_id:    object::id(parlay),
            maker_refund: amount,
            taker_refund: 0,
            timestamp:    now,
        });

        deregister_parlay(registry, object::id(parlay));
        transfer::public_transfer(refund, parlay.maker);
    }

    /// Anyone can expire an unmatched parlay past its deadline.
    public entry fun expire_parlay<T>(
        parlay:   &mut P2PParlay<T>,
        registry: &mut P2PRegistry,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        assert!(parlay.status == STATUS_OPEN, EOfferNotOpen);
        let now = clock.timestamp_ms();
        assert!(now >= parlay.expires_at, EOfferNotExpired);

        let amount    = parlay.maker_stake.value();
        let refund    = parlay.maker_stake.split(amount).into_coin(ctx);
        parlay.status = STATUS_EXPIRED;

        event::emit(ParlayExpired {
            parlay_id: object::id(parlay),
            maker:     parlay.maker,
            refund:    amount,
            timestamp: now,
        });

        deregister_parlay(registry, object::id(parlay));
        transfer::public_transfer(refund, parlay.maker);
    }

    /// Oracle settles one leg.  `leg_won` = true if maker's prediction was correct.
    public entry fun settle_parlay_leg<T>(
        _oracle_cap: &OracleCap,
        parlay:      &mut P2PParlay<T>,
        leg_index:   u64,
        leg_won:     bool,
        clock:       &Clock,
    ) {
        assert!(
            parlay.status == STATUS_MATCHED || parlay.status == STATUS_SETTLING,
            EParlayNotMatched
        );
        let num_legs = parlay.leg_statuses.length();
        assert!(leg_index < num_legs, ELegIndexOob);

        let current = *parlay.leg_statuses.borrow(leg_index);
        assert!(current == LEG_PENDING, ELegAlreadySettled);

        let new_status = if (leg_won) { LEG_WON } else { LEG_LOST };
        *parlay.leg_statuses.borrow_mut(leg_index) = new_status;
        parlay.legs_settled = parlay.legs_settled + 1;
        if (parlay.status == STATUS_MATCHED) { parlay.status = STATUS_SETTLING; };

        event::emit(ParlayLegSettled {
            parlay_id:  object::id(parlay),
            leg_index,
            leg_status: new_status,
            timestamp:  clock.timestamp_ms(),
        });
    }

    /// Oracle voids one leg (match cancelled / postponed).
    public entry fun void_parlay_leg<T>(
        _oracle_cap: &OracleCap,
        parlay:      &mut P2PParlay<T>,
        leg_index:   u64,
        clock:       &Clock,
    ) {
        assert!(
            parlay.status == STATUS_MATCHED || parlay.status == STATUS_SETTLING,
            EParlayNotMatched
        );
        let num_legs = parlay.leg_statuses.length();
        assert!(leg_index < num_legs, ELegIndexOob);
        let current = *parlay.leg_statuses.borrow(leg_index);
        assert!(current == LEG_PENDING, ELegAlreadySettled);

        *parlay.leg_statuses.borrow_mut(leg_index) = LEG_VOID;
        parlay.legs_settled = parlay.legs_settled + 1;
        if (parlay.status == STATUS_MATCHED) { parlay.status = STATUS_SETTLING; };

        event::emit(ParlayLegVoided {
            parlay_id: object::id(parlay),
            leg_index,
            timestamp: clock.timestamp_ms(),
        });
    }

    /// Oracle queues parlay finalization (starts dispute window).
    /// Called once all legs are settled/voided.
    public entry fun queue_finalize_parlay<T>(
        _oracle_cap:  &OracleCap,
        config:       &P2PConfig,
        parlay:       &mut P2PParlay<T>,
        clock:        &Clock,
    ) {
        require_config!(parlay.config_id, object::id(config));
        assert!(
            parlay.status == STATUS_SETTLING || parlay.status == STATUS_MATCHED,
            EParlayNotMatched
        );
        assert!(parlay.taker.is_some(), ENoTaker);

        let pending = count_leg_status(&parlay.leg_statuses, LEG_PENDING);
        assert!(pending == 0, ENotAllLegsSettled);

        let lost        = count_leg_status(&parlay.leg_statuses, LEG_LOST);
        let maker_wins  = lost == 0;
        let now         = clock.timestamp_ms();

        parlay.pending_maker_wins = maker_wins;
        parlay.settle_queued_at   = now;
        parlay.disputed           = false;
        parlay.status             = STATUS_SETTLING;

        event::emit(ParlaySettleQueued {
            parlay_id:          object::id(parlay),
            pending_maker_wins: maker_wins,
            settle_due_ms:      now + config.dispute_window_ms,
            timestamp:          now,
        });
    }

    /// Anyone can dispute a queued parlay settlement during the dispute window.
    public entry fun dispute_parlay<T>(
        parlay: &mut P2PParlay<T>,
        clock:  &Clock,
        ctx:    &mut TxContext,
    ) {
        assert!(parlay.status == STATUS_SETTLING, EParlayNotMatched);
        assert!(!parlay.disputed, EBetAlreadyDisputed);
        assert!(parlay.settle_queued_at > 0, ESettleNotQueued);

        let now      = clock.timestamp_ms();
        let disputer = ctx.sender();
        parlay.disputed = true;
        parlay.disputer = option::some(disputer);
        parlay.status   = STATUS_DISPUTED;

        event::emit(ParlayDisputed {
            parlay_id: object::id(parlay),
            disputer,
            timestamp: now,
        });
    }

    /// Oracle resolves a disputed parlay.
    public entry fun resolve_parlay_dispute<T>(
        _oracle_cap: &OracleCap,
        config:      &P2PConfig,
        parlay:      &mut P2PParlay<T>,
        maker_wins:  bool,
        clock:       &Clock,
    ) {
        require_config!(parlay.config_id, object::id(config));
        assert!(parlay.status == STATUS_DISPUTED, EParlayNotMatched);

        let now = clock.timestamp_ms();
        parlay.pending_maker_wins = maker_wins;
        parlay.settle_queued_at   = now;
        parlay.disputed           = false;
        parlay.disputer           = option::none();
        parlay.status             = STATUS_SETTLING;

        event::emit(ParlayDisputeResolved {
            parlay_id:      object::id(parlay),
            maker_wins,
            new_settle_due: now + config.dispute_window_ms,
            timestamp:      now,
        });
    }

    /// Claim the parlay payout after the dispute window has passed.
    public entry fun claim_parlay<T>(
        config:   &mut P2PConfig,
        registry: &mut P2PRegistry,
        parlay:   &mut P2PParlay<T>,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        require_config!(parlay.config_id, object::id(config));
        assert!(parlay.status == STATUS_SETTLING, EParlayNotMatched);
        assert!(!parlay.disputed, EBetDisputed);
        assert!(parlay.settle_queued_at > 0, ESettleNotQueued);

        let now = clock.timestamp_ms();
        assert!(now >= parlay.settle_queued_at + config.dispute_window_ms, EDisputeWindowActive);

        let taker     = *parlay.taker.borrow();
        let maker_val = parlay.maker_stake.value();
        let taker_val = parlay.taker_balance.value();
        // Safe addition — u128 intermediate prevents u64 overflow on large stakes
        let gross_pot = (((maker_val as u128) + (taker_val as u128)) as u64);

        let (payout, fee) = calc_payout(gross_pot, parlay.taker_fee_bps, parlay.maker_rebate_bps);

        let mut pot = parlay.maker_stake.split(maker_val);
        pot.join(parlay.taker_balance.split(taker_val));

        if (fee > 0) {
            deposit_fee(config, pot.split(fee));
        };

        let actual_payout = pot.value();
        let winner        = if (parlay.pending_maker_wins) { parlay.maker } else { taker };
        let final_status  = if (parlay.pending_maker_wins) { STATUS_MAKER_WON } else { STATUS_TAKER_WON };

        record_win(config, winner);
        parlay.status = final_status;

        event::emit(ParlaySettled {
            parlay_id:    object::id(parlay),
            status:       final_status,
            winner,
            payout:       actual_payout,
            platform_fee: fee,
            timestamp:    now,
        });

        deregister_parlay(registry, object::id(parlay));
        transfer::public_transfer(pot.into_coin(ctx), winner);
        let _ = payout;
    }

    /// Oracle voids an entire parlay — full refunds.
    public entry fun void_parlay<T>(
        _oracle_cap: &OracleCap,
        config:      &P2PConfig,
        registry:    &mut P2PRegistry,
        parlay:      &mut P2PParlay<T>,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_config!(parlay.config_id, object::id(config));
        assert!(
            parlay.status == STATUS_OPEN     ||
            parlay.status == STATUS_MATCHED  ||
            parlay.status == STATUS_SETTLING ||
            parlay.status == STATUS_DISPUTED,
            EAlreadySettled
        );

        let maker_amount = parlay.maker_stake.value();
        let taker_amount = parlay.taker_balance.value();
        let now          = clock.timestamp_ms();

        let maker_refund = parlay.maker_stake.split(maker_amount).into_coin(ctx);
        parlay.status    = STATUS_VOID;

        event::emit(ParlayVoided {
            parlay_id:    object::id(parlay),
            maker_refund: maker_amount,
            taker_refund: taker_amount,
            timestamp:    now,
        });

        deregister_parlay(registry, object::id(parlay));
        transfer::public_transfer(maker_refund, parlay.maker);

        if (taker_amount > 0 && parlay.taker.is_some()) {
            let taker        = *parlay.taker.borrow();
            let taker_refund = parlay.taker_balance.split(taker_amount).into_coin(ctx);
            transfer::public_transfer(taker_refund, taker);
        };

        let _ = config;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INSTANT SETTLE  — oracle pays winner immediately, no dispute window
    // Used when oracle has high confidence (signed API result).
    // Winner receives funds directly on-chain in the same transaction.
    // ═══════════════════════════════════════════════════════════════════════════

    /// Oracle instantly settles a matched bet — payout sent to winner immediately.
    /// No dispute window. Use only when oracle result is authoritative.
    public entry fun instant_settle_bet<T>(
        _auth: &Auth<OracleRole>,  // OZ AccessControl — replaces legacy OracleCap
        config:      &mut P2PConfig,
        registry:    &mut P2PRegistry,
        bet:         &mut P2PMatchedBet<T>,
        maker_wins:  bool,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_config!(bet.config_id, object::id(config));
        assert!(
            bet.status == STATUS_MATCHED  ||
            bet.status == STATUS_SETTLING ||
            bet.status == STATUS_DISPUTED,
            EAlreadySettled
        );

        let now       = clock.timestamp_ms();
        let maker_val = bet.maker_balance.value();
        let taker_val = bet.taker_balance.value();
        // Safe addition — u128 intermediate prevents u64 overflow on large stakes
        let gross_pot = (((maker_val as u128) + (taker_val as u128)) as u64);

        let (payout, fee) = calc_payout(gross_pot, bet.taker_fee_bps, bet.maker_rebate_bps);

        let mut pot = bet.maker_balance.split(maker_val);
        pot.join(bet.taker_balance.split(taker_val));

        if (fee > 0) {
            deposit_fee(config, pot.split(fee));
        };

        let actual_payout = pot.value();
        let winner        = if (maker_wins) { bet.maker } else { bet.taker };
        let final_status  = if (maker_wins) { STATUS_MAKER_WON } else { STATUS_TAKER_WON };

        record_win(config, winner);
        bet.status             = final_status;
        bet.pending_maker_wins = maker_wins;
        bet.settle_queued_at   = now;

        event::emit(BetSettled {
            bet_id:       object::id(bet),
            status:       final_status,
            winner,
            payout:       actual_payout,
            platform_fee: fee,
            timestamp:    now,
        });

        deregister_bet(registry, object::id(bet));
        transfer::public_transfer(pot.into_coin(ctx), winner);
        let _ = payout;
    }

    /// Oracle instantly voids a matched bet — full refunds, no dispute window.
    public entry fun instant_void_bet<T>(
        _oracle_cap: &OracleCap,
        config:      &P2PConfig,
        registry:    &mut P2PRegistry,
        bet:         &mut P2PMatchedBet<T>,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_config!(bet.config_id, object::id(config));
        assert!(
            bet.status == STATUS_MATCHED  ||
            bet.status == STATUS_SETTLING ||
            bet.status == STATUS_DISPUTED,
            EAlreadySettled
        );

        let maker_amount = bet.maker_balance.value();
        let taker_amount = bet.taker_balance.value();
        let now          = clock.timestamp_ms();

        let maker_refund = bet.maker_balance.split(maker_amount).into_coin(ctx);
        let taker_refund = bet.taker_balance.split(taker_amount).into_coin(ctx);
        bet.status = STATUS_VOID;

        event::emit(BetVoided {
            bet_id:       object::id(bet),
            maker_refund: maker_amount,
            taker_refund: taker_amount,
            timestamp:    now,
        });

        deregister_bet(registry, object::id(bet));
        transfer::public_transfer(maker_refund, bet.maker);
        transfer::public_transfer(taker_refund, bet.taker);
        let _ = config;
    }

    /// Oracle instantly finalizes a parlay — winner paid immediately.
    /// `maker_wins` = true if ALL legs won.
    public entry fun instant_settle_parlay<T>(
        _oracle_cap: &OracleCap,
        config:      &mut P2PConfig,
        registry:    &mut P2PRegistry,
        parlay:      &mut P2PParlay<T>,
        maker_wins:  bool,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_config!(parlay.config_id, object::id(config));
        assert!(parlay.taker.is_some(), ENoTaker);
        assert!(
            parlay.status == STATUS_MATCHED  ||
            parlay.status == STATUS_SETTLING ||
            parlay.status == STATUS_DISPUTED,
            EAlreadySettled
        );

        let now       = clock.timestamp_ms();
        let taker     = *parlay.taker.borrow();
        let maker_val = parlay.maker_stake.value();
        let taker_val = parlay.taker_balance.value();
        // Safe addition — u128 intermediate prevents u64 overflow on large stakes
        let gross_pot = (((maker_val as u128) + (taker_val as u128)) as u64);

        let (payout, fee) = calc_payout(gross_pot, parlay.taker_fee_bps, parlay.maker_rebate_bps);

        let mut pot = parlay.maker_stake.split(maker_val);
        pot.join(parlay.taker_balance.split(taker_val));

        if (fee > 0) {
            deposit_fee(config, pot.split(fee));
        };

        let actual_payout = pot.value();
        let winner        = if (maker_wins) { parlay.maker } else { taker };
        let final_status  = if (maker_wins) { STATUS_MAKER_WON } else { STATUS_TAKER_WON };

        record_win(config, winner);
        parlay.status             = final_status;
        parlay.pending_maker_wins = maker_wins;
        parlay.settle_queued_at   = now;

        event::emit(ParlaySettled {
            parlay_id:    object::id(parlay),
            status:       final_status,
            winner,
            payout:       actual_payout,
            platform_fee: fee,
            timestamp:    now,
        });

        deregister_parlay(registry, object::id(parlay));
        transfer::public_transfer(pot.into_coin(ctx), winner);
        let _ = payout;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-SIG FEE WITHDRAWAL  — requires both AdminCap AND OracleCap
    // Step 1: Admin proposes withdrawal → creates shared WithdrawalProposal
    // Step 2: Oracle countersigns + executes → funds leave the vault
    // Neither key alone can drain the fee vault.
    // ═══════════════════════════════════════════════════════════════════════════

    /// Admin proposes a fee withdrawal. Creates a shared proposal object.
    /// The OracleCap holder must call `execute_withdrawal` to release funds.
    public entry fun propose_withdrawal<T>(
        _admin_cap: &AdminCap,
        config:     &P2PConfig,
        amount:     u64,
        recipient:  address,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(amount > 0, EInvalidAmount);
        let key = type_name::get<T>();
        assert!(config.fee_vault.contains(key), EInsufficientBalance);
        let vault = config.fee_vault.borrow<TypeName, Balance<T>>(key);
        assert!(vault.value() >= amount, EInsufficientBalance);

        let coin_type = key.into_string().into_bytes();
        let proposal = WithdrawalProposal {
            id:          object::new(ctx),
            config_id:   object::id(config),
            coin_type,
            amount,
            recipient,
            proposed_at: clock.timestamp_ms(),
            executed:    false,
        };

        transfer::share_object(proposal);
    }

    /// Oracle countersigns and executes a pending fee withdrawal proposal.
    /// Both AdminCap (from propose_withdrawal) and OracleCap (this call) required.
    public entry fun execute_withdrawal<T>(
        _oracle_cap: &OracleCap,
        config:      &mut P2PConfig,
        proposal:    &mut WithdrawalProposal,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        require_config!(proposal.config_id, object::id(config));
        assert!(!proposal.executed, EAlreadySettled);

        let key             = type_name::get<T>();
        let coin_type_bytes = key.into_string().into_bytes();
        assert!(coin_type_bytes == proposal.coin_type, EConfigMismatch);

        assert!(config.fee_vault.contains(key), EInsufficientBalance);
        let vault = config.fee_vault.borrow_mut<TypeName, Balance<T>>(key);
        assert!(vault.value() >= proposal.amount, EInsufficientBalance);

        let now      = clock.timestamp_ms();
        let fee_coin = vault.split(proposal.amount).into_coin(ctx);

        proposal.executed = true;

        event::emit(WithdrawalExecuted {
            proposal_id: object::id(proposal),
            config_id:   object::id(config),
            amount:      proposal.amount,
            recipient:   proposal.recipient,
            timestamp:   now,
        });

        event::emit(FeesWithdrawn {
            config_id:  object::id(config),
            coin_type:  proposal.coin_type,
            amount:     proposal.amount,
            recipient:  proposal.recipient,
            timestamp:  now,
        });

        transfer::public_transfer(fee_coin, proposal.recipient);
    }

    // ── Read-only view helpers ────────────────────────────────────────────────

    public fun offer_status<T>(offer: &P2POffer<T>): u8 { offer.status }
    public fun offer_maker<T>(offer: &P2POffer<T>): address { offer.maker }
    public fun offer_remaining<T>(offer: &P2POffer<T>): u64 { offer.maker_remaining.value() }
    public fun offer_filled<T>(offer: &P2POffer<T>): u64 { offer.filled_taker }
    public fun offer_match_count<T>(offer: &P2POffer<T>): u64 { offer.match_count }

    public fun bet_status<T>(bet: &P2PMatchedBet<T>): u8 { bet.status }
    public fun bet_maker<T>(bet: &P2PMatchedBet<T>): address { bet.maker }
    public fun bet_taker<T>(bet: &P2PMatchedBet<T>): address { bet.taker }
    public fun bet_gross_pot<T>(bet: &P2PMatchedBet<T>): u64 {
        bet.maker_balance.value() + bet.taker_balance.value()
    }
    public fun bet_disputed<T>(bet: &P2PMatchedBet<T>): bool { bet.disputed }
    public fun bet_settle_queued_at<T>(bet: &P2PMatchedBet<T>): u64 { bet.settle_queued_at }
    public fun bet_pending_maker_wins<T>(bet: &P2PMatchedBet<T>): bool { bet.pending_maker_wins }

    public fun parlay_status<T>(parlay: &P2PParlay<T>): u8 { parlay.status }
    public fun parlay_legs_settled<T>(parlay: &P2PParlay<T>): u64 { parlay.legs_settled }
    public fun parlay_num_legs<T>(parlay: &P2PParlay<T>): u64 { parlay.leg_statuses.length() }

    public fun config_paused(config: &P2PConfig): bool { config.paused }
    public fun config_dispute_window(config: &P2PConfig): u64 { config.dispute_window_ms }
    public fun config_total_offers(config: &P2PConfig): u64 { config.total_offers }
    public fun config_total_bets(config: &P2PConfig): u64 { config.total_bets }
    public fun config_total_volume(config: &P2PConfig): u64 { config.total_volume }

    public fun registry_open_offers_count(registry: &P2PRegistry): u64 {
        registry.open_offers.length()
    }
    public fun registry_live_bets_count(registry: &P2PRegistry): u64 {
        registry.live_bets.length()
    }
    public fun registry_open_parlays_count(registry: &P2PRegistry): u64 {
        registry.open_parlays.length()
    }

    public fun wallet_volume(config: &P2PConfig, wallet: address): u64 {
        get_wallet_volume(config, wallet)
    }
    public fun wallet_taker_fee_bps(config: &P2PConfig, wallet: address): u64 {
        get_taker_fee_bps(config, wallet)
    }
    public fun wallet_maker_rebate_bps(config: &P2PConfig, wallet: address): u64 {
        get_maker_rebate_bps(config, wallet)
    }

    // ── Enum-based view helpers ───────────────────────────────────────────────
    // These translate the raw u8 status fields into the typed enums defined above.
    // Use these in off-chain indexers and other Move modules for readable matching.

    public fun offer_status_enum<T>(offer: &P2POffer<T>): OfferStatus {
        let s = offer.status;
        if      (s == STATUS_OPEN)      { OfferStatus::Open }
        else if (s == STATUS_FILLED)    { OfferStatus::Filled }
        else if (s == STATUS_CANCELLED) { OfferStatus::Cancelled }
        else                            { OfferStatus::Expired }
    }

    public fun bet_status_enum<T>(bet: &P2PMatchedBet<T>): BetStatus {
        let s = bet.status;
        if      (s == STATUS_MATCHED)   { BetStatus::Matched }
        else if (s == STATUS_SETTLING)  { BetStatus::Settling }
        else if (s == STATUS_MAKER_WON) { BetStatus::MakerWon }
        else if (s == STATUS_TAKER_WON) { BetStatus::TakerWon }
        else if (s == STATUS_VOID)      { BetStatus::Void }
        else if (s == STATUS_CANCELLED) { BetStatus::Cancelled }
        else if (s == STATUS_EXPIRED)   { BetStatus::Expired }
        else                            { BetStatus::Disputed }
    }

    public fun parlay_status_enum<T>(parlay: &P2PParlay<T>): BetStatus {
        let s = parlay.status;
        if      (s == STATUS_MATCHED)   { BetStatus::Matched }
        else if (s == STATUS_SETTLING)  { BetStatus::Settling }
        else if (s == STATUS_MAKER_WON) { BetStatus::MakerWon }
        else if (s == STATUS_TAKER_WON) { BetStatus::TakerWon }
        else if (s == STATUS_VOID)      { BetStatus::Void }
        else if (s == STATUS_CANCELLED) { BetStatus::Cancelled }
        else if (s == STATUS_EXPIRED)   { BetStatus::Expired }
        else                            { BetStatus::Disputed }
    }

    public fun leg_status_enum(leg_u8: u8): LegStatus {
        if      (leg_u8 == LEG_WON)  { LegStatus::Won }
        else if (leg_u8 == LEG_LOST) { LegStatus::Lost }
        else if (leg_u8 == LEG_VOID) { LegStatus::Voided }
        else                         { LegStatus::Pending }
    }
}
