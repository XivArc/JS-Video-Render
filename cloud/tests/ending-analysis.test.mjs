import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEndingFrames } from '../../src/ending-analysis.js';
import { animationFrame, animationFramePlan, durationSettings } from '../../src/duration-settings.js';

const w = 160, h = 90, duration = 12;
const firstTime = 1 / 16 - 1 / 60;
function sample({ moving = true, repeat = true, fade = true } = {}) {
  return Array.from({ length: 192 }, (_, n) => {
    const t = firstTime + n / 16;
    const frame = new Uint8Array(w * h * 4).fill(238);
    const rect = (left, top, width, height, color) => {
      for (let y = top; y < top + height; y++) {
        for (let x = left; x < left + width; x++) {
          const offset = (y * w + x) * 4;
          frame[offset] = color[0]; frame[offset + 1] = color[1]; frame[offset + 2] = color[2];
        }
      }
    };
    const alpha = fade ? Math.max(0, Math.min(1, (11.6 - t) / 1.6)) : 1;
    const ink = Math.round(238 - 190 * alpha);
    for (let x = 20; x < 62; x += 9) {
      rect(x, 37, 4, 13, [ink, ink, ink]);
      rect(x, 37, 7, 3, [ink, ink, ink]);
    }
    if (moving) {
      const x = repeat ? Math.round(124 + 13 * Math.sin(Math.PI * t)) : Math.round(82 + 5 * t);
      rect(x, 20, 7, 7, [38, 92, 174]);
    }
    return frame;
  });
}

test('detects a repeat in the ornament area and keeps text from before its fade', () => {
  const plan = inspectEndingFrames(sample(), w, h, firstTime, duration);
  assert.equal(plan.endRegion.end - plan.endRegion.start, 2);
  assert.ok(plan.holdAt > 9.7 && plan.holdAt < 10.12, JSON.stringify(plan));
  assert.ok(plan.endRegion.regions.length >= 2);
  assert.ok(plan.endRegion.regions.every(rect => rect.x > .60), 'The text is outside the moving region');
});

test('preserves a stable composition through a fade even when there is no loop', () => {
  const plan = inspectEndingFrames(sample({ moving: false }), w, h, firstTime, duration);
  assert.equal(plan.endRegion, undefined);
  assert.ok(plan.holdAt > 9.7 && plan.holdAt < 10.12);
  const meta = { duration, smartEnding: plan };
  const settings = { fps: 60, endingBehavior: 'smart', ...durationSettings(duration, 'extend', 60, 5) };
  const framePlan = animationFramePlan(meta, settings);
  assert.equal(framePlan.totalFrames, 1020);
  assert.equal(framePlan.drawFrames + framePlan.holdFrames, framePlan.totalFrames);
  assert.equal(animationFrame(15, meta, settings).time, (framePlan.drawFrames - 1) / 60);
});

test('a one-way motion has no detected repeat', () => {
  assert.equal(inspectEndingFrames(sample({ repeat: false, fade: false }), w, h, firstTime, duration), null);
});

test('Copper Card keeps the pre-outro composition while its clock continues', () => {
  const meta = { duration: 25, endRegion: { start: 18.75, end: 25, holdAt: 21.6 } };
  const settings = { fps: 60, endingBehavior: 'smart', ...durationSettings(25, 'extend', 60, 10) };
  assert.deepEqual(animationFrame(20, meta, settings), { time: 20 });
  assert.deepEqual(animationFrame(23, meta, settings), { time: 23, endingBaseTime: 21.6 });
  assert.deepEqual(animationFrame(25, meta, settings), { time: 18.75, endingBaseTime: 21.6 });
  assert.deepEqual(animationFrame(31.25, meta, settings), { time: 18.75, endingBaseTime: 21.6 });
  assert.deepEqual(animationFrame(23, meta, { ...settings, endingBehavior: 'source' }), { time: 23 });
  assert.equal(animationFramePlan(meta, settings).drawFrames, 2100);
});
