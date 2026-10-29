import { zlibSync } from './node_modules/fflate/esm/browser.js';

// Lossless PNG encoding from opaque Canvas RGBA bytes. Typed arrays only:
// no Canvas PNG Blob or FileReader backing file exists.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodePng(pixels, width, height, level = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      pixels.byteLength !== width * height * 4) throw new Error('Invalid PNG pixel dimensions.');
  const stride = width * 3 + 1;
  const rows = new Uint8Array(stride * height);
  let pixel = 0, out = 0;
  for (let y = 0; y < height; y++) {
    rows[out++] = 1; // PNG Sub filter; RGB is exact because the canvas is opaque.
    for (let x = 0; x < width; x++, pixel += 4) {
      const previous = x ? pixel - 4 : -1;
      rows[out++] = pixels[pixel] - (x ? pixels[previous] : 0);
      rows[out++] = pixels[pixel + 1] - (x ? pixels[previous + 1] : 0);
      rows[out++] = pixels[pixel + 2] - (x ? pixels[previous + 2] : 0);
    }
  }
  const data = zlibSync(rows, { level, mem: 8 });
  const png = new Uint8Array(data.length + 57);
  const view = new DataView(png.buffer);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  const chunk = (type, bytes) => {
    view.setUint32(offset, bytes.length);
    for (let i = 0; i < 4; i++) png[offset + 4 + i] = type.charCodeAt(i);
    png.set(bytes, offset + 8);
    view.setUint32(offset + 8 + bytes.length, crc32(png, offset + 4, offset + 8 + bytes.length));
    offset += bytes.length + 12;
  };
  const header = new Uint8Array(13), dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, width); dimensions.setUint32(4, height);
  header[8] = 8; header[9] = 2; // 8-bit RGB; no transparency in video output.
  chunk('IHDR', header); chunk('IDAT', data); chunk('IEND', new Uint8Array());
  return png.buffer;
}
