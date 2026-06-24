import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const BEFORE_TXS = [
  "settle_leg(parlay, 0)",
  "settle_leg(parlay, 1)",
  "settle_leg(parlay, 2)",
  "settle_leg(parlay, 3)",
  "settle_leg(parlay, 4)",
  "settle_leg(parlay, 5)",
  "settle_leg(parlay, 6)",
  "settle_leg(parlay, 7)",
  "queue_finalize(parlay)",
  "claim_payout(parlay)",
];

const AFTER_LINES = [
  "warp_settle_parlay_atomic(",
  "  oracle_cap,",
  "  parlay,",
  "  [T,T,F,T,T,T,F,T],",
  "  []",
  ")",
];

export function WarpScene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 2400),
      setTimeout(() => setPhase(4), 3600),
      setTimeout(() => setPhase(5), 5000),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.35 }}
    >
      <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#04060d 0%,#06091a 100%)" }} />
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(#bf5fff 1px,transparent 1px),linear-gradient(90deg,#bf5fff 1px,transparent 1px)", backgroundSize: "50px 50px" }} />

      {/* Label */}
      <motion.div
        className="absolute top-[8%] left-0 right-0 text-center"
        initial={{ opacity: 0, y: -16 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -16 }}
        transition={{ duration: 0.45 }}
      >
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "#bf5fff", letterSpacing: "0.25em", textTransform: "uppercase" }}>
          Atomic Parlay Settlement
        </span>
      </motion.div>

      {/* Before / After split */}
      <div className="relative z-10 flex items-start justify-center gap-6" style={{ maxWidth: "min(900px,90vw)", width: "100%" }}>

        {/* BEFORE */}
        <motion.div
          style={{ flex: 1, minWidth: 0 }}
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 2 ? { opacity: phase >= 3 ? 0.35 : 1, x: 0 } : { opacity: 0, x: -30 }}
          transition={{ duration: 0.5 }}
        >
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "#ff4040", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "0.6rem", fontWeight: 700 }}>
            ✗ Before — 10 txs
          </div>
          {BEFORE_TXS.map((tx, i) => (
            <motion.div
              key={tx}
              className="rounded px-3 py-1.5 mb-1"
              style={{ background: "rgba(255,64,64,0.07)", border: "1px solid rgba(255,64,64,0.2)" }}
              initial={{ opacity: 0, x: -10 }}
              animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
              transition={{ duration: 0.25, delay: i * 0.06 }}
            >
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem,0.9vw,0.62rem)", color: "#ff6b6b" }}>
                {tx}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* Arrow */}
        <motion.div
          className="flex-shrink-0 flex flex-col items-center justify-center pt-8"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
        >
          <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.5rem,4vw,2.5rem)", color: "#00e5ff", fontWeight: 900 }}>→</div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem,0.9vw,0.62rem)", color: "rgba(0,229,255,0.6)", textAlign: "center", marginTop: 4, letterSpacing: "0.1em" }}>
            WARP
          </div>
        </motion.div>

        {/* AFTER */}
        <motion.div
          style={{ flex: 1, minWidth: 0 }}
          initial={{ opacity: 0, x: 30 }}
          animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
          transition={{ duration: 0.5 }}
        >
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "#00e5ff", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "0.6rem", fontWeight: 700 }}>
            ✓ After — 1 tx
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(0,229,255,0.07)", border: "1px solid rgba(0,229,255,0.3)" }}>
            {AFTER_LINES.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
              >
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem,0.9vw,0.62rem)", color: i === 0 ? "#00e5ff" : "rgba(0,229,255,0.7)" }}>
                  {line}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Bottom savings */}
      <motion.div
        className="absolute bottom-[9%] left-0 right-0 flex justify-center gap-5"
        initial={{ opacity: 0, y: 16 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.45 }}
      >
        {[
          { label: "4-leg parlay", stat: "-83%", sub: "gas saved" },
          { label: "8-leg parlay", stat: "-90%", sub: "gas saved" },
          { label: "transactions", stat: "10 → 1", sub: "per parlay" },
        ].map(({ label, stat, sub }) => (
          <div key={label} className="rounded-xl px-4 py-2 text-center" style={{ background: "rgba(191,95,255,0.08)", border: "1px solid rgba(191,95,255,0.25)" }}>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem,0.9vw,0.6rem)", color: "rgba(191,95,255,0.7)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
            <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1rem,2.5vw,1.6rem)", color: "#bf5fff", fontWeight: 900 }}>{stat}</div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.4rem,0.8vw,0.55rem)", color: "rgba(191,95,255,0.5)", letterSpacing: "0.1em" }}>{sub}</div>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
