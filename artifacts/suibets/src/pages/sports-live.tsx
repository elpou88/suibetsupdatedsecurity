import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import Layout from '@/components/layout/Layout';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';
import { BetSlip } from '@/components/betting/BetSlip';
import { useBetting } from '@/context/BettingContext';
import SportsSidebar from '@/components/layout/SportsSidebar';
import { Clock, Calendar, ExternalLink, Swords } from 'lucide-react';
const suiBetsHero = "/images/sui-hero.png";

// ── Sport keyword map (same synonyms as home page) ───────────────────────────
const SPORT_KEYWORDS: Record<string, string[]> = {
  football:   ['football', 'soccer', 'league', 'cup', 'premier', 'liga', 'serie', 'bundesliga', 'ligue', 'world cup', 'champions', 'europa', 'mls', 'eredivisie', 'primeira'],
  soccer:     ['football', 'soccer', 'league', 'cup', 'premier', 'liga', 'serie', 'bundesliga', 'ligue', 'world cup', 'champions', 'europa', 'mls', 'eredivisie', 'primeira'],
  basketball: ['basketball', 'nba', 'euroleague', 'ncaa'],
  esports:    ['esports', 'e-sports', 'gaming', 'dota', 'csgo', 'lol', 'valorant', 'overwatch'],
  tennis:     ['tennis', 'atp', 'wta', 'grand slam', 'wimbledon', 'us open', 'roland'],
  hockey:     ['hockey', 'nhl', 'khl'],
  'ice-hockey': ['hockey', 'nhl', 'khl'],
  mma:        ['mma', 'ufc', 'boxing', 'bellator'],
  baseball:   ['baseball', 'mlb', 'softball'],
  cricket:    ['cricket', 'ipl', 't20', 'odi', 'test match'],
  rugby:      ['rugby', 'nrl', 'super rugby'],
  volleyball: ['volleyball', 'beach volleyball'],
  handball:   ['handball'],
};

function matchesSlug(offer: any, slug: string): boolean {
  const kws = SPORT_KEYWORDS[slug] ?? [slug];
  const sn = (offer.sportName || '').toLowerCase();
  const ln = (offer.leagueName || '').toLowerCase();
  const en = (offer.eventName || '').toLowerCase();
  if (!sn && !ln && !en) return true;
  return kws.some(kw => sn.includes(kw) || ln.includes(kw) || en.includes(kw));
}

// ── P2P Sidebar Panel ─────────────────────────────────────────────────────────
function P2PSidebarPanel({ sportName, sportSlug }: { sportName?: string; sportSlug?: string }) {
  const [, navigate] = useLocation();
  const [p2pTab, setP2pTab] = useState<'offers' | 'parlays'>('offers');

  const { data: book } = useQuery<{
    openOffers: number; openParlays: number; contractDeployed: boolean;
    supportedCoins: { symbol: string; default: boolean }[];
  }>({
    queryKey: ['/api/p2p/onchain-book'],
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: allOffers = [] } = useQuery<any[]>({
    queryKey: ['/api/p2p/offers', 'open'],
    queryFn: () =>
      fetch('/api/p2p/offers?status=open')
        .then(r => r.json())
        .then((d: any) => Array.isArray(d) ? d : []),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: allParlays = [] } = useQuery<any[]>({
    queryKey: ['/api/p2p/parlays', 'open'],
    queryFn: () =>
      fetch('/api/p2p/parlays?status=open')
        .then(r => r.json())
        .then((d: any) => Array.isArray(d) ? d : []),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const offers = sportSlug
    ? (allOffers as any[]).filter((o: any) =>
        (o.status === 'open' || o.status === 'partial') && matchesSlug(o, sportSlug)
      )
    : (allOffers as any[]).filter((o: any) => o.status === 'open' || o.status === 'partial');

  const parlays = (allParlays as any[]).filter((p: any) => p.status === 'open');

  const totalOpen = (book?.openOffers ?? 0) + (book?.openParlays ?? 0);
  const coins = book?.supportedCoins ?? [{ symbol: 'SUI', default: true }, { symbol: 'SBETS', default: false }, { symbol: 'USDSUI', default: false }];

  return (
    <div className="mx-4 mb-4 bg-[#0d1420] border border-purple-500/25 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-purple-900/40 to-cyan-900/30 border-b border-purple-500/20">
        <div className="flex items-center gap-1.5">
          <Swords size={13} className="text-purple-400" />
          <span className="text-white text-xs font-bold">P2P Open Market</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-[10px] font-medium">Live</span>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-2">
        {/* Counts */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-[#111d2e] rounded-lg p-2 text-center">
            <div className="text-cyan-400 font-black text-lg leading-tight">{offers.length}</div>
            <div className="text-gray-500 text-[9px] uppercase tracking-wide">{sportName ? `${sportName} Offers` : 'Open Offers'}</div>
          </div>
          <div className="bg-[#111d2e] rounded-lg p-2 text-center">
            <div className="text-purple-400 font-black text-lg leading-tight">{parlays.length}</div>
            <div className="text-gray-500 text-[9px] uppercase tracking-wide">Open Parlays</div>
          </div>
        </div>

        {/* Tab toggle */}
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={() => setP2pTab('offers')}
            className="flex-1 text-[10px] font-bold py-1 rounded-md transition-all"
            style={p2pTab === 'offers'
              ? { background: 'rgba(0,255,255,0.15)', color: '#00ffff', border: '1px solid rgba(0,255,255,0.3)' }
              : { color: '#6b7280', border: '1px solid transparent' }}
          >
            ⚔️ Offers ({offers.length})
          </button>
          <button
            onClick={() => setP2pTab('parlays')}
            className="flex-1 text-[10px] font-bold py-1 rounded-md transition-all"
            style={p2pTab === 'parlays'
              ? { background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }
              : { color: '#6b7280', border: '1px solid transparent' }}
          >
            🎯 Parlays ({parlays.length})
          </button>
        </div>

        {/* Supported coins */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-gray-500 text-[10px]">Bet with:</span>
          {coins.map((c: any) => (
            <span key={c.symbol}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                c.symbol === 'SUI'    ? 'bg-cyan-500/20 text-cyan-400' :
                c.symbol === 'SBETS' ? 'bg-purple-500/20 text-purple-400' :
                                       'bg-green-500/20 text-green-400'
              }`}
            >
              {c.symbol === 'SUI' ? '𝕊' : c.symbol === 'SBETS' ? '⚡' : c.symbol === 'LBTC' ? '₿' : '$'} {c.symbol}
            </span>
          ))}
        </div>

        {/* Offer cards */}
        {p2pTab === 'offers' && (
          <>
            {offers.slice(0, 3).map((o: any) => (
              <div key={o.id} className="bg-[#111d2e] rounded-lg p-2 border border-cyan-500/10 cursor-pointer hover:border-cyan-500/30 transition-colors" onClick={() => navigate('/p2p')}>
                <div className="flex items-center justify-between">
                  <span className="text-white text-[10px] truncate flex-1">{o.homeTeam && o.awayTeam ? `${o.homeTeam} vs ${o.awayTeam}` : (o.eventName || 'Match')}</span>
                  <span className="text-cyan-400 text-[10px] font-bold ml-1">{Number(o.odds || 0).toFixed(2)}x</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                    o.prediction === 'home' ? 'bg-cyan-500/20 text-cyan-400' :
                    o.prediction === 'away' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {o.prediction === 'home' ? '🏠 Home' : o.prediction === 'away' ? '✈️ Away' : '🤝 Draw'}
                  </span>
                  <span className="text-gray-500 text-[10px]">{o.currency || 'SUI'} · {Number(o.creatorStake || 0).toFixed(2)}</span>
                </div>
              </div>
            ))}
            {offers.length === 0 && (
              <p className="text-gray-600 text-[10px] text-center py-1">No open offers for this sport yet</p>
            )}
            {offers.length > 3 && (
              <button onClick={() => navigate('/p2p')} className="w-full text-[10px] text-cyan-400 text-center hover:underline">
                +{offers.length - 3} more offers →
              </button>
            )}
          </>
        )}

        {/* Parlay cards */}
        {p2pTab === 'parlays' && (
          <>
            {parlays.slice(0, 3).map((p: any) => {
              const legs: any[] = Array.isArray(p.legs) ? p.legs : [];
              const takerWin = ((Number(p.creatorStake) || 0) + (Number(p.takerStake) || 0)) * 0.98;
              return (
                <div key={p.id} className="bg-[#111d2e] rounded-lg p-2 border border-purple-500/10 cursor-pointer hover:border-purple-500/30 transition-colors" onClick={() => navigate('/p2p?tab=parlays')}>
                  <div className="flex items-center justify-between">
                    <span className="text-purple-300 text-[10px] font-bold">🎰 {p.legCount}-Leg Parlay</span>
                    <span className="text-purple-400 text-[10px] font-bold">{Number(p.totalOdds || 0).toFixed(2)}x</span>
                  </div>
                  <div className="text-gray-500 text-[10px] truncate mt-0.5">
                    {legs.slice(0, 2).map((l: any) => l.homeTeam?.split(' ').pop()).join(' · ')}
                    {legs.length > 2 && <span> +{legs.length - 2}</span>}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-gray-600 text-[10px]">{p.currency} · all legs win</span>
                    <span className="text-purple-400 text-[10px]">Win {takerWin.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
            {parlays.length === 0 && (
              <p className="text-gray-600 text-[10px] text-center py-1">No open parlays right now</p>
            )}
            {parlays.length > 3 && (
              <button onClick={() => navigate('/p2p?tab=parlays')} className="w-full text-[10px] text-purple-400 text-center hover:underline">
                +{parlays.length - 3} more parlays →
              </button>
            )}
          </>
        )}

        {/* CTAs */}
        <div className="flex gap-1.5">
          <button
            onClick={() => navigate('/p2p')}
            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] py-1.5 rounded-lg transition-colors"
          >
            View All
          </button>
          <a
            href="/p2p"
            className="flex-1 text-center bg-cyan-900/30 hover:bg-cyan-900/50 border border-cyan-500/25 text-cyan-400 font-bold text-[10px] py-1.5 rounded-lg transition-colors flex items-center justify-center gap-0.5"
          >
            Post Offer <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Sport page that displays events for a specific sport with real-time data
 */
export default function SportsLive() {
  const params = useParams();
  const sportSlug = (params as any).slug || (params as any)['0'] || (params as any).wild || '';
  const [, setLocation] = useLocation();
  const { addBet } = useBetting();
  const [activeTab, setActiveTab] = useState<string>('all');
  
  // Fetch sports data
  const { data: sports = [] } = useQuery({
    queryKey: ['/api/sports'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/sports');
      return response.json();
    }
  });
  
  const SLUG_TO_SPORT: Record<string, { id: number; name: string }> = {
    'football': { id: 1, name: 'Football' },
    'soccer': { id: 1, name: 'Football' },
    'basketball': { id: 2, name: 'Basketball' },
    'american-football': { id: 4, name: 'American Football' },
    'baseball': { id: 5, name: 'Baseball' },
    'hockey': { id: 6, name: 'Hockey' },
    'ice-hockey': { id: 6, name: 'Hockey' },
    'mma': { id: 7, name: 'MMA' },
    'esports': { id: 9, name: 'Esports' },
    'afl': { id: 10, name: 'AFL' },
    'formula-1': { id: 11, name: 'Formula 1' },
    'formula_1': { id: 11, name: 'Formula 1' },
    'handball': { id: 12, name: 'Handball' },
    'rugby': { id: 15, name: 'Rugby' },
    'volleyball': { id: 16, name: 'Volleyball' },
    'horse-racing': { id: 17, name: 'Horse Racing' },
    'cricket': { id: 18, name: 'Cricket' },
  };

  const currentSport = sports.find((sport: any) => sport.slug === sportSlug)
    || (sportSlug && SLUG_TO_SPORT[sportSlug] ? { ...SLUG_TO_SPORT[sportSlug], slug: sportSlug } : null);
  
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['/api/events', sportSlug, currentSport?.id],
    queryFn: async () => {
      const sportId = currentSport?.id;
      if (!sportId) {
        return [];
      }
      const response = await apiRequest('GET', `/api/events?sportId=${sportId}`);
      return response.json();
    },
    enabled: !!currentSport?.id,
    refetchInterval: 60000
  });
  
  // Filter events based on the active tab
  const filteredEvents = events.filter((event: any) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'live') return event.status === 'live';
    if (activeTab === 'upcoming') return event.status === 'upcoming';
    return true;
  });
  
  // Handle bet selection
  const handleBetSelection = (event: any, market: any, outcome: any) => {
    const betId = `${event.id}-${market.id}-${outcome.id}`;
    
    addBet({
      id: betId,
      eventId: event.id,
      eventName: event.name,
      selectionName: outcome.name,
      odds: outcome.odds,
      stake: 10,
      market: market.name,
      isLive: event.status === 'live',
      leagueName: event.leagueName || event.league || undefined,
      sportName: event.sport || undefined,
      matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
    });
  };
  
  return (
    <Layout>
      <div className="flex min-h-screen bg-[#112225]">
        {/* Left sidebar */}
        <div className="w-64 bg-[#0b1618] border-r border-[#1e3a3f] min-h-screen">
          <SportsSidebar />
        </div>
        
        {/* Main content */}
        <div className="flex-1 p-4">
          <div className="mb-6">
            {/* Sport header */}
            {currentSport ? (
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-white">{currentSport.name}</h1>
                  <p className="text-gray-400">{currentSport.description || `All ${currentSport.name} Events`}</p>
                </div>
                
                {/* Tabs */}
                <div className="flex space-x-2">
                  <Button 
                    variant="outline" 
                    className={`border-[#1e3a3f] ${activeTab === 'all' ? 'bg-cyan-400 text-black' : 'bg-[#0b1618] text-white'}`}
                    onClick={() => setActiveTab('all')}
                  >
                    All Events
                  </Button>
                  <Button 
                    variant="outline" 
                    className={`border-[#1e3a3f] ${activeTab === 'live' ? 'bg-cyan-400 text-black' : 'bg-[#0b1618] text-white'}`}
                    onClick={() => setActiveTab('live')}
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></div>
                    Live
                  </Button>
                  <Button 
                    variant="outline" 
                    className={`border-[#1e3a3f] ${activeTab === 'upcoming' ? 'bg-cyan-400 text-black' : 'bg-[#0b1618] text-white'}`}
                    onClick={() => setActiveTab('upcoming')}
                  >
                    Upcoming
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-gray-500">
                Select a sport from the sidebar.
              </div>
            )}
            
            {/* Events list */}
            {eventsLoading ? (
              <div className="flex justify-center items-center h-40">
                <div className="animate-spin w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full"></div>
              </div>
            ) : filteredEvents.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {filteredEvents.map((event: any) => (
                  <Card key={event.id} className="bg-[#0b1618] border-[#1e3a3f] text-white overflow-hidden">
                    <CardContent className="p-0">
                      <div className={`p-4 border-b border-[#1e3a3f] ${
                        event.status === 'live' 
                          ? 'bg-gradient-to-r from-cyan-600 to-cyan-400' 
                          : 'bg-[#0b1618]'
                      }`}>
                        <div className="flex justify-between items-center">
                          <h3 className="text-lg font-semibold">{event.name}</h3>
                          {event.status === 'live' && (
                            <div className="bg-red-600 text-white px-2 py-1 rounded text-xs font-bold animate-pulse">
                              LIVE
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-2 flex justify-between items-center">
                          {event.status === 'upcoming' ? (
                            <div className="flex items-center text-sm">
                              <Calendar className="w-4 h-4 mr-1" />
                              {format(new Date(event.startTime), 'dd MMM')}
                              <Clock className="w-4 h-4 ml-3 mr-1" />
                              {format(new Date(event.startTime), 'HH:mm')}
                            </div>
                          ) : (
                            <div className="text-sm">
                              Started at {format(new Date(event.startTime), 'HH:mm')}
                            </div>
                          )}
                        </div>
                        
                        {/* Live score (if available) */}
                        {event.status === 'live' && event.score && (
                          <div className="mt-2 flex justify-center bg-[#0b1618] rounded-md p-3">
                            <div className="flex items-center justify-between w-full max-w-md">
                              <div className="text-right flex-1 mr-4">
                                <div className="font-bold">{event.homeTeam}</div>
                              </div>
                              <div className="text-xl font-bold bg-black rounded-md py-1 px-4">
                                {event.score}
                              </div>
                              <div className="text-left flex-1 ml-4">
                                <div className="font-bold">{event.awayTeam}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Markets */}
                      {event.markets && event.markets.map((market: any) => (
                        <div key={market.id} className="px-4 py-3 border-b border-[#1e3a3f]">
                          <h4 className="text-sm text-gray-400 mb-2">{market.name}</h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {market.outcomes && market.outcomes.map((outcome: any) => (
                              <Button
                                key={outcome.id}
                                variant="outline"
                                className={`flex justify-between items-center border-[#1e3a3f] hover:bg-cyan-400 hover:text-black ${
                                  outcome.status === 'active' 
                                    ? 'bg-[#112225]' 
                                    : 'bg-gray-800 opacity-70 cursor-not-allowed'
                                }`}
                                disabled={outcome.status !== 'active'}
                                onClick={() => handleBetSelection(event, market, outcome)}
                              >
                                <span className="truncate">{outcome.name}</span>
                                <span className={`font-medium ml-2 ${
                                  outcome.status === 'active' 
                                    ? 'text-cyan-400' 
                                    : 'text-gray-400'
                                }`}>
                                  {outcome.odds.toFixed(2)}
                                </span>
                              </Button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-500">
                No events found for this sport.
              </div>
            )}
          </div>
        </div>
        
        {/* Right sidebar with bet slip, P2P panel, and hero image */}
        <div className="w-80 bg-[#0b1618] border-l border-[#1e3a3f] flex flex-col min-h-screen">
          {/* BetSlip - scrollable container */}
          <div className="p-4 flex-shrink-0">
            <BetSlip />
          </div>

          {/* P2P Order Book Panel */}
          <P2PSidebarPanel sportName={currentSport?.name} sportSlug={sportSlug} />

          {/* Hero Image below BetSlip */}
          <div className="p-4 flex-1 flex">
            <div className="relative overflow-hidden rounded-lg shadow-lg shadow-cyan-500/30 w-full">
              <img 
                src={suiBetsHero} 
                alt="SuiBets" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-blue-600/20 to-[#061118] pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}