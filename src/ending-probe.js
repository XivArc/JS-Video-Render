// Probe in a separate worker: sampled timestamps must not advance a script's
// drawing state before the preview or the export starts.
export async function probeEnding(bridge, source, dimensions) {
  try {
    await bridge.call('load', { ...source, restricted: true, restrictedContext: 'Ending analysis' }, [], 6000);
    return await bridge.call('analyze-ending', { width: dimensions.width, height: dimensions.height }, [], 6000);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return null;
  } finally { bridge.dispose(); }
}
