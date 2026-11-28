// Worker-local Canvas compatibility. Only unpack coordinates that are present.
const METHODS = {
  moveTo: { required: 2 }, lineTo: { required: 2 },
  quadraticCurveTo: { required: 4 }, bezierCurveTo: { required: 6 },
  arcTo: { required: 5 }, rect: { required: 4, rectangle: true },
  fillRect: { required: 4, rectangle: true }, strokeRect: { required: 4, rectangle: true },
  clearRect: { required: 4, rectangle: true },
  arc: { required: 5, direction: true }, ellipse: { required: 7, direction: true },
  translate: { required: 2 }, scale: { required: 2 }, transform: { required: 6 },
};

let installed;

function sequence(value) {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

function unpack(args, spec) {
  const values = [];
  const seen = new Set();
  let packed = false;
  function append(value, depth = 0) {
    if (depth > 4 || values.length > spec.required + 1) return false;
    if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') {
      values.push(value);
      return true;
    }
    if (sequence(value)) {
      if (value.length > spec.required + 1 || seen.has(value)) return false;
      seen.add(value);
      packed = true;
      for (const entry of value) if (!append(entry, depth + 1)) return false;
      seen.delete(value);
      return true;
    }
    if (value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      packed = true;
      values.push(value.x, value.y);
      return true;
    }
    return false;
  }
  if (spec.rectangle && args.length === 1 && args[0] && typeof args[0] === 'object' && !sequence(args[0])) {
    const rectangle = args[0];
    const result = [rectangle.x, rectangle.y, rectangle.width ?? rectangle.w, rectangle.height ?? rectangle.h];
    return result.every(Number.isFinite) ? result : null;
  }
  for (const value of args) if (!append(value)) return null;
  const maximum = spec.required + (spec.direction ? 1 : 0);
  if (!packed || values.length < spec.required || values.length > maximum ||
      !values.slice(0, spec.required).every(Number.isFinite) ||
      (values.length > spec.required && typeof values[spec.required] !== 'boolean')) return null;
  return values;
}

export function installCanvasAutoRepair() {
  if (installed) return installed;
  let sourceName = 'animation.js';
  let sourceUrl = '';
  let repairedCalls = 0;
  const fixes = new Map();

  function location(error) {
    if (!sourceUrl || typeof error?.stack !== 'string') return null;
    const offset = error.stack.indexOf(sourceUrl + ':');
    if (offset < 0) return null;
    const match = error.stack.slice(offset + sourceUrl.length).match(/^:(\d+):(\d+)/);
    return match ? { line: Number(match[1]), column: Number(match[2]) } : null;
  }

  function record(operation) {
    repairedCalls++;
    const existing = fixes.get(operation);
    if (existing) existing.calls++;
    else fixes.set(operation, { operation, calls: 1, firstLocation: location(new Error()) });
  }

  const prototypes = new Set();
  if (typeof OffscreenCanvas !== 'undefined') {
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (context) prototypes.add(Object.getPrototypeOf(context));
  }
  if (typeof CanvasRenderingContext2D !== 'undefined') prototypes.add(CanvasRenderingContext2D.prototype);
  if (typeof Path2D !== 'undefined') prototypes.add(Path2D.prototype);
  for (const prototype of prototypes) {
    for (const [method, spec] of Object.entries(METHODS)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      if (typeof descriptor?.value !== 'function') continue;
      const native = descriptor.value;
      const wrapper = function () {
        // Valid calls go straight to the browser without unpacking or stack capture.
        if (arguments.length >= spec.required) return Reflect.apply(native, this, arguments);
        const coordinates = unpack(arguments, spec);
        if (!coordinates) {
          const error = new TypeError(method + '() requires ' + spec.required +
            ' coordinate values; received ' + arguments.length + ' argument' + (arguments.length === 1 ? '' : 's') +
            '. Auto-repair needs all values in a coordinate array or point object. Missing values cannot be inferred.');
          error.name = 'CanvasArgumentError';
          throw error;
        }
        const result = Reflect.apply(native, this, coordinates);
        record(method);
        return result;
      };
      Object.defineProperty(prototype, method, { ...descriptor, value: wrapper });
    }
  }

  installed = {
    reset(name = 'animation.js', url = '') {
      sourceName = String(name || 'animation.js').slice(0, 200);
      sourceUrl = url;
      repairedCalls = 0;
      fixes.clear();
    },
    report() {
      return { enabled: true, sourceName, repairedCalls,
        fixes: Array.from(fixes.values(), fix => ({ ...fix, firstLocation: fix.firstLocation && { ...fix.firstLocation } })) };
    },
    annotate(error, time) {
      if (error?.name === 'CanvasAnimationError') return error;
      const at = location(error);
      const position = sourceName + (at ? ':' + at.line + ':' + at.column : '');
      const timing = Number.isFinite(time) ? ' at ' + time.toFixed(3) + ' s' : '';
      const annotated = new Error(position + timing + ' · ' + (error?.message || String(error)), { cause: error });
      annotated.name = 'CanvasAnimationError';
      return annotated;
    },
  };
  return installed;
}
