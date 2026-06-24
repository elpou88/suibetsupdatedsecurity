import { pgClient } from '../db';

const PLATFORM_WALLET = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
const DEFAULT_LIQUIDITY = 10000;

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d;
}

interface MarketTemplate {
  title: string;
  description: string;
  category: string;
  daysUntilEnd: number;
  currency?: string;
}

interface MarketTemplateExt extends MarketTemplate {
  resolutionSource: string;
}

const MARKET_POOL: MarketTemplateExt[] = [
  {
    title: 'Will Bitcoin reach $200K before end of 2026?',
    description: 'BTC price hits $200,000 USD on any major exchange before December 31, 2026. Resolves YES if BTC/USD price on Binance, Coinbase, or Kraken reaches or exceeds $200,000 at any point before the deadline.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinGecko BTC/USD price data (coingecko.com)',
  },
  {
    title: 'Will Ethereum flip Bitcoin by market cap in 2026?',
    description: 'ETH total market cap surpasses BTC total market cap at any point in 2026. Resolves YES based on CoinMarketCap market cap rankings.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinMarketCap market cap rankings (coinmarketcap.com)',
  },
  {
    title: 'Will Bitcoin hit $100K again by June 2026?',
    description: 'BTC price reaches or exceeds $100,000 on any major exchange before July 1, 2026. Resolves YES if BTC/USD hits $100,000 on Binance or Coinbase.',
    category: 'crypto',
    daysUntilEnd: 82,
    resolutionSource: 'CoinGecko BTC/USD price data (coingecko.com)',
  },
  {
    title: 'Will a spot ETH ETF launch in the US by Q3 2026?',
    description: 'SEC approves and a US-listed spot Ethereum ETF begins trading before October 1, 2026. Resolves YES based on SEC official filings and Bloomberg ETF tracker.',
    category: 'crypto',
    daysUntilEnd: 174,
    resolutionSource: 'SEC EDGAR filings (sec.gov) + Bloomberg ETF listings',
  },
  {
    title: 'Will SUI token reach $10 before end of 2026?',
    description: 'SUI price hits $10 USD on any major exchange before December 31, 2026. Resolves YES if SUI/USD reaches $10 on CoinGecko.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinGecko SUI/USD price data (coingecko.com)',
  },
  {
    title: 'Will Solana overtake Ethereum in daily DEX volume by Q2 2026?',
    description: 'Solana DEX volume (on-chain) exceeds Ethereum DEX volume for 7 consecutive days before July 1, 2026. Resolves YES based on DefiLlama DEX volume data.',
    category: 'crypto',
    daysUntilEnd: 82,
    resolutionSource: 'DefiLlama DEX volume tracker (defillama.com/dexs)',
  },
  {
    title: 'Will a major bank launch a stablecoin in 2026?',
    description: 'JPMorgan, Goldman Sachs, Bank of America, or HSBC officially launches a stablecoin product in 2026. Resolves YES based on official press releases from these institutions.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'Official bank press releases + Reuters/Bloomberg reporting',
  },
  {
    title: 'Will Dogecoin reach $1 by end of 2026?',
    description: 'DOGE price hits $1.00 USD on any major exchange before December 31, 2026. Resolves YES if DOGE/USD reaches $1.00 on CoinGecko.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinGecko DOGE/USD price data (coingecko.com)',
  },
  {
    title: 'Will XRP win the SEC lawsuit and reach $5 by June 2026?',
    description: 'Ripple achieves full regulatory clarity AND XRP price reaches $5 before July 1, 2026. Both conditions must be met. Court ruling from SEC EDGAR, price from CoinGecko.',
    category: 'crypto',
    daysUntilEnd: 82,
    resolutionSource: 'SEC EDGAR court filings + CoinGecko XRP/USD price',
  },
  {
    title: 'Will the total crypto market cap hit $10 trillion in 2026?',
    description: 'Total crypto market cap on CoinMarketCap exceeds $10 trillion at any point in 2026. Resolves YES based on CoinMarketCap total market cap.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinMarketCap total market cap (coinmarketcap.com)',
  },
  {
    title: 'Will the US pass a federal crypto regulation bill in 2026?',
    description: 'A comprehensive federal cryptocurrency regulation bill is signed into US law before December 31, 2026. Resolves YES based on Congress.gov bill tracker.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'Congress.gov official bill tracker (congress.gov)',
  },
  {
    title: 'Will there be a G7 agreement on AI regulation by end of 2026?',
    description: 'G7 nations formally agree on a joint AI governance framework before December 31, 2026. Resolves YES based on official G7 summit communique.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'Official G7 summit communique + Reuters/AP reporting',
  },
  {
    title: 'Will the EU enforce MiCA crypto rules against a major exchange by Q3 2026?',
    description: 'A top-10 crypto exchange receives an official enforcement action under EU MiCA regulations before October 1, 2026. Resolves YES based on ESMA official communications.',
    category: 'politics',
    daysUntilEnd: 174,
    resolutionSource: 'ESMA official enforcement notices (esma.europa.eu)',
  },
  {
    title: 'Will any country adopt Bitcoin as legal tender in 2026?',
    description: 'A sovereign nation passes legislation making Bitcoin legal tender before December 31, 2026. Resolves YES based on official government gazette/legislation.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'Official government legislation + Reuters/AP reporting',
  },
  {
    title: 'Will the US Federal Reserve cut rates at least 3 times in 2026?',
    description: 'The US Federal Reserve announces 3 or more rate cuts at FOMC meetings throughout 2026. Resolves YES based on official FOMC statements on federalreserve.gov.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'Federal Reserve FOMC statements (federalreserve.gov)',
  },
  {
    title: 'Will Real Madrid win the 2025-26 UEFA Champions League?',
    description: 'Real Madrid wins the UEFA Champions League Final in 2026. Resolves YES based on official UEFA match results.',
    category: 'sports',
    daysUntilEnd: 60,
    resolutionSource: 'UEFA official results (uefa.com)',
  },
  {
    title: 'Will the NBA Finals go to 7 games in 2026?',
    description: 'The 2026 NBA Finals reaches a decisive Game 7. Resolves YES based on official NBA results.',
    category: 'sports',
    daysUntilEnd: 75,
    resolutionSource: 'NBA official results (nba.com)',
  },
  {
    title: 'Will Lionel Messi retire from professional football in 2026?',
    description: 'Lionel Messi officially announces his retirement from professional football before December 31, 2026. Resolves YES based on official club/player statement.',
    category: 'sports',
    daysUntilEnd: 265,
    resolutionSource: 'Official player/club announcement + AP/Reuters',
  },
  {
    title: 'Will the 2026 FIFA World Cup be held as scheduled?',
    description: 'The FIFA World Cup 2026 (USA/Canada/Mexico) opens on schedule without major postponement. Resolves YES based on FIFA official schedule.',
    category: 'sports',
    daysUntilEnd: 80,
    resolutionSource: 'FIFA official schedule (fifa.com)',
  },
  {
    title: 'Will OpenAI release GPT-5 by June 2026?',
    description: 'OpenAI officially launches GPT-5 (or equivalent next-generation model) before July 1, 2026. Resolves YES based on official OpenAI blog announcement.',
    category: 'tech',
    daysUntilEnd: 82,
    resolutionSource: 'OpenAI official blog (openai.com/blog)',
  },
  {
    title: 'Will Apple release a foldable iPhone in 2026?',
    description: 'Apple announces and ships a foldable iPhone model before December 31, 2026. Resolves YES based on official Apple product launch.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Apple official product announcements (apple.com)',
  },
  {
    title: "Will Elon Musk's xAI surpass OpenAI in valuation by end of 2026?",
    description: "xAI official valuation (per last funding round or IPO) exceeds OpenAI's valuation before December 31, 2026. Resolves YES based on PitchBook or Crunchbase data.",
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'PitchBook / Crunchbase valuation data',
  },
  {
    title: 'Will Google\'s Gemini become the most-used AI assistant by Q4 2026?',
    description: 'Gemini surpasses ChatGPT in monthly active users according to a credible third-party report before January 1, 2027. Resolves YES based on SimilarWeb or data.ai traffic data.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'SimilarWeb / data.ai monthly active user reports',
  },
  {
    title: 'Will Nvidia remain the #1 most valuable company in the world by Q3 2026?',
    description: 'Nvidia holds the highest market cap among all public companies on any day before October 1, 2026. Resolves YES based on Yahoo Finance market cap rankings.',
    category: 'tech',
    daysUntilEnd: 174,
    resolutionSource: 'Yahoo Finance market cap data (finance.yahoo.com)',
  },
  {
    title: 'Will GTA VI launch on PC before end of 2026?',
    description: 'Grand Theft Auto VI officially launches on PC before December 31, 2026. Resolves YES based on official Rockstar Games announcement and Steam/Epic store listing.',
    category: 'gaming',
    daysUntilEnd: 265,
    resolutionSource: 'Rockstar Games official announcements + Steam store',
  },
  {
    title: 'Will a blockchain game break into the top 10 Steam games by player count in 2026?',
    description: 'A blockchain/web3 game appears in the top 10 most played Steam games (by peak concurrent players) at any point in 2026. Resolves YES based on SteamDB player charts.',
    category: 'gaming',
    daysUntilEnd: 265,
    resolutionSource: 'SteamDB player count charts (steamdb.info)',
  },
  {
    title: 'Will a movie gross over $3 billion at the box office in 2026?',
    description: 'Any single film earns $3 billion or more in worldwide box office revenue in 2026. Resolves YES based on Box Office Mojo data.',
    category: 'entertainment',
    daysUntilEnd: 265,
    resolutionSource: 'Box Office Mojo worldwide gross (boxofficemojo.com)',
  },
  {
    title: 'Will Taylor Swift release a new studio album in 2026?',
    description: 'Taylor Swift officially releases a brand-new studio album (not a re-recording) before December 31, 2026. Resolves YES based on official release on Spotify/Apple Music.',
    category: 'entertainment',
    daysUntilEnd: 265,
    resolutionSource: 'Official Spotify/Apple Music release + artist announcement',
  },
  {
    title: 'Will Netflix remain the #1 streaming platform by subscribers in 2026?',
    description: 'Netflix holds the highest global paid subscriber count among all streaming services through Q4 2026. Resolves YES based on official quarterly earnings reports.',
    category: 'entertainment',
    daysUntilEnd: 265,
    resolutionSource: 'Netflix/Disney+/etc quarterly earnings reports (SEC filings)',
  },
  {
    title: 'Will humans land on the Moon again before end of 2026?',
    description: 'NASA Artemis or another crewed mission achieves a Moon landing before December 31, 2026. Resolves YES based on official NASA mission status.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'NASA official mission status (nasa.gov)',
  },
  {
    title: 'Will SpaceX achieve a full Starship reusable round trip in 2026?',
    description: 'SpaceX successfully launches Starship and lands the full stack (both booster and ship) reusably in 2026. Resolves YES based on SpaceX official confirmation.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'SpaceX official updates (spacex.com) + FAA records',
  },

  {
    title: 'Will the US impose new tariffs on Chinese goods in Q2 2026?',
    description: 'The US government announces or implements new tariffs on Chinese imports before July 1, 2026. Resolves YES based on official USTR or White House announcements.',
    category: 'politics',
    daysUntilEnd: 82,
    resolutionSource: 'USTR official announcements (ustr.gov) + Reuters',
  },
  {
    title: 'Will the S&P 500 hit an all-time high in Q2 2026?',
    description: 'The S&P 500 index reaches a new all-time closing high before July 1, 2026. Resolves YES based on Yahoo Finance historical data.',
    category: 'other',
    daysUntilEnd: 82,
    resolutionSource: 'Yahoo Finance S&P 500 data (finance.yahoo.com)',
  },
  {
    title: 'Will China launch a digital yuan internationally by end of 2026?',
    description: 'China\'s PBOC officially launches cross-border digital yuan (e-CNY) for international trade settlements before December 31, 2026.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'PBOC official announcements + Reuters/Bloomberg',
  },
  {
    title: 'Will Tether (USDT) lose its dollar peg in 2026?',
    description: 'USDT trades below $0.95 for more than 24 consecutive hours on any major exchange in 2026. Resolves YES based on CoinGecko USDT/USD price.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinGecko USDT/USD price data (coingecko.com)',
  },
  {
    title: 'Will the WHO declare a new pandemic in 2026?',
    description: 'The World Health Organization officially declares a new Public Health Emergency of International Concern (PHEIC) or pandemic before December 31, 2026.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'WHO official declarations (who.int)',
  },
  {
    title: 'Will a major AI company IPO in 2026?',
    description: 'Anthropic, OpenAI, xAI, Databricks, or Scale AI completes an IPO on a US exchange before December 31, 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'SEC EDGAR filings + NYSE/Nasdaq listing data',
  },
  {
    title: 'Will autonomous taxis operate in more than 5 US cities by end of 2026?',
    description: 'Waymo, Cruise, or another robotaxi service has commercial operations (paid rides, no safety driver) in 6+ US cities before December 31, 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Official company announcements + CPUC/DMV records',
  },
  {
    title: 'Will India become the 3rd largest economy by GDP in 2026?',
    description: 'India surpasses Japan in nominal GDP according to IMF World Economic Outlook data published in 2026.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'IMF World Economic Outlook database (imf.org)',
  },
  {
    title: 'Will a country ban TikTok nationwide in 2026?',
    description: 'A G20 nation enacts and enforces a full ban on TikTok (not just a government device ban) before December 31, 2026.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'Official government legislation + Reuters/AP',
  },
  {
    title: 'Will Apple Vision Pro 2 launch in 2026?',
    description: 'Apple announces and begins selling a second-generation Vision Pro headset before December 31, 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Apple official product announcements (apple.com)',
  },
  {
    title: 'Will global temperatures set a new record in 2026?',
    description: '2026 becomes the hottest year on record according to NASA GISS or NOAA global temperature data.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'NASA GISS / NOAA global temperature records',
  },
  {
    title: 'Will the FIFA 2026 World Cup final be held in the US?',
    description: 'The FIFA World Cup 2026 Final match is held at a US venue (MetLife Stadium, NJ). Resolves YES based on official FIFA schedule.',
    category: 'sports',
    daysUntilEnd: 120,
    resolutionSource: 'FIFA official schedule (fifa.com)',
  },
  {
    title: 'Will Tesla launch a sub-$25,000 car in 2026?',
    description: 'Tesla announces and begins taking orders for a vehicle with a base price under $25,000 USD before December 31, 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Tesla official announcements (tesla.com)',
  },
  {
    title: 'Will a hurricane cause over $100 billion in damages in 2026?',
    description: 'A single Atlantic hurricane causes estimated damages exceeding $100 billion in 2026 according to NOAA or insurance industry estimates.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'NOAA / Swiss Re / Munich Re damage estimates',
  },
  {
    title: 'Will Samsung release a tri-fold smartphone in 2026?',
    description: 'Samsung officially launches a tri-fold (dual-hinge) smartphone for commercial sale before December 31, 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Samsung official product announcements (samsung.com)',
  },
  {
    title: 'Will the US national debt exceed $40 trillion in 2026?',
    description: 'US national debt held by the public exceeds $40 trillion at any point in 2026 according to US Treasury data.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'US Treasury fiscal data (fiscaldata.treasury.gov)',
  },
  {
    title: 'Will a deepfake cause a major stock market crash in 2026?',
    description: 'A verified deepfake (audio, video, or image) directly causes a >5% intraday drop in a major stock index (S&P 500, Nasdaq, Dow) in 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'SEC/FINRA investigation reports + Bloomberg/Reuters',
  },
  {
    title: 'Will there be a major earthquake (8.0+) in 2026?',
    description: 'An earthquake of magnitude 8.0 or greater occurs anywhere in the world before December 31, 2026 according to USGS data.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'USGS Earthquake Hazards Program (earthquake.usgs.gov)',
  },
  {
    title: 'Will Coinbase list 50+ new tokens in 2026?',
    description: 'Coinbase adds 50 or more new cryptocurrency tokens to its exchange in 2026. Resolves YES based on official Coinbase asset listing announcements.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'Coinbase official listing blog (blog.coinbase.com)',
  },
  {
    title: 'Will any AI model pass a full Turing Test in 2026?',
    description: 'An AI system passes a rigorous Turing Test conducted by a recognized institution where >50% of judges cannot distinguish it from a human over extended conversation.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Academic publications + major AI conference proceedings',
  },
  {
    title: 'Will a new meme coin reach $10B+ market cap in 2026?',
    description: 'A cryptocurrency launched in 2026 (not pre-2026 tokens) reaches $10 billion market cap. Resolves YES based on CoinMarketCap data.',
    category: 'crypto',
    daysUntilEnd: 265,
    resolutionSource: 'CoinMarketCap market cap data (coinmarketcap.com)',
  },
  {
    title: 'Will Ethereum transaction fees stay below $1 average for Q2 2026?',
    description: 'Average Ethereum L1 transaction fee stays below $1 USD for the entire Q2 2026 (April-June). Resolves YES based on Etherscan gas tracker historical data.',
    category: 'crypto',
    daysUntilEnd: 82,
    resolutionSource: 'Etherscan gas tracker (etherscan.io/gastracker)',
  },
  {
    title: 'Will a Mars mission launch in 2026?',
    description: 'NASA, SpaceX, ESA, or any national space agency successfully launches a mission to Mars in 2026.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'NASA/ESA mission tracking + SpaceflightNow',
  },
  {
    title: 'Will the UK rejoin any EU trade agreement in 2026?',
    description: 'The United Kingdom signs a new or rejoins an existing EU trade framework (customs union, single market, or comprehensive FTA) before December 31, 2026.',
    category: 'politics',
    daysUntilEnd: 265,
    resolutionSource: 'UK Government official trade announcements (gov.uk)',
  },
  {
    title: 'Will YouTube launch a TikTok competitor app in 2026?',
    description: 'Google/YouTube launches a standalone short-form video app separate from YouTube Shorts before December 31, 2026.',
    category: 'tech',
    daysUntilEnd: 265,
    resolutionSource: 'Google official blog + App Store/Google Play listings',
  },
  {
    title: 'Will gold price exceed $3,500/oz in 2026?',
    description: 'Gold spot price exceeds $3,500 USD per troy ounce at any point in 2026. Resolves YES based on LBMA gold price fixing or Kitco spot price.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'LBMA gold price / Kitco spot (kitco.com)',
  },
  {
    title: 'Will oil prices drop below $50/barrel in 2026?',
    description: 'WTI crude oil price drops below $50 USD per barrel at any point in 2026. Resolves YES based on EIA or Bloomberg energy data.',
    category: 'other',
    daysUntilEnd: 265,
    resolutionSource: 'EIA petroleum data (eia.gov) + Bloomberg',
  },
  {
    title: '[SUI] Will the S&P 500 hit an all-time high in Q2 2026?',
    description: 'The S&P 500 index reaches a new all-time closing high before July 1, 2026. Bet with SUI tokens.',
    category: 'other',
    daysUntilEnd: 82,
    currency: 'SUI',
    resolutionSource: 'Yahoo Finance S&P 500 data (finance.yahoo.com)',
  },
  {
    title: '[SUI] Will a major AI company IPO in 2026?',
    description: 'Anthropic, OpenAI, xAI, Databricks, or Scale AI completes an IPO on a US exchange before December 31, 2026. Bet with SUI tokens.',
    category: 'tech',
    daysUntilEnd: 265,
    currency: 'SUI',
    resolutionSource: 'SEC EDGAR filings + NYSE/Nasdaq listing data',
  },
  {
    title: '[$USD] Will gold price exceed $3,500/oz in 2026?',
    description: 'Gold spot price exceeds $3,500 USD per troy ounce at any point in 2026. Bet with $USDsui stablecoins.',
    category: 'other',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'LBMA gold price / Kitco spot (kitco.com)',
  },
  {
    title: '[$USD] Will Tesla launch a sub-$25,000 car in 2026?',
    description: 'Tesla announces and begins taking orders for a vehicle with a base price under $25,000 USD before December 31, 2026. Bet with $USDsui.',
    category: 'tech',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'Tesla official announcements (tesla.com)',
  },
  {
    title: '[SUI] Will SUI token reach $10 before end of 2026?',
    description: 'SUI price hits $10 USD on any major exchange before December 31, 2026. Bet with SUI tokens. Resolves YES if SUI/USD reaches $10 on CoinGecko.',
    category: 'crypto',
    daysUntilEnd: 265,
    currency: 'SUI',
    resolutionSource: 'CoinGecko SUI/USD price data (coingecko.com)',
  },
  {
    title: '[SUI] Will Bitcoin reach $200K before end of 2026?',
    description: 'BTC price hits $200,000 USD on any major exchange before December 31, 2026. Bet with SUI tokens.',
    category: 'crypto',
    daysUntilEnd: 265,
    currency: 'SUI',
    resolutionSource: 'CoinGecko BTC/USD price data (coingecko.com)',
  },
  {
    title: '[SUI] Will Ethereum flip Bitcoin by market cap in 2026?',
    description: 'ETH total market cap surpasses BTC total market cap at any point in 2026. Bet with SUI tokens.',
    category: 'crypto',
    daysUntilEnd: 265,
    currency: 'SUI',
    resolutionSource: 'CoinMarketCap market cap rankings (coinmarketcap.com)',
  },
  {
    title: '[SUI] Will the US pass a federal crypto regulation bill in 2026?',
    description: 'A comprehensive federal cryptocurrency regulation bill is signed into US law before December 31, 2026. Bet with SUI tokens.',
    category: 'politics',
    daysUntilEnd: 265,
    currency: 'SUI',
    resolutionSource: 'Congress.gov official bill tracker (congress.gov)',
  },
  {
    title: '[SUI] Will OpenAI release GPT-5 by June 2026?',
    description: 'OpenAI officially launches GPT-5 (or equivalent next-generation model) before July 1, 2026. Bet with SUI tokens.',
    category: 'tech',
    daysUntilEnd: 82,
    currency: 'SUI',
    resolutionSource: 'OpenAI official blog (openai.com/blog)',
  },
  {
    title: '[$USD] Will Bitcoin reach $200K before end of 2026?',
    description: 'BTC price hits $200,000 USD on any major exchange before December 31, 2026. Bet with $USDsui stablecoins.',
    category: 'crypto',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'CoinGecko BTC/USD price data (coingecko.com)',
  },
  {
    title: '[$USD] Will SUI token reach $10 before end of 2026?',
    description: 'SUI price hits $10 USD on any major exchange before December 31, 2026. Bet with $USDsui stablecoins.',
    category: 'crypto',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'CoinGecko SUI/USD price data (coingecko.com)',
  },
  {
    title: '[$USD] Will the US Federal Reserve cut rates at least 3 times in 2026?',
    description: 'The US Federal Reserve announces 3 or more rate cuts at FOMC meetings throughout 2026. Bet with $USDsui stablecoins.',
    category: 'politics',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'Federal Reserve FOMC statements (federalreserve.gov)',
  },
  {
    title: '[$USD] Will Ethereum flip Bitcoin by market cap in 2026?',
    description: 'ETH total market cap surpasses BTC total market cap at any point in 2026. Bet with $USDsui stablecoins.',
    category: 'crypto',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'CoinMarketCap market cap rankings (coinmarketcap.com)',
  },
  {
    title: '[$USD] Will GTA VI launch on PC before end of 2026?',
    description: 'Grand Theft Auto VI officially launches on PC before December 31, 2026. Bet with $USDsui stablecoins.',
    category: 'gaming',
    daysUntilEnd: 265,
    currency: 'USDSUI',
    resolutionSource: 'Rockstar Games official announcements + Steam store',
  },
];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SPORT_ID_TO_NAME: Record<number, string> = {
  1: 'Football',
  2: 'Basketball',
  3: 'Tennis',
  4: 'American Football',
  5: 'Baseball',
  6: 'Ice Hockey',
  7: 'MMA',
  10: 'AFL',
  11: 'Formula 1',
  12: 'Handball',
  13: 'NBA',
  14: 'NFL',
  15: 'Rugby',
  16: 'Volleyball',
  18: 'Cricket',
};

const SPORT_ID_TO_CATEGORY: Record<number, string> = {
  1: 'football',
  2: 'basketball',
  3: 'tennis',
  4: 'american-football',
  5: 'baseball',
  6: 'hockey',
  7: 'mma',
  10: 'afl',
  11: 'formula-1',
  12: 'handball',
  13: 'basketball',
  14: 'american-football',
  15: 'rugby',
  16: 'volleyball',
  18: 'cricket',
};

export async function seedSportsFromCachedEvents(): Promise<void> {
  const sql = pgClient;
  if (!sql) {
    console.log('[SportsSeeder] No DB client — skipping');
    return;
  }

  try {
    const { freeSportsService } = await import('./freeSportsService');
    const allEvents = freeSportsService.getUpcomingEvents();

    if (allEvents.length === 0) {
      console.log('[SportsSeeder] No cached sports events available');
      return;
    }

    const now = Date.now();
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    const upcoming = allEvents.filter(e => {
      if (!e.startTime || !e.homeTeam || !e.awayTeam) return false;
      const start = new Date(e.startTime).getTime();
      const diff = start - now;
      return diff >= THREE_HOURS_MS && diff <= SEVEN_DAYS_MS;
    });

    if (upcoming.length === 0) {
      console.log('[SportsSeeder] No upcoming events in 3h–7d window');
      return;
    }

    const existingRows = await sql`SELECT title, event_id FROM social_predictions WHERE status = 'active'`;
    const titlesSet = new Set<string>(existingRows.map((r: any) => r.title));
    const eventIdSet = new Set<string>(existingRows.filter((r: any) => r.event_id).map((r: any) => r.event_id));

    const MAX_NEW_MARKETS = 30;
    const shuffled = shuffleArray(upcoming);
    let inserted = 0;

    for (const event of shuffled) {
      if (inserted >= MAX_NEW_MARKETS) break;

      const eventId = String(event.id);
      if (eventIdSet.has(eventId)) continue;

      const home = event.homeTeam;
      const away = event.awayTeam;
      const title = `Will ${home} beat ${away}?`;

      if (titlesSet.has(title)) continue;
      titlesSet.add(title);
      eventIdSet.add(eventId);

      const kickoff = new Date(event.startTime!);
      const dateLabel = kickoff.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const sportName = SPORT_ID_TO_NAME[event.sportId] || event.leagueName || 'Sports';
      const league = event.leagueName || sportName;

      const description = `${home} vs ${away} — ${league} on ${dateLabel}. ` +
        `Market resolves YES if ${home} wins. Draw or ${away} win resolves NO.`;

      const endDate = kickoff.toISOString();
      const homeLogo = event.homeLogo || null;
      const awayLogo = event.awayLogo || null;
      const leagueLogo = event.leagueLogo || null;
      const sportCategory = SPORT_ID_TO_CATEGORY[event.sportId] || 'sports';
      const currencies = ['SBETS', 'SUI', 'USDSUI'] as const;
      const mCurrency = currencies[inserted % 3];
      const liq = mCurrency === 'SBETS' ? 1000000 : DEFAULT_LIQUIDITY;

      try {
        await sql`
          INSERT INTO social_predictions
            (creator_wallet, title, description, category, end_date, status,
             total_yes_amount, total_no_amount, total_participants, resolved_outcome,
             yes_reserve, no_reserve, initial_liquidity, resolution_source, total_volume,
             home_logo, away_logo, league_logo, event_id, currency)
          VALUES
            (${PLATFORM_WALLET}, ${title}, ${description}, ${sportCategory}, ${endDate}::timestamptz, 'active',
             0, 0, 0, NULL,
             ${liq}, ${liq}, ${liq}, 'API-Sports (api-sports.io)', 0,
             ${homeLogo}, ${awayLogo}, ${leagueLogo}, ${eventId}, ${mCurrency})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      } catch (insertErr: any) {
        console.warn(`[SportsSeeder] Insert error for "${title}": ${insertErr.message}`);
      }
    }

    console.log(`[SportsSeeder] ⚡ Auto-created ${inserted} sports prediction markets from ${upcoming.length} upcoming events`);
  } catch (err: any) {
    console.error('[SportsSeeder] Error (non-fatal):', err.message);
  }
}

export async function cleanExpiredSportsMarkets(): Promise<void> {
  const sql = pgClient;
  if (!sql) return;

  try {
    const result = await sql`
      UPDATE social_predictions
      SET status = 'expired'
      WHERE creator_wallet = ${PLATFORM_WALLET}
        AND status = 'active'
        AND end_date < NOW() - INTERVAL '4 hours'
        AND event_id IS NOT NULL
        AND event_id NOT LIKE 'FEATURED:%'
    `;
    const count = (result as any)?.count || 0;
    if (count > 0) {
      console.log(`[SportsSeeder] 🧹 Expired ${count} past sports markets`);
    }
  } catch (err: any) {
    console.warn('[SportsSeeder] Cleanup error:', err.message);
  }
}

export function startSportsAutoSeederInterval(): void {
  setTimeout(() => {
    cleanExpiredSportsMarkets().catch(err => {
      console.warn('[SportsSeeder] Initial cleanup error:', err.message);
    });
    seedSportsFromCachedEvents().catch(err => {
      console.warn('[SportsSeeder] Initial seed error:', err.message);
    });
  }, 30_000);

  setInterval(() => {
    cleanExpiredSportsMarkets().catch(err => {
      console.warn('[SportsSeeder] Periodic cleanup error:', err.message);
    });
    seedSportsFromCachedEvents().catch(err => {
      console.warn('[SportsSeeder] Periodic seed error:', err.message);
    });
  }, 2 * 60 * 60 * 1000);

  console.log('⚡ Sports auto-seeder started — refreshes every 2 hours (first run in 30s)');
}

export async function seedFootballPredictionMarkets(): Promise<void> {
  console.log('[FootballSeeder] Replaced by unified sports auto-seeder — skipping legacy football seeder');
}

const GRAND_NATIONAL_2026_HORSES = [
  'I Am Maximus', 'Grangeclare West', 'Jagwar', 'Iroko', 'Haiti Couleurs', 'Panic Attack',
  'Johnnywho', 'Banbridge', 'Captain Cody', 'Gerri Colombe', "Monty's Star", 'Spanish Harlem',
  'Firefox', 'Lecky Watson', 'Champ Kiely', 'Favori De Champdou', 'Three Card Brag', 'Oscars Brother',
  'Mr Vango', 'High Class Hero', 'Stellar Story', 'Beauport', 'Perceval Legallois', 'Gorgeous Tom',
  'Doyen Quest', 'Gold Tweet', 'Dorans Doyen', 'Mister Coffey', 'Doyen La Cotte',
  'Mystical Power', 'Idas Boy', 'On The Sev', 'Doyen Glory',
];

const GRAND_NATIONAL_CURRENCIES = [
  'SBETS', 'SUI', 'USDSUI', 'SBETS', 'SUI', 'USDSUI',
  'SBETS', 'SUI', 'USDSUI', 'SBETS', 'SUI', 'USDSUI',
  'SBETS', 'SUI', 'USDSUI', 'SBETS', 'SUI', 'USDSUI',
  'SBETS', 'SUI', 'USDSUI', 'SBETS', 'SUI', 'USDSUI',
  'SBETS', 'SUI', 'USDSUI', 'SBETS', 'SUI',
  'SBETS', 'SUI', 'USDSUI', 'SBETS',
];

export async function seedGrandNational2026(): Promise<{ inserted: number }> {
  const sql = pgClient;
  if (!sql) return { inserted: 0 };

  const eventStartTime = '2026-04-11T15:00:00Z';
  const endDate = '2026-04-11T18:00:00Z';
  let inserted = 0;

  for (let i = 0; i < GRAND_NATIONAL_2026_HORSES.length; i++) {
    const horse = GRAND_NATIONAL_2026_HORSES[i];
    const title = `Grand National 2026: Will ${horse} win?`;
    const eventId = `FEATURED:grand-national-2026-horse-${i + 1}`;
    const currency = GRAND_NATIONAL_CURRENCIES[i] || 'SBETS';
    const liq = currency === 'SBETS' ? 1000000 : (currency === 'USDSUI' ? 10000 : 10000);

    try {
      const existing = await sql`SELECT id FROM social_predictions WHERE event_id = ${eventId}`;
      if (existing.length > 0) continue;

      await sql`
        INSERT INTO social_predictions
          (creator_wallet, title, description, category, end_date, status,
           total_yes_amount, total_no_amount, total_participants, resolved_outcome,
           yes_reserve, no_reserve, initial_liquidity, resolution_source, total_volume, currency, event_id)
        VALUES
          (${PLATFORM_WALLET}, ${title},
           ${'Grand National 2026 at Aintree Racecourse. Pick your horse! If this horse wins the race, market resolves YES. All other horses resolve NO. Winner takes all!'},
           'horse-racing', ${endDate}::timestamptz, 'active',
           0, 0, 0, NULL,
           ${liq}, ${liq}, ${liq}, 'admin', 0, ${currency}, ${eventId})
        ON CONFLICT DO NOTHING
      `;
      inserted++;
      console.log(`[GrandNational] Seeded #${i + 1}: ${horse} (${currency})`);
    } catch (err: any) {
      console.warn(`[GrandNational] Error seeding ${horse}:`, err.message);
    }
  }

  console.log(`[GrandNational] ✅ Seeded ${inserted} new horse markets (${GRAND_NATIONAL_2026_HORSES.length} total)`);
  return { inserted };
}

interface FeaturedMarket {
  title: string;
  description: string;
  category: string;
  daysUntilEnd: number;
  currency: string;
  resolutionSource: string;
  eventId: string;
}

const FEATURED_TRENDING_MARKETS: FeaturedMarket[] = [
  {
    title: 'Will Bitcoin reach $150K before August 2026?',
    description: 'BTC price hits $150,000 USD on any major exchange before August 1, 2026. Resolves YES if BTC/USD on Binance, Coinbase, or Kraken reaches or exceeds $150,000.',
    category: 'crypto', daysUntilEnd: 112, currency: 'SBETS',
    resolutionSource: 'CoinGecko BTC/USD price data', eventId: 'FEATURED:trending-btc-150k',
  },
  {
    title: 'Will SUI reach $10 before end of 2026?',
    description: 'SUI token price hits $10.00 USD on any major exchange before December 31, 2026. Resolves YES if SUI/USD reaches $10 on CoinGecko.',
    category: 'crypto', daysUntilEnd: 265, currency: 'SUI',
    resolutionSource: 'CoinGecko SUI/USD price data', eventId: 'FEATURED:trending-sui-10',
  },
  {
    title: 'Will Ethereum hit $10K before 2027?',
    description: 'ETH price reaches $10,000 USD on any major exchange before January 1, 2027. Resolves YES based on CoinGecko ETH/USD price.',
    category: 'crypto', daysUntilEnd: 265, currency: 'USDSUI',
    resolutionSource: 'CoinGecko ETH/USD price data', eventId: 'FEATURED:trending-eth-10k',
  },
  {
    title: 'Who wins UFC 315 main event?',
    description: 'UFC 315 main event result. Resolves YES if the fighter listed first wins. Resolves NO otherwise (opponent win, draw, no-contest). Based on official UFC results.',
    category: 'mma', daysUntilEnd: 45, currency: 'SBETS',
    resolutionSource: 'UFC official results (ufc.com)', eventId: 'FEATURED:trending-ufc-315',
  },
  {
    title: 'Will the Celtics repeat as NBA Champions 2026?',
    description: 'Boston Celtics win the 2025-26 NBA Championship. Resolves YES based on official NBA Finals results.',
    category: 'basketball', daysUntilEnd: 75, currency: 'SUI',
    resolutionSource: 'NBA official results (nba.com)', eventId: 'FEATURED:trending-nba-celtics',
  },
  {
    title: 'Will Real Madrid win Champions League 2026?',
    description: 'Real Madrid wins the 2025-26 UEFA Champions League Final. Resolves YES based on official UEFA match results.',
    category: 'sports', daysUntilEnd: 60, currency: 'USDSUI',
    resolutionSource: 'UEFA official results (uefa.com)', eventId: 'FEATURED:trending-ucl-madrid',
  },
  {
    title: 'Will Barcelona win La Liga 2025-26?',
    description: 'FC Barcelona finishes 1st in La Liga 2025-26. Resolves YES based on official La Liga standings at season end.',
    category: 'sports', daysUntilEnd: 50, currency: 'SBETS',
    resolutionSource: 'La Liga official standings', eventId: 'FEATURED:trending-laliga-barca',
  },
  {
    title: 'Will Solana hit $500 before 2027?',
    description: 'SOL price reaches $500 USD on any major exchange before January 1, 2027. Resolves YES if SOL/USD hits $500 on CoinGecko.',
    category: 'crypto', daysUntilEnd: 265, currency: 'SBETS',
    resolutionSource: 'CoinGecko SOL/USD price data', eventId: 'FEATURED:trending-sol-500',
  },
  {
    title: 'Will the 2026 FIFA World Cup final be USA vs Brazil?',
    description: 'Both USA and Brazil qualify for the 2026 FIFA World Cup Final. Resolves YES based on official FIFA match results.',
    category: 'sports', daysUntilEnd: 120, currency: 'SUI',
    resolutionSource: 'FIFA official match results (fifa.com)', eventId: 'FEATURED:trending-wc-final',
  },
  {
    title: 'Will GTA VI break day-1 sales records?',
    description: 'Grand Theft Auto VI sells more copies on its first day of release than any previous game. Resolves YES based on official Take-Two/Rockstar announcement or NPD data.',
    category: 'gaming', daysUntilEnd: 265, currency: 'USDSUI',
    resolutionSource: 'Rockstar/Take-Two official + NPD/Circana', eventId: 'FEATURED:trending-gta6-sales',
  },
  {
    title: 'Will OpenAI release GPT-5 by June 2026?',
    description: 'OpenAI officially launches GPT-5 (or next-gen model) before July 1, 2026. Resolves YES based on official OpenAI blog announcement.',
    category: 'tech', daysUntilEnd: 82, currency: 'SBETS',
    resolutionSource: 'OpenAI official blog (openai.com/blog)', eventId: 'FEATURED:trending-gpt5',
  },
  {
    title: 'Will Dogecoin hit $1 in 2026?',
    description: 'DOGE price reaches $1.00 USD on any major exchange before December 31, 2026. Resolves YES based on CoinGecko DOGE/USD price.',
    category: 'crypto', daysUntilEnd: 265, currency: 'SUI',
    resolutionSource: 'CoinGecko DOGE/USD price data', eventId: 'FEATURED:trending-doge-1',
  },
];

export async function seedFeaturedTrending(): Promise<{ inserted: number }> {
  const sql = pgClient;
  if (!sql) return { inserted: 0 };
  let inserted = 0;

  for (const m of FEATURED_TRENDING_MARKETS) {
    try {
      const existing = await sql`SELECT id FROM social_predictions WHERE event_id = ${m.eventId}`;
      if (existing.length > 0) continue;

      const endDate = daysFromNow(m.daysUntilEnd).toISOString();
      const liq = m.currency === 'SBETS' ? 1000000 : 10000;

      await sql`
        INSERT INTO social_predictions
          (creator_wallet, title, description, category, end_date, status,
           total_yes_amount, total_no_amount, total_participants, resolved_outcome,
           yes_reserve, no_reserve, initial_liquidity, resolution_source, total_volume, currency, event_id)
        VALUES
          (${PLATFORM_WALLET}, ${m.title}, ${m.description}, ${m.category}, ${endDate}::timestamptz, 'active',
           0, 0, 0, NULL,
           ${liq}, ${liq}, ${liq}, ${m.resolutionSource}, 0, ${m.currency}, ${m.eventId})
        ON CONFLICT DO NOTHING
      `;
      inserted++;
      console.log(`[FeaturedSeeder] Seeded: ${m.title} (${m.currency})`);
    } catch (err: any) {
      console.warn(`[FeaturedSeeder] Error seeding "${m.title}":`, err.message);
    }
  }

  console.log(`[FeaturedSeeder] ✅ Seeded ${inserted} featured trending markets`);
  return { inserted };
}

export function startFootballSeederInterval(): void {
  startSportsAutoSeederInterval();
}

export async function seedPredictionMarkets(): Promise<void> {
  try {
    const sql = pgClient;
    if (!sql) {
      console.log('[PredictionSeeder] No DB client — skipping seed');
      return;
    }

    const existingRows = await sql`SELECT title FROM social_predictions`;
    const titlesSet = new Set<string>(existingRows.map((r: any) => r.title));

    const toInsert = shuffleArray(MARKET_POOL).filter(m => !titlesSet.has(m.title));

    if (toInsert.length === 0) {
      console.log('[PredictionSeeder] All markets already present — nothing to seed');
      return;
    }

    let inserted = 0;
    for (const m of toInsert) {
      const endDate = daysFromNow(m.daysUntilEnd).toISOString();
      const resSrc = (m as MarketTemplateExt).resolutionSource || 'admin';
      const mCurrency = m.currency || 'SBETS';
      const liq = mCurrency === 'SBETS' ? 1000000 : DEFAULT_LIQUIDITY;
      await sql`
        INSERT INTO social_predictions
          (creator_wallet, title, description, category, end_date, status,
           total_yes_amount, total_no_amount, total_participants, resolved_outcome,
           yes_reserve, no_reserve, initial_liquidity, resolution_source, total_volume, currency)
        VALUES
          (${PLATFORM_WALLET}, ${m.title}, ${m.description}, ${m.category}, ${endDate}::timestamptz, 'active',
           0, 0, 0, NULL,
           ${liq}, ${liq}, ${liq}, ${resSrc}, 0, ${mCurrency})
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    }

    console.log(`[PredictionSeeder] ✅ Seeded ${inserted} prediction markets`);
  } catch (err: any) {
    console.error('[PredictionSeeder] Seed error (non-fatal):', err.message);
  }
}

export async function addNewMarketsBatch(batch: MarketTemplate[]): Promise<number> {
  try {
    const sql = pgClient;
    if (!sql) return 0;
    const existingRows = await sql`SELECT title FROM social_predictions`;
    const titlesSet = new Set<string>(existingRows.map((r: any) => r.title));
    let inserted = 0;
    for (const m of batch) {
      if (titlesSet.has(m.title)) continue;
      const endDate = daysFromNow(m.daysUntilEnd).toISOString();
      const resSrc = (m as MarketTemplateExt).resolutionSource || 'admin';
      const mCurrency = m.currency || 'SBETS';
      const liq = mCurrency === 'SBETS' ? 1000000 : DEFAULT_LIQUIDITY;
      await sql`
        INSERT INTO social_predictions
          (creator_wallet, title, description, category, end_date, status,
           total_yes_amount, total_no_amount, total_participants, resolved_outcome,
           yes_reserve, no_reserve, initial_liquidity, resolution_source, total_volume, currency)
        VALUES
          (${PLATFORM_WALLET}, ${m.title}, ${m.description}, ${m.category}, ${endDate}::timestamptz, 'active',
           0, 0, 0, NULL,
           ${liq}, ${liq}, ${liq}, ${resSrc}, 0, ${mCurrency})
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    }
    return inserted;
  } catch (err: any) {
    console.error('[PredictionSeeder] Batch insert error:', err.message);
    return 0;
  }
}

interface CryptoPriceTarget {
  pattern: RegExp;
  coinId: string;
  targetPrice: number;
  direction: 'above' | 'below';
}

const CRYPTO_PRICE_RULES: CryptoPriceTarget[] = [
  { pattern: /bitcoin.*\$200k|\$200,000/i, coinId: 'bitcoin', targetPrice: 200000, direction: 'above' },
  { pattern: /bitcoin.*\$100k|\$100,000/i, coinId: 'bitcoin', targetPrice: 100000, direction: 'above' },
  { pattern: /sui.*\$10/i, coinId: 'sui', targetPrice: 10, direction: 'above' },
  { pattern: /dogecoin.*\$1/i, coinId: 'dogecoin', targetPrice: 1, direction: 'above' },
  { pattern: /xrp.*\$5/i, coinId: 'ripple', targetPrice: 5, direction: 'above' },
];

const CRYPTO_MCAP_RULES: { pattern: RegExp; coinIds: [string, string] }[] = [
  { pattern: /ethereum.*flip.*bitcoin.*market.?cap/i, coinIds: ['ethereum', 'bitcoin'] },
];

const CRYPTO_TOTAL_MCAP_RULES: { pattern: RegExp; targetTrillion: number }[] = [
  { pattern: /total.*crypto.*market.*cap.*\$10\s*trillion/i, targetTrillion: 10 },
];

let lastCoinGeckoFetch = 0;
let cachedPrices: Record<string, { usd: number; usd_market_cap?: number }> = {};

async function fetchCoinGeckoPrices(): Promise<Record<string, { usd: number; usd_market_cap?: number }>> {
  const now = Date.now();
  if (now - lastCoinGeckoFetch < 120_000 && Object.keys(cachedPrices).length > 0) {
    return cachedPrices;
  }
  try {
    const ids = 'bitcoin,ethereum,sui,dogecoin,ripple,tether';
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) {
      console.warn(`[CryptoResolver] CoinGecko HTTP ${resp.status}`);
      return cachedPrices;
    }
    const data = await resp.json();
    cachedPrices = data;
    lastCoinGeckoFetch = now;
    return data;
  } catch (err: any) {
    console.warn(`[CryptoResolver] CoinGecko fetch error: ${err.message}`);
    return cachedPrices;
  }
}

async function fetchCryptoTotalMarketCap(): Promise<number | null> {
  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/global',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data?.total_market_cap?.usd || null;
  } catch {
    return null;
  }
}

export async function checkCryptoAutoResolve(prediction: {
  id: number;
  title: string;
  description: string;
  category: string;
  endDate: Date;
}): Promise<'yes' | 'no' | null> {
  if (prediction.category !== 'crypto') return null;

  const title = prediction.title;
  const prices = await fetchCoinGeckoPrices();
  if (Object.keys(prices).length === 0) return null;

  for (const rule of CRYPTO_PRICE_RULES) {
    if (rule.pattern.test(title)) {
      const coinData = prices[rule.coinId];
      if (!coinData) continue;
      const currentPrice = coinData.usd;

      if (rule.direction === 'above' && currentPrice >= rule.targetPrice) {
        console.log(`[CryptoResolver] ✅ ${rule.coinId} at $${currentPrice} >= target $${rule.targetPrice} → YES`);
        return 'yes';
      }

      const endTime = new Date(prediction.endDate).getTime();
      if (Date.now() > endTime) {
        console.log(`[CryptoResolver] ❌ ${rule.coinId} at $${currentPrice} < target $${rule.targetPrice} and market expired → NO`);
        return 'no';
      }

      return null;
    }
  }

  for (const rule of CRYPTO_MCAP_RULES) {
    if (rule.pattern.test(title)) {
      const [challengerId, defenderId] = rule.coinIds;
      const challenger = prices[challengerId];
      const defender = prices[defenderId];
      if (!challenger?.usd_market_cap || !defender?.usd_market_cap) continue;

      if (challenger.usd_market_cap > defender.usd_market_cap) {
        console.log(`[CryptoResolver] ✅ ${challengerId} mcap $${(challenger.usd_market_cap / 1e9).toFixed(0)}B > ${defenderId} $${(defender.usd_market_cap / 1e9).toFixed(0)}B → YES`);
        return 'yes';
      }

      const endTime = new Date(prediction.endDate).getTime();
      if (Date.now() > endTime) return 'no';
      return null;
    }
  }

  for (const rule of CRYPTO_TOTAL_MCAP_RULES) {
    if (rule.pattern.test(title)) {
      const totalMcap = await fetchCryptoTotalMarketCap();
      if (!totalMcap) continue;
      const targetUsd = rule.targetTrillion * 1e12;

      if (totalMcap >= targetUsd) {
        console.log(`[CryptoResolver] ✅ Total crypto mcap $${(totalMcap / 1e12).toFixed(2)}T >= target $${rule.targetTrillion}T → YES`);
        return 'yes';
      }

      const endTime = new Date(prediction.endDate).getTime();
      if (Date.now() > endTime) return 'no';
      return null;
    }
  }

  return null;
}
