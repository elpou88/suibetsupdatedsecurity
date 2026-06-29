import { useState, useEffect, useRef } from "react";

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const keys = Object.keys(durations);
  const [currentScene, setCurrentScene] = useState(0);
  const hasRecorded = useRef(false);
  const totalDuration = Object.values(durations).reduce((a, b) => a + b, 0);

  useEffect(() => {
    (window as any).startRecording?.();

    let elapsed = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    keys.forEach((_, i) => {
      if (i === 0) return;
      elapsed += durations[keys[i - 1]];
      timers.push(
        setTimeout(() => {
          setCurrentScene(i);
        }, elapsed)
      );
    });

    const stopTimer = setTimeout(() => {
      if (!hasRecorded.current) {
        hasRecorded.current = true;
        (window as any).stopRecording?.();
      }
    }, totalDuration);

    const loopTimer = setTimeout(() => {
      setCurrentScene(0);
    }, totalDuration + 100);

    timers.push(stopTimer, loopTimer);

    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (currentScene === 0 && hasRecorded.current) {
      let elapsed = 0;
      const timers: ReturnType<typeof setTimeout>[] = [];

      keys.forEach((_, i) => {
        if (i === 0) return;
        elapsed += durations[keys[i - 1]];
        timers.push(setTimeout(() => setCurrentScene(i), elapsed));
      });

      const loopTimer = setTimeout(() => {
        setCurrentScene(0);
      }, totalDuration + 100);

      timers.push(loopTimer);
      return () => timers.forEach(clearTimeout);
    }
  }, [currentScene]);

  return { currentScene, sceneName: keys[currentScene] };
}
