// 누르기(클릭·탭)로 고르기: 보이는 메시만 광선 검사하고, 지형이 먼저 가리면 무시합니다.
// 마우스를 멈추면(0.1 초) 이름을 작은 풍선으로 보여 줍니다(데스크톱, 카메라가 멈춰 있을 때만).
//
// createPicker({ camera, dom, heightAt, roots, onPick(id|null), tooltipRoot, names, resolve, enabled, isKnown, hitLabel, isIdle })
//   → { pickAt(x, y), hoverId, hideTip() }
//   isKnown(id): 고를 수 있는 id 인지. 모르는 id(이름 없는 부재)에 맞으면 광선은 거기서 멈추되 고르지도, 카드를 닫지도 않음.
//   hitLabel(x, y): 화면의 이름표가 그 점에 있으면 id (이름표는 pointer-events 가 없어 끌기는 장면으로 감)
import * as THREE from 'three';
import { h } from './dom.js';

const BLOCK = Symbol('block');   // 맞았지만 고를 수 없는 것

// ── 큰 메시용 가벼운 광선 검사: 삼각형 128개씩 묶은 상자(AABB)를 먼저 걸러 냄 ──
const CHUNK = 128;
const chunkCache = new WeakMap();   // geometry → { n, boxes, triCount }
function chunksOf(g) {
  let c = chunkCache.get(g);
  if (c) return c;
  const P = g.attributes.position, I = g.index;
  const triCount = Math.floor((I ? I.count : P.count) / 3);
  const n = Math.ceil(triCount / CHUNK);
  const boxes = new Float32Array(n * 6);
  const pa = P.array, st = P.isInterleavedBufferAttribute ? P.data.stride : 3, off = P.isInterleavedBufferAttribute ? P.offset : 0;
  const ia = I ? I.array : null;
  for (let k = 0; k < n; k++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const t1 = Math.min(triCount, (k + 1) * CHUNK) * 3;
    for (let j = k * CHUNK * 3; j < t1; j++) {
      const vi = (ia ? ia[j] : j) * st + off;
      const x = pa[vi], y = pa[vi + 1], z = pa[vi + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    boxes.set([x0, y0, z0, x1, y1, z1], k * 6);
  }
  c = { n, boxes, triCount };
  chunkCache.set(g, c);
  return c;
}
const _inv = new THREE.Matrix4(), _lray = new THREE.Ray(), _sph = new THREE.Sphere();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _pt = new THREE.Vector3(), _w = new THREE.Vector3();
function fastRaycast(mesh, raycaster, out) {
  const g = mesh.geometry, mat = mesh.material;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _sph.copy(g.boundingSphere).applyMatrix4(mesh.matrixWorld);
  if (!raycaster.ray.intersectsSphere(_sph)) return;
  if (raycaster.ray.origin.distanceTo(_sph.center) - _sph.radius > raycaster.far) return;
  _inv.copy(mesh.matrixWorld).invert();
  _lray.copy(raycaster.ray).applyMatrix4(_inv);
  const { n, boxes, triCount } = chunksOf(g);
  const o = _lray.origin, d = _lray.direction;
  const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
  const P = g.attributes.position, I = g.index;
  const side = mat.side;
  const s = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
  const farL = raycaster.far / s + 1e-3;
  for (let k = 0; k < n; k++) {
    const b = k * 6;
    let t0 = (boxes[b] - o.x) * ix, t1 = (boxes[b + 3] - o.x) * ix;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    let u0 = (boxes[b + 1] - o.y) * iy, u1 = (boxes[b + 4] - o.y) * iy;
    if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    if (t0 > u1 || u0 > t1) continue;
    if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
    let v0 = (boxes[b + 2] - o.z) * iz, v1 = (boxes[b + 5] - o.z) * iz;
    if (v0 > v1) { const t = v0; v0 = v1; v1 = t; }
    if (t0 > v1 || v0 > t1) continue;
    if (v0 > t0) t0 = v0; if (v1 < t1) t1 = v1;
    if (t1 < 0 || t0 > farL) continue;
    const e = Math.min(triCount, (k + 1) * CHUNK);
    for (let t = k * CHUNK; t < e; t++) {
      const ia = I ? I.getX(t * 3) : t * 3, ib = I ? I.getX(t * 3 + 1) : t * 3 + 1, ic = I ? I.getX(t * 3 + 2) : t * 3 + 2;
      _a.fromBufferAttribute(P, ia); _b.fromBufferAttribute(P, ib); _c.fromBufferAttribute(P, ic);
      const hit = side === THREE.BackSide ? _lray.intersectTriangle(_c, _b, _a, true, _pt) : _lray.intersectTriangle(_a, _b, _c, side === THREE.FrontSide, _pt);
      if (!hit) continue;
      _w.copy(_pt).applyMatrix4(mesh.matrixWorld);
      const dist = raycaster.ray.origin.distanceTo(_w);
      if (dist < raycaster.near || dist > raycaster.far) continue;
      out.push({ distance: dist, point: _w.clone(), object: mesh, faceIndex: t, face: { a: ia, b: ib, c: ic, materialIndex: 0 } });
    }
  }
}
const triCountOf = (g) => Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);

export function createPicker({
  camera, dom, heightAt, roots, onPick, tooltipRoot, names, resolve = null, enabled = () => true,
  isKnown = null, hitLabel = null, isIdle = () => true, onHoverLabel = null,
}) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = [];
  const hits = [];
  const p = new THREE.Vector3();

  function visibleMeshes() {
    meshes.length = 0;
    const walk = (o) => {
      if (!o.visible) return;
      if (o.isLOD) {
        // 지금 보이는 단계만
        const lvl = o.levels.find((l) => l.object.visible);
        if (lvl) walk(lvl.object);
        return;
      }
      if (o.isMesh && !o.userData.__rim) meshes.push(o);
      for (const c of o.children) walk(c);
    };
    for (const r of roots()) walk(r);
    return meshes;
  }

  // 지형과 처음 만나는 거리 (높이 함수를 따라 걸음)
  function groundDistance(r) {
    const o = r.ray.origin, d = r.ray.direction;
    let t = 0, step = 1.5, prevT = 0;
    for (let i = 0; i < 400 && t < 6000; i++) {
      p.copy(o).addScaledVector(d, t);
      if (p.y < heightAt(p.x, p.z) - 0.05) {
        // 이분법으로 다듬기
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          p.copy(o).addScaledVector(d, m);
          if (p.y < heightAt(p.x, p.z) - 0.05) b = m; else a = m;
        }
        return b;
      }
      prevT = t;
      t += step;
      step = Math.min(step * 1.12, 25);
    }
    return Infinity;
  }

  function idOf(o) {
    for (let q = o; q; q = q.parent) {
      if (q.userData?.pickId) return q.userData.pickId;
      if (q.userData?.id && q.userData.pickable) return q.userData.id;
    }
    return null;
  }

  // → id | BLOCK | null
  function pickRaw(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const gd = groundDistance(ray);
    ray.far = Number.isFinite(gd) ? gd + 0.6 : 8000;
    ray.near = 0;
    hits.length = 0;
    for (const m of visibleMeshes()) {
      const g = m.geometry;
      if (!g?.attributes?.position) continue;
      // 큰 합친 메시(회랑·계단·담장)와 큰 전각 메시는 묶음 상자로 먼저 거름
      if (!m.isInstancedMesh && !m.isSkinnedMesh && !Array.isArray(m.material) && !m.morphTargetInfluences && triCountOf(g) > 1500) fastRaycast(m, ray, hits);
      else m.raycast(ray, hits);
    }
    hits.sort((a, b) => a.distance - b.distance);
    for (const hit of hits) {
      const id = (resolve && resolve(hit)) || idOf(hit.object);
      if (!id) continue;
      return !isKnown || isKnown(id) ? id : BLOCK;
    }
    return null;
  }
  const pickAt = (x, y) => { const id = pickRaw(x, y); return id === BLOCK ? null : id; };

  // 클릭 판정: 거의 움직이지 않고 짧게 누름. 손가락이 둘 이상 닿았던 몸짓, 비행을 멈추게 한 누름은 고르지 않음.
  let down = null, multi = false;
  const active = new Set();
  // (캡처 단계: OrbitControls 가 'start' 로 비행을 끊기 전에 비행 중이었는지 기록)
  dom.addEventListener('pointerdown', (e) => {
    active.add(e.pointerId);
    if (active.size > 1) { multi = true; down = null; return; }
    multi = false;
    if (e.pointerType === 'mouse' && e.button !== 0) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, busy: !enabled() };
  }, { capture: true });
  const release = (e) => {
    active.delete(e.pointerId);
    const d = down;
    if (!d || e.pointerId !== d.id) return null;
    down = null;
    return d;
  };
  dom.addEventListener('pointerup', (e) => {
    const wasMulti = multi;
    const d = release(e);
    if (!active.size) multi = false;
    if (!d || wasMulti || d.busy) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const dt = performance.now() - d.t;
    if (moved > 6 || dt > 650 || !enabled()) return;
    const lid = hitLabel?.(e.clientX, e.clientY);
    const id = lid || pickRaw(e.clientX, e.clientY);
    if (id === BLOCK) return;
    onPick?.(id);
  });
  dom.addEventListener('pointercancel', (e) => { release(e); if (!active.size) multi = false; });
  // 캔버스 밖에서 손을 뗀 포인터도 목록에서 지움 (다음 몸짓이 여러 손가락으로 잘못 잡히지 않게)
  const drop = (e) => { if (e.target !== dom) { active.delete(e.pointerId); if (!active.size) multi = false; } };
  addEventListener('pointerup', drop, true);
  addEventListener('pointercancel', drop, true);

  // 마우스 올림 풍선: 포인터가 잠깐 멈추고 장면이 가만히 있을 때만 광선 검사 (움직이는 동안은 자리만 따라감)
  let tip = null, hoverId = null, pending = null, hoverTimer = 0;
  const hideTip = () => { if (tip) tip.hidden = true; hoverId = null; dom.style.cursor = ''; onHoverLabel?.(null); };
  const placeTip = () => { if (tip && pending) tip.style.transform = `translate3d(${pending.x + 14}px, ${pending.y + 16}px, 0)`; };
  function hover() {
    hoverTimer = 0;
    if (!pending || !tip) return;
    if (!enabled() || !isIdle()) { hideTip(); hoverTimer = setTimeout(hover, 160); return; }
    const lid = hitLabel?.(pending.x, pending.y) || null;
    let id = lid || pickRaw(pending.x, pending.y);
    if (id === BLOCK) id = null;
    hoverId = id;
    onHoverLabel?.(lid);
    dom.style.cursor = id ? 'pointer' : '';
    const name = id ? names(id) : '';
    if (!name) { tip.hidden = true; return; }
    tip.textContent = name;
    tip.hidden = false;
    placeTip();
  }
  if (tooltipRoot) {
    tip = h('div', { class: 'hover-tip', 'aria-hidden': 'true' });
    tip.hidden = true;
    tooltipRoot.append(tip);
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) { if (hoverId || !tip.hidden) hideTip(); pending = null; return; }
      pending = { x: e.clientX, y: e.clientY };
      placeTip();
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(hover, 100);
    });
    dom.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); pending = null; hideTip(); });
  }

  return { pickAt, get hoverId() { return hoverId; }, hideTip };
}
