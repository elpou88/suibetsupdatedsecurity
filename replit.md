# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## SuiBets Blockchain (Sui Mainnet)

- **Original Package (v1)**: `0x95432fe09ab4d17afeb874366fbb611d625bfabe3cbcae75dd07b328c5951ac7`
- **Package v2**: `0x4d83eab83defa9e2488b3c525f54fc588185cfc1a906e5dada1954bf52296e76`
- **Package v3 (current)**: `0x2e354642a3c00571832c03c42575587a0ca38cfe02e4f84cb3404cc9eab403d3`
- **Platform Object**: `0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9`
- **Upgrade Cap**: `0xfef1d4446a5ef6faa129133a3152d37570a9396b554c657eb8d8c8c9f704484d`
- **Admin Cap**: `0xe1e5fd1e5077a78bb3a8fd28bf096f32b0e031213974239ebee1dd80afcfae61`
- **Admin Wallet**: `0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43`
- **SBETS Token Package**: `0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502`
- **USDsui Package**: `0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1`
- **v3 Upgrade TX**: `6jnR1YacooTTmvYstrb3R2em4tfZbutoXYY2t3KsQdCu`
- **USDsui init TX**: `3v9XXW5GpSkgEiPNXgS9gpbezAxjUZhYctdLYC3S1UVh`

### v3 Changes
- Added USDsui (6 decimals) as third betting currency (`COIN_TYPE_USDSUI = 2`)
- Uses `UsdsuiKey`/`UsdsuiState` dynamic field pattern on Platform object
- New functions: `place_bet_usdsui`, `settle_bet_usdsui`, `settle_bet_usdsui_admin`, `void_bet_usdsui_admin`, `init_usdsui_state`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Settlement Worker Bug Fixes

### Non-Football Settlement Bug (Fixed)
Three issues caused volleyball/basketball/etc. bets to settle incorrectly:

1. **`isFinished` too broad**: `statusLong.includes('final')` matched intermediate states like "Set 1 Final". Fixed by using exact equality (`=== 'final'`) and adding a partial-phase blocklist (set/quarter/half/period keywords).

2. **Score parsing null fallthrough**: When API returns `scores.home.total = null` (common for volleyball before game ends), scores fell through to 0-0, making `winner = 'draw'`. Fixed by checking if raw scores are null — only skip settlement when ALL score fields are null/missing (legitimate 0-0 finals still settle).

3. **Women's team "W" suffix**: Teams like "Minas W" vs "Maringa W" confused matching since "W" wasn't stripped. Added `.replace(/\s+w$/i, '')` to both `normalizeName` functions.

### Score Extraction Robustness (Fixed)
- Added `extractNumericScore()` helper to both `settlementWorker.ts` and `freeSportsService.ts` — handles plain numbers, objects with `.total`, `.score`, `.points`, and sums individual period/set keys when `.total` is null
- All 6 unsafe score extraction sites in settlementWorker updated to use the helper
- Added `extractVolleyballSetsWon()` for volleyball-specific handling — when `total` is null, counts sets won by comparing per-set point scores rather than summing them (which would give total points, not sets won)
- Both direct lookup and batch settlement paths use volleyball-specific extraction when `eventId.startsWith('volleyball_')` or `sportSlug === 'volleyball'`

### Unicode/Diacritical Character Bug (Fixed)
Team names with diacritical marks (Çorluspor, Béni, Eddaïer, Progrès, etc.) failed to match against API team names without diacritics. The `normName` function now uses `String.normalize('NFD')` + combining-mark stripping to convert characters like ç→c, é→e, ï→i before comparison. Also added year suffix stripping (e.g. "1947") and fuzzy word-overlap matching for partial team names.

### Cup Match PEN/AET Settlement (Fixed)
Matches ending in penalties (PEN) or after extra time (AET) were incorrectly settling 1X2/DC markets. API-Sports `fulltime` sometimes includes ET goals, and `goals` always includes them. Fix uses two-layer approach:
- **Winner**: Forced to `'draw'` for PEN/AET matches (since 90-min must be a draw to go to ET). Used by 1X2 and Double Chance markets.
- **Scores**: Uses `fulltime` (or `goals` fallback) as-is for score-dependent markets (Over/Under, BTTS, Correct Score, Odd/Even). This is the best available data from API-Sports.
Applied in both `fetchFootballFixtureById` (direct lookup) and `fetchFinishedForSport` (batch) paths.

## Cash Out Time Decay

Cash out values now aggressively decay based on bet age (always applied, regardless of whether live game context is available):
- **0-2 min**: No decay (100%)
- **2-30 min**: Linear decay to 85%
- **30-60 min**: Decay to 70%
- **60-120 min**: Decay to 50%
- **120+ min**: Continues to 15% minimum (10% per additional hour)

When live game context IS available, additional game-progress decay is stacked (up to 55% reduction at 100% game progress). Unfavorable score halves the value further.

## Odds Flow (No Compression)

- `sanitizeEventsForServing()` in routes-simple.ts passes through real API odds — no `compressMatchOdds` anymore
- Top-level `homeOdds`, `drawOdds`, `awayOdds` are extracted from markets if not already set on event objects
- `transformFootballEvent`, `transformBasketballEvent`, `transformGenericEvent` all set top-level odds from their market outcomes
- `live-lite` endpoint now returns correct `drawOdds` for football since transformers set it
- `live-lite` enriches football events with bulk `/odds/live` API (single API call for all live fixtures, 30s cache)
- `live-lite` applies **score-based fallback odds** for events without API odds — winning team always gets lower odds based on score differential and match minute
- `fetchBulkLiveOdds()` fetches all live in-play odds in one API call and caches for 30s
- Only `capOdds()` minimum floor (1.01) and security cap (51.00) remain — no artificial odds compression

## Stake & Payout Limits

- **MAX_STAKE_SBETS**: 500,000 (backend `RUNTIME_MAX_STAKE_SBETS` + frontend `BetSlip.tsx` + `parlay.tsx`)
- **MAX_STAKE_SUI**: 100 SUI
- **MAX_STAKE_USDSUI**: 1 USDsui
- **MAX_PAYOUT_SBETS**: 7,000,000 (routes-simple.ts + BetSlip.tsx + blockchainBetService.ts)
- **MAX_PAYOUT_SUI**: 150
- **MAX_PAYOUT_USDSUI**: 4
- **Settlement caps**: 15M SBETS / 150 SUI (defense-in-depth in settlementWorker.ts)
- **Oracle stake enforcement**: `/api/oracle/sign-bet` rejects betAmountMist > max stake before signing
- **Quick-bet buttons (SBETS)**: 1K, 10K, 50K, 100K, 500K
- **Conservative oracle cap**: Uses `MAX_ODDS_CAP * 100` BPS (not hardcoded 300)

## Sport Badge Detection

`sportUtils.ts` provides `getSportFromEventId(eventId, sportId?)` to detect sport type:
- **Primary**: Uses `sportId` numeric field (1=Football, 2=Basketball, 5=Ice Hockey, etc.)
- **Fallback**: Parses `sport_api_*` prefix from eventId string
- **No longer assumes** plain numeric IDs are football (could be any sport)

## Streaming Integration

- **Primary**: SportsRC API (`api.sportsrc.org`) — free, CORS-enabled, no API key, 20 req/sec, 15+ sports
- **Fallback**: WeStream (`westream.su`) — used when SportsRC is unavailable
- **Endpoints**: `/api/streaming/sports`, `/api/streaming/live`, `/api/streaming/matches/:sport`, `/api/streaming/detail/:category/:id`, `/api/watch-embed/:category/:id/:streamNo`, `/api/stream-proxy/:category/:id/:streamNo`
- **Embed domains**: Validated server-side; player loads from inner embed chain (SportsRC → embedsports.top → pooembed.eu etc.)
- **Inner iframe following**: `stream-proxy` follows nested iframe chain up to 3 levels deep to reach actual player content, adds `<base href>` for correct relative URL resolution, injects `window.top`/`window.parent`/`frameElement` overrides to bypass sandbox detection
- **Security**: All list responses sanitized (no embed URLs exposed to frontend), embed URL stays server-side only, input sanitization on all params, rate limiting (30/min per IP on embed routes), CSP frame-ancestors restriction, popup blocker injection, X-Frame-Options skipped only for stream routes
- **stripAdsFromHtml**: Removes tracking scripts (Histats, _Hasync), ad-domain scripts/iframes/images, popup-related scripts (preserving player scripts), injects ad-hiding CSS and overlay cleanup interval
