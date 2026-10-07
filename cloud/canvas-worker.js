import { installCanvasAutoRepair } from '../src/canvas-auto-repair.js';
import { animationTime } from '../src/duration-settings.js';
import { readAnimation } from '../src/animation-reader.js';

const repair = installCanvasAutoRepair();
let animation, meta, canvas;

function restrictIO(source) {
  if (/\bimport\b\s*(?:\(|['"{*]|[A-Za-z_$])|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]|\b(?:eval|Function|importScripts)\s*\(/.test(source)) {
    throw new Error('Cloud rendering supports self-contained Canvas JS without imports or dynamic code execution.');
  }
  const blocked = () => { throw new Error('Network access is disabled for cloud animation code.'); };
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (descriptor && !descriptor.configurable) continue;
    Object.defineProperty(globalThis, name, { value: blocked, writable: false, configurable: false });
  }
}

async function load(source, fileName) {
  restrictIO(source);
  animation = (await readAnimation(source, repair, fileName)).animation;
  for (const key of ['width', 'height', 'fps', 'duration']) {
    if (!Number.isFinite(animation.meta[key]) || animation.meta[key] <= 0) throw new Error('Invalid source metadata: ' + key);
  }
  if (animation.meta.width > 16384 || animation.meta.height > 16384 || animation.meta.fps > 240 || animation.meta.duration > 3600) {
    throw new Error('Source metadata exceeds supported limits.');
  }
  meta = { width: animation.meta.width, height: animation.meta.height, fps: animation.meta.fps, duration: animation.meta.duration,
    title: String(animation.meta.title || animation.meta.id || fileName).slice(0, 200) };
  return meta;
}

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    if (type === 'load') {
      self.postMessage({ id, ok: true, result: await load(payload.source, payload.fileName) });
    } else if (type === 'frame') {
      const { width, height, fps, frame, duration, durationMode } = payload;
      if (![width, height, fps, frame].every(Number.isInteger) || width < 16 || height < 16 || width > 4096 || height > 4096 ||
          ![24, 25, 30, 50, 60].includes(fps) || frame < 0 || frame >= Math.round(duration * fps)) throw new Error('Invalid cloud frame settings.');
      if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.save(); ctx.resetTransform(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.restore();
      const time = animationTime(frame / fps, meta.duration, { duration, durationMode });
      try {
        if (typeof animation.drawFrame === 'function') animation.drawFrame(canvas, time);
        else animation.render(ctx, time, width, height);
      } catch (error) { throw repair.annotate(error, time); }
      if (canvas.width !== width || canvas.height !== height) throw new Error('Animation changed the export canvas dimensions.');
      // Send lossless compressed frames: raw 4K RGBA is 33 MB per frame and
      // overwhelms the browser-to-encoder transfer before native encoding.
      const buffer = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      self.postMessage({ id, ok: true, result: { buffer, canvasRepair: repair.report() } }, [buffer]);
    } else throw new Error('Unknown cloud frame command.');
  } catch (error) {
    self.postMessage({ id, ok: false, error: { name: error.name || 'Error', message: error.message || String(error) } });
  }
};
