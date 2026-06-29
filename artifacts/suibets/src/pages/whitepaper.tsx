import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useWalrusProtocolContext } from '@/context/WalrusProtocolContext';
import SuiNSName from '@/components/SuiNSName';
const suibetsLogo = "/images/suibets-logo.png";
import {
  FileText, Shield, Zap, Lock, TrendingUp, Globe, Wallet,
  RefreshCw, ExternalLink, ArrowLeft, Users, Target, Award,
  Coins, BarChart3, MessageCircle, Layers, Link2, Star, Radio,
  Fuel, Code2, GitBranch, Cpu, ChevronDown, ChevronUp, Copy, Check, Database
} from 'lucide-react';

type ContentBlock =
  | string
  | { type: 'code'; lang: string; label?: string; code: string }
  | { type: 'callout'; variant: 'info' | 'warn' | 'tech'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'steps'; items: string[] };

interface Section {
  id: string;
  title: string;
  badge?: string;
  icon: React.ReactNode;
  content: ContentBlock[];
}

function CodeBlock({ lang, code, label }: { lang: string; code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/8 bg-[#060d16]">
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.04] border-b border-white/8">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500/60" /><div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" /><div className="w-2.5 h-2.5 rounded-full bg-green-500/60" /></div>
          {label && <span className="text-xs text-gray-500 ml-2">{label}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-gray-600 uppercase">{lang}</span>
          <button onClick={copy} className="text-gray-600 hover:text-gray-300 transition-colors">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed">
        <code className="text-gray-300 font-mono">{code}</code>
      </pre>
    </div>
  );
}

function Callout({ variant, text }: { variant: 'info' | 'warn' | 'tech'; text: string }) {
  const styles = {
    info:  'bg-cyan-500/8 border-cyan-500/30 text-cyan-300',
    warn:  'bg-amber-500/8 border-amber-500/30 text-amber-300',
    tech:  'bg-violet-500/8 border-violet-500/30 text-violet-300',
  }[variant];
  const prefix = { info: 'ℹ', warn: '⚠', tech: '⚙' }[variant];
  return (
    <div className={`flex gap-2.5 border rounded-lg p-3 text-xs leading-relaxed my-2 ${styles}`}>
      <span className="flex-shrink-0 font-black">{prefix}</span>
      <span>{text}</span>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-white/8">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/8 bg-white/[0.03]">
            {headers.map(h => <th key={h} className="px-4 py-2.5 text-left font-bold text-gray-300">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
              {row.map((cell, j) => <td key={j} className="px-4 py-2.5 text-gray-400 font-mono">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="my-2 space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-xs text-gray-300">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 font-black flex items-center justify-center text-[10px]">{i + 1}</span>
          <span className="leading-relaxed pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function renderBlock(block: ContentBlock, idx: number) {
  if (typeof block === 'string') {
    return <p key={idx} className="text-gray-300 leading-relaxed text-sm">{block}</p>;
  }
  if (block.type === 'code') return <CodeBlock key={idx} lang={block.lang} code={block.code} label={block.label} />;
  if (block.type === 'callout') return <Callout key={idx} variant={block.variant} text={block.text} />;
  if (block.type === 'table') return <DataTable key={idx} headers={block.headers} rows={block.rows} />;
  if (block.type === 'steps') return <Steps key={idx} items={block.items} />;
  return null;
}

export default function WhitepaperPage() {
  const [, setLocation] = useLocation();
  const { currentWallet } = useWalrusProtocolContext();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (id: string) => setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));

  const sections: Section[] = [
    {
      id: 'orderbook-price-discovery',
      title: 'Orderbook Price Discovery',
      badge: 'PRICE DISCOVERY',
      icon: <BarChart3 className="h-5 w-5 text-cyan-400" />,
      content: [
        'SuiBets implements a decentralised Central Limit Order Book (CLOB) for sports markets — the same price-discovery mechanism used by Binance and dYdX, applied to betting odds. Every open offer is a resting limit order. The real-time book depth is the aggregate of all live on-chain offers, aggregated by odds level across all takers.',
        {
          type: 'callout', variant: 'tech',
          text: 'Price discovery on SuiBets is fully emergent — no house, no AMM curve, no oracle input. Odds are set by makers competing for takers. The market-clearing price at any moment is the intersection of maker supply and taker demand, visible in the CLOB depth chart in real time.'
        },
        'The three settlement engines each contribute a distinct price-discovery layer:',
        {
          type: 'table',
          headers: ['Engine', 'Market Type', 'Price Formation', 'Liquidity Model'],
          rows: [
            ['WARP', 'Binary P2P + Parlay', 'Fixed-odds maker posts; taker accepts or counter-offers', 'Whole-lot fills; batch settlement in one PTB'],
            ['FLUX', 'Fractional P2P CLOB', 'Fixed-odds + continuous partial fills aggregate depth', 'Sharded taker receipts (FluxShard) — any fill size'],
            ['PULSE', 'Pari-mutuel Pool', 'Floating odds — real-time pool ratio = implied probability', 'Side pools merge all stakes; odds finalise at settlement'],
          ]
        },
        'How the live CLOB book is constructed from raw on-chain data:',
        {
          type: 'steps',
          items: [
            'Every open BetOffer and FluxOffer is fetched from the DB (indexed from chain events). Each offer carries: eventId, prediction (home/away/draw), odds (bps), remaining taker stake.',
            'Offers are grouped by odds level (rounded to 2 d.p.) and prediction side, producing bid-side (home/draw) and ask-side (away) depth arrays — identical to a traditional CLOB level-2 feed.',
            'PULSE pools contribute a synthetic mid-price: side_a_pool / total_pool gives the implied probability for side A, converted to decimal odds. This floats in real time as stakes move.',
            'The aggregated book is served via REST (GET /api/p2p/clob/:eventId?currency=SUI) and broadcast via WebSocket on every offer create/fill/cancel event. Clients receive delta updates, not full snapshots.',
            'DeepBook v3 SDK mirrors open P2P offers as limit orders on the DEX for additional price transparency. The SuiBets CLOB feeds the on-chain DeepBook pool, enabling external arbitrageurs to narrow spreads.',
          ]
        },
        {
          type: 'code', lang: 'typescript', label: 'routes-p2p.ts — CLOB aggregation endpoint',
          code: `// GET /api/p2p/clob/:eventId?currency=SUI
// Returns aggregated bid/ask/draw depth for the event
router.get('/clob/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const currency = (req.query.currency as string ?? 'SUI').toUpperCase();

  const offers = await db.select().from(p2pBetOffers).where(
    and(
      eq(p2pBetOffers.eventId, eventId),
      eq(p2pBetOffers.currency, currency),
      inArray(p2pBetOffers.status, ['open', 'partial']),
      gt(p2pBetOffers.expiresAt, new Date()),
    )
  );

  // Aggregate into price levels (bid = home, ask = away, draw = draw)
  const levels = { bids: new Map(), asks: new Map(), draw: new Map() };
  for (const o of offers) {
    const side = o.prediction === 'home' ? 'bids'
               : o.prediction === 'away' ? 'asks' : 'draw';
    const key  = Math.round(Number(o.odds) * 100) / 100;
    const qty  = (o.takerStake ?? 0) - (o.filledStake ?? 0);
    const prev = levels[side].get(key) ?? { quantity: 0, count: 0 };
    levels[side].set(key, { quantity: prev.quantity + qty, count: prev.count + 1 });
  }
  res.json({ eventId, currency, bids, asks, draw, timestamp: new Date() });
});`
        },
        {
          type: 'callout', variant: 'info',
          text: 'PULSE pools are broadcast separately via GET /api/p2p/pulse/pools?eventId=X. The implied probability from the pool ratio is overlaid on the CLOB depth chart as a dashed "pool mid" line, giving takers a real-time arbitrage signal between fixed-odds WARP/FLUX offers and the floating-odds PULSE pool.'
        },
        'DeepBook v3 — On-Chain Price Transparency:',
        {
          type: 'callout', variant: 'tech',
          text: 'DeepBook v3 is Sui\'s native CLOB DEX. SuiBets mirrors every open P2P offer as a limit order into a DeepBook pool for the corresponding event market. This means SuiBets odds become publicly discoverable on-chain — any Sui wallet, DEX aggregator, or trading bot can query the DeepBook pool to see the live best bid / best ask for any match, without going through the SuiBets UI at all.'
        },
        {
          type: 'table',
          headers: ['DeepBook Integration Point', 'What it Does', 'Why it Matters'],
          rows: [
            ['Offer mirror (limit order)', 'Each BetOffer posted on SuiBets is mirrored as a DeepBook limit order at the offer\'s odds price', 'External market participants can see and fill the order, deepening liquidity'],
            ['Best bid / best ask feed', 'DeepBook v3 SDK exposes the current spread for any event market', 'Price discovery is fully on-chain and independent of SuiBets servers'],
            ['Arbitrage signal', 'PULSE pool mid-price vs DeepBook best offer creates a public spread', 'Arbitrageurs tighten the book, narrowing the spread for all users'],
            ['OracleCap settlement', 'Same oracle wallet settles DeepBook-matched offers via PTB', 'Unified settlement across P2P, FLUX, PULSE, and DeepBook channels'],
          ]
        },
        {
          type: 'code', lang: 'typescript', label: 'deepbookService.ts — mirror P2P offer as limit order',
          code: `import { DeepBookClient } from '@mysten/deepbook-v3';

// Called whenever a new BetOffer is created on-chain
export async function mirrorOfferToDeepBook(offer: BetOffer) {
  const client = new DeepBookClient({ client: suiClient, address: ORACLE_ADDRESS });

  // Each event gets its own DeepBook pool: BASE=HOME_SIDE, QUOTE=AWAY_SIDE
  const poolKey = \`SUIBETS_\${offer.eventId}_\${offer.currency}\`;

  await client.placeMarketOrder({
    poolKey,
    quantity:  BigInt(offer.creatorStake),
    price:     BigInt(Math.round(offer.odds * 1_000_000)), // odds in micro-units
    isBid:     offer.prediction === 'home',                // home = bid side
    expiration: BigInt(offer.expiresAt),
  });
}`
        },
        'Because all three engines share the same OracleCap and settlement infrastructure, the protocol can route each bet to the optimal engine at posting time — maximising liquidity depth across the combined order book surface. DeepBook provides the external price-discovery rail that ensures SuiBets odds are globally visible and competitive.',
      ]
    },
    {
      id: 'clob',
      title: 'Sports Order Book (CLOB Model)',
      badge: 'WHY SUIBETS',
      icon: <Zap className="h-5 w-5 text-yellow-400" />,
      content: [
        'A Central Limit Order Book (CLOB) lets participants post offers at their chosen price and wait for a counterparty — exactly how Binance, dYdX, and every professional exchange operates. SuiBets is the first protocol to apply this model to sports betting.',
        {
          type: 'callout', variant: 'tech',
          text: 'Traditional sportsbooks use a house-edge model where the book is always your counterparty and always wins long-term. SuiBets replaces the house with an on-chain order book. You post a bet offer at your odds. Anyone who disagrees fills the other side. The smart contract holds escrow. Winner takes all minus a 2% taker fee — less than any house margin ever.'
        },
        'How SuiBets compares to every other model:',
        {
          type: 'table',
          headers: ['Model', 'Counterparty', 'Edge / Fee', 'Odds Control', 'Custody'],
          rows: [
            ['Traditional Sportsbook', 'House (always)', '5–15% margin', 'House sets all odds', 'Centralised — accounts can be limited'],
            ['Prediction Market (AMM)', 'Liquidity pool', 'Slippage + fees', 'AMM curve (no control)', 'Smart contract'],
            ['SuiBets P2P CLOB', 'Other users', '2% taker fee only', 'You set your own odds', 'On-chain escrow (Move)'],
          ]
        },
        'Key properties of the SuiBets order book model:',
        {
          type: 'steps',
          items: [
            'Maker posts an offer: stake amount, odds, match, side. Offer is held on-chain as a Move object (BetOffer<T>).',
            'Taker browses the open book and fills any offer. The contract atomically locks both stakes in escrow via a single PTB.',
            'Oracle settles the result post-match. The winning side receives both stakes minus the 2% protocol fee.',
            'FLUX engine enables partial fills — multiple takers can each fill a fraction of a large maker offer, just like a CLOB order.',
            'WARP engine enables parlay composition — multiple settled legs are combined atomically with weighted payout logic.',
          ]
        },
        {
          type: 'callout', variant: 'info',
          text: 'Zero house edge means the protocol never takes a position. The 2% fee is purely operational — it funds team, SBETS holder distributions, buybacks, and platform market-making. All fee flows are on-chain and auditable.'
        }
      ]
    },
    {
      id: 'architecture',
      title: 'Architecture & Object Model',
      badge: 'CORE',
      icon: <Cpu className="h-5 w-5 text-cyan-400" />,
      content: [
        'SuiBets is built natively on Sui\'s object-centric model. Every bet, offer, and position is a first-class Sui object — not a mapping in a smart contract\'s storage. This means offers can be transferred, displayed in wallets, and composed into PTBs without any wrapper indirection.',
        {
          type: 'callout', variant: 'tech',
          text: 'Sui objects have unique identity (UID), version, and digest. Shared objects allow concurrent access; owned objects provide exclusive possession. SuiBets uses both: BetPlatform is shared (multi-writer), BetOffer is owned by creator until accepted.'
        },
        'Core Move structs powering the protocol:',
        {
          type: 'code', lang: 'move', label: 'suibets::p2p — core objects',
          code: `/// Shared object — one instance, owned by the protocol
public struct BetPlatform has key {
    id: UID,
    admin_cap: address,
    fee_bps: u64,             // platform fee in basis points (200 = 2%)
    total_volume: u64,
    paused: bool,
}

/// Owned by creator until a taker accepts — then consumed
public struct BetOffer has key, store {
    id: UID,
    creator: address,
    event_id: vector<u8>,
    prediction: vector<u8>,
    odds_bps: u64,            // odds × 10_000 (e.g. 19000 = 1.90×)
    creator_stake: Balance<SUI>,
    taker_stake_required: u64,
    expires_at: u64,          // epoch ms — capped at match kickoff
    suins_gated: bool,
    live_odds: bool,
    share_token: Option<vector<u8>>,  // UUID for challenge links
}

/// Capability — minted once at deploy, required for all admin ops
public struct AdminCap has key, store { id: UID }

/// Oracle capability — minted by admin, handed to settlement worker
public struct OracleCap has key, store { id: UID }`
        },
        'The AdminCap and OracleCap follow Sui\'s One-Time Witness (OTW) pattern — they are non-duplicable capabilities that gate privileged entry points. Loss of AdminCap = loss of admin access with no recovery path.',
        {
          type: 'callout', variant: 'info',
          text: 'OracleCap can be delegated to a hot wallet used exclusively for settlement, keeping AdminCap in cold storage. This is the recommended production setup.'
        }
      ]
    },
    {
      id: 'ptb-composition',
      title: 'Programmable Transaction Blocks (PTBs)',
      badge: 'SUI NATIVE',
      icon: <GitBranch className="h-5 w-5 text-violet-400" />,
      content: [
        'Every meaningful action on SuiBets is a single PTB — not multiple transactions. PTBs let us compose escrow lock + oracle validation + conditional payout into one atomic, gas-efficient transaction that either fully succeeds or fully reverts.',
        'Creating a P2P offer — the full on-chain flow in one PTB:',
        {
          type: 'code', lang: 'typescript', label: 'frontend — create offer PTB',
          code: `import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';

async function buildCreateOfferPTB(params: {
  creatorWallet: string;
  stakeAmountMist: bigint;
  oddsBps: number;          // e.g. 19000 for 1.90×
  expiresAt: number;        // match kickoff epoch ms
  eventId: string;
  prediction: string;
  suinsGated: boolean;
  shareToken: string;       // UUID from server
}): Promise<Transaction> {
  const tx = new Transaction();
  tx.setSender(params.creatorWallet);

  // Split exact stake from gas coin — no separate coin management
  const [stakeCoin] = tx.splitCoins(tx.gas, [params.stakeAmountMist]);

  // Call Move entry function — returns BetOffer object
  const [offer] = tx.moveCall({
    target: \`\${PACKAGE_ID}::p2p::create_offer\`,
    arguments: [
      tx.object(PLATFORM_ID),        // shared BetPlatform
      stakeCoin,
      tx.pure.u64(params.oddsBps),
      tx.pure.u64(params.expiresAt),
      tx.pure.string(params.eventId),
      tx.pure.string(params.prediction),
      tx.pure.bool(params.suinsGated),
      tx.pure.option('vector<u8>',
        new TextEncoder().encode(params.shareToken)),
    ],
  });

  // Transfer owned BetOffer to creator — visible in wallet
  tx.transferObjects([offer], params.creatorWallet);
  return tx;
}`
        },
        'Settlement PTB — oracle resolves winner and triggers payout atomically:',
        {
          type: 'code', lang: 'typescript', label: 'settlement worker — settle PTB',
          code: `async function buildSettlePTB(
  offerId: string,
  matchId: string,
  winnerSide: 'creator' | 'taker',
  oracleCapId: string
): Promise<Transaction> {
  const tx = new Transaction();

  // Receive the shared BetOffer object (now a shared object after match)
  tx.moveCall({
    target: \`\${PACKAGE_ID}::p2p::settle_offer\`,
    arguments: [
      tx.object(PLATFORM_ID),
      tx.object(offerId),          // BetOffer — consumed on settlement
      tx.object(oracleCapId),      // OracleCap — proves settlement authority
      tx.pure.string(matchId),
      tx.pure.bool(winnerSide === 'creator'),
    ],
    // Move returns nothing; payout transferred internally via transfer::public_transfer
  });
  return tx;
}`
        },
        {
          type: 'callout', variant: 'tech',
          text: 'PTBs are the killer primitive: splitting coins, calling Move, and transferring outputs happen in sequence within one consensus round. Gas is paid once. Failed settlement reverts the entire block — no partial state.'
        }
      ]
    },
    {
      id: 'parallel-execution',
      title: 'Parallel Execution & P2P Parlays',
      badge: 'NARWHAL',
      icon: <Zap className="h-5 w-5 text-amber-400" />,
      content: [
        'Sui\'s DAG-based mempool (Narwhal) and BFT consensus (Bullshark) execute non-conflicting transactions in parallel. SuiBets P2P parlays are designed to exploit this: each leg is a separate owned object with no shared state dependency — they literally run on different CPUs.',
        {
          type: 'callout', variant: 'tech',
          text: 'Two transactions conflict only if they touch the same shared object or a common owned object. Parlay legs touch different BetOffer UIDs — zero conflicts, maximum parallelism.'
        },
        'Parlay architecture — how multi-leg bets map to Sui objects:',
        {
          type: 'code', lang: 'move', label: 'suibets::parlay',
          code: `public struct ParlayTicket has key, store {
    id: UID,
    creator: address,
    taker: Option<address>,
    legs: vector<BetLegRef>,       // references to per-leg BetOffer IDs
    combined_odds_bps: u64,        // product of all leg odds
    status: u8,                    // 0=open 1=matched 2=settled
}

public struct BetLegRef has store, copy, drop {
    offer_id: address,
    event_id: vector<u8>,
    prediction: vector<u8>,
    settled: bool,
    creator_won: bool,
}

/// Called once per leg — no dependency between calls
/// These can be submitted in the same consensus round in parallel
public entry fun settle_parlay_leg(
    ticket: &mut ParlayTicket,
    leg_index: u64,
    oracle_cap: &OracleCap,
    creator_won: bool,
    ctx: &TxContext,
) {
    let leg = vector::borrow_mut(&mut ticket.legs, leg_index);
    assert!(!leg.settled, EAlreadySettled);
    leg.settled = true;
    leg.creator_won = creator_won;

    // Check if all legs settled — trigger payout if so
    if (all_legs_settled(ticket)) {
        finalize_parlay(ticket, ctx);
    }
}`
        },
        'The settlement worker submits one `settle_parlay_leg` transaction per leg concurrently. Because each call only mutates the `ParlayTicket` shared object (different field per leg), Sui\'s object scheduler can pipeline them without serialization.',
        {
          type: 'table',
          headers: ['Leg Count', 'Sequential Latency', 'Parallel Latency', 'Gas Saved'],
          rows: [
            ['2 legs', '~800ms', '~420ms', '~38%'],
            ['4 legs', '~1600ms', '~440ms', '~73%'],
            ['6 legs', '~2400ms', '~460ms', '~81%'],
          ]
        }
      ]
    },
    {
      id: 'warp-engine',
      title: 'WARP Engine — Weighted Atomic Resolution Protocol',
      badge: 'WARP',
      icon: <Layers className="h-5 w-5 text-orange-400" />,
      content: [
        'The WARP Engine is SuiBets\' custom settlement infrastructure — a companion Move module (p2p_betting::warp_engine) that ships in the same package as the core P2P contracts. Same-package placement gives WARP direct cross-module access to every type and public function in the core contract, enabling innovations that a separate package could not implement.',
        {
          type: 'callout', variant: 'tech',
          text: 'WARP = Weighted Atomic Resolution Protocol. Three innovations: (1) WarpEscrow — owned per-user object using Transfer-to-Object for zero-consensus deposits. (2) warp_settle_parlay_atomic — all parlay legs in one PTB call, 83% gas reduction. (3) warp_batch_marker — oracle packs 512 instant_settle_bet calls into one PTB, 67% gas/bet reduction at scale.'
        },
        '── Innovation 1: WarpEscrow (Transfer-to-Object) ──',
        'Every user creates one WarpEscrow — an OWNED object, not shared. Sui\'s owned-object fastpath means all deposit and withdraw operations bypass the consensus round entirely, executing at single-validator speed (~50ms vs ~400ms for shared objects). The escrow holds any number of coin types simultaneously via a dynamic-field Bag keyed by TypeName.',
        {
          type: 'code', lang: 'move', label: 'warp_engine.move — WarpEscrow + TTO receive',
          code: `/// Owned per-user — zero consensus for deposit/withdraw.
/// Multi-coin: Bag keyed by TypeName holds SUI, USDC, SBETS, etc.
public struct WarpEscrow has key {
    id:        UID,
    owner:     address,
    balances:  Bag,    // TypeName → Balance<T>
    bet_count: u64,    // cumulative bets posted from this escrow
    win_count: u64,    // cumulative wins received
}

/// Transfer-to-Object receive — absorb winnings sent to this escrow.
/// Oracle does: transfer::public_transfer(payout_coin, escrow_id).
/// User then calls this to fold the coin into their escrow balance.
/// Entire round-trip: zero shared-object consensus.
public entry fun receive_winnings_to_escrow<T>(
    escrow:   &mut WarpEscrow,
    incoming: Receiving<Coin<T>>,   // TTO ticket from the transfer
    clock:    &Clock,
    ctx:      &mut TxContext,
) {
    assert!(ctx.sender() == escrow.owner, EUnauthorized);
    // sui::transfer::public_receive — the TTO primitive
    let coin   = transfer::public_receive(&mut escrow.id, incoming);
    let key    = type_name::get<T>();
    if (escrow.balances.contains(key)) {
        escrow.balances.borrow_mut<TypeName, Balance<T>>(key)
              .join(coin.into_balance());
    } else {
        escrow.balances.add(key, coin.into_balance());
    };
    escrow.win_count = escrow.win_count + 1;
}`
        },
        'warp_spend_from_escrow is a non-entry public function — it returns Coin<T> directly. PTBs can use this output as the payment argument for post_offer in the very next command, so funds flow from escrow to on-chain offer without ever touching the user\'s wallet:',
        {
          type: 'code', lang: 'typescript', label: 'PTB — escrow → post_offer chained (zero intermediate transfer)',
          code: `const tx = new Transaction();

// Step 1: spend from escrow — returns Coin<T> as a PTB result
const [coin] = tx.moveCall({
  target:        \`\${WARP_PKG}::warp_engine::warp_spend_from_escrow\`,
  typeArguments: [SUI_COIN_TYPE],
  arguments: [
    tx.object(myEscrowId),        // owned WarpEscrow — fastpath
    tx.pure.u64(stakeAmountMist),
  ],
});

// Step 2: pass the coin directly into post_offer — one PTB, one tx
tx.moveCall({
  target:        \`\${P2P_PKG}::p2p_betting::post_offer\`,
  typeArguments: [SUI_COIN_TYPE],
  arguments: [
    tx.object(CONFIG_ID),   // shared P2PConfig
    tx.object(REGISTRY_ID), // shared P2PRegistry
    coin,                   // ← output from step 1, no wallet detour
    tx.pure.vector('u8', encode(eventId)),
    tx.pure.vector('u8', encode(eventName)),
    tx.pure.vector('u8', encode(prediction)),
    tx.pure.vector('u8', encode(marketType)),
    tx.pure.u64(oddsBps),
    tx.pure.u64(expiresAt),
    tx.object(CLOCK_ID),
  ],
});
// One transaction. Coin never left the chain.`
        },
        '── Innovation 2: Atomic Parlay Settlement ──',
        {
          type: 'callout', variant: 'warn',
          text: 'Baseline parlay flow: N × settle_parlay_leg + queue_finalize_parlay + claim_parlay = N + 2 separate transactions. A 4-leg parlay costs 6 consensus rounds. WARP collapses this to 1.'
        },
        'warp_settle_parlay_atomic takes all leg results in one call — leg_results: vector<bool> (won/lost) and void_legs: vector<bool> (cancelled). It loops through all legs via cross-module calls, computes maker_wins = !any_lost, then immediately calls instant_settle_parlay to finalize and pay the winner — all in a single Move function execution:',
        {
          type: 'code', lang: 'move', label: 'warp_engine.move — atomic parlay settlement',
          code: `/// Settle ALL parlay legs + finalize in ONE PTB call.
/// leg_results[i] = true  → maker's prediction on leg i was correct
/// void_legs[i]   = true  → leg i voided (match cancelled); overrides leg_results
public entry fun warp_settle_parlay_atomic<T>(
    oracle_cap:  &OracleCap,
    config:      &mut P2PConfig,
    registry:    &mut P2PRegistry,
    parlay:      &mut P2PParlay<T>,
    leg_results: vector<bool>,
    void_legs:   vector<bool>,
    clock:       &Clock,
    ctx:         &mut TxContext,
) {
    let num_legs = parlay_num_legs(parlay);       // public view fn
    assert!(leg_results.length() == num_legs, EInvalidLegCount);

    let mut i = 0u64; let mut any_lost = false;

    while (i < num_legs) {
        if (*void_legs.borrow(i)) {
            // Cross-module call — same package, no extra consensus
            p2p_betting::p2p_betting::void_parlay_leg(oracle_cap, parlay, i, clock);
        } else {
            let leg_won = *leg_results.borrow(i);
            p2p_betting::p2p_betting::settle_parlay_leg(
                oracle_cap, parlay, i, leg_won, clock
            );
            if (!leg_won) { any_lost = true; };
        };
        i = i + 1;
    };

    let maker_wins = !any_lost;
    event::emit(WarpParlayAtomicSettled {
        parlay_id: object::id(parlay), legs_verified: num_legs,
        maker_wins, timestamp: clock.timestamp_ms(),
    });

    // Immediately finalize — winner paid in this same transaction
    p2p_betting::p2p_betting::instant_settle_parlay(
        oracle_cap, config, registry, parlay, maker_wins, clock, ctx
    );
}`
        },
        {
          type: 'table',
          headers: ['Legs', 'Baseline (N+2 txs)', 'WARP (1 tx)', 'Gas Saved'],
          rows: [
            ['2-leg parlay', '4 transactions', '1 transaction', '75%'],
            ['3-leg parlay', '5 transactions', '1 transaction', '80%'],
            ['4-leg parlay', '6 transactions', '1 transaction', '83%'],
            ['6-leg parlay', '8 transactions', '1 transaction', '88%'],
            ['8-leg parlay', '10 transactions', '1 transaction', '90%'],
          ]
        },
        '── Innovation 3: PTB Batch Settlement + WarpStats ──',
        'The oracle backend assembles PTBs with up to 512 instant_settle_bet calls. The first command in the PTB is warp_batch_marker — it records the batch count in the shared WarpStats object and emits a WarpBatchSettled event. All 512 bets then settle in order, atomically. If any single bet reverts, the entire PTB rolls back:',
        {
          type: 'code', lang: 'typescript', label: 'warpEngineService.ts — build batch PTB',
          code: `export function buildBatchSettlePTB(specs: BetSettleSpec[]): Transaction {
  // specs: [{ betObjectId, makerWins, coinType? }, ...] — up to 512 entries
  const tx = new Transaction();

  // Command 0: warp_batch_marker — records batch in WarpStats, emits event
  if (WARP_STATS_ID) {
    tx.moveCall({
      target:    \`\${WARP_PKG}::warp_engine::warp_batch_marker\`,
      arguments: [
        tx.object(WARP_STATS_ID),
        tx.pure.u64(specs.length),  // count
        tx.pure.u64(0),             // voided
        tx.object(CLOCK_ID),
      ],
    });
  }

  // Commands 1…N: settle each bet
  for (const spec of specs) {
    tx.moveCall({
      target:         \`\${P2P_PKG}::p2p_betting::instant_settle_bet\`,
      typeArguments:  [spec.coinType ?? SUI_COIN_TYPE],
      arguments: [
        tx.object(ORACLE_CAP_ID),
        tx.object(CONFIG_ID),
        tx.object(REGISTRY_ID),
        tx.object(spec.betObjectId),
        tx.pure.bool(spec.makerWins),
        tx.object(CLOCK_ID),
      ],
    });
  }

  tx.setGasBudget(200_000_000);  // 0.2 SUI — enough for 512 settles
  return tx;
}`
        },
        {
          type: 'table',
          headers: ['Batch Size', 'Gas Total', 'Gas / Bet', 'Savings vs Baseline'],
          rows: [
            ['1 (baseline)', '0.0015 SUI', '0.001500 SUI', '—'],
            ['10 bets', '0.0060 SUI', '0.000600 SUI', '60%'],
            ['50 bets', '0.0260 SUI', '0.000520 SUI', '65%'],
            ['100 bets', '0.0510 SUI', '0.000510 SUI', '66%'],
            ['512 bets', '0.2570 SUI', '0.000502 SUI', '67%'],
          ]
        },
        {
          type: 'callout', variant: 'tech',
          text: 'Peak throughput: 1,280 bets/second at batch-512 and one PTB per 400ms Sui block. Gas amortisation: fixed tx overhead (signature verify, epoch check) is paid once across all N settles. At batch-100, marginal gas per bet drops 66% vs single-bet settlement.'
        },
        '── Sui tech inventory used in WARP ──',
        {
          type: 'table',
          headers: ['Sui Primitive', 'Where Used', 'Benefit'],
          rows: [
            ['sui::transfer::Receiving (TTO)', 'receive_winnings_to_escrow', 'Win payouts to escrow = zero consensus'],
            ['Owned-object fastpath', 'WarpEscrow (has key, owned)', '~8× faster deposit/withdraw vs shared'],
            ['Non-entry public fun', 'warp_spend_from_escrow returns Coin<T>', 'PTB output chaining — coin never leaves chain'],
            ['Bag (dynamic-field)', 'WarpEscrow.balances', 'Multi-coin escrow in one object'],
            ['Same-package modules', 'warp_engine calls p2p_betting fns', 'Cross-module access with no extra deployment'],
            ['Move 2024.beta', 'Method syntax, macros, enums as u8', 'Readable code, struct upgrade safety'],
            ['PTB batching', 'buildBatchSettlePTB (512 calls)', 'One atomic tx settles 512 bets or zero'],
          ]
        },
        {
          type: 'callout', variant: 'info',
          text: 'WARP API: POST /api/warp/batch/settle — executes batch PTB. POST /api/warp/parlay/atomic — atomic parlay settle. POST /api/warp/benchmark — returns live gas model benchmark. GET /api/warp/health — WarpStats status. All routes live at /api/warp/.'
        }
      ]
    },
    {
      id: 'flux-engine',
      title: 'FLUX Engine — Fractional Liquidity Utilization eXchange',
      badge: 'FLUX',
      icon: <Layers className="h-5 w-5 text-blue-400" />,
      content: [
        'FLUX is SuiBets\' fractional-fill order book engine deployed as a standalone Move package on Sui mainnet. Where classic P2P requires a single taker to match the full maker stake, FLUX allows any number of takers to fill a maker\'s offer in partial shards — each shard is an independent on-chain object that settles atomically via the oracle.',
        {
          type: 'callout', variant: 'tech',
          text: 'FLUX = Fractional Liquidity Utilization eXchange. Three primitives: (1) FluxOffer — shared object holding maker\'s escrowed stake and fill metadata. (2) FluxShard — owned taker receipt per partial fill, settles independently. (3) flux_batch_close — oracle records aggregate settlement metrics in FluxStats.'
        },
        '── How it works ──',
        'A maker calls flux_create_offer with their full stake and desired odds. The offer becomes a shared object accessible to any taker. Each taker calls flux_fill_shard with a partial stake; the contract issues them a FluxShard receipt and calls flux_confirm_fill to atomically record the fill on the offer. The oracle independently settles every shard with flux_settle_shard — winners receive their proportional payout immediately.',
        {
          type: 'code', lang: 'move', label: 'flux_engine.move — core entry functions',
          code: `/// Maker posts a fractional offer. Coin<T> is escrowed on-chain.
public entry fun flux_create_offer<T>(
    stake:     Coin<T>,          // maker's full stake (escrowed)
    event_id:  vector<u8>,
    prediction: vector<u8>,
    odds_bps:  u64,              // 10_000 = 1.0x, 20_000 = 2.0x
    min_shard: u64,              // 0 = any size
    stats:     &mut FluxStats,
    clock:     &Clock,
    ctx:       &mut TxContext,
)

/// Taker fills a shard. Returns a FluxShard receipt.
public fun flux_fill_shard<T>(
    offer:  &mut FluxOffer<T>,
    stake:  Coin<T>,             // taker's partial stake
    clock:  &Clock,
    ctx:    &mut TxContext,
): FluxFillReceipt                // PTB-chainable receipt

/// Oracle settles one shard — pays winner immediately.
public entry fun flux_settle_shard<T>(
    _cap:      &OracleCap,
    shard:     FluxShard<T>,     // consumed on settlement
    taker_wins: bool,
    stats:     &mut FluxStats,
    clock:     &Clock,
    ctx:       &mut TxContext,
)`
        },
        {
          type: 'table',
          headers: ['Property', 'FLUX Value'],
          rows: [
            ['Package ID (mainnet)', '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018'],
            ['FluxStats object', '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320'],
            ['Oracle', 'Shared OracleCap — same wallet as WARP + PULSE'],
            ['Coin types', 'Generic <T> — SUI, USDC, SBETS, any Sui coin'],
            ['Min fill', 'Configurable per offer (0 = any size)'],
            ['Settlement', 'Per-shard atomic — independent of other shards on same offer'],
          ]
        },
        {
          type: 'callout', variant: 'info',
          text: 'FLUX settlement in one PTB: flux_settle_shard (taker wins → payout) + flux_batch_close (oracle metrics). Both share the same OracleCap reference — no version-race between sequential TXs.'
        }
      ]
    },
    {
      id: 'pulse-engine',
      title: 'PULSE Engine — Pari-mutuel Under-Liquidity Shifting Engine',
      badge: 'PULSE',
      icon: <Layers className="h-5 w-5 text-pink-400" />,
      content: [
        'PULSE is SuiBets\' dynamic-odds pool engine. Unlike FLUX (fixed-odds, maker vs takers) or WARP (binary bet settlement), PULSE runs a pari-mutuel model: all stakes on each side are pooled, and the winning side splits the losing side\'s pool proportionally. Odds shift in real time as liquidity flows between sides — a pure market-clearing mechanism with no house margin.',
        {
          type: 'callout', variant: 'tech',
          text: 'PULSE = Pari-mutuel Under-Liquidity Shifting Engine. Four primitives: (1) PulsePool — shared object with side_a and side_b balance pools. (2) PulsePosition — owned taker receipt tracking stake + side. (3) pulse_lock_pool + pulse_settle_pool in one PTB — oracle locks then resolves atomically. (4) pulse_claim_winnings — winner redeems proportional share.'
        },
        '── Dynamic odds model ──',
        'When a user takes a position, the effective odds are determined by the pool ratio at settlement time, not at entry time. If side_a has 100 SUI and side_b has 400 SUI, side_a winners receive 4× their stake (80% return from the other pool). This self-balancing mechanism ensures efficient price discovery without a market maker.',
        {
          type: 'code', lang: 'move', label: 'pulse_engine.move — pool lifecycle',
          code: `/// Creator seeds both sides — sets initial odds signal.
public entry fun pulse_create_pool<T>(
    seed_a:   Coin<T>,           // side A initial liquidity
    seed_b:   Coin<T>,           // side B initial liquidity
    event_id: vector<u8>,
    name_a:   vector<u8>,        // e.g. "Arsenal"
    name_b:   vector<u8>,        // e.g. "Chelsea"
    stats:    &mut PulseStats,
    clock:    &Clock,
    ctx:      &mut TxContext,
)

/// Anyone takes a position on either side.
public entry fun pulse_take_position<T>(
    pool:    &mut PulsePool<T>,
    stake:   Coin<T>,
    side:    u8,                 // 0 = SIDE_A, 1 = SIDE_B
    stats:   &mut PulseStats,
    clock:   &Clock,
    ctx:     &mut TxContext,
)

/// Oracle: lock then settle in ONE PTB — no version race on OracleCap.
public entry fun pulse_lock_pool<T>(
    _cap: &OracleCap, pool: &mut PulsePool<T>, clock: &Clock
)
public entry fun pulse_settle_pool<T>(
    _cap:   &OracleCap,
    pool:   &mut PulsePool<T>,
    winner: u8,                  // 0 = SIDE_A, 1 = SIDE_B
    stats:  &mut PulseStats,
    clock:  &Clock, ctx: &mut TxContext,
)

/// Winner claims proportional share of the losing pool.
public entry fun pulse_claim_winnings<T>(
    pool:     &mut PulsePool<T>,
    position: PulsePosition<T>,  // consumed — one claim per position
    clock:    &Clock,
    ctx:      &mut TxContext,
)`
        },
        {
          type: 'table',
          headers: ['Property', 'PULSE Value'],
          rows: [
            ['Package ID (mainnet)', '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238'],
            ['PulseStats object', '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff'],
            ['Oracle', 'Shared OracleCap — same wallet as WARP + FLUX'],
            ['Odds model', 'Pari-mutuel — dynamic, market-clearing, zero house margin'],
            ['Settlement', 'lock_pool + settle_pool in one PTB → atomic oracle resolution'],
            ['Payout', 'claim_winnings — winner\'s proportional share of losing pool'],
          ]
        },
        {
          type: 'callout', variant: 'info',
          text: 'Three engines, one oracle. WARP (batch settlement), FLUX (fractional fill), and PULSE (pari-mutuel pools) all share the same OracleCap object (0x4319c676…) and oracle wallet. The oracle backend routes each market type to the correct engine automatically.'
        }
      ]
    },
    {
      id: 'walrus-storage',
      title: 'Walrus — Decentralised Bet Receipt Storage',
      badge: 'WALRUS',
      icon: <Database className="h-5 w-5 text-sky-400" />,
      content: [
        'Walrus is the decentralised storage and data-availability layer of the Sui stack. SuiBets writes every settled bet to Walrus as an immutable JSON blob — the blob ID is stored on-chain, making the full bet receipt permanently verifiable by anyone without trusting SuiBets\' servers.',
        {
          type: 'callout', variant: 'tech',
          text: 'Walrus uses an erasure-coding scheme across independent storage nodes. Even if SuiBets disappears, a bet blob can be reconstructed from any 1/3 of the nodes that originally stored it. This is cryptographically stronger provenance than IPFS pinning.'
        },
        'How a Walrus receipt is created after settlement:',
        {
          type: 'steps',
          items: [
            'Oracle settles the bet on-chain → Sui emits a SettledEvent with bet metadata',
            'API server catches the event → assembles a JSON receipt: { betId, creator, taker, stake, odds, result, payoutTx, settledAt }',
            'Server calls Walrus Publisher API → receives a blobId (32-byte content hash)',
            'Server stores blobId in PostgreSQL bet record and optionally writes it to a Sui Move object via a PTB',
            'User visits /walrus-receipt/<blobId> — client fetches blob from Walrus aggregator and renders the signed receipt',
            'User can mint an NFT from the receipt: mintBetReceiptNFT(blobId) on-chain → receipt lives in their wallet forever',
          ]
        },
        {
          type: 'code', lang: 'typescript', label: 'api-server — write receipt to Walrus',
          code: `import { WalrusClient } from '@mysten/walrus';

const walrus = new WalrusClient({ network: 'mainnet' });

async function archiveBetReceipt(bet: SettledBet): Promise<string> {
  const receipt = {
    version: '1.0',
    betId:      bet.id,
    eventName:  bet.eventName,
    creator:    bet.creatorWallet,
    taker:      bet.takerWallet,
    prediction: bet.prediction,
    odds:       bet.odds,
    creatorStake: bet.creatorStake,
    takerStake:   bet.takerStake,
    winner:     bet.winner,
    payout:     bet.payout,
    settleTxHash: bet.settleTxHash,
    settledAt:  bet.settledAt.toISOString(),
  };

  // Store blob — epochs=5 keeps it alive for ~5 Sui epochs (~10 days)
  // Use a longer epoch count for high-value receipts
  const { blobId } = await walrus.writeBlob({
    blob: Buffer.from(JSON.stringify(receipt)),
    deletable: false,
    epochs: 5,
    signer: adminKeypair,
  });

  // Persist blobId so /walrus-receipt/:blobId can resolve it
  await db.update(settledBets)
    .set({ walrusBlobId: blobId })
    .where(eq(settledBets.id, bet.id));

  return blobId;
}`
        },
        {
          type: 'table',
          headers: ['Property', 'Value'],
          rows: [
            ['Storage protocol', 'Walrus (Mysten Labs) — mainnet live 2025'],
            ['Encoding', 'Erasure coding across distributed storage nodes'],
            ['Receipt format', 'JSON blob — human-readable, cryptographically content-addressed'],
            ['NFT minting', 'On-chain PTB mints BetReceiptNFT with blobId field — lives in user wallet'],
            ['Retrieval', 'GET /walrus-receipt/:blobId — fetched from Walrus aggregator, rendered client-side'],
            ['Permanence', 'Configurable by epoch count; high-value bets stored for 52+ epochs (~1 year)'],
          ]
        },
        {
          type: 'callout', variant: 'info',
          text: 'Walrus blobIds are the same on every node — deterministic content hashes. Two identical receipts produce identical blobIds. This means a user can independently verify their receipt by re-hashing the JSON and checking it matches the on-chain blobId.'
        }
      ]
    },
    {
      id: 'passkey-auth',
      title: 'Passkey — Biometric Sui Signing',
      badge: 'PASSKEY',
      icon: <Shield className="h-5 w-5 text-fuchsia-400" />,
      content: [
        'Passkey support went live on Sui mainnet on 7 August 2025 (SIP-9). SuiBets integrates PasskeyKeypair from @mysten/sui — users can sign transactions with Face ID, Touch ID, or a device PIN. No browser extension. No seed phrase. The ECDSA P-256 public key is stored in the device\'s secure enclave and never leaves the hardware.',
        {
          type: 'callout', variant: 'tech',
          text: 'Passkey = WebAuthn FIDO2 over the P-256 (secp256r1) curve. Sui validators accept P-256 signatures natively (flag 0x02). The user\'s Sui address is derived from the P-256 public key using the same hash-to-address path as Ed25519 — just a different key type flag.'
        },
        {
          type: 'steps',
          items: [
            'First visit: createPasskey() → browser prompts biometric → P-256 keypair generated in secure enclave → credentialId + publicKey stored in localStorage',
            'Returning visit: getPasskey(credentialId) reconstructs PasskeyKeypair from stored public key',
            'Sign tx: PasskeyKeypair.signTransaction(txBytes) → triggers Face ID / Touch ID prompt → returns ECDSA P-256 signature',
            'Submit: standard suiClient.signAndExecuteTransaction — validators verify P-256 sig natively',
          ]
        },
        {
          type: 'code', lang: 'typescript', label: 'passkey integration — sign a bet PTB',
          code: `import { PasskeyKeypair, BrowserPasskeyProvider } from '@mysten/sui/keypairs/passkey';

// ── Create (first time) ────────────────────────────────────────────────
const provider = new BrowserPasskeyProvider('SuiBets', {
  rpId: window.location.hostname,
});
const keypair = await PasskeyKeypair.createPasskey(provider);

// Persist for next visit
localStorage.setItem('passkey_credential_id', keypair.credentialId);
localStorage.setItem('passkey_public_key',    keypair.publicKey.toBase64());

// ── Reconstruct (returning) ────────────────────────────────────────────
const credentialId = localStorage.getItem('passkey_credential_id')!;
const pubKeyB64    = localStorage.getItem('passkey_public_key')!;
const keypair = await PasskeyKeypair.fromCredential(credentialId, pubKeyB64);

// ── Sign + execute ─────────────────────────────────────────────────────
const tx = buildCreateOfferPTB({ creatorWallet: keypair.toSuiAddress(), ...params });
const result = await suiClient.signAndExecuteTransaction({
  transaction: tx,
  signer: keypair,  // triggers Face ID / Touch ID prompt
});`
        },
        {
          type: 'table',
          headers: ['Auth Method', 'Extension needed', 'Seed phrase', 'UX friction', 'Security'],
          rows: [
            ['Hardware wallet', 'Yes (connector)', 'Optional', 'High', 'Highest'],
            ['Browser extension (Sui Wallet, Slipstream)', 'Yes', 'Yes (backup)', 'Medium', 'High'],
            ['zkLogin (Google / Apple)', 'No', 'No', 'Low', 'High (ZK proof)'],
            ['Passkey (Face ID / Touch ID)', 'No', 'No', 'Very low', 'High (secure enclave)'],
          ]
        }
      ]
    },
    {
      id: 'zksend-challenges',
      title: 'zkSend Challenge Links',
      badge: 'ZK',
      icon: <Link2 className="h-5 w-5 text-cyan-400" />,
      content: [
        'Every P2P offer generates a UUID share token on the server at creation time. The challenge URL `/p2p/c/<uuid>` resolves to the full offer — no wallet required to view, one tap to accept.',
        {
          type: 'code', lang: 'typescript', label: 'api-server — challenge token generation',
          code: `import { randomUUID } from 'crypto';

// Called inside POST /api/p2p/offers — before DB insert
function generateShareToken(): string {
  return randomUUID();  // RFC 4122 v4 UUID — 122 bits of entropy
}

// GET /api/p2p/challenge/:token
router.get('/challenge/:token', async (req, res) => {
  const offer = await db.query.p2pBetOffers.findFirst({
    where: and(
      eq(p2pBetOffers.shareToken, req.params.token),
      eq(p2pBetOffers.status, 'open'),
      gt(p2pBetOffers.expiresAt, new Date()),  // auto-rejects post-kickoff
    )
  });
  if (!offer) return res.status(404).json({ error: 'challenge_expired' });
  res.json({ offer, challengeUrl: \`/p2p/c/\${req.params.token}\` });
});`
        },
        'The token is opaque — it reveals nothing about the creator\'s wallet or offer ID. Resolution happens server-side with automatic expiry enforcement: no taker can accept after match_date regardless of link freshness.',
        {
          type: 'callout', variant: 'info',
          text: 'zkSend integration planned: challenge links will embed a sealed zkSend object containing taker stake, so the recipient can accept AND fund the bet from a single link — zero pre-existing wallet required.'
        }
      ]
    },
    {
      id: 'zklogin',
      title: 'zkLogin — OAuth → Sui Address',
      badge: 'ZK PROOF',
      icon: <Shield className="h-5 w-5 text-violet-400" />,
      content: [
        'SuiBets integrates Sui\'s native zkLogin, allowing users to derive a real Sui address from a Google OAuth JWT without ever exposing a seed phrase. The ZK proof prevents the identity provider from knowing what on-chain address belongs to which JWT subject.',
        'The cryptographic flow:',
        {
          type: 'steps',
          items: [
            'User authenticates with Google → receives a JWT (sub claim = opaque user identifier)',
            'Client generates an ephemeral Ed25519 keypair (valid for ≤ epoch + 2)',
            'Client computes: address = poseidon_bn254(jwt_sub, user_salt, key_claim_name) → then Sui hashes to a 32-byte address',
            'ZK proof generated (Groth16 over BN254) proving: "I hold a valid JWT whose sub hashes to this address" without revealing sub',
            'Transactions are signed with the ephemeral key + the ZK proof — valid for the current epoch window',
          ]
        },
        {
          type: 'code', lang: 'typescript', label: 'zkLogin — derive address + sign tx',
          code: `import {
  generateNonce, generateRandomness,
  getZkLoginSignature, jwtToAddress
} from '@mysten/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// 1 — Generate ephemeral keypair for this session
const ephemeralKeypair = new Ed25519Keypair();
const { epoch } = await suiClient.getLatestSuiSystemState();
const maxEpoch = Number(epoch) + 2;   // valid for ~2 epochs (~48h on mainnet)

// 2 — Build nonce to embed in Google OAuth request
const randomness = generateRandomness();
const nonce = generateNonce(
  ephemeralKeypair.getPublicKey(),
  maxEpoch,
  randomness
);
// → redirect user to: accounts.google.com/...&nonce=<nonce>

// 3 — After OAuth redirect, derive Sui address from JWT
const jwt = getJwtFromUrl();     // parse id_token from URL hash
const userSalt = getUserSalt();  // stored per-user, generated once
const suiAddress = jwtToAddress(jwt, userSalt);
// suiAddress is a real 0x... Sui address — deterministic per (sub, salt)

// 4 — Get ZK proof from Mysten's proving service (or self-hosted)
const zkProof = await fetch('https://prover-dev.mystenlabs.com/v1', {
  method: 'POST',
  body: JSON.stringify({
    jwt, extendedEphemeralPublicKey: ephemeralKeypair.getPublicKey().toBase64(),
    maxEpoch, jwtRandomness: randomness, salt: userSalt, keyClaimName: 'sub'
  })
}).then(r => r.json());

// 5 — Sign transaction + assemble zkLogin signature
const tx = buildCreateOfferPTB({ creatorWallet: suiAddress, ...params });
const txBytes = await tx.build({ client: suiClient });
const ephemeralSig = await ephemeralKeypair.signTransaction(txBytes);

const zkLoginSig = getZkLoginSignature({
  inputs: { ...zkProof, addressSeed: computeAddressSeed(jwt, userSalt) },
  maxEpoch,
  userSignature: ephemeralSig.signature,
});
// Submit: { txBytes, signature: zkLoginSig } → Sui RPC`
        },
        {
          type: 'callout', variant: 'tech',
          text: 'The ZK proof is Groth16 over BN254 (~150ms to generate client-side with WASM). The resulting zkLogin signature is ~2KB and verified by validators using the same BN254 pairing check. No trusted setup per-app — the ceremony is shared across all zkLogin users on Sui.'
        }
      ]
    },
    {
      id: 'sponsored-tx',
      title: 'Sponsored Gas — Dual-Sig PTBs',
      badge: 'GASLESS',
      icon: <Fuel className="h-5 w-5 text-amber-400" />,
      content: [
        'Sui\'s sponsored transaction model separates `sender` (who signs the payload) from `gasOwner` (who provides the gas coin). SuiBets uses this to let new zkLogin users with zero SUI accept offers the moment they arrive on-chain.',
        {
          type: 'code', lang: 'typescript', label: 'dual-sig sponsored flow',
          code: `// ── STEP 1: Frontend builds transaction ──────────────────────────────
const tx = new Transaction();
tx.setSender(userAddress);     // zkLogin user — signs payload
tx.setGasBudget(10_000_000);   // 0.01 SUI budget

tx.moveCall({
  target: \`\${PACKAGE_ID}::p2p::accept_offer\`,
  arguments: [tx.object(PLATFORM_ID), tx.object(offerId), takerCoin],
});

// ── STEP 2: Fetch sponsor address + gas object from server ────────────
const { sponsorAddress, gasObjectId } = await fetch('/api/p2p/sponsor-address')
  .then(r => r.json());

tx.setGasOwner(sponsorAddress);   // admin wallet pays gas
tx.setGasPayment([{               // explicit gas coin from sponsor
  objectId: gasObjectId, version, digest
}]);

// ── STEP 3: Serialize — user signs ONLY the payload bytes ────────────
const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: false });
const userSig = await zkLoginSign(txBytes);     // ephemeral key + ZK proof

// ── STEP 4: Server co-signs as gas owner ─────────────────────────────
// POST /api/p2p/sponsor-gas  { txBytes: base64(txBytes), userSig }
const { sponsorSig } = await fetch('/api/p2p/sponsor-gas', {
  method: 'POST',
  body: JSON.stringify({ txBytes: toBase64(txBytes), userSig })
}).then(r => r.json());

// ── STEP 5: Submit with both signatures ──────────────────────────────
await suiClient.executeTransactionBlock({
  transactionBlock: txBytes,
  signature: [userSig, sponsorSig],  // order matters — user first, sponsor second
});`
        },
        {
          type: 'callout', variant: 'warn',
          text: 'Gas sponsorship is scoped to P2P accept and create flows. The server validates transaction intent before co-signing — it parses the PTB MoveCall target and rejects anything that isn\'t a known SuiBets entry point. This prevents gas draining attacks.'
        },
        {
          type: 'table',
          headers: ['User Type', 'SUI Balance Needed', 'Can Place Bets?', 'Mechanism'],
          rows: [
            ['Wallet user (SUI)', '>0 SUI', '✓ Yes', 'Self-funded gas'],
            ['zkLogin (Google) + USDC', '0 SUI', '✓ Yes', 'Sponsored gas'],
            ['zkLogin (Google) + zero', '0 SUI', '✗ No', 'No taker stake'],
          ]
        }
      ]
    },
    {
      id: 'suins-vip',
      title: 'SuiNS VIP Pools — On-Chain Name Resolution',
      badge: 'SUINS',
      icon: <Star className="h-5 w-5 text-violet-400" />,
      content: [
        'VIP-gated offers require the taker to own a `.sui` domain registered on SuiNS. Verification calls the SuiNS registry object on-chain — no centralized API, no spoofable claims.',
        {
          type: 'code', lang: 'typescript', label: 'SuiNS resolution — server-side check',
          code: `import { SuinsClient } from '@mysten/suins';

const suinsClient = new SuinsClient({
  client: suiClient,
  network: 'mainnet',
});

async function walletOwnsAnyDotSui(wallet: string): Promise<boolean> {
  // Query the SuiNS registry — returns owned Name objects
  const names = await suinsClient.getAllNames(wallet);
  // names: Array<{ name: string; expirationTimestamp: number; ... }>
  return names.length > 0 && names.some(n => {
    const expiry = new Date(n.expirationTimestamp);
    return expiry > new Date();   // filter expired names
  });
}

// Called inside POST /api/p2p/offers/:id/accept
// GET /api/p2p/suins/check/:wallet — cached 5 min per wallet
router.get('/suins/check/:wallet', async (req, res) => {
  const hasName = await walletOwnsAnyDotSui(req.params.wallet);
  res.json({ qualified: hasName, wallet: req.params.wallet });
});`
        },
        '.sui names are non-trivial to acquire: requires owning SUI, paying a yearly registration fee on suins.io, and completing an on-chain transaction. VIP pools naturally filter throwaway wallets and attract serious P2P liquidity.',
        {
          type: 'table',
          headers: ['Tier', 'Requirement', 'Platform Fee', 'Access'],
          rows: [
            ['Standard', 'Any wallet', '2.00%', 'All offers'],
            ['VIP', 'Own ≥1 active .sui name', '0.30%', 'VIP + standard offers'],
          ]
        }
      ]
    },
    {
      id: 'live-odds',
      title: 'Live In-Play Odds — WebSocket Architecture',
      badge: 'REAL-TIME',
      icon: <Radio className="h-5 w-5 text-green-400" />,
      content: [
        'The `liveOddsService` runs a 15s polling loop against ESPN free endpoints, computes probability deltas, and broadcasts to all connected clients via WebSocket on the `live-odds` channel.',
        {
          type: 'code', lang: 'typescript', label: 'liveOddsService.ts — probability model',
          code: `interface LiveMatchState {
  homeScore: number; awayScore: number;
  minute: number; status: 'live' | 'ht' | 'ft';
}

function computeImpliedOdds(state: LiveMatchState, baseOdds: {
  home: number; draw: number; away: number;
}) {
  const { homeScore, awayScore, minute } = state;
  const diff = homeScore - awayScore;
  const timeWeight = Math.min(minute / 90, 1);   // 0→1 as match progresses

  // Shift implied probability based on score delta × time elapsed
  // diff=+1 at min 70 → ~85% win probability for leading team
  const scoreFactor = diff * 0.12 * timeWeight;

  const rawHome = (1 / baseOdds.home) + scoreFactor;
  const rawAway = (1 / baseOdds.away) - scoreFactor;
  const rawDraw  = 1 - rawHome - rawAway;

  // Apply 5% overround (bookmaker margin), floor odds at 1.02
  const margin = 1.05;
  return {
    home: Math.max(margin / rawHome,  1.02),
    draw: Math.max(margin / rawDraw,  1.02),
    away: Math.max(margin / rawAway,  1.02),
    liveMinute: minute,
    score: \`\${homeScore}-\${awayScore}\`,
  };
}

// Broadcast pattern — wsService wraps ws.Server
wsService.broadcast('live-odds', {
  updates: liveMatches.map(m => ({
    eventId: m.id,
    odds: computeImpliedOdds(m.state, m.baseOdds),
    ts: Date.now(),
  })),
  ts: Date.now(),
});`
        },
        {
          type: 'code', lang: 'typescript', label: 'frontend — WebSocket subscription',
          code: `// In P2P hub — subscribes on mount, cleans up on unmount
useEffect(() => {
  const ws = new WebSocket(\`wss://\${window.location.host}/ws\`);

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type !== 'live-odds') return;

    setLiveOdds(prev => {
      const next = { ...prev };
      for (const update of msg.updates) {
        next[update.eventId] = update.odds;   // merge into keyed map
      }
      return next;
    });
  };

  return () => ws.close();
}, []);

// Offer cards read from liveOdds[offer.eventId] — shows live badge + delta
const currentOdds = liveOdds[offer.eventId] ?? null;`
        },
        {
          type: 'callout', variant: 'info',
          text: 'REST fallback at GET /api/p2p/live-odds returns the latest broadcast snapshot. Clients that reconnect after a broadcast get the last known state immediately, then switch to WebSocket for deltas.'
        }
      ]
    },
    {
      id: 'p2p-order-book',
      title: 'P2P Order Book — Settlement Oracle',
      badge: 'P2P',
      icon: <TrendingUp className="h-5 w-5 text-green-400" />,
      content: [
        'The core P2P model: creator locks stake on-chain → taker fills opposite side → oracle resolves winner → escrow releases. Zero house edge, zero custody after creation.',
        {
          type: 'code', lang: 'move', label: 'p2p::accept_offer — taker side',
          code: `public entry fun accept_offer(
    platform: &mut BetPlatform,
    offer: &mut BetOffer,    // shared after creation — concurrent access safe
    taker_coin: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let taker = tx_context::sender(ctx);
    let now = tx_context::epoch_timestamp_ms(ctx);

    // Hard expiry — no race condition possible on-chain
    assert!(now < offer.expires_at, EOfferExpired);
    assert!(offer.taker.is_none(),  EAlreadyFilled);

    // If suins_gated, taker must prove ownership before calling this
    // (verified server-side; on-chain we trust the gating flag)
    let required = offer.taker_stake_required;
    assert!(coin::value(&taker_coin) == required, EWrongStake);

    // Lock taker stake alongside creator stake in the offer object
    balance::join(&mut offer.taker_stake, coin::into_balance(taker_coin));
    offer.taker = option::some(taker);

    event::emit(OfferFilled {
        offer_id: object::id(offer),
        creator: offer.creator,
        taker,
        total_pot: balance::value(&offer.creator_stake) + required,
    });
}`
        },
        {
          type: 'code', lang: 'move', label: 'p2p::settle_offer — oracle payout',
          code: `public entry fun settle_offer(
    platform: &mut BetPlatform,
    offer: &mut BetOffer,
    _oracle: &OracleCap,       // non-copyable capability — proves authority
    creator_won: bool,
    ctx: &mut TxContext,
) {
    assert!(offer.taker.is_some(), ENotFilled);
    assert!(offer.status == STATUS_ACTIVE, EAlreadySettled);
    offer.status = STATUS_SETTLED;

    let total = balance::value(&offer.creator_stake)
              + balance::value(&offer.taker_stake);

    // Fee: 200bps (2%) on total pot; VIP offers: 30bps (0.3%)
    let fee_bps = if (offer.suins_gated) { 30 } else { platform.fee_bps };
    let fee = (total * fee_bps) / 10_000;
    let payout = total - fee;

    let winner = if (creator_won) { offer.creator }
                 else { *option::borrow(&offer.taker) };

    // Extract full balances, send payout in one transfer
    let pot = balance::split(&mut offer.creator_stake, payout);
    transfer::public_transfer(coin::from_balance(pot, ctx), winner);

    // Fee stays in platform treasury
    balance::join(&mut platform.treasury, balance::withdraw_all(&mut offer.creator_stake));
    balance::join(&mut platform.treasury, balance::withdraw_all(&mut offer.taker_stake));

    event::emit(OfferSettled { offer_id: object::id(offer), winner, payout, fee });
}`
        },
        {
          type: 'table',
          headers: ['Action', 'Gas (approx)', 'Object touched', 'Parallelizable?'],
          rows: [
            ['create_offer', '~0.002 SUI', 'BetPlatform (shared), new BetOffer (owned)', '✓ Yes'],
            ['accept_offer', '~0.003 SUI', 'BetOffer (now shared)', '✓ Different offers yes'],
            ['settle_offer', '~0.002 SUI', 'BetOffer (final write)', '✓ Yes'],
            ['settle_parlay_leg', '~0.002 SUI', 'ParlayTicket (shared)', '✓ Different legs yes'],
          ]
        }
      ]
    },
    {
      id: 'security',
      title: 'Security Model',
      badge: 'SECURITY',
      icon: <Shield className="h-5 w-5 text-red-400" />,
      content: [
        'Multi-layer security: on-chain capability guards + server-side anti-exploit + DB constraints + rate limiting.',
        {
          type: 'callout', variant: 'warn',
          text: 'All entry points that mutate state require either AdminCap or OracleCap. There is no admin-by-address pattern — losing the capability object loses admin access permanently.'
        },
        {
          type: 'code', lang: 'move', label: 'anti-exploit patterns',
          code: `// ── Time-lock: server sets expiry = match_date, on-chain enforces it ──
assert!(tx_context::epoch_timestamp_ms(ctx) < offer.expires_at, EExpired);

// ── No self-fill: creator cannot take their own offer ─────────────────
assert!(tx_context::sender(ctx) != offer.creator, ESelfFill);

// ── Exact stake: no partial fills, no tip attacks ─────────────────────
assert!(coin::value(&taker_coin) == offer.taker_stake_required, EWrongStake);

// ── Re-entrancy: status flag prevents double-settlement ───────────────
assert!(offer.status == STATUS_ACTIVE, EAlreadySettled);
offer.status = STATUS_SETTLING;   // set before any transfers
// ... perform transfer ...
offer.status = STATUS_SETTLED;`
        },
        'Server-side rejection codes — returned before any on-chain call:',
        {
          type: 'table',
          headers: ['Code', 'Trigger', 'Layer'],
          rows: [
            ['EVENT_NOT_FOUND', 'Unknown event ID submitted', 'API'],
            ['MATCH_TIME_EXCEEDED', 'Bet submitted after match start', 'API'],
            ['STALE_EVENT_DATA', 'Last refresh > 3 hours ago', 'API'],
            ['SUINS_NOT_QUALIFIED', 'Taker has no .sui name for VIP offer', 'API'],
            ['DUPLICATE_TX_HASH', 'txHash reuse attempt detected', 'DB + memory Set'],
            ['MAX_STAKE_EXCEEDED', 'Stake > 100 SUI or 10M SBETS', 'API'],
            ['RATE_LIMITED', '> 20 bets / hour per wallet', 'API'],
          ]
        }
      ]
    },
    {
      id: 'technology',
      title: 'Technology Stack',
      badge: 'STACK',
      icon: <Code2 className="h-5 w-5 text-yellow-400" />,
      content: [
        {
          type: 'table',
          headers: ['Layer', 'Technology', 'Why'],
          rows: [
            ['L1 Blockchain', 'Sui Mainnet (Move 2024)', 'Object model, PTBs, parallel exec, zkLogin native'],
            ['Smart Contracts', 'Move 2024 — method syntax, enums, macros', 'Type safety, capability pattern, no reentrancy'],
            ['Sui SDK', '@mysten/sui v1.x, @mysten/zklogin', 'PTB builder, ZK proof assembly, sponsored tx'],
            ['Frontend', 'React 18 + Vite + TypeScript + TailwindCSS', 'HMR, tree-shaking, typed PTB construction'],
            ['Backend', 'Express + TypeScript + Drizzle ORM', 'RESTful API, WebSocket broadcast, settlement worker'],
            ['Database', 'PostgreSQL (Drizzle ORM)', 'ACID transactions, unique indexes, typed schema'],
            ['DEX Mirror', 'DeepBook v3 SDK', 'P2P offers mirrored as limit orders for price discovery'],
            ['Name Service', 'SuiNS (@mysten/suins)', 'On-chain .sui name resolution for VIP gating'],
            ['Storage', 'Walrus (blob archival)', 'Settled bets stored as permanent blobs; receipt NFTs reference on-chain blob IDs'],
            ['Auth (biometric)', 'Passkey — @mysten/sui PasskeyKeypair', 'Face ID / Touch ID via WebAuthn P-256; no extension, no seed phrase'],
            ['Sports Data', 'ESPN free API + API-Sports', '30+ sports, live scores, 7-day lookahead'],
          ]
        },
        {
          type: 'code', lang: 'bash', label: 'run locally',
          code: `# Clone and install
git clone https://github.com/suibets/suibets && cd suibets
pnpm install

# Required env vars
export DATABASE_URL=postgresql://...
export ADMIN_PRIVATE_KEY=suiprivkey1...  # platform gas sponsor
export ADMIN_WALLET_ADDRESS=0x...
export API_SPORTS_KEY=...

# Start both services
pnpm --filter @workspace/api-server run dev   # port 8080
pnpm --filter @workspace/suibets   run dev   # port 5000

# Apply schema to local DB
cd artifacts/api-server && node scripts/migrate.js`
        },
        {
          type: 'callout', variant: 'tech',
          text: 'Schema lives in TWO files for a monorepo split: shared/schema.ts (used by API server build via esbuild) and lib/db/src/schema/schema.ts (used by lib/db package). Both must be kept in sync on every schema change.'
        }
      ]
    }
  ];

  const handleRefresh = () => { setIsRefreshing(true); setTimeout(() => setIsRefreshing(false), 500); };
  const handleConnectWallet = () => window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  const handleBack = () => { if (window.history.length > 1) window.history.back(); else setLocation('/'); };

  return (
    <div className="min-h-screen bg-[#060d16]" data-testid="whitepaper-page">
      {/* Back button */}
      <div className="px-4 pt-4">
        <button onClick={handleBack} className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors" data-testid="btn-back">
          <ArrowLeft size={20} />
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-cyan-500/20 rounded-xl">
            <FileText className="h-8 w-8 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white" data-testid="text-title">SuiBets Technical Whitepaper</h1>
            <p className="text-gray-400 font-mono text-sm" data-testid="text-version">v6.0 — June 2026 — Move 2024 · PTBs · zkLogin · Passkey · Walrus · DeepBook · WARP · FLUX · PULSE</p>
          </div>
        </div>

        {/* Hero */}
        <div className="relative bg-gradient-to-br from-[#0a1a2e] to-[#0a0f1e] border border-cyan-500/20 rounded-2xl p-8 mb-8 overflow-hidden">
          {/* Grid bg */}
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-cyan-400 text-xs font-bold font-mono">MAINNET LIVE</span>
              </div>
              <div className="px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400 text-xs font-bold font-mono">MOVE 2024</div>
              <div className="px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold font-mono">ZERO HOUSE EDGE</div>
              <div className="px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-bold font-mono">⚡ WARP</div>
              <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold font-mono">⚡ FLUX</div>
              <div className="px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/30 text-pink-400 text-xs font-bold font-mono">⚡ PULSE</div>
              <div className="px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-bold font-mono">🦭 WALRUS</div>
              <div className="px-3 py-1 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-400 text-xs font-bold font-mono">🔑 PASSKEY</div>
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Pure P2P Sports Betting on Sui</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-6 max-w-2xl">
              SuiBets is a peer-to-peer sports betting protocol built natively on Sui. Every bet is an on-chain object.
              Settlement is a PTB. Gas is sponsored for stablecoin users. Privacy is zkLogin. This is the technical specification.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { v: 'PTB', label: 'Atomic settlement', color: 'text-cyan-400', bg: 'bg-cyan-500/8 border-cyan-500/20' },
                { v: '0%', label: 'House edge', color: 'text-green-400', bg: 'bg-green-500/8 border-green-500/20' },
                { v: 'zkLogin', label: 'Google → Sui addr', color: 'text-violet-400', bg: 'bg-violet-500/8 border-violet-500/20' },
                { v: '0 SUI', label: 'Gas for USDC bets', color: 'text-amber-400', bg: 'bg-amber-500/8 border-amber-500/20' },
              ].map(item => (
                <div key={item.label} className={`text-center p-4 rounded-xl border ${item.bg}`}>
                  <p className={`text-2xl font-black font-mono ${item.color}`}>{item.v}</p>
                  <p className="text-gray-500 text-xs mt-1">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section nav pills */}
        <div className="flex flex-wrap gap-2 mb-6">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[#0f1923] border border-cyan-900/30 text-gray-500 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors font-mono"
              data-testid={`nav-section-${s.id}`}
            >
              {s.badge && <span className="text-[9px] font-black text-cyan-500/60">{s.badge}</span>}
              {s.title}
            </button>
          ))}
        </div>

        {/* Sections */}
        <div className="space-y-3">
          {sections.map((section, index) => {
            const isExpanded = expandedSections[section.id] !== false;
            return (
              <div
                key={section.id}
                id={`section-${section.id}`}
                className="bg-[#0a1220] border border-white/8 rounded-2xl overflow-hidden hover:border-cyan-500/20 transition-all"
                data-testid={`section-${section.id}`}
              >
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center justify-between gap-3 p-5 text-left"
                  data-testid={`button-toggle-${section.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/[0.04] rounded-xl">{section.icon}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-black text-white">{section.title}</h3>
                        {section.badge && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-500 font-mono tracking-wider">{section.badge}</span>
                        )}
                      </div>
                      <div className="text-gray-600 text-xs font-mono">§{String(index + 1).padStart(2, '0')}</div>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={16} className="text-gray-600 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-600 flex-shrink-0" />}
                </button>
                {isExpanded && (
                  <div className="px-5 pb-5 pl-16 space-y-2">
                    {section.content.map((block, i) => renderBlock(block, i))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Contract addresses */}
        <div className="bg-[#0a1220] border border-white/8 rounded-2xl p-6 mt-6">
          <div className="flex items-center gap-3 mb-5">
            <Code2 className="h-5 w-5 text-cyan-400" />
            <h3 className="text-base font-black text-white">Deployed Contracts — Sui Mainnet</h3>
          </div>
          <div className="space-y-3 font-mono">
            {[
              { label: 'SBETS Token', env: import.meta.env.VITE_SBETS_TOKEN_TYPE || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS' },
              ...(import.meta.env.VITE_BETTING_PLATFORM_ID ? [{ label: 'BetPlatform Object', env: import.meta.env.VITE_BETTING_PLATFORM_ID }] : []),
              ...(import.meta.env.VITE_BETTING_PACKAGE_ID ? [{ label: 'Move Package', env: import.meta.env.VITE_BETTING_PACKAGE_ID }] : []),
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between gap-4 p-3 bg-white/[0.03] rounded-xl border border-white/5 flex-wrap">
                <span className="text-gray-500 text-xs">{item.label}</span>
                <div className="flex items-center gap-2">
                  <code className="text-cyan-400 text-xs">{item.env.slice(0, 14)}…{item.env.slice(-8)}</code>
                  <a href={`https://suiscan.xyz/mainnet/object/${item.env.split('::')[0]}`} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-cyan-400 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-5 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="h-4 w-4 text-gray-600" />
            <span className="text-xs font-bold text-gray-500">Disclaimer</span>
          </div>
          <p className="text-gray-600 text-xs leading-relaxed">
            This document is a technical specification. It does not constitute financial or investment advice.
            Sports betting and digital assets carry risk. Smart contract code is publicly verifiable on Sui mainnet.
            SuiBets enforces responsible gambling tools including spending limits and self-exclusion.
          </p>
        </div>

        <div className="text-center text-gray-700 text-xs font-mono mt-6 pb-8">
          SuiBets · v6.0 · June 2026 · Move 2024 · PTBs · zkLogin · Passkey · Walrus · Sui Mainnet
        </div>
      </div>
    </div>
  );
}
