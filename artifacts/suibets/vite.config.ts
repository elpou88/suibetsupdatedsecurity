import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { Plugin } from "vite";

// ── OG Tag Middleware for Twitter/X crawlers ──────────────────────────────────
// When a bot (e.g. Twitterbot) requests /p2p/offer/:id or /p2p/parlay/:id,
// return a minimal HTML page with rich Open Graph meta tags so X shows a
// card preview. Real users get the normal SPA (next() → index.html).
function p2pOgPlugin(): Plugin {
  const BOT_UA = /twitterbot|facebookexternalhit|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|bot\/|googlebot|bingbot|yandex|baidu|duckduckbot|sogou|exabot|ia_archiver|embedly|outbrain|quora|rogerbot|applebot|semrushbot|ahrefsbot|mj12bot/i;
  const OFFER_RE  = /^\/p2p\/offer\/(\d+)/;
  const PARLAY_RE = /^\/p2p\/parlay\/(\d+)/;

  const escHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function buildOgHtml(title: string, description: string, url: string): string {
    return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SuiBets">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:url" content="${escHtml(url)}">
<meta property="og:image" content="https://suibets.app/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@SuiBets">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="https://suibets.app/og-image.png">
<meta http-equiv="refresh" content="0;url=${escHtml(url)}">
</head><body><a href="${escHtml(url)}">View bet on SuiBets</a></body></html>`;
  }

  return {
    name: 'p2p-og-tags',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const ua = (req.headers['user-agent'] ?? '') as string;
        if (!BOT_UA.test(ua)) return next();

        const url = req.url ?? '';
        const offerMatch  = url.match(OFFER_RE);
        const parlayMatch = url.match(PARLAY_RE);
        if (!offerMatch && !parlayMatch) return next();

        const isParlay = !!parlayMatch;
        const id = offerMatch?.[1] ?? parlayMatch?.[1];
        const canonicalUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers['host']}${url}`;

        try {
          const apiEndpoint = isParlay
            ? `http://localhost:8080/api/p2p/parlays/${id}`
            : `http://localhost:8080/api/p2p/offers/${id}`;
          const apiRes = await fetch(apiEndpoint);
          if (!apiRes.ok) return next();
          const data: any = await apiRes.json();

          let title: string;
          let description: string;

          if (isParlay) {
            const legTeams = (data.legs ?? []).slice(0, 3).map((l: any) => `${l.homeTeam} vs ${l.awayTeam}`).join(', ');
            const maxWin = Math.round((data.creatorStake + data.takerStake) * 0.98 * 1000) / 1000;
            title = `🎰 ${data.legCount}-Leg Parlay @ ${Number(data.totalOdds).toFixed(2)}x — SuiBets P2P`;
            description = `${legTeams}${(data.legs ?? []).length > 3 ? ` +${(data.legs ?? []).length - 3} more` : ''} · Creator: ${data.creatorStake} ${data.currency} · Win up to ${maxWin} ${data.currency}. Accept on SuiBets.`;
          } else {
            const predLbl = data.prediction === 'home' ? data.homeTeam : data.prediction === 'away' ? data.awayTeam : 'Draw';
            const maxWin = Math.round((data.creatorStake + data.takerStake) * 0.98 * 1000) / 1000;
            title = `🎯 ${data.homeTeam} vs ${data.awayTeam} @ ${Number(data.odds).toFixed(2)}x — SuiBets P2P`;
            description = `${predLbl} @ ${Number(data.odds).toFixed(2)}x odds · Creator stakes ${data.creatorStake} ${data.currency} · Max win: ${maxWin} ${data.currency}. Accept the opposite side on SuiBets.`;
          }

          const html = buildOgHtml(title, description, canonicalUrl);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        } catch {
          next();
        }
      });
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    p2pOgPlugin(),
  ],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      "@shared": path.resolve(import.meta.dirname, "..", "..", "..", "shared"),
      events: "events",
      buffer: "buffer",
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["events", "buffer"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        secure: false,
      },
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
