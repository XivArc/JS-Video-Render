// Validate a whole PNG before writing any bytes to the encoder. Interrupted
// uploads must never append partial frames to the image2pipe decoder.
export async function writePngFrame(request, sink, isCurrent) {
  const maximum = sink.width * sink.height * 4 + 1_000_000;
  const length = request.headers['content-length'];
  if (length !== undefined && (!Number.isInteger(Number(length)) || Number(length) < 57 || Number(length) > maximum)) {
    throw new Error('PNG frame Content-Length exceeds its supported size.');
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) throw new Error('PNG frame exceeds its supported size.');
    chunks.push(chunk);
  }
  if (length !== undefined && bytes !== Number(length)) throw new Error('PNG frame upload is incomplete.');
  if (!isCurrent() || sink.stdin.destroyed) throw new Error('Frame encoder is no longer available.');
  const frame = Buffer.concat(chunks, bytes);
  chunks.length = 0;
  if (bytes < 57 || frame.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || frame.readUInt32BE(8) !== 13 ||
      frame.subarray(12, 16).toString('ascii') !== 'IHDR' || frame.readUInt32BE(16) !== sink.width ||
      frame.readUInt32BE(20) !== sink.height || frame.readUInt32BE(bytes - 12) !== 0 ||
      frame.subarray(bytes - 8, bytes - 4).toString('ascii') !== 'IEND') throw new Error('PNG frame is incomplete or has incorrect dimensions.');
  await new Promise((resolve, reject) => sink.stdin.write(frame, error => error ? reject(error) : resolve()));
  sink.next++;
}
