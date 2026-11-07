const SAMPLE_FPS = 16;
const TILE_SIZE = 12;
const MAX_SAMPLES = 233;
const MIN_LAG = 8;
const MAX_LAG = 100;

function sampledTiles(frames, width, height) {
  const tiles = [];
  for (let y = 0; y < height; y += TILE_SIZE) {
    for (let x = 0; x < width; x += TILE_SIZE) {
      const w = Math.min(TILE_SIZE, width - x), h = Math.min(TILE_SIZE, height - y);
      const offsets = [];
      // Several samples per tile keep a moving shape distinct from a
      // color average, which can stay constant as an object moves.
      for (let dy = 1; dy < h; dy += 3) {
        for (let dx = 1; dx < w; dx += 3) offsets.push(((y + dy) * width + x + dx) * 4);
      }
      if (!offsets.length) continue;
      const stride = offsets.length * 3;
      const values = new Uint8Array(frames.length * stride);
      let at = 0;
      for (const frame of frames) {
        for (const offset of offsets) {
          values[at++] = frame[offset]; values[at++] = frame[offset + 1]; values[at++] = frame[offset + 2];
        }
      }
      tiles.push({ x, y, w, h, stride, values });
    }
  }
  return tiles;
}

function tileDistance(tile, a, b) {
  let distance = 0;
  for (let i = 0, j = a * tile.stride, k = b * tile.stride; i < tile.stride; i++) {
    distance += Math.abs(tile.values[j + i] - tile.values[k + i]);
  }
  return distance / tile.stride;
}

function findRepeatedTiles(frames, width, height, deadline) {
  const last = frames.length - 1;
  const maximum = Math.min(MAX_LAG, Math.floor(frames.length / 2));
  if (maximum < MIN_LAG) return null;
  const active = sampledTiles(frames, width, height).filter(tile => {
    // Look across a whole possible cycle, including tiles visited by an
    // object only briefly. The comparison below requires the motion to repeat.
    for (let lag = 1; lag <= maximum; lag += 2) {
      if (tileDistance(tile, last, last - lag) > 1.8) return true;
    }
    return false;
  });
  let best = null;
  for (let lag = MIN_LAG; lag <= maximum; lag++) {
    if (performance.now() > deadline) return null;
    const stride = Math.max(1, Math.floor(lag / 12));
    const tiles = [];
    let score = 0, area = 0;
    for (const tile of active) {
      let error = 0, variation = 0, samples = 0;
      for (let offset = 0; offset < lag; offset += stride) {
        const i = last - offset;
        error += tileDistance(tile, i, i - lag);
        variation += tileDistance(tile, i, last - (offset + Math.floor(lag / 2)) % lag);
        samples++;
      }
      // A real repeat is much closer to the same phase one cycle earlier
      // than to another phase of that cycle. One-way fades and pans fail.
      if (variation < 2.5 * samples || error > variation * .16) continue;
      if (tileDistance(tile, last, last - lag) > variation / samples * .32) continue;
      tiles.push(tile);
      area += tile.w * tile.h;
      score += (variation - 3 * error) / samples * tile.w * tile.h;
    }
    // Prefer a local moving region. Avoid treating a whole changing scene
    // as an object that should be pasted back over the held composition.
    if (!tiles.length || area > width * height * .48) continue;
    if (!best || score > best.score * 1.06) best = { lag, tiles, score };
  }
  if (!best) return null;
  // Confirm the selected tiles using pixels, not just the sparse signatures.
  const lag = best.lag, step = Math.max(1, Math.floor(lag / 8));
  const confirmed = best.tiles.filter(tile => {
    let error = 0, variation = 0;
    for (let offset = 0; offset < lag; offset += step) {
      const a = frames[last - offset], b = frames[last - offset - lag];
      const c = frames[last - (offset + Math.floor(lag / 2)) % lag];
      for (let y = tile.y; y < tile.y + tile.h; y++) {
        for (let x = tile.x; x < tile.x + tile.w; x++) {
          const pixel = (y * width + x) * 4;
          for (let k = pixel; k < pixel + 3; k++) {
            error += Math.abs(a[k] - b[k]);
            variation += Math.abs(a[k] - c[k]);
          }
        }
      }
    }
    return variation > 0 && error <= variation * .23;
  });
  return confirmed.length ? { lag, tiles: confirmed } : null;
}

function fadeAnchor(frames, width, height, mask, deadline) {
  const last = frames.length - 1;
  const first = Math.max(3, last - 5 * SAMPLE_FPS);
  const end = frames[last], pixels = width * height;
  const rgbDistance = (a, b, i) => Math.abs(a[i] - b[i]) +
    Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  const difference = (a, b) => {
    let sum = 0;
    for (let i = 0; i < pixels; i += 2) if (!mask[i]) sum += rgbDistance(a, b, i * 4);
    return sum;
  };
  const distances = frames.slice(first - 3).map(frame => difference(frame, end));
  const distanceAt = index => distances[index - first + 3];
  const candidates = [];
  for (let i = first; i < last - 4; i++) {
    const amount = distanceAt(i);
    if (amount < pixels * .38 || difference(frames[i], frames[i - 3]) > amount * .025) continue;
    let rises = 0, intermediate = 0;
    for (let j = i + 1; j <= last; j++) {
      rises += Math.max(0, distanceAt(j) - distanceAt(j - 1));
      if (distanceAt(j) > amount * .12 && distanceAt(j) < amount * .88) intermediate++;
    }
    if (rises <= amount * .08 && intermediate >= 3) candidates.push({ i, amount });
  }
  if (!candidates.length) return undefined;
  // Keep all of the visible composition. Use the latest stable sample
  // whose amount of foreground detail is close to the strongest candidate.
  const peak = Math.max(...candidates.map(candidate => candidate.amount));
  for (let c = candidates.length - 1; c >= 0; c--) {
    if (performance.now() > deadline) return undefined;
    const { i, amount } = candidates[c];
    if (amount < peak * .96) continue;
    const base = frames[i];
    let baseEdges = 0, endEdges = 0;
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const pixel = y * width + x, index = pixel * 4;
        if (mask[pixel] || mask[pixel + 1] || mask[pixel + width]) continue;
        for (const next of [index + 4, index + width * 4]) {
          for (let k = 0; k < 3; k++) {
            baseEdges += Math.abs(base[index + k] - base[next + k]);
            endEdges += Math.abs(end[index + k] - end[next + k]);
          }
        }
      }
    }
    if (baseEdges - endEdges < Math.max(amount * .08, endEdges * .025)) continue;
    let overshoot = 0;
    for (const phase of [.75, .5, .25]) {
      let j = i;
      while (j < last && distanceAt(j) > amount * phase) j++;
      const middle = frames[j];
      // A disappearing foreground moves pixel values toward the final
      // background in place. Reject displaced shapes and scene changes.
      for (let pixel = 0; pixel < pixels; pixel += 2) {
        if (mask[pixel]) continue;
        for (let k = pixel * 4; k < pixel * 4 + 3; k++) {
          overshoot += Math.max(0, middle[k] - Math.max(base[k], end[k]) - 6,
            Math.min(base[k], end[k]) - middle[k] - 6);
        }
      }
    }
    if (overshoot <= amount * .20) return i;
  }
  return undefined;
}

export function inspectEndingFrames(frames, width, height, firstTime, duration, deadline = Infinity) {
  if (frames.length < 10) return null;
  const repeated = findRepeatedTiles(frames, width, height, deadline);
  const mask = new Uint8Array(width * height);
  for (const tile of repeated?.tiles ?? []) {
    for (let y = tile.y; y < tile.y + tile.h; y++) mask.fill(1, y * width + tile.x, y * width + tile.x + tile.w);
  }
  const anchor = fadeAnchor(frames, width, height, mask, deadline);
  if (!repeated && anchor === undefined) return null;
  return {
    holdAt: anchor === undefined ? undefined : firstTime + anchor / SAMPLE_FPS,
    endRegion: repeated ? {
      label: 'Detected loop',
      start: duration - repeated.lag / SAMPLE_FPS, end: duration,
      regions: repeated.tiles.map(({ x, y, w, h }) => ({ x: x / width, y: y / height, width: w / width, height: h / height })),
    } : undefined,
  };
}

export function analyzeEnding(paint, duration, { width, height }) {
  if (![width, height, duration].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(1, 160 / Math.max(width, height));
  const w = Math.max(16, Math.round(width * scale)), h = Math.max(16, Math.round(height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const last = Math.max(0, duration - 1 / 60);
  const count = Math.min(MAX_SAMPLES, Math.floor(last * SAMPLE_FPS) + 1);
  const firstTime = last - (count - 1) / SAMPLE_FPS;
  const deadline = performance.now() + 3500;
  const frames = [];
  for (let i = 0; i < count; i++) {
    if (performance.now() > deadline) return null;
    paint(canvas, firstTime + i / SAMPLE_FPS);
    if (canvas.width !== w || canvas.height !== h) return null;
    frames.push(ctx.getImageData(0, 0, w, h).data);
  }
  return inspectEndingFrames(frames, w, h, firstTime, duration, deadline);
}
