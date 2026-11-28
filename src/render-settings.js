// Output size is independent of bitrate. Resolve native size per source file.
export function validateDimensions(width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value >= 16 && value <= 4096 && value % 2 === 0)) {
    throw new Error('Resolution must use even width and height values from 16 to 4096 pixels.');
  }
  return { width, height };
}

export function exportDimensions(settings, meta) {
  return settings.resolution === 'native' ? validateDimensions(meta?.width, meta?.height) :
    validateDimensions(settings.width, settings.height);
}
