import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const OLD_TXS = [
  { label: "settle_leg_1()", gas: "2,000,000" },
  { label: "settle_leg_2()", gas: "2,000,000" },
  { label: "settle_leg_3()", gas: "2,000,000" },
  { label: "settle_leg_4()", gas: "2,000,000" },
  { label: "queue_finalize()", gas: "2,000,000" },
  { label: "claim_payout()", gas: "2,000,000" },
];

export function WarpScene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 2800),
      setTimeout(() => setPhase(4), 4200),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.35 }}
    >
      <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#04060d 0%,#080f1a 100%)" }} />

      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: "linear-gradient(#00e5ff 1px,transparent 1px),linear-gradient(90deg,#00e5ff 1px,transparent 1px)", backgroundSize: "60px 60px" }} />

      {/* Title */}
      <motion.div
        className="absolute top-[10%] left-0 right-0 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem,1.1vw,0.72rem)", color: "#ff6b00", letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 700 }}>
          The old way
        </div>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.2rem,3vw,2rem)", color: "#fff", fontWeight: 800, marginTop: "0.25rem", letterSpacing: "-0.02em" }}>
          One parlay. Six transactions.
        </div>
      </motion.div>

      {/* TX chain */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pt-8">
        {OLD_TXS.map((tx, i) => (
          <motion.div
            key={tx.label}
            className="flex items-center gap-3 rounded-lg px-4 py-2"
            style={{ background: "rgba(255,107,0,0.07)", border: "1px solid rgba(255,107,0,0.25)", minWidth: "min(420px,80vw)" }}
            initial={{ opacity: 0, x: -40 }}
            animate={phase >= 2 ? { opacity: phase >= 4 ? 0 : 1, x: phase >= 4 ? 40 : 0 } : { opacity: 0, x: -40 }}
            transition={{ duration: phase >= 4 ? 0.3 : 0.4, delay: phase >= 2 ? i * 0.09 : 0, ease: [0.16, 1, 0.3, 1] }}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff6b00", flexShrink: 0 }} />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.6rem,1.3vw,0.82rem)", color: "#ff9c52", flex: 1 }}>{tx.label}</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.7rem)", color: "rgba(255,107,0,0.55)" }}>{tx.gas} gas</span>
          </motion.div>
        ))}

        {/* Total */}
        <motion.div
          className="flex items-center gap-3 rounded-lg px-4 py-2 mt-1"
          style={{ background: "rgba(255,107,0,0.14)", border: "1px solid rgba(255,107,0,0.5)", minWidth: "min(420px,80vw)" }}
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: phase >= 4 ? 0 : 1 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff4040", flexShrink: 0 }} />
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.7rem,1.4vw,0.9rem)", color: "#ff4040", fontWeight: 800, flex: 1 }}>
            TOTAL: 6 txs · 12,000,000 gas
          </span>
          <span style={{ fontSize: "1rem" }}>😤</span>
        </motion.div>
      </div>

      {/* Exit flash */}
      <motion.div
        className="absolute inset-0"
        style={{ background: "#ff6b00", pointerEvents: "none" }}
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: [0, 0.12, 0] } : { opacity: 0 }}
        transition={{ duration: 0.5 }}
      />
    </motion.div>
  );
}
