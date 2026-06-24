const KNOWN_SPORT_PREFIXES = new Set([
  'esports', 'basketball', 'baseball', 'ice-hockey', 'mma',
  'american-football', 'afl', 'formula-1', 'handball', 'rugby',
  'volleyball', 'cricket', 'horse-racing', 'boxing', 'wwe',
  'motogp', 'table-tennis', 'nfl', 'tennis'
]);

const KNOWN_THREE_PART_PREFIXES = new Set(['esports_lol', 'esports_dota']);
const KNOWN_MIDDLE_PARTS = new Set(['api', 'sf']);

export function extractParlayLegIds(parlayEventId: string): string[] {
  const withoutPrefix = parlayEventId.replace(/^parlay_\d+_/, '');
  if (!withoutPrefix || withoutPrefix === parlayEventId) return [];

  if (withoutPrefix.includes('~')) {
    return withoutPrefix.split('~').filter(id => id.length > 0);
  }

  const parts = withoutPrefix.split('_');
  const legIds: string[] = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];
    if (!part) { i++; continue; }

    if (/^\d+$/.test(part)) {
      legIds.push(part);
      i++;
      continue;
    }

    if (i + 1 < parts.length) {
      const twoPartPrefix = `${part}_${parts[i + 1]}`;

      if (KNOWN_THREE_PART_PREFIXES.has(twoPartPrefix) && i + 2 < parts.length) {
        if (twoPartPrefix === 'esports_dota') {
          let j = i + 2;
          while (j < parts.length) {
            if (KNOWN_SPORT_PREFIXES.has(parts[j]) && j + 1 < parts.length) break;
            j++;
          }
          legIds.push(parts.slice(i, j).join('_'));
          i = j;
        } else {
          legIds.push(`${part}_${parts[i + 1]}_${parts[i + 2]}`);
          i += 3;
        }
        continue;
      }

      if (KNOWN_MIDDLE_PARTS.has(parts[i + 1]) && i + 2 < parts.length) {
        legIds.push(`${part}_${parts[i + 1]}_${parts[i + 2]}`);
        i += 3;
        continue;
      }

      legIds.push(`${part}_${parts[i + 1]}`);
      i += 2;
    } else {
      legIds.push(part);
      i++;
    }
  }

  return legIds.filter(id => id.length > 0);
}
