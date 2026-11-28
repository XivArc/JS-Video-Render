import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function publishReport(report, env, fetchImpl = fetch) {
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  const runId = Number(env.GITHUB_RUN_ID), attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !token ||
      !Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0 ||
      !/^cloud-[a-z0-9-]{1,70}$/.test(report.id || '')) throw new Error('GitHub result publishing is not configured.');
  const text = JSON.stringify({ ...report, githubRunId: runId, githubRunAttempt: attempt });
  if (Buffer.byteLength(text) > 150000) throw new Error('Result report exceeds 150 KB.');
  const url = 'https://api.github.com/repos/' + repository + '/contents/cloud/results/' + report.id + '.json';
  const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json', 'User-Agent': 'canvas-video-studio' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await fetchImpl(url + '?ref=main', { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (current.status !== 404 && !current.ok) throw new Error('Unable to read the previous result report (HTTP ' + current.status + ').');
    const sha = current.ok ? (await current.json()).sha : undefined;
    const saved = await fetchImpl(url, { method: 'PUT', headers, redirect: 'error', signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ branch: 'main', message: 'Cloud render results ' + report.id,
        content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) }) });
    if (saved.ok) return;
    if (saved.status !== 409) throw new Error('Unable to publish the result report (HTTP ' + saved.status + ').');
  }
  throw new Error('Repository changed repeatedly while publishing results. Videos remain in Artifacts.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const report = JSON.parse(await readFile(resolve(root, 'cloud-output/report.json'), 'utf8'));
    await publishReport(report, process.env);
    console.log('[cloud] Result report published.');
  } catch (error) {
    console.error('[cloud] ' + error.message + ' Download the report from Artifacts if publishing is unavailable.');
    process.exitCode = 1;
  }
}
