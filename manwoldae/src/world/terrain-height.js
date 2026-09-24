// 지형 높이 모형 — DEM 격자(궁궐 10 m → 근경 40 m → 원경 200 m) + 평탄화·물길·연못 규칙
// 메시는 이 함수를 격자점에서 표본해 만들고, heightAt 은 메시와 같은 보간을 씁니다(terrain.js).
import {
  clamp, lerp, smoothstep, noise2, pointInPolygon, segDist, palacePolygon, terraceRect, stairRect, rectDist,
} from './terrain-common.js';

// Catmull-Rom 쌍삼차 격자 표본기
function makeGrid(g) {
  const { x0, z0, step, nx, nz } = g;
  const v = Float32Array.from(g.values);
  const x1 = x0 + (nx - 1) * step, z1 = z0 + (nz - 1) * step;
  const inv = 1 / step;
  const ci = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  function at(x, z) {
    let fx = (x - x0) * inv, fz = (z - z0) * inv;
    fx = fx < 0 ? 0 : fx > nx - 1.000001 ? nx - 1.000001 : fx;
    fz = fz < 0 ? 0 : fz > nz - 1.000001 ? nz - 1.000001 : fz;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const tx2 = tx * tx, tx3 = tx2 * tx, tz2 = tz * tz, tz3 = tz2 * tz;
    const ax0 = (-tx3 + 2 * tx2 - tx) * 0.5, ax1 = (3 * tx3 - 5 * tx2 + 2) * 0.5;
    const ax2 = (-3 * tx3 + 4 * tx2 + tx) * 0.5, ax3 = (tx3 - tx2) * 0.5;
    const az0 = (-tz3 + 2 * tz2 - tz) * 0.5, az1 = (3 * tz3 - 5 * tz2 + 2) * 0.5;
    const az2 = (-3 * tz3 + 4 * tz2 + tz) * 0.5, az3 = (tz3 - tz2) * 0.5;
    const i0 = ci(i - 1, nx), i1 = i, i2 = ci(i + 1, nx), i3 = ci(i + 2, nx);
    let s = 0;
    for (let b = 0; b < 4; b++) {
      const row = ci(j - 1 + b, nz) * nx;
      const r = v[row + i0] * ax0 + v[row + i1] * ax1 + v[row + i2] * ax2 + v[row + i3] * ax3;
      s += r * (b === 0 ? az0 : b === 1 ? az1 : b === 2 ? az2 : az3);
    }
    return s;
  }
  const edgeDist = (x, z) => Math.min(x - x0, x1 - x, z - z0, z1 - z);
  return { x0, z0, x1, z1, step, nx, nz, at, edgeDist };
}

// 격자가 없거나 깨졌을 때 쓰는 평면 근사 (spec.terrain.slope.planeFit)
const planeGrid = {
  x0: -9600, z0: -9600, x1: 9600, z1: 9600,
  at: (x, z) => 0.5 - 0.0066 * clamp(x, -800, 800) - 0.0513 * clamp(z, -2200, 400),
  edgeDist: () => 1e9,
};

const validGrid = (g) => g && Array.isArray(g.values) && g.values.length === g.nx * g.nz && g.step > 0;

export function createHeightModel(spec) {
  const T = spec.terrain || {};
  const G = T.heightGrids || {};
  const problems = [];
  const pal = validGrid(G.palace) ? makeGrid(G.palace) : null;
  const near = validGrid(G.near) ? makeGrid(G.near) : null;
  const far = validGrid(G.far) ? makeGrid(G.far) : planeGrid;
  if (!pal) problems.push('heightGrids.palace 없음/깨짐');
  if (!near) problems.push('heightGrids.near 없음/깨짐');
  if (far === planeGrid) problems.push('heightGrids.far 없음/깨짐 — 평면 근사 사용');

  // 원경 격자 밖(지평선 둘레)은 낮은 들판으로 이어 주고 먼 산 실루엣을 더합니다.
  const apronBase = -12;
  const sil = (T.farSilhouettes || []).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z));
  function apron(x, z, h, ef) {
    const out = -ef;
    let y = lerp(h, apronBase + noise2(x / 2600, z / 2600, 41) * 45 + 25, smoothstep(0, 2600, out));
    for (const s of sil) {
      const r = Math.hypot(x - s.x, z - s.z);
      const R = (s.width || 2000) * 0.5;
      if (r > R * 1.6) continue;
      const k = Math.exp(-((r / (R * 0.62)) ** 2) * 1.2);
      const rough = 1 + 0.18 * noise2(x / 420, z / 420, 43) + 0.08 * noise2(x / 150, z / 150, 44);
      y = Math.max(y, apronBase + (s.height - apronBase) * k * rough);
    }
    return y;
  }

  let lastWp = 0; // demAt 가 남기는 궁궐 격자 가중치(세부 노이즈 차폐용)
  const peakPts = [...(T.peaks || []), ...(spec.landmarks || [])]
    .map((p) => [p.x ?? p.cx, p.z ?? p.cz])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z) > 1200);
  function demAt(x, z) {
    let h;
    const ep = pal ? pal.edgeDist(x, z) : -1;
    if (ep > 50) { lastWp = 1; return pal.at(x, z); }
    const en = near ? near.edgeDist(x, z) : -1;
    if (en > 240) h = near.at(x, z);
    else {
      h = far.at(x, z);
      const ef = far.edgeDist(x, z);
      if (ef < 0) h = apron(x, z, h, ef);
      if (en > 0) h = lerp(h, near.at(x, z), smoothstep(0, 240, en));
    }
    lastWp = 0;
    if (ep > 0) {
      lastWp = smoothstep(0, 50, ep);
      h = lerp(h, pal.at(x, z), lastWp);
    }
    return h;
  }

  // 원지형에 더하는 세부 기복(격자가 담지 못한 능선의 주름). minL 보다 짧은 파장은 뺍니다.
  const OCT = [[420, 8, 1], [210, 4.6, 2], [105, 2.5, 3], [52, 1.2, 4], [26, 0.5, 5]];
  function detailAt(x, z, dem, wp, minL) {
    const m = 1 - wp;
    if (m <= 0) return 0;
    const hill = smoothstep(12, 150, dem);
    const plain = 0.35;
    let s = 0;
    for (const [L, A, sd] of OCT) {
      if (L < minL) continue;
      const f = minL > 0 ? smoothstep(minL, minL * 2, L) : 1;
      s += noise2(x / L, z / L, sd) * A * f * (hill + plain * (L > 100 ? 0.25 : 0.08));
    }
    // 정상부 화강암 암릉: 뾰족한 주름
    // 봉우리 라벨·정상 표지(spec 높이) 둘레 150 m 는 주름을 줄여 문헌/격자 높이에 맞춥니다.
    let crag = smoothstep(210, 360, dem);
    for (const pk of peakPts) {
      const d2 = (x - pk[0]) ** 2 + (z - pk[1]) ** 2;
      if (d2 < 40000) crag *= smoothstep(60, 200, Math.sqrt(d2));
    }
    if (crag > 0 && minL <= 70) {
      const r = 1 - Math.abs(noise2(x / 70, z / 70, 9));
      s += (r * r - 0.45) * 7 * crag;
    }
    return s * m;
  }

  function naturalAt(x, z, minL = 0) {
    const d = demAt(x, z);
    return d + detailAt(x, z, d, lastWp, minL);
  }

  // ── 지형 요소 ──
  const terraces = (spec.terraces || []).map((t, i) => ({
    i, id: t.id, r: terraceRect(t), top: t.topY, bottom: Number.isFinite(t.bottomY) ? t.bottomY : t.topY - 2,
    surface: t.surface, surfaceAlt: t.surfaceAlt, def: t,
  })).filter((t) => Number.isFinite(t.top) && t.r.x1 > t.r.x0 && t.r.z1 > t.r.z0);
  for (const t of spec.terraces || []) {
    const rd = (((t.rotationDeg || 0) % 90) + 90) % 90;
    if (rd > 0.5 && rd < 89.5) problems.push(`terrace ${t.id}: rotationDeg ${t.rotationDeg} — 축 정렬 박스로 근사`);
  }
  const stairs = (spec.stairs || []).filter((s) => Number.isFinite(s.bottomY)).map((s) => ({
    r: stairRect(s), bottom: s.bottomY, top: s.topY, def: s,
    ax: Math.sin(((s.rotationDeg || 0) * Math.PI) / 180), az: -Math.cos(((s.rotationDeg || 0) * Math.PI) / 180),
  }));
  const bridges = (spec.bridges || []).map((b) => {
    const r = (((b.rotationDeg || 0) % 180) + 180) % 180;
    const swap = Math.abs(r - 90) < 1;
    const w = swap ? b.length : b.width, d = swap ? b.width : b.length;
    return { r: { x0: b.cx - w / 2, x1: b.cx + w / 2, z0: b.cz - d / 2, z1: b.cz + d / 2 }, deckY: b.deckY };
  });
  const palacePoly = palacePolygon(spec);

  // 물길: 누적 길이·수면 높이, 궁성 안 석축 구간
  const streams = (T.streams || []).filter((s) => s.path && s.path.length >= 2).map((s, si) => {
    const pts = s.path.map((p) => [p[0], p[1]]);
    let wy = Array.isArray(s.waterY) ? s.waterY.slice() : [];
    if (wy.length !== pts.length) {
      problems.push(`stream ${s.id}: waterY 길이(${wy.length}) ≠ path(${pts.length}) — 지형에서 추정`);
      wy = pts.map((p) => naturalAt(p[0], p[1]) - 1.5);
    }
    const segs = [];
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      segs.push({ si, k, ax, az, bx, bz, len, s0: acc, wyA: wy[k], wyB: wy[k + 1] });
      acc += len;
    }
    const w = s.width || 5;
    // bankHalf: 석축 호안 벽까지, clipHalf: 호안 윗돌 바깥까지(지형 메시를 잘라내는 폭)
    const st = { si, id: s.id, pts, wy, segs, length: acc, w, bankHalf: w / 2 + 0.5, clipHalf: w / 2 + 1.5, sections: [], def: s };
    // 궁성 안 구간(석축 호안)
    if (s.bankStoneInPalace && palacePoly) {
      const N = Math.max(200, Math.ceil(acc / 1));
      let inside = false, start = 0;
      for (let q = 0; q <= N; q++) {
        const sq = (q / N) * acc;
        const p = pointAtS(st, sq);
        const ins = pointInPolygon(p[0], p[1], palacePoly);
        if (ins && !inside) { start = sq; inside = true; }
        if ((!ins || q === N) && inside) { st.sections.push([Math.max(0, start - 3), Math.min(acc, sq + 3)]); inside = false; }
      }
    }
    return st;
  });

  function pointAtS(st, s) {
    for (const g of st.segs) {
      if (s <= g.s0 + g.len || g === st.segs[st.segs.length - 1]) {
        const t = clamp((s - g.s0) / (g.len || 1), 0, 1);
        return [g.ax + (g.bx - g.ax) * t, g.az + (g.bz - g.az) * t, lerp(g.wyA, g.wyB, t)];
      }
    }
    return [st.pts[0][0], st.pts[0][1], st.wy[0]];
  }

  const ponds = (spec.ponds || []).filter((p) => Number.isFinite(p.waterY)).map((p, i) => ({
    i, id: p.id, cx: p.cx, cz: p.cz, a: (p.w || 20) / 2, b: (p.d || 15) / 2, waterY: p.waterY,
    island: { x: p.cx + (p.w || 20) * 0.14, z: p.cz - (p.d || 15) * 0.1, r: Math.min(p.w || 20, p.d || 15) * 0.16 },
    def: p,
  }));

  // ── 공간 구획(20 m) — 요소 찾기를 빠르게 ──
  const BX0 = -1600, BZ0 = -2600, BS = 20, BNX = 160, BNZ = 180;
  const EMPTY = { t: [], s: [], g: [], p: [] };
  const bins = new Array(BNX * BNZ).fill(null);
  function addBox(x0, z0, x1, z1, key, idx) {
    const i0 = clamp(Math.floor((x0 - BX0) / BS), 0, BNX - 1), i1 = clamp(Math.floor((x1 - BX0) / BS), 0, BNX - 1);
    const j0 = clamp(Math.floor((z0 - BZ0) / BS), 0, BNZ - 1), j1 = clamp(Math.floor((z1 - BZ0) / BS), 0, BNZ - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * BNX + i;
        if (!bins[k]) bins[k] = { t: [], s: [], g: [], p: [] };
        bins[k][key].push(idx);
      }
    }
  }
  terraces.forEach((t, i) => addBox(t.r.x0 - 13.5, t.r.z0 - 13.5, t.r.x1 + 13.5, t.r.z1 + 13.5, 't', i));
  stairs.forEach((s, i) => addBox(s.r.x0 - 3.5, s.r.z0 - 3.5, s.r.x1 + 3.5, s.r.z1 + 3.5, 's', i));
  const allSegs = [];
  for (const st of streams) {
    for (const g of st.segs) {
      // 둑 비탈이 닿는 거리: 가장 깊은 곳 기준
      let depth = 0;
      for (let q = 0; q <= 8; q++) {
        const t = q / 8;
        const x = g.ax + (g.bx - g.ax) * t, z = g.az + (g.bz - g.az) * t;
        depth = Math.max(depth, naturalAt(x, z, 20) - (lerp(g.wyA, g.wyB, t) - 0.6));
      }
      const reach = st.w / 2 + 2 + clamp(depth, 0, 40) / 0.55 + 6;
      g.reach = reach;
      const gi = allSegs.push(g) - 1;
      addBox(Math.min(g.ax, g.bx) - reach, Math.min(g.az, g.bz) - reach, Math.max(g.ax, g.bx) + reach, Math.max(g.az, g.bz) + reach, 'g', gi);
    }
  }
  ponds.forEach((p, i) => addBox(p.cx - p.a - 6, p.cz - p.b - 6, p.cx + p.a + 6, p.cz + p.b + 6, 'p', i));
  const binAt = (x, z) => {
    const i = Math.floor((x - BX0) / BS), j = Math.floor((z - BZ0) / BS);
    if (i < 0 || j < 0 || i >= BNX || j >= BNZ) return EMPTY;
    return bins[j * BNX + i] || EMPTY;
  };

  // 물길 최근접 (물길별) — 결과는 재사용 객체에 담습니다.
  const nearBuf = streams.map(() => ({ d: Infinity, s: 0, wy: 0, seg: null }));
  function nearestStreams(x, z, bin) {
    for (const nb of nearBuf) { nb.d = Infinity; nb.seg = null; }
    for (const gi of bin.g) {
      const g = allSegs[gi];
      const { d, t } = segDist(x, z, g.ax, g.az, g.bx, g.bz);
      const nb = nearBuf[g.si];
      if (d < nb.d) { nb.d = d; nb.s = g.s0 + t * g.len; nb.wy = lerp(g.wyA, g.wyB, t); nb.seg = g; }
    }
    return nearBuf;
  }
  // 석축 구간 안이면 −(구간 끝까지 거리 + 1), 밖이면 가장 가까운 구간 끝까지 거리
  const sectionOf = (st, s) => {
    let dsOut = Infinity;
    for (const [a, b] of st.sections) {
      if (s >= a && s <= b) return -(Math.min(s - a, b - s) + 1);
      dsOut = Math.min(dsOut, s < a ? a - s : s - b);
    }
    return dsOut;
  };

  // 연못 가장자리까지의 거리(바깥 +, m)
  function pondEdge(P, x, z) {
    const dx = x - P.cx, dz = z - P.cz;
    const r = Math.hypot(dx / P.a, dz / P.b);
    const rr = Math.hypot(dx, dz);
    const rho = r > 1e-6 ? rr / r : Math.min(P.a, P.b);
    const ang = Math.atan2(dz, dx);
    const wob = noise2(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5, 33) * 1.6;
    return (r - 1) * rho + wob;
  }
  function pondProfile(P, x, z) {
    const e = pondEdge(P, x, z);
    let hp;
    if (e < 0) hp = lerp(P.waterY - 0.15, P.waterY - 1.0, smoothstep(0, 3, -e)) - 0.15 * smoothstep(4, 12, -e);
    else hp = P.waterY - 0.15 + e * 0.95;
    const I = P.island;
    const di = Math.hypot(x - I.x, z - I.z);
    if (di < I.r * 1.6) {
      const mound = P.waterY + 2.1 - (di / I.r) ** 2 * 2.9 + noise2(x / 2.2, z / 2.2, 35) * 0.35;
      if (mound > hp) hp = mound;
    }
    return hp;
  }

  // 최종 지형(메시용). 궁성 안 석축 물길 안쪽은 메시에서 잘라내므로 파지 않습니다.
  function finalAt(x, z, minL = 0) {
    const nat = naturalAt(x, z, minL);
    const bin = binAt(x, z);
    if (bin === EMPTY) return nat;
    let cut = 0;
    for (const ti of bin.t) {
      const t = terraces[ti];
      const dd = rectDist(t.r, x, z);
      const k = clamp((dd - 1) / 12, 0, 1);
      if (k >= 1) continue;
      const c = (1 - k) * (nat - (t.top - 0.3));
      if (c > cut) cut = c;
    }
    for (const si of bin.s) {
      const s = stairs[si];
      const dd = rectDist(s.r, x, z);
      const k = clamp((dd - 0.3) / 3, 0, 1);
      if (k >= 1) continue;
      const c = (1 - k) * (nat - (s.bottom - 0.3));
      if (c > cut) cut = c;
    }
    let h = nat - cut;
    if (bin.g.length) {
      const nb = nearestStreams(x, z, bin);
      for (let q = 0; q < streams.length; q++) {
        const n = nb[q];
        if (!n.seg || n.d > n.seg.reach) continue;
        const st = streams[q];
        const ds = sectionOf(st, n.s);
        if (ds < 0) {
          // 궁성 안 석축 구간: 메시에서 잘려 나가므로 파지 않되, 구간 끝(바깥 물길과 잇는 마구리) 가까이만
          // 잘린 폭(clipHalf) 안을 바닥까지 내려 끝 단면이 바깥 물길 바닥과 맞게 합니다.
          if (-ds - 1 < 8 && n.d < st.clipHalf - 0.01 && n.wy - 0.6 < h) h = n.wy - 0.6;
          continue;
        }
        const tr = st.sections.length ? clamp(ds / 18, 0, 1) : 1;
        // 물 아래 바닥(core) → 자갈 물가(shore, 수면 +0.2 까지) → 둑 비탈
        const core = lerp(st.clipHalf, Math.max(1, st.w / 2 - 1), tr), shore = lerp(0.01, 1.6, tr);
        const slope = lerp(1.4, 0.55, tr);
        const bedY = n.wy - 0.6;
        const hc = n.d < core ? bedY : n.d < core + shore ? lerp(bedY, n.wy + 0.2, (n.d - core) / shore)
          : n.wy + 0.2 + (n.d - core - shore) * slope;
        if (hc < h) h = hc;
      }
    }
    for (const pi of bin.p) {
      const hp = pondProfile(ponds[pi], x, z);
      if (hp < h) h = hp;
    }
    return h;
  }

  // 궁성 안 석축 물길 안쪽인지(바닥 높이 반환, 아니면 NaN)
  function channelBedAt(x, z) {
    const bin = binAt(x, z);
    if (!bin.g.length) return NaN;
    const nb = nearestStreams(x, z, bin);
    for (let q = 0; q < streams.length; q++) {
      const n = nb[q];
      if (!n.seg) continue;
      const st = streams[q];
      if (n.d < st.bankHalf && sectionOf(st, n.s) < 0) return n.wy - 0.6;
    }
    return NaN;
  }

  // 대지/계단/다리 윗면 (없으면 NaN)
  function terraceTopAt(x, z) {
    const bin = binAt(x, z);
    let top = NaN;
    for (const ti of bin.t) {
      const t = terraces[ti];
      if (x >= t.r.x0 && x <= t.r.x1 && z >= t.r.z0 && z <= t.r.z1) top = Number.isNaN(top) ? t.top : Math.max(top, t.top);
    }
    return top;
  }
  function stairTopAt(x, z) {
    const bin = binAt(x, z);
    let y = NaN;
    for (const si of bin.s) {
      const s = stairs[si];
      if (x < s.r.x0 || x > s.r.x1 || z < s.r.z0 || z > s.r.z1) continue;
      const run = s.def.run || 1;
      // 오르는 방향 성분: 아랫변(−run/2) → 윗변(+run/2)
      const u = ((x - s.def.cx) * s.ax + (z - s.def.cz) * s.az) / run + 0.5;
      const v = lerp(s.bottom, s.top, clamp(u, 0, 1));
      y = Number.isNaN(y) ? v : Math.max(y, v);
    }
    return y;
  }
  function bridgeTopAt(x, z) {
    for (const b of bridges) {
      if (x >= b.r.x0 && x <= b.r.x1 && z >= b.r.z0 && z <= b.r.z1) return b.deckY;
    }
    return NaN;
  }

  return {
    problems, pal, near, far, demAt, naturalAt, finalAt, channelBedAt,
    terraceTopAt, stairTopAt, bridgeTopAt, pointAtS,
    terraces, stairs, streams, ponds, bridges, palacePoly, binAt, pondEdge, allSegs,
  };
}
