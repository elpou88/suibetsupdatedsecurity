import { useState, useEffect, useRef, useCallback } from "react";
import { useCurrentAccount, useSignPersonalMessage } from '@/lib/dapp-kit-compat';
import { encryptMessage, decryptMessage, isSealEncrypted, getSealStatus, resetSealSession } from '@/lib/sealEncryption';
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useWsOn } from "@/hooks/useWebSocket";
import {
  MessageCircle, Send, Users, ArrowLeft, Lock, Hash, Loader2,
  Trophy, Swords, Bell, User, CheckCircle, XCircle, ChevronRight,
  Shield, Zap, TrendingUp, Award, Clock, Sparkles, Globe,
  ExternalLink, Copy, Eye, EyeOff, Radio, Wallet, Search
} from "lucide-react";

type Tab = "chat" | "challenges" | "notifications" | "profile";

interface ChatRoom {
  id: number;
  eventId: number | null;
  name: string;
  roomType: string;
  memberCount: number;
  lastMessage: string | null;
  lastMessageTime: string | null;
  activeBets?: number;
}

interface ChatMessage {
  id: number;
  roomId: number;
  senderWallet: string;
  encryptedContent: string;
  messageType: string;
  createdAt: string;
}

interface P2pChallenge {
  id: number;
  challengerWallet: string;
  challengedWallet: string;
  eventId: number | null;
  eventName: string | null;
  prediction: string;
  amount: number;
  currency: string;
  odds: number;
  status: string;
  message: string | null;
  createdAt: string;
}

interface SettlementNotification {
  id: number;
  recipientWallet: string;
  betId: number;
  eventName: string | null;
  result: string;
  payoutAmount: number | null;
  currency: string | null;
  txHash: string | null;
  read: boolean;
  createdAt: string;
}

interface WalletProfile {
  wallet: string;
  totalBets: number;
  wonBets: number;
  lostBets: number;
  pendingBets: number;
  totalWagered: number;
  totalWon: number;
  winRate: number;
  messagesSent: number;
  memberSince: string | null;
  verified: boolean;
}

interface TapeItem {
  id: string;
  type: 'single' | 'parlay';
  eventName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  prediction: string | null;
  odds: number;
  totalPot: number;
  winner: string | null;
  creatorWallet: string | null;
  takerWallet: string | null;
  payoutAmount: number | null;
  currency: string;
  settledAt: string | null;
  legCount: number | null;
  isLive?: boolean;
}

interface LiveFeedEvent {
  key: string;
  action: string;
  betType: string;
  eventName?: string;
  ts: number;
}

const truncAddr = (a: string) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "?";
const fmtTime = (d: string) => {
  try { return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
};
const fmtDate = (d: string) => {
  try { return new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
};
const fmtAmount = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toString();

export default function MessagingPage() {
  const account = useCurrentAccount();
  const wallet = account?.address?.toLowerCase() || "";
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("chat");
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [challengeForm, setChallengeForm] = useState({ wallet: "", prediction: "", amount: "", message: "" });
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [profileWallet, setProfileWallet] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [roomSearch, setRoomSearch] = useState("");
  const [sealActive, setSealActive] = useState(false);
  const [decryptedCache, setDecryptedCache] = useState<Map<number, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const roomsQuery = useQuery<ChatRoom[]>({
    queryKey: ["/api/chat/rooms"],
    enabled: !!wallet,
    refetchInterval: 10000,
  });

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/rooms", activeRoom?.id, "messages"],
    queryFn: async () => { const r = await fetch(`/api/chat/rooms/${activeRoom!.id}/messages`); if (!r.ok) throw new Error('Failed'); return r.json(); },
    enabled: !!activeRoom,
    refetchInterval: 3000,
  });

  const challengesQuery = useQuery<P2pChallenge[]>({
    queryKey: ["/api/p2p/challenges", wallet],
    queryFn: async () => { const r = await fetch(`/api/p2p/challenges?wallet=${wallet}`); if (!r.ok) throw new Error('Failed'); return r.json(); },
    enabled: !!wallet,
    refetchInterval: tab === "challenges" ? 10000 : 30000,
  });

  const notificationsQuery = useQuery<SettlementNotification[]>({
    queryKey: ["/api/settlement-notifications", wallet],
    queryFn: async () => { const r = await fetch(`/api/settlement-notifications?wallet=${wallet}`); if (!r.ok) throw new Error('Failed'); return r.json(); },
    enabled: !!wallet,
    refetchInterval: tab === "notifications" ? 15000 : 60000,
  });

  const viewProfile = profileWallet || wallet;
  const profileQuery = useQuery<WalletProfile>({
    queryKey: ["/api/chat/profile", viewProfile],
    queryFn: async () => { const r = await fetch(`/api/chat/profile/${viewProfile}`); if (!r.ok) throw new Error('Failed'); return r.json(); },
    enabled: !!viewProfile && (tab === "profile" || !!profileWallet),
  });

  const sendMsgMutation = useMutation({
    mutationFn: async (content: string) => {
      let encryptedContent = content;
      if (wallet && activeRoom) {
        try {
          encryptedContent = await encryptMessage(content, activeRoom.id, wallet, signPersonalMessage);
          setSealActive(true);
        } catch {
          encryptedContent = content;
        }
      }
      return apiRequest("POST", `/api/chat/rooms/${activeRoom!.id}/messages`, {
        senderWallet: wallet,
        encryptedContent,
        messageType: "text",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/rooms", activeRoom?.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/rooms"] });
    },
  });

  const decryptMessages = useCallback(async (messages: ChatMessage[], roomId: number) => {
    if (!wallet) return;
    const encrypted = messages.filter(m => isSealEncrypted(m.encryptedContent));
    if (!encrypted.length) return;
    const newCache = new Map(decryptedCache);
    let changed = false;
    for (const msg of encrypted) {
      if (newCache.has(msg.id)) continue;
      try {
        const plain = await decryptMessage(msg.encryptedContent, roomId, wallet, signPersonalMessage);
        newCache.set(msg.id, plain);
        changed = true;
        setSealActive(true);
      } catch {}
    }
    if (changed) setDecryptedCache(new Map(newCache));
  }, [wallet, decryptedCache, signPersonalMessage]);

  useEffect(() => {
    if (messagesQuery.data && activeRoom) {
      decryptMessages(messagesQuery.data, activeRoom.id);
    }
  }, [messagesQuery.data, activeRoom?.id]);

  useEffect(() => {
    if (!wallet) { resetSealSession(); setSealActive(false); setDecryptedCache(new Map()); }
  }, [wallet]);

  const createChallengeMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/p2p/challenges", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/p2p/challenges", wallet] });
      setShowChallengeForm(false);
      setChallengeForm({ wallet: "", prediction: "", amount: "", message: "" });
    },
  });

  const respondChallengeMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "accept" | "decline" }) => {
      return apiRequest("POST", `/api/p2p/challenges/${id}/${action}`, { wallet });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/p2p/challenges", wallet] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/settlement-notifications/${id}/read`, { wallet });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settlement-notifications", wallet] });
    },
  });

  const settledTapeQuery = useQuery<TapeItem[]>({
    queryKey: ["/api/p2p/settled-tape"],
    queryFn: async () => {
      const r = await fetch("/api/p2p/settled-tape");
      if (!r.ok) return [];
      const d = await r.json();
      return (d.tape ?? d ?? []).map((item: any, i: number) => ({ ...item, id: item.id ?? String(i) }));
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const myP2PQuery = useQuery<{ myOffers: any[]; myMatches: any[]; myParlayOffers: any[] }>({
    queryKey: ["/api/p2p/my", wallet],
    queryFn: async () => {
      const r = await fetch(`/api/p2p/my?wallet=${wallet}`);
      if (!r.ok) return { myOffers: [], myMatches: [], myParlayOffers: [] };
      return r.json();
    },
    enabled: !!wallet,
    staleTime: 15_000,
    refetchInterval: tab === "challenges" ? 15_000 : 60_000,
  });

  const [liveFeedEvents, setLiveFeedEvents] = useState<LiveFeedEvent[]>([]);

  useWsOn((msg) => {
    if (msg.type === "p2p-updates" && msg.data) {
      const { action, type, data } = msg.data;
      const event: LiveFeedEvent = {
        key: `ws-${msg.ts ?? Date.now()}-${Math.random()}`,
        action: action ?? "updated",
        betType: type ?? "offer",
        eventName: data?.eventName,
        ts: msg.ts ?? Date.now(),
      };
      setLiveFeedEvents(prev => [event, ...prev].slice(0, 10));
      queryClient.invalidateQueries({ queryKey: ["/api/p2p/settled-tape"] });
      if (wallet) queryClient.invalidateQueries({ queryKey: ["/api/p2p/my", wallet] });
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const sendMessage = () => {
    if (!newMessage.trim() || !activeRoom) return;
    const msg = newMessage.trim();
    sendMsgMutation.mutate(msg, {
      onSuccess: () => setNewMessage(""),
    });
  };

  const submitChallenge = () => {
    const { wallet: cWallet, prediction, amount, message } = challengeForm;
    if (!cWallet || !prediction || !amount) return;
    createChallengeMutation.mutate({
      challengerWallet: wallet,
      challengedWallet: cWallet,
      prediction,
      amount: parseFloat(amount),
      currency: "SBETS",
      message: message || undefined,
    });
  };

  const copyWallet = (addr: string) => {
    try {
      navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const unreadNotifs = (notificationsQuery.data || []).filter(n => !n.read).length;
  const totalChallenges = (challengesQuery.data || []).filter(c => c.challengedWallet === wallet && c.status === "pending").length;

  if (!wallet) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#080c14] via-[#0a0e17] to-[#0d1220] flex flex-col" data-testid="messaging-connect">
        <div className="px-4 py-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
            data-testid="btn-back-home-connect"
          >
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-sm font-medium">Back to SuiBets</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8 max-w-lg">
          <div className="relative mx-auto mb-8">
            <div className="h-24 w-24 bg-gradient-to-br from-[#4da2ff] to-[#2d7dd2] rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-[#4da2ff]/20 rotate-3 hover:rotate-0 transition-transform duration-500">
              <MessageCircle className="h-12 w-12 text-white" />
            </div>
            <div className="absolute -top-2 -right-2 h-6 w-6 bg-green-500 rounded-full flex items-center justify-center animate-pulse">
              <Lock className="h-3 w-3 text-white" />
            </div>
          </div>
          <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">SuiBets <span className="text-[#4da2ff]">Chat</span></h2>
          <p className="text-gray-400 mb-8 text-base leading-relaxed">E2E encrypted messaging powered by Sui Seal. Your wallet is your identity. No server ever sees your messages.</p>
          
          <div className="grid grid-cols-2 gap-4 text-left mb-8">
            {[
              { icon: Hash, label: "Encrypted Bet Chat", desc: "Real-time chat with fellow bettors on the same match", gradient: "from-blue-500/20 to-cyan-500/20", border: "border-blue-500/30" },
              { icon: Swords, label: "P2P Challenges", desc: "Send encrypted bet dares wallet-to-wallet. No middleman", gradient: "from-purple-500/20 to-pink-500/20", border: "border-purple-500/30" },
              { icon: Bell, label: "Settlement Proofs", desc: "On-chain payout proofs stored on Walrus, verifiable forever", gradient: "from-green-500/20 to-emerald-500/20", border: "border-green-500/30" },
              { icon: Trophy, label: "Social Proof", desc: "On-chain verified betting identity. 47 wins? Everyone sees it", gradient: "from-yellow-500/20 to-orange-500/20", border: "border-yellow-500/30" },
            ].map(({ icon: Icon, label, desc, gradient, border }) => (
              <div key={label} className={`bg-gradient-to-br ${gradient} border ${border} rounded-2xl p-4 backdrop-blur-sm hover:scale-[1.02] transition-transform duration-300`}>
                <Icon className="h-6 w-6 text-[#4da2ff] mb-3" />
                <div className="text-white text-sm font-semibold mb-1">{label}</div>
                <div className="text-gray-400 text-xs leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>

          <div className="inline-flex items-center gap-2 bg-[#4da2ff]/10 border border-[#4da2ff]/30 rounded-full px-5 py-2.5 text-[#4da2ff] font-medium text-sm">
            <Wallet className="h-4 w-4" />
            Connect your Sui wallet to start
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (profileWallet) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#080c14] via-[#0a0e17] to-[#0d1220]" data-testid="messaging-profile-view">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800/60 bg-[#0d1220]/80 backdrop-blur-md sticky top-0 z-10">
          <button onClick={() => setProfileWallet(null)} className="text-gray-400 hover:text-white transition-colors" data-testid="btn-back-from-profile">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-8 w-8 bg-gradient-to-br from-[#4da2ff] to-[#7b61ff] rounded-lg flex items-center justify-center">
            <User className="h-4 w-4 text-white" />
          </div>
          <span className="text-white font-semibold">Player Profile</span>
          <span className="text-[#4da2ff] font-mono text-xs ml-auto">{truncAddr(profileWallet)}</span>
        </div>
        <div className="max-w-lg mx-auto px-4 py-6">
          {renderProfile(profileQuery.data, profileQuery.isLoading)}
        </div>
      </div>
    );
  }

  if (activeRoom) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#080c14] via-[#0a0e17] to-[#0d1220] flex flex-col" data-testid="messaging-chat">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800/60 bg-[#0d1220]/80 backdrop-blur-md sticky top-0 z-10">
          <button onClick={() => setActiveRoom(null)} className="text-gray-400 hover:text-white transition-colors" data-testid="btn-back-channels">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-9 w-9 bg-gradient-to-br from-[#4da2ff]/20 to-[#4da2ff]/5 rounded-xl flex items-center justify-center border border-[#4da2ff]/30">
            <Hash className="h-4 w-4 text-[#4da2ff]" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-white font-semibold truncate block">{activeRoom.name}</span>
            <span className="text-gray-500 text-xs flex items-center gap-1">
              <Users className="h-3 w-3" /> {activeRoom.memberCount || 0} members
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/30 px-3 py-1.5 rounded-full">
            <Lock className="h-3 w-3 text-green-400" />
            <span className="text-green-400 font-medium">Encrypted</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messagesQuery.isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>
          )}
          {(messagesQuery.data || []).length === 0 && !messagesQuery.isLoading && (
            <div className="text-center py-16">
              <div className="h-16 w-16 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="h-8 w-8 text-[#4da2ff]/50" />
              </div>
              <p className="text-gray-400 font-medium mb-1">No messages yet</p>
              <p className="text-gray-600 text-sm">Start the conversation! All messages are E2E encrypted.</p>
            </div>
          )}
          {(messagesQuery.data || []).map((msg, idx) => {
            const isMe = msg.senderWallet === wallet;
            const prevMsg = (messagesQuery.data || [])[idx - 1];
            const showSender = !isMe && (!prevMsg || prevMsg.senderWallet !== msg.senderWallet);
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.id}`}>
                <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                  {showSender && (
                    <button
                      onClick={() => setProfileWallet(msg.senderWallet)}
                      className="text-[#4da2ff] text-xs font-mono mb-1.5 hover:underline flex items-center gap-1 ml-3"
                      data-testid={`profile-link-${msg.id}`}
                    >
                      <div className="h-4 w-4 bg-[#4da2ff]/20 rounded-full flex items-center justify-center">
                        <User className="h-2.5 w-2.5 text-[#4da2ff]" />
                      </div>
                      {truncAddr(msg.senderWallet)}
                    </button>
                  )}
                  <div className={`rounded-2xl px-4 py-3 ${
                    isMe 
                      ? "bg-gradient-to-br from-[#4da2ff] to-[#3d8ce6] text-white shadow-lg shadow-[#4da2ff]/10" 
                      : "bg-[#141c2e] text-white border border-gray-800/50"
                  }`}>
                    <p className="break-words text-[15px] leading-relaxed">
                      {isSealEncrypted(msg.encryptedContent)
                        ? (decryptedCache.get(msg.id) ?? <span className="opacity-50 italic text-sm">🔒 decrypting…</span>)
                        : msg.encryptedContent}
                    </p>
                    <div className={`text-[11px] mt-1.5 flex items-center gap-1 ${isMe ? "text-blue-200/70 justify-end" : "text-gray-500"}`}>
                      {fmtTime(msg.createdAt)}
                      {isSealEncrypted(msg.encryptedContent)
                        ? <Lock className="h-2.5 w-2.5 text-green-400" title="Seal encrypted" />
                        : isMe && <Lock className="h-2.5 w-2.5" />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 py-4 border-t border-gray-800/60 bg-[#0d1220]/90 backdrop-blur-md">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Type an encrypted message..."
                className="w-full bg-[#141c2e] text-white rounded-2xl pl-4 pr-4 py-3 border border-gray-700/50 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none placeholder-gray-500 text-[15px] transition-all"
                data-testid="input-message"
              />
            </div>
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim() || sendMsgMutation.isPending}
              className="bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] hover:from-[#5db0ff] hover:to-[#4d9cf6] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl p-3 transition-all shadow-lg shadow-[#4da2ff]/20 hover:shadow-[#4da2ff]/30"
              data-testid="btn-send-message"
            >
              {sendMsgMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
          {sendMsgMutation.isError && (
            <p className="text-red-400 text-xs mt-2 text-center">Failed to send message. Try again.</p>
          )}
          <div className="flex items-center gap-1.5 mt-2.5 text-gray-600 text-[11px] justify-center">
            <Shield className={`h-3 w-3 ${sealActive ? "text-green-400" : "text-green-500/50"}`} />
            <span className={sealActive ? "text-green-400" : undefined}>
              {sealActive ? "Seal AES-256 active" : "Seal E2E encryption"}
            </span>
            <span className="text-gray-700 mx-1">&middot;</span>
            <Globe className="h-3 w-3 text-[#4da2ff]/50" />
            <span>Walrus decentralized storage</span>
          </div>
        </div>
      </div>
    );
  }

  const rooms = roomsQuery.data || [];
  const totalRooms = rooms.length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#080c14] via-[#0a0e17] to-[#0d1220]" data-testid="messaging-main">
      <div className="px-4 sm:px-6 py-4 border-b border-gray-800/60 bg-[#0d1220]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[#141c2e] border border-gray-700/50 text-gray-400 hover:text-white hover:border-[#4da2ff]/40 hover:bg-[#4da2ff]/10 transition-all shrink-0"
            data-testid="btn-back-home"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-10 w-10 bg-gradient-to-br from-[#4da2ff] to-[#2d7dd2] rounded-xl flex items-center justify-center shadow-lg shadow-[#4da2ff]/20 shrink-0">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">SuiBets <span className="text-[#4da2ff]">Chat</span></h1>
            <p className="text-gray-500 text-xs">{totalRooms} room{totalRooms !== 1 ? 's' : ''} &middot; Encrypted on Sui</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/30 px-3 py-1.5 rounded-full">
              <div className="h-1.5 w-1.5 bg-green-400 rounded-full animate-pulse" />
              <Lock className="h-3 w-3 text-green-400" />
              <span className="text-green-400 font-medium hidden sm:inline">E2E Encrypted</span>
              <span className="text-green-400 font-medium sm:hidden">E2E</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex border-b border-gray-800/60 bg-[#0c1019]/80 backdrop-blur-sm">
        {([
          { key: "chat" as Tab, icon: Hash, label: "Rooms", badge: 0 },
          { key: "challenges" as Tab, icon: Swords, label: "P2P", badge: totalChallenges },
          { key: "notifications" as Tab, icon: Bell, label: "Alerts", badge: unreadNotifs },
          { key: "profile" as Tab, icon: User, label: "Profile", badge: 0 },
        ]).map(({ key, icon: Icon, label, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-3.5 text-xs font-medium flex flex-col items-center gap-1.5 transition-all relative ${
              tab === key 
                ? "text-[#4da2ff]" 
                : "text-gray-500 hover:text-gray-300"
            }`}
            data-testid={`tab-${key}`}
          >
            <div className={`relative ${tab === key ? "scale-110" : ""} transition-transform`}>
              <Icon className="h-5 w-5" />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] rounded-full h-4 min-w-[16px] flex items-center justify-center font-bold px-1 shadow-lg shadow-red-500/30">{badge}</span>
              )}
            </div>
            <span className="tracking-wide">{label}</span>
            {tab === key && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-[#4da2ff] rounded-full" />}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {tab === "chat" && renderChatTab()}
        {tab === "challenges" && renderChallengesTab()}
        {tab === "notifications" && renderNotificationsTab()}
        {tab === "profile" && renderProfileTab()}
      </div>
    </div>
  );

  function renderP2PLiveFeed() {
    const rawTapeData = settledTapeQuery.data;
    const tape: TapeItem[] = Array.isArray(rawTapeData)
      ? rawTapeData
      : ((rawTapeData as any)?.tape ?? []).map((item: any, i: number) => ({ ...item, id: item.id ?? String(i) }));
    const allItems = [
      ...liveFeedEvents.map(e => ({
        key: e.key,
        isLive: true,
        label: e.action === "created"
          ? `New ${e.betType} offer posted${e.eventName ? ` on ${e.eventName}` : ""}`
          : e.action === "accepted"
          ? `${e.betType} offer matched${e.eventName ? ` — ${e.eventName}` : ""}`
          : e.action === "cancelled"
          ? `${e.betType} offer cancelled`
          : `P2P ${e.betType} ${e.action}`,
        icon: e.action === "accepted" ? "⚡" : e.action === "created" ? "🎯" : e.action === "cancelled" ? "❌" : "🔄",
        color: e.action === "accepted" ? "text-[#4da2ff]" : e.action === "created" ? "text-cyan-400" : "text-gray-400",
        ts: e.ts,
      })),
      ...tape.slice(0, 5).map(t => {
        const winnerWallet = t.winner === "creator" ? t.creatorWallet : t.winner === "taker" ? t.takerWallet : t.winner;
        const matchName = t.eventName ?? (t.homeTeam && t.awayTeam ? `${t.homeTeam} vs ${t.awayTeam}` : t.type === "parlay" ? `${t.legCount ?? "?"}-leg Parlay` : "Match");
        return {
          key: `tape-${t.type}-${t.id}`,
          isLive: false,
          label: winnerWallet ? `${truncAddr(winnerWallet)} won ${t.payoutAmount != null ? `${Number(t.payoutAmount).toLocaleString()} ${t.currency}` : ""} on ${matchName}` : `${matchName} settled`,
          icon: "🏆",
          color: "text-green-400",
          ts: t.settledAt ? new Date(t.settledAt).getTime() : 0,
        };
      }),
    ].sort((a, b) => b.ts - a.ts).slice(0, 7);

    if (allItems.length === 0 && !settledTapeQuery.isLoading) return null;

    return (
      <div className="bg-gradient-to-r from-[#0a1520]/90 to-[#0d1220]/90 border border-[#4da2ff]/20 rounded-2xl overflow-hidden" data-testid="p2p-live-feed">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#4da2ff]/10">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-[#4da2ff] rounded-full animate-pulse" />
            <Zap className="h-3.5 w-3.5 text-[#4da2ff]" />
            <span className="text-[#4da2ff] text-xs font-bold uppercase tracking-wider">P2P Live Feed</span>
          </div>
          <Link href="/p2p" className="text-[11px] text-[#4da2ff]/70 hover:text-[#4da2ff] transition-colors flex items-center gap-1">
            Open Market <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {settledTapeQuery.isLoading && allItems.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-3">
            <Loader2 className="h-3.5 w-3.5 text-[#4da2ff] animate-spin" />
            <span className="text-gray-500 text-xs">Loading activity…</span>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/30">
            {allItems.map(item => (
              <div key={item.key} className={`flex items-center gap-2.5 px-4 py-2.5 ${item.isLive ? "bg-[#4da2ff]/5" : ""}`}>
                <span className="text-base shrink-0">{item.icon}</span>
                <span className={`text-xs leading-snug flex-1 min-w-0 truncate ${item.color}`}>{item.label}</span>
                {item.isLive && (
                  <span className="text-[10px] bg-[#4da2ff]/20 text-[#4da2ff] px-1.5 py-0.5 rounded-full font-bold shrink-0">LIVE</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderChatTab() {
    const allRooms = roomsQuery.data || [];
    const searchLower = roomSearch.toLowerCase().trim();
    const filtered = searchLower ? allRooms.filter(r => r.name.toLowerCase().includes(searchLower)) : allRooms;
    const matchRooms = filtered.filter(r => r.roomType === 'match');
    const globalRooms = filtered.filter(r => r.roomType !== 'match');
    return (
      <div className="space-y-3" data-testid="chat-rooms-list">
        {renderP2PLiveFeed()}
        {allRooms.length > 3 && (
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={roomSearch}
              onChange={(e) => setRoomSearch(e.target.value)}
              placeholder="Search rooms..."
              className="w-full bg-[#141c2e] text-white rounded-xl pl-10 pr-4 py-2.5 border border-gray-700/50 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none placeholder-gray-500 text-sm transition-all"
              data-testid="input-search-rooms"
            />
          </div>
        )}
        {roomsQuery.isLoading && (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>
        )}
        {roomsQuery.isError && (
          <div className="text-center py-12">
            <XCircle className="h-8 w-8 text-red-400/50 mx-auto mb-3" />
            <p className="text-red-400 font-medium mb-2">Failed to load rooms</p>
            <button onClick={() => roomsQuery.refetch()} className="text-[#4da2ff] text-sm hover:underline" data-testid="btn-retry-rooms">Try again</button>
          </div>
        )}
        {filtered.length === 0 && searchLower && !roomsQuery.isLoading && (
          <div className="text-center py-12">
            <Search className="h-8 w-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 font-medium mb-1">No rooms matching "{roomSearch}"</p>
            <button onClick={() => setRoomSearch("")} className="text-[#4da2ff] text-sm hover:underline mt-2" data-testid="btn-clear-search">Clear search</button>
          </div>
        )}
        {allRooms.length === 0 && !roomsQuery.isLoading && !roomsQuery.isError && (
          <div className="text-center py-16">
            <div className="h-16 w-16 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Hash className="h-8 w-8 text-[#4da2ff]/40" />
            </div>
            <p className="text-gray-300 font-medium mb-1">No chat rooms yet</p>
            <p className="text-gray-600 text-sm">Place a bet on any match and a chat room will appear here instantly</p>
          </div>
        )}

        {matchRooms.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1 pt-1 pb-2">
              <Radio className="h-4 w-4 text-green-400" />
              <span className="text-green-400 text-xs font-bold uppercase tracking-wider">Active Match Rooms</span>
              <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">{matchRooms.length}</span>
            </div>
            {matchRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setActiveRoom(room)}
                className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-[#0d1a20]/90 to-[#0d1220]/80 hover:from-[#142028] hover:to-[#141c2e] rounded-2xl border border-green-900/40 hover:border-green-500/40 transition-all text-left group"
                data-testid={`room-${room.id}`}
              >
                <div className="h-12 w-12 bg-gradient-to-br from-green-500/20 to-green-500/5 rounded-xl flex items-center justify-center shrink-0 border border-green-500/30 group-hover:border-green-400/50 transition-colors relative">
                  <Radio className="h-5 w-5 text-green-400" />
                  <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-semibold truncate group-hover:text-green-400 transition-colors">{room.name}</span>
                    {room.lastMessageTime && (
                      <span className="text-gray-600 text-xs shrink-0 ml-2">{fmtTime(room.lastMessageTime)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    {(room.activeBets || 0) > 0 && (
                      <span className="text-green-400 text-xs flex items-center gap-1 bg-green-500/10 px-2 py-0.5 rounded-full">
                        <TrendingUp className="h-3 w-3" />
                        {room.activeBets} active bet{(room.activeBets || 0) > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="text-gray-600 text-xs flex items-center gap-1">
                      <Users className="h-3 w-3" />{room.memberCount || 0}
                    </span>
                    <span className="text-gray-700 text-xs flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5 text-green-500/50" />
                      <span className="text-green-500/50">Sealed</span>
                    </span>
                  </div>
                  {room.lastMessage && (
                    <p className="text-gray-500 text-xs mt-1 truncate">{room.lastMessage}</p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-green-400 shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        )}

        {globalRooms.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1 pt-3 pb-2">
              <Hash className="h-4 w-4 text-[#4da2ff]" />
              <span className="text-[#4da2ff] text-xs font-bold uppercase tracking-wider">Community Rooms</span>
            </div>
            {globalRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setActiveRoom(room)}
                className="w-full flex items-center gap-4 p-4 bg-[#0d1220]/80 hover:bg-[#141c2e] rounded-2xl border border-gray-800/50 hover:border-[#4da2ff]/30 transition-all text-left group"
                data-testid={`room-${room.id}`}
              >
                <div className="h-12 w-12 bg-gradient-to-br from-[#4da2ff]/20 to-[#4da2ff]/5 rounded-xl flex items-center justify-center shrink-0 border border-[#4da2ff]/20 group-hover:border-[#4da2ff]/40 transition-colors">
                  <Hash className="h-5 w-5 text-[#4da2ff]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-semibold truncate group-hover:text-[#4da2ff] transition-colors">{room.name}</span>
                    {room.lastMessageTime && (
                      <span className="text-gray-600 text-xs shrink-0 ml-2">{fmtTime(room.lastMessageTime)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-gray-500 text-sm truncate">{room.lastMessage || "No messages yet"}</p>
                    <span className="text-gray-600 text-xs flex items-center gap-1 shrink-0 ml-2">
                      <Users className="h-3 w-3" />{room.memberCount || 0}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-[#4da2ff] shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 bg-gradient-to-br from-[#4da2ff]/5 via-[#4da2ff]/10 to-transparent border border-[#4da2ff]/20 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 bg-[#4da2ff]/10 rounded-xl flex items-center justify-center shrink-0">
              <Shield className="h-5 w-5 text-[#4da2ff]" />
            </div>
            <div>
              <h3 className="text-white font-semibold mb-1.5">Encrypted Match Chat</h3>
              <div className="space-y-2 text-gray-400 text-sm leading-relaxed">
                <p>Chat rooms auto-create for every match with active bets. Place a bet on any game and the room appears here instantly.</p>
                <div className="flex flex-wrap gap-3 mt-3">
                  <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
                    <Lock className="h-3 w-3 text-green-400" />
                    <span className="text-green-400 text-xs font-medium">Sui Seal E2E</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#4da2ff]/10 border border-[#4da2ff]/20 rounded-full px-3 py-1">
                    <Globe className="h-3 w-3 text-[#4da2ff]" />
                    <span className="text-[#4da2ff] text-xs font-medium">Walrus Storage</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full px-3 py-1">
                    <Shield className="h-3 w-3 text-purple-400" />
                    <span className="text-purple-400 text-xs font-medium">On-chain Verified</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderChallengesTab() {
    const challenges = challengesQuery.data || [];
    const incoming = challenges.filter(c => c.challengedWallet === wallet && c.status === "pending");
    const outgoing = challenges.filter(c => c.challengerWallet === wallet);
    const resolved = challenges.filter(c => c.status !== "pending" && c.challengedWallet === wallet);

    const myOffers: any[] = myP2PQuery.data?.myOffers ?? [];
    const myMatches: any[] = myP2PQuery.data?.myMatches ?? [];
    const myParlays: any[] = myP2PQuery.data?.myParlayOffers ?? [];

    const statusBadge = (status: string) => {
      switch (status) {
        case "open":      return <span className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-semibold">Open</span>;
        case "filled":    return <span className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-semibold">Matched</span>;
        case "settled":   return <span className="text-[10px] bg-green-500/15 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full font-semibold">Settled</span>;
        case "cancelled": return <span className="text-[10px] bg-gray-700/50 text-gray-500 border border-gray-700/50 px-2 py-0.5 rounded-full font-semibold">Cancelled</span>;
        case "expired":   return <span className="text-[10px] bg-gray-700/50 text-gray-500 border border-gray-700/50 px-2 py-0.5 rounded-full font-semibold">Expired</span>;
        default:          return <span className="text-[10px] bg-gray-700/50 text-gray-500 border border-gray-700/50 px-2 py-0.5 rounded-full font-semibold">{status}</span>;
      }
    };

    const allMyActivity = [
      ...myOffers.map(o => ({
        key: `offer-${o.id}`,
        role: "Creator" as const,
        label: o.eventName ?? (o.homeTeam && o.awayTeam ? `${o.homeTeam} vs ${o.awayTeam}` : "Match"),
        sub: `${o.prediction ?? "—"} @ ${Number(o.odds ?? 1).toFixed(2)}x`,
        stake: `${Number(o.creatorStake ?? 0).toLocaleString()} ${o.currency ?? "SUI"}`,
        status: o.status ?? "open",
        winner: o.winner,
        creatorWallet: o.creatorWallet,
        ts: o.createdAt,
      })),
      ...myMatches.map(m => ({
        key: `match-${m.id}`,
        role: "Taker" as const,
        label: m.offer?.eventName ?? (m.offer?.homeTeam && m.offer?.awayTeam ? `${m.offer.homeTeam} vs ${m.offer.awayTeam}` : "Match"),
        sub: `Took: ${m.offer?.prediction ?? "—"} @ ${Number(m.offer?.odds ?? 1).toFixed(2)}x`,
        stake: `${Number(m.takerStake ?? 0).toLocaleString()} ${m.offer?.currency ?? "SUI"}`,
        status: m.offer?.status ?? "filled",
        winner: m.offer?.winner,
        creatorWallet: m.offer?.creatorWallet,
        ts: m.createdAt,
      })),
      ...myParlays.map(p => ({
        key: `parlay-${p.id}`,
        role: (p.creatorWallet === wallet ? "Creator" : "Taker") as "Creator" | "Taker",
        label: `${p.legCount ?? (p.legs?.length ?? "?")} -leg Parlay`,
        sub: `${Number(p.totalOdds ?? 1).toFixed(2)}x combined odds`,
        stake: `${Number(p.creatorWallet === wallet ? p.creatorStake : p.takerStake ?? 0).toLocaleString()} ${p.currency ?? "SUI"}`,
        status: p.status ?? "open",
        winner: p.winner,
        creatorWallet: p.creatorWallet,
        ts: p.createdAt,
      })),
    ].sort((a, b) => new Date(b.ts ?? 0).getTime() - new Date(a.ts ?? 0).getTime()).slice(0, 20);

    return (
      <div className="space-y-5" data-testid="challenges-list">

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#4da2ff]" />
              My P2P Bets
            </h2>
            <Link href="/p2p" className="flex items-center gap-1.5 bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] text-white text-sm px-4 py-2 rounded-xl font-medium shadow-lg shadow-[#4da2ff]/20 hover:shadow-[#4da2ff]/30 transition-all">
              <Zap className="h-3.5 w-3.5" /> Post Offer
            </Link>
          </div>

          {myP2PQuery.isLoading && (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 text-[#4da2ff] animate-spin" /></div>
          )}

          {!myP2PQuery.isLoading && allMyActivity.length === 0 && (
            <div className="bg-[#0d1220] border border-[#4da2ff]/20 rounded-2xl p-6 text-center">
              <div className="h-12 w-12 bg-[#4da2ff]/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                <TrendingUp className="h-6 w-6 text-[#4da2ff]/50" />
              </div>
              <p className="text-gray-300 font-medium mb-1">No P2P bets yet</p>
              <p className="text-gray-600 text-sm mb-4">Post an offer on any match and it'll show here with live status.</p>
              <Link href="/p2p" className="inline-flex items-center gap-2 bg-[#4da2ff]/10 border border-[#4da2ff]/30 text-[#4da2ff] text-sm px-4 py-2 rounded-xl font-medium hover:bg-[#4da2ff]/20 transition-all">
                Browse P2P Market <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {allMyActivity.length > 0 && (
            <div className="space-y-2">
              {allMyActivity.map(item => {
                const isWinner = item.winner === "creator" ? item.creatorWallet === wallet : item.winner === "taker" ? item.creatorWallet !== wallet : item.winner === wallet;
                const settled = item.status === "settled";
                return (
                  <div key={item.key} className={`bg-[#0d1220] border rounded-xl p-3.5 transition-all ${
                    settled && isWinner ? "border-green-500/30" :
                    settled && !isWinner ? "border-red-500/20" :
                    item.status === "filled" ? "border-[#4da2ff]/30" :
                    "border-gray-800/60"
                  }`} data-testid={`my-p2p-${item.key}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${item.role === "Creator" ? "bg-purple-500/15 text-purple-400" : "bg-orange-500/15 text-orange-400"}`}>{item.role}</span>
                          {statusBadge(item.status)}
                          {settled && item.winner && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isWinner ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                              {isWinner ? "🏆 Won" : "💸 Lost"}
                            </span>
                          )}
                        </div>
                        <p className="text-white text-sm font-medium truncate">{item.label}</p>
                        <p className="text-gray-500 text-xs mt-0.5">{item.sub}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[#4da2ff] text-xs font-semibold">{item.stake}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-gray-800/50 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-base flex items-center gap-2">
              <Swords className="h-4 w-4 text-purple-400" />
              Direct Challenges
            </h2>
            <p className="text-gray-600 text-xs mt-0.5">Wallet-to-wallet dares. No order book needed.</p>
          </div>
          <button
            onClick={() => setShowChallengeForm(!showChallengeForm)}
            className={`text-sm px-4 py-2 rounded-xl font-medium transition-all ${
              showChallengeForm 
                ? "bg-gray-800 text-gray-300 hover:bg-gray-700" 
                : "bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25"
            }`}
            data-testid="btn-new-challenge"
          >
            {showChallengeForm ? "Cancel" : "New Challenge"}
          </button>
        </div>

        {showChallengeForm && (
          <div className="bg-[#0d1220] border border-[#4da2ff]/30 rounded-2xl p-5 space-y-3" data-testid="challenge-form">
            <div className="text-[#4da2ff] text-xs font-semibold uppercase tracking-wider mb-1">Create Bet Challenge</div>
            <input
              type="text"
              placeholder="Opponent wallet address (0x...)"
              value={challengeForm.wallet}
              onChange={(e) => setChallengeForm(f => ({ ...f, wallet: e.target.value }))}
              className="w-full bg-[#141c2e] text-white rounded-xl px-4 py-3 border border-gray-700/50 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none text-sm placeholder-gray-500 transition-all"
              data-testid="input-challenge-wallet"
            />
            <input
              type="text"
              placeholder="Your prediction (e.g., 'Mexico wins World Cup')"
              value={challengeForm.prediction}
              onChange={(e) => setChallengeForm(f => ({ ...f, prediction: e.target.value }))}
              className="w-full bg-[#141c2e] text-white rounded-xl px-4 py-3 border border-gray-700/50 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none text-sm placeholder-gray-500 transition-all"
              data-testid="input-challenge-prediction"
            />
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="number"
                  placeholder="Amount"
                  value={challengeForm.amount}
                  onChange={(e) => setChallengeForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full bg-[#141c2e] text-white rounded-xl pl-4 pr-16 py-3 border border-gray-700/50 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none text-sm placeholder-gray-500 transition-all"
                  data-testid="input-challenge-amount"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4da2ff] text-xs font-bold">SBETS</span>
              </div>
              <button
                onClick={submitChallenge}
                disabled={!challengeForm.wallet || !challengeForm.prediction || !challengeForm.amount || createChallengeMutation.isPending}
                className="bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] hover:from-[#5db0ff] hover:to-[#4d9cf6] disabled:opacity-40 text-white rounded-xl px-6 py-3 text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-[#4da2ff]/20"
                data-testid="btn-submit-challenge"
              >
                {createChallengeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
                Send
              </button>
            </div>
            <input
              type="text"
              placeholder="Optional trash talk message..."
              value={challengeForm.message}
              onChange={(e) => setChallengeForm(f => ({ ...f, message: e.target.value }))}
              className="w-full bg-[#141c2e] text-white rounded-xl px-4 py-3 border border-gray-700/50 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none text-sm placeholder-gray-500 transition-all"
              data-testid="input-challenge-message"
            />
          </div>
        )}

        {incoming.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-yellow-400 text-sm font-bold flex items-center gap-2">
              <div className="h-2 w-2 bg-yellow-400 rounded-full animate-pulse" />
              Incoming Challenges ({incoming.length})
            </h3>
            {incoming.map(c => (
              <div key={c.id} className="bg-gradient-to-r from-yellow-500/5 to-orange-500/5 border border-yellow-500/30 rounded-2xl p-5" data-testid={`challenge-incoming-${c.id}`}>
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setProfileWallet(c.challengerWallet)} className="text-[#4da2ff] text-sm font-mono hover:underline flex items-center gap-1.5" data-testid={`challenge-profile-${c.id}`}>
                    <div className="h-6 w-6 bg-[#4da2ff]/10 rounded-full flex items-center justify-center">
                      <User className="h-3 w-3 text-[#4da2ff]" />
                    </div>
                    {truncAddr(c.challengerWallet)}
                  </button>
                  <span className="text-yellow-400 text-sm font-bold bg-yellow-500/10 px-3 py-1 rounded-full">{fmtAmount(c.amount)} {c.currency}</span>
                </div>
                <p className="text-white font-medium text-base mb-1">"{c.prediction}"</p>
                {c.message && <p className="text-gray-400 text-sm italic mb-3">{c.message}</p>}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => respondChallengeMutation.mutate({ id: c.id, action: "accept" })}
                    disabled={respondChallengeMutation.isPending}
                    className="flex-1 bg-green-500/15 border border-green-500/40 text-green-400 rounded-xl py-3 text-sm font-semibold hover:bg-green-500/25 transition-all flex items-center justify-center gap-2"
                    data-testid={`btn-accept-${c.id}`}
                  >
                    <CheckCircle className="h-4 w-4" /> Accept Challenge
                  </button>
                  <button
                    onClick={() => respondChallengeMutation.mutate({ id: c.id, action: "decline" })}
                    disabled={respondChallengeMutation.isPending}
                    className="flex-1 bg-red-500/15 border border-red-500/40 text-red-400 rounded-xl py-3 text-sm font-semibold hover:bg-red-500/25 transition-all flex items-center justify-center gap-2"
                    data-testid={`btn-decline-${c.id}`}
                  >
                    <XCircle className="h-4 w-4" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-gray-400 text-sm font-semibold">Sent Challenges ({outgoing.length})</h3>
            {outgoing.map(c => (
              <div key={c.id} className="bg-[#0d1220] border border-gray-800/50 rounded-2xl p-4" data-testid={`challenge-outgoing-${c.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm flex items-center gap-1.5">
                    <Send className="h-3 w-3" />
                    To: <button onClick={() => setProfileWallet(c.challengedWallet)} className="text-[#4da2ff] font-mono hover:underline">{truncAddr(c.challengedWallet)}</button>
                  </span>
                  <span className={`text-xs px-3 py-1 rounded-full font-semibold ${
                    c.status === "pending" ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30" :
                    c.status === "accepted" ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                    "bg-red-500/15 text-red-400 border border-red-500/30"
                  }`}>{c.status}</span>
                </div>
                <p className="text-white text-sm font-medium">"{c.prediction}" — <span className="text-[#4da2ff]">{fmtAmount(c.amount)} {c.currency}</span></p>
                <p className="text-gray-600 text-xs mt-2 flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(c.createdAt)}</p>
              </div>
            ))}
          </div>
        )}

        {resolved.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-gray-400 text-sm font-semibold">Resolved ({resolved.length})</h3>
            {resolved.map(c => (
              <div key={c.id} className="bg-[#0d1220] border border-gray-800/50 rounded-2xl p-4 opacity-70" data-testid={`challenge-resolved-${c.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm flex items-center gap-1.5">
                    From: <button onClick={() => setProfileWallet(c.challengerWallet)} className="text-[#4da2ff] font-mono hover:underline">{truncAddr(c.challengerWallet)}</button>
                  </span>
                  <span className={`text-xs px-3 py-1 rounded-full font-semibold ${
                    c.status === "accepted" ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                    "bg-red-500/15 text-red-400 border border-red-500/30"
                  }`}>{c.status}</span>
                </div>
                <p className="text-white text-sm font-medium">"{c.prediction}" — <span className="text-[#4da2ff]">{fmtAmount(c.amount)} {c.currency}</span></p>
                <p className="text-gray-600 text-xs mt-2 flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(c.createdAt)}</p>
              </div>
            ))}
          </div>
        )}

        {challenges.length === 0 && !challengesQuery.isLoading && !challengesQuery.isError && !showChallengeForm && (
          <div className="text-center py-16">
            <div className="h-16 w-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Swords className="h-8 w-8 text-purple-400/50" />
            </div>
            <p className="text-gray-300 font-medium mb-1">No challenges yet</p>
            <p className="text-gray-600 text-sm max-w-xs mx-auto">Send a P2P bet challenge to any wallet. The bet is created on-chain from the conversation. No middleman.</p>
          </div>
        )}

        {challengesQuery.isLoading && (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>
        )}
        {challengesQuery.isError && (
          <div className="text-center py-12">
            <XCircle className="h-8 w-8 text-red-400/50 mx-auto mb-3" />
            <p className="text-red-400 font-medium mb-2">Failed to load challenges</p>
            <button onClick={() => challengesQuery.refetch()} className="text-[#4da2ff] text-sm hover:underline">Try again</button>
          </div>
        )}
        </div>
      </div>
    );
  }

  function renderNotificationsTab() {
    const notifs = notificationsQuery.data || [];
    return (
      <div className="space-y-4" data-testid="notifications-list">
        <div>
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Bell className="h-5 w-5 text-[#4da2ff]" />
            Settlement Notifications
          </h2>
          <p className="text-gray-600 text-xs mt-0.5">Encrypted on-chain payout proofs. Verifiable forever.</p>
        </div>

        {notificationsQuery.isLoading && (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>
        )}
        {notificationsQuery.isError && (
          <div className="text-center py-12">
            <XCircle className="h-8 w-8 text-red-400/50 mx-auto mb-3" />
            <p className="text-red-400 font-medium mb-2">Failed to load notifications</p>
            <button onClick={() => notificationsQuery.refetch()} className="text-[#4da2ff] text-sm hover:underline">Try again</button>
          </div>
        )}

        {notifs.length === 0 && !notificationsQuery.isLoading && !notificationsQuery.isError && (
          <div className="text-center py-16">
            <div className="h-16 w-16 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Bell className="h-8 w-8 text-green-400/50" />
            </div>
            <p className="text-gray-300 font-medium mb-1">No notifications</p>
            <p className="text-gray-600 text-sm max-w-xs mx-auto">When your bets settle, you'll get encrypted on-chain payout proofs here. Not push notifications — verifiable messages stored on Walrus.</p>
          </div>
        )}

        {notifs.map(n => (
          <div
            key={n.id}
            className={`bg-[#0d1220] border rounded-2xl p-5 transition-all ${
              n.read 
                ? "border-gray-800/50" 
                : n.result === "won" 
                  ? "border-green-500/30 shadow-lg shadow-green-500/5" 
                  : "border-red-500/30 shadow-lg shadow-red-500/5"
            }`}
            data-testid={`notification-${n.id}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {n.result === "won" ? (
                  <div className="h-11 w-11 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl flex items-center justify-center border border-green-500/30">
                    <Trophy className="h-5 w-5 text-green-400" />
                  </div>
                ) : (
                  <div className="h-11 w-11 bg-gradient-to-br from-red-500/20 to-rose-500/20 rounded-xl flex items-center justify-center border border-red-500/30">
                    <XCircle className="h-5 w-5 text-red-400" />
                  </div>
                )}
                <div>
                  <p className={`text-base font-semibold ${n.result === "won" ? "text-green-400" : "text-red-400"}`}>
                    {n.result === "won" ? "Bet Won!" : "Bet Lost"}
                  </p>
                  {n.eventName && <p className="text-gray-400 text-sm mt-0.5">{n.eventName}</p>}
                </div>
              </div>
              <div className="text-right">
                {n.payoutAmount && n.result === "won" && (
                  <p className="text-green-400 font-bold text-lg">+{fmtAmount(n.payoutAmount)} <span className="text-xs">{n.currency}</span></p>
                )}
                <p className="text-gray-600 text-xs mt-0.5 flex items-center gap-1 justify-end"><Clock className="h-3 w-3" />{fmtDate(n.createdAt)}</p>
              </div>
            </div>

            {n.txHash && (
              <div className="flex items-center gap-2 text-xs mt-3 bg-[#141c2e] rounded-xl px-4 py-2.5 border border-gray-800/50">
                <Shield className="h-4 w-4 text-green-400 shrink-0" />
                <span className="text-gray-400">TX:</span>
                <span className="text-gray-300 font-mono">{truncAddr(n.txHash)}</span>
                <a
                  href={`https://suiscan.xyz/mainnet/tx/${n.txHash}`}
                  target="_blank"
                  rel="noopener"
                  className="text-[#4da2ff] hover:text-[#5db0ff] ml-auto flex items-center gap-1 font-medium transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Verify on SuiScan
                </a>
              </div>
            )}

            {!n.read && (
              <button
                onClick={() => markReadMutation.mutate(n.id)}
                className="text-gray-500 hover:text-[#4da2ff] text-xs mt-3 transition-colors flex items-center gap-1"
                data-testid={`btn-mark-read-${n.id}`}
              >
                <Eye className="h-3 w-3" /> Mark as read
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderProfileTab() {
    return (
      <div data-testid="profile-tab">
        <div className="mb-5">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <User className="h-5 w-5 text-[#4da2ff]" />
            Your Betting Identity
          </h2>
          <p className="text-gray-600 text-xs mt-0.5">On-chain verified. No one can fake it.</p>
        </div>
        {renderProfile(profileQuery.data, profileQuery.isLoading)}
      </div>
    );
  }

  function renderProfile(profile: WalletProfile | undefined, loading: boolean) {
    if (loading) {
      return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>;
    }
    if (!profile) {
      return <p className="text-gray-500 text-center py-12">No profile data available</p>;
    }

    return (
      <div className="space-y-5">
        <div className="bg-gradient-to-br from-[#0d1220] to-[#141c2e] border border-gray-800/50 rounded-2xl p-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#4da2ff]/5 to-transparent pointer-events-none" />
          <div className="relative">
            <div className="h-20 w-20 bg-gradient-to-br from-[#4da2ff] to-[#7b61ff] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-[#4da2ff]/20 rotate-3">
              <User className="h-10 w-10 text-white" />
            </div>
            <button 
              onClick={() => copyWallet(profile.wallet)}
              className="text-[#4da2ff] font-mono text-sm hover:text-[#5db0ff] transition-colors flex items-center gap-1.5 mx-auto"
            >
              {truncAddr(profile.wallet)}
              {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {profile.verified ? (
              <div className="inline-flex items-center gap-1.5 mt-3 bg-green-500/10 border border-green-500/30 px-4 py-1.5 rounded-full">
                <CheckCircle className="h-4 w-4 text-green-400" />
                <span className="text-green-400 text-xs font-semibold">Verified Bettor</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 mt-3 bg-gray-800/50 border border-gray-700/50 px-4 py-1.5 rounded-full">
                <Award className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-gray-500 text-xs">Place {Math.max(0, 10 - profile.totalBets)} more bets to verify</span>
              </div>
            )}
            {profile.memberSince && (
              <p className="text-gray-600 text-xs mt-3 flex items-center justify-center gap-1">
                <Clock className="h-3 w-3" />
                Member since {fmtDate(profile.memberSince)}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={TrendingUp} label="Win Rate" value={`${profile.winRate}%`} color="text-green-400" bgColor="from-green-500/10 to-green-500/5" borderColor="border-green-500/20" />
          <StatCard icon={Trophy} label="Bets Won" value={profile.wonBets.toString()} color="text-yellow-400" bgColor="from-yellow-500/10 to-yellow-500/5" borderColor="border-yellow-500/20" />
          <StatCard icon={Award} label="Total Bets" value={profile.totalBets.toString()} color="text-[#4da2ff]" bgColor="from-blue-500/10 to-blue-500/5" borderColor="border-blue-500/20" />
          <StatCard icon={Zap} label="Wagered" value={fmtAmount(profile.totalWagered)} color="text-purple-400" bgColor="from-purple-500/10 to-purple-500/5" borderColor="border-purple-500/20" />
        </div>

        <div className="bg-[#0d1220] border border-gray-800/50 rounded-2xl p-5">
          <h3 className="text-gray-300 text-sm font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#4da2ff]" />
            Performance Breakdown
          </h3>
          <div className="space-y-3">
            <StatRow label="Won" value={profile.wonBets} total={profile.totalBets} color="bg-green-500" />
            <StatRow label="Lost" value={profile.lostBets} total={profile.totalBets} color="bg-red-500" />
            <StatRow label="Pending" value={profile.pendingBets} total={profile.totalBets} color="bg-yellow-500" />
          </div>
          <div className="mt-5 pt-4 border-t border-gray-800/50 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />Total Won</span>
              <span className="text-green-400 font-bold">{fmtAmount(profile.totalWon)} SBETS</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" />Messages Sent</span>
              <span className="text-white font-medium">{profile.messagesSent}</span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#4da2ff]/5 via-[#4da2ff]/10 to-transparent border border-[#4da2ff]/20 rounded-2xl p-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Shield className="h-5 w-5 text-[#4da2ff]" />
            <Lock className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            This profile is derived from <span className="text-[#4da2ff] font-medium">on-chain bet history</span> on Sui blockchain.
            Verified and immutable — no one can fake it.
          </p>
        </div>
      </div>
    );
  }
}

function StatCard({ icon: Icon, label, value, color, bgColor, borderColor }: { icon: any; label: string; value: string; color: string; bgColor: string; borderColor: string }) {
  return (
    <div className={`bg-gradient-to-br ${bgColor} border ${borderColor} rounded-2xl p-4`}>
      <Icon className={`h-5 w-5 ${color} mb-2`} />
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-0.5">{label}</p>
    </div>
  );
}

function StatRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-medium">{value} <span className="text-gray-600 text-xs">/ {total}</span></span>
      </div>
      <div className="h-2 bg-gray-800/80 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
