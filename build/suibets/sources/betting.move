#[allow(duplicate_alias, unused_const, lint(public_entry))]
module suibets::betting {
    use sui::object::{Self, UID, ID};
    use sui::transfer::{Self, Receiving};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::types;
    use sui::ed25519;
    use std::bcs;
    use std::vector;
    use sui::dynamic_field;
    
    use sbets_token::sbets::SBETS;

    const EInsufficientBalance: u64 = 0;
    const EBetAlreadySettled: u64 = 1;
    const EUnauthorized: u64 = 2;
    const EInvalidOdds: u64 = 3;
    const EBetNotFound: u64 = 4;
    const EEventNotFinished: u64 = 5;
    const EInvalidAmount: u64 = 6;
    const EPlatformPaused: u64 = 7;
    const EExceedsMaxBet: u64 = 8;
    const EExceedsMinBet: u64 = 9;
    const ENotOneTimeWitness: u64 = 10;
    const EInsufficientTreasury: u64 = 11;
    const EInvalidOracleSignature: u64 = 12;
    const EQuoteExpired: u64 = 13;
    const EBetNotExpired: u64 = 14;
    const EExceedsHardMaxBet: u64 = 15;
    const EOracleNotSet: u64 = 16;
    const EWithdrawalTooLarge: u64 = 17;
    const EInvalidPublicKey: u64 = 18;
    const EPhantomVoidFailed: u64 = 19;
    const EWithdrawalsLocked: u64 = 20;
    const ENotASigner: u64 = 21;
    const EAlreadyApproved: u64 = 22;
    const EInsufficientApprovals: u64 = 23;
    const EProposalExpired: u64 = 24;
    const EProposalAlreadyExecuted: u64 = 25;
    const EInvalidThreshold: u64 = 26;

    const STATUS_PENDING: u8 = 0;
    const STATUS_WON: u8 = 1;
    const STATUS_LOST: u8 = 2;
    const STATUS_VOID: u8 = 3;

    const COIN_TYPE_SUI: u8 = 0;
    const COIN_TYPE_SBETS: u8 = 1;

    const PLATFORM_FEE_BPS: u64 = 100;
    const BPS_DENOMINATOR: u64 = 10000;

    const DEFAULT_MIN_BET_SUI: u64 = 50_000_000;
    const DEFAULT_MAX_BET_SUI: u64 = 100_000_000_000;
    const DEFAULT_MIN_BET_SBETS: u64 = 1_000_000_000_000;
    const DEFAULT_MAX_BET_SBETS: u64 = 100_000_000_000_000_000;
    const MAX_FEE_BPS: u64 = 1000;

    const ABSOLUTE_MAX_BET_SUI: u64 = 1_000_000_000_000;
    const ABSOLUTE_MAX_BET_SBETS: u64 = 1_000_000_000_000_000_000;

    const DEFAULT_BET_EXPIRY_MS: u64 = 604_800_000;

    const MAX_SINGLE_WITHDRAWAL_SUI: u64 = 500_000_000_000;
    const MAX_SINGLE_WITHDRAWAL_SBETS: u64 = 500_000_000_000_000_000;
    const WITHDRAWAL_COOLDOWN_MS: u64 = 3_600_000;

    const WITHDRAWAL_TYPE_FEES: u8 = 0;
    const WITHDRAWAL_TYPE_TREASURY: u8 = 1;
    const PROPOSAL_EXPIRY_MS: u64 = 86_400_000;

    public struct BETTING has drop {}

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct OracleCap has key, store {
        id: UID,
    }

    public struct BettingPlatform has key {
        id: UID,
        treasury_sui: Balance<SUI>,
        total_volume_sui: u64,
        total_potential_liability_sui: u64,
        accrued_fees_sui: u64,
        treasury_sbets: Balance<SBETS>,
        total_volume_sbets: u64,
        total_potential_liability_sbets: u64,
        accrued_fees_sbets: u64,
        platform_fee_bps: u64,
        total_bets: u64,
        paused: bool,
        min_bet_sui: u64,
        max_bet_sui: u64,
        min_bet_sbets: u64,
        max_bet_sbets: u64,
        oracle_public_key: vector<u8>,
        bet_expiry_ms: u64,
        last_withdrawal_at: u64,
    }

    public struct Bet has key, store {
        id: UID,
        bettor: address,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        stake: u64,
        potential_payout: u64,
        platform_fee: u64,
        status: u8,
        placed_at: u64,
        settled_at: u64,
        walrus_blob_id: vector<u8>,
        coin_type: u8,
        deadline: u64,
    }

    public struct BetPlaced has copy, drop {
        bet_id: ID,
        bettor: address,
        event_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        stake: u64,
        potential_payout: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct BetSettled has copy, drop {
        bet_id: ID,
        bettor: address,
        status: u8,
        payout: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct PlatformCreated has copy, drop {
        platform_id: ID,
        admin_cap_id: ID,
        fee_bps: u64,
    }

    public struct PlatformPaused has copy, drop {
        platform_id: ID,
        paused: bool,
        timestamp: u64,
    }

    public struct OracleCapMinted has copy, drop {
        oracle_cap_id: ID,
        recipient: address,
        timestamp: u64,
    }

    public struct OracleCapRevoked has copy, drop {
        oracle_cap_id: ID,
        timestamp: u64,
    }

    public struct LiquidityDeposited has copy, drop {
        platform_id: ID,
        depositor: address,
        amount: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct FeesWithdrawn has copy, drop {
        platform_id: ID,
        amount: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct TreasuryWithdrawn has copy, drop {
        platform_id: ID,
        amount: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct OracleKeyUpdated has copy, drop {
        platform_id: ID,
        timestamp: u64,
    }

    public struct ExpiredBetRefunded has copy, drop {
        bet_id: ID,
        bettor: address,
        refund_amount: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct PhantomBetVoided has copy, drop {
        bet_id: ID,
        bettor: address,
        stake: u64,
        liability_freed: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct WithdrawalLockKey has copy, drop, store {}

    public struct MultisigGuard has key {
        id: UID,
        signers: vector<address>,
        threshold: u64,
        platform_id: ID,
    }

    public struct WithdrawalProposal has key {
        id: UID,
        proposer: address,
        amount: u64,
        coin_type: u8,
        withdrawal_type: u8,
        recipient: address,
        approvals: vector<address>,
        executed: bool,
        created_at: u64,
        expires_at: u64,
        guard_id: ID,
        platform_id: ID,
    }

    public struct MultisigGuardCreated has copy, drop {
        guard_id: ID,
        platform_id: ID,
        threshold: u64,
        num_signers: u64,
        timestamp: u64,
    }

    public struct WithdrawalProposed has copy, drop {
        proposal_id: ID,
        proposer: address,
        amount: u64,
        coin_type: u8,
        withdrawal_type: u8,
        recipient: address,
        timestamp: u64,
    }

    public struct WithdrawalApprovedEvent has copy, drop {
        proposal_id: ID,
        approver: address,
        approval_count: u64,
        threshold: u64,
        timestamp: u64,
    }

    public struct MultisigWithdrawalExecuted has copy, drop {
        proposal_id: ID,
        amount: u64,
        coin_type: u8,
        withdrawal_type: u8,
        recipient: address,
        approval_count: u64,
        timestamp: u64,
    }

    public struct DirectWithdrawalsLocked has copy, drop {
        platform_id: ID,
        locked: bool,
        timestamp: u64,
    }

    fun build_oracle_message(event_id: &vector<u8>, odds: u64, quote_expiry: u64, bettor: address, prediction: &vector<u8>): vector<u8> {
        let mut msg = vector::empty<u8>();
        vector::append(&mut msg, *event_id);
        let odds_bytes = bcs::to_bytes(&odds);
        vector::append(&mut msg, odds_bytes);
        let expiry_bytes = bcs::to_bytes(&quote_expiry);
        vector::append(&mut msg, expiry_bytes);
        let addr_bytes = bcs::to_bytes(&bettor);
        vector::append(&mut msg, addr_bytes);
        vector::append(&mut msg, *prediction);
        msg
    }

    fun init(witness: BETTING, ctx: &mut TxContext) {
        assert!(types::is_one_time_witness(&witness), ENotOneTimeWitness);
        
        let deployer = tx_context::sender(ctx);
        
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        let admin_cap_id = object::id(&admin_cap);
        
        let platform = BettingPlatform {
            id: object::new(ctx),
            treasury_sui: balance::zero(),
            total_volume_sui: 0,
            total_potential_liability_sui: 0,
            accrued_fees_sui: 0,
            treasury_sbets: balance::zero(),
            total_volume_sbets: 0,
            total_potential_liability_sbets: 0,
            accrued_fees_sbets: 0,
            platform_fee_bps: PLATFORM_FEE_BPS,
            total_bets: 0,
            paused: true,
            min_bet_sui: DEFAULT_MIN_BET_SUI,
            max_bet_sui: DEFAULT_MAX_BET_SUI,
            min_bet_sbets: DEFAULT_MIN_BET_SBETS,
            max_bet_sbets: DEFAULT_MAX_BET_SBETS,
            oracle_public_key: vector::empty(),
            bet_expiry_ms: DEFAULT_BET_EXPIRY_MS,
            last_withdrawal_at: 0,
        };

        event::emit(PlatformCreated {
            platform_id: object::id(&platform),
            admin_cap_id,
            fee_bps: PLATFORM_FEE_BPS,
        });

        transfer::share_object(platform);
        transfer::transfer(admin_cap, deployer);
    }

    public entry fun place_bet(
        platform: &mut BettingPlatform,
        payment: Coin<SUI>,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        quote_expiry: u64,
        oracle_signature: vector<u8>,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!platform.paused, EPlatformPaused);
        
        let oracle_pk = &platform.oracle_public_key;
        assert!(vector::length(oracle_pk) == 32, EOracleNotSet);
        
        let bettor = tx_context::sender(ctx);
        let msg = build_oracle_message(&event_id, odds, quote_expiry, bettor, &prediction);
        assert!(
            ed25519::ed25519_verify(&oracle_signature, oracle_pk, &msg),
            EInvalidOracleSignature
        );
        
        let now = clock::timestamp_ms(clock);
        assert!(now <= quote_expiry, EQuoteExpired);
        
        let stake = coin::value(&payment);
        assert!(stake > 0, EInvalidAmount);
        assert!(stake >= platform.min_bet_sui, EExceedsMinBet);
        assert!(stake <= platform.max_bet_sui, EExceedsMaxBet);
        assert!(stake <= ABSOLUTE_MAX_BET_SUI, EExceedsHardMaxBet);
        assert!(odds >= 100, EInvalidOdds);
        assert!(odds <= 100000, EInvalidOdds);

        let payout_u128 = ((stake as u128) * (odds as u128)) / 100u128;
        assert!(payout_u128 <= 18446744073709551615u128, EInvalidAmount);
        let potential_payout = (payout_u128 as u64);
        
        let current_treasury = balance::value(&platform.treasury_sui);
        assert!(
            current_treasury + stake >= platform.total_potential_liability_sui + potential_payout,
            EInsufficientBalance
        );

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut platform.treasury_sui, payment_balance);

        platform.total_bets = platform.total_bets + 1;
        platform.total_volume_sui = platform.total_volume_sui + stake;
        platform.total_potential_liability_sui = platform.total_potential_liability_sui + potential_payout;

        let bettor = tx_context::sender(ctx);

        let bet = Bet {
            id: object::new(ctx),
            bettor,
            event_id,
            market_id,
            prediction,
            odds,
            stake,
            potential_payout,
            platform_fee: 0,
            status: STATUS_PENDING,
            placed_at: now,
            settled_at: 0,
            walrus_blob_id,
            coin_type: COIN_TYPE_SUI,
            deadline: now + platform.bet_expiry_ms,
        };

        let bet_id = object::id(&bet);

        event::emit(BetPlaced {
            bet_id,
            bettor,
            event_id: bet.event_id,
            prediction: bet.prediction,
            odds,
            stake,
            potential_payout,
            coin_type: COIN_TYPE_SUI,
            timestamp: now,
        });

        transfer::share_object(bet);
    }

    public entry fun place_bet_sbets(
        platform: &mut BettingPlatform,
        payment: Coin<SBETS>,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        quote_expiry: u64,
        oracle_signature: vector<u8>,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!platform.paused, EPlatformPaused);

        let oracle_pk = &platform.oracle_public_key;
        assert!(vector::length(oracle_pk) == 32, EOracleNotSet);

        let bettor = tx_context::sender(ctx);
        let msg = build_oracle_message(&event_id, odds, quote_expiry, bettor, &prediction);
        assert!(
            ed25519::ed25519_verify(&oracle_signature, oracle_pk, &msg),
            EInvalidOracleSignature
        );

        let now = clock::timestamp_ms(clock);
        assert!(now <= quote_expiry, EQuoteExpired);
        
        let stake = coin::value(&payment);
        assert!(stake > 0, EInvalidAmount);
        assert!(stake >= platform.min_bet_sbets, EExceedsMinBet);
        assert!(stake <= platform.max_bet_sbets, EExceedsMaxBet);
        assert!(stake <= ABSOLUTE_MAX_BET_SBETS, EExceedsHardMaxBet);
        assert!(odds >= 100, EInvalidOdds);
        assert!(odds <= 100000, EInvalidOdds);

        let payout_u128 = ((stake as u128) * (odds as u128)) / 100u128;
        assert!(payout_u128 <= 18446744073709551615u128, EInvalidAmount);
        let potential_payout = (payout_u128 as u64);
        
        let current_treasury = balance::value(&platform.treasury_sbets);
        assert!(
            current_treasury + stake >= platform.total_potential_liability_sbets + potential_payout,
            EInsufficientBalance
        );

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut platform.treasury_sbets, payment_balance);

        platform.total_bets = platform.total_bets + 1;
        platform.total_volume_sbets = platform.total_volume_sbets + stake;
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets + potential_payout;

        let bettor = tx_context::sender(ctx);

        let bet = Bet {
            id: object::new(ctx),
            bettor,
            event_id,
            market_id,
            prediction,
            odds,
            stake,
            potential_payout,
            platform_fee: 0,
            status: STATUS_PENDING,
            placed_at: now,
            settled_at: 0,
            walrus_blob_id,
            coin_type: COIN_TYPE_SBETS,
            deadline: now + platform.bet_expiry_ms,
        };

        let bet_id = object::id(&bet);

        event::emit(BetPlaced {
            bet_id,
            bettor,
            event_id: bet.event_id,
            prediction: bet.prediction,
            odds,
            stake,
            potential_payout,
            coin_type: COIN_TYPE_SBETS,
            timestamp: now,
        });

        transfer::share_object(bet);
    }

    public entry fun settle_bet(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sui = platform.accrued_fees_sui + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sui) >= net_payout, EInsufficientTreasury);
            
            let payout_balance = balance::split(&mut platform.treasury_sui, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sui = platform.accrued_fees_sui + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        }
    }

    public entry fun settle_bet_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sui = platform.accrued_fees_sui + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sui) >= net_payout, EInsufficientTreasury);
            
            let payout_balance = balance::split(&mut platform.treasury_sui, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sui = platform.accrued_fees_sui + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        }
    }

    public entry fun settle_bet_sbets(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sbets) >= net_payout, EInsufficientTreasury);
            
            let payout_balance = balance::split(&mut platform.treasury_sbets, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        }
    }

    public entry fun settle_bet_sbets_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sbets) >= net_payout, EInsufficientTreasury);
            
            let payout_balance = balance::split(&mut platform.treasury_sbets, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        }
    }

    public entry fun void_bet(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&platform.treasury_sui) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut platform.treasury_sui, refund_amount);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: bet.settled_at,
        });
    }

    public entry fun void_bet_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&platform.treasury_sui) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut platform.treasury_sui, refund_amount);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: bet.settled_at,
        });
    }

    public entry fun void_bet_sbets(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&platform.treasury_sbets) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut platform.treasury_sbets, refund_amount);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: bet.settled_at,
        });
    }

    public entry fun void_bet_sbets_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&platform.treasury_sbets) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut platform.treasury_sbets, refund_amount);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: bet.settled_at,
        });
    }

    public entry fun void_phantom_bet(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        bet.status = STATUS_VOID;
        bet.settled_at = now;

        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        event::emit(PhantomBetVoided {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            stake: bet.stake,
            liability_freed: bet.potential_payout,
            coin_type: COIN_TYPE_SUI,
            timestamp: now,
        });
    }

    public entry fun void_phantom_bet_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        bet.status = STATUS_VOID;
        bet.settled_at = now;

        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        event::emit(PhantomBetVoided {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            stake: bet.stake,
            liability_freed: bet.potential_payout,
            coin_type: COIN_TYPE_SBETS,
            timestamp: now,
        });
    }

    public entry fun claim_expired_refund_sui(
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);
        let now = clock::timestamp_ms(clock);
        assert!(now > bet.deadline, EBetNotExpired);
        assert!(tx_context::sender(ctx) == bet.bettor, EUnauthorized);

        bet.status = STATUS_VOID;
        bet.settled_at = now;

        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&platform.treasury_sui) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut platform.treasury_sui, refund_amount);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(ExpiredBetRefunded {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            refund_amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: now,
        });
    }

    public entry fun claim_expired_refund_sbets(
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);
        let now = clock::timestamp_ms(clock);
        assert!(now > bet.deadline, EBetNotExpired);
        assert!(tx_context::sender(ctx) == bet.bettor, EUnauthorized);

        bet.status = STATUS_VOID;
        bet.settled_at = now;

        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        let refund_amount = bet.stake;
        assert!(balance::value(&platform.treasury_sbets) >= refund_amount, EInsufficientBalance);
        let refund_balance = balance::split(&mut platform.treasury_sbets, refund_amount);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, bet.bettor);

        event::emit(ExpiredBetRefunded {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            refund_amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: now,
        });
    }

    public entry fun deposit_liquidity(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        coin: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&coin);
        balance::join(&mut platform.treasury_sui, coin::into_balance(coin));
        
        event::emit(LiquidityDeposited {
            platform_id: object::id(platform),
            depositor: tx_context::sender(ctx),
            amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun deposit_liquidity_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        coin: Coin<SBETS>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&coin);
        balance::join(&mut platform.treasury_sbets, coin::into_balance(coin));
        
        event::emit(LiquidityDeposited {
            platform_id: object::id(platform),
            depositor: tx_context::sender(ctx),
            amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun withdraw_fees(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {}), EWithdrawalsLocked);
        assert!(amount <= platform.accrued_fees_sui, EInsufficientBalance);
        assert!(balance::value(&platform.treasury_sui) >= amount, EInsufficientTreasury);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SUI, EWithdrawalTooLarge);
        
        let now = clock::timestamp_ms(clock);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;

        let fees_balance = balance::split(&mut platform.treasury_sui, amount);
        let fees_coin = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, tx_context::sender(ctx));
        
        platform.accrued_fees_sui = platform.accrued_fees_sui - amount;

        event::emit(FeesWithdrawn {
            platform_id: object::id(platform),
            amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: now,
        });
    }

    public entry fun withdraw_fees_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {}), EWithdrawalsLocked);
        assert!(amount <= platform.accrued_fees_sbets, EInsufficientBalance);
        assert!(balance::value(&platform.treasury_sbets) >= amount, EInsufficientTreasury);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SBETS, EWithdrawalTooLarge);

        let now = clock::timestamp_ms(clock);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;
        
        let fees_balance = balance::split(&mut platform.treasury_sbets, amount);
        let fees_coin = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, tx_context::sender(ctx));
        
        platform.accrued_fees_sbets = platform.accrued_fees_sbets - amount;

        event::emit(FeesWithdrawn {
            platform_id: object::id(platform),
            amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: now,
        });
    }

    public entry fun withdraw_treasury(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {}), EWithdrawalsLocked);
        assert!(balance::value(&platform.treasury_sui) >= amount, EInsufficientTreasury);
        assert!(balance::value(&platform.treasury_sui) - amount >= platform.total_potential_liability_sui, EInsufficientBalance);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SUI, EWithdrawalTooLarge);

        let now = clock::timestamp_ms(clock);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;
        
        let treasury_balance = balance::split(&mut platform.treasury_sui, amount);
        let treasury_coin = coin::from_balance(treasury_balance, ctx);
        transfer::public_transfer(treasury_coin, tx_context::sender(ctx));

        event::emit(TreasuryWithdrawn {
            platform_id: object::id(platform),
            amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: now,
        });
    }

    public entry fun withdraw_treasury_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {}), EWithdrawalsLocked);
        assert!(balance::value(&platform.treasury_sbets) >= amount, EInsufficientTreasury);
        assert!(balance::value(&platform.treasury_sbets) - amount >= platform.total_potential_liability_sbets, EInsufficientBalance);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SBETS, EWithdrawalTooLarge);

        let now = clock::timestamp_ms(clock);
        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;

        let treasury_balance = balance::split(&mut platform.treasury_sbets, amount);
        let treasury_coin = coin::from_balance(treasury_balance, ctx);
        transfer::public_transfer(treasury_coin, tx_context::sender(ctx));

        event::emit(TreasuryWithdrawn {
            platform_id: object::id(platform),
            amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: now,
        });
    }

    public entry fun update_fee(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= MAX_FEE_BPS, EUnauthorized);
        platform.platform_fee_bps = new_fee_bps;
    }

    public entry fun update_limits_sui(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        min_bet: u64,
        max_bet: u64,
    ) {
        assert!(max_bet <= ABSOLUTE_MAX_BET_SUI, EExceedsHardMaxBet);
        platform.min_bet_sui = min_bet;
        platform.max_bet_sui = max_bet;
    }

    public entry fun update_limits_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        min_bet: u64,
        max_bet: u64,
    ) {
        assert!(max_bet <= ABSOLUTE_MAX_BET_SBETS, EExceedsHardMaxBet);
        platform.min_bet_sbets = min_bet;
        platform.max_bet_sbets = max_bet;
    }

    public entry fun toggle_pause(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
    ) {
        platform.paused = !platform.paused;
        
        event::emit(PlatformPaused {
            platform_id: object::id(platform),
            paused: platform.paused,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun set_pause(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        paused: bool,
        clock: &Clock,
    ) {
        platform.paused = paused;

        event::emit(PlatformPaused {
            platform_id: object::id(platform),
            paused,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun set_oracle_public_key(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        new_public_key: vector<u8>,
        clock: &Clock,
    ) {
        assert!(vector::length(&new_public_key) == 32, EInvalidPublicKey);
        platform.oracle_public_key = new_public_key;

        event::emit(OracleKeyUpdated {
            platform_id: object::id(platform),
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun update_bet_expiry(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        new_expiry_ms: u64,
    ) {
        platform.bet_expiry_ms = new_expiry_ms;
    }

    public entry fun mint_oracle_cap(
        _admin_cap: &AdminCap,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let oracle_cap = OracleCap {
            id: object::new(ctx),
        };
        
        event::emit(OracleCapMinted {
            oracle_cap_id: object::id(&oracle_cap),
            recipient,
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(oracle_cap, recipient);
    }

    public entry fun revoke_oracle_cap(
        _admin_cap: &AdminCap,
        oracle_cap: OracleCap,
        clock: &Clock,
    ) {
        let oracle_cap_id = object::id(&oracle_cap);
        let OracleCap { id } = oracle_cap;
        object::delete(id);

        event::emit(OracleCapRevoked {
            oracle_cap_id,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public fun get_bet_info(bet: &Bet): (address, u64, u64, u64, u8, u8) {
        (bet.bettor, bet.stake, bet.odds, bet.potential_payout, bet.status, bet.coin_type)
    }

    public fun get_platform_stats(platform: &BettingPlatform): (u64, u64, u64, u64, u64, u64, u64, u64, bool) {
        (
            balance::value(&platform.treasury_sui),
            balance::value(&platform.treasury_sbets),
            platform.total_bets,
            platform.total_volume_sui,
            platform.total_volume_sbets,
            platform.total_potential_liability_sui,
            platform.total_potential_liability_sbets,
            platform.platform_fee_bps,
            platform.paused
        )
    }

    public fun get_accrued_fees(platform: &BettingPlatform): (u64, u64) {
        (platform.accrued_fees_sui, platform.accrued_fees_sbets)
    }

    public fun get_bet_limits_sui(platform: &BettingPlatform): (u64, u64) {
        (platform.min_bet_sui, platform.max_bet_sui)
    }

    public fun get_bet_limits_sbets(platform: &BettingPlatform): (u64, u64) {
        (platform.min_bet_sbets, platform.max_bet_sbets)
    }

    public fun get_bet_prediction(bet: &Bet): vector<u8> {
        bet.prediction
    }

    public fun get_bet_event_id(bet: &Bet): vector<u8> {
        bet.event_id
    }

    public fun get_bet_market_id(bet: &Bet): vector<u8> {
        bet.market_id
    }

    public fun get_bet_deadline(bet: &Bet): u64 {
        bet.deadline
    }

    public entry fun admin_reset_liability_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        new_liability: u64,
    ) {
        platform.total_potential_liability_sbets = new_liability;
    }

    public entry fun admin_reset_liability_sui(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        new_liability: u64,
    ) {
        platform.total_potential_liability_sui = new_liability;
    }

    public entry fun receive_sbets_coins(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        coin_to_receive: Receiving<Coin<SBETS>>,
        ctx: &mut TxContext
    ) {
        let coin = transfer::public_receive(&mut platform.id, coin_to_receive);
        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

    public entry fun receive_sui_coins(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        coin_to_receive: Receiving<Coin<SUI>>,
        ctx: &mut TxContext
    ) {
        let coin = transfer::public_receive(&mut platform.id, coin_to_receive);
        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

    fun is_signer(guard: &MultisigGuard, addr: address): bool {
        let len = vector::length(&guard.signers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(&guard.signers, i) == addr) {
                return true
            };
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

    public entry fun create_multisig_guard(
        _admin_cap: &AdminCap,
        platform: &BettingPlatform,
        signers: vector<address>,
        threshold: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let num_signers = vector::length(&signers);
        assert!(threshold > 0 && threshold <= num_signers, EInvalidThreshold);
        assert!(num_signers >= 2, EInvalidThreshold);
        validate_unique_signers(&signers);

        let guard = MultisigGuard {
            id: object::new(ctx),
            signers,
            threshold,
            platform_id: object::id(platform),
        };

        event::emit(MultisigGuardCreated {
            guard_id: object::id(&guard),
            platform_id: object::id(platform),
            threshold,
            num_signers,
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::share_object(guard);
    }

    public entry fun lock_direct_withdrawals(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
    ) {
        if (!dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {})) {
            dynamic_field::add(&mut platform.id, WithdrawalLockKey {}, true);
        };

        event::emit(DirectWithdrawalsLocked {
            platform_id: object::id(platform),
            locked: true,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun unlock_direct_withdrawals(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
    ) {
        if (dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {})) {
            dynamic_field::remove<WithdrawalLockKey, bool>(&mut platform.id, WithdrawalLockKey {});
        };

        event::emit(DirectWithdrawalsLocked {
            platform_id: object::id(platform),
            locked: false,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun propose_withdrawal(
        guard: &MultisigGuard,
        amount: u64,
        coin_type: u8,
        withdrawal_type: u8,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(is_signer(guard, sender), ENotASigner);
        assert!(coin_type == COIN_TYPE_SUI || coin_type == COIN_TYPE_SBETS, EInvalidAmount);
        assert!(withdrawal_type == WITHDRAWAL_TYPE_FEES || withdrawal_type == WITHDRAWAL_TYPE_TREASURY, EInvalidAmount);
        assert!(amount > 0, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        let mut approvals = vector::empty<address>();
        vector::push_back(&mut approvals, sender);

        let proposal = WithdrawalProposal {
            id: object::new(ctx),
            proposer: sender,
            amount,
            coin_type,
            withdrawal_type,
            recipient,
            approvals,
            executed: false,
            created_at: now,
            expires_at: now + PROPOSAL_EXPIRY_MS,
            guard_id: object::id(guard),
            platform_id: guard.platform_id,
        };

        event::emit(WithdrawalProposed {
            proposal_id: object::id(&proposal),
            proposer: sender,
            amount,
            coin_type,
            withdrawal_type,
            recipient,
            timestamp: now,
        });

        transfer::share_object(proposal);
    }

    public entry fun approve_withdrawal(
        guard: &MultisigGuard,
        proposal: &mut WithdrawalProposal,
        clock: &Clock,
        ctx: &mut TxContext
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
            proposal_id: object::id(proposal),
            approver: sender,
            approval_count: vector::length(&proposal.approvals),
            threshold: guard.threshold,
            timestamp: now,
        });
    }

    public entry fun execute_withdrawal_fees_sui(
        guard: &MultisigGuard,
        proposal: &mut WithdrawalProposal,
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);
        assert!(proposal.platform_id == object::id(platform), EUnauthorized);
        assert!(guard.platform_id == object::id(platform), EUnauthorized);
        assert!(proposal.coin_type == COIN_TYPE_SUI, EInvalidAmount);
        assert!(proposal.withdrawal_type == WITHDRAWAL_TYPE_FEES, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);
        assert!(count_valid_approvals(guard, &proposal.approvals) >= guard.threshold, EInsufficientApprovals);

        let amount = proposal.amount;
        assert!(amount <= platform.accrued_fees_sui, EInsufficientBalance);
        assert!(balance::value(&platform.treasury_sui) >= amount, EInsufficientTreasury);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SUI, EWithdrawalTooLarge);

        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;

        proposal.executed = true;

        let fees_balance = balance::split(&mut platform.treasury_sui, amount);
        let fees_coin = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, proposal.recipient);

        platform.accrued_fees_sui = platform.accrued_fees_sui - amount;

        event::emit(MultisigWithdrawalExecuted {
            proposal_id: object::id(proposal),
            amount,
            coin_type: COIN_TYPE_SUI,
            withdrawal_type: WITHDRAWAL_TYPE_FEES,
            recipient: proposal.recipient,
            approval_count: vector::length(&proposal.approvals),
            timestamp: now,
        });
    }

    public entry fun execute_withdrawal_fees_sbets(
        guard: &MultisigGuard,
        proposal: &mut WithdrawalProposal,
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);
        assert!(proposal.platform_id == object::id(platform), EUnauthorized);
        assert!(guard.platform_id == object::id(platform), EUnauthorized);
        assert!(proposal.coin_type == COIN_TYPE_SBETS, EInvalidAmount);
        assert!(proposal.withdrawal_type == WITHDRAWAL_TYPE_FEES, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);
        assert!(count_valid_approvals(guard, &proposal.approvals) >= guard.threshold, EInsufficientApprovals);

        let amount = proposal.amount;
        assert!(amount <= platform.accrued_fees_sbets, EInsufficientBalance);
        assert!(balance::value(&platform.treasury_sbets) >= amount, EInsufficientTreasury);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SBETS, EWithdrawalTooLarge);

        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;

        proposal.executed = true;

        let fees_balance = balance::split(&mut platform.treasury_sbets, amount);
        let fees_coin = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, proposal.recipient);

        platform.accrued_fees_sbets = platform.accrued_fees_sbets - amount;

        event::emit(MultisigWithdrawalExecuted {
            proposal_id: object::id(proposal),
            amount,
            coin_type: COIN_TYPE_SBETS,
            withdrawal_type: WITHDRAWAL_TYPE_FEES,
            recipient: proposal.recipient,
            approval_count: vector::length(&proposal.approvals),
            timestamp: now,
        });
    }

    public entry fun execute_withdrawal_treasury_sui(
        guard: &MultisigGuard,
        proposal: &mut WithdrawalProposal,
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);
        assert!(proposal.platform_id == object::id(platform), EUnauthorized);
        assert!(guard.platform_id == object::id(platform), EUnauthorized);
        assert!(proposal.coin_type == COIN_TYPE_SUI, EInvalidAmount);
        assert!(proposal.withdrawal_type == WITHDRAWAL_TYPE_TREASURY, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);
        assert!(count_valid_approvals(guard, &proposal.approvals) >= guard.threshold, EInsufficientApprovals);

        let amount = proposal.amount;
        assert!(balance::value(&platform.treasury_sui) >= amount, EInsufficientTreasury);
        assert!(balance::value(&platform.treasury_sui) - amount >= platform.total_potential_liability_sui, EInsufficientBalance);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SUI, EWithdrawalTooLarge);

        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;

        proposal.executed = true;

        let treasury_balance = balance::split(&mut platform.treasury_sui, amount);
        let treasury_coin = coin::from_balance(treasury_balance, ctx);
        transfer::public_transfer(treasury_coin, proposal.recipient);

        event::emit(MultisigWithdrawalExecuted {
            proposal_id: object::id(proposal),
            amount,
            coin_type: COIN_TYPE_SUI,
            withdrawal_type: WITHDRAWAL_TYPE_TREASURY,
            recipient: proposal.recipient,
            approval_count: vector::length(&proposal.approvals),
            timestamp: now,
        });
    }

    public entry fun execute_withdrawal_treasury_sbets(
        guard: &MultisigGuard,
        proposal: &mut WithdrawalProposal,
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!proposal.executed, EProposalAlreadyExecuted);
        assert!(proposal.guard_id == object::id(guard), EUnauthorized);
        assert!(proposal.platform_id == object::id(platform), EUnauthorized);
        assert!(guard.platform_id == object::id(platform), EUnauthorized);
        assert!(proposal.coin_type == COIN_TYPE_SBETS, EInvalidAmount);
        assert!(proposal.withdrawal_type == WITHDRAWAL_TYPE_TREASURY, EInvalidAmount);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.expires_at, EProposalExpired);
        assert!(count_valid_approvals(guard, &proposal.approvals) >= guard.threshold, EInsufficientApprovals);

        let amount = proposal.amount;
        assert!(balance::value(&platform.treasury_sbets) >= amount, EInsufficientTreasury);
        assert!(balance::value(&platform.treasury_sbets) - amount >= platform.total_potential_liability_sbets, EInsufficientBalance);
        assert!(amount <= MAX_SINGLE_WITHDRAWAL_SBETS, EWithdrawalTooLarge);

        assert!(now >= platform.last_withdrawal_at + WITHDRAWAL_COOLDOWN_MS, EWithdrawalTooLarge);
        platform.last_withdrawal_at = now;

        proposal.executed = true;

        let treasury_balance = balance::split(&mut platform.treasury_sbets, amount);
        let treasury_coin = coin::from_balance(treasury_balance, ctx);
        transfer::public_transfer(treasury_coin, proposal.recipient);

        event::emit(MultisigWithdrawalExecuted {
            proposal_id: object::id(proposal),
            amount,
            coin_type: COIN_TYPE_SBETS,
            withdrawal_type: WITHDRAWAL_TYPE_TREASURY,
            recipient: proposal.recipient,
            approval_count: vector::length(&proposal.approvals),
            timestamp: now,
        });
    }

    public entry fun update_multisig_signers(
        _admin_cap: &AdminCap,
        guard: &mut MultisigGuard,
        new_signers: vector<address>,
        new_threshold: u64,
    ) {
        let num_signers = vector::length(&new_signers);
        assert!(new_threshold > 0 && new_threshold <= num_signers, EInvalidThreshold);
        assert!(num_signers >= 2, EInvalidThreshold);
        validate_unique_signers(&new_signers);

        guard.signers = new_signers;
        guard.threshold = new_threshold;
    }

    public fun get_multisig_info(guard: &MultisigGuard): (vector<address>, u64, ID) {
        (guard.signers, guard.threshold, guard.platform_id)
    }

    public fun get_proposal_info(proposal: &WithdrawalProposal): (address, u64, u8, u8, address, u64, bool, u64, u64) {
        (
            proposal.proposer,
            proposal.amount,
            proposal.coin_type,
            proposal.withdrawal_type,
            proposal.recipient,
            vector::length(&proposal.approvals),
            proposal.executed,
            proposal.created_at,
            proposal.expires_at
        )
    }

    public fun is_withdrawal_locked(platform: &BettingPlatform): bool {
        dynamic_field::exists_<WithdrawalLockKey>(&platform.id, WithdrawalLockKey {})
    }
}
