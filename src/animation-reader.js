import { parseSourceDuration } from './duration-settings.js';

// Appended inside the animation module to see const/let bindings as well as
// globals. The source's drawing code and line numbers stay unchanged.
function captureBindings() {
  return {
    draw: typeof draw === 'function' ? draw : undefined,
    render: typeof render === 'function' ? render : undefined,
    drawFrame: typeof drawFrame === 'function' ? drawFrame : undefined,
    animation: typeof animation !== 'undefined' ? animation : undefined,
    meta: typeof meta !== 'undefined' ? meta : undefined,
    metadata: typeof metadata !== 'undefined' ? metadata : undefined,
    META: typeof META !== 'undefined' ? META : undefined,
    config: typeof config !== 'undefined' ? config : undefined,
    CONFIG: typeof CONFIG !== 'undefined' ? CONFIG : undefined,
    settings: typeof settings !== 'undefined' ? settings : undefined,
    SETTINGS: typeof SETTINGS !== 'undefined' ? SETTINGS : undefined,
    timing: typeof timing !== 'undefined' ? timing : undefined,
    TIMING: typeof TIMING !== 'undefined' ? TIMING : undefined,
    exportSettings: typeof exportSettings !== 'undefined' ? exportSettings : undefined,
    EXPORT_SETTINGS: typeof EXPORT_SETTINGS !== 'undefined' ? EXPORT_SETTINGS : undefined,
    width: typeof width !== 'undefined' ? width : typeof WIDTH !== 'undefined' ? WIDTH : typeof W !== 'undefined' ? W : undefined,
    height: typeof height !== 'undefined' ? height : typeof HEIGHT !== 'undefined' ? HEIGHT : typeof H !== 'undefined' ? H : undefined,
    fps: typeof fps !== 'undefined' ? fps : typeof FPS !== 'undefined' ? FPS : typeof FRAME_RATE !== 'undefined' ? FRAME_RATE : typeof frameRate !== 'undefined' ? frameRate : undefined,
    duration: typeof duration !== 'undefined' ? duration : typeof DURATION !== 'undefined' ? DURATION :
      typeof DURATION_SECONDS !== 'undefined' ? DURATION_SECONDS : typeof DURATION_SEC !== 'undefined' ? DURATION_SEC :
      typeof durationSeconds !== 'undefined' ? durationSeconds : typeof durationSec !== 'undefined' ? durationSec :
      typeof TOTAL_DURATION !== 'undefined' ? TOTAL_DURATION : typeof ANIMATION_DURATION !== 'undefined' ? ANIMATION_DURATION :
      typeof totalDuration !== 'undefined' ? totalDuration : typeof animationDuration !== 'undefined' ? animationDuration :
      typeof LOOP_DURATION !== 'undefined' ? LOOP_DURATION : undefined,
    durationMs: typeof DURATION_MS !== 'undefined' ? DURATION_MS : typeof durationMs !== 'undefined' ? durationMs :
      typeof DURATION_MILLISECONDS !== 'undefined' ? DURATION_MILLISECONDS : undefined,
    totalFrames: typeof TOTAL_FRAMES !== 'undefined' ? TOTAL_FRAMES : typeof FRAME_COUNT !== 'undefined' ? FRAME_COUNT :
      typeof totalFrames !== 'undefined' ? totalFrames : typeof frameCount !== 'undefined' ? frameCount : undefined,
  };
}

const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const fields = ['width', 'height', 'fps', 'duration'];

// Output duration never becomes source duration. Missing source timing is
// always 20 seconds, including when a short test/fitted output is selected.
export function animationDefaults(settings = {}) {
  return {
    width: settings.width ?? 1920, height: settings.height ?? 1080,
    fps: settings.fps ?? 30,
    duration: 20,
  };
}

// Only leading comments with explicit metadata labels are eligible. This
// excludes drawing coordinates, string literals, and comments inside helpers.
export function sourceHeaderMetadata(source) {
  const text = source.slice(0, 16384), comments = [];
  let offset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < text.length) {
    while (/\s/.test(text[offset] || '') && offset < text.length) offset++;
    if (text.startsWith('//', offset)) {
      const end = text.indexOf('\n', offset);
      comments.push(text.slice(offset + 2, end === -1 ? text.length : end));
      offset = end === -1 ? text.length : end + 1;
    } else if (text.startsWith('/*', offset)) {
      const end = text.indexOf('*/', offset + 2);
      if (end === -1) break;
      comments.push(text.slice(offset + 2, end)); offset = end + 2;
    } else break;
  }
  const values = Object.fromEntries(fields.map(key => [key, []]));
  const add = (key, value) => {
    const number = Number(value);
    if (!values[key].includes(number)) values[key].push(number);
  };
  for (const raw of comments.join('\n').split(/\r?\n/)) {
    const line = raw.trim().replace(/^\*\s?/, '');
    const target = /^(?:(?:native\s+)?(?:video\s+)?export\s+target|(?:native\s+)?render\s+target|animation\s+metadata)\s*:/i.test(line);
    if (target || /^(?:resolution|dimensions|size)\s*:/i.test(line)) {
      const match = line.match(/(?:^|[^\w.+-])(-?\d+(?:\.\d+)?)\s*[x×]\s*(-?\d+(?:\.\d+)?)(?![\d.])/i);
      if (match) { add('width', match[1]); add('height', match[2]); }
    }
    if (target || /^(?:fps|frame\s*rate)\s*:/i.test(line)) {
      const match = line.match(/(?:^|[^\w.+-])(-?\d+(?:\.\d+)?)\s*fps\b/i) ||
        line.match(/^(?:fps|frame\s*rate)\s*:\s*(-?\d+(?:\.\d+)?)(?:\s|$)/i);
      if (match) add('fps', match[1]);
    }
    const durationLabel = line.match(/^(?:(?:total|animation|loop|clip)\s+)?(?:duration|durasi)(?:\s*\((ms|milliseconds?|s|seconds?)\))?\s*[:=]\s*(.+)$/i);
    if (durationLabel) {
      const value = durationLabel[2].split(/[|;·(@,]/)[0].trim();
      let seconds = parseSourceDuration(value, /^m/i.test(durationLabel[1] || ''));
      if (!Number.isFinite(seconds)) {
        const prefix = value.match(/^-?\d+(?:\.\d+)?\s*(?:milliseconds?|msecs?|ms|minutes?|mins?|m|seconds?|secs?|s|detik|menit)\b/i);
        if (prefix) seconds = parseSourceDuration(prefix[0]);
      }
      if (Number.isFinite(seconds)) add('duration', seconds);
      else if (/^-\d/.test(value)) add('duration', NaN);
    } else if (target) {
      const match = line.match(/(?:^|[^\w.+-])(-?\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|detik)\b/i);
      if (match) add('duration', parseSourceDuration(match[1] + match[2]));
    }
  }
  return values;
}

function resolveAnimation(imported, common, captured, metadataDefaults, header) {
  const candidates = [imported.default, imported, common.exports, common.exports?.default,
    ...Object.values(globalThis.SmartHomeAnimations || {}), captured.animation, captured];
  const existing = candidates.find(a => a?.meta && (typeof a.drawFrame === 'function' || typeof a.render === 'function')) ||
    candidates.find(a => typeof a === 'function' && a.meta);
  let owner, fn, api;
  const choose = value => {
    if (!isObject(value)) return false;
    if (typeof value === 'function') { owner = value; fn = value; api = value.name === 'drawFrame' ? 'drawFrame' : value.name === 'render' ? 'render' : 'draw'; return true; }
    for (const name of ['drawFrame', 'render', 'draw']) {
      if (typeof value[name] === 'function') { owner = value; fn = value[name]; api = name; return true; }
    }
    return false;
  };
  if (!choose(existing)) {
    for (const value of candidates) if (choose(value)) break;
  }
  if (!fn) {
    const named = Object.values(imported).filter(value => typeof value === 'function' && value.meta);
    if (named.length === 1) choose(named[0]);
    else if (named.length > 1) throw new Error('Multiple Canvas animation functions were found. Export one as default or name the entry point draw, render, or drawFrame.');
  }
  if (!fn) throw new Error('No animation API was found. Include the complete draw(ctx, seconds, width, height), render(ctx, seconds, width, height), or drawFrame(canvas, seconds) function. Helper functions alone cannot be previewed.');

  const sources = [owner.meta, fn.meta, owner.metadata, fn.metadata,
    imported.meta, imported.metadata, common.exports?.meta, common.exports?.metadata,
    captured.meta, captured.metadata, captured.META,
    owner.exportSettings, fn.exportSettings, owner.config, imported.config,
    captured.exportSettings, captured.EXPORT_SETTINGS, captured.config, captured.CONFIG,
    captured.settings, captured.SETTINGS, captured.timing, captured.TIMING, owner, fn, captured]
    .filter(isObject).flatMap(item => [item, item.timing].filter(isObject));
  const m = {}, defaulted = [], recovered = [], inferred = [];
  for (const key of ['id', 'title', 'targetVideoBitrate', ...fields]) {
    const aliases = key === 'fps' ? ['fps', 'frameRate'] : key === 'duration' ?
      ['duration', 'durationSeconds', 'durationSec', 'durationInSeconds', 'totalDuration', 'animationDuration', 'loopDuration',
        'durationMs', 'durationMilliseconds', 'totalDurationMs'] : [key];
    let found = false;
    for (const item of sources) {
      for (const name of aliases) {
        if (item[name] !== undefined) {
          m[key] = key === 'duration' ? parseSourceDuration(item[name], /Ms$|Milliseconds$/.test(name)) : item[name];
          found = true; break;
        }
      }
      if (found) break;
    }
    if (!found && fields.includes(key) && header[key].length) {
      if (header[key].length > 1) throw new Error('Conflicting source header metadata for ' + key + '. Provide one export target or explicit animation metadata.');
      m[key] = header[key][0]; found = true; recovered.push(key);
    }
    if (!found && key === 'duration' && !defaulted.includes('fps')) {
      for (const item of sources) {
        const frames = item.totalFrames ?? item.frameCount ?? item.durationFrames;
        if (Number.isInteger(frames) && frames > 0) {
          m.duration = frames / m.fps; found = true; inferred.push('duration'); break;
        }
      }
    }
    if (!found && fields.includes(key) && metadataDefaults?.[key] !== undefined) {
      m[key] = metadataDefaults[key]; defaulted.push(key);
    }
  }
  const missing = fields.filter(key => m[key] === undefined);
  if (missing.length) throw new Error('No animation API metadata was found for ' + missing.join(', ') + '. Add meta with width, height, fps, and duration.');
  for (const key of fields) {
    if (!Number.isFinite(m[key]) || m[key] <= 0) throw new Error('Metadata ' + key + ' must be a positive number.');
  }
  if (m.width > 16384 || m.height > 16384 || m.duration > 3600 || m.fps > 240) {
    throw new Error('The animation metadata exceeds the supported limits.');
  }
  const animation = { meta: m };
  if (api === 'drawFrame') animation.drawFrame = (canvas, seconds) => fn.call(owner, canvas, seconds);
  else animation.render = (ctx, seconds, width, height) => fn.call(owner, ctx, seconds, width, height);
  return { animation, reader: { api, defaulted, header: recovered, inferred } };
}

export async function readAnimation(source, repair, fileName, metadataDefaults) {
  if (typeof source !== 'string' || source.length > 5_000_000) throw new Error('The JavaScript file must be smaller than 5 MB.');
  globalThis.SmartHomeAnimations = {};
  const common = { exports: {} }, key = '__canvas_reader_' + crypto.randomUUID();
  const previous = new Map();
  // window is a registry alias in the worker, not a DOM implementation.
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
  for (const [name, value] of [['module', common], ['exports', common.exports]]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const footer = '\n;globalThis[' + JSON.stringify(key) + '] = (' + captureBindings.toString() + ')();\n';
  const url = URL.createObjectURL(new Blob([source, footer], { type: 'text/javascript' }));
  repair.reset(fileName, url);
  try {
    const imported = await import(/* @vite-ignore */ url);
    // Keep the source timing already accepted through Use for render, even if
    // the user subsequently changes output settings. No source file is edited.
    const defaults = { ...metadataDefaults, ...common.__canvasPreviewDefaults };
    return resolveAnimation(imported, common, globalThis[key] || {}, defaults, sourceHeaderMetadata(source));
  } catch (error) {
    if (/document is not defined|Cannot read properties of undefined.*(?:getElementById|querySelector)/.test(error.message)) {
      error.message += ' The Canvas reader needs a drawing function; HTML/DOM setup is not supported in the worker.';
    }
    throw repair.annotate(error);
  } finally {
    URL.revokeObjectURL(url);
    delete globalThis[key];
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

// Carry inferred preview values into later renders so timing stays consistent.
export function sourceForQuickRender(source, meta) {
  if (!meta.reader?.defaulted?.length) return source;
  const values = Object.fromEntries(fields.map(key => [key, meta[key]]));
  const output = source + '\n;module.__canvasPreviewDefaults = ' + JSON.stringify(values) + ';\n';
  if (new TextEncoder().encode(output).length > 5_000_000) throw new Error('The code plus its preview metadata exceeds 5 MB. Shorten the code before rendering.');
  return output;
}
