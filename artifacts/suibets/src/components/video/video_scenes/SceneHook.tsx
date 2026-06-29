import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const WORD1 = "PEER".split("");
const WORD2 = "TO".split("");
const WORD3 = "PEER".split("");

export function SceneHook() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 80),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1400),
      setTimeout(() => setPhase(4), 2200),
      setTimeout(() => setPhase(5), 3300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const charAnim = (i: number, threshold: number) => ({
    initial: { opacity: 0, y: 80, rotateX: -55, scale: 0.7 },
    animate: phase >= threshold
      ? { opacity: 1, y: 0, rotateX: 0, scale: 1 }
      : { opacity: 0, y: 80, rotateX: -55, scale: 0.7 },
    exit: { opacity: 0, y: -60, scale: 1.15 },
    transition: { type: "spring" as const, stiffness: 320, damping: 22, delay: i * 0.055 },
  });

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ clipPath: "polygon(0 100%, 100% 100%, 100% 100%, 0 100%)" }}
      animate={{ clipPath: "polygon(0 0%, 100% 0%, 100% 100%, 0 100%)" }}
      exit={{ clipPath: "polygon(0 0%, 100% 0%, 100% 0%, 0 0%)", opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Slash accent */}
      <motion.div
        className="absolute pointer-events-none"
        style={{ top: "20%", left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent 10%, rgba(6,182,212,0.5) 50%, transparent 90%)" }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={phase >= 1 ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Hero text */}
      <div style={{ perspective: "900px" }} className="flex flex-col items-center gap-1">
        {/* PEER */}
        <div className="flex gap-[0.04em]">
          {WORD1.map((c, i) => (
            <motion.span key={i} {...charAnim(i, 1)}
              style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(4rem,13vw,11rem)", fontWeight: 900, letterSpacing: "-0.02em", color: "#fff", lineHeight: 1, display: "inline-block" }}>
              {c}
            </motion.span>
          ))}
        </div>
        {/* TO */}
        <div className="flex gap-[0.04em]">
          {WORD2.map((c, i) => (
            <motion.span key={i} {...charAnim(i, 2)}
              style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(2.8rem,9vw,7.5rem)", fontWeight: 900, letterSpacing: "0.18em", color: "#06b6d4", lineHeight: 1, display: "inline-block" }}>
              {c}
            </motion.span>
          ))}
        </div>
        {/* PEER */}
        <div className="flex gap-[0.04em]">
          {WORD3.map((c, i) => (
            <motion.span key={i} {...charAnim(i, 3)}
              style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(4rem,13vw,11rem)", fontWeight: 900, letterSpacing: "-0.02em", color: "#fff", lineHeight: 1, display: "inline-block" }}>
              {c}
            </motion.span>
          ))}
        </div>
      </div>

      {/* Tagline */}
      <motion.p
        style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.7rem,1.4vw,1rem)", color: "rgba(255,255,255,0.5)", letterSpacing: "0.22em", marginTop: "2.5rem" }}
        initial={{ opacity: 0, filter: "blur(8px)" }}
        animate={phase >= 4 ? { opacity: 1, filter: "blur(0px)" } : { opacity: 0, filter: "blur(8px)" }}
        transition={{ duration: 0.55 }}
      >
        NO HOUSE EDGE · NO MIDDLEMAN · JUST YOU VS THEM
      </motion.p>

      {/* SuiBets logo bar */}
      <motion.div
        className="absolute bottom-10 left-1/2"
        style={{ transform: "translateX(-50%)" }}
        initial={{ opacity: 0, y: 16 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.45 }}
      >
        <img
          src={`${import.meta.env.BASE_URL}logo/suibets-logo-transparent.png`}
          alt="SuiBets"
          style={{ height: "clamp(1.8rem,3.2vw,2.6rem)", width: "auto", opacity: 0.85 }}
        />
      </motion.div>

      {/* Bottom slash */}
      <motion.div
        className="absolute pointer-events-none"
        style={{ bottom: "18%", left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent 10%, rgba(6,182,212,0.3) 50%, transparent 90%)" }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={phase >= 2 ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      />
    </motion.div>
  );
}
