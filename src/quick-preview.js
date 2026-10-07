import { sourceForQuickRender } from './animation-reader.js';

export const PREVIEW_TABS_HTML = '<div class="preview-tabs" role="tablist" aria-label="Preview source"><button id="preview-files-tab" type="button" role="tab" aria-selected="true" aria-controls="preview-files-content">Animation files</button><button id="quick-preview-tab" type="button" role="tab" aria-selected="false" aria-controls="quick-preview-content" tabindex="-1">Quick Preview <span>LIVE</span></button></div>';

export const QUICK_PREVIEW_HTML = [
  '<section id="quick-preview-content" role="tabpanel" aria-labelledby="quick-preview-tab" hidden>',
  '<div id="quick-stage" class="stage"><canvas id="quick-canvas" width="960" height="540" aria-label="Pasted JavaScript animation preview"></canvas><div id="quick-empty" class="empty-state"><span class="quick-code-symbol" aria-hidden="true">&lt;/&gt;</span><h3 id="quick-empty-title">PASTE CODE.<br>SEE IT MOVE.</h3><p id="quick-empty-note">Paste your complete Canvas JavaScript below. Motion starts automatically.</p></div></div>',
  '<div class="playback quick-playback"><button id="quick-play" class="icon-button" type="button" disabled aria-label="Play preview">▶</button><input id="quick-seek" aria-label="Quick Preview time" type="range" min="0" max="20" step="0.01" value="0" disabled><span id="quick-time" class="time">0.00 / 0.00 s</span></div>',
  '<div class="quick-meta"><span id="quick-metadata">Local Canvas preview · no video encoding</span><label><input id="quick-loop" type="checkbox" checked>Loop preview</label></div>',
  '<div class="quick-terminal"><div class="quick-terminal-heading"><span class="terminal-dots" aria-hidden="true"><i></i><i></i><i></i></span><label for="quick-code">quick-preview.js</label><span id="quick-code-count">0 lines · 0 KB</span></div><textarea id="quick-code" aria-label="Canvas JavaScript code" aria-describedby="quick-editor-note quick-status" placeholder="// Paste your complete Canvas .js code here…" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" maxlength="5000000"></textarea></div>',
  '<div class="quick-actions"><div><button id="quick-example" class="secondary-button" type="button">Load example</button><button id="quick-restart" class="secondary-button" type="button" disabled>Restart preview</button><button id="quick-clear" class="secondary-button" type="button" disabled>Clear</button></div><button id="quick-use" class="quick-use-button" type="button" disabled>Use for render <span aria-hidden="true">↗</span></button></div>',
  '<p id="quick-status" class="quick-status" role="status" aria-live="polite">Paste code to start. Preview updates automatically after editing.</p>',
  '<p id="quick-editor-note" class="quick-note">Preview runs on this device. Use for render makes this code the single file in the render queue. Code stays in this tab until you submit a cloud render.</p>',
  '<details class="quick-api"><summary>Supported Canvas code</summary><p>Paste a complete drawing function; exports are optional. Detected: <code>meta + render(ctx, seconds, width, height)</code>, <code>meta + drawFrame(canvas, seconds)</code>, or <code>draw(ctx, seconds, width, height)</code>, including named exports and <code>module.exports</code>/<code>exports</code>. Metadata can be in <code>meta</code>, <code>metadata</code>, <code>draw.meta</code>, or Canvas constants/config. Missing values use Export settings; Full animation defaults to 20 seconds. Use trusted, self-contained Canvas code. Ctrl + Enter restarts the preview.</p></details>',
  '</section>',
].join('\n');

export const QUICK_PREVIEW_EXAMPLE = `// A self-contained Canvas animation. Time is in seconds.
function draw(ctx, seconds, width, height) {
  const phase = (seconds % 10) / 10;
  const pulse = (1 - Math.cos(phase * Math.PI * 2)) / 2;
  const scale = Math.min(width / 1280, height / 720);
  ctx.save();
  ctx.fillStyle = '#10121e';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#405074';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -25, 125, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.rotate(phase * Math.PI * 2);
  ctx.fillStyle = '#a77bff';
  ctx.beginPath(); ctx.arc(0, -150, 15, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#4ee5d4';
  const radius = 52 + pulse * 20;
  ctx.beginPath(); ctx.arc(0, -25, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eef2ff';
  ctx.textAlign = 'center'; ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Quick Preview', 0, 190);
  ctx.fillStyle = '#929dbb'; ctx.font = '18px sans-serif';
  ctx.fillText('CANVAS 2D / JAVASCRIPT', 0, 225);
  ctx.restore();
}
draw.meta = { title: 'Quick Preview example', width: 1280, height: 720, fps: 30, duration: 10 };
module.exports = draw;
`;

export function makeQuickPreview({ makeBridge, onModeChange, onUse, readDefaults }) {
  const $ = id => document.getElementById(id);
  const editor = $('quick-code');
  const state = { active: false, bridge: null, revision: 0, timer: 0, raf: 0, meta: null,
    ready: false, playing: false, drawing: false, pendingTime: null, time: 0, origin: 0, originTime: 0,
    lastFrameAt: -Infinity, source: '', bytes: 0, editingBlocked: false, useBlocked: false };

  function status(text, error = false) {
    $('quick-status').textContent = String(text).slice(0, 5000);
    $('quick-status').classList.toggle('error', error);
    $('quick-status').dataset.state = error ? 'error' : state.ready ? 'ready' : editor.value.trim() ? 'loading' : 'empty';
  }
  function overlay(title, note) {
    $('quick-empty').hidden = false;
    $('quick-empty-title').textContent = title;
    $('quick-empty-note').textContent = note;
  }
  function controls() {
    editor.readOnly = state.editingBlocked;
    $('quick-preview-tab').disabled = state.editingBlocked;
    for (const id of ['quick-example', 'quick-clear', 'quick-restart']) {
      $(id).disabled = state.editingBlocked || (id !== 'quick-example' && !editor.value.trim());
    }
    $('quick-play').disabled = state.editingBlocked || !state.ready;
    $('quick-seek').disabled = state.editingBlocked || !state.ready;
    $('quick-use').disabled = state.useBlocked || state.editingBlocked || !state.ready || state.source !== editor.value;
    $('quick-play').textContent = state.playing ? 'Ⅱ' : '▶';
    $('quick-play').setAttribute('aria-label', state.playing ? 'Pause preview' : 'Play preview');
  }
  function pause() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    controls();
  }
  function stop() {
    state.revision++;
    clearTimeout(state.timer);
    pause();
    state.bridge?.dispose();
    state.bridge = null;
    state.meta = null;
    state.ready = false;
    state.drawing = false;
    state.pendingTime = null;
    state.source = '';
    controls();
  }
  function current(revision, bridge) {
    return state.active && revision === state.revision && bridge === state.bridge;
  }
  function failure(error, revision, bridge) {
    if (!current(revision, bridge)) return;
    stop();
    overlay('PREVIEW STOPPED', 'Fix the code below. Preview reloads automatically after editing.');
    status(error.message || String(error), true);
  }
  async function frame(time, revision = state.revision, bridge = state.bridge) {
    if (!state.meta || !current(revision, bridge)) return false;
    if (state.drawing) { state.pendingTime = time; return false; }
    state.drawing = true;
    const scale = Math.min(960 / state.meta.width, 540 / state.meta.height, 1);
    const width = Math.max(1, Math.round(state.meta.width * scale));
    const height = Math.max(1, Math.round(state.meta.height * scale));
    try {
      const result = await bridge.call('draw', { width, height, time }, [], 2000);
      if (!current(revision, bridge)) { result.bitmap.close(); return false; }
      const canvas = $('quick-canvas');
      try {
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        canvas.getContext('2d').drawImage(result.bitmap, 0, 0);
      } finally { result.bitmap.close(); }
      $('quick-stage').style.aspectRatio = width + ' / ' + height;
      state.time = time;
      $('quick-seek').value = time;
      $('quick-time').textContent = time.toFixed(2) + ' / ' + state.meta.duration.toFixed(2) + ' s';
      return true;
    } catch (error) { failure(error, revision, bridge); return false; }
    finally {
      if (current(revision, bridge)) {
        state.drawing = false;
        if (state.pendingTime !== null) {
          const nextTime = state.pendingTime;
          state.pendingTime = null;
          void frame(nextTime, revision, bridge);
        }
      }
    }
  }
  function tick(now) {
    if (!state.active || !state.playing || !state.ready) return;
    const duration = state.meta.duration;
    let time = state.originTime + (now - state.origin) / 1000;
    const ended = time >= duration && !$('quick-loop').checked;
    time = ended ? duration : time % duration;
    if (!state.drawing && (ended || now - state.lastFrameAt >= 1000 / Math.min(60, state.meta.fps))) {
      state.lastFrameAt = now;
      void frame(time);
    }
    if (ended) { pause(); return; }
    state.raf = requestAnimationFrame(tick);
  }
  function play() {
    if (!state.active || !state.ready || state.editingBlocked) return;
    if (state.time >= state.meta.duration) state.time = 0;
    state.originTime = state.time;
    state.origin = performance.now();
    state.lastFrameAt = -Infinity;
    state.playing = true;
    controls();
    state.raf = requestAnimationFrame(tick);
  }
  async function load(revision, source) {
    if (!state.active || state.editingBlocked || revision !== state.revision) return;
    const bridge = makeBridge();
    state.bridge = bridge;
    status('Loading Canvas code…');
    try {
      const meta = await bridge.call('load', { source, fileName: 'quick-preview.js', restrictedContext: 'Quick Preview', previewDefaults: readDefaults() }, [], 4000);
      if (!current(revision, bridge)) return;
      state.meta = meta;
      state.time = 0;
      $('quick-seek').max = meta.duration;
      if (!await frame(0, revision, bridge) || !current(revision, bridge)) return;
      state.ready = true;
      state.source = source;
      $('quick-empty').hidden = true;
      $('quick-metadata').textContent = meta.title + ' · ' + meta.width + ' × ' + meta.height + ' · ' + meta.fps + ' FPS · ' + meta.duration + ' s';
      const defaults = meta.reader?.defaulted || [];
      status(defaults.length ? 'Preview ready · ' + meta.reader.api + ' detected. Missing ' + defaults.join(', ') + ' use Export settings (Full animation defaults to 20 s). Values are included when you use this code for render.' : 'Preview ready · ' + meta.reader.api + ' detected. Motion starts automatically.');
      controls();
      play();
    } catch (error) { failure(error, revision, bridge); }
  }
  function schedule(immediate = false) {
    stop();
    const source = editor.value;
    state.bytes = new TextEncoder().encode(source).length;
    const lines = source ? source.split('\n').length : 0;
    $('quick-code-count').textContent = lines + ' line' + (lines === 1 ? '' : 's') + ' · ' + (state.bytes / 1000).toFixed(1) + ' KB';
    $('quick-metadata').textContent = 'Local Canvas preview · no video encoding';
    $('quick-time').textContent = '0.00 / 0.00 s';
    $('quick-seek').value = 0;
    if (!source.trim()) {
      overlay('PASTE CODE. SEE IT MOVE.', 'Paste your complete Canvas JavaScript below. Motion starts automatically.');
      status('Paste code to start. Preview updates automatically after editing.');
      return;
    }
    if (state.bytes > 5_000_000) {
      overlay('CODE IS TOO LARGE', 'Use Canvas JavaScript up to 5 MB.');
      status('Quick Preview supports up to 5 MB of JavaScript.', true);
      return;
    }
    overlay('UPDATING PREVIEW', 'Reading the latest Canvas code…');
    status('Waiting for your latest edit…');
    if (state.active && !state.editingBlocked) {
      const revision = state.revision;
      state.timer = setTimeout(() => void load(revision, source), immediate ? 0 : 450);
    }
  }
  function showFiles() {
    if (!state.active) return;
    state.active = false;
    stop();
    $('quick-preview-content').hidden = true;
    $('preview-files-content').hidden = false;
    $('quick-preview-tab').setAttribute('aria-selected', 'false');
    $('quick-preview-tab').tabIndex = -1;
    $('preview-files-tab').setAttribute('aria-selected', 'true');
    $('preview-files-tab').tabIndex = 0;
    onModeChange(false);
  }
  function showEditor() {
    if (state.active || state.editingBlocked) return;
    state.active = true;
    $('quick-preview-content').hidden = false;
    $('preview-files-content').hidden = true;
    $('quick-preview-tab').setAttribute('aria-selected', 'true');
    $('quick-preview-tab').tabIndex = 0;
    $('preview-files-tab').setAttribute('aria-selected', 'false');
    $('preview-files-tab').tabIndex = -1;
    onModeChange(true);
    schedule(true);
  }

  $('preview-files-tab').addEventListener('click', showFiles);
  $('quick-preview-tab').addEventListener('click', showEditor);
  document.querySelector('.preview-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || (state.active && event.key !== 'End')) { showFiles(); $('preview-files-tab').focus(); }
    else if (!state.editingBlocked) { showEditor(); $('quick-preview-tab').focus(); }
  });
  editor.addEventListener('input', () => schedule());
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!state.editingBlocked) schedule(true); }
  });
  $('quick-example').addEventListener('click', () => { editor.value = QUICK_PREVIEW_EXAMPLE; schedule(true); });
  $('quick-clear').addEventListener('click', () => { editor.value = ''; schedule(); editor.focus(); });
  $('quick-restart').addEventListener('click', () => schedule(true));
  $('quick-play').addEventListener('click', () => state.playing ? pause() : play());
  $('quick-seek').addEventListener('input', () => { pause(); void frame(Number($('quick-seek').value)); });
  $('quick-use').addEventListener('click', async () => {
    if ($('quick-use').disabled) return;
    try { await onUse(sourceForQuickRender(state.source, state.meta)); }
    catch (error) { status(error.message || String(error), true); }
  });
  controls();
  return {
    get active() { return state.active; },
    showFiles,
    settingsChanged() {
      if (state.active && editor.value.trim() && !state.editingBlocked &&
          (!state.meta || state.meta.reader?.defaulted?.length)) schedule(true);
    },
    setBlocked({ editing, using }) {
      const changed = state.editingBlocked !== editing;
      state.editingBlocked = editing;
      state.useBlocked = using;
      if (changed && editing) {
        stop();
        if (state.active) { overlay('PREVIEW PAUSED', 'Finish the current local operation to continue editing.'); status('Preview paused during the current local operation.'); }
      } else if (changed && state.active && editor.value.trim()) schedule(true);
      controls();
    },
  };
}
