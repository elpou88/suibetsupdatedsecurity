import { useState, useEffect, useCallback } from 'react';
import { Tv, X, Loader2, Signal, Play } from 'lucide-react';

interface StreamMatch {
  id: string;
  title: string;
  category: string;
  date: number;
  teams: {
    home: { name: string | null; badge: string };
    away: { name: string | null; badge: string };
  };
}

interface StreamEmbedProps {
  eventName: string;
  isLive?: boolean;
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bfc\b/gi, '')
    .replace(/\bsc\b/gi, '')
    .replace(/\bcf\b/gi, '')
    .replace(/\bafc\b/gi, '')
    .replace(/\bac\b/gi, '')
    .replace(/\bunited\b/gi, 'utd')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamsMatch(betName: string, streamMatch: StreamMatch): boolean {
  const betLower = normalizeTeam(betName);
  const homeStream = normalizeTeam(streamMatch.teams?.home?.name || '');
  const awayStream = normalizeTeam(streamMatch.teams?.away?.name || '');
  const titleStream = normalizeTeam(streamMatch.title || '');

  if (!homeStream && !awayStream && !titleStream) return false;

  if (homeStream && awayStream) {
    const homeWords = homeStream.split(' ').filter(w => w.length > 2);
    const awayWords = awayStream.split(' ').filter(w => w.length > 2);
    const homeMatch = homeWords.some(w => betLower.includes(w));
    const awayMatch = awayWords.some(w => betLower.includes(w));
    if (homeMatch && awayMatch) return true;

    const betParts = betLower.split(/\s+vs\.?\s+|\s+-\s+/);
    if (betParts.length === 2) {
      const betHome = betParts[0].trim();
      const betAway = betParts[1].trim();
      const h2 = homeWords.some(w => betHome.includes(w)) || betHome.split(' ').some((w: string) => w.length > 2 && homeStream.includes(w));
      const a2 = awayWords.some(w => betAway.includes(w)) || betAway.split(' ').some((w: string) => w.length > 2 && awayStream.includes(w));
      if (h2 && a2) return true;
      const h3 = homeWords.some(w => betAway.includes(w)) || betAway.split(' ').some((w: string) => w.length > 2 && homeStream.includes(w));
      const a3 = awayWords.some(w => betHome.includes(w)) || betHome.split(' ').some((w: string) => w.length > 2 && awayStream.includes(w));
      if (h3 && a3) return true;
    }
  }

  if (titleStream && betLower.length > 5) {
    const titleWords = titleStream.split(' ').filter(w => w.length > 3);
    const matchCount = titleWords.filter(w => betLower.includes(w)).length;
    if (matchCount >= 2) return true;
  }

  return false;
}

let cachedMatches: StreamMatch[] | null = null;
let cacheTime = 0;
let inflight: Promise<StreamMatch[] | null> | null = null;
const CACHE_TTL = 60_000;

async function fetchMatches(): Promise<StreamMatch[] | null> {
  if (cachedMatches && Date.now() - cacheTime < CACHE_TTL) return cachedMatches;
  if (inflight) return inflight;
  inflight = fetch('/api/streaming/live')
    .then(res => res.ok ? res.json() : null)
    .then(data => { cachedMatches = data; cacheTime = Date.now(); inflight = null; return data; })
    .catch(() => { inflight = null; return null; });
  return inflight;
}

export default function StreamEmbed({ eventName, isLive }: StreamEmbedProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matchedStream, setMatchedStream] = useState<StreamMatch | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [streamCount, setStreamCount] = useState(0);
  const [noStream, setNoStream] = useState(false);
  const [checked, setChecked] = useState(false);
  const [iframeLive, setIframeLive] = useState(false);

  useEffect(() => {
    setChecked(false);
    setMatchedStream(null);
    setWatchUrl(null);
    setStreamCount(0);
    setNoStream(false);
    setExpanded(false);
    setIframeLive(false);
  }, [eventName]);

  const findStream = useCallback(async () => {
    if (checked) return;
    setLoading(true);
    setChecked(true);

    try {
      const matches = await fetchMatches();

      if (!matches || matches.length === 0) {
        setNoStream(true);
        setLoading(false);
        return;
      }

      const found = matches.find(m => teamsMatch(eventName, m));
      if (!found) {
        setNoStream(true);
        setLoading(false);
        return;
      }

      setMatchedStream(found);

      const detailRes = await fetch(`/api/streaming/detail/${found.category}/${found.id}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        if (detail?.sources?.length > 0) {
          setStreamCount(detail.sources.length);
          const best = detail.sources.find((s: any) => s.hd && s.embedUrl) || detail.sources.find((s: any) => s.embedUrl) || detail.sources[0];
          if (best.embedUrl) {
            setWatchUrl(best.embedUrl);
          } else {
            setWatchUrl(`/api/stream-proxy/${found.category}/${found.id}/${best.streamNo}`);
          }
        } else {
          setNoStream(true);
        }
      } else {
        setNoStream(true);
      }
    } catch {
      setNoStream(true);
    }

    setLoading(false);
  }, [eventName, checked]);

  const handleToggle = () => {
    if (!expanded && !checked) {
      findStream();
    }
    setExpanded(prev => !prev);
  };

  if (!isLive) return null;
  if (noStream && !expanded) return null;

  return (
    <div className="mt-1">
      <button
        onClick={handleToggle}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300 transition-colors border border-red-500/20"
        data-testid="btn-stream-toggle"
      >
        {expanded ? (
          <>
            <X className="h-3 w-3" />
            Close
          </>
        ) : (
          <>
            <Tv className="h-3 w-3" />
            <Signal className="h-2.5 w-2.5 animate-pulse" />
            Stream
          </>
        )}
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg overflow-hidden border border-red-500/20 bg-black">
          {loading ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              <span className="text-gray-400 text-xs">Finding stream...</span>
            </div>
          ) : noStream ? (
            <div className="flex flex-col items-center justify-center py-4 gap-1">
              <Tv className="h-5 w-5 text-gray-600" />
              <span className="text-gray-500 text-xs">No stream available</span>
            </div>
          ) : watchUrl ? (
            <div className="relative">
              <div className="flex items-center justify-between px-2 py-1 bg-gradient-to-r from-gray-900 to-black border-b border-red-500/10">
                <div className="flex items-center gap-1.5">
                  <Signal className="h-2.5 w-2.5 text-red-500 animate-pulse" />
                  <span className="text-[10px] text-gray-400 truncate max-w-[150px]">
                    {matchedStream?.teams?.home?.name || matchedStream?.title?.split(' vs ')?.[0]} vs {matchedStream?.teams?.away?.name || matchedStream?.title?.split(' vs ')?.[1]}
                  </span>
                </div>
                {streamCount > 1 && (
                  <span className="text-[9px] text-cyan-400">{streamCount} sources</span>
                )}
              </div>
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                {!iframeLive ? (
                  <button
                    onClick={() => setIframeLive(true)}
                    className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 to-black cursor-pointer border-0 z-10"
                    data-testid="btn-start-stream"
                  >
                    <div className="w-14 h-14 rounded-full bg-red-600/90 flex items-center justify-center mb-2 hover:bg-red-500 transition-colors">
                      <Play className="h-7 w-7 text-white ml-0.5" fill="white" />
                    </div>
                    <span className="text-gray-300 text-xs">Tap to start stream</span>
                  </button>
                ) : (
                  <iframe
                    src={watchUrl}
                    className="absolute inset-0 w-full h-full"
                    allowFullScreen
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    referrerPolicy="no-referrer"
                    style={{ border: 'none' }}
                    data-testid="stream-iframe"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 gap-1">
              <Tv className="h-5 w-5 text-gray-600" />
              <span className="text-gray-500 text-xs">Stream unavailable</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
