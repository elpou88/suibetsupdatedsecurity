import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Layout from "@/components/layout/Layout";
import { apiRequest } from "@/lib/queryClient";
import SimpleMarkets from "@/components/betting/SimpleMarkets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock, Zap, ExternalLink, Share2, ArrowLeft,
  Radio, Trophy, Users
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function MatchDetail() {
  const [, params] = useRoute("/match-detail/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const eventId = params?.id;

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["/api/events", eventId],
    queryFn: async () => {
      if (!eventId) return null;
      const r = await apiRequest("GET", `/api/events/${eventId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!eventId,
    refetchInterval: 30000,
  });

  const { data: p2pOffers = [] } = useQuery<any[]>({
    queryKey: ["/api/p2p/offers", "match-detail", eventId],
    queryFn: () =>
      fetch(`/api/p2p/offers?status=open&eventId=${eventId}`)
        .then(r => r.ok ? r.json() : [])
        .then(d => Array.isArray(d) ? d : [])
        .catch(() => []),
    enabled: !!eventId,
    refetchInterval: 20000,
    staleTime: 0,
  });

  const openCount = p2pOffers.length;

  const handleShare = () => {
    const url = `${window.location.origin}/match-detail/${eventId}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Link copied!", description: "Match link copied to clipboard." });
    });
  };

  if (eventLoading) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#0b1618] flex items-center justify-center">
          <div className="text-cyan-400 animate-pulse text-lg">Loading match…</div>
        </div>
      </Layout>
    );
  }

  if (!event) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#0b1618] text-white flex flex-col items-center justify-center gap-4">
          <Trophy className="h-16 w-16 text-gray-600" />
          <h2 className="text-xl font-semibold text-gray-400">Match not found</h2>
          <Button variant="outline" onClick={() => setLocation("/live-events")}
            className="border-cyan-500/40 text-cyan-400 hover:border-cyan-400">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Live Events
          </Button>
        </div>
      </Layout>
    );
  }

  const isLive = event.isLive;
  const startDate = event.startTime ? new Date(event.startTime) : null;

  return (
    <Layout>
      <div className="min-h-screen bg-[#0b1618] text-white py-6">
        <div className="container mx-auto px-4 max-w-3xl">

          {/* Back */}
          <button
            onClick={() => setLocation(isLive ? "/live-events" : "/upcoming-events")}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-cyan-400 transition-colors mb-5"
          >
            <ArrowLeft className="h-4 w-4" />
            {isLive ? "Back to Live Events" : "Back to Upcoming Events"}
          </button>

          {/* Match card */}
          <Card className="bg-[#112225] border-[#1e3a3f] mb-5">
            <CardHeader className="border-b border-[#1e3a3f]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isLive ? (
                    <Badge variant="destructive" className="animate-pulse">
                      <Radio className="h-3 w-3 mr-1" /> LIVE
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-cyan-400 text-cyan-400">
                      <Clock className="h-3 w-3 mr-1" />
                      {startDate
                        ? startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "Scheduled"}
                    </Badge>
                  )}
                  {event.leagueName && (
                    <span className="text-xs text-gray-400">{event.leagueName}</span>
                  )}
                </div>
                <button
                  onClick={handleShare}
                  className="text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Copy match link"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>

              {/* Scoreboard */}
              <div className="grid grid-cols-3 items-center text-center gap-4 py-4">
                <div>
                  <div className="text-xl font-extrabold text-white truncate">{event.homeTeam}</div>
                  <div className="text-xs text-gray-400 mt-1">Home</div>
                </div>
                <div>
                  {isLive ? (
                    <>
                      <div className="text-3xl font-extrabold text-cyan-400">
                        {event.homeScore ?? 0} – {event.awayScore ?? 0}
                      </div>
                      <div className="text-xs text-green-400 font-mono mt-1">
                        {event.minute ? `${event.minute}'` : "Live"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-extrabold text-gray-500">VS</div>
                      <div className="text-xs text-cyan-400 mt-1">
                        {startDate
                          ? startDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
                          : ""}
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <div className="text-xl font-extrabold text-white truncate">{event.awayTeam}</div>
                  <div className="text-xs text-gray-400 mt-1">Away</div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4">
              <SimpleMarkets
                event={event}
                eventId={event.id}
                sportType={(event.sport || "").toLowerCase()}
                isLive={isLive}
              />
            </CardContent>
          </Card>

          {/* P2P Offers section */}
          <Card className="bg-[#112225] border-[#1e3a3f] mb-5">
            <CardHeader className="border-b border-[#1e3a3f] pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-purple-300 text-base">
                  <Users className="h-4 w-4" />
                  P2P Offers for This Match
                  {openCount > 0 && (
                    <span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-0.5 rounded-full font-semibold">
                      {openCount} open
                    </span>
                  )}
                </CardTitle>
                <div className="flex gap-2">
                  {openCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-purple-500/30 text-purple-400 hover:border-purple-400 h-7 text-xs"
                      onClick={() => setLocation(`/p2p?event=${eventId}`)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" /> View All
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-500 text-white h-7 text-xs"
                    onClick={() =>
                      setLocation(
                        `/p2p?event=${eventId}&match=${encodeURIComponent(
                          `${event.homeTeam} vs ${event.awayTeam}`
                        )}`
                      )
                    }
                  >
                    <Zap className="h-3 w-3 mr-1" /> Post P2P Offer
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {openCount === 0 ? (
                <div className="text-center py-6">
                  <Zap className="h-10 w-10 text-purple-600/40 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm mb-1">No P2P offers posted yet</p>
                  <p className="text-gray-500 text-xs">
                    Be the first to post a P2P bet on this match — set your own odds, stake, and pick a side.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {p2pOffers.slice(0, 5).map((offer: any) => (
                    <div
                      key={offer.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-[#0b1618] border border-[#1e3a3f] hover:border-purple-500/30 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {offer.creatorPrediction === "home"
                            ? event.homeTeam
                            : offer.creatorPrediction === "away"
                            ? event.awayTeam
                            : offer.creatorPrediction === "draw"
                            ? "Draw"
                            : offer.creatorPrediction}
                        </p>
                        <p className="text-gray-400 text-xs">
                          {offer.creatorStake} {offer.currency || "SUI"} stake ·{" "}
                          {offer.creatorOdds?.toFixed(2)}x odds
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-500 text-white h-7 text-xs shrink-0 ml-3"
                        onClick={() => setLocation(`/p2p/offer/${offer.id}`)}
                      >
                        Take Bet
                      </Button>
                    </div>
                  ))}
                  {openCount > 5 && (
                    <button
                      onClick={() => setLocation(`/p2p?event=${eventId}`)}
                      className="w-full text-center text-xs text-purple-400 hover:text-purple-300 py-2 transition-colors"
                    >
                      View {openCount - 5} more offer{openCount - 5 !== 1 ? "s" : ""} →
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </Layout>
  );
}
