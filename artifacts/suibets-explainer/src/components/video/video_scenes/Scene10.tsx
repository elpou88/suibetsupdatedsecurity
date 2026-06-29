import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene10() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
      setTimeout(() => setPhase(5), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const players = [
    { id: 1, name: "Alice", addr: "0x3A" },
    { id: 2, name: "Bob", addr: "0x9F" },
    { id: 3, name: "Charlie", addr: "0xB2" },
    { id: 4, name: "Dave", addr: "0x1C" },
    { id: 5, name: "Eve", addr: "0x8D" }
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-12 bg-gradient-to-b from-transparent to-[#e94560]/10"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: 50, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center w-full max-w-6xl">
        <div className="w-1/2 pr-12 flex flex-col justify-center">
          <motion.div
            className="inline-block px-4 py-1 rounded-full bg-[#e94560]/20 border border-[#e94560]/30 text-[#e94560] font-mono text-[1vw] font-bold mb-4 uppercase tracking-widest w-fit"
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          >
            Social P2E
          </motion.div>
          <motion.h2 
            className="text-[4.5vw] font-display font-bold leading-tight text-white mb-4"
            initial={{ opacity: 0, y: 30 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.1 }}
          >
            Hot Potato <span className="text-[#e94560]">Game</span>
          </motion.h2>
          
          <motion.p 
            className="text-[1.5vw] text-white/70 mb-6 max-w-md"
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            Fast-paced action built right into the match rooms. High stakes, rapid settlement.
          </motion.p>

          <motion.div 
            className="bg-black/30 border border-white/10 rounded-xl p-5"
            initial={{ opacity: 0, x: -30 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
          >
            <div className="text-[1vw] font-bold text-white uppercase tracking-widest mb-3 text-[#FFD700]">Game Rules</div>
            <ul className="text-[1.1vw] text-white/80 space-y-2 flex flex-col gap-2">
              <li className="flex gap-3 items-center"><span className="w-5 h-5 rounded bg-white/10 flex items-center justify-center font-mono text-sm">1</span> Grab the pot (adds SUI)</li>
              <li className="flex gap-3 items-center"><span className="w-5 h-5 rounded bg-white/10 flex items-center justify-center font-mono text-sm">2</span> Timer ticks down unpredictably</li>
              <li className="flex gap-3 items-center"><span className="w-5 h-5 rounded bg-[#e94560]/50 text-white flex items-center justify-center font-mono text-sm border border-[#e94560]">3</span> Last holder when it explodes loses</li>
            </ul>
          </motion.div>
        </div>

        <div className="w-1/2 relative flex justify-center items-center h-[70vh]">
          {/* Players in circle */}
          {players.map((player, i) => {
            const angle = (i * 360) / 5;
            const rad = (angle * Math.PI) / 180;
            const radius = 180;
            const x = Math.sin(rad) * radius;
            const y = -Math.cos(rad) * radius;
            // Phase 3: Player 3 holds. Phase 4: Player 4 holds and explodes
            const isActive = phase >= 2 && i === (phase >= 4 ? 3 : phase >= 3 ? 2 : 0);
            const isLoser = phase >= 5 && i === 3;

            return (
              <motion.div
                key={i}
                className={`absolute flex flex-col items-center gap-2 transition-all duration-300`}
                style={{ x, y }}
                initial={{ opacity: 0, scale: 0 }}
                animate={phase >= 1 ? { opacity: 1, scale: isActive ? 1.1 : 1 } : { opacity: 0, scale: 0 }}
                transition={{ type: 'spring', delay: i * 0.1 }}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center font-bold border-2 ${
                  isLoser ? 'bg-[#e94560] border-white text-white shadow-[0_0_20px_#e94560]' :
                  isActive ? 'bg-[#FFD700] border-white text-black shadow-[0_0_15px_#FFD700]' : 'bg-[#112a4f] border-white/20 text-white/50'
                }`}>
                  P{player.id}
                </div>
                <div className="bg-black/50 px-2 py-0.5 rounded text-[0.8vw] text-white/70 font-medium whitespace-nowrap">
                  {player.name}
                </div>
              </motion.div>
            );
          })}

          {/* The Potato / Pot */}
          <motion.div
            className="w-36 h-36 rounded-full bg-gradient-to-br from-[#FFD700] to-[#ffaa00] shadow-[0_0_40px_rgba(255,215,0,0.5)] flex flex-col items-center justify-center relative z-20 overflow-hidden border-4 border-white/20"
            initial={{ opacity: 0, scale: 0 }}
            animate={phase >= 2 ? { 
              opacity: phase >= 5 ? 0 : 1, 
              scale: phase >= 5 ? 2 : phase >= 4 ? 1.2 : 1,
              x: phase >= 4 ? Math.sin((216 * Math.PI)/180)*180 : phase >= 3 ? Math.sin((144 * Math.PI)/180)*180 : 0,
              y: phase >= 4 ? -Math.cos((216 * Math.PI)/180)*180 : phase >= 3 ? -Math.cos((144 * Math.PI)/180)*180 : -180,
              backgroundColor: phase >= 4 ? '#e94560' : '#FFD700'
            } : { opacity: 0, scale: 0 }}
            transition={{ type: 'spring', stiffness: 150 }}
          >
            {phase < 5 && (
              <>
                <div className={`text-black font-black text-[2.5vw] leading-none ${phase >= 4 ? 'text-white' : ''}`}>
                  {phase >= 4 ? '3.5' : phase >= 3 ? '2.5' : '1.5'}
                </div>
                <div className={`text-black/70 font-bold text-[0.9vw] ${phase >= 4 ? 'text-white/80' : ''}`}>SUI POT</div>
              </>
            )}
          </motion.div>

          {/* Explosion effect */}
          {phase >= 5 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                 style={{ 
                   transform: `translate(${Math.sin((216 * Math.PI)/180)*180}px, ${-Math.cos((216 * Math.PI)/180)*180}px)` 
                 }}>
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-4 h-4 rounded-full bg-[#e94560]"
                  initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                  animate={{ 
                    x: Math.sin((i * 30 * Math.PI)/180) * 150, 
                    y: Math.cos((i * 30 * Math.PI)/180) * 150,
                    scale: 0,
                    opacity: 0
                  }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              ))}
              <motion.div 
                className="w-40 h-40 bg-[#e94560] rounded-full mix-blend-screen"
                initial={{ scale: 0, opacity: 1 }}
                animate={{ scale: 3, opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          )}

          {/* Central Timer Display */}
          <motion.div 
            className="absolute text-center flex flex-col items-center justify-center"
            initial={{ opacity: 0 }}
            animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          >
            <div className="text-[1vw] text-white/40 uppercase tracking-widest font-mono mb-2">Game Ends In</div>
            <motion.div 
              className={`text-[5vw] font-mono font-black ${phase >= 5 ? 'text-[#e94560]' : 'text-white/80'}`}
              animate={phase >= 4 ? { scale: [1, 1.1, 1], color: '#e94560' } : {}}
              transition={{ repeat: phase >= 4 && phase < 5 ? Infinity : 0, duration: 0.3 }}
            >
              {phase >= 5 ? '00.00' : phase >= 4 ? '00.82' : phase >= 3 ? '02.14' : '05.99'}
            </motion.div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
