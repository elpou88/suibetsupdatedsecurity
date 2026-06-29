import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Event } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Info, Play } from "lucide-react";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBetting } from "@/context/BettingContext";
import { formatOdds } from "@/lib/utils";

interface MatchDetailsProps {
  eventId: number;
}

// ── Football market definitions ───────────────────────────────────────────────

const OVER_UNDER_LINES = [
  { line: '0.5', overOdds: 1.15, underOdds: 6.50 },
  { line: '1.5', overOdds: 1.55, underOdds: 2.45 },
  { line: '2.5', overOdds: 1.95, underOdds: 1.85 },
  { line: '3.5', overOdds: 2.80, underOdds: 1.42 },
  { line: '4.5', overOdds: 4.50, underOdds: 1.22 },
];

export function MatchDetails({ eventId }: MatchDetailsProps) {
  const [selectedTab, setSelectedTab] = useState("match-winner");
  const { addBet } = useBetting();

  const { data: event, isLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
  });

  if (isLoading) {
    return <div className="p-12 text-center">Loading match details...</div>;
  }

  if (!event) {
    return <div className="p-12 text-center">Match not found</div>;
  }

  const homeTeam = event.homeTeam || 'Home';
  const awayTeam = event.awayTeam || 'Away';
  const isSoccer = (event.sport || '').toLowerCase().includes('soccer') ||
    (event.sport || '').toLowerCase().includes('football') ||
    (event.leagueName || '').toLowerCase().includes('league') ||
    (event.leagueName || '').toLowerCase().includes('premier') ||
    (event.leagueName || '').toLowerCase().includes('bundesliga') ||
    (event.leagueName || '').toLowerCase().includes('laliga') ||
    (event.leagueName || '').toLowerCase().includes('serie a') ||
    (event.leagueName || '').toLowerCase().includes('ligue 1') ||
    (event.leagueName || '').toLowerCase().includes('champions');

  const handleBetClick = (
    prediction: string,
    selectionName: string,
    odds: number,
    market: string,
  ) => {
    addBet({
      id: `${event.id}-${market}-${prediction}`,
      eventId: event.id,
      eventName: `${homeTeam} vs ${awayTeam}`,
      homeTeam,
      awayTeam,
      prediction,
      selectionName,
      odds,
      stake: 10,
      market,
      leagueName: event.leagueName || event.league || undefined,
      sportName: event.sport || undefined,
      matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
    } as any);
  };

  return (
    <div className="p-4">
      <div className="flex items-center mb-4">
        <Link href="/">
          <Button variant="ghost" className="text-gray-500">
            <ChevronLeft className="h-5 w-5 mr-1" />
            Back
          </Button>
        </Link>
        
        <div className="ml-2 flex items-center space-x-2">
          <Button variant="outline" className="text-sm flex items-center">
            {event.leagueName}
            <ChevronLeft className="h-4 w-4 ml-1 rotate-270" />
          </Button>
        </div>
      </div>
      
      <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
        {/* Match Info */}
        <div className="w-full md:w-2/3 bg-gray-50 rounded-lg p-4">
          <div className="mb-4">
            <h2 className="text-lg font-medium">
              {homeTeam} vs {awayTeam}
            </h2>
            <h3 className="text-sm font-medium text-gray-500 flex items-center mt-2">
              <ChevronLeft className="h-4 w-4 mr-1 rotate-90" />
              Scores
              <Info className="h-4 w-4 ml-1 text-gray-400" />
            </h3>
            <div className="text-xs text-gray-500 mt-1">
              {event.isLive ? "Live" : "Upcoming"}
              {event.score && ` - Score: ${event.score}`}
            </div>
          </div>
          
          <Tabs defaultValue="match-winner" onValueChange={setSelectedTab}>
            <TabsList className={`grid ${isSoccer ? 'grid-cols-4' : 'grid-cols-3'} text-xs`}>
              <TabsTrigger value="match-winner">Winner</TabsTrigger>
              {isSoccer && <TabsTrigger value="over-under">Over/Under</TabsTrigger>}
              {isSoccer && <TabsTrigger value="btts-dc">BTTS / DC</TabsTrigger>}
              <TabsTrigger value="handicap">Handicap</TabsTrigger>
              {!isSoccer && <TabsTrigger value="totals">Totals</TabsTrigger>}
            </TabsList>
            
            {/* ── Match Winner ── */}
            <TabsContent value="match-winner" className="mt-4">
              <div className={`grid ${event.drawOdds ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
                <Button
                  variant="outline"
                  className="p-3 h-auto"
                  onClick={() => handleBetClick('home', homeTeam, event.homeOdds || 1.5, 'match-winner')}
                >
                  <div className="flex flex-col items-center w-full">
                    <span className="text-xs text-gray-500">1</span>
                    <span className="font-medium text-sm truncate max-w-full">{homeTeam}</span>
                    <span className="text-lg font-bold">{formatOdds(event.homeOdds || 1.5)}</span>
                  </div>
                </Button>

                {event.drawOdds && (
                  <Button
                    variant="outline"
                    className="p-3 h-auto"
                    onClick={() => handleBetClick('draw', 'Draw', event.drawOdds, 'match-winner')}
                  >
                    <div className="flex flex-col items-center w-full">
                      <span className="text-xs text-gray-500">X</span>
                      <span className="font-medium text-sm">Draw</span>
                      <span className="text-lg font-bold">{formatOdds(event.drawOdds)}</span>
                    </div>
                  </Button>
                )}

                <Button
                  variant="outline"
                  className="p-3 h-auto"
                  onClick={() => handleBetClick('away', awayTeam, event.awayOdds || 6.5, 'match-winner')}
                >
                  <div className="flex flex-col items-center w-full">
                    <span className="text-xs text-gray-500">2</span>
                    <span className="font-medium text-sm truncate max-w-full">{awayTeam}</span>
                    <span className="text-lg font-bold">{formatOdds(event.awayOdds || 6.5)}</span>
                  </div>
                </Button>
              </div>
            </TabsContent>

            {/* ── Over / Under (football only) ── */}
            {isSoccer && (
              <TabsContent value="over-under" className="mt-4">
                <div className="space-y-2">
                  {/* Header row */}
                  <div className="grid grid-cols-3 text-xs text-gray-400 font-semibold px-2">
                    <span>Line</span>
                    <span className="text-center">Over</span>
                    <span className="text-center">Under</span>
                  </div>
                  {OVER_UNDER_LINES.map(({ line, overOdds, underOdds }) => (
                    <div key={line} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-sm font-bold text-gray-700 px-2">{line} Goals</span>
                      <Button
                        variant="outline"
                        className="p-2 h-auto text-center"
                        onClick={() => handleBetClick(`over_${line}`, `Over ${line} Goals`, overOdds, 'over-under')}
                      >
                        <div className="flex flex-col items-center">
                          <span className="text-xs text-gray-500">Over</span>
                          <span className="font-bold">{overOdds.toFixed(2)}</span>
                        </div>
                      </Button>
                      <Button
                        variant="outline"
                        className="p-2 h-auto text-center"
                        onClick={() => handleBetClick(`under_${line}`, `Under ${line} Goals`, underOdds, 'over-under')}
                      >
                        <div className="flex flex-col items-center">
                          <span className="text-xs text-gray-500">Under</span>
                          <span className="font-bold">{underOdds.toFixed(2)}</span>
                        </div>
                      </Button>
                    </div>
                  ))}
                </div>
              </TabsContent>
            )}

            {/* ── BTTS + Double Chance (football only) ── */}
            {isSoccer && (
              <TabsContent value="btts-dc" className="mt-4 space-y-4">
                {/* Both Teams to Score */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Both Teams to Score</div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      className="p-3 h-auto"
                      onClick={() => handleBetClick('btts_yes', 'BTTS Yes', 1.80, 'btts')}
                    >
                      <div className="flex flex-col items-center w-full">
                        <span className="text-xs text-gray-500">Yes</span>
                        <span className="font-medium text-sm">Both Score</span>
                        <span className="text-lg font-bold">1.80</span>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="p-3 h-auto"
                      onClick={() => handleBetClick('btts_no', 'BTTS No', 2.00, 'btts')}
                    >
                      <div className="flex flex-col items-center w-full">
                        <span className="text-xs text-gray-500">No</span>
                        <span className="font-medium text-sm">Not Both</span>
                        <span className="text-lg font-bold">2.00</span>
                      </div>
                    </Button>
                  </div>
                </div>

                {/* Double Chance */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Double Chance</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      className="p-3 h-auto"
                      onClick={() => handleBetClick('home_or_draw', `${homeTeam} or Draw`, 1.45, 'double-chance')}
                    >
                      <div className="flex flex-col items-center w-full">
                        <span className="text-xs text-gray-500">1X</span>
                        <span className="font-medium text-xs truncate max-w-full">{homeTeam} or Draw</span>
                        <span className="text-base font-bold">1.45</span>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="p-3 h-auto"
                      onClick={() => handleBetClick('home_or_away', 'Either Team Wins', 1.35, 'double-chance')}
                    >
                      <div className="flex flex-col items-center w-full">
                        <span className="text-xs text-gray-500">12</span>
                        <span className="font-medium text-xs">Either Wins</span>
                        <span className="text-base font-bold">1.35</span>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="p-3 h-auto"
                      onClick={() => handleBetClick('away_or_draw', `${awayTeam} or Draw`, 1.70, 'double-chance')}
                    >
                      <div className="flex flex-col items-center w-full">
                        <span className="text-xs text-gray-500">X2</span>
                        <span className="font-medium text-xs truncate max-w-full">{awayTeam} or Draw</span>
                        <span className="text-base font-bold">1.70</span>
                      </div>
                    </Button>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── Handicap (all sports — enhanced for football) ── */}
            <TabsContent value="handicap" className="mt-4">
              {isSoccer ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 text-xs text-gray-400 font-semibold px-2">
                    <span>{homeTeam}</span>
                    <span className="text-center">Handicap</span>
                    <span className="text-right">{awayTeam}</span>
                  </div>
                  {[
                    { h: '-1.5', homeOdds: 3.20, awayOdds: 1.35 },
                    { h: '-0.5', homeOdds: 1.90, awayOdds: 1.90 },
                    { h: '+0.5', homeOdds: 1.30, awayOdds: 3.00 },
                    { h: '+1.5', homeOdds: 1.15, awayOdds: 5.50 },
                  ].map(({ h, homeOdds, awayOdds }) => (
                    <div key={h} className="grid grid-cols-3 gap-2 items-center">
                      <Button
                        variant="outline"
                        className="p-2 h-auto"
                        onClick={() => handleBetClick(`home_${h}`, `${homeTeam} ${h}`, homeOdds, 'handicap')}
                      >
                        <div className="flex flex-col items-center w-full">
                          <span className="text-xs font-bold">{h}</span>
                          <span className="font-bold">{homeOdds.toFixed(2)}</span>
                        </div>
                      </Button>
                      <span className="text-center text-xs text-gray-500 font-semibold">AH</span>
                      <Button
                        variant="outline"
                        className="p-2 h-auto"
                        onClick={() => {
                          const awayH = h.startsWith('-') ? '+' + h.slice(1) : '-' + h.slice(1);
                          handleBetClick(`away_${awayH}`, `${awayTeam} ${awayH}`, awayOdds, 'handicap');
                        }}
                      >
                        <div className="flex flex-col items-center w-full">
                          <span className="text-xs font-bold">
                            {h.startsWith('-') ? '+' + h.slice(1) : '-' + h.slice(1)}
                          </span>
                          <span className="font-bold">{awayOdds.toFixed(2)}</span>
                        </div>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    className="p-3 h-auto"
                    onClick={() => handleBetClick(`home_-1`, `${homeTeam} -1`, 2.01, 'handicap')}
                  >
                    <div className="flex flex-col items-center w-full">
                      <span className="font-medium">{homeTeam} -1</span>
                      <span className="text-lg font-bold">2.01</span>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="p-3 h-auto"
                    onClick={() => handleBetClick(`away_+1`, `${awayTeam} +1`, 1.77, 'handicap')}
                  >
                    <div className="flex flex-col items-center w-full">
                      <span className="font-medium">{awayTeam} +1</span>
                      <span className="text-lg font-bold">1.77</span>
                    </div>
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Totals (non-football sports) ── */}
            {!isSoccer && (
              <TabsContent value="totals" className="mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    className="p-3 h-auto"
                    onClick={() => handleBetClick('over_2.5', 'Over 2.5', 1.95, 'totals')}
                  >
                    <div className="flex flex-col items-center w-full">
                      <span className="font-medium">Over 2.5</span>
                      <span className="text-lg font-bold">1.95</span>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="p-3 h-auto"
                    onClick={() => handleBetClick('under_2.5', 'Under 2.5', 1.85, 'totals')}
                  >
                    <div className="flex flex-col items-center w-full">
                      <span className="font-medium">Under 2.5</span>
                      <span className="text-lg font-bold">1.85</span>
                    </div>
                  </Button>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
        
        {/* Match Video/Preview */}
        <div className="w-full md:w-1/3 bg-gray-900 rounded-lg overflow-hidden relative">
          <div className="relative pt-[56.25%]">
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="relative w-full h-full">
                <div className="w-full h-full bg-gradient-to-br from-gray-900 to-gray-700"></div>
                {event.isLive && (
                  <div className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded">
                    LIVE
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-primary/70 flex items-center justify-center cursor-pointer">
                    <Play className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-gray-50 rounded-lg p-4 mt-6">
        <h2 className="text-gray-700 font-semibold mb-2">
          {event.isLive ? "LIVE" : ""} Crypto Betting on {event.leagueName}
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          On SuiBets our people can make bets on live data of {event.leagueName}, and tons of other activities. 
          For example: {event.leagueName} - {homeTeam} vs {awayTeam}. 
          SuiBet is a dedicated sports book using the Sui blockchain and Wurlus protocol.
        </p>
        <Button variant="link" className="text-primary text-sm p-0 h-auto">
          Show more
        </Button>
      </div>
    </div>
  );
}
