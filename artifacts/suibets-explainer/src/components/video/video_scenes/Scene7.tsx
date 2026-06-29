import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene7() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 4500),
      setTimeout(() => setPhase(5), 6000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center mb-10 w-full max-w-5xl">
        <motion.h2 
          className="text-[4vw] font-display font-bold leading-tight text-white mb-2"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          The <span className="text-gradient-cyan">Settlement</span> Engine
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-white/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Zero false losses. Null-safe gates. Payouts in 390ms.
        </motion.p>
      </div>

      <div className="flex items-center justify-center gap-2 w-full max-w-6xl mt-4">
        {/* Step 1 */}
        <motion.div 
          className="w-[14vw] h-[14vw] rounded-full border-2 border-white/10 bg-[#0a1628] flex flex-col items-center justify-center p-4 text-center relative z-10"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="text-[2.5vw] mb-1">🏁</div>
          <div className="text-[1vw] font-bold text-white">Match Ends</div>
          <div className="text-[0.7vw] text-white/50 mt-1">API fetches result</div>
        </motion.div>

        {/* Arrow 1 */}
        <motion.div 
          className="flex-1 flex flex-col items-center"
          initial={{ opacity: 0 }} animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        >
          <div className="text-[0.7vw] text-[#00D4FF] font-mono mb-1">Fetch</div>
          <div className="w-full h-1 bg-gradient-to-r from-white/10 to-[#00D4FF]/50 relative">
            <motion.div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#00D4FF] shadow-[0_0_10px_#00D4FF]"
              initial={{ left: 0 }} animate={phase >= 2 ? { left: '100%' } : { left: 0 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
        </motion.div>

        {/* Step 2 */}
        <motion.div 
          className="w-[18vw] h-[18vw] rounded-full border-2 border-[#00D4FF]/50 bg-[#112a4f] flex flex-col items-center justify-center p-4 text-center relative z-10 shadow-[0_0_30px_rgba(0,212,255,0.2)]"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <motion.div 
            className="absolute inset-0 rounded-full border-2 border-dashed border-[#00D4FF] opacity-30"
            animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          />
          <div className="text-[1.2vw] font-bold text-[#00D4FF] mb-1 font-mono leading-tight">25 Pattern<br/>Matchers</div>
          <div className="text-[0.8vw] text-white/70">Smart Resolution</div>
          <div className="text-[1vw] font-bold text-white mt-2 border border-white/20 px-2 py-1 rounded bg-black/20">347 Odds Combos</div>
        </motion.div>

        {/* Arrow 2 - Null Safe Gate */}
        <motion.div 
          className="flex-[1.5] flex flex-col items-center relative"
          initial={{ opacity: 0 }} animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        >
          <div className="text-[0.7vw] text-[#FFD700] font-mono mb-1 px-2 py-0.5 border border-[#FFD700]/50 rounded bg-[#FFD700]/10">Null-Safe Gate</div>
          <div className="w-full h-1 bg-gradient-to-r from-[#00D4FF]/50 to-[#FFD700]/50 relative">
            <motion.div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#FFD700] shadow-[0_0_10px_#FFD700]"
              initial={{ left: 0 }} animate={phase >= 3 ? { left: '100%' } : { left: 0 }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.5 }}
            />
          </div>
        </motion.div>

        {/* Step 3 */}
        <motion.div 
          className="w-[14vw] h-[14vw] rounded-full border-2 border-[#FFD700]/50 bg-[#0a1628] flex flex-col items-center justify-center p-4 text-center relative z-10"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="text-[2vw] mb-1">⛓️</div>
          <div className="text-[1vw] font-bold text-white leading-tight">Smart<br/>Contract</div>
          <div className="text-[0.7vw] text-[#FFD700] mt-1">Verifies outcome</div>
        </motion.div>

        {/* Arrow 3 */}
        <motion.div 
          className="flex-1 flex flex-col items-center"
          initial={{ opacity: 0 }} animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
        >
          <div className="text-[0.7vw] text-[#00D4FF] font-mono mb-1 text-center">Execute</div>
          <div className="w-full h-1 bg-gradient-to-r from-[#FFD700]/50 to-[#00D4FF] relative">
            <motion.div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#00D4FF] shadow-[0_0_10px_#00D4FF]"
              initial={{ left: 0 }} animate={phase >= 4 ? { left: '100%' } : { left: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </motion.div>

        {/* Step 4 */}
        <motion.div 
          className="w-[15vw] h-[15vw] rounded-full border-4 border-[#00D4FF] bg-gradient-to-br from-[#00D4FF]/20 to-transparent flex flex-col items-center justify-center p-4 text-center relative z-10 shadow-[0_0_30px_rgba(0,212,255,0.4)]"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="text-[1.2vw] font-bold text-white mb-1">Payout</div>
          <div className="text-[2.2vw] font-black text-[#00D4FF] font-mono leading-none">390<span className="text-[1vw]">ms</span></div>
        </motion.div>
      </div>

      <div className="mt-8 flex gap-8 w-full max-w-5xl justify-center items-stretch">
        {/* Smart matching example */}
        <motion.div 
          className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-center"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          <div className="text-[0.9vw] text-white/50 mb-2 uppercase tracking-wider font-mono">Smart Team Resolution</div>
          <div className="flex items-center gap-3 text-[1vw] font-mono text-[#00D4FF]">
            <span className="bg-black/30 px-2 py-1 rounded">"FC Barcelona"</span>
            <span>→</span>
            <span className="bg-black/30 px-2 py-1 rounded">"Barcelona"</span>
            <span>→</span>
            <span className="bg-black/30 px-2 py-1 rounded">"Barça"</span>
            <span className="text-[#10B981] font-bold bg-[#10B981]/20 px-2 py-1 rounded ml-auto">ALL RESOLVE ✓</span>
          </div>
        </motion.div>

        {/* Fallback rule */}
        <motion.div 
          className="flex-1 text-[1.1vw] font-mono text-white/50 border border-white/10 p-4 rounded-xl bg-white/5 flex items-center justify-center"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          <span className="text-[#00D4FF]">if</span> (!100% Confident) {"{"} status = PENDING {"}"}
        </motion.div>
      </div>
    </motion.div>
  );
}
