import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene11() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 3500),
      setTimeout(() => setPhase(5), 4500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center mb-10 w-full max-w-5xl relative">
        <motion.div
          className="absolute right-0 top-1/2 -translate-y-1/2 border border-[#e94560]/50 bg-[#e94560]/10 text-[#e94560] px-4 py-2 rounded-full font-mono text-[1vw] font-bold"
          initial={{ opacity: 0, x: 20 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
        >
          Deflationary by Design
        </motion.div>
        
        <motion.h2 
          className="text-[4vw] font-display font-bold leading-tight text-white"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        >
          Real <span className="text-gradient-gold">Yield</span>. Real <span className="text-[#00D4FF]">Deflation</span>.
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-white/70 mt-2"
          initial={{ opacity: 0 }} animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
        >
          The SBETS Tokenomics Engine
        </motion.p>
      </div>

      <div className="flex gap-6 w-full max-w-6xl justify-center items-stretch">
        {/* Buyback & Burn */}
        <motion.div 
          className="flex-[1.2] bg-[#0a1628] border border-[#e94560]/30 rounded-2xl p-6 relative overflow-hidden flex flex-col"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#e94560] rounded-full blur-[50px] opacity-10" />
          <div className="text-[2.5vw] mb-3">🔥</div>
          <h3 className="text-[1.5vw] font-bold text-white mb-2">Buyback & Burn</h3>
          <p className="text-[1vw] text-white/70 mb-4 flex-1">
            <span className="font-bold text-[#e94560]">3% of ALL revenue</span> triggers an automatic buyback. Tokens are permanently burned. Every bet reduces supply.
          </p>
          
          <div className="mt-auto bg-black/30 rounded-xl p-3 font-mono text-[0.9vw]">
            <div className="flex justify-between text-white/50 mb-1"><span>Total Burned</span> <span>Live</span></div>
            <div className="text-[1.8vw] font-black text-[#e94560] leading-none">4,291,048 <span className="text-[0.8vw]">SBETS</span></div>
          </div>
        </motion.div>

        {/* Staking Rewards */}
        <motion.div 
          className="flex-1 bg-[#0a1628] border border-[#FFD700]/30 rounded-2xl p-6 relative overflow-hidden flex flex-col"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700] rounded-full blur-[50px] opacity-10" />
          <div className="text-[2.5vw] mb-3">💰</div>
          <h3 className="text-[1.5vw] font-bold text-white mb-2">SBETS Rewards</h3>
          <p className="text-[1vw] text-white/70 mb-4 flex-1">
            SBETS holders earn platform rewards paid in <span className="font-bold text-[#00D4FF]">SUI</span>. Be the house. Share the revenue.
          </p>
          
          <div className="mt-auto bg-black/30 rounded-xl p-3 font-mono text-[0.9vw]">
            <div className="flex justify-between text-white/50 mb-1"><span>Current APR</span> <span>Est.</span></div>
            <div className="text-[1.8vw] font-black text-[#FFD700] leading-none">42.8%</div>
          </div>
        </motion.div>

        {/* LP Revenue Sharing */}
        <motion.div 
          className="flex-1 bg-[#0a1628] border border-[#00D4FF]/30 rounded-2xl p-6 relative overflow-hidden flex flex-col"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#00D4FF] rounded-full blur-[50px] opacity-10" />
          <div className="text-[2.5vw] mb-3">💧</div>
          <h3 className="text-[1.5vw] font-bold text-white mb-2">LP Revenue Sharing</h3>
          <p className="text-[1vw] text-white/70 mb-4 flex-1">
            Provide liquidity on <span className="font-bold text-white">Cetus DEX</span> to earn a direct cut of trading fees and protocol revenue.
          </p>
          
          <div className="mt-auto bg-black/30 rounded-xl p-3 font-mono text-[0.9vw]">
            <div className="flex justify-between text-white/50 mb-1"><span>Pool Value</span> <span>TVL</span></div>
            <div className="text-[1.8vw] font-black text-[#00D4FF] leading-none">$1.2M</div>
          </div>
        </motion.div>
      </div>

      {/* Visual Flow Indicator */}
      <motion.div 
        className="mt-10 bg-white/5 border border-white/10 rounded-full px-8 py-4 flex items-center justify-center gap-4 text-[1.1vw] font-mono text-white/80 w-full max-w-4xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
      >
        <span className="font-bold text-white">Platform Revenue</span>
        <span className="text-white/40">→</span>
        <span className="text-[#e94560] font-bold">3% Allocation</span>
        <span className="text-white/40">→</span>
        <span className="text-[#00D4FF] bg-[#00D4FF]/10 px-2 py-1 rounded">Cetus DEX Swap</span>
        <span className="text-white/40">→</span>
        <span className="text-[#e94560] font-black border border-[#e94560] px-2 py-1 rounded">BURN 🔥</span>
      </motion.div>
    </motion.div>
  );
}
