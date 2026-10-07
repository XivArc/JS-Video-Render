import {
  Output, CanvasSource, Quality, BufferTarget, StreamTarget,
  Mp4OutputFormat, MovOutputFormat, canEncodeVideo,
} from 'mediabunny';
import { installCanvasAutoRepair } from './canvas-auto-repair.js';
import { animationTime, validateDuration } from './duration-settings.js';

let animation;
let metadata;
let previewCanvas;
const canvasRepair = installCanvasAutoRepair();

function describe(error) {
  return { name: error.name || 'Error', message: error.message || String(error) };
}

async function loadAnimation(source, fileName) {
  if (typeof source !== 'string' || source.length > 5_000_000) {
    throw new Error('The JavaScript file must be smaller than 5 MB.');
  }
  globalThis.SmartHomeAnimations = {};
  const common = { exports: {} };
  globalThis.module = common;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  canvasRepair.reset(fileName, url);
  let imported;
  try {
    imported = await import(/* @vite-ignore */ url);
  } catch (error) {
    throw canvasRepair.annotate(error);
  } finally {
    URL.revokeObjectURL(url);
    delete globalThis.module;
  }
  const candidates = [imported.default, imported, common.exports,
    ...Object.values(globalThis.SmartHomeAnimations || {})];
  animation = candidates.find((a) => a && a.meta &&
    (typeof a.drawFrame === 'function' || typeof a.render === 'function'));
  if (!animation) {
    // Standalone Canvas sources can export draw(ctx, seconds, width, height)
    // directly, with their metadata attached to that function as draw.meta.
    const draw = candidates.find(a => typeof a === 'function' && a.meta);
    if (draw) animation = { meta: draw.meta, render: (ctx, seconds, width, height) => draw(ctx, seconds, width, height) };
  }
  if (!animation) {
    throw new Error('No animation API was found. Export meta with drawFrame(canvas, seconds) or render(ctx, seconds), or a draw(ctx, seconds, width, height) function with draw.meta.');
  }
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

function validate(settings) {
  const s = { ...settings };
  if (!['mp4', 'mov'].includes(s.format)) throw new Error('The format must be MP4 or MOV.');
  for (const key of ['width', 'height', 'fps', 'bitrate', 'duration']) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error('Setting ' + key + ' is invalid.');
  }
  if (s.width > 4096 || s.height > 4096 || s.width % 2 || s.height % 2 ||
      ![24, 25, 30, 50, 60].includes(s.fps) || s.bitrate > 200_000_000) {
    throw new Error('The resolution, frame rate, or bitrate exceeds the supported limits.');
  }
  return s;
}

async function codecConfig(s) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs is unavailable. Use a browser with VideoEncoder support over HTTPS or localhost.');
  }
  const config = {
    width: s.width, height: s.height, frameRate: s.fps,
    quality: new Quality({ bitrate: s.bitrate, bitrateMode: 'variable' }),
    latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware',
  };
  if (await canEncodeVideo('avc', config)) return config;
  config.hardwareAcceleration = 'no-preference';
  if (await canEncodeVideo('avc', config)) return config;
  throw new Error('H.264 is unsupported for these settings. Lower the resolution, frame rate, or bitrate and try again.');
}

async function exportVideo(id, source, settings, stream, fileName) {
  const s = validate(settings);
  await loadAnimation(source, fileName);
  validateDuration(metadata.duration, s);
  const config = await codecConfig(s);
  const canvas = new OffscreenCanvas(s.width, s.height);
  const target = stream ? new StreamTarget(stream, { chunked: true, chunkSize: 4 * 1024 * 1024 }) : new BufferTarget();
  const format = s.format === 'mov' ? new MovOutputFormat({ fastStart: false }) : new Mp4OutputFormat({ fastStart: false });
  const output = new Output({ format, target });
  const video = new CanvasSource(canvas, {
    codec: 'avc', quality: config.quality,
    hardwareAcceleration: config.hardwareAcceleration,
    latencyMode: 'quality', keyFrameInterval: 2,
  });
  output.addVideoTrack(video, { frameRate: s.fps });
  output.setMetadataTags({ title: metadata.title });
  const total = Math.round(s.duration * s.fps);
  const started = performance.now();
  let bytes = 0;
  target.on('write', ({ end }) => { bytes = Math.max(bytes, end); });
  try {
    await output.start();
    for (let i = 0; i < total; i++) {
      paint(canvas, animationTime(i / s.fps, metadata.duration, s));
      await video.add(i / s.fps, 1 / s.fps);
      if (i % 8 === 0 || i === total - 1) {
        const elapsed = (performance.now() - started) / 1000;
        self.postMessage({ event: 'progress', id, frame: i + 1, total, elapsed, bytes, canvasRepair: canvasRepair.report() });
      }
      if (i % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    self.postMessage({ event: 'finalizing', id });
    await output.finalize();
    const result = {
      mime: format.mimeType, bytes, frames: total, duration: total / s.fps,
      elapsed: (performance.now() - started) / 1000, savedToDisk: Boolean(stream), canvasRepair: canvasRepair.report(),
    };
    if (stream) self.postMessage({ id, ok: true, result });
    else {
      result.buffer = target.buffer;
      result.bytes = target.buffer.byteLength;
      self.postMessage({ id, ok: true, result }, [target.buffer]);
    }
  } catch (error) {
    try { await output.cancel(); } catch { /* Preserve the original error. */ }
    throw error;
  }
}

self.onmessage = async ({ data }) => {
  const { id, type, payload = {} } = data;
  try {
    if (type === 'load') {
      if (payload.restricted) restrictAnimationIO(payload.source, payload.restrictedContext);
      self.postMessage({ id, ok: true, result: await loadAnimation(payload.source, payload.fileName) });
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
    } else if (type === 'check') {
      await codecConfig(validate(payload.settings));
      self.postMessage({ id, ok: true, result: { supported: true } });
    } else if (type === 'export') {
      await exportVideo(id, payload.source, payload.settings, payload.stream, payload.fileName);
    } else throw new Error('Unknown renderer command.');
  } catch (error) {
    self.postMessage({ id, ok: false, error: describe(error) });
  }
};
