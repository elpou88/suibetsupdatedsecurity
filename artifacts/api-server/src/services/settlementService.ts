
export interface Bet {
  id: string;
  userId: string;
  eventId: string;
  marketId: string;
  outcomeId: string;
  odds: number;
  betAmount: number;
  status: 'pending' | 'won' | 'lost' | 'void';
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

      if (betWon === null) {
        console.warn(`⚠️ SettlementService: Cannot determine outcome for bet ${bet.id} — voiding (refunding stake)`);
        settled.status = 'void';
        settled.payout = bet.betAmount;
      } else if (betWon) {
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

  static settleParlay(bets: Bet[], eventResults: any[]): SettlementResult {
    const settled: SettlementResult = {
      betId: `parlay-${bets.map(b => b.id).join('-')}`,
      status: 'lost',
      payout: 0
    };

    try {
      let anyLost = false;
      let anyIndeterminate = false;
      for (let i = 0; i < bets.length; i++) {
        const result = eventResults[i];
        const legResult = this.isBetWon(bets[i], result);
        if (legResult === null) {
          anyIndeterminate = true;
        } else if (!legResult) {
          anyLost = true;
        }
      }

      if (anyIndeterminate && !anyLost) {
        console.warn(`⚠️ SettlementService: Parlay has indeterminate legs — voiding (refunding stake)`);
        settled.status = 'void';
        settled.payout = bets[0].betAmount;
      } else if (anyLost) {
        settled.status = 'lost';
        settled.payout = 0;
      } else {
        settled.status = 'won';
        const parlayOdds = bets.reduce((acc, bet) => acc * bet.odds, 1);
        settled.payout = Math.round(bets[0].betAmount * parlayOdds * 100) / 100;
      }

      return settled;
    } catch (error) {
      console.error('Parlay settlement error:', error);
      settled.status = 'void';
      settled.payout = bets[0].betAmount;
      return settled;
    }
  }

  private static isBetWon(bet: Bet, eventResult: any): boolean | null {
    if (!eventResult) return null;

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

    console.warn(`⚠️ SettlementService.isBetWon: UNMATCHED — prediction="${prediction}" market="${bet.marketId}" result="${result}" — returning null (cannot determine)`);
    return null;
  }
}
