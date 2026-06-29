import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // "Seamless UX"
      setTimeout(() => setPhase(2), 2000),  // zkLogin
      setTimeout(() => setPhase(3), 4000),  // Passkey
      setTimeout(() => setPhase(4), 6000),  // Walrus
      setTimeout(() => setPhase(5), 8500),  // Tagline: "No seed phrase. No extension. Just bet."
      setTimeout(() => setPhase(6), 11000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-transparent z-10 p-16"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex w-full max-w-6xl items-center">
        
        {/* Left column - Features */}
        <div className="flex-1 flex flex-col gap-8">
          <motion.div
            className="flex items-center gap-6"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ type: 'spring' }}
          >
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center border border-primary/50 text-primary text-2xl font-bold font-mono">1</div>
            <div>
              <div className="text-[2.5vw] font-black text-white">zkLogin</div>
              <div className="text-[1.2vw] text-white/50 font-mono">Google sign-in → Sui address</div>
            </div>
          </motion.div>

          <motion.div
            className="flex items-center gap-6"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ type: 'spring' }}
          >
            <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center border border-secondary/50 text-secondary text-2xl font-bold font-mono">2</div>
            <div>
              <div className="text-[2.5vw] font-black text-white">Passkey</div>
              <div className="text-[1.2vw] text-white/50 font-mono">Face ID / Touch ID auth</div>
            </div>
          </motion.div>

          <motion.div
            className="flex items-center gap-6"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 4 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ type: 'spring' }}
          >
            <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center border border-success/50 text-success text-2xl font-bold font-mono">3</div>
            <div>
              <div className="text-[2.5vw] font-black text-white">Walrus</div>
              <div className="text-[1.2vw] text-white/50 font-mono">Decentralized bet receipts</div>
            </div>
          </motion.div>
        </div>

        {/* Right column - Tagline */}
        <div className="flex-1 flex items-center justify-center pl-16 border-l border-white/10">
          <motion.div
            className="text-[4vw] font-black font-display leading-[1.1] tracking-tight"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={phase >= 5 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 1 }}
          >
            <span className="text-white/40 block">No seed phrase.</span>
            <span className="text-white/60 block mt-2">No extension.</span>
            <span className="text-primary block mt-4 tracking-tighter">Just bet.</span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}