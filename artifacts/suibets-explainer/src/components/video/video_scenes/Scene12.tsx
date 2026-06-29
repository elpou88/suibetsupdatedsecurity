import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import bannerImg from '../../assets/suibets-home.jpg';

export function Scene12() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 2800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center text-center p-12 bg-gradient-to-b from-[#0a1628] to-[#040b14] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      {/* Background visual element */}
      <motion.div 
        className="absolute top-10 left-1/2 -translate-x-1/2 w-[80vw] h-[40vh] opacity-20 mask-image:linear-gradient(to_bottom,black,transparent)"
        initial={{ opacity: 0, y: -50 }}
        animate={phase >= 4 ? { opacity: 0.15, y: 0 } : { opacity: 0, y: -50 }}
        transition={{ duration: 1.5 }}
      >
        <img src={bannerImg} alt="Banner" className="w-full h-full object-cover rounded-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a1628]" />
      </motion.div>

      <motion.div 
        className="mb-8 z-10"
        initial={{ scale: 0, rotate: -180 }}
        animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <img src="https://iili.io/B5Hfuet.jpg" alt="SuiBets Logo" className="w-[8vw] h-[8vw] rounded-3xl shadow-[0_0_40px_rgba(0,212,255,0.4)]" />
      </motion.div>

      <motion.h1 
        className="text-[6vw] font-display font-black leading-none tracking-tighter text-white mb-6 z-10"
        initial={{ opacity: 0, y: 30 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      >
        suibets<span className="text-[#00D4FF]">.com</span>
      </motion.h1>

      <motion.div 
        className="flex gap-6 mb-10 text-[1.5vw] font-medium text-white/80 uppercase tracking-widest font-mono z-10"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
      >
        <span>Your Bets.</span>
        <span className="text-[#00D4FF]">•</span>
        <span>Your Proof.</span>
        <span className="text-[#00D4FF]">•</span>
        <span>Your Keys.</span>
      </motion.div>

      {/* Stats recap row */}
      <motion.div 
        className="flex gap-6 mb-10 text-[1vw] font-bold text-white/60 bg-black/40 px-8 py-4 rounded-full border border-white/5 backdrop-blur-md z-10"
        initial={{ opacity: 0, y: 20, scale: 0.9 }}
        animate={phase >= 3 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.9 }}
      >
        <span className="text-[#FFD700]">900+ Markets</span>
        <span className="text-white/20">|</span>
        <span className="text-[#00D4FF]">10+ Sports</span>
        <span className="text-white/20">|</span>
        <span className="text-white">390ms Settlement</span>
        <span className="text-white/20">|</span>
        <span className="text-[#FFD700]">347 Odds Combos</span>
      </motion.div>

      <motion.div 
        className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-full px-6 py-3 backdrop-blur-md z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        <span className="text-white/50 text-[1vw]">Built natively on</span>
        <span className="font-bold text-[#00D4FF] text-[1.2vw] flex items-center gap-2">
          Sui Network
        </span>
      </motion.div>

      {/* Social links placeholder area */}
      <motion.div 
        className="absolute bottom-8 flex gap-6 text-white/40 text-[1.5vw] z-10"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
      >
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 hover:bg-white/10 transition-colors">𝕏</div>
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 hover:bg-white/10 transition-colors">💬</div>
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 hover:bg-white/10 transition-colors">📄</div>
      </motion.div>
    </motion.div>
  );
}
