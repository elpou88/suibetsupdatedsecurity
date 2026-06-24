import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const NODES = [
  { x: "15%", y: "25%" }, { x: "78%", y: "20%" }, { x: "10%", y: "65%" },
  { x: "84%", y: "68%" }, { x: "50%", y: "12%" }, { x: "50%", y: "84%" },
  { x: "26%", y: "46%" }, { x: "74%", y: "46%" }, { x: "38%", y: "74%" }, { x: "62%", y: "28%" },
];

const LINES = [
  [0, 6], [1, 7], [2, 6], [3, 7], [4, 6], [4, 7], [5, 6], [5, 7],
  [6, 7], [0, 4], [1, 4], [2, 5], [3, 5], [8, 6], [9, 7],
];

export function SceneFinality() {
  const [phase, setPhase] = useState(0);
  const [ms, setMs] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 80),
      setTimeout(() => setPhase(2), 420),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (phase < 2) return;
    let val = 0;
    const id = setInterval(() => {
      val += 14;
      setMs(Math.min(val, 400));
      if (val >= 400) {
        clearInterval(id);
        setConfirmed(true);
        setPhase(3);
      }
    }, 14);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex flex-col items-center justify-between"
      style={{ background: "#040D21", padding: "5% 6% 6%" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(77,162,255,0.08) 0%, transparent 65%)" }} />

      {/* Network SVG lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
        {LINES.map(([a, b], i) => (
          <motion.line key={i}
            x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={phase >= 2 ? { pathLength: 1, opacity: confirmed ? 0.55 : 0.14 } : {}}
            transition={{ delay: i * 0.04, duration: 0.38 }}
            stroke={confirmed ? "#00FFB2" : "#4DA2FF"}
            strokeWidth={confirmed ? 1.5 : 0.8}
          />
        ))}
      </svg>

      {/* Nodes */}
      {NODES.map((node, i) => (
        <motion.div key={i}
          className="absolute rounded-full"
          style={{ left: node.x, top: node.y, transform: "translate(-50%,-50%)", zIndex: 2,
            width: "clamp(8px, 1.5vw, 13px)", height: "clamp(8px, 1.5vw, 13px)" }}
          animate={{
            background: confirmed ? "#00FFB2" : "#4DA2FF",
            boxShadow: confirmed ? "0 0 16px #00FFB2" : "0 0 6px #4DA2FF50",
            scale: confirmed ? [1, 2, 1] : [1, 1.15, 1],
          }}
          transition={{ delay: i * 0.04, duration: confirmed ? 0.3 : 2.2, repeat: confirmed ? 0 : Infinity, ease: "easeInOut" }}
        />
      ))}

      {/* Header */}
      <motion.div className="relative z-10 flex justify-center"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.55rem, 1.3vw, 0.82rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            04 — SUB-SECOND FINALITY
          </span>
        </div>
      </motion.div>

      {/* Main timer — center of screen */}
      <div className="relative z-10 text-center flex flex-col items-center">
        <motion.p
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 0.5 } : { opacity: 0 }}
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem, 1.1vw, 0.72rem)", color: "#6FBCF0", letterSpacing: "0.2em", marginBottom: "1.5vh" }}
        >
          BET PLACED → CONFIRMING
        </motion.p>

        <motion.div
          initial={{ scale: 0.55, opacity: 0 }}
          animate={phase >= 2 ? { scale: 1, opacity: 1 } : { opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
        >
          <motion.span
            animate={{
              color: confirmed ? "#00FFB2" : "#4DA2FF",
              textShadow: confirmed
                ? "0 0 50px #00FFB2, 0 0 100px #00FFB230"
                : "0 0 25px #4DA2FF40",
            }}
            transition={{ duration: 0.18 }}
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontSize: "clamp(5rem, 17vw, 12rem)",
              fontWeight: 900,
              letterSpacing: "-0.05em",
              display: "block",
              lineHeight: 1,
            }}
          >
            {(ms / 1000).toFixed(3)}s
          </motion.span>
        </motion.div>
      </div>

      {/* Bottom confirmation */}
      <motion.div
        className="relative z-10"
        initial={{ opacity: 0, scale: 0.75, y: 18 }}
        animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 22 }}
      >
        <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full"
          style={{ background: "rgba(0,255,178,0.12)", border: "2px solid rgba(0,255,178,0.5)", boxShadow: "0 0 32px rgba(0,255,178,0.22)" }}>
          <div className="rounded-full" style={{ width: 10, height: 10, background: "#00FFB2", boxShadow: "0 0 10px #00FFB2" }} />
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.75rem, 2vw, 1.3rem)", fontWeight: 900, color: "#00FFB2" }}>
            CONFIRMED ON-CHAIN
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
