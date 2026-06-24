import { motion, AnimatePresence } from "framer-motion";
import { useVideoPlayer } from "@/lib/video";
import { SceneHook }       from "./video_scenes/SceneHook";
import { SceneP2P }        from "./video_scenes/SceneP2P";
import { SceneEngines }    from "./video_scenes/SceneEngines";
import { SceneSuiStack }   from "./video_scenes/SceneSuiStack";
import { SceneStats }      from "./video_scenes/SceneStats";
import { SceneOutroFinal } from "./video_scenes/SceneOutroFinal";

const SCENE_DURATIONS = {
  hook:      4200,   // "PEER TO PEER" kinetic open
  p2p:       6500,   // P2P order book — creator vs taker
  engines:   8000,   // 4 engines reveal cards
  sui_stack: 6500,   // Sui primitives grid
  stats:     4500,   // Big number stats + contract hash
  outro:     6500,   // Logo + "The future is P2P"
};

const SCENE_KEYS = Object.keys(SCENE_DURATIONS) as Array<keyof typeof SCENE_DURATIONS>;

const BADGE_LABELS: Record<keyof typeof SCENE_DURATIONS, string> = {
  hook:      "SUIBETS",
  p2p:       "P2P ORDER BOOK",
  engines:   "4 ENGINES",
  sui_stack: "SUI PRIMITIVES",
  stats:     "SUI MAINNET",
  outro:     "SUI OVERFLOW 2026",
};

// Persistent drifting orbs — one per engine color + cyan base
const ORBS = [
  { w: "40vw", h: "40vw", top: "-12%", left: "-8%",  color: "rgba(6,182,212,0.055)",  dur: 14, dx: ["-4%","11%","-2%"], dy: ["4%","20%","7%"]  },
  { w: "32vw", h: "32vw", top: "60%",  left: "70%",  color: "rgba(6,182,212,0.04)",   dur: 18, dx: ["5%","-9%","3%"],  dy: ["-7%","9%","-3%"] },
  { w: "24vw", h: "24vw", top: "36%",  left: "2%",   color: "rgba(245,158,11,0.035)", dur: 12, dx: ["7%","-4%","5%"],  dy: ["6%","-11%","4%"] },
  { w: "18vw", h: "18vw", top: "10%",  left: "76%",  color: "rgba(167,139,250,0.04)", dur: 16, dx: ["-6%","4%","-7%"], dy: ["4%","-6%","7%"]  },
  { w: "14vw", h: "14vw", top: "74%",  left: "34%",  color: "rgba(52,211,153,0.03)",  dur: 20, dx: ["3%","-5%","2%"],  dy: ["-4%","7%","-2%"] },
];

// Accent line shifts each scene
const ACCENT_POS = [
  { top: "88%", left: "8%",  width: "28%" },
  { top: "16%", left: "54%", width: "36%" },
  { top: "78%", left: "26%", width: "32%" },
  { top: "12%", left: "7%",  width: "44%" },
  { top: "84%", left: "60%", width: "24%" },
  { top: "55%", left: "72%", width: "20%" },
];

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const sceneKey = SCENE_KEYS[currentScene] ?? "hook";
  const accent = ACCENT_POS[currentScene] ?? ACCENT_POS[0];

  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{ background: "#04060d", fontFamily: "Space Grotesk, sans-serif" }}
    >
      {/* ── Persistent drifting orbs ── */}
      {ORBS.map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full blur-3xl pointer-events-none"
          style={{
            width: orb.w, height: orb.h, top: orb.top, left: orb.left,
            background: `radial-gradient(circle, ${orb.color}, transparent)`,
          }}
          animate={{ x: orb.dx, y: orb.dy }}
          transition={{ duration: orb.dur, repeat: Infinity, ease: "easeInOut", repeatType: "mirror" }}
        />
      ))}

      {/* ── Subtle grid lines ── */}
      {[25, 50, 75].map((pct, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${pct}%`, width: "1px", background: "rgba(255,255,255,0.018)" }}
        />
      ))}

      {/* ── Persistent accent line ── */}
      <motion.div
        className="absolute pointer-events-none"
        style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.45), transparent)" }}
        animate={{ top: accent.top, left: accent.left, width: accent.width }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* ── Scene badge (top-right) ── */}
      <motion.div
        className="absolute top-5 right-6 z-20 flex items-center gap-1.5 rounded-full px-3 py-1"
        style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.18)" }}
        animate={{ opacity: currentScene === 5 ? 0 : 0.85 }}
        transition={{ duration: 0.4 }}
      >
        <motion.div
          style={{ width: 5, height: 5, borderRadius: "50%", background: "#06b6d4" }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <AnimatePresence mode="popLayout">
          <motion.span
            key={sceneKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "clamp(0.38rem,0.65vw,0.5rem)",
              color: "#06b6d4", letterSpacing: "0.18em", whiteSpace: "nowrap",
            }}
          >
            {BADGE_LABELS[sceneKey]}
          </motion.span>
        </AnimatePresence>
      </motion.div>

      {/* ── Scene content ── */}
      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <SceneHook       key="hook"      />}
        {currentScene === 1 && <SceneP2P        key="p2p"       />}
        {currentScene === 2 && <SceneEngines    key="engines"   />}
        {currentScene === 3 && <SceneSuiStack   key="sui_stack" />}
        {currentScene === 4 && <SceneStats      key="stats"     />}
        {currentScene === 5 && <SceneOutroFinal key="outro"     />}
      </AnimatePresence>
    </div>
  );
}
