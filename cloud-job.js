import { getBitrateProfile, bitrateInProfile, bitrateHasNonRoundKbps, randomBitrate } from './bitrate-profiles.js';
import { FIXED_DURATIONS } from './duration-settings.js';

export const CLOUD_ACTIONS_URL = 'https://github.com/XivArc/JS-Video-Render/actions/workflows/render-cloud.yml';
export const CLOUD_UPLOAD_URL = 'https://github.com/XivArc/JS-Video-Render/upload/main/cloud/jobs';
export const MAX_CLOUD_JOB_BYTES = 20_000_000;
const bytes = text => new TextEncoder().encode(text).length;

export function validateCloudJob(job) {
  if (!job || job.version !== 1 || typeof job.id !== 'string' || !/^cloud-[a-z0-9-]{1,70}$/.test(job.id)) {
    throw new Error('Invalid cloud job format or identifier.');
  }
  const settings = job.settings;
  if (!settings || !['mp4', 'mov'].includes(settings.format) || ![24, 25, 30, 50, 60].includes(settings.fps) ||
      !['full', '2', '5', ...FIXED_DURATIONS.map(String)].includes(settings.durationChoice)) {
    throw new Error('Choose a supported format, frame rate, and duration.');
  }
  getBitrateProfile(settings.bitrateMode);
  if (!Array.isArray(job.files) || job.files.length < 1 || job.files.length > 10) throw new Error('A cloud job must contain 1–10 JavaScript files.');
  const files = job.files.map(file => {
    if (!file || typeof file.fileName !== 'string' || !/\.js$/i.test(file.fileName) || file.fileName.length > 255 ||
        /[\x00-\x1f]/.test(file.fileName) || typeof file.source !== 'string' || bytes(file.source) > 5_000_000) {
      throw new Error('Each cloud source must be a .js file up to 5 MB.');
    }
    if (!bitrateInProfile(file.bitrate, settings.bitrateMode) || !bitrateHasNonRoundKbps(file.bitrate)) {
      throw new Error('Every target bitrate must match the selected Auto Random profile.');
    }
    return { fileName: file.fileName, source: file.source, bitrate: file.bitrate };
  });
  const normalized = { version: 1, id: job.id, settings: {
    format: settings.format, fps: settings.fps, durationChoice: settings.durationChoice, bitrateMode: settings.bitrateMode,
  }, files };
  if (bytes(JSON.stringify(normalized)) > MAX_CLOUD_JOB_BYTES) throw new Error('The cloud job exceeds 20 MB. Select fewer files for this job.');
  return normalized;
}

export function createCloudJob(preferences, sources) {
  const used = [preferences.bitrate];
  const files = sources.map((file, index) => {
    const bitrate = index === 0 ? preferences.bitrate : randomBitrate(preferences.bitrateMode, used);
    used.push(bitrate);
    return { fileName: file.fileName, source: file.source, bitrate };
  });
  return validateCloudJob({ version: 1, id: 'cloud-' + crypto.randomUUID(), settings: preferences, files });
}
