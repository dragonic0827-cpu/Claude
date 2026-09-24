// 선택: 건물·유적·다리·계단 정보 카드 + 선택한 대상 테두리 빛(프레넬) 강조
//
// createInfo({ items, sheets, onFocus }) → { select(id), clear(), current }
//   items: Map id → { id, type: 'building'|'landmark'|'bridge'|'stairs', def, object }
import * as THREE from 'three';
import { h, icon, confidenceBadge, CONFIDENCE, KIND_KO, announce } from './dom.js';

// 선택 강조: 같은 지오메트리를 가산 혼합 프레넬 셰이더로 한 번 더 (재질을 건드리지 않음)
const RIM_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const RIM_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 4.0);
  gl_FragColor = vec4(uColor * (0.045 + rim * 0.75) * uStrength, 1.0);
}`;
let rimMat = null;
function getRimMat() {
  if (rimMat) return rimMat;
  rimMat = new THREE.ShaderMaterial({
    name: 'SelectionRim',
    uniforms: { uColor: { value: new THREE.Color('#f2d488') }, uStrength: { value: 0.6 } },
    vertexShader: RIM_VERT, fragmentShader: RIM_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  return rimMat;
}

function addHighlight(root) {
  const added = [];
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.__rim && o.geometry?.attributes?.normal) meshes.push(o); });
  for (const m of meshes) {
    let ov;
    if (m.isInstancedMesh) {
      ov = new THREE.InstancedMesh(m.geometry, getRimMat(), m.count);
      ov.instanceMatrix = m.instanceMatrix;
      ov.frustumCulled = m.frustumCulled;
    } else {
      ov = new THREE.Mesh(m.geometry, getRimMat());
    }
    ov.userData.__rim = true;
    ov.raycast = () => {};
    ov.renderOrder = 5;
    m.add(ov);
    added.push(ov);
  }
  return () => { for (const ov of added) ov.parent?.remove(ov); };
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? (+v.toFixed(d)).toString() : '');

export function createInfo({ items, sheets, onFocus, onChange }) {
  const eyebrow = h('span', { class: 'eyebrow' });
  const name = h('h2', { class: 'info-name', id: 'info-title' });
  const hanja = h('p', { class: 'info-hanja', lang: 'zh-Hant' });
  const facts = h('dl', { class: 'info-facts' });
  const conf = h('div', { class: 'info-conf' });
  const desc = h('p', { class: 'info-desc' });
  const notesBody = h('p', { class: 'info-notes' });
  const notes = h('details', { class: 'info-more' }, h('summary', {}, '고증 메모'), notesBody);
  const focusBtn = h('button', { class: 'btn text-btn', type: 'button', onclick: () => current && onFocus?.(current) }, icon('fly'), h('span', {}, '가까이 가기'));

  sheets.create('info', {
    side: 'right', label: '정보', labelledBy: 'info-title', eyebrow,
    body: [name, hanja, facts, conf, desc, notes],
    footer: [h('div', { class: 'info-actions' }, focusBtn)],
    onClose: () => clear(true),
  });

  let current = null, removeHi = null;

  function fact(k, v) {
    if (v === undefined || v === null || v === '') return;
    facts.append(h('dt', {}, k), h('dd', {}, v));
  }

  function fill(it) {
    const d = it.def || {};
    const kind = it.type === 'building' ? KIND_KO[d.kind] || '전각' : KIND_KO[it.type] || '';
    eyebrow.textContent = kind;
    name.textContent = d.nameKo || d.id;
    hanja.textContent = d.nameHanja || '';
    hanja.hidden = !d.nameHanja;
    facts.replaceChildren();
    if (it.type === 'building') {
      if (d.baysFront && d.baysSide) fact('칸 수', `정면 ${d.baysFront}칸 × 측면 ${d.baysSide}칸${d.stories === 2 ? ' · 2층' : ''}`);
      if (d.columnSpanW && d.columnSpanD) fact('기둥 간 너비', `${fmt(d.columnSpanW)} m × ${fmt(d.columnSpanD)} m`);
      if (d.renamedTo) fact('1138년 개칭', d.renamedTo);
    } else if (it.type === 'stairs') {
      if (d.steps) fact('단 수', `${d.steps}단`);
      if (Number.isFinite(d.topY) && Number.isFinite(d.bottomY)) fact('높이', `${fmt(d.topY - d.bottomY)} m`);
      if (d.width) fact('너비', `${fmt(d.width)} m`);
    } else if (it.type === 'bridge') {
      if (d.length && d.width) fact('크기', `길이 ${fmt(d.length)} m × 너비 ${fmt(d.width)} m`);
    } else if (it.type === 'landmark' && d.dims) {
      if (d.dims.w && d.dims.h) fact('크기', `한 변 ${fmt(d.dims.w)} m · 높이 ${fmt(d.dims.h)} m`);
    }
    facts.hidden = !facts.children.length;
    conf.replaceChildren();
    if (d.confidence) {
      const c = CONFIDENCE[d.confidence];
      conf.append(confidenceBadge(d.confidence, d.confidenceNote), h('span', { class: 'conf-text' }, c ? c.text : ''));
      if (d.confidenceNote) conf.append(h('span', { class: 'conf-note' }, d.confidenceNote));
    }
    conf.hidden = !d.confidence;
    const description = d.descriptionKo || (it.type === 'stairs' ? d.notes : '') || '';
    desc.textContent = description;
    desc.hidden = !description;
    const noteText = it.type === 'stairs' ? '' : d.notes || '';
    notesBody.textContent = noteText;
    notes.hidden = !noteText;
    notes.open = false;
    focusBtn.hidden = !(it.object || Number.isFinite(d.cx ?? d.x));
  }

  function select(id) {
    const it = items.get(id);
    if (!it) { clear(); return false; }
    if (current !== it) {
      if (removeHi) removeHi();
      removeHi = it.object ? addHighlight(it.object) : null;
    }
    current = it;
    fill(it);
    sheets.open('info');
    announce(`${it.def?.nameKo || id} 정보`);
    onChange?.(it);
    return true;
  }

  function clear(fromClose = false) {
    if (removeHi) { removeHi(); removeHi = null; }
    const had = !!current;
    current = null;
    if (!fromClose) sheets.close('info');
    if (had) onChange?.(null);
  }

  return {
    select, clear,
    get current() { return current; },
    refreshHighlight() { if (current && removeHi) { removeHi(); removeHi = addHighlight(current.object); } },
  };
}
