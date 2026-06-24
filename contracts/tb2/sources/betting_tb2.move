#[allow(duplicate_alias, unused_const, lint(public_entry))]
/// SuiBets TB2 — Generic multi-token sports betting contract.
/// All token state is stored as dynamic fields keyed by the coin's Sui type,
/// so new SUI-ecosystem tokens can be added at any time without upgrading
/// the core struct layout.  Full feature parity with the sportsbook contract:
/// oracle-signature verification, multisig withdrawal guard, withdrawal lock,
/// cooldown, per-token bet limits / hard caps, void / expired-refund / phantom-void,
/// liquidity deposits, and UpgradeCap support.
module suibets_tb2::betting_tb2 {

    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::types;
    use sui::ed25519;
    use sui::dynamic_field;
    use std::bcs;
    use std::vector;
    use std::type_name;
    use std::ascii;
    use td2::td2::TD2;

    // ============================================================
    // ERROR CODES
    // ============================================================

    const EInsufficientBalance:      u64 = 0;
    const EBetAlreadySettled:        u64 = 1;
    const EUnauthorized:             u64 = 2;
    const EInvalidOdds:              u64 = 3;
    const EBetNotFound:              u64 = 4;
    const EEventNotFinished:         u64 = 5;
    const EInvalidAmount:            u64 = 6;
    const EPlatformPaused:           u64 = 7;
    const EExceedsMaxBet:            u64 = 8;
    const EExceedsMinBet:            u64 = 9;
    const ENotOneTimeWitness:        u64 = 10;
    const EInsufficientTreasury:     u64 = 11;
    const EInvalidOracleSignature:   u64 = 12;
    const EQuoteExpired:             u64 = 13;
    const EBetNotExpired:            u64 = 14;
    const EExceedsHardMaxBet:        u64 = 15;
    const EOracleNotSet:             u64 = 16;
    const EWithdrawalTooLarge:       u64 = 17;
    const EInvalidPublicKey:         u64 = 18;
    const EPhantomVoidFailed:        u64 = 19;
    const EWithdrawalsLocked:        u64 = 20;
    const ENotASigner:               u64 = 21;
    const EAlreadyApproved:          u64 = 22;
    const EInsufficientApprovals:    u64 = 23;
    const EProposalExpired:          u64 = 24;
    const EProposalAlreadyExecuted:  u64 = 25;
    const EInvalidThreshold:         u64 = 26;
    const ETokenNotRegistered:       u64 = 27;
    const ETokenAlreadyRegistered:   u64 = 28;
    const ECoinTypeMismatch:         u64 = 29;
    const ETokenDisabled:            u64 = 30;
    const ETd2AlreadyInitialized:    u64 = 31;
    const ETd2NotInitialized:        u64 = 32;

    // ============================================================
    // STATUS CONSTANTS
    // ============================================================

    const STATUS_PENDING: u8 = 0;
    const STATUS_WON:     u8 = 1;
    const STATUS_LOST:    u8 = 2;
    const STATUS_VOID:    u8 = 3;

    // ============================================================
    // PLATFORM CONSTANTS
    // ============================================================

    const PLATFORM_FEE_BPS:        u64 = 100;
    const BPS_DENOMINATOR:         u64 = 10000;
    const MAX_FEE_BPS:             u64 = 1000;
    const DEFAULT_BET_EXPIRY_MS:   u64 = 604_800_000;
    const WITHDRAWAL_COOLDOWN_MS:  u64 = 3_600_000;
    const PROPOSAL_EXPIRY_MS:      u64 = 86_400_000;
    const WITHDRAWAL_TYPE_FEES:    u8  = 0;
    const WITHDRAWAL_TYPE_TREASURY: u8 = 1;

    // TD2 token default limits
    const DEFAULT_MIN_BET_TD2:         u64 = 1_000_000;
    const DEFAULT_MAX_BET_TD2:         u64 = 10_000_000_000;
    const ABSOLUTE_MAX_BET_TD2:        u64 = 100_000_000_000;
    const MAX_SINGLE_WITHDRAWAL_TD2:   u64 = 50_000_000_000;

    // ============================================================
    // ONE-TIME WITNESS
    // ============================================================

    public struct BETTING_TB2 has drop {}

    // ============================================================
    // CAPABILITY STRUCTS
    // ============================================================

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct OracleCap has key, store {
        id: UID,
    }

    // ============================================================
    // PLATFORM STRUCT  (no hardcoded per-coin fields)
    // ============================================================

    public struct BettingPlatformTb2 has key {
        id: UID,
        platform_fee_bps:  u64,
        total_bets:        u64,
        paused:            bool,
        oracle_public_key: vector<u8>,
        bet_expiry_ms:     u64,
        last_withdrawal_at: u64,
    }

    // ============================================================
    // GENERIC TOKEN STATE  (stored as dynamic field per coin type)
    // ============================================================

    /// Dynamic-field key.  `phantom T` ensures one slot per coin type.
    public struct TokenStateKey<phantom T> has copy, drop, store {}

    /// Per-token treasury + accounting state.
    public struct TokenState<phantom T> has store {
        treasury:                  Balance<T>,
        total_volume:              u64,
        total_potential_liability: u64,
        accrued_fees:              u64,
        min_bet:                   u64,
        max_bet:                   u64,
        /// Admin-set hard cap that can never be exceeded even via update_token_limits.
        absolute_max_bet:          u64,
        /// Per-token single-withdrawal ceiling.
        max_single_withdrawal:     u64,
        enabled:                   bool,
    }

    // ============================================================
    // BET OBJECT
    // ============================================================

    public struct BetTb2 has key, store {
        id:              UID,
        bettor:          address,
        event_id:        vector<u8>,
        market_id:       vector<u8>,
        prediction:      vector<u8>,
        odds:            u64,
        stake:           u64,
        potential_payout: u64,
        platform_fee:    u64,
        status:          u8,
        placed_at:       u64,
        settled_at:      u64,
        walrus_blob_id:  vector<u8>,
        /// Full Sui type string bytes, e.g. b"0xabc::mytoken::MYTOKEN"
        coin_type_name:  vector<u8>,
        deadline:        u64,
    }

    // ============================================================
    // WITHDRAWAL LOCK KEY
    // ============================================================

    public struct WithdrawalLockKey has copy, drop, store {}

    // ============================================================
    // MULTISIG STRUCTS
    // ============================================================

    public struct MultisigGuard has key {
        id:          UID,
        signers:     vector<address>,
        threshold:   u64,
        platform_id: ID,
    }

    public struct WithdrawalProposalTb2 has key {
        id:              UID,
        proposer:        address,
        amount:          u64,
        /// Full Sui type string bytes — matched against get_coin_type_name<T>() at execute time.
        coin_type_name:  vector<u8>,
        withdrawal_type: u8,
        recipient:       address,
        approvals:       vector<address>,
        executed:        bool,
        created_at:      u64,
        expires_at:      u64,
        guard_id:        ID,
        platform_id:     ID,
    }

    // ============================================================
    // EVENTS
    // ============================================================

    public struct PlatformCreated has copy, drop {
        platform_id:  ID,
        admin_cap_id: ID,
        fee_bps:      u64,
    }

    public struct PlatformPaused has copy, drop {
        platform_id: ID,
        paused:      bool,
        timestamp:   u64,
    }

    public struct TokenRegistered has copy, drop {
        platform_id:       ID,
        coin_type_name:    vector<u8>,
        min_bet:           u64,
        max_bet:           u64,
        absolute_max_bet:  u64,
        timestamp:         u64,
    }

    public struct TokenStatusChanged has copy, drop {
        platform_id:    ID,
        coin_type_name: vector<u8>,
        enabled:        bool,
        timestamp:      u64,
    }

    public struct BetPlaced has copy, drop {
        bet_id:          ID,
        bettor:          address,
        event_id:        vector<u8>,
        prediction:      vector<u8>,
        odds:            u64,
        stake:           u64,
        potential_payout: u64,
        coin_type_name:  vector<u8>,
        timestamp:       u64,
    }

    public struct BetSettled has copy, drop {
        bet_id:         ID,
        bettor:         address,
        status:         u8,
        payout:         u64,
        coin_type_name: vector<u8>,
        timestamp:      u64,
    }

    public struct OracleCapMinted has copy, drop {
        oracle_cap_id: ID,
        recipient:     address,
        timestamp:     u64,
    }

    public struct OracleCapRevoked has copy, drop {
        oracle_cap_id: ID,
        timestamp:     u64,
    }

    public struct LiquidityDeposited has copy, drop {
        platform_id:    ID,
        depositor:      address,
        amount:         u64,
        coin_type_name: vector<u8>,
        timestamp:      u64,
    }

    public struct FeesWithdrawn has copy, drop {
        platform_id:    ID,
        amount:         u64,
        coin_type_name: vector<u8>,
        timestamp:      u64,
    }

    public struct TreasuryWithdrawn has copy, drop {
        platform_id:    ID,
        amount:         u64,
        coin_type_name: vector<u8>,
        timestamp:      u64,
    }

    public struct OracleKeyUpdated has copy, drop {
        platform_id: ID,
        timestamp:   u64,
    }

    public struct ExpiredBetRefunded has copy, drop {
        bet_id:         ID,
        bettor:         address,
        refund_amount:  u64,
        coin_type_name: vector<u8>,
        timestamp:      u64,
    }

    public struct PhantomBetVoided has copy, drop {
        bet_id:          ID,
        bettor:          address,
        stake:           u64,
        liability_freed: u64,
        coin_type_name:  vector<u8>,
        timestamp:       u64,
    }

    public struct DirectWithdrawalsLocked has copy, drop {
        platform_id: ID,
        locked:      bool,
        timestamp:   u64,
    }

    public struct MultisigGuardCreated has copy, drop {
        guard_id:    ID,
        platform_id: ID,
        threshold:   u64,
        num_signers: u64,
        timestamp:   u64,
    }

    public struct WithdrawalProposed has copy, drop {
        proposal_id:     ID,
        proposer:        address,
        amount:          u64,
        coin_type_name:  vector<u8>,
        withdrawal_type: u8,
        recipient:       address,
        timestamp:       u64,
    }

    public struct WithdrawalApprovedEvent has copy, drop {
        proposal_id:    ID,
        approver:       address,
        approval_count: u64,
        threshold:      u64,
        timestamp:      u64,
    }

    public struct MultisigWithdrawalExecuted has copy, drop {
        proposal_id:     ID,
        amount:          u64,
        coin_type_name:  vector<u8>,
        withdrawal_type: u8,
        recipient:       address,
        approval_count:  u64,
        timestamp:       u64,
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /// Return the ASCII bytes of a coin's full Sui type string.
    fun get_coin_type_name<T>(): vector<u8> {
        ascii::into_bytes(type_name::into_string(type_name::with_defining_ids<T>()))
    }

    /// Build the deterministic oracle message (same format as sportsbook).
    fun build_oracle_message(
        event_id:    &vector<u8>,
        odds:        u64,
        quote_expiry: u64,
        bettor:      address,
        prediction:  &vector<u8>,
    ): vector<u8> {
        let mut msg = vector::empty<u8>();
        vector::append(&mut msg, *event_id);
        vector::append(&mut msg, bcs::to_bytes(&odds));
        vector::append(&mut msg, bcs::to_bytes(&quote_expiry));
        vector::append(&mut msg, bcs::to_bytes(&bettor));
        vector::append(&mut msg, *prediction);
        msg
    }

    fun is_signer(guard: &MultisigGuard, addr: address): bool {
        let len = vector::length(&guard.signers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(&guard.signers, i) == addr) { return true };
            i = i + 1;
        };
        false
    }

    fun validate_unique_signers(signers: &vector<address>) {
        let len = vector::length(signers);
        let mut i = 0;
        while (i < len) {
            let addr = *vector::borrow(signers, i);
            let mut j = i + 1;
            while (j < len) {
                assert!(*vector::borrow(signers, j) != addr, EInvalidThreshold);
                j = j + 1;
            };
            i = i + 1;
        };
    }

    fun count_valid_approvals(guard: &MultisigGuard, approvals: &vector<address>): u64 {
        let len = vector::length(approvals);
        let mut count = 0u64;
        let mut i = 0;
        while (i < len) {
            if (is_signer(guard, *vector::borrow(approvals, i))) {
                count = count + 1;
            };
            i = i + 1;
        };
        count
    }

    // ============================================================
    // INIT
    // ============================================================

    fun init(witness: BETTING_TB2, ctx: &mut TxContext) {
        assert!(types::is_one_time_witness(&witness), ENotOneTimeWitness);

        let deployer = tx_context::sender(ctx);

        let admin_cap = AdminCap { id: object::new(ctx) };
        let admin_cap_id = object::id(&admin_cap);

        let platform = BettingPlatformTb2 {
            id:                 object::new(ctx),
            platform_fee_bps:   PLATFORM_FEE_BPS,
            total_bets:         0,
            paused:             true,
            oracle_public_key:  vector::empty(),
            bet_expiry_ms:      DEFAULT_BET_EXPIRY_MS,
            last_withdrawal_at: 0,
        };

        event::emit(PlatformCreated {
            platform_id:  object::id(&platform),
            admin_cap_id,
            fee_bps:      PLATFORM_FEE_BPS,
        });

        transfer::share_object(platform);
        transfer::transfer(admin_cap, deployer);
    }

    // ============================================================
    // TOKEN REGISTRATION
    // ============================================================

    /// Register a new token so it can be used for betting.
    /// `absolute_max_bet`  — hard upper bound that update_token_limits can never exceed.
    /// `max_single_withdrawal` — per-call withdrawal ceiling for this token.
    public entry fun register_token<T>(
        _admin_cap:          &AdminCap,
        platform:            &mut BettingPlatformTb2,
        min_bet:             u64,
        max_bet:             u64,
        absolute_max_bet:    u64,
        max_single_withdrawal: u64,
        clock:               &Clock,
    ) {
        assert!(
            !dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenAlreadyRegistered
        );
        assert!(max_bet <= absolute_max_bet, EExceedsHardMaxBet);
        assert!(min_bet > 0, EInvalidAmount);
        assert!(max_bet > 0, EInvalidAmount);
        assert!(max_single_withdrawal > 0, EInvalidAmount);

        let coin_type_name = get_coin_type_name<T>();

        dynamic_field::add(
            &mut platform.id,
            TokenStateKey<T> {},
            TokenState<T> {
                treasury:                  balance::zero<T>(),
                total_volume:              0,
                total_potential_liability: 0,
                accrued_fees:              0,
                min_bet,
                max_bet,
                absolute_max_bet,
                max_single_withdrawal,
                enabled:                   true,
            }
        );

        event::emit(TokenRegistered {
            platform_id:      object::id(platform),
            coin_type_name,
            min_bet,
            max_bet,
            absolute_max_bet,
            timestamp:        clock::timestamp_ms(clock),
        });
    }

    // ============================================================
    // BETTING
    // ============================================================

    public entry fun place_bet<T>(
        platform:        &mut BettingPlatformTb2,
        payment:         Coin<T>,
        event_id:        vector<u8>,
        market_id:       vector<u8>,
        prediction:      vector<u8>,
        odds:            u64,
        quote_expiry:    u64,
        oracle_signature: vector<u8>,
        walrus_blob_id:  vector<u8>,
        clock:           &Clock,
        ctx:             &mut TxContext,
    ) {
        assert!(!platform.paused, EPlatformPaused);

        // Oracle public key must be set
        let oracle_pk = &platform.oracle_public_key;
        assert!(vector::length(oracle_pk) == 32, EOracleNotSet);

        let bettor = tx_context::sender(ctx);
        let now    = clock::timestamp_ms(clock);

        // Verify oracle signature
        let msg = build_oracle_message(&event_id, odds, quote_expiry, bettor, &prediction);
        assert!(
            ed25519::ed25519_verify(&oracle_signature, oracle_pk, &msg),
            EInvalidOracleSignature
        );
        assert!(now <= quote_expiry, EQuoteExpired);

        // Odds sanity: 1.00x–1000x expressed as integer *100
        assert!(odds >= 100,    EInvalidOdds);
        assert!(odds <= 100000, EInvalidOdds);

        let stake = coin::value(&payment);
        assert!(stake > 0, EInvalidAmount);

        // Borrow token state (asserts token is registered)
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        assert!(state.enabled, ETokenDisabled);
        assert!(stake >= state.min_bet, EExceedsMinBet);
        assert!(stake <= state.max_bet, EExceedsMaxBet);
        assert!(stake <= state.absolute_max_bet, EExceedsHardMaxBet);

        // Overflow-safe payout calculation
        let payout_u128 = ((stake as u128) * (odds as u128)) / 100u128;
        assert!(payout_u128 <= 18446744073709551615u128, EInvalidAmount);
        let potential_payout = (payout_u128 as u64);

        // Solvency check: treasury + incoming stake must cover all liabilities
        let current_treasury = balance::value(&state.treasury);
        assert!(
            current_treasury + stake >= state.total_potential_liability + potential_payout,
            EInsufficientBalance
        );

        // Accept payment
        balance::join(&mut state.treasury, coin::into_balance(payment));
        state.total_volume              = state.total_volume + stake;
        state.total_potential_liability = state.total_potential_liability + potential_payout;
        platform.total_bets             = platform.total_bets + 1;

        let coin_type_name = get_coin_type_name<T>();

        let bet = BetTb2 {
            id:              object::new(ctx),
            bettor,
            event_id,
            market_id,
            prediction,
            odds,
            stake,
            potential_payout,
            platform_fee:    0,
            status:          STATUS_PENDING,
            placed_at:       now,
            settled_at:      0,
            walrus_blob_id,
            coin_type_name,
            deadline:        now + platform.bet_expiry_ms,
        };

        event::emit(BetPlaced {
            bet_id:           object::id(&bet),
            bettor,
            event_id:         bet.event_id,
            prediction:       bet.prediction,
            odds,
            stake,
            potential_payout,
            coin_type_name:   bet.coin_type_name,
            timestamp:        now,
        });

        transfer::share_object(bet);
    }

    // ============================================================
    // SETTLEMENT
    // ============================================================

    public entry fun settle_bet<T>(
        _oracle_cap: &OracleCap,
        platform:    &mut BettingPlatformTb2,
        bet:         &mut BetTb2,
        won:         bool,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        state.total_potential_liability = state.total_potential_liability - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;

            let profit   = bet.potential_payout - bet.stake;
            let win_fee  = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;

            state.accrued_fees = state.accrued_fees + win_fee;
            bet.platform_fee   = win_fee;

            assert!(balance::value(&state.treasury) >= net_payout, EInsufficientTreasury);
            let payout_balance = balance::split(&mut state.treasury, net_payout);
            let payout_coin    = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id:         object::id(bet),
                bettor:         bet.bettor,
                status:         STATUS_WON,
                payout:         net_payout,
                coin_type_name: bet.coin_type_name,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;

            event::emit(BetSettled {
                bet_id:         object::id(bet),
                bettor:         bet.bettor,
                status:         STATUS_LOST,
                payout:         0,
                coin_type_name: bet.coin_type_name,
                timestamp,
            });
        }
    }

    // ============================================================
    // VOID FUNCTIONS  (oracle)
    // ============================================================

    public entry fun void_bet<T>(
        _oracle_cap: &OracleCap,
        platform:    &mut BettingPlatformTb2,
        bet:         &mut BetTb2,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        bet.status     = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.total_potential_liability = state.total_potential_liability - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&state.treasury) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut state.treasury, refund_amount);
        let refund_coin    = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(BetSettled {
            bet_id:         object::id(bet),
            bettor:         bet.bettor,
            status:         STATUS_VOID,
            payout:         refund_amount,
            coin_type_name: bet.coin_type_name,
            timestamp:      bet.settled_at,
        });
    }

    // ============================================================
    // VOID FUNCTIONS  (admin)
    // ============================================================

    public entry fun void_bet_admin<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        bet:        &mut BetTb2,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        bet.status     = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.total_potential_liability = state.total_potential_liability - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&state.treasury) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut state.treasury, refund_amount);
        let refund_coin    = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(BetSettled {
            bet_id:         object::id(bet),
            bettor:         bet.bettor,
            status:         STATUS_VOID,
            payout:         refund_amount,
            coin_type_name: bet.coin_type_name,
            timestamp:      bet.settled_at,
        });
    }

    // ============================================================
    // PHANTOM VOID  (clears liability without paying out — for bets
    // whose on-chain object exists but whose funds are unrecoverable)
    // ============================================================

    public entry fun void_phantom_bet<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        bet:        &mut BetTb2,
        clock:      &Clock,
        _ctx:       &mut TxContext,
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        let now        = clock::timestamp_ms(clock);
        bet.status     = STATUS_VOID;
        bet.settled_at = now;

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.total_potential_liability = state.total_potential_liability - bet.potential_payout;

        event::emit(PhantomBetVoided {
            bet_id:          object::id(bet),
            bettor:          bet.bettor,
            stake:           bet.stake,
            liability_freed: bet.potential_payout,
            coin_type_name:  bet.coin_type_name,
            timestamp:       now,
        });
    }

    // ============================================================
    // EXPIRED REFUND  (bettor self-service after deadline)
    // ============================================================

    public entry fun claim_expired_refund<T>(
        platform: &mut BettingPlatformTb2,
        bet:      &mut BetTb2,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        let now = clock::timestamp_ms(clock);
        assert!(now > bet.deadline, EBetNotExpired);
        assert!(tx_context::sender(ctx) == bet.bettor, EUnauthorized);

        bet.status     = STATUS_VOID;
        bet.settled_at = now;

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.total_potential_liability = state.total_potential_liability - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&state.treasury) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut state.treasury, refund_amount);
        let refund_coin    = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(ExpiredBetRefunded {
            bet_id:         object::id(bet),
            bettor:         bet.bettor,
            refund_amount,
            coin_type_name: bet.coin_type_name,
            timestamp:      now,
        });
    }

    // ============================================================
    // LIQUIDITY DEPOSITS
    // ============================================================

    public entry fun deposit_liquidity<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        coin:       Coin<T>,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let amount = coin::value(&coin);
        let state  = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        balance::join(&mut state.treasury, coin::into_balance(coin));

        event::emit(LiquidityDeposited {
            platform_id:    object::id(platform),
            depositor:      tx_context::sender(ctx),
            amount,
            coin_type_name: get_coin_type_name<T>(),
            timestamp:      clock::timestamp_ms(clock),
        });
    }

    // ============================================================
    // DIRECT WITHDRAWALS  (admin, subject to lock + cooldown)
    // ============================================================

    public entry fun withdraw_fees<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        amount:     u64,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            !dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {}),
            EWithdrawalsLocked
        );
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );

        let now = clock::timestamp_ms(clock);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        assert!(amount <= state.accrued_fees, EInsufficientBalance);
        assert!(balance::value(&state.treasury) >= amount, EInsufficientTreasury);
        assert!(amount <= state.max_single_withdrawal, EWithdrawalTooLarge);

        platform.last_withdrawal_at = now;
        state.accrued_fees = state.accrued_fees - amount;

        let fees_balance = balance::split(&mut state.treasury, amount);
        let fees_coin    = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, tx_context::sender(ctx));

        event::emit(FeesWithdrawn {
            platform_id:    object::id(platform),
            amount,
            coin_type_name: get_coin_type_name<T>(),
            timestamp:      now,
        });
    }

    public entry fun withdraw_treasury<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        amount:     u64,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            !dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {}),
            EWithdrawalsLocked
        );
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );

        let now = clock::timestamp_ms(clock);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        assert!(balance::value(&state.treasury) >= amount, EInsufficientTreasury);
        assert!(
            balance::value(&state.treasury) - amount >= state.total_potential_liability,
            EInsufficientBalance
        );
        assert!(amount <= state.max_single_withdrawal, EWithdrawalTooLarge);

        platform.last_withdrawal_at = now;

        let treasury_balance = balance::split(&mut state.treasury, amount);
        let treasury_coin    = coin::from_balance(treasury_balance, ctx);
        transfer::public_transfer(treasury_coin, tx_context::sender(ctx));

        event::emit(TreasuryWithdrawn {
            platform_id:    object::id(platform),
            amount,
            coin_type_name: get_coin_type_name<T>(),
            timestamp:      now,
        });
    }

    // ============================================================
    // MULTISIG GUARD
    // ============================================================

    public entry fun create_multisig_guard(
        _admin_cap:  &AdminCap,
        platform:    &BettingPlatformTb2,
        signers:     vector<address>,
        threshold:   u64,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        let num_signers = vector::length(&signers);
        assert!(threshold > 0 && threshold <= num_signers, EInvalidThreshold);
        assert!(num_signers >= 2, EInvalidThreshold);
        validate_unique_signers(&signers);

        let guard = MultisigGuard {
            id:          object::new(ctx),
            signers,
            threshold,
            platform_id: object::id(platform),
        };

        event::emit(MultisigGuardCreated {
            guard_id:    object::id(&guard),
            platform_id: object::id(platform),
            threshold,
            num_signers,
            timestamp:   clock::timestamp_ms(clock),
        });

        transfer::share_object(guard);
    }

    public entry fun update_multisig_signers(
        _admin_cap:    &AdminCap,
        guard:         &mut MultisigGuard,
        new_signers:   vector<address>,
        new_threshold: u64,
    ) {
        let num_signers = vector::length(&new_signers);
        assert!(new_threshold > 0 && new_threshold <= num_signers, EInvalidThreshold);
        assert!(num_signers >= 2, EInvalidThreshold);
        validate_unique_signers(&new_signers);
        guard.signers   = new_signers;
        guard.threshold = new_threshold;
    }

    public entry fun lock_direct_withdrawals(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
    ) {
        if (!dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {})) {
            dynamic_field::add(&mut platform.id, WithdrawalLockKey {}, true);
        };
        event::emit(DirectWithdrawalsLocked {
            platform_id: object::id(platform),
            locked:      true,
            timestamp:   clock::timestamp_ms(clock),
        });
    }

    public entry fun unlock_direct_withdrawals(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
    ) {
        if (dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {})) {
            dynamic_field::remove<WithdrawalLockKey, bool>(&mut platform.id, WithdrawalLockKey {});
        };
        event::emit(DirectWithdrawalsLocked {
            platform_id: object::id(platform),
            locked:      false,
            timestamp:   clock::timestamp_ms(clock),
        });
    }

    /// Propose a multisig withdrawal.  `coin_type_name` is the full Sui type
    /// string bytes of the token (e.g. b"0xabc::mytoken::MYTOKEN").
    public entry fun propose_withdrawal(
        guard:           &MultisigGuard,
        amount:          u64,
        coin_type_name:  vector<u8>,
        withdrawal_type: u8,
        recipient:       address,
        clock:           &Clock,
        ctx:             &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(is_signer(guard, sender), ENotASigner);
        assert!(
            withdrawal_type == WITHDRAWAL_TYPE_FEES || withdrawal_type == WITHDRAWAL_TYPE_TREASURY,
            EInvalidAmount
        );
        assert!(amount > 0, EInvalidAmount);
        assert!(vector::length(&coin_type_name) > 0, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        let mut approvals = vector::empty<address>();
        vector::push_back(&mut approvals, sender);

        let proposal = WithdrawalProposalTb2 {
            id:              object::new(ctx),
            proposer:        sender,
            amount,
            coin_type_name,
            withdrawal_type,
            recipient,
            approvals,
            executed:        false,
            created_at:      now,
            expires_at:      now + PROPOSAL_EXPIRY_MS,
            guard_id:        object::id(guard),
            platform_id:     guard.platform_id,
        };

        event::emit(WithdrawalProposed {
            proposal_id:     object::id(&proposal),
            proposer:        sender,
            amount,
            coin_type_name:  proposal.coin_type_name,
            withdrawal_type,
            recipient,
            timestamp:       now,
        });

        transfer::share_object(proposal);
    }

    public entry fun approve_withdrawal(
        guard:    &MultisigGuard,
        proposal: &mut WithdrawalProposalTb2,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(is_signer(guard, sender), ENotASigner);
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);

        let len = vector::length(&proposal.approvals);
        let mut i = 0;
        while (i < len) {
            assert!(*vector::borrow(&proposal.approvals, i) != sender, EAlreadyApproved);
            i = i + 1;
        };
        vector::push_back(&mut proposal.approvals, sender);

        event::emit(WithdrawalApprovedEvent {
            proposal_id:    object::id(proposal),
            approver:       sender,
            approval_count: vector::length(&proposal.approvals),
            threshold:      guard.threshold,
            timestamp:      now,
        });
    }

    /// Execute a multisig fee withdrawal for token T.
    /// The caller supplies T; the function verifies the proposal was created
    /// for that exact type by comparing coin_type_name bytes.
    public entry fun execute_withdrawal_fees<T>(
        guard:      &MultisigGuard,
        proposal:   &mut WithdrawalProposalTb2,
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);
        assert!(proposal.platform_id == object::id(platform), EUnauthorized);
        assert!(guard.platform_id == object::id(platform), EUnauthorized);
        assert!(proposal.withdrawal_type == WITHDRAWAL_TYPE_FEES, EInvalidAmount);
        assert!(proposal.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);
        assert!(
            count_valid_approvals(guard, &proposal.approvals) >= guard.threshold,
            EInsufficientApprovals
        );

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        let amount = proposal.amount;
        assert!(amount <= state.accrued_fees, EInsufficientBalance);
        assert!(balance::value(&state.treasury) >= amount, EInsufficientTreasury);
        assert!(amount <= state.max_single_withdrawal, EWithdrawalTooLarge);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);

        platform.last_withdrawal_at = now;
        proposal.executed           = true;
        state.accrued_fees          = state.accrued_fees - amount;

        let fees_balance = balance::split(&mut state.treasury, amount);
        let fees_coin    = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, proposal.recipient);

        event::emit(MultisigWithdrawalExecuted {
            proposal_id:     object::id(proposal),
            amount,
            coin_type_name:  proposal.coin_type_name,
            withdrawal_type: WITHDRAWAL_TYPE_FEES,
            recipient:       proposal.recipient,
            approval_count:  vector::length(&proposal.approvals),
            timestamp:       now,
        });
    }

    public entry fun execute_withdrawal_treasury<T>(
        guard:      &MultisigGuard,
        proposal:   &mut WithdrawalProposalTb2,
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);
        assert!(proposal.platform_id == object::id(platform), EUnauthorized);
        assert!(guard.platform_id == object::id(platform), EUnauthorized);
        assert!(proposal.withdrawal_type == WITHDRAWAL_TYPE_TREASURY, EInvalidAmount);
        assert!(proposal.coin_type_name == get_coin_type_name<T>(), ECoinTypeMismatch);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);
        assert!(
            count_valid_approvals(guard, &proposal.approvals) >= guard.threshold,
            EInsufficientApprovals
        );

        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        let amount = proposal.amount;
        assert!(balance::value(&state.treasury) >= amount, EInsufficientTreasury);
        assert!(
            balance::value(&state.treasury) - amount >= state.total_potential_liability,
            EInsufficientBalance
        );
        assert!(amount <= state.max_single_withdrawal, EWithdrawalTooLarge);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);

        platform.last_withdrawal_at = now;
        proposal.executed           = true;

        let treasury_balance = balance::split(&mut state.treasury, amount);
        let treasury_coin    = coin::from_balance(treasury_balance, ctx);
        transfer::public_transfer(treasury_coin, proposal.recipient);

        event::emit(MultisigWithdrawalExecuted {
            proposal_id:     object::id(proposal),
            amount,
            coin_type_name:  proposal.coin_type_name,
            withdrawal_type: WITHDRAWAL_TYPE_TREASURY,
            recipient:       proposal.recipient,
            approval_count:  vector::length(&proposal.approvals),
            timestamp:       now,
        });
    }

    // ============================================================
    // ADMIN — PLATFORM CONFIGURATION
    // ============================================================

    public entry fun toggle_pause(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
    ) {
        platform.paused = !platform.paused;
        event::emit(PlatformPaused {
            platform_id: object::id(platform),
            paused:      platform.paused,
            timestamp:   clock::timestamp_ms(clock),
        });
    }

    public entry fun set_pause(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        paused:     bool,
        clock:      &Clock,
    ) {
        platform.paused = paused;
        event::emit(PlatformPaused {
            platform_id: object::id(platform),
            paused,
            timestamp:   clock::timestamp_ms(clock),
        });
    }

    public entry fun set_oracle_public_key(
        _admin_cap:  &AdminCap,
        platform:    &mut BettingPlatformTb2,
        new_public_key: vector<u8>,
        clock:       &Clock,
    ) {
        assert!(vector::length(&new_public_key) == 32, EInvalidPublicKey);
        platform.oracle_public_key = new_public_key;
        event::emit(OracleKeyUpdated {
            platform_id: object::id(platform),
            timestamp:   clock::timestamp_ms(clock),
        });
    }

    public entry fun update_fee(
        _admin_cap:  &AdminCap,
        platform:    &mut BettingPlatformTb2,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= MAX_FEE_BPS, EUnauthorized);
        platform.platform_fee_bps = new_fee_bps;
    }

    public entry fun update_bet_expiry(
        _admin_cap:    &AdminCap,
        platform:      &mut BettingPlatformTb2,
        new_expiry_ms: u64,
    ) {
        platform.bet_expiry_ms = new_expiry_ms;
    }

    public entry fun mint_oracle_cap(
        _admin_cap: &AdminCap,
        recipient:  address,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        let oracle_cap = OracleCap { id: object::new(ctx) };
        event::emit(OracleCapMinted {
            oracle_cap_id: object::id(&oracle_cap),
            recipient,
            timestamp:     clock::timestamp_ms(clock),
        });
        transfer::transfer(oracle_cap, recipient);
    }

    public entry fun revoke_oracle_cap(
        _admin_cap: &AdminCap,
        oracle_cap: OracleCap,
        clock:      &Clock,
    ) {
        let oracle_cap_id = object::id(&oracle_cap);
        let OracleCap { id } = oracle_cap;
        object::delete(id);
        event::emit(OracleCapRevoked {
            oracle_cap_id,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // ============================================================
    // ADMIN — TOKEN CONFIGURATION
    // ============================================================

    public entry fun update_token_limits<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        min_bet:    u64,
        max_bet:    u64,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        assert!(max_bet <= state.absolute_max_bet, EExceedsHardMaxBet);
        state.min_bet = min_bet;
        state.max_bet = max_bet;
    }

    public entry fun update_token_withdrawal_ceiling<T>(
        _admin_cap:         &AdminCap,
        platform:           &mut BettingPlatformTb2,
        max_single_withdrawal: u64,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        assert!(max_single_withdrawal > 0, EInvalidAmount);
        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.max_single_withdrawal = max_single_withdrawal;
    }

    public entry fun enable_token<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.enabled = true;
        event::emit(TokenStatusChanged {
            platform_id:    object::id(platform),
            coin_type_name: get_coin_type_name<T>(),
            enabled:        true,
            timestamp:      clock::timestamp_ms(clock),
        });
    }

    public entry fun disable_token<T>(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.enabled = false;
        event::emit(TokenStatusChanged {
            platform_id:    object::id(platform),
            coin_type_name: get_coin_type_name<T>(),
            enabled:        false,
            timestamp:      clock::timestamp_ms(clock),
        });
    }

    /// Emergency liability correction (admin safety valve).
    public entry fun admin_reset_liability<T>(
        _admin_cap:    &AdminCap,
        platform:      &mut BettingPlatformTb2,
        new_liability: u64,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let state = dynamic_field::borrow_mut<TokenStateKey<T>, TokenState<T>>(
            &mut platform.id, TokenStateKey<T> {}
        );
        state.total_potential_liability = new_liability;
    }

    // ============================================================
    // TD2 TOKEN — EXPLICIT ENTRY FUNCTIONS
    // Every function below is a named wrapper around the generic
    // equivalent so wallets, SDKs, and PTBs can call TD2 operations
    // without supplying an explicit type argument.
    // ============================================================

    /// Register TD2 with sensible defaults.  Must be called once by admin
    /// before any TD2 betting can take place.
    public entry fun init_td2_state(
        _admin_cap: &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
    ) {
        assert!(
            !dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2AlreadyInitialized
        );
        dynamic_field::add(
            &mut platform.id,
            TokenStateKey<TD2> {},
            TokenState<TD2> {
                treasury:                  balance::zero<TD2>(),
                total_volume:              0,
                total_potential_liability: 0,
                accrued_fees:              0,
                min_bet:                   DEFAULT_MIN_BET_TD2,
                max_bet:                   DEFAULT_MAX_BET_TD2,
                absolute_max_bet:          ABSOLUTE_MAX_BET_TD2,
                max_single_withdrawal:     MAX_SINGLE_WITHDRAWAL_TD2,
                enabled:                   true,
            }
        );
        event::emit(TokenRegistered {
            platform_id:       object::id(platform),
            coin_type_name:    get_coin_type_name<TD2>(),
            min_bet:           DEFAULT_MIN_BET_TD2,
            max_bet:           DEFAULT_MAX_BET_TD2,
            absolute_max_bet:  ABSOLUTE_MAX_BET_TD2,
            timestamp:         clock::timestamp_ms(clock),
        });
    }

    public entry fun place_bet_td2(
        platform:         &mut BettingPlatformTb2,
        payment:          Coin<TD2>,
        event_id:         vector<u8>,
        market_id:        vector<u8>,
        prediction:       vector<u8>,
        odds:             u64,
        quote_expiry:     u64,
        oracle_signature: vector<u8>,
        walrus_blob_id:   vector<u8>,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        place_bet<TD2>(
            platform, payment, event_id, market_id, prediction,
            odds, quote_expiry, oracle_signature, walrus_blob_id, clock, ctx
        );
    }

    public entry fun settle_bet_td2(
        oracle_cap: &OracleCap,
        platform:   &mut BettingPlatformTb2,
        bet:        &mut BetTb2,
        won:        bool,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        settle_bet<TD2>(oracle_cap, platform, bet, won, clock, ctx);
    }

    public entry fun void_bet_td2(
        oracle_cap: &OracleCap,
        platform:   &mut BettingPlatformTb2,
        bet:        &mut BetTb2,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        void_bet<TD2>(oracle_cap, platform, bet, clock, ctx);
    }

    public entry fun void_bet_td2_admin(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        bet:       &mut BetTb2,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        void_bet_admin<TD2>(admin_cap, platform, bet, clock, ctx);
    }

    public entry fun void_phantom_bet_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        bet:       &mut BetTb2,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        void_phantom_bet<TD2>(admin_cap, platform, bet, clock, ctx);
    }

    public entry fun claim_expired_refund_td2(
        platform: &mut BettingPlatformTb2,
        bet:      &mut BetTb2,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        claim_expired_refund<TD2>(platform, bet, clock, ctx);
    }

    public entry fun deposit_liquidity_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        coin:      Coin<TD2>,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        deposit_liquidity<TD2>(admin_cap, platform, coin, clock, ctx);
    }

    public entry fun withdraw_fees_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        amount:    u64,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        withdraw_fees<TD2>(admin_cap, platform, amount, clock, ctx);
    }

    public entry fun withdraw_treasury_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        amount:    u64,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        withdraw_treasury<TD2>(admin_cap, platform, amount, clock, ctx);
    }

    public entry fun update_limits_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        min_bet:   u64,
        max_bet:   u64,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        update_token_limits<TD2>(admin_cap, platform, min_bet, max_bet);
    }

    public entry fun update_withdrawal_ceiling_td2(
        admin_cap:            &AdminCap,
        platform:             &mut BettingPlatformTb2,
        max_single_withdrawal: u64,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        update_token_withdrawal_ceiling<TD2>(admin_cap, platform, max_single_withdrawal);
    }

    public entry fun enable_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        clock:     &Clock,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        enable_token<TD2>(admin_cap, platform, clock);
    }

    public entry fun disable_td2(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        clock:     &Clock,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        disable_token<TD2>(admin_cap, platform, clock);
    }

    public entry fun admin_reset_liability_td2(
        admin_cap:     &AdminCap,
        platform:      &mut BettingPlatformTb2,
        new_liability: u64,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        admin_reset_liability<TD2>(admin_cap, platform, new_liability);
    }

    /// Multisig: execute a fee withdrawal for TD2.
    public entry fun execute_withdrawal_fees_td2(
        guard:      &MultisigGuard,
        proposal:   &mut WithdrawalProposalTb2,
        admin_cap:  &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        execute_withdrawal_fees<TD2>(guard, proposal, admin_cap, platform, clock, ctx);
    }

    /// Multisig: execute a treasury withdrawal for TD2.
    public entry fun execute_withdrawal_treasury_td2(
        guard:      &MultisigGuard,
        proposal:   &mut WithdrawalProposalTb2,
        admin_cap:  &AdminCap,
        platform:   &mut BettingPlatformTb2,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        execute_withdrawal_treasury<TD2>(guard, proposal, admin_cap, platform, clock, ctx);
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /// Named view for TD2 stats — same as get_token_stats<TD2>.
    public fun get_td2_stats(
        platform: &BettingPlatformTb2
    ): (u64, u64, u64, u64, u64, u64, u64, u64, bool) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        get_token_stats<TD2>(platform)
    }

    public fun td2_is_initialized(platform: &BettingPlatformTb2): bool {
        dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {})
    }

    public fun get_platform_info(platform: &BettingPlatformTb2): (u64, u64, bool, u64) {
        (platform.platform_fee_bps, platform.total_bets, platform.paused, platform.bet_expiry_ms)
    }

    public fun token_is_registered<T>(platform: &BettingPlatformTb2): bool {
        dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {})
    }

    /// Returns (treasury_balance, total_volume, total_potential_liability,
    ///          accrued_fees, min_bet, max_bet, absolute_max_bet,
    ///          max_single_withdrawal, enabled).
    public fun get_token_stats<T>(
        platform: &BettingPlatformTb2
    ): (u64, u64, u64, u64, u64, u64, u64, u64, bool) {
        assert!(
            dynamic_field::exists_<TokenStateKey<T>>(&platform.id, TokenStateKey<T> {}),
            ETokenNotRegistered
        );
        let s = dynamic_field::borrow<TokenStateKey<T>, TokenState<T>>(
            &platform.id, TokenStateKey<T> {}
        );
        (
            balance::value(&s.treasury),
            s.total_volume,
            s.total_potential_liability,
            s.accrued_fees,
            s.min_bet,
            s.max_bet,
            s.absolute_max_bet,
            s.max_single_withdrawal,
            s.enabled,
        )
    }

    public fun get_bet_info(bet: &BetTb2): (address, u64, u64, u64, u8, vector<u8>) {
        (bet.bettor, bet.stake, bet.odds, bet.potential_payout, bet.status, bet.coin_type_name)
    }

    public fun get_bet_prediction(bet: &BetTb2): vector<u8> { bet.prediction }
    public fun get_bet_event_id(bet:  &BetTb2): vector<u8> { bet.event_id }
    public fun get_bet_market_id(bet: &BetTb2): vector<u8> { bet.market_id }
    public fun get_bet_deadline(bet:  &BetTb2): u64         { bet.deadline }

    public fun get_multisig_info(guard: &MultisigGuard): (vector<address>, u64, ID) {
        (guard.signers, guard.threshold, guard.platform_id)
    }

    public fun get_proposal_info(
        proposal: &WithdrawalProposalTb2
    ): (address, u64, vector<u8>, u8, address, u64, bool, u64, u64) {
        (
            proposal.proposer,
            proposal.amount,
            proposal.coin_type_name,
            proposal.withdrawal_type,
            proposal.recipient,
            vector::length(&proposal.approvals),
            proposal.executed,
            proposal.created_at,
            proposal.expires_at,
        )
    }

    public fun is_withdrawal_locked(platform: &BettingPlatformTb2): bool {
        dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {})
    }

    // ============================================================
    // ADMIN CONVENIENCE — added in upgrade v2
    // ============================================================

    /// Settle a TD2 bet using the AdminCap (mirrors settle_bet_admin in the
    /// sportsbook contract). Allows the backend to settle without needing a
    /// separate OracleCap object.
    public entry fun settle_bet_td2_admin(
        admin_cap: &AdminCap,
        platform:  &mut BettingPlatformTb2,
        bet:       &mut BetTb2,
        won:       bool,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        assert!(
            dynamic_field::exists_<TokenStateKey<TD2>>(&platform.id, TokenStateKey<TD2> {}),
            ETd2NotInitialized
        );
        // Derive an ephemeral OracleCap capability from the AdminCap to reuse
        // the shared settle_bet logic without storing an extra on-chain object.
        let oracle_cap = OracleCap { id: object::new(ctx) };
        settle_bet<TD2>(&oracle_cap, platform, bet, won, clock, ctx);
        let OracleCap { id } = oracle_cap;
        object::delete(id);
        // Suppress unused variable warning
        let _ = admin_cap;
    }

    /// Mint an OracleCap and send it to the transaction sender.
    /// Use this instead of mint_oracle_cap when you want to avoid passing
    /// an address as a pure argument (which fails with Move 2024 + SDK v2).
    public entry fun mint_oracle_cap_self(
        _admin_cap: &AdminCap,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        let recipient = tx_context::sender(ctx);
        let oracle_cap = OracleCap { id: object::new(ctx) };
        event::emit(OracleCapMinted {
            oracle_cap_id: object::id(&oracle_cap),
            recipient,
            timestamp:     clock::timestamp_ms(clock),
        });
        transfer::transfer(oracle_cap, recipient);
    }
}
