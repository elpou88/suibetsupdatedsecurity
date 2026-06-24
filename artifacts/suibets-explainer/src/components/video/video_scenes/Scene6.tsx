import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Logo
      setTimeout(() => setPhase(2), 2000),  // "Zero house edge."
      setTimeout(() => setPhase(3), 3500),  // "Pure P2P."
      setTimeout(() => setPhase(4), 5000),  // "Live on Sui mainnet."
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-transparent z-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <div className="relative text-center flex flex-col items-center">
        
        <motion.div
          initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="mb-12"
        >
          <div className="text-[8vw] font-black font-display tracking-tighter">
            <span className="text-white">Sui</span><span className="text-primary">Bets</span>
          </div>
        </motion.div>

        <div className="flex flex-col items-center gap-6 text-[2vw] font-mono tracking-widest uppercase">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            className="text-white"
          >
            Zero House Edge.
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            className="text-primary"
          >
            Pure P2P.
          </motion.div>
        </div>

        <motion.div
          className="mt-16 bg-white/5 border border-white/20 px-8 py-4 rounded-full backdrop-blur-md relative overflow-hidden group"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ delay: 0.5, type: 'spring' }}
        >
          <motion.div 
            className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/20 to-transparent"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
          <span className="text-[1.5vw] font-bold text-white tracking-wide relative z-10">Live on Sui Mainnet</span>
        </motion.div>
      </div>
    </motion.div>
  );
}