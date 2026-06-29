import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function SceneP2P() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2900),
      setTimeout(() => setPhase(5), 4200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.5 }}
    >
      {/* Section label */}
      <motion.p
        style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem,0.9vw,0.7rem)", color: "#06b6d4", letterSpacing: "0.28em", marginBottom: "clamp(1.2rem,3vh,2.5rem)" }}
        initial={{ opacity: 0, y: -10 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
        transition={{ duration: 0.4 }}
      >
        P2P ORDER BOOK
      </motion.p>

      {/* Two-sided order book */}
      <div className="flex items-center gap-0" style={{ width: "clamp(22rem,70vw,58rem)" }}>
        {/* Creator card */}
        <motion.div
          style={{
            flex: 1, borderRadius: "1rem", padding: "clamp(1rem,2.5vw,1.8rem)",
            background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.22)",
            backdropFilter: "blur(8px)",
          }}
          initial={{ opacity: 0, x: -60 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -60 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.75vw,0.6rem)", color: "#06b6d4", letterSpacing: "0.2em", marginBottom: "0.5rem" }}>CREATOR</p>
          <p style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 800, fontSize: "clamp(1rem,2.2vw,1.6rem)", color: "#fff", lineHeight: 1.1, marginBottom: "0.75rem" }}>
            Spain wins<br />
            <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400, fontSize: "0.75em" }}>vs Argentina</span>
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}>STAKE</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "#fff" }}>10 SUI</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}>ODDS</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "#06b6d4" }}>2.10×</span>
            </div>
          </div>
          <motion.div
            style={{ marginTop: "0.9rem", height: "2px", background: "linear-gradient(90deg, #06b6d4, rgba(6,182,212,0.1))", borderRadius: 4 }}
            initial={{ scaleX: 0, originX: 0 }}
            animate={phase >= 2 ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </motion.div>

        {/* Arrow connector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 clamp(0.8rem,2vw,1.8rem)", flexShrink: 0 }}>
          <motion.div
            style={{ width: "clamp(2.5rem,5vw,4rem)", height: "1px", background: "linear-gradient(90deg, rgba(6,182,212,0.4), rgba(251,146,60,0.4))" }}
            initial={{ scaleX: 0 }}
            animate={phase >= 3 ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.p
            style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.65vw,0.55rem)", color: "rgba(255,255,255,0.3)", letterSpacing: "0.14em", marginTop: "0.4rem", whiteSpace: "nowrap" }}
            initial={{ opacity: 0 }}
            animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            vs
          </motion.p>
        </div>

        {/* Taker card */}
        <motion.div
          style={{
            flex: 1, borderRadius: "1rem", padding: "clamp(1rem,2.5vw,1.8rem)",
            background: "rgba(251,146,60,0.05)", border: "1px solid rgba(251,146,60,0.2)",
            backdropFilter: "blur(8px)",
          }}
          initial={{ opacity: 0, x: 60 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 60 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.75vw,0.6rem)", color: "#fb923c", letterSpacing: "0.2em", marginBottom: "0.5rem" }}>TAKER</p>
          <p style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 800, fontSize: "clamp(1rem,2.2vw,1.6rem)", color: "#fff", lineHeight: 1.1, marginBottom: "0.75rem" }}>
            Argentina wins<br />
            <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400, fontSize: "0.75em" }}>vs Spain</span>
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}>STAKE</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "#fff" }}>11 SUI</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}>TO WIN</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,0.7vw,0.58rem)", color: "#fb923c" }}>21 SUI</span>
            </div>
          </div>
          <motion.div
            style={{ marginTop: "0.9rem", height: "2px", background: "linear-gradient(90deg, rgba(251,146,60,0.1), #fb923c)", borderRadius: 4 }}
            initial={{ scaleX: 0, originX: 1 }}
            animate={phase >= 3 ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </motion.div>
      </div>

      {/* Escrow line */}
      <motion.div
        style={{ marginTop: "clamp(1.5rem,3.5vh,2.8rem)", display: "flex", alignItems: "center", gap: "clamp(0.6rem,1.5vw,1.2rem)" }}
        initial={{ opacity: 0, y: 18 }}
        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
        transition={{ duration: 0.45 }}
      >
        <div style={{ height: "1px", width: "clamp(2rem,4vw,3rem)", background: "rgba(255,255,255,0.12)" }} />
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.55rem,0.85vw,0.68rem)", color: "rgba(255,255,255,0.38)", letterSpacing: "0.16em" }}>
          ESCROW LOCKED ON-CHAIN · SETTLED BY ORACLE
        </p>
        <div style={{ height: "1px", width: "clamp(2rem,4vw,3rem)", background: "rgba(255,255,255,0.12)" }} />
      </motion.div>

      {/* "Post your edge" */}
      <motion.p
        style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: "clamp(1.2rem,3vw,2.2rem)", color: "#fff", marginTop: "clamp(1rem,2.5vh,2rem)", letterSpacing: "-0.01em" }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.92 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        Post your edge.{" "}
        <span style={{ color: "#06b6d4" }}>Take theirs.</span>
      </motion.p>
    </motion.div>
  );
}
