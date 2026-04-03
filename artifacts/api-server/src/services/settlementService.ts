
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

  static calculateCashOut(bet: Bet, currentOdds: number, percentageWinning: number): number {
    if (bet.status !== 'pending') return 0;

    const stake = Number(bet.betAmount) || 0;
    if (stake <= 0) return 0;

    const originalOdds = Number(bet.odds) || 2.0;
    const clampedCurrentOdds = Math.max(currentOdds, 1.05);

    const oddsRatio = originalOdds / clampedCurrentOdds;

    const hedgeFactor = 0.85;
    let cashOutValue = stake * oddsRatio * hedgeFactor;

    const maxPayout = stake * originalOdds * 0.85;
    cashOutValue = Math.min(cashOutValue, maxPayout);
    cashOutValue = Math.max(cashOutValue, 0);

    return Math.round(cashOutValue * 100) / 100;
  }

  static calculateParlayCashOut(
    stake: number,
    totalOdds: number,
    legs: Array<{ odds: number; won: boolean | null }>
  ): number {
    if (stake <= 0) return 0;

    const wonLegs = legs.filter(l => l.won === true);
    const pendingLegs = legs.filter(l => l.won === null);
    const lostLegs = legs.filter(l => l.won === false);

    if (lostLegs.length > 0) return 0;

    if (pendingLegs.length === 0 && wonLegs.length === legs.length) {
      return Math.round(stake * totalOdds * 0.85 * 100) / 100;
    }

    const wonOddsProduct = wonLegs.reduce((acc, l) => acc * l.odds, 1);
    const pendingOddsProduct = pendingLegs.reduce((acc, l) => acc * l.odds, 1);
    const fullPayout = stake * totalOdds;

    const pendingImpliedProb = 1 / pendingOddsProduct;

    const hedgeFactor = 0.85;
    let cashOutValue = stake * wonOddsProduct * (0.5 + 0.5 * pendingImpliedProb) * hedgeFactor;

    const minCashOut = stake * wonOddsProduct * hedgeFactor * 0.3;
    cashOutValue = Math.max(cashOutValue, minCashOut);

    const maxPayout = fullPayout * hedgeFactor;
    cashOutValue = Math.min(cashOutValue, maxPayout);
    cashOutValue = Math.max(cashOutValue, 0);

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
