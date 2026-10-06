import { validateCloudJob } from './cloud-job.js';

export const DEFAULT_REPOSITORY = 'XivArc/JS-Video-Render';
export const GITHUB_WORKFLOW = 'render-cloud.yml';
export const GITHUB_BRANCH = 'main';
export const CONNECTION_KEY = 'canvas-video-github-connection-v1';
export const HISTORY_KEY = 'canvas-video-github-jobs-v1';
const API = 'https://api.github.com';
const ACTIVE = new Set(['uploading', 'starting', 'locating', 'uncertain', 'queued', 'in_progress', 'waiting', 'pending', 'requested']);

export const cloudJobActive = job => Boolean(job && ACTIVE.has(job.status));
export function repositoryName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(name)) throw new Error('Enter a repository as owner/name.');
  return name;
}
export function githubConfig(repository, token) {
  const config = { repository: repositoryName(repository), token: String(token || '').trim() };
  if (!/^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/.test(config.token)) throw new Error('Enter your GitHub personal access token.');
  return config;
}
export const workflowUrl = repository => 'https://github.com/' + repositoryName(repository) + '/actions/workflows/' + GITHUB_WORKFLOW;
export const runUrl = (repository, id) => 'https://github.com/' + repositoryName(repository) + '/actions/runs/' + positiveId(id);
export const artifactUrl = (repository, runId, id) => runUrl(repository, runId) + '/artifacts/' + positiveId(id);
function positiveId(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('Invalid GitHub identifier.');
  return Number(id);
}
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  const pieces = [];
  for (let i = 0; i < bytes.length; i += 0x8000) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(pieces.join(''));
}
function apiError(status, headers) {
  if (status === 401) return 'GitHub rejected the token. Reconnect with a valid, unexpired token.';
  if (status === 429 || headers.get('x-ratelimit-remaining') === '0') return 'GitHub request limit reached. Wait before refreshing again.';
  if (status === 403) return 'GitHub denied this action. Check Contents and Actions permissions, token expiry, and repository rules.';
  if (status === 404) return 'GitHub could not find this repository, workflow, or result. Check repository access and the installed cloud workflow.';
  if (status === 409) return 'The repository changed during upload. Try rendering again after other commits finish.';
  if (status === 422) return 'GitHub could not accept this request. Check the main branch and render-cloud.yml workflow.';
  return 'GitHub is unavailable (HTTP ' + status + '). Check the job status before retrying.';
}

export class GithubError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'GithubError'; this.status = status; }
}

export function makeGithubClient(config, fetchImpl = fetch) {
  config = githubConfig(config.repository, config.token);
  const base = '/repos/' + config.repository;
  async function request(path, { method = 'GET', body, raw = false, signal, timeout = 60000, optional = false } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeout);
    let response;
    try {
      response = await fetchImpl(API + base + path, { method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: 'Bearer ' + config.token, 'X-GitHub-Api-Version': '2026-03-10',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      if (optional && response.status === 404) return null;
      if (!response.ok) throw new GithubError(apiError(response.status, response.headers), response.status);
      if (response.status === 204 || response.status === 202) return null;
      if (raw) {
        const text = await response.text();
        if (new TextEncoder().encode(text).length > 150000) throw new GithubError('The cloud result report is too large. Open the GitHub run instead.');
        return JSON.parse(text);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof GithubError) throw error;
      throw new GithubError('The GitHub request was interrupted. Check your connection and refresh the job status.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    repository: config.repository,
    async connect() {
      const repository = await request('');
      if (repository.default_branch !== GITHUB_BRANCH) throw new Error('This renderer expects main as the default repository branch.');
      const workflow = await request('/actions/workflows/' + GITHUB_WORKFLOW);
      if (workflow.state !== 'active') throw new Error('Enable the Render video in cloud workflow in GitHub Actions.');
      return { repository: config.repository, private: Boolean(repository.private) };
    },
    async submit(job, record, update) {
      job = validateCloudJob(job);
      const runs = await request('/actions/workflows/' + GITHUB_WORKFLOW + '/runs?branch=main&per_page=100');
      if ((runs.workflow_runs || []).some(run => run.status !== 'completed')) {
        throw new Error('Another cloud render is still active. Wait for it to finish before starting this batch.');
      }
      record.status = 'uploading'; update(record);
      const uploaded = await request('/contents/' + record.jobPath, { method: 'PUT', timeout: 120000,
        body: { branch: GITHUB_BRANCH, message: 'Cloud render job ' + job.id, content: base64(JSON.stringify(job)) } });
      if (!/^[a-f0-9]{40}$/i.test(uploaded?.commit?.sha || '')) throw new Error('GitHub did not confirm the job upload. No render was requested.');
      record.commitSha = uploaded.commit.sha;
      record.status = 'starting'; update(record);
      try {
        // Never retry this POST automatically: its response could be lost after
        // GitHub has already accepted the render. Resolve by the unique job path.
        const accepted = await request('/actions/workflows/' + GITHUB_WORKFLOW + '/dispatches', { method: 'POST',
          body: { ref: GITHUB_BRANCH, inputs: { job_file: record.jobPath } } });
        record.accepted = true;
        record.acceptedAt = new Date().toISOString();
        record.runId = accepted?.workflow_run_id ? positiveId(accepted.workflow_run_id) : null;
        record.status = record.runId ? 'queued' : 'locating';
        update(record);
      } catch (error) {
        if (error.status >= 400 && error.status < 500) throw error;
        record.status = 'uncertain'; record.error = 'Checking whether GitHub accepted the render. No duplicate request will be sent.';
        update(record);
      }
      return record;
    },
    async findRun(record) {
      const runs = await request('/actions/workflows/' + GITHUB_WORKFLOW + '/runs?branch=main&event=workflow_dispatch&per_page=100');
      const expected = 'Cloud render · ' + record.jobPath;
      const matches = (runs.workflow_runs || []).filter(run => run.display_title === expected);
      if (!matches.length) return null;
      return matches.sort((a, b) => b.id - a.id)[0];
    },
    getRun: id => request('/actions/runs/' + positiveId(id)),
    async getPhase(id) {
      const body = await request('/actions/runs/' + positiveId(id) + '/jobs?filter=latest&per_page=100');
      const steps = (body.jobs || []).flatMap(job => job.steps || []);
      const step = steps.find(step => step.status === 'in_progress');
      if (!step) return 'Preparing cloud runner';
      if (/Render and verify/.test(step.name)) return 'Rendering and verifying videos';
      if (/Save videos/.test(step.name)) return 'Uploading completed videos';
      if (/Publish result/.test(step.name)) return 'Publishing results';
      return 'Preparing cloud runner';
    },
    async getReport(record) {
      const report = await request('/contents/cloud/results/' + record.id + '.json?ref=main', { raw: true, optional: true });
      if (!report) return null;
      if (report.id !== record.id || Number(report.githubRunId) !== record.runId || Number(report.githubRunAttempt) !== record.runAttempt ||
          !Array.isArray(report.files) || report.files.length !== record.fileNames.length ||
          report.files.some((file, i) => file.fileName !== record.fileNames[i] || !['completed', 'failed'].includes(file.status))) {
        throw new Error('The result report does not match this render. Open its GitHub summary.');
      }
      return report;
    },
    async getArtifacts(record) {
      const body = await request('/actions/runs/' + positiveId(record.runId) + '/artifacts?per_page=100');
      const expected = 'rendered-videos-' + record.runId + '-' + record.runAttempt;
      return (body.artifacts || []).filter(artifact => artifact.name === expected).map(artifact => ({
        id: positiveId(artifact.id), name: artifact.name, bytes: Number(artifact.size_in_bytes), expired: Boolean(artifact.expired),
        expiresAt: artifact.expires_at, href: artifactUrl(config.repository, record.runId, artifact.id),
      }));
    },
    cancel: id => request('/actions/runs/' + positiveId(id) + '/cancel', { method: 'POST' }),
  };
}

// Persist only connection consent and small job metadata. Source code is never
// placed in browser storage. GitHub tokens never enter job JSON or result URLs.
export function loadConnection(storage) {
  try { storage ??= globalThis.localStorage; const value = JSON.parse(storage.getItem(CONNECTION_KEY)); return value?.remember ? githubConfig(value.repository, value.token) : null; }
  catch { return null; }
}
export function saveConnection(config, remember, storage = localStorage) {
  storage.removeItem(CONNECTION_KEY);
  if (remember) storage.setItem(CONNECTION_KEY, JSON.stringify({ ...githubConfig(config.repository, config.token), remember: true }));
}
export function forgetConnection(storage = localStorage) { storage.removeItem(CONNECTION_KEY); }
export function loadHistory(repository, storage) {
  try {
    storage ??= globalThis.localStorage;
    const values = JSON.parse(storage.getItem(HISTORY_KEY));
    if (!Array.isArray(values)) return [];
    return values.filter(value => value && value.repository === repository && /^cloud-[a-z0-9-]{1,70}$/.test(value.id) &&
      value.jobPath === 'cloud/jobs/' + value.id + '.json' && Array.isArray(value.fileNames) &&
      value.fileNames.length > 0 && value.fileNames.length <= 10 && value.fileNames.every(name => typeof name === 'string' && name.length <= 255) &&
      Number.isFinite(Date.parse(value.createdAt)) && (!value.runId || (Number.isSafeInteger(value.runId) && value.runId > 0)) &&
      Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0 &&
      Array.isArray(value.artifacts) && value.artifacts.every(a => a && Number.isSafeInteger(a.id) && a.id > 0) &&
      Array.isArray(value.resultFiles) && value.resultFiles.every(file => file && value.fileNames.includes(file.fileName) && ['completed', 'failed'].includes(file.status))).slice(0, 20);
  } catch { return []; }
}
export function saveHistory(history, storage = localStorage) {
  const safe = history.slice(0, 20).map(job => ({ id: job.id, repository: job.repository, jobPath: job.jobPath,
    fileNames: job.fileNames, createdAt: job.createdAt, acceptedAt: job.acceptedAt, accepted: Boolean(job.accepted),
    status: job.status, conclusion: job.conclusion || null, runId: job.runId || null, runAttempt: job.runAttempt || 1,
    commitSha: job.commitSha || null, phase: job.phase || '', error: job.error || '', cancelRequested: Boolean(job.cancelRequested),
    artifacts: (job.artifacts || []).map(a => ({ id: a.id, name: a.name, bytes: a.bytes, expired: a.expired, expiresAt: a.expiresAt })),
    resultFiles: (job.resultFiles || []).map(file => ({ fileName: file.fileName, status: file.status,
      videoBitrate: file.videoBitrate, frames: file.frames, duration: file.duration, pipelineFPS: file.pipelineFPS,
      error: typeof file.error === 'string' ? file.error.slice(0, 2500) : '' })),
  }));
  storage.setItem(HISTORY_KEY, JSON.stringify(safe));
}
