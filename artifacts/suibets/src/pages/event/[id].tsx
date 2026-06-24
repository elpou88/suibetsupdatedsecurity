import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/layout/Layout";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { ChevronLeft, Clock, AlertTriangle, Info, Users, ArrowRight, Zap, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistance } from "date-fns";
import { formatOdds } from "@/lib/utils";
import { useBetting } from "@/context/BettingContext";
import { BetSlip } from "@/components/betting/BetSlip"; 
import { Separator } from "@/components/ui/separator";

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { addBet } = useBetting();
  const [activeTab, setActiveTab] = useState("match-winner");
  
  // Fetch event data
  const { data: event, isLoading, error } = useQuery({
    queryKey: ['/api/events', id],
    queryFn: () => apiRequest('GET', `/api/events/${id}`).then(resp => resp.json())
  });

  // Fetch P2P offers for this specific event
  const { data: p2pOffers = [] } = useQuery<any[]>({
    queryKey: ['/api/p2p/offers', 'event', id],
    queryFn: () =>
      fetch(`/api/p2p/offers?status=open&eventId=${id}`)
        .then(r => r.ok ? r.json() : [])
        .then(d => Array.isArray(d) ? d : [])
        .catch(() => []),
    refetchInterval: 20000,
    staleTime: 0,
  });
  
  // Handle adding a bet to the bet slip
  const handleAddBet = (selection: string, odds: number, market: string) => {
    if (!event) return;
    
    addBet({
      id: `${event.id}_${market}_${selection}`,
      eventId: event.id,
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      market: market,
      marketId: event.markets?.find(m => m.name.toLowerCase() === market.toLowerCase())?.id,
      selectionName: selection,
      odds: odds,
      stake: 10, // Default stake
      currency: 'SUI'
    });
  };

  // Format time until event
  const getTimeUntil = (startTime: string | number | Date) => {
    try {
      const startDate = new Date(startTime);
      return formatDistance(startDate, new Date(), { addSuffix: true });
    } catch (e) {
      return 'Unknown time';
    }
  };
  
  // Get current total goals for live market filtering
  const getCurrentTotalGoals = () => {
    if (!event) return 0;
    const homeScore = parseInt(String(event.homeScore || 0)) || 0;
    const awayScore = parseInt(String(event.awayScore || 0)) || 0;
    return homeScore + awayScore;
  };
  
  // Check if a goals market threshold is already decided
  const isGoalsMarketDecided = (threshold: number) => {
    if (!event?.isLive) return false;
    return getCurrentTotalGoals() > threshold;
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto mt-8 px-4 lg:px-8">
          <div className="flex items-center mb-4">
            <Button variant="ghost" onClick={() => setLocation("/")} className="mr-2">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">Loading Event...</h1>
          </div>
          
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !event) {
    return (
      <Layout>
        <div className="container mx-auto mt-8 px-4 lg:px-8">
          <div className="flex items-center mb-4">
            <Button variant="ghost" onClick={() => setLocation("/")} className="mr-2">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">Error Loading Event</h1>
          </div>
          
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <p>There was an error loading this event. Please try again.</p>
          </div>
          
          <Button onClick={() => setLocation("/")} className="mt-4">
            Return to Home
          </Button>
        </div>
      </Layout>
    );
  }
  
  // Use real markets from the event; fall back to standard markets using real API odds
  const markets = event.markets || [
    {
      id: 1,
      name: "Match Winner",
      outcomes: [
        { id: 1, name: event.homeTeam, odds: event.homeOdds || 1.9 },
        { id: 2, name: "Draw", odds: event.drawOdds || 3.4 },
        { id: 3, name: event.awayTeam, odds: event.awayOdds || 4.2 }
      ]
    },
    {
      id: 2,
      name: "Total Goals",
      outcomes: [
        { id: 4, name: "Over 2.5", odds: 1.85 },
        { id: 5, name: "Under 2.5", odds: 1.95 }
      ]
    },
    {
      id: 3,
      name: "Both Teams to Score",
      outcomes: [
        { id: 6, name: "Yes", odds: 1.75 },
        { id: 7, name: "No", odds: 2.05 }
      ]
    }
  ];
  
  return (
    <Layout>
      <div className="container mx-auto mt-4 mb-16 px-4 lg:px-8">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Main content */}
          <div className="flex-1">
            <div className="flex items-center mb-4">
              <Button variant="ghost" onClick={() => setLocation("/")} className="mr-2">
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-bold truncate">{event.homeTeam} vs {event.awayTeam}</h1>
            </div>
            
            <div className="bg-muted/40 p-4 rounded-lg mb-6">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {event.isLive ? 'LIVE' : getTimeUntil(event.startTime)}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {event.leagueName || 'League'} • {event.sportName || 'Sport'}
                </div>
              </div>
              
              <div className="mt-4 flex justify-between items-center">
                <div className="text-center flex-1">
                  <div className="text-xl font-bold">{event.homeTeam}</div>
                  <div className="text-sm text-muted-foreground">Home</div>
                </div>
                
                <div className="text-center px-4">
                  <div className="text-2xl font-bold">
                    {event.homeScore !== undefined && event.awayScore !== undefined ? 
                      `${event.homeScore} - ${event.awayScore}` : 
                      'vs'}
                  </div>
                  {event.isLive && <div className="text-xs text-red-500 font-semibold">LIVE</div>}
                </div>
                
                <div className="text-center flex-1">
                  <div className="text-xl font-bold">{event.awayTeam}</div>
                  <div className="text-sm text-muted-foreground">Away</div>
                </div>
              </div>
            </div>
            
            <Tabs defaultValue="match-winner" className="w-full" value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full mb-4">
                <TabsTrigger value="match-winner" className="flex-1">Match Winner</TabsTrigger>
                <TabsTrigger value="goals" className="flex-1">Goals</TabsTrigger>
                <TabsTrigger value="props" className="flex-1">Props</TabsTrigger>
                <TabsTrigger value="p2p" className="flex-1 relative">
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  P2P
                  {p2pOffers.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {p2pOffers.length > 9 ? '9+' : p2pOffers.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="match-winner">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Match Winner</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <Button 
                        variant="outline"
                        className="h-20 flex flex-col items-center justify-center"
                        onClick={() => handleAddBet(event.homeTeam, event.homeOdds || 1.9, "Match Winner")}
                      >
                        <div className="text-sm">{event.homeTeam}</div>
                        <div className="text-lg font-bold">{formatOdds(event.homeOdds || 1.9)}</div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-20 flex flex-col items-center justify-center"
                        onClick={() => handleAddBet("Draw", event.drawOdds || 3.4, "Match Winner")}
                      >
                        <div className="text-sm">Draw</div>
                        <div className="text-lg font-bold">{formatOdds(event.drawOdds || 3.4)}</div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-20 flex flex-col items-center justify-center"
                        onClick={() => handleAddBet(event.awayTeam, event.awayOdds || 4.2, "Match Winner")}
                      >
                        <div className="text-sm">{event.awayTeam}</div>
                        <div className="text-lg font-bold">{formatOdds(event.awayOdds || 4.2)}</div>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                
                <Card className="mt-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Double Chance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <Button 
                        variant="outline"
                        className="h-20 flex flex-col items-center justify-center"
                        onClick={() => handleAddBet(`${event.homeTeam} or Draw`, 1.25, "Double Chance")}
                      >
                        <div className="text-sm">{event.homeTeam} or Draw</div>
                        <div className="text-lg font-bold">{formatOdds(1.25)}</div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-20 flex flex-col items-center justify-center"
                        onClick={() => handleAddBet(`${event.homeTeam} or ${event.awayTeam}`, 1.3, "Double Chance")}
                      >
                        <div className="text-sm">{event.homeTeam} or {event.awayTeam}</div>
                        <div className="text-lg font-bold">{formatOdds(1.3)}</div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-20 flex flex-col items-center justify-center"
                        onClick={() => handleAddBet(`${event.awayTeam} or Draw`, 1.85, "Double Chance")}
                      >
                        <div className="text-sm">{event.awayTeam} or Draw</div>
                        <div className="text-lg font-bold">{formatOdds(1.85)}</div>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="goals">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Total Goals</CardTitle>
                    {event?.isLive && getCurrentTotalGoals() > 0 && (
                      <p className="text-xs text-muted-foreground">Current: {getCurrentTotalGoals()} goals</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {/* Over/Under 2.5 - only show if not decided */}
                    {!isGoalsMarketDecided(2.5) ? (
                      <div className="grid grid-cols-2 gap-3">
                        <Button 
                          variant="outline"
                          className="h-16"
                          onClick={() => handleAddBet("Over 2.5", 1.85, "Total Goals")}
                        >
                          <div className="flex flex-col items-center">
                            <span>Over 2.5</span>
                            <span className="text-lg font-bold">{formatOdds(1.85)}</span>
                          </div>
                        </Button>
                        
                        <Button 
                          variant="outline"
                          className="h-16"
                          onClick={() => handleAddBet("Under 2.5", 1.95, "Total Goals")}
                        >
                          <div className="flex flex-col items-center">
                            <span>Under 2.5</span>
                            <span className="text-lg font-bold">{formatOdds(1.95)}</span>
                          </div>
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 bg-muted/50 rounded-lg text-center text-sm text-muted-foreground">
                        Over/Under 2.5 - Market decided (3+ goals scored)
                      </div>
                    )}
                    
                    <Separator className="my-4" />
                    
                    {/* Over/Under 3.5 - only show if not decided */}
                    {!isGoalsMarketDecided(3.5) ? (
                      <div className="grid grid-cols-2 gap-3">
                        <Button 
                          variant="outline"
                          className="h-16"
                          onClick={() => handleAddBet("Over 3.5", 3.1, "Total Goals")}
                        >
                          <div className="flex flex-col items-center">
                            <span>Over 3.5</span>
                            <span className="text-lg font-bold">{formatOdds(3.1)}</span>
                          </div>
                        </Button>
                        
                        <Button 
                          variant="outline"
                          className="h-16"
                          onClick={() => handleAddBet("Under 3.5", 1.35, "Total Goals")}
                        >
                          <div className="flex flex-col items-center">
                            <span>Under 3.5</span>
                            <span className="text-lg font-bold">{formatOdds(1.35)}</span>
                          </div>
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 bg-muted/50 rounded-lg text-center text-sm text-muted-foreground">
                        Over/Under 3.5 - Market decided (4+ goals scored)
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                <Card className="mt-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Both Teams to Score</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <Button 
                        variant="outline"
                        className="h-16"
                        onClick={() => handleAddBet("Yes", 1.75, "Both Teams to Score")}
                      >
                        <div className="flex flex-col items-center">
                          <span>Yes</span>
                          <span className="text-lg font-bold">{formatOdds(1.75)}</span>
                        </div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-16"
                        onClick={() => handleAddBet("No", 2.05, "Both Teams to Score")}
                      >
                        <div className="flex flex-col items-center">
                          <span>No</span>
                          <span className="text-lg font-bold">{formatOdds(2.05)}</span>
                        </div>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="props">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">First Goalscorer</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {['Player 1', 'Player 2', 'Player 3', 'Player 4'].map((player, idx) => (
                        <Button 
                          key={idx}
                          variant="outline"
                          className="h-16"
                          onClick={() => handleAddBet(player, 6.0 + idx, "First Goalscorer")}
                        >
                          <div className="flex flex-col items-center">
                            <span>{player}</span>
                            <span className="text-lg font-bold">{formatOdds(6.0 + idx)}</span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                
                <Card className="mt-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Half-Time/Full-Time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { result: `${event.homeTeam}/Draw`, odds: 15.0 },
                        { result: `${event.homeTeam}/${event.homeTeam}`, odds: 3.4 },
                        { result: `Draw/${event.homeTeam}`, odds: 5.0 },
                        { result: `${event.awayTeam}/Draw`, odds: 15.0 },
                        { result: `Draw/Draw`, odds: 4.5 },
                        { result: `Draw/${event.awayTeam}`, odds: 7.5 },
                        { result: `${event.homeTeam}/${event.awayTeam}`, odds: 25.0 },
                        { result: `${event.awayTeam}/${event.awayTeam}`, odds: 5.5 },
                        { result: `${event.awayTeam}/${event.homeTeam}`, odds: 25.0 }
                      ].map((item, idx) => (
                        <Button 
                          key={idx}
                          variant="outline"
                          className="h-16 text-xs"
                          onClick={() => handleAddBet(item.result, item.odds, "Half-Time/Full-Time")}
                        >
                          <div className="flex flex-col items-center">
                            <span>{item.result}</span>
                            <span className="text-base font-bold">{formatOdds(item.odds)}</span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                
                <Card className="mt-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Correct Score</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { score: '1-0', odds: 7.0 },
                        { score: '2-0', odds: 9.0 },
                        { score: '2-1', odds: 8.5 },
                        { score: '0-0', odds: 10.0 },
                        { score: '1-1', odds: 6.0 },
                        { score: '0-1', odds: 11.0 }
                      ].map((item, idx) => (
                        <Button 
                          key={idx}
                          variant="outline"
                          className="h-16"
                          onClick={() => handleAddBet(item.score, item.odds, "Correct Score")}
                        >
                          <div className="flex flex-col items-center">
                            <span>{item.score}</span>
                            <span className="text-lg font-bold">{formatOdds(item.odds)}</span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                
                <Card className="mt-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Team to Score First</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <Button 
                        variant="outline"
                        className="h-16"
                        onClick={() => handleAddBet(event.homeTeam, 1.85, "Team to Score First")}
                      >
                        <div className="flex flex-col items-center">
                          <span>{event.homeTeam}</span>
                          <span className="text-lg font-bold">{formatOdds(1.85)}</span>
                        </div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-16"
                        onClick={() => handleAddBet("No Goal", 9.5, "Team to Score First")}
                      >
                        <div className="flex flex-col items-center">
                          <span>No Goal</span>
                          <span className="text-lg font-bold">{formatOdds(9.5)}</span>
                        </div>
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="h-16"
                        onClick={() => handleAddBet(event.awayTeam, 2.1, "Team to Score First")}
                      >
                        <div className="flex flex-col items-center">
                          <span>{event.awayTeam}</span>
                          <span className="text-lg font-bold">{formatOdds(2.1)}</span>
                        </div>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── P2P Bets Tab ─────────────────────────────────────────── */}
              <TabsContent value="p2p">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-yellow-500" />
                      <span className="font-semibold text-sm">P2P Offers for this Match</span>
                      {p2pOffers.length > 0 && (
                        <Badge variant="secondary" className="text-xs">{p2pOffers.length} open</Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1"
                      onClick={() => setLocation('/p2p')}
                    >
                      Post Offer <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>

                  {p2pOffers.length === 0 ? (
                    <Card>
                      <CardContent className="py-10 text-center">
                        <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                        <p className="text-sm font-medium mb-1">No P2P offers yet</p>
                        <p className="text-xs text-muted-foreground mb-4">Be the first to post a bet offer on this match</p>
                        <Button size="sm" onClick={() => setLocation('/p2p')}>
                          Post a P2P Offer <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {/* Column headers */}
                      <div className="grid grid-cols-5 gap-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <span>Prediction</span>
                        <span className="text-right">Odds</span>
                        <span className="text-right">Stake</span>
                        <span className="text-right">Available</span>
                        <span className="text-right">Action</span>
                      </div>

                      {p2pOffers.map((offer: any) => {
                        const remaining = (offer.takerStake || 0) - (offer.filledStake || 0);
                        const pct = offer.takerStake > 0 ? Math.round((offer.filledStake || 0) / offer.takerStake * 100) : 0;
                        const predLabel = offer.prediction === 'home'
                          ? (event?.homeTeam || 'Home')
                          : offer.prediction === 'away'
                          ? (event?.awayTeam || 'Away')
                          : offer.prediction === 'draw' ? 'Draw' : offer.prediction;
                        const predColor = offer.prediction === 'home'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : offer.prediction === 'away'
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                          : 'bg-muted text-muted-foreground border-border';

                        return (
                          <Card key={offer.id} className="overflow-hidden border border-border/60 hover:border-primary/30 transition-colors">
                            <CardContent className="py-3 px-3">
                              <div className="grid grid-cols-5 gap-2 items-center">
                                {/* Prediction */}
                                <div>
                                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${predColor}`}>
                                    {predLabel}
                                  </span>
                                  <div className="text-[10px] text-muted-foreground mt-1">{offer.currency}</div>
                                </div>

                                {/* Odds */}
                                <div className="text-right">
                                  <span className="font-bold text-sm text-yellow-500">{Number(offer.odds).toFixed(2)}x</span>
                                </div>

                                {/* Creator stake */}
                                <div className="text-right">
                                  <span className="text-xs font-medium">
                                    {offer.creatorStake >= 1000
                                      ? `${(offer.creatorStake / 1000).toFixed(1)}k`
                                      : offer.creatorStake}
                                  </span>
                                  <div className="text-[10px] text-muted-foreground">creator</div>
                                </div>

                                {/* Available liquidity */}
                                <div className="text-right">
                                  <span className={`text-xs font-medium ${remaining <= 0 ? 'text-muted-foreground' : 'text-green-400'}`}>
                                    {remaining >= 1000
                                      ? `${(remaining / 1000).toFixed(1)}k`
                                      : remaining.toFixed(0)}
                                  </span>
                                  {pct > 0 && (
                                    <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="h-full bg-green-500 rounded-full"
                                        style={{ width: `${100 - pct}%` }}
                                      />
                                    </div>
                                  )}
                                </div>

                                {/* Accept button */}
                                <div className="text-right">
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs px-2 gap-1"
                                    onClick={() => setLocation(`/p2p`)}
                                    disabled={remaining <= 0}
                                  >
                                    Accept <ArrowRight className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}

                      {/* Footer CTA */}
                      <div className="flex items-center justify-between pt-1 pb-2 px-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" /> P2P — no house edge, user vs user
                        </span>
                        <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setLocation('/p2p')}>
                          View all on P2P hub →
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
          
          {/* Bet slip sidebar */}
          <div className="md:w-96">
            <BetSlip />

            {/* P2P quick-access card */}
            {p2pOffers.length > 0 && (
              <Card className="mt-4 border-yellow-500/20 bg-yellow-500/5">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-yellow-500" />
                      P2P Offers Available
                    </span>
                    <Badge className="bg-green-500 text-white text-xs">{p2pOffers.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3 text-xs text-muted-foreground space-y-2">
                  <p>{p2pOffers.length} peer-to-peer offer{p2pOffers.length !== 1 ? 's' : ''} open for this match — bet at user-set odds with no house edge.</p>
                  <Button size="sm" className="w-full h-7 text-xs" onClick={() => setActiveTab('p2p')}>
                    View P2P Offers <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center">
                  <Info className="h-4 w-4 mr-2" />
                  Event Information
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div>
                  <span className="font-semibold">League:</span> {event.leagueName || 'Unknown League'}
                </div>
                <div>
                  <span className="font-semibold">Sport:</span> {event.sportName || 'Football'}
                </div>
                <div>
                  <span className="font-semibold">Stadium:</span> {event.venue || 'Not specified'}
                </div>
                <div>
                  <span className="font-semibold">Blockchain Verified:</span> Yes (Wurlus Protocol)
                </div>
                <div>
                  <span className="font-semibold">Tokens Accepted:</span> SUI, SBETS
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}