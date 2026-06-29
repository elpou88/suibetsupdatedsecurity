import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import Layout from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Radio, Clock, TrendingUp, Filter, Zap, Users } from 'lucide-react';
import SimpleMarkets from '@/components/betting/SimpleMarkets';
import { useLiveEvents, SportEvent } from '@/hooks/useEvents';
import { useLiveClock } from '@/hooks/useLiveClock';

/**
 * Isolated per-event card so useLiveClock can run inside the map.
 * The clock ticks every second — no page refresh needed.
 */
function LiveEventCardItem({
  event,
  getSportName,
  p2pCount = 0,
}: {
  event: SportEvent;
  getSportName: (id: number) => string;
  p2pCount?: number;
}) {
  const liveClock = useLiveClock(event, event.sportId);
  const [, setLocation] = useLocation();

  return (
    <Card className="bg-[#112225] border-[#1e3a3f] hover:border-cyan-400/50 transition-colors">
      <CardHeader className="border-b border-[#1e3a3f]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Badge variant="destructive" className="animate-pulse">
              <Radio className="h-3 w-3 mr-1" />
              LIVE
            </Badge>
            <span className="text-sm text-gray-400">
              {getSportName(event.sportId)}
            </span>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-cyan-400">
              {event.homeScore || 0} - {event.awayScore || 0}
            </div>
            <div className="text-sm text-green-400 font-mono font-bold">
              {liveClock}
            </div>
          </div>
        </div>

        <CardTitle className="text-white text-lg">
          {event.homeTeam} vs {event.awayTeam}
        </CardTitle>

        {event.league && (
          <p className="text-sm text-gray-400">{event.league}</p>
        )}
      </CardHeader>

      <CardContent className="p-4">
        {/* Live Stats */}
        {(event.stats || event.minute) && (
          <div className="mb-4 p-3 bg-[#0b1618] rounded border border-[#1e3a3f]">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-cyan-400">
                  {event.homeScore || 0}
                </div>
                <div className="text-xs text-gray-400">{event.homeTeam}</div>
              </div>
              <div>
                <div className="text-green-400 font-bold font-mono">
                  {liveClock}
                </div>
                <div className="text-xs text-gray-400">Live</div>
              </div>
              <div>
                <div className="text-lg font-bold text-cyan-400">
                  {event.awayScore || 0}
                </div>
                <div className="text-xs text-gray-400">{event.awayTeam}</div>
              </div>
            </div>
          </div>
        )}

        {/* Live Betting Markets */}
        <SimpleMarkets
          event={event}
          eventId={event.id}
          sportType={getSportName(event.sportId).toLowerCase()}
          isLive={true}
        />

        {/* P2P strip */}
        <div className="mt-3 pt-3 border-t border-[#1e3a3f] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            {p2pCount > 0 ? (
              <span className="text-xs text-purple-300 font-medium">
                {p2pCount} P2P offer{p2pCount !== 1 ? 's' : ''} open
              </span>
            ) : (
              <span className="text-xs text-gray-500">No P2P offers yet</span>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            {p2pCount > 0 && (
              <button
                onClick={() => setLocation(`/p2p?event=${event.id}`)}
                className="text-xs px-2.5 py-1 rounded-md bg-purple-500/10 border border-purple-500/25 text-purple-400 hover:bg-purple-500/20 transition-colors"
              >
                View
              </button>
            )}
            <button
              onClick={() =>
                setLocation(
                  `/p2p?event=${event.id}&match=${encodeURIComponent(
                    `${event.homeTeam} vs ${event.awayTeam}`
                  )}`
                )
              }
              className="text-xs px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white transition-colors flex items-center gap-1"
            >
              <Zap className="h-3 w-3" /> Post P2P
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LiveEventsPage() {
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [, setLocation] = useLocation();

  const { data: liveEvents = [], isLoading: liveLoading } = useLiveEvents(selectedSport);

  const { data: allP2POffers = [] } = useQuery<any[]>({
    queryKey: ['/api/p2p/offers', 'live-events-count'],
    queryFn: () =>
      fetch('/api/p2p/offers?status=open')
        .then(r => r.ok ? r.json() : [])
        .then(d => Array.isArray(d) ? d : [])
        .catch(() => []),
    refetchInterval: 30000,
    staleTime: 0,
  });

  const p2pCountByEvent = allP2POffers.reduce<Record<string, number>>((acc, o) => {
    if (o.eventId) acc[String(o.eventId)] = (acc[String(o.eventId)] || 0) + 1;
    return acc;
  }, {});

  const totalP2POffers = allP2POffers.length;

  // Get unique sports from events
  const availableSports = [
    { id: 'all', name: 'All Sports' },
    ...Array.from(new Set(liveEvents.map(event => event.sportId)))
      .map(sportId => ({
        id: sportId.toString(),
        name: getSportName(sportId)
      }))
  ];

  function getSportName(sportId: number): string {
    const sportNames: Record<number, string> = {
      1: '⚽ Football',
      2: '🏀 Basketball', 
      3: '🎾 Tennis',
      4: '⚾ Baseball',
      5: '🏒 Hockey',
      6: '🤾 Handball',
      7: '🏐 Volleyball',
      8: '🏉 Rugby',
      9: '🏏 Cricket',
      10: '⛳ Golf',
      11: '🥊 Boxing',
      12: '🥋 MMA',
      13: '🏎️ Formula 1',
      14: '🚴 Cycling',
      15: '🏈 American Football',
      20: '🎭 WWE Entertainment',
      23: '🏎️ Motorsports',
      26: '⚽ Soccer'
    };
    return sportNames[sportId] || `Sport ${sportId}`;
  }

  const filteredEvents = selectedSport === 'all' 
    ? liveEvents 
    : liveEvents.filter(event => event.sportId.toString() === selectedSport);

  return (
    <Layout title="Live Events">
      <div className="min-h-screen bg-[#0b1618] text-white py-6">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Radio className="h-8 w-8 text-red-500 animate-pulse" />
              <div>
                <h1 className="text-3xl font-bold text-cyan-400">Live Events</h1>
                <p className="text-gray-400">Real-time sporting events happening now</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Badge variant="destructive" className="animate-pulse">
                <Radio className="h-3 w-3 mr-1" />
                LIVE
              </Badge>
              <span className="text-sm text-gray-400">
                {filteredEvents.length} events
              </span>
            </div>
          </div>

          {/* P2P Banner */}
          {totalP2POffers > 0 && (
            <div className="mb-5 rounded-xl border border-purple-500/30 bg-purple-500/5 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-purple-400 shrink-0" />
                <p className="text-sm text-purple-300 font-medium">
                  {totalP2POffers} P2P offer{totalP2POffers !== 1 ? 's' : ''} open on live matches — bet peer-to-peer with no house edge
                </p>
              </div>
              <button
                onClick={() => setLocation('/p2p')}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors shrink-0 flex items-center gap-1"
              >
                <Zap className="h-3 w-3" /> P2P Hub
              </button>
            </div>
          )}

          {/* Sports Filter */}
          <Card className="bg-[#112225] border-[#1e3a3f] mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center text-cyan-300">
                <Filter className="h-5 w-5 mr-2" />
                Filter by Sport
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {availableSports.map((sport) => (
                  <Button
                    key={sport.id}
                    variant={selectedSport === sport.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSport(sport.id)}
                    className={`${
                      selectedSport === sport.id 
                        ? 'bg-cyan-600 text-white' 
                        : 'border-[#1e3a3f] text-gray-300 hover:border-cyan-400 hover:text-cyan-400'
                    }`}
                  >
                    {sport.name}
                    {sport.id !== 'all' && (
                      <Badge variant="secondary" className="ml-2 bg-[#1e3a3f]">
                        {liveEvents.filter(e => e.sportId.toString() === sport.id).length}
                      </Badge>
                    )}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Loading State */}
          {liveLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="bg-[#112225] border-[#1e3a3f] animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-4 bg-[#1e3a3f] rounded mb-4"></div>
                    <div className="h-8 bg-[#1e3a3f] rounded mb-2"></div>
                    <div className="h-6 bg-[#1e3a3f] rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Live Events Grid */}
          {!liveLoading && filteredEvents.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredEvents.map((event) => (
                <LiveEventCardItem
                  key={event.id}
                  event={event}
                  getSportName={getSportName}
                  p2pCount={p2pCountByEvent[String(event.id)] || 0}
                />
              ))}
            </div>
          )}

          {/* No Live Events */}
          {!liveLoading && filteredEvents.length === 0 && (
            <Card className="bg-[#112225] border-[#1e3a3f] text-center py-12">
              <CardContent>
                <Radio className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">
                  No Live Events
                </h3>
                <p className="text-gray-500 mb-6">
                  {selectedSport === 'all' 
                    ? 'There are currently no live sporting events. Check back soon!'
                    : `No live ${availableSports.find(s => s.id === selectedSport)?.name} events right now.`
                  }
                </p>
                <div className="flex justify-center space-x-4">
                  <Button 
                    variant="outline" 
                    onClick={() => setSelectedSport('all')}
                    className="border-[#1e3a3f] text-cyan-400 hover:border-cyan-400"
                  >
                    View All Sports
                  </Button>
                  <Button 
                    onClick={() => window.location.reload()}
                    className="bg-cyan-600 hover:bg-cyan-700"
                  >
                    Refresh Events
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}