import { Info } from "lucide-react";

interface BettingLimitsNoticeProps {
  borderColor?: string;
  textColor?: string;
  mutedColor?: string;
}

export default function BettingLimitsNotice({ 
  borderColor = "border-[#04363E]",
  textColor = "text-gray-500",
  mutedColor = "text-gray-600"
}: BettingLimitsNoticeProps) {
  return (
    <div className={`mt-6 pt-4 border-t ${borderColor}`}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <Info size={12} className={`${mutedColor} flex-shrink-0`} />
          <span className={`text-[11px] font-medium ${textColor} uppercase tracking-wider`}>Betting Limits & Fair Play</span>
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5 text-[11px] ${mutedColor} leading-relaxed`}>
          <span>Maximum 7 bets per wallet per 24 hours</span>
          <span>Maximum 3 bets per match per wallet</span>
          <span>Max single bet odds: 7.0x</span>
          <span>Max stake: 1,000,000 SBETS or 100 SUI per bet</span>
          <span>Max payout: 15,000,000 SBETS or 150 SUI per bet</span>
          <span>Max combined parlay odds: 15.0x</span>
          <span>Parlays: each leg capped at 7.0x odds</span>
          <span>Live bets close at 85th minute (football)</span>
          <span>All odds sourced and verified by API-Sports</span>
          <span>Bets settled automatically when matches finish</span>
          <span>Unsettled bets voided after 48 hours</span>
          <span>All transactions recorded on Sui blockchain</span>
        </div>
        <p className={`text-[10px] ${mutedColor} mt-2`}>
          SuiBets reserves the right to void bets placed under irregular conditions. Odds are subject to change up until bet confirmation. 
          All limits are enforced on-chain and server-side for fair play. By placing a bet, you agree to these terms.
        </p>
      </div>
    </div>
  );
}
