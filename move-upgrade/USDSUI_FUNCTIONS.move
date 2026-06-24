// ============================================================
// ADD THESE TO YOUR betting.move FILE
// ============================================================
//
// 1. Add this use at the top of the module (with other uses):
//    use 0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI;
//    use sui::dynamic_field;
//
// 2. Add this constant (near other constants):
//    const COIN_TYPE_USDSUI: u8 = 2;
//    const USDSUI_TREASURY_KEY: vector<u8> = b"treasury_usdsui";
//    const USDSUI_VOLUME_KEY: vector<u8> = b"total_volume_usdsui";
//    const USDSUI_LIABILITY_KEY: vector<u8> = b"total_liability_usdsui";
//    const USDSUI_FEES_KEY: vector<u8> = b"accrued_fees_usdsui";
//    const MIN_BET_USDSUI: u64 = 1_000_000;      // 1 USDsui (6 decimals)
//    const MAX_BET_USDSUI: u64 = 10_000_000_000; // 10,000 USDsui
//
// 3. Add these three functions to the module body:

    public fun place_bet_usdsui(
        platform: &mut BettingPlatform,
        payment: Coin<USDSUI>,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds_bps: u64,
        quote_expiry: u64,
        oracle_signature: vector<u8>,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // === SAME CHECKS AS place_bet_sbets ===
        assert!(!platform.paused, EContractPaused);

        let stake = coin::value(&payment);
        assert!(stake >= MIN_BET_USDSUI, EBetTooSmall);
        assert!(stake <= MAX_BET_USDSUI, EBetTooLarge);

        // Oracle signature verification (same as place_bet_sbets)
        let now = clock::timestamp_ms(clock);
        assert!(now <= quote_expiry, EQuoteExpired);

        let mut msg = vector::empty<u8>();
        vector::append(&mut msg, event_id);
        vector::append(&mut msg, market_id);
        vector::append(&mut msg, prediction);
        let odds_bytes = bcs::to_bytes(&odds_bps);
        vector::append(&mut msg, odds_bytes);
        let expiry_bytes = bcs::to_bytes(&quote_expiry);
        vector::append(&mut msg, expiry_bytes);
        assert!(
            ed25519::ed25519_verify(&oracle_signature, &platform.oracle_public_key, &msg),
            EInvalidOracleSignature
        );

        // Fee and payout calculation (same as place_bet_sbets)
        let fee = (stake * platform.platform_fee_bps) / 10000;
        let net_stake = stake - fee;
        let potential_payout = (net_stake * odds_bps) / 10000;
        let deadline = now + platform.bet_expiry_ms;

        // Store USDsui in dynamic treasury field
        let balance_in = coin::into_balance(payment);
        if (dynamic_field::exists_(&platform.id, USDSUI_TREASURY_KEY)) {
            let treasury: &mut Balance<USDSUI> = dynamic_field::borrow_mut(&mut platform.id, USDSUI_TREASURY_KEY);
            balance::join(treasury, balance_in);
        } else {
            dynamic_field::add(&mut platform.id, USDSUI_TREASURY_KEY, balance_in);
        };

        // Track volume & fees in dynamic fields
        if (dynamic_field::exists_(&platform.id, USDSUI_VOLUME_KEY)) {
            let vol: &mut u64 = dynamic_field::borrow_mut(&mut platform.id, USDSUI_VOLUME_KEY);
            *vol = *vol + stake;
        } else {
            dynamic_field::add(&mut platform.id, USDSUI_VOLUME_KEY, stake);
        };
        if (dynamic_field::exists_(&platform.id, USDSUI_LIABILITY_KEY)) {
            let liab: &mut u64 = dynamic_field::borrow_mut(&mut platform.id, USDSUI_LIABILITY_KEY);
            *liab = *liab + potential_payout;
        } else {
            dynamic_field::add(&mut platform.id, USDSUI_LIABILITY_KEY, potential_payout);
        };
        if (dynamic_field::exists_(&platform.id, USDSUI_FEES_KEY)) {
            let fees: &mut u64 = dynamic_field::borrow_mut(&mut platform.id, USDSUI_FEES_KEY);
            *fees = *fees + fee;
        } else {
            dynamic_field::add(&mut platform.id, USDSUI_FEES_KEY, fee);
        };

        platform.total_bets = platform.total_bets + 1;

        // Create Bet object
        let bet = Bet {
            id: object::new(ctx),
            bettor: tx_context::sender(ctx),
            event_id,
            market_id,
            prediction,
            odds: odds_bps,
            stake,
            potential_payout,
            platform_fee: fee,
            status: 0u8,
            placed_at: now,
            settled_at: 0u64,
            walrus_blob_id,
            coin_type: COIN_TYPE_USDSUI,
            deadline,
        };

        let bet_id = object::id(&bet);
        let bettor = tx_context::sender(ctx);

        event::emit(BetPlaced {
            bet_id,
            bettor,
            event_id: bet.event_id,
            prediction: bet.prediction,
            odds: odds_bps,
            stake,
            potential_payout,
            coin_type: COIN_TYPE_USDSUI,
            timestamp: now,
        });

        transfer::share_object(bet);
    }

    public fun settle_bet_usdsui_admin(
        _admin: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(bet.status == 0u8, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_USDSUI, EWrongCoinType);

        let now = clock::timestamp_ms(clock);
        let bettor = bet.bettor;

        if (won) {
            bet.status = 1u8;
            let payout = bet.potential_payout;

            // Update liability
            if (dynamic_field::exists_(&platform.id, USDSUI_LIABILITY_KEY)) {
                let liab: &mut u64 = dynamic_field::borrow_mut(&mut platform.id, USDSUI_LIABILITY_KEY);
                if (*liab >= payout) { *liab = *liab - payout; } else { *liab = 0; };
            };

            let treasury: &mut Balance<USDSUI> = dynamic_field::borrow_mut(&mut platform.id, USDSUI_TREASURY_KEY);
            let payout_balance = balance::split(treasury, payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bettor);
        } else {
            bet.status = 2u8;
            if (dynamic_field::exists_(&platform.id, USDSUI_LIABILITY_KEY)) {
                let liab: &mut u64 = dynamic_field::borrow_mut(&mut platform.id, USDSUI_LIABILITY_KEY);
                if (*liab >= bet.potential_payout) { *liab = *liab - bet.potential_payout; } else { *liab = 0; };
            };
        };

        bet.settled_at = now;

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor,
            status: bet.status,
            payout: if (won) { bet.potential_payout } else { 0 },
            coin_type: COIN_TYPE_USDSUI,
            timestamp: now,
        });
    }

    public fun withdraw_treasury_usdsui(
        _admin: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        _clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(dynamic_field::exists_(&platform.id, USDSUI_TREASURY_KEY), EInsufficientFunds);
        let treasury: &mut Balance<USDSUI> = dynamic_field::borrow_mut(&mut platform.id, USDSUI_TREASURY_KEY);
        assert!(balance::value(treasury) >= amount, EInsufficientFunds);
        let withdrawn = balance::split(treasury, amount);
        let coin = coin::from_balance(withdrawn, ctx);
        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

// ============================================================
// ALSO: In Move.toml, add to [dependencies]:
//   USDsui = { git = "...", subdir = "...", rev = "..." }
// OR just add the address to [addresses]:
//   usdsui_pkg = "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1"
// ============================================================
