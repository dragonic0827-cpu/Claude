// 식생 — 송악산 적송·참나무 숲, 능선 소나무, 정상부 화강암, 금원·동지 주변 나무 (인스턴싱)
//
// createVegetation(spec, mats, heightAt, isBlocked = () => false, opts = { density: 1 }) → THREE.Group
//   heightAt(x,z): 지형 높이(terrain.heightAt), isBlocked(x,z): 건물·담장 등 통합 쪽에서 막는 자리
// 나무 모양은 단위 높이 1 로 만들고 인스턴스마다 높이·폭·기울기·색을 흔듭니다.
// 그림자는 궁궐 둘레(반경 ~450 m) 나무만 드리웁니다(그림자 패스 부담을 줄이려고).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/textures.js';
import {
  clamp, lerp, smoothstep, noise2, pointInPolygon, forestDensity, palacePolygon, terraceRect, stairRect, segDist,
} from './terrain-common.js';

const SHADOW_R = 450;                 // 이 반경 안(궁궐 중심 기준) 나무만 그림자
const SHADOW_C = [0, -60];
const NEAR_ZMIN = -1150;              // 이보다 북쪽(송악산 윗부분)은 뭉친 숲 덩어리로

const matCache = new WeakMap();
function vegMaterial(mats) {
  let m = matCache.get(mats);
  if (!m) {
    m = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93, metalness: 0 }),
    };
    matCache.set(mats, m);
  }
  return m;
}

// ───────────── 모양 만들기 (단위 크기, 정점 색) ─────────────
const tmpC = new THREE.Color();
function finish(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}
// 비색인 삼각형 배열 → BufferGeometry (면마다 색 흔들림)
function build(tris, colorOf, R) {
  const n = tris.length / 9;
  const pos = new Float32Array(tris);
  const col = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const j = 0.9 + R() * 0.2;
    for (let v = 0; v < 3; v++) {
      const o = f * 9 + v * 3;
      colorOf(pos[o], pos[o + 1], pos[o + 2], tmpC);
      col[o] = tmpC.r * j; col[o + 1] = tmpC.g * j; col[o + 2] = tmpC.b * j;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// 줄기(수평 고리를 이은 관)
function tube(points, radii, sides, out, a0 = 0) {
  const ring = (p, r, a) => [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r];
  for (let k = 0; k < points.length - 1; k++) {
    for (let s = 0; s < sides; s++) {
      const a = a0 + (s / sides) * Math.PI * 2, b = a0 + ((s + 1) / sides) * Math.PI * 2;
      const A = ring(points[k], radii[k], a), B = ring(points[k], radii[k], b);
      const C = ring(points[k + 1], radii[k + 1], b), D = ring(points[k + 1], radii[k + 1], a);
      out.push(...A, ...D, ...C, ...A, ...C, ...B);
    }
  }
}
// 가지: 두 점 사이 가는 4각 기둥
function limb(p, q, r, out) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  const t = [dx / L, dy / L, dz / L];
  let u = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const s1 = nrm(cr(t, u)); const s2 = cr(t, s1);
  const ringAt = (c, rr) => [0, 1, 2, 3].map((k) => {
    const a = (k / 4) * Math.PI * 2;
    return [c[0] + (s1[0] * Math.cos(a) + s2[0] * Math.sin(a)) * rr, c[1] + (s1[1] * Math.cos(a) + s2[1] * Math.sin(a)) * rr, c[2] + (s1[2] * Math.cos(a) + s2[2] * Math.sin(a)) * rr];
  });
  const A = ringAt(p, r), B = ringAt(q, r * 0.6);
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    out.push(...A[k], ...A[k1], ...B[k1], ...A[k], ...B[k1], ...B[k]);
  }
}
// 솔잎 뭉치(납작한 방석꼴): 위 꼭지·둘레 고리·아래 꼭지
function cushion(c, R, H, sides, R2, out, round = false) {
  const top = [c[0] + (R2() - 0.5) * R * 0.2, c[1] + H, c[2] + (R2() - 0.5) * R * 0.2];
  const bot = [c[0], c[1] - H * 0.55, c[2]];
  const ring = [], shoulder = [];
  const a0 = R2() * Math.PI * 2;
  for (let k = 0; k < sides; k++) {
    const a = a0 + ((k + (R2() - 0.5) * 0.5) / sides) * Math.PI * 2;
    const r = R * (0.8 + R2() * 0.4);
    ring.push([c[0] + Math.cos(a) * r, c[1] + (R2() - 0.5) * H * 0.3, c[2] + Math.sin(a) * r]);
    // 둥근 윗면: 어깨 고리(반지름 0.7, 높이 0.72)
    const a2 = a + Math.PI / sides;
    shoulder.push([c[0] + Math.cos(a2) * r * 0.7, c[1] + H * (0.66 + R2() * 0.12), c[2] + Math.sin(a2) * r * 0.7]);
  }
  for (let k = 0; k < sides; k++) {
    const p = ring[k], q = ring[(k + 1) % sides];
    if (round) {
      const s0 = shoulder[k], s1 = shoulder[(k + 1) % sides];
      out.push(...top, ...s1, ...s0);
      out.push(...s0, ...q, ...p);
      out.push(...s0, ...s1, ...q);
    } else out.push(...top, ...q, ...p);
    out.push(...bot, ...p, ...q);
  }
}
// 울퉁불퉁한 구(참나무 수관·버드나무)
function blob(c, R, sy, seed, out) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position;
  const key = (i) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const jit = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    if (!jit.has(k)) jit.set(k, 0.82 + 0.36 * (noise2(pos.getX(i) * 2.1 + seed, pos.getZ(i) * 2.1 + pos.getY(i), 61) * 0.5 + 0.5));
    const s = jit.get(k);
    out.push(c[0] + pos.getX(i) * R * s, c[1] + pos.getY(i) * R * s * sy, c[2] + pos.getZ(i) * R * s);
  }
  g.dispose();
}

function pineGeometry(P, variant) {
  const R2 = rng(variant === 'A' ? 101 : 202);
  const wood = [], leaf = [];
  const trunkLow = new THREE.Color('#5d4a3d'), trunkHigh = new THREE.Color('#a45a3a');
  const needle = new THREE.Color(P.pineForest || '#2E4630');
  const needleTop = needle.clone().lerp(new THREE.Color('#6d8a4a'), 0.45);
  const needleLow = needle.clone().multiplyScalar(0.55);
  let pads;
  if (variant === 'A') {
    // 우산꼴 적송: 굽은 줄기, 위쪽에 넓게 퍼진 층층 솔잎
    const pts = [[0, -0.05, 0], [0.018, 0.3, 0.005], [0.05, 0.6, 0.004], [0.032, 0.86, -0.01]];
    tube(pts, [0.024, 0.017, 0.012, 0.006], 5, wood);
    pads = [
      [[0.04, 0.86, 0], 0.22, 0.1, true], [[-0.14, 0.78, 0.08], 0.16, 0.095], [[0.2, 0.76, -0.05], 0.16, 0.095],
      [[0.02, 0.72, 0.18], 0.14, 0.085], [[-0.07, 0.69, -0.17], 0.13, 0.085],
    ];
    limb([0.046, 0.6, 0.004], [-0.1, 0.77, 0.07], 0.007, wood);
    limb([0.048, 0.64, 0.002], [0.17, 0.75, -0.04], 0.007, wood);
  } else {
    // 젊은 소나무: 곧은 줄기, 둥글게 층진 수관
    const pts = [[0, -0.05, 0], [0.006, 0.3, 0], [0.014, 0.6, 0.006], [0.01, 0.9, 0]];
    tube(pts, [0.026, 0.019, 0.012, 0.006], 5, wood);
    pads = [
      [[0.01, 0.9, 0], 0.16, 0.1], [[0.07, 0.79, 0.05], 0.21, 0.1], [[-0.08, 0.75, -0.03], 0.21, 0.1],
      [[0.03, 0.64, -0.09], 0.24, 0.1], [[-0.04, 0.6, 0.1], 0.23, 0.09],
    ];
    limb([0.012, 0.58, 0.005], [0.09, 0.55, -0.01], 0.006, wood);
  }
  for (const [c, R, H, round] of pads) cushion(c, R, H, 7, R2, leaf, round);
  const gw = build(wood, (x, y, z, c) => c.copy(trunkLow).lerp(trunkHigh, smoothstep(0.15, 0.6, y)), R2);
  const gl = build(leaf, (x, y, z, c) => {
    // 위쪽은 밝게, 아래는 어둡게 (방석별 높이를 모르므로 y 와 중심 거리로)
    const t = smoothstep(0.55, 0.98, y + Math.hypot(x, z) * -0.25);
    c.copy(needleLow).lerp(needle, 0.55).lerp(needleTop, t * 0.8);
  }, R2);
  // 방석 윗면을 더 밝게: 법선 y 로 한 번 더
  shadeByNormal(gl, 0.72, 1.18);
  return finish([gw, gl]);
}

function oakGeometry(P) {
  const R2 = rng(303);
  const wood = [], leaf = [];
  tube([[0, -0.05, 0], [0.01, 0.3, 0], [0.02, 0.5, 0.01]], [0.03, 0.022, 0.015], 5, wood);
  limb([0.015, 0.42, 0.005], [0.16, 0.6, 0.05], 0.011, wood);
  const lumps = [[[0, 0.72, 0], 0.31], [[0.19, 0.62, 0.07], 0.24], [[-0.17, 0.64, -0.09], 0.24], [[0.0, 0.66, 0.2], 0.22]];
  lumps.forEach(([c, R], i) => blob(c, R, 0.82, i * 3.1, leaf));
  const base = new THREE.Color(P.oakForest || '#4D5E35');
  const hi = base.clone().lerp(new THREE.Color('#8d8f4e'), 0.4), lo = base.clone().multiplyScalar(0.6);
  const bark = new THREE.Color('#5a5046');
  const gw = build(wood, (x, y, z, c) => c.copy(bark), R2);
  const gl = build(leaf, (x, y, z, c) => c.copy(lo).lerp(base, 0.6).lerp(hi, smoothstep(0.55, 1.0, y) * 0.8), R2);
  shadeByNormal(gl, 0.72, 1.15);
  return finish([gw, gl]);
}

function willowGeometry(P) {
  const R2 = rng(404);
  const wood = [], leaf = [];
  tube([[0, -0.05, 0], [0.03, 0.35, 0.01], [0.02, 0.62, 0]], [0.05, 0.036, 0.02], 6, wood);
  limb([0.025, 0.5, 0.005], [0.2, 0.72, 0.06], 0.014, wood);
  limb([0.025, 0.52, 0.005], [-0.18, 0.74, -0.08], 0.013, wood);
  // 둥근 수관 + 가장자리로 늘어진 가지 다발(세로로 긴 덩이)
  blob([0, 0.8, 0], 0.3, 0.6, 1.7, leaf);
  blob([0.16, 0.74, 0.06], 0.22, 0.6, 2.3, leaf);
  blob([-0.15, 0.76, -0.07], 0.22, 0.6, 2.9, leaf);
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R2() * 0.4;
    const r = 0.3 + R2() * 0.06;
    blob([Math.cos(a) * r, 0.56 + R2() * 0.06, Math.sin(a) * r], 0.1 + R2() * 0.03, 2.4, 4 + k, leaf);
  }
  const g1 = new THREE.Color('#9aa65a'), g0 = new THREE.Color(P.hayeop || '#3B5534').lerp(new THREE.Color('#6f8440'), 0.4);
  const gw = build(wood, (x, y, z, c) => c.set('#5b4b3e'), R2);
  const gl = build(leaf, (x, y, z, c) => c.copy(g0).lerp(g1, smoothstep(0.35, 1.0, y)), R2);
  shadeByNormal(gl, 0.75, 1.12);
  return finish([gw, gl]);
}

// 원경 숲 덩어리: 수관 3개를 붙인 낮은 다면체 (나무 여러 그루를 대신)
function clumpGeometry(P) {
  const R2 = rng(505);
  const leaf = [];
  cushion([0.05, 0.08, 0.02], 0.52, 0.5, 7, R2, leaf, true);
  cushion([-0.3, 0.0, -0.22], 0.4, 0.4, 6, R2, leaf, true);
  const base = new THREE.Color(P.pineForest || '#2E4630');
  const hi = base.clone().lerp(new THREE.Color('#6a7c45'), 0.4);
  const g = build(leaf, (x, y, z, c) => c.copy(base).multiplyScalar(0.75).lerp(hi, smoothstep(0.0, 0.6, y)), R2);
  shadeByNormal(g, 0.75, 1.15);
  return g;
}

// 화강암 노두
function rockGeometry(P) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const jit = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!jit.has(k)) jit.set(k, 0.72 + 0.4 * (noise2(v.x * 1.4 + 3, v.z * 1.4 - v.y * 1.1, 19) * 0.5 + 0.5));
    v.multiplyScalar(jit.get(k));
    v.y = v.y > 0 ? v.y * 0.75 : v.y * 0.5;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const tris = Array.from(pos.array);
  g.dispose();
  const base = new THREE.Color(P.graniteOutcrop || '#B7B0A3');
  const lo = base.clone().multiplyScalar(0.62);
  const out = build(tris, (x, y, z, c) => c.copy(lo).lerp(base, smoothstep(-0.4, 0.7, y)), rng(606));
  return out;
}

// 면 법선의 y 로 명암을 한 번 더 (윗면 밝게, 아랫면 어둡게)
function shadeByNormal(g, lo, hi) {
  const n = g.attributes.normal, c = g.attributes.color;
  for (let i = 0; i < n.count; i++) {
    const k = lerp(lo, hi, n.getY(i) * 0.5 + 0.5);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

// ───────────── 배치 ─────────────
export function createVegetation(spec, mats, heightAt, isBlocked = () => false, opts = {}) {
  // opts.density (0.2–1): 휴대폰 등에서 나무 수를 줄일 때 (기본 1)
  const dens = clamp(opts.density ?? 1, 0.2, 1);
  const t0 = performance.now();
  const P = mats.palette || {};
  const group = new THREE.Group();
  group.name = 'vegetation';
  const M = vegMaterial(mats);
  const T = spec.terrain || {};

  // 막는 요소들
  const palace = palacePolygon(spec);
  const terr = (spec.terraces || []).map(terraceRect);
  const stairs = (spec.stairs || []).map(stairRect);
  const streams = (T.streams || []).filter((s) => s.path && s.path.length > 1);
  const walls = (spec.walls || []).filter((w) => w.path && w.path.length > 1);
  const ponds = spec.ponds || [];
  const approach = { x0: -24, x1: 16, z0: 290, z1: 450 };
  // 선분 구획(64 m): 물길·성벽 → 가까운 선분만 검사
  const SB = 64, SX0 = -9600, SZ0 = -9600, SN = 300;
  const segBins = new Map();
  const addSeg = (ax, az, bx, bz, pad) => {
    const i0 = Math.floor((Math.min(ax, bx) - pad - SX0) / SB), i1 = Math.floor((Math.max(ax, bx) + pad - SX0) / SB);
    const j0 = Math.floor((Math.min(az, bz) - pad - SZ0) / SB), j1 = Math.floor((Math.max(az, bz) + pad - SZ0) / SB);
    const seg = { ax, az, bx, bz, pad };
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * SN + i;
        if (!segBins.has(k)) segBins.set(k, []);
        segBins.get(k).push(seg);
      }
    }
  };
  for (const s of streams) for (let k = 0; k < s.path.length - 1; k++) addSeg(...s.path[k], ...s.path[k + 1], (s.width || 5) / 2 + 4);
  for (const w of walls) {
    const pts = w.closed ? [...w.path, w.path[0]] : w.path;
    for (let k = 0; k < pts.length - 1; k++) addSeg(...pts[k], ...pts[k + 1], (w.thickness || 1) / 2 + (w.kind === 'enclosure' ? 2 : 5));
  }
  const nearLine = (x, z) => {
    const list = segBins.get(Math.floor((z - SZ0) / SB) * SN + Math.floor((x - SX0) / SB));
    if (!list) return false;
    for (const s of list) if (segDist(x, z, s.ax, s.az, s.bx, s.bz).d < s.pad) return true;
    return false;
  };
  const inPalace = (x, z) => palace && x > -300 && x < 180 && z > -490 && z < 270 && pointInPolygon(x, z, palace);
  const inRects = (x, z, list, pad) => list.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
  const inPond = (x, z, pad) => ponds.some((p) => ((x - p.cx) / (p.w / 2 + pad)) ** 2 + ((z - p.cz) / (p.d / 2 + pad)) ** 2 < 1);
  const blocked = (x, z) => inPalace(x, z) || nearLine(x, z) || inRects(x, z, terr, 3) || inRects(x, z, stairs, 2)
    || inRects(x, z, [approach], 0) || inPond(x, z, 3) || isBlocked(x, z);

  // 능선(소나무 띠)
  const ridges = (T.ridges || []).map((r) => r.points.map((p) => [p[0], p[1]]));
  const ridgeDist = (x, z) => {
    let d = Infinity;
    for (const pts of ridges) for (let k = 0; k < pts.length - 1; k++) d = Math.min(d, segDist(x, z, ...pts[k], ...pts[k + 1]).d);
    return d;
  };
  const slopeAt = (x, z, h, e = 3) => {
    const gx = (heightAt(x + e, z) - h) / e, gz = (heightAt(x, z + e) - h) / e;
    return 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
  };

  // 인스턴스 목록: [x, y, z, sx, sy, sz, rotY, lean, colorK, hueK]
  const L = { pineA: [], pineB: [], oak: [], willow: [], clump: [], rock: [] };
  const R = rng(20240923);
  const add = (kind, x, y, z, sx, sy, sz, lean = 0) => {
    L[kind].push([x, y, z, sx, sy, sz, R() * Math.PI * 2, lean, 0.84 + R() * 0.3, (R() - 0.5) * 0.12]);
  };
  const addTree = (x, z, y, big = 1) => {
    // 적송 70 %, 참나무 30 % (능선 가까이는 소나무를 더)
    const rd = ridges.length ? ridgeDist(x, z) : 1e9;
    const pOak = clamp(0.32 + 0.2 * noise2(x / 160, z / 160, 88) - 0.3 * (1 - smoothstep(20, 140, rd)) - 0.25 * smoothstep(150, 290, y), 0.02, 0.6);
    const r = R();
    const lean = (R() - 0.5) * 0.12;
    if (r < pOak) {
      const h = (10 + R() * 6) * big;
      add('oak', x, y - 0.3, z, h * (0.95 + R() * 0.35), h, h * (0.95 + R() * 0.35), lean * 0.3);
    } else if (R() < 0.62) {
      const h = (13 + R() * 8) * big;
      const w = h * (0.95 + R() * 0.4);
      add('pineA', x, y - 0.4, z, w, h, w * (0.85 + R() * 0.3), lean);
    } else {
      const h = (8 + R() * 6) * big;
      const w = h * (0.9 + R() * 0.35);
      add('pineB', x, y - 0.3, z, w, h, w, lean * 0.6);
    }
  };

  // 1) 송악산 아랫부분·산기슭·구릉 (상세 나무). 궁궐에서 멀수록 성기게.
  const STEP = 6.5;
  for (let z = NEAR_ZMIN; z < 1000; z += STEP) {
    for (let x = -1600; x < 1600; x += STEP) {
      const px = x + (R() - 0.5) * STEP * 0.9, pz = z + (R() - 0.5) * STEP * 0.9;
      const u = R();
      const r = Math.hypot(px - 0, pz + 350);
      const far = lerp(1, 0.2, smoothstep(500, 1500, r));
      if (u > 0.27 * far * dens) continue;           // 빠른 거절(최대 밀도 상한)
      const y = heightAt(px, pz);
      if (y < 4) {
        // 도성 평지: 드문드문 (마을 숲 느낌으로 뭉치게)
        const grove = smoothstep(0.35, 0.65, noise2(px / 180, pz / 180, 91));
        if (u > 0.27 * far * dens * 0.055 * grove) continue;
        if (blocked(px, pz)) continue;
        addTree(px, pz, y, 0.9);
        continue;
      }
      const sl = slopeAt(px, pz, y);
      const d = forestDensity(px, pz, y, sl);
      if (u > 0.27 * far * dens * (d * 0.62 + 0.01)) continue;
      if (blocked(px, pz)) continue;
      addTree(px, pz, y);
    }
  }
  // 2) 송악산 윗부분·원경 구릉: 숲 덩어리
  const clumpAt = (x, z, step, k) => {
    const y = heightAt(x, z);
    const sl = slopeAt(x, z, y, 8);
    const d = forestDensity(x, z, y, sl);
    if (R() > d * k * dens) return;
    if (y > 300 && R() < 0.7) return;
    if (blocked(x, z)) return;
    const s = step * (0.8 + R() * 0.5);
    add('clump', x, y - 1.2, z, s, s * (0.55 + R() * 0.25), s * (0.8 + R() * 0.4));
  };
  for (let z = -2600; z < NEAR_ZMIN; z += 27) {
    for (let x = -1600; x < 1600; x += 27) clumpAt(x + (R() - 0.5) * 22, z + (R() - 0.5) * 22, 33, 0.8);
  }
  for (let z = -4000; z < 4000; z += 85) {
    for (let x = -4000; x < 4000; x += 85) {
      if (x > -1620 && x < 1620 && z > -2620 && z < 1020) continue;
      if (Math.hypot(x, z + 500) > 4000) continue;
      clumpAt(x + (R() - 0.5) * 70, z + (R() - 0.5) * 70, 55, 0.4);
    }
  }
  // 3) 능선·정상부: 하늘선에 걸리는 소나무 + 화강암 노두
  for (const pts of ridges) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < len; s += 9) {
        const t = s / len;
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        const off = (R() - 0.5) * 70;
        const x = lerp(ax, bx, t) + nx * off, z = lerp(az, bz, t) + nz * off;
        const y = heightAt(x, z);
        if (y > 410 && R() < 0.6) continue;
        if (R() < 0.35 || blocked(x, z)) continue;
        const h = 11 + R() * 7;
        add('pineA', x, y - 0.4, z, h * (0.9 + R() * 0.35), h, h * (0.9 + R() * 0.3), (R() - 0.5) * 0.2);
      }
    }
  }
  const summit = (T.peaks || []).find((p) => p.id === 'songaksan') || { x: 88, z: -2164 };
  const crest = ridges[0] || [];
  for (let q = 0; q < 6000 && L.rock.length < 260; q++) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 950;
    const x = summit.x + Math.cos(a) * rr * 1.3, z = summit.z + Math.sin(a) * rr * 0.7;
    const y = heightAt(x, z);
    if (y < 280) continue;
    const sl = slopeAt(x, z, y, 6);
    let rd = Infinity;
    for (let k = 0; k < crest.length - 1; k++) rd = Math.min(rd, segDist(x, z, ...crest[k], ...crest[k + 1]).d);
    // 능선·가파른 곳에 큰 암괴가 무리 지어
    const pAcc = 0.08 + sl * 2.5 + (1 - smoothstep(20, 120, rd)) * 0.5;
    if (R() > pAcc * (0.5 + 0.5 * smoothstep(-0.3, 0.3, noise2(x / 140, z / 140, 97)))) continue;
    const s = 4 + R() * 7 + (R() < 0.18 ? 7 : 0);
    add('rock', x, y - s * 0.3, z, s * (1 + R() * 0.7), s * (0.5 + R() * 0.55), s * (0.8 + R() * 0.5), (R() - 0.5) * 0.5);
    // 바위 틈 소나무
    if (R() < 0.2) {
      const h = 7 + R() * 5;
      const px = x + (R() - 0.5) * s * 2.5, pz = z + (R() - 0.5) * s * 2.5;
      add('pineA', px, heightAt(px, pz) - 0.4, pz, h * 1.1, h, h, (R() - 0.5) * 0.3);
    }
  }
  // 4) 궁궐 안: 금원 정자·동지 둘레 몇 그루
  const geumwon = (spec.terraces || []).find((t) => t.id === 'geumwon');
  if (geumwon) {
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * Math.PI * 2 + R() * 0.4, rr = geumwon.w * 0.5 + 4 + R() * 12;
      const x = geumwon.cx + Math.cos(a) * rr, z = geumwon.cz + Math.sin(a) * rr;
      if (nearLine(x, z) || inRects(x, z, terr, 2) || isBlocked(x, z)) continue;
      const h = 12 + R() * 7;
      add('pineA', x, heightAt(x, z) - 0.4, z, h * (0.9 + R() * 0.3), h, h, (R() - 0.5) * 0.14);
    }
  }
  for (const p of ponds) {
    const a0 = R() * 6.28;
    for (let q = 0; q < 9; q++) {
      const a = a0 + (q / 9) * Math.PI * 2 + (R() - 0.5) * 0.4;
      const k = 1 + (4 + R() * 6) / Math.min(p.w, p.d) * 2;
      const x = p.cx + Math.cos(a) * p.w / 2 * k, z = p.cz + Math.sin(a) * p.d / 2 * k;
      if (nearLine(x, z) || inRects(x, z, terr, 2) || isBlocked(x, z)) continue;
      const y = heightAt(x, z);
      if (q % 3 === 0) { const h = 7 + R() * 3; add('willow', x, y - 0.2, z, h * 1.1, h, h * 1.1); }
      else { const h = 10 + R() * 6; add('pineA', x, y - 0.4, z, h * (0.95 + R() * 0.3), h, h, (R() - 0.5) * 0.25); }
    }
  }
  // 5) 승평문 밖 길가 소나무 (『고려도경』 "脩松夾道")
  for (let z = approach.z0 + 14; z < approach.z1; z += 11 + R() * 4) {
    for (const side of [-1, 1]) {
      const x = (side < 0 ? approach.x0 - 4 : approach.x1 + 4) + side * R() * 3;
      if (nearLine(x, z) || inRects(x, z, terr, 2) || isBlocked(x, z)) continue;
      const h = 13 + R() * 6;
      add('pineA', x, heightAt(x, z) - 0.4, z, h * (0.85 + R() * 0.3), h, h * (0.85 + R() * 0.3), (R() - 0.5) * 0.12);
    }
  }

  // ── 인스턴스 메시 ──
  const geos = {
    pineA: pineGeometry(P, 'A'), pineB: pineGeometry(P, 'B'), oak: oakGeometry(P),
    willow: willowGeometry(P), clump: clumpGeometry(P), rock: rockGeometry(P),
  };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const col = new THREE.Color();
  const stats = {};
  let tris = 0, count = 0;
  const makeIM = (kind, list, shadow) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[kind], M.solid, list.length);
    list.forEach((it, k) => {
      const [x, y, z, sx, sy, sz, ry, lean, ck, hk] = it;
      e3.set(lean, ry, lean * 0.6, 'YXZ');
      q4.setFromEuler(e3);
      m4.compose(v3.set(x, y, z), q4, s3.set(sx, sy, sz));
      im.setMatrixAt(k, m4);
      col.setRGB(ck * (1 + hk), ck, ck * (1 - hk * 0.6));
      im.setColorAt(k, col);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.name = `veg-${kind}${shadow ? '-shadow' : ''}`;
    group.add(im);
    const n = geos[kind].attributes.position.count / 3;
    stats[im.name] = { instances: list.length, trisEach: n };
    tris += n * list.length; count += list.length;
  };
  const used = new Set();
  for (const kind of Object.keys(L)) {
    const near = [], rest = [];
    for (const it of L[kind]) {
      const d = Math.hypot(it[0] - SHADOW_C[0], it[2] - SHADOW_C[1]);
      ((kind !== 'clump' && kind !== 'rock' && d < SHADOW_R) ? near : rest).push(it);
    }
    makeIM(kind, near, true);
    makeIM(kind, rest, false);
    if (near.length || rest.length) used.add(kind);
  }
  for (const k of Object.keys(geos)) if (!used.has(k)) geos[k].dispose();
  group.userData.info = { instances: count, triangles: tris, drawCalls: group.children.length, buildMs: Math.round(performance.now() - t0), stats };
  return group;
}
