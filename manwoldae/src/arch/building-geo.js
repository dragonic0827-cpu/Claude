// 건물 지오메트리 누적기 — 부재를 재질(키)별로 모아 건물 하나에 메시 몇 개로 합칩니다.
//
// GeoSink 는 현재 변환 행렬(setMatrix)을 적용해 정점을 곧바로 배열에 쌓습니다.
// 작은 BufferGeometry 를 수천 개 만들어 mergeGeometries 하는 것보다 빠르고 메모리도 적게 씁니다.
// 모든 버킷은 index + position/normal/uv (+ 색 버킷은 color) 로 속성 구성이 같습니다.
import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);
const UV01 = [0, 0, 1, 0, 1, 1, 0, 1];
const Y_UP = new THREE.Vector3(0, 1, 0);

const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _D = new THREE.Vector3();
const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3();
const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3();

// 상자 면: [이름, 법선, 네 꼭짓점 부호(바깥에서 반시계), u 축, v 축]
const BOX_FACES = [
  ['+x', [1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], 2, 1],
  ['-x', [-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], 2, 1],
  ['+z', [0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], 0, 1],
  ['-z', [0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], 0, 1],
  ['+y', [0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], 0, 2],
  ['-y', [0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], 0, 2],
];

export class GeoSink {
  constructor(colored = []) {
    this.buckets = new Map();
    this.colored = new Set(colored);
    this.aliases = new Map();   // 키 → [실제 키, 기본 색] (단색 재질을 정점색 메시로 합칠 때)
    this.defCol = null;
    this.M = new THREE.Matrix4();
    this.N = new THREE.Matrix3();
    this.ident = true;
  }

  // key 로 그린 것을 target 버킷에 col 색으로 합침
  alias(key, target, col) { this.aliases.set(key, [target, col]); return this; }

  get(key) {
    const al = this.aliases.get(key);
    if (al) { key = al[0]; this.defCol = al[1]; } else this.defCol = null;
    let b = this.buckets.get(key);
    if (!b) {
      b = { p: [], n: [], uv: [], c: this.colored.has(key) ? [] : null, idx: [], nv: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  setMatrix(m) {
    if (m) { this.M.copy(m); this.N.getNormalMatrix(m); this.ident = false; } else { this.M.identity(); this.N.identity(); this.ident = true; }
    return this;
  }

  // 현재 변환에 m 을 곱해 들어감 / 되돌림
  push(m) {
    this._stack = this._stack || [];
    this._stack.push([this.M.clone(), this.ident]);
    if (this.ident) this.setMatrix(m); else this.setMatrix(this.M.clone().multiply(m));
    return this;
  }

  pop() {
    const [m, id] = this._stack.pop();
    if (id) this.setMatrix(null); else this.setMatrix(m);
    return this;
  }

  // 로컬 → 현재 변환
  tp(x, y, z, out) { out.set(x, y, z); if (!this.ident) out.applyMatrix4(this.M); return out; }
  tn(x, y, z, out) { out.set(x, y, z); if (!this.ident) out.applyMatrix3(this.N); return out.normalize(); }

  pushV(b, p, n, u, v, col) {
    b.p.push(p.x, p.y, p.z);
    b.n.push(n.x, n.y, n.z);
    b.uv.push(u, v);
    if (b.c) { const c = col || this.defCol || WHITE; b.c.push(c.r, c.g, c.b); }
    return b.nv++;
  }

  // 평면 사각형. a..d 는 로컬 [x,y,z], 바깥에서 볼 때 반시계. expect(로컬 법선)를 주면 감김을 맞춥니다.
  quad(key, a, b, c, d, col, uv = UV01, expect = null) {
    const bk = this.get(key);
    this.tp(a[0], a[1], a[2], _A); this.tp(b[0], b[1], b[2], _B);
    this.tp(c[0], c[1], c[2], _C); this.tp(d[0], d[1], d[2], _D);
    _u.subVectors(_C, _A); _w.subVectors(_D, _B); _n.crossVectors(_u, _w);
    const len = _n.length();
    if (len < 1e-12) return;
    _n.divideScalar(len);
    let flip = false;
    if (expect) { this.tn(expect[0], expect[1], expect[2], _q); if (_n.dot(_q) < 0) { flip = true; _n.negate(); } }
    const i0 = this.pushV(bk, _A, _n, uv[0], uv[1], col);
    const i1 = this.pushV(bk, _B, _n, uv[2], uv[3], col);
    const i2 = this.pushV(bk, _C, _n, uv[4], uv[5], col);
    const i3 = this.pushV(bk, _D, _n, uv[6], uv[7], col);
    if (flip) bk.idx.push(i0, i2, i1, i0, i3, i2); else bk.idx.push(i0, i1, i2, i0, i2, i3);
  }

  // 삼각형 (로컬), expect 로 감김 보정
  tri(key, a, b, c, col, uv = UV01, expect = null) {
    const bk = this.get(key);
    this.tp(a[0], a[1], a[2], _A); this.tp(b[0], b[1], b[2], _B); this.tp(c[0], c[1], c[2], _C);
    _u.subVectors(_B, _A); _w.subVectors(_C, _A); _n.crossVectors(_u, _w);
    const len = _n.length();
    if (len < 1e-12) return;
    _n.divideScalar(len);
    let flip = false;
    if (expect) { this.tn(expect[0], expect[1], expect[2], _q); if (_n.dot(_q) < 0) { flip = true; _n.negate(); } }
    const i0 = this.pushV(bk, _A, _n, uv[0], uv[1], col);
    const i1 = this.pushV(bk, _B, _n, uv[2], uv[3], col);
    const i2 = this.pushV(bk, _C, _n, uv[4], uv[5], col);
    if (flip) bk.idx.push(i0, i2, i1); else bk.idx.push(i0, i1, i2);
  }

  // 상자 (로컬 중심 cx,cy,cz, 크기 sx,sy,sz)
  //   o.col, o.under(아랫면 색), o.top(윗면 색), o.skip('-y+z' 처럼 뺄 면),
  //   o.uv: 'unit'(면마다 0..1) | 'world'(미터/us, vs) | 'member'(u = x 방향 0..1, v = 높이 0..1)
  box(key, cx, cy, cz, sx, sy, sz, o = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const dims = [sx, sy, sz];
    const us = o.us ?? 1, vs = o.vs ?? 1;
    for (const [name, nrm, corners, ua, va] of BOX_FACES) {
      if (o.skip && o.skip.includes(name)) continue;
      const pts = corners.map(([a, b, c]) => [cx + a * hx, cy + b * hy, cz + c * hz]);
      let uv = UV01;
      if (o.uv === 'world') {
        const u1 = dims[ua] / us, v1 = dims[va] / vs;
        const u0 = (o.u0 ?? 0), v0 = (o.v0 ?? 0);
        uv = [u0, v0, u0 + u1, v0, u0 + u1, v0 + v1, u0, v0 + v1];
      } else if (o.uv === 'member') {
        if (name === '+x' || name === '-x') uv = [0.01, 0.3, 0.01, 0.3, 0.01, 0.7, 0.01, 0.7];
        else if (name === '-z') uv = [1, 0, 0, 0, 0, 1, 1, 1];
      }
      let col = o.col;
      if (name === '-y' && o.under) col = o.under;
      if (name === '+y' && o.top) col = o.top;
      this.quad(key, pts[0], pts[1], pts[2], pts[3], col, uv, nrm);
    }
  }

  // 사각 뿔대 (밑면 중심 cx,y0,cz, 아래 반폭 rb, 위 반폭 rt, 높이 h) — 주두·소로의 굽
  frustum(key, cx, y0, cz, rbx, rbz, rtx, rtz, h, col, o = {}) {
    const y1 = y0 + h;
    const B = [[cx - rbx, y0, cz + rbz], [cx + rbx, y0, cz + rbz], [cx + rbx, y0, cz - rbz], [cx - rbx, y0, cz - rbz]];
    const T = [[cx - rtx, y1, cz + rtz], [cx + rtx, y1, cz + rtz], [cx + rtx, y1, cz - rtz], [cx - rtx, y1, cz - rtz]];
    const ex = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(key, B[i], B[j], T[j], T[i], col, UV01, ex[i]);
    }
    if (o.top) this.quad(key, T[0], T[1], T[2], T[3], col, UV01, [0, 1, 0]);
    if (o.bottom) this.quad(key, B[3], B[2], B[1], B[0], o.bottomCol || col, UV01, [0, -1, 0]);
  }

  // 회전체. prof = [[r, y], ...] 아래→위. 같은 점을 두 번 쓰면 모서리가 각집니다.
  lathe(key, prof, segs, col, o = {}) {
    const bk = this.get(key);
    const phase = o.phase ?? 0;
    const np = prof.length;
    // 선분 법선 (r, y 평면)
    const segN = [];
    for (let k = 0; k < np - 1; k++) {
      const dr = prof[k + 1][0] - prof[k][0], dy = prof[k + 1][1] - prof[k][1];
      const L = Math.hypot(dr, dy);
      segN.push(L < 1e-9 ? null : [dy / L, -dr / L]);
    }
    const vN = [];
    for (let k = 0; k < np; k++) {
      const a = k > 0 ? segN[k - 1] : null, b = k < np - 1 ? segN[k] : null;
      let nr = 0, ny = 0;
      if (a) { nr += a[0]; ny += a[1]; }
      if (b) { nr += b[0]; ny += b[1]; }
      const L = Math.hypot(nr, ny) || 1;
      vN.push([nr / L, ny / L]);
    }
    const base = bk.nv;
    const vMax = prof[np - 1][1] - prof[0][1] || 1;
    for (let k = 0; k < np; k++) {
      const [r, y] = prof[k];
      for (let i = 0; i <= segs; i++) {
        const a = phase + (i / segs) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        this.tp(r * c, y, -r * s, _A);
        this.tn(vN[k][0] * c, vN[k][1], -vN[k][0] * s, _n);
        this.pushV(bk, _A, _n, i / segs, (y - prof[0][1]) / vMax, col);
      }
    }
    for (let k = 0; k < np - 1; k++) {
      if (segN[k] === null) continue;
      for (let i = 0; i < segs; i++) {
        const a = base + k * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
        bk.idx.push(a, b, d, a, d, c);
      }
    }
  }

  // 두 점 사이 원기둥(옆면만). A,B 로컬 Vector3
  cyl(key, A, B, r0, r1, segs, col, o = {}) {
    const bk = this.get(key);
    this.tp(A.x, A.y, A.z, _A); this.tp(B.x, B.y, B.z, _B);
    _t.subVectors(_B, _A);
    const L = _t.length();
    if (L < 1e-6) return;
    _t.divideScalar(L);
    // 반지름 방향 기준 벡터
    _up.copy(Math.abs(_t.y) < 0.9 ? Y_UP : _q.set(1, 0, 0));
    _s.crossVectors(_t, _up).normalize();
    _up.crossVectors(_s, _t).normalize();
    const phase = o.phase ?? 0;
    const base = bk.nv;
    for (let e = 0; e < 2; e++) {
      const P = e ? _B : _A, r = e ? r1 : r0; // 변환에 배율이 없다고 가정
      for (let i = 0; i <= segs; i++) {
        const a = phase + (i / segs) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        _n.set(_s.x * c + _up.x * s, _s.y * c + _up.y * s, _s.z * c + _up.z * s);
        _C.set(P.x + _n.x * r, P.y + _n.y * r, P.z + _n.z * r);
        bk.p.push(_C.x, _C.y, _C.z); bk.n.push(_n.x, _n.y, _n.z); bk.uv.push(i / segs, e);
        if (bk.c) { const cc = col || this.defCol || WHITE; bk.c.push(cc.r, cc.g, cc.b); }
        bk.nv++;
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i, b = a + 1, c = a + segs + 1, d = c + 1;
      bk.idx.push(a, c, d, a, d, b);
    }
  }

  // 원판 (중심 C, 법선 N 방향을 바라봄). uv 는 원을 0..1 정사각형에 맞춤
  disc(key, C, N, r, segs, col, o = {}) {
    const bk = this.get(key);
    this.tp(C.x, C.y, C.z, _A);
    this.tn(N.x, N.y, N.z, _t);
    _up.copy(Math.abs(_t.y) < 0.9 ? Y_UP : _q.set(1, 0, 0));
    _s.crossVectors(_up, _t).normalize();
    _up.crossVectors(_t, _s).normalize();
    const phase = o.phase ?? 0;
    const c0 = this.pushV(bk, _A, _t, 0.5, 0.5, col);
    for (let i = 0; i <= segs; i++) {
      const a = phase + (i / segs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      _B.set(_A.x + (_s.x * c + _up.x * s) * r, _A.y + (_s.y * c + _up.y * s) * r, _A.z + (_s.z * c + _up.z * s) * r);
      this.pushV(bk, _B, _t, 0.5 + 0.5 * c, 0.5 + 0.5 * s, col);
    }
    for (let i = 0; i < segs; i++) bk.idx.push(c0, c0 + 1 + i, c0 + 2 + i);
  }

  // 격자면. fn(i, j, out) 가 로컬 위치를 out 에 넣고 [u, v] 를 돌려줌. expect(n) → 법선이 맞는 방향이면 true
  grid(key, nu, nv, fn, expect, col) {
    const bk = this.get(key);
    const P = new Array((nu + 1) * (nv + 1));
    const UV = new Array(P.length);
    const tmp = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const uv = fn(i, j, tmp);
        const p = new THREE.Vector3();
        this.tp(tmp.x, tmp.y, tmp.z, p);
        P[j * (nu + 1) + i] = p;
        UV[j * (nu + 1) + i] = uv;
      }
    }
    const at = (i, j) => P[Math.min(nv, Math.max(0, j)) * (nu + 1) + Math.min(nu, Math.max(0, i))];
    const NRM = new Array(P.length);
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        _u.subVectors(at(i + 1, j), at(i - 1, j));
        _w.subVectors(at(i, j + 1), at(i, j - 1));
        // 한 줄이 한 점으로 모이면(꼭짓점) 이웃 줄의 가로 방향을 씀
        if (_u.lengthSq() < 1e-12) {
          const jj = j > 0 ? j - 1 : j + 1;
          _u.subVectors(at(i + 1, jj), at(i - 1, jj));
        }
        const n = new THREE.Vector3().crossVectors(_u, _w);
        if (n.lengthSq() < 1e-16) n.set(0, 1, 0);
        n.normalize();
        if (!expect(n)) n.negate();
        NRM[j * (nu + 1) + i] = n;
      }
    }
    const base = bk.nv;
    for (let k = 0; k < P.length; k++) this.pushV(bk, P[k], NRM[k], UV[k][0], UV[k][1], col);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        // 칸마다 기하 법선과 정점 법선을 비교해 감김 결정
        _u.subVectors(P[d], P[a]); _w.subVectors(P[c], P[b]);
        _n.crossVectors(_u, _w);
        if (_n.lengthSq() < 1e-14) { _u.subVectors(P[b], P[a]); _w.subVectors(P[c], P[a]); _n.crossVectors(_u, _w); }
        _q.copy(NRM[a]).add(NRM[d]);
        if (_n.dot(_q) >= 0) bk.idx.push(base + a, base + b, base + d, base + a, base + d, base + c);
        else bk.idx.push(base + a, base + d, base + b, base + a, base + c, base + d);
      }
    }
  }

  // 단면(prof: [[u, v], ...], u = 옆, v = 위)을 경로(pts)를 따라 쓸어 만든 관. 마루·추녀·박공널.
  //   cols: 단면 선분마다 색(없으면 o.col), o.up: 단면 위 방향(기본 세계 위), o.capStart/o.capEnd
  sweep(key, pts, prof, cols, o = {}) {
    const bk = this.get(key);
    const n = pts.length;
    if (n < 2) return;
    const W = pts.map((p) => this.tp(p.x, p.y, p.z, new THREE.Vector3()));
    const sides = [], ups = [], tans = [];
    const up0 = o.up || Y_UP;
    for (let i = 0; i < n; i++) {
      const t = new THREE.Vector3().subVectors(W[Math.min(n - 1, i + 1)], W[Math.max(0, i - 1)]).normalize();
      let side = new THREE.Vector3().crossVectors(t, up0);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize();
      const up = o.perp ? new THREE.Vector3().crossVectors(side, t).normalize() : up0.clone();
      sides.push(side); ups.push(up); tans.push(t);
    }
    // 단면 중심 (법선 바깥 판정용)
    let cu = 0, cv = 0;
    for (const [u, v] of prof) { cu += u; cv += v; }
    cu /= prof.length; cv /= prof.length;
    const L = [0];
    for (let i = 1; i < n; i++) L.push(L[i - 1] + W[i].distanceTo(W[i - 1]));
    for (let k = 0; k < prof.length - 1; k++) {
      const [u0, v0] = prof[k], [u1, v1] = prof[k + 1];
      const du = u1 - u0, dv = v1 - v0;
      const sl = Math.hypot(du, dv);
      if (sl < 1e-9) continue;
      let nu2 = dv / sl, nv2 = -du / sl;
      const mu = (u0 + u1) / 2 - cu, mv = (v0 + v1) / 2 - cv;
      if (nu2 * mu + nv2 * mv < 0) { nu2 = -nu2; nv2 = -nv2; }
      const col = (cols && cols[k]) || o.col;
      const base = bk.nv;
      for (let i = 0; i < n; i++) {
        const s = sides[i], u = ups[i], m = o.scale ? o.scale[i] : 1;
        for (const [pu, pv] of [[u0, v0], [u1, v1]]) {
          _A.set(W[i].x + (s.x * pu + u.x * pv) * m, W[i].y + (s.y * pu + u.y * pv) * m, W[i].z + (s.z * pu + u.z * pv) * m);
          _n.set(s.x * nu2 + u.x * nv2, s.y * nu2 + u.y * nv2, s.z * nu2 + u.z * nv2).normalize();
          this.pushV(bk, _A, _n, L[i] / (o.uvLen || 1), pu === u0 && pv === v0 ? 0 : 1, col);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        // 감김: 기하 법선과 정점 법선 비교
        _u.set(bk.p[c * 3] - bk.p[a * 3], bk.p[c * 3 + 1] - bk.p[a * 3 + 1], bk.p[c * 3 + 2] - bk.p[a * 3 + 2]);
        _w.set(bk.p[b * 3] - bk.p[a * 3], bk.p[b * 3 + 1] - bk.p[a * 3 + 1], bk.p[b * 3 + 2] - bk.p[a * 3 + 2]);
        _q.crossVectors(_u, _w);
        _n.set(bk.n[a * 3], bk.n[a * 3 + 1], bk.n[a * 3 + 2]);
        if (_q.dot(_n) >= 0) bk.idx.push(a, c, b, b, c, d); else bk.idx.push(a, b, c, b, d, c);
      }
    }
    // 마구리
    const cap = (i, sign, col) => {
      const k = o.scale ? o.scale[i] : 1;
      const s = sides[i].clone().multiplyScalar(k), u = ups[i].clone().multiplyScalar(k);
      const Nn = tans[i].clone().multiplyScalar(sign);
      const c0 = this.pushV(bk, _A.set(W[i].x + s.x * cu + u.x * cv, W[i].y + s.y * cu + u.y * cv, W[i].z + s.z * cu + u.z * cv), Nn, 0.5, 0.5, col);
      const first = bk.nv;
      for (const [pu, pv] of prof) {
        _A.set(W[i].x + s.x * pu + u.x * pv, W[i].y + s.y * pu + u.y * pv, W[i].z + s.z * pu + u.z * pv);
        this.pushV(bk, _A, Nn, 0.5, 0.5, col);
      }
      for (let k = 0; k < prof.length - 1; k++) {
        const a = first + k, b = a + 1;
        _u.set(bk.p[a * 3] - bk.p[c0 * 3], bk.p[a * 3 + 1] - bk.p[c0 * 3 + 1], bk.p[a * 3 + 2] - bk.p[c0 * 3 + 2]);
        _w.set(bk.p[b * 3] - bk.p[c0 * 3], bk.p[b * 3 + 1] - bk.p[c0 * 3 + 1], bk.p[b * 3 + 2] - bk.p[c0 * 3 + 2]);
        _q.crossVectors(_u, _w);
        if (_q.dot(Nn) >= 0) bk.idx.push(c0, a, b); else bk.idx.push(c0, b, a);
      }
    };
    if (o.capStart) cap(0, -1, o.capCol || o.col || (cols && cols[0]));
    if (o.capEnd) cap(n - 1, 1, o.capCol || o.col || (cols && cols[0]));
  }

  // 공포 팔(첨차·살미·익공): 로컬 x 를 따라 놓인 단면 목록 st = [[x, yBottom, yTop], ...], 두께 w (z = ±w/2)
  //   o.side(옆면), o.under(밑면: 황단), o.top(윗면), o.band(옆면 아래 백분 선 높이), o.bandCol
  arm(key, st, w, o) {
    const hw = w / 2;
    const n = st.length;
    for (let i = 0; i < n - 1; i++) {
      const [x0, b0, t0] = st[i], [x1, b1, t1] = st[i + 1];
      for (const z of [hw, -hw]) {
        const ex = [0, 0, Math.sign(z)];
        if (o.band) {
          const m0 = Math.min(t0, b0 + o.band), m1 = Math.min(t1, b1 + o.band);
          this.quad(key, [x0, b0, z], [x1, b1, z], [x1, m1, z], [x0, m0, z], o.bandCol, UV01, ex);
          this.quad(key, [x0, m0, z], [x1, m1, z], [x1, t1, z], [x0, t0, z], o.side, UV01, ex);
        } else {
          this.quad(key, [x0, b0, z], [x1, b1, z], [x1, t1, z], [x0, t0, z], o.side, UV01, ex);
        }
      }
    }
    // 밑면 / 윗면: 같은 높이로 이어지는 구간은 한 면으로 합침
    const run = (idx) => {
      let i = 0;
      while (i < n - 1) {
        let j = i + 1;
        const flat = (k) => Math.abs(st[k][idx] - st[i][idx]) < 1e-6;
        if (flat(j)) while (j + 1 < n && flat(j + 1)) j++;
        const [x0, b0, t0] = st[i], [x1, b1, t1] = st[j];
        const dx = x1 - x0;
        if (idx === 1) this.quad(key, [x0, b0, -hw], [x1, b1, -hw], [x1, b1, hw], [x0, b0, hw], o.under, UV01, [(b1 - b0), -dx, 0]);
        else this.quad(key, [x0, t0, hw], [x1, t1, hw], [x1, t1, -hw], [x0, t0, -hw], o.top || o.side, UV01, [-(t1 - t0), dx, 0]);
        i = j;
      }
    };
    run(1); run(2);
    const [xa, ba, ta] = st[0], [xb, bb, tb] = st[n - 1];
    if (ta - ba > 1e-4) this.quad(key, [xa, ba, -hw], [xa, ba, hw], [xa, ta, hw], [xa, ta, -hw], o.side, UV01, [-1, 0, 0]);
    if (tb - bb > 1e-4) this.quad(key, [xb, bb, hw], [xb, bb, -hw], [xb, tb, -hw], [xb, tb, hw], o.side, UV01, [1, 0, 0]);
  }

  // 두 점 사이 각재(단면 w × h, 단면 위쪽은 수직면 안에서 부재에 수직)
  beam(key, A, B, w, h, col, o = {}) {
    const prof = o.open
      ? [[-w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2]]
      : [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
    const cols = o.under ? (o.open ? [col, o.under, col] : [o.under, col, col, col]) : null;
    this.sweep(key, [A, B], prof, cols, { col, perp: true, capStart: o.capStart, capEnd: o.capEnd });
  }

  triangles() {
    let n = 0;
    for (const b of this.buckets.values()) n += b.idx.length / 3;
    return n;
  }

  // 버킷 → 메시 묶음. matFor(key) 가 재질을 돌려줌
  build(name, matFor, pickId) {
    const g = new THREE.Group();
    g.name = name;
    for (const [key, b] of this.buckets) {
      if (!b.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if (b.c) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      geo.setIndex(b.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, matFor(key));
      mesh.name = `${name}:${key}`;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.pickId = pickId;
      mesh.userData.matKey = key;
      g.add(mesh);
    }
    return g;
  }
}
