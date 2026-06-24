import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[20%] w-[80%] h-px bg-white/10 overflow-hidden">
        <motion.div 
          className="absolute top-0 left-0 h-full w-[20%] bg-red-500/80 blur-sm"
          animate={{ left: ['-20%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        />
      </div>
      <div className="absolute bottom-[20%] w-[80%] h-px bg-white/10 overflow-hidden">
        <motion.div 
          className="absolute top-0 left-0 h-full w-[20%] bg-red-500/80 blur-sm"
          animate={{ left: ['100%', '-20%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear', delay: 1 }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-5xl">
        <motion.div
          className="text-red-500 font-mono text-[1.5vw] mb-8 uppercase tracking-widest border border-red-500/30 bg-red-500/10 px-4 py-1 rounded"
          initial={{ opacity: 0, y: -20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        >
          // ERROR: Settlement Bottleneck
        </motion.div>
        
        <div className="flex gap-12 w-full justify-center">
          <motion.div 
            className="flex flex-col items-center"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          >
            <div className="text-[1.2vw] text-white/50 font-mono mb-2 uppercase">Transactions</div>
            <div className="text-[5vw] font-black leading-none text-white tracking-tighter" style={{ fontFamily: 'var(--font-display)' }}>
              Fragmented
            </div>
          </motion.div>

          <motion.div 
            className="flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
          >
            <div className="text-[1.2vw] text-white/50 font-mono mb-2 uppercase">Gas Costs</div>
            <div className="text-[5vw] font-black leading-none text-red-500 tracking-tighter" style={{ fontFamily: 'var(--font-display)' }}>
              Wasted
            </div>
          </motion.div>
        </div>

        <motion.p
          className="mt-12 text-[2vw] text-white/70 font-mono"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
        >
          The old way of on-chain betting is breaking.
        </motion.p>
      </div>

      {/* Grid Network background integration */}
      <motion.div 
        className="absolute inset-0 z-[-1] opacity-20"
        initial={{ scale: 1.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.2 }}
        transition={{ duration: 6, ease: "easeOut" }}
      >
        <img src={`${import.meta.env.BASE_URL}images/grid-network.png`} className="w-full h-full object-cover mix-blend-screen grayscale" />
      </motion.div>
    </motion.div>
  );
}