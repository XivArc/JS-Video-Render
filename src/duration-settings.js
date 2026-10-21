export const FIXED_DURATIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

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

export function durationSettings(sourceDuration, choice, fps) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
      ![24, 25, 30, 50, 60].includes(fps)) {
    throw new Error('Invalid animation duration or frame rate.');
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
    duration: Math.max(1, Math.round(seconds * fps)) / fps,
    durationMode: fixed ? 'fit' : 'clip',
  };
}

export function validateDuration(sourceDuration, settings) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
      !Number.isFinite(settings.duration) || settings.duration <= 0 ||
      !['clip', 'fit'].includes(settings.durationMode ?? 'clip')) {
    throw new Error('Invalid animation timing settings.');
  }
  const frameTolerance = Number.isFinite(settings.fps) ? 1 / settings.fps : 0;
  if (settings.durationMode !== 'fit' && settings.duration > sourceDuration + frameTolerance + 0.00001) {
    throw new Error('The export duration exceeds the animation duration.');
  }
}

export function animationTime(outputTime, sourceDuration, settings) {
  const time = Math.max(0, Math.min(settings.duration, outputTime));
  return Math.min(sourceDuration, settings.durationMode === 'fit' ?
    time / settings.duration * sourceDuration : time);
}
