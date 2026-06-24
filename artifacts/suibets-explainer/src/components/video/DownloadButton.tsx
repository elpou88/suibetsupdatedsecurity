import { useState, useRef, useCallback } from 'react';

const FULL_DURATION = 7000 + 7000 + 8000 + 8000 + 7000 + 8000 + 8000 + 8000 + 7000 + 7000 + 7000 + 5000 + 3000;
const SHORT_DURATION = 45000;

type RecordMode = 'short' | 'full';

export function DownloadButton() {
  const [status, setStatus] = useState<'idle' | 'picking' | 'recording' | 'processing'>('idle');
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<RecordMode>('short');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async (selectedMode: RecordMode) => {
    try {
      setMode(selectedMode);
      setStatus('recording');
      setProgress(0);
      chunksRef.current = [];

      const duration = selectedMode === 'short' ? SHORT_DURATION : FULL_DURATION;
      const bitrate = selectedMode === 'short' ? 800000 : 2500000;

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: selectedMode === 'short' ? 1280 : 1920,
          height: selectedMode === 'short' ? 720 : 1080,
          frameRate: 24,
        },
        audio: false,
      });

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });

      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (intervalRef.current) clearInterval(intervalRef.current);

        setStatus('processing');
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = selectedMode === 'short'
          ? 'SuiBets-Explainer-Twitter.webm'
          : 'SuiBets-Explainer-Full.webm';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('idle');
        setProgress(0);
      };

      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      });

      recorder.start(1000);

      const startTime = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, Math.round((elapsed / duration) * 100));
        setProgress(pct);
        if (elapsed >= duration) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (recorder.state === 'recording') {
            recorder.stop();
          }
        }
      }, 500);
    } catch {
      setStatus('idle');
      setProgress(0);
    }
  }, []);

  if (status === 'idle') {
    return (
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', gap: 8 }}>
        <button
          onClick={() => startRecording('short')}
          style={{
            background: 'linear-gradient(135deg, #00D4FF, #0099FF)',
            color: '#000',
            border: 'none',
            borderRadius: 12,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,212,255,0.4)',
          }}
        >
          X/TWITTER (≤5MB)
        </button>
        <button
          onClick={() => startRecording('full')}
          style={{
            background: 'rgba(10,22,40,0.9)',
            color: '#00D4FF',
            border: '1px solid rgba(0,212,255,0.3)',
            borderRadius: 12,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          FULL HD
        </button>
      </div>
    );
  }

  if (status === 'recording') {
    return (
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 9999,
          background: 'rgba(10,22,40,0.95)',
          border: '1px solid rgba(0,212,255,0.3)',
          borderRadius: 12,
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: '#ef4444',
          boxShadow: '0 0 10px rgba(239,68,68,0.8)',
          animation: 'pulse 1.5s infinite',
        }} />
        <div>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>
            {mode === 'short' ? 'X/Twitter' : 'Full'} — {progress}%
          </div>
          <div style={{
            width: 140, height: 4, background: 'rgba(255,255,255,0.1)',
            borderRadius: 4, marginTop: 4, overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: '#00D4FF', borderRadius: 4,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        background: 'rgba(10,22,40,0.95)',
        border: '1px solid rgba(0,212,255,0.3)',
        borderRadius: 12,
        padding: '12px 20px',
        color: '#00D4FF',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      Preparing download...
    </div>
  );
}
