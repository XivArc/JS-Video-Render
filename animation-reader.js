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
    exportSettings: typeof exportSettings !== 'undefined' ? exportSettings : undefined,
    EXPORT_SETTINGS: typeof EXPORT_SETTINGS !== 'undefined' ? EXPORT_SETTINGS : undefined,
    width: typeof width !== 'undefined' ? width : typeof WIDTH !== 'undefined' ? WIDTH : typeof W !== 'undefined' ? W : undefined,
    height: typeof height !== 'undefined' ? height : typeof HEIGHT !== 'undefined' ? HEIGHT : typeof H !== 'undefined' ? H : undefined,
    fps: typeof fps !== 'undefined' ? fps : typeof FPS !== 'undefined' ? FPS : undefined,
    duration: typeof duration !== 'undefined' ? duration : typeof DURATION !== 'undefined' ? DURATION : typeof DURATION_SECONDS !== 'undefined' ? DURATION_SECONDS : undefined,
  };
}

const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const fields = ['width', 'height', 'fps', 'duration'];

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
    if (target || /^duration\s*:/i.test(line)) {
      const match = line.match(/(?:^|[^\w.+-])(-?\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
      if (match) add('duration', match[1]);
    }
  }
  return values;
}

function resolveAnimation(imported, common, captured, previewDefaults, header) {
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
    captured.exportSettings, captured.EXPORT_SETTINGS, captured.config, captured.CONFIG, owner, fn, captured].filter(isObject);
  const m = {}, defaulted = [], recovered = [];
  for (const key of ['id', 'title', 'targetVideoBitrate', ...fields]) {
    const aliases = key === 'fps' ? ['fps', 'frameRate'] : key === 'duration' ? ['duration', 'durationSeconds'] : [key];
    let found = false;
    for (const item of sources) {
      for (const name of aliases) {
        if (item[name] !== undefined) { m[key] = item[name]; found = true; break; }
      }
      if (found) break;
    }
    if (!found && fields.includes(key) && header[key].length) {
      if (header[key].length > 1) throw new Error('Conflicting source header metadata for ' + key + '. Provide one export target or explicit animation metadata.');
      m[key] = header[key][0]; found = true; recovered.push(key);
    }
    if (!found && fields.includes(key) && previewDefaults?.[key] !== undefined) {
      m[key] = previewDefaults[key]; defaulted.push(key);
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
  return { animation, reader: { api, defaulted, header: recovered } };
}

export async function readAnimation(source, repair, fileName, previewDefaults) {
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
    return resolveAnimation(imported, common, globalThis[key] || {}, previewDefaults || common.__canvasPreviewDefaults, sourceHeaderMetadata(source));
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
