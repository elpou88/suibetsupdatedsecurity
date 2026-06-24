import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function SceneSponsored() {
  const [phase, setPhase] = useState(0);
  const [gasFee, setGasFee] = useState(0.18);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 2000),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (phase < 2) return;
    const start = 0.18;
    const end = 0;
    const steps = 30;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setGasFee(Math.max(0, start - (start / steps) * step));
      if (step >= steps) {
        setGasFee(0);
        clearInterval(interval);
        setPhase(3);
      }
    }, 38);
    return () => clearInterval(interval);
  }, [phase]);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ background: "#040D21" }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(0,255,178,0.06) 0%, transparent 65%)" }} />

      <motion.div className="absolute top-[5%] left-0 right-0 flex justify-center"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.6rem, 1.3vw, 0.8rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            06 — SPONSORED TRANSACTIONS
          </span>
        </div>
      </motion.div>

      <div className="relative z-10 flex flex-col items-center text-center gap-4">
        {/* Gas meter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-2"
        >
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem, 1.1vw, 0.7rem)", color: "rgba(111,188,240,0.7)", letterSpacing: "0.15em" }}>
            GAS FEE
          </p>

          <motion.div
            animate={gasFee === 0 ? { color: "#00FFB2", textShadow: "0 0 30px #00FFB2, 0 0 60px #00FFB280" } : { color: "#FFB300" }}
            transition={{ duration: 0.3 }}
            style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(3.5rem, 13vw, 9rem)", fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 1 }}
          >
            ${gasFee.toFixed(2)}
          </motion.div>

          {/* Progress bar going to zero */}
          <div className="rounded-full overflow-hidden" style={{ width: "clamp(120px, 28vw, 220px)", height: "clamp(6px, 1.2vh, 10px)", background: "rgba(255,255,255,0.08)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #00FFB2, #4DA2FF)", transformOrigin: "left" }}
              animate={phase >= 2 ? { scaleX: 0 } : { scaleX: 1 }}
              initial={{ scaleX: 1 }}
              transition={{ duration: 1.1, ease: "easeInOut" }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
        >
          <p style={{ fontFamily: "Space Grotesp, sans-serif", fontSize: "clamp(0.8rem, 2.5vw, 1.4rem)", fontWeight: 900, color: "#F0F8FF" }}>
            Platform pays. <span style={{ color: "#00FFB2" }}>You keep winning.</span>
          </p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem, 0.95vw, 0.65rem)", color: "rgba(111,188,240,0.6)", marginTop: 6 }}>
            Sui Sponsored Transactions → Zero cost for users
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
