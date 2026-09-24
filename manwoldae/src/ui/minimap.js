// 미니맵: spec 으로 그린 궁성 평면(음영 지형·대지·전각·담장·물길) + 카메라 위치와 시야, 해/달 방향.
// 누르면 그곳으로 날아갑니다. 키보드: 평면도에 초점을 두고 방향키로 표적을 옮기고(Shift 는 크게) Enter 로 이동.
//
// createMinimap({ spec, root, heightAt, onPick(x, z), onChange() }) →
//   { update(camera, target, lightDir, night), setVisible(v), visible, collapsed, el, invalidate() }
//   onChange: 다시 그려야 할 때(접기·펼치기·키보드 표적) — main 이 한 프레임 그리게 함
import { h, icon } from './dom.js';

const EXT = { x0: -330, x1: 200, z0: -520, z1: 300 };
const DEG = Math.PI / 180;

export function createMinimap({ spec, root, heightAt, onPick, onChange, northOffsetDeg = 17 }) {
  const W = EXT.x1 - EXT.x0, D = EXT.z1 - EXT.z0;
  const canvas = h('canvas', {
    class: 'minimap-canvas', role: 'application', tabindex: '0', 'aria-roledescription': '평면도',
    'aria-label': '궁성 평면도: 누르면 그곳으로 이동합니다. 방향키로 표적을 옮기고 Enter 를 누르면 이동합니다',
  });
  const north = h('span', { class: 'minimap-north', title: '진북 (중심축은 진북에서 서쪽으로 17°)', 'aria-hidden': 'true' }, icon('north'), h('b', {}, '北'));
  north.style.transform = `rotate(${northOffsetDeg}deg)`;
  const collapse = h('button', { class: 'btn icon-btn minimap-toggle', type: 'button', 'aria-label': '평면도 접기', 'aria-expanded': 'true' }, icon('chevronDown'));
  const el = h('div', { class: 'minimap', id: 'minimap' },
    h('div', { class: 'minimap-head' }, h('span', { class: 'eyebrow' }, '궁성 평면'), collapse),
    h('div', { class: 'minimap-frame' }, canvas, north));
  root.append(el);

  let visible = true, collapsed = false, byUser = false;
  function setCollapsed(on, user = false) {
    if (collapsed === !!on) return;
    collapsed = !!on;
    if (user) byUser = true;
    el.classList.toggle('collapsed', collapsed);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.setAttribute('aria-label', collapsed ? '평면도 펼치기' : '평면도 접기');
    collapse.replaceChildren(icon(collapsed ? 'chevronUp' : 'chevronDown'));
    dirty = true; last.x = NaN;
    onChange?.();
  }
  collapse.addEventListener('click', () => setCollapsed(!collapsed, true));

  const base = document.createElement('canvas');
  let cssW = 0, cssH = 0, dpr = 1, dirty = true;
  const toPx = (x, z) => [((x - EXT.x0) / W) * cssW, ((z - EXT.z0) / D) * cssH];

  function drawBase() {
    const r = canvas.getBoundingClientRect();
    cssW = Math.round(r.width); cssH = Math.round(r.height);
    if (!cssW || !cssH) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, base]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    const g = base.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 음영 지형 (북서쪽 빛)
    const nx = Math.max(40, Math.round(cssW / 2)), nz = Math.max(60, Math.round(cssH / 2));
    const img = g.createImageData(nx, nz);
    const hs = (x, z) => heightAt(x, z);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = EXT.x0 + ((i + 0.5) / nx) * W, z = EXT.z0 + ((j + 0.5) / nz) * D;
        const e = 4;
        const dx = hs(x + e, z) - hs(x - e, z), dz = hs(x, z + e) - hs(x, z - e);
        const y = hs(x, z);
        let shade = 0.5 + (-dx * 0.6 - dz * 0.35) / (2 * e) * 0.9;
        shade = Math.max(0, Math.min(1, shade));
        const hgt = Math.max(0, Math.min(1, (y + 15) / 60));
        const k = (i + j * nx) * 4;
        img.data[k] = 24 + 30 * shade + 10 * hgt;
        img.data[k + 1] = 29 + 32 * shade + 10 * hgt;
        img.data[k + 2] = 30 + 26 * shade + 6 * hgt;
        img.data[k + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = nx; tmp.height = nz;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(tmp, 0, 0, cssW, cssH);
    const sx = cssW / W, sz = cssH / D;
    const rect = (cx, cz, w, d, rot, fill, stroke) => {
      g.save();
      const [px, pz] = toPx(cx, cz);
      g.translate(px, pz);
      g.rotate((rot || 0) * DEG);
      g.beginPath();
      g.rect((-w / 2) * sx, (-d / 2) * sz, w * sx, d * sz);
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.75; g.stroke(); }
      g.restore();
    };
    const line = (pts, style, width, closed) => {
      if (!pts || pts.length < 2) return;
      g.beginPath();
      pts.forEach(([x, z], i) => { const [px, pz] = toPx(x, z); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      if (closed) g.closePath();
      g.strokeStyle = style; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
      g.stroke();
    };
    // 대지
    for (const t of spec.terraces || []) {
      const lift = Math.max(0, Math.min(1, ((t.topY ?? 0) + 11) / 34));
      rect(t.cx, t.cz, t.w, t.d, t.rotationDeg, `rgba(${150 + 40 * lift},${150 + 34 * lift},${136 + 26 * lift},0.22)`, 'rgba(236,230,216,0.28)');
    }
    // 물길·연못
    for (const s of spec.terrain?.streams || []) line(s.path, 'rgba(126,172,178,0.85)', Math.max(1.4, (s.width || 4) * sx), false);
    for (const p of spec.ponds || []) {
      const [px, pz] = toPx(p.cx, p.cz);
      g.beginPath(); g.ellipse(px, pz, (p.w / 2) * sx, (p.d / 2) * sz, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(110,150,152,0.75)'; g.fill();
    }
    // 담장·성벽
    for (const w of spec.walls || []) {
      const city = w.kind === 'city';
      line(w.path, city ? 'rgba(200,162,69,0.35)' : w.kind === 'palace' ? 'rgba(200,162,69,0.75)' : 'rgba(236,230,216,0.45)', w.kind === 'palace' ? 1.6 : 0.9, w.closed);
    }
    // 회랑
    for (const c of spec.corridors || []) line(c.path, 'rgba(236,230,216,0.55)', Math.max(1, (c.width || 4) * sx * 0.8), c.closed);
    // 계단
    for (const s of spec.stairs || []) rect(s.cx, s.cz, s.width, s.run, s.rotationDeg, 'rgba(236,230,216,0.5)');
    // 전각
    for (const b of spec.buildings || []) {
      if (!(b.platformW > 0)) continue;
      const major = (b.rank ?? 4) <= 2;
      rect(b.cx, b.cz, b.platformW, b.platformD, b.rotationDeg, major ? 'rgba(236,230,216,0.95)' : 'rgba(236,230,216,0.7)');
    }
    dirty = false;
    return true;
  }

  const last = { x: NaN, z: NaN, yaw: NaN, ex: NaN };
  let cursor = null;       // 키보드 표적 [x, z]
  const lastTarget = { x: 0, z: 0 };
  function update(camera, target, lightDir, night) {
    lastTarget.x = target.x; lastTarget.z = target.z;
    if (!visible || collapsed) return;
    if (dirty && !drawBase()) return;
    const p = camera.position;
    const yaw = Math.atan2(target.x - p.x, target.z - p.z);
    const key = (lightDir ? lightDir.x * 7 + lightDir.z * 13 : 0) + (night ? 100 : 0) + (cursor ? cursor[0] * 0.37 + cursor[1] * 0.71 + 1e4 : 0);
    if (Math.abs(p.x - last.x) < 0.3 && Math.abs(p.z - last.z) < 0.3 && Math.abs(yaw - last.yaw) < 0.004 && key === last.ex) return;
    last.x = p.x; last.z = p.z; last.yaw = yaw; last.ex = key;
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 해/달 방향 표시 (가장자리)
    if (lightDir) {
      const L = Math.hypot(lightDir.x, lightDir.z) || 1;
      const ux = lightDir.x / L, uz = lightDir.z / L;
      const cx = cssW / 2, cz = cssH / 2;
      const t = Math.min(Math.abs((cssW / 2 - 12) / (ux || 1e-6)), Math.abs((cssH / 2 - 12) / (uz || 1e-6)));
      const gx = cx + ux * t, gz = cz + uz * t;
      g.beginPath();
      g.arc(gx, gz, 5, 0, Math.PI * 2);
      g.fillStyle = night ? 'rgba(236,230,216,0.95)' : 'rgba(232,190,90,0.95)';
      g.fill();
      if (night) { g.beginPath(); g.arc(gx + 2, gz - 1.5, 4.2, 0, Math.PI * 2); g.fillStyle = 'rgba(21,25,27,0.85)'; g.fill(); }
    }
    // 카메라: 시야 부채꼴 + 점
    let [px, pz] = toPx(p.x, p.z);
    const out = px < 0 || pz < 0 || px > cssW || pz > cssH;
    px = Math.max(6, Math.min(cssW - 6, px)); pz = Math.max(6, Math.min(cssH - 6, pz));
    const half = (camera.fov * camera.aspect * 0.5) * DEG * 0.9;
    const ang = Math.atan2(target.z - p.z, target.x - p.x);
    const R = out ? 16 : 34;
    const grad = g.createRadialGradient(px, pz, 0, px, pz, R);
    grad.addColorStop(0, 'rgba(143,184,166,0.55)');
    grad.addColorStop(1, 'rgba(143,184,166,0)');
    g.beginPath();
    g.moveTo(px, pz);
    g.arc(px, pz, R, ang - Math.min(half, 1.2), ang + Math.min(half, 1.2));
    g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath();
    g.arc(px, pz, 3.6, 0, Math.PI * 2);
    g.fillStyle = '#8FB8A6'; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = '#15191b'; g.stroke();
    // 키보드 표적 (십자)
    if (cursor) {
      const [cx, cz] = toPx(cursor[0], cursor[1]);
      g.strokeStyle = '#f2d488'; g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx - 8, cz); g.lineTo(cx - 3, cz); g.moveTo(cx + 3, cz); g.lineTo(cx + 8, cz);
      g.moveTo(cx, cz - 8); g.lineTo(cx, cz - 3); g.moveTo(cx, cz + 3); g.lineTo(cx, cz + 8);
      g.stroke();
      g.beginPath(); g.arc(cx, cz, 5.5, 0, Math.PI * 2); g.stroke();
    }
  }

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const x = EXT.x0 + ((e.clientX - r.left) / r.width) * W;
    const z = EXT.z0 + ((e.clientY - r.top) / r.height) * D;
    onPick?.(x, z);
  }
  canvas.addEventListener('click', pick);

  // 키보드: 방향키로 표적(10 m, Shift 40 m), Enter·Space 로 이동, Esc 로 표적 지우기
  const clampX = (x) => Math.max(EXT.x0, Math.min(EXT.x1, x)), clampZ = (z) => Math.max(EXT.z0, Math.min(EXT.z1, z));
  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) {
      if (!cursor) cursor = [lastTarget.x, lastTarget.z];
      cursor = [clampX(cursor[0] + mv[0]), clampZ(cursor[1] + mv[1])];
      e.preventDefault(); e.stopPropagation();
      onChange?.();
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor) {
      e.preventDefault(); e.stopPropagation();
      onPick?.(cursor[0], cursor[1]);
    } else if (e.key === 'Escape' && cursor) {
      cursor = null;
      e.preventDefault(); e.stopPropagation();
      onChange?.();
    }
  });
  canvas.addEventListener('blur', () => { if (cursor) { cursor = null; onChange?.(); } });

  function setVisible(v) {
    visible = !!v;
    el.hidden = !visible;
    dirty = true; last.x = NaN;
    onChange?.();
  }
  addEventListener('resize', () => { dirty = true; last.x = NaN; });

  return {
    update, setVisible, el,
    get visible() { return visible; },
    get collapsed() { return collapsed; },
    // 투어가 열리면 main 이 잠시 접음 (사용자가 직접 접고 편 적이 있으면 userTouched 로 알 수 있음)
    setCollapsed: (on) => setCollapsed(on),
    get userTouched() { return byUser; },
    resetTouched() { byUser = false; },
    invalidate() { dirty = true; last.x = NaN; },
  };
}
