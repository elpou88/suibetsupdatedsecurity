import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes-simple";
import p2pRouter from "./routes-p2p";
import warpRouter from "./routes-warp";
import fluxRouter from "./routes-flux";
import pulseRouter from "./routes-pulse";
import { setupVite, serveStatic, log } from "./vite";
import { initDb, seedDb } from "./db";
import { setupBlockchainAuth } from "./blockchain-auth";
import { blockchainStorage } from "./blockchain-storage";

const app = express();

app.set('trust proxy', 1);

// Early health check — must respond BEFORE any middleware that might redirect or block
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.get('/_health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((req, res, next) => {
  if (req.headers.accept?.includes('text/html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const isStreamEmbed = req.path.startsWith('/api/embed-stream/') || req.path.startsWith('/watch/') || req.path.startsWith('/api/watch/') || req.path.startsWith('/api/watch-embed/') || req.path.startsWith('/api/stream-proxy/');
  if (!isStreamEmbed) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS configuration for Railway deployment - v3.1
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.VITE_API_URL,
  'https://suibets.up.railway.app',
  'https://suibets-production.up.railway.app',
  'https://web-production-4d574.up.railway.app',
  'https://suibets.io',
  'https://www.suibets.io',
  'https://www.suibets.com',
  'https://suibets.com',
  'https://suibets.wal.app',
  'https://suibets.walrus.site',
  'http://localhost:5000',
  'http://localhost:5173',
].filter(Boolean) as string[];

const walrusDomainPatterns = [
  /^https:\/\/.*\.walrus\.site$/,
  /^https:\/\/.*\.wal\.app$/,
];

const railwayDomainPatterns = [
  /^https:\/\/.*\.up\.railway\.app$/,
  /^https:\/\/.*\.railway\.app$/,
];

const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins in development
    if (!isProduction) return callback(null, true);
    
    // Allow wallet browser extensions (chrome-extension://, moz-extension://, etc.)
    if (origin.includes('-extension://')) {
      return callback(null, true);
    }
    
    // Production: Check against allowed origins
    const isAllowed = allowedOrigins.some(allowed => origin === allowed);
    
    const isRailwayDomain = railwayDomainPatterns.some(pattern => pattern.test(origin));
    const isWalrusDomain = walrusDomainPatterns.some(pattern => pattern.test(origin));
    
    if (isAllowed || isRailwayDomain || isWalrusDomain) {
      return callback(null, true);
    }
    
    // Log rejected origins for debugging
    console.log(`[CORS] Origin rejected: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Handle preflight requests explicitly
app.options('/{*splat}', cors());

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/api/events' || req.path === '/api/events/counts' || req.path === '/api/sports' || req.path.startsWith('/assets'),
});
app.use('/api/', globalLimiter);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many admin requests, please try again later.' },
});
app.use('/api/admin/', adminLimiter);

// Serve large static images directly from server (used by Walrus Sites build)
app.use('/images', express.static(path.join(import.meta.dirname, 'images')));

// Content Security Policy headers for Railway deployment
// Allow inline scripts and eval for Vite/React/Sui wallet libraries
app.use((req, res, next) => {
  // Skip CSP for API requests
  if (req.path.startsWith('/api')) return next();
  
  // Relaxed CSP for streaming watch pages (player needs data: URIs, media sources, etc.)
  if (req.path.startsWith('/watch/')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; " +
      "script-src * 'unsafe-inline' 'unsafe-eval' blob:; " +
      "style-src * 'unsafe-inline'; " +
      "img-src * data: blob:; " +
      "media-src * data: blob:; " +
      "connect-src * data: blob:; " +
      "object-src * data:; " +
      "frame-src * data: blob:;"
    );
    return next();
  }

  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https: http:; " +
    "connect-src 'self' https: wss: ws: http:; " +
    "frame-src 'self' https:; " +
    "worker-src 'self' blob:; " +
    "child-src 'self' blob:;"
  );
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !path.startsWith("/api/admin")) {
        const sanitized = { ...capturedJsonResponse };
        delete sanitized.token;
        delete sanitized.authorization;
        delete sanitized.password;
        delete sanitized.privateKey;
        logLine += ` :: ${JSON.stringify(sanitized)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('⚠️ WARNING: ADMIN_PASSWORD not set — admin endpoints will be disabled');
  } else if (process.env.ADMIN_PASSWORD.length < 16) {
    console.warn('⚠️ WARNING: ADMIN_PASSWORD should be 16+ characters for production');
  }

  // ── Auto-migration: add missing columns (idempotent, safe to re-run) ────────
  try {
    const { db: mDb } = await import('./db.js');
    const { sql: mSql } = await import('drizzle-orm');

    // P2P tables — these always exist; run first so P2P is never blocked
    const p2pStmts = [
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_client_order_id text`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_id text`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_digest text`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS share_token text`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS suins_gated boolean DEFAULT false`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS live_odds boolean DEFAULT false`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS score_snapshot text`,
      `ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_minute integer`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_p2p_offers_share_token ON p2p_bet_offers(share_token) WHERE share_token IS NOT NULL`,
      `ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_blob_id text`,
      `ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_receipt_json text`,
      `ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS checkpoint_seq text`,
      `ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS bets_settled integer DEFAULT 0`,
    ];
    for (const stmt of p2pStmts) {
      await mDb.execute(mSql.raw(stmt));
    }
    log('✅ P2P auto-migration complete');

    // bets table — create if missing, then ensure Walrus columns exist
    try {
      await mDb.execute(mSql.raw(`
        CREATE TABLE IF NOT EXISTS bets (
          id                  SERIAL PRIMARY KEY,
          user_id             INTEGER,
          wallet_address      TEXT,
          event_id            INTEGER,
          market_id           INTEGER,
          outcome_id          INTEGER,
          bet_amount          REAL NOT NULL DEFAULT 0,
          currency            TEXT DEFAULT 'SUI',
          odds                REAL NOT NULL DEFAULT 1,
          prediction          TEXT NOT NULL DEFAULT '',
          potential_payout    REAL NOT NULL DEFAULT 0,
          status              TEXT DEFAULT 'pending',
          result              TEXT,
          payout              REAL,
          settled_at          TIMESTAMP,
          created_at          TIMESTAMP DEFAULT NOW(),
          bet_type            TEXT DEFAULT 'single',
          cash_out_available  BOOLEAN DEFAULT false,
          cash_out_amount     REAL,
          cash_out_at         TIMESTAMP,
          parlay_id           INTEGER,
          wurlus_bet_id       TEXT,
          bet_object_id       TEXT,
          tx_hash             TEXT,
          settlement_tx_hash  TEXT,
          platform_fee        REAL,
          network_fee         REAL,
          fee_currency        TEXT DEFAULT 'SUI',
          event_name          TEXT,
          external_event_id   TEXT,
          home_team           TEXT,
          away_team           TEXT,
          winnings_withdrawn  BOOLEAN DEFAULT false,
          walrus_blob_id      TEXT,
          walrus_receipt_data TEXT,
          nft_mint_tx         TEXT,
          gifted_to           TEXT,
          gifted_from         TEXT
        )
      `));
      const betsStmts = [
        `ALTER TABLE bets ADD COLUMN IF NOT EXISTS walrus_blob_id text`,
        `ALTER TABLE bets ADD COLUMN IF NOT EXISTS walrus_receipt_data text`,
        `ALTER TABLE bets ADD COLUMN IF NOT EXISTS nft_mint_tx text`,
        `ALTER TABLE bets ADD COLUMN IF NOT EXISTS gifted_to text`,
        `ALTER TABLE bets ADD COLUMN IF NOT EXISTS gifted_from text`,
      ];
      for (const stmt of betsStmts) {
        await mDb.execute(mSql.raw(stmt));
      }
      log('✅ bets table auto-migration complete');
    } catch (betsErr: any) {
      console.warn('⚠️ bets table migration warning (non-fatal):', betsErr.message);
    }
  } catch (migrateErr: any) {
    console.warn('⚠️ DB auto-migration warning (non-fatal):', migrateErr.message);
  }

  // Setup blockchain-based authentication
  const { requireWalletAuth } = setupBlockchainAuth(app);
  log('Blockchain-based authentication system initialized');
  log('Blockchain-based storage system initialized');

  log('Registering SuiBets API routes...');
  const server = await registerRoutes(app);
  log('API routes registered successfully');

  // P2P betting routes
  app.use('/api/p2p', p2pRouter);
  log('P2P betting routes registered');

  // WARP Engine routes
  app.use('/api/warp', warpRouter);
  log('WARP Engine routes registered');

  // FLUX Engine routes
  app.use('/api/flux', fluxRouter);
  log('FLUX Engine routes registered');

  // PULSE Engine routes
  app.use('/api/pulse', pulseRouter);
  log('PULSE Engine routes registered');

  // ── Telegram webhook — registered HERE (before serveStatic catch-all) ────────
  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
      // If no secret is configured, reject all webhook calls to prevent abuse
      return res.status(403).json({ ok: false });
    }
    if (req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return res.status(403).json({ ok: false });
    }
    res.json({ ok: true }); // respond immediately — Telegram requires <5s
    try {
      const { handleWebhookUpdate } = await import('./services/telegramBotService.js');
      handleWebhookUpdate(req.body).catch(() => {});
    } catch { /* non-fatal */ }
  });
  log('Telegram webhook route registered at POST /api/telegram/webhook');

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error('Server error:', err);
    if (!res.headersSent) {
      const safeMessage = status >= 500 ? "Internal Server Error" : (err.message || "Request failed");
      res.status(status).json({ message: safeMessage });
    }
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    try {
      serveStatic(app);
      log('Static files configured for production');
    } catch (staticErr: any) {
      console.error('FATAL: serveStatic failed:', staticErr.message);
      app.use("*", (_req, res) => {
        res.status(503).json({ error: "Frontend not available", details: staticErr.message });
      });
    }
  }

  // ── BIND PORT IMMEDIATELY so Railway health-check passes ──────────────────
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    log(`🚀 Server running on ${host}:${port} (NODE_ENV: ${process.env.NODE_ENV || 'development'})`);

    // ── ALL heavy async work runs AFTER the port is bound ─────────────────

    // Security sanity checks
    if (!process.env.ADMIN_SECRET) {
      console.warn(
        '⚠️  WARNING: ADMIN_SECRET env var is not set. ' +
        'Admin routes (/api/p2p/admin/*, /api/p2p/settle, etc.) are protected by DB sessions only. ' +
        'Set ADMIN_SECRET to a strong random string to enable the fast-path token check.'
      );
    }
    if (!process.env.ADMIN_WALLET_ADDRESS) {
      console.warn('⚠️  WARNING: ADMIN_WALLET_ADDRESS is not set. Custodial payouts will fail at runtime.');
    }
    if (!process.env.ADMIN_PRIVATE_KEY) {
      console.warn('⚠️  WARNING: ADMIN_PRIVATE_KEY is not set. Custodial payouts will fail at runtime.');
    }

    // DB init + seed (non-blocking)
    (async () => {
      try {
        await initDb();
        await seedDb();
        log('Database initialized and seeded successfully');
      } catch (error) {
        console.error('Error initializing database:', error);
        log('Continuing with blockchain-based authentication and storage');
      }

      // Prediction market seeder
      try {
        const { seedPredictionMarkets, startFootballSeederInterval, seedGrandNational2026, seedFeaturedTrending } = await import('./services/predictionSeederService');
        await seedPredictionMarkets();
        await seedGrandNational2026();
        await seedFeaturedTrending();
        startFootballSeederInterval();
      } catch (seedErr: any) {
        console.warn('[PredictionSeeder] Startup seed failed (non-fatal):', seedErr.message);
      }

      // Walrus backfill
      try {
        const { db: backfillDb } = await import('./db');
        const { bets: backfillBets } = await import('@shared/schema');
        const { isNull: backfillIsNull, eq: backfillEq } = await import('drizzle-orm');
        const { createHash } = await import('crypto');
        const missing = await backfillDb.select().from(backfillBets).where(backfillIsNull(backfillBets.walrusBlobId));
        if (missing.length > 0) {
          log(`🐋 Backfilling ${missing.length} bet(s) missing Walrus blob IDs...`);
          const storedAt = Date.now();
          for (const row of missing) {
            const betId = row.wurlusBetId || String(row.id);
            const currency = (row as any).currency || row.feeCurrency || 'SUI';
            const placedAt = row.createdAt?.getTime() || storedAt;
            const blobId = `local_${createHash('sha256').update(betId + placedAt).digest('hex').slice(0, 16)}`;
            const verificationPayload = JSON.stringify({
              betId, walletAddress: row.walletAddress,
              eventId: String(row.eventId || ''), prediction: row.prediction,
              odds: row.odds, stake: row.betAmount, currency, placedAt,
            });
            const receiptData = JSON.stringify({
              platform: 'SuiBets', version: '2.0', type: 'bet_receipt',
              branding: {
                name: 'SuiBets', tagline: 'Decentralized Sports Betting on Sui',
                website: 'https://www.suibets.com', walrusSite: 'https://suibets.wal.app',
                colors: { primary: '#06b6d4', secondary: '#8b5cf6', accent: '#f59e0b', background: '#0a0e1a', surface: '#111827', success: '#10b981', error: '#ef4444' },
                logo: 'https://www.suibets.com/suibets-logo.png',
              },
              bet: {
                id: betId, walletAddress: row.walletAddress || null,
                eventId: String(row.eventId || ''), eventName: row.eventName || 'Unknown Event',
                homeTeam: row.homeTeam || null, awayTeam: row.awayTeam || null,
                prediction: row.prediction, odds: row.odds, stake: row.betAmount,
                currency, potentialPayout: row.potentialPayout, sportName: null,
                marketType: row.marketType || 'match_winner',
              },
              blockchain: {
                chain: 'sui:mainnet', network: 'mainnet',
                txHash: row.txHash || null, betObjectId: row.betObjectId || null,
                token: currency === 'SBETS'
                  ? (process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS')
                  : '0x2::sui::SUI',
                contract: process.env.BETTING_PACKAGE_ID || '',
                platform: process.env.BETTING_PLATFORM_ID || '',
              },
              storage: {
                protocol: 'walrus', network: 'mainnet', blobId,
                local: true, backfilled: true, storedVia: 'local-backfill',
                storedAt, placedAt, storageEpoch: null, endEpoch: null, walCost: null,
              },
              verification: {
                receiptHash: createHash('sha256').update(verificationPayload).digest('hex'),
                algorithm: 'sha256',
                fields: ['betId', 'walletAddress', 'eventId', 'prediction', 'odds', 'stake', 'currency', 'placedAt'],
              },
            }, null, 2);
            await backfillDb.update(backfillBets)
              .set({ walrusBlobId: blobId, walrusReceiptData: receiptData })
              .where(backfillEq(backfillBets.id, row.id));
          }
          log(`🐋 Walrus backfill complete: ${missing.length} bet(s) patched`);
        }
      } catch (backfillErr: any) {
        console.warn('[Walrus backfill] Failed:', backfillErr.message);
      }
    })();

    // Background services (fire-and-forget)
    import('./services/p2pBettingService').then(({ p2pBettingService }) => {
      p2pBettingService.startSettlementLoop(5 * 60 * 1000);
      p2pBettingService.startLiveScoreWatcher();
    }).catch((e: any) => console.warn('[P2P] Settlement loop startup error:', e.message));

    import('./services/socialPublisherService').then(({ logSocialConfig }) => {
      logSocialConfig();
    }).catch(() => {});

    if (process.env.TELEGRAM_BOT_DISABLED !== 'true') {
      import('./services/telegramBotService').then(({ startTelegramBot }) => {
        startTelegramBot(app).catch((e: any) => console.warn('[TelegramBot] Startup error (non-fatal):', e.message));
      }).catch((e: any) => console.warn('[TelegramBot] Import error (non-fatal):', e.message));
    } else {
      console.log('[TelegramBot] Bot startup disabled (TELEGRAM_BOT_DISABLED=true). Webhook-only mode active.');
      // Re-assert the webhook URL on every startup so Railway cannot override it
      const botToken   = process.env.TELEGRAM_BOT_TOKEN;
      const webhookUrl = (process.env.TELEGRAM_WEBHOOK_URL ?? '').replace(/\/$/, '') + '/api/telegram/webhook';
      const secret     = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (botToken && secret && process.env.TELEGRAM_WEBHOOK_URL) {
        fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl, secret_token: secret, drop_pending_updates: false, allowed_updates: ['message', 'callback_query', 'channel_post'] }),
        })
          .then(r => r.json())
          .then(j => console.log(`[TelegramBot] Webhook locked → ${webhookUrl} (ok=${j.ok})`))
          .catch(() => {});
      }
    }

    import('./services/liveOddsService').then(({ startLiveOddsPoll }) => {
      startLiveOddsPoll(15_000);
    }).catch((e: any) => console.warn('[LiveOdds] Startup error (non-fatal):', e.message));

    import('./services/moveEventListener').then(({ startMoveEventListener }) => {
      startMoveEventListener().catch((e: any) =>
        console.warn('[MoveEvents] Startup error (non-fatal):', e.message)
      );
    }).catch(() => {});

    // FLUX + PULSE auto-settlement (runs every 5 min; same oracle keys as WARP)
    import('./services/engineAutoSettleService').then(({ startEngineAutoSettle }) => {
      startEngineAutoSettle();
    }).catch((e: any) => console.warn('[EngineAutoSettle] Startup error (non-fatal):', e.message));

    // WARP+FLUX+PULSE continuous on-chain activity (runs every 10 min)
    // Creates real PULSE pool lifecycles + WARP/FLUX batch markers so engines
    // are always visible on SuiVision regardless of user betting activity.
    import('./services/engineActivityService').then(({ startEngineActivity }) => {
      startEngineActivity();
    }).catch((e: any) => console.warn('[EngineActivity] Startup error (non-fatal):', e.message));

    import('./services/pythPriceService').then(({ fetchPythPrices }) => {
      fetchPythPrices().catch((e: any) =>
        console.warn('[Pyth] Warmup error (non-fatal):', e.message)
      );
    }).catch(() => {});
  });
})();
