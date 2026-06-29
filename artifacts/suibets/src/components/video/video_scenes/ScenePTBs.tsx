import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const OPS = [
  { icon: "📤", label: "Place Bet", detail: "escrow.lock($200)" },
  { icon: "🔍", label: "Verify Odds", detail: "oracle.confirm(2.10)" },
  { icon: "🔐", label: "Lock Escrow", detail: "transfer.escrow(obj)" },
  { icon: "⚽", label: "Await Result", detail: "settlement.bind(event)" },
  { icon: "💸", label: "Pay Winner", detail: "transfer.payout(sui)" },
];

export function ScenePTBs() {
  const [phase, setPhase] = useState(0);
  const [bundled, setBundled] = useState(false);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 300),
      setTimeout(() => { setPhase(3); setBundled(true); }, 2000),
      setTimeout(() => setPhase(4), 2500),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ background: "#040D21" }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(77,162,255,0.07) 0%, transparent 65%)" }} />

      <motion.div className="absolute top-[5%] left-0 right-0 flex justify-center"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.6rem, 1.3vw, 0.8rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            07 — PROGRAMMABLE TRANSACTION BLOCKS
          </span>
        </div>
      </motion.div>

      <div className="relative z-10 flex flex-col items-center gap-3 w-[90%] max-w-sm">
        {!bundled ? (
          <div className="flex flex-col gap-1.5 w-full">
            {OPS.map((op, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0 }}
                transition={{ delay: i * 0.1, duration: 0.3 }}
                className="flex items-center gap-3 rounded-lg px-3"
                style={{
                  height: "clamp(28px, 5.5vh, 40px)",
                  background: "rgba(77,162,255,0.06)",
                  border: "1px solid rgba(77,162,255,0.2)",
                }}
              >
                <span style={{ fontSize: "clamp(0.7rem, 1.5vw, 1rem)" }}>{op.icon}</span>
                <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.5rem, 1.1vw, 0.7rem)", fontWeight: 700, color: "#F0F8FF", flex: 1 }}>{op.label}</span>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.8vw, 0.55rem)", color: "rgba(111,188,240,0.6)" }}>{op.detail}</span>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="w-full rounded-xl flex flex-col items-center justify-center text-center"
            style={{
              padding: "clamp(16px, 3vh, 28px)",
              background: "rgba(0,255,178,0.08)",
              border: "2px solid rgba(0,255,178,0.4)",
              boxShadow: "0 0 30px rgba(0,255,178,0.15)",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1rem, 3.5vw, 2rem)", fontWeight: 900, color: "#00FFB2", letterSpacing: "-0.02em" }}>
              5 OPS. 1 TX.
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.85vw, 0.6rem)", color: "rgba(0,255,178,0.6)", marginTop: 6 }}>
              DIGEST: 0xDzBUvi...wLSja
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.85vw, 0.6rem)", color: "rgba(0,255,178,0.6)" }}>
              ATOMIC · INSTANT · TRUSTLESS
            </p>
          </motion.div>
        )}

        <motion.p
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.35 }}
          style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.6rem, 1.4vw, 0.85rem)", fontWeight: 700, color: "rgba(111,188,240,0.8)", textAlign: "center" }}
        >
          Full bet lifecycle in a single atomic call.
        </motion.p>
      </div>
    </motion.div>
  );
}
