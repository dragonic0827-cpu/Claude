// 고려 목조건축 부재 — 기단·계단·초석·배흘림기둥·공포·창호·난간·편액·극(戟)
// 모든 함수는 GeoSink 에 건물 로컬 좌표(정면 +z, 기단 바닥 y = 0)로 그립니다.
import * as THREE from 'three';
import { rng } from '../core/textures.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y = new THREE.Vector3(0, 1, 0);

// 두 점을 잇는 부재 좌표계: 로컬 x = A→B, y = 위(수직면 안), z = x × y
export function memberMatrix(A, B) {
  const x = V3().subVectors(B, A);
  const L = x.length();
  x.divideScalar(L || 1);
  const y = V3().copy(Y).addScaledVector(x, -x.y).normalize();
  const z = V3().crossVectors(x, y);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(V3().addVectors(A, B).multiplyScalar(0.5));
  return [m, L];
}

// A→B 부재(윗면이 A,B 높이). 단면 높이 h, 폭 d
export function member(sink, key, A, B, h, d, o = {}) {
  const [m, L] = memberMatrix(A, B);
  sink.push(m);
  sink.box(key, 0, (o.center ? 0 : -h / 2), 0, L + (o.ext ?? 0) * 2, h, d, { uv: o.uv, col: o.col, under: o.under, skip: o.skip, us: o.us, vs: o.vs });
  sink.pop();
}

// ─────────────── 기단 ───────────────

// 가구식 기단(지대석·면석·갑석) + 우주·탱주. 중심 (cx, cz), 크기 w × d, 높이 h
export function platformBox(sink, cx, cz, w, d, h, o = {}) {
  const capH = Math.min(0.2, h * 0.3);
  const baseH = Math.min(0.2, h * 0.24);
  const faceH = h - capH - baseH;
  const sunk = -0.15;
  sink.box('stoneW', cx, (sunk + baseH) / 2, cz, w + 0.16, baseH - sunk, d + 0.16, { skip: '-y' });
  if (faceH > 0.04) {
    sink.box('stone', cx, baseH + faceH / 2, cz, w, faceH, d, { uv: 'world', us: 4, vs: 2, skip: '-y+y', u0: cx * 0.13 });
    // 우주·탱주: 면석 사이 기둥돌 (조금 도드라짐)
    if (o.posts !== false && faceH > 0.25) {
      const pw = Math.min(0.32, faceH * 0.35);
      const add = (x, z, alongX) => sink.box('stoneTop', x, baseH + faceH / 2, z, alongX ? pw : 0.06, faceH, alongX ? 0.06 : pw, { skip: '-y+y' });
      const xs = o.postsX || [], zs = o.postsZ || [];
      for (const x of [-w / 2 + pw / 2, ...xs, w / 2 - pw / 2]) for (const s of [1, -1]) if (!(o.skipFront && s > 0 && o.skipFront(x))) add(cx + x, cz + s * (d / 2 + 0.01), true);
      for (const z of [-d / 2 + pw / 2, ...zs, d / 2 - pw / 2]) for (const s of [1, -1]) add(cx + s * (w / 2 + 0.01), cz + z, false);
    }
  }
  sink.box('stoneTop', cx, h - capH / 2, cz, w + 0.1, capH, d + 0.1, { skip: '-y' });
}

// 기단 계단: 바깥(+z')으로 내려가는 계단. (x, zEdge) 기단 가장자리, dirZ = +1(앞) / -1(뒤)
export function platformStair(sink, x, zEdge, dirZ, width, run, rise) {
  const n = Math.max(2, Math.round(rise / 0.19));
  const rs = rise / n, tr = run / n;
  const m = new THREE.Matrix4().makeTranslation(x, 0, zEdge);
  if (dirZ < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  sink.push(m);
  for (let k = 0; k < n; k++) {
    const z0 = run - (k + 1) * tr, z1 = run - k * tr, top = (k + 1) * rs;
    sink.box('stoneTop', 0, (top - 0.1) / 2, (z0 + z1) / 2, width, top + 0.1, z1 - z0 + 0.002, { skip: '-y-z+x-x' });
  }
  // 소맷돌(옆막이)
  const cw = 0.3;
  for (const s of [1, -1]) {
    const xi = s * (width / 2), xo = s * (width / 2 + cw);
    const yT0 = rise + 0.1, yT1 = rs + 0.12, z1 = run + 0.06;
    const A = [xi, -0.1, 0], B = [xo, -0.1, 0], Cc = [xo, -0.1, z1], D = [xi, -0.1, z1];
    const At = [xi, yT0, 0], Bt = [xo, yT0, 0], Ct = [xo, yT1, z1], Dt = [xi, yT1, z1];
    sink.quad('stoneW', B, Cc, Ct, Bt, null, undefined, [s, 0, 0]);
    sink.quad('stoneW', D, A, At, Dt, null, undefined, [-s, 0, 0]);
    sink.quad('stoneW', Dt, Ct, Bt, At, null, undefined, [0, 1, 0]);
    sink.quad('stoneW', D, Cc, Ct, Dt, null, undefined, [0, 0, 1]);
  }
  sink.pop();
  return { n, rs, tr };
}

// 원형 초석 (지름 dP, 윗면 = y0 + 0.15, 주좌 포함)
export function plinth(sink, x, y0, z, dP, segs, rich = true) {
  const r = dP / 2;
  const prof = rich
    ? [[r, -0.08], [r, 0.09], [r, 0.09], [r * 0.9, 0.125], [r * 0.9, 0.125], [r * 0.64, 0.125], [r * 0.64, 0.125], [r * 0.62, 0.15], [r * 0.62, 0.15], [0, 0.15]]
    : [[r, -0.08], [r, 0.1], [r, 0.1], [r * 0.88, 0.15], [r * 0.88, 0.15], [0, 0.15]];
  sink.push(new THREE.Matrix4().makeTranslation(x, y0, z));
  sink.lathe('stoneW', prof, segs, null);
  sink.pop();
}

// ─────────────── 기둥 ───────────────

// 배흘림: 뿌리 0.90·D, H/3 에서 최대 D, 머리 0.78·D (modelingGuide.column.entasis)
const entasis = (y) => {
  if (y <= 1 / 3) { const u = (1 / 3 - y) / (1 / 3); return 0.45 + 0.05 * (1 - u * u); }
  const u = (y - 1 / 3) / (2 / 3);
  return 0.5 - 0.11 * Math.pow(u, 1.25);
};
const COL_PROF = [0, 0.13, 1 / 3, 0.58, 0.8, 1].map((y) => [entasis(y), y]);
const COL_PROF_LOW = [0, 1 / 3, 1].map((y) => [entasis(y), y]);

// 기둥: 밑 (x, yb, z) → 머리 (xh, yb + h, zh) — 안쏠림은 기울임(전단)으로
export function column(sink, x, yb, z, xh, zh, h, D, segs, col, low = false) {
  const m = new THREE.Matrix4().set(
    D, xh - x, 0, x,
    0, h, 0, yb,
    0, zh - z, D, z,
    0, 0, 0, 1,
  );
  sink.push(m);
  sink.lathe('painted', low ? COL_PROF_LOW : COL_PROF, segs, col);
  sink.pop();
}

// ─────────────── 공포 ───────────────

// 첨차 단면열 (길이 L, 높이 h, 양끝 초각 곡선 길이 c, 들림 r)
function chumchaStations(L, h, c, r, high) {
  const us = high === 'full' ? [0, 0.4, 0.75, 1] : high ? [0, 0.55, 1] : [0, 1];
  const st = [];
  const half = L / 2;
  c = Math.min(c, half * 0.9);
  for (const u of us) st.push([-half + c * u, r * (1 - Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)))), h]);
  for (const u of us.slice().reverse()) st.push([half - c * u, r * (1 - Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)))), h]);
  return st;
}

// 살미 단면열: 안쪽 z0 에서 바깥 z1(쇠서 끝)까지. 끝은 아래로 굽은 쇠서
function salmiStations(z0, reach, beak, h, high) {
  const zT = reach + beak;
  if (!high) return [[z0, 0, h], [reach, 0, h], [zT, h * 0.45, h * 0.7]];
  if (high !== 'full') return [[z0, 0, h], [reach, 0, h], [reach + beak * 0.55, h * 0.26, h * 0.92], [zT, h * 0.5, h * 0.68]];
  return [
    [z0, 0, h],
    [reach - beak * 0.15, 0, h],
    [reach + beak * 0.3, h * 0.12, h * 0.98],
    [reach + beak * 0.62, h * 0.32, h * 0.86],
    [zT, h * 0.5, h * 0.68],
  ];
}

// 공포 한 조. 로컬: x = 벽 방향, z = 바깥, y = 위, 원점 = 기둥머리(주두 밑) 중심
//   B = { jw, hJ, tH, cH, sH, aW, p, n, maxL, band, high, C }
export function bracketSet(sink, B, o = {}) {
  const { jw, hJ, tH, cH, sH, aW, p, n, C } = B;
  const armO = { side: C.timber, under: C.hwangdan, top: C.timber, band: B.band ? Math.min(0.03, aW / 8 + 0.005) : 0, bandCol: C.white };
  // 주두 (굽 + 몸)
  if (!o.noJudu) {
    sink.frustum('painted', 0, 0, 0, jw * 0.36, jw * 0.36, jw * 0.5, jw * 0.5, hJ * 0.4, C.timber, { bottom: true, bottomCol: C.hwangdan });
    sink.box('painted', 0, hJ * 0.4 + (hJ * 0.6) / 2, 0, jw, hJ * 0.6, jw, { col: C.timber, skip: '-y' });
  }
  const so = jw * 0.62;
  const q = B.q;
  const soro = q === 'full'
    ? (x, y, z) => {
      sink.frustum('painted', x, y, z, so * 0.38, so * 0.38, so * 0.5, so * 0.5, sH * 0.4, C.timber, {});
      sink.box('painted', x, y + sH * 0.4 + (sH * 0.6) / 2, z, so, sH * 0.6, so, { col: C.timber, skip: '-y' });
    }
    : (x, y, z) => sink.box('painted', x, y + sH / 2, z, so, sH, so, { col: C.timber, under: C.hwangdan });
  const tiers = n + 1;
  for (let k = 1; k <= tiers; k++) {
    const yk = hJ + (k - 1) * tH;
    // 주심 첨차
    if (!o.noChumcha) {
      const L = Math.min(jw * (2.3 + 0.95 * (k - 1)), B.maxL);
      sink.push(new THREE.Matrix4().makeTranslation(0, yk, 0));
      sink.arm('painted', chumchaStations(L, cH, jw * 0.52, cH * 0.52, q), aW, armO);
      sink.pop();
      const xs3 = B.soro >= 3 || k === 1 ? [-L / 2 + so * 0.55, 0, L / 2 - so * 0.55] : B.soro === 2 ? [-L / 2 + so * 0.55, L / 2 - so * 0.55] : [0];
      for (const x of xs3) soro(x, yk + cH, 0);
    }
    // 살미 (바깥으로)
    const reach = n > 0 ? Math.min(k, n) * p : jw * 0.55;
    const beak = n > 0 ? jw * 0.7 : jw * 1.05;
    sink.push(new THREE.Matrix4().makeTranslation(0, yk, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)));
    sink.arm('painted', salmiStations(-jw * 0.45, reach, beak, cH, q), aW, armO);
    sink.pop();
    if (n > 0 && k <= n) soro(0, yk + cH, reach);
    // 출목 첨차 (선 j = k - 1)
    if (k >= 2 && k - 1 < n) {
      const j = k - 1;
      const L = Math.min(jw * 2.3, B.maxL);
      sink.push(new THREE.Matrix4().makeTranslation(0, yk, j * p));
      sink.arm('painted', chumchaStations(L, cH, jw * 0.52, cH * 0.52, q), aW, armO);
      sink.pop();
      if (B.soro >= 2) for (const x of [-L / 2 + so * 0.55, L / 2 - so * 0.55]) soro(x, yk + cH, j * p);
      else soro(0, yk + cH, j * p);
    }
  }
}

// 귀공포 (모서리). 로컬: +x, +z 가 바깥, 벽은 -x·-z 쪽으로 뻗음
export function cornerBracket(sink, B) {
  const { jw, hJ, tH, cH, sH, aW, p, n, C } = B;
  const armO = { side: C.timber, under: C.hwangdan, top: C.timber, band: B.band ? Math.min(0.03, aW / 8 + 0.005) : 0, bandCol: C.white };
  sink.frustum('painted', 0, 0, 0, jw * 0.36, jw * 0.36, jw * 0.5, jw * 0.5, hJ * 0.4, C.timber, { bottom: true, bottomCol: C.hwangdan });
  sink.box('painted', 0, hJ * 0.4 + (hJ * 0.6) / 2, 0, jw, hJ * 0.6, jw, { col: C.timber, skip: '-y' });
  const so = jw * 0.62;
  const soro = (x, y, z) => sink.box('painted', x, y + sH / 2, z, so, sH, so, { col: C.timber, under: C.hwangdan });
  for (let k = 1; k <= n + 1; k++) {
    const yk = hJ + (k - 1) * tH;
    const L = Math.min(jw * (2.3 + 0.95 * (k - 1)), B.maxL);
    const reach = n > 0 ? Math.min(k, n) * p : jw * 0.55;
    const beak = n > 0 ? jw * 0.7 : jw * 1.05;
    // 두 방향 팔: 벽 쪽은 첨차 곡선, 바깥은 쇠서
    for (const rot of [0, -Math.PI / 2]) {
      // rot 0: 팔이 x 방향 (앞벽 첨차 + 옆벽 살미), rot -90°: z 방향
      const st = salmiStations(-L / 2, reach, beak, cH, B.q);
      // 안쪽 끝을 첨차처럼 둥글게
      st[0] = [-L / 2, cH * 0.42, cH]; st.splice(1, 0, [-L / 2 + jw * 0.3, cH * 0.08, cH]);
      const m = new THREE.Matrix4().makeTranslation(0, yk, 0);
      if (rot) m.multiply(new THREE.Matrix4().makeRotationY(rot));
      sink.push(m);
      sink.arm('painted', st, aW, armO);
      sink.pop();
    }
    // 귀살미 (대각선)
    const m = new THREE.Matrix4().makeTranslation(0, yk + 0.002, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 4));
    sink.push(m);
    sink.arm('painted', salmiStations(0, reach * Math.SQRT2, beak * 1.25, cH, B.q), aW * 1.05, armO);
    sink.pop();
    soro(0, yk + cH, 0);
    if (n > 0 && k <= n) { soro(reach, yk + cH, 0); soro(0, yk + cH, reach); }
    // 출목 첨차 (L 자: 앞벽 줄과 옆벽 줄이 모서리에서 만남)
    if (k >= 2 && k - 1 < n) {
      const zj = (k - 1) * p;
      const Lh = Math.min(jw * 1.3, B.maxL / 2);
      const x0 = -Lh, x1 = zj + aW * 0.5;
      sink.box('painted', (x0 + x1) / 2, yk + cH / 2, zj, x1 - x0, cH, aW, { col: C.timber, under: C.hwangdan });
      sink.box('painted', zj, yk + cH / 2 + 0.002, (x0 + x1) / 2 - 0.001, aW * 0.98, cH, x1 - x0 - aW, { col: C.timber, under: C.hwangdan });
      soro(-Lh + so * 0.55, yk + cH, zj); soro(zj, yk + cH, -Lh + so * 0.55);
    }
  }
}

// ─────────────── 벽·창호 ───────────────

// 칸 하나의 벽/문. 로컬: x0..x1 벽 방향, z = 0 벽면, +z 바깥. yF = 바닥, yT = 창방 밑
//   type: 'plaster' | 'lattice' | 'window' | 'plank' | 'open'
export function bayInfill(sink, type, x0, x1, yF, yT, o) {
  const { C, Dm } = o;
  if (type === 'open') return;
  const w = x1 - x0, xc = (x0 + x1) / 2;
  const t = Math.max(0.1, Dm * 0.34); // 인방 두께
  const twoSided = !!o.twoSided;
  const sillH = type === 'plank' ? 0.34 : 0.24;
  const panel = (key, a, b, ya, yb, uv) => {
    sink.quad(key, [a, ya, 0.01], [b, ya, 0.01], [b, yb, 0.01], [a, yb, 0.01], null, uv, [0, 0, 1]);
    if (twoSided) sink.quad(key, [b, ya, -0.01], [a, ya, -0.01], [a, yb, -0.01], [b, yb, -0.01], null, uv, [0, 0, -1]);
  };
  // 하인방
  sink.box('painted', xc, yF + sillH / 2, 0, w, sillH, t, { col: C.timber, skip: '-y' });
  const yS = yF + sillH;
  if (type === 'plaster') {
    const yM = yS + (yT - yS) * 0.42;
    sink.box('painted', xc, yM, 0, w, 0.16, t * 0.9, { col: C.timber });
    panel('plaster', x0, x1, yS, yM - 0.08);
    panel('plaster', x0, x1, yM + 0.08, yT);
    return;
  }
  const yH = Math.min(yT - 0.3, yF + o.doorH);   // 상인방 아래
  const hdH = 0.18;
  sink.box('painted', xc, yH + hdH / 2, 0, w, hdH, t, { col: C.timber });
  panel('plaster', x0, x1, yH + hdH, yT);
  const colR = Dm * 0.42;
  const a = x0 + colR, b = x1 - colR;
  // 문선
  const fw = Math.min(0.14, w * 0.04);
  for (const x of [a + fw / 2, b - fw / 2]) sink.box('painted', x, (yS + yH) / 2, 0.02, fw, yH - yS, t * 0.8, { col: C.timber });
  const a2 = a + fw, b2 = b - fw;
  if (type === 'lattice') {
    const mid = (a2 + b2) / 2;
    panel('lattice', a2, mid, yS, yH);
    panel('lattice', mid, b2, yS, yH);
    sink.box('painted', mid, (yS + yH) / 2, 0.03, 0.06, yH - yS, 0.05, { col: C.timber });
  } else if (type === 'window') {
    const yW = yS + (yH - yS) * 0.42;
    sink.box('painted', xc, yW, 0, w, 0.14, t * 0.9, { col: C.timber });
    panel('plaster', x0, x1, yS, yW - 0.07);
    const mid = (a2 + b2) / 2;
    panel('lattice', a2, mid, yW + 0.07, yH, [0, 0.35, 1, 0.35, 1, 0.9, 0, 0.9]);
    panel('lattice', mid, b2, yW + 0.07, yH, [0, 0.35, 1, 0.35, 1, 0.9, 0, 0.9]);
    // 창 옆 벽
    panel('plaster', x0, a2, yW + 0.07, yH);
    panel('plaster', b2, x1, yW + 0.07, yH);
  } else if (type === 'plank') {
    // 판문 두 짝 + 띠장 + 문정(금동 못) + 문고리
    const gap = 0, th = 0.09;
    const lw = (b2 - a2) / 2;
    for (const s of [0, 1]) {
      const la = a2 + s * lw + (s ? gap : 0), lb = a2 + (s + 1) * lw - (s ? 0 : gap);
      const lc = (la + lb) / 2;
      sink.box('plank', lc, (yS + yH) / 2, 0, lb - la, yH - yS, th, { uv: 'unit' });
      for (const k of [0.16, 0.5, 0.84]) {
        const yy = yS + (yH - yS) * k;
        for (const zz of [1, -1]) sink.box('painted', lc, yy, zz * (th / 2 + 0.018), lb - la - 0.04, 0.13, 0.036, { col: C.timberDark, skip: zz > 0 ? '-z' : '+z' });
      }
      if (o.studs) {
        const rows = [0.16, 0.5, 0.84];
        for (const k of rows) {
          const yy = yS + (yH - yS) * k;
          for (let q = 1; q <= 3; q++) {
            const xx = la + ((lb - la) * q) / 4;
            sink.disc('gilt', V3(xx, yy, th / 2 + 0.04), V3(0, 0, 1), 0.035, 6, null);
          }
        }
      }
      if (s === 0) sink.box('painted', lb, (yS + yH) / 2, 0, 0.05, yH - yS, th + 0.03, { col: C.timberDark }); // 띠 (맞닿는 선)
      // 문고리 (금동 고리 + 바탕 원판)
      const kx = s ? la + 0.16 : lb - 0.16, ky = yS + (yH - yS) * 0.45;
      sink.disc('gilt', V3(kx, ky, th / 2 + 0.005), V3(0, 0, 1), 0.085, 10, null);
      ring(sink, 'gilt', kx, ky - 0.11, th / 2 + 0.03, 0.09, 0.013);
    }
  }
}

// 금동 문고리 고리 (세로 원환)
function ring(sink, key, x, y, z, R, r) {
  const n = 10, m = 4;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const c0 = V3(x + Math.cos(a0) * R, y + Math.sin(a0) * R, z), c1 = V3(x + Math.cos(a1) * R, y + Math.sin(a1) * R, z);
    sink.cyl(key, c0, c1, r, r, m, null);
  }
}

// ─────────────── 난간 ───────────────

// 주칠 난간: 점열 pts([x, z]) 를 따라, 바닥 y0 에서 높이 h. 금동 꽃장식(gilt)
export function railing(sink, pts, y0, h, o) {
  const { C } = o;
  const col = C.lacquer;
  const postW = o.postW ?? 0.11;
  const high = o.high;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
    if (L < 0.05) continue;
    const ya = A[2] ?? y0, yb = B[2] ?? y0;
    const nP = Math.max(1, Math.round(L / (o.spacing ?? 1.2)));
    for (let k = 0; k <= nP; k++) {
      if (k === 0 && i > 0) continue;
      const u = k / nP;
      const x = A[0] + dx * u, z = A[1] + dz * u, yy = ya + (yb - ya) * u;
      sink.box('painted', x, yy + (h + 0.08) / 2, z, postW, h + 0.08, postW, { col, skip: '-y' });
      if (o.gilt && high) sink.box('gilt', x, yy + h + 0.12, z, postW * 0.9, 0.08, postW * 0.9, { skip: '-y' });
    }
    const A3 = (dy) => V3(A[0], ya + dy, A[1]), B3 = (dy) => V3(B[0], yb + dy, B[1]);
    member(sink, 'painted', A3(h), B3(h), 0.075, 0.1, { col, ext: 0.04 });            // 돌란대
    member(sink, 'painted', A3(h * 0.52), B3(h * 0.52), 0.07, 0.07, { col });         // 중방
    member(sink, 'painted', A3(0.12), B3(0.12), 0.08, 0.09, { col });                 // 하방
    if (high) {
      // 난간 동자 (짧은 기둥)
      const nD = Math.max(1, Math.round(L / 0.36));
      for (let k = 1; k < nD; k++) {
        const u = k / nD;
        const x = A[0] + dx * u, z = A[1] + dz * u, yy = ya + (yb - ya) * u;
        sink.box('painted', x, yy + h * 0.76, z, 0.045, h * 0.46, 0.045, { col, skip: '-y+y' });
      }
      // 풍혈 판
      const [m, L2] = memberMatrix(A3(0.16), B3(0.16));
      sink.push(m);
      sink.box('painted', 0, (h * 0.5 - 0.16) / 2, 0, L2, h * 0.5 - 0.16, 0.025, { col: C.lacquerDark || col });
      sink.pop();
    }
  }
}

// ─────────────── 편액 ───────────────

const plaqueTexCache = new Map();
let glyphOK = null;
// 한자 글꼴이 있는지(두부 상자로 나오지 않는지) 검사
function hasCJK(ctx) {
  if (glyphOK !== null) return glyphOK;
  const probe = (ch) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    x.font = '28px serif';
    x.fillText(ch, 2, 28);
    return x.getImageData(0, 0, 32, 32).data.join(',');
  };
  try { glyphOK = probe('會') !== probe('\u{10FFFD}') && probe('會') !== probe('￿'); } catch { glyphOK = true; }
  return glyphOK;
}

export function plaqueTexture(text, P) {
  const key = text + '|' + P.lacquerRed;
  if (plaqueTexCache.has(key)) return plaqueTexCache.get(key);
  const chars = [...text];
  const n = chars.length;
  const H = 192, W = Math.round(H * (0.82 * n + 0.55));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 테두리: 녹·청·금 띠 (단청 액자)
  ctx.fillStyle = P.gunCheong; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = P.yangrok; ctx.fillRect(8, 8, W - 16, H - 16);
  ctx.fillStyle = P.gold; ctx.fillRect(16, 16, W - 32, H - 32);
  ctx.fillStyle = P.lacquerRed; ctx.fillRect(22, 22, W - 44, H - 44);
  // 모서리 금 장식
  ctx.fillStyle = P.gold;
  for (const [x, y] of [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]]) { ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); }
  // 글씨: 오른쪽에서 왼쪽으로 (金書朱地)
  const cw = (W - 70) / n;
  const fs = Math.min(H * 0.6, cw * 0.9);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ok = hasCJK(ctx);
  ctx.fillStyle = P.gold;
  ctx.font = `bold ${Math.round(fs)}px "Noto Serif KR","Noto Serif CJK KR","Noto Serif CJK TC","Source Han Serif","Batang","AppleMyungjo","Songti TC","PMingLiU","MingLiU","SimSun",serif`;
  chars.forEach((ch, i) => {
    const x = W - 35 - cw * (i + 0.5), y = H / 2 + 4;
    if (ok) {
      ctx.fillStyle = 'rgba(40,10,5,0.45)';
      ctx.fillText(ch, x + 3, y + 3);
      ctx.fillStyle = P.gold;
      ctx.fillText(ch, x, y);
    } else {
      // 글꼴이 없으면 붓획 느낌의 금색 획으로 대신함
      const r = rng(ch.codePointAt(0));
      ctx.strokeStyle = P.gold; ctx.lineCap = 'round';
      for (let s = 0; s < 6; s++) {
        ctx.lineWidth = fs * (0.06 + r() * 0.05);
        ctx.beginPath();
        const x0 = x + (r() - 0.5) * fs * 0.7, y0 = y + (r() - 0.5) * fs * 0.7;
        const hor = r() < 0.5;
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + (hor ? fs * 0.25 : (r() - 0.5) * fs * 0.2), y0 + (hor ? (r() - 0.5) * fs * 0.1 : fs * 0.2), x0 + (hor ? fs * 0.45 : (r() - 0.5) * 0.2), y0 + (hor ? 0 : fs * 0.4));
        ctx.stroke();
      }
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const r = { tex, aspect: W / H };
  plaqueTexCache.set(key, r);
  return r;
}

// 포벽 단청 (rank 1–2): 회벽 바탕 + 붉은 테두리 + 가운데 연화문 + 좌우 넝쿨 (12세기 보상화 계열)
export function pobyeokTexture(P) {
  const W = 768, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = P.plasterWall; x.fillRect(0, 0, W, H);
  const r = rng(29);
  for (let i = 0; i < 5000; i++) { x.fillStyle = `rgba(0,0,0,${r() * 0.05})`; x.fillRect(r() * W, r() * H, 2, 2); }
  x.strokeStyle = P.timberRed; x.lineWidth = 12; x.strokeRect(6, 6, W - 12, H - 12);
  x.strokeStyle = P.baekbun; x.lineWidth = 3; x.strokeRect(16, 16, W - 32, H - 32);
  const cx = W / 2, cy = H / 2;
  // 넝쿨
  x.lineCap = 'round';
  for (const d of [-1, 1]) {
    x.strokeStyle = P.yangrok; x.lineWidth = 7;
    x.beginPath(); x.moveTo(cx + d * 70, cy);
    for (let k = 0; k < 4; k++) {
      const x0 = cx + d * (70 + k * 60);
      x.bezierCurveTo(x0 + d * 20, cy + (k % 2 ? 42 : -42), x0 + d * 40, cy + (k % 2 ? 42 : -42), x0 + d * 60, cy);
    }
    x.stroke();
    for (let k = 0; k < 4; k++) {
      const x0 = cx + d * (100 + k * 60), y0 = cy + (k % 2 ? 30 : -30);
      x.fillStyle = k % 2 ? P.gunCheong : P.seokhwang;
      x.beginPath(); x.ellipse(x0, y0, 13, 8, d * 0.6, 0, Math.PI * 2); x.fill();
      x.strokeStyle = P.baekbun; x.lineWidth = 2; x.stroke();
    }
  }
  // 연화 (8엽)
  x.save(); x.translate(cx, cy); x.scale(0.8, 0.8); x.translate(-cx, -cy);
  x.fillStyle = P.gunCheong; x.beginPath(); x.arc(cx, cy, 78, 0, Math.PI * 2); x.fill();
  x.fillStyle = P.baekbun; x.beginPath(); x.arc(cx, cy, 71, 0, Math.PI * 2); x.fill();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    x.save(); x.translate(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); x.rotate(a);
    x.fillStyle = k % 2 ? P.yangrok : P.lacquerRed;
    x.beginPath(); x.ellipse(0, 0, 27, 15, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = P.baekbun; x.lineWidth = 3; x.stroke();
    x.restore();
  }
  x.fillStyle = P.seokhwang; x.beginPath(); x.arc(cx, cy, 20, 0, Math.PI * 2); x.fill();
  x.fillStyle = P.lacquerRed; x.beginPath(); x.arc(cx, cy, 9, 0, Math.PI * 2); x.fill();
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 편액 판: 중심 (x, y, z), 크기 w × h, 앞으로 기울기 tilt(rad)
export function plaque(sink, x, y, z, w, h, tilt, C) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(-tilt));
  sink.push(m);
  sink.box('painted', 0, 0, -0.06, w + 0.12, h + 0.12, 0.1, { col: C.lacquerDark || C.lacquer });
  sink.quad('plaque', [-w / 2, -h / 2, 0.0], [w / 2, -h / 2, 0.0], [w / 2, h / 2, 0.0], [-w / 2, h / 2, 0.0], null, undefined, [0, 0, 1]);
  // 걸쇠
  sink.box('gilt', -w * 0.3, h / 2 + 0.1, -0.08, 0.05, 0.25, 0.05, {});
  sink.box('gilt', w * 0.3, h / 2 + 0.1, -0.08, 0.05, 0.25, 0.05, {});
  sink.pop();
}

// ─────────────── 극(戟) 거치대 ───────────────

// 극 n 자루 (x 방향으로 늘어섬), 중심 (cx, 0, cz)
export function halberdRack(sink, cx, cz, n, C, sp = 0.38) {
  const L = (n - 1) * sp, h = 3.1;
  for (const s of [-1, 1]) sink.box('painted', cx + s * (L / 2 + 0.25), 1.1, cz, 0.14, 2.2, 0.14, { col: C.lacquer, skip: '-y' });
  for (const y of [0.9, 2.0]) sink.box('painted', cx, y, cz, L + 0.64, 0.1, 0.12, { col: C.lacquer });
  for (let i = 0; i < n; i++) {
    const x = cx - L / 2 + i * sp;
    sink.cyl('painted', V3(x, 0, cz), V3(x, h, cz), 0.032, 0.028, 6, C.timberDark);
    // 날: 창날(곧은 날) + 옆가지(굽은 날) — 금동
    sink.box('gilt', x, h + 0.26, cz, 0.075, 0.52, 0.03, {});
    sink.box('gilt', x, h + 0.55, cz, 0.04, 0.08, 0.025, {});
    sink.box('gilt', x + 0.13, h + 0.08, cz, 0.22, 0.07, 0.025, {});
    sink.box('gilt', x + 0.23, h + 0.16, cz, 0.05, 0.16, 0.025, {});
    // 붉은 술과 깃발
    sink.box('painted', x, h - 0.12, cz, 0.1, 0.2, 0.1, { col: C.lacquer });
    sink.box('painted', x - 0.1, h - 0.45, cz, 0.18, 0.5, 0.012, { col: C.lacquer });
  }
}
