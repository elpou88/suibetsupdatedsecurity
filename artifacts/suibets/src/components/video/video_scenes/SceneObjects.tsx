import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const BETS = [
  { sport: "⚽", match: "PSG vs Bayern", stake: "$500", status: "PENDING", odds: "2.10×", obj: "0x7f3a...c821" },
  { sport: "🏀", match: "Lakers vs Warriors", stake: "$200", status: "SETTLED", odds: "1.85×", obj: "0x2b1d...f43e" },
  { sport: "🏈", match: "Chiefs vs Eagles", stake: "$1,000", status: "PAID", odds: "3.20×", obj: "0x9c4e...a1b2" },
  { sport: "🎾", match: "Djokovic vs Alcaraz", stake: "$150", status: "PENDING", odds: "1.60×", obj: "0x5f8c...d790" },
  { sport: "⚾", match: "Yankees vs Red Sox", stake: "$300", status: "SETTLED", odds: "2.45×", obj: "0x1e6a...3c09" },
];

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#FFB300",
  SETTLED: "#4DA2FF",
  PAID: "#00FFB2",
};

export function SceneObjects() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 80),
      setTimeout(() => setPhase(2), 350),
      setTimeout(() => setPhase(3), 2100),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      style={{ background: "#040D21", display: "grid", gridTemplateRows: "auto 1fr auto", padding: "5% 6% 4%" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3 }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 35%, rgba(77,162,255,0.09) 0%, transparent 60%)" }} />

      {/* Header badge */}
      <motion.div
        className="relative z-10 flex justify-center"
        initial={{ opacity: 0, y: -10 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: "3vh" }}
      >
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.55rem, 1.3vw, 0.82rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            02 — OBJECT-CENTRIC MODEL
          </span>
        </div>
      </motion.div>

      {/* Bet cards — fills available middle space */}
      <div className="relative z-10 flex flex-col justify-around" style={{ gap: "clamp(8px, 1.8vh, 18px)" }}>
        {BETS.map((bet, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, x: i % 2 === 0 ? -60 : 60, rotateY: i % 2 === 0 ? -10 : 10 }}
            animate={phase >= 2 ? { opacity: 1, x: 0, rotateY: 0 } : { opacity: 0 }}
            transition={{ delay: i * 0.13, duration: 0.45, type: "spring", stiffness: 280, damping: 26 }}
            style={{ perspective: 700 }}
          >
            <div
              className="flex items-center rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${STATUS_COLOR[bet.status]}40`,
                boxShadow: `0 4px 20px ${STATUS_COLOR[bet.status]}12`,
                padding: "clamp(10px, 2vh, 18px) clamp(12px, 2.5vw, 24px)",
              }}
            >
              <span style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)", marginRight: "clamp(10px, 2vw, 20px)", flexShrink: 0 }}>{bet.sport}</span>
              <div className="flex-1 min-w-0">
                <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.65rem, 1.5vw, 1rem)", fontWeight: 700, color: "#F0F8FF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {bet.match}
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.4rem, 0.9vw, 0.6rem)", color: "rgba(111,188,240,0.5)", marginTop: 3 }}>
                  Object ID · {bet.obj}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.65rem, 1.4vw, 0.95rem)", fontWeight: 700, color: "#F0F8FF" }}>{bet.stake}</span>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem, 0.9vw, 0.62rem)", color: "rgba(200,220,255,0.45)" }}>{bet.odds}</span>
                <div className="px-2 py-1 rounded-full flex-shrink-0"
                  style={{ background: `${STATUS_COLOR[bet.status]}18`, border: `1px solid ${STATUS_COLOR[bet.status]}60` }}>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.4rem, 0.85vw, 0.58rem)", color: STATUS_COLOR[bet.status], fontWeight: 700 }}>
                    {bet.status}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Footer tagline */}
      <motion.div
        className="relative z-10 text-center"
        style={{ marginTop: "3vh" }}
        initial={{ opacity: 0, y: 14 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0 }}
        transition={{ duration: 0.4, type: "spring", stiffness: 300 }}
      >
        <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1rem, 3vw, 1.9rem)", fontWeight: 900, color: "#F0F8FF", letterSpacing: "-0.02em" }}>
          Every bet is an <span style={{ color: "#4DA2FF" }}>object</span>. Owned by <span style={{ color: "#00FFB2" }}>you</span>.
        </p>
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.42rem, 0.95vw, 0.62rem)", color: "rgba(111,188,240,0.55)", marginTop: 6 }}>
          Not a database entry. A first-class Sui object with on-chain ownership.
        </p>
      </motion.div>
    </motion.div>
  );
}
