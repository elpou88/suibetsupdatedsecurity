import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function SceneOpen() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 80),
      setTimeout(() => setPhase(2), 400),
      setTimeout(() => setPhase(3), 800),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        className="absolute inset-0"
        style={{ background: "linear-gradient(135deg, #040D21 0%, #071428 60%, #040D21 100%)" }}
        animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
      />

      <motion.div
        className="absolute left-0 right-0"
        style={{ top: "50%", height: "1px", background: "linear-gradient(90deg, transparent, #4DA2FF, #00FFB2, #4DA2FF, transparent)" }}
        initial={{ scaleX: 0 }}
        animate={phase >= 1 ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      />

      <div className="relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.85 }}
          animate={phase >= 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{ fontFamily: "Space Grotesk, sans-serif" }}
        >
          <div className="flex items-center gap-3 justify-center mb-1">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #4DA2FF, #00FFB2)" }}>
              <span style={{ fontSize: "1.2rem", fontWeight: 900, color: "#040D21" }}>S</span>
            </div>
            <span style={{ fontSize: "clamp(2rem, 6vw, 4rem)", fontWeight: 900, color: "#F0F8FF", letterSpacing: "-0.04em" }}>
              SuiBets
            </span>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, filter: "blur(8px)" }}
          animate={phase >= 3 ? { opacity: 0.7, filter: "blur(0px)" } : { opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.4 }}
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "clamp(0.6rem, 1.5vw, 0.9rem)", color: "#6FBCF0", letterSpacing: "0.2em", textTransform: "uppercase" }}
        >
          8 Reasons Sui Changes Everything
        </motion.p>
      </div>

      <motion.div
        className="absolute bottom-[8%] left-0 right-0 flex justify-center gap-2"
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 0.2 }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} className="rounded-full"
            style={{ width: 6, height: 6, background: "#4DA2FF", opacity: 0.3 }} />
        ))}
      </motion.div>
    </motion.div>
  );
}
