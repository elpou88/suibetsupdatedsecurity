import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActivityIcon, Clock, ChevronDown, ChevronUp, TrendingUp, Swords } from 'lucide-react';
import OddsHistoryChart from '@/components/betting/OddsHistoryChart';
import { Event, Market } from '@/types';
import { useBetting } from '@/context/BettingContext';
import sportMarketsAdapter from '@/lib/sportMarketsAdapter';
import { useLiveClock } from '@/hooks/useLiveClock';
import { useQuery } from '@tanstack/react-query';

interface SportEventCardProps {
  event: Event;
  sportId: number;
}

const SportEventCard: React.FC<SportEventCardProps> = ({ event, sportId }) => {
  const { addBet } = useBetting();
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [showOddsChart, setShowOddsChart] = useState(false);

  // Read P2P offers for this match from the shared React Query cache (no extra network request)
  const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
  const { data: rawAllOffers } = useQuery<Array<{ eventName: string; status: string }>>({
    queryKey: ['/api/p2p/offers'],
    queryFn: () => fetch('/api/p2p/offers?status=open').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    staleTime: 30000,
    refetchInterval: 30000,
  });
  const allOffers = Array.isArray(rawAllOffers) ? rawAllOffers : [];
  const p2pCount = allOffers.filter(
    o => o.status === 'open' && o.eventName?.toLowerCase().includes(event.homeTeam.toLowerCase())
  ).length;

  const handleShowP2POffers = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('set-p2p-event-filter', { detail: { eventName } }));
  };

  // Derive home/away/draw from a selection name by matching keywords then team names
  const derivePrediction = (selectionName: string): string => {
    const s = selectionName.toLowerCase().trim();
    if (s === 'draw' || s === 'x' || s.includes('draw') || s.includes('tie')) return 'draw';
    if (s === 'away' || s === '2' || s.includes('away')) return 'away';
    if (event.awayTeam && s.includes(event.awayTeam.toLowerCase())) return 'away';
    if (s === 'home' || s === '1' || s.includes('home')) return 'home';
    if (event.homeTeam && s.includes(event.homeTeam.toLowerCase())) return 'home';
    return 'home';
  };

  const handleCreateP2POffer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const market = primaryMarket;
    const firstOutcome = market?.outcomes?.[0];
    if (!firstOutcome) return;
    const eventIdString = typeof event.id === 'number' ? event.id.toString() : event.id;
    const odds = Number(firstOutcome.odds) || 2.0;
    const selectionName = firstOutcome.name || `${event.homeTeam} Win`;
    addBet({
      id: `${eventIdString}-p2p-${Date.now()}`,
      eventId: eventIdString,
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      selectionName,
      prediction: derivePrediction(selectionName),
      odds,
      stake: 10,
      market: market?.name || 'Match Result',
      marketId: typeof market?.id === 'number' ? market.id : parseInt(String(market?.id)),
      isLive: event.isLive,
      uniqueId: Math.random().toString(36).substring(2, 8),
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      sportId: sportId || event.sportId,
      leagueName: event.leagueName || event.league || undefined,
      sportName: event.sport || undefined,
      matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
    });
    window.dispatchEvent(new CustomEvent('open-betslip-p2p', { detail: { odds: odds.toFixed(2) } }));
    window.dispatchEvent(new CustomEvent('open-betslip'));
  };

  // Exact real-time live clock — uses startTime for soccer first half (sub-second accuracy)
  const liveClockDisplay = useLiveClock(event, sportId);

  // Tick every 30 s so matchMinute / isBettingClosed / filterDecidedMarkets
  // re-evaluate even when no poll/WS update arrives.
  const [_clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!event.isLive) return;
    const id = setInterval(() => setClockTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, [event.isLive]);
  
  // Check if live match is past 45 minutes (betting closed)
  const getMatchMinute = (): number | null => {
    const eventAny = event as any;
    // Try various minute field names
    if (eventAny.minute !== undefined && eventAny.minute !== null) {
      const min = parseInt(String(eventAny.minute));
      if (!isNaN(min)) return min;
    }
    if (eventAny.matchMinute !== undefined && eventAny.matchMinute !== null) {
      const min = parseInt(String(eventAny.matchMinute));
      if (!isNaN(min)) return min;
    }
    // Try to extract from status string like "75'" or "HT"
    if (typeof eventAny.status === 'string') {
      const match = eventAny.status.match(/(\d+)/);
      if (match) return parseInt(match[1]);
      if (eventAny.status === 'HT') return 45; // Half time = 45
    }
    // Fallback: compute from kickoff time when API didn't give a minute.
    // Soccer = 90 mins of play + 15 min halftime break starting at minute 45.
    if (event.startTime) {
      const startMs = new Date(event.startTime).getTime();
      if (!isNaN(startMs)) {
        const elapsedMin = Math.floor((Date.now() - startMs) / 60000);
        if (elapsedMin >= 0 && elapsedMin <= 130) {
          if (elapsedMin <= 45) return elapsedMin;            // 1st half
          if (elapsedMin <= 60) return 45;                    // halftime window
          const secondHalfMin = 45 + (elapsedMin - 60);        // 2nd half (after 15-min break)
          return Math.min(95, secondHalfMin);
        }
      }
    }
    // Status says 2H but no minute and no usable startTime — assume early 2nd half
    if (typeof eventAny.status === 'string' && eventAny.status.includes('2H')) return 46;
    return null;
  };
  
  const matchMinute = getMatchMinute();
  const isLiveMatch = event.isLive || event.status?.toLowerCase().includes('live') || 
                      event.status?.includes('H') || event.status?.includes("'");
  // P2P offers cannot be posted once a match has started — close betting for all live events.
  // Previously this only triggered at 85+ minutes, leaving a window where users could post
  // offers for games already in progress (funds would get stuck on-chain).
  const isMatchStarted = isLiveMatch || (event.startTime ? new Date(event.startTime).getTime() <= Date.now() : false);
  const isBettingClosed = isMatchStarted;
  
  // Helper to get current total goals from event score
  const getCurrentTotalGoals = (): number => {
    let homeScore = 0;
    let awayScore = 0;
    const eventAny = event as any;
    
    // Try direct homeScore/awayScore properties first (most common)
    if (eventAny.homeScore !== undefined || eventAny.awayScore !== undefined) {
      homeScore = parseInt(String(eventAny.homeScore)) || 0;
      awayScore = parseInt(String(eventAny.awayScore)) || 0;
      return homeScore + awayScore;
    }
    
    // Try score object with home/away
    const score = event.score as any;
    if (score) {
      if (typeof score === 'string') {
        const parts = score.split('-').map((s: string) => parseInt(s.trim()));
        homeScore = parts[0] || 0;
        awayScore = parts[1] || 0;
      } else if (typeof score === 'object' && score !== null) {
        homeScore = typeof score.home === 'number' ? score.home : parseInt(String(score.home)) || 0;
        awayScore = typeof score.away === 'number' ? score.away : parseInt(String(score.away)) || 0;
      }
    }
    
    return homeScore + awayScore;
  };
  
  // Filter out Over/Under markets that are already decided for live events
  const filterDecidedMarkets = (markets: Market[]): Market[] => {
    const isLive = event.isLive || event.status?.toLowerCase().includes('live') || 
                   event.status?.includes('H') || event.status?.includes("'");
    
    if (!isLive) return markets;
    
    const totalGoals = getCurrentTotalGoals();
    if (totalGoals === 0) return markets;
    
    return markets.map(market => {
      const marketName = market.name?.toLowerCase() || '';
      
      // Check if this is an Over/Under or Goals market
      const isOverUnderMarket = marketName.includes('over') || marketName.includes('under') || 
                                 marketName.includes('o/u') || marketName.includes('goals');
      
      if (isOverUnderMarket) {
        // Try to extract threshold from market name (e.g., "Over/Under 2.5 Goals" -> 2.5)
        const marketThresholdMatch = marketName.match(/(\d+\.?\d*)/);
        const marketThreshold = marketThresholdMatch ? parseFloat(marketThresholdMatch[1]) : null;
        
        // If we can determine threshold from market name and it's already exceeded,
        // the whole market is decided - remove it entirely
        if (marketThreshold !== null && totalGoals > marketThreshold) {
          return null; // Both Over (won) and Under (lost) are decided
        }
        
        // Filter individual outcomes within the market
        const filteredOutcomes = market.outcomes.filter(outcome => {
          const outcomeName = outcome.name?.toLowerCase() || '';
          
          // Parse the threshold from outcome (e.g., "Over 2.5" -> 2.5)
          const match = outcomeName.match(/(over|under)\s*(\d+\.?\d*)/i);
          if (!match) return true; // Keep non-matching outcomes
          
          const threshold = parseFloat(match[2]);
          
          // If total goals already exceeds threshold, both Over and Under are decided
          if (totalGoals > threshold) {
            return false; // Over already won, Under already lost - hide both
          }
          
          return true;
        });
        
        // If all outcomes are filtered out, remove the entire market
        if (filteredOutcomes.length === 0) return null;
        
        return { ...market, outcomes: filteredOutcomes };
      }
      
      return market;
    }).filter((m): m is Market => m !== null && m.outcomes.length > 0);
  };
  
  // Get markets for this event based on sport type
  let allMarkets: Market[] = event.markets || [];
  
  // If no markets provided, use default ones based on sport
  if (!allMarkets || allMarkets.length === 0) {
    allMarkets = sportMarketsAdapter.getDefaultMarkets(
      sportId, 
      event.homeTeam, 
      event.awayTeam,
      { home: event.homeOdds, draw: event.drawOdds, away: event.awayOdds }
    ) as Market[];
  } else {
    allMarkets = sportMarketsAdapter.enhanceMarketsForSport(allMarkets, sportId, event.homeTeam, event.awayTeam, { home: event.homeOdds, draw: event.drawOdds, away: event.awayOdds }) as Market[];
  }
  
  // Filter out decided markets for live events
  allMarkets = filterDecidedMarkets(allMarkets);
  
  const primaryMarket = allMarkets[0];
  const secondaryMarkets = allMarkets.slice(1);
  
  // Format date for display
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    
    const today = new Date();
    if (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    ) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    return date.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' }) + 
      ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  // Function to handle adding a bet to the betslip
  const handleAddBet = (e: React.MouseEvent, market: Market, selectionName: string, odds: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Convert eventId to string if it's a number
    const eventIdString = typeof event.id === 'number' ? event.id.toString() : event.id;
    
    // Create the bet object
    const bet = {
      id: `${eventIdString}-${market?.name || 'Match Result'}-${selectionName}-${Date.now()}`,
      eventId: eventIdString,
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      selectionName,
      prediction: derivePrediction(selectionName),
      odds,
      stake: 10,
      market: market?.name || 'Match Result',
      marketId: typeof market?.id === 'number' ? market.id : parseInt(String(market?.id)),
      isLive: event.isLive,
      uniqueId: Math.random().toString(36).substring(2, 8),
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      sportId: sportId || event.sportId,
      leagueName: event.leagueName || event.league || undefined,
      sportName: event.sport || undefined,
      matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
    };
    
    addBet(bet);
    console.log(`Adding bet for ${selectionName} at odds ${odds}`);
  };
  
  return (
    <Card className="bg-[#112225] border-[#1e3a3f] hover:border-cyan-500/70 transition-all duration-200 overflow-hidden relative">
      <CardContent className="p-3">
        {/* Event header with time */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <h3 className="text-white font-bold truncate">{event.homeTeam} vs {event.awayTeam}</h3>
            <div className="flex items-center text-xs text-gray-400 mt-1">
              {event.isLive ? (
                <>
                  <ActivityIcon className="h-3 w-3 text-red-500 mr-1 animate-pulse" />
                  <span className="text-red-400 font-bold mr-1">LIVE</span>
                  <span className="ml-1 px-1.5 py-0.5 bg-[#1e3a3f] rounded text-cyan-300 font-mono font-bold text-xs">
                    {liveClockDisplay}
                  </span>
                  {event.score && (
                    <span className="ml-2 px-1.5 py-0.5 bg-[#1e3a3f] rounded text-cyan-300 font-medium">
                      {event.score}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 mr-1" />
                  <span>{formatDate(event.startTime)}</span>
                  <span className="text-gray-500 ml-2">ID:{event.id}</span>
                </>
              )}
            </div>
          </div>
          <div className="bg-[#0b1618] px-2 py-1 rounded text-xs text-cyan-300">
            {event.leagueName}
          </div>
        </div>

        
        {/* Main Market */}
        {primaryMarket && (
          <div className="mt-4 relative">
            <p className="text-xs text-gray-400 mb-2 text-center font-medium">{primaryMarket.name}</p>
            {isBettingClosed ? (
              <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-3 text-center">
                <span className="text-red-400 font-bold text-sm">Betting Closed</span>
                <span className="text-red-400/70 text-xs block">Betting closed</span>
              </div>
            ) : (
              <div className={`grid ${primaryMarket.outcomes.length > 2 ? 'grid-cols-3' : 'grid-cols-2'} gap-1 relative z-20`}>
                {primaryMarket.outcomes.map((outcome, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-12 bg-[#1e3a3f] hover:bg-cyan-800 border-[#2a4c55] text-cyan-300 hover:text-white"
                    onClick={(e) => handleAddBet(e, primaryMarket, outcome.name, outcome.odds)}
                  >
                    <div className="flex flex-col">
                      <span className="text-[10px] font-normal truncate max-w-[80px]">{outcome.name}</span>
                      <span className="font-bold text-sm">{Math.round(100 / outcome.odds)}%</span>
                    </div>
                  </Button>
                ))}
              </div>
            )}

            {/* Odds movement chart trigger */}
            <div className="flex justify-end mt-1 relative z-20">
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowOddsChart(v => !v); }}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-cyan-400 transition-colors px-1 py-0.5"
                title="View odds movement chart"
              >
                <TrendingUp className="h-3 w-3" />
                <span>odds movement</span>
              </button>
            </div>

            {showOddsChart && (
              <OddsHistoryChart
                eventId={typeof event.id === 'number' ? event.id.toString() : event.id}
                homeTeam={event.homeTeam}
                awayTeam={event.awayTeam}
                onClose={() => setShowOddsChart(false)}
              />
            )}
          </div>
        )}

        {/* Expandable Secondary Markets - hide when betting closed */}
        {secondaryMarkets.length > 0 && !isBettingClosed && (
          <div className="mt-3 border-t border-[#1e3a3f] pt-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full text-xs text-cyan-400 hover:text-cyan-300 h-7 flex items-center justify-center gap-1 relative z-20"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowAllMarkets(!showAllMarkets);
              }}
            >
              {showAllMarkets ? (
                <><ChevronUp className="h-3 w-3" /> Hide Markets</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> +{secondaryMarkets.length} More Markets</>
              )}
            </Button>

            {showAllMarkets && (
              <div className="mt-3 space-y-4">
                {secondaryMarkets.map((market, idx) => (
                  <div key={idx} className="border-b border-[#1e3a3f]/50 pb-3 last:border-0 last:pb-0">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-bold">{market.name}</p>
                    <div className="grid grid-cols-2 gap-1 relative z-20">
                      {market.outcomes.map((outcome, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="sm"
                          className="h-10 bg-[#0b1618] hover:bg-cyan-900/40 border-[#1e3a3f] text-cyan-300"
                          onClick={(e) => handleAddBet(e, market, outcome.name, outcome.odds)}
                        >
                          <div className="flex justify-between items-center w-full px-1">
                            <span className="text-[10px] font-normal truncate mr-2">{outcome.name}</span>
                            <span className="font-bold text-xs">{outcome.odds.toFixed(2)}</span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* P2P Offers for this match */}
        <div className="mt-3 pt-2.5 border-t border-[#1e3a3f]/60 flex items-center justify-between relative z-20">
          <button
            onClick={handleShowP2POffers}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
              p2pCount > 0
                ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25'
                : 'bg-[#0b1618] text-gray-500 border border-[#1e3a3f] hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <Swords size={11} className={p2pCount > 0 ? 'text-purple-400' : 'text-gray-600'} />
            P2P offers
            {p2pCount > 0 && (
              <span className="ml-0.5 bg-purple-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                {p2pCount}
              </span>
            )}
          </button>
          {primaryMarket?.outcomes?.[0] && !isLiveMatch && (
            <button
              onClick={handleCreateP2POffer}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 hover:bg-cyan-500/20 hover:border-cyan-400/50 z-10 relative"
            >
              <Swords size={11} className="text-cyan-400" />
              Post offer
            </button>
          )}
        </div>
      </CardContent>
      
      {/* Link to event details page - placed after content so betting buttons work */}
      <Link href={`/match/${event.id}`}>
        <span className="absolute inset-0 z-0 cursor-pointer"></span>
      </Link>
    </Card>
  );
};

export default SportEventCard;