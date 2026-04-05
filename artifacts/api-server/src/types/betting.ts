// Types for sports events
export interface SportEvent {
  id: string;
  sportId: number;
  leagueName: string;
  leagueId?: number | string;
  leagueSlug?: string;
  homeTeam: string;
  awayTeam: string;
  eventTitle?: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueLogo?: string;
  homeOdds?: number;
  awayOdds?: number;
  drawOdds?: number | null;
  startTime: string;
  status: 'scheduled' | 'live' | 'finished' | 'upcoming';
  score?: string;
  minute?: number | null; // Elapsed minutes for live events (numeric, used for odds math and cutoff checks)
  displayMinute?: string; // Human-readable period label for UI (e.g., "Q4 8", "2H", "Set 3")
  homeScore?: number; // Home team score for live events
  awayScore?: number; // Away team score for live events
  markets: MarketData[];
  isLive: boolean;
  dataSource?: string; // Added to track data source for data quality purposes
  venue?: string;     // Venue information for the event
  format?: string;    // Format information (e.g., T20, Test, ODI for cricket)
  
  runnersInfo?: any[];
  raceDetails?: any;
  oddsSource?: string;

  // Internal properties used during transformation
  _sportId?: number; // Used for tracking the source sport ID during transformations
  _sportName?: string; // Used for tracking the source sport name during transformations
}

// Types for market data
export interface MarketData {
  id: string;
  name: string;
  status?: string; // Optional status field ('open', 'suspended', 'closed', etc.)
  marketType?: string; // Optional market type classification
  outcomes: OutcomeData[];
}

// Types for outcome data
export interface OutcomeData {
  id: string;
  name: string;
  odds: number;
  probability: number;
  status?: string; // Optional status field for the outcome ('active', 'suspended', etc.)
}

// Types for odds data
export interface OddsData {
  providerId: string;
  eventId: string;
  marketId: string;
  marketName: string;
  outcomes: OutcomeData[];
}

// Types for normalized odds data (for the aggregator)
export interface NormalizedOdds {
  outcomeId: string;
  marketId: string;
  eventId: string;
  value: number;
  providerId: string;
  timestamp: Date;
  confidence: number;
}

// Types for bet data
export interface BetData {
  id: string;
  userId: string;
  eventId: string;
  marketId: string;
  outcomeId: string;
  odds: number;
  stake: number;
  potentialWinnings: number;
  status: 'pending' | 'won' | 'lost' | 'void' | 'cash_out';
  placedAt: string;
  settledAt?: string;
  cashOutValue?: number;
}

// Provider configuration
export interface OddsProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
}

// API response format
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}