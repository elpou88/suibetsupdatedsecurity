import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // "Traditional Betting"
      setTimeout(() => setPhase(2), 2000), // "The House Always Wins"
      setTimeout(() => setPhase(3), 3500), // Strike through
      setTimeout(() => setPhase(4), 5000), // Shatter/Red
      setTimeout(() => setPhase(5), 7000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-transparent z-10"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative text-center max-w-5xl px-8 z-20 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          className="text-[1.5vw] font-mono text-white/50 tracking-widest uppercase mb-8"
        >
          [ Traditional Sportsbooks ]
        </motion.div>
        
        <div className="relative">
          <motion.h2 
            className="text-[8vw] font-black font-display leading-[0.9] tracking-tighter"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.6, type: 'spring', bounce: 0.4 }}
          >
            HOUSE EDGE
          </motion.h2>

          {/* Strike through line */}
          <motion.div
            className="absolute top-1/2 left-0 h-[1vw] bg-danger w-full -translate-y-1/2 rotate-[-2deg] origin-left z-30 glow-danger"
            initial={{ scaleX: 0 }}
            animate={phase >= 3 ? { scaleX: 1.1 } : { scaleX: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
          
          {/* Glitch / shatter effect when struck */}
          {phase >= 4 && (
            <motion.div 
              className="absolute inset-0 flex items-center justify-center mix-blend-screen text-danger text-[8vw] font-black font-display leading-[0.9] tracking-tighter z-20"
              animate={{
                x: [-10, 10, -5, 5, 0],
                y: [5, -5, 10, -10, 0],
                opacity: [1, 0.8, 1, 0.4, 0]
              }}
              transition={{ duration: 0.5 }}
            >
              HOUSE EDGE
            </motion.div>
          )}
        </div>
        
        <motion.p
          className="mt-12 text-[2vw] text-danger font-mono font-bold uppercase tracking-widest"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, type: 'spring' }}
        >
          Destroyed.
        </motion.p>
      </div>

      {/* Red ambient glow */}
      <motion.div 
        className="absolute inset-0 bg-danger mix-blend-overlay z-0"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 0.15 } : { opacity: 0 }}
        transition={{ duration: 0.3 }}
      />
    </motion.div>
  );
}