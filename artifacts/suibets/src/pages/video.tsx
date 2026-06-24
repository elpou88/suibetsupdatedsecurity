import { useState, useRef, useEffect } from "react";
import VideoTemplate from "@/components/video/VideoTemplate";

// hook(4200) + p2p(6500) + engines(8000) + sui_stack(6500) + stats(4500) + outro(6500)
const TOTAL_DURATION_MS = 36200;

export default function VideoPage() {
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [done, setDone] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function startDownload() {
    setDone(false);
    setRecording(true);
    chunksRef.current = [];

    // Capture the whole page as a video stream
    const stream = (document.body as any).captureStream
      ? (document.body as any).captureStream(30)
      : await (navigator.mediaDevices as any).getDisplayMedia({ video: true });

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "suibets-sui-tech-video.webm";
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
      setDone(true);
      setCountdown(0);
    };

    recorder.start(100);

    // Countdown timer
    const secs = Math.ceil(TOTAL_DURATION_MS / 1000);
    setCountdown(secs);
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(intervalRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    // Stop after full loop
    setTimeout(() => {
      recorder.stop();
    }, TOTAL_DURATION_MS + 500);
  }

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#040D21" }}>
      <VideoTemplate />

      {/* Download overlay button */}
      <div
        className="absolute flex flex-col items-center gap-2"
        style={{ bottom: "5%", left: "50%", transform: "translateX(-50%)", zIndex: 100 }}
      >
        {!recording && !done && (
          <button
            onClick={startDownload}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{
              background: "rgba(77,162,255,0.15)",
              border: "1px solid rgba(77,162,255,0.5)",
              color: "#6FBCF0",
              fontFamily: "Space Grotesk, sans-serif",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.05em",
              backdropFilter: "blur(8px)",
            }}
          >
            ⬇ Download Video (.webm)
          </button>
        )}

        {recording && (
          <div
            className="flex items-center gap-3 px-5 py-2.5 rounded-full"
            style={{
              background: "rgba(0,255,178,0.12)",
              border: "1px solid rgba(0,255,178,0.4)",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "0.75rem",
              color: "#00FFB2",
              backdropFilter: "blur(8px)",
            }}
          >
            <span className="animate-pulse">●</span>
            Recording… {countdown}s remaining
          </div>
        )}

        {done && (
          <div
            className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{
              background: "rgba(0,255,178,0.12)",
              border: "1px solid rgba(0,255,178,0.4)",
              fontFamily: "Space Grotesk, sans-serif",
              fontSize: "0.8rem",
              fontWeight: 700,
              color: "#00FFB2",
              backdropFilter: "blur(8px)",
            }}
          >
            ✓ Download started — check your Downloads folder
          </div>
        )}
      </div>
    </div>
  );
}
