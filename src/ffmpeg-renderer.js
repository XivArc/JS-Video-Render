import { FFmpeg } from '@ffmpeg/ffmpeg';
import { Input, BufferSource, MP4, QTFF } from 'mediabunny';
import coreScript from '@ffmpeg/core?url';
import coreWasm from '@ffmpeg/core/wasm?url';
import { getBitrateProfile, bitrateInProfile, bitrateHasNonRoundKbps, randomBitrate } from './bitrate-profiles.js';
import { animationTime, validateDuration } from './duration-settings.js';
import { animationDefaults } from './animation-reader.js';

const MAX_OUTPUT_BYTES = 500_000_000;
const MAX_WORKING_FILES_BYTES = 600_000_000;

export function makeFfmpegBridge(makeCanvasBridge, onEvent) {
  let ffmpeg;
  let canvasBridge;
  let inspection;
  let cancelled = false;
  let running = false;
  const abortError = () => new DOMException('Render cancelled.', 'AbortError');
  const checkCancelled = () => { if (cancelled) throw abortError(); };
  const emit = (data) => { if (!cancelled) onEvent(data); };

  async function run({ source, fileName, settings: s, metadataDefaults }) {
    if (running) throw new Error('FFmpeg is already running.');
    running = true;
    const started = performance.now();
    const total = Math.round(s.duration * s.fps);
    const estimate = s.bitrate * s.duration / 8;
    let inputBytes = 0;
    let encoding = false;
    let stageStarted = started;
    const logTail = [];
    let canvasRepair;
    try {
      checkCancelled();
      if (!['mp4', 'mov'].includes(s.format) || ![24, 25, 30, 50, 60].includes(s.fps) ||
          !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 16 || s.height < 16 ||
          s.width > 4096 || s.height > 4096 || s.width % 2 || s.height % 2 ||
          !Number.isFinite(s.bitrate) || s.bitrate < 1_000_000 || s.bitrate > 200_000_000 ||
          !Number.isFinite(s.duration) || s.duration <= 0 || total < 1) {
        throw new Error('Invalid FFmpeg export settings.');
      }
      const profile = getBitrateProfile(s.bitrateMode);
      if (!bitrateInProfile(s.bitrate, profile.id) || s.width !== profile.width || s.height !== profile.height) {
        throw new Error('The dimensions or target bitrate do not match the selected Auto Random mode.');
      }
      if (estimate > MAX_OUTPUT_BYTES || total > 30_000) {
        throw new Error('FFmpeg export is limited to approximately 500 MB or 30,000 frames. Reduce the duration or select a lower-resolution bitrate mode.');
      }
      canvasBridge = makeCanvasBridge();
      const meta = await canvasBridge.call('load', { source, fileName,
        metadataDefaults: metadataDefaults ?? animationDefaults(s) }, [], 15_000);
      validateDuration(meta.duration, s);
      checkCancelled();
      emit({ event: 'phase', phase: 'loading', message: 'Loading the local video encoder…' });
      ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => {
        logTail.push(message);
        if (logTail.length > 15) logTail.shift();
        if (encoding) {
          const match = message.match(/frame=\s*(\d+)/);
          if (match) sendEncodingProgress(Number(match[1]));
        }
      });
      function sendEncodingProgress(frame) {
        frame = Math.max(0, Math.min(total, frame));
        emit({ event: 'progress', phase: 'encoding', frame, total,
          elapsed: (performance.now() - stageStarted) / 1000, progress: 35 + 60 * frame / total });
      }
      ffmpeg.on('progress', ({ time }) => {
        if (encoding && Number.isFinite(time) && time > 0) {
          sendEncodingProgress(Math.round(time / 1_000_000 * s.fps));
        }
      });
      let loadTimer;
      try {
        await Promise.race([
          ffmpeg.load({
            coreURL: new URL(coreScript, location.href).href,
            wasmURL: new URL(coreWasm, location.href).href,
          }),
          new Promise((_, reject) => {
            loadTimer = setTimeout(() => reject(new Error('Unable to load FFmpeg. Check the Vite configuration and refresh the page.')), 120_000);
          }),
        ]);
      } finally { clearTimeout(loadTimer); }
      checkCancelled();
      await ffmpeg.createDir('/frames');
      emit({ event: 'phase', phase: 'frames', message: 'Preparing frames from your animation…' });
      stageStarted = performance.now();
      for (let i = 0; i < total; i++) {
        checkCancelled();
        const result = await canvasBridge.call('png', {
          width: s.width, height: s.height, time: animationTime(i / s.fps, meta.duration, s),
        }, [], 60_000).catch(error => {
          if (error.name === 'AbortError') throw error;
          const failure = new Error('Frame ' + (i + 1) + ' / ' + total + ' · ' + error.message, { cause: error });
          failure.name = error.name;
          throw failure;
        });
        canvasRepair = result.canvasRepair;
        checkCancelled();
        inputBytes += result.buffer.byteLength;
        if (inputBytes + estimate > MAX_WORKING_FILES_BYTES) {
          throw new Error('The frames and video require too much temporary memory. Reduce the resolution or duration and try again.');
        }
        await ffmpeg.writeFile('/frames/f' + String(i).padStart(6, '0') + '.png', new Uint8Array(result.buffer));
        if (i % 4 === 0 || i === total - 1) {
          emit({ event: 'progress', phase: 'frames', frame: i + 1, total, bytes: inputBytes,
            elapsed: (performance.now() - stageStarted) / 1000, progress: 35 * (i + 1) / total, canvasRepair });
        }
      }
      canvasBridge.dispose();
      canvasBridge = null;
      checkCancelled();
      const outputName = '/output.' + s.format;
      let targetBitrate = s.bitrate;
      for (let attempt = 0; attempt < 3; attempt++) {
        checkCancelled();
        const attemptBytes = targetBitrate * s.duration / 8;
        if (attemptBytes > MAX_OUTPUT_BYTES || attemptBytes + inputBytes > MAX_WORKING_FILES_BYTES) {
          throw new Error('The video and frames exceed the memory limit. Reduce the duration or resolution.');
        }
        emit({ event: 'phase', phase: 'encoding', targetBitrate,
          message: (attempt ? 'Adjusting the bitrate to fit ' : 'Encoding H.264 within ') +
            profile.minMbps + '–' + profile.maxMbps + ' Mbps…' });
        stageStarted = performance.now();
        encoding = true;
        const rate = String(targetBitrate);
        // Filler is real H.264 stream data. VBR HRD is compatible with MP4.
        const code = await ffmpeg.exec([
          '-hide_banner', '-y', '-framerate', String(s.fps), '-start_number', '0',
          '-i', '/frames/f%06d.png', '-frames:v', String(total), '-an',
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-b:v', rate, '-minrate', rate, '-maxrate', rate, '-bufsize', rate,
          '-x264-params', 'nal-hrd=vbr:filler=1:vbv-init=1:force-cfr=1',
          '-g', String(s.fps * 2), '-sc_threshold', '0', '-r', String(s.fps),
          '-f', s.format, outputName,
        ]);
        encoding = false;
        checkCancelled();
        if (code !== 0) {
          throw new Error('FFmpeg encoding failed. Try a lower resolution or shorter duration. ' + logTail.slice(-3).join(' ').slice(-350));
        }
        emit({ event: 'phase', phase: 'checking', message: 'Checking video duration, frames, and the selected bitrate range…' });
        const data = await ffmpeg.readFile(outputName);
        checkCancelled();
        inspection = new Input({ formats: [MP4, QTFF], source: new BufferSource(data) });
        let duration, frames, videoBitrate;
        try {
          const track = await inspection.getPrimaryVideoTrack();
          if (!track) throw new Error('No video track was found in the output.');
          const [codec, width, height, stats, end, first] = await Promise.all([
            track.getCodec(), track.getCodedWidth(), track.getCodedHeight(),
            track.computePacketStats(), track.computeDuration(), track.getFirstTimestamp(),
          ]);
          checkCancelled();
          duration = end - first;
          frames = stats.packetCount;
          if (codec !== 'avc' || width !== s.width || height !== s.height || frames !== total ||
              Math.abs(stats.averagePacketRate - s.fps) > 0.01 ||
              !Number.isFinite(duration) || Math.abs(duration - total / s.fps) > 0.01 || Math.abs(first) > 0.01) {
            throw new Error('Video validation failed: dimensions, frame rate, frame count, or duration do not match your settings.');
          }
          videoBitrate = stats.averageBitrate;
        } finally {
          if (inspection) inspection.dispose();
          inspection = null;
        }
        const bitrateMatches = Number.isFinite(videoBitrate) && Math.abs(videoBitrate / targetBitrate - 1) <= 0.05;
        if (bitrateMatches && bitrateInProfile(videoBitrate, profile.id) && bitrateHasNonRoundKbps(videoBitrate)) {
          return {
            buffer: data.buffer, bytes: data.byteLength,
            mime: s.format === 'mov' ? 'video/quicktime' : 'video/mp4',
            frames, duration, elapsed: (performance.now() - started) / 1000,
            savedToDisk: false, engine: 'ffmpeg', videoBitrate, bitrateMatches: true, bitrateVerified: true,
            targetBitrate, bitrateMode: profile.id, encodingAttempts: attempt + 1, canvasRepair,
          };
        }
        if (attempt === 2) {
          throw new Error('Unable to produce a verified bitrate within ' + profile.minMbps + '–' +
            profile.maxMbps + ' Mbps after 3 encoding attempts. No video was saved.');
        }
        await ffmpeg.deleteFile(outputName);
        targetBitrate = randomBitrate(profile.id, [targetBitrate], true);
      }
    } catch (error) {
      if (cancelled) throw abortError();
      if (error instanceof Error) throw error;
      throw new Error(String(error));
    } finally {
      if (canvasBridge) canvasBridge.dispose();
      if (ffmpeg) ffmpeg.terminate();
      if (inspection) inspection.dispose();
      inspection = null;
      canvasBridge = null;
      ffmpeg = null;
    }
  }
  return {
    call(type, payload) {
      if (cancelled) return Promise.reject(abortError());
      if (type !== 'export') return Promise.reject(new Error('Unknown FFmpeg command.'));
      return run(payload);
    },
    dispose() {
      cancelled = true;
      if (canvasBridge) canvasBridge.dispose();
      if (inspection) inspection.dispose();
      if (ffmpeg) ffmpeg.terminate();
    },
  };
}
