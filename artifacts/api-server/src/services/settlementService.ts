
export interface Bet {
  id: string;
  userId: string;
  eventId: string;
  marketId: string;
  outcomeId: string;
  odds: number;
  betAmount: number;
  status: 'pending' | 'won' | 'lost' | 'void' | 'cashed_out';
  prediction: string;
  placedAt: number;
  settledAt?: number;
  potentialPayout: number;
  actualPayout?: number;
}

export interface SettlementResult {
  betId: string;
  status: 'won' | 'lost' | 'void';
  payout: number;
}

export class SettlementService {
  static settleBet(bet: Bet, eventResult: any): SettlementResult {
    const settled: SettlementResult = {
      betId: bet.id,
      status: 'lost',
      payout: 0
    };

    try {
      if (!eventResult) {
        settled.status = 'void';
        settled.payout = bet.betAmount;
        return settled;
      }

      const betWon = this.isBetWon(bet, eventResult);

      if (betWon) {
        settled.status = 'won';
        settled.payout = Math.round(bet.betAmount * bet.odds * 100) / 100;
      } else {
        settled.status = 'lost';
        settled.payout = 0;
      }

      return settled;
    } catch (error) {
      console.error('Settlement error:', error);
      settled.status = 'void';
      settled.payout = bet.betAmount;
      return settled;
    }
  }

  static calculateCashOut(bet: Bet, currentOdds: number, percentageWinning: number, gameContext?: { elapsedMinutes?: number; totalMinutes?: number; isLive?: boolean; scoreFavorable?: boolean; scoreDiff?: number; predictionType?: string }): number {
    if (bet.status !== 'pending') return 0;

    const stake = Number(bet.betAmount) || 0;
    if (stake <= 0) return 0;

    const originalOdds = Number(bet.odds) || 2.0;
    const clampedCurrentOdds = Math.max(currentOdds, 1.05);

    const oddsRatio = originalOdds / clampedCurrentOdds;

    const hedgeFactor = 0.85;
    let cashOutValue = stake * oddsRatio * hedgeFactor;

    const betAgeMs = Date.now() - (Number(bet.placedAt) || Date.now());
    const betAgeMinutes = Math.max(0, betAgeMs / (1000 * 60));

    if (gameContext && gameContext.isLive) {
      const elapsed = gameContext.elapsedMinutes || 0;
      const total = gameContext.totalMinutes || 90;
      const gameProgress = Math.min(elapsed / total, 1.0);

      if (gameProgress > 0) {
        const timeDecay = 1.0 - (gameProgress * 0.55);
        cashOutValue *= timeDecay;
      }

      const diff = gameContext.scoreDiff ?? 0;

      if (gameContext.scoreFavorable === false) {
        const absDiff = Math.abs(diff);
        let scorePenalty: number;
        if (absDiff >= 3) {
          scorePenalty = 0.03;
        } else if (absDiff === 2) {
          scorePenalty = 0.10;
        } else {
          scorePenalty = 0.25;
        }
        const lateGameMultiplier = 1.0 - (gameProgress * 0.7);
        scorePenalty *= lateGameMultiplier;
        cashOutValue *= scorePenalty;
      } else if (gameContext.scoreFavorable === true && diff !== 0) {
        const absDiff = Math.abs(diff);
        const winBoost = 1.0 + Math.min(absDiff * 0.10, 0.30);
        cashOutValue *= winBoost;
      }
    }

    if (betAgeMinutes > 2) {
      let ageDecayFactor: number;
      if (betAgeMinutes <= 30) {
        ageDecayFactor = 1.0 - (betAgeMinutes / 30) * 0.15;
      } else if (betAgeMinutes <= 60) {
        ageDecayFactor = 0.85 - ((betAgeMinutes - 30) / 30) * 0.15;
      } else if (betAgeMinutes <= 120) {
        ageDecayFactor = 0.70 - ((betAgeMinutes - 60) / 60) * 0.20;
      } else {
        const extraHours = (betAgeMinutes - 120) / 60;
        ageDecayFactor = Math.max(0.15, 0.50 - extraHours * 0.10);
      }
      cashOutValue *= ageDecayFactor;
    }

    const maxPayout = stake * originalOdds * 0.85;
    cashOutValue = Math.min(cashOutValue, maxPayout);
    cashOutValue = Math.max(0, cashOutValue);

    return Math.round(cashOutValue * 100) / 100;
  }

  static calculateParlayCashOut(
    stake: number,
    totalOdds: number,
    legs: Array<{ odds: number; won: boolean | null }>,
    betPlacedAt?: number
  ): number {
    if (stake <= 0) return 0;

    const wonLegs = legs.filter(l => l.won === true);
    const pendingLegs = legs.filter(l => l.won === null);
    const lostLegs = legs.filter(l => l.won === false);

    if (lostLegs.length > 0) return 0;

    const hedgeFactor = 0.85;

    if (pendingLegs.length === 0 && wonLegs.length === legs.length) {
      return Math.round(stake * totalOdds * hedgeFactor * 100) / 100;
    }

    const wonOddsProduct = wonLegs.reduce((acc, l) => acc * l.odds, 1);
    const pendingOddsProduct = pendingLegs.reduce((acc, l) => acc * l.odds, 1);
    const fullPayout = stake * totalOdds;

    const pendingImpliedProb = 1 / pendingOddsProduct;

    const wonProgress = wonLegs.length / legs.length;
    const wonWeight = 0.40 + wonProgress * 0.45;
    const pendingWeight = 1 - wonWeight;

    let cashOutValue = stake * wonOddsProduct * (wonWeight + pendingWeight * pendingImpliedProb) * hedgeFactor;

    if (betPlacedAt && betPlacedAt > 0) {
      const ageMs = Date.now() - betPlacedAt;
      const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
      if (ageHours > 0.5) {
        let timeDecay: number;
        if (ageHours <= 2) {
          timeDecay = 1.0 - (ageHours / 2) * 0.05;
        } else if (ageHours <= 12) {
          timeDecay = 0.95 - ((ageHours - 2) / 10) * 0.10;
        } else if (ageHours <= 48) {
          timeDecay = 0.85 - ((ageHours - 12) / 36) * 0.15;
        } else {
          const extraDays = (ageHours - 48) / 24;
          timeDecay = Math.max(0.50, 0.70 - extraDays * 0.05);
        }
        cashOutValue *= timeDecay;
      }
    }

    const minCashOut = stake * wonOddsProduct * hedgeFactor * 0.25;
    cashOutValue = Math.max(cashOutValue, minCashOut);

    const maxPayout = fullPayout * hedgeFactor;
    cashOutValue = Math.min(cashOutValue, maxPayout);
    cashOutValue = Math.max(0, cashOutValue);

    return Math.round(cashOutValue * 100) / 100;
  }

  static settleParlay(bets: Bet[], eventResults: any[]): SettlementResult {
    const settled: SettlementResult = {
      betId: `parlay-${bets.map(b => b.id).join('-')}`,
      status: 'lost',
      payout: 0
    };

    try {
      const allWon = bets.every((bet, index) => {
        const result = eventResults[index];
        return this.isBetWon(bet, result);
      });

      if (allWon) {
        settled.status = 'won';
        const parlayOdds = bets.reduce((acc, bet) => acc * bet.odds, 1);
        settled.payout = Math.round(bets[0].betAmount * parlayOdds * 100) / 100;
      } else {
        settled.status = 'lost';
        settled.payout = 0;
      }

      return settled;
    } catch (error) {
      console.error('Parlay settlement error:', error);
      settled.status = 'void';
      settled.payout = bets[0].betAmount;
      return settled;
    }
  }

  private static isBetWon(bet: Bet, eventResult: any): boolean {
    if (!eventResult) return false;

    const prediction = bet.prediction.toLowerCase();
    const result = typeof eventResult === 'string' 
      ? eventResult.toLowerCase()
      : (eventResult.result || eventResult.winner || '').toLowerCase();
    const score = typeof eventResult === 'object' ? eventResult.score : undefined;

    if (result === prediction || result === bet.outcomeId.toLowerCase()) {
      return true;
    }

    if (bet.marketId.includes('match-winner') || bet.marketId.includes('1x2')) {
      if (prediction === 'home' || prediction === '1') {
        return result === 'home' || result === '1' || (eventResult.homeScore > eventResult.awayScore);
      }
      if (prediction === 'away' || prediction === '2') {
        return result === 'away' || result === '2' || (eventResult.awayScore > eventResult.homeScore);
      }
      if (prediction === 'draw' || prediction === 'x') {
        return result === 'draw' || result === 'x' || (eventResult.homeScore === eventResult.awayScore);
      }
    }

    if (bet.marketId.includes('btts')) {
      const bothScored = (eventResult.homeScore > 0 && eventResult.awayScore > 0);
      if (prediction === 'yes') return bothScored;
      if (prediction === 'no') return !bothScored;
    }

    if (bet.marketId.includes('double-chance')) {
      const isHomeWin = eventResult.homeScore > eventResult.awayScore;
      const isAwayWin = eventResult.awayScore > eventResult.homeScore;
      const isDraw = eventResult.homeScore === eventResult.awayScore;

      if (prediction === '1x' || prediction === 'home_draw') return isHomeWin || isDraw;
      if (prediction === 'x2' || prediction === 'draw_away') return isAwayWin || isDraw;
      if (prediction === '12' || prediction === 'home_away') return isHomeWin || isAwayWin;
    }

    if (bet.marketId.includes('half-time')) {
      const htHome = eventResult.score?.halftime?.home ?? eventResult.htHomeScore;
      const htAway = eventResult.score?.halftime?.away ?? eventResult.htAwayScore;
      
      if (htHome !== undefined && htAway !== undefined) {
        if (prediction === 'home' || prediction === '1') return htHome > htAway;
        if (prediction === 'away' || prediction === '2') return htAway > htHome;
        if (prediction === 'draw' || prediction === 'x') return htHome === htAway;
      }
    }

    if (bet.marketId.includes('over-under') || bet.marketId.includes('o/u')) {
      const totalGoals = (eventResult.homeScore || 0) + (eventResult.awayScore || 0);
      const threshold = parseFloat(bet.marketId.match(/\d+\.?\d*/)?.[0] || '2.5');
      
      if (prediction.includes('over')) {
        return totalGoals > threshold;
      }
      if (prediction.includes('under')) {
        return totalGoals < threshold;
      }
    }

    return false;
  }
}
