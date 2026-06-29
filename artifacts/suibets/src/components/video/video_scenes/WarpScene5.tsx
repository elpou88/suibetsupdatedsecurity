import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const STATS = [
  { value: "512", label: "bets / tx", color: "#00e5ff" },
  { value: "75%", label: "gas saved", color: "#00e5ff" },
  { value: "90%", label: "parlay gas", color: "#bf5fff" },
  { value: "50ms", label: "fastpath", color: "#ff6b00" },
  { value: "1,280", label: "bets / sec", color: "#ff6b00" },
  { value: "1 tx", label: "per parlay", color: "#bf5fff" },
];

export function WarpScene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 1200),
      setTimeout(() => setPhase(4), 2400),
      setTimeout(() => setPhase(5), 3800),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.5 }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, #040d1c 0%, #04060d 100%)" }} />

      {/* Animated grid */}
      <div className="absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: "linear-gradient(#00e5ff 1px,transparent 1px),linear-gradient(90deg,#00e5ff 1px,transparent 1px)", backgroundSize: "50px 50px" }} />

      {/* Corner glow */}
      <motion.div
        className="absolute"
        style={{ top: "-10%", left: "-10%", width: "50vw", height: "50vh", borderRadius: "50%", background: "radial-gradient(circle,rgba(0,229,255,0.08) 0%,transparent 70%)", pointerEvents: "none" }}
        animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* WARP wordmark */}
      <motion.div
        className="relative z-10 text-center"
        initial={{ opacity: 0, y: 30, scale: 0.85 }}
        animate={phase >= 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.85 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
      >
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(3rem,10vw,6.5rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, background: "linear-gradient(135deg,#00e5ff 0%,#7af6ff 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          WARP
        </div>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1rem,3vw,2rem)", color: "rgba(255,255,255,0.85)", fontWeight: 300, letterSpacing: "0.06em", marginTop: "-0.15em" }}>
          Engine
        </div>
      </motion.div>

      {/* Stats grid */}
      <motion.div
        className="relative z-10 grid grid-cols-3 gap-3 mt-7"
        style={{ maxWidth: "min(600px,85vw)", width: "100%" }}
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5 }}
      >
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            className="rounded-xl p-3 text-center"
            style={{ background: `${s.color}0d`, border: `1px solid ${s.color}33` }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
            transition={{ type: "spring", stiffness: 400, damping: 25, delay: i * 0.06 }}
          >
            <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1rem,3vw,1.8rem)", fontWeight: 900, color: s.color, letterSpacing: "-0.02em" }}>
              {s.value}
            </div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.42rem,0.85vw,0.58rem)", color: `${s.color}99`, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 2 }}>
              {s.label}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Live badge + URL */}
      <motion.div
        className="relative z-10 flex flex-col items-center gap-3 mt-6"
        initial={{ opacity: 0, y: 16 }}
        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.45 }}
      >
        <div className="flex items-center gap-2 rounded-full px-4 py-1.5"
          style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.35)" }}>
          <motion.div
            style={{ width: 7, height: 7, borderRadius: "50%", background: "#00e5ff" }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "#00e5ff", letterSpacing: "0.18em" }}>
            LIVE ON SUI MAINNET
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={phase >= 5 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1rem,2.8vw,1.8rem)", fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", textAlign: "center" }}>
            SuiBets<span style={{ color: "#00e5ff" }}> · WARP Engine</span>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
