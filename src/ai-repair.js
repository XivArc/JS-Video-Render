export const MAX_AI_SOURCE_BYTES = 250_000;
const metadataKeys = ['width', 'height', 'fps', 'duration', 'id', 'title'];

export function repairEndpoint(value) {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter a valid HTTPS backend URL without credentials, query parameters, or fragments.');
  }
  if (!['', '/', '/repair', '/health'].includes(url.pathname)) throw new Error('Enter the backend root URL, for example https://canvas-ai-repair.example.workers.dev.');
  return url.origin;
}

export function applyRepairEdits(source, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 16) throw new Error('AI could not establish a repair. The original file is unchanged.');
  let next = source;
  for (const edit of edits) {
    if (typeof edit.find !== 'string' || !edit.find || typeof edit.replace !== 'string' || edit.find.length > 65000 || edit.replace.length > 65000) throw new Error('Invalid AI edit.');
    const index = next.indexOf(edit.find);
    if (index < 0 || next.indexOf(edit.find, index + 1) >= 0) throw new Error('AI edit does not match exactly one source location. The original file is unchanged.');
    next = next.slice(0, index) + edit.replace + next.slice(index + edit.find.length);
  }
  if (next === source || new TextEncoder().encode(next).length > MAX_AI_SOURCE_BYTES) throw new Error('AI did not return a usable change within the 250 KB limit.');
  return next;
}

export async function callRepairBackend(endpoint, token, path, payload, signal) {
  if (token.length < 24) throw new Error('Enter your repair access code (at least 24 characters).');
  const timeout = AbortSignal.timeout(120000);
  let response;
  try {
    response = await fetch(repairEndpoint(endpoint) + path, {
      method: payload ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Repair cancelled.', 'AbortError');
    if (timeout.aborted) throw new Error('AI repair timed out. The original file is unchanged.');
    throw new Error('Cannot reach the AI backend. Check its URL, deployment, and ALLOWED_ORIGIN setting.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('The backend did not return JSON. Check its URL and deployment.'); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI backend request failed.');
  if (result.model !== 'gpt-5.6-sol') throw new Error('The backend must use GPT-5.6 Sol.');
  return result;
}

export async function validateAnimation(source, fileName, settings, makeBridge, { signal, expectedMeta, onProgress = () => {}, timeoutMs = 15000 } = {}) {
  // Independent worker per validation. No video encoding or output writes occur here.
  const bridge = makeBridge();
  const cancel = () => bridge.dispose(new DOMException('Repair cancelled.', 'AbortError'));
  signal?.addEventListener('abort', cancel, { once: true });
  let meta;
  try {
    if (signal?.aborted) throw new DOMException('Repair cancelled.', 'AbortError');
    meta = await bridge.call('load', { source, fileName, restricted: true }, [], timeoutMs);
    if (expectedMeta && metadataKeys.some(key => meta[key] !== expectedMeta[key])) {
      throw new Error('The proposed repair changed animation metadata. The original file is unchanged.');
    }
    const total = Math.round(meta.duration * settings.fps);
    if (total < 1 || total > 30000) throw new Error('Full animation validation supports up to 30,000 frames. Reduce source duration before AI repair.');
    for (let start = 0; start < total; start += 16) {
      if (signal?.aborted) throw new DOMException('Repair cancelled.', 'AbortError');
      const count = Math.min(16, total - start);
      await bridge.call('validate-frames', { width: settings.width, height: settings.height, fps: settings.fps, start, count, total }, [], timeoutMs);
      onProgress({ frame: start + count, total });
    }
    return { meta, frames: total, width: settings.width, height: settings.height, fps: settings.fps };
  } catch (error) {
    if (meta) error.animationMeta = meta;
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    bridge.dispose();
  }
}
