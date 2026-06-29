/**
 * Validation Schemas for SuiBets API
 */

import { z } from 'zod';

// Bet amount validation - min 0.02 SUI/SBETS, high cap to allow SBETS bets (enforced per-currency at runtime)
export const BetAmountSchema = z.number()
  .min(0.02, 'Minimum bet is 0.02 SUI / 100 SBETS')
  .positive('Bet amount must be positive');

// Odds validation - between 1.01 and 260 (futures markets can have high odds; runtime caps per event type)
export const OddsSchema = z.number()
  .min(1.01, 'Minimum odds is 1.01')
  .max(260, 'Maximum odds is 260')
  .positive('Odds must be positive');

// Bet placement schema
export const PlaceBetSchema = z.object({
  userId: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  walletAddress: z.string().optional(),
  eventId: z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().min(1, 'Event ID required')),
  eventName: z.string().optional(), // Event name for bet history display
  homeTeam: z.string().optional(), // Home team name for settlement matching
  awayTeam: z.string().optional(), // Away team name for settlement matching
  sportName: z.string().optional(),
  leagueName: z.string().optional(),
  matchDate: z.string().optional(),
  marketId: z.string().optional().default('match_winner'),
  outcomeId: z.string().optional().default('selection'),
  odds: OddsSchema,
  betAmount: BetAmountSchema,
  currency: z.enum(['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC']).optional(),
  prediction: z.string().min(1, 'Prediction required'),
  potentialPayout: z.number().optional(),
  feeCurrency: z.enum(['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC']).optional().default('SBETS'),
  paymentMethod: z.enum(['platform', 'wallet', 'free_bet']).optional().default('platform'),
  txHash: z.string().optional(), // For wallet/on-chain bets
  onChainBetId: z.string().optional(), // Sui bet object ID
  status: z.enum(['pending', 'confirmed', 'settled', 'cancelled']).optional().default('pending'),
  isLive: z.boolean().optional(), // Whether this is a live match
  matchMinute: z.number().optional(), // Current match minute for live matches (betting blocked >= 80)
  useBonus: z.boolean().optional().default(false), // Whether to use promo bonus balance
  useFreeBet: z.boolean().optional().default(false) // Whether to use welcome/referral SBETS bonus
});

// Parlay schema
export const ParlaySchema = z.object({
  userId: z.string().optional(),
  selections: z.array(
    z.object({
      eventId: z.string(),
      odds: OddsSchema,
      prediction: z.string()
    })
  ).min(2, 'Parlay requires at least 2 selections').max(10, 'Maximum 10 selections per parlay'),
  betAmount: BetAmountSchema,
  currency: z.enum(['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC']).optional(),
  feeCurrency: z.enum(['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC']).optional().default('SBETS')
});

// Withdrawal limits per currency (single source of truth)
export const WITHDRAW_LIMITS = {
  SUI:    { min: 0.1,  max: 10_000 },
  SBETS:  { min: 1,    max: 2_000_000 },
  USDSUI: { min: 0.01, max: 10_000 },
} as const;

// Withdrawal schema — coerce amount from string/number to handle mobile form inputs
export const WithdrawSchema = z.object({
  userId: z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().min(1, 'User ID required')),
  walletAddress: z.string().min(1, 'Wallet address required'),
  amount: z.union([z.number(), z.string().transform(v => parseFloat(v))]).pipe(z.number().positive('Amount must be positive').finite('Amount must be a valid number')),
  currency: z.enum(['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC']).default('SUI'),
}).superRefine((data, ctx) => {
  if (isNaN(data.amount)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be a valid number' });
    return;
  }
  const limits = WITHDRAW_LIMITS[data.currency];
  if (data.amount < limits.min) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Minimum ${data.currency} withdrawal is ${limits.min}` });
  }
  if (data.amount > limits.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Maximum ${data.currency} withdrawal is ${limits.max.toLocaleString()}` });
  }
});

// Settlement schema
export const SettleSchema = z.object({
  eventResult: z.object({
    eventId: z.string(),
    result: z.string(),
    homeScore: z.number().optional(),
    awayScore: z.number().optional(),
    winner: z.string().optional()
  })
});


/**
 * Validate request data
 */
export function validateRequest<T>(schema: z.ZodSchema<T>, data: any): { valid: boolean; errors?: string[]; data?: T } {
  try {
    const validated = schema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { valid: false, errors };
    }
    return { valid: false, errors: ['Validation error'] };
  }
}

export default {
  BetAmountSchema,
  OddsSchema,
  PlaceBetSchema,
  ParlaySchema,
  WithdrawSchema,
  SettleSchema,
  validateRequest
};
