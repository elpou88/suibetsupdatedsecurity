import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const STATS = [
  { value: "4", label: "ENGINES", color: "#06b6d4" },
  { value: "40+", label: "DB TABLES", color: "#f59e0b" },
  { value: "3", label: "UPGRADES", color: "#a78bfa" },
];

export function SceneStats() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 900),
      setTimeout(() => setPhase(4), 1300),
      setTimeout(() => setPhase(5), 2200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08 }}
      transition={{ duration: 0.4 }}
    >
      {/* Stats row */}
      <div style={{ display: "flex", gap: "clamp(2rem,6vw,5rem)", alignItems: "center", marginBottom: "clamp(2rem,5vh,4rem)" }}>
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            style={{ textAlign: "center" }}
            initial={{ opacity: 0, scale: 0.7, y: 30 }}
            animate={phase >= i + 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.7, y: 30 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
          >
            <p style={{
              fontFamily: "Space Grotesk, sans-serif", fontWeight: 900,
              fontSize: "clamp(3.5rem,10vw,8rem)", color: s.color, lineHeight: 1,
              letterSpacing: "-0.03em",
            }}>
              {s.value}
            </p>
            <p style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "clamp(0.5rem,0.8vw,0.65rem)", color: "rgba(255,255,255,0.38)",
              letterSpacing: "0.22em", marginTop: "0.3rem",
            }}>
              {s.label}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Divider */}
      <motion.div
        style={{ width: "clamp(14rem,38vw,30rem)", height: "1px", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)", marginBottom: "clamp(1.5rem,3.5vh,3rem)" }}
        initial={{ scaleX: 0 }}
        animate={phase >= 4 ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Contract address */}
      <motion.div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem" }}
        initial={{ opacity: 0, y: 16 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.4 }}
      >
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.75vw,0.62rem)", color: "rgba(255,255,255,0.28)", letterSpacing: "0.18em" }}>
          SUI MAINNET
        </p>
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.52rem,0.82vw,0.65rem)", color: "#06b6d4", letterSpacing: "0.06em" }}>
          0xd51fe151bec66a15b086a67c1cfce9b05759ddac...
        </p>
      </motion.div>
    </motion.div>
  );
}
