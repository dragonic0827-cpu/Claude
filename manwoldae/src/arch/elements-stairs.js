// 계단(디딤돌·소맷돌·지대석·주칠 목난간), 다리(홍예교·널다리), 기념물(첨성대·비좌·표지)
import * as THREE from 'three';
import { rng } from '../core/textures.js';
import { Sink, box, tube, worldUV, elementMats, clamp, lerp, rad, v2, segProj } from './elements-geo.js';
import SPEC from '../data/spec.js';   // opts.streams 가 없을 때 물길 기본값

// 대지 가장자리 갑석(terrain.js CAP_OUT)이 계단 쪽으로 8 cm 내밀어 있어, 맨 윗단 디딤판은 그만큼 뒤에서 시작합니다.
const TOP_GAP = 0.08;

export function hashId(s = '') {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 주칠 목난간은 명세에 railing: true 로 적은 계단에만 답니다 (이름으로 짐작하지 않음).
// 『고려도경』의 "東西兩階 丹漆欄檻"은 회경전 기단 가운데 두 계단(buildings[].platformStairs)에 이미 달려 있습니다.
export function stairHasRailing(def) {
  return def.railing === true;
}

// ─────────────────────────── 계단 ───────────────────────────
// 로컬 좌표: x = 폭 방향, z = 앞(내려가는 쪽, 발치 +run/2), 위(윗변) −run/2. y 는 월드 높이 그대로.
export function createStairs(def, mats) {
  const E = elementMats(mats);
  const C = E.C;
  const group = new THREE.Group();
  group.name = def.id || 'stairs';
  const bot = def.bottomY ?? 0, top = def.topY ?? bot + 1;
  const Ht = Math.max(0.05, top - bot);
  const N = def.steps > 0 ? Math.round(def.steps) : Math.max(1, Math.round(Ht / 0.18));
  const run = def.run > 0 ? def.run : N * 0.3;
  const rise = Ht / N, tread = run / N;
  const W = def.width > 0 ? def.width : 4;
  const inset = !!def.inset;
  const sw = inset ? 0.3 : clamp(0.22 + 0.04 * W, 0.42, 0.75);      // 소맷돌(옆막이) 폭
  const hs = inset ? 0.2 : 0.3;                                         // 디딤 모서리선 위로 솟은 높이
  const tw = Math.max(0.6, W - 2 * sw);
  const zf = run / 2, zt = -run / 2;
  const R = rng(hashId(def.id) || 7);
  const sink = new Sink();
  const gb = sink.get(E.granite);
  const ao = C.ao;

  // 디딤 모서리선: 각 단 앞 윗모서리를 잇는 직선
  const noseLine = (z) => bot + rise + ((zf - z) / tread) * rise;
  const capH = inset ? 0.03 : 0.12;
  const stringerTop = (z, h = hs) => Math.min(noseLine(z) + h, top + capH);

  // ── 디딤돌 ──
  const nose = Math.min(0.03, tread * 0.1), nh = Math.min(0.05, rise * 0.3), ch = 0.012;
  const x0 = -tw / 2, x1 = tw / 2;
  for (let i = 0; i < N; i++) {
    const zi = zf - i * tread;
    const last = i === N - 1;
    const zb = last ? zt + TOP_GAP : zf - (i + 1) * tread - nose;
    const yT = bot + (i + 1) * rise, yB = i === 0 ? bot - 0.05 : bot + i * rise;
    const off = R() * 4;
    const U = (x) => (x + off) / 4;
    // 디딤판 윗면 (뒤쪽 구석은 그늘)
    const kb = last ? 0.95 : 0.7;
    gb.quad([x0, yT, zb], [x1, yT, zb], [x1, yT, zi - ch], [x0, yT, zi - ch],
      [U(x0), zb / 2, U(x1), zb / 2, U(x1), (zi - ch) / 2, U(x0), (zi - ch) / 2],
      [ao(kb), ao(kb), ao(1), ao(1)], [0, 1, 0]);
    // 모접기
    gb.quad([x0, yT, zi - ch], [x1, yT, zi - ch], [x1, yT - ch, zi], [x0, yT - ch, zi],
      [U(x0), 0.5, U(x1), 0.5, U(x1), 0.51, U(x0), 0.51], ao(1.06), [0, 0.7, 0.7]);
    // 코 앞면
    gb.quad([x0, yT - ch, zi], [x1, yT - ch, zi], [x1, yT - nh, zi], [x0, yT - nh, zi],
      [U(x0), (yT - ch) / 2, U(x1), (yT - ch) / 2, U(x1), (yT - nh) / 2, U(x0), (yT - nh) / 2], ao(0.97), [0, 0, 1]);
    // 코 밑면
    gb.quad([x0, yT - nh, zi], [x1, yT - nh, zi], [x1, yT - nh, zi - nose], [x0, yT - nh, zi - nose],
      [U(x0), 0.3, U(x1), 0.3, U(x1), 0.31, U(x0), 0.31], ao(0.5), [0, -1, 0]);
    // 챌판 (위는 코 그늘)
    gb.quad([x0, yT - nh, zi - nose], [x1, yT - nh, zi - nose], [x1, yB, zi - nose], [x0, yB, zi - nose],
      [U(x0), (yT - nh) / 2, U(x1), (yT - nh) / 2, U(x1), yB / 2, U(x0), yB / 2],
      [ao(0.62), ao(0.62), ao(0.8), ao(0.8)], [0, 0, 1]);
  }

  // ── 소맷돌 / 옆막이돌 ──
  const endE = inset ? 0 : clamp(0.3 + 0.025 * W, 0.4, 0.7);  // 발치 앞으로 내민 길이
  const zBack = zt - 0.1;
  const stringerProfile = (h) => {
    // (z, y) 윗선: 뒤 끝 → 앞 끝(둥근 머리) → 바닥
    const pts = [];
    const zk = zf - ((top + capH - h - bot - rise) / rise) * tread; // 수평 윗면이 끝나는 곳
    pts.push([zBack, top + capH]);
    if (zk > zBack + 0.05 && zk < zf) pts.push([zk, top + capH]);
    const yEnd = noseLine(zf) + h;
    if (inset) {
      const r = Math.min(0.18, h);
      pts.push([zf - r, stringerTop(zf - r, h)]);
      for (let k = 1; k <= 4; k++) {
        const a = (k / 4) * (Math.PI / 2);
        pts.push([zf - r + Math.sin(a) * r, stringerTop(zf - r, h) - (1 - Math.cos(a)) * r * 1.2]);
      }
      pts.push([zf, bot + 0.04]);
    } else {
      pts.push([zf, yEnd]);
      const ry = yEnd - (bot + 0.05);
      for (let k = 1; k <= 7; k++) {
        const a = (k / 7) * (Math.PI / 2);
        pts.push([zf + Math.sin(a) * endE, bot + 0.05 + Math.cos(a) * ry]);
      }
    }
    const zEnd = pts[pts.length - 1][0];
    pts.push([zEnd, bot - 0.3]);
    return pts;
  };
  const stringer = (xa, xb, h, withOuter = true) => {
    // xa: 계단 쪽 면, xb: 바깥 면 (부호로 방향)
    const prof = stringerProfile(h);
    const sgn = Math.sign(xb - xa) || 1;
    const poly = [...prof, [zBack, bot - 0.3]];
    const colY = (y) => ao(y < bot + 0.25 ? 0.82 : 1);
    for (const [x, outward] of [[xa, -sgn], [xb, sgn]]) {
      if (x === xb && !withOuter) continue;
      const p3 = poly.map(([z, y]) => [x, y, z]);
      const p2 = poly.map(([z, y]) => [z, y]);
      gb.polygon(p3, p2, [outward, 0, 0], (p) => [p[2] / 4 + (x > 0 ? 0.37 : 0), p[1] / 2], colY(bot));
    }
    // 윗면·머리 띠
    let acc = 0;
    for (let k = 0; k < prof.length - 1; k++) {
      const [za, ya] = prof[k], [zb2, yb2] = prof[k + 1];
      const L = Math.hypot(zb2 - za, yb2 - ya);
      const dz = zb2 - za, dy = yb2 - ya;
      // 윗선 진행(+z 쪽으로 내려감)의 바깥 법선 = (0, dz, −dy) 정규화 → 위/앞
      const nl = Math.hypot(dz, dy) || 1;
      const n = [0, dz / nl, -dy / nl];
      gb.quad([xa, ya, za], [xb, ya, za], [xb, yb2, zb2], [xa, yb2, zb2],
        [acc / 4, xa / 2, acc / 4, xb / 2, (acc + L) / 4, xb / 2, (acc + L) / 4, xa / 2],
        [colY(ya), colY(ya), colY(yb2), colY(yb2)], n);
      acc += L;
    }
  };
  for (const s of [-1, 1]) stringer(s * tw / 2, s * W / 2, hs, true);

  // 넓은 계단(14 m 이상)은 가운데 소맷돌 두 줄로 세 길(어도)을 나눕니다
  if (!inset && W >= 14) {
    const dw = 0.34;
    for (const s of [-1, 1]) {
      const xc = s * tw * 0.2;
      stringer(xc - dw / 2, xc + dw / 2, 0.24, true);
    }
  }

  // ── 지대석(맨 아래 받침돌) ──
  const jx = inset ? W / 2 : W / 2 + 0.08;
  const jz0 = zf - 0.15, jz1 = zf + (inset ? 0.35 : endE + 0.25);
  box(gb, [0, bot - 0.12, (jz0 + jz1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], jx, 0.18, (jz1 - jz0) / 2,
    { uv: 'world', scale: [4, 2], skip: ['-y', '-z'], col: ao(0.92) });
  if (!inset) {
    // 소맷돌 바깥 아랫단
    for (const s of [-1, 1]) {
      const xa = s * (W / 2 - 0.02), xb = s * (W / 2 + 0.1);
      const zc = (zBack + jz0) / 2;
      box(gb, [(xa + xb) / 2, bot - 0.08, zc], [0, 0, 1], [0, 1, 0], [1, 0, 0], (jz0 - zBack) / 2, 0.22, Math.abs(xb - xa) / 2,
        { uv: 'world', scale: [4, 2], skip: ['-y', '-x', '+x'], col: ao(0.9) });
    }
  }

  // ── 주칠 목난간 + 금동 꽃장식 ──
  if (stairHasRailing(def)) buildRailing(sink, E, mats, { tw, sw, zt, zf, inset, stringerTop, endE, run });

  sink.build(group, def.id, 'stairs');
  group.position.set(def.cx || 0, 0, def.cz || 0);
  group.rotation.y = -rad(def.rotationDeg);
  group.userData = { id: def.id, nameKo: def.nameKo, kind: 'stairs', pickId: def.id };
  return group;
}

// 금동 연봉(연꽃 봉오리) 기둥머리
let _budGeo = null;
function budGeometry() {
  if (_budGeo) return _budGeo;
  const pts = [[0.0, -0.035], [0.082, -0.035], [0.082, -0.005], [0.07, 0.0], [0.075, 0.03], [0.068, 0.07], [0.048, 0.11], [0.022, 0.145], [0.0, 0.165]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  _budGeo = new THREE.LatheGeometry(pts, 8);
  return _budGeo;
}

function buildRailing(sink, E, mats, o) {
  const { tw, sw, zt, zf, inset, stringerTop } = o;
  const lb = sink.get(mats.lacquer);
  const gl = sink.get(mats.gilt);
  const Hr = 0.88;
  const z0 = zt + (inset ? 0.4 : 0.3), z1 = zf - (inset ? 0.25 : 0.12);
  const n = Math.max(2, Math.ceil((z1 - z0) / 1.8) + 1);
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const bud = budGeometry();
  const M = new THREE.Matrix4();
  for (const s of [-1, 1]) {
    const x = s * (tw / 2 + sw / 2);
    const zs = [];
    for (let i = 0; i < n; i++) zs.push(lerp(z0, z1, i / (n - 1)));
    const yS = zs.map((z) => stringerTop(z));
    // 기둥
    zs.forEach((z, i) => {
      const y0 = yS[i] - 0.03, y1 = yS[i] + Hr + 0.1;
      box(lb, [x, (y0 + y1) / 2, z], Y, X, Z, (y1 - y0) / 2, 0.065, 0.065, { uv: 'member', skip: ['-x'] });
      M.makeTranslation(x, y1, z);
      gl.addGeometry(bud, M);
      // 돌란대가 닿는 곳의 금동 꽃장식 (안팎)
      for (const side of [-1, 1]) rosette(gl, [x + side * 0.068, yS[i] + Hr - 0.02, z], [side, 0, 0], 0.05);
    });
    // 칸마다 난간대
    for (let i = 0; i < n - 1; i++) {
      const za = zs[i] + 0.065, zb = zs[i + 1] - 0.065;
      const ya = lerp(yS[i], yS[i + 1], 0.065 / (zs[i + 1] - zs[i]));
      const yb = lerp(yS[i], yS[i + 1], 1 - 0.065 / (zs[i + 1] - zs[i]));
      tube(lb, [x, ya + Hr, za], [x, yb + Hr, zb], 0.045, 8);                 // 돌란대
      rail(lb, x, za, zb, ya + 0.45, yb + 0.45, 0.03, 0.035);                   // 띠장
      rail(lb, x, za, zb, ya + 0.04, yb + 0.04, 0.05, 0.04);                    // 하방
      const L = zb - za;
      const nb = Math.max(1, Math.floor(L / 0.42));
      for (let k = 1; k <= nb; k++) {
        const t = k / (nb + 1);
        const z = lerp(za, zb, t), yy = lerp(ya, yb, t);
        const b0 = yy + 0.08, b1 = yy + Hr - 0.035;
        box(lb, [x, (b0 + b1) / 2, z], Y, X, Z, (b1 - b0) / 2, 0.022, 0.022, { uv: 'member', skip: ['-x', '+x'] });
      }
      // 칸 가운데 금동 꽃(동화) — 바깥쪽
      const zm = (za + zb) / 2, ym = (ya + yb) / 2 + 0.66;
      rosette(gl, [x + s * 0.03, ym, zm], [s, 0, 0], 0.06);
    }
  }
}

// 기울어진 네모 난간대 (x 고정, z a→b, y a→b)
function rail(buf, x, za, zb, ya, yb, hw, hh) {
  const A = (dx, dy) => [x + dx, ya + dy, za], B = (dx, dy) => [x + dx, yb + dy, zb];
  buf.quad(A(-hw, hh), B(-hw, hh), B(hw, hh), A(hw, hh), null, null, [0, 1, 0]);
  buf.quad(A(hw, -hh), B(hw, -hh), B(hw, hh), A(hw, hh), null, null, [1, 0, 0]);
  buf.quad(A(-hw, -hh), B(-hw, -hh), B(-hw, hh), A(-hw, hh), null, null, [-1, 0, 0]);
  buf.quad(A(-hw, -hh), B(-hw, -hh), B(hw, -hh), A(hw, -hh), null, null, [0, -1, 0]);
}

// 육각 꽃판(얇은 원판) — n 방향을 봄
function rosette(buf, c, n, r) {
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const s = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const sl = Math.hypot(...s) || 1;
  const a = s.map((q) => q / sl);
  const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    pts.push([c[0] + (a[0] * Math.cos(t) + b[0] * Math.sin(t)) * r, c[1] + (a[1] * Math.cos(t) + b[1] * Math.sin(t)) * r, c[2] + (a[2] * Math.cos(t) + b[2] * Math.sin(t)) * r]);
  }
  const top = [c[0] + n[0] * r * 0.35, c[1] + n[1] * r * 0.35, c[2] + n[2] * r * 0.35];
  for (let i = 0; i < 6; i++) buf.tri(top, pts[i], pts[(i + 1) % 6], null, null, n);
}

// ─────────────────────────── 다리 ───────────────────────────
// 로컬 좌표: z = 다리 길이 방향(length), x = 폭(width). 물길(opts.streams, 없으면 spec.terrain.streams)로
// 다리 방향을 검증하고(물길과 나란하면 90° 돌려 건너게) 수면 높이를 읽습니다.
// 셋째 인자로 heightAt 함수를 넘겨도 됩니다(쓰지 않음) — createBridge(def, mats, heightAt, opts).
export function createBridge(def, mats, opts = {}, opts2 = null) {
  if (typeof opts === 'function' || !opts) opts = opts2 || {};
  const E = elementMats(mats);
  const C = E.C;
  const group = new THREE.Group();
  group.name = def.id || 'bridge';
  const L = def.length > 0 ? def.length : 8, Wd = def.width > 0 ? def.width : 4;
  const deck = def.deckY ?? 0;
  let rot = def.rotationDeg || 0;
  const problems = [];
  // 물길 찾기
  let water = deck - 1.9, chHalf = Math.min(L / 2 - 0.5, 3.5), along0 = 0;
  const streams = opts.streams || (opts.terrain && opts.terrain.streams) || (SPEC.terrain && SPEC.terrain.streams) || null;
  if (streams) {
    let best = null;
    for (const st of streams) {
      const P = st.path || [];
      for (let i = 0; i < P.length - 1; i++) {
        const pr = segProj([def.cx, def.cz], P[i], P[i + 1]);
        if (!best || pr.d < best.d) best = { d: pr.d, st, i, t: pr.t, q: pr.q };
      }
    }
    if (best && best.d < 25) {
      const P = best.st.path;
      const sd = v2.norm(v2.sub(P[best.i + 1], P[best.i]));
      const r = rad(rot);
      const ax = [-Math.sin(r), Math.cos(r)]; // 로컬 +z (길이 방향)
      if (Math.abs(v2.dot(ax, sd)) > 0.7) {
        rot += 90;
        problems.push(`${def.id}: 길이 방향이 물길과 나란해 90° 돌림`);
      }
      const wy = best.st.waterY;
      if (Array.isArray(wy) && wy.length === P.length) water = lerp(wy[best.i], wy[best.i + 1], best.t);
      chHalf = Math.min(L / 2 - 0.3, (best.st.width || 6) / 2 + 0.5);
      const r2 = rad(rot);
      const ax2 = [-Math.sin(r2), Math.cos(r2)];
      along0 = v2.dot(v2.sub(best.q, [def.cx, def.cz]), ax2);
    }
  }
  const bed = water - 0.6;
  const sink = new Sink();
  const sb = sink.get(mats.stone);
  const gb = sink.get(E.granite);
  const ao = C.ao;
  const stoneUV = (p, n) => worldUV(p, n, [4, 2]);
  const style = def.style || 'stone-slab';
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

  if (style === 'stone-arch') {
    // 쌍홍예: 가운데 교각 + 반원 홍예 둘, 물 위로 반원이 비칩니다
    const S = 2 * chHalf;
    const pier = 0.9;
    const twin = S > 4.6;
    const span = twin ? Math.min((S - pier) / 2, 3.4) : Math.min(S - 0.4, 4.2);
    const ra = span / 2;
    let yS = water - 0.25;
    const deckT = 0.3;
    const crownMax = deck - deckT - 0.28;
    if (yS + ra > crownMax) yS = crownMax - ra;
    const centers = twin ? [-(pier / 2 + ra), pier / 2 + ra] : [0];
    const yBot = bed - 0.7;
    const Lb = L / 2 + 0.7;
    const shape = new THREE.Shape();
    shape.moveTo(-Lb, yBot); shape.lineTo(Lb, yBot); shape.lineTo(Lb, deck - deckT); shape.lineTo(-Lb, deck - deckT); shape.lineTo(-Lb, yBot);
    for (const c of centers) {
      const h = new THREE.Path();
      h.moveTo(c - ra, yBot + 0.08);
      h.lineTo(c - ra, yS);
      h.absarc(c, yS, ra, Math.PI, 0, true);
      h.lineTo(c + ra, yBot + 0.08);
      h.lineTo(c - ra, yBot + 0.08);
      shape.holes.push(h);
    }
    const body = new THREE.ExtrudeGeometry(shape, { depth: Wd, bevelEnabled: false, curveSegments: 14 });
    // (sx, sy, ez) → (ez − Wd/2, sy, −sx)
    const M = new THREE.Matrix4().set(0, 0, 1, -Wd / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
    sb.addGeometry(body, M, { uvFn: stoneUV });
    body.dispose();
    // 홍예석 띠 (앞뒤 면에서 5 cm 내밂)
    for (const c of centers) {
      const ring = new THREE.Shape();
      const ro = ra + 0.42;
      ring.moveTo(c + ro, yS);
      ring.absarc(c, yS, ro, 0, Math.PI, false);
      ring.lineTo(c - ra, yS);
      ring.absarc(c, yS, ra, Math.PI, 0, true);
      ring.lineTo(c + ro, yS);
      const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.05, bevelEnabled: false, curveSegments: 16 });
      for (const side of [-1, 1]) {
        const x0 = side > 0 ? Wd / 2 : -Wd / 2 - 0.05;
        const Mr = new THREE.Matrix4().set(0, 0, 1, x0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
        gb.addGeometry(rg, Mr, {
          uvFn: (p) => { const a = Math.atan2(p[1] - yS, -p[2] - c); return [a * (ra + 0.2) * 2.2 / 4, Math.hypot(p[1] - yS, -p[2] - c) / 2]; },
          colFn: () => ao(0.97),
        });
      }
      rg.dispose();
      // 이맛돌 (홍예 꼭대기 쐐기돌) 조금 더 내밂
      for (const side of [-1, 1]) {
        const xk = side * (Wd / 2 + 0.07);
        box(gb, [xk, yS + ra + 0.2, -c], Z, Y, X, 0.2, 0.24, 0.035, { uv: 'world', scale: [2, 2], col: ao(1.02) });
      }
    }
    // 멍에돌 띠(상판 아래 내민 돌림) + 상판
    box(gb, [0, deck - deckT / 2 - 0.01, 0], Z, Y, X, L / 2, deckT / 2, Wd / 2 + 0.1, { uv: 'world', scale: [2.5, 2], col: ao(0.95) });
    box(gb, [0, deck - 0.02, 0], Z, Y, X, L / 2, 0.02, Wd / 2 + 0.04, { uv: 'world', scale: [2.5, 2], skip: ['-y'], col: ao(1) });
    // 난간 대신 낮은 연석(지대 돌) + 양 끝 엄지석 — 궁궐 돌난간 근거가 없어 연석만 둡니다
    const cw = 0.34, chh = 0.3;
    for (const s of [-1, 1]) {
      const xc = s * (Wd / 2 - cw / 2 - 0.02);
      box(gb, [xc, deck + chh / 2, 0], Z, Y, X, L / 2 - 0.45, chh / 2, cw / 2, { uv: 'world', scale: [2.2, 2], skip: ['-y'], col: ao(0.98) });
      for (const e of [-1, 1]) {
        box(gb, [xc, deck + 0.24, e * (L / 2 - 0.25)], Z, Y, X, 0.22, 0.24, cw / 2 + 0.04, { uv: 'world', scale: [2.2, 2], skip: ['-y'], col: ao(1) });
      }
    }
  } else {
    // 널다리: 돌기둥 교각 + 멍엣돌 + 청판돌
    const S = 2 * chHalf;
    const n = Math.max(2, Math.ceil(S / 2.6));
    const posts = Wd > 3.6 ? [-Wd / 2 + 0.55, 0, Wd / 2 - 0.55] : [-Wd / 2 + 0.5, Wd / 2 - 0.5];
    const deckT = 0.3;
    for (let k = 1; k < n; k++) {
      const a = -S / 2 + (k * S) / n;
      for (const x of posts) {
        const y0 = bed - 0.4, y1 = deck - deckT - 0.28;
        box(gb, [x, (y0 + y1) / 2, a], Y, X, Z, (y1 - y0) / 2, 0.2, 0.2, { uv: 'world', scale: [2, 2], skip: ['-y'], col: ao(0.9) });
      }
      box(gb, [0, deck - deckT - 0.14, a], X, Y, Z, Wd / 2 + 0.1, 0.14, 0.24, { uv: 'world', scale: [2.5, 2], col: ao(0.93) });
    }
    // 양쪽 물가 받침(교대)
    for (const e of [-1, 1]) {
      const a = e * (S / 2 + 0.3);
      box(sb, [0, (bed - 0.4 + deck - deckT) / 2, a], X, Y, Z, Wd / 2 + 0.15, (deck - deckT - bed + 0.4) / 2, 0.45, { uv: 'world', scale: [4, 2], skip: ['-y'] });
    }
    // 청판돌 네 장 (틈 2 cm)
    const m = Math.max(2, Math.round(Wd / 1.2));
    const gap = 0.025, sw = (Wd - gap * (m - 1)) / m;
    const R = rng(hashId(def.id));
    for (let k = 0; k < m; k++) {
      const x = -Wd / 2 + sw / 2 + k * (sw + gap);
      const dy = (R() - 0.5) * 0.016;
      box(gb, [x, deck - deckT / 2 + dy, 0], Z, Y, X, L / 2, deckT / 2, sw / 2, { uv: 'world', scale: [2.2, 2], uOff: R(), col: ao(0.96 + R() * 0.06) });
    }
  }
  sink.build(group, def.id, 'bridge');
  group.position.set(def.cx || 0, 0, def.cz || 0);
  group.rotation.y = -rad(rot);
  group.userData = { id: def.id, nameKo: def.nameKo, kind: 'bridge', pickId: def.id, problems, waterY: water, along0 };
  return group;
}

// ─────────────────────────── 기념물 ───────────────────────────
export function createLandmark(def, mats, heightAt) {
  const E = elementMats(mats);
  const C = E.C;
  const x = def.x ?? def.cx ?? 0, z = def.z ?? def.cz ?? 0;
  const y0 = Number.isFinite(def.y) ? def.y : heightAt ? heightAt(x, z) : 0;
  const obj = new THREE.Group();
  obj.name = def.id || 'landmark';
  obj.position.set(x, y0, z);
  let labelH = 4;
  const sink = new Sink();
  const gb = sink.get(E.granite);
  const ao = C.ao;
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const uvw = { uv: 'world', scale: [2, 2] };

  if (def.id === 'cheomseongdae' || /첨성대/.test(def.nameKo || '')) {
    // 개성 첨성대: 낮은 돌 기단 위 초석 다섯, 돌기둥 다섯(네 귀 + 가운데), 판석 돌마루
    const dims = def.dims || {};
    const w = dims.w || 2.6, H = dims.h || 2.8;
    const baseH = 0.24, slabT = 0.36, plinthH = 0.1;
    const pillarH = H - baseH - slabT - plinthH;
    // 기단 (두 장 판석)
    box(gb, [0, baseH / 2 - 0.15, 0], X, Y, Z, w / 2 + 0.55, baseH / 2 + 0.15, w / 2 + 0.55, { ...uvw, skip: ['-y'], col: ao(0.82) });
    const inset = 0.4;
    const pos = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (w / 2 - inset), b * (w / 2 - inset)]);
    if ((dims.pillars || 5) >= 5) pos.push([0, 0]);
    const pillar0 = new THREE.CylinderGeometry(0.2 * Math.SQRT2 * 0.93, 0.2 * Math.SQRT2, pillarH, 4, 1, true);
    pillar0.rotateY(Math.PI / 4);
    const pillar = pillar0.toNonIndexed();   // 면마다 평평한 법선 (uv 투영이 면 방향을 따르게)
    pillar.computeVertexNormals();
    pillar0.dispose();
    for (const [px, pz] of pos) {
      box(gb, [px, baseH + plinthH / 2, pz], X, Y, Z, 0.33, plinthH / 2, 0.33, { ...uvw, skip: ['-y'], col: ao(0.9) });
      const M = new THREE.Matrix4().makeTranslation(px, baseH + plinthH + pillarH / 2, pz);
      gb.addGeometry(pillar, M, { uvFn: (p, n) => worldUV(p, n, [1.3, 2]), colFn: (n, p) => ao(p[1] < 1 ? 0.88 : 1) });
    }
    pillar.dispose();
    // 돌마루: 판석 세 장 + 가장자리 모접기 느낌의 얇은 턱
    const yS = baseH + plinthH + pillarH;
    const pw = (w - 0.02) / 3;
    for (let k = 0; k < 3; k++) {
      const cx = -w / 2 + pw / 2 + k * (pw + 0.01);
      box(gb, [cx, yS + slabT / 2, 0], Z, Y, X, w / 2, slabT / 2, pw / 2, { ...uvw, col: ao(1 - k * 0.03) });
    }
    labelH = H + 1.4;
  } else if (def.id === 'bijwa' || /비좌/.test(def.nameKo || '')) {
    // 비좌: 다듬은 화강암 받침 + 윗면 복련(엎은 연꽃) 띠 + 비신을 꽂는 홈
    const bw = 1.9, bd = 1.15, bh = 0.5, band = 0.16, hole = [0.86, 0.3], depth = 0.2;
    // 몸통
    box(gb, [0, bh / 2 - 0.1, 0], X, Y, Z, bw / 2, bh / 2 + 0.1, bd / 2, { ...uvw, skip: ['+y', '-y'], col: ao(0.86) });
    // 경사 띠 (모서리를 둥글게 깎은 윗단)
    const t = bh + 0.12;
    const ow = bw / 2, od = bd / 2, iw = bw / 2 - band, id = bd / 2 - band;
    const O = [[-ow, bh, -od], [ow, bh, -od], [ow, bh, od], [-ow, bh, od]];
    const I = [[-iw, t, -id], [iw, t, -id], [iw, t, id], [-iw, t, id]];
    for (let k = 0; k < 4; k++) {
      const a = O[k], b = O[(k + 1) % 4], c = I[(k + 1) % 4], d = I[k];
      const mid = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
      const n = [mid[0], 0.8, mid[2]];
      gb.quad(a, b, c, d, [a[0], a[2], b[0], b[2], c[0], c[2], d[0], d[2]], ao(0.92), n);
    }
    // 윗면 (홈 둘레 네 조각)
    const hw = hole[0] / 2, hd = hole[1] / 2;
    const top = (x0, z0, x1, z1) => gb.quad([x0, t, z0], [x1, t, z0], [x1, t, z1], [x0, t, z1], [x0, z0, x1, z0, x1, z1, x0, z1], ao(1), [0, 1, 0]);
    top(-iw, -id, iw, -hd); top(-iw, hd, iw, id); top(-iw, -hd, -hw, hd); top(hw, -hd, iw, hd);
    // 홈 안쪽 벽과 바닥
    const yb = t - depth;
    const walls = [[[-hw, -hd], [hw, -hd], [0, 0, 1]], [[hw, hd], [-hw, hd], [0, 0, -1]], [[-hw, hd], [-hw, -hd], [1, 0, 0]], [[hw, -hd], [hw, hd], [-1, 0, 0]]];
    for (const [a, b, n] of walls) gb.quad([a[0], t, a[1]], [b[0], t, b[1]], [b[0], yb, b[1]], [a[0], yb, a[1]], null, ao(0.55), n);
    gb.quad([-hw, yb, -hd], [hw, yb, -hd], [hw, yb, hd], [-hw, yb, hd], null, ao(0.45), [0, 1, 0]);
    // 복련 꽃잎: 경사 띠 위에 도톰한 잎 (둘레를 따라)
    const petal = new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const per = 2 * (bw + bd) - 8 * band;
    const count = Math.max(12, Math.round(per / 0.3));
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S3 = new THREE.Vector3(), T3 = new THREE.Vector3();
    const e1 = new THREE.Euler();
    const mw = (ow + iw) / 2, md = (od + id) / 2;
    const perim = 2 * (2 * mw + 2 * md);
    for (let k = 0; k < count; k++) {
      let s = ((k + 0.5) / count) * perim;
      let px, pz, ang;
      if (s < 2 * mw) { px = -mw + s; pz = md; ang = 0; }
      else if ((s -= 2 * mw) < 2 * md) { px = mw; pz = md - s; ang = Math.PI / 2; }
      else if ((s -= 2 * md) < 2 * mw) { px = mw - s; pz = -md; ang = Math.PI; }
      else { s -= 2 * mw; px = -mw; pz = -md + s; ang = -Math.PI / 2; }
      e1.set(-0.55, ang, 0, 'YXZ');
      Q.setFromEuler(e1);
      S3.set(0.12, 0.05, 0.1);
      T3.set(px, (bh + t) / 2 - 0.005, pz);
      M.compose(T3, Q, S3);
      gb.addGeometry(petal, M, { uvFn: (p) => [p[0] * 2, p[2] * 2], colFn: () => ao(0.97) });
    }
    petal.dispose();
    labelH = 1.9;
  } else {
    // 실물이 남지 않은 자리: 빈 표지(이름표 높이만)
    labelH = def.id === 'songak_summit' ? 24 : /구정|광장/.test(def.nameKo || '') ? 6 : 4;
  }
  if (sink.tris) sink.build(obj, def.id, 'landmark');
  obj.userData = { id: def.id, nameKo: def.nameKo, kind: 'landmark', labelY: y0 + labelH, pickId: def.id };
  return obj;
}
