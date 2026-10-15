// Render at the displayed device-pixel size, rather than stretching a 540p frame.
// A 4K pixel budget and 4096px edge limit bound worker/bitmap allocations.
const MAX_PIXELS = 3840 * 2160;
const MAX_EDGE = 4096;

export function makePreviewResolution(canvas, onResize) {
  let scheduled = 0;
  let densityQuery;

  function size(meta) {
    if (!meta) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const density = window.devicePixelRatio || 1;
    // Fullscreen and the compact Quick Preview can letterbox the source.
    // Only the contained picture needs pixels, not the surrounding bars.
    const scale = Math.min(
      bounds.width * density / meta.width,
      bounds.height * density / meta.height,
      MAX_EDGE / meta.width,
      MAX_EDGE / meta.height,
      Math.sqrt(MAX_PIXELS / (meta.width * meta.height)),
    );
    return {
      width: Math.max(1, Math.floor(meta.width * scale)),
      height: Math.max(1, Math.floor(meta.height * scale)),
    };
  }

  function needsRedraw(meta) {
    const next = size(meta);
    return next && (canvas.width !== next.width || canvas.height !== next.height);
  }

  function refresh() {
    if (scheduled) return;
    // Read layout after fullscreen styles and ResizeObserver delivery settle.
    scheduled = requestAnimationFrame(() => { scheduled = 0; onResize(); });
  }

  function watchDensity() {
    densityQuery?.removeEventListener('change', densityChanged);
    densityQuery = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    densityQuery.addEventListener('change', densityChanged);
  }
  function densityChanged() { watchDensity(); refresh(); }

  const observer = new ResizeObserver(refresh);
  observer.observe(canvas);
  window.addEventListener('resize', refresh);
  window.visualViewport?.addEventListener('resize', refresh);
  document.addEventListener('fullscreenchange', refresh);
  watchDensity();

  return { size, needsRedraw };
}
