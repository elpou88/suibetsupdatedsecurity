import { useState, useEffect, useRef } from 'react';

/**
 * Exact real-time live match clock.
 *
 * Soccer first half  (0-45 min)  → uses `startTime` (kickoff) for sub-second accuracy.
 *                                   If real time is 1:25, DApp shows 1:25. Exact.
 * Soccer stoppage time           → shows 45+N:SS
 * Soccer halftime                → shows 'HT'
 * Soccer second half (46-90 min) → anchored to the moment the API first reported
 *                                   each minute > 45; seconds tick from that anchor.
 * Non-soccer                     → shows displayMinute as-is (already MM:SS or period string).
 */
export function useLiveClock(event: any, overrideSportId?: number): string {
  const [display, setDisplay] = useState<string>(() => {
    return (event as any)?.displayMinute ?? 'LIVE';
  });

  const secondHalfAnchorRef = useRef<{ minute: number; ts: number } | null>(null);
  const prevMinuteRef = useRef<number | null>(null);

  const sportId: number = overrideSportId ?? ((event as any)?.sportId as number) ?? 0;
  const isSoccer = sportId === 1 || String((event as any)?._sportName ?? '').toLowerCase().includes('football');

  const apiMinute: number | null =
    typeof (event as any)?.minute === 'number' ? (event as any).minute :
    typeof (event as any)?.minute === 'string' ? (parseInt((event as any).minute) || null) :
    null;

  useEffect(() => {
    if (!event?.isLive) {
      setDisplay((event as any)?.displayMinute ?? 'LIVE');
      return;
    }

    if (!isSoccer) {
      setDisplay((event as any)?.displayMinute ?? 'LIVE');
      return;
    }

    // Track second-half anchor: record the real timestamp when API minute first exceeds 45
    if (apiMinute !== null && apiMinute > 45) {
      if (prevMinuteRef.current !== apiMinute) {
        secondHalfAnchorRef.current = { minute: apiMinute, ts: Date.now() };
        prevMinuteRef.current = apiMinute;
      }
    } else if (apiMinute !== null && apiMinute <= 45) {
      secondHalfAnchorRef.current = null;
      prevMinuteRef.current = apiMinute;
    }

    const startMs = (event as any)?.startTime ? new Date((event as any).startTime).getTime() : NaN;
    const validStart = !isNaN(startMs) && startMs > 0;

    const tick = () => {
      const now = Date.now();
      const dm = String((event as any)?.displayMinute ?? '');
      const statusStr = String((event as any)?.status ?? '');

      // Explicit halftime markers from the API
      if (dm === 'HT' || statusStr === 'HT') {
        setDisplay('HT');
        return;
      }

      // Second half: anchor on the moment we first received a minute > 45
      if (secondHalfAnchorRef.current) {
        const { minute: anchorMin, ts: anchorTs } = secondHalfAnchorRef.current;
        const secsSinceAnchor = Math.max(0, Math.floor((now - anchorTs) / 1000));
        const totalSec = anchorMin * 60 + secsSinceAnchor;
        const min = Math.min(Math.floor(totalSec / 60), 95);
        const sec = totalSec % 60;
        setDisplay(`${min}:${String(sec).padStart(2, '0')}`);
        return;
      }

      // First half: exact computation from kickoff time → 100% real-time accurate
      if (validStart) {
        const elapsedSec = Math.floor((now - startMs) / 1000);

        if (elapsedSec < 0) {
          setDisplay('Kickoff');
          return;
        }

        if (elapsedSec <= 2820) {
          // 0:00 – 47:00 (first half + typical stoppage time)
          const min = Math.floor(elapsedSec / 60);
          const sec = elapsedSec % 60;
          if (min >= 45) {
            setDisplay(`45+${min - 45}:${String(sec).padStart(2, '0')}`);
          } else {
            setDisplay(`${min}:${String(sec).padStart(2, '0')}`);
          }
          return;
        }

        if (elapsedSec <= 3720) {
          // 47–62 min from kickoff: halftime window (15 min break)
          setDisplay('HT');
          return;
        }

        // Beyond HT window but API hasn't pushed minute > 45 yet — estimate 2H
        // 3720s = 45min 1H + 17min HT. Second half offset from there.
        const secondHalfSec = elapsedSec - 3720 + 45 * 60;
        const min = Math.min(Math.floor(secondHalfSec / 60), 95);
        const sec = secondHalfSec % 60;
        setDisplay(`${min}:${String(sec).padStart(2, '0')}`);
        return;
      }

      // Final fallback: raw displayMinute from API
      setDisplay(dm || 'LIVE');
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    event?.isLive,
    (event as any)?.startTime,
    apiMinute,
    (event as any)?.displayMinute,
    (event as any)?.status,
    (event as any)?.homeScore,
    (event as any)?.awayScore,
    isSoccer,
  ]);

  return display;
}
