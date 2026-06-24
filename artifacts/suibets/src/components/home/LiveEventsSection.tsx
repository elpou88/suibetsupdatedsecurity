import { Event, Sport } from "@/types";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import FeaturedEventCard from "./FeaturedEventCard";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLiveEvents } from "@/hooks/useEvents";
import { useBetting } from "@/context/BettingContext";
import { LiveClockBadge } from "@/components/sports/LiveClockBadge";

/** Normalized implied probability (%) for one outcome given all outcomes in the market */
function probPct(odds: number, allOdds: number[]): number {
  const implied = allOdds.map(o => 1 / o);
  const total = implied.reduce((a, b) => a + b, 0) || 1;
  return Math.round((1 / odds / total) * 100);
}

/** Visual probability bar + percentage label */
function ProbBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct >= 50 ? 'linear-gradient(90deg,#06b6d4,#00ffff)' : 'linear-gradient(90deg,#6366f1,#818cf8)' }} />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color: pct >= 50 ? '#22d3ee' : '#a5b4fc', minWidth: '2.5rem', textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

export function LiveEventsSection() {
  const { data: liveEvents = [], isLoading } = useLiveEvents();
  const { addBet } = useBetting();

  // Use live events directly — no stale cache.
  // mergeEventsStably in useLiveEvents already prevents render-to-render
  // flicker for events that are still live; when a match ends the server
  // removes it and the UI should immediately reflect that.
  const stableEvents = liveEvents;

  // Only show loading on initial load, not during a background refetch
  if (isLoading && stableEvents.length === 0) {
    return <div className="p-12 text-center">Loading live events...</div>;
  }

  if (stableEvents.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader className="bg-gray-100 p-3 flex flex-row items-center justify-between">
          <div className="flex items-center">
            <ChevronDown className="h-4 w-4 mr-2 text-gray-500" />
            <div className="flex items-center">
              <span className="flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-2 live-pulse"></span>
                LIVE
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 text-center text-gray-500">
          No live events available at the moment.
        </CardContent>
      </Card>
    );
  }

  // Group events by league
  const groupedEvents = stableEvents.reduce((acc, event) => {
    // Create a safe league key from league name
    const key = event.leagueSlug || 
                (event.leagueName ? event.leagueName.toLowerCase().replace(/\s+/g, '-') : 'unknown');
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(event);
    return acc;
  }, {} as Record<string, any[]>);

  // Sport ID canonical mapping (matches backend freeSportsService.ts and API-Sports IDs)
  const getSportName = (sportId: number | null): string => {
    switch(sportId) {
      case 1: return 'Football';
      case 2: return 'Basketball';
      case 3: return 'Tennis';
      case 4: return 'Baseball';
      case 5: return 'Ice Hockey';
      case 6: return 'Handball';
      case 7: return 'Volleyball';
      case 8: return 'Rugby';
      case 9: return 'Cricket';
      case 11: return 'Boxing';
      case 12: return 'MMA';
      case 13: return 'Formula 1';
      case 15: return 'American Football';
      case 16: return 'AFL';
      case 18: return 'Horse Racing';
      case 19: return 'MotoGP';
      case 20: return 'WWE';
      default: return 'Other';
    }
  };

  // Get sports count to organize leagues by sport - memoized to prevent recalculation
  const sportGroups = useMemo(() => {
    return stableEvents.reduce((acc, event) => {
      const sportId = event.sportId || 0;
      if (!acc[sportId]) {
        acc[sportId] = {
          name: getSportName(sportId),
          count: 0,
          events: []
        };
      }
      acc[sportId].count++;
      acc[sportId].events.push(event);
      return acc;
    }, {} as Record<number, { name: string; count: number; events: any[] }>);
  }, [stableEvents]);

  // Define type for sport groups
  type SportGroup = { name: string; count: number; events: any[] };
  
  // Sort sports by count - memoized for stability
  const sortedSports = useMemo((): SportGroup[] => {
    const groups = Object.values(sportGroups) as SportGroup[];
    return groups.sort((a, b) => b.count - a.count);
  }, [sportGroups]);
  
  // State for expanded/collapsed sport sections
  const [expandedSports, setExpandedSports] = useState<Record<string, boolean>>({});
  
  // Track if we've initialized - only run once
  const initializedRef = useRef(false);
  
  // Initialize the first sport as expanded - only once on first data load
  useEffect(() => {
    if (sortedSports.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setExpandedSports({ [sortedSports[0].name]: true });
    }
  }, [sortedSports]);
  
  // Toggle accordion
  const toggleSportExpand = (sportName: string) => {
    setExpandedSports(prev => ({
      ...prev,
      [sportName]: !prev[sportName]
    }));
  };
  
  return (
    <Card className="mb-4 bg-[#18323a] border-[#2a4c55] shadow-lg">
      <CardHeader className="bg-[#214550] p-3 flex flex-row items-center justify-between border-b border-[#2a4c55]">
        <div className="flex items-center">
          <div className="flex items-center">
            <span className="flex items-center text-cyan-300 font-bold">
              <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-2 animate-pulse"></span>
              LIVE EVENTS
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" className="border-cyan-400 text-cyan-300 hover:bg-cyan-400/20 text-xs">
          View All
        </Button>
      </CardHeader>
      <CardContent className="p-0 max-h-[700px] overflow-auto custom-scrollbar">
        {/* Featured Events */}
        <div className="bg-[#0b1618] p-4 border-b border-[#1e3a3f]">
          <div className="flex items-center justify-between mb-4">
            <div className="text-cyan-300 text-lg font-bold">Featured Events</div>
            <Link href="/live">
              <button className="bg-cyan-500 text-black text-xs font-semibold rounded py-1 px-3 hover:bg-cyan-400">
                View All Live
              </button>
            </Link>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stableEvents.slice(0, 6).map((event) => (
              <div key={event.id} className="relative bg-[#112225] rounded-md border border-[#1e3a3f] overflow-hidden shadow-md h-full flex flex-col">
                {/* Event header */}
                <div className="bg-[#0b1618] p-3 relative border-b border-[#1e3a3f]">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-cyan-300 font-medium">{getSportName(event.sportId)}</span>
                    <span className="text-xs text-gray-400">{event.leagueName}</span>
                  </div>
                  
                  <div className="text-white font-bold text-sm mb-1">{event.homeTeam}</div>
                  <div className="text-gray-400 text-xs mb-1">vs</div>
                  <div className="text-white font-bold text-sm">{event.awayTeam}</div>
                  
                  <div className="absolute top-3 right-3 flex items-center gap-1">
                    {event.isLive && (
                      <LiveClockBadge
                        event={event}
                        sportId={(event as any).sportId}
                        className="bg-[#1e3a3f] border border-cyan-500/40 rounded text-xs px-1.5 py-0.5 text-cyan-300 font-mono font-bold"
                      />
                    )}
                    <span className="bg-red-600 rounded text-xs px-1.5 py-0.5 flex items-center">
                      <span className="w-1.5 h-1.5 bg-white rounded-full mr-1 animate-pulse"></span>
                      <span className="text-white font-semibold">LIVE</span>
                    </span>
                  </div>
                </div>
                
                {/* Score display with robust type handling */}
                <div className="bg-[#0b1618] py-2 text-center font-bold border-b border-[#1e3a3f]">
                  <span className="text-cyan-300 text-lg">
                    {(() => {
                      // Handle all possible score formats
                      if (!event.score) return '0 - 0';
                      
                      if (typeof event.score === 'string') {
                        return event.score;
                      }
                      
                      if (Array.isArray(event.score)) {
                        return `${event.score[0] || 0} - ${event.score[1] || 0}`;
                      }
                      
                      if (typeof event.score === 'object') {
                        // Type guard for object with home/away properties
                        interface ScoreObject {
                          home: number | string;
                          away: number | string;
                        }
                        
                        // Check if object has home and away properties
                        if ('home' in event.score && 'away' in event.score) {
                          const typed = event.score as ScoreObject;
                          return `${typed.home || 0} - ${typed.away || 0}`;
                        }
                      }
                      
                      // Default fallback
                      return '0 - 0';
                    })()}
                  </span>
                </div>
                
                {/* Betting options */}
                <div className="p-3 bg-[#112225] flex-grow flex flex-col justify-between">
                  <div className="text-xs text-gray-400 text-center mb-3">
                    {(event.markets && Array.isArray(event.markets) && event.markets.length > 0) ? 
                      event.markets[0]?.name || "Match Result" : 
                      "Match Result"}
                  </div>
                  
                  <div className="space-y-3">
                    {event.markets && event.markets[0] && event.markets[0].outcomes ? (
                      // Use real market data when available
                      event.markets[0].outcomes.map((outcome: { id?: string; name: string; odds: number }, index: number) => (
                        <button 
                          key={outcome.id || index}
                          className="w-full bg-[#1e3a3f] hover:bg-cyan-800 text-cyan-300 py-2.5 px-3 rounded-sm text-sm font-medium transition-colors flex justify-between items-center border border-[#2a4c55]"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            addBet({
                              id: `${event.id}-${outcome.id || index}-${Date.now()}`,
                              eventId: String(event.id),
                              eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                              selectionName: outcome.name,
                              odds: outcome.odds,
                              stake: 10,
                              market: event.markets?.[0]?.name || "Match Result",
                              isLive: true,
                              uniqueId: Math.random().toString(36).substring(2, 8)
                            });
                          }}
                        >
                          <span>{outcome.name}</span>
                          <span className="bg-[#0b1618] px-2 py-0.5 rounded text-cyan-400 text-xs font-bold">
                            {outcome.odds.toFixed(2)}
                          </span>
                        </button>
                      ))
                    ) : (
                      // Fallback buttons with default data
                      <>
                        <button 
                          className="w-full bg-[#1e3a3f] hover:bg-cyan-800 text-cyan-300 py-2.5 px-3 rounded-sm text-sm font-medium transition-colors flex justify-between items-center border border-[#2a4c55]"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            addBet({
                              id: `${event.id}-home-${Date.now()}`,
                              eventId: String(event.id),
                              eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                              selectionName: event.homeTeam,
                              odds: (event as any).homeOdds || 2.10,
                              stake: 10,
                              market: "Match Result",
                              isLive: true,
                              uniqueId: Math.random().toString(36).substring(2, 8)
                            });
                          }}
                        >
                          <span>{event.homeTeam}</span>
                          <span className="bg-[#0b1618] px-2 py-0.5 rounded text-cyan-400 text-xs font-bold">{((event as any).homeOdds || 2.10).toFixed(2)}</span>
                        </button>
                        <button 
                          className="w-full bg-[#1e3a3f] hover:bg-cyan-800 text-cyan-300 py-2.5 px-3 rounded-sm text-sm font-medium transition-colors flex justify-between items-center border border-[#2a4c55]"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            addBet({
                              id: `${event.id}-away-${Date.now()}`,
                              eventId: String(event.id),
                              eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                              selectionName: event.awayTeam,
                              odds: (event as any).awayOdds || 3.40,
                              stake: 10,
                              market: "Match Result",
                              isLive: true,
                              uniqueId: Math.random().toString(36).substring(2, 8)
                            });
                          }}
                        >
                          <span>{event.awayTeam}</span>
                          <span className="bg-[#0b1618] px-2 py-0.5 rounded text-cyan-400 text-xs font-bold">{((event as any).awayOdds || 3.40).toFixed(2)}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Clickable link to event details */}
                <Link href={`/match/${event.id}`}>
                  <span className="absolute inset-0 cursor-pointer z-0"></span>
                </Link>
              </div>
            ))}
          </div>
        </div>
        
        {/* Sports Tabs */}
        <div className="flex items-center bg-[#214550] p-2 border-b border-[#2a4c55] overflow-x-auto sticky top-0 z-10 shadow-md">
          {sortedSports.map((sport, idx) => (
            <Button 
              key={idx}
              variant={idx === 0 ? "default" : "outline"} 
              size="sm" 
              className={`mr-2 text-xs whitespace-nowrap ${
                idx === 0 
                  ? 'bg-cyan-400 text-[#112225] hover:bg-cyan-500 font-semibold' 
                  : 'border-[#2a4c55] text-white hover:text-cyan-200 hover:border-cyan-400 bg-[#18323a]/70'
              }`}
            >
              {sport.name} ({sport.count})
            </Button>
          ))}
        </div>

        {/* Display events by sport in compact grid format */}
        <div className="p-3">
          {sortedSports.slice(0, 10).map((sport, sportIndex) => (
            <div key={sportIndex} className="mb-5 bg-[#0b1618] border border-[#1e3a3f] rounded-md overflow-hidden">
              {/* Sport header with collapsible accordion style */}
              <div 
                className="flex items-center justify-between p-3 bg-[#0b1618] cursor-pointer hover:bg-[#112225] transition-colors"
                onClick={() => toggleSportExpand(sport.name)}
              >
                <h3 className="text-cyan-400 font-bold flex items-center">
                  {expandedSports[sport.name] ? 
                    <ChevronDown className="h-4 w-4 mr-2 text-cyan-300" /> : 
                    <ChevronRight className="h-4 w-4 mr-2 text-cyan-300" />
                  }
                  {sport.name.toUpperCase()} 
                  <span className="ml-2 px-1.5 py-0.5 bg-[#1e3a3f] rounded-sm text-xs text-cyan-300/90">
                    {sport.count}
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-sm flex items-center font-semibold">
                    <span className="w-1 h-1 bg-white rounded-full mr-1 animate-pulse"></span>
                    LIVE
                  </span>
                  <Link href={`/sport/${sport.name.toLowerCase()}`} onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="border-cyan-400 text-cyan-300 hover:bg-cyan-400/20 text-xs">
                      View All
                    </Button>
                  </Link>
                </div>
              </div>
              
              {/* Show sport events when expanded */}
              {expandedSports[sport.name] && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                  {sport.events.slice(0, 3).map((event) => (
                    <Link key={event.id} href={`/match/${event.id}`}>
                      <div className="cursor-pointer bg-[#18323a] hover:bg-[#214550] p-3 border border-[#2a4c55] hover:border-cyan-400/50 rounded transition-all duration-200 shadow-md h-full">
                        <div className="flex justify-between items-center mb-2">
                          <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-sm flex items-center font-semibold">
                            <span className="w-1 h-1 bg-white rounded-full mr-1 animate-pulse"></span>
                            LIVE
                          </span>
                          <span className="text-cyan-300 text-xs font-medium">{event.leagueName}</span>
                        </div>
                        
                        {(() => {
                          const mkt0 = event.markets?.[0];
                          const outcomes = mkt0?.outcomes;
                          const mktName = mkt0?.name || "Match Result";
                          const homeOdds = outcomes?.[0]?.odds || (event as any).homeOdds || 1.90;
                          const awayOdds = outcomes?.[1]?.odds || (event as any).awayOdds || 2.10;
                          return (
                            <>
                              <div className="flex justify-between items-center mb-2.5">
                                <span className="text-cyan-300 font-bold truncate pr-2 max-w-[65%]">{event.homeTeam}</span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs bg-cyan-700/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 font-semibold px-3"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    addBet({
                                      id: `${event.id}-home-${Date.now()}`,
                                      eventId: String(event.id),
                                      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                                      selectionName: outcomes?.[0]?.name || event.homeTeam,
                                      odds: homeOdds,
                                      stake: 10,
                                      market: mktName,
                                      isLive: true,
                                      uniqueId: Math.random().toString(36).substring(2, 8)
                                    });
                                  }}
                                >
                                  {homeOdds.toFixed(2)}
                                </Button>
                              </div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-cyan-300 font-bold truncate pr-2 max-w-[65%]">{event.awayTeam}</span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs bg-cyan-700/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 font-semibold px-3"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    addBet({
                                      id: `${event.id}-away-${Date.now()}`,
                                      eventId: String(event.id),
                                      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                                      selectionName: outcomes?.[1]?.name || event.awayTeam,
                                      odds: awayOdds,
                                      stake: 10,
                                      market: mktName,
                                      isLive: true,
                                      uniqueId: Math.random().toString(36).substring(2, 8)
                                    });
                                  }}
                                >
                                  {awayOdds.toFixed(2)}
                                </Button>
                              </div>
                              {event.score && (
                                <div className="mt-3 text-center">
                                  <span className="text-cyan-300 text-sm font-bold bg-[#2a4c55] px-3 py-1 rounded shadow-inner shadow-black/20 border border-cyan-500/30">
                                    {event.score}
                                  </span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        
        <div className="p-3 text-center bg-gradient-to-r from-[#214550] to-[#2a5665] border-t border-[#2a4c55]">
          <Link href="/live">
            <Button variant="outline" className="border-cyan-400 text-cyan-300 bg-[#18323a]/70 hover:bg-cyan-500 hover:text-white hover:border-cyan-500 font-semibold shadow-md">
              View All Live Events
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}