import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const FEATURES = [
  "Parallel Execution", "Object-Centric", "zkLogin",
  "Sub-second Finality", "SuiNS", "Sponsored Tx", "PTBs", "Move Safety",
];

export function SceneOutro() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1400),
      setTimeout(() => setPhase(4), 2600),
      setTimeout(() => setPhase(5), 3500),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex flex-col items-center justify-between"
      style={{ background: "#040D21", padding: "6% 8%" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Background radial */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(77,162,255,0.1) 0%, rgba(0,255,178,0.05) 40%, transparent 70%)" }}
      />

      {/* Feature orbit pills */}
      {FEATURES.map((f, i) => {
        const angle = (i / FEATURES.length) * Math.PI * 2 - Math.PI / 2;
        const rx = 42, ry = 36;
        const x = 50 + Math.cos(angle) * rx;
        const y = 50 + Math.sin(angle) * ry;
        return (
          <motion.div key={i}
            className="absolute px-2 py-0.5 rounded-full pointer-events-none"
            style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)", zIndex: 1,
              background: "rgba(77,162,255,0.07)", border: "1px solid rgba(77,162,255,0.22)" }}
            initial={{ opacity: 0, scale: 0 }}
            animate={phase >= 1 ? { opacity: 0.55, scale: 1 } : { opacity: 0, scale: 0 }}
            transition={{ delay: i * 0.07, type: "spring", stiffness: 350 }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.3rem, 0.65vw, 0.48rem)", color: "#4DA2FF", whiteSpace: "nowrap" }}>{f}</span>
          </motion.div>
        );
      })}

      {/* Spacer top */}
      <div />

      {/* Center logo + tagline */}
      <div className="relative z-10 flex flex-col items-center gap-5">
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={phase >= 2 ? { scale: 1, opacity: 1 } : { opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="flex items-center gap-4"
        >
          <div className="rounded-full flex items-center justify-center flex-shrink-0"
            style={{ width: "clamp(44px, 9vw, 70px)", height: "clamp(44px, 9vw, 70px)", background: "linear-gradient(135deg, #4DA2FF, #00FFB2)", boxShadow: "0 0 30px rgba(77,162,255,0.4)" }}>
            <span style={{ fontSize: "clamp(1.4rem, 3.2vw, 2.4rem)", fontWeight: 900, color: "#040D21" }}>S</span>
          </div>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(2.5rem, 8vw, 5.5rem)", fontWeight: 900, color: "#F0F8FF", letterSpacing: "-0.04em" }}>
            SuiBets
          </span>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.85rem, 2.8vw, 1.8rem)", fontWeight: 700, color: "#F0F8FF", opacity: 0.88, textAlign: "center" }}
        >
          P2P Betting. Zero House Edge.{" "}
          <span style={{ color: "#00FFB2" }}>Sui Fast.</span>
        </motion.p>

        <motion.div
          initial={{ scaleX: 0 }}
          animate={phase >= 3 ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: 2, width: "clamp(100px, 24vw, 200px)", background: "linear-gradient(90deg, transparent, #4DA2FF, #00FFB2, transparent)" }}
        />

        <motion.p
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem, 1.1vw, 0.72rem)", color: "rgba(111,188,240,0.65)", letterSpacing: "0.08em" }}
        >
          SuiBets · Built on Sui
        </motion.p>
      </div>

      {/* Bottom: all 8 tech points */}
      <motion.div
        className="relative z-10 flex flex-wrap justify-center"
        style={{ gap: "clamp(4px, 0.8vw, 8px)" }}
        initial={{ opacity: 0, y: 16 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0 }}
        transition={{ duration: 0.45 }}
      >
        {FEATURES.map((f, i) => (
          <div key={i} className="px-2 py-1 rounded-full"
            style={{ background: "rgba(0,255,178,0.08)", border: "1px solid rgba(0,255,178,0.25)" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.35rem, 0.75vw, 0.52rem)", color: "rgba(0,255,178,0.7)" }}>{f}</span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
