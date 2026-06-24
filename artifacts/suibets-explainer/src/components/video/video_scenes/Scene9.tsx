import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene9() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 3800),
      setTimeout(() => setPhase(5), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center mb-10 w-full max-w-5xl">
        <motion.h2 
          className="text-[4vw] font-display font-bold leading-tight text-white"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <span className="text-[#FFD700]">Gift</span> Bets 🎁
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-white/70 mt-2 max-w-2xl mx-auto"
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
        >
          Place a bet where the winnings go directly to someone else's wallet.
        </motion.p>
      </div>

      <div className="flex items-center gap-6 w-full max-w-6xl justify-center relative">
        {/* Sender & Bet Slip toggle */}
        <motion.div 
          className="w-[22vw] bg-[#0a1628] border border-white/10 rounded-2xl p-5 relative z-10 flex flex-col shadow-xl"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
        >
          <div className="flex items-center gap-3 mb-4 border-b border-white/5 pb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 border-2 border-white/20" />
            <div>
              <div className="text-[1vw] font-bold text-white leading-tight">You</div>
              <div className="text-[0.8vw] font-mono text-white/50">0x1A...9F2</div>
            </div>
          </div>
          
          <div className="bg-[#112a4f] rounded-xl p-3 border border-white/5 mb-4">
            <div className="text-[0.9vw] text-white mb-1 font-bold">MCI to Win</div>
            <div className="flex justify-between items-center text-[0.8vw]">
              <span className="text-white/50">Stake</span>
              <span className="font-bold text-[#00D4FF]">50 SUI</span>
            </div>
          </div>

          <motion.div 
            className="bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-lg p-3 flex justify-between items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          >
            <div className="text-[0.9vw] font-bold text-[#FFD700]">Gift Winnings</div>
            {/* Toggle switch visual */}
            <div className="w-8 h-4 bg-[#FFD700] rounded-full relative">
              <div className="absolute right-0.5 top-0.5 w-3 h-3 bg-black rounded-full" />
            </div>
          </motion.div>
          {phase >= 3 && (
            <motion.div 
              className="mt-2 text-[0.7vw] font-mono text-white/50 bg-black/20 p-2 rounded border border-white/5"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              Recipient: <span className="text-white">0x7C...B31</span>
            </motion.div>
          )}
        </motion.div>

        {/* Path / Contract */}
        <div className="flex-[1.5] h-32 relative flex items-center justify-center">
          <motion.div 
            className="absolute inset-x-0 h-1.5 bg-white/10 overflow-hidden"
            initial={{ scaleX: 0 }}
            animate={phase >= 4 ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Gradient trail that fills the track */}
            <motion.div 
              className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-[#00D4FF] via-[#FFD700] to-[#10B981] opacity-70"
              initial={{ x: '-100%' }}
              animate={phase >= 4 ? { x: 0 } : { x: '-100%' }}
              transition={{ duration: 1, ease: 'linear' }}
            />
          </motion.div>
          
          <motion.div 
            className="bg-[#112a4f] border-2 border-[#FFD700] rounded-xl px-5 py-3 relative z-10 font-bold text-[#FFD700] text-[1.1vw] shadow-[0_0_20px_rgba(255,215,0,0.2)]"
            initial={{ opacity: 0, scale: 0 }}
            animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
            transition={{ type: 'spring', stiffness: 200 }}
          >
            Gift Bet Contract
          </motion.div>

          {/* Winnings moving with trail */}
          {phase >= 5 && (
            <motion.div 
              className="absolute w-12 h-12 bg-[#10B981] rounded-full shadow-[0_0_30px_#10B981] z-20 flex items-center justify-center text-black text-xl font-black border-2 border-white/50"
              initial={{ left: '10%', opacity: 0, scale: 0.5 }}
              animate={{ left: '90%', opacity: [0, 1, 1, 0], scale: 1 }}
              transition={{ duration: 1.5, ease: 'easeInOut' }}
            >
              $
              <motion.div 
                className="absolute right-full top-1/2 -translate-y-1/2 h-4 w-16 bg-gradient-to-r from-transparent to-[#10B981] opacity-50 blur-sm pointer-events-none"
              />
            </motion.div>
          )}
        </div>

        {/* Receiver */}
        <motion.div 
          className="w-[20vw] bg-[#0a1628] border border-[#10B981]/30 rounded-2xl p-6 text-center relative z-10 overflow-hidden shadow-xl"
          initial={{ opacity: 0, x: 50 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
        >
          {phase >= 5 && (
            <motion.div 
              className="absolute inset-0 bg-[#10B981]/10"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            />
          )}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 mx-auto mb-3 border-2 border-white/20 relative">
            <motion.div 
              className="absolute -top-2 -right-2 w-6 h-6 bg-[#10B981] rounded-full text-white flex items-center justify-center text-xs shadow-lg"
              initial={{ scale: 0 }}
              animate={phase >= 5 ? { scale: 1 } : { scale: 0 }}
            >
              ✓
            </motion.div>
          </div>
          <div className="text-[1.2vw] font-bold text-white mb-1">Friend</div>
          <div className="text-[0.8vw] font-mono text-white/50 mb-4">0x7C...B31</div>
          
          <motion.div 
            className="bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl p-3"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          >
            <div className="text-[0.8vw] text-[#10B981] mb-1 font-bold uppercase tracking-wider">Winnings Received</div>
            <div className="text-[1.5vw] font-black text-white">92.5 SUI</div>
          </motion.div>
        </motion.div>
      </div>
      
      <motion.div 
        className="flex gap-4 mt-12 flex-wrap justify-center max-w-4xl"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        {["Friends", "Communities", "Giveaways", "Creators"].map((tag, i) => (
          <motion.div 
            key={tag}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[1vw] text-white/70 font-medium"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
            transition={{ delay: 0.5 + i * 0.1 }}
          >
            Works for: <span className="text-white">{tag}</span>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
