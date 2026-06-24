import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const HEX = "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";

export function SceneSuiNS() {
  const [phase, setPhase] = useState(0);
  const [visibleHex, setVisibleHex] = useState("");

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 400),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 2200),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (phase < 2) return;
    let i = 0;
    const interval = setInterval(() => {
      setVisibleHex(HEX.slice(0, i + 1));
      i++;
      if (i >= HEX.length) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [phase]);

  const chars = "suibets.sui".split("");

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ background: "#040D21" }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 70% 50%, rgba(0,255,178,0.06) 0%, transparent 60%)" }} />

      <motion.div className="absolute top-[5%] left-0 right-0 flex justify-center"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.6rem, 1.3vw, 0.8rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            05 — SuiNS
          </span>
        </div>
      </motion.div>

      <div className="relative z-10 flex flex-col items-center gap-6 text-center w-[90%] max-w-lg">
        {/* Hex address typing out */}
        <motion.div
          animate={phase >= 3 ? { opacity: 0.2, scale: 0.85, y: -10 } : { opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem, 1.2vw, 0.8rem)", color: "#FF4444", letterSpacing: "0.05em", opacity: 0.85 }}>
            WHO ARE YOU BETTING AGAINST?
          </p>
          <div className="mt-1 px-3 py-2 rounded"
            style={{ background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)", wordBreak: "break-all" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem, 1.1vw, 0.72rem)", color: "rgba(255,100,100,0.8)" }}>
              {visibleHex}<span className="animate-pulse">|</span>
            </span>
          </div>
        </motion.div>

        {/* Arrow */}
        <motion.div
          initial={{ opacity: 0, scaleY: 0 }}
          animate={phase >= 3 ? { opacity: 1, scaleY: 1 } : { opacity: 0, scaleY: 0 }}
          transition={{ duration: 0.3 }}
          style={{ fontSize: "clamp(1rem, 2.5vw, 1.5rem)", color: "#4DA2FF" }}
        >↓</motion.div>

        {/* SuiNS name */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 350 }}
        >
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem, 1.2vw, 0.8rem)", color: "#00FFB2", letterSpacing: "0.05em", opacity: 0.85, marginBottom: 4 }}>
            NOW THAT'S A NAME
          </p>
          <div className="flex items-center justify-center gap-1 px-4 py-3 rounded-xl"
            style={{ background: "rgba(0,255,178,0.08)", border: "2px solid rgba(0,255,178,0.4)", boxShadow: "0 0 24px rgba(0,255,178,0.15)" }}>
            {chars.map((char, i) => (
              <motion.span key={i}
                initial={{ opacity: 0, y: 15 }}
                animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0 }}
                transition={{ delay: 0.05 + i * 0.04, type: "spring", stiffness: 400, damping: 20 }}
                style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.4rem, 5vw, 3rem)", fontWeight: 900, color: char === "." ? "#4DA2FF" : "#00FFB2", letterSpacing: "-0.02em" }}
              >
                {char}
              </motion.span>
            ))}
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.65rem, 1.5vw, 0.9rem)", fontWeight: 700, color: "rgba(111,188,240,0.8)" }}
        >
          Bet like a human. Not a robot.
        </motion.p>
      </div>
    </motion.div>
  );
}
