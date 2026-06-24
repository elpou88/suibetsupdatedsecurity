/**
 * Sports Configuration for SuiBets Platform
 * Configurable sports list with environment variable support
 */

export interface SportsConfig {
  available: string[];
  enabled?: string[];
  singleSportMode: boolean;
  currentSport: string;
}

const ALL_SPORTS = [
  'football', 'basketball', 'baseball', 'hockey', 'handball', 'volleyball',
  'rugby', 'mma', 'formula-1', 'american-football', 'afl'
];

const LIVE_SPORTS = [
  'football', 'basketball', 'baseball', 'hockey', 'handball', 'volleyball',
  'rugby', 'mma', 'american-football', 'afl'
];

export function getSportsToFetch(): string[] {
  const singleSportMode = process.env.SINGLE_SPORT_MODE === 'true';
  
  if (singleSportMode) {
    const sport = process.env.CURRENT_SPORT || 'football';
    console.log(`📍 SINGLE SPORT MODE: Fetching only "${sport}"`);
    return [sport];
  }
  
  if (process.env.SPORTS_LIST) {
    const customSports = process.env.SPORTS_LIST
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s && ALL_SPORTS.includes(s));
    
    if (customSports.length > 0) {
      console.log(`📍 CUSTOM SPORTS LIST: ${customSports.join(', ')}`);
      return customSports;
    } else {
      console.warn(`⚠️ SPORTS_LIST provided but no valid sports found. Using all sports.`);
    }
  }
  
  return ALL_SPORTS;
}

export function getLiveSportsToFetch(): string[] {
  return LIVE_SPORTS;
}

export function getSportsConfig(): SportsConfig {
  const singleSportMode = process.env.SINGLE_SPORT_MODE === 'true';
  
  return {
    available: ALL_SPORTS,
    enabled: process.env.SPORTS_LIST 
      ? process.env.SPORTS_LIST.split(',').map(s => s.trim().toLowerCase())
      : undefined,
    singleSportMode,
    currentSport: process.env.CURRENT_SPORT || 'football'
  };
}

export default { getSportsToFetch, getLiveSportsToFetch, getSportsConfig, ALL_SPORTS, LIVE_SPORTS };
