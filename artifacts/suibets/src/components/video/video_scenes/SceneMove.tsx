import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function SceneMove() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2400),
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
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 60%, rgba(0,255,178,0.05) 0%, transparent 60%)" }} />

      <motion.div className="absolute top-[5%] left-0 right-0 flex justify-center"
        initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}>
        <div className="px-3 py-1 rounded-full" style={{ background: "rgba(77,162,255,0.12)", border: "1px solid rgba(77,162,255,0.3)" }}>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.6rem, 1.3vw, 0.8rem)", fontWeight: 700, color: "#6FBCF0", letterSpacing: "0.08em" }}>
            08 — MOVE LANGUAGE SAFETY
          </span>
        </div>
      </motion.div>

      <div className="relative z-10 flex flex-col items-center gap-3 w-[90%] max-w-sm">
        {/* Solidity "bad" code */}
        <motion.div
          animate={phase >= 3 ? { opacity: 0.15, scale: 0.9, y: -8 } : { opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full rounded-lg overflow-hidden"
          style={{ background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.25)" }}
        >
          <div className="px-2 py-1 flex items-center gap-2" style={{ background: "rgba(255,68,68,0.1)", borderBottom: "1px solid rgba(255,68,68,0.2)" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.8vw, 0.55rem)", color: "rgba(255,100,100,0.8)" }}>solidity · VULNERABLE</span>
            <div className="ml-auto px-1.5 py-0.5 rounded" style={{ background: "rgba(255,68,68,0.3)" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.32rem, 0.7vw, 0.48rem)", color: "#FF4444" }}>⚠ EXPLOIT RISK</span>
            </div>
          </div>
          <div className="p-2">
            <pre style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.85vw, 0.6rem)", color: "rgba(255,100,100,0.8)", margin: 0, lineHeight: 1.5 }}>
{`function payout(addr) {
  // ❌ Re-entrancy possible
  escrow[addr].transfer(amt);
  balances[addr] = 0; // too late!
}`}
            </pre>
          </div>
        </motion.div>

        {/* Arrow */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          style={{ fontSize: "clamp(0.8rem, 2vw, 1.2rem)", color: "#4DA2FF" }}
        >↓</motion.div>

        {/* Move "good" code */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 350 }}
          className="w-full rounded-lg overflow-hidden"
          style={{ background: "rgba(0,255,178,0.06)", border: "1px solid rgba(0,255,178,0.3)", boxShadow: "0 0 20px rgba(0,255,178,0.1)" }}
        >
          <div className="px-2 py-1 flex items-center gap-2" style={{ background: "rgba(0,255,178,0.08)", borderBottom: "1px solid rgba(0,255,178,0.2)" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.8vw, 0.55rem)", color: "rgba(0,255,178,0.8)" }}>move · TYPE-SAFE</span>
            <div className="ml-auto px-1.5 py-0.5 rounded" style={{ background: "rgba(0,255,178,0.2)" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.32rem, 0.7vw, 0.48rem)", color: "#00FFB2" }}>✓ EXPLOIT-PROOF</span>
            </div>
          </div>
          <div className="p-2">
            <pre style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.38rem, 0.85vw, 0.6rem)", color: "rgba(0,255,178,0.85)", margin: 0, lineHeight: 1.5 }}>
{`public fun payout(coin: Coin<SUI>,
                  recipient: address) {
  // ✓ Ownership enforced by type
  transfer::public_transfer(coin, recipient);
}`}
            </pre>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: "clamp(0.65rem, 1.5vw, 0.9rem)", fontWeight: 700, color: "#F0F8FF", textAlign: "center" }}
        >
          Your funds <span style={{ color: "#00FFB2" }}>cannot disappear</span>. Move won't allow it.
        </motion.p>
      </div>
    </motion.div>
  );
}
