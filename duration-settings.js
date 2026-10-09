export const FIXED_DURATIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

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
    duration: Math.floor(seconds * fps + 0.000001) / fps,
    durationMode: fixed ? 'fit' : 'clip',
  };
}

export function validateDuration(sourceDuration, settings) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
      !Number.isFinite(settings.duration) || settings.duration <= 0 ||
      !['clip', 'fit'].includes(settings.durationMode ?? 'clip')) {
    throw new Error('Invalid animation timing settings.');
  }
  if (settings.durationMode !== 'fit' && settings.duration > sourceDuration + 0.00001) {
    throw new Error('The export duration exceeds the animation duration.');
  }
}

export function animationTime(outputTime, sourceDuration, settings) {
  const time = Math.max(0, Math.min(settings.duration, outputTime));
  return Math.min(sourceDuration, settings.durationMode === 'fit' ?
    time / settings.duration * sourceDuration : time);
}
