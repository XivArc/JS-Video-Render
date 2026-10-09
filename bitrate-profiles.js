export const BITRATE_PROFILES = Object.freeze({
  '2160p': Object.freeze({ id: '2160p', label: '4K (2160p)', width: 3840, height: 2160, minMbps: 70, maxMbps: 100 }),
  '1440p': Object.freeze({ id: '1440p', label: '2K (1440p)', width: 2560, height: 1440, minMbps: 53, maxMbps: 68 }),
  '1080p': Object.freeze({ id: '1080p', label: 'FHD (1080p)', width: 1920, height: 1080, minMbps: 40, maxMbps: 51 }),
  '720p': Object.freeze({ id: '720p', label: 'HD (720p)', width: 1280, height: 720, minMbps: 20, maxMbps: 38 }),
});

export function getBitrateProfile(id) {
  if (!Object.hasOwn(BITRATE_PROFILES, id)) throw new Error('Choose a supported Auto Random bitrate mode.');
  return BITRATE_PROFILES[id];
}

export function profileForDimensions(width, height) {
  return Object.values(BITRATE_PROFILES).find((profile) => profile.width === width && profile.height === height);
}

export function bitrateInProfile(bitrate, id) {
  const profile = getBitrateProfile(id);
  return Number.isFinite(bitrate) && bitrate >= profile.minMbps * 1_000_000 && bitrate <= profile.maxMbps * 1_000_000;
}

export function bitrateHasNonRoundKbps(bitrate) {
  return Number.isFinite(bitrate) && Math.floor(bitrate / 1000) % 1000 !== 0 && Math.round(bitrate / 1000) % 1000 !== 0;
}

export function randomBitrate(id, previous = [], central = false) {
  const profile = getBitrateProfile(id);
  const span = (profile.maxMbps - profile.minMbps) * 1000;
  // Leave room for headers at the limits. A retry uses the middle half of the range.
  const margin = central ? Math.ceil(span / 4) : 10;
  const minimum = profile.minMbps * 1000 + margin;
  const maximum = profile.maxMbps * 1000 - margin;
  const count = maximum - minimum + 1;
  const limit = Math.floor(0x1_0000_0000 / count) * count;
  const excluded = previous.map((value) => Math.round(value / 1000));
  const random = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(random);
    if (random[0] >= limit) continue;
    const kbps = minimum + random[0] % count;
    const fraction = kbps % 1000;
    if (fraction <= 10 || fraction >= 990 || excluded.includes(kbps)) continue;
    return kbps * 1000;
  }
}
