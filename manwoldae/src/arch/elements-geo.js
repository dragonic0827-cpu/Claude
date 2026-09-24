// 계단·다리·회랑·담장 공통 도구 — 지오메트리 누적기(Buf/Sink), 단면 스윕, 전용 재질(재질 묶음마다 캐시)
//
// Buf 는 정점을 곧바로 배열에 쌓는 색인(index) 버퍼입니다. 모든 버킷이 position/normal/uv(+color)로 같아
// 재질별로 메시 하나씩만 만듭니다. 좌표는 모두 월드(또는 호출한 쪽의 로컬) 좌표를 그대로 씁니다.
import * as THREE from 'three';
import { rng } from '../core/textures.js';
import { materialUsesUV, colorAttribute } from './building-geo.js';
import { addUnderLift, UNDER_LIFT } from '../core/materials.js';

export const WHITE = new THREE.Color(1, 1, 1);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const rad = (deg) => ((deg || 0) * Math.PI) / 180;

// ─────────────────────────── 2D 벡터 (x, z) ───────────────────────────
export const v2 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  cross: (a, b) => a[0] * b[1] - a[1] * b[0],
  len: (a) => Math.hypot(a[0], a[1]),
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  // 진행 방향 t 의 왼쪽 법선 (y 위를 보고 섰을 때 왼쪽) = (tz, −tx)
  left: (t) => [t[1], -t[0]],
  madd: (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};

// 두 직선 p + a·s, q + b·t 의 교점 (평행하면 null)
export function lineX(p, a, q, b) {
  const den = v2.cross(a, b);
  if (Math.abs(den) < 1e-9) return null;
  const s = v2.cross(v2.sub(q, p), b) / den;
  return v2.madd(p, a, s);
}

// 꺾임점의 마이터 벡터: 들어오는 방향 a, 나가는 방향 b → V + m·d 가 두 변에서 모두 옆으로 d 떨어짐
export function miterVec(a, b, maxScale = 2.6) {
  const na = v2.left(a), nb = v2.left(b);
  const k = 1 + v2.dot(na, nb);
  if (k < 1e-4) return na;
  let m = v2.mul(v2.add(na, nb), 1 / k);
  const L = v2.len(m);
  if (L > maxScale) m = v2.mul(m, maxScale / L);
  return m;
}

// 점 → 선분 거리와 매개변수
export function segProj(p, a, b) {
  const ab = v2.sub(b, a);
  const L2 = v2.dot(ab, ab) || 1e-9;
  const t = clamp(v2.dot(v2.sub(p, a), ab) / L2, 0, 1);
  const q = v2.madd(a, ab, t);
  return { t, d: v2.dist(p, q), q };
}

// 회전된 직사각형(건물 기단 등): 중심, 반폭(로컬 x), 반깊이(로컬 z), rotationDeg
export function orientedRect(cx, cz, hw, hd, rotationDeg) {
  const r = rad(rotationDeg);
  return { c: [cx, cz], ax: [Math.cos(r), Math.sin(r)], az: [-Math.sin(r), Math.cos(r)], hw, hd };
}
export function rectLocal(R, p) {
  const q = v2.sub(p, R.c);
  return [v2.dot(q, R.ax), v2.dot(q, R.az)];
}
export function rectDist(R, p) {
  const [x, z] = rectLocal(R, p);
  const dx = Math.max(Math.abs(x) - R.hw, 0), dz = Math.max(Math.abs(z) - R.hd, 0);
  return Math.hypot(dx, dz);
}
// 선분 a→b 가 사각형 안을 지나는 매개변수 구간 [t0,t1] (없으면 null) — Liang–Barsky
export function clipSegRect(R, a, b, margin = 0) {
  const [ax, az] = rectLocal(R, a), [bx, bz] = rectLocal(R, b);
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const hw = R.hw + margin, hd = R.hd + margin;
  const P = [-dx, dx, -dz, dz], Q = [ax + hw, hw - ax, az + hd, hd - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(P[i]) < 1e-12) { if (Q[i] < 0) return null; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-6 ? [t0, t1] : null;
}

// ─────────────────────────── 누적 버퍼 ───────────────────────────
const _n = [0, 0, 0];
function faceN(a, b, c, out = _n) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z);
  if (l < 1e-12) { out[0] = 0; out[1] = 1; out[2] = 0; return 0; }
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return l;
}

export class Buf {
  constructor(colors = false) {
    this.p = []; this.n = []; this.uv = []; this.c = colors ? [] : null; this.idx = []; this.nv = 0;
  }
  get tris() { return this.idx.length / 3; }
  vert(p, n, u, v, col) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    if (this.c) { const k = col || WHITE; this.c.push(k.r, k.g, k.b); }
    return this.nv++;
  }
  // 평면 사각형 a-b-c-d (둘레 순서). hint(바깥 법선)와 반대로 감겼으면 뒤집습니다.
  // uv: [u0,v0,u1,v1,u2,v2,u3,v3], col: Color 또는 [Color×4]
  quad(a, b, c, d, uv, col, hint) {
    const n = [0, 0, 0];
    // 대각선 외적 → 약간 뒤틀린 사각형도 안정적
    const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2];
    const fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
    n[0] = ey * fz - ez * fy; n[1] = ez * fx - ex * fz; n[2] = ex * fy - ey * fx;
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-10) return;
    n[0] /= l; n[1] /= l; n[2] /= l;
    let flip = false;
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { flip = true; n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    const U = uv || UV0;
    const cs = Array.isArray(col) ? col : [col, col, col, col];
    const i0 = this.vert(a, n, U[0], U[1], cs[0]);
    const i1 = this.vert(b, n, U[2], U[3], cs[1]);
    const i2 = this.vert(c, n, U[4], U[5], cs[2]);
    const i3 = this.vert(d, n, U[6], U[7], cs[3]);
    if (flip) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  // 정점마다 법선을 주는 사각형 (매끈한 면). 감김은 법선 평균에 맞춥니다.
  quadN(a, b, c, d, na, nb, nc, nd, uv, col) {
    const g = [0, 0, 0];
    const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2];
    const fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
    g[0] = ey * fz - ez * fy; g[1] = ez * fx - ex * fz; g[2] = ex * fy - ey * fx;
    if (Math.hypot(g[0], g[1], g[2]) < 1e-10) return;
    const s = (na[0] + nb[0] + nc[0] + nd[0]) * g[0] + (na[1] + nb[1] + nc[1] + nd[1]) * g[1] + (na[2] + nb[2] + nc[2] + nd[2]) * g[2];
    const U = uv || UV0;
    const cs = Array.isArray(col) ? col : [col, col, col, col];
    const i0 = this.vert(a, na, U[0], U[1], cs[0]);
    const i1 = this.vert(b, nb, U[2], U[3], cs[1]);
    const i2 = this.vert(c, nc, U[4], U[5], cs[2]);
    const i3 = this.vert(d, nd, U[6], U[7], cs[3]);
    if (s < 0) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  tri(a, b, c, uv, col, hint) {
    const n = [0, 0, 0];
    if (faceN(a, b, c, n) < 1e-12) return;
    let flip = false;
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { flip = true; n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    const U = uv || UV0;
    const cs = Array.isArray(col) ? col : [col, col, col];
    const i0 = this.vert(a, n, U[0], U[1], cs[0]);
    const i1 = this.vert(b, n, U[2], U[3], cs[1]);
    const i2 = this.vert(c, n, U[4], U[5], cs[2]);
    if (flip) this.idx.push(i0, i2, i1); else this.idx.push(i0, i1, i2);
  }
  // 평면 다각형(볼록·오목 모두) — pts3: 3D 점들, pts2: 같은 순서의 2D 좌표(삼각분할용), uvFn(p3) → [u,v]
  polygon(pts3, pts2, hint, uvFn, col) {
    if (pts3.length < 3) return;
    const contour = pts2.map((q) => new THREE.Vector2(q[0], q[1]));
    if (THREE.ShapeUtils.isClockWise(contour)) {
      contour.reverse();
      pts3 = pts3.slice().reverse();
    }
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    const n = hint ? v3norm(hint) : null;
    for (const [i, j, k] of faces) {
      const a = pts3[i], b = pts3[j], c = pts3[k];
      const ua = uvFn(a), ub = uvFn(b), uc = uvFn(c);
      this.tri(a, b, c, [ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]], col, n);
    }
  }
  // 다른 BufferGeometry 를 행렬로 옮겨 넣기. uvFn(p, n) 이 있으면 uv 를 새로 만들고, colFn(n, p) 로 정점색
  addGeometry(geo, m, { uvFn = null, colFn = null, col = null } = {}) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uva = geo.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    const base = this.nv;
    for (let i = 0; i < pos.count; i++) {
      P.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (nor) N.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); else N.set(0, 1, 0);
      const p = [P.x, P.y, P.z], n = [N.x, N.y, N.z];
      let u = 0, v = 0;
      if (uvFn) [u, v] = uvFn(p, n); else if (uva) { u = uva.getX(i); v = uva.getY(i); }
      this.vert(p, n, u, v, colFn ? colFn(n, p) : col);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', colorAttribute(this.c));
    g.setIndex(this.nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
const UV0 = [0, 0, 1, 0, 1, 1, 0, 1];
function v3norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// 재질 → 버퍼 모음. build() 로 재질마다 메시 하나.
export class Sink {
  constructor() { this.map = new Map(); }
  get(mat) {
    let b = this.map.get(mat);
    if (!b) { b = new Buf(!!mat.vertexColors); this.map.set(mat, b); }
    return b;
  }
  get tris() { let t = 0; for (const b of this.map.values()) t += b.tris; return t; }
  build(group, pickId, name = '') {
    for (const [mat, b] of this.map) {
      if (!b.idx.length) continue;
      const geo = b.geometry();
      if (!materialUsesUV(mat)) geo.deleteAttribute('uv');
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = name;
      if (pickId) mesh.userData.pickId = pickId;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    return group;
  }
}

// 상자: 중심 c, 서로 수직인 단위축 ax(길이 방향)·ay(위)·az, 반길이 hx·hy·hz
// opt.uv: 'member'(u = 길이 0..1, v = 높이 0..1) | 'world'(월드 좌표 / scale) , opt.skip: ['-y', ...]
// opt.col / opt.colFaces: { '+y': Color, ... }
const BOXF = [
  ['+x', 0, 1, [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  ['-x', 0, -1, [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  ['+z', 2, 1, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  ['-z', 2, -1, [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ['+y', 1, 1, [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  ['-y', 1, -1, [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
];
export function box(buf, c, ax, ay, az, hx, hy, hz, opt = {}) {
  const { uv = 'member', scale = [1, 1], skip = null, col = null, colFaces = null, uOff = 0 } = opt;
  const P = (sx, sy, sz) => [
    c[0] + ax[0] * hx * sx + ay[0] * hy * sy + az[0] * hz * sz,
    c[1] + ax[1] * hx * sx + ay[1] * hy * sy + az[1] * hz * sz,
    c[2] + ax[2] * hx * sx + ay[2] * hy * sy + az[2] * hz * sz,
  ];
  const axes = [ax, ay, az];
  for (const [name, k, sgn, cs] of BOXF) {
    if (skip && skip.includes(name)) continue;
    const pts = cs.map(([sx, sy, sz]) => P(sx, sy, sz));
    const nrm = axes[k].map((q) => q * sgn);
    let U;
    if (uv === 'member') {
      if (k === 0) U = [0.5, 0.2, 0.5, 0.2, 0.5, 0.8, 0.5, 0.8];
      else U = cs.flatMap(([sx, sy, sz]) => [(sx + 1) / 2, k === 1 ? (sz * sgn + 1) / 2 : (sy + 1) / 2]);
    } else {
      U = pts.flatMap((p) => worldUV(p, nrm, scale, uOff));
    }
    buf.quad(pts[0], pts[1], pts[2], pts[3], U, (colFaces && colFaces[name]) || col, nrm);
  }
}

// 월드 상자 투영 uv (법선의 주축에 따라) — scale = [가로 m, 세로 m]
export function worldUV(p, n, scale = [4, 2], uOff = 0) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0] / scale[0] + uOff, p[2] / scale[0]];
  if (ax >= az) return [p[2] / scale[0] + uOff, p[1] / scale[1]];
  return [p[0] / scale[0] + uOff, p[1] / scale[1]];
}

// 선분 a→b 를 따라 가는 각기둥(도리·난간대). 둘레 v: 아래 0 → 위 1 (단청 흰 선이 아래로)
export function tube(buf, a, b, r, segs = 8, { col = null, u0 = 0, u1 = 1, caps = false, up = [0, 1, 0] } = {}) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-6) return;
  const t = [d[0] / L, d[1] / L, d[2] / L];
  // 옆 벡터: up × t, 위 벡터: t × side
  let s = [up[1] * t[2] - up[2] * t[1], up[2] * t[0] - up[0] * t[2], up[0] * t[1] - up[1] * t[0]];
  let sl = Math.hypot(s[0], s[1], s[2]);
  if (sl < 1e-6) { s = [1, 0, 0]; sl = 1; }
  s = s.map((q) => q / sl);
  const w = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]];
  const ring = [];
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const cy = -Math.cos(th), cx = Math.sin(th); // th=0 → 아래
    const n = [s[0] * cx + w[0] * cy, s[1] * cx + w[1] * cy, s[2] * cx + w[2] * cy];
    ring.push({ n, v: (1 - Math.cos(th)) / 2 });
  }
  const P = (o, n) => [o[0] + n[0] * r, o[1] + n[1] * r, o[2] + n[2] * r];
  for (let i = 0; i < segs; i++) {
    const A = ring[i], B = ring[i + 1];
    buf.quadN(P(a, A.n), P(b, A.n), P(b, B.n), P(a, B.n), A.n, A.n, B.n, B.n, [u0, A.v, u1, A.v, u1, B.v, u0, B.v], col);
  }
  if (caps) {
    for (const [o, sg] of [[a, -1], [b, 1]]) {
      const pts = ring.slice(0, segs).map((q) => P(o, q.n));
      const ctr = o;
      const nn = [t[0] * sg, t[1] * sg, t[2] * sg];
      for (let i = 0; i < segs; i++) buf.tri(ctr, pts[i], pts[(i + 1) % segs], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], col, nn);
    }
  }
}

// ─────────────────────────── 단면 스윕 ───────────────────────────
// 단면(section): { o:[x,z] 기준점, m:[mx,mz] (옆 거리 d → o + m·d), prof:[{d,y,tag}] }
//   prof 의 k 번째 점에서 k+1 번째 점으로 가는 변은 prof[k].tag 버킷에 그립니다(tag 가 null 이면 건너뜀).
//   단면은 +진행 방향에서 볼 때 (d 오른쪽, y 위) 반시계로 돌면 바깥 법선이 밖을 향합니다.
// tags: { 태그: { buf, uv:(ctx)→[u,v] 또는 'len'(u = 길이/su, v = 단면 길이/sv), su, sv, smooth, col|colFn } }
// 연속한 단면 쌍(i, i+1)마다 띠를 잇습니다. 법선은 단면의 (d, y) 모양에서 구하고, smooth 태그만 이웃 변과 평균합니다.
export function sweep(sections, tags, { closed = false } = {}) {
  const ns = sections.length;
  if (ns < 2) return;
  const np = sections[0].prof.length;
  const segCount = closed ? np : np - 1;
  // 각 단면 점의 3D 위치
  const P3 = sections.map((S) => S.prof.map((q) => [S.o[0] + S.m[0] * q.d, q.y, S.o[1] + S.m[1] * q.d]));
  // 길이 누적 (점마다)
  const uAcc = sections.map(() => new Float64Array(np));
  for (let i = 1; i < ns; i++) {
    for (let k = 0; k < np; k++) {
      const a = P3[i - 1][k], b = P3[i][k];
      uAcc[i][k] = uAcc[i - 1][k] + Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
  }
  // 단면 길이 누적 (v)
  const vAcc = sections.map((S) => {
    const arr = new Float64Array(np + 1);
    for (let k = 1; k <= np; k++) {
      const a = S.prof[k - 1], b = S.prof[k % np];
      arr[k] = arr[k - 1] + Math.hypot(b.d - a.d, b.y - a.y);
    }
    return arr;
  });
  for (let i = 0; i < ns - 1; i++) {
    const A = sections[i], B = sections[i + 1];
    // 진행 방향(수평)과 왼쪽 법선
    const dir = v2.norm(v2.sub(B.o, A.o));
    if (!Number.isFinite(dir[0]) || v2.dist(B.o, A.o) < 1e-6) continue;
    const nl = v2.left(dir);
    const edgeN = (S, k) => {
      const a = S.prof[k], b = S.prof[(k + 1) % np];
      const dd = b.d - a.d, dy = b.y - a.y;
      const l = Math.hypot(dd, dy) || 1;
      return [dy / l, -dd / l]; // (d, y) 평면 바깥 법선
    };
    const to3 = (n2) => [nl[0] * n2[0], n2[1], nl[1] * n2[0]];
    const vertN = (S, k, side) => {
      // side 0: 변 k 의 시작점(k), side 1: 끝점(k+1). 같은 태그의 이웃 변과 각이 작으면 법선을 평균
      const tg = S.prof[k].tag;
      const T = tags[tg];
      const e = edgeN(S, k);
      if (!T || !T.smooth) return to3(e);
      let kk = side === 0 ? k - 1 : k + 1;
      if (closed) kk = (kk + np) % np;
      else if (kk < 0 || kk > np - 2) return to3(e);
      if (S.prof[kk].tag !== tg) return to3(e);
      const e2 = edgeN(S, kk);
      if (e[0] * e2[0] + e[1] * e2[1] < (T.smoothCos ?? 0.8)) return to3(e);
      const s = [e[0] + e2[0], e[1] + e2[1]];
      const l = Math.hypot(s[0], s[1]) || 1;
      return to3([s[0] / l, s[1] / l]);
    };
    for (let k = 0; k < segCount; k++) {
      const tg = A.prof[k].tag;
      const T = tags[tg];
      if (!T) continue;
      const k1 = (k + 1) % np;
      const a0 = P3[i][k], a1 = P3[i][k1], b0 = P3[i + 1][k], b1 = P3[i + 1][k1];
      let U;
      if (typeof T.uv === 'function') {
        U = [
          ...T.uv(a0, uAcc[i][k], vAcc[i][k], A.prof[k]), ...T.uv(b0, uAcc[i + 1][k], vAcc[i + 1][k], B.prof[k]),
          ...T.uv(b1, uAcc[i + 1][k1], vAcc[i + 1][k + 1], B.prof[k1]), ...T.uv(a1, uAcc[i][k1], vAcc[i][k + 1], A.prof[k1]),
        ];
      } else {
        const su = T.su || 1, sv = T.sv || 1;
        U = [uAcc[i][k] / su, vAcc[i][k] / sv, uAcc[i + 1][k] / su, vAcc[i + 1][k] / sv,
          uAcc[i + 1][k1] / su, vAcc[i + 1][k + 1] / sv, uAcc[i][k1] / su, vAcc[i][k + 1] / sv];
      }
      const col = T.colFn ? [T.colFn(A.prof[k]), T.colFn(B.prof[k]), T.colFn(B.prof[k1]), T.colFn(A.prof[k1])] : T.col;
      const na0 = vertN(A, k, 0), na1 = vertN(A, k, 1), nb0 = vertN(B, k, 0), nb1 = vertN(B, k, 1);
      // 둘레 순서: a0 → a1 → b1 → b0 (바깥에서 반시계)
      T.buf.quadN(a0, a1, b1, b0, na0, na1, nb1, nb0, [U[0], U[1], U[6], U[7], U[4], U[5], U[2], U[3]], col ? (Array.isArray(col) ? [col[0], col[3], col[2], col[1]] : col) : null);
    }
  }
}

// 단면 하나를 마구리 면으로 막기 (idx: 쓸 단면 점 번호들, 순서대로 다각형). dirOut: 바깥쪽 수평 방향 [x,z]
export function capSection(buf, S, idx, dirOut, uvFn, col) {
  const pts3 = idx.map((k) => [S.o[0] + S.m[0] * S.prof[k].d, S.prof[k].y, S.o[1] + S.m[1] * S.prof[k].d]);
  const pts2 = idx.map((k) => [S.prof[k].d, S.prof[k].y]);
  buf.polygon(pts3, pts2, [dirOut[0], 0, dirOut[1]], uvFn || ((p) => [p[0] / 4 + p[2] / 4, p[1] / 2]), col);
}

// ─────────────────────────── 전용 재질 (재질 묶음마다 한 번) ───────────────────────────
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.lerp(new THREE.Color(0, 0, 0), -k);
  return '#' + c.getHexString();
}
function tex(c, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
// 원형으로 이어지는(이음매 없는) 얼룩: 가장자리를 넘는 얼룩은 반대쪽에도 그림
function wrapBlob(ctx, W, H, x, y, r, fill) {
  for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
    if (x + ox + r < 0 || x + ox - r > W || y + oy + r < 0 || y + oy - r > H) continue;
    const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
    g.addColorStop(0, fill);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
  }
}
function grain(ctx, W, H, rand, n, dark, light, size = 1.6) {
  for (let i = 0; i < n; i++) {
    const x = rand() * W, y = rand() * H, s = 1 + rand() * size;
    const r = rand();
    ctx.fillStyle = r < 0.45 ? `rgba(20,18,16,${dark * rand()})` : r < 0.8 ? `rgba(255,252,245,${light * rand()})` : `rgba(150,110,90,${0.25 * rand()})`;
    ctx.fillRect(x, y, s, s);
  }
}

// 화강암 장대석: 세로 이음매만 있는 돌 띠 (가로 4 m × 세로 2 m 반복, 위아래로 이음매 없음)
// 계단 디딤판·챌판, 소맷돌, 다리 상판에 씁니다. u 방향으로 돌마다 색이 조금씩 다릅니다.
function graniteTexture(base, seed = 31) {
  const W = 512, H = 256;
  const [c, ctx] = canvas(W, H);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // 돌 나누기
  const joints = [];
  let x = rand() * 40;
  while (x < W - 60) { joints.push(x); x += 90 + rand() * 150; }
  const edges = [...joints, W + joints[0]];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    ctx.fillStyle = shade(base, (rand() - 0.5) * 0.14);
    ctx.fillRect(a, 0, b - a, H);
    if (b > W) { ctx.fillRect(a - W, 0, b - a, H); }
  }
  // 얼룩 (풍화·물때)
  for (let i = 0; i < 70; i++) {
    const r = 10 + rand() * 45;
    wrapBlob(ctx, W, H, rand() * W, rand() * H, r, rand() < 0.55 ? 'rgba(60,55,48,0.10)' : 'rgba(255,250,240,0.08)');
  }
  grain(ctx, W, H, rand, 14000, 0.32, 0.3, 1.2);
  // 이음매: 어두운 줄 + 한쪽 밝은 모서리
  for (const j of joints) {
    ctx.fillStyle = 'rgba(30,26,22,0.55)';
    ctx.fillRect(j - 1, 0, 2.2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(j + 1.2, 0, 1.5, H);
  }
  return tex(c);
}

// 판축 토성: 수평 켜(층)와 빗물 자국, 잔자갈 (가로 4 m × 세로 2 m)
function earthTexture(base, { stones = 0, seed = 41 } = {}) {
  const W = 256, H = 256;
  const [c, ctx] = canvas(W, H);
  const rand = rng(seed);
  ctx.fillStyle = shade(base, 0.08);
  ctx.fillRect(0, 0, W, H);
  // 켜: 약 0.1–0.2 m, 경계는 흐릿하게
  let y = 0;
  while (y < H) {
    const h = 12 + rand() * 14;
    ctx.fillStyle = shade(base, 0.08 + (rand() - 0.5) * 0.12);
    ctx.fillRect(0, y, W, h);
    const g = ctx.createLinearGradient(0, y + h - 3, 0, y + h + 1);
    g.addColorStop(0, 'rgba(60,42,28,0)');
    g.addColorStop(1, 'rgba(60,42,28,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y + h - 3, W, 4);
    y += h;
  }
  // 얼룩 (흙 색 차이)
  for (let i = 0; i < 60; i++) wrapBlob(ctx, W, H, rand() * W, rand() * H, 12 + rand() * 40, rand() < 0.5 ? 'rgba(70,50,32,0.10)' : 'rgba(255,245,225,0.08)');
  // 빗물 자국 (세로, 옅게)
  for (let i = 0; i < 26; i++) {
    const x = rand() * W, w = 1 + rand() * 3;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(50,38,28,0)');
    g.addColorStop(0.5, `rgba(50,38,28,${0.03 + rand() * 0.05})`);
    g.addColorStop(1, 'rgba(50,38,28,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, H);
  }
  // 돌 (토석 혼축): 둥근 강돌·깬돌이 흙 사이로 드러남
  for (let i = 0; i < stones; i++) {
    const sx = rand() * W, sy = rand() * H, rx = 3 + rand() * 8, ry = 2.5 + rand() * 5;
    const tone = shade('#9a958b', (rand() - 0.5) * 0.35);
    const rot = rand() * 0.8;
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      ctx.fillStyle = 'rgba(40,30,20,0.35)';
      ctx.beginPath(); ctx.ellipse(sx + ox + 0.8, sy + oy + 1.2, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tone;
      ctx.beginPath(); ctx.ellipse(sx + ox, sy + oy, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(sx + ox - rx * 0.25, sy + oy - ry * 0.3, rx * 0.5, ry * 0.35, rot, 0, Math.PI * 2); ctx.fill();
    }
  }
  grain(ctx, W, H, rand, 4000, 0.25, 0.15);
  return tex(c);
}

// 살창(회랑 바깥벽 창): 주칠 살대 + 어두운 안쪽 (창 한 짝 = u 0..1)
function salchangTexture(P) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#1c1512';
  ctx.fillRect(0, 0, 256, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(90,70,55,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const fr = new THREE.Color(P.timberRed);
  const frame = '#' + fr.getHexString();
  ctx.fillStyle = frame;
  for (let x = 12; x < 250; x += 26) {
    ctx.fillStyle = frame; ctx.fillRect(x, 0, 12, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, 0, 3, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 10, 0, 2, 256);
  }
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, 256, 16); ctx.fillRect(0, 240, 256, 16);
  ctx.fillRect(0, 0, 14, 256); ctx.fillRect(242, 0, 14, 256);
  ctx.fillRect(0, 120, 256, 10);
  const t = tex(c, 4);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const cache = new WeakMap();
const vcClone = (src, extra = {}) => {
  const m = src.clone();
  m.vertexColors = true;
  m.color.set(0xffffff);
  Object.assign(m, extra);
  return m;
};

// 재질 묶음(mats) 하나에 대해 한 번만 만드는 전용 재질과 정점색
export function elementMats(mats) {
  let E = cache.get(mats);
  if (E) return E;
  const P = mats.palette || {};
  const col = (h, k = 1) => new THREE.Color(h).multiplyScalar(k);
  E = {
    // 정점색으로 칠하는 목부재(석간주·황단·백분·개판) — 공포·서까래·박공·인방을 메시 하나로
    wood: vcClone(mats.timber),
    // 정점색 기와 마감(용마루 적새·백도·막새·착고)
    trim: vcClone(mats.ridgeGray, { roughness: 0.8 }),
    // 화강암 장대석(세로 이음매) + 정점색으로 구석 그늘
    granite: new THREE.MeshStandardMaterial({ map: graniteTexture(P.granite || '#A9A59C'), vertexColors: true, roughness: 0.9 }),
    earth: new THREE.MeshStandardMaterial({ map: earthTexture(P.rammedEarthWall || '#9E8466'), roughness: 1 }),
    earthStone: new THREE.MeshStandardMaterial({ map: earthTexture(P.rammedEarthWall || '#9E8466', { stones: 140, seed: 43 }), roughness: 1 }),
    salchang: new THREE.MeshStandardMaterial({ map: salchangTexture(P), roughness: 0.85, side: THREE.DoubleSide }),
    C: {
      timber: col(P.timberRed || '#8C3A2B'),
      timberDark: col(P.timberRed || '#8C3A2B', 0.55),
      hwangdan: col(P.hwangdan || '#D4622B'),
      white: col(P.baekbun || '#EFE8D8'),
      soffit: col('#6a3526'),
      rafterEnd: new THREE.Color(P.timberRed || '#8C3A2B').lerp(new THREE.Color(P.baekbun || '#EFE8D8'), 0.3),
      ridge: col(P.roofTileShadow || '#3F4244'),
      ridgeDark: col(P.roofTileShadow || '#3F4244', 0.7),
      eave: col(P.roofTileHighlight || '#72767A', 0.95),
      eaveDark: col(P.roofTile || '#5A5D5E', 0.55),
      tile: col(P.roofTile || '#5A5D5E'),
      makse: col(P.roofTileHighlight || '#72767A', 0.92),
      makseFace: col(P.roofTile || '#5A5D5E', 0.62),
      ao: (k) => new THREE.Color(k, k, k),
    },
  };
  // 회랑 공포 밑면(황단 정점색)도 전각과 같은 밑면 채움빛
  addUnderLift(E.wood, E.C.hwangdan, UNDER_LIFT);
  E.granite.name = 'elements-granite';
  E.wood.name = 'elements-wood';
  E.trim.name = 'elements-trim';
  cache.set(mats, E);
  return E;
}

// ─────────────────────────── 합치기(선택) ───────────────────────────
// 여러 요소(담장·계단·회랑 등)를 재질별 메시 하나로 합쳐 그리기 호출을 줄입니다(정적인 것만).
// 합친 메시는 userData.pickRanges = [[첫 삼각형, 끝 삼각형(미포함), pickId], ...] 를 갖고,
// pickIdAt(mesh, faceIndex) 로 레이캐스트 결과의 id 를 찾습니다. 원래 지오메트리는 dispose 합니다.
//   opts.cell (m): 합친 메시가 이보다 넓으면(xz 경계 상자 반대각 > cell) 공간 칸으로 나눠, 화면·그림자 상자 밖 칸은
//     frustum culling 으로 건너뛰게 합니다(도성 성벽처럼 수 km 에 걸친 것). 삼각형을 만든 차례(경로 순)대로 칸 크기를 넘지 않는
//     구간으로 끊고, 구간을 그 무게중심이 든 칸에 모읍니다(칸 모서리를 스치는 몇 개짜리 조각이 생기지 않게).
//     칸은 opts.center 에서 멀수록 두 배씩 커지고(반지름 grow·cell 안은 cell, 그 밖은 2·cell …, grow 기본 2),
//     opts.near 안쪽은 한 덩이(늘 그 안에서 보는 둘레), opts.minTris(기본 200)보다 작은 칸은 가장 가까운 칸에 붙입니다.
//   그림자: 재질에 userData.noCastShadow 가 있으면(금동 장식처럼 아주 작은 부재) 합친 메시도 그림자를 드리우지 않습니다.
export function mergeElements(objects, name = 'elements', opts = {}) {
  const byMat = new Map();
  for (const o of objects) {
    if (!o) continue;
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh) return;
      let list = byMat.get(m.material);
      if (!list) { list = []; byMat.set(m.material, list); }
      list.push(m);
    });
  }
  const group = new THREE.Group();
  group.name = name;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const [mat, meshes] of byMat) {
    let nv = 0, ni = 0;
    for (const m of meshes) {
      const g = m.geometry;
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const withColor = meshes.every((m) => m.geometry.attributes.color);
    const withUV = materialUsesUV(mat);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = withUV ? new Float32Array(nv * 2) : null;
    const col = withColor ? new Float32Array(nv * 3) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const ranges = [];
    let vo = 0, io = 0;
    for (const m of meshes) {
      const g = m.geometry, M = m.matrixWorld;
      nm.getNormalMatrix(M);
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, Cc = g.attributes.color;
      for (let i = 0; i < P.count; i++) {
        const k = vo + i;
        v.fromBufferAttribute(P, i).applyMatrix4(M);
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z; }
        if (U && uv) { uv[k * 2] = U.getX(i); uv[k * 2 + 1] = U.getY(i); }
        if (col) { col[k * 3] = Cc.getX(i); col[k * 3 + 1] = Cc.getY(i); col[k * 3 + 2] = Cc.getZ(i); }
      }
      const t0 = io / 3;
      if (g.index) for (let j = 0; j < g.index.count; j++) idx[io++] = g.index.getX(j) + vo;
      else for (let j = 0; j < P.count; j++) idx[io++] = j + vo;
      const id = m.userData.pickId ?? null;
      const last = ranges[ranges.length - 1];
      if (last && last[2] === id && last[1] === t0) last[1] = io / 3;
      else ranges.push([t0, io / 3, id]);
      vo += P.count;
      g.dispose();
    }
    const cast = !mat.userData?.noCastShadow;
    const parts = opts?.cell > 0 ? splitCells({ pos, nor, uv, col, idx, ranges }, opts) : null;
    for (const part of parts || [{ pos, nor, uv, col, idx, ranges }]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(part.nor, 3));
      if (part.uv) geo.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
      if (part.col) geo.setAttribute('color', colorAttribute(part.col));
      geo.setIndex(new THREE.BufferAttribute(part.idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.pickRanges = part.ranges;
      if (parts) mesh.name = `${name}:${part.key}`;
      group.add(mesh);
    }
  }
  return group;
}

// 합친 지오메트리를 공간 칸으로 나눔 (mergeElements 의 opts.cell). 나눌 만큼 넓지 않으면 null.
function splitCells({ pos, nor, uv, col, idx, ranges }, { cell, center = [0, 0], near = 0, minTris = 200, grow = 2 }) {
  const nt = idx.length / 3;
  if (!nt) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = pos[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (Math.hypot(x1 - x0, z1 - z0) / 2 <= cell) return null;
  const [cx, cz] = center;
  // 칸 크기: 가운데에서 멀수록 두 배씩 (반지름 grow·cell 안은 cell, grow·2·cell 안은 2·cell …)
  const sizeAt = (r) => { let s = cell, lvl = 0; while (r > s * grow && lvl < 8) { s *= 2; lvl++; } return [s, lvl]; };
  // 1) 삼각형을 만든 차례(경로를 따라 이어짐)대로 훑어, 칸 크기를 넘지 않는 연속 구간(run)으로 끊음
  //    — 삼각형마다 칸을 고르면 칸 모서리를 스치는 몇 개짜리 조각이 그리기 호출만 늘리므로
  const runs = [];
  let run = null;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const x = (pos[a] + pos[b] + pos[c]) / 3 - cx, z = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - cz;
    if (run) {
      const rx0 = Math.min(run.x0, x), rx1 = Math.max(run.x1, x), rz0 = Math.min(run.z0, z), rz1 = Math.max(run.z1, z);
      if (rx1 - rx0 > run.lim || rz1 - rz0 > run.lim) run = null;
      else { run.x0 = rx0; run.x1 = rx1; run.z0 = rz0; run.z1 = rz1; }
    }
    if (!run) { run = { tris: [], sx: 0, sz: 0, x0: x, x1: x, z0: z, z1: z, lim: sizeAt(Math.hypot(x, z))[0] }; runs.push(run); }
    run.tris.push(t);
    run.sx += x; run.sz += z;
  }
  // 2) 구간을 그 무게중심이 든 칸에 모음
  const cells = new Map();
  for (const q of runs) {
    const x = q.sx / q.tris.length, z = q.sz / q.tris.length;
    const r = Math.hypot(x, z);
    const [sz, lvl] = sizeAt(r);
    const key = r < near ? 'near' : `${lvl}_${Math.floor(x / sz)}_${Math.floor(z / sz)}`;
    let cq = cells.get(key);
    if (!cq) { cq = { key, tris: [], sx: 0, sz: 0 }; cells.set(key, cq); }
    for (const t of q.tris) cq.tris.push(t);
    cq.sx += q.sx; cq.sz += q.sz;
  }
  // 작은 칸은 무게중심이 가장 가까운 큰 칸에 붙임
  const list = [...cells.values()];
  for (const q of list) { q.mx = q.sx / q.tris.length; q.mz = q.sz / q.tris.length; }
  const big = list.filter((q) => q.tris.length >= minTris);
  if (big.length < 2) return null;
  for (const q of list) {
    if (q.tris.length >= minTris) continue;
    let best = big[0], bd = Infinity;
    for (const p of big) { const d = Math.hypot(p.mx - q.mx, p.mz - q.mz); if (d < bd) { bd = d; best = p; } }
    for (const t of q.tris) best.tris.push(t);
  }
  const remap = new Int32Array(pos.length / 3);
  return big.map((q) => {
    q.tris.sort((a, b) => a - b);
    remap.fill(-1);
    let n = 0;
    for (const t of q.tris) for (let k = 0; k < 3; k++) { const i = idx[t * 3 + k]; if (remap[i] < 0) remap[i] = n++; }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = uv ? new Float32Array(n * 2) : null, C = col ? new Float32Array(n * 3) : null;
    for (let i = 0; i < remap.length; i++) {
      const j = remap[i];
      if (j < 0) continue;
      P[j * 3] = pos[i * 3]; P[j * 3 + 1] = pos[i * 3 + 1]; P[j * 3 + 2] = pos[i * 3 + 2];
      N[j * 3] = nor[i * 3]; N[j * 3 + 1] = nor[i * 3 + 1]; N[j * 3 + 2] = nor[i * 3 + 2];
      if (U) { U[j * 2] = uv[i * 2]; U[j * 2 + 1] = uv[i * 2 + 1]; }
      if (C) { C[j * 3] = col[i * 3]; C[j * 3 + 1] = col[i * 3 + 1]; C[j * 3 + 2] = col[i * 3 + 2]; }
    }
    const I = n > 65535 ? new Uint32Array(q.tris.length * 3) : new Uint16Array(q.tris.length * 3);
    const R = [];
    let r = 0;
    q.tris.forEach((t, k) => {
      I[k * 3] = remap[idx[t * 3]]; I[k * 3 + 1] = remap[idx[t * 3 + 1]]; I[k * 3 + 2] = remap[idx[t * 3 + 2]];
      while (r < ranges.length - 1 && t >= ranges[r][1]) r++;
      const id = ranges[r]?.[2] ?? null;
      const last = R[R.length - 1];
      if (last && last[2] === id && last[1] === k) last[1] = k + 1;
      else R.push([k, k + 1, id]);
    });
    return { key: q.key, pos: P, nor: N, uv: U, col: C, idx: I, ranges: R };
  });
}

// 합친 메시에서 삼각형 번호 → pickId
export function pickIdAt(mesh, faceIndex) {
  const R = mesh && mesh.userData && mesh.userData.pickRanges;
  if (!R) return mesh && mesh.userData ? mesh.userData.pickId ?? null : null;
  let lo = 0, hi = R.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (faceIndex < R[mid][0]) hi = mid - 1;
    else if (faceIndex >= R[mid][1]) lo = mid + 1;
    else return R[mid][2];
  }
  return null;
}
