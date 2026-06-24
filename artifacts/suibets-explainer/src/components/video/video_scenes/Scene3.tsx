import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // "SuiBets P2P"
      setTimeout(() => setPhase(2), 1500), // Creator posts offer
      setTimeout(() => setPhase(3), 3000), // Arrow
      setTimeout(() => setPhase(4), 4000), // Taker fills
      setTimeout(() => setPhase(5), 5500), // "No Middleman"
      setTimeout(() => setPhase(6), 8000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-transparent z-10 p-16"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        className="text-[1.5vw] font-mono text-primary tracking-widest uppercase mb-12 border border-primary/30 bg-primary/10 px-6 py-2 rounded"
      >
        Pure P2P Architecture
      </motion.div>

      <div className="flex items-center justify-center gap-12 w-full max-w-6xl relative">
        {/* Creator */}
        <motion.div
          className="flex flex-col items-center w-[30%]"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
        >
          <div className="w-[12vw] h-[16vw] bg-card border-2 border-primary/50 rounded-2xl p-6 relative overflow-hidden glow-cyan flex flex-col justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,255,255,0.2),transparent_50%)]" />
            <div className="text-[1vw] font-mono text-primary uppercase">Maker</div>
            <div className="text-[2.5vw] font-black leading-none">Posts<br/>Offer</div>
            <div className="h-1 w-full bg-primary/30 mt-4 rounded overflow-hidden">
              <motion.div 
                className="h-full bg-primary" 
                initial={{ width: 0 }}
                animate={phase >= 2 ? { width: '100%' } : { width: 0 }}
                transition={{ duration: 1, delay: 0.5 }}
              />
            </div>
          </div>
        </motion.div>

        {/* Connection */}
        <motion.div
          className="flex-1 h-[2px] bg-white/20 relative"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        >
          <motion.div
            className="absolute top-1/2 left-0 h-[4px] bg-primary -translate-y-1/2 glow-cyan"
            initial={{ width: 0 }}
            animate={phase >= 3 ? { width: '100%' } : { width: 0 }}
            transition={{ duration: 1, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-4 h-4 rotate-45 border-t-2 border-r-2 border-primary"
            initial={{ opacity: 0 }}
            animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.8 }}
          />
          
          {phase >= 5 && (
            <motion.div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-base px-4 py-2 border border-danger/50 text-danger font-mono text-[1.2vw] uppercase tracking-wider rounded whitespace-nowrap glow-danger"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', bounce: 0.6 }}
            >
              Zero Middleman
            </motion.div>
          )}
        </motion.div>

        {/* Taker */}
        <motion.div
          className="flex flex-col items-center w-[30%]"
          initial={{ opacity: 0, x: 50 }}
          animate={phase >= 4 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
        >
          <div className="w-[12vw] h-[16vw] bg-card border-2 border-secondary/50 rounded-2xl p-6 relative overflow-hidden glow-purple flex flex-col justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(168,85,247,0.2),transparent_50%)]" />
            <div className="text-[1vw] font-mono text-secondary uppercase text-right">Taker</div>
            <div className="text-[2.5vw] font-black leading-none text-right">Fills<br/>Other<br/>Side</div>
            <div className="h-1 w-full bg-secondary/30 mt-4 rounded overflow-hidden flex justify-end">
              <motion.div 
                className="h-full bg-secondary" 
                initial={{ width: 0 }}
                animate={phase >= 4 ? { width: '100%' } : { width: 0 }}
                transition={{ duration: 1, delay: 0.5 }}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}