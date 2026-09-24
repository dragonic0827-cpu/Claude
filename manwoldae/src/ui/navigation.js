// 카메라 조작: 궤도(OrbitControls) 제한 · 걷기 모드(키보드/끌어 둘러보기/터치 조이스틱) · 부드러운 비행
//
// createNavigation({ camera, controls, dom, terrain, spec, joystickRoot }) →
//   { update(dt) → 움직였는지, flyTo(pos, target, o) → Promise, lookAt(pos, target), cancelFlight(),
//     nudge({ yaw, pitch, pan: [x, z], dolly }) (키보드 궤도·걷기 시선), setWalk(on), walking, flying, interacting,
//     colliders, onWalkChange(fn), blocked(x, z) }
// 비행 중에도 OrbitControls 는 켜 둡니다: 누르거나 휠을 굴리면 'start' 로 비행이 끊기고 그 몸짓이 바로 이어집니다.
import * as THREE from 'three';
import { h, reducedMotion } from './dom.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
const EYE = 1.6;
const RADIUS = 0.35;
const BOUNDS = { x0: -2400, x1: 2400, z0: -2700, z1: 2000 };

// 건물 기단 발자국(회전 사각형). 문은 가운데 문칸(doors)을 비워 지나갈 수 있게.
function buildColliders(spec) {
  const out = [];
  for (const b of spec.buildings || []) {
    const W = b.platformW, D = b.platformD;
    if (!(W > 0 && D > 0) || !Number.isFinite(b.cx) || !Number.isFinite(b.cz)) continue;
    const r = (b.rotationDeg || 0) * DEG;
    const base = { cx: b.cx, cz: b.cz, c: Math.cos(r), s: Math.sin(r), hd: D / 2, y: (b.groundY ?? 0) };
    const isGate = b.kind === 'gate' || b.kind === 'gatehouse';
    const bays = Array.isArray(b.bayWidthsFront) && b.bayWidthsFront.length ? b.bayWidthsFront : null;
    if (isGate && bays) {
      const n = bays.length, doors = clamp(b.doors ?? (n >= 5 ? 3 : 1), 0, n);
      const span = bays.reduce((a, v) => a + v, 0);
      const first = Math.floor((n - doors) / 2);
      let u = -span / 2;
      let u0 = 0, u1 = 0;
      for (let i = 0; i < n; i++) {
        if (i === first) u0 = u;
        u += bays[i];
        if (i === first + doors - 1) u1 = u;
      }
      if (doors === 0) { out.push({ ...base, u0: -W / 2, u1: W / 2 }); continue; }
      // 문칸 가장자리에 기둥 폭(0.5 m)만큼 남김
      if (u0 - 0.25 > -W / 2) out.push({ ...base, u0: -W / 2, u1: u0 + 0.25 });
      if (u1 - 0.25 < W / 2) out.push({ ...base, u0: u1 - 0.25, u1: W / 2 });
    } else {
      out.push({ ...base, u0: -W / 2, u1: W / 2 });
    }
  }
  return out;
}
function buildWallSegs(spec) {
  const segs = [];
  for (const w of spec.walls || []) {
    if (!Array.isArray(w.path) || w.path.length < 2) continue;
    const pts = w.closed ? [...w.path, w.path[0]] : w.path;
    const half = (w.thickness || 1) / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      segs.push({ ax, az, bx, bz, half, x0: Math.min(ax, bx) - half - 1, x1: Math.max(ax, bx) + half + 1, z0: Math.min(az, bz) - half - 1, z1: Math.max(az, bz) + half + 1 });
    }
  }
  return segs;
}

export function createNavigation({ camera, controls, dom, terrain, spec, joystickRoot }) {
  const heightAt = (x, z) => {
    const y = terrain.heightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  };
  const colliders = buildColliders(spec);
  const walls = buildWallSegs(spec);
  const listeners = new Set();

  function blocked(x, z, rad = RADIUS) {
    for (const k of colliders) {
      const dx = x - k.cx, dz = z - k.cz;
      const u = dx * k.c + dz * k.s, v = -dx * k.s + dz * k.c;
      if (u > k.u0 - rad && u < k.u1 + rad && Math.abs(v) < k.hd + rad) return true;
    }
    for (const w of walls) {
      if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1) continue;
      const ex = w.bx - w.ax, ez = w.bz - w.az;
      const L2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - w.ax) * ex + (z - w.az) * ez) / L2, 0, 1);
      const px = w.ax + ex * t - x, pz = w.az + ez * t - z;
      if (px * px + pz * pz < (w.half + rad) ** 2) return true;
    }
    return false;
  }

  // ─────────── 궤도 모드 제한 ───────────
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minDistance = 2;
  controls.maxDistance = 4000;
  controls.maxPolarAngle = 88 * DEG;
  controls.rotateSpeed = 0.6;
  controls.panSpeed = 0.9;
  let userActive = false, userTail = 0;
  controls.addEventListener('start', () => { userActive = true; cancelFlight(); });
  controls.addEventListener('end', () => { userActive = false; userTail = 0.8; });
  const lastT = new THREE.Vector3().copy(controls.target);

  function clampOrbit(dt) {
    const t = controls.target, p = camera.position;
    // 보는 곳 범위
    const cx = clamp(t.x, BOUNDS.x0, BOUNDS.x1), cz = clamp(t.z, BOUNDS.z0, BOUNDS.z1);
    if (cx !== t.x || cz !== t.z) { p.x += cx - t.x; p.z += cz - t.z; t.x = cx; t.z = cz; }
    // 사용자가 끌어 옮길 때만 보는 점 높이를 지면에 맞춤
    const moved = Math.abs(t.x - lastT.x) + Math.abs(t.z - lastT.z) > 1e-3;
    if ((userActive || userTail > 0) && moved) {
      const gy = heightAt(t.x, t.z) + 1;
      const dy = (gy - t.y) * Math.min(1, dt * 6);
      t.y += dy; p.y += dy;
    }
    const gT = heightAt(t.x, t.z);
    if (t.y < gT - 2) { const d = gT - 2 - t.y; t.y += d; p.y += d; }
    if (t.y > gT + 600) t.y = gT + 600;
    lastT.copy(t);
    // 카메라는 땅 위 1.2 m 이상
    p.x = clamp(p.x, BOUNDS.x0 - 1500, BOUNDS.x1 + 1500);
    p.z = clamp(p.z, BOUNDS.z0 - 1500, BOUNDS.z1 + 1500);
    const gP = heightAt(p.x, p.z) + 1.2;
    if (p.y < gP) p.y = gP;
  }

  // 가까운 면 거리: 낮게 보면 작게, 높이 보면 크게(깊이 정밀도)
  function updateNear() {
    const above = Math.max(0.5, camera.position.y - heightAt(camera.position.x, camera.position.z));
    const d = walking ? 0.12 : clamp(Math.min(above * 0.03, camera.position.distanceTo(controls.target) * 0.01), 0.15, 3);
    if (Math.abs(d - camera.near) / camera.near > 0.1) {
      camera.near = d;
      camera.updateProjectionMatrix();
    }
  }

  // ─────────── 비행 ───────────
  let flight = null;
  const _p = new THREE.Vector3(), _t = new THREE.Vector3();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function cancelFlight() {
    if (!flight) return;
    const f = flight;
    flight = null;
    controls.enabled = !walking;
    f.resolve(false);
  }
  function lookAt(pos, target) {
    cancelFlight();
    if (walking) setWalk(false, { keepCamera: true });
    camera.position.set(pos.x, pos.y, pos.z);
    controls.target.set(target.x, target.y, target.z);
    lastT.copy(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    updateNear();
  }
  function flyTo(pos, target, o = {}) {
    cancelFlight();
    if (walking) setWalk(false, { keepCamera: true });
    const to = new THREE.Vector3(pos.x, pos.y, pos.z), toT = new THREE.Vector3(target.x, target.y, target.z);
    if (o.instant || reducedMotion()) { lookAt(to, toT); return Promise.resolve(true); }
    const from = camera.position.clone(), fromT = controls.target.clone();
    const dist = from.distanceTo(to) + 0.5 * fromT.distanceTo(toT);
    const dur = o.duration ?? clamp(1.3 + dist / 280, 1.4, 5.5) * 1000;
    // 가까운 비행도 조금 떠올라 회랑·담장 지붕을 넘어가게
    const lift = dist > 20 ? clamp(dist * 0.17, 3, 240) : 0;
    return new Promise((resolve) => {
      flight = { from, fromT, to, toT, dur, lift, t0: performance.now(), resolve };
    });
  }
  function stepFlight() {
    const f = flight;
    const t = clamp((performance.now() - f.t0) / f.dur, 0, 1);
    const e = ease(t);
    _p.lerpVectors(f.from, f.to, e);
    _p.y += f.lift * Math.sin(Math.PI * e);
    const e2 = ease(clamp(t * 1.15, 0, 1)); // 시선은 조금 먼저 돌림
    _t.lerpVectors(f.fromT, f.toT, e2);
    const g = heightAt(_p.x, _p.z) + 2;
    if (_p.y < g && t < 1) _p.y = g;
    camera.position.copy(_p);
    controls.target.copy(_t);
    camera.lookAt(_t);
    if (t >= 1) {
      flight = null;
      controls.enabled = !walking;
      lastT.copy(controls.target);
      controls.update();
      f.resolve(true);
    }
  }

  // ─────────── 걷기 ───────────
  let walking = false;
  const walk = { x: 0, z: 0, y: 0, yaw: 0, pitch: 0, vx: 0, vz: 0 };
  const keys = new Set();
  const joy = { x: 0, y: 0, active: false };
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE', 'PageUp', 'PageDown']);
  const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  addEventListener('keydown', (e) => {
    if (!walking || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    // 패널·라디오 묶음 안의 방향키·PageUp/Down 은 그쪽(스크롤·고르기)에 맡김 — W A S D 는 어디서나
    if (/^(Arrow|Page)/.test(e.code) && e.target?.closest?.('.sheet, .pop, .minimap, [role="radiogroup"], [role="tablist"], [role="menu"]')) return;
    if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // 끌어서 둘러보기 (걷기 모드에서만)
  let look = null;
  dom.addEventListener('pointerdown', (e) => {
    if (flight && !walking) cancelFlight();
    if (!walking || look || (e.pointerType === 'mouse' && e.button !== 0)) return;   // 첫 손가락만 따라감
    look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    dom.setPointerCapture?.(e.pointerId);
  });
  dom.addEventListener('pointermove', (e) => {
    if (!look || e.pointerId !== look.id) return;
    const k = e.pointerType === 'touch' ? 0.0055 : 0.0038;
    walk.yaw -= (e.clientX - look.x) * k;
    walk.pitch = clamp(walk.pitch - (e.clientY - look.y) * k, -1.25, 1.25);
    look.x = e.clientX; look.y = e.clientY;
  });
  const endLook = (e) => { if (look && e.pointerId === look.id) look = null; };
  dom.addEventListener('pointerup', endLook);
  dom.addEventListener('pointercancel', endLook);
  dom.addEventListener('wheel', (e) => { if (walking) e.preventDefault(); }, { passive: false });

  // 터치 조이스틱
  let joyEl = null;
  const touchCapable = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  if (joystickRoot && touchCapable) {
    const knob = h('div', { class: 'joy-knob' });
    joyEl = h('div', { class: 'joystick', role: 'application', 'aria-label': '걷기 조이스틱: 끌어서 이동' }, h('div', { class: 'joy-ring' }), knob);
    joyEl.hidden = true;
    joystickRoot.append(joyEl);
    let jid = null, cx = 0, cy = 0;
    const R = 44;
    const set = (x, y) => {
      const d = Math.hypot(x, y), m = d > R ? R / d : 1;
      joy.x = (x * m) / R; joy.y = (y * m) / R;
      knob.style.transform = `translate(${x * m}px, ${y * m}px)`;
    };
    joyEl.addEventListener('pointerdown', (e) => {
      jid = e.pointerId;
      const r = joyEl.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      joy.active = true;
      joyEl.setPointerCapture(e.pointerId);
      set(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    });
    joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === jid) set(e.clientX - cx, e.clientY - cy); });
    const up = (e) => { if (e.pointerId !== jid) return; jid = null; joy.active = false; set(0, 0); };
    joyEl.addEventListener('pointerup', up);
    joyEl.addEventListener('pointercancel', up);
  }

  const _dir = new THREE.Vector3();
  function setWalk(on, o = {}) {
    on = !!on;
    if (on === walking) return walking;
    if (on) {
      cancelFlight();
      camera.getWorldDirection(_dir);
      walk.yaw = Math.atan2(-_dir.x, -_dir.z);
      walk.pitch = 0;
      // 시작점: 카메라가 땅 가까이면 그 자리, 아니면 보던 곳에서 카메라 쪽으로 물러나 빈 곳 찾기
      const p = camera.position, t = controls.target;
      let x = t.x, z = t.z;
      if (p.y - heightAt(p.x, p.z) < 25) { x = p.x; z = p.z; }
      const bx = p.x - x, bz = p.z - z, bl = Math.hypot(bx, bz) || 1;
      for (let i = 0; i < 80 && blocked(x, z, 0.8); i++) { x += (bx / bl) * 2; z += (bz / bl) * 2; }
      walk.x = x; walk.z = z; walk.y = heightAt(x, z) + EYE;
      walk.vx = walk.vz = 0;
      controls.enabled = false;
      walking = true;
      camera.position.set(walk.x, walk.y, walk.z);
      camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
    } else {
      walking = false;
      keys.clear();
      camera.getWorldDirection(_dir);
      _dir.y = 0;
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
      _dir.normalize();
      if (!o.keepCamera) {
        const tx = camera.position.x + _dir.x * 18, tz = camera.position.z + _dir.z * 18;
        controls.target.set(tx, heightAt(tx, tz) + 1.2, tz);
        lastT.copy(controls.target);
      }
      controls.enabled = true;
      controls.update();
    }
    if (joyEl) joyEl.hidden = !walking;
    for (const fn of listeners) fn(walking);
    return walking;
  }

  // 한 걸음 갈 수 있는지: 범위·건물·담장, 높은 축대는 오르지도 뛰어내리지도 않음
  function canStep(x, z, y0) {
    if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return false;
    if (blocked(x, z)) return false;
    const dy = heightAt(x, z) - y0;
    return dy < 0.8 && dy > -1.6;
  }
  function stepWalk(dt) {
    let fx = 0, fz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyD')) fx += 1;
    if (keys.has('KeyA')) fx -= 1;
    if (keys.has('ArrowLeft') || keys.has('KeyQ')) walk.yaw += 1.6 * dt;
    if (keys.has('ArrowRight') || keys.has('KeyE')) walk.yaw -= 1.6 * dt;
    if (keys.has('PageUp')) walk.pitch = clamp(walk.pitch + 1.1 * dt, -1.25, 1.25);
    if (keys.has('PageDown')) walk.pitch = clamp(walk.pitch - 1.1 * dt, -1.25, 1.25);
    if (joy.active) { fx += joy.x; fz -= joy.y; }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.8 : 1;
    const speed = 3.4 * run;
    const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
    // 앞 = (−sin yaw, −cos yaw), 오른쪽 = (cos yaw, −sin yaw)
    const tvx = (-sy * fz + cy * fx) * speed, tvz = (-cy * fz - sy * fx) * speed;
    const k = Math.min(1, dt * 10);
    walk.vx += (tvx - walk.vx) * k;
    walk.vz += (tvz - walk.vz) * k;
    let moved = Math.abs(walk.vx) + Math.abs(walk.vz) > 0.01;
    if (moved) {
      const y0 = heightAt(walk.x, walk.z);
      const nx = walk.x + walk.vx * dt, nz = walk.z + walk.vz * dt;
      if (canStep(nx, nz, y0)) { walk.x = nx; walk.z = nz; } else if (canStep(nx, walk.z, y0)) { walk.x = nx; walk.vz *= 0.5; } else if (canStep(walk.x, nz, y0)) { walk.z = nz; walk.vx *= 0.5; } else { walk.vx = walk.vz = 0; moved = false; }
    }
    const gy = heightAt(walk.x, walk.z) + EYE;
    const prevY = walk.y;
    walk.y += (gy - walk.y) * Math.min(1, dt * (gy > walk.y ? 12 : 7));
    const prevYaw = camera.rotation.y, prevPitch = camera.rotation.x;
    camera.position.set(walk.x, walk.y, walk.z);
    camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
    return moved || Math.abs(prevY - walk.y) > 1e-4 || prevYaw !== walk.yaw || prevPitch !== walk.pitch;
  }

  // ─────────── 매 프레임 ───────────
  function update(dt) {
    let active = false;
    if (flight) { stepFlight(); active = true; }
    if (walking) {
      active = stepWalk(dt) || active;
    } else if (!flight) {
      if (userTail > 0) userTail -= dt;
      active = controls.update(dt) || active;
      clampOrbit(dt);
    }
    updateNear();
    return active;
  }

  // ─────────── 키보드 궤도: 방향키로 돌리기, Shift+방향키로 옮기기, +/− 로 가까이·멀리 ───────────
  const _sph = new THREE.Spherical(), _off = new THREE.Vector3(), _fw = new THREE.Vector3();
  function nudge({ yaw = 0, pitch = 0, pan = null, dolly = 1 } = {}) {
    if (walking) {
      walk.yaw += yaw;
      walk.pitch = clamp(walk.pitch + pitch, -1.25, 1.25);
      return true;
    }
    cancelFlight();
    const t = controls.target, p = camera.position;
    _off.copy(p).sub(t);
    _sph.setFromVector3(_off);
    _sph.theta += yaw;
    _sph.phi = clamp(_sph.phi + pitch, 0.08, controls.maxPolarAngle);
    _sph.radius = clamp(_sph.radius * dolly, controls.minDistance, controls.maxDistance);
    _off.setFromSpherical(_sph);
    if (pan) {
      camera.getWorldDirection(_fw);
      _fw.y = 0;
      if (_fw.lengthSq() < 1e-6) _fw.set(0, 0, -1);
      _fw.normalize();
      const k = Math.max(3, _sph.radius * 0.06);
      // 오른쪽 = (−fz, 0, fx)
      t.x += (-_fw.z * pan[0] + _fw.x * pan[1]) * k;
      t.z += (_fw.x * pan[0] + _fw.z * pan[1]) * k;
    }
    p.copy(t).add(_off);
    camera.lookAt(t);
    userTail = 0.8;   // 옮긴 뒤 보는 점 높이를 지면에 맞춤(clampOrbit)
    controls.update();
    return true;
  }

  return {
    update, flyTo, lookAt, cancelFlight, setWalk, blocked, colliders, nudge,
    get walking() { return walking; },
    get flying() { return !!flight; },
    get interacting() { return userActive || !!look || joy.active || keys.size > 0; },
    walkState: walk,
    onWalkChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    heightAt,
  };
}
