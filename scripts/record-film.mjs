#!/usr/bin/env node
/**
 * Record a scripted film (src/capture/film.ts, timeline.ts) to MP4: frame by frame, so the
 * result is smooth whatever the machine, with the soundtrack rendered offline from the same
 * timeline. Run it on a machine with a real GPU; software rendering takes ~5 s a frame.
 *
 *   npm install && npx playwright install chromium
 *   npm run dev                      # in another terminal (or point --url at a running one)
 *   npm run film -- --film light-plays --out docs/video/spectral-loom-social.mp4
 *
 * Options: --url http://127.0.0.1:5173  --film light-plays|light-changes-music
 *          --fps 30  --size 1280x720  --out <file.mp4>  --headed (show the browser)
 * Needs ffmpeg on PATH.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5173');
const film = arg('film', 'light-plays');
const fps = Number(arg('fps', '30'));
const [width, height] = arg('size', '1280x720').split('x').map(Number);
const out = arg('out', `docs/video/spectral-loom-${film}.mp4`);
const headed = process.argv.includes('--headed');

if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('ffmpeg not found on PATH');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'spectral-film-'));
const browser = await chromium.launch({ headless: !headed, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${url}/?fixedres&debug`);
  await page.waitForFunction(() => window.__spectralLoom, null, { timeout: 60000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`GPU: ${renderer}`);
  if (/swiftshader|llvmpipe|software/i.test(renderer)) console.warn('Software rendering: this will be very slow. Try --headed.');

  await page.evaluate((f) => window.__spectralLoom.captureStart(f), film);
  const duration = await page.evaluate((f) => window.__spectralLoom.duration(f), film);

  console.log('soundtrack…');
  const wav = await page.evaluate(() => window.__spectralLoom.captureWav());
  writeFileSync(join(dir, 'film.wav'), Buffer.from(wav, 'base64'));

  // Let pulses and weather settle before the first frame.
  for (let t = -1; t < 0; t += 0.25) await page.evaluate((t) => window.__spectralLoom.captureFrame(Math.max(0, t)), t);
  const frames = Math.round(duration * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.__spectralLoom.captureFrame(t), f / fps);
    await page.screenshot({ path: join(dir, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    if (f === 0 && errors.length > 0) {
      console.error('The page reported errors on the first frame (shaders?):\n' + errors.join('\n'));
      process.exitCode = 1;
      break;
    }
    if (f % fps === 0) console.log(`frame ${f}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }

  if (!process.exitCode) {
    const ff = spawnSync(
      'ffmpeg',
      ['-y', '-framerate', String(fps), '-i', join(dir, 'f%05d.jpg'), '-i', join(dir, 'film.wav'),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out],
      { stdio: 'inherit' },
    );
    if (ff.status !== 0) process.exitCode = 1;
    else console.log(`→ ${out}`);
  }
  if (errors.length > 0) console.warn(`${errors.length} page error(s), first: ${errors[0]}`);
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
