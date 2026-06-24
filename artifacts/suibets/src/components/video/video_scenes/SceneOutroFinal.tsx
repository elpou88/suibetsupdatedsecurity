import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function SceneOutroFinal() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1700),
      setTimeout(() => setPhase(4), 2800),
      setTimeout(() => setPhase(5), 4200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      {/* Expanding ring */}
      <motion.div
        style={{
          position: "absolute", borderRadius: "50%",
          border: "1px solid rgba(6,182,212,0.25)",
          pointerEvents: "none",
        }}
        initial={{ width: "0vw", height: "0vw", opacity: 0.8 }}
        animate={phase >= 1 ? { width: "70vw", height: "70vw", opacity: 0 } : { width: "0vw", height: "0vw", opacity: 0.8 }}
        transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        style={{
          position: "absolute", borderRadius: "50%",
          border: "1px solid rgba(6,182,212,0.15)",
          pointerEvents: "none",
        }}
        initial={{ width: "0vw", height: "0vw", opacity: 0.6 }}
        animate={phase >= 1 ? { width: "50vw", height: "50vw", opacity: 0 } : { width: "0vw", height: "0vw", opacity: 0.6 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, scale: 0.82, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.82, y: 20 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        style={{ marginBottom: "clamp(1.2rem,3vh,2.4rem)" }}
      >
        <img
          src={`${import.meta.env.BASE_URL}logo/suibets-logo-transparent.png`}
          alt="SuiBets"
          style={{ height: "clamp(3rem,7vw,5.5rem)", width: "auto" }}
        />
      </motion.div>

      {/* Tagline */}
      <motion.p
        style={{
          fontFamily: "Space Grotesk, sans-serif", fontWeight: 800,
          fontSize: "clamp(1.1rem,2.8vw,2rem)", color: "#fff",
          textAlign: "center", letterSpacing: "-0.01em", lineHeight: 1.2,
          maxWidth: "clamp(18rem,48vw,38rem)",
        }}
        initial={{ opacity: 0, y: 22 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
      >
        The future of sports betting is{" "}
        <span style={{ color: "#06b6d4" }}>peer-to-peer.</span>
      </motion.p>

      {/* Horizontal rule */}
      <motion.div
        style={{ width: "clamp(8rem,20vw,16rem)", height: "1px", background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.5), transparent)", margin: "clamp(1rem,2.5vh,2rem) 0" }}
        initial={{ scaleX: 0 }}
        animate={phase >= 4 ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Sui Overflow badge */}
      <motion.div
        style={{
          display: "flex", alignItems: "center", gap: "0.6rem",
          background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)",
          borderRadius: "2rem", padding: "0.4rem 1.1rem",
        }}
        initial={{ opacity: 0, scale: 0.88 }}
        animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.88 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
      >
        <motion.div
          style={{ width: 6, height: 6, borderRadius: "50%", background: "#06b6d4", flexShrink: 0 }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.48rem,0.72vw,0.6rem)", color: "#06b6d4", letterSpacing: "0.18em", whiteSpace: "nowrap" }}>
          SUI OVERFLOW 2026 · SUIBETS.APP
        </span>
      </motion.div>

      {/* Persistent bottom grid lines */}
      {[20, 40, 60, 80].map((pct, i) => (
        <motion.div
          key={i}
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${pct}%`, width: "1px",
            background: "rgba(255,255,255,0.025)",
            pointerEvents: "none",
          }}
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: i * 0.08 }}
        />
      ))}
    </motion.div>
  );
}
