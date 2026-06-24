/**
 * ELO-style team ratings for 2025-26 / 2026 season.
 * Scale: 2150 = world-class elite, 2000 = CL-level, 1900 = strong top-league,
 *        1800 = mid top-league, 1700 = good second-tier, 1600 = lower leagues.
 *
 * Covers: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie,
 * Primeira Liga, Scottish Prem, Süper Lig, Belgian Pro, Austrian BL, Swiss SL,
 * Greek SL, Czech FL, Polish Ekstraklasa, Danish SL, Norwegian EL, Swedish AS,
 * Russian PL, Ukrainian PL, Serbian SL, Romanian L1, Croatian FL,
 * Brazilian Série A, Argentine Primera, MLS, Liga MX, Chilean PD, Colombian PD,
 * Saudi Pro League, UAE Pro League, J1 League, Chinese SL, A-League,
 * NBA, NHL, MLB, EuroLeague Basketball,
 * FIFA National Teams (World Cup 2026 era).
 *
 * Sources: ELO ratings (clubelo.com / eloratings.net), UEFA coefficients,
 * FIFA World Rankings (April 2026), public power rankings.
 */

export const TEAM_RATINGS: Record<string, number> = {

  // ═══════════════════════════════════════════════════════════════════
  //  FIFA NATIONAL TEAMS — World Cup 2026 era
  // ═══════════════════════════════════════════════════════════════════
  'Argentina': 2150,         // World Champions 2022, still top-ranked
  'France': 2120,
  'Spain': 2110,
  'England': 2090,
  'Brazil': 2100,
  'Portugal': 2060,
  'Belgium': 1980,
  'Netherlands': 2040,
  'Germany': 2050,
  'Italy': 2020,
  'Uruguay': 1990,
  'Croatia': 1980,
  'Morocco': 1960,
  'Denmark': 1970,
  'Switzerland': 1960,
  'Colombia': 1960,
  'Mexico': 1940,
  'Japan': 1950,
  'Senegal': 1940,
  'USA': 1940,
  'United States': 1940,
  'Poland': 1930,
  'Serbia': 1920,
  'Ecuador': 1900,
  'Turkey': 1910,
  'South Korea': 1910,
  'Korea Republic': 1910,
  'Australia': 1900,
  'Austria': 1880,
  'Ukraine': 1900,
  'Wales': 1880,
  'Scotland': 1870,
  'Hungary': 1870,
  'Czech Republic': 1890,
  'Czechia': 1890,
  'Slovakia': 1870,
  'Greece': 1840,
  'Romania': 1840,
  'Norway': 1900,
  'Sweden': 1890,
  'Algeria': 1870,
  'Nigeria': 1880,
  'Egypt': 1870,
  'Ghana': 1840,
  'Cameroon': 1840,
  'Ivory Coast': 1860,
  "Côte d'Ivoire": 1860,
  'Tunisia': 1860,
  'Mali': 1840,
  'South Africa': 1820,
  'Canada': 1900,
  'Chile': 1900,
  'Paraguay': 1870,
  'Peru': 1860,
  'Venezuela': 1840,
  'Bolivia': 1810,
  'Costa Rica': 1840,
  'Panama': 1830,
  'Jamaica': 1810,
  'Honduras': 1800,
  'Guatemala': 1780,
  'El Salvador': 1770,
  'Qatar': 1840,
  'Saudi Arabia': 1860,
  'Iran': 1880,
  'Iraq': 1850,
  'Uzbekistan': 1860,
  'Jordan': 1840,
  'New Zealand': 1780,
  'Russia': 1940,
  'Israel': 1850,
  'Slovenia': 1860,
  'Albania': 1840,
  'Finland': 1840,
  'Iceland': 1850,
  'Northern Ireland': 1830,
  'Republic of Ireland': 1840,
  'Ireland': 1840,

  // ═══════════════════════════════════════════════════════════════════
  //  PREMIER LEAGUE — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Liverpool': 2090,
  'Arsenal': 2070,
  'Manchester City': 2000,
  'Chelsea': 1990,
  'Aston Villa': 1960,
  'Newcastle United': 1950,
  'Newcastle': 1950,
  'Tottenham Hotspur': 1950,
  'Tottenham': 1950,
  'Nottingham Forest': 1880,
  'Brighton': 1870,
  'Brighton & Hove Albion': 1870,
  'Brentford': 1850,
  'Fulham': 1855,
  'Crystal Palace': 1845,
  'Bournemouth': 1840,
  'West Ham United': 1820,
  'West Ham': 1820,
  'Manchester United': 1810,
  'Everton': 1790,
  'Wolverhampton Wanderers': 1790,
  'Wolves': 1790,
  'Ipswich Town': 1740,
  'Leicester City': 1740,
  'Southampton': 1700,
  // 2024-25 PL also
  'Burnley': 1720,
  'Luton Town': 1700,
  'Sheffield United': 1700,

  // ═══════════════════════════════════════════════════════════════════
  //  LA LIGA — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Real Madrid': 2130,       // Mbappe era
  'Barcelona': 2060,
  'Atletico Madrid': 2050,
  'Athletic Club': 1980,
  'Athletic Bilbao': 1980,
  'Real Sociedad': 1960,
  'Villarreal': 1950,
  'Sevilla': 1930,
  'Real Betis': 1920,
  'Valencia': 1890,
  'Girona': 1900,
  'Osasuna': 1870,
  'Mallorca': 1860,
  'Celta Vigo': 1850,
  'Rayo Vallecano': 1830,
  'Las Palmas': 1820,
  'Getafe': 1810,
  'Deportivo Alaves': 1800,
  'Alaves': 1800,
  'Leganes': 1780,
  'Espanyol': 1770,
  'Granada': 1740,
  'Cadiz': 1720,
  'Almeria': 1700,
  'Leganés': 1780,

  // ═══════════════════════════════════════════════════════════════════
  //  SERIE A — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Inter Milan': 2080,
  'Internazionale': 2080,
  'Inter': 2080,
  'Juventus': 2030,
  'AC Milan': 2010,
  'Milan': 2010,
  'Atalanta': 2000,
  'Napoli': 1990,
  'Roma': 1960,
  'AS Roma': 1960,
  'Lazio': 1950,
  'SS Lazio': 1950,
  'Fiorentina': 1920,
  'ACF Fiorentina': 1920,
  'Bologna': 1900,
  'Torino': 1870,
  'Monza': 1850,
  'Udinese': 1830,
  'Genoa': 1820,
  'Empoli': 1800,
  'Lecce': 1790,
  'Cagliari': 1780,
  'Verona': 1800,
  'Hellas Verona': 1800,
  'Parma': 1770,
  'Como': 1760,
  'Venezia': 1740,
  'Frosinone': 1740,
  'Salernitana': 1720,
  'Spezia': 1710,
  'Sassuolo': 1760,

  // ═══════════════════════════════════════════════════════════════════
  //  BUNDESLIGA — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Bayern Munich': 2120,
  'FC Bayern München': 2120,
  'Bayern München': 2120,
  'Bayer Leverkusen': 2060,
  'Borussia Dortmund': 2000,
  'BVB': 2000,
  'RB Leipzig': 1980,
  'Stuttgart': 1960,
  'VfB Stuttgart': 1960,
  'Eintracht Frankfurt': 1940,
  'Freiburg': 1920,
  'SC Freiburg': 1920,
  'Hoffenheim': 1900,
  'TSG Hoffenheim': 1900,
  'Wolfsburg': 1890,
  'VfL Wolfsburg': 1890,
  'Borussia Mönchengladbach': 1880,
  'Borussia Monchengladbach': 1880,
  'Union Berlin': 1870,
  '1. FC Union Berlin': 1870,
  'Mainz': 1860,
  'FSV Mainz': 1860,
  'Mainz 05': 1860,
  'Augsburg': 1840,
  'FC Augsburg': 1840,
  'Werder Bremen': 1855,
  'SV Werder Bremen': 1855,
  'Bochum': 1800,
  'VfL Bochum': 1800,
  'Darmstadt': 1780,
  'SV Darmstadt': 1780,
  'Cologne': 1810,
  'FC Cologne': 1810,
  '1. FC Köln': 1810,
  'Heidenheim': 1800,
  '1. FC Heidenheim': 1800,
  'Holstein Kiel': 1790,
  'St. Pauli': 1810,
  'FC St. Pauli': 1810,

  // ═══════════════════════════════════════════════════════════════════
  //  LIGUE 1 — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'PSG': 2090,
  'Paris Saint-Germain': 2090,
  'Paris SG': 2090,
  'Monaco': 2020,
  'AS Monaco': 2020,
  'Marseille': 1970,
  'Olympique de Marseille': 1970,
  'Olympique Marseille': 1970,
  'Lyon': 1950,
  'Olympique Lyonnais': 1950,
  'Olympique de Lyon': 1950,
  'Lille': 1950,
  'LOSC Lille': 1950,
  'Nice': 1930,
  'OGC Nice': 1930,
  'Rennes': 1910,
  'Stade Rennais': 1910,
  'Lens': 1900,
  'RC Lens': 1900,
  'Brest': 1890,
  'Stade Brestois': 1890,
  'Montpellier': 1860,
  'Montpellier HSC': 1860,
  'Strasbourg': 1860,
  'RC Strasbourg': 1860,
  'Reims': 1840,
  'Stade de Reims': 1840,
  'Toulouse': 1840,
  'Toulouse FC': 1840,
  'Nantes': 1820,
  'FC Nantes': 1820,
  'Lorient': 1800,
  'FC Lorient': 1800,
  'Metz': 1780,
  'FC Metz': 1780,
  'Clermont': 1760,
  'Clermont Foot': 1760,
  'Le Havre': 1790,
  'Auxerre': 1800,
  'AJ Auxerre': 1800,
  'Angers': 1780,
  'SCO Angers': 1780,
  'Saint-Etienne': 1790,
  'AS Saint-Etienne': 1790,

  // ═══════════════════════════════════════════════════════════════════
  //  EREDIVISIE — Netherlands 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Ajax': 2000,
  'AFC Ajax': 2000,
  'PSV': 2010,
  'PSV Eindhoven': 2010,
  'Feyenoord': 1990,
  'Feyenoord Rotterdam': 1990,
  'AZ Alkmaar': 1940,
  'AZ': 1940,
  'Twente': 1900,
  'FC Twente': 1900,
  'Utrecht': 1880,
  'FC Utrecht': 1880,
  'Groningen': 1860,
  'FC Groningen': 1860,
  'Go Ahead Eagles': 1840,
  'Almere City': 1830,
  'Sparta Rotterdam': 1850,
  'NEC Nijmegen': 1840,
  'Heerenveen': 1850,
  'SC Heerenveen': 1850,
  'RKC Waalwijk': 1820,
  'Heracles': 1830,
  'Heracles Almelo': 1830,
  'PEC Zwolle': 1820,
  'Excelsior': 1810,

  // ═══════════════════════════════════════════════════════════════════
  //  PRIMEIRA LIGA — Portugal 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Benfica': 2020,
  'SL Benfica': 2020,
  'Porto': 2010,
  'FC Porto': 2010,
  'Sporting CP': 2000,
  'Sporting': 2000,
  'Braga': 1930,
  'SC Braga': 1930,
  'Vitoria Guimaraes': 1860,
  'Vitória de Guimarães': 1860,
  'Guimaraes': 1860,
  'Estoril': 1820,
  'Gil Vicente': 1820,
  'Casa Pia': 1810,
  'Famalicao': 1800,
  'Rio Ave': 1800,
  'Moreirense': 1790,
  'Boavista': 1840,
  'Arouca': 1780,

  // ═══════════════════════════════════════════════════════════════════
  //  UEFA CHAMPIONS LEAGUE / EUROPA perennials
  // ═══════════════════════════════════════════════════════════════════
  'Bayern': 2120,
  'Real': 2130,
  'Barca': 2060,
  'Atletico': 2050,
  'Red Bull Salzburg': 1970,
  'Salzburg': 1970,
  'FC Salzburg': 1970,
  'Shakhtar Donetsk': 2000,
  'Dynamo Kiev': 1960,
  'Red Star Belgrade': 1980,
  'Crvena zvezda': 1980,
  'Partizan': 1950,
  'Partizan Belgrade': 1950,
  'Young Boys': 1950,
  'BSC Young Boys': 1950,
  'Basel': 1930,
  'FC Basel': 1930,
  'Club Brugge': 1990,
  'Anderlecht': 1970,
  'RSC Anderlecht': 1970,
  'Gent': 1940,
  'KAA Gent': 1940,
  'Union Saint-Gilloise': 1960,
  'Olympiakos': 1980,
  'Olympiacos': 1980,
  'PAOK': 1970,
  'AEK Athens': 1960,
  'Panathinaikos': 1950,

  // ═══════════════════════════════════════════════════════════════════
  //  SÜPER LIG — Turkey 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Galatasaray': 1990,
  'Fenerbahce': 1980,
  'Fenerbahçe': 1980,
  'Besiktas': 1960,
  'Beşiktaş': 1960,
  'Trabzonspor': 1910,
  'Basaksehir': 1890,
  'Istanbul Basaksehir': 1890,
  'Başakşehir': 1890,
  'Adana Demirspor': 1850,
  'Konyaspor': 1830,
  'Sivasspor': 1820,
  'Alanyaspor': 1810,
  'Antalyaspor': 1800,
  'Kasimpasa': 1790,
  'Kasımpaşa': 1790,
  'Gaziantep FK': 1790,
  'Hatayspor': 1780,
  'Kayserispor': 1770,
  'Rizespor': 1760,
  'Samsunspor': 1780,
  'Ankaragücü': 1770,
  'Bodrumspor': 1750,

  // ═══════════════════════════════════════════════════════════════════
  //  SCOTTISH PREMIERSHIP
  // ═══════════════════════════════════════════════════════════════════
  'Celtic': 1980,
  'Rangers': 1950,
  'Hearts': 1830,
  'Heart of Midlothian': 1830,
  'Hibernian': 1820,
  'Aberdeen': 1800,
  'Motherwell': 1760,
  'St Mirren': 1750,
  'Dundee United': 1740,
  'Ross County': 1730,
  'Kilmarnock': 1750,
  'Livingston': 1730,
  'St Johnstone': 1720,

  // ═══════════════════════════════════════════════════════════════════
  //  AUSTRIAN BUNDESLIGA
  // ═══════════════════════════════════════════════════════════════════
  'RB Salzburg': 1970,
  'Sturm Graz': 1950,
  'SK Sturm Graz': 1950,
  'LASK': 1930,
  'LASK Linz': 1930,
  'Rapid Wien': 1920,
  'SK Rapid': 1920,
  'Austria Wien': 1880,
  'FK Austria Wien': 1880,
  'Wolfsberger AC': 1870,
  'WAC': 1870,
  'Hartberg': 1830,
  'TSV Hartberg': 1830,

  // ═══════════════════════════════════════════════════════════════════
  //  BELGIAN PRO LEAGUE — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Club Brugge KV': 1990,
  'Genk': 1940,
  'Racing Genk': 1940,
  'Standard Liège': 1920,
  'Standard': 1920,
  'Antwerp': 1940,
  'Royal Antwerp': 1940,
  'Mechelen': 1900,
  'KV Mechelen': 1900,
  'Cercle Brugge': 1900,
  'Charleroi': 1890,
  'Sporting Charleroi': 1890,
  'OH Leuven': 1880,
  'Sint-Truiden': 1870,
  'STVV': 1870,
  'Westerlo': 1870,
  'KV Kortrijk': 1850,

  // ═══════════════════════════════════════════════════════════════════
  //  GREEK SUPER LEAGUE
  // ═══════════════════════════════════════════════════════════════════
  'Aris': 1880,
  'AEK': 1960,
  'Panathnaikos': 1950,
  'Panserraikos': 1780,
  'Panetolikos': 1790,
  'OFI Crete': 1800,
  'Atromitos': 1810,
  'Volos': 1790,
  'PAS Giannina': 1780,
  'Asteras Tripolis': 1800,
  'Levadiakos': 1770,
  'Lamia': 1780,
  'Ionikos': 1790,

  // ═══════════════════════════════════════════════════════════════════
  //  SWISS SUPER LEAGUE
  // ═══════════════════════════════════════════════════════════════════
  'FC Zurich': 1920,
  'Zurich': 1920,
  'Servette': 1910,
  'FC Servette': 1910,
  'Lugano': 1890,
  'FC Lugano': 1890,
  'Lausanne-Sport': 1870,
  'FC Lausanne-Sport': 1870,
  'Lucerne': 1860,
  'FC Luzern': 1860,
  'Grasshoppers': 1850,
  'Grasshopper': 1850,
  'Winterthur': 1830,
  'FC Winterthur': 1830,
  'Sion': 1840,
  'FC Sion': 1840,
  'Yverdon': 1820,

  // ═══════════════════════════════════════════════════════════════════
  //  CZECH FIRST LEAGUE
  // ═══════════════════════════════════════════════════════════════════
  'Sparta Prague': 1950,
  'AC Sparta Prague': 1950,
  'Slavia Prague': 1960,
  'SK Slavia Prague': 1960,
  'Viktoria Plzen': 1920,
  'Viktoria Plzeň': 1920,
  'Banik Ostrava': 1880,
  'FC Baník Ostrava': 1880,
  'Mlada Boleslav': 1860,
  'Sigma Olomouc': 1850,
  'Jablonec': 1840,
  'FK Jablonec': 1840,
  'Bohemians': 1830,
  'Bohemians 1905': 1830,

  // ═══════════════════════════════════════════════════════════════════
  //  POLISH EKSTRAKLASA
  // ═══════════════════════════════════════════════════════════════════
  'Legia Warsaw': 1940,
  'Legia Warszawa': 1940,
  'Lech Poznan': 1930,
  'Lech Poznań': 1930,
  'Rakow Czestochowa': 1940,
  'Raków Częstochowa': 1940,
  'Wisla Krakow': 1890,
  'Wisła Kraków': 1890,
  'Pogon Szczecin': 1900,
  'Pogoń Szczecin': 1900,
  'Piast Gliwice': 1880,
  'Slask Wroclaw': 1870,
  'Śląsk Wrocław': 1870,
  'Cracovia': 1870,
  'Gornik Zabrze': 1860,

  // ═══════════════════════════════════════════════════════════════════
  //  DANISH SUPERLIGA
  // ═══════════════════════════════════════════════════════════════════
  'FC Copenhagen': 1960,
  'FC København': 1960,
  'Midtjylland': 1940,
  'FC Midtjylland': 1940,
  'Brondby': 1930,
  'Brøndby': 1930,
  'Brøndby IF': 1930,
  'FC Nordsjælland': 1880,
  'Nordsjaelland': 1880,
  'AGF': 1870,
  'Aarhus GF': 1870,
  'OB': 1860,
  'Odense BK': 1860,
  'Randers FC': 1860,
  'Silkeborg': 1850,
  'SønderjyskE': 1840,
  'Viborg': 1860,
  'Viborg FF': 1860,

  // ═══════════════════════════════════════════════════════════════════
  //  NORWEGIAN ELITESERIEN
  // ═══════════════════════════════════════════════════════════════════
  'Bodø/Glimt': 1970,
  'Bodo/Glimt': 1970,
  'FK Bodø/Glimt': 1970,
  'Molde': 1940,
  'Molde FK': 1940,
  'Rosenborg': 1930,
  'Rosenborg BK': 1930,
  'Viking': 1880,
  'Viking FK': 1880,
  'Brann': 1890,
  'SK Brann': 1890,
  'Lillestrøm': 1870,
  'IK Start': 1840,
  'Tromsø': 1840,

  // ═══════════════════════════════════════════════════════════════════
  //  SWEDISH ALLSVENSKAN
  // ═══════════════════════════════════════════════════════════════════
  'Malmö': 1940,
  'Malmö FF': 1940,
  'Malmo FF': 1940,
  'Hammarby': 1910,
  'AIK': 1920,
  'AIK Solna': 1920,
  'Djurgården': 1900,
  'Djurgarden': 1900,
  'Häcken': 1880,
  'BK Häcken': 1880,
  'IFK Göteborg': 1890,
  'Goteborg': 1890,
  'Elfsborg': 1880,
  'IF Elfsborg': 1880,
  'Helsingborg': 1840,
  'IFK Norrköping': 1860,

  // ═══════════════════════════════════════════════════════════════════
  //  RUSSIAN PREMIER LEAGUE
  // ═══════════════════════════════════════════════════════════════════
  'Zenit Saint Petersburg': 1970,
  'Zenit': 1970,
  'Zenit St. Petersburg': 1970,
  'CSKA Moscow': 1950,
  'CSKA': 1950,
  'Spartak Moscow': 1940,
  'Spartak': 1940,
  'Lokomotiv Moscow': 1920,
  'Lokomotiv': 1920,
  'Dynamo Moscow': 1920,
  'Dynamo': 1920,
  'Krasnodar': 1940,
  'FK Krasnodar': 1940,
  'Rostov': 1900,
  'FK Rostov': 1900,
  'Akhmat Grozny': 1880,
  'Rubin Kazan': 1880,
  'Torpedo Moscow': 1850,

  // ═══════════════════════════════════════════════════════════════════
  //  UKRAINIAN PREMIER LEAGUE
  // ═══════════════════════════════════════════════════════════════════
  'Shakhtar': 2000,
  'Dynamo Kyiv': 1960,
  'Dynamo Kyiv FC': 1960,
  'Metalist': 1880,
  'Dnipro': 1870,

  // ═══════════════════════════════════════════════════════════════════
  //  SERBIAN SUPERLIGA
  // ═══════════════════════════════════════════════════════════════════
  'Vojvodina': 1900,
  'FK Vojvodina': 1900,
  'Radnicki Nis': 1880,
  'TSC Backa Topola': 1870,

  // ═══════════════════════════════════════════════════════════════════
  //  ROMANIAN LIGA 1
  // ═══════════════════════════════════════════════════════════════════
  'FCSB': 1920,
  'Steaua Bucharest': 1920,
  'CFR Cluj': 1930,
  'Rapid Bucharest': 1910,
  'Rapid București': 1910,
  'Universitatea Craiova': 1890,
  'FC Hermannstadt': 1860,
  'Petrolul': 1850,
  'Sepsi': 1840,

  // ═══════════════════════════════════════════════════════════════════
  //  CROATIAN FIRST FOOTBALL LEAGUE (HNL)
  // ═══════════════════════════════════════════════════════════════════
  'Dinamo Zagreb': 1970,
  'GNK Dinamo Zagreb': 1970,
  'Hajduk Split': 1940,
  'NK Hajduk Split': 1940,
  'Rijeka': 1900,
  'HNK Rijeka': 1900,
  'Osijek': 1880,
  'NK Osijek': 1880,
  'Varaždin': 1840,
  'Lokomotiva Zagreb': 1850,

  // ═══════════════════════════════════════════════════════════════════
  //  SEGUNDA DIVISIÓN — Spain
  // ═══════════════════════════════════════════════════════════════════
  'Elche': 1760,
  'Oviedo': 1760,
  'Real Oviedo': 1760,
  'Mirandés': 1750,
  'Levante': 1780,
  'Levante UD': 1780,
  'Huesca': 1770,
  'SD Huesca': 1770,
  'Racing Santander': 1750,
  'Racing de Santander': 1750,
  'Tenerife': 1760,
  'CD Tenerife': 1760,
  'Burgos': 1740,
  'Burgos CF': 1740,
  'Racing de Ferrol': 1710,
  'Albacete': 1740,
  'Albacete BP': 1740,
  'FC Andorra': 1730,
  'Andorra': 1730,
  'Eldense': 1700,
  'Sporting Gijón': 1760,
  'Zaragoza': 1770,
  'Real Zaragoza': 1770,
  'Eibar': 1760,
  'SD Eibar': 1760,
  'Valladolid': 1770,
  'Real Valladolid': 1770,

  // ═══════════════════════════════════════════════════════════════════
  //  BRAZILIAN SÉRIE A — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Flamengo': 1990,
  'CR Flamengo': 1990,
  'Palmeiras': 1980,
  'SE Palmeiras': 1980,
  'Atletico Mineiro': 1970,
  'Atlético Mineiro': 1970,
  'Botafogo': 1960,
  'Botafogo FR': 1960,
  'Fluminense': 1950,
  'Fluminense FC': 1950,
  'Internacional': 1940,
  'SC Internacional': 1940,
  'Sao Paulo': 1940,
  'São Paulo FC': 1940,
  'Gremio': 1940,
  'Grêmio': 1940,
  'Corinthians': 1930,
  'SC Corinthians': 1930,
  'Fortaleza': 1910,
  'Fortaleza EC': 1910,
  'Bragantino': 1900,
  'Red Bull Bragantino': 1900,
  'Bahia': 1890,
  'EC Bahia': 1890,
  'Cruzeiro': 1930,
  'Cruzeiro EC': 1930,
  'Santos': 1920,
  'Santos FC': 1920,
  'Vasco da Gama': 1920,
  'Vasco': 1920,
  'Sport Recife': 1880,
  'Sport Club do Recife': 1880,
  'Juventude': 1870,
  'EC Juventude': 1870,
  'Criciuma': 1860,
  'Criciúma': 1860,
  'Ceara': 1880,
  'Ceará SC': 1880,
  'Cuiaba': 1850,
  'Cuiabá': 1850,
  'Athletico Paranaense': 1940,
  'Athletico-PR': 1940,
  'Atletico Paranaense': 1940,

  // ═══════════════════════════════════════════════════════════════════
  //  ARGENTINE PRIMERA DIVISIÓN
  // ═══════════════════════════════════════════════════════════════════
  'River Plate': 2000,
  'Club Atlético River Plate': 2000,
  'Boca Juniors': 1990,
  'CA Boca Juniors': 1990,
  'Racing Club': 1960,
  'Racing Club de Avellaneda': 1960,
  'Independiente': 1950,
  'CA Independiente': 1950,
  'San Lorenzo': 1940,
  'CA San Lorenzo': 1940,
  'Estudiantes': 1940,
  'Estudiantes LP': 1940,
  'Lanus': 1910,
  'CA Lanús': 1910,
  'Tigre': 1870,
  'CA Tigre': 1870,
  'Talleres': 1920,
  'Talleres de Córdoba': 1920,
  'Colon': 1890,
  "Colón": 1890,
  "Newell's Old Boys": 1890,
  'Newells': 1890,
  'Vélez Sársfield': 1940,
  'Velez': 1940,
  'Argentinos Juniors': 1920,
  'Atletico Tucuman': 1880,
  'Atlético Tucumán': 1880,
  'Banfield': 1880,
  'Club Atlético Banfield': 1880,
  'Huracan': 1900,
  'Huracán': 1900,
  'Defensa y Justicia': 1900,
  'Godoy Cruz': 1880,
  'Club Godoy Cruz': 1880,
  'Central Córdoba': 1860,
  'Instituto': 1860,
  'Barracas Central': 1840,
  'Platense': 1840,
  'Belgrano': 1880,
  'Club Atlético Belgrano': 1880,
  'Sarmiento': 1830,
  'Union de Santa Fe': 1870,
  'Unión de Santa Fe': 1870,
  'Rosario Central': 1910,
  'CA Rosario Central': 1910,
  'Gimnasia La Plata': 1870,
  'Gimnasia y Esgrima': 1870,

  // ═══════════════════════════════════════════════════════════════════
  //  MLS — Major League Soccer 2026
  // ═══════════════════════════════════════════════════════════════════
  'Inter Miami CF': 1980,    // Messi
  'Inter Miami': 1980,
  'LAFC': 1960,
  'Los Angeles FC': 1960,
  'LA Galaxy': 1930,
  'Seattle Sounders': 1930,
  'Seattle Sounders FC': 1930,
  'Columbus Crew': 1920,
  'Columbus Crew SC': 1920,
  'FC Cincinnati': 1910,
  'New England Revolution': 1900,
  'New England': 1900,
  'Nashville SC': 1900,
  'Atlanta United': 1920,
  'Atlanta United FC': 1920,
  'Philadelphia Union': 1920,
  'Portland Timbers': 1900,
  'New York City FC': 1910,
  'NYCFC': 1910,
  'New York Red Bulls': 1890,
  'FC Dallas': 1880,
  'Sporting Kansas City': 1880,
  'SKC': 1880,
  'Real Salt Lake': 1880,
  'RSL': 1880,
  'Colorado Rapids': 1860,
  'Austin FC': 1890,
  'Charlotte FC': 1880,
  'St. Louis City SC': 1880,
  'St. Louis City': 1880,
  'San Jose Earthquakes': 1850,
  'Chicago Fire': 1860,
  'Chicago Fire FC': 1860,
  'DC United': 1850,
  'D.C. United': 1850,
  'Vancouver Whitecaps': 1870,
  'Toronto FC': 1870,
  'Houston Dynamo': 1870,
  'Minnesota United': 1870,
  'Minnesota United FC': 1870,
  'Orlando City': 1880,
  'Orlando City SC': 1880,
  'CF Montréal': 1870,
  'Montreal Impact': 1870,
  'Cruz Azul': 1950,         // Liga MX
  'Chivas': 1940,
  'Club America': 1960,
  'América': 1960,
  'Tigres UANL': 1950,
  'Tigres': 1950,
  'Monterrey': 1950,
  'Club de Foot Monterrey': 1950,
  'Rayados': 1950,
  'Pumas UNAM': 1890,
  'Toluca': 1900,
  'Deportivo Guadalajara': 1940,
  'Pachuca': 1920,
  'CF Pachuca': 1920,
  'Atlas': 1880,
  'Santos Laguna': 1880,
  'Leon': 1890,
  'Club León': 1890,
  'Necaxa': 1860,
  'Mazatlan': 1840,

  // ═══════════════════════════════════════════════════════════════════
  //  SAUDI PRO LEAGUE — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Al-Hilal': 2010,          // Neymar, top squad
  'Al Hilal': 2010,
  'Al-Nassr': 1990,          // Ronaldo
  'Al Nassr': 1990,
  'Al-Ittihad': 1970,
  'Al Ittihad': 1970,
  'Al-Ahli': 1960,
  'Al Ahli': 1960,
  'Al-Qadsiah': 1890,
  'Al Qadsiah': 1890,
  'Al-Shabab': 1880,
  'Al Shabab': 1880,
  'Al-Feiha': 1840,
  'Al Feiha': 1840,
  'Al-Fateh': 1850,
  'Al Fateh': 1850,
  'Al-Riyadh': 1830,
  'Al Riyadh': 1830,
  'Al-Hazm': 1820,
  'Al-Okhdood': 1820,
  'Al-Ettifaq': 1870,
  'Al Ettifaq': 1870,
  'Al-Qadisiyah': 1840,
  'Al-Khaleej': 1830,
  'Damac FC': 1820,

  // ═══════════════════════════════════════════════════════════════════
  //  J1 LEAGUE — Japan 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Kawasaki Frontale': 1960,
  'Yokohama F. Marinos': 1960,
  'Yokohama Marinos': 1960,
  'Yokohama F.Marinos': 1960,
  'Vissel Kobe': 1950,
  'Urawa Red Diamonds': 1940,
  'Urawa Reds': 1940,
  'Gamba Osaka': 1920,
  'FC Tokyo': 1900,
  'Cerezo Osaka': 1890,
  'Kashima Antlers': 1940,
  'Kashima': 1940,
  'Nagoya Grampus': 1890,
  'Sagan Tosu': 1870,
  'Sanfrecce Hiroshima': 1900,
  'Shonan Bellmare': 1850,
  'Kyoto Sanga': 1860,
  'Avispa Fukuoka': 1850,
  'Consadole Sapporo': 1850,

  // ═══════════════════════════════════════════════════════════════════
  //  CHINESE SUPER LEAGUE
  // ═══════════════════════════════════════════════════════════════════
  'Shandong Taishan': 1910,
  'Shanghai Port': 1900,
  'Shanghai SIPG': 1900,
  'Guangzhou FC': 1880,
  'Guangzhou Evergrande': 1880,
  'Beijing Guoan': 1890,
  'Wuhan Three Towns': 1890,
  'Zhejiang': 1870,

  // ═══════════════════════════════════════════════════════════════════
  //  A-LEAGUE — Australia
  // ═══════════════════════════════════════════════════════════════════
  'Melbourne City': 1880,
  'Western Sydney Wanderers': 1860,
  'Sydney FC': 1870,
  'Melbourne Victory': 1870,
  'Adelaide United': 1850,
  'Perth Glory': 1840,
  'Brisbane Roar': 1840,
  'Central Coast Mariners': 1840,
  'Wellington Phoenix': 1840,
  'Macarthur FC': 1840,

  // ═══════════════════════════════════════════════════════════════════
  //  LIGA PORTUGAL 2 / Second tiers
  // ═══════════════════════════════════════════════════════════════════
  'Farense': 1780,
  'Vizela': 1770,
  'Estrela Amadora': 1760,
  'Leixões': 1750,
  'Penafiel': 1740,
  'Académica': 1730,

  // ═══════════════════════════════════════════════════════════════════
  //  EFL CHAMPIONSHIP (England second tier)
  // ═══════════════════════════════════════════════════════════════════
  'Leeds United': 1800,
  'Leeds': 1800,
  'Sunderland': 1780,
  'West Bromwich Albion': 1790,
  'West Brom': 1790,
  'Norwich City': 1790,
  'Norwich': 1790,
  'Middlesbrough': 1780,
  'Sheffield Wednesday': 1770,
  'Millwall': 1770,
  'Stoke City': 1770,
  'Coventry City': 1790,
  'Coventry': 1790,
  'Bristol City': 1760,
  'Watford': 1780,
  'Derby County': 1770,
  'Swansea City': 1760,
  'Plymouth Argyle': 1750,
  'Queens Park Rangers': 1760,
  'QPR': 1760,
  'Hull City': 1770,
  'Hull': 1770,
  'Cardiff City': 1760,
  'Cardiff': 1760,
  'Oxford United': 1750,
  'Blackburn Rovers': 1760,
  'Preston North End': 1750,
  'Exeter City': 1720,
  'Portsmouth': 1750,
  'Luton': 1770,
  'Barnsley': 1730,

  // ═══════════════════════════════════════════════════════════════════
  //  NBA — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Boston Celtics': 2000,    // Defending champions
  'Oklahoma City Thunder': 1990,
  'Cleveland Cavaliers': 1980,
  'Minnesota Timberwolves': 1960,
  'Denver Nuggets': 1950,
  'Los Angeles Lakers': 1940,
  'Golden State Warriors': 1930,
  'Houston Rockets': 1920,
  'Dallas Mavericks': 1920,
  'Indiana Pacers': 1910,
  'New York Knicks': 1910,
  'Milwaukee Bucks': 1900,
  'Sacramento Kings': 1890,
  'Phoenix Suns': 1870,
  'Miami Heat': 1870,
  'Philadelphia 76ers': 1850,
  'Memphis Grizzlies': 1850,
  'Los Angeles Clippers': 1840,
  'New Orleans Pelicans': 1830,
  'Orlando Magic': 1840,
  'Atlanta Hawks': 1810,
  'Chicago Bulls': 1800,
  'Brooklyn Nets': 1780,
  'Toronto Raptors': 1760,
  'Portland Trail Blazers': 1750,
  'Detroit Pistons': 1760,
  'San Antonio Spurs': 1750,
  'Utah Jazz': 1740,
  'Charlotte Hornets': 1720,
  'Washington Wizards': 1710,

  // ═══════════════════════════════════════════════════════════════════
  //  NHL — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Florida Panthers': 1980,
  'Colorado Avalanche': 1970,
  'Boston Bruins': 1960,
  'Vegas Golden Knights': 1960,
  'New York Rangers': 1950,
  'Carolina Hurricanes': 1940,
  'Edmonton Oilers': 1940,
  'Dallas Stars': 1930,
  'Winnipeg Jets': 1930,
  'Vancouver Canucks': 1920,
  'Tampa Bay Lightning': 1910,
  'Toronto Maple Leafs': 1900,
  'New Jersey Devils': 1890,
  'Seattle Kraken': 1860,
  'Washington Capitals': 1870,
  'New York Islanders': 1870,
  'Minnesota Wild': 1870,
  'Pittsburgh Penguins': 1850,
  'Los Angeles Kings': 1850,
  'St. Louis Blues': 1850,
  'Ottawa Senators': 1840,
  'Nashville Predators': 1830,
  'Calgary Flames': 1830,
  'Buffalo Sabres': 1820,
  'Philadelphia Flyers': 1810,
  'Detroit Red Wings': 1810,
  'Montreal Canadiens': 1790,
  'Columbus Blue Jackets': 1770,
  'Anaheim Ducks': 1750,
  'Chicago Blackhawks': 1740,
  'San Jose Sharks': 1710,

  // ═══════════════════════════════════════════════════════════════════
  //  MLB — 2025-26
  // ═══════════════════════════════════════════════════════════════════
  'Los Angeles Dodgers': 1980,
  'New York Yankees': 1960,
  'Atlanta Braves': 1950,
  'Philadelphia Phillies': 1930,
  'Baltimore Orioles': 1920,
  'Houston Astros': 1910,
  'Cleveland Guardians': 1900,
  'Texas Rangers': 1900,
  'Seattle Mariners': 1890,
  'Arizona Diamondbacks': 1880,
  'San Diego Padres': 1880,
  'Milwaukee Brewers': 1870,
  'Minnesota Twins': 1860,
  'Boston Red Sox': 1860,
  'Tampa Bay Rays': 1860,
  'Kansas City Royals': 1850,
  'New York Mets': 1850,
  'San Francisco Giants': 1840,
  'Toronto Blue Jays': 1840,
  'Chicago Cubs': 1810,
  'Cincinnati Reds': 1810,
  'Detroit Tigers': 1820,
  'Pittsburgh Pirates': 1800,
  'St. Louis Cardinals': 1800,
  'Los Angeles Angels': 1780,
  'Miami Marlins': 1760,
  'Chicago White Sox': 1710,
  'Colorado Rockies': 1710,
  'Oakland Athletics': 1710,
  'Washington Nationals': 1730,

  // ═══════════════════════════════════════════════════════════════════
  //  EuroLeague Basketball
  // ═══════════════════════════════════════════════════════════════════
  'Real Madrid Baloncesto': 2010,
  'FC Barcelona Basket': 2000,
  'Fenerbahce Beko': 1990,
  'Anadolu Efes': 1985,
  'Olympiakos BC': 1970,
  'Maccabi Tel Aviv': 1950,
  'CSKA Moscow Basketball': 1980,
  'Panathinaikos BC': 1970,
  'Zalgiris': 1930,
  'Zalgiris Kaunas': 1930,
  'Bayern Munich Basketball': 1960,
  'Alba Berlin': 1930,
  'Baskonia': 1950,
  'Saski Baskonia': 1950,
  'AS Monaco Basketball': 1940,
  'Barcelone': 2000,

  // ═══════════════════════════════════════════════════════════════════
  //  HANDBALL — EHF Champions League
  // ═══════════════════════════════════════════════════════════════════
  'Barcelona Handbol': 2050,
  'FC Barcelona Handbol': 2050,
  'Kiel': 2030,
  'THW Kiel': 2030,
  'Paris Saint-Germain HB': 2020,
  'PSG Handball': 2020,
  'Veszprem': 2000,
  'Telekom Veszprem': 2000,
  'Magdeburg': 1980,
  'SC Magdeburg': 1980,
  'Flensburg': 1970,
  'SG Flensburg-Handewitt': 1970,
  'Aalborg': 1960,
  'Aalborg Handbold': 1960,
  'Montpellier HB': 1940,
  'Nantes HB': 1910,
  'HC Vardar': 1900,

  // ═══════════════════════════════════════════════════════════════════
  //  VOLLEYBALL — CEV Champions League
  // ═══════════════════════════════════════════════════════════════════
  'Perugia': 1990,
  'Sir Sicoma Perugia': 1990,
  'Trentino': 1980,
  'Itas Trentino': 1980,
  'Jastrzebski Wegiel': 1970,
  'Lube Civitanova': 1970,
  'Cucine Lube Civitanova': 1970,
  'Berlin Recycling Volleys': 1950,
  'Zenit Kazan': 1960,
  'Modena': 1960,
  'Piacenza': 1940,
  'Zaksa Kedzierzyn-Kozle': 1960,
  'ZAKSA': 1960,
  'Ziraat Bankasi': 1940,
  'Fenerbahce Opet': 1940,
};

const _RATINGS_ENTRIES = Object.entries(TEAM_RATINGS);

/**
 * Deterministic hash of a team name → stable rating in [1580, 1980].
 * Used as last-resort fallback for teams not in the table, producing
 * varied realistic-looking odds instead of always 50/50.
 */
function hashRating(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  // 401-point range: 1580 to 1980
  return 1580 + (Math.abs(h) % 401);
}

/**
 * Look up a team's ELO rating. Tries multiple strategies before falling
 * back to a deterministic name-hash (1580–1980 range, stable & varied).
 *
 * Match order:
 *   1. Exact key
 *   2. Case-insensitive exact
 *   3. Normalised (strip diacritics + punctuation)
 *   4. Substring containment (both directions)
 *   5. Word-overlap (≥ 2 words in common)
 *   6. Hash fallback — deterministic, never flat 1800 for unknowns
 */
export function getTeamRating(name: string): number {
  if (!name) return hashRating('unknown');

  // 1. Exact key
  const direct = TEAM_RATINGS[name];
  if (direct) return direct;

  const lower = name.toLowerCase().trim();

  // 2. Case-insensitive exact
  for (const [k, v] of _RATINGS_ENTRIES) {
    if (k.toLowerCase() === lower) return v;
  }

  // 3. Normalise: strip diacritics + collapse punctuation/articles
  const norm = (s: string) =>
    s.normalize('NFD')
     .replace(/[\u0300-\u036f]/g, '')
     .replace(/[^a-z0-9 ]/g, ' ')
     .replace(/\b(fc|cf|ac|sc|sk|fk|hc|bk|if|gd|rc|cd|ud|sd|nk|ca|sa|de|la|le|les|el|st|afc|aek|och)\b/g, '')
     .replace(/\s+/g, ' ')
     .trim();

  const normName = norm(lower);
  for (const [k, v] of _RATINGS_ENTRIES) {
    if (norm(k.toLowerCase()) === normName) return v;
  }

  // 4. Substring containment
  for (const [k, v] of _RATINGS_ENTRIES) {
    const kl = k.toLowerCase();
    if (lower.includes(kl) || kl.includes(lower)) return v;
  }

  // 5. Normalised substring containment (catches "Atlético" vs "Atletico")
  for (const [k, v] of _RATINGS_ENTRIES) {
    const kn = norm(k.toLowerCase());
    if (normName.includes(kn) || kn.includes(normName)) return v;
  }

  // 6. Word-overlap (≥ 2 meaningful words in common)
  const stopWords = new Set(['city', 'united', 'real', 'club', 'sport', 'fc', 'cf', 'sc', 'ac']);
  const words = normName.split(' ').filter(w => w.length > 2 && !stopWords.has(w));
  if (words.length >= 2) {
    for (const [k, v] of _RATINGS_ENTRIES) {
      const kWords = norm(k.toLowerCase()).split(' ').filter(w => w.length > 2 && !stopWords.has(w));
      const shared = words.filter(w => kWords.includes(w));
      if (shared.length >= 2) return v;
    }
  }

  // 7. Single distinctive word overlap (≥ 5 chars, not a stop word)
  if (words.length >= 1) {
    const longWords = words.filter(w => w.length >= 5);
    for (const [k, v] of _RATINGS_ENTRIES) {
      const kWords = norm(k.toLowerCase()).split(' ');
      if (longWords.some(w => kWords.includes(w))) return v;
    }
  }

  // 8. Deterministic hash fallback — varied, realistic, never flat
  return hashRating(name);
}

/**
 * Compute bookmaker-style odds for a match given home/away team names.
 *
 * Uses ELO-derived win probabilities + home advantage + house overround.
 * All teams — even unknown ones — get varied realistic odds via the
 * hash-based rating fallback (1580–1980 range) instead of flat 1800.
 *
 * @param homeTeam  Home team display name
 * @param awayTeam  Away team display name
 * @param hasDraw   True for football (3-way market), false for basketball etc.
 * @param seed      Deterministic seed string (e.g. eventId) for jitter
 */
export function computeOddsFromRatings(
  homeTeam: string,
  awayTeam: string,
  hasDraw: boolean,
  seed: string
): { homeOdds: number; drawOdds?: number; awayOdds: number } {
  // ── 1. Team ratings & home advantage ──────────────────────────────
  const HOME_ADV = hasDraw ? 80 : 100;
  const homeRat = getTeamRating(homeTeam) + HOME_ADV;
  const awayRat = getTeamRating(awayTeam);

  // ── 2. ELO win probability ─────────────────────────────────────────
  const divisor = hasDraw ? 400 : 500;
  const rawHomeWinP = 1 / (1 + Math.pow(10, (awayRat - homeRat) / divisor));

  // ── 3. Deterministic jitter ±4% for variety within same rating band ─
  let h = 5381;
  const s = seed + homeTeam + awayTeam;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const jitter = ((Math.abs(h) % 100) / 100 - 0.5) * 0.08;
  const homeWinP = Math.max(0.05, Math.min(0.95, rawHomeWinP + jitter));
  const awayWinP = 1 - homeWinP;

  // ── 4. Compute odds ────────────────────────────────────────────────
  const OVERROUND = 1.0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  if (hasDraw) {
    const closeness = 1 - Math.abs(homeWinP - awayWinP);
    const drawFraction = 0.22 + closeness * 0.07;
    const adjHome = homeWinP * (1 - drawFraction);
    const adjDraw = drawFraction;
    const adjAway = awayWinP * (1 - drawFraction);
    const homeOdds = r2(clamp(OVERROUND / adjHome, 1.30, 18));
    const drawOdds = r2(clamp(OVERROUND / adjDraw, 2.80, 5.50));
    const awayOdds = r2(clamp(OVERROUND / adjAway, 1.30, 18));
    return { homeOdds, drawOdds, awayOdds };
  } else {
    const homeOdds = r2(clamp(OVERROUND / homeWinP, 1.30, 8));
    const awayOdds = r2(clamp(OVERROUND / awayWinP, 1.30, 8));
    return { homeOdds, awayOdds };
  }
}
