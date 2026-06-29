import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const GRID_SIZE = 42;
const GRID = Array.from({ length: GRID_SIZE });

export function SceneParallel() {
  const [phase, setPhase] = useState(0);
  const [settled, setSettled] = useState(false);
  const [ethStep, setEthStep] = useState(0);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setEthStep(1), 720),
      setTimeout(() => setEthStep(2), 1060),
      setTimeout(() => setEthStep(3), 1400),
      setTimeout(() => setEthStep(4), 1740),
      setTimeout(() => setEthStep(5), 2080),
      setTimeout(() => { setSettled(true); setPhase(3); }, 2280),
      setTimeout(() => setPhase(4), 2680),
      setTimeout(() => setPhase(5), 3000),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: "-3%" }}
      transition={{ duration: 0.3 }}
      style={{ background: "#040D21" }}
    >
      {/* Top badge */}
      <motion.div className="absolute top-[5%] left-0 right-0 flex justify-center z-20"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.55rem, 1.3vw, 0.82rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            01 — PARALLEL EXECUTION
          </span>
        </div>
      </motion.div>

      <div className="absolute inset-0 flex" style={{ paddingTop: "14%", paddingBottom: "5%" }}>
        {/* LEFT — Sequential chains */}
        <motion.div
          className="relative flex flex-col items-center justify-between overflow-hidden"
          style={{ width: "50%", borderRight: "1px solid rgba(255,255,255,0.06)", paddingBottom: "4%", paddingTop: "2%" }}
          animate={phase >= 3 ? { opacity: 0.1, filter: "grayscale(1) blur(1.5px)" } : { opacity: 1 }}
          transition={{ duration: 0.45 }}
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(40,6,6,0.5) 0%, transparent 60%)" }} />

          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem, 1.1vw, 0.75rem)", color: "#FF6666", letterSpacing: "0.12em", opacity: 0.9 }}>
            OTHER CHAINS
          </p>

          <div className="flex flex-col w-full px-8" style={{ gap: "clamp(6px, 1.4vh, 14px)", maxWidth: 240 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, x: -24 }}
                animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0 }}
                transition={{ delay: i * 0.06, duration: 0.25 }}
              >
                <div className="relative rounded-xl overflow-hidden"
                  style={{ height: "clamp(28px, 5.5vh, 42px)", background: "rgba(255,68,68,0.05)", border: "1px solid rgba(255,68,68,0.2)" }}>
                  <motion.div
                    className="absolute inset-y-0 left-0"
                    style={{ background: "linear-gradient(90deg, rgba(255,68,68,0.45), rgba(255,68,68,0.2))" }}
                    initial={{ width: "0%" }}
                    animate={ethStep > i ? { width: "100%" } : { width: "0%" }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                  <div className="absolute inset-0 flex items-center px-3">
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.4rem, 0.85vw, 0.58rem)", color: ethStep > i ? "rgba(255,120,120,0.9)" : "rgba(255,80,80,0.3)" }}>
                      {ethStep > i ? `TX #${1000 + i} ✓` : "waiting..."}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div className="text-center"
            initial={{ opacity: 0 }}
            animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.4 }}>
            <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.8rem, 5.5vw, 3.5rem)", fontWeight: 900, color: "#FF4444", lineHeight: 1 }}>12s+</p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.8vw, 0.55rem)", color: "rgba(255,100,100,0.45)", marginTop: 4 }}>per transaction</p>
          </motion.div>
        </motion.div>

        {/* RIGHT — Sui parallel */}
        <div className="relative flex flex-col items-center justify-between overflow-hidden"
          style={{ width: "50%", paddingBottom: "4%", paddingTop: "2%" }}>
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(4,13,40,0.5) 0%, transparent 60%)" }} />

          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem, 1.1vw, 0.75rem)", color: "#4DA2FF", letterSpacing: "0.12em", opacity: 0.9 }}>
            SUI — ALL AT ONCE
          </p>

          <div className="grid relative z-10"
            style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: "clamp(3px, 0.6vw, 6px)", width: "clamp(150px, 32vw, 240px)" }}>
            {GRID.map((_, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, scale: 0.3 }}
                animate={phase >= 2 ? {
                  opacity: 1,
                  scale: 1,
                  background: settled ? "#00FFB2" : "rgba(77,162,255,0.2)",
                  boxShadow: settled ? "0 0 10px #00FFB270" : "none",
                } : { opacity: 0, scale: 0.3 }}
                transition={settled
                  ? { duration: 0.06, delay: Math.random() * 0.03 }
                  : { delay: 0.02 + i * 0.008, duration: 0.2 }}
                style={{
                  height: "clamp(12px, 3vh, 22px)",
                  borderRadius: 4,
                  border: settled ? "1px solid rgba(0,255,178,0.5)" : "1px solid rgba(77,162,255,0.3)",
                }}
              />
            ))}
          </div>

          <motion.div className="text-center"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}>
            <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.8rem, 5.5vw, 3.5rem)", fontWeight: 900, color: "#00FFB2", lineHeight: 1 }}>0.4s</p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.8vw, 0.55rem)", color: "rgba(0,255,178,0.55)", marginTop: 4 }}>ALL {GRID_SIZE} SETTLED</p>
          </motion.div>
        </div>
      </div>

      {/* Radial flash */}
      <motion.div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 75% 55%, #00FFB2 0%, transparent 50%)", zIndex: 10 }}
        initial={{ opacity: 0 }}
        animate={phase === 3 ? { opacity: [0, 0.28, 0] } : { opacity: 0 }}
        transition={{ duration: 0.5 }}
      />

      {/* 30× label */}
      <motion.div className="absolute pointer-events-none z-20"
        style={{ left: "50%", top: "62%", transform: "translate(-50%, -50%)" }}
        initial={{ opacity: 0, scale: 0 }}
        animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0 }}
        transition={{ type: "spring", stiffness: 500 }}>
        <div className="px-3 py-1 rounded-lg"
          style={{ background: "rgba(4,13,33,0.92)", border: "1px solid rgba(77,162,255,0.4)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.55rem, 1.1vw, 0.75rem)", fontWeight: 700, color: "#4DA2FF" }}>30× faster</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
