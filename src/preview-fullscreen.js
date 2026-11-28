const expandIcon = '<svg class="fullscreen-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
const shrinkIcon = '<svg class="fullscreen-shrink" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/></svg>';

export const fullscreenButton = id => '<button id="' + id + '" type="button" class="fullscreen-button" aria-label="Enter fullscreen" aria-pressed="false" title="Fullscreen (F)">' + expandIcon + shrinkIcon + '<span>Fullscreen</span></button>';

let windowFullscreen;

// The existing canvas, play button, timeline, and clock move as one viewport.
// Playback and seeking keep their original handlers and their current time.
export function makePreviewFullscreen(viewport, button) {
  let marker, oldOverflow, previousFocus, wasActive = false, switching = false;
  const active = () => document.fullscreenElement === viewport || Boolean(marker);
  const restoreFocus = () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  function sync() {
    const expanded = active();
    viewport.classList.toggle('is-fullscreen', expanded);
    viewport.dataset.fullscreenMode = expanded ? marker ? 'window' : 'native' : 'off';
    viewport.setAttribute('role', expanded ? 'dialog' : 'region');
    if (expanded) viewport.setAttribute('aria-modal', 'true');
    else viewport.removeAttribute('aria-modal');
    button.setAttribute('aria-pressed', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = expanded ? 'Exit fullscreen (Esc or F)' : 'Fullscreen (F)';
    button.querySelector('span').textContent = expanded ? 'Exit fullscreen' : 'Fullscreen';
    if (expanded && !wasActive) viewport.focus({ preventScroll: true });
    if (!expanded && wasActive) restoreFocus();
    wasActive = expanded;
  }
  async function exit() {
    if (marker) {
      marker.replaceWith(viewport);
      marker = null;
      windowFullscreen = null;
      document.body.style.overflow = oldOverflow;
      sync();
    } else if (document.fullscreenElement === viewport) {
      try { await document.exitFullscreen(); } catch { /* The browser may have exited first. */ }
      sync();
    }
  }
  async function enter() {
    if (switching || active()) return;
    switching = true;
    previousFocus = document.activeElement;
    try {
      if (windowFullscreen) await windowFullscreen.exit();
      if (typeof viewport.requestFullscreen === 'function' && document.fullscreenEnabled !== false) {
        try { await viewport.requestFullscreen({ navigationUI: 'hide' }); sync(); return; }
        catch { /* Embedded/mobile browsers can deny the native API. Use a full-window view. */ }
      }
      marker = document.createComment('preview viewport');
      viewport.before(marker);
      oldOverflow = document.body.style.overflow;
      document.body.append(viewport);
      document.body.style.overflow = 'hidden';
      windowFullscreen = { exit };
      sync();
    } finally { switching = false; }
  }
  const toggle = () => active() ? exit() : enter();
  button.addEventListener('click', () => void toggle());
  viewport.querySelector('.stage').addEventListener('dblclick', () => void toggle());
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && marker) { event.preventDefault(); void exit(); }
  });
  viewport.addEventListener('keydown', event => {
    if (!active() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab') {
      const items = [...viewport.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(item => item.getClientRects().length);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = index < 0 ? event.shiftKey ? items.length - 1 : 0 :
        (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault(); void toggle();
    } else if (event.key === ' ' && !event.target.closest('button, input')) {
      event.preventDefault(); viewport.querySelector('.icon-button:not(:disabled)')?.click();
    } else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.target.closest('input')) {
      const seek = viewport.querySelector('input[type="range"]');
      if (seek.disabled) return;
      event.preventDefault();
      seek.value = Math.max(Number(seek.min), Math.min(Number(seek.max), Number(seek.value) + (event.key === 'ArrowRight' ? 5 : -5)));
      seek.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  sync();
  return { get active() { return active(); }, exit };
}
