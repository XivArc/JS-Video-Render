import assert from 'node:assert/strict';
import test from 'node:test';
import { animationFrame, animationTime, durationFramePlan, durationSettings, normalizeEndLoop } from '../../src/duration-settings.js';
import { validateCloudJob } from '../../src/cloud-job.js';
import { sourceHeaderMetadata } from '../../src/animation-reader.js';

const timing = (source, choice, fps = 60, extra) => ({ fps, ...durationSettings(source, choice, fps, extra) });

test('Fit to Duration changes speed; original and quick tests retain the source clock', () => {
  assert.equal(animationTime(17.5, 25, timing(25, '35')), 12.5);
  assert.equal(animationTime(10, 25, timing(25, '20')), 12.5);
  assert.equal(animationTime(10, 25, timing(25, 'full')), 10);
  assert.equal(timing(3, '5').duration, 3);
  assert.equal(animationTime(1, 25, timing(25, '2')), 1);
});

test('Extend Timeline keeps the original frames and holds the last sampled frame', () => {
  const settings = timing(25, 'extend', 60, 10);
  assert.equal(settings.duration, 35);
  assert.deepEqual(durationFramePlan(25, settings), { totalFrames: 2100, drawFrames: 1500, holdFrames: 600 });
  assert.equal(animationTime(12.5, 25, settings), 12.5);
  for (const t of [25, 30, 35]) assert.equal(animationTime(t, 25, settings), 1499 / 60);
});

test('a declared terminal loop continues at 1× and never seeks back into the intro', () => {
  const settings = timing(25, 'extend', 60, 10);
  const loop = normalizeEndLoop({ start: 22, end: 25 }, 25);
  assert.deepEqual(durationFramePlan(25, settings, loop), { totalFrames: 2100, drawFrames: 2100, holdFrames: 0 });
  for (const [t, expected] of [[24.5, 24.5], [25, 22], [25.5, 22.5], [28, 22], [34, 22], [35, 22 + 59 / 60]]) {
    assert.ok(Math.abs(animationTime(t, 25, settings, loop) - expected) < 1e-9, 'Output second ' + t);
  }
});

test('a leading duration, resolution and FPS tuple establishes the source timing', () => {
  const header = '/**\n * 25 seconds, 3840 × 2160, 60 fps. The renderer supplies seconds.\n */';
  assert.deepEqual(sourceHeaderMetadata(header), { width: [3840], height: [2160], fps: [60], duration: [25] });
  assert.deepEqual(sourceHeaderMetadata('function draw() {}\n' + header).duration, []);
});

test('the region keeps the source clock through the original clip and holds the last complete frame during its loop', () => {
  const endRegion = { start: 18.75, end: 25 };
  const meta = { duration: 25, endRegion };
  const settings = timing(25, 'extend', 60, 10);
  assert.deepEqual(animationFrame(1499 / 60, meta, settings), { time: 1499 / 60 });
  for (const outputTime of [25, 31.25]) {
    assert.deepEqual(animationFrame(outputTime, meta, settings), { time: 18.75, endingBaseTime: 1499 / 60 });
  }
  assert.deepEqual(animationFrame(26.5, meta, settings), { time: 20.25, endingBaseTime: 1499 / 60 });
  assert.deepEqual(animationFrame(17.5, meta, timing(25, '35')), { time: 12.5 });
  assert.deepEqual(durationFramePlan(25, settings, endRegion), { totalFrames: 2100, drawFrames: 2100, holdFrames: 0 });
});

test('fractional source durations keep the exact original frame count and loop phase', () => {
  const source = 25.01;
  const settings = timing(source, 'extend', 60, 10);
  const original = durationFramePlan(source, timing(source, 'full'));
  const plan = durationFramePlan(source, settings);
  assert.equal(plan.drawFrames, original.totalFrames);
  assert.equal(plan.holdFrames, 600);
  assert.equal(animationTime(settings.duration, source, settings), (plan.drawFrames - 1) / 60);
  const firstAddedTime = plan.drawFrames / 60;
  const loop = normalizeEndLoop({ start: 22 }, source);
  assert.ok(Math.abs(animationTime(firstAddedTime, source, settings, loop) - (22 + firstAddedTime - source)) < 1e-9);
});

test('only an explicit valid loop ending at source duration is accepted', () => {
  assert.deepEqual(normalizeEndLoop({ start: 22 }, 25), { start: 22, end: 25 });
  for (const marker of [true, { start: -1 }, { start: 25 }, { start: '22' }, { start: 22, end: 24 }, { start: 22, end: 26 }]) {
    assert.equal(normalizeEndLoop(marker, 25), null);
  }
});

test('cloud jobs preserve extension settings and still accept older duration choices', () => {
  const base = { version: 1, id: 'cloud-duration-test',
    settings: { format: 'mp4', fps: 60, resolution: 'fixed', width: 128, height: 72, bitrateMode: 'manual' },
    files: [{ fileName: 'test.js', source: 'function draw() {}', bitrate: 1234000 }] };
  const withChoice = (durationChoice, extraSeconds) => ({ ...base, settings: { ...base.settings, durationChoice, extraSeconds } });
  assert.equal(validateCloudJob(withChoice('extend', 10)).settings.extraSeconds, 10);
  for (const choice of ['full', '2', '5', '35']) {
    assert.equal(validateCloudJob(withChoice(choice)).settings.durationChoice, choice);
  }
  for (const invalid of [undefined, 0, -1, 1.5, 61, '10']) {
    assert.throws(() => validateCloudJob(withChoice('extend', invalid)), /whole seconds/);
  }
  assert.throws(() => durationFramePlan(25, { ...timing(25, 'extend', 60, 10), duration: 34 }), /original duration/);
});
