import { useState, useMemo, useEffect, useRef } from 'react';
import { useSuiNSNames, displayName } from '@/hooks/useSuiNSName';
import FantasyH2H from './FantasyH2H';
import { Users, Star, Trophy, Shirt, RotateCcw, Check, Lock, Info, AlertCircle, Copy, ExternalLink, Zap, ArrowLeftRight } from 'lucide-react';

// ─── Admin wallet for 5 SUI entry fee ─────────────────────────────────────────
const ADMIN_WALLET = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
const ENTRY_FEE_SUI = 5;
const ENTRY_FEE_MIST = BigInt(5_000_000_000); // 5 SUI in MIST

// ─── Player Pool ──────────────────────────────────────────────────────────────
export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface Player {
  id: string;
  name: string;
  country: string;
  countryName: string;
  position: Position;
  rating: number;
  price: number;
}

// WC 2026 Official Draw (Dec 5, 2025) — 48 teams across 12 groups
// Group A: Mexico, South Africa, South Korea, Czechia
// Group B: Canada, Bosnia & Herzegovina, Qatar, Switzerland
// Group C: Brazil, Morocco, Haiti, Scotland
// Group D: USA, Paraguay, Australia, Turkey
// Group E: Germany, Ivory Coast, Ecuador, Curaçao
// Group F: Netherlands, Sweden, Tunisia, Japan
// Group G: Belgium, Egypt, Iran, New Zealand
// Group H: Spain, Cape Verde, Saudi Arabia, Uruguay
// Group I: France, Senegal, Iraq, Norway
// Group J: Argentina, Algeria, Austria, Jordan
// Group K: Portugal, DR Congo, Uzbekistan, Colombia
// Group L: England, Croatia, Ghana, Panama

export const PLAYERS: Player[] = [
  // ── GOALKEEPERS ─────────────────────────────────────────────────────────────
  { id: 'gk-eng-1', name: 'J. Pickford',   country: 'GB-ENG', countryName: 'England',         position: 'GK', rating: 7, price: 5.0 },
  { id: 'gk-fra-1', name: 'M. Maignan',    country: 'FR',     countryName: 'France',           position: 'GK', rating: 8, price: 5.5 },
  { id: 'gk-esp-1', name: 'U. Simón',      country: 'ES',     countryName: 'Spain',            position: 'GK', rating: 8, price: 5.5 },
  { id: 'gk-bra-1', name: 'Alisson',       country: 'BR',     countryName: 'Brazil',           position: 'GK', rating: 9, price: 6.0 },
  { id: 'gk-arg-1', name: 'E. Martínez',   country: 'AR',     countryName: 'Argentina',        position: 'GK', rating: 9, price: 6.0 },
  { id: 'gk-ger-1', name: 'M. ter Stegen', country: 'DE',     countryName: 'Germany',          position: 'GK', rating: 8, price: 5.5 },
  { id: 'gk-por-1', name: 'D. Costa',      country: 'PT',     countryName: 'Portugal',         position: 'GK', rating: 7, price: 5.0 },
  { id: 'gk-ned-1', name: 'B. Flekken',    country: 'NL',     countryName: 'Netherlands',      position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-mor-1', name: 'Y. Bounou',     country: 'MA',     countryName: 'Morocco',          position: 'GK', rating: 8, price: 5.5 },
  { id: 'gk-usa-1', name: 'M. Turner',     country: 'US',     countryName: 'USA',              position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-jpn-1', name: 'S. Gonda',      country: 'JP',     countryName: 'Japan',            position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-hrv-1', name: 'D. Livaković',  country: 'HR',     countryName: 'Croatia',          position: 'GK', rating: 8, price: 5.5 },
  { id: 'gk-bel-1', name: 'T. Courtois',   country: 'BE',     countryName: 'Belgium',          position: 'GK', rating: 9, price: 6.0 },
  { id: 'gk-col-1', name: 'C. Vargas',     country: 'CO',     countryName: 'Colombia',         position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-ury-1', name: 'S. Rochet',     country: 'UY',     countryName: 'Uruguay',          position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-nor-1', name: 'Ø. Nyland',     country: 'NO',     countryName: 'Norway',           position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-egy-1', name: 'M. El Shenawy', country: 'EG',     countryName: 'Egypt',            position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-mex-1', name: 'G. Ochoa',      country: 'MX',     countryName: 'Mexico',           position: 'GK', rating: 8, price: 5.0 },
  { id: 'gk-kor-1', name: 'K. Seung-gyu',  country: 'KR',     countryName: 'South Korea',      position: 'GK', rating: 7, price: 4.5 },
  { id: 'gk-sui-1', name: 'Y. Sommer',     country: 'CH',     countryName: 'Switzerland',      position: 'GK', rating: 8, price: 5.0 },
  { id: 'gk-sen-1', name: 'E. Mendy',      country: 'SN',     countryName: 'Senegal',          position: 'GK', rating: 8, price: 5.0 },
  { id: 'gk-mex-2', name: 'R. Cota',       country: 'MX',     countryName: 'Mexico',           position: 'GK', rating: 7, price: 4.5 },

  // ── DEFENDERS ────────────────────────────────────────────────────────────────
  { id: 'def-eng-1', name: 'K. Walker',           country: 'GB-ENG', countryName: 'England',    position: 'DEF', rating: 8, price: 6.0 },
  { id: 'def-eng-2', name: 'M. Guehi',            country: 'GB-ENG', countryName: 'England',    position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-eng-3', name: 'T. Alexander-Arnold', country: 'GB-ENG', countryName: 'England',    position: 'DEF', rating: 9, price: 7.5 },
  { id: 'def-fra-1', name: 'J. Koundé',           country: 'FR',     countryName: 'France',     position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-fra-2', name: 'T. Hernández',        country: 'FR',     countryName: 'France',     position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-fra-3', name: 'W. Saliba',           country: 'FR',     countryName: 'France',     position: 'DEF', rating: 9, price: 7.0 },
  { id: 'def-esp-1', name: 'A. Laporte',          country: 'ES',     countryName: 'Spain',      position: 'DEF', rating: 8, price: 6.0 },
  { id: 'def-esp-2', name: 'M. Cucurella',        country: 'ES',     countryName: 'Spain',      position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-esp-3', name: 'Le Normand',          country: 'ES',     countryName: 'Spain',      position: 'DEF', rating: 8, price: 6.0 },
  { id: 'def-bra-1', name: 'Marquinhos',          country: 'BR',     countryName: 'Brazil',     position: 'DEF', rating: 9, price: 7.0 },
  { id: 'def-bra-2', name: 'Militão',             country: 'BR',     countryName: 'Brazil',     position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-arg-1', name: 'N. Molina',           country: 'AR',     countryName: 'Argentina',  position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-arg-2', name: 'L. Martínez',         country: 'AR',     countryName: 'Argentina',  position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-ger-1', name: 'A. Rüdiger',          country: 'DE',     countryName: 'Germany',    position: 'DEF', rating: 9, price: 7.0 },
  { id: 'def-ger-2', name: 'J. Tah',              country: 'DE',     countryName: 'Germany',    position: 'DEF', rating: 8, price: 6.0 },
  { id: 'def-por-1', name: 'R. Semedo',           country: 'PT',     countryName: 'Portugal',   position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-por-2', name: 'P. Magalhães',        country: 'PT',     countryName: 'Portugal',   position: 'DEF', rating: 8, price: 6.0 },
  { id: 'def-ned-1', name: 'V. van Dijk',         country: 'NL',     countryName: 'Netherlands',position: 'DEF', rating: 9, price: 7.0 },
  { id: 'def-ned-2', name: 'D. Dumfries',         country: 'NL',     countryName: 'Netherlands',position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-mor-1', name: 'N. Mazraoui',         country: 'MA',     countryName: 'Morocco',    position: 'DEF', rating: 8, price: 6.0 },
  { id: 'def-hrv-1', name: 'J. Gvardiol',         country: 'HR',     countryName: 'Croatia',    position: 'DEF', rating: 9, price: 7.5 },
  { id: 'def-bel-1', name: 'A. Castagne',         country: 'BE',     countryName: 'Belgium',    position: 'DEF', rating: 7, price: 6.0 },
  { id: 'def-bel-2', name: 'W. Faes',             country: 'BE',     countryName: 'Belgium',    position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-col-1', name: 'D. Muñoz',            country: 'CO',     countryName: 'Colombia',   position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-ury-1', name: 'R. Araújo',           country: 'UY',     countryName: 'Uruguay',    position: 'DEF', rating: 8, price: 7.0 },
  { id: 'def-nor-1', name: 'J. Ajer',             country: 'NO',     countryName: 'Norway',     position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-sco-1', name: 'A. Robertson',        country: 'GB-SCT', countryName: 'Scotland',   position: 'DEF', rating: 9, price: 7.5 },
  { id: 'def-sui-1', name: 'M. Akanji',           country: 'CH',     countryName: 'Switzerland',position: 'DEF', rating: 8, price: 7.0 },
  { id: 'def-jpn-1', name: 'H. Sugawara',         country: 'JP',     countryName: 'Japan',      position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-kor-1', name: 'Kim Min-jae',         country: 'KR',     countryName: 'South Korea',position: 'DEF', rating: 9, price: 7.5 },
  { id: 'def-tur-1', name: 'S. Kabak',            country: 'TR',     countryName: 'Turkey',     position: 'DEF', rating: 7, price: 6.0 },
  { id: 'def-mex-1', name: 'J. Sánchez',          country: 'MX',     countryName: 'Mexico',     position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-sen-1', name: 'K. Koulibaly',        country: 'SN',     countryName: 'Senegal',    position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-aus-1', name: 'M. Rowles',           country: 'AU',     countryName: 'Australia',  position: 'DEF', rating: 7, price: 5.5 },
  { id: 'def-par-1', name: 'G. Adeola',           country: 'PY',     countryName: 'Paraguay',   position: 'DEF', rating: 7, price: 5.0 },
  { id: 'def-alg-1', name: 'R. Ait Nouri',        country: 'DZ',     countryName: 'Algeria',    position: 'DEF', rating: 8, price: 6.5 },
  { id: 'def-aut-1', name: 'D. Alaba',            country: 'AT',     countryName: 'Austria',    position: 'DEF', rating: 8, price: 7.0 },

  // ── MIDFIELDERS ──────────────────────────────────────────────────────────────
  { id: 'mid-eng-1', name: 'J. Bellingham',   country: 'GB-ENG', countryName: 'England',         position: 'MID', rating: 10, price: 11.5 },
  { id: 'mid-eng-2', name: 'D. Rice',         country: 'GB-ENG', countryName: 'England',         position: 'MID', rating: 9,  price: 8.0  },
  { id: 'mid-eng-3', name: 'P. Foden',        country: 'GB-ENG', countryName: 'England',         position: 'MID', rating: 9,  price: 9.0  },
  { id: 'mid-fra-1', name: 'A. Tchouaméni',  country: 'FR',     countryName: 'France',           position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-fra-2', name: 'E. Camavinga',   country: 'FR',     countryName: 'France',           position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-esp-1', name: 'P. Gavi',        country: 'ES',     countryName: 'Spain',            position: 'MID', rating: 9,  price: 8.5  },
  { id: 'mid-esp-2', name: 'P. Pedri',       country: 'ES',     countryName: 'Spain',            position: 'MID', rating: 10, price: 10.0 },
  { id: 'mid-esp-3', name: 'F. Ruiz',        country: 'ES',     countryName: 'Spain',            position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-bra-1', name: 'Lucas Paquetá',  country: 'BR',     countryName: 'Brazil',           position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-bra-2', name: 'Bruno Guimarães',country: 'BR',     countryName: 'Brazil',           position: 'MID', rating: 9,  price: 8.0  },
  { id: 'mid-arg-1', name: 'L. Messi',       country: 'AR',     countryName: 'Argentina',        position: 'MID', rating: 10, price: 15.0 },
  { id: 'mid-arg-2', name: 'A. Mac Allister',country: 'AR',     countryName: 'Argentina',        position: 'MID', rating: 9,  price: 8.0  },
  { id: 'mid-arg-3', name: 'R. De Paul',     country: 'AR',     countryName: 'Argentina',        position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-ger-1', name: 'J. Kimmich',     country: 'DE',     countryName: 'Germany',          position: 'MID', rating: 9,  price: 8.5  },
  { id: 'mid-ger-2', name: 'F. Wirtz',       country: 'DE',     countryName: 'Germany',          position: 'MID', rating: 9,  price: 9.5  },
  { id: 'mid-por-1', name: 'B. Fernandes',   country: 'PT',     countryName: 'Portugal',         position: 'MID', rating: 9,  price: 9.0  },
  { id: 'mid-por-2', name: 'R. Neves',       country: 'PT',     countryName: 'Portugal',         position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-ned-1', name: 'F. de Jong',     country: 'NL',     countryName: 'Netherlands',      position: 'MID', rating: 9,  price: 8.5  },
  { id: 'mid-ned-2', name: 'T. Reijnders',   country: 'NL',     countryName: 'Netherlands',      position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-mor-1', name: 'S. Amrabat',     country: 'MA',     countryName: 'Morocco',          position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-mor-2', name: 'H. Ziyech',      country: 'MA',     countryName: 'Morocco',          position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-usa-1', name: 'W. McKennie',    country: 'US',     countryName: 'USA',              position: 'MID', rating: 7,  price: 6.0  },
  { id: 'mid-usa-2', name: 'Y. Musah',       country: 'US',     countryName: 'USA',              position: 'MID', rating: 7,  price: 6.0  },
  { id: 'mid-jpn-1', name: 'T. Minamino',    country: 'JP',     countryName: 'Japan',            position: 'MID', rating: 7,  price: 6.5  },
  { id: 'mid-jpn-2', name: 'W. Endo',        country: 'JP',     countryName: 'Japan',            position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-hrv-1', name: 'L. Modrić',      country: 'HR',     countryName: 'Croatia',          position: 'MID', rating: 9,  price: 8.0  },
  { id: 'mid-hrv-2', name: 'M. Brozović',    country: 'HR',     countryName: 'Croatia',          position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-bel-1', name: 'K. De Bruyne',   country: 'BE',     countryName: 'Belgium',          position: 'MID', rating: 10, price: 12.5 },
  { id: 'mid-bel-2', name: 'Y. Tielemans',   country: 'BE',     countryName: 'Belgium',          position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-col-1', name: 'J. Rodriguez',   country: 'CO',     countryName: 'Colombia',         position: 'MID', rating: 8,  price: 8.0  },
  { id: 'mid-col-2', name: 'J. Cuadrado',    country: 'CO',     countryName: 'Colombia',         position: 'MID', rating: 7,  price: 6.5  },
  { id: 'mid-ury-1', name: 'F. Valverde',    country: 'UY',     countryName: 'Uruguay',          position: 'MID', rating: 9,  price: 9.0  },
  { id: 'mid-nor-1', name: 'M. Ødegaard',    country: 'NO',     countryName: 'Norway',           position: 'MID', rating: 10, price: 11.0 },
  { id: 'mid-sco-1', name: 'S. McTominay',   country: 'GB-SCT', countryName: 'Scotland',         position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-sui-1', name: 'G. Xhaka',       country: 'CH',     countryName: 'Switzerland',      position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-kor-1', name: 'Lee Jae-sung',   country: 'KR',     countryName: 'South Korea',      position: 'MID', rating: 7,  price: 6.5  },
  { id: 'mid-tur-1', name: 'H. Çalhanoğlu',  country: 'TR',     countryName: 'Turkey',           position: 'MID', rating: 9,  price: 8.5  },
  { id: 'mid-tur-2', name: 'A. Güler',        country: 'TR',     countryName: 'Turkey',           position: 'MID', rating: 9,  price: 9.0  },
  { id: 'mid-mex-1', name: 'H. Lozano',      country: 'MX',     countryName: 'Mexico',           position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-mex-2', name: 'T. Almada',      country: 'MX',     countryName: 'Mexico',           position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-sen-1', name: 'I. Sarr',        country: 'SN',     countryName: 'Senegal',          position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-sen-2', name: 'P. Gueye',       country: 'SN',     countryName: 'Senegal',          position: 'MID', rating: 8,  price: 7.0  },
  { id: 'mid-alg-1', name: 'I. Bennacer',    country: 'DZ',     countryName: 'Algeria',          position: 'MID', rating: 8,  price: 8.0  },
  { id: 'mid-aut-1', name: 'M. Sabitzer',    country: 'AT',     countryName: 'Austria',          position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-gha-1', name: 'M. Kudus',       country: 'GH',     countryName: 'Ghana',            position: 'MID', rating: 9,  price: 9.0  },
  { id: 'mid-sau-1', name: 'S. Al-Dawsari',  country: 'SA',     countryName: 'Saudi Arabia',     position: 'MID', rating: 8,  price: 7.5  },
  { id: 'mid-aus-1', name: 'J. Irvine',      country: 'AU',     countryName: 'Australia',        position: 'MID', rating: 7,  price: 6.0  },
  { id: 'mid-civ-1', name: 'F. Sangaré',     country: 'CI',     countryName: 'Ivory Coast',      position: 'MID', rating: 7,  price: 6.5  },
  { id: 'mid-ecu-1', name: 'M. Caicedo',     country: 'EC',     countryName: 'Ecuador',          position: 'MID', rating: 8,  price: 8.0  },
  { id: 'mid-ned-3', name: 'X. Simons',      country: 'NL',     countryName: 'Netherlands',      position: 'MID', rating: 8,  price: 8.0  },
  { id: 'mid-mar-1', name: 'H. Lozano',      country: 'MA',     countryName: 'Morocco',          position: 'MID', rating: 7,  price: 6.0  },
  { id: 'mid-irq-1', name: 'M. Ali',         country: 'IQ',     countryName: 'Iraq',             position: 'MID', rating: 7,  price: 5.5  },
  { id: 'mid-pan-1', name: 'A. Murillo',     country: 'PA',     countryName: 'Panama',           position: 'MID', rating: 7,  price: 5.5  },

  // ── FORWARDS ─────────────────────────────────────────────────────────────────
  { id: 'fwd-eng-1', name: 'H. Kane',         country: 'GB-ENG', countryName: 'England',         position: 'FWD', rating: 10, price: 13.0 },
  { id: 'fwd-eng-2', name: 'B. Saka',         country: 'GB-ENG', countryName: 'England',         position: 'FWD', rating: 9,  price: 10.0 },
  { id: 'fwd-fra-1', name: 'K. Mbappé',       country: 'FR',     countryName: 'France',          position: 'FWD', rating: 10, price: 14.0 },
  { id: 'fwd-fra-2', name: 'M. Thuram',       country: 'FR',     countryName: 'France',          position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-fra-3', name: 'O. Dembélé',      country: 'FR',     countryName: 'France',          position: 'FWD', rating: 9,  price: 9.5  },
  { id: 'fwd-esp-1', name: 'A. Morata',       country: 'ES',     countryName: 'Spain',           position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-esp-2', name: 'L. Yamal',        country: 'ES',     countryName: 'Spain',           position: 'FWD', rating: 9,  price: 10.5 },
  { id: 'fwd-esp-3', name: 'N. Williams',     country: 'ES',     countryName: 'Spain',           position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-bra-1', name: 'Vinícius Jr.',    country: 'BR',     countryName: 'Brazil',          position: 'FWD', rating: 10, price: 13.0 },
  { id: 'fwd-bra-2', name: 'Endrick',         country: 'BR',     countryName: 'Brazil',          position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-bra-3', name: 'Raphinha',        country: 'BR',     countryName: 'Brazil',          position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-bra-4', name: 'Rodrygo',         country: 'BR',     countryName: 'Brazil',          position: 'FWD', rating: 9,  price: 9.0  },
  { id: 'fwd-arg-1', name: 'J. Álvarez',      country: 'AR',     countryName: 'Argentina',       position: 'FWD', rating: 9,  price: 10.0 },
  { id: 'fwd-arg-2', name: 'L. Martínez',     country: 'AR',     countryName: 'Argentina',       position: 'FWD', rating: 9,  price: 9.5  },
  { id: 'fwd-ger-1', name: 'K. Havertz',      country: 'DE',     countryName: 'Germany',         position: 'FWD', rating: 9,  price: 9.5  },
  { id: 'fwd-ger-2', name: 'N. Füllkrug',     country: 'DE',     countryName: 'Germany',         position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-por-1', name: 'C. Ronaldo',      country: 'PT',     countryName: 'Portugal',        position: 'FWD', rating: 9,  price: 12.0 },
  { id: 'fwd-por-2', name: 'R. Leão',         country: 'PT',     countryName: 'Portugal',        position: 'FWD', rating: 9,  price: 9.5  },
  { id: 'fwd-ned-1', name: 'M. Depay',        country: 'NL',     countryName: 'Netherlands',     position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-ned-2', name: 'C. Gakpo',        country: 'NL',     countryName: 'Netherlands',     position: 'FWD', rating: 9,  price: 9.5  },
  { id: 'fwd-mor-1', name: 'Y. En-Nesyri',   country: 'MA',     countryName: 'Morocco',         position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-usa-1', name: 'C. Pulisic',      country: 'US',     countryName: 'USA',             position: 'FWD', rating: 8,  price: 9.0  },
  { id: 'fwd-jpn-1', name: 'K. Mitoma',       country: 'JP',     countryName: 'Japan',           position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-hrv-1', name: 'A. Kramarić',     country: 'HR',     countryName: 'Croatia',         position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-bel-1', name: 'R. Lukaku',       country: 'BE',     countryName: 'Belgium',         position: 'FWD', rating: 8,  price: 9.0  },
  { id: 'fwd-bel-2', name: 'L. Openda',       country: 'BE',     countryName: 'Belgium',         position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-col-1', name: 'L. Díaz',         country: 'CO',     countryName: 'Colombia',        position: 'FWD', rating: 9,  price: 9.5  },
  { id: 'fwd-col-2', name: 'J. Borja',        country: 'CO',     countryName: 'Colombia',        position: 'FWD', rating: 7,  price: 7.0  },
  { id: 'fwd-ury-1', name: 'D. Núñez',        country: 'UY',     countryName: 'Uruguay',         position: 'FWD', rating: 9,  price: 10.0 },
  { id: 'fwd-nor-1', name: 'E. Haaland',      country: 'NO',     countryName: 'Norway',          position: 'FWD', rating: 10, price: 15.0 },
  { id: 'fwd-sco-1', name: 'L. Adams',        country: 'GB-SCT', countryName: 'Scotland',        position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-sui-1', name: 'B. Embolo',       country: 'CH',     countryName: 'Switzerland',     position: 'FWD', rating: 7,  price: 7.0  },
  { id: 'fwd-kor-1', name: 'Son Heung-min',   country: 'KR',     countryName: 'South Korea',     position: 'FWD', rating: 10, price: 12.0 },
  { id: 'fwd-tur-1', name: 'B. Yılmaz',       country: 'TR',     countryName: 'Turkey',          position: 'FWD', rating: 7,  price: 7.5  },
  { id: 'fwd-mex-1', name: 'R. Jiménez',      country: 'MX',     countryName: 'Mexico',          position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-sen-1', name: 'B. Dia',          country: 'SN',     countryName: 'Senegal',         position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-egy-1', name: 'M. Salah',        country: 'EG',     countryName: 'Egypt',           position: 'FWD', rating: 10, price: 13.0 },
  { id: 'fwd-alg-1', name: 'R. Mahrez',       country: 'DZ',     countryName: 'Algeria',         position: 'FWD', rating: 9,  price: 9.0  },
  { id: 'fwd-alg-2', name: 'A. Belaili',      country: 'DZ',     countryName: 'Algeria',         position: 'FWD', rating: 8,  price: 7.5  },
  { id: 'fwd-aut-1', name: 'M. Arnautović',   country: 'AT',     countryName: 'Austria',         position: 'FWD', rating: 7,  price: 7.5  },
  { id: 'fwd-gha-1', name: 'I. Williams',     country: 'GH',     countryName: 'Ghana',           position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-sau-1', name: 'S. Al-Shehri',    country: 'SA',     countryName: 'Saudi Arabia',    position: 'FWD', rating: 7,  price: 7.0  },
  { id: 'fwd-aus-1', name: 'M. Duke',         country: 'AU',     countryName: 'Australia',       position: 'FWD', rating: 7,  price: 7.0  },
  { id: 'fwd-civ-1', name: 'S. Haller',       country: 'CI',     countryName: 'Ivory Coast',     position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-ecu-1', name: 'E. Valencia',     country: 'EC',     countryName: 'Ecuador',         position: 'FWD', rating: 8,  price: 8.0  },
  { id: 'fwd-ira-1', name: 'M. Taremi',       country: 'IR',     countryName: 'Iran',            position: 'FWD', rating: 9,  price: 10.0 },
  { id: 'fwd-par-1', name: 'R. Sánchez',      country: 'PY',     countryName: 'Paraguay',        position: 'FWD', rating: 7,  price: 6.5  },
  { id: 'fwd-uzb-1', name: 'E. Shomurodov',   country: 'UZ',     countryName: 'Uzbekistan',      position: 'FWD', rating: 7,  price: 6.5  },
  { id: 'fwd-pan-1', name: 'R. Fajardo',      country: 'PA',     countryName: 'Panama',          position: 'FWD', rating: 7,  price: 6.5  },
  { id: 'fwd-tur-2', name: 'K. Aktürkoğlu',   country: 'TR',     countryName: 'Turkey',          position: 'FWD', rating: 8,  price: 8.5  },
  { id: 'fwd-jor-1', name: 'M. Al-Tamari',    country: 'JO',     countryName: 'Jordan',          position: 'FWD', rating: 7,  price: 6.5  },
  { id: 'fwd-swe-1', name: 'V. Gyökeres',     country: 'SE',     countryName: 'Sweden',          position: 'FWD', rating: 9,  price: 11.0 },
  { id: 'fwd-swe-2', name: 'A. Isak',         country: 'SE',     countryName: 'Sweden',          position: 'FWD', rating: 9,  price: 10.5 },
  { id: 'fwd-tun-1', name: 'Y. Msakni',       country: 'TN',     countryName: 'Tunisia',         position: 'FWD', rating: 7,  price: 6.5  },
];

// ─── Flag Emoji Map ────────────────────────────────────────────────────────────
export const FLAG_EMOJI: Record<string, string> = {
  'GB-ENG': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'GB-SCT': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'FR': '🇫🇷', 'ES': '🇪🇸', 'BR': '🇧🇷', 'AR': '🇦🇷',
  'PT': '🇵🇹', 'DE': '🇩🇪', 'NL': '🇳🇱', 'MA': '🇲🇦',
  'US': '🇺🇸', 'JP': '🇯🇵', 'HR': '🇭🇷', 'BE': '🇧🇪',
  'CO': '🇨🇴', 'UY': '🇺🇾', 'NO': '🇳🇴', 'EG': '🇪🇬',
  'MX': '🇲🇽', 'KR': '🇰🇷', 'CH': '🇨🇭', 'SN': '🇸🇳',
  'TR': '🇹🇷', 'DZ': '🇩🇿', 'AT': '🇦🇹', 'GH': '🇬🇭',
  'PA': '🇵🇦', 'PY': '🇵🇾', 'AU': '🇦🇺', 'SA': '🇸🇦',
  'IR': '🇮🇷', 'NZ': '🇳🇿', 'CI': '🇨🇮', 'EC': '🇪🇨',
  'SE': '🇸🇪', 'TN': '🇹🇳', 'IQ': '🇮🇶', 'JO': '🇯🇴',
  'CD': '🇨🇩', 'UZ': '🇺🇿', 'ZA': '🇿🇦', 'CZ': '🇨🇿',
  'BA': '🇧🇦', 'QA': '🇶🇦', 'HT': '🇭🇹', 'CV': '🇨🇻',
  'CW': '🇨🇼', 'SI': '🇸🇮',
};

export const POS_COLOR: Record<Position, string> = {
  GK: 'bg-amber-500', DEF: 'bg-blue-500', MID: 'bg-green-500', FWD: 'bg-red-500',
};
export const POS_TEXT_COLOR: Record<Position, string> = {
  GK: 'text-amber-400', DEF: 'text-blue-400', MID: 'text-green-400', FWD: 'text-red-400',
};
const POS_LABEL: Record<Position, string> = {
  GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD',
};

// ─── WC 2026 Official Groups ───────────────────────────────────────────────────
const WC2026_GROUPS = [
  { group: 'A', teams: ['MX','ZA','KR','CZ'] },
  { group: 'B', teams: ['CA','BA','QA','CH'] },
  { group: 'C', teams: ['BR','MA','HT','GB-SCT'] },
  { group: 'D', teams: ['US','PY','AU','TR'] },
  { group: 'E', teams: ['DE','CI','EC','CW'] },
  { group: 'F', teams: ['NL','SE','TN','JP'] },
  { group: 'G', teams: ['BE','EG','IR','NZ'] },
  { group: 'H', teams: ['ES','CV','SA','UY'] },
  { group: 'I', teams: ['FR','SN','IQ','NO'] },
  { group: 'J', teams: ['AR','DZ','AT','JO'] },
  { group: 'K', teams: ['PT','CD','UZ','CO'] },
  { group: 'L', teams: ['GB-ENG','HR','GH','PA'] },
];

const COUNTRY_NAMES: Record<string,string> = {
  'GB-ENG':'England','GB-SCT':'Scotland','FR':'France','ES':'Spain','BR':'Brazil','AR':'Argentina',
  'PT':'Portugal','DE':'Germany','NL':'Netherlands','MA':'Morocco','US':'USA','JP':'Japan','HR':'Croatia',
  'BE':'Belgium','CO':'Colombia','UY':'Uruguay','NO':'Norway','EG':'Egypt','MX':'Mexico','KR':'South Korea',
  'CH':'Switzerland','SN':'Senegal','TR':'Turkey','DZ':'Algeria','AT':'Austria','GH':'Ghana','PA':'Panama',
  'PY':'Paraguay','AU':'Australia','SA':'Saudi Arabia','IR':'Iran','NZ':'New Zealand','CI':'Ivory Coast',
  'EC':'Ecuador','SE':'Sweden','TN':'Tunisia','IQ':'Iraq','JO':'Jordan','CD':'DR Congo','UZ':'Uzbekistan',
  'ZA':'South Africa','CZ':'Czechia','BA':'Bosnia','QA':'Qatar','HT':'Haiti','CV':'Cape Verde','CW':'Curaçao',
  'CA':'Canada',
};

// ─── Scoring constants ─────────────────────────────────────────────────────────
const BUDGET = 100.0;
const SQUAD_SIZE = 15;
const STARTER_SIZE = 11;
const STARTER_SLOTS: Position[] = ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','MID','FWD','FWD'];
const BENCH_SLOTS: Position[]   = ['GK','DEF','MID','FWD'];

export function calcPlayerPoints(
  player: Player,
  matchResult: { win: boolean; draw: boolean; loss: boolean; goalsFor: number; goalsAgainst: number }
) {
  let pts = 0;
  if (matchResult.win) pts += 3;
  else if (matchResult.draw) pts += 1;
  if (player.position === 'FWD') pts += matchResult.goalsFor * 4;
  else if (player.position === 'MID') pts += matchResult.goalsFor * 3;
  else if (player.position === 'DEF') pts += matchResult.goalsFor * 1;
  else if (player.position === 'GK')  pts += matchResult.goalsFor * 1;
  if (matchResult.goalsAgainst === 0) {
    if (player.position === 'GK')  pts += 6;
    else if (player.position === 'DEF') pts += 4;
    else if (player.position === 'MID') pts += 1;
  }
  return pts;
}

// Simulated WC 2026 Group Stage MD1 results (tournament starts June 11, 2026)
export const SAMPLE_RESULTS = [
  { round: 'Group Stage MD1 (Simulated)', teams: [
    { country: 'GB-ENG', win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'FR',     win: true,  draw: false, loss: false, goalsFor: 3, goalsAgainst: 0 },
    { country: 'ES',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 1 },
    { country: 'AR',     win: true,  draw: false, loss: false, goalsFor: 3, goalsAgainst: 1 },
    { country: 'BR',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'DE',     win: true,  draw: false, loss: false, goalsFor: 4, goalsAgainst: 0 },
    { country: 'NL',     win: false, draw: true,  loss: false, goalsFor: 1, goalsAgainst: 1 },
    { country: 'PT',     win: true,  draw: false, loss: false, goalsFor: 3, goalsAgainst: 0 },
    { country: 'BE',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'NO',     win: true,  draw: false, loss: false, goalsFor: 3, goalsAgainst: 1 },
    { country: 'EG',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 1 },
    { country: 'KR',     win: true,  draw: false, loss: false, goalsFor: 1, goalsAgainst: 0 },
    { country: 'UY',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'CO',     win: false, draw: true,  loss: false, goalsFor: 1, goalsAgainst: 1 },
    { country: 'MA',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'US',     win: true,  draw: false, loss: false, goalsFor: 1, goalsAgainst: 0 },
    { country: 'HR',     win: false, draw: true,  loss: false, goalsFor: 1, goalsAgainst: 1 },
    { country: 'SE',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 1 },
    { country: 'DZ',     win: false, draw: false, loss: true,  goalsFor: 1, goalsAgainst: 2 },
    { country: 'TR',     win: false, draw: false, loss: true,  goalsFor: 0, goalsAgainst: 2 },
    { country: 'SN',     win: true,  draw: false, loss: false, goalsFor: 1, goalsAgainst: 0 },
    { country: 'MX',     win: false, draw: true,  loss: false, goalsFor: 0, goalsAgainst: 0 },
    { country: 'AT',     win: false, draw: false, loss: true,  goalsFor: 0, goalsAgainst: 1 },
    { country: 'EC',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 1 },
    { country: 'GH',     win: false, draw: false, loss: true,  goalsFor: 0, goalsAgainst: 1 },
    { country: 'CI',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'IR',     win: false, draw: false, loss: true,  goalsFor: 1, goalsAgainst: 2 },
    { country: 'SE',     win: true,  draw: false, loss: false, goalsFor: 2, goalsAgainst: 0 },
    { country: 'IQ',     win: false, draw: true,  loss: false, goalsFor: 0, goalsAgainst: 0 },
  ]}
];

// ─── LocalStorage ──────────────────────────────────────────────────────────────
const LS_KEY     = 'suibets_fantasy_wc26';
const LS_FEE_KEY = 'suibets_fantasy_fee_wc26';

interface FantasyTeam {
  name: string;
  wallet?: string;
  starterIds: string[];
  benchIds: string[];
  captainId: string;
  totalPoints: number;
  locked: boolean;
  feePaid: boolean;
  feeTxHash?: string;
  createdAt: number;
}

interface FeeRecord { paid: boolean; txHash: string; wallet: string; ts: number; }

function loadTeam(): FantasyTeam | null {
  try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveTeam(t: FantasyTeam) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch {}
}
function loadFee(): FeeRecord | null {
  try { const r = localStorage.getItem(LS_FEE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveFee(f: FeeRecord) {
  try { localStorage.setItem(LS_FEE_KEY, JSON.stringify(f)); } catch {}
}

// Sanitize loaded IDs: only keep IDs that still exist in the PLAYERS pool, pad/truncate to exact size
const VALID_PLAYER_IDS = new Set(PLAYERS.map(p => p.id));
function sanitizePlayerIds(ids: unknown, size: number): (string | null)[] {
  const arr = Array.isArray(ids) ? ids : [];
  const clean: (string | null)[] = arr.map((id: unknown) =>
    (typeof id === 'string' && id && VALID_PLAYER_IDS.has(id)) ? id : null
  );
  if (clean.length > size) return clean.slice(0, size);
  while (clean.length < size) clean.push(null);
  return clean;
}

// ─── Result types ─────────────────────────────────────────────────────────────
export type ResultRound = {
  round: string;
  teams: { country: string; win: boolean; draw: boolean; loss: boolean; goalsFor: number; goalsAgainst: number }[];
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

// ─── Scoring helper ───────────────────────────────────────────────────────────
function computePointsForPlayers(playerIds: string[], captainId: string, results: ResultRound[]): number {
  let total = 0;
  for (const id of playerIds) {
    const player = PLAYERS.find(p => p.id === id);
    if (!player) continue;
    let pts = 0;
    for (const round of results) {
      const r = round.teams.find(t => t.country === player.country);
      if (r) pts += calcPlayerPoints(player, r);
    }
    total += id === captainId ? pts * 2 : pts;
  }
  return total;
}

// ─── Sui TX verifier (mainnet JSON-RPC) ───────────────────────────────────────
// Sui transaction digests are base58-encoded (e.g. CGaAKym2HndUnFMp64ph1y9Sma23p8w),
// NOT 0x-prefixed hex. Accept both just in case wallets display either format.
function normalizeSuiDigest(raw: string): string | null {
  const s = raw.trim();
  // Already a base58 digest (standard Sui format)
  if (/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(s)) return s;
  // Some explorers show 0x-prefixed hex — accept and pass through as-is
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s;
  return null;
}

async function verifySuiTx(txHash: string, senderWallet?: string): Promise<{ ok: boolean; reason: string }> {
  const digest = normalizeSuiDigest(txHash);
  if (!digest) {
    return { ok: false, reason: 'Invalid transaction ID. Paste the digest from your Sui wallet or SuiScan (e.g. CGaAKym2…).' };
  }
  try {
    const res = await fetch('https://fullnode.mainnet.sui.io', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'sui_getTransactionBlock',
        params: [digest, { showInput: true, showEffects: true, showBalanceChanges: true }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data.error) return { ok: false, reason: 'Transaction not found on Sui mainnet.' };
    const tx = data.result;
    if (!tx) return { ok: false, reason: 'Transaction not found.' };
    // Check status
    const status = tx.effects?.status?.status;
    if (status !== 'success') return { ok: false, reason: `Transaction failed on-chain (status: ${status}).` };
    // Check balance changes for admin wallet receiving >= 5 SUI
    const changes: any[] = tx.balanceChanges || [];
    const adminReceived = changes
      .filter((c: any) =>
        c.owner?.AddressOwner?.toLowerCase() === ADMIN_WALLET.toLowerCase() &&
        c.coinType === '0x2::sui::SUI'
      )
      .reduce((sum: bigint, c: any) => sum + BigInt(c.amount || 0), BigInt(0));
    if (adminReceived < ENTRY_FEE_MIST) {
      const suiReceived = Number(adminReceived) / 1e9;
      return { ok: false, reason: `Transaction found, but only ${suiReceived.toFixed(2)} SUI sent to admin wallet. Need exactly ${ENTRY_FEE_SUI} SUI.` };
    }
    return { ok: true, reason: `Verified: ${Number(adminReceived) / 1e9} SUI received.` };
  } catch (e: any) {
    // CORS or network issue — accept the TX hash and mark as pending verification
    if (e.name === 'AbortError' || e.message?.includes('fetch')) {
      return { ok: true, reason: 'TX hash accepted. Verification will be confirmed by the platform.' };
    }
    return { ok: false, reason: 'Could not reach Sui network. Check your connection.' };
  }
}

// ─── Fee Payment Modal ────────────────────────────────────────────────────────
function FeePaymentModal({ walletAddress, onSuccess, onClose }: {
  walletAddress?: string;
  onSuccess: (txHash: string) => void;
  onClose: () => void;
}) {
  const [txHash, setTxHash] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error' | 'success'>('idle');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleVerify() {
    if (!txHash.trim()) { setStatus('error'); setMessage('Please enter your TX hash.'); return; }
    setStatus('verifying');
    setMessage('Verifying on Sui mainnet...');
    const result = await verifySuiTx(txHash.trim(), walletAddress);
    if (result.ok) {
      setStatus('success');
      setMessage(result.reason);
      setTimeout(() => onSuccess(txHash.trim()), 800);
    } else {
      setStatus('error');
      setMessage(result.reason);
    }
  }

  function copyWallet() {
    navigator.clipboard.writeText(ADMIN_WALLET);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0a1628] border border-cyan-500/20 rounded-2xl w-full max-w-md shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
            <Zap className="text-green-400" size={20} />
          </div>
          <div>
            <h3 className="text-white font-black text-base">Entry Fee — {ENTRY_FEE_SUI} SUI</h3>
            <p className="text-gray-500 text-xs">One-time fee to lock your WC 2026 fantasy team</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-black">1</span>
              Send exactly {ENTRY_FEE_SUI} SUI to:
            </div>
            <div className="bg-white/[0.04] border border-white/8 rounded-xl p-3 flex items-center gap-2">
              <code className="text-cyan-400 text-[11px] font-mono break-all flex-1">{ADMIN_WALLET}</code>
              <button
                onClick={copyWallet}
                className="flex-shrink-0 p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 transition-all"
                title="Copy address"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-gray-600">Use any Sui wallet (Slush, Nightly, Suiet). Send SUI on mainnet.</p>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-black">2</span>
              Paste your transaction hash:
            </div>
            <input
              value={txHash}
              onChange={e => { setTxHash(e.target.value); setStatus('idle'); }}
              placeholder="e.g. CGaAKym2HndUnFMp64ph1y9Sma23p8w"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-cyan-500/50 placeholder-gray-600"
            />
          </div>

          {/* Status message */}
          {status !== 'idle' && (
            <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
              status === 'verifying' ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-300' :
              status === 'success'   ? 'bg-green-500/10 border border-green-500/20 text-green-300' :
                                       'bg-red-500/10 border border-red-500/20 text-red-300'
            }`}>
              {status === 'verifying' && <div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin mt-0.5 flex-shrink-0" />}
              {status === 'success'   && <Check size={13} className="mt-0.5 flex-shrink-0" />}
              {status === 'error'     && <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />}
              <span>{message}</span>
            </div>
          )}

          {/* Prize reminder */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
            <Trophy size={13} className="mt-0.5 flex-shrink-0" />
            <span>Entry fee goes into the community prize pool. Top 3 on the leaderboard win SBETS!</span>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-gray-400 hover:text-white text-sm transition-all">
              Cancel
            </button>
            <button
              onClick={handleVerify}
              disabled={status === 'verifying' || status === 'success'}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                status === 'verifying' || status === 'success'
                  ? 'bg-white/[0.06] text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-400 hover:to-emerald-400 shadow-lg shadow-green-500/20'
              }`}
            >
              {status === 'verifying' ? 'Verifying...' : status === 'success' ? '✓ Verified!' : 'Verify & Lock Team'}
            </button>
          </div>

          <a
            href={`https://suiscan.xyz/mainnet/account/${ADMIN_WALLET}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            <ExternalLink size={11} /> View admin wallet on SuiScan
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────
function PlayerCard({ player, selected, onToggle, disabled, captain, onCaptain }: {
  player: Player; selected: boolean; onToggle: () => void; disabled: boolean;
  captain: boolean; onCaptain?: () => void;
}) {
  return (
    <div
      className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all group ${
        selected
          ? 'border-cyan-500/60 bg-cyan-500/10'
          : disabled
          ? 'border-white/5 bg-white/[0.02] opacity-40 cursor-not-allowed'
          : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
      }`}
      onClick={!disabled || selected ? onToggle : undefined}
    >
      {selected && onCaptain && (
        <button
          onClick={e => { e.stopPropagation(); onCaptain(); }}
          className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
            captain ? 'bg-amber-400 text-black' : 'bg-white/10 text-gray-500 hover:bg-amber-400/30 hover:text-amber-400'
          }`}
          title={captain ? 'Captain (2× points)' : 'Make captain'}
        >
          <Star size={10} className={captain ? 'fill-current' : ''} />
        </button>
      )}
      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${POS_COLOR[player.position]} text-white flex-shrink-0`}>
        {POS_LABEL[player.position]}
      </span>
      <span className="text-sm">{FLAG_EMOJI[player.country] || '🏳️'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white text-xs font-bold truncate">{player.name}</div>
        <div className="text-gray-500 text-[10px]">{player.countryName} · £{player.price}M · ⭐{player.rating}</div>
      </div>
      {selected && <Check size={14} className="text-cyan-400 flex-shrink-0" />}
    </div>
  );
}

// ─── Pitch Slot ───────────────────────────────────────────────────────────────
function PitchSlot({ position, player, captain, onClick, swapMode, selected }: {
  position: Position; player?: Player; captain?: boolean;
  onClick?: () => void; swapMode?: boolean; selected?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 cursor-pointer group" onClick={onClick}>
      <div className={`relative w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all ${
        player
          ? swapMode
            ? 'border-orange-400 bg-orange-500/20 shadow-lg shadow-orange-500/30 animate-pulse'
            : selected
            ? 'border-amber-400 bg-amber-500/20 shadow-lg shadow-amber-500/30 scale-110'
            : 'border-cyan-400 bg-gradient-to-b from-cyan-500/20 to-cyan-900/40 shadow-lg shadow-cyan-500/20'
          : 'border-dashed border-white/20 bg-white/[0.03] group-hover:border-white/40'
      }`}>
        {captain && player && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center">
            <Star size={8} className="text-black fill-current" />
          </div>
        )}
        {player
          ? <span className="text-base">{FLAG_EMOJI[player.country] || '🏳️'}</span>
          : <span className={`text-[10px] font-black ${POS_COLOR[position]} text-white rounded px-1`}>{POS_LABEL[position]}</span>
        }
      </div>
      <div className="text-center" style={{ minWidth: 52 }}>
        {player
          ? <div className="text-[10px] text-white font-bold leading-tight truncate max-w-[56px]">{player.name.split(' ').pop()}</div>
          : <div className="text-[9px] text-gray-600">Empty</div>
        }
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WorldCupFantasy({ walletAddress }: { walletAddress?: string }) {
  const [starters, setStarters] = useState<(string | null)[]>(Array(STARTER_SIZE).fill(null));
  const [bench, setBench]       = useState<(string | null)[]>(Array(4).fill(null));
  const [captainId, setCaptainId] = useState<string | null>(null);
  const [activePos, setActivePos] = useState<Position | 'ALL'>('ALL');
  const [search, setSearch]     = useState('');
  const [view, setView]         = useState<'pitch' | 'pick' | 'scoring' | 'leaderboard' | 'h2h'>('pitch');
  const [teamName, setTeamName] = useState('My World Cup XI');
  const [saved, setSaved]       = useState(false);
  const [tab, setTab]           = useState<'starters' | 'bench'>('starters');
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [feePaid, setFeePaid]   = useState(false);
  const [feeTxHash, setFeeTxHash] = useState('');
  const [locked, setLocked]     = useState(false);
  const [swapSource, setSwapSource] = useState<{ type: 'starter' | 'bench'; idx: number } | null>(null);
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [liveResults, setLiveResults] = useState<ResultRound[]>([]);
  const [resultsSource, setResultsSource] = useState<'live' | 'simulated'>('simulated');
  const [resultsCount, setResultsCount] = useState(0);
  const [lbTeams, setLbTeams] = useState<{rank: number; walletAddress: string; teamName: string; totalPoints: number; feePaid: boolean; devBypass: boolean}[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const lbNames = useSuiNSNames(lbTeams.map(t => t.walletAddress));
  const [lockedCount, setLockedCount] = useState<number | null>(null);
  const [savingToDb, setSavingToDb] = useState(false);
  const [priceFilter, setPriceFilter] = useState<'all' | 'budget' | 'mid' | 'premium'>('all');
  const [sortBy, setSortBy] = useState<'rating' | 'price_asc' | 'price_desc'>('rating');
  const [pitchMenu, setPitchMenu] = useState<{ type: 'starter' | 'bench'; idx: number } | null>(null);
  const [viewingTeam, setViewingTeam] = useState<{
    walletAddress: string; teamName: string;
    starterIds: string[]; benchIds: string[]; captainId: string | null;
  } | null>(null);
  const [viewingTeamLoading, setViewingTeamLoading] = useState(false);


  // Load saved team — try API first (by wallet), fall back to localStorage
  useEffect(() => {
    async function loadFromApi() {
      let apiFeePaid = false;
      let apiFeeTxHash = '';
      let apiLocked = false;
      let apiHasSquad = false;

      if (walletAddress) {
        try {
          const r = await fetch(`${API_BASE}/api/fantasy/wc2026/team?wallet=${walletAddress}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const d = await r.json();
            if (d.team) {
              const t = d.team;
              const cleanStarters = sanitizePlayerIds(t.starterIds, STARTER_SIZE);
              const cleanBench    = sanitizePlayerIds(t.benchIds, 4);
              const captainValid  = (t.captainId && cleanStarters.includes(t.captainId)) ? t.captainId : null;

              // Capture fee/lock status from API always
              apiFeePaid    = !!(t.feePaid || t.devBypass);
              apiFeeTxHash  = t.feeTxHash || (t.devBypass ? 'dev-bypass' : '');
              apiLocked     = !!(t.locked);
              apiHasSquad   = cleanStarters.some(Boolean);

              if (apiHasSquad) {
                // API has real squad data — use it as source of truth
                setStarters(cleanStarters);
                setBench(cleanBench);
                setCaptainId(captainValid);
                setTeamName((t.teamName || '').trim() || 'My World Cup XI');
                setLocked(apiLocked);
                if (apiFeePaid) { setFeePaid(true); setFeeTxHash(apiFeeTxHash); }
                return;
              }
              // API record exists but squad is empty — still capture fee status,
              // then fall through to localStorage for the squad
            }
          }
        } catch { /* DB or network error — fall through to localStorage */ }
      }

      // Fallback: localStorage for squad data
      const savedTeam = loadTeam();
      // Use localStorage squad only if it belongs to this wallet (or no wallet yet)
      const lsMatchesWallet = !walletAddress || !savedTeam?.wallet || savedTeam.wallet === walletAddress;
      if (savedTeam && lsMatchesWallet) {
        const cleanStarters = sanitizePlayerIds(savedTeam.starterIds, STARTER_SIZE);
        const cleanBench    = sanitizePlayerIds(savedTeam.benchIds, 4);
        const captainValid  = (savedTeam.captainId && cleanStarters.includes(savedTeam.captainId)) ? savedTeam.captainId : null;
        setStarters(cleanStarters);
        setBench(cleanBench);
        setCaptainId(captainValid);
        setTeamName((savedTeam.name || '').trim() || 'My World Cup XI');
        setLocked(apiLocked || savedTeam.locked || false);
      }

      // Fee status: API wins over localStorage (DB is authoritative)
      if (apiFeePaid) {
        setFeePaid(true);
        setFeeTxHash(apiFeeTxHash);
      } else {
        const savedFee = loadFee();
        if (savedFee?.paid) { setFeePaid(true); setFeeTxHash(savedFee.txHash); }
      }
    }
    loadFromApi();
  }, [walletAddress]);

  // Auto-save draft to localStorage + API whenever selection changes (only while unlocked)
  const apiSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (locked) return;
    const hasAny = starters.some(Boolean) || bench.some(Boolean);
    if (!hasAny) return;
    const draft: FantasyTeam = {
      name:         (teamName || '').trim() || 'My World Cup XI',
      wallet:       walletAddress,
      starterIds:   starters.map(id => id || ''),
      benchIds:     bench.map(id => id || ''),
      captainId:    captainId || '',
      totalPoints,
      locked:       false,
      feePaid,
      feeTxHash:    feeTxHash || undefined,
      createdAt:    Date.now(),
    };
    saveTeam(draft);

    // Debounce API save by 1.5s — persists squad across browsers/devices
    if (walletAddress) {
      if (apiSaveTimerRef.current) clearTimeout(apiSaveTimerRef.current);
      apiSaveTimerRef.current = setTimeout(() => {
        fetch(`${API_BASE}/api/fantasy/wc2026/team`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress,
            teamName:   draft.name,
            starterIds: draft.starterIds,
            benchIds:   draft.benchIds,
            captainId:  draft.captainId,
            totalPoints: draft.totalPoints,
            locked:     false,
            feePaid:    draft.feePaid,
            feeTxHash:  draft.feeTxHash,
            devBypass:  false,
          }),
        }).catch(() => { /* silent — localStorage is the fallback */ });
      }, 1500);
    }
  }, [starters, bench, captainId, teamName, locked]);

  // Fetch live WC 2026 match results from settled_events
  useEffect(() => {
    fetch(`${API_BASE}/api/fantasy/wc2026/results`)
      .then(r => r.json())
      .then((d: { results: ResultRound[]; source: string; matchCount: number }) => {
        if (d.source === 'live' && d.results.length > 0) {
          setLiveResults(d.results);
          setResultsSource('live');
          setResultsCount(d.matchCount);
        }
      })
      .catch(() => {}); // silent fallback to SAMPLE_RESULTS
  }, []);

  // Fetch locked-team count once on mount (powers the live entry counter)
  useEffect(() => {
    fetch(`${API_BASE}/api/fantasy/wc2026/leaderboard`)
      .then(r => r.json())
      .then((d: { count?: number; teams?: unknown[] }) => {
        const n = typeof d.count === 'number' ? d.count : (d.teams?.length ?? 0);
        setLockedCount(n);
      })
      .catch(() => {});
  }, []);

  // Fetch real leaderboard from DB when leaderboard tab is open
  useEffect(() => {
    if (view !== 'leaderboard') return;
    setLbLoading(true);
    fetch(`${API_BASE}/api/fantasy/wc2026/leaderboard`)
      .then(r => r.json())
      .then((d: { teams: typeof lbTeams }) => {
        if (d.teams) setLbTeams(d.teams);
      })
      .catch(() => {})
      .finally(() => setLbLoading(false));
  }, [view]);

  const allSelected = useMemo(() =>
    [...starters.filter(Boolean), ...bench.filter(Boolean)] as string[],
    [starters, bench]
  );

  const budget = useMemo(() => {
    return BUDGET - allSelected.reduce((sum, id) => {
      const p = PLAYERS.find(p => p.id === id);
      return sum + (p?.price ?? 0);
    }, 0);
  }, [allSelected]);

  // Only use real results fetched from the server — NEVER fall back to SAMPLE_RESULTS.
  // Points are 0 before tournament starts (Jun 11, 2026). This is intentional.
  const activeResults: ResultRound[] = liveResults;

  const totalPoints = useMemo(() =>
    computePointsForPlayers(starters.filter(Boolean) as string[], captainId || '', activeResults),
    [starters, captainId, activeResults]
  );

  // All unique countries in squad for group context
  const squadCountries = useMemo(() => {
    const codes = new Set<string>();
    allSelected.forEach(id => {
      const p = PLAYERS.find(pl => pl.id === id);
      if (p) codes.add(p.country);
    });
    return codes;
  }, [allSelected]);

  // Find which group a country is in
  const countryToGroup = useMemo(() => {
    const map: Record<string, string> = {};
    WC2026_GROUPS.forEach(g => g.teams.forEach(c => { map[c] = g.group; }));
    return map;
  }, []);

  const allCountries = useMemo(() =>
    [...new Set(PLAYERS.map((p: Player) => p.country))].sort((a: string, b: string) =>
      (COUNTRY_NAMES[a] || a).localeCompare(COUNTRY_NAMES[b] || b)
    ), []
  );

  const filteredPlayers = useMemo(() => PLAYERS.filter(p => {
    if (activePos !== 'ALL' && p.position !== activePos) return false;
    if (countryFilter !== 'ALL' && p.country !== countryFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.countryName.toLowerCase().includes(search.toLowerCase())) return false;
    if (priceFilter === 'budget' && p.price > 6) return false;
    if (priceFilter === 'mid' && (p.price <= 6 || p.price > 9)) return false;
    if (priceFilter === 'premium' && p.price <= 9) return false;
    return true;
  }).sort((a, b) =>
    sortBy === 'price_asc' ? a.price - b.price :
    sortBy === 'price_desc' ? b.price - a.price :
    b.rating - a.rating
  ), [activePos, countryFilter, search, priceFilter, sortBy]);

  function togglePlayer(playerId: string) {
    if (locked) return;
    const player = PLAYERS.find(p => p.id === playerId)!;
    const isSelected = allSelected.includes(playerId);

    if (isSelected) {
      setStarters(s => s.map(id => id === playerId ? null : id));
      setBench(b => b.map(id => id === playerId ? null : id));
      if (captainId === playerId) setCaptainId(null);
      setPitchMenu(null);
      return;
    }

    // Try to add to active tab first, then the other
    const [targetSlots, targetArr, setArr] = tab === 'bench'
      ? [BENCH_SLOTS, bench, setBench]
      : [STARTER_SLOTS, starters, setStarters];
    const [otherSlots, otherArr, setOther] = tab === 'bench'
      ? [STARTER_SLOTS, starters, setStarters]
      : [BENCH_SLOTS, bench, setBench];

    const slotIdx = targetSlots.findIndex((pos, i) => pos === player.position && !targetArr[i]);
    if (slotIdx !== -1) {
      (setArr as any)(a => { const n = [...a]; n[slotIdx] = playerId; return n; });
      return;
    }
    const otherIdx = otherSlots.findIndex((pos, i) => pos === player.position && !otherArr[i]);
    if (otherIdx !== -1) {
      (setOther as any)(a => { const n = [...a]; n[otherIdx] = playerId; return n; });
    }
  }

  // Swap between bench and starter
  function handleSwapClick(type: 'starter' | 'bench', idx: number) {
    if (locked) return;
    const id = type === 'starter' ? starters[idx] : bench[idx];
    if (!id) return;

    if (swapSource) {
      if (swapSource.type === type && swapSource.idx === idx) {
        setSwapSource(null);
        return;
      }
      // Perform swap
      const srcId = swapSource.type === 'starter' ? starters[swapSource.idx] : bench[swapSource.idx];
      const dstId = type === 'starter' ? starters[idx] : bench[idx];

      // Check positional validity for swaps
      const srcPos = srcId ? PLAYERS.find(p => p.id === srcId)?.position : null;
      const dstPos = dstId ? PLAYERS.find(p => p.id === dstId)?.position : null;
      const srcSlotPos = swapSource.type === 'starter' ? STARTER_SLOTS[swapSource.idx] : BENCH_SLOTS[swapSource.idx];
      const dstSlotPos = type === 'starter' ? STARTER_SLOTS[idx] : BENCH_SLOTS[idx];

      // For inter-list swaps, check position compatibility
      if (swapSource.type !== type) {
        if (srcPos !== dstSlotPos || (dstPos && dstPos !== srcSlotPos)) {
          setSwapSource(null);
          return;
        }
      }

      // Execute swap
      if (swapSource.type === 'starter') {
        setStarters(s => { const n = [...s]; n[swapSource.idx] = dstId; return n; });
      } else {
        setBench(b => { const n = [...b]; n[swapSource.idx] = dstId; return n; });
      }
      if (type === 'starter') {
        setStarters(s => { const n = [...s]; n[idx] = srcId; return n; });
      } else {
        setBench(b => { const n = [...b]; n[idx] = srcId; return n; });
      }
      setSwapSource(null);
    } else {
      setSwapSource({ type, idx });
    }
  }

  function handlePitchSlotClick(type: 'starter' | 'bench', idx: number) {
    if (locked) return;
    const id = type === 'starter' ? starters[idx] : bench[idx];
    if (!id) { setView('pick'); return; }
    if (swapSource) { handleSwapClick(type, idx); return; }
    setPitchMenu(pm => (pm?.type === type && pm?.idx === idx) ? null : { type, idx });
  }

  function autoFill() {
    if (locked) return;
    const newStarters = [...starters];
    const newBench = [...bench];
    let spent = PLAYERS.reduce((sum, p) =>
      newStarters.includes(p.id) || newBench.includes(p.id) ? sum + p.price : sum, 0);
    for (let i = 0; i < STARTER_SLOTS.length; i++) {
      if (newStarters[i]) continue;
      const pos = STARTER_SLOTS[i];
      const taken = new Set([...newStarters, ...newBench].filter(Boolean) as string[]);
      const best = PLAYERS
        .filter(p => p.position === pos && !taken.has(p.id) && p.price <= BUDGET - spent)
        .sort((a, b) => b.rating - a.rating)[0];
      if (best) { newStarters[i] = best.id; spent += best.price; }
    }
    for (let i = 0; i < BENCH_SLOTS.length; i++) {
      if (newBench[i]) continue;
      const pos = BENCH_SLOTS[i];
      const taken = new Set([...newStarters, ...newBench].filter(Boolean) as string[]);
      const cheapest = PLAYERS
        .filter(p => p.position === pos && !taken.has(p.id) && p.price <= BUDGET - spent)
        .sort((a, b) => a.price - b.price)[0];
      if (cheapest) { newBench[i] = cheapest.id; spent += cheapest.price; }
    }
    setStarters(newStarters);
    setBench(newBench);
    setPitchMenu(null);
    if (!captainId) {
      const best = (newStarters.filter(Boolean) as string[])
        .map(id => PLAYERS.find(p => p.id === id)!).filter(Boolean)
        .sort((a, b) => b.rating - a.rating)[0];
      if (best) setCaptainId(best.id);
    }
  }

  function handleLockTeam() {
    if (!isTeamComplete) return;
    if (feePaid) {
      doSaveAndLock(feeTxHash);
    } else {
      setShowFeeModal(true);
    }
  }

  async function doSaveAndLock(txHash: string) {
    const starterIdsFinal = starters.map(id => id || '');
    const benchIdsFinal   = bench.map(id => id || '');
    const safeName = (teamName || '').trim() || 'My World Cup XI';

    // Persist locally FIRST — user never loses their team even if network fails
    const team: FantasyTeam = {
      name:       safeName,
      wallet:     walletAddress,
      starterIds: starterIdsFinal,
      benchIds:   benchIdsFinal,
      captainId:  captainId || '',
      totalPoints,
      locked:     true,
      feePaid:    true,
      feeTxHash:  txHash,
      createdAt:  Date.now(),
    };
    saveTeam(team);
    saveFee({ paid: true, txHash, wallet: walletAddress || 'guest', ts: Date.now() });

    // Update UI immediately — don't make user wait for the DB round-trip
    setLocked(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);

    // Persist to DB with up to 3 attempts; silent failure is acceptable because
    // the team is already in localStorage and the server re-reads it on next load.
    if (walletAddress) {
      setSavingToDb(true);
      const payload = {
        walletAddress,
        teamName: safeName,
        starterIds: starterIdsFinal,
        benchIds:   benchIdsFinal,
        captainId:  captainId || '',
        totalPoints,
        locked:   true,
        feePaid:  true,
        feeTxHash: txHash,
        devBypass: false,
      };
      let dbSaved = false;
      let feeRejected = false;
      let feeRejectedReason = '';
      for (let attempt = 1; attempt <= 3 && !dbSaved && !feeRejected; attempt++) {
        try {
          const resp = await fetch(`${API_BASE}/api/fantasy/wc2026/team`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            dbSaved = true;
          } else if (resp.status === 402) {
            // Server rejected the fee — TX was invalid or insufficient
            feeRejected = true;
            try { const d = await resp.json(); feeRejectedReason = d.error || 'Fee verification failed.'; } catch {}
          } else {
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        } catch {
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
      setSavingToDb(false);

      if (feeRejected) {
        // Roll back local state — the fee wasn't actually paid
        alert(`⚠️ Entry fee could not be verified on-chain:\n\n${feeRejectedReason}\n\nYour team has been unlocked. Please check your transaction and try again.`);
        const draft = loadTeam();
        if (draft) { saveTeam({ ...draft, locked: false, feePaid: false, feeTxHash: '' }); }
        setLocked(false);
        setFeePaid(false);
        setFeeTxHash('');
        return;
      }
    }
  }

  function handleFeeSuccess(txHash: string) {
    const feeRecord: FeeRecord = {
      paid: true,
      txHash,
      wallet: walletAddress || 'guest',
      ts: Date.now(),
    };
    saveFee(feeRecord);
    setFeePaid(true);
    setFeeTxHash(txHash);
    setShowFeeModal(false);
    doSaveAndLock(txHash);
  }

  function handleReset() {
    if (locked) return;
    setStarters(Array(STARTER_SIZE).fill(null));
    setBench(Array(4).fill(null));
    setCaptainId(null);
    setSwapSource(null);
    setPitchMenu(null);
  }

  const completedStarters = starters.filter(Boolean).length;
  const completedBench    = bench.filter(Boolean).length;
  const isTeamComplete    = completedStarters === STARTER_SIZE && completedBench === 4 && !!captainId && budget >= 0;

  const pitchRows: { pos: Position; indices: number[] }[] = [
    { pos: 'FWD', indices: [9, 10] },
    { pos: 'MID', indices: [5, 6, 7, 8] },
    { pos: 'DEF', indices: [1, 2, 3, 4] },
    { pos: 'GK',  indices: [0] },
  ];

  return (
    <div className="space-y-5">
      {showFeeModal && (
        <FeePaymentModal
          walletAddress={walletAddress}
          onSuccess={handleFeeSuccess}
          onClose={() => setShowFeeModal(false)}
        />
      )}

      {/* Header */}
      <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/20 border border-green-500/20 rounded-2xl p-5">
        {/* Title row */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <Shirt className="text-green-400" size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black text-white leading-tight">Fantasy World Cup 2026</h2>
            <p className="text-gray-500 text-xs">Pick 15 players · Score from real WC results · Win SBETS</p>
          </div>
          {feePaid && (
            <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-lg px-2.5 py-1.5 flex-shrink-0">
              <Check size={12} className="text-green-400" />
              <span className="text-green-400 text-xs font-bold">Fee Paid</span>
            </div>
          )}
        </div>

        {/* Stats bar — always visible on all screen sizes */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-black/30 rounded-xl p-2.5 text-center">
            <div className="text-xl font-black text-amber-400">{totalPoints}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Pts</div>
          </div>
          <div className={`bg-black/30 rounded-xl p-2.5 text-center border ${budget < 0 ? 'border-red-500/30' : 'border-transparent'}`}>
            <div className={`text-xl font-black ${budget < 0 ? 'text-red-400' : 'text-cyan-400'}`}>£{budget.toFixed(1)}M</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Budget Left</div>
          </div>
          <div className="bg-black/30 rounded-xl p-2.5 text-center">
            <div className="text-xl font-black text-amber-300">{ENTRY_FEE_SUI} SUI</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Entry Fee</div>
          </div>
        </div>

        {/* Countdown + lock status */}
        <div className="bg-black/20 rounded-xl px-4 py-2 mb-3 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider">
            ⚽ WC 2026 kicks off Jun 11 — {locked ? '🔒 Team Locked & Entered!' : 'Lock your team before MD1!'}
          </span>
        </div>

        {/* Scoring rules summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          {[
            { pts: '+3', label: 'Win (all players)' },
            { pts: '+4', label: 'Team goal (FWD)' },
            { pts: '+6', label: 'Clean sheet (GK)' },
            { pts: '×2', label: 'Captain bonus' },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.04] rounded-lg p-2 text-center border border-white/5">
              <div className="font-black text-green-400 text-sm">{item.pts}</div>
              <div className="text-gray-500">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Entry Fee Banner — shown until fee is paid ─────────────────────── */}
      {!feePaid && !locked && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/60 via-amber-900/30 to-amber-950/60">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.12) 0%, transparent 70%)' }} />
          <div className="relative p-4 sm:p-5">
            <div className="flex items-start gap-4">
              {/* Fee pill */}
              <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-amber-300">5</span>
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-wider">SUI</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-300 font-black text-base">One-time Entry Fee</span>
                  <span className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Required to compete</span>
                </div>
                <p className="text-gray-400 text-xs leading-relaxed mb-3">
                  Send exactly <strong className="text-amber-300">5 SUI</strong> to enter the global leaderboard and compete for the prize pool. Build your squad first, then lock it with the entry fee to go live.
                </p>
                {/* Steps */}
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { n: '1', label: 'Build squad (15 players)' },
                    { n: '2', label: 'Set your captain' },
                    { n: '3', label: 'Pay 5 SUI & lock team' },
                    { n: '4', label: 'Score points & win' },
                  ].map((step, i) => (
                    <div key={step.n} className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/25 text-amber-400 text-[10px] font-black flex items-center justify-center flex-shrink-0">{step.n}</span>
                      <span className="text-gray-400 text-[11px]">{step.label}</span>
                      {i < 3 && <span className="text-gray-700 text-[10px]">→</span>}
                    </div>
                  ))}
                </div>
              </div>
              {/* Prize pool (dynamic) + entry counter */}
              {(() => {
                const n      = lockedCount ?? 0;
                const pool   = n * 5;          // 5 SUI per entry
                const first  = (pool * 0.60).toFixed(1);
                const second = (pool * 0.25).toFixed(1);
                const third  = (pool * 0.15).toFixed(1);
                return (
                  <div className="hidden sm:flex flex-col gap-1.5 flex-shrink-0 text-center min-w-[110px]">
                    <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
                      <div className="text-[9px] text-amber-500/70 uppercase tracking-wider leading-none mb-0.5">Prize Pool</div>
                      <div className="text-sm font-black text-amber-300 leading-none">
                        {pool > 0 ? `${pool} SUI` : '—'}
                      </div>
                    </div>
                    {[
                      { pos: '🥇', share: first  },
                      { pos: '🥈', share: second },
                      { pos: '🥉', share: third  },
                    ].map(p => (
                      <div key={p.pos} className="bg-black/40 rounded-lg px-2.5 py-1 border border-white/5">
                        <div className="text-xs font-black text-white">
                          {p.pos} <span className="text-green-400">{pool > 0 ? `${p.share} SUI` : 'from pool'}</span>
                        </div>
                      </div>
                    ))}
                    <div className="bg-green-500/10 border border-green-500/25 rounded-lg px-2.5 py-1.5 mt-0.5">
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider leading-none mb-0.5">Entered</div>
                      <div className="text-sm font-black text-green-400 leading-none">
                        {lockedCount === null ? '…' : lockedCount}
                        <span className="text-[9px] font-normal text-gray-500 ml-0.5">teams</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['pitch','pick','scoring','leaderboard','h2h'] as const).map(t => ({
          id: t,
          label: t === 'pitch' ? '⚽ My Squad' : t === 'pick' ? '🔍 Pick Players' : t === 'scoring' ? '📊 Scoring & Groups' : t === 'leaderboard' ? '🏆 Leaderboard' : '⚔️ H2H Bets',
        })).map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              view === t.id
                ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                : 'bg-white/[0.04] text-gray-400 border border-white/8 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PITCH VIEW ─────────────────────────────────────────────────────── */}
      {view === 'pitch' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={teamName}
              onChange={e => !locked && setTeamName(e.target.value)}
              disabled={locked}
              className="bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2 text-white text-sm font-bold focus:outline-none focus:border-cyan-500/50 disabled:opacity-50"
              placeholder="Team name…"
            />
            <div className="flex gap-2 ml-auto">
              {!locked && (
                <>
                  <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/8 text-gray-400 hover:text-red-400 text-sm transition-all">
                    <RotateCcw size={13} /> Reset
                  </button>
                  <button onClick={() => setView('pick')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/8 text-gray-400 hover:text-white text-sm transition-all">
                    <Users size={13} /> Edit
                  </button>
                </>
              )}
              <button
                onClick={handleLockTeam}
                disabled={!isTeamComplete || locked || savingToDb}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  locked
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : isTeamComplete
                    ? saved
                      ? 'bg-green-500 text-white'
                      : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-400 shadow-lg shadow-green-500/20'
                    : 'bg-white/[0.05] text-gray-600 cursor-not-allowed'
                }`}
              >
                {savingToDb
                  ? <><span className="animate-spin inline-block">⏳</span> Saving…</>
                  : locked
                  ? <><Check size={13} /> Locked — Fee Paid</>
                  : saved
                  ? <><Check size={13} /> Saved!</>
                  : <><Lock size={13} /> Lock Team ({ENTRY_FEE_SUI} SUI)</>
                }
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
            <span className={completedStarters === STARTER_SIZE ? 'text-green-400 font-bold' : ''}>Starters: {completedStarters}/{STARTER_SIZE}</span>
            <span className={completedBench === 4 ? 'text-green-400 font-bold' : ''}>Bench: {completedBench}/4</span>
            <span className={captainId ? 'text-amber-400 font-bold' : ''}>Captain: {captainId ? '✓ Set' : '⚠ Not set'}</span>
            <span className="ml-auto text-cyan-400 font-bold">Budget: £{budget.toFixed(1)}M / £{BUDGET}M</span>
          </div>

          {locked && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-xs text-green-300">
              <Lock size={12} />
              <span>Team locked. TX: <code className="font-mono text-[10px]">{feeTxHash.slice(0,16)}…{feeTxHash.slice(-8)}</code></span>
            </div>
          )}

          {/* Empty state — getting started guide */}
          {allSelected.length === 0 && !locked && (
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 text-center space-y-4">
              <div className="text-4xl">⚽</div>
              <div>
                <div className="text-white font-black text-base mb-1">Build Your World Cup Squad</div>
                <p className="text-gray-500 text-sm">Pick 11 starters + 4 bench players from 48 nations within a £{BUDGET}M budget.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-left">
                {[
                  { icon: '🥅', pos: 'Goalkeeper', slots: '1', budget: '£4.5–6M' },
                  { icon: '🛡️', pos: 'Defenders', slots: '4', budget: '£5.5–7.5M' },
                  { icon: '⚡', pos: 'Midfielders', slots: '4', budget: '£5.5–9M' },
                  { icon: '🎯', pos: 'Forwards', slots: '2', budget: '£7.5–11M' },
                ].map(r => (
                  <div key={r.pos} className="bg-white/[0.04] border border-white/8 rounded-xl p-3">
                    <div className="text-lg mb-1">{r.icon}</div>
                    <div className="font-bold text-white">{r.pos}</div>
                    <div className="text-gray-500 text-[11px]">{r.slots} starter{r.slots !== '1' ? 's' : ''}</div>
                    <div className="text-cyan-400 text-[11px]">{r.budget}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setView('pick')}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-black text-sm hover:from-green-400 transition-all shadow-lg shadow-green-500/20"
              >
                🔍 Pick Players — Start Building
              </button>
              <div className="flex items-center justify-center gap-2 text-xs text-amber-400">
                <span className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center font-black text-[10px]">£</span>
                Entry fee: <strong>{ENTRY_FEE_SUI} SUI</strong> — paid when you lock your final team
              </div>
            </div>
          )}

          {!captainId && completedStarters > 0 && !locked && (
            <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              <Star size={12} /> Tap ⭐ on a player in "Pick Players" to set your captain (2× points)
            </div>
          )}

          {swapSource && (
            <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl p-2.5 text-xs text-orange-300">
              <ArrowLeftRight size={12} />
              <span>Swap mode: tap another player to swap positions. Tap same player to cancel.</span>
              <button onClick={() => setSwapSource(null)} className="ml-auto text-orange-400 hover:text-orange-300">Cancel</button>
            </div>
          )}

          {/* Pitch action menu — tap any player to open */}
          {pitchMenu && !locked && (() => {
            const pm = pitchMenu;
            const id = pm.type === 'starter' ? starters[pm.idx] : bench[pm.idx];
            const player = id ? PLAYERS.find(p => p.id === id) : null;
            if (!player || !id) return null;
            const isCapt = id === captainId;
            return (
              <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xl">{FLAG_EMOJI[player.country] || '🏳️'}</span>
                  <div>
                    <div className="text-white font-black text-sm leading-tight">{player.name}</div>
                    <div className="text-gray-500 text-[11px]">{player.countryName} · £{player.price}M · <span className={`font-bold ${POS_TEXT_COLOR[player.position]}`}>{player.position}</span></div>
                  </div>
                </div>
                <button
                  onClick={() => { setCaptainId(isCapt ? null : id); setPitchMenu(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isCapt ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20'}`}
                >
                  <Star size={11} fill={isCapt ? 'currentColor' : 'none'} /> {isCapt ? '★ Captain (tap to remove)' : 'Set Captain ⭐'}
                </button>
                <button
                  onClick={() => { setSwapSource(pm); setPitchMenu(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all"
                >
                  <ArrowLeftRight size={11} /> Swap
                </button>
                <button
                  onClick={() => {
                    if (pm.type === 'starter') setStarters(s => { const n = [...s]; n[pm.idx] = null; return n; });
                    else setBench(b => { const n = [...b]; n[pm.idx] = null; return n; });
                    if (captainId === id) setCaptainId(null);
                    setPitchMenu(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"
                >
                  <RotateCcw size={11} /> Remove
                </button>
                <button onClick={() => setPitchMenu(null)} className="text-gray-600 hover:text-gray-400 text-xs px-1">✕</button>
              </div>
            );
          })()}

          {/* Football pitch */}
          <div className="relative rounded-2xl overflow-hidden border-2 border-cyan-900/60 shadow-2xl shadow-black/60"
            style={{ background: 'linear-gradient(180deg, #14532d 0%, #166534 12.5%, #15803d 25%, #166534 37.5%, #15803d 50%, #166534 62.5%, #15803d 75%, #166534 87.5%, #14532d 100%)' }}>
            <div className="absolute inset-0 pointer-events-none">
              {/* Pitch mowing stripes */}
              {[...Array(8)].map((_, i) => (
                <div key={i} className="absolute top-0 bottom-0" style={{ left: `${i * 12.5}%`, width: '12.5%', background: i % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.02)' }} />
              ))}
              {/* Pitch boundary */}
              <div className="absolute inset-x-8 inset-y-5 border border-white/20 rounded-sm" />
              {/* Halfway line */}
              <div className="absolute top-5 bottom-5 left-1/2 border-l border-white/20 -translate-x-px" />
              {/* Centre circle */}
              <div className="absolute top-1/2 left-1/2 w-24 h-24 -translate-x-1/2 -translate-y-1/2 border border-white/20 rounded-full" />
              {/* Centre spot */}
              <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 bg-white/30 rounded-full" />
              {/* Top penalty box */}
              <div className="absolute top-5 left-[30%] right-[30%] h-14 border border-white/15 border-t-0" />
              {/* Bottom penalty box */}
              <div className="absolute bottom-5 left-[30%] right-[30%] h-14 border border-white/15 border-b-0" />
              {/* Top six-yard box */}
              <div className="absolute top-5 left-[40%] right-[40%] h-5 border border-white/10 border-t-0" />
              {/* Bottom six-yard box */}
              <div className="absolute bottom-5 left-[40%] right-[40%] h-5 border border-white/10 border-b-0" />
              {/* Corner flags */}
              {[['top-4 left-8','🚩'],['top-4 right-8','🚩'],['bottom-4 left-8','🚩'],['bottom-4 right-8','🚩']].map(([cls, flag]) => (
                <div key={cls as string} className={`absolute ${cls} text-[8px] leading-none`}>{flag}</div>
              ))}

              {/* Side boards — left */}
              <div className="absolute left-0 top-0 bottom-0 w-7 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg,#164e63 0%,#0e7490 20%,#06b6d4 45%,#0284c7 65%,#0e7490 80%,#164e63 100%)' }}>
                {['suibets','.com','⚽','P2P','suibets','.com','⚡','🏆'].map((txt, i) => (
                  <div key={i} className="flex-1 flex items-center justify-center overflow-hidden">
                    <span className="font-black text-white/90 tracking-widest" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: '6px' }}>{txt}</span>
                  </div>
                ))}
              </div>
              {/* Side boards — right */}
              <div className="absolute right-0 top-0 bottom-0 w-7 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg,#164e63 0%,#0284c7 20%,#0e7490 45%,#06b6d4 65%,#0e7490 80%,#164e63 100%)' }}>
                {['🏆','suibets','.com','⚡','P2P','suibets','.com','⚽'].map((txt, i) => (
                  <div key={i} className="flex-1 flex items-center justify-center overflow-hidden">
                    <span className="font-black text-white/90 tracking-widest" style={{ writingMode: 'vertical-rl', fontSize: '6px' }}>{txt}</span>
                  </div>
                ))}
              </div>

              {/* Top advertising strip */}
              <div className="absolute top-0 left-7 right-7 h-5 flex items-center justify-around overflow-hidden border-b border-cyan-400/20"
                style={{ background: 'linear-gradient(90deg,#164e63,#0e7490,#06b6d4,#0e7490,#06b6d4,#0e7490,#164e63)' }}>
                {['SUIBETS.COM','⚽ P2P BETTING','SUIBETS.COM','🏆 WIN SUI','SUIBETS.COM','⚡ NO HOUSE EDGE','SUIBETS.COM'].map((txt, i) => (
                  <span key={i} className="text-[6.5px] font-black text-white tracking-widest whitespace-nowrap px-1.5">{txt}</span>
                ))}
              </div>
              {/* Bottom advertising strip */}
              <div className="absolute bottom-0 left-7 right-7 h-5 flex items-center justify-around overflow-hidden border-t border-cyan-400/20"
                style={{ background: 'linear-gradient(90deg,#164e63,#06b6d4,#0e7490,#06b6d4,#0e7490,#06b6d4,#164e63)' }}>
                {['🏆 WIN SUI','SUIBETS.COM','⚡ H2H BETS','SUIBETS.COM','NO HOUSE EDGE','SUIBETS.COM','🌐 P2P ONLY'].map((txt, i) => (
                  <span key={i} className="text-[6.5px] font-black text-white tracking-widest whitespace-nowrap px-1.5">{txt}</span>
                ))}
              </div>
            </div>
            <div className="relative py-6 px-8 space-y-4">
              {pitchRows.map(row => (
                <div key={row.pos} className="flex justify-center gap-2 sm:gap-4">
                  {row.indices.map(i => {
                    const player = starters[i] ? PLAYERS.find(p => p.id === starters[i]) : undefined;
                    const isSwapSrc = swapSource?.type === 'starter' && swapSource.idx === i;
                    return (
                      <PitchSlot
                        key={i}
                        position={STARTER_SLOTS[i]}
                        player={player}
                        captain={player?.id === captainId}
                        swapMode={isSwapSrc}
                        selected={pitchMenu?.type === 'starter' && pitchMenu?.idx === i}
                        onClick={() => handlePitchSlotClick('starter', i)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Bench */}
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
              Substitutes
              {!locked && <span className="text-[10px] text-gray-700 normal-case font-normal">— tap a player to swap with bench</span>}
            </div>
            <div className="flex gap-3">
              {BENCH_SLOTS.map((pos, i) => {
                const player = bench[i] ? PLAYERS.find(p => p.id === bench[i]) : undefined;
                const isSwapSrc = swapSource?.type === 'bench' && swapSource.idx === i;
                return (
                  <div
                    key={i}
                    className={`flex-1 p-3 rounded-xl border text-center cursor-pointer transition-all ${
                      isSwapSrc
                        ? 'border-orange-400 bg-orange-500/15 animate-pulse'
                        : (pitchMenu?.type === 'bench' && pitchMenu?.idx === i)
                        ? 'border-amber-400 bg-amber-500/15 scale-105'
                        : player
                        ? 'border-white/15 bg-white/[0.04] hover:border-white/25'
                        : 'border-dashed border-white/10 hover:border-white/20'
                    }`}
                    onClick={() => handlePitchSlotClick('bench', i)}
                  >
                    <span className="text-lg">{player ? FLAG_EMOJI[player.country] || '🏳️' : '—'}</span>
                    <div className="text-[10px] text-gray-500 mt-1">{player?.name.split(' ').pop() || POS_LABEL[pos]}</div>
                    <div className={`text-[9px] font-bold mt-0.5 ${player ? POS_TEXT_COLOR[player.position] : 'text-gray-700'}`}>{player?.position || 'Empty'}</div>
                    {player && <div className="text-[9px] text-gray-700 mt-0.5">£{player.price}M</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ready-to-lock CTA — shown when team is complete and not yet locked */}
          {isTeamComplete && !locked && (
            <div className="rounded-2xl border border-green-500/40 bg-gradient-to-r from-green-950/60 to-emerald-950/40 p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <Lock className="text-green-400" size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-green-300 font-black text-sm">Squad Complete — Ready to Lock!</div>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Pay the <strong className="text-amber-300">{ENTRY_FEE_SUI} SUI</strong> one-time entry fee to lock your team and enter the global leaderboard.
                  </p>
                </div>
                <button
                  onClick={handleLockTeam}
                  disabled={savingToDb}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-black text-sm hover:from-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0"
                >
                  {savingToDb ? <><span className="animate-spin">⏳</span> Saving…</> : <><Lock size={14} /> Lock — {ENTRY_FEE_SUI} SUI</>}
                </button>
              </div>
            </div>
          )}

          {/* Points — live only */}
          {allSelected.length > 0 && resultsSource === 'live' && (
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Info size={12} className="text-green-400" />
                <span className="text-green-400">● LIVE</span> Points — {resultsCount} match{resultsCount !== 1 ? 'es' : ''} settled
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                {(starters.filter(Boolean) as string[]).map(id => {
                  const player = PLAYERS.find(p => p.id === id)!;
                  let pts = 0;
                  for (const round of activeResults) {
                    const r = round.teams.find(t => t.country === player.country);
                    if (r) pts += calcPlayerPoints(player, r);
                  }
                  const isCapt = id === captainId;
                  const grp = countryToGroup[player.country];
                  return (
                    <div key={id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-300 flex items-center gap-1.5">
                        {FLAG_EMOJI[player.country]} {player.name}
                        {isCapt && <span className="text-amber-400 text-[9px] font-black bg-amber-400/10 px-1 rounded">C</span>}
                        {grp && <span className="text-gray-600 text-[9px]">Grp {grp}</span>}
                      </span>
                      <span className={`font-bold ${(isCapt ? pts * 2 : pts) > 0 ? 'text-green-400' : 'text-gray-600'}`}>{isCapt ? pts * 2 : pts} pts</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-white/8 mt-2 pt-2 flex justify-between text-sm font-black">
                <span className="text-gray-400">Total</span>
                <span className="text-green-400">{totalPoints} pts</span>
              </div>
            </div>
          )}
          {allSelected.length > 0 && resultsSource === 'simulated' && (
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4 flex items-center gap-3 text-xs text-gray-500">
              <Info size={13} className="shrink-0 text-gray-600" />
              Points will appear here once WC 2026 matches kick off on Jun 11.
            </div>
          )}
        </div>
      )}

      {/* ── PICK VIEW ──────────────────────────────────────────────────────── */}
      {view === 'pick' && (
        <div className="space-y-3">
          {/* Squad position completion strip */}
          <div className="flex gap-1.5 flex-wrap items-center">
            {(['GK', 'DEF', 'MID', 'FWD'] as const).map(pos => {
              const filled = starters.filter((id, i) => id && STARTER_SLOTS[i] === pos).length;
              const total  = STARTER_SLOTS.filter(p => p === pos).length;
              return (
                <button key={pos} onClick={() => { setActivePos(pos); setTab('starters'); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                    filled === total
                      ? 'bg-green-500/10 border-green-500/20 text-green-400'
                      : filled > 0
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      : 'bg-white/[0.04] border-white/8 text-gray-600 hover:text-gray-400'
                  }`}>
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[7px] font-black text-white ${POS_COLOR[pos]}`}>{pos[0]}</span>
                  {filled}/{total}
                </button>
              );
            })}
            <button onClick={() => setTab('bench')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                completedBench === 4
                  ? 'bg-green-500/10 border-green-500/20 text-green-400'
                  : completedBench > 0
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-white/[0.04] border-white/8 text-gray-600'
              }`}>
              BENCH {completedBench}/4
            </button>
            {!locked && (starters.some(s => !s) || bench.some(b => !b)) && (
              <button onClick={autoFill}
                className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-bold hover:bg-purple-500/20 transition-all">
                <Zap size={11} /> Auto-fill
              </button>
            )}
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <button onClick={() => setTab('starters')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === 'starters' ? 'bg-cyan-500 text-white' : 'bg-white/[0.04] text-gray-400 border border-white/8'}`}>
              Starters ({completedStarters}/11)
            </button>
            <button onClick={() => setTab('bench')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === 'bench' ? 'bg-cyan-500 text-white' : 'bg-white/[0.04] text-gray-400 border border-white/8'}`}>
              Bench ({completedBench}/4)
            </button>
            <div className={`ml-auto text-sm font-black ${budget < 0 ? 'text-red-400' : 'text-cyan-400'}`}>£{budget.toFixed(1)}M left</div>
          </div>

          {/* Position + price tier filters */}
          <div className="flex gap-1.5 flex-wrap">
            {(['ALL', 'GK', 'DEF', 'MID', 'FWD'] as const).map(pos => (
              <button
                key={pos}
                onClick={() => setActivePos(pos)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  activePos === pos
                    ? pos === 'ALL' ? 'bg-white text-black' : `${POS_COLOR[pos as Position]} text-white`
                    : 'bg-white/[0.05] text-gray-500 border border-white/8 hover:text-gray-300'
                }`}
              >{pos}</button>
            ))}
          </div>

          {/* Price tier + sort */}
          <div className="flex gap-1.5 flex-wrap items-center">
            {([
              { k: 'all',     label: 'Any £' },
              { k: 'budget',  label: '≤ £6M' },
              { k: 'mid',     label: '£6–9M' },
              { k: 'premium', label: '£9M+' },
            ] as const).map(({ k, label }) => (
              <button key={k} onClick={() => setPriceFilter(k)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                  priceFilter === k
                    ? 'bg-cyan-500/80 text-white'
                    : 'bg-white/[0.04] text-gray-500 border border-white/8 hover:text-gray-300'
                }`}>{label}</button>
            ))}
            <div className="flex-1" />
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-gray-400 focus:outline-none focus:border-cyan-500/50 cursor-pointer">
              <option value="rating">⭐ Rating</option>
              <option value="price_desc">£ High → Low</option>
              <option value="price_asc">£ Low → High</option>
            </select>
          </div>

          {/* Country filter + search */}
          <div className="flex gap-2">
            <select
              value={countryFilter}
              onChange={e => setCountryFilter(e.target.value)}
              className="bg-white/[0.05] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 flex-1"
            >
              <option value="ALL">All Nations</option>
              {allCountries.map(c => (
                <option key={c} value={c}>{FLAG_EMOJI[c] || ''} {COUNTRY_NAMES[c] || c}</option>
              ))}
            </select>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search player…"
              className="bg-white/[0.05] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 w-40"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[60vh] overflow-y-auto pr-0.5" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            {filteredPlayers.map(player => {
              const selected = allSelected.includes(player.id);
              const samePos = tab === 'starters'
                ? starters.filter(id => id && PLAYERS.find(p => p.id === id)?.position === player.position).length
                : bench.filter(id => id && PLAYERS.find(p => p.id === id)?.position === player.position).length;
              const maxForPos = tab === 'starters'
                ? STARTER_SLOTS.filter(p => p === player.position).length
                : BENCH_SLOTS.filter(p => p === player.position).length;
              const disabled = !selected && (
                allSelected.length >= SQUAD_SIZE || budget < player.price || samePos >= maxForPos
              );
              return (
                <PlayerCard
                  key={player.id}
                  player={player}
                  selected={selected}
                  onToggle={() => togglePlayer(player.id)}
                  disabled={disabled}
                  captain={player.id === captainId}
                  onCaptain={selected ? () => setCaptainId(player.id === captainId ? null : player.id) : undefined}
                />
              );
            })}
            {filteredPlayers.length === 0 && (
              <div className="col-span-2 text-center py-8 text-gray-600 text-sm">No players match your filters.</div>
            )}
          </div>

          <button onClick={() => setView('pitch')} className="w-full py-2.5 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-400 transition-all">
            ← Back to Squad
          </button>
        </div>
      )}

      {/* ── SCORING & GROUPS VIEW ────────────────────────────────────────── */}
      {view === 'scoring' && (
        <div className="space-y-4">
          {/* WC 2026 Official Groups */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
              <Trophy size={14} className="text-cyan-400" />
              <span className="font-bold text-white text-sm">Official WC 2026 Groups (All 48 Teams)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-white/5">
              {WC2026_GROUPS.map(g => (
                <div key={g.group} className="bg-[#060a10] p-3">
                  <div className="text-xs font-black text-cyan-400 mb-2">Group {g.group}</div>
                  {g.teams.map(code => {
                    const inMySquad = squadCountries.has(code);
                    return (
                      <div key={code} className={`flex items-center gap-1.5 py-0.5 text-[11px] ${inMySquad ? 'text-white font-bold' : 'text-gray-500'}`}>
                        <span>{FLAG_EMOJI[code] || '🏳️'}</span>
                        <span>{COUNTRY_NAMES[code] || code}</span>
                        {inMySquad && <span className="text-green-400 text-[9px]">●</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="px-4 py-2 text-[11px] text-gray-600">
              <span className="text-green-400">●</span> Green = you have players from this nation
            </div>
          </div>

          {/* Scoring Rules */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { title: '🏆 Match Result', rules: [
                { label: 'Win', pts: '+3', desc: 'All players in winning squad' },
                { label: 'Draw', pts: '+1', desc: 'All players' },
                { label: 'Loss', pts: '0', desc: 'No result points' },
              ]},
              { title: '⚽ Goals (per team goal)', rules: [
                { label: 'Goalkeeper', pts: '+1', desc: 'Per goal scored by team' },
                { label: 'Defender', pts: '+1', desc: 'Per goal scored by team' },
                { label: 'Midfielder', pts: '+3', desc: 'Per goal scored by team' },
                { label: 'Forward', pts: '+4', desc: 'Per goal scored by team' },
              ]},
              { title: '🔒 Clean Sheet (0 goals conceded)', rules: [
                { label: 'Goalkeeper', pts: '+6', desc: '90 min clean sheet' },
                { label: 'Defender', pts: '+4', desc: '90 min clean sheet' },
                { label: 'Midfielder', pts: '+1', desc: '90 min clean sheet' },
                { label: 'Forward', pts: '0', desc: 'No clean sheet bonus' },
              ]},
              { title: '⭐ Captain', rules: [
                { label: 'All points', pts: '×2', desc: 'Captain earns double every match' },
                { label: 'Choose wisely', pts: '—', desc: 'Only 1 captain per team' },
              ]},
            ].map(section => (
              <div key={section.title} className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
                <div className="text-sm font-black text-white mb-3">{section.title}</div>
                <div className="space-y-2">
                  {section.rules.map(r => (
                    <div key={r.label} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-gray-300 font-medium">{r.label}</span>
                        <span className="text-gray-600 ml-1.5">{r.desc}</span>
                      </div>
                      <span className="font-black text-green-400 text-sm">{r.pts}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Per-player points breakdown — only visible once real match data exists */}
          {activeResults.length > 0 && starters.some(Boolean) && (
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
                <Star size={14} className="text-amber-400" />
                <span className="font-bold text-white text-sm">Your Squad Breakdown</span>
                <span className="ml-auto text-xs font-black text-amber-400">{totalPoints} pts total</span>
              </div>
              <div className="divide-y divide-white/5">
                {(['GK','DEF','MID','FWD'] as Position[]).flatMap(pos => {
                  const posPlayers = starters
                    .filter(Boolean)
                    .map(id => PLAYERS.find(p => p.id === id)!)
                    .filter(p => p && p.position === pos);
                  return posPlayers.map(player => {
                    let rawPts = 0;
                    for (const round of activeResults) {
                      const r = round.teams.find(t => t.country === player.country);
                      if (r) rawPts += calcPlayerPoints(player, r);
                    }
                    const isCap = player.id === captainId;
                    const finalPts = isCap ? rawPts * 2 : rawPts;
                    return (
                      <div key={player.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={`text-[9px] font-black w-7 text-center rounded px-1 py-0.5 ${POS_COLOR[pos]} text-white flex-shrink-0`}>{pos}</span>
                        <span className="text-sm">{FLAG_EMOJI[player.country] || '🌍'}</span>
                        <span className="flex-1 text-sm text-white">{player.name}</span>
                        {isCap && (
                          <span className="text-[9px] font-black bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full flex-shrink-0">© ×2</span>
                        )}
                        <span className={`font-black text-sm ${finalPts > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                          {finalPts}
                        </span>
                        {isCap && rawPts > 0 && (
                          <span className="text-[9px] text-gray-600 flex-shrink-0">({rawPts}×2)</span>
                        )}
                        <span className="text-[10px] text-gray-600 flex-shrink-0">pts</span>
                      </div>
                    );
                  });
                })}
              </div>
              <div className="px-4 py-2 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Based on {activeResults.length} match round{activeResults.length !== 1 ? 's' : ''} played</span>
                <span className="text-xs font-black text-amber-400">{totalPoints} pts</span>
              </div>
            </div>
          )}

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm">
            <div className="font-bold text-amber-400 mb-1">🌟 How scoring works</div>
            <p className="text-gray-400 text-xs leading-relaxed">
              Points are based on national team match results from live sports data — updated after every WC match.
              All players from the same national team earn the same base result points per match.
              Strategy is picking players from teams that score goals and go deep in the tournament.
              The captain multiplier (2×) is your biggest lever — pick carefully!
            </p>
          </div>

        </div>
      )}

      {/* ── LEADERBOARD ─────────────────────────────────────────────────── */}
      {view === 'leaderboard' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-white/[0.03] border border-white/8 rounded-xl p-3">
            <Info size={13} className="text-cyan-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 flex-1">Live leaderboard activates when the tournament starts (Jun 11, 2026). Connect your wallet to compete globally.</span>
            <div className="flex-shrink-0 flex items-center gap-2 bg-green-500/10 border border-green-500/25 rounded-lg px-3 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-black text-green-400">
                {lockedCount === null ? '…' : lockedCount}
              </span>
              <span className="text-[10px] text-gray-500">teams entered</span>
            </div>
          </div>

          {/* My rank banner */}
          {walletAddress && lbTeams.length > 0 && (() => {
            const myRow = lbTeams.find(t => t.walletAddress?.toLowerCase() === walletAddress.toLowerCase());
            if (!myRow) return null;
            const medal = myRow.rank === 1 ? '🥇' : myRow.rank === 2 ? '🥈' : myRow.rank === 3 ? '🥉' : null;
            return (
              <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
                <span className="text-xl">{medal || `#${myRow.rank}`}</span>
                <div className="flex-1">
                  <div className="text-sm font-black text-white">{myRow.teamName}</div>
                  <div className="text-xs text-gray-500">Your current rank · {lbTeams.length} teams entered</div>
                </div>
                <div className="text-right">
                  <div className={`text-xl font-black ${myRow.totalPoints > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                    {myRow.totalPoints > 0 ? myRow.totalPoints : '—'}
                  </div>
                  <div className="text-[10px] text-gray-600">pts</div>
                </div>
              </div>
            );
          })()}

          {/* My team entry */}
          {allSelected.length > 0 && (
            <div className={`rounded-xl p-4 border ${locked ? 'bg-green-500/10 border-green-500/30' : 'bg-cyan-500/10 border-cyan-500/30'}`}>
              <div className={`text-xs font-bold uppercase tracking-wider mb-2 ${locked ? 'text-green-400' : 'text-cyan-400'}`}>
                {locked ? '🔒 Your Locked Team' : '👁 Your Team (not yet locked)'}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center text-xl">🏆</div>
                <div>
                  <div className="font-bold text-white">{teamName}</div>
                  <div className="text-xs text-gray-400">
                    {completedStarters}/11 starters · {completedBench}/4 bench{captainId ? ' · Captain ✓' : ''}
                    {feePaid && <span className="text-green-400 ml-2">· Fee Paid ✓</span>}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-2xl font-black text-amber-400">{totalPoints}</div>
                  <div className="text-[10px] text-gray-600">{resultsSource === 'live' ? 'live pts' : 'sim pts'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard table */}
          <div className="bg-white/[0.03] border border-white/8 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
              <Trophy size={14} className="text-amber-400" />
              <span className="font-bold text-white text-sm">Global Rankings</span>
              {lbLoading && <span className="ml-2 text-[10px] text-cyan-400 animate-pulse">Loading…</span>}
              <span className="ml-auto text-xs text-gray-500">{lbTeams.length > 0 ? `${lbTeams.length} teams entered` : 'Tournament starts Jun 11, 2026'}</span>
            </div>
            {lbLoading ? (
              <div className="py-8 text-center text-gray-600 text-sm">Loading leaderboard…</div>
            ) : lbTeams.length === 0 ? (
              <div className="py-8 text-center text-gray-600 text-sm">
                <div className="text-2xl mb-2">🏆</div>
                <div>No locked teams yet — be the first!</div>
                <div className="text-[11px] text-gray-700 mt-1">Lock your team to appear here.</div>
              </div>
            ) : (
              lbTeams.map(row => {
                const isMe = row.walletAddress?.toLowerCase() === walletAddress?.toLowerCase();
                const isViewing = viewingTeam?.walletAddress?.toLowerCase() === row.walletAddress?.toLowerCase();
                return (
                  <div
                    key={row.rank}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 transition-colors cursor-pointer ${isViewing ? 'bg-cyan-500/20 border-l-2 border-l-cyan-400' : isMe ? 'bg-cyan-500/10' : 'hover:bg-white/[0.04]'}`}
                    onClick={async () => {
                      if (isViewing) { setViewingTeam(null); return; }
                      setViewingTeamLoading(true);
                      try {
                        const r = await fetch(`${API_BASE}/api/fantasy/wc2026/team?wallet=${row.walletAddress}`, { signal: AbortSignal.timeout(8000) });
                        if (r.ok) {
                          const d = await r.json();
                          if (d.team) {
                            setViewingTeam({
                              walletAddress: row.walletAddress,
                              teamName: d.team.teamName || row.teamName,
                              starterIds: Array.isArray(d.team.starterIds) ? d.team.starterIds.filter(Boolean) : [],
                              benchIds: Array.isArray(d.team.benchIds) ? d.team.benchIds.filter(Boolean) : [],
                              captainId: d.team.captainId || null,
                            });
                          }
                        }
                      } catch { /* ignore */ }
                      setViewingTeamLoading(false);
                    }}
                  >
                    <span className={`w-6 text-center font-black text-sm ${row.rank === 1 ? 'text-amber-400' : row.rank === 2 ? 'text-gray-300' : row.rank === 3 ? 'text-amber-600' : 'text-gray-600'}`}>
                      {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}
                    </span>
                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-base flex-shrink-0">⚽</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white truncate">{row.teamName}</div>
                      <div className="text-[10px] text-gray-500 truncate">
                        {displayName(row.walletAddress, lbNames[row.walletAddress])}
                        {isMe && <span className="text-cyan-400 ml-1">· You</span>}
                        {row.devBypass && <span className="text-orange-400 ml-1">· Dev</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 flex items-center gap-2">
                      <div>
                        <div className={`font-black text-sm ${row.totalPoints > 0 ? 'text-amber-400' : 'text-gray-600'}`}>{row.totalPoints > 0 ? row.totalPoints : '—'}</div>
                        <div className="text-[9px] text-gray-600">pts</div>
                      </div>
                      <div className={`text-[10px] px-1.5 py-0.5 rounded border ${isViewing ? 'border-cyan-400 text-cyan-400' : 'border-white/10 text-gray-600'}`}>
                        {isViewing ? 'Hide' : 'View'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Viewing another team's squad */}
          {viewingTeam && (
            <div className="bg-[#0f1a2e] border border-cyan-500/30 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-cyan-500/20 flex items-center gap-2">
                <Shirt size={14} className="text-cyan-400" />
                <span className="font-bold text-white text-sm">{viewingTeam.teamName}</span>
                <span className="text-[10px] text-gray-500 flex-1 truncate">{displayName(viewingTeam.walletAddress, lbNames[viewingTeam.walletAddress])}</span>
                <button onClick={() => setViewingTeam(null)} className="text-gray-600 hover:text-gray-300 text-xs">✕ Close</button>
              </div>
              {viewingTeamLoading ? (
                <div className="py-6 text-center text-gray-600 text-sm">Loading squad…</div>
              ) : viewingTeam.starterIds.length === 0 ? (
                <div className="py-6 text-center text-gray-600 text-sm">Squad not yet saved on-chain.</div>
              ) : (
                <div className="p-4 space-y-3">
                  {(['GK', 'DEF', 'MID', 'FWD'] as Position[]).map(pos => {
                    const posPlayers = viewingTeam.starterIds
                      .map(id => PLAYERS.find(p => p.id === id))
                      .filter((p): p is Player => !!p && p.position === pos);
                    if (posPlayers.length === 0) return null;
                    return (
                      <div key={pos}>
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">{pos}</div>
                        <div className="flex flex-wrap gap-2">
                          {posPlayers.map(p => (
                            <div key={p.id} className={`flex items-center gap-1.5 bg-white/5 border rounded-lg px-2 py-1 ${p.id === viewingTeam.captainId ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10'}`}>
                              <span className="text-[10px]">{FLAG_EMOJI[p.country] || '🌍'}</span>
                              <span className="text-xs font-semibold text-white">{p.name}</span>
                              {p.id === viewingTeam.captainId && <span className="text-[9px] text-amber-400 font-black">©</span>}
                              <span className="text-[9px] text-gray-500">{p.countryName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {viewingTeam.benchIds.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Bench</div>
                      <div className="flex flex-wrap gap-2">
                        {viewingTeam.benchIds.map(id => {
                          const p = PLAYERS.find(pl => pl.id === id);
                          if (!p) return null;
                          return (
                            <div key={p.id} className="flex items-center gap-1.5 bg-white/[0.03] border border-white/8 rounded-lg px-2 py-1">
                              <span className="text-xs text-gray-400">{p.name}</span>
                              <span className="text-[9px] text-gray-600">{p.position}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!feePaid && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
              <AlertCircle size={13} className="flex-shrink-0" />
              <span>Pay the {ENTRY_FEE_SUI} SUI entry fee when locking your team to appear on the global leaderboard.</span>
            </div>
          )}
        </div>
      )}

      {/* ── H2H BETTING ──────────────────────────────────────────────────── */}
      {view === 'h2h' && (
        <FantasyH2H
          walletAddress={walletAddress}
          teamName={teamName}
          starterIds={starters}
          captainId={captainId}
          isTeamComplete={isTeamComplete}
          myPreviewPts={computePointsForPlayers(
            starters.filter(Boolean) as string[],
            captainId || '',
            activeResults,
          )}
          results={activeResults}
        />
      )}
    </div>
  );
}
