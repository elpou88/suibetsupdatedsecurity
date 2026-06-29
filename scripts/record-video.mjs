import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = path.join(__dirname, '../tmp-frames');
const OUTPUT_PATH = path.join(__dirname, '../suibets-video.mp4');
const VIDEO_URL = 'http://localhost:5000/video';
const RECORD_MS = 32500;
const FPS = 15;

const CHROMIUM_PATH = execSync(
  'which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo ""'
).toString().trim().split('\n')[0];

console.log(`Chromium: ${CHROMIUM_PATH}`);

if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,720',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

// Use CDP session for screencast
const client = await page.createCDPSession();

const frames = [];
await client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 90,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 1,
});

client.on('Page.screencastFrame', async (frameData) => {
  frames.push(frameData.data);
  await client.send('Page.screencastFrameAck', { sessionId: frameData.sessionId });
  process.stdout.write(`\r  Captured ${frames.length} frames…`);
});

console.log('Navigating to video page…');
await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

console.log(`Recording for ${RECORD_MS / 1000}s…`);
await new Promise(r => setTimeout(r, RECORD_MS));

await client.send('Page.stopScreencast');
await browser.close();

console.log(`\nGot ${frames.length} frames. Writing to disk…`);

// Write frames
for (let i = 0; i < frames.length; i++) {
  const buf = Buffer.from(frames[i], 'base64');
  fs.writeFileSync(path.join(FRAMES_DIR, `frame${String(i).padStart(5, '0')}.jpg`), buf);
}

console.log('Encoding with ffmpeg…');
execSync(
  `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame%05d.jpg" ` +
  `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${OUTPUT_PATH}"`,
  { stdio: 'inherit' }
);

fs.rmSync(FRAMES_DIR, { recursive: true });
const size = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ suibets-video.mp4 ready — ${size} MB`);
