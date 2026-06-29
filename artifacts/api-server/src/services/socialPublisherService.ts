/**
 * socialPublisherService.ts
 *
 * Central dispatcher — publishes new P2P offers to all configured social platforms:
 *   • Discord   (webhook URL — no approval needed)
 *   • X/Twitter (OAuth 1.0a v2 API)
 *   • Farcaster (Neynar API)
 *   • Reddit    (OAuth2 link post)
 *
 * Each platform is enabled only when its env vars are present.
 * All calls are fire-and-forget; failures never throw to the caller.
 *
 * Env vars:
 *   DISCORD_WEBHOOK_URL
 *   TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 *   NEYNAR_API_KEY, NEYNAR_SIGNER_UUID
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_SUBREDDIT
 *   APP_URL  (public frontend URL, e.g. https://suibets.app)
 */

import crypto from 'crypto';

const APP_URL = process.env.TELEGRAM_APP_URL || process.env.APP_URL || 'https://web-production-4d574.up.railway.app';

export interface OfferPayload {
  id: number;
  eventName?: string;
  homeTeam?: string;
  awayTeam?: string;
  sportName?: string;
  leagueName?: string;
  prediction?: string;
  odds: number;
  creatorStake: number;
  takerStake: number;
  currency?: string;
  expiresAt?: Date | string | null;
}

function offerUrl(id: number) { return `${APP_URL}/p2p/offer/${id}`; }

function formatAmt(raw: number, cur: string): string {
  const n = Number(raw) / 1_000_000_000;
  return `${n.toLocaleString('en', { maximumFractionDigits: 4 })} ${cur}`;
}

function sportEmoji(sport?: string): string {
  const s = (sport ?? '').toLowerCase();
  if (s.includes('football') || s.includes('soccer')) return '⚽';
  if (s.includes('basket'))  return '🏀';
  if (s.includes('tennis'))  return '🎾';
  if (s.includes('cricket')) return '🏏';
  if (s.includes('rugby'))   return '🏉';
  if (s.includes('baseball'))return '⚾';
  if (s.includes('hockey'))  return '🏒';
  if (s.includes('mma') || s.includes('boxing')) return '🥊';
  if (s.includes('formula') || s.includes('racing')) return '🏎️';
  return '🎯';
}

function buildSummary(o: OfferPayload) {
  const cur   = o.currency ?? 'SUI';
  const event = o.eventName ?? `${o.homeTeam ?? '?'} vs ${o.awayTeam ?? '?'}`;
  const sport = o.sportName ?? o.leagueName ?? 'Sport';
  const em    = sportEmoji(sport);
  const odds  = Number(o.odds).toFixed(2);
  const stake = formatAmt(Number(o.takerStake), cur);
  const win   = formatAmt(Number(o.creatorStake) + Number(o.takerStake), cur);
  return { cur, event, sport, em, odds, stake, win };
}

// ─── Discord ────────────────────────────────────────────────────────────────────
// Uses Discord webhook — create one in your server: Channel settings → Integrations → Webhooks

async function postDiscord(offer: OfferPayload): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const { event, sport, em, odds, stake, win, cur } = buildSummary(offer);
  const link = offerUrl(offer.id);
  const expStr = offer.expiresAt
    ? new Date(offer.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'Open';

  const body = {
    username: 'SuiBets P2P',
    avatar_url: 'https://web-production-4d574.up.railway.app/favicon.ico',
    embeds: [{
      title: `🆕 New P2P Offer #${offer.id} ${em}`,
      url: link,
      color: 0x4da2ff,
      fields: [
        { name: 'Event',      value: event,   inline: false },
        { name: 'Sport',      value: sport,   inline: true  },
        { name: 'Pick',       value: `**${offer.prediction ?? '—'}** @ **${odds}x**`, inline: true },
        { name: 'Expires',    value: expStr,  inline: true  },
        { name: 'Stake to accept', value: stake, inline: true },
        { name: 'Win',        value: `**${win}**`, inline: true },
        { name: 'Currency',   value: cur,     inline: true  },
      ],
      footer: { text: 'SuiBets • Pure P2P Sports Betting on Sui' },
      timestamp: new Date().toISOString(),
    }],
    components: [{
      type: 1,
      components: [{
        type: 2, style: 5,
        label: '⚡ Accept Offer',
        url: link,
      }],
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Discord webhook ${res.status}`);
  console.log(`[Social] ✅ Discord: offer #${offer.id}`);
}

// ─── X / Twitter ────────────────────────────────────────────────────────────────
// Requires a Twitter Developer App with OAuth 1.0a User Context write permissions.
// Get credentials from https://developer.twitter.com

function twitterOAuthHeader(method: string, url: string, params: Record<string, string>, apiKey: string, apiSecret: string, accessToken: string, accessSecret: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts    = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     apiKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        ts,
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const base = Object.keys(allParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const sigBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(base)}`;
  const sigKey  = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const sig     = crypto.createHmac('sha1', sigKey).update(sigBase).digest('base64');

  oauthParams['oauth_signature'] = sig;
  const header = 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
  return header;
}

async function postTwitter(offer: OfferPayload): Promise<void> {
  const apiKey      = process.env.TWITTER_API_KEY;
  const apiSecret   = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret= process.env.TWITTER_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return;

  const { event, em, odds, stake, win } = buildSummary(offer);
  const link = offerUrl(offer.id);

  const text = [
    `🆕 New P2P Bet Offer on @SuiBets ${em}`,
    ``,
    `📌 ${event}`,
    `🎯 Pick: ${offer.prediction ?? '—'} @ ${odds}x`,
    `💰 Stake: ${stake} → Win: ${win}`,
    ``,
    `⚡ Accept it now 👇`,
    link,
    ``,
    `#SuiBets #Sui #P2PBetting #SportsBetting`,
  ].join('\n');

  const tweetUrl = 'https://api.twitter.com/2/tweets';
  const authHeader = twitterOAuthHeader('POST', tweetUrl, {}, apiKey, apiSecret, accessToken, accessSecret);

  const res = await fetch(tweetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Twitter API ${res.status}: ${err.slice(0, 200)}`);
  }
  console.log(`[Social] ✅ X/Twitter: offer #${offer.id}`);
}

// ─── Farcaster (via Neynar) ──────────────────────────────────────────────────────
// Get your API key + signer UUID from https://neynar.com
// The signer must be approved by the Farcaster account you want to cast as.

async function postFarcaster(offer: OfferPayload): Promise<void> {
  const apiKey     = process.env.NEYNAR_API_KEY;
  const signerUuid = process.env.NEYNAR_SIGNER_UUID;
  if (!apiKey || !signerUuid) return;

  const { event, em, odds, stake, win } = buildSummary(offer);
  const link = offerUrl(offer.id);

  const text = [
    `🆕 New P2P Bet on SuiBets ${em}`,
    ``,
    `${event}`,
    `Pick: ${offer.prediction ?? '—'} @ ${odds}x`,
    `Stake ${stake} → Win ${win}`,
    ``,
    `Accept 👉 ${link}`,
  ].join('\n');

  const res = await fetch('https://api.neynar.com/v2/farcaster/cast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api_key': apiKey,
    },
    body: JSON.stringify({
      signer_uuid: signerUuid,
      text,
      embeds: [{ url: link }],
      channel_id: 'sui',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Neynar API ${res.status}: ${err.slice(0, 200)}`);
  }
  console.log(`[Social] ✅ Farcaster: offer #${offer.id}`);
}

// ─── Reddit ──────────────────────────────────────────────────────────────────────
// Create a Reddit app (script type) at https://www.reddit.com/prefs/apps
// Generate a refresh token via OAuth (Reddit uses Authorization Code Grant).
// Env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_SUBREDDIT

let redditAccessToken: string | null = null;
let redditTokenExpiry = 0;

async function getRedditToken(): Promise<string | null> {
  const clientId     = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  if (redditAccessToken && Date.now() < redditTokenExpiry) return redditAccessToken;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SuiBets/1.0 by SuiBetsApp',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Reddit token ${res.status}`);
  const data: any = await res.json();
  redditAccessToken = data.access_token;
  redditTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return redditAccessToken;
}

async function postReddit(offer: OfferPayload): Promise<void> {
  const subreddit = process.env.REDDIT_SUBREDDIT;
  if (!subreddit) return;

  const token = await getRedditToken();
  if (!token) return;

  const { event, em, odds, stake, win } = buildSummary(offer);
  const link = offerUrl(offer.id);

  const title = `🆕 New P2P Bet ${em}: ${event} | Pick: ${offer.prediction ?? '—'} @ ${odds}x | Stake ${stake} to Win ${win}`;

  const res = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SuiBets/1.0 by SuiBetsApp',
    },
    body: new URLSearchParams({
      sr: subreddit,
      kind: 'link',
      title: title.slice(0, 300),
      url: link,
      nsfw: 'false',
      resubmit: 'true',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Reddit submit ${res.status}: ${err.slice(0, 200)}`);
  }
  console.log(`[Social] ✅ Reddit r/${subreddit}: offer #${offer.id}`);
}

// ─── Main export ─────────────────────────────────────────────────────────────────

export async function publishNewOffer(offer: OfferPayload): Promise<void> {
  const tasks: Array<Promise<void>> = [
    postDiscord(offer).catch(e  => console.warn(`[Social] Discord error: ${e.message}`)),
    postTwitter(offer).catch(e  => console.warn(`[Social] Twitter error: ${e.message}`)),
    postFarcaster(offer).catch(e=> console.warn(`[Social] Farcaster error: ${e.message}`)),
    postReddit(offer).catch(e   => console.warn(`[Social] Reddit error: ${e.message}`)),
  ];
  await Promise.allSettled(tasks);
}

export function logSocialConfig() {
  const enabled: string[] = [];
  if (process.env.DISCORD_WEBHOOK_URL)  enabled.push('Discord');
  if (process.env.TWITTER_API_KEY)      enabled.push('X/Twitter');
  if (process.env.NEYNAR_API_KEY)       enabled.push('Farcaster');
  if (process.env.REDDIT_CLIENT_ID)     enabled.push('Reddit');
  if (enabled.length) {
    console.log(`[Social] 📣 Auto-broadcast enabled for: ${enabled.join(', ')}`);
  } else {
    console.log('[Social] ℹ️  No social platforms configured — add env vars to enable auto-posting');
  }
}
