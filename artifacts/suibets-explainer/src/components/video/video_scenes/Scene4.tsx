import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // "On-Chain Engines"
      setTimeout(() => setPhase(2), 1500), // WARP
      setTimeout(() => setPhase(3), 3500), // FLUX
      setTimeout(() => setPhase(4), 5500), // PULSE
      setTimeout(() => setPhase(5), 9000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const containerVariants = {
    hidden: { opacity: 0, y: 50 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, type: 'spring' } }
  };

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-transparent z-10 p-12"
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -100, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.h2
        className="text-[4vw] font-black font-display mb-12 tracking-tight"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
      >
        <span className="text-white">Custom</span> <span className="text-gradient-cyan">On-Chain</span> <span className="text-white">Engines</span>
      </motion.h2>

      <div className="flex gap-8 w-full max-w-7xl">
        {/* WARP */}
        <motion.div 
          className="flex-1 bg-card border border-white/10 rounded-2xl p-8 relative overflow-hidden"
          variants={containerVariants}
          initial="hidden"
          animate={phase >= 2 ? "visible" : "hidden"}
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
          <h3 className="text-[2.5vw] font-black mb-2 text-primary">WARP</h3>
          <p className="text-[1vw] font-mono text-white/50 mb-8 uppercase tracking-wide">Batch Settlement</p>
          <div className="text-[3vw] font-mono font-bold leading-none mb-2">512</div>
          <p className="text-[1.2vw] text-white/70">Bets settled per transaction.</p>
        </motion.div>

        {/* FLUX */}
        <motion.div 
          className="flex-1 bg-card border border-white/10 rounded-2xl p-8 relative overflow-hidden"
          variants={containerVariants}
          initial="hidden"
          animate={phase >= 3 ? "visible" : "hidden"}
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-secondary" />
          <h3 className="text-[2.5vw] font-black mb-2 text-secondary">FLUX</h3>
          <p className="text-[1vw] font-mono text-white/50 mb-8 uppercase tracking-wide">Fractional Fills</p>
          <div className="text-[3vw] font-mono font-bold leading-none mb-2">Partial</div>
          <p className="text-[1.2vw] text-white/70">Match any size automatically.</p>
        </motion.div>

        {/* PULSE */}
        <motion.div 
          className="flex-1 bg-card border border-white/10 rounded-2xl p-8 relative overflow-hidden"
          variants={containerVariants}
          initial="hidden"
          animate={phase >= 4 ? "visible" : "hidden"}
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-success" />
          <h3 className="text-[2.5vw] font-black mb-2 text-success">PULSE</h3>
          <p className="text-[1vw] font-mono text-white/50 mb-8 uppercase tracking-wide">Pari-Mutuel Pools</p>
          <div className="text-[3vw] font-mono font-bold leading-none mb-2">Dynamic</div>
          <p className="text-[1.2vw] text-white/70">Shared liquidity markets.</p>
        </motion.div>
      </div>
    </motion.div>
  );
}