import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, realpath, open, unlink, statfs, appendFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { validateCloudJob, MAX_CLOUD_JOB_BYTES } from '../src/cloud-job.js';
import { nextBitrate, verifiedBitrate } from '../src/bitrate-profiles.js';
import { exportDimensions } from '../src/render-settings.js';
import { durationSettings } from '../src/duration-settings.js';
import { animationDefaults } from '../src/animation-reader.js';
import { outputFileName, uniqueOutputName } from '../src/render-queue.js';
import { writePngFrame } from './frame-stream.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'cloud-output');
const clean = value => String(value).replace(/[\r\n\x00]/g, ' ').slice(0, 2500);
const log = message => console.log('[cloud] ' + clean(message));
const threads = Math.min(4, availableParallelism());
const report = { version: 1, frameTransport: 'lossless-png-memory-stream', startedAt: new Date().toISOString(), runner: {
  cpu: cpus()[0]?.model || 'unknown', encoderThreads: threads, ramBytes: totalmem(), githubHosted: Boolean(process.env.GITHUB_ACTIONS),
}, files: [] };
let browser, context, page, server, active, encoder, totalBytes = 0, cancelled = false;
let origin;
const assets = new Map([
  ['/', ['cloud/controller.html', 'text/html']],
  ['/cloud/canvas-worker.js', ['cloud/canvas-worker.js', 'text/javascript']],
  ['/cloud/png-frame.js', ['cloud/png-frame.js', 'text/javascript']],
  ['/cloud/node_modules/fflate/esm/browser.js', ['cloud/node_modules/fflate/esm/browser.js', 'text/javascript']],
  ['/src/canvas-auto-repair.js', ['src/canvas-auto-repair.js', 'text/javascript']],
  ['/src/duration-settings.js', ['src/duration-settings.js', 'text/javascript']],
  ['/src/animation-reader.js', ['src/animation-reader.js', 'text/javascript']],
]);

async function readJob() {
  const requested = process.env.CLOUD_JOB_FILE || 'cloud/jobs/example-job.json';
  if (!/^cloud\/jobs\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.json$/.test(requested)) {
    throw new Error('Job file must be a JSON file directly inside cloud/jobs/.');
  }
  const path = await realpath(resolve(root, requested));
  if (!path.startsWith(resolve(root, 'cloud/jobs') + sep) || (await stat(path)).size > MAX_CLOUD_JOB_BYTES) {
    throw new Error('Job file is outside cloud/jobs/ or exceeds 20 MB.');
  }
  report.jobFile = requested;
  return validateCloudJob(JSON.parse(await readFile(path, 'utf8')));
}

async function startServer() {
  server = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/frame') {
        const sink = active;
        if (!sink || req.headers['x-cloud-token'] !== sink.token || req.headers.origin !== origin ||
            Number(req.headers['x-frame-index']) !== sink.next || sink.receiving || sink.next >= sink.total) {
          res.writeHead(409); res.end('Frame sequence rejected.'); return;
        }
        sink.receiving = true;
        try { await writePngFrame(req, sink, () => sink === active); }
        finally { sink.receiving = false; }
        const elapsed = (performance.now() - sink.started) / 1000;
        if (elapsed - sink.lastLog >= 1 || sink.next === sink.total) {
          sink.lastLog = elapsed;
          log('Frames ' + sink.next + '/' + sink.total + ' · pipeline ' + (sink.next / elapsed).toFixed(2) + ' FPS');
        }
        res.writeHead(200); res.end('ok'); return;
      }
      const asset = req.method === 'GET' && assets.get(req.url);
      if (!asset) { res.writeHead(404); res.end('Not found.'); return; }
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; connect-src 'self';" });
      res.end(await readFile(resolve(root, asset[0])));
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end('[FRAME_TRANSFER_FAILED] ' + clean(error.message || error));
    }
  });
  server.requestTimeout = 60000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
}

async function encode(source, fileName, settings, path, meta) {
  const total = Math.round(settings.duration * settings.fps);
  const started = performance.now();
  const rate = String(settings.bitrate);
  let tail = '';
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-nostats', '-filter_threads', '2',
    '-f', 'image2pipe', '-vcodec', 'png',
    '-framerate', String(settings.fps), '-i', 'pipe:0', '-frames:v', String(total), '-an',
    '-c:v', 'libx264', '-threads', String(threads), '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-b:v', rate, '-minrate', rate, '-maxrate', rate, '-bufsize', rate,
    '-x264-params', 'nal-hrd=vbr:filler=1:vbv-init=1:force-cfr=1', '-g', String(settings.fps * 2),
    '-sc_threshold', '0', '-r', String(settings.fps), '-metadata', 'title=' + meta.title,
    '-progress', 'pipe:3', '-stats_period', '1', '-f', settings.format, path,
  ], { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
  encoder = child;
  child.stdin.on('error', () => {});
  child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-4000); });
  let progress = '';
  child.stdio[3].on('data', chunk => {
    progress += chunk;
    const lines = progress.split('\n'); progress = lines.pop();
    for (const line of lines) if (line.startsWith('frame=')) log('Encoded ' + line.slice(6).trim() + '/' + total + ' frames');
  });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg failed (' + code + '). ' + clean(tail))));
  });
  finished.catch(() => {});
  const token = randomUUID();
  active = { token, stdin: child.stdin, next: 0, total, width: settings.width, height: settings.height,
    started, lastLog: 0, receiving: false };
  try {
    const frames = await page.evaluate(({ settings, token }) => window.streamFrames(settings, token), { settings, token });
    child.stdin.end();
    await finished;
    return { ...frames, elapsedSeconds: (performance.now() - started) / 1000 };
  } catch (error) {
    error.completedFrames = active?.next || 0;
    error.totalFrames = total;
    throw error;
  } finally {
    active = null; encoder = null;
    if (child.exitCode === null) child.kill('SIGKILL');
    // Wait for the process to close before removing or reusing its output.
    await finished.catch(() => {});
  }
}

async function closeRenderer() {
  const previous = context;
  context = null; page = null;
  await previous?.close().catch(() => {});
}

async function openRenderer() {
  await closeRenderer();
  if (!browser?.isConnected()) {
    const customBrowser = process.env.CLOUD_CHROMIUM_EXECUTABLE;
    browser = await chromium.launch({ headless: true, ...(customBrowser ? { executablePath: customBrowser,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
  }
  context = await browser.newContext();
  // Binary frames use local HTTP with backpressure, never Playwright routing
  // or JSON serialization. Each file/recovery gets a fresh browser context.
  page = await context.newPage();
  await page.goto(origin);
}

function recoverable(error) {
  return /\[(?:FRAME_READ_FAILED|FRAME_ENCODE_FAILED|SOURCE_READ_FAILED|FRAME_TRANSFER_FAILED|WORKER_TIMEOUT|WORKER_CRASH)\]|Target (?:page, context or browser has been closed|closed)|(?:Page|Browser) crashed|browser has disconnected/i.test(String(error.message || error));
}

function inspect(path, settings, target) {
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,duration,bit_rate,nb_read_packets', '-of', 'json', path],
  { encoding: 'utf8', maxBuffer: 1_000_000 }));
  const stream = info.streams?.[0];
  const total = Math.round(settings.duration * settings.fps);
  const [numerator, denominator] = String(stream?.avg_frame_rate).split('/').map(Number);
  if (!stream || stream.codec_name !== 'h264' || stream.width !== settings.width || stream.height !== settings.height ||
      Number(stream.nb_read_packets) !== total || Math.abs(numerator / denominator - settings.fps) > .01 ||
      !Number.isFinite(Number(stream.duration)) || Math.abs(Number(stream.duration) - total / settings.fps) > .01) {
    throw new Error('Video verification failed: codec, dimensions, FPS, frames, or duration do not match.');
  }
  const bitrate = Number(stream.bit_rate);
  return { verified: verifiedBitrate(bitrate, settings.bitrateMode, target),
    videoBitrate: bitrate, frames: total, duration: Number(stream.duration) };
}

async function renderFile(file, job, index, used) {
  const record = { fileName: file.fileName, status: 'failed', recoveries: [] };
  report.files.push(record);
  let path, outputName;
  const started = performance.now();
  let encodingAttempts = 0;
  try {
    for (let recovery = 0; recovery <= 2; recovery++) {
      try {
        if (cancelled) throw new Error('Cloud render cancelled.');
        await openRenderer();
        log('File ' + (index + 1) + '/' + job.files.length + ': ' + file.fileName);
        const loadPayload = { source: file.source, name: file.fileName,
          metadataDefaults: animationDefaults(job.settings) };
        const loadSource = () => page.evaluate(({ source, name, metadataDefaults }) =>
          window.loadAnimation(source, name, metadataDefaults), loadPayload);
        const meta = await loadSource();
        record.sourceMetadata = meta;
        const settings = { ...job.settings, ...exportDimensions(job.settings, meta),
          ...durationSettings(meta.duration, job.settings.durationChoice, job.settings.fps) };
        if (settings.duration * settings.fps < 1 || settings.duration * settings.fps > 30000) throw new Error('Cloud export supports 1–30,000 frames per video.');
        let target = file.bitrate;
        if (!path) for (;;) {
          outputName = uniqueOutputName(outputFileName(file.fileName, settings), used);
          path = resolve(outDir, outputName);
          try { const handle = await open(path, 'wx'); await handle.close(); break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        for (let attempt = 1; attempt <= 3; attempt++) {
          const estimate = target * settings.duration / 8;
          const disk = await statfs(outDir);
          if (estimate > 2_000_000_000 || totalBytes + estimate > 8_000_000_000 || disk.bavail * disk.bsize < estimate + 500_000_000) {
            throw new Error('Cloud output exceeds the available disk budget (2 GB/video, 8 GB/job). Choose fewer files or a shorter duration.');
          }
          settings.bitrate = target;
          if (attempt > 1) { await openRenderer(); await loadSource(); }
          log(settings.width + 'x' + settings.height + ' · ' + settings.fps + ' FPS · ' + settings.duration + ' s · target ' + (target / 1e6).toFixed(3) + ' Mbps');
          encodingAttempts++;
          const metrics = await encode(file.source, file.fileName, settings, path, meta);
          const verified = inspect(path, settings, target);
          if (verified.verified) {
            const bytes = (await stat(path)).size;
            totalBytes += bytes;
            Object.assign(record, { status: 'completed', outputName, bytes, ...verified, targetBitrate: target, encodingAttempts,
              recoveryAttempts: record.recoveries.length, pureDrawingSeconds: metrics.pureDrawingSeconds,
              pixelReadbackSeconds: metrics.pixelReadbackSeconds, compressionSeconds: metrics.compressionSeconds,
              frameTransferSeconds: metrics.frameTransferSeconds,
              elapsedSeconds: (performance.now() - started) / 1000, pipelineFPS: verified.frames / metrics.elapsedSeconds,
              canvasFPS: metrics.drawingSeconds > 0 ? verified.frames / metrics.drawingSeconds : null, canvasRepair: metrics.canvasRepair });
            log('Completed · ' + outputName + ' · verified ' + (verified.videoBitrate / 1e6).toFixed(3) + ' Mbps · ' + record.pipelineFPS.toFixed(2) + ' pipeline FPS');
            return;
          }
          target = nextBitrate(settings.bitrateMode, file.bitrate, [target], true);
        }
        throw new Error('Bitrate did not pass verification after 3 attempts.');
      } catch (error) {
        if (cancelled || recovery === 2 || !recoverable(error)) throw error;
        if (path) await unlink(path).catch(() => {});
        record.recoveries.push({ attempt: recovery + 1, error: clean(error.message || error),
          completedFrames: error.completedFrames, totalFrames: error.totalFrames });
        log('Recovering ' + file.fileName + ' · ' + (recovery + 1) + '/2 · restarting this file with a fresh browser context · ' + clean(error.message || error));
        await closeRenderer();
      }
    }
  } catch (error) {
    if (path) await unlink(path).catch(() => {});
    record.error = clean(error.message || error);
    record.encodingAttempts = encodingAttempts;
    record.recoveryAttempts = record.recoveries.length;
    if (Number.isInteger(error.completedFrames)) {
      record.completedFrames = error.completedFrames;
      record.failedFrame = error.completedFrames + 1;
      record.totalFrames = error.totalFrames;
    }
    record.elapsedSeconds = (performance.now() - started) / 1000;
    log('Failed · ' + file.fileName + ' · ' + record.error + ' Continuing to the next file.');
  } finally { await closeRenderer(); }
}

async function saveReport() {
  report.finishedAt = new Date().toISOString();
  report.completed = report.files.filter(file => file.status === 'completed').length;
  report.failed = report.files.filter(file => file.status !== 'completed').length;
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => clean(value).replace(/[&<>|`]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '`': '&#96;' })[char]);
  const lines = ['# Prysm Motion Studio · cloud render', '',
    'Native FFmpeg on CPU. Pipeline FPS includes drawing, frame transfer, and encoding; these stages overlap.', '',
    '| File | Result | Duration | Frames | Video bitrate | Pipeline FPS |', '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.files.map(file => '| ' + escape(file.fileName) + ' | ' + (file.status === 'completed' ? '✅ Completed' : '❌ Failed') + ' | ' +
      (file.duration ?? '—') + ' s | ' + (file.frames ?? '—') + ' | ' + (file.videoBitrate ? (file.videoBitrate / 1e6).toFixed(3) + ' Mbps' : '—') + ' | ' +
      (file.pipelineFPS?.toFixed(2) ?? '—') + ' |'), '',
    ...report.files.filter(file => file.error).map(file => '- ' + escape(file.fileName) + ': ' + escape(file.error)),
    ...(report.error ? ['', 'Job error: ' + escape(report.error)] : []), '',
    'Download completed videos and report.json from Artifacts before the 3-day retention expires.',
    'Uploaded job JSON contains source code. Deleting it later does not remove its Git history.', '',
  ];
  await writeFile(resolve(outDir, 'summary.md'), lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  try {
    const job = await readJob();
    report.id = job.id; report.settings = job.settings;
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    await startServer();
    const used = new Set();
    for (let i = 0; i < job.files.length && !cancelled; i++) await renderFile(job.files[i], job, i, used);
    if (cancelled) throw new Error('Cloud render cancelled.');
  } catch (error) { report.error = clean(error.message || error); log(report.error); }
  finally {
    encoder?.kill('SIGKILL');
    await browser?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await saveReport();
    if (report.error || report.failed) process.exitCode = 1;
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  cancelled = true; encoder?.kill('SIGKILL'); void browser?.close();
});
await main();
