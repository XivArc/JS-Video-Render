import { createCloudJob } from './cloud-job.js';
import { DEFAULT_REPOSITORY, githubConfig, makeGithubClient, cloudJobActive, workflowUrl, runUrl, artifactUrl,
  loadConnection, saveConnection, forgetConnection, loadHistory, saveHistory } from './github-cloud.js';

export const CLOUD_PANEL_HTML = '<section id="cloud-panel" class="cloud-panel" aria-labelledby="cloud-title" hidden>' +
  '<div class="panel-title"><span class="section-number">CLOUD</span><h2 id="cloud-title">GitHub cloud render</h2></div>' +
  '<p>Drop your Canvas JavaScript files and click Render. Uploading and starting the cloud engine happen automatically.</p>' +
  '<p id="cloud-connection" class="cloud-connection" role="status">Connect GitHub once to enable cloud rendering.</p>' +
  '<details id="github-settings"><summary>GitHub connection · one-time setup</summary>' +
  '<div class="github-fields"><label>Repository<input id="github-repository" value="XivArc/JS-Video-Render" autocomplete="off" spellcheck="false"></label>' +
  '<label>GitHub personal access token<input id="github-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label></div>' +
  '<label class="github-remember"><input id="github-remember" type="checkbox">Remember this connection on my own device</label>' +
  '<p class="field-note">Remembering includes the token in this browser’s storage. Otherwise it stays in this tab. Restrict the token to this repository with Contents and Actions set to Read and write.</p>' +
  '<div class="cloud-actions"><button id="github-connect" type="button" class="secondary-button">Connect GitHub</button>' +
  '<button id="github-disconnect" type="button" class="secondary-button" hidden>Disconnect</button>' +
  '<a id="github-create-token" class="secondary-button" target="_blank" rel="noopener noreferrer">Create GitHub token ↗</a></div></details>' +
  '<div class="cloud-jobs-heading"><h3>Recent cloud jobs</h3><button id="cloud-refresh" type="button" class="secondary-button">Refresh status</button></div>' +
  '<p id="cloud-empty" class="field-note">Your cloud renders will appear here. After GitHub accepts a run, you can close the browser or switch off your laptop.</p>' +
  '<ol id="cloud-jobs" class="cloud-jobs"></ol>' +
  '<p class="field-note cloud-footnote">Up to 10 files, 5 MB each, and 20 MB per batch. Videos are available for 3 days. Uploaded animation source and result reports are committed to your repository; a public repository makes them public. Use trusted, self-contained Canvas JS.</p></section>';

function tokenUrl(repository) {
  const owner = repository.split('/')[0];
  const params = new URLSearchParams({ name: 'Canvas Video Studio', target_name: owner, expires_in: '90', contents: 'write', actions: 'write' });
  return 'https://github.com/settings/personal-access-tokens/new?' + params;
}
const statusText = job => job.status === 'completed' ? (job.conclusion === 'success' ? 'Completed' : job.conclusion === 'cancelled' ? 'Cancelled' : 'Finished · check file results') :
  ({ uploading: 'Uploading animations', starting: 'Starting cloud render', queued: 'Queued in GitHub', in_progress: job.phase || 'Rendering in GitHub',
    uncertain: 'Checking whether GitHub accepted the render', locating: 'Locating the accepted run', upload_failed: 'Unable to start', unconfirmed: 'Run not confirmed',
    waiting: 'Waiting in GitHub', pending: 'Waiting in GitHub', requested: 'Waiting in GitHub' })[job.status] || 'Checking job';

export function makeCloudControls({ onChange, onRun, onReport, onConnect }) {
  const $ = id => document.getElementById(id);
  let client = null, config = loadConnection(), connecting = false, submitting = false, polling = false, timer = null;
  let repository = config?.repository || DEFAULT_REPOSITORY;
  let history = loadHistory(repository);
  let current = history.find(cloudJobActive) || history[0] || null;
  $('github-repository').value = repository;
  $('github-create-token').href = tokenUrl(repository);
  if (config) { $('github-token').value = config.token; $('github-remember').checked = true; }

  const store = () => { try { saveHistory(history); } catch { $('cloud-empty').textContent = 'Browser storage is unavailable. Keep the GitHub run link to find this render later.'; } };
  const running = () => Boolean(client && current && cloudJobActive(current));
  const changed = () => { store(); render(); onChange?.(); };
  const link = (text, href, className = 'secondary-button') => {
    const a = document.createElement('a'); a.textContent = text; a.href = href; a.className = className;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  };
  function render() {
    $('github-connect').disabled = connecting || submitting;
    $('github-disconnect').hidden = !client;
    $('github-disconnect').disabled = submitting || connecting;
    $('cloud-refresh').disabled = !client || polling || submitting || !history.length;
    $('cloud-empty').hidden = Boolean(history.length);
    $('cloud-jobs').replaceChildren();
    for (const job of history) {
      const row = document.createElement('li'); row.className = 'cloud-job'; row.dataset.jobId = job.id;
      row.dataset.status = job.status;
      const header = document.createElement('div'); header.className = 'cloud-job-header';
      const title = document.createElement('strong'); title.textContent = job.fileNames.length + ' video' + (job.fileNames.length > 1 ? 's' : '') + ' · ' + statusText(job);
      const when = document.createElement('span'); when.className = 'muted'; when.textContent = new Date(job.createdAt).toLocaleString();
      header.append(title, when); row.append(header);
      const names = document.createElement('p'); names.className = 'cloud-job-names'; names.textContent = job.fileNames.join(' · '); row.append(names);
      if (job.error) { const p = document.createElement('p'); p.className = 'cloud-job-error'; p.textContent = job.error; row.append(p); }
      if (job.resultFiles?.length) {
        const files = document.createElement('ul'); files.className = 'cloud-results';
        for (const file of job.resultFiles) {
          const item = document.createElement('li'); item.dataset.status = file.status;
          const result = document.createElement('strong'); result.textContent = (file.status === 'completed' ? '✓ ' : '✕ ') + file.fileName;
          const detail = document.createElement('span'); detail.textContent = file.status === 'completed' ?
            (file.videoBitrate / 1e6).toFixed(3) + ' Mbps · ' + file.frames + ' frames · ' + file.duration + ' s · ' + Number(file.pipelineFPS).toFixed(2) + ' render FPS' : file.error || 'Render failed.';
          item.append(result, detail); files.append(item);
        }
        row.append(files);
      }
      const actions = document.createElement('div'); actions.className = 'cloud-actions';
      for (const artifact of job.artifacts || []) {
        const expired = artifact.expired || Date.parse(artifact.expiresAt) <= Date.now();
        if (!expired) actions.append(link('Download videos ↓', artifactUrl(repository, job.runId, artifact.id), 'download-link'));
        else { const p = document.createElement('span'); p.className = 'field-note'; p.textContent = 'Video download expired. Render again to create a new copy.'; actions.append(p); }
      }
      if (job.runId) actions.append(link('View cloud run ↗', runUrl(repository, job.runId)));
      else if (cloudJobActive(job) || job.status === 'unconfirmed') actions.append(link('Check in GitHub ↗', workflowUrl(repository)));
      if (cloudJobActive(job) && !job.runId && !submitting && Date.now() - Date.parse(job.createdAt) > 120000) {
        const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'secondary-button'; stop.textContent = 'Stop checking';
        stop.addEventListener('click', () => {
          job.status = 'unconfirmed'; job.error = 'Run not confirmed. Check GitHub before starting a new batch.';
          changed(); onRun?.(job); schedule();
        });
        actions.append(stop);
      }
      if (!cloudJobActive(job)) {
        const hide = document.createElement('button'); hide.type = 'button'; hide.className = 'cloud-hide'; hide.textContent = 'Hide';
        hide.addEventListener('click', () => { history = history.filter(item => item !== job); if (current === job) current = history.find(cloudJobActive) || history[0] || null; changed(); });
        actions.append(hide);
      }
      row.append(actions); $('cloud-jobs').append(row);
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (running()) timer = setTimeout(() => void refresh(), document.hidden ? 30000 : 10000);
  }
  async function refresh(record = current) {
    if (!client || !record || polling || submitting) return;
    const activeClient = client;
    clearTimeout(timer); polling = true; render();
    try {
      let run;
      if (!record.runId) {
        run = await activeClient.findRun(record);
        if (!run) return;
        record.runId = Number(run.id); record.accepted = true;
      } else run = await activeClient.getRun(record.runId);
      if (client !== activeClient) return;
      if (record.runAttempt !== Number(run.run_attempt || 1)) { record.resultFiles = []; record.artifacts = []; }
      record.status = run.status; record.conclusion = run.conclusion; record.runAttempt = Number(run.run_attempt || 1);
      record.error = '';
      if (run.status === 'in_progress') record.phase = record.cancelRequested ? 'Cancellation requested' : await activeClient.getPhase(record.runId);
      if (run.status === 'completed') {
        // Fetch separately so a missing optional website report never hides the
        // artifact download or turns an unknown file result into a false check.
        try {
          const report = await activeClient.getReport(record);
          if (report) { record.resultFiles = report.files; if (client === activeClient) onReport?.(report, record); }
          else record.error = 'Detailed file results are unavailable here. Open the GitHub run; completed downloads, if any, remain below.';
        } catch (error) { record.error = error.message; }
        try { record.artifacts = await activeClient.getArtifacts(record); }
        catch (error) { record.error += (record.error ? ' ' : '') + error.message; }
      }
      if (client === activeClient) onRun?.(record);
    } catch (error) { record.error = error.message; }
    finally { polling = false; if (client === activeClient) changed(); schedule(); }
  }
  async function connect() {
    if (connecting || submitting) return;
    connecting = true; render(); onChange?.();
    $('cloud-connection').textContent = 'Connecting to GitHub…';
    try {
      const next = githubConfig($('github-repository').value, $('github-token').value);
      const candidate = makeGithubClient(next);
      const info = await candidate.connect();
      config = next; client = candidate; repository = next.repository;
      history = loadHistory(repository); current = history.find(cloudJobActive) || history[0] || null;
      let remembered = $('github-remember').checked;
      try { saveConnection(next, remembered); } catch { remembered = false; }
      $('cloud-connection').textContent = 'Connected · ' + repository + ' · ' + (remembered ? 'remembered on this device' : 'this tab only') +
        '. Drop files and click Render. ' + (info.private ? 'Repository is private.' : 'Uploaded animation source is public.');
      $('github-settings').open = false;
      onConnect?.();
      if (current?.runId || cloudJobActive(current)) void refresh();
    } catch (error) {
      client = null; $('github-settings').open = true; $('cloud-connection').textContent = error.message;
    } finally { connecting = false; changed(); }
  }
  $('github-connect').addEventListener('click', () => void connect());
  $('github-repository').addEventListener('input', () => {
    try { $('github-create-token').href = tokenUrl($('github-repository').value); } catch {}
  });
  $('github-disconnect').addEventListener('click', () => {
    if (submitting) return;
    client = null; config = null; clearTimeout(timer); $('github-token').value = ''; $('github-remember').checked = false;
    try { forgetConnection(); } catch {}
    $('cloud-connection').textContent = 'Disconnected. Cloud jobs already accepted by GitHub keep running.';
    $('github-settings').open = true; changed();
  });
  $('cloud-refresh').addEventListener('click', async () => {
    for (const record of history) if (record.runId || cloudJobActive(record)) await refresh(record);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && running()) void refresh(); });
  window.addEventListener('online', () => { if (running()) void refresh(); });
  render();
  return {
    get running() { return running(); },
    get connecting() { return connecting; },
    get accepted() { return Boolean(current?.accepted); },
    get canCancel() { return running() && Boolean(current.runId) && !current.cancelRequested; },
    get connected() { return Boolean(client); },
    openConnection() {
      $('cloud-panel').hidden = false; $('github-settings').open = true;
      $('github-settings').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('github-token').focus({ preventScroll: true });
    },
    async submit(preferences, sources) {
      if (!client) { this.openConnection(); throw new Error('Connect GitHub once, then drop files and click Render.'); }
      if (running()) throw new Error('Wait for the current cloud batch to finish before starting another.');
      const job = createCloudJob(preferences, sources);
      const record = { id: job.id, repository, jobPath: 'cloud/jobs/' + job.id + '.json',
        fileNames: job.files.map(file => file.fileName), createdAt: new Date().toISOString(), status: 'uploading', accepted: false,
        runId: null, runAttempt: 1, artifacts: [], resultFiles: [] };
      current = record; history.unshift(record); history = history.slice(0, 20);
      submitting = true; changed(); onRun?.(record, true);
      try {
        await client.submit(job, record, changedRecord => { changed(); onRun?.(changedRecord); });
      } catch (error) { record.status = 'upload_failed'; record.error = error.message; onRun?.(record); throw error; }
      finally { submitting = false; changed(); }
      schedule(); void refresh();
      return record;
    },
    async cancel() {
      if (!this.canCancel) return;
      try {
        await client.cancel(current.runId); current.cancelRequested = true;
        current.phase = 'Cancellation requested'; changed(); onRun?.(current); schedule();
      } catch (error) { current.error = error.message; changed(); }
    },
    init() { if (config) void connect(); else if (history.length) onRun?.(current); },
  };
}
