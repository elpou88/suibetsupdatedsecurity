module prediction_market::prediction_market {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::vec_set::{Self, VecSet};

    const E_NOT_ADMIN: u64 = 0;
    const E_MARKET_NOT_ACTIVE: u64 = 1;
    const E_MARKET_EXPIRED: u64 = 2;
    const E_INSUFFICIENT_AMOUNT: u64 = 4;
    const E_NO_SHARES: u64 = 5;
    const E_MARKET_NOT_RESOLVED: u64 = 6;
    const E_ALREADY_CLAIMED: u64 = 7;
    const E_INVALID_OUTCOME: u64 = 8;
    const E_MARKET_PAUSED: u64 = 9;
    const E_AMOUNT_TOO_LARGE: u64 = 10;
    const E_SLIPPAGE_EXCEEDED: u64 = 11;
    const E_WRONG_MARKET: u64 = 12;
    const E_ZERO_SHARES: u64 = 13;
    const E_NOT_AUTHORIZED_SIGNER: u64 = 14;
    const E_ALREADY_APPROVED: u64 = 15;
    const E_INSUFFICIENT_APPROVALS: u64 = 16;
    const E_ALREADY_EXECUTED: u64 = 17;
    const E_PROPOSAL_EXPIRED: u64 = 18;
    const E_NOT_CANCELLED: u64 = 19;
    const E_OVERFLOW: u64 = 21;
    const E_PLATFORM_PAUSED: u64 = 22;
    const E_TREASURY_INSUFFICIENT: u64 = 23;
    const E_POSITION_HAS_SHARES: u64 = 24;

    const STATUS_ACTIVE: u8 = 0;
    const STATUS_PAUSED: u8 = 1;
    const STATUS_RESOLVED_YES: u8 = 2;
    const STATUS_RESOLVED_NO: u8 = 3;
    const STATUS_CANCELLED: u8 = 4;

    const SIDE_YES: u8 = 0;
    const SIDE_NO: u8 = 1;

    const DEFAULT_FEE_BPS: u64 = 200;
    const MAX_FEE_BPS: u64 = 500;
    const MIN_LIQUIDITY: u64 = 100;
    const PROPOSAL_TTL_MS: u64 = 172_800_000;
    const PRICE_PRECISION: u64 = 10000;

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct PlatformConfig has key {
        id: UID,
        admin: address,
        default_fee_bps: u64,
        default_max_bet: u64,
        paused: bool,
        total_markets_created: u64,
        authorized_signers: vector<address>,
        required_approvals: u64,
    }

    public struct Market<phantom T> has key {
        id: UID,
        title: vector<u8>,
        description: vector<u8>,
        category: vector<u8>,
        creator: address,
        created_at: u64,
        end_time: u64,
        status: u8,
        yes_reserve: u64,
        no_reserve: u64,
        initial_liquidity: u64,
        treasury: Balance<T>,
        collected_fees: Balance<T>,
        fee_bps: u64,
        total_yes_shares: u64,
        total_no_shares: u64,
        total_volume: u64,
        participant_count: u64,
        resolved_outcome: u8,
        resolution_time: u64,
        max_bet: u64,
    }

    public struct Position<phantom T> has key, store {
        id: UID,
        market_id: ID,
        yes_shares: u64,
        no_shares: u64,
        total_invested: u64,
        claimed: bool,
    }

    public struct ResolutionProposal has key {
        id: UID,
        market_id: ID,
        proposed_outcome: u8,
        proposer: address,
        approvals: VecSet<address>,
        required_approvals: u64,
        created_at: u64,
        executed: bool,
    }

    public struct MarketCreated has copy, drop {
        market_id: ID,
        title: vector<u8>,
        category: vector<u8>,
        end_time: u64,
        initial_liquidity: u64,
        fee_bps: u64,
    }

    public struct SharesPurchased has copy, drop {
        market_id: ID,
        buyer: address,
        side: u8,
        amount_paid: u64,
        shares_received: u64,
        fee_paid: u64,
        yes_price_after: u64,
        no_price_after: u64,
    }

    public struct SharesSold has copy, drop {
        market_id: ID,
        seller: address,
        side: u8,
        shares_sold: u64,
        amount_received: u64,
        fee_paid: u64,
        yes_price_after: u64,
        no_price_after: u64,
    }

    public struct MarketResolved has copy, drop {
        market_id: ID,
        outcome: u8,
        resolution_time: u64,
        treasury_value: u64,
        total_winning_shares: u64,
    }

    public struct WinningsClaimed has copy, drop {
        market_id: ID,
        claimer: address,
        winning_shares: u64,
        payout: u64,
    }

    public struct MarketCancelled has copy, drop {
        market_id: ID,
        refund_pool: u64,
    }

    public struct RefundClaimed has copy, drop {
        market_id: ID,
        claimer: address,
        refund: u64,
    }

    public struct ResolutionProposed has copy, drop {
        proposal_id: ID,
        market_id: ID,
        proposed_outcome: u8,
        proposer: address,
    }

    public struct ResolutionApproved has copy, drop {
        proposal_id: ID,
        approver: address,
        total_approvals: u64,
    }

    public struct LiquidityAdded has copy, drop {
        market_id: ID,
        amount: u64,
        provider: address,
    }

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        let config = PlatformConfig {
            id: object::new(ctx),
            admin: ctx.sender(),
            default_fee_bps: DEFAULT_FEE_BPS,
            default_max_bet: 10_000_000_000_000,
            paused: false,
            total_markets_created: 0,
            authorized_signers: vector[ctx.sender()],
            required_approvals: 1,
        };
        transfer::transfer(admin_cap, ctx.sender());
        transfer::share_object(config);
    }

    public entry fun create_market<T>(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        title: vector<u8>,
        description: vector<u8>,
        category: vector<u8>,
        end_time: u64,
        initial_liquidity: u64,
        fee_bps: u64,
        max_bet: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!config.paused, E_PLATFORM_PAUSED);
        let now = clock::timestamp_ms(clock);
        assert!(end_time > now, E_MARKET_EXPIRED);
        assert!(fee_bps <= MAX_FEE_BPS, E_INVALID_OUTCOME);
        assert!(initial_liquidity >= MIN_LIQUIDITY, E_INSUFFICIENT_AMOUNT);

        let market = Market<T> {
            id: object::new(ctx),
            title,
            description,
            category,
            creator: ctx.sender(),
            created_at: now,
            end_time,
            status: STATUS_ACTIVE,
            yes_reserve: initial_liquidity,
            no_reserve: initial_liquidity,
            initial_liquidity,
            treasury: balance::zero<T>(),
            collected_fees: balance::zero<T>(),
            fee_bps,
            total_yes_shares: 0,
            total_no_shares: 0,
            total_volume: 0,
            participant_count: 0,
            resolved_outcome: 0,
            resolution_time: 0,
            max_bet,
        };

        config.total_markets_created = config.total_markets_created + 1;

        event::emit(MarketCreated {
            market_id: object::id(&market),
            title: market.title,
            category: market.category,
            end_time,
            initial_liquidity,
            fee_bps,
        });

        transfer::share_object(market);
    }

    public entry fun create_market_funded<T>(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        title: vector<u8>,
        description: vector<u8>,
        category: vector<u8>,
        end_time: u64,
        initial_liquidity: u64,
        fee_bps: u64,
        max_bet: u64,
        funding: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!config.paused, E_PLATFORM_PAUSED);
        let now = clock::timestamp_ms(clock);
        assert!(end_time > now, E_MARKET_EXPIRED);
        assert!(fee_bps <= MAX_FEE_BPS, E_INVALID_OUTCOME);
        assert!(initial_liquidity >= MIN_LIQUIDITY, E_INSUFFICIENT_AMOUNT);

        let market = Market<T> {
            id: object::new(ctx),
            title,
            description,
            category,
            creator: ctx.sender(),
            created_at: now,
            end_time,
            status: STATUS_ACTIVE,
            yes_reserve: initial_liquidity,
            no_reserve: initial_liquidity,
            initial_liquidity,
            treasury: coin::into_balance(funding),
            collected_fees: balance::zero<T>(),
            fee_bps,
            total_yes_shares: 0,
            total_no_shares: 0,
            total_volume: 0,
            participant_count: 0,
            resolved_outcome: 0,
            resolution_time: 0,
            max_bet,
        };

        config.total_markets_created = config.total_markets_created + 1;

        event::emit(MarketCreated {
            market_id: object::id(&market),
            title: market.title,
            category: market.category,
            end_time,
            initial_liquidity,
            fee_bps,
        });

        transfer::share_object(market);
    }

    public entry fun buy_shares<T>(
        market: &mut Market<T>,
        config: &PlatformConfig,
        payment: Coin<T>,
        side: u8,
        min_shares_out: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!config.paused, E_PLATFORM_PAUSED);
        assert!(market.status == STATUS_ACTIVE, E_MARKET_NOT_ACTIVE);
        let now = clock::timestamp_ms(clock);
        assert!(now < market.end_time, E_MARKET_EXPIRED);
        assert!(side == SIDE_YES || side == SIDE_NO, E_INVALID_OUTCOME);

        let amount = coin::value(&payment);
        assert!(amount > 0, E_INSUFFICIENT_AMOUNT);
        assert!(amount <= market.max_bet, E_AMOUNT_TOO_LARGE);

        let fee = (amount * market.fee_bps) / 10000;
        let net_amount = amount - fee;

        let shares_out = if (side == SIDE_YES) {
            cpmm_buy(market.yes_reserve, market.no_reserve, net_amount)
        } else {
            cpmm_buy(market.no_reserve, market.yes_reserve, net_amount)
        };

        assert!(shares_out >= min_shares_out, E_SLIPPAGE_EXCEEDED);
        assert!(shares_out > 0, E_ZERO_SHARES);

        if (side == SIDE_YES) {
            market.no_reserve = market.no_reserve + net_amount;
            assert!(market.yes_reserve >= shares_out, E_OVERFLOW);
            market.yes_reserve = market.yes_reserve - shares_out;
            market.total_yes_shares = market.total_yes_shares + shares_out;
        } else {
            market.yes_reserve = market.yes_reserve + net_amount;
            assert!(market.no_reserve >= shares_out, E_OVERFLOW);
            market.no_reserve = market.no_reserve - shares_out;
            market.total_no_shares = market.total_no_shares + shares_out;
        };

        market.total_volume = market.total_volume + amount;
        market.participant_count = market.participant_count + 1;

        let mut payment_balance = coin::into_balance(payment);
        if (fee > 0) {
            let fee_balance = balance::split(&mut payment_balance, fee);
            balance::join(&mut market.collected_fees, fee_balance);
        };
        balance::join(&mut market.treasury, payment_balance);

        let (yes_price, no_price) = get_prices_internal(market.yes_reserve, market.no_reserve);

        event::emit(SharesPurchased {
            market_id: object::id(market),
            buyer: ctx.sender(),
            side,
            amount_paid: amount,
            shares_received: shares_out,
            fee_paid: fee,
            yes_price_after: yes_price,
            no_price_after: no_price,
        });

        let position = Position<T> {
            id: object::new(ctx),
            market_id: object::id(market),
            yes_shares: if (side == SIDE_YES) { shares_out } else { 0 },
            no_shares: if (side == SIDE_NO) { shares_out } else { 0 },
            total_invested: amount,
            claimed: false,
        };

        transfer::transfer(position, ctx.sender());
    }

    public entry fun sell_shares<T>(
        market: &mut Market<T>,
        config: &PlatformConfig,
        position: &mut Position<T>,
        side: u8,
        shares_to_sell: u64,
        min_payout: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!config.paused, E_PLATFORM_PAUSED);
        assert!(market.status == STATUS_ACTIVE, E_MARKET_NOT_ACTIVE);
        let now = clock::timestamp_ms(clock);
        assert!(now < market.end_time, E_MARKET_EXPIRED);
        assert!(position.market_id == object::id(market), E_WRONG_MARKET);
        assert!(side == SIDE_YES || side == SIDE_NO, E_INVALID_OUTCOME);

        let available = if (side == SIDE_YES) { position.yes_shares } else { position.no_shares };
        assert!(shares_to_sell > 0 && shares_to_sell <= available, E_NO_SHARES);

        let gross_payout = if (side == SIDE_YES) {
            cpmm_sell(market.yes_reserve, market.no_reserve, shares_to_sell)
        } else {
            cpmm_sell(market.no_reserve, market.yes_reserve, shares_to_sell)
        };

        let fee = (gross_payout * market.fee_bps) / 10000;
        let net_payout = gross_payout - fee;

        assert!(net_payout >= min_payout, E_SLIPPAGE_EXCEEDED);
        let treasury_val = balance::value(&market.treasury);
        assert!(net_payout <= treasury_val, E_TREASURY_INSUFFICIENT);

        if (side == SIDE_YES) {
            market.yes_reserve = market.yes_reserve + shares_to_sell;
            market.no_reserve = market.no_reserve - gross_payout;
            position.yes_shares = position.yes_shares - shares_to_sell;
            market.total_yes_shares = market.total_yes_shares - shares_to_sell;
        } else {
            market.no_reserve = market.no_reserve + shares_to_sell;
            market.yes_reserve = market.yes_reserve - gross_payout;
            position.no_shares = position.no_shares - shares_to_sell;
            market.total_no_shares = market.total_no_shares - shares_to_sell;
        };

        if (available > 0) {
            let reduction = ((position.total_invested as u128) * (shares_to_sell as u128) / (available as u128)) as u64;
            if (reduction <= position.total_invested) {
                position.total_invested = position.total_invested - reduction;
            };
        };

        if (fee > 0) {
            let fee_balance = balance::split(&mut market.treasury, fee);
            balance::join(&mut market.collected_fees, fee_balance);
        };

        let payout_coin = coin::from_balance(
            balance::split(&mut market.treasury, net_payout),
            ctx,
        );

        let (yes_price, no_price) = get_prices_internal(market.yes_reserve, market.no_reserve);

        event::emit(SharesSold {
            market_id: object::id(market),
            seller: ctx.sender(),
            side,
            shares_sold: shares_to_sell,
            amount_received: net_payout,
            fee_paid: fee,
            yes_price_after: yes_price,
            no_price_after: no_price,
        });

        transfer::public_transfer(payout_coin, ctx.sender());
    }

    public entry fun claim_winnings<T>(
        market: &mut Market<T>,
        position: &mut Position<T>,
        ctx: &mut TxContext,
    ) {
        assert!(
            market.status == STATUS_RESOLVED_YES || market.status == STATUS_RESOLVED_NO,
            E_MARKET_NOT_RESOLVED
        );
        assert!(position.market_id == object::id(market), E_WRONG_MARKET);
        assert!(!position.claimed, E_ALREADY_CLAIMED);

        let winning_shares = if (market.resolved_outcome == STATUS_RESOLVED_YES) {
            position.yes_shares
        } else {
            position.no_shares
        };

        assert!(winning_shares > 0, E_NO_SHARES);

        let total_winning = if (market.resolved_outcome == STATUS_RESOLVED_YES) {
            market.total_yes_shares
        } else {
            market.total_no_shares
        };

        let treasury_value = balance::value(&market.treasury);
        assert!(total_winning > 0, E_NO_SHARES);

        let payout = ((treasury_value as u128) * (winning_shares as u128) / (total_winning as u128)) as u64;
        assert!(payout > 0, E_NO_SHARES);
        assert!(payout <= treasury_value, E_OVERFLOW);

        position.claimed = true;

        if (market.resolved_outcome == STATUS_RESOLVED_YES) {
            market.total_yes_shares = market.total_yes_shares - winning_shares;
        } else {
            market.total_no_shares = market.total_no_shares - winning_shares;
        };

        let payout_coin = coin::from_balance(
            balance::split(&mut market.treasury, payout),
            ctx,
        );

        event::emit(WinningsClaimed {
            market_id: object::id(market),
            claimer: ctx.sender(),
            winning_shares,
            payout,
        });

        transfer::public_transfer(payout_coin, ctx.sender());
    }

    public entry fun claim_refund<T>(
        market: &mut Market<T>,
        position: &mut Position<T>,
        ctx: &mut TxContext,
    ) {
        assert!(market.status == STATUS_CANCELLED, E_NOT_CANCELLED);
        assert!(position.market_id == object::id(market), E_WRONG_MARKET);
        assert!(!position.claimed, E_ALREADY_CLAIMED);

        let my_shares = position.yes_shares + position.no_shares;
        assert!(my_shares > 0, E_NO_SHARES);

        let total_shares = market.total_yes_shares + market.total_no_shares;
        let treasury_value = balance::value(&market.treasury);
        assert!(total_shares > 0, E_NO_SHARES);

        let mut refund = ((treasury_value as u128) * (my_shares as u128) / (total_shares as u128)) as u64;
        if (refund > treasury_value) {
            refund = treasury_value;
        };
        assert!(refund > 0, E_INSUFFICIENT_AMOUNT);

        position.claimed = true;
        market.total_yes_shares = market.total_yes_shares - position.yes_shares;
        market.total_no_shares = market.total_no_shares - position.no_shares;

        let refund_coin = coin::from_balance(
            balance::split(&mut market.treasury, refund),
            ctx,
        );

        event::emit(RefundClaimed {
            market_id: object::id(market),
            claimer: ctx.sender(),
            refund,
        });

        transfer::public_transfer(refund_coin, ctx.sender());
    }

    public entry fun merge_positions<T>(
        pos_a: &mut Position<T>,
        pos_b: Position<T>,
    ) {
        assert!(pos_a.market_id == pos_b.market_id, E_WRONG_MARKET);
        assert!(!pos_a.claimed && !pos_b.claimed, E_ALREADY_CLAIMED);

        pos_a.yes_shares = pos_a.yes_shares + pos_b.yes_shares;
        pos_a.no_shares = pos_a.no_shares + pos_b.no_shares;
        pos_a.total_invested = pos_a.total_invested + pos_b.total_invested;

        let Position { id, market_id: _, yes_shares: _, no_shares: _, total_invested: _, claimed: _ } = pos_b;
        object::delete(id);
    }

    public entry fun burn_position<T>(
        position: Position<T>,
    ) {
        assert!(position.yes_shares == 0 && position.no_shares == 0, E_POSITION_HAS_SHARES);

        let Position { id, market_id: _, yes_shares: _, no_shares: _, total_invested: _, claimed: _ } = position;
        object::delete(id);
    }

    public entry fun propose_resolution(
        config: &PlatformConfig,
        market_id: ID,
        outcome: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(outcome == STATUS_RESOLVED_YES || outcome == STATUS_RESOLVED_NO, E_INVALID_OUTCOME);
        let sender = ctx.sender();
        assert!(is_authorized_signer(config, sender), E_NOT_AUTHORIZED_SIGNER);

        let now = clock::timestamp_ms(clock);
        let mut approvals = vec_set::empty<address>();
        vec_set::insert(&mut approvals, sender);

        let proposal = ResolutionProposal {
            id: object::new(ctx),
            market_id,
            proposed_outcome: outcome,
            proposer: sender,
            approvals,
            required_approvals: config.required_approvals,
            created_at: now,
            executed: false,
        };

        event::emit(ResolutionProposed {
            proposal_id: object::id(&proposal),
            market_id,
            proposed_outcome: outcome,
            proposer: sender,
        });

        transfer::share_object(proposal);
    }

    public entry fun approve_resolution(
        config: &PlatformConfig,
        proposal: &mut ResolutionProposal,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(is_authorized_signer(config, sender), E_NOT_AUTHORIZED_SIGNER);
        assert!(!proposal.executed, E_ALREADY_EXECUTED);

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.created_at + PROPOSAL_TTL_MS, E_PROPOSAL_EXPIRED);
        assert!(!vec_set::contains(&proposal.approvals, &sender), E_ALREADY_APPROVED);

        vec_set::insert(&mut proposal.approvals, sender);

        event::emit(ResolutionApproved {
            proposal_id: object::id(proposal),
            approver: sender,
            total_approvals: vec_set::size(&proposal.approvals),
        });
    }

    public entry fun execute_resolution<T>(
        proposal: &mut ResolutionProposal,
        market: &mut Market<T>,
        clock: &Clock,
    ) {
        assert!(!proposal.executed, E_ALREADY_EXECUTED);
        assert!(
            vec_set::size(&proposal.approvals) >= proposal.required_approvals,
            E_INSUFFICIENT_APPROVALS
        );
        assert!(proposal.market_id == object::id(market), E_WRONG_MARKET);
        assert!(
            market.status == STATUS_ACTIVE || market.status == STATUS_PAUSED,
            E_MARKET_NOT_ACTIVE
        );

        let now = clock::timestamp_ms(clock);
        assert!(now <= proposal.created_at + PROPOSAL_TTL_MS, E_PROPOSAL_EXPIRED);

        market.status = proposal.proposed_outcome;
        market.resolved_outcome = proposal.proposed_outcome;
        market.resolution_time = now;
        proposal.executed = true;

        let total_winning = if (proposal.proposed_outcome == STATUS_RESOLVED_YES) {
            market.total_yes_shares
        } else {
            market.total_no_shares
        };

        event::emit(MarketResolved {
            market_id: object::id(market),
            outcome: proposal.proposed_outcome,
            resolution_time: now,
            treasury_value: balance::value(&market.treasury),
            total_winning_shares: total_winning,
        });
    }

    public entry fun resolve_market_direct<T>(
        _admin: &AdminCap,
        config: &PlatformConfig,
        market: &mut Market<T>,
        outcome: u8,
        clock: &Clock,
    ) {
        assert!(config.required_approvals <= 1, E_INSUFFICIENT_APPROVALS);
        assert!(outcome == STATUS_RESOLVED_YES || outcome == STATUS_RESOLVED_NO, E_INVALID_OUTCOME);
        assert!(
            market.status == STATUS_ACTIVE || market.status == STATUS_PAUSED,
            E_MARKET_NOT_ACTIVE
        );

        let now = clock::timestamp_ms(clock);
        market.status = outcome;
        market.resolved_outcome = outcome;
        market.resolution_time = now;

        let total_winning = if (outcome == STATUS_RESOLVED_YES) {
            market.total_yes_shares
        } else {
            market.total_no_shares
        };

        event::emit(MarketResolved {
            market_id: object::id(market),
            outcome,
            resolution_time: now,
            treasury_value: balance::value(&market.treasury),
            total_winning_shares: total_winning,
        });
    }

    public entry fun cancel_market<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
    ) {
        assert!(
            market.status == STATUS_ACTIVE || market.status == STATUS_PAUSED,
            E_MARKET_NOT_ACTIVE
        );

        market.status = STATUS_CANCELLED;

        event::emit(MarketCancelled {
            market_id: object::id(market),
            refund_pool: balance::value(&market.treasury),
        });
    }

    public entry fun set_platform_pause(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        paused: bool,
    ) {
        config.paused = paused;
    }

    public entry fun set_market_pause<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
        paused: bool,
    ) {
        if (paused) {
            assert!(market.status == STATUS_ACTIVE, E_MARKET_NOT_ACTIVE);
            market.status = STATUS_PAUSED;
        } else {
            assert!(market.status == STATUS_PAUSED, E_MARKET_NOT_ACTIVE);
            market.status = STATUS_ACTIVE;
        };
    }

    public entry fun set_default_fee(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        new_fee: u64,
    ) {
        assert!(new_fee <= MAX_FEE_BPS, E_INVALID_OUTCOME);
        config.default_fee_bps = new_fee;
    }

    public entry fun set_default_max_bet(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        new_max: u64,
    ) {
        config.default_max_bet = new_max;
    }

    public entry fun set_market_fee<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
        new_fee: u64,
    ) {
        assert!(new_fee <= MAX_FEE_BPS, E_INVALID_OUTCOME);
        market.fee_bps = new_fee;
    }

    public entry fun set_market_max_bet<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
        new_max: u64,
    ) {
        market.max_bet = new_max;
    }

    public entry fun add_signer(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        new_signer: address,
    ) {
        let signers = &config.authorized_signers;
        let len = vector::length(signers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(signers, i) == new_signer) {
                return
            };
            i = i + 1;
        };
        vector::push_back(&mut config.authorized_signers, new_signer);
    }

    public entry fun remove_signer(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        signer_to_remove: address,
    ) {
        let signers = &mut config.authorized_signers;
        let len = vector::length(signers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(signers, i) == signer_to_remove) {
                vector::swap_remove(signers, i);
                return
            };
            i = i + 1;
        };
    }

    public entry fun set_required_approvals(
        _admin: &AdminCap,
        config: &mut PlatformConfig,
        required: u64,
    ) {
        assert!(required > 0, E_INVALID_OUTCOME);
        assert!(required <= vector::length(&config.authorized_signers), E_INVALID_OUTCOME);
        config.required_approvals = required;
    }

    public entry fun withdraw_fees<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
        ctx: &mut TxContext,
    ) {
        let fee_amount = balance::value(&market.collected_fees);
        assert!(fee_amount > 0, E_INSUFFICIENT_AMOUNT);

        let fee_coin = coin::from_balance(
            balance::split(&mut market.collected_fees, fee_amount),
            ctx,
        );
        transfer::public_transfer(fee_coin, ctx.sender());
    }

    public entry fun add_liquidity<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
        coin: Coin<T>,
        ctx: &mut TxContext,
    ) {
        assert!(market.status == STATUS_ACTIVE, E_MARKET_NOT_ACTIVE);
        let amount = coin::value(&coin);
        assert!(amount > 0, E_INSUFFICIENT_AMOUNT);

        let half = amount / 2;
        market.yes_reserve = market.yes_reserve + half;
        market.no_reserve = market.no_reserve + (amount - half);
        balance::join(&mut market.treasury, coin::into_balance(coin));

        event::emit(LiquidityAdded {
            market_id: object::id(market),
            amount,
            provider: ctx.sender(),
        });
    }

    public entry fun sweep_remaining<T>(
        _admin: &AdminCap,
        market: &mut Market<T>,
        ctx: &mut TxContext,
    ) {
        assert!(
            market.status == STATUS_RESOLVED_YES || market.status == STATUS_RESOLVED_NO,
            E_MARKET_NOT_RESOLVED
        );

        let winning_outstanding = if (market.resolved_outcome == STATUS_RESOLVED_YES) {
            market.total_yes_shares
        } else {
            market.total_no_shares
        };
        assert!(winning_outstanding == 0, E_POSITION_HAS_SHARES);

        let remaining = balance::value(&market.treasury);
        if (remaining > 0) {
            let remaining_coin = coin::from_balance(
                balance::split(&mut market.treasury, remaining),
                ctx,
            );
            transfer::public_transfer(remaining_coin, ctx.sender());
        };
    }

    fun cpmm_buy(target_reserve: u64, other_reserve: u64, amount: u64): u64 {
        let k = (target_reserve as u128) * (other_reserve as u128);
        let new_other = (other_reserve as u128) + (amount as u128);
        let new_target = k / new_other;
        let shares_out = (target_reserve as u128) - new_target;
        (shares_out as u64)
    }

    fun cpmm_sell(target_reserve: u64, other_reserve: u64, shares: u64): u64 {
        let k = (target_reserve as u128) * (other_reserve as u128);
        let new_target = (target_reserve as u128) + (shares as u128);
        let new_other = k / new_target;
        let payout = (other_reserve as u128) - new_other;
        (payout as u64)
    }

    fun get_prices_internal(yes_reserve: u64, no_reserve: u64): (u64, u64) {
        let total = (yes_reserve as u128) + (no_reserve as u128);
        if (total == 0) {
            return (5000, 5000)
        };
        let yes_price = ((no_reserve as u128) * (PRICE_PRECISION as u128) / total) as u64;
        let no_price = PRICE_PRECISION - yes_price;
        (yes_price, no_price)
    }

    fun is_authorized_signer(config: &PlatformConfig, addr: address): bool {
        let signers = &config.authorized_signers;
        let len = vector::length(signers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(signers, i) == addr) {
                return true
            };
            i = i + 1;
        };
        false
    }

    public fun get_yes_price<T>(market: &Market<T>): u64 {
        let (yes_price, _) = get_prices_internal(market.yes_reserve, market.no_reserve);
        yes_price
    }

    public fun get_no_price<T>(market: &Market<T>): u64 {
        let (_, no_price) = get_prices_internal(market.yes_reserve, market.no_reserve);
        no_price
    }

    public fun get_status<T>(market: &Market<T>): u8 {
        market.status
    }

    public fun get_treasury_value<T>(market: &Market<T>): u64 {
        balance::value(&market.treasury)
    }

    public fun get_fees_value<T>(market: &Market<T>): u64 {
        balance::value(&market.collected_fees)
    }

    public fun get_reserves<T>(market: &Market<T>): (u64, u64) {
        (market.yes_reserve, market.no_reserve)
    }

    public fun get_shares_outstanding<T>(market: &Market<T>): (u64, u64) {
        (market.total_yes_shares, market.total_no_shares)
    }

    public fun get_volume<T>(market: &Market<T>): u64 {
        market.total_volume
    }

    public fun get_position_info<T>(position: &Position<T>): (ID, u64, u64, u64, bool) {
        (position.market_id, position.yes_shares, position.no_shares, position.total_invested, position.claimed)
    }

    public fun get_market_end_time<T>(market: &Market<T>): u64 {
        market.end_time
    }

    public fun get_market_fee<T>(market: &Market<T>): u64 {
        market.fee_bps
    }

    public fun estimate_buy_shares<T>(market: &Market<T>, side: u8, amount: u64): u64 {
        let fee = (amount * market.fee_bps) / 10000;
        let net = amount - fee;
        if (side == SIDE_YES) {
            cpmm_buy(market.yes_reserve, market.no_reserve, net)
        } else {
            cpmm_buy(market.no_reserve, market.yes_reserve, net)
        }
    }

    public fun estimate_sell_payout<T>(market: &Market<T>, side: u8, shares: u64): u64 {
        let gross = if (side == SIDE_YES) {
            cpmm_sell(market.yes_reserve, market.no_reserve, shares)
        } else {
            cpmm_sell(market.no_reserve, market.yes_reserve, shares)
        };
        let fee = (gross * market.fee_bps) / 10000;
        gross - fee
    }
}
