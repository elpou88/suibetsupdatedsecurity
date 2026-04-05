const SPORT_MAP: Record<string, { label: string; emoji: string }> = {
  'football': { label: 'Football', emoji: '⚽' },
  'soccer': { label: 'Football', emoji: '⚽' },
  'basketball': { label: 'Basketball', emoji: '🏀' },
  'ice-hockey': { label: 'Ice Hockey', emoji: '🏒' },
  'baseball': { label: 'Baseball', emoji: '⚾' },
  'american-football': { label: 'American Football', emoji: '🏈' },
  'nfl': { label: 'NFL', emoji: '🏈' },
  'mma': { label: 'MMA', emoji: '🥊' },
  'boxing': { label: 'Boxing', emoji: '🥊' },
  'handball': { label: 'Handball', emoji: '🤾' },
  'volleyball': { label: 'Volleyball', emoji: '🏐' },
  'rugby': { label: 'Rugby', emoji: '🏉' },
  'afl': { label: 'AFL', emoji: '🏉' },
  'cricket': { label: 'Cricket', emoji: '🏏' },
  'formula-1': { label: 'Formula 1', emoji: '🏎️' },
  'horse-racing': { label: 'Horse Racing', emoji: '🐎' },
  'esports': { label: 'Esports', emoji: '🎮' },
  'lol': { label: 'LoL Esports', emoji: '🎮' },
  'dota': { label: 'Dota 2', emoji: '🎮' },
};

export function getSportFromEventId(eventId: string): { label: string; emoji: string } | null {
  if (!eventId) return null;

  const prefixMatch = eventId.match(/^([a-z0-9-]+?)_api_/);
  if (prefixMatch) {
    const sport = prefixMatch[1];
    return SPORT_MAP[sport] || { label: sport.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), emoji: '🏅' };
  }

  if (eventId.startsWith('esports_') || eventId.startsWith('lol_') || eventId.startsWith('dota_')) {
    const sport = eventId.split('_')[0];
    return SPORT_MAP[sport] || { label: 'Esports', emoji: '🎮' };
  }

  if (eventId.startsWith('horse-racing_') || eventId.includes('rac_')) {
    return SPORT_MAP['horse-racing'];
  }

  if (/^\d+$/.test(eventId)) {
    return SPORT_MAP['football'];
  }

  return null;
}
