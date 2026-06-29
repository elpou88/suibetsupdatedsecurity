import { useLiveClock } from '@/hooks/useLiveClock';

interface LiveClockBadgeProps {
  event: any;
  sportId?: number;
  className?: string;
}

export function LiveClockBadge({ event, sportId, className }: LiveClockBadgeProps) {
  const clock = useLiveClock(event, sportId);
  return <span className={className}>{clock}</span>;
}
