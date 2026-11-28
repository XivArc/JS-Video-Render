import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { writePngFrame } from '../frame-stream.mjs';
import { encodePng } from '../png-frame.js';

function fixture(chunks, headers = {}) {
  const received = [];
  const request = Readable.from(chunks); request.headers = headers;
  const sink = { width: 2, height: 1, next: 0,
    stdin: new Writable({ highWaterMark: 1, write(chunk, encoding, callback) {
      received.push(Buffer.from(chunk)); setImmediate(callback);
    } }) };
  return { request, sink, received };
}

test('fragmented PNG frames reach the encoder exactly once and in order', async () => {
  const rgba = Buffer.from(encodePng(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1));
  const f = fixture([rgba.subarray(0, 3), rgba.subarray(3)], { 'content-length': String(rgba.length) });
  await writePngFrame(f.request, f.sink, () => true);
  assert.equal(f.sink.next, 1);
  assert.deepEqual(f.received, [rgba]);
});

test('short, oversized, and incorrectly declared frames never reach FFmpeg', async () => {
  for (const [chunks, headers] of [[[Buffer.alloc(7)], {}], [[Buffer.alloc(1_000_009)], {}],
    [[Buffer.alloc(80)], { 'content-length': '79' }], [[Buffer.from(encodePng(new Uint8Array(16),4,1))], {}]]) {
    const f = fixture(chunks, headers);
    await assert.rejects(writePngFrame(f.request, f.sink, () => true), /PNG frame/);
    assert.equal(f.sink.next, 0); assert.equal(f.received.length, 0);
  }
});

test('aborted uploads cannot write a partial PNG frame', async () => {
  const f = fixture([]);
  f.request = Readable.from((async function* () { yield Buffer.alloc(4); throw new Error('connection lost'); })());
  f.request.headers = {};
  await assert.rejects(writePngFrame(f.request, f.sink, () => true), /connection lost/);
  assert.equal(f.sink.next, 0); assert.equal(f.received.length, 0);
});

test('an obsolete encoder cannot receive a late frame from a previous attempt', async () => {
  const f = fixture([Buffer.from(encodePng(new Uint8Array(8), 2, 1))]);
  await assert.rejects(writePngFrame(f.request, f.sink, () => false), /no longer available/);
  assert.equal(f.sink.next, 0); assert.equal(f.received.length, 0);
});

test('frame acknowledgements wait for encoder backpressure', async () => {
  const f = fixture([Buffer.from(encodePng(new Uint8Array(8), 2, 1))]);
  let release;
  f.sink.stdin = new Writable({ write(chunk, encoding, callback) { release = callback; } });
  const pending = writePngFrame(f.request, f.sink, () => true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sink.next, 0);
  assert.equal(typeof release, 'function'); release();
  await pending; assert.equal(f.sink.next, 1);
});

test('failed encoder writes do not acknowledge the frame', async () => {
  const f = fixture([Buffer.from(encodePng(new Uint8Array(8), 2, 1))]);
  f.sink.stdin = new Writable({ write(chunk, encoding, callback) { callback(new Error('encoder closed')); } });
  f.sink.stdin.on('error', () => {});
  await assert.rejects(writePngFrame(f.request, f.sink, () => true), /encoder closed/);
  assert.equal(f.sink.next, 0);
});
