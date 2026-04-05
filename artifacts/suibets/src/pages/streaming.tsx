import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, Tv, Radio, Eye, ArrowLeft, Monitor, Signal } from 'lucide-react';

interface StreamTeam {
  name: string | null;
  badge: string;
}

interface StreamMatch {
  id: string;
  title: string;
  category: string;
  date: number;
  popular: boolean;
  poster?: string;
  teams: {
    home: StreamTeam;
    away: StreamTeam;
  };
}

interface StreamSource {
  id: string;
  streamNo: number;
  language: string;
  hd: boolean;
  source: string;
  viewers: number;
  embedUrl: string;
}

interface MatchDetail extends StreamMatch {
  sources: StreamSource[];
}

type ViewMode = 'list' | 'watching';

const SPORT_LABELS: Record<string, string> = {
  football: 'Football',
  basketball: 'Basketball',
  tennis: 'Tennis',
  hockey: 'Hockey',
  baseball: 'Baseball',
  'american-football': 'American Football',
  cricket: 'Cricket',
  fight: 'Boxing / MMA',
  'motor-sports': 'Motor Sports',
  rugby: 'Rugby',
  golf: 'Golf',
  darts: 'Darts',
  afl: 'AFL',
  billiards: 'Billiards',
  other: 'Other',
};

export default function StreamingPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeSport, setActiveSport] = useState<string>('all');
  const [activeStreamNo, setActiveStreamNo] = useState(1);

  const { data: liveMatches = [], isLoading: loadingLive } = useQuery<StreamMatch[]>({
    queryKey: ['/api/streaming/live'],
    refetchInterval: 60000,
  });

  const { data: sportMatches = [], isLoading: loadingSport } = useQuery<StreamMatch[]>({
    queryKey: ['/api/streaming/matches', activeSport],
    queryFn: async () => {
      if (activeSport === 'all') return [];
      const res = await fetch(`/api/streaming/matches/${activeSport}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeSport !== 'all',
    refetchInterval: 120000,
  });

  const { data: matchDetail, isLoading: loadingDetail } = useQuery<MatchDetail>({
    queryKey: ['/api/streaming/detail', selectedCategory, selectedMatchId],
    queryFn: async () => {
      if (!selectedCategory || !selectedMatchId) return null;
      const res = await fetch(`/api/streaming/detail/${selectedCategory}/${selectedMatchId}`);
      if (!res.ok) throw new Error('Failed to load match detail');
      return res.json();
    },
    enabled: !!selectedCategory && !!selectedMatchId && viewMode === 'watching',
  });

  const handleWatchMatch = (match: StreamMatch) => {
    setSelectedMatchId(match.id);
    setSelectedCategory(match.category);
    setActiveStreamNo(1);
    setViewMode('watching');
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedMatchId(null);
    setSelectedCategory(null);
  };

  const isLive = (date: number) => {
    const now = Date.now();
    const diff = now - date;
    return diff >= 0 && diff < 3 * 60 * 60 * 1000;
  };

  const getMatchTime = (date: number) => {
    const now = Date.now();
    const diff = now - date;
    if (diff < 0) {
      return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    const mins = Math.floor(diff / 60000);
    if (mins > 90) return 'FT';
    if (mins > 45 && mins < 50) return 'HT';
    return `${mins}'`;
  };

  const displayMatches = activeSport === 'all' ? liveMatches : sportMatches;
  const isLoading = activeSport === 'all' ? loadingLive : loadingSport;

  const liveNow = displayMatches.filter(m => isLive(m.date));
  const upcoming = displayMatches.filter(m => !isLive(m.date));

  const sportGroups = liveNow.reduce<Record<string, StreamMatch[]>>((acc, m) => {
    const cat = m.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {});

  const availableSports = Array.from(new Set(liveMatches.map(m => m.category))).filter(Boolean);

  if (viewMode === 'watching' && selectedMatchId) {
    return (
      <Layout title="Streaming" showBackButton={false}>
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToList}
              className="text-cyan-400 hover:text-cyan-300"
              data-testid="button-back-to-streams"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <h2 className="text-lg font-bold text-white">{matchDetail?.title || 'Loading...'}</h2>
            {matchDetail && isLive(matchDetail.date) && (
              <Badge className="bg-red-600 text-white text-xs">
                <Signal className="h-3 w-3 mr-1" />
                LIVE {getMatchTime(matchDetail.date)}
              </Badge>
            )}
          </div>

          {matchDetail?.sources && matchDetail.sources.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {matchDetail.sources.map((stream) => (
                <button
                  key={`${stream.source}-${stream.streamNo}`}
                  onClick={() => setActiveStreamNo(stream.streamNo)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors border ${
                    activeStreamNo === stream.streamNo
                      ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                      : 'border-gray-600 text-gray-300 hover:border-cyan-500 hover:text-cyan-400'
                  }`}
                  data-testid={`button-stream-${stream.streamNo}`}
                >
                  <Monitor className="h-3 w-3 mr-1" />
                  Stream {stream.streamNo}
                  {stream.hd && <span className="ml-1 text-xs text-green-400">HD</span>}
                  {stream.language && <span className="ml-1 text-xs opacity-70">({stream.language})</span>}
                  {stream.viewers > 0 && (
                    <span className="ml-2 text-xs opacity-70 flex items-center">
                      <Eye className="h-3 w-3 mr-0.5" />
                      {stream.viewers}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
            {loadingDetail ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                <span className="ml-3 text-gray-400">Loading stream sources...</span>
              </div>
            ) : matchDetail?.sources && matchDetail.sources.length > 0 ? (
              <iframe
                key={`${selectedCategory}-${selectedMatchId}-${activeStreamNo}`}
                src={`/api/stream-proxy/${selectedCategory}/${selectedMatchId}/${activeStreamNo}`}
                className="absolute inset-0 w-full h-full"
                allowFullScreen
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="no-referrer"
                style={{ border: 'none' }}
                data-testid="stream-iframe"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <Tv className="h-12 w-12 mb-3" />
                <p>No stream available for this match</p>
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Streaming">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Tv className="h-6 w-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">Live Streams</h1>
          <Badge className="bg-red-600 text-white">
            <Radio className="h-3 w-3 mr-1" />
            {liveNow.length} Live
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            size="sm"
            variant={activeSport === 'all' ? 'default' : 'outline'}
            onClick={() => setActiveSport('all')}
            className={activeSport === 'all' ? 'bg-cyan-600 text-white' : 'border-gray-600 text-gray-300'}
          >
            All Sports
          </Button>
          {availableSports.map(sport => (
            <Button
              key={sport}
              size="sm"
              variant={activeSport === sport ? 'default' : 'outline'}
              onClick={() => setActiveSport(sport)}
              className={activeSport === sport ? 'bg-cyan-600 text-white' : 'border-gray-600 text-gray-300'}
            >
              {SPORT_LABELS[sport] || sport.charAt(0).toUpperCase() + sport.slice(1)}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            <span className="ml-3 text-gray-400">Loading matches...</span>
          </div>
        ) : displayMatches.length === 0 ? (
          <Card className="p-8 text-center bg-[#0b1618]/80 border-[#1e3a3f]">
            <Tv className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <p className="text-gray-400 text-lg">No streams available right now</p>
            <p className="text-gray-500 text-sm mt-2">Check back during match times for live streams</p>
          </Card>
        ) : (
          <>
            {Object.keys(sportGroups).length > 0 && (
              <div className="space-y-6">
                {Object.entries(sportGroups).map(([sport, matches]) => (
                  <div key={sport} className="space-y-3">
                    <h2 className="text-lg font-semibold text-red-400 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {SPORT_LABELS[sport] || sport.charAt(0).toUpperCase() + sport.slice(1)} ({matches.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {matches.map(match => (
                        <MatchCard 
                          key={match.id} 
                          match={match} 
                          isLive={true}
                          matchTime={getMatchTime(match.date)}
                          onWatch={() => handleWatchMatch(match)} 
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {upcoming.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-gray-300">
                  Upcoming ({upcoming.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {upcoming.map(match => (
                    <MatchCard 
                      key={match.id} 
                      match={match} 
                      isLive={false}
                      matchTime={getMatchTime(match.date)}
                      onWatch={() => handleWatchMatch(match)} 
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function MatchCard({ match, isLive, matchTime, onWatch }: { 
  match: StreamMatch; 
  isLive: boolean;
  matchTime: string;
  onWatch: () => void;
}) {
  const homeName = match.teams?.home?.name || match.title?.split(' vs ')?.[0] || 'TBD';
  const awayName = match.teams?.away?.name || match.title?.split(' vs ')?.[1] || 'TBD';
  const homeBadge = match.teams?.home?.badge;
  const awayBadge = match.teams?.away?.badge;

  return (
    <Card 
      className="bg-[#0b1618]/90 border-[#1e3a3f] hover:border-cyan-500/40 transition-all cursor-pointer overflow-visible"
      onClick={onWatch}
      data-testid={`card-match-${match.id}`}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge className="bg-red-600 text-white text-xs px-1.5 py-0.5">
                <Signal className="h-2.5 w-2.5 mr-0.5" />
                {matchTime}
              </Badge>
            )}
            {match.popular && (
              <Badge className="bg-yellow-600/80 text-white text-xs px-1.5 py-0.5">
                Popular
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Badge className="bg-gray-700/60 text-gray-300 text-xs px-1.5 py-0.5">
              {SPORT_LABELS[match.category] || match.category}
            </Badge>
            {!isLive && (
              <span className="text-xs text-gray-500 ml-1">{matchTime}</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 flex items-center justify-end gap-2">
            <p className="text-sm font-medium text-white truncate text-right">{homeName}</p>
            {homeBadge && <img src={homeBadge} alt="" className="w-6 h-6 object-contain" loading="lazy" />}
          </div>
          <span className="text-xs text-gray-500 px-2 font-bold">VS</span>
          <div className="flex-1 flex items-center gap-2">
            {awayBadge && <img src={awayBadge} alt="" className="w-6 h-6 object-contain" loading="lazy" />}
            <p className="text-sm font-medium text-white truncate">{awayName}</p>
          </div>
        </div>

        <Button
          size="sm"
          className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500"
          data-testid={`button-watch-${match.id}`}
        >
          <Play className="h-3 w-3 mr-1 fill-white" />
          Watch Stream
        </Button>
      </div>
    </Card>
  );
}
