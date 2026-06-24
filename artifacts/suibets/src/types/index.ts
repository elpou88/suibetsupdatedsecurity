import { WalletType, User, Sport, Bet, Promotion, Notification } from "@shared/schema";
import type { Event as SchemaEvent } from "@shared/schema";

// Enhanced Event type that properly handles score variations
export interface Event extends Omit<SchemaEvent, 'score'> {
  // Allow score to be string, object with home/away properties, or array of scores
  score?: 
    | string 
    | { home: number | string; away: number | string } 
    | [number | string, number | string] 
    | null;
  // Add other properties that might come from API but aren't in schema
  markets?: Array<{
    id?: string | number;
    name: string;
    outcomes?: Array<{
      id?: string | number;
      name: string;
      odds: number;
    }>;
  }>;
  eventDate?: string;
  league?: { name: string; id: number | string };
  home?: string;
  away?: string;
  team1?: string;
  team2?: string;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  connectWallet: (address: string, walletType: WalletType) => Promise<void>;
  disconnectWallet: () => void;
  login: (user: User) => void;
  updateWalletBalance: (amount: number, currency: string) => void;
}

export interface PlaceBetOptions {
  betType?: 'single' | 'parlay';
  currency?: 'SUI' | 'SBETS';
  acceptOddsChange?: boolean;
  paymentMethod?: 'platform' | 'wallet';
  useBonus?: boolean;
  useFreeBet?: boolean;
  giftRecipientWallet?: string;
}

export interface BettingContextType {
  selectedBets: SelectedBet[];
  addBet: (bet: SelectedBet) => void;
  removeBet: (betId: string) => void;
  clearBets: () => void;
  placeBet: (betAmount: number, options?: PlaceBetOptions) => Promise<boolean>;
  totalStake: number;
  potentialWinnings: number;
  updateStake: (id: string, amount: number) => void;
}

export interface SelectedBet {
  id: string;
  eventId: string;
  eventName: string;
  selectionName: string;
  odds: number;
  stake: number;
  market: string;
  marketId?: number;
  outcomeId?: string | number;
  currency?: 'SUI' | 'SBETS';
  isLive?: boolean;
  matchMinute?: number;
  uniqueId?: string;
  homeTeam?: string;
  awayTeam?: string;
  sportId?: number;
  leagueName?: string;
  sportName?: string;
  matchDate?: string;
}

// Market type for betting markets
export interface Market {
  id: number | string;
  name: string;
  type?: string;
  status?: string;
  outcomes: {
    id: string | number;
    name: string;
    odds: number;
    probability?: number;
  }[];
}

export interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export { WalletType, User, Sport, Bet, Promotion, Notification };
