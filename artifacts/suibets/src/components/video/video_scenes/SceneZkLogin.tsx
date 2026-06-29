import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function SceneZkLogin() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1500),
      setTimeout(() => setPhase(4), 2200),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ background: "#040D21" }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% 50%, rgba(0,255,178,0.05) 0%, transparent 60%)" }} />

      <motion.div className="absolute top-[5%] left-0 right-0 flex justify-center"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }} transition={{ duration: 0.3 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.6rem, 1.3vw, 0.8rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            03 — zkLOGIN
          </span>
        </div>
      </motion.div>

      <div className="relative z-10 flex items-center gap-8 w-[90%] max-w-xl">
        {/* Phone mockup */}
        <motion.div
          className="flex-shrink-0"
          initial={{ x: -30, opacity: 0 }}
          animate={phase >= 1 ? { x: 0, opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5, type: "spring", stiffness: 300 }}
        >
          <div className="rounded-2xl overflow-hidden flex flex-col items-center justify-center"
            style={{
              width: "clamp(90px, 20vw, 140px)",
              height: "clamp(160px, 35vh, 240px)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "clamp(8px, 2vw, 16px)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}>

            {/* Before: Google button */}
            <motion.div
              className="w-full flex flex-col items-center gap-2"
              animate={phase >= 3 ? { opacity: 0, y: -20 } : { opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "white", fontSize: "0.7rem", fontWeight: 700, color: "#4285F4" }}>G</div>
              <div className="w-full rounded-lg flex items-center justify-center"
                style={{ height: "clamp(20px, 4vh, 28px)", background: "rgba(77,162,255,0.15)", border: "1px solid rgba(77,162,255,0.4)" }}>
                <motion.div
                  animate={phase >= 2 ? { width: "60%", height: "60%" } : { width: "0%", height: "2px" }}
                  style={{ background: "#4DA2FF", borderRadius: 4 }}
                  transition={{ duration: 0.25 }}
                />
              </div>
              <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.4rem, 0.8vw, 0.55rem)", color: "rgba(111,188,240,0.8)", textAlign: "center" }}>
                Sign in with Google
              </p>
            </motion.div>

            {/* After: wallet connected */}
            <motion.div
              className="absolute flex flex-col items-center gap-2"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.35 }}
            >
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.35rem, 0.7vw, 0.5rem)", color: "#00FFB2", textAlign: "center" }}>
                ✓ WALLET READY
              </div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.3rem, 0.65vw, 0.45rem)", color: "rgba(111,188,240,0.6)", textAlign: "center" }}>
                0x7f3a...c821
              </div>
              <div className="w-full rounded-lg flex items-center justify-center"
                style={{ height: "clamp(18px, 3.5vh, 26px)", background: "rgba(0,255,178,0.15)", border: "1px solid rgba(0,255,178,0.5)" }}>
                <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.4rem, 0.8vw, 0.55rem)", color: "#00FFB2", fontWeight: 700 }}>PLACE BET</span>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Right: text */}
        <div className="flex flex-col gap-3">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <p style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(1.2rem, 4vw, 2.5rem)", fontWeight: 900, color: "#F0F8FF", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              No seed<br />phrase.<br /><span style={{ color: "#00FFB2" }}>Ever.</span>
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.45rem, 1vw, 0.65rem)", color: "rgba(111,188,240,0.7)", lineHeight: 1.6 }}>
              Google → Sui wallet<br />
              Zero friction.<br />
              <span style={{ color: "#4DA2FF" }}>zkProof under the hood.</span>
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2"
          >
            <div className="rounded-full" style={{ width: 8, height: 8, background: "#00FFB2", boxShadow: "0 0 8px #00FFB2" }} />
            <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.5rem, 1.1vw, 0.72rem)", fontWeight: 700, color: "#00FFB2" }}>ONE TAP TO BET</span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
