import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { DownloadButton } from './DownloadButton';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

const SCENE_DURATIONS = {
  hook: 5000,
  problem: 8000,
  solution: 9000,
  proof: 10000,
  ux: 12000,
  close: 16000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#080a0f] flex items-center justify-center font-body text-white">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <video 
          src={`${import.meta.env.BASE_URL}videos/energy-field.mp4`} 
          autoPlay 
          loop 
          muted 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen" 
        />
        
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[120px] opacity-20 mix-blend-screen"
          style={{ background: 'radial-gradient(circle, #00ffff, transparent)' }}
          animate={{
            x: ['-20%', '30%', '10%', '-10%', '20%', '-10%'][currentScene] || '0%',
            y: ['-20%', '10%', '-20%', '0%', '10%', '20%'][currentScene] || '0%',
            scale: [1, 1.2, 0.8, 1.1, 1.3, 1][currentScene] || 1,
            opacity: [0.1, 0.2, 0.15, 0.25, 0.1, 0.3][currentScene] || 0.2,
          }}
          transition={{ duration: 4, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[100px] opacity-15 mix-blend-screen right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #a855f7, transparent)' }}
          animate={{
            x: ['10%', '-40%', '-10%', '-30%', '0%', '20%'][currentScene] || '0%',
            y: ['10%', '-20%', '10%', '-10%', '20%', '-10%'][currentScene] || '0%',
            scale: [1, 0.9, 1.3, 1, 1.2, 1.1][currentScene] || 1,
            opacity: [0.15, 0.1, 0.2, 0.15, 0.2, 0.1][currentScene] || 0.15,
          }}
          transition={{ duration: 5, ease: 'easeInOut' }}
        />
        
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#00ffff 1px, transparent 1px), linear-gradient(90deg, #00ffff 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080a0f] via-transparent to-transparent opacity-90" />
      </div>

      <DownloadButton />

      {/* Foreground scenes */}
      <div className="relative w-full h-full z-10">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="s1" />}
          {currentScene === 1 && <Scene2 key="s2" />}
          {currentScene === 2 && <Scene3 key="s3" />}
          {currentScene === 3 && <Scene4 key="s4" />}
          {currentScene === 4 && <Scene5 key="s5" />}
          {currentScene === 5 && <Scene6 key="s6" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
