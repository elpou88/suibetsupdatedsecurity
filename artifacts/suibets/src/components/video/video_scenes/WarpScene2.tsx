import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const CHARS_WARP = "WARP".split("");
const CHARS_ENGINE = "Engine".split("");

export function WarpScene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 1100),
      setTimeout(() => setPhase(4), 1800),
      setTimeout(() => setPhase(5), 3000),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.06 }}
      transition={{ duration: 0.4 }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 50%, #020814 0%, #04060d 100%)" }} />

      {/* Radial pulse rings */}
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ border: "1px solid rgba(0,229,255,0.15)", width: `${i * 26}vw`, height: `${i * 26}vw` }}
          animate={phase >= 2 ? { scale: [1, 1.08, 1], opacity: [0.15, 0.06, 0.15] } : { opacity: 0 }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.5, ease: "easeInOut" }}
        />
      ))}

      {/* Cyan sweep line */}
      <motion.div
        className="absolute left-0 right-0"
        style={{ top: "50%", height: "1px", background: "linear-gradient(90deg, transparent 0%, #00e5ff 50%, transparent 100%)", transformOrigin: "center" }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={phase >= 1 ? { scaleX: 1, opacity: [0, 0.8, 0.3] } : { scaleX: 0, opacity: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* WARP — per-character kinetic reveal */}
      <div className="relative z-10 text-center">
        <div className="flex items-baseline justify-center gap-[0.03em]" style={{ lineHeight: 1 }}>
          {CHARS_WARP.map((ch, i) => (
            <motion.span
              key={i}
              style={{
                fontFamily: "Space Grotesk, sans-serif",
                fontSize: "clamp(5rem,16vw,11rem)",
                fontWeight: 900,
                letterSpacing: "-0.04em",
                display: "inline-block",
                background: "linear-gradient(135deg,#00e5ff 0%,#7af6ff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                textShadow: "none",
              }}
              initial={{ opacity: 0, y: 80, rotateX: -50, scale: 0.7 }}
              animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0, scale: 1 } : { opacity: 0, y: 80, rotateX: -50, scale: 0.7 }}
              transition={{ type: "spring", stiffness: 500, damping: 28, delay: phase >= 2 ? i * 0.06 : 0 }}
            >
              {ch}
            </motion.span>
          ))}
        </div>

        {/* Engine */}
        <div className="flex items-baseline justify-center gap-[0.03em]" style={{ marginTop: "-0.15em" }}>
          {CHARS_ENGINE.map((ch, i) => (
            <motion.span
              key={i}
              style={{
                fontFamily: "Space Grotesk, sans-serif",
                fontSize: "clamp(2.5rem,8vw,5.5rem)",
                fontWeight: 300,
                letterSpacing: "0.08em",
                color: "#fff",
                display: "inline-block",
              }}
              initial={{ opacity: 0, y: 30 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 400, damping: 30, delay: phase >= 3 ? i * 0.04 : 0 }}
            >
              {ch}
            </motion.span>
          ))}
        </div>

        {/* Tagline */}
        <motion.div
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem,1.2vw,0.78rem)", color: "#00e5ff", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: "1.2rem", opacity: 0.75 }}
          initial={{ opacity: 0, filter: "blur(8px)" }}
          animate={phase >= 4 ? { opacity: 0.75, filter: "blur(0px)" } : { opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.6 }}
        >
          Weighted Atomic Resolution Protocol
        </motion.div>

        {/* Chain badge */}
        <motion.div
          className="flex items-center justify-center gap-2 mt-4"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
        >
          <div className="rounded-full px-3 py-1 flex items-center gap-1.5"
            style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.35)" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e5ff" }} />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "#00e5ff", letterSpacing: "0.12em" }}>
              SUI MAINNET · LIVE
            </span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
