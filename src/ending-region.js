// A known animation can continue one region using its original draw function.
// Bind the profile to the source, since the crop and timing must match exactly.
const copperChristmasCard = {
  label: 'Ornament loop',
  start: 18.75,
  end: 25,
  region: { x: 1502, y: 114, width: 164, height: 272, designWidth: 1920, designHeight: 1080 },
};
const copperChristmasDigest = '3d5e6e9b3f1469961eb8f01d48d4b64c1a79b0b372e4d9fb81c388a01d87ad60';

export async function knownEndRegion(source) {
  if (!source.slice(0, 512).includes('Copper Christmas Card') || !globalThis.crypto?.subtle) return undefined;
  const canonical = source.replace(/\r\n?/g, '\n').trim();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return hex === copperChristmasDigest ? copperChristmasCard : undefined;
}

export function createEndRegionPainter(draw) {
  let held;
  return (canvas, time, endRegion, endingBaseTime) => {
    if (endingBaseTime === undefined) {
      held = undefined;
      draw(canvas, time);
      return;
    }
    if (!endRegion || !Number.isFinite(endingBaseTime) || endingBaseTime < 0 || endingBaseTime >= endRegion.end) {
      throw new Error('Invalid held frame for the ending region.');
    }
    const { width, height } = canvas;
    const { x, y, width: regionWidth, height: regionHeight, designWidth, designHeight } = endRegion.region;
    if (held?.canvas !== canvas || held.width !== width || held.height !== height || held.time !== endingBaseTime) {
      draw(canvas, endingBaseTime);
    }
    // The known source fits its design into a centered viewport. Clip to
    // whole output pixels so the surrounding held image stays untouched.
    const scale = Math.min(width / designWidth, height / designHeight);
    const offsetX = (width - designWidth * scale) / 2, offsetY = (height - designHeight * scale) / 2;
    const left = Math.floor(offsetX + x * scale), top = Math.floor(offsetY + y * scale);
    const right = Math.ceil(offsetX + (x + regionWidth) * scale), bottom = Math.ceil(offsetY + (y + regionHeight) * scale);
    const ctx = canvas.getContext('2d');
    held = undefined;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.clip();
      ctx.beginPath();
      draw(canvas, time);
    } finally { ctx.restore(); }
    held = { canvas, width, height, time: endingBaseTime };
  };
}
