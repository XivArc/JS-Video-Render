import brandMark from './prysm-mark.svg?raw';

export const BRAND_MARK_HTML = brandMark;

const subtract = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = v => v.map(n => n / Math.hypot(...v));
const number = n => Number(n.toFixed(5));

// Each SVG is a real triangular face, positioned in CSS 3D once. The compositor
// rotates the crystal; no animation frames, timers, or video resources are used.
function crystalFaces() {
  const top = [0, -126, 0], bottom = [0, 114, 0];
  const ring = [[-91, 56, 0], [0, 56, 69], [91, 56, 0], [0, 56, -69]];
  const colors = [['#f6edff','#ad81df','#655caa'], ['#e4fcff','#7ecfdd','#416ca7'],
    ['#c5d8ff','#8b8edc','#54439c'], ['#fdeaff','#cc8adf','#7450ac']];
  const html = [];
  for (let side = 0; side < 4; side++) for (let cap = 0; cap < 2; cap++) {
    let a = cap ? bottom : top, b = ring[side], c = ring[(side + 1) % 4];
    let normal = unit(cross(subtract(b,a), subtract(c,a)));
    const centroid = a.map((v,i) => (v+b[i]+c[i])/3);
    if (dot(normal,centroid) < 0) { [b,c]=[c,b]; normal=unit(cross(subtract(b,a),subtract(c,a))); }
    const u = unit(subtract(b,a)), v = cross(normal,u);
    const length = Math.hypot(...subtract(b,a)), cx = dot(subtract(c,a),u), height = dot(subtract(c,a),v);
    const left = Math.min(0,cx), width = Math.max(length,cx)-left;
    const origin = a.map((n,i) => n+left*u[i]);
    const matrix = [...u,0,...v,0,...normal,0,...origin,1].map(number).join(',');
    const points = [-left,0,length-left,0,cx-left,height].map(number);
    const id = 'prysm-facet-' + side + '-' + cap, [light, mid, dark] = colors[side];
    html.push('<svg class="prism-face' + (cap ? ' prism-face-base' : '') + '" style="width:' + number(width) + 'px;height:' + number(height) + 'px;transform:matrix3d(' + matrix + ')" viewBox="0 0 ' + number(width) + ' ' + number(height) + '" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + light + '"/><stop offset=".46" stop-color="' + mid + '"/><stop offset="1" stop-color="' + dark + '"/></linearGradient><clipPath id="' + id + '-clip"><polygon points="' + points.join(' ') + '"/></clipPath></defs><polygon points="' + points.join(' ') + '" fill="url(#' + id + ')" stroke="#e9f2ff" stroke-opacity=".62" stroke-width="1.3" vector-effect="non-scaling-stroke"/><g clip-path="url(#' + id + '-clip)" fill="none" stroke="#fff" stroke-linecap="round"><path d="M-30 ' + number(height*.28) + ' ' + number(width+20) + ' ' + number(height*.56) + '" stroke-opacity=".32" stroke-width="7"/><path d="M-30 ' + number(height*.35) + ' ' + number(width+20) + ' ' + number(height*.63) + '" stroke-opacity=".16" stroke-width="3"/></g></svg>');
  }
  return html.join('');
}

export const PRISM_ART_HTML = '<div class="prism-art" data-render-state="idle"><div class="prism-stage" aria-hidden="true"><div class="prism-aura"></div><div class="prism-orbit orbit-one"></div><div class="prism-orbit orbit-two"></div><div class="prism-crystal">' + crystalFaces() + '</div><div class="prism-ground"></div><i class="prism-spark spark-one"></i><i class="prism-spark spark-two"></i></div><span class="prism-caption">CREATE / RENDER / EXPORT</span><span class="prism-state" role="status" aria-live="polite"><i aria-hidden="true"></i><span>STUDIO READY</span></span></div>';

export function makePrismAnimation(element) {
  let current = 'idle';
  const labels = { idle:'STUDIO READY', queued:'CLOUD QUEUED', rendering:'RENDERING' };
  return {
    setState(state) {
      if (state === current) return;
      current = state;
      element.dataset.renderState = state;
      element.classList.toggle('is-rendering', state === 'rendering');
      element.querySelector('.prism-state > span').textContent = labels[state];
    },
  };
}
