import './style.css';
import { makeFfmpegBridge } from './ffmpeg-renderer.js';
import { BITRATE_PROFILES, getBitrateProfile, profileForDimensions, randomBitrate, bitrateInProfile, bitrateHasNonRoundKbps } from './bitrate-profiles.js';
import { MAX_QUEUE_FILES, createRenderQueue, outputFileName, uniqueOutputName } from './render-queue.js';
import { MAX_AI_SOURCE_BYTES, repairEndpoint, callRepairBackend, applyRepairEdits, validateAnimation } from './ai-repair.js';

document.title = 'Canvas Video Studio';
document.documentElement.lang = 'en';

const uploadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>';
const fileIcon = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M19 3H8a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V10L19 3Zm0 0v7h7M12 16l-3 3 3 3m8-6 3 3-3 3m-3-7-2 10"/></svg>';
const bitrateOptions = Object.values(BITRATE_PROFILES).map((profile) =>
  '<option value="' + profile.id + '"' + (profile.id === '1080p' ? ' selected' : '') + '>Auto Random · ' + profile.label + ' · ' + profile.minMbps + '–' + profile.maxMbps + ' Mbps</option>').join('');

document.querySelector('#app').innerHTML = [
  '<main class="studio" id="top">',
  '<header class="topbar"><a class="brand" href="#top" aria-label="Canvas Video Studio home"><span class="brand-mark" aria-hidden="true"><i></i></span><span class="brand-name"><strong>CANVAS</strong><span>VIDEO STUDIO</span></span></a><nav class="nav-links" aria-label="Studio navigation"><a href="#workspace">Studio</a><a href="#export-settings">Export</a><a href="#render-status">Status</a></nav><span class="local-badge"><i></i>Runs on your device</span></header>',
  '<section class="intro"><div class="intro-content"><p class="eyebrow"><span class="eyebrow-line"></span>YOUR BROWSER. YOUR RENDER ENGINE.</p><h1>TURN CODE<br>INTO <span>MOTION.</span></h1><p class="intro-copy">Transform your JavaScript animations into crisp, smooth video. Preview, customize, and export directly on your device.</p><div class="feature-tags"><span>MP4 &amp; MOV</span><span>UP TO 4K</span><span>60 FPS</span></div></div><div class="prism-art" aria-hidden="true"><div class="prism-orbit orbit-one"></div><div class="prism-orbit orbit-two"></div><svg viewBox="0 0 300 270" fill="none"><defs><linearGradient id="prism-gradient" x1="30" y1="20" x2="260" y2="230" gradientUnits="userSpaceOnUse"><stop stop-color="#00ffff"/><stop offset="0.5" stop-color="#00a8ff"/><stop offset="1" stop-color="#9945ff"/></linearGradient></defs><path d="M150 22 259 85 259 211 150 251 41 211 41 85 150 22Z" fill="url(#prism-gradient)" fill-opacity=".05" stroke="url(#prism-gradient)"/><path d="m150 22 55 94-55 135-55-135 55-94Zm-109 63 109 34 109-34M41 211l109-92 109 92M95 116l55 3 55-3" stroke="url(#prism-gradient)" stroke-width="1.5"/><path d="M150 72 184 131 150 184 116 131 150 72Z" fill="url(#prism-gradient)" fill-opacity=".2" stroke="url(#prism-gradient)"/></svg><span class="prism-caption">CREATE / RENDER / EXPORT</span></div></section>',
  '<div class="workspace" id="workspace">',
  '<section class="preview-panel"><div class="panel-heading"><div class="panel-title"><span class="section-number">01</span><h2>Animation preview</h2></div><span id="source-badge" class="muted">No file loaded</span></div>',
  '<div id="stage" class="stage"><canvas id="preview" width="960" height="540"></canvas><div id="empty-state" class="empty-state"><span class="canvas-symbol">' + fileIcon + '</span><h3>YOUR NEXT FRAME<br>STARTS HERE.</h3><p>Choose a JavaScript file to preview your animation.</p><span class="empty-tag">CANVAS 2D / JAVASCRIPT</span></div></div>',
  '<div class="playback"><button id="play" class="icon-button" disabled aria-label="Play or pause preview">▶</button><input id="seek" aria-label="Preview time" type="range" min="0" max="20" step="0.01" value="0" disabled><span id="time" class="time">0.00 / 0.00 s</span></div>',
  '<div class="file-details"><span class="file-detail-icon" aria-hidden="true">JS</span><div><strong id="animation-title">Canvas 2D animation</strong><span id="metadata">Animation details will appear here.</span></div><span class="file-detail-label">SOURCE</span></div></section>',
  '<aside class="settings-panel" id="export-settings"><div class="panel-heading"><div class="panel-title"><span class="section-number">02</span><h2>Export settings</h2></div><span class="step-chip">H.264</span></div>',
  '<label class="upload-zone" id="upload-zone"><span class="upload-icon">' + uploadIcon + '</span><strong id="file-label">Choose JavaScript files</strong><span>Up to 10 .js files · 5 MB per file</span><input id="file" type="file" accept=".js,text/javascript,application/javascript" multiple aria-label="Choose up to 10 JavaScript animation files"></label>',
  '<p id="canvas-repair-note" class="field-note">Canvas auto-repair is on. Coordinate arrays and point objects are unpacked automatically.</p>',
  '<form id="settings"><label>Render engine<select id="engine"><option value="ffmpeg">FFmpeg · verified bitrate</option><option value="webcodecs" disabled>WebCodecs · bitrate not guaranteed</option></select></label><p id="engine-note" class="field-note"></p><div class="field-row"><label>Format<select id="format"><option value="mp4">MP4 · H.264</option><option value="mov">MOV · H.264</option></select></label><label>Frame rate<select id="fps"><option value="30">30 FPS</option><option value="60">60 FPS</option><option value="24">24 FPS</option><option value="25">25 FPS</option><option value="50">50 FPS</option></select></label></div>',
  '<label>Resolution<select id="resolution"><option value="3840x2160">4K · 3840 × 2160</option><option value="2560x1440">2K · 2560 × 1440</option><option value="1920x1080" selected>FHD · 1920 × 1080</option><option value="1280x720">HD · 1280 × 720</option><option value="native" disabled>Original resolution</option></select></label>',
  '<label>Duration<select id="duration"><option value="full">Full animation</option><option value="2">Quick test · 2 seconds</option><option value="5">Quick test · 5 seconds</option></select></label>',
  '<label>Bitrate mode<select id="bitrate-mode">' + bitrateOptions + '</select></label>',
  '<label>Target bitrate<div class="bitrate-field"><input id="bitrate" type="number" min="40" max="51" step="0.001" value="45.123" required readonly aria-label="Target bitrate in Mbps"><span>Mbps</span><button id="random-bitrate" type="button" title="Pick a new target within the selected range">Randomize</button></div></label>',
  '<p id="bitrate-mode-note" class="field-note"></p>',
  '<p id="bitrate-note" class="field-note"></p>',
  '<label>Save video<select id="save-mode"><option value="download">Download when complete</option><option value="disk">Save directly to file</option></select></label>',
  '<p id="storage-note" class="field-note"></p><div class="estimate"><span>Estimated file size</span><strong id="estimate">—</strong></div>',
  '<button id="render" class="primary-button" type="submit" disabled>Render video <span aria-hidden="true">↗</span></button></form>',
  '<p id="capabilities" class="capabilities">Checking browser support…</p></aside></div>',
  '<section class="job-panel" id="render-status" aria-live="polite"><div class="job-header"><div><p class="eyebrow">RENDER STATUS</p><h2 id="status">Ready to load an animation</h2></div><button id="cancel" class="secondary-button" disabled>Cancel render</button></div>',
  '<progress id="progress" aria-label="Render progress" value="0" max="100"></progress><div class="job-stats"><span id="frame-stat">0 frames</span><span id="speed-stat">—</span><span id="eta-stat">—</span></div><p id="encoding-details" class="field-note"></p><p id="repair-details" class="field-note" hidden></p><p id="message" class="job-message">For a quick first test, use 720p, 30 FPS, and a 2-second clip.</p><a id="download" class="download-link" hidden>Download video <span aria-hidden="true">↓</span></a></section>',
  '<section id="render-queue" class="queue-panel" aria-labelledby="queue-title" hidden><div class="queue-header"><div class="panel-title"><span class="section-number">03</span><h2 id="queue-title">Render queue</h2></div><span id="queue-count" class="step-chip"></span></div><p class="queue-note">Files render one at a time. If an animation fails, the next file starts automatically.</p><ol id="queue-list" class="queue-list"></ol><p id="queue-summary" class="queue-summary" role="status" aria-live="polite"></p></section>',
  '<section class="ai-panel" aria-labelledby="ai-title"><div class="panel-title"><span class="section-number">04</span><h2 id="ai-title">AI Auto Repair · GPT-5.6 Sol</h2></div><p class="queue-note">Use Auto Repair on a file in the render queue. Repaired code is tested across the full animation before it becomes ready to render.</p><details id="ai-settings"><summary>AI repair connection</summary><div class="ai-fields"><label>AI backend URL<input id="ai-endpoint" type="url" placeholder="https://canvas-ai-repair.example.workers.dev" autocomplete="off"></label><label>Repair access code<input id="ai-token" type="password" placeholder="Your private repair access code" autocomplete="off" spellcheck="false"></label></div><button id="ai-check" class="secondary-button" type="button">Check backend</button><p id="ai-connection" class="field-note" aria-live="polite">Configure your backend to enable AI repair. Keep your OpenAI API key in the backend.</p></details><label class="ai-consent"><input id="ai-consent" type="checkbox">Allow the selected JavaScript file and error details to be sent to OpenAI through my backend for repair.</label><p class="field-note">Up to 250 KB per file and two AI requests per click. API usage is billed separately. The access code stays in this tab; only the backend URL is remembered. Your original file is kept. Review the preview before exporting.</p><p id="ai-status" class="field-note" aria-live="polite">AI repair is ready to configure.</p></section>',
  '<footer><span>JAVASCRIPT → CANVAS → MP4 / MOV</span><span>Keep this tab open while rendering.</span></footer>',
  '</main>',
].join('\n');

const $ = (id) => document.getElementById(id);
const state = {
  source: '', fileName: '', meta: null, preview: null, exporting: null,
  playing: false, raf: 0, time: 0, origin: 0, originTime: 0,
  drawing: false, pendingTime: null, loading: false, busy: false, cancelRequested: false, fileStream: null,
  activeSettings: null, lastRenderBitrate: null, jobs: [], currentJob: null, preparing: null, repairing: null,
};
const queue = createRenderQueue($('render-queue'), job => loadPreview(job), repairJob, restoreOriginal);

function makeBridge(onEvent, restricted = false) {
  const worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextId = 1;
  let disposed = false;
  const failAll = (error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    if (data.event) { if (onEvent) onEvent(data); return; }
    const item = pending.get(data.id);
    if (!item) { if (data.result && data.result.bitmap) data.result.bitmap.close(); return; }
    clearTimeout(item.timer);
    pending.delete(data.id);
    if (data.ok) item.resolve(data.result);
    else {
      const error = new Error(data.error.message);
      error.name = data.error.name;
      item.reject(error);
    }
  };
  worker.onerror = (event) => failAll(new Error(event.message || 'The renderer stopped. Reload your animation file and try again.'));
  return {
    call(type, payload = {}, transfer = [], timeout = 0) {
      return new Promise((resolve, reject) => {
        if (disposed) { reject(new DOMException('Cancelled.', 'AbortError')); return; }
        const id = nextId++;
        const timer = timeout ? setTimeout(() => {
          this.dispose(new Error('The animation is not responding. Check your JavaScript and reload the file.'));
        }, timeout) : null;
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ id, type, payload: type === 'load' && restricted ? { ...payload, restricted: true } : payload }, transfer); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    dispose(error = new DOMException('Cancelled.', 'AbortError')) {
      disposed = true;
      worker.terminate();
      failAll(error);
    },
  };
}

function setMessage(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}

function repairText(report) {
  const operations = report.fixes.map(fix => fix.operation + '()').join(', ');
  return 'Canvas auto-repair applied · ' + report.repairedCalls + ' call' + (report.repairedCalls === 1 ? '' : 's') + ' · ' + operations + '.';
}

function updateRepairDetails(report) {
  if (!report) return;
  $('repair-details').hidden = !report.repairedCalls;
  $('repair-details').textContent = report.repairedCalls ? repairText(report) : '';
}

function updateControls() {
  const blocked = state.busy || state.loading;
  $('file').disabled = blocked;
  $('upload-zone').classList.toggle('disabled', blocked);
  for (const element of $('settings').querySelectorAll('input, select, button')) element.disabled = blocked;
  $('render').disabled = blocked || !state.jobs.length || !browserReady;
  $('render').innerHTML = (state.jobs.length > 1 ? 'Render ' + state.jobs.length + ' videos' : 'Render video') + ' <span aria-hidden="true">↗</span>';
  $('play').disabled = blocked || !state.meta;
  $('seek').disabled = blocked || !state.meta;
  $('cancel').disabled = !state.busy;
  $('cancel').textContent = state.repairing ? 'Cancel repair' : state.jobs.length > 1 ? 'Cancel queue' : 'Cancel render';
  for (const element of $('ai-settings').querySelectorAll('input, button')) element.disabled = blocked;
  $('ai-consent').disabled = blocked;
  queue.setBlocked(blocked);
}

function exportPreferences() {
  const dimensions = $('resolution').value === 'native' ?
    [state.meta?.width, state.meta?.height] : $('resolution').value.split('x').map(Number);
  const preferences = {
    format: $('format').value, width: dimensions[0], height: dimensions[1], fps: Number($('fps').value),
    durationChoice: $('duration').value, engine: $('engine').value, bitrateMode: $('bitrate-mode').value,
    bitrate: Math.round(Number($('bitrate').value) * 1_000_000), saveMode: $('save-mode').value,
  };
  const profile = getBitrateProfile(preferences.bitrateMode);
  if (!bitrateInProfile(preferences.bitrate, profile.id) || preferences.width !== profile.width || preferences.height !== profile.height) {
    throw new Error('The resolution and target must match the selected Auto Random mode.');
  }
  if (preferences.engine !== 'ffmpeg') throw new Error('Auto Random modes require FFmpeg for verified bitrate.');
  return preferences;
}

function settingsFor(meta, preferences, bitrate = preferences.bitrate) {
  const duration = preferences.durationChoice === 'full' ? meta.duration :
    Math.min(meta.duration, Number(preferences.durationChoice));
  return {
    format: preferences.format, width: preferences.width, height: preferences.height, fps: preferences.fps,
    engine: preferences.engine, bitrateMode: preferences.bitrateMode, bitrate,
    duration: Math.floor(duration * preferences.fps + 0.000001) / preferences.fps,
  };
}

function settings() {
  return settingsFor(state.meta, exportPreferences());
}

function sizeText(bytes) {
  if (bytes >= 1_000_000_000) return (bytes / 1_000_000_000).toFixed(2) + ' GB';
  return (bytes / 1_000_000).toFixed(1) + ' MB';
}

function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return Math.ceil(seconds) + ' sec';
  return Math.floor(seconds / 60) + ' min ' + Math.ceil(seconds % 60) + ' sec';
}

function updateEstimate() {
  if (!state.meta) { $('estimate').textContent = '—'; return; }
  try { const s = settings(); $('estimate').textContent = '≈ ' + sizeText(s.bitrate * s.duration / 8); }
  catch { $('estimate').textContent = '—'; }
}

function randomizeBitrate() {
  const bitrate = randomBitrate($('bitrate-mode').value, [Number($('bitrate').value) * 1_000_000, state.lastRenderBitrate]);
  $('bitrate').value = (bitrate / 1_000_000).toFixed(3);
  updateEstimate();
  return bitrate;
}

function updateBitrateMode(syncResolution = true) {
  const profile = getBitrateProfile($('bitrate-mode').value);
  if (syncResolution) $('resolution').value = profile.width + 'x' + profile.height;
  $('engine').value = 'ffmpeg';
  $('bitrate').readOnly = true;
  $('bitrate').min = profile.minMbps;
  $('bitrate').max = profile.maxMbps;
  $('bitrate-mode-note').textContent = 'New random target for each file. ' + profile.label + ': ' + profile.minMbps + '–' + profile.maxMbps + ' Mbps. Resolution follows this mode; every output is checked before saving.';
  randomizeBitrate();
  updateEngineNotes();
}

function updateResolutionMode() {
  const dimensions = $('resolution').value === 'native' ? [state.meta.width, state.meta.height] : $('resolution').value.split('x').map(Number);
  const profile = profileForDimensions(...dimensions);
  if (!profile) throw new Error('Choose a resolution supported by the Auto Random modes.');
  $('bitrate-mode').value = profile.id;
  updateBitrateMode(false);
}

function clearDownload() {
  $('download').hidden = true;
  $('download').removeAttribute('href');
}

function pause() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  $('play').textContent = '▶';
}

async function draw(time) {
  if (!state.preview || !state.meta) return;
  if (state.drawing) { state.pendingTime = time; return; }
  const bridge = state.preview;
  state.drawing = true;
  const width = Math.min(960, Math.round(540 * state.meta.width / state.meta.height));
  const height = Math.round(width * state.meta.height / state.meta.width);
  try {
    const { bitmap, canvasRepair } = await bridge.call('draw', { width, height, time }, [], 10000);
    if (bridge !== state.preview) { bitmap.close(); return; }
    const canvas = $('preview');
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    $('canvas-repair-note').textContent = canvasRepair?.repairedCalls ? repairText(canvasRepair) :
      'Canvas auto-repair is on. Coordinate arrays and point objects are unpacked automatically.';
    state.time = time;
    $('seek').value = time;
    $('time').textContent = time.toFixed(2) + ' / ' + state.meta.duration.toFixed(2) + ' s';
    return true;
  } catch (error) {
    if (bridge === state.preview && error.name !== 'AbortError') {
      pause();
      setMessage(error.message, true);
    }
    return false;
  } finally {
    if (bridge === state.preview) {
      state.drawing = false;
      if (state.pendingTime !== null) {
        const nextTime = state.pendingTime;
        state.pendingTime = null;
        void draw(nextTime);
      }
    }
  }
}

function tick(now) {
  if (!state.playing || !state.meta) return;
  const time = Math.min(state.meta.duration, state.originTime + (now - state.origin) / 1000);
  if (!state.drawing) void draw(time);
  if (time >= state.meta.duration) { pause(); void draw(state.meta.duration); return; }
  state.raf = requestAnimationFrame(tick);
}

const browserReady = isSecureContext && 'OffscreenCanvas' in globalThis &&
  'Worker' in globalThis && 'WebAssembly' in globalThis;
const diskAvailable = 'showSaveFilePicker' in globalThis;
const directoryAvailable = 'showDirectoryPicker' in globalThis;
$('save-mode').querySelector('[value="disk"]').disabled = !diskAvailable;
$('save-mode').value = 'download';
$('engine').querySelector('[value="webcodecs"]').disabled = true;
$('capabilities').textContent = browserReady ?
  'Browser ready. FFmpeg runs on this device’s CPU.' :
  'Export requires OffscreenCanvas, Worker, WebAssembly, and HTTPS or localhost.';
$('capabilities').classList.toggle('unsupported', !browserReady);

async function jobSource(job) {
  if (job.file.size > 5_000_000) throw new Error(job.file.name + ' · Choose a JavaScript file smaller than 5 MB.');
  if (!job.file.name.toLowerCase().endsWith('.js')) throw new Error(job.file.name + ' · Choose a file with a .js extension.');
  if (job.source === null) job.source = await job.file.text();
  return job.source;
}

function aiConnection() {
  const endpoint = repairEndpoint($('ai-endpoint').value);
  const token = $('ai-token').value;
  if (token.length < 24) throw new Error('Enter your repair access code (at least 24 characters) in AI repair connection.');
  return { endpoint, token };
}

function resetJobOutput(job) {
  if (job.downloadUrl) URL.revokeObjectURL(job.downloadUrl);
  job.downloadUrl = null;
  job.result = null;
  job.outputName = '';
  job.status = 'pending';
  clearDownload();
}

async function restoreOriginal(job) {
  if (state.busy || state.loading || !job.repaired) return;
  job.source = job.originalSource;
  job.meta = null;
  job.repaired = false;
  if (job.repairedUrl) URL.revokeObjectURL(job.repairedUrl);
  job.repairedUrl = null;
  job.repairMessage = 'Original JavaScript restored.';
  job.detail = 'Original source restored. Ready to render.';
  resetJobOutput(job);
  queue.update(job);
  await loadPreview(job);
}

async function repairJob(job) {
  if (state.busy || state.loading || !browserReady) return;
  let connection, source, selected;
  try {
    connection = aiConnection();
    if (!$('ai-consent').checked) throw new Error('Allow sending the selected file to OpenAI by checking the consent box in AI Auto Repair.');
    source = await jobSource(job);
    if (new TextEncoder().encode(source).length > MAX_AI_SOURCE_BYTES) throw new Error('AI repair supports files up to 250 KB. This file can still be rendered normally.');
    const preferences = exportPreferences();
    selected = { width: preferences.width, height: preferences.height, fps: preferences.fps };
  } catch (error) {
    $('ai-settings').open = true;
    $('ai-status').textContent = error.message;
    job.repairMessage = error.message;
    queue.update(job);
    return;
  }
  pause();
  if (state.preview) state.preview.dispose();
  state.preview = null;
  state.drawing = false;
  state.pendingTime = null;
  const controller = new AbortController();
  state.repairing = controller;
  state.busy = true;
  state.cancelRequested = false;
  updateControls();
  let committed = false;
  const stage = text => {
    job.repairMessage = text;
    $('ai-status').textContent = job.file.name + ' · ' + text;
    $('status').textContent = 'AI Auto Repair · ' + text;
    queue.update(job);
  };
  const validate = (candidate, expectedMeta) => validateAnimation(candidate, job.file.name, selected, () => makeBridge(), {
    signal: controller.signal, expectedMeta,
    onProgress: ({ frame, total }) => {
      $('progress').value = frame / total * 100;
      $('frame-stat').textContent = frame + ' / ' + total + ' frames checked';
    },
  });
  try {
    $('progress').value = 0;
    let diagnostic, expectedMeta = job.meta;
    stage('Checking the full animation…');
    try {
      await validate(source);
      stage('No runtime error found. Original source kept.');
      return;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (error.animationMeta) expectedMeta = error.animationMeta;
      diagnostic = error.message;
      if (diagnostic.includes('30,000 frames') || diagnostic.includes('without imports or dynamic code')) throw error;
    }
    let candidate = source;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (controller.signal.aborted) throw new DOMException('Repair cancelled.', 'AbortError');
      stage('Requesting GPT-5.6 Sol · attempt ' + attempt + ' / 2…');
      const result = await callRepairBackend(connection.endpoint, connection.token, '/repair', {
        source: candidate, fileName: job.file.name, error: diagnostic.slice(0, 4000), metadata: expectedMeta,
      }, controller.signal);
      if (!Array.isArray(result.edits) || !result.edits.length) throw new Error(result.summary || 'AI could not establish a repair.');
      candidate = applyRepairEdits(candidate, result.edits);
      stage('Validating the repaired animation…');
      try {
        const verified = await validate(candidate, expectedMeta);
        if (controller.signal.aborted) throw new DOMException('Repair cancelled.', 'AbortError');
        if (job.originalSource === null) job.originalSource = source;
        if (job.repairedUrl) URL.revokeObjectURL(job.repairedUrl);
        job.source = candidate;
        job.meta = verified.meta;
        job.repaired = true;
        job.repairedUrl = URL.createObjectURL(new Blob([candidate], { type: 'text/javascript' }));
        resetJobOutput(job);
        job.detail = 'Repaired source ready. Preview the animation, then click Render to export.';
        stage('Repair ready · ' + verified.frames + ' frames checked at ' + selected.width + ' × ' + selected.height + ', ' + selected.fps + ' FPS. ' + String(result.summary).slice(0, 2000));
        committed = true;
        break;
      } catch (error) {
        if (controller.signal.aborted || error.message.includes('changed animation metadata') || error.message.includes('without imports or dynamic code')) throw error;
        diagnostic = error.message;
        if (attempt === 2) throw new Error('Repair did not pass full animation validation. ' + diagnostic);
      }
    }
  } catch (error) {
    stage(controller.signal.aborted ? 'Repair cancelled. Original source kept.' : 'Repair failed · ' + error.message + ' Original source kept.');
  } finally {
    state.repairing = null;
    state.busy = false;
    state.cancelRequested = false;
    updateControls();
    // Restore a usable preview without modifying any original file on disk.
    await loadPreview(job);
    if (committed) $('status').textContent = 'AI repair ready to render';
    $('ai-status').textContent = job.file.name + ' · ' + job.repairMessage;
  }
}

try { $('ai-endpoint').value = localStorage.getItem('canvas-ai-backend') || ''; } catch { /* Storage is optional. */ }
$('ai-endpoint').addEventListener('change', () => {
  try { localStorage.setItem('canvas-ai-backend', $('ai-endpoint').value.trim()); } catch { /* Storage is optional. */ }
});
$('ai-check').addEventListener('click', async () => {
  if (state.busy || state.loading) return;
  try {
    const connection = aiConnection();
    $('ai-check').disabled = true;
    $('ai-connection').textContent = 'Checking backend configuration…';
    const result = await callRepairBackend(connection.endpoint, connection.token, '/health');
    if (!result.ok) throw new Error('The backend is not ready.');
    $('ai-connection').textContent = 'Backend connected · GPT-5.6 Sol configured. API access and billing are checked on the first repair.';
  } catch (error) { $('ai-connection').textContent = error.message; }
  finally { $('ai-check').disabled = state.busy || state.loading; }
});

async function loadPreview(job, initial = false) {
  if (state.busy || state.loading) return;
  pause();
  updateRepairDetails({ repairedCalls: 0 });
  $('canvas-repair-note').textContent = 'Canvas auto-repair is on. Coordinate arrays and point objects are unpacked automatically.';
  if (state.preview) state.preview.dispose();
  state.preview = null;
  state.meta = null;
  state.loading = true;
  $('source-badge').textContent = 'Loading…';
  $('source-badge').classList.remove('loaded');
  state.drawing = false;
  state.pendingTime = null;
  updateControls();
  $('status').textContent = 'Loading animation…';
  $('progress').value = 0;
  try {
    if (!('OffscreenCanvas' in globalThis)) throw new Error('This browser does not support OffscreenCanvas.');
    state.source = await jobSource(job);
    state.fileName = job.file.name;
    state.preview = makeBridge(undefined, job.repaired);
    state.meta = await state.preview.call('load', { source: state.source, fileName: state.fileName }, [], 15000);
    job.meta = state.meta;
    $('animation-title').textContent = state.meta.title;
    $('metadata').textContent = state.meta.width + ' × ' + state.meta.height + ' · ' +
      state.meta.fps + ' FPS · ' + state.meta.duration + ' seconds';
    $('source-badge').textContent = state.jobs.length > 1 ? 'Preview · ' + job.file.name : 'File loaded';
    $('source-badge').classList.add('loaded');
    $('empty-state').hidden = true;
    $('seek').max = state.meta.duration;
    if (initial) $('fps').value = ['24', '25', '30', '50', '60'].includes(String(state.meta.fps)) ?
      String(state.meta.fps) : '30';
    const nativeProfile = profileForDimensions(state.meta.width, state.meta.height);
    $('resolution').querySelector('[value="native"]').disabled = state.jobs.length > 1 || !nativeProfile;
    if (initial) {
      if ($('resolution').value === 'native' && nativeProfile && state.jobs.length === 1) updateResolutionMode();
      else updateBitrateMode();
    }
    $('stage').style.aspectRatio = state.meta.width + ' / ' + state.meta.height;
    $('status').textContent = state.jobs.length > 1 ? state.jobs.length + ' files ready to render' : 'Animation ready to export';
    setMessage(state.jobs.length > 1 ? 'One set of export settings applies to every file. Full animation uses each file’s own duration. Choose Render ' + state.jobs.length + ' videos to start the queue.' : 'The preview uses a lower resolution. Your video uses the export settings. For a quick test, choose FFmpeg, 720p, 30 FPS, and 2 seconds.');
    updateEngineNotes();
    const drawn = await draw(Math.min(2, state.meta.duration));
    if (!drawn && job.status === 'pending') {
      job.detail = 'Preview error · ' + $('message').textContent + ' The queue will attempt this file and continue if it fails.';
      queue.update(job);
    }
    updateEstimate();
  } catch (error) {
    if (state.preview) state.preview.dispose();
    state.preview = null;
    state.meta = null;
    if ($('resolution').value === 'native') updateBitrateMode();
    $('animation-title').textContent = job.file.name;
    $('metadata').textContent = 'Preview unavailable.';
    $('status').textContent = 'Unable to load the file';
    $('source-badge').textContent = 'File error';
    setMessage(error.message, true);
    $('empty-state').hidden = false;
    if (job.status === 'pending') {
      job.detail = 'Preview unavailable · ' + error.message;
      queue.update(job);
    }
  } finally { state.loading = false; updateControls(); }
}

$('file').addEventListener('change', async (event) => {
  if (state.busy || state.loading) return;
  const files = Array.from(event.target.files);
  if (!files.length) return;
  event.target.value = '';
  if (files.length > MAX_QUEUE_FILES) {
    setMessage('Select up to ' + MAX_QUEUE_FILES + ' JavaScript files. You selected ' + files.length + '. The current queue has been kept.', true);
    return;
  }
  clearDownload();
  state.jobs = queue.replace(files);
  $('file-label').textContent = files.length === 1 ? files[0].name : files.length + ' JavaScript files selected';
  if (files.length > 1 && $('resolution').value === 'native') updateBitrateMode();
  $('resolution').querySelector('[value="native"]').disabled = true;
  updateEngineNotes();
  $('frame-stat').textContent = '0 frames';
  $('speed-stat').textContent = '—';
  $('eta-stat').textContent = '—';
  $('encoding-details').textContent = '';
  await loadPreview(state.jobs[0], true);
});

$('play').addEventListener('click', () => {
  if (state.playing) { pause(); return; }
  if (state.time >= state.meta.duration) state.time = 0;
  state.originTime = state.time;
  state.origin = performance.now();
  state.playing = true;
  $('play').textContent = 'Ⅱ';
  state.raf = requestAnimationFrame(tick);
});
$('seek').addEventListener('input', () => { pause(); void draw(Number($('seek').value)); });
function updateEngineNotes() {
  const isFfmpeg = $('engine').value === 'ffmpeg';
  const batch = state.jobs.length > 1;
  const diskOption = $('save-mode').querySelector('[value="disk"]');
  diskOption.textContent = batch ? 'Save all videos to a folder' : 'Choose a save location';
  diskOption.disabled = batch ? !directoryAvailable : !diskAvailable;
  if (diskOption.disabled && $('save-mode').value === 'disk') $('save-mode').value = 'download';
  $('save-mode').querySelector('[value="download"]').textContent = batch ? 'Download each completed video' : 'Download when complete';
  $('engine-note').textContent = isFfmpeg ?
    'The video bitrate is verified against your selected range before saving.' :
    'Faster encoding. The actual bitrate may be much lower than your target.';
  $('bitrate-note').textContent = isFfmpeg ?
    'H.264 filler maintains the target bitrate when needed. It increases file size without adding visual detail.' :
    'Your target is sent to the browser encoder. The result depends on the encoder and animation.';
  $('storage-note').textContent = batch ?
    'Download each result from its row, or choose one folder when supported. Encoding uses memory; each output is limited to approximately 500 MB.' :
    'Encoding uses memory even when choosing a save location. Output is limited to approximately 500 MB.';
  updateEstimate();
}
$('settings').addEventListener('input', updateEstimate);
$('engine').addEventListener('change', updateEngineNotes);
$('bitrate-mode').addEventListener('change', () => updateBitrateMode());
$('resolution').addEventListener('change', updateResolutionMode);
$('random-bitrate').addEventListener('click', randomizeBitrate);

function renderStatus(text, job = state.currentJob) {
  $('status').textContent = job && state.jobs.length > 1 ?
    (job.index + 1) + ' / ' + state.jobs.length + ' · ' + text : text;
}

function onProgress(data, job) {
  if (!state.busy || state.currentJob !== job || state.cancelRequested) return;
  updateRepairDetails(data.canvasRepair);
  if (Number.isFinite(data.targetBitrate) && state.activeSettings) {
    $('bitrate').value = (data.targetBitrate / 1_000_000).toFixed(3);
    $('encoding-details').textContent = encodingDetails(state.activeSettings, data.targetBitrate);
  }
  if (data.event === 'phase') {
    const stages = { loading: 'Loading FFmpeg…', frames: 'Preparing animation frames…',
      encoding: 'Encoding video with FFmpeg…', checking: 'Checking the video…' };
    const stage = stages[data.phase] || 'Rendering…';
    renderStatus(stage, job);
    job.detail = stage;
    queue.update(job);
    if (data.phase === 'encoding') $('progress').value = 35;
    if (data.phase === 'checking') $('progress').value = 98;
    setMessage(data.message);
    return;
  }
  if (data.event === 'finalizing') {
    renderStatus('Finalizing the video…', job);
    $('progress').value = 99;
    return;
  }
  const rate = data.elapsed > 0 ? data.frame / data.elapsed : 0;
  $('progress').value = Math.min(99, data.progress ?? 99 * data.frame / data.total);
  $('frame-stat').textContent = data.frame + ' / ' + data.total + ' frames';
  $('speed-stat').textContent = (data.phase === 'frames' ? 'Frames: ' : 'Encoding: ') + rate.toFixed(1) + ' frames/sec';
  $('eta-stat').textContent = (data.phase ? 'Stage remaining ≈ ' : 'Remaining ≈ ') + durationText(rate > 0 ? (data.total - data.frame) / rate : Infinity);
}

function encodingDetails(s, target = s.bitrate) {
  const profile = getBitrateProfile(s.bitrateMode);
  return 'FFmpeg / x264 · ' + profile.label + ' · allowed ' + profile.minMbps + '–' + profile.maxMbps +
    ' Mbps · target ' + (target / 1_000_000).toFixed(3) + ' Mbps · ' + s.width + ' × ' + s.height + ' · ' + s.fps + ' FPS';
}

function checkCancelled() {
  if (state.cancelRequested) throw new DOMException('Render cancelled.', 'AbortError');
}

async function prepareJob(job) {
  const source = await jobSource(job);
  checkCancelled();
  if (!job.meta) {
    const bridge = makeBridge(undefined, job.repaired);
    state.preparing = bridge;
    try { job.meta = await bridge.call('load', { source, fileName: job.file.name }, [], 15000); }
    finally {
      bridge.dispose();
      if (state.preparing === bridge) state.preparing = null;
    }
  }
  checkCancelled();
  return source;
}

let createdOutput = null;
async function abortSave() {
  const stream = state.fileStream;
  state.fileStream = null;
  if (stream) { try { await stream.abort(); } catch { /* Already closed or aborted. */ } }
  const output = createdOutput;
  createdOutput = null;
  if (output) { try { await output.directory.removeEntry(output.name); } catch { /* No incomplete file remains. */ } }
}

async function folderOutput(directory, name, usedNames) {
  // Only create a file after video verification. Existing files are never replaced.
  while (true) {
    checkCancelled();
    const candidate = uniqueOutputName(name, usedNames);
    try { await directory.getFileHandle(candidate); }
    catch (error) {
      if (error.name === 'TypeMismatchError') continue;
      if (error.name !== 'NotFoundError') throw error;
      checkCancelled();
      const handle = await directory.getFileHandle(candidate, { create: true });
      createdOutput = { directory, name: candidate };
      checkCancelled();
      return { handle, name: candidate };
    }
  }
}

async function renderJob(job, preferences, bitrate, directory, diskNames) {
  state.currentJob = job;
  job.status = 'rendering';
  job.detail = 'Loading animation…';
  queue.update(job);
  $('progress').value = 0;
  $('frame-stat').textContent = '0 frames';
  $('speed-stat').textContent = '—';
  $('eta-stat').textContent = '—';
  updateRepairDetails({ repairedCalls: 0 });
  $('bitrate').value = (bitrate / 1_000_000).toFixed(3);
  renderStatus('Loading animation…', job);
  try {
    const source = await prepareJob(job);
    const s = settingsFor(job.meta, preferences, bitrate);
    state.activeSettings = s;
    state.lastRenderBitrate = bitrate;
    $('encoding-details').textContent = encodingDetails(s);
    if (s.bitrate * s.duration / 8 > 500_000_000) {
      throw new Error('The estimated FFmpeg output exceeds 500 MB. Reduce the duration or select a lower-resolution bitrate mode.');
    }
    checkCancelled();
    const exporter = makeFfmpegBridge(() => makeBridge(undefined, job.repaired), data => {
      if (state.exporting === exporter) onProgress(data, job);
    });
    state.exporting = exporter;
    renderStatus('Rendering ' + s.format.toUpperCase() + '…', job);
    setMessage(job.file.name + ' · ' + s.width + ' × ' + s.height + ' · ' + s.fps + ' FPS · ' +
      s.duration + ' seconds. Rendering runs on this device.');
    const result = await exporter.call('export', { source, fileName: job.file.name, settings: s });
    checkCancelled();
    if (result.engine !== 'ffmpeg' || !result.bitrateVerified || !bitrateInProfile(result.videoBitrate, s.bitrateMode) || !bitrateHasNonRoundKbps(result.videoBitrate)) {
      throw new Error('The video bitrate did not pass the selected Auto Random range. No output file was saved.');
    }
    $('bitrate').value = (result.targetBitrate / 1_000_000).toFixed(3);
    state.lastRenderBitrate = result.targetBitrate;
    $('encoding-details').textContent = encodingDetails(s, result.targetBitrate);
    if (directory) {
      const output = await folderOutput(directory, job.outputName, diskNames);
      job.outputName = output.name;
      state.fileStream = await output.handle.createWritable();
      checkCancelled();
    }
    if (state.fileStream) {
      renderStatus('Saving the video…', job);
      await state.fileStream.write(new Uint8Array(result.buffer));
      checkCancelled();
      await state.fileStream.close();
      state.fileStream = null;
      createdOutput = null;
      result.savedToDisk = true;
    } else {
      job.downloadUrl = URL.createObjectURL(new Blob([result.buffer], { type: result.mime }));
    }
    updateRepairDetails(result.canvasRepair);
    const profile = getBitrateProfile(s.bitrateMode);
    const bitrateText = 'video bitrate ≈ ' + (result.videoBitrate / 1_000_000).toFixed(3) + ' Mbps';
    job.status = 'completed';
    job.detail = sizeText(result.bytes) + ' · ' + result.duration + ' s · ' + result.frames + ' frames · ' + bitrateText +
      ' · verified ' + profile.minMbps + '–' + profile.maxMbps + ' Mbps · target ' + (result.targetBitrate / 1_000_000).toFixed(3) + ' Mbps' +
      (result.savedToDisk ? ' · Saved as ' + job.outputName : '');
    // Keep output statistics and a Blob URL, without retaining a second copy of the video buffer.
    job.result = { bytes: result.bytes, duration: result.duration, frames: result.frames,
      videoBitrate: result.videoBitrate, targetBitrate: result.targetBitrate, savedToDisk: result.savedToDisk };
    queue.update(job);
    $('progress').value = 100;
    renderStatus('Video complete', job);
    $('frame-stat').textContent = result.frames + ' frames · ' + result.duration + ' seconds';
    $('speed-stat').textContent = 'Completed in ' + durationText(result.elapsed);
    $('eta-stat').textContent = sizeText(result.bytes);
    setMessage(job.outputName + ' · ' + bitrateText + '. Verified within ' + profile.minMbps + '–' + profile.maxMbps +
      ' Mbps. ' + (result.savedToDisk ? 'Saved to your chosen location.' : 'Download your video below.'));
    if (state.jobs.length === 1 && job.downloadUrl) {
      $('download').href = job.downloadUrl;
      $('download').download = job.outputName;
      $('download').hidden = false;
    }
  } catch (error) {
    await abortSave();
    if (state.cancelRequested) {
      job.status = 'cancelled';
      job.detail = 'Render cancelled. No partial video is available.';
    } else {
      job.status = 'failed';
      job.detail = error.message || String(error);
    }
    queue.update(job);
    if (state.jobs.length === 1) {
      $('status').textContent = state.cancelRequested ? 'Render cancelled' : 'Export failed';
      setMessage(state.cancelRequested ? 'Your settings are ready. You can try again.' : job.detail, !state.cancelRequested);
    }
  } finally {
    if (state.exporting) state.exporting.dispose();
    state.exporting = null;
    state.activeSettings = null;
    state.currentJob = null;
  }
}

$('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.jobs.length || state.busy || state.loading) return;
  pause();
  let preferences;
  try {
    randomizeBitrate();
    preferences = exportPreferences();
  } catch (error) { setMessage(error.message, true); return; }
  state.busy = true;
  state.cancelRequested = false;
  clearDownload();
  queue.reset();
  const usedOutputNames = new Set();
  for (const job of state.jobs) job.outputName = uniqueOutputName(outputFileName(job.file.name, preferences), usedOutputNames);
  updateControls();
  $('progress').value = 0;
  $('status').textContent = state.jobs.length > 1 ? 'Preparing render queue…' : 'Preparing export…';
  $('encoding-details').textContent = encodingDetails(preferences);
  const started = performance.now();
  const usedBitrates = new Set([preferences.bitrate]);
  let directory = null;
  try {
    // Open the picker while this click still has user activation, once per queue.
    if (preferences.saveMode === 'disk') {
      if (state.jobs.length > 1) {
        directory = await showDirectoryPicker({ mode: 'readwrite' });
        checkCancelled();
      } else {
        const handle = await showSaveFilePicker({
          suggestedName: state.jobs[0].outputName,
          types: [{ description: preferences.format.toUpperCase() + ' video',
            accept: { [preferences.format === 'mov' ? 'video/quicktime' : 'video/mp4']: ['.' + preferences.format] } }],
        });
        checkCancelled();
        state.fileStream = await handle.createWritable();
        checkCancelled();
      }
    }
    const diskNames = new Set();
    for (const job of state.jobs) {
      checkCancelled();
      const bitrate = job.index === 0 ? preferences.bitrate :
        randomBitrate(preferences.bitrateMode, [...usedBitrates, state.lastRenderBitrate]);
      usedBitrates.add(bitrate);
      await renderJob(job, preferences, bitrate, directory, diskNames);
      checkCancelled();
    }
    if (state.jobs.length > 1) {
      const completed = state.jobs.filter(job => job.status === 'completed');
      const failed = state.jobs.filter(job => job.status === 'failed').length;
      $('progress').value = 100;
      $('status').textContent = 'Batch complete · ' + completed.length + ' completed · ' + failed + ' failed';
      $('frame-stat').textContent = completed.length + ' / ' + state.jobs.length + ' files completed';
      $('speed-stat').textContent = 'Completed in ' + durationText((performance.now() - started) / 1000);
      $('eta-stat').textContent = sizeText(completed.reduce((sum, job) => sum + job.result.bytes, 0));
      setMessage((directory ? 'Completed videos were saved to your chosen folder.' : 'Download completed videos from their rows below.') +
        (failed ? ' Failed files show their error messages and can be corrected before rendering again.' : ' Every video passed the selected bitrate range.'));
    }
  } catch (error) {
    const cancelled = state.cancelRequested || error.name === 'AbortError';
    if (cancelled) {
      for (const job of state.jobs) {
        if (job.status === 'pending' || job.status === 'rendering') {
          job.status = 'cancelled';
          job.detail = 'Queue cancelled. This file was not completed.';
          queue.update(job);
        }
      }
    }
    $('status').textContent = cancelled ? (state.jobs.length > 1 ? 'Queue cancelled' : 'Render cancelled') : 'Unable to start the render';
    setMessage(cancelled ? 'Completed videos remain available below. Click Render to restart the selected files.' : error.message, !cancelled);
  } finally {
    await abortSave();
    if (state.preparing) state.preparing.dispose();
    if (state.exporting) state.exporting.dispose();
    state.preparing = null;
    state.exporting = null;
    state.currentJob = null;
    state.activeSettings = null;
    state.busy = false;
    updateControls();
  }
});

$('cancel').addEventListener('click', () => {
  if (!state.busy) return;
  state.cancelRequested = true;
  if (state.repairing) state.repairing.abort();
  if (state.preparing) state.preparing.dispose();
  if (state.exporting) state.exporting.dispose();
  $('cancel').disabled = true;
});

window.addEventListener('beforeunload', (event) => {
  if (state.busy) { event.preventDefault(); event.returnValue = ''; }
});
updateEngineNotes();
updateBitrateMode();
updateControls();
