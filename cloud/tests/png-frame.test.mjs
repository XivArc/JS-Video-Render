import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { encodePng } from '../png-frame.js';

test('FFmpeg decodes every RGB pixel exactly, including row boundaries and wrapped differences', () => {
  for (const [width, height] of [[1, 1], [17, 9], [128, 72]]) {
    const rgba = new Uint8Array(width * height * 4), rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let channel = 0; channel < 3; channel++) rgb[i * 3 + channel] = rgba[i * 4 + channel] =
        (x * 83 + y * 47 + channel * 101) % 256;
      rgba[i * 4 + 3] = 255;
    }
    const decoded = execFileSync('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-vcodec', 'png', '-i', 'pipe:0',
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { input: Buffer.from(encodePng(rgba, width, height)), maxBuffer: rgb.length + 1_000_000 });
    assert.deepEqual(decoded, rgb);
  }
});

test('frame encoding does not require Blob or FileReader', () => {
  const original = globalThis.Blob;
  globalThis.Blob = class { constructor() { throw new Error('Blob disabled'); } };
  try {
    const png = encodePng(Uint8Array.from([18, 128, 255, 255]), 1, 1);
    assert.equal(Buffer.from(png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally { globalThis.Blob = original; }
});
