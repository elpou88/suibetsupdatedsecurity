import { useEffect, useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, X, Loader2 } from 'lucide-react';

interface OddsSnapshot {
  homeOdds: number;
  drawOdds?: number;
  awayOdds: number;
  timestamp: number;
}

interface OddsHistoryChartProps {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0b1618] border border-cyan-800/50 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-medium">
          {p.name}: {Number(p.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
};

export default function OddsHistoryChart({ eventId, homeTeam, awayTeam, onClose }: OddsHistoryChartProps) {
  const [history, setHistory] = useState<OddsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/events/${eventId}/odds-history`)
      .then(r => r.json())
      .then(data => {
        setHistory(data.history ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load odds history');
        setLoading(false);
      });
  }, [eventId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const chartData = history.map(s => ({
    time: formatTime(s.timestamp),
    [homeTeam]: s.homeOdds,
    ...(s.drawOdds ? { Draw: s.drawOdds } : {}),
    [awayTeam]: s.awayOdds,
  }));

  const hasDraw = history.some(s => s.drawOdds);

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-[#0d1f23] border border-cyan-700/50 rounded-xl shadow-2xl p-4"
      style={{ width: 320, top: '110%', left: '50%', transform: 'translateX(-50%)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-400" />
          <span className="text-xs text-cyan-300 font-semibold">Odds Movement</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading real odds data...</span>
        </div>
      )}

      {error && (
        <p className="text-center text-xs text-red-400 py-6">{error}</p>
      )}

      {!loading && !error && history.length === 0 && (
        <div className="text-center py-6">
          <p className="text-xs text-gray-400">No history yet.</p>
          <p className="text-xs text-gray-500 mt-1">Odds are recorded every 30 min from the live feed.</p>
          <p className="text-xs text-gray-500">Check back after the next update cycle.</p>
        </div>
      )}

      {!loading && !error && history.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="time"
                tick={{ fill: '#6b7280', fontSize: 9 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 9 }}
                tickLine={false}
                domain={['auto', 'auto']}
                tickFormatter={v => v.toFixed(2)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 9, paddingTop: 4 }}
                formatter={(value) => <span style={{ color: '#9ca3af', fontSize: 9 }}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey={homeTeam}
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
              {hasDraw && (
                <Line
                  type="monotone"
                  dataKey="Draw"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              )}
              <Line
                type="monotone"
                dataKey={awayTeam}
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-500 text-center mt-2">
            {history.length} snapshot{history.length !== 1 ? 's' : ''} · live paid API · updates every 30 min
          </p>
        </>
      )}
    </div>
  );
}
