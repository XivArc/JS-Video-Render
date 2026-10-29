import { installCanvasAutoRepair } from '../src/canvas-auto-repair.js';
import { animationTime } from '../src/duration-settings.js';
import { readAnimation } from '../src/animation-reader.js';
import { encodePng } from './png-frame.js';

const repair = installCanvasAutoRepair();
let animation, meta, canvas, fileName;

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

async function load(source, fileName, metadataDefaults) {
  restrictIO(source);
  const loaded = await readAnimation(source, repair, fileName, metadataDefaults);
  animation = loaded.animation;
  for (const key of ['width', 'height', 'fps', 'duration']) {
    if (!Number.isFinite(animation.meta[key]) || animation.meta[key] <= 0) throw new Error('Invalid source metadata: ' + key);
  }
  if (animation.meta.width > 16384 || animation.meta.height > 16384 || animation.meta.fps > 240 || animation.meta.duration > 3600) {
    throw new Error('Source metadata exceeds supported limits.');
  }
  meta = { width: animation.meta.width, height: animation.meta.height, fps: animation.meta.fps, duration: animation.meta.duration,
    title: String(animation.meta.title || animation.meta.id || fileName).slice(0, 200), reader: loaded.reader };
  return meta;
}

self.onmessage = async ({ data: { id, type, payload } }) => {
  let stage = type === 'load' ? 'load' : 'validation';
  try {
    if (type === 'load') {
      fileName = payload.fileName;
      self.postMessage({ id, ok: true, result: await load(payload.source, payload.fileName, payload.metadataDefaults) });
    } else if (type === 'frame') {
      const { width, height, fps, frame, duration, durationMode } = payload;
      if (![width, height, fps, frame].every(Number.isInteger) || width < 16 || height < 16 || width > 4096 || height > 4096 ||
          ![24, 25, 30, 50, 60].includes(fps) || frame < 0 || frame >= Math.round(duration * fps)) throw new Error('Invalid cloud frame settings.');
      stage = 'draw';
      const drawStarted = performance.now();
      if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.save(); ctx.resetTransform(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.restore();
      const time = animationTime(frame / fps, meta.duration, { duration, durationMode });
      try {
        if (typeof animation.drawFrame === 'function') animation.drawFrame(canvas, time);
        else animation.render(ctx, time, width, height);
      } catch (error) { throw repair.annotate(error, time); }
      if (canvas.width !== width || canvas.height !== height) throw new Error('Animation changed the export canvas dimensions.');
      const drawMs = performance.now() - drawStarted;
      stage = 'pixel-readback';
      const readStarted = performance.now();
      // Read pixels into typed arrays, then encode PNG without Blob/FileReader.
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const readbackMs = performance.now() - readStarted;
      stage = 'png-compression';
      const compressionStarted = performance.now();
      const buffer = encodePng(pixels, width, height);
      self.postMessage({ id, ok: true, result: { buffer, drawMs,
        readbackMs, compressionMs: performance.now() - compressionStarted, canvasRepair: repair.report() } }, [buffer]);
    } else throw new Error('Unknown cloud frame command.');
  } catch (error) {
    const code = stage === 'pixel-readback' ? 'FRAME_READ_FAILED' : stage === 'png-compression' ? 'FRAME_ENCODE_FAILED' : stage === 'draw' ? 'ANIMATION_DRAW_FAILED' :
      stage === 'load' && (error.name === 'NotReadableError' || error.cause?.name === 'NotReadableError') ? 'SOURCE_READ_FAILED' :
      stage === 'load' ? 'ANIMATION_LOAD_FAILED' : 'FRAME_SETTINGS_INVALID';
    self.postMessage({ id, ok: false, error: { code, stage, fileName, frame: payload.frame,
      name: error.name || 'Error', message: error.message || String(error), stack: error.stack || '' } });
  }
};
