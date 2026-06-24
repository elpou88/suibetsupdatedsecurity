import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const PRIMITIVES = [
  { name: "zkLogin", sub: "Google · Apple → wallet", color: "#06b6d4", icon: "ZK" },
  { name: "Walrus", sub: "Decentralised bet receipts", color: "#f59e0b", icon: "W" },
  { name: "DeepBook v3", sub: "Limit orders · price discovery", color: "#a78bfa", icon: "DB" },
  { name: "PTBs", sub: "5 ops → 1 atomic TX", color: "#34d399", icon: "PTB" },
  { name: "SuiNS", sub: "@handle VIP gating", color: "#f472b6", icon: "NS" },
  { name: "Mysticeti v2", sub: "DAG-BFT · 35% boost", color: "#60a5fa", icon: "M2" },
];

export function SceneSuiStack() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 150),
      setTimeout(() => setPhase(2), 400),
      setTimeout(() => setPhase(3), 700),
      setTimeout(() => setPhase(4), 1000),
      setTimeout(() => setPhase(5), 1300),
      setTimeout(() => setPhase(6), 1600),
      setTimeout(() => setPhase(7), 1900),
      setTimeout(() => setPhase(8), 3400),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ clipPath: "circle(0% at 50% 50%)" }}
      animate={{ clipPath: "circle(75% at 50% 50%)" }}
      exit={{ opacity: 0, scale: 1.06 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.p
        style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem,0.9vw,0.7rem)", color: "rgba(255,255,255,0.38)", letterSpacing: "0.28em", marginBottom: "clamp(1.2rem,3vh,2.2rem)" }}
        initial={{ opacity: 0 }}
        animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.4 }}
      >
        BUILT ON SUI PRIMITIVES
      </motion.p>

      {/* Primitives grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "clamp(0.5rem,1.2vw,1rem)", width: "clamp(22rem,68vw,56rem)" }}>
        {PRIMITIVES.map((p, i) => (
          <motion.div
            key={p.name}
            style={{
              borderRadius: "0.75rem",
              padding: "clamp(0.8rem,1.8vw,1.3rem)",
              background: `${p.color}09`,
              border: `1px solid ${p.color}28`,
              display: "flex",
              alignItems: "flex-start",
              gap: "0.7rem",
            }}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={phase >= i + 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <div style={{
              width: "clamp(2rem,3.5vw,2.6rem)", height: "clamp(2rem,3.5vw,2.6rem)",
              borderRadius: "0.5rem", background: `${p.color}18`, border: `1px solid ${p.color}35`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.42rem,0.65vw,0.55rem)", color: p.color, fontWeight: 700, letterSpacing: "0.05em" }}>
                {p.icon}
              </span>
            </div>
            <div>
              <p style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: "clamp(0.75rem,1.3vw,1rem)", color: "#fff", marginBottom: "0.2rem" }}>
                {p.name}
              </p>
              <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.58rem,0.9vw,0.72rem)", color: "rgba(255,255,255,0.42)", lineHeight: 1.3 }}>
                {p.sub}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Bottom line */}
      <motion.p
        style={{
          fontFamily: "Space Grotesk, sans-serif", fontWeight: 700,
          fontSize: "clamp(1rem,2vw,1.5rem)", color: "#fff",
          marginTop: "clamp(1.2rem,3vh,2.4rem)", letterSpacing: "-0.01em",
        }}
        initial={{ opacity: 0, y: 14 }}
        animate={phase >= 8 ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ duration: 0.45 }}
      >
        The deepest Sui integration{" "}
        <span style={{ color: "#06b6d4" }}>in sports betting.</span>
      </motion.p>
    </motion.div>
  );
}
