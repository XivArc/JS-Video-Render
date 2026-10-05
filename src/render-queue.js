export const MAX_QUEUE_FILES = 10;

const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/></svg>';
const labels = { pending: 'Waiting', rendering: 'Rendering', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };

export function createRenderQueue(panel, onPreview, onRepair, onRestore) {
  const list = panel.querySelector('#queue-list');
  const count = panel.querySelector('#queue-count');
  const summary = panel.querySelector('#queue-summary');
  let jobs = [];
  let blocked = false;

  function refreshSummary() {
    const totals = Object.fromEntries(Object.keys(labels).map(status => [status, jobs.filter(job => job.status === status).length]));
    count.textContent = jobs.length + ' / ' + MAX_QUEUE_FILES + ' files';
    summary.textContent = Object.keys(labels).filter(status => totals[status]).map(status =>
      totals[status] + ' ' + (status === 'pending' ? 'waiting' : status)).join(' · ');
  }

  function update(job) {
    const row = job.row;
    row.dataset.status = job.status;
    const icon = row.querySelector('.queue-icon');
    if (job.status === 'completed' || job.status === 'failed') icon.innerHTML = checkIcon;
    else if (job.status === 'rendering') icon.innerHTML = '<span class="queue-spinner" aria-hidden="true"></span>';
    else icon.textContent = String(job.index + 1).padStart(2, '0');
    row.querySelector('.queue-state').textContent = labels[job.status];
    row.querySelector('.queue-detail').textContent = job.detail || 'Ready to render.';
    row.querySelector('.queue-repair-message').textContent = job.repairMessage || '';
    row.querySelector('.queue-repair').disabled = blocked;
    row.querySelector('.queue-restore').disabled = blocked;
    row.querySelector('.queue-restore').hidden = !job.repaired;
    const repaired = row.querySelector('.queue-repaired-download');
    repaired.hidden = !job.repairedUrl;
    if (job.repairedUrl) {
      repaired.href = job.repairedUrl;
      repaired.download = job.file.name.replace(/\.js$/i, '') + '_repaired.js';
    } else repaired.removeAttribute('href');
    const preview = row.querySelector('.queue-preview');
    preview.disabled = blocked;
    preview.setAttribute('aria-label', 'Preview ' + job.file.name);
    const download = row.querySelector('.queue-download');
    download.hidden = !job.downloadUrl;
    if (job.downloadUrl) {
      download.href = job.downloadUrl;
      download.download = job.outputName;
      download.setAttribute('aria-label', 'Download ' + job.outputName);
    } else download.removeAttribute('href');
    refreshSummary();
  }

  function release(job, all = false) {
    if (job.downloadUrl) URL.revokeObjectURL(job.downloadUrl);
    job.downloadUrl = null;
    if (all && job.repairedUrl) { URL.revokeObjectURL(job.repairedUrl); job.repairedUrl = null; }
  }

  return {
    replace(files) {
      jobs.forEach(job => release(job, true));
      list.replaceChildren();
      jobs = files.map((file, index) => {
        const row = document.createElement('li');
        row.className = 'queue-item';
        row.innerHTML = '<span class="queue-icon"></span><div class="queue-content"><div class="queue-file-line"><strong class="queue-file"></strong><span class="queue-state"></span></div><p class="queue-detail"></p><p class="queue-repair-message" aria-live="polite"></p></div><div class="queue-actions"><button class="queue-preview" type="button">Preview</button><button class="queue-repair" type="button">Auto Repair</button><a class="queue-repaired-download" hidden>Download repaired JS</a><button class="queue-restore" type="button" hidden>Restore original</button><a class="queue-download" hidden>Download <span aria-hidden="true">↓</span></a></div>';
        row.querySelector('.queue-file').textContent = file.name;
        const job = { file, index, row, source: null, meta: null, status: 'pending', detail: '', downloadUrl: null, outputName: '', result: null,
          originalSource: null, repaired: false, repairedUrl: null, repairMessage: '' };
        row.querySelector('.queue-preview').addEventListener('click', () => { if (!blocked) void onPreview(job); });
        row.querySelector('.queue-repair').addEventListener('click', () => { if (!blocked) void onRepair(job); });
        row.querySelector('.queue-restore').addEventListener('click', () => { if (!blocked) void onRestore(job); });
        list.append(row);
        return job;
      });
      jobs.forEach(update);
      panel.hidden = !jobs.length;
      return jobs;
    },
    reset() {
      jobs.forEach(job => {
        release(job);
        job.status = 'pending';
        job.detail = 'Ready to render.';
        job.result = null;
        update(job);
      });
    },
    setBlocked(value) {
      blocked = value;
      list.querySelectorAll('button').forEach(button => { button.disabled = value; });
    },
    update,
  };
}

export function outputFileName(sourceName, settings) {
  const stem = sourceName.replace(/\.js$/i, '').replace(/[^\w.-]+/g, '_').replace(/^\.+$/, '') || 'animation';
  return stem + '_' + settings.width + 'x' + settings.height + '_' + settings.fps + 'fps.' + settings.format;
}

export function uniqueOutputName(name, used) {
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot);
  const extension = name.slice(dot);
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = stem + '_' + suffix++ + extension;
  used.add(candidate.toLowerCase());
  return candidate;
}
