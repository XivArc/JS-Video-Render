import { installCanvasAutoRepair } from './canvas-auto-repair.js';
import { readAnimation } from './animation-reader.js';

let animation;
let metadata;
let previewCanvas;
const canvasRepair = installCanvasAutoRepair();

function describe(error) {
  return { name: error.name || 'Error', message: error.message || String(error) };
}

async function loadAnimation(source, fileName, metadataDefaults) {
  const loaded = await readAnimation(source, canvasRepair, fileName, metadataDefaults);
  animation = loaded.animation;
  const m = animation.meta;
  for (const key of ['width', 'height', 'fps', 'duration']) {
    if (!Number.isFinite(m[key]) || m[key] <= 0) {
      throw new Error('Metadata ' + key + ' must be a positive number.');
    }
  }
  if (m.width > 16384 || m.height > 16384 || m.duration > 3600 || m.fps > 240) {
    throw new Error('The animation metadata exceeds the supported limits.');
  }
  metadata = {
    id: String(m.id || 'canvas_animation').slice(0, 150),
    title: String(m.title || m.id || 'Canvas animation').slice(0, 200),
    width: m.width, height: m.height, fps: m.fps, duration: m.duration,
    targetVideoBitrate: Number(m.targetVideoBitrate) || 12_000_000,
    reader: loaded.reader,
  };
  return metadata;
}

function restrictAnimationIO(source, context = 'AI repair') {
  const quick = context === 'Quick Preview';
  if (/\bimport\s*(?:\(|['"{*]|[A-Za-z_$])|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]|\b(?:eval|Function|importScripts)\s*\(/.test(source)) {
    throw new Error((quick ? 'Quick Preview' : 'AI repair') + ' supports self-contained Canvas JavaScript without imports or dynamic code execution.');
  }
  const blocked = () => { throw new Error('Network access is disabled for ' + (quick ? 'Quick Preview animations.' : 'AI-repaired animations.')); };
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts']) {
    // Worker APIs can be inherited; shadow those as well as configurable own properties.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (descriptor && !descriptor.configurable) continue;
    Object.defineProperty(globalThis, name, { value: blocked, writable: false, configurable: false });
  }
}

function paint(canvas, time) {
  if (!animation) throw new Error('Load an animation file first.');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  try {
    if (typeof animation.drawFrame === 'function') animation.drawFrame(canvas, time);
    else animation.render(ctx, time, canvas.width, canvas.height);
  } catch (error) {
    throw canvasRepair.annotate(error, time);
  }
}

self.onmessage = async ({ data }) => {
  const { id, type, payload = {} } = data;
  try {
    if (type === 'load') {
      if (payload.restricted) restrictAnimationIO(payload.source, payload.restrictedContext);
      self.postMessage({ id, ok: true, result: await loadAnimation(payload.source, payload.fileName,
        payload.metadataDefaults ?? payload.previewDefaults) });
    } else if (type === 'draw') {
      const { width, height, time } = payload;
      if (!previewCanvas || previewCanvas.width !== width || previewCanvas.height !== height) {
        previewCanvas = new OffscreenCanvas(width, height);
      }
      paint(previewCanvas, Math.min(metadata.duration, Math.max(0, time)));
      const bitmap = previewCanvas.transferToImageBitmap();
      self.postMessage({ id, ok: true, result: { bitmap, time, canvasRepair: canvasRepair.report() } }, [bitmap]);
    } else if (type === 'png') {
      const { width, height, time } = payload;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 ||
          width > 4096 || height > 4096 || !Number.isFinite(time) || time < 0 || time > metadata.duration) {
        throw new Error('Invalid frame dimensions or time.');
      }
      if (!previewCanvas || previewCanvas.width !== width || previewCanvas.height !== height) {
        previewCanvas = new OffscreenCanvas(width, height);
      }
      paint(previewCanvas, time);
      const blob = await previewCanvas.convertToBlob({ type: 'image/png' });
      const buffer = await blob.arrayBuffer();
      self.postMessage({ id, ok: true, result: { buffer, canvasRepair: canvasRepair.report() } }, [buffer]);
    } else if (type === 'validate-frames') {
      const { width, height, fps, start, count, total } = payload;
      if (![width, height, fps, start, count, total].every(Number.isInteger) || width < 16 || height < 16 ||
          width > 4096 || height > 4096 || ![24, 25, 30, 50, 60].includes(fps) ||
          start < 0 || count < 1 || count > 16 || start + count > total || total > 30000) {
        throw new Error('Invalid full animation validation settings.');
      }
      if (!previewCanvas || previewCanvas.width !== width || previewCanvas.height !== height) previewCanvas = new OffscreenCanvas(width, height);
      for (let frame = start; frame < start + count; frame++) {
        try { paint(previewCanvas, frame / fps); }
        catch (error) { error.message = 'Frame ' + (frame + 1) + ' / ' + total + ' · ' + error.message; throw error; }
      }
      self.postMessage({ id, ok: true, result: { frame: start + count, total } });
    } else throw new Error('Unknown renderer command.');
  } catch (error) {
    self.postMessage({ id, ok: false, error: describe(error) });
  }
};
