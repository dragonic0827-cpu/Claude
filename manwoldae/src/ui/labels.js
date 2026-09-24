// 떠 있는 이름표: rank ≤ 2 전각 · 유적(landmarks) · 산(terrain.peaks)
// 화면에 투영한 div 로 그리고, 거리와 지형 가림에 따라 흐려집니다. 겹치면 중요도가 낮은 것을 숨깁니다.
//
// createLabels({ spec, camera, root, heightAt, items, onPick }) → { update(), setVisible(v), visible }
import * as THREE from 'three';
import { h } from './dom.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createLabels({ spec, camera, root, heightAt, items, onPick }) {
  const list = [];
  const add = (o) => {
    if (![o.x, o.y, o.z].every(Number.isFinite)) return;
    const el = h('button', { class: `label label-${o.kind}${o.major ? ' major' : ''}`, type: 'button', tabindex: '-1', 'aria-hidden': 'true' },
      h('span', { class: 'label-n' }, o.text), o.sub ? h('span', { class: 'label-h', lang: 'zh-Hant' }, o.sub) : null);
    if (o.pickId) el.addEventListener('click', (e) => { e.stopPropagation(); onPick?.(o.pickId); });
    else el.classList.add('static');
    root.append(el);
    list.push({ ...o, el, pos: new THREE.Vector3(o.x, o.y, o.z), alpha: 0, occ: 1, occT: 1, shown: false, w: 0, hgt: 0 });
  };

  const shortName = (s) => (s || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  for (const b of spec.buildings || []) {
    if ((b.rank ?? 9) > 2) continue;
    const it = items.get(b.id);
    const ridge = it?.object?.userData?.ridgeY;
    const y = Number.isFinite(ridge) ? ridge + 3 : (b.groundY ?? 0) + (b.columnHeight || 4) * (b.stories || 1) + 9;
    add({ kind: 'building', text: shortName(b.nameKo), sub: b.nameHanja, x: b.cx, y, z: b.cz, pickId: b.id, prio: 10 - (b.rank || 2), maxD: b.rank === 1 ? 2600 : 1500, major: b.rank === 1 });
  }
  const lms = spec.landmarks || [];
  for (const l of lms) {
    const it = items.get(l.id);
    const ly = it?.object?.userData?.labelY;
    const far = l.id === 'songak_summit';
    const y = Number.isFinite(ly) ? ly : (Number.isFinite(l.y) ? l.y : heightAt(l.x, l.z)) + (far ? 40 : 7);
    add({ kind: far ? 'peak' : 'landmark', text: shortName(l.nameKo), sub: far ? l.nameHanja : '', x: l.x, y, z: l.z, pickId: l.id, prio: far ? 6 : 4, maxD: far ? 9000 : 900 });
  }
  for (const p of spec.terrain?.peaks || []) {
    if (lms.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < 250)) continue; // 송악산 정상 유적과 겹침
    const y = (Number.isFinite(p.height) ? p.height : heightAt(p.x, p.z)) + 28;
    add({ kind: 'peak', text: shortName(p.nameKo), sub: p.heightASL ? `${p.heightASL} m` : '', x: p.x, y, z: p.z, prio: 5, maxD: 9000 });
  }

  // 건물 가림: 기단 발자국 × (지면~용마루) 회전 상자
  const DEG = Math.PI / 180;
  const boxes = [];
  for (const b of spec.buildings || []) {
    if (!(b.platformW > 0 && b.platformD > 0)) continue;
    const it = items.get(b.id);
    const g = b.groundY ?? 0;
    const top = it?.object?.userData?.ridgeY ?? g + (b.columnHeight || 4) * (b.stories || 1) + 6;
    const r = (b.rotationDeg || 0) * DEG;
    boxes.push({ id: b.id, cx: b.cx, cz: b.cz, c: Math.cos(r), s: Math.sin(r), hw: b.platformW / 2, hd: b.platformD / 2, y0: g, y1: top - 1.2 });
  }
  // 회랑·담장도 가림 상자로 (구간마다 회전 상자, 높이는 회랑 지붕·담장 높이 정도)
  const segBoxes = (path, closed, width, height, id) => {
    const pts = closed ? [...path, path[0]] : path;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i] || [], [bx, bz] = pts[i + 1] || [];
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const r = Math.atan2(bz - az, bx - ax);
      // 비탈을 따라가는 긴 성벽은 20 m 이하 조각으로 (조각마다 지면 높이)
      const n = Math.ceil(len / 20);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t, g = heightAt(cx, cz);
        boxes.push({ id, cx, cz, c: Math.cos(r), s: Math.sin(r), hw: len / n / 2, hd: width / 2, y0: g - 1, y1: g + height });
      }
    }
  };
  for (const c of spec.corridors || []) if (Array.isArray(c.path)) segBoxes(c.path, c.closed, c.width || 4.5, 5.2, c.id);
  for (const w of spec.walls || []) {
    if (!Array.isArray(w.path) || w.kind === 'city') continue; // 황성·나성은 멀어서 지형 검사로 충분
    segBoxes(w.path, w.closed, w.thickness || 1, (w.height || 3) - 0.3, w.id);
  }
  // 선분 p→q 가 상자를 지나는지 (상자 좌표로 돌려 슬랩 검사)
  function segHitsBox(px, py, pz, qx, qy, qz, B) {
    const ax = px - B.cx, az = pz - B.cz, bx = qx - B.cx, bz = qz - B.cz;
    const u0 = ax * B.c + az * B.s, v0 = -ax * B.s + az * B.c;
    const u1 = bx * B.c + bz * B.s, v1 = -bx * B.s + bz * B.c;
    let t0 = 0, t1 = 1;
    const slab = (a, b, lo, hi) => {
      const d = b - a;
      if (Math.abs(d) < 1e-9) return a >= lo && a <= hi;
      let ta = (lo - a) / d, tb = (hi - a) / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      return t0 <= t1;
    };
    return slab(u0, u1, -B.hw, B.hw) && slab(v0, v1, -B.hd, B.hd) && slab(py, qy, B.y0, B.y1);
  }

  let visible = true;
  let rr = 0;
  const v = new THREE.Vector3();
  // 겹침 검사용 사각형 (미리 만들어 두고 다시 씀)
  const placed = Array.from({ length: 64 }, () => ({ x0: 0, x1: 0, y0: 0, y1: 0 }));
  let nPlaced = 0;
  const place = (x0, x1, y0, y1) => {
    if (nPlaced >= placed.length) return;
    const r = placed[nPlaced++];
    r.x0 = x0; r.x1 = x1; r.y0 = y0; r.y1 = y1;
  };
  const overlaps = (x0, x1, y0, y1) => {
    for (let i = 0; i < nPlaced; i++) {
      const q = placed[i];
      if (x0 < q.x1 && x1 > q.x0 && y0 < q.y1 && y1 > q.y0) return true;
    }
    return false;
  };
  const lastFull = new THREE.Vector3(1e9, 0, 0);
  const byPrio = [...list].sort((a, b) => b.prio - a.prio);

  // 카메라→이름표 선분이 지형 아래로 들어가면 가림
  function occluded(L) {
    const p = camera.position;
    const dx = L.pos.x - p.x, dy = L.pos.y - p.y, dz = L.pos.z - p.z;
    const dist = Math.hypot(dx, dz);
    const n = clamp(Math.ceil(dist / 45), 6, 28);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (t > 0.97) break;
      const x = p.x + dx * t, z = p.z + dz * t, y = p.y + dy * t;
      if (heightAt(x, z) > y + 0.5) return true;
    }
    // 건물 (이름표 자신의 건물은 빼고, 이름표 바로 앞 2 m 까지만)
    const L2 = Math.hypot(dx, dy, dz) || 1;
    const k = Math.max(0, 1 - 2 / L2);
    const qx = p.x + dx * k, qy = p.y + dy * k, qz = p.z + dz * k;
    for (const B of boxes) {
      if (B.id === L.pickId) continue;
      if (segHitsBox(p.x, p.y, p.z, qx, qy, qz, B)) return true;
    }
    return false;
  }

  // 반환값: 아직 흐려지거나 나타나는 중인지 (다음 프레임에도 불러야 함)
  let snapNext = false;
  const brand = document.querySelector('.brand');
  let brandRect = null, brandW = 0, brandH = 0;
  function update() {
    if (!visible) return false;
    let busy = false;
    const snap = snapNext;
    snapNext = false;
    const W = root.clientWidth, H = root.clientHeight;
    // 가림 검사는 프레임마다 몇 개씩 돌아가며 (카메라가 크게 움직였으면 모두)
    const all = snap || camera.position.distanceToSquared(lastFull) > 1600;
    if (all) lastFull.copy(camera.position);
    for (let k = 0; k < (all ? list.length : 6) && list.length; k++) {
      const L = list[rr++ % list.length];
      L.occT = occluded(L) ? 0 : 1;
    }
    nPlaced = 0;
    // 표제(왼쪽 위)와 겹치지 않게 자리 잡아 둠
    if (brand) {
      if (!brandRect || brandW !== W || brandH !== H) { brandRect = brand.getBoundingClientRect(); brandW = W; brandH = H; }
      if (brandRect.width) place(brandRect.left - 6, brandRect.right + 12, brandRect.top - 6, brandRect.bottom + 10);
    }
    // 땅 가까이 서 있으면 먼 이름표는 줄임 (산은 그대로)
    const above = camera.position.y - heightAt(camera.position.x, camera.position.z);
    const near = clamp(above / 70, above < 4 ? 0.1 : 0.3, 1);
    for (const L of byPrio) {
      v.copy(L.pos).project(camera);
      const d = camera.position.distanceTo(L.pos);
      const maxD = L.kind === 'peak' ? L.maxD : L.maxD * near;
      let a = 0;
      if (v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15) {
        a = 1 - clamp((d - maxD * 0.65) / (maxD * 0.35), 0, 1);
        a *= clamp((d - 14) / 20, 0, 1); // 너무 가까우면 숨김
      }
      L.occ = snap ? L.occT : L.occ + (L.occT - L.occ) * 0.3;
      if (Math.abs(L.occT - L.occ) > 0.02) busy = true;
      a *= L.occ;
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      if (a > 0.02) {
        if (!L.w) { L.w = L.el.offsetWidth || 60; L.hgt = L.el.offsetHeight || 22; }
        const x0 = x - L.w / 2 - 4, x1 = x + L.w / 2 + 4, y0 = y - L.hgt - 16, y1 = y;
        // 화면 가장자리에 걸리면 흐리게
        const edge = Math.min(x0 - 8, W - 8 - x1, y0 - 8, H - 8 - y1);
        if (edge < 0) a *= clamp(1 + edge / 12, 0, 1);
        if (overlaps(x0, x1, y0, y1)) a = 0;
        else place(x0, x1, y0, y1);
      }
      L.alpha = snap ? a : L.alpha + (a - L.alpha) * 0.3;
      if (Math.abs(a - L.alpha) > 0.02) busy = true;
      if (L.alpha < 0.02) {
        if (L.shown) { L.el.style.visibility = 'hidden'; L.shown = false; }
        continue;
      }
      if (!L.shown) { L.el.style.visibility = 'visible'; L.shown = true; }
      L.el.style.opacity = L.alpha.toFixed(3);
      L.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      L.el.style.pointerEvents = L.alpha > 0.5 && L.pickId ? 'auto' : 'none';
    }
    return busy;
  }

  function setVisible(on) {
    visible = !!on;
    root.hidden = !visible;
    if (visible) for (const L of list) { L.w = 0; }
  }

  // 카메라가 순간 이동했을 때: 다음 갱신에서 흐림 없이 바로 맞춤
  const snapNow = () => { snapNext = true; };
  return { update, setVisible, snap: snapNow, get visible() { return visible; }, list };
}
