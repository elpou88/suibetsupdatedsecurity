import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene8() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
      setTimeout(() => setPhase(5), 5500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-[45vw] z-10">
        <motion.div
          className="flex items-center gap-3 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          <div className="inline-block px-4 py-1 rounded-full bg-[#00D4FF]/20 border border-[#00D4FF]/30 text-[#00D4FF] font-mono text-[1vw] font-bold uppercase tracking-widest">
            Social Features
          </div>
          <div className="inline-block px-3 py-1 rounded-full bg-[#10B981]/20 border border-[#10B981]/30 text-[#10B981] font-mono text-[0.8vw] font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            Sui Seal Encrypted
          </div>
        </motion.div>

        <motion.h2 
          className="text-[4vw] font-display font-bold leading-tight text-white mb-6"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.1 }}
        >
          Live Chat & <br />
          <span className="text-gradient-cyan">P2P Challenges</span>
        </motion.h2>
        
        <motion.p 
          className="text-[1.5vw] text-white/70 mb-8 max-w-lg"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          E2E encrypted messaging. Challenge any wallet directly. No house edge.
        </motion.p>
      </div>

      <div className="w-[40vw] relative">
        <motion.div 
          className="bg-[#0a1628] border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.15)] relative overflow-hidden"
          initial={{ opacity: 0, x: 50 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="bg-[#112a4f] p-4 border-b border-white/10 flex justify-between items-center">
            <div className="font-bold text-[1.2vw]">Match Chat: LAL vs GSW</div>
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-full border border-white/10">
              <div className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
              <div className="text-white/70 text-[0.9vw]">1,248 online</div>
            </div>
          </div>
          
          <div className="p-6 h-[45vh] flex flex-col gap-4 overflow-hidden relative">
            {/* Chat Bubble 1 */}
            <motion.div 
              className="flex gap-3"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.2 }}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 shadow-md" />
              <div className="flex-1 max-w-[80%]">
                <div className="text-[0.9vw] text-white/50 mb-1">0x8f2...9a1</div>
                <div className="bg-[#112a4f] p-3 rounded-2xl rounded-tl-none text-[1.1vw] shadow-sm">
                  LeBron is going off tonight! 👑
                </div>
              </div>
            </motion.div>

            {/* Chat Bubble 2 - Response */}
            <motion.div 
              className="flex gap-3 justify-end"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            >
              <div className="flex-1 max-w-[80%] flex flex-col items-end">
                <div className="text-[0.9vw] text-white/50 mb-1">0x3b1...c82</div>
                <div className="bg-[#00D4FF]/20 text-white p-3 rounded-2xl rounded-tr-none text-[1.1vw] border border-[#00D4FF]/30">
                  Nah, Steph is about to heat up.
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-red-500 shadow-md" />
            </motion.div>

            {/* P2P Challenge Card */}
            <motion.div 
              className="mt-2 border border-[#FFD700]/30 bg-[#FFD700]/10 rounded-xl p-5 relative overflow-hidden shadow-lg backdrop-blur-md"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={phase >= 4 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-[#FFD700] rounded-full blur-[40px] opacity-20" />
              
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                  <div className="font-bold text-[#FFD700] text-[1.1vw] mb-1 flex items-center gap-2">
                    <span>⚔️</span> P2P CHALLENGE
                  </div>
                  <div className="text-[0.9vw] text-white/60">Stakes: 100 SUI each</div>
                </div>
                <div className="text-[1.5vw] font-black font-mono text-white">200 SUI <span className="text-[0.9vw] font-sans text-[#FFD700]">POT</span></div>
              </div>
              
              <div className="text-[1.2vw] mb-5 text-white/90 font-medium">I bet GSW wins by +5. Who wants it?</div>
              
              <div className="flex flex-col gap-2">
                <motion.button 
                  className="w-full py-3 bg-[#FFD700] text-black font-bold rounded-lg text-[1vw] relative overflow-hidden shadow-[0_4px_14px_rgba(255,215,0,0.3)] transition-all"
                  animate={phase >= 5 ? { background: '#10B981', color: 'white', scale: 0.98 } : {}}
                >
                  {phase >= 5 ? '✓ ACCEPTED BY 0x3B...C82' : 'ACCEPT WAGER'}
                </motion.button>
                
                {phase >= 5 && (
                  <motion.div 
                    className="text-center text-[0.8vw] text-[#10B981] font-mono"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  >
                    Settlement: Auto on match end
                  </motion.div>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
