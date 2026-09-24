// 선택: 건물·지점·다리·계단·회랑·담장 정보 카드 + 선택한 대상 테두리 빛(프레넬) 강조
//
// createInfo({ items, sheets, onFocus, onChange }) → { select(id, { min }), clear(), current, refreshHighlight() }
//   items: Map id → { id, type: 'building'|'landmark'|'bridge'|'stairs'|'corridor'|'wall', def, object, center? }
import * as THREE from 'three';
import { h, icon, confidenceBadge, CONFIDENCE, KIND_KO, announce, nobreak, cleanNote, confidenceOf } from './dom.js';

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
// '확실(칸수)/추정(치수)' → '칸수: 확실 · 치수: 추정'
const noteText = (n) => {
  const parts = String(n || '').split('/').map((p) => p.trim().match(/^(확실|추정|불확실)\s*\((.+)\)$/));
  return parts.length && parts.every(Boolean) ? parts.map((m) => `${m[2]}: ${m[1]}`).join(' · ') : String(n || '');
};

export function createInfo({ items, sheets, onFocus, onChange }) {
  const eyebrowKind = h('span', {});
  const eyebrowName = h('span', { class: 'min-name' });   // 접힌 카드에서만 보이는 이름
  const eyebrow = h('span', { class: 'eyebrow' }, eyebrowKind, eyebrowName);
  const name = h('h2', { class: 'info-name', id: 'info-title' });
  const hanja = h('p', { class: 'info-hanja', lang: 'zh-Hant' });
  const facts = h('dl', { class: 'info-facts' });
  const conf = h('div', { class: 'info-conf' });
  const desc = h('p', { class: 'info-desc' });
  const notesBody = h('p', { class: 'info-notes' });
  const notes = h('details', { class: 'info-more' }, h('summary', {}, '고증 메모'), notesBody);
  const focusBtn = h('button', { class: 'btn text-btn', type: 'button', onclick: () => current && onFocus?.(current) }, icon('fly'), h('span', {}, '가까이 가기'));

  sheets.create('info', {
    side: 'right', label: '정보 카드', labelledBy: 'info-title', eyebrow,
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
    const kind = it.type === 'building' ? KIND_KO[d.kind] || '전각'
      : it.type === 'wall' ? KIND_KO[d.kind === 'palace' ? 'palaceWall' : d.kind === 'city' ? 'cityWall' : 'wall']
        : KIND_KO[it.type] || '';
    eyebrowKind.textContent = kind;
    eyebrowName.textContent = ` · ${d.nameKo || d.id}`;
    name.textContent = d.nameKo || d.id;
    hanja.textContent = d.nameHanja || '';
    hanja.hidden = !d.nameHanja;
    facts.replaceChildren();
    if (it.type === 'building') {
      if (d.baysFront && d.baysSide) fact('칸 수', `정면 ${d.baysFront}칸 × 측면 ${d.baysSide}칸${d.stories === 2 ? ' · 2층' : ''}`);
      if (d.columnSpanW && d.columnSpanD) fact('평면(기둥 중심)', `${fmt(d.columnSpanW, 2)} m × ${fmt(d.columnSpanD, 2)} m`);
      if (d.renamedTo) fact('뒤의 이름', d.renamedTo);
    } else if (it.type === 'stairs') {
      if (d.steps) fact('단 수', `${d.steps}단`);
      const hgt = Number.isFinite(d.recordedHeight) ? d.recordedHeight : Number.isFinite(d.topY) && Number.isFinite(d.bottomY) ? d.topY - d.bottomY : NaN;
      if (Number.isFinite(hgt)) fact('높이', `${fmt(hgt, 2)} m`);
      if (d.width) fact('너비', `${fmt(d.width, 2)} m`);
    } else if (it.type === 'bridge') {
      if (d.length && d.width) fact('크기', `길이 ${fmt(d.length)} m × 너비 ${fmt(d.width)} m`);
    } else if (it.type === 'landmark' && d.dims) {
      if (d.dims.w && d.dims.h) fact('크기', `한 변 ${fmt(d.dims.w)} m · 높이 ${fmt(d.dims.h)} m`);
    } else if (it.type === 'wall') {
      if (d.height) fact('높이', `${fmt(d.height)} m${d.thickness ? ` · 두께 ${fmt(d.thickness)} m` : ''}`);
    } else if (it.type === 'corridor') {
      if (d.width) fact('너비', `${fmt(d.width)} m${d.double ? ' · 복랑(두 줄)' : ''}`);
    }
    facts.hidden = !facts.children.length;
    conf.replaceChildren();
    const cf = confidenceOf(d);
    if (cf.confidence) {
      const c = CONFIDENCE[cf.confidence];
      // 부분마다 신뢰도가 다르면(예: 칸수 확실 / 치수 추정) 일반 설명 대신 그 메모를 보임
      conf.append(confidenceBadge(cf.confidence, cf.note), h('span', { class: 'conf-text' }, cf.note ? noteText(cf.note) : c ? c.text : ''));
    }
    conf.hidden = !cf.confidence;
    // 고증 메모: 독자용 notesKo 가 있으면 그것, 없으면 생성기 메모에서 코드 식별자를 걷어 냄
    const note = cleanNote(d.notesKo ?? d.notes);
    const description = d.descriptionKo || (it.type === 'stairs' ? note : '') || '';
    desc.textContent = nobreak(description);
    desc.hidden = !description;
    const more = it.type === 'stairs' && !d.descriptionKo ? '' : note;
    notesBody.textContent = nobreak(more);
    notes.hidden = !more;
    notes.open = false;
    focusBtn.hidden = !(it.object || it.center || Number.isFinite(d.cx ?? d.x));
  }

  function select(id, o = {}) {
    const it = items.get(id);
    if (!it) { clear(); return false; }
    if (current !== it) {
      if (removeHi) removeHi();
      removeHi = it.object ? addHighlight(it.object) : null;
    }
    current = it;
    fill(it);
    sheets.open('info', { min: !!o.min, focus: o.focus });
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
