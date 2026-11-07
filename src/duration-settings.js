export const FIXED_DURATIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
export const MAX_EXTRA_SECONDS = 60;
const FRAME_RATES = [24, 25, 30, 50, 60];
const frameCount = (seconds, fps) => Math.max(1, Math.round(seconds * fps));

export function validExtraSeconds(seconds) {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_EXTRA_SECONDS;
}

// Only an explicitly declared terminal segment can loop. Generic loop flags
// and loops in the drawing code do not establish the end of the animation.
export function normalizeEndLoop(loop, sourceDuration) {
  if (!loop || typeof loop !== 'object') return null;
  const { start, end = sourceDuration } = loop;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= sourceDuration ||
      end <= start || Math.abs(end - sourceDuration) > 1e-6) return null;
  return { start, end: sourceDuration };
}

// Only explicit duration fields/header values use this parser; drawing
// coordinates and arbitrary timer calls are never treated as clip lengths.
export function parseSourceDuration(value, milliseconds = false) {
  if (typeof value === 'number') return milliseconds ? value / 1000 : value;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) / (milliseconds ? 1000 : 1);
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (clock && Number(clock[2]) < 60 && Number(clock[3]) < 60) {
    return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|ms|minutes?|mins?|m|seconds?|secs?|s|detik|menit)\b/gi)];
  if (!parts.length || text.replace(/(\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|ms|minutes?|mins?|m|seconds?|secs?|s|detik|menit)\b/gi, '').trim()) return NaN;
  return parts.reduce((sum, match) => sum + Number(match[1]) *
    (/^(?:ms|msec|millisecond)/i.test(match[2]) ? 0.001 : /^(?:m|min|menit)/i.test(match[2]) ? 60 : 1), 0);
}

export function durationSettings(sourceDuration, choice, fps, extraSeconds) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || !FRAME_RATES.includes(fps)) {
    throw new Error('Invalid animation duration or frame rate.');
  }
  if (choice === 'extend') {
    if (!validExtraSeconds(extraSeconds)) {
      throw new Error('Add 1–' + MAX_EXTRA_SECONDS + ' whole seconds to extend the timeline.');
    }
    // Preserve every frame of an original-duration export, even when the
    // source ends between two output frame timestamps.
    return {
      duration: (frameCount(sourceDuration, fps) + extraSeconds * fps) / fps,
      durationMode: 'extend', extraSeconds,
    };
  }
  const fixed = FIXED_DURATIONS.includes(Number(choice));
  if (choice !== 'full' && !fixed && !['2', '5'].includes(choice)) {
    throw new Error('Choose a supported video duration.');
  }
  const seconds = fixed ? Number(choice) : choice === 'full' ? sourceDuration :
    Math.min(sourceDuration, Number(choice));
  return {
    // Whole frames are unavoidable; use the nearest length rather than
    // systematically truncating the original animation's final fraction.
    duration: frameCount(seconds, fps) / fps,
    durationMode: fixed ? 'fit' : 'clip',
  };
}

export function validateDuration(sourceDuration, settings) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
      !Number.isFinite(settings.duration) || settings.duration <= 0 ||
      !['clip', 'fit', 'extend'].includes(settings.durationMode ?? 'clip')) {
    throw new Error('Invalid animation timing settings.');
  }
  if (settings.durationMode === 'extend') {
    const expected = durationSettings(sourceDuration, 'extend', settings.fps, settings.extraSeconds);
    if (Math.abs(settings.duration - expected.duration) > 1e-6) {
      throw new Error('The extended duration must equal the original duration plus the added time.');
    }
    return;
  }
  const frameTolerance = Number.isFinite(settings.fps) ? 1 / settings.fps : 0;
  if (settings.durationMode !== 'fit' && settings.duration > sourceDuration + frameTolerance + 0.00001) {
    throw new Error('The export duration exceeds the animation duration.');
  }
}

export function durationFramePlan(sourceDuration, settings, endingMotion) {
  validateDuration(sourceDuration, settings);
  const totalFrames = frameCount(settings.duration, settings.fps);
  const holdFrames = settings.durationMode === 'extend' && !endingMotion ? settings.extraSeconds * settings.fps : 0;
  return { totalFrames, drawFrames: totalFrames - holdFrames, holdFrames };
}

function extensionFrame(time, settings) {
  return Math.min(frameCount(settings.duration, settings.fps) - 1, Math.floor(time * settings.fps + 1e-8));
}

export function shouldAnalyzeEnding(meta, settings) {
  return settings.durationMode === 'extend' && settings.endingBehavior === 'smart' &&
    !meta.endLoop && !meta.endRegion && meta.smartEnding === undefined;
}

export function selectedEnding(meta, settings) {
  if (settings.durationMode !== 'extend') return {};
  if (meta.endLoop) return { loop: meta.endLoop };
  const smart = settings.endingBehavior === 'smart';
  return {
    region: meta.endRegion ?? (smart ? meta.smartEnding?.endRegion : undefined),
    holdAt: smart ? meta.endRegion?.holdAt ?? meta.smartEnding?.holdAt : undefined,
  };
}

function holdFrame(meta, settings, holdAt) {
  const last = frameCount(meta.duration, settings.fps) - 1;
  return Number.isFinite(holdAt) ? Math.min(last, Math.max(0, Math.floor(holdAt * settings.fps + 1e-8))) : last;
}

export function animationFramePlan(meta, settings) {
  const { loop, region, holdAt } = selectedEnding(meta, settings);
  const plan = durationFramePlan(meta.duration, settings, loop ?? region);
  if (!loop && !region && Number.isFinite(holdAt)) {
    plan.drawFrames = holdFrame(meta, settings, holdAt) + 1;
    plan.holdFrames = plan.totalFrames - plan.drawFrames;
  }
  return plan;
}

export function animationTime(outputTime, sourceDuration, settings, endLoop) {
  const time = Math.max(0, Math.min(settings.duration, outputTime));
  if (settings.durationMode === 'extend') {
    const { fps } = settings;
    const frame = extensionFrame(time, settings);
    const originalFrames = frameCount(sourceDuration, fps);
    if (frame < originalFrames) return frame / fps;
    if (!endLoop) return (originalFrames - 1) / fps;
    const seconds = frame / fps;
    if (seconds < endLoop.end) return seconds;
    const period = endLoop.end - endLoop.start;
    const cycles = (seconds - endLoop.end) / period;
    const phase = Math.abs(cycles - Math.round(cycles)) < 1e-9 ? 0 : cycles % 1;
    return endLoop.start + phase * period;
  }
  return Math.min(sourceDuration, settings.durationMode === 'fit' ?
    time / settings.duration * sourceDuration : time);
}

export function animationFrame(outputTime, meta, settings) {
  const { loop, region, holdAt } = selectedEnding(meta, settings);
  const time = animationTime(outputTime, meta.duration, settings, loop ?? region);
  if (!region && !Number.isFinite(holdAt)) return { time };
  const baseFrame = holdFrame(meta, settings, holdAt);
  const outputFrame = extensionFrame(Math.max(0, Math.min(settings.duration, outputTime)), settings);
  if (outputFrame < (Number.isFinite(holdAt) ? baseFrame : frameCount(meta.duration, settings.fps))) return { time };
  return region ? { time, endingBaseTime: baseFrame / settings.fps } : { time: baseFrame / settings.fps };
}
