import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const BATCH_DOTS = Array.from({ length: 24 }, (_, i) => i);

function CountUp({ target, duration = 1200, suffix = "" }: { target: number; duration?: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return <>{val.toLocaleString()}{suffix}</>;
}

export function WarpScene3() {
  const [phase, setPhase] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => { setPhase(3); setCollapsed(false); }, 1200),
      setTimeout(() => { setPhase(4); setCollapsed(true); }, 2800),
      setTimeout(() => setPhase(5), 3800),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.35 }}
    >
      <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#04060d 0%,#050d18 100%)" }} />
      <div className="absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: "linear-gradient(#00e5ff 1px,transparent 1px),linear-gradient(90deg,#00e5ff 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Section label */}
      <motion.div
        className="absolute top-[8%] left-0 right-0 text-center"
        initial={{ opacity: 0, y: -16 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -16 }}
        transition={{ duration: 0.45 }}
      >
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "#00e5ff", letterSpacing: "0.25em", textTransform: "uppercase" }}>
          PTB Batch Settlement
        </span>
      </motion.div>

      {/* Main stat */}
      <motion.div
        className="relative z-10 text-center mb-6"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(5rem,15vw,10rem)", fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 1, color: "#00e5ff" }}>
          {phase >= 2 ? <CountUp target={512} duration={900} /> : "0"}
        </div>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.9rem,2.5vw,1.6rem)", color: "rgba(255,255,255,0.7)", fontWeight: 600, letterSpacing: "-0.01em", marginTop: "-0.2rem" }}>
          bets settled in <span style={{ color: "#00e5ff" }}>1 atomic transaction</span>
        </div>
      </motion.div>

      {/* Dot grid → collapse animation */}
      <motion.div
        className="relative flex flex-wrap justify-center gap-1.5"
        style={{ maxWidth: "min(380px,80vw)" }}
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {BATCH_DOTS.map((i) => (
          <motion.div
            key={i}
            style={{ width: 10, height: 10, borderRadius: 2 }}
            animate={collapsed
              ? { x: 0, y: 0, scale: 0.3, opacity: 0.3, background: "#00e5ff" }
              : { x: 0, y: 0, scale: 1, opacity: 0.9, background: i % 3 === 0 ? "#00e5ff" : i % 3 === 1 ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.25)" }
            }
            transition={{ duration: 0.6, delay: collapsed ? i * 0.01 : i * 0.03, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
        {collapsed && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 25, delay: 0.3 }}
          >
            <div style={{ background: "#00e5ff", borderRadius: 8, padding: "6px 18px" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.6rem,1.2vw,0.8rem)", color: "#04060d", fontWeight: 800, letterSpacing: "0.1em" }}>
                1 PTB BLOCK
              </span>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Gas savings badge */}
      <motion.div
        className="absolute bottom-[10%] flex items-center gap-4"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.45 }}
      >
        <div className="rounded-xl px-5 py-2.5" style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.2rem,3.5vw,2.2rem)", fontWeight: 900, color: "#00e5ff" }}>
            {phase >= 5 ? <CountUp target={75} duration={700} suffix="%" /> : "0%"}
          </span>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "rgba(0,229,255,0.6)", display: "block", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>
            gas saved / bet
          </span>
        </div>
        <div className="rounded-xl px-5 py-2.5" style={{ background: "rgba(255,107,0,0.08)", border: "1px solid rgba(255,107,0,0.25)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.2rem,3.5vw,2.2rem)", fontWeight: 900, color: "#ff6b00" }}>
            {phase >= 5 ? <CountUp target={1280} duration={700} /> : "0"}
          </span>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.5rem,1vw,0.65rem)", color: "rgba(255,107,0,0.6)", display: "block", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>
            bets / sec
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
