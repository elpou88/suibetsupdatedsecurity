import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const ENGINES = [
  {
    name: "p2p_betting",
    tag: "CORE CONTRACT",
    desc: "P2P escrow · Oracle settlement",
    address: "0xd51fe151...b2e59",
    color: "#06b6d4",
    bg: "rgba(6,182,212,0.07)",
    border: "rgba(6,182,212,0.25)",
  },
  {
    name: "WARP",
    tag: "BATCH ENGINE",
    desc: "512 bets per TX · TTO escrow",
    address: "0x9c36e734...9747",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.07)",
    border: "rgba(245,158,11,0.22)",
  },
  {
    name: "FLUX",
    tag: "FRACTIONAL FILLS",
    desc: "Partial order matching · Deep liquidity",
    address: "0xfa76c707...3018",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.07)",
    border: "rgba(167,139,250,0.22)",
  },
  {
    name: "PULSE",
    tag: "PARI-MUTUEL AMM",
    desc: "Dynamic odds · Pool-based",
    address: "0x6ac71a60...e238",
    color: "#34d399",
    bg: "rgba(52,211,153,0.07)",
    border: "rgba(52,211,153,0.22)",
  },
];

export function SceneEngines() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 150),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1050),
      setTimeout(() => setPhase(4), 1500),
      setTimeout(() => setPhase(5), 1950),
      setTimeout(() => setPhase(6), 3200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.45 }}
    >
      <motion.p
        style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem,0.9vw,0.7rem)", color: "rgba(255,255,255,0.35)", letterSpacing: "0.28em", marginBottom: "clamp(1.5rem,3.5vh,2.8rem)" }}
        initial={{ opacity: 0, y: -8 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
        transition={{ duration: 0.4 }}
      >
        4 ENGINES · SUI MAINNET
      </motion.p>

      {/* Engine cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "clamp(0.6rem,1.5vw,1.1rem)", width: "clamp(22rem,72vw,60rem)" }}>
        {ENGINES.map((eng, i) => (
          <motion.div
            key={eng.name}
            style={{
              borderRadius: "0.85rem",
              padding: "clamp(0.9rem,2vw,1.4rem)",
              background: eng.bg,
              border: `1px solid ${eng.border}`,
              backdropFilter: "blur(10px)",
              position: "relative",
              overflow: "hidden",
            }}
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={phase >= i + 2 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.88, y: 24 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
          >
            {/* Glow accent */}
            <motion.div
              style={{
                position: "absolute", top: "-30%", right: "-20%",
                width: "50%", height: "140%", borderRadius: "50%",
                background: `radial-gradient(circle, ${eng.color}22, transparent 70%)`,
                pointerEvents: "none",
              }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <p style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 800, fontSize: "clamp(1.1rem,2.2vw,1.6rem)", color: eng.color, lineHeight: 1 }}>
                {eng.name}
              </p>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.42rem,0.62vw,0.52rem)", color: eng.color, letterSpacing: "0.18em", background: `${eng.color}18`, border: `1px solid ${eng.color}30`, borderRadius: "0.35rem", padding: "0.15rem 0.4rem", whiteSpace: "nowrap" }}>
                {eng.tag}
              </span>
            </div>
            <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.65rem,1.1vw,0.85rem)", color: "rgba(255,255,255,0.55)", marginBottom: "0.7rem" }}>
              {eng.desc}
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.42rem,0.62vw,0.52rem)", color: "rgba(255,255,255,0.28)", letterSpacing: "0.06em" }}>
              {eng.address}
            </p>

            {/* Bottom progress bar */}
            <motion.div
              style={{ position: "absolute", bottom: 0, left: 0, height: "2px", background: eng.color, borderRadius: "0 0 0.85rem 0.85rem" }}
              initial={{ scaleX: 0, originX: 0 }}
              animate={phase >= i + 2 ? { scaleX: 1 } : { scaleX: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Bottom label */}
      <motion.p
        style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: "clamp(1rem,2.2vw,1.6rem)", color: "#fff", marginTop: "clamp(1.2rem,3vh,2.2rem)", letterSpacing: "-0.01em" }}
        initial={{ opacity: 0 }}
        animate={phase >= 6 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        One platform.{" "}
        <span style={{ color: "#06b6d4" }}>Every model.</span>
      </motion.p>
    </motion.div>
  );
}
