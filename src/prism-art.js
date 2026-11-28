import brandMark from './prysm-mark.svg?raw';

export const BRAND_MARK_HTML = brandMark;

const subtract = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = v => v.map(n => n / Math.hypot(...v));
const number = n => Number(n.toFixed(5));

// One rigid square pyramid: a shared apex, four equal sides, and a coplanar
// square base. Each SVG is positioned once; only the parent rotates.
function triangleFace(a, b, c, index, base) {
  let normal = unit(cross(subtract(b,a), subtract(c,a)));
  const centroid = a.map((v,i) => (v+b[i]+c[i])/3);
  if (dot(normal,centroid) < 0) { [b,c]=[c,b]; normal=unit(cross(subtract(b,a),subtract(c,a))); }
  const u = unit(subtract(b,a)), v = cross(normal,u);
  const length = Math.hypot(...subtract(b,a)), cx = dot(subtract(c,a),u), height = dot(subtract(c,a),v);
  const left = Math.min(0,cx), width = Math.max(length,cx)-left;
  const origin = a.map((n,i) => n+left*u[i]);
  const matrix = [...u,0,...v,0,...normal,0,...origin,1].map(number).join(',');
  const point = (alongB,alongC) => [number(-left+length*alongB+cx*alongC),number(height*alongC)];
  const points = [point(0,0),point(1,0),point(0,1)].flat().join(' ');
  const mix = (b,c) => point(b,c).join(' ');
  const id = 'prysm-facet-' + index, midpoint = point(.5,.5);
  // Distinct, fixed materials make a full turn readable instead of producing
  // four identical flashes from an otherwise perfectly symmetric pyramid.
  const [light,mid,dark] = [['#f5e4ff','#b09ae9','#65509f'],['#dceeff','#9caeea','#4f669d'],
    ['#eeddff','#ac9ae6','#57479c'],['#d9f3ff','#94ade2','#52689b']][index%4];
  const gloss = [.16,.28,.98,.42][index%4];
  const fill = base ?
    '<stop stop-color="#b7beff" stop-opacity=".12"/><stop offset="1" stop-color="#7f72db" stop-opacity=".14"/>' :
    '<stop stop-color="' + light + '" stop-opacity=".46"/><stop offset=".42" stop-color="' + mid + '" stop-opacity=".25"/><stop offset="1" stop-color="' + dark + '" stop-opacity=".18"/>';
  const structure = base ? '' :
    '<path d="M' + mix(.68,0) + 'L' + mix(0,.68) + 'M' + mix(.9,0) + 'L' + mix(0,.9) + '" stroke="#c1e6ff" stroke-width=".75" stroke-opacity=".28" fill="none"/>';
  const highlight = base ? '' :
    '<polygon points="' + [point(.02,.012),point(.955,.018),point(.7,.27),point(.018,.035)].flat().join(' ') + '" fill="url(#' + id + '-gloss)"/>';
  return '<svg class="prism-face' + (base ? ' prism-face-base' : '') + '" data-face-kind="' + (base ? 'base' : 'side') + '" style="width:' + number(width) + 'px;height:' + number(height) + 'px;transform:matrix3d(' + matrix + ')" viewBox="0 0 ' + number(width) + ' ' + number(height) + '" aria-hidden="true"><defs>' +
    '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + number(-left) + '" y1="0" x2="' + midpoint[0] + '" y2="' + midpoint[1] + '">' + fill + '</linearGradient>' +
    '<linearGradient id="' + id + '-edge" gradientUnits="userSpaceOnUse" x1="' + number(-left) + '" y1="0" x2="' + midpoint[0] + '" y2="' + midpoint[1] + '"><stop stop-color="#efa9ff"/><stop offset=".3" stop-color="#b8a1ff"/><stop offset=".6" stop-color="#87e9ff"/><stop offset=".82" stop-color="#abf4df"/><stop offset="1" stop-color="#f4e9a9"/></linearGradient>' +
    '<linearGradient id="' + id + '-gloss"><stop stop-color="#fff" stop-opacity="' + number(gloss) + '"/><stop offset=".38" stop-color="#f7fcff" stop-opacity="' + number(gloss*.84) + '"/><stop offset="1" stop-color="#c4eaff" stop-opacity="' + number(gloss*.2) + '"/></linearGradient></defs>' +
    '<polygon points="' + points + '" fill="url(#' + id + ')"/>' + structure + highlight +
    '<polygon points="' + points + '" fill="none" stroke="url(#' + id + '-edge)" stroke-width="' + (base ? '.8' : '1.8') + '" stroke-opacity="' + (base ? '.4' : '.85') + '" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}

function crystalFaces() {
  const apex = [0,-132,0], center = [0,82,0];
  const corners = [[-74,82,-74],[74,82,-74],[74,82,74],[-74,82,74]];
  return corners.map((corner,index) => triangleFace(apex,corner,corners[(index+1)%4],index,false)).join('') +
    corners.map((corner,index) => triangleFace(center,corner,corners[(index+1)%4],index+4,true)).join('');
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
