// 한국 전통 지붕 생성기 — 팔작(hip-gable) · 우진각(hip) · 맞배(gable)
//
// 지붕은 처마 선(평면 직사각형, 반폭 a × 반깊이 b)에서 안쪽으로 들어간 거리 t 의 함수로 높이를 정합니다.
//   y = H · f(t / b),  f(u) = u^p   (p > 1 → 처마 쪽은 완만하고 용마루 쪽은 가파른 오목한 물매)
// 여기에 한국 지붕 특유의 곡선을 더합니다.
//   · 앙곡(仰曲): 모서리(추녀) 쪽으로 갈수록 처마가 들려 올라감
//   · 안허리: 평면에서 모서리 쪽 처마가 바깥으로 뻗어 나감
// 두 곡선은 “모서리에서 처마를 따라 잰 거리 d” 와 “처마에서 안으로 들어간 거리 t” 로만 계산하므로
// 추녀마루(hip)를 사이에 둔 두 면이 정확히 이어집니다.
//
// 좌표: 지붕 중심이 원점, 처마 끝(모서리 제외)의 높이가 y = 0, 정면은 +z.
import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class RoofShape {
  constructor(o) {
    this.type = o.type || 'hip-gable';     // 'hip-gable' | 'hip' | 'gable'
    this.a = o.halfWidth;                  // 처마 반폭 (x)
    this.b = o.halfDepth;                  // 처마 반깊이 (z)
    this.H = o.height;                     // 처마 끝 → 용마루 높이
    this.p = o.concavity ?? 1.22;          // 물매 오목함
    this.lift = o.cornerLift ?? 0.085 * o.halfDepth;       // 앙곡: 모서리 들림 (m)
    this.flare = o.cornerFlare ?? 0.075 * o.halfDepth;     // 안허리: 모서리 뻗침 (m)
    this.sweep = o.sweepLength ?? Math.min(this.a, this.b) * 0.9; // 곡선이 미치는 처마 길이
    this.gableInset = o.gableInset ?? 0.6; // 팔작: 합각 위치 (b 에 대한 비율)
    const b = this.b;
    // 끝면(측면 지붕)이 올라가는 깊이 e
    this.e = this.type === 'hip' ? b : this.type === 'gable' ? 0 : Math.min(b * this.gableInset, this.a - 0.5);
    if (this.type === 'hip' && this.a < b) this.e = this.a;
  }

  f(u) { return Math.pow(clamp01(u), this.p); }

  // 모서리 효과 가중치 (d: 모서리에서 처마를 따라 잰 거리, t: 처마에서 안쪽 거리)
  cornerWeight(d, t) {
    const wd = clamp01(1 - d / this.sweep);
    const wt = clamp01(1 - t / (this.b * 0.85));
    return wd * wd * wt * wt;
  }

  // 면 위의 점: face = 'long' (±z 면) | 'end' (±x 면). s = 처마 방향 좌표(m), t = 안쪽 거리(m)
  point(face, sx, sz, s, t, target = new THREE.Vector3()) {
    const { a, b, H } = this;
    let x, z, d;
    if (face === 'long') {
      x = s; z = sz * (b - t);
      d = this.type === 'gable' ? Infinity : a - Math.abs(s);
    } else {
      z = s; x = sx * (a - t);
      d = b - Math.abs(s);
    }
    const w = this.type === 'gable' ? 0 : this.cornerWeight(d, t);
    const y = H * this.f(t / b) + this.lift * w;
    // 안허리: 모서리 쪽으로 대각선 방향으로 뻗음
    const fl = this.flare * w * Math.SQRT1_2;
    const signX = face === 'long' ? Math.sign(s) || 1 : sx;
    const signZ = face === 'long' ? sz : Math.sign(s) || 1;
    return target.set(x + signX * fl, y, z + signZ * fl);
  }

  // 긴 면에서 높이 t 에서의 처마 방향 범위(절반)
  longHalfSpan(t) {
    const { a } = this;
    if (this.type === 'gable') return a;
    if (this.type === 'hip') return Math.max(0, a - t);
    return t <= this.e ? a - t : a - this.e;
  }

  get ridgeHalf() { // 용마루 반길이
    if (this.type === 'gable') return this.a;
    return this.a - this.e;
  }

  get ridgeY() { return this.H; }
}

// 파라메트릭 격자 → BufferGeometry (UV 는 미터 단위 / tile)
function gridGeometry(nu, nv, fn, { tile = 1.2, flip = false } = {}) {
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const r = fn(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      uv.push(r.u / tile, r.v / tile);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const A = j * (nu + 1) + i, B = A + 1, C = A + nu + 1, D = C + 1;
      if (flip) idx.push(A, C, B, B, C, D); else idx.push(A, B, C, B, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 지붕 기와면(윗면) + 처마 밑면 + 처마 두께면 + 합각/박공
export function buildRoofSurfaces(shape, { thickness = 0.45, segU = 28, segV = 14 } = {}) {
  const top = [], under = [], edge = [], gable = [];
  const { b } = shape;
  const tmp = new THREE.Vector3();

  // 긴 면 (앞 +z, 뒤 -z)
  for (const sz of [1, -1]) {
    const tMax = b;
    const mk = (drop) => gridGeometry(segU, segV, (i, j, p) => {
      const t = tMax * j;
      const half = shape.longHalfSpan(t);
      const s = (i * 2 - 1) * half;
      shape.point('long', 0, sz, s, t, p);
      p.y -= drop;
      return { u: s, v: slopeLen(shape, t) };
    }, { flip: (sz < 0) !== (drop > 0) });
    top.push(mk(0));
    under.push(mk(thickness));
    // 처마 끝 두께면
    edge.push(stripGeometry(segU * 2, (i, p) => {
      const half = shape.longHalfSpan(0);
      shape.point('long', 0, sz, (i * 2 - 1) * half, 0, p);
    }, thickness, sz < 0));
  }
  // 끝면 (±x)
  if (shape.type !== 'gable') {
    for (const sx of [1, -1]) {
      const tMax = shape.e;
      const mk = (drop) => gridGeometry(segU, Math.max(4, Math.round(segV * tMax / b)), (i, j, p) => {
        const t = tMax * j;
        const half = Math.max(0, b - t);
        const s = (i * 2 - 1) * half;
        shape.point('end', sx, 0, s, t, p);
        p.y -= drop;
        return { u: s, v: slopeLen(shape, t) };
      }, { flip: (sx > 0) !== (drop > 0) });
      top.push(mk(0));
      under.push(mk(thickness));
      edge.push(stripGeometry(segU * 2, (i, p) => {
        shape.point('end', sx, 0, (i * 2 - 1) * b, 0, p);
      }, thickness, sx > 0));
    }
  }
  // 합각벽(팔작) / 박공(맞배): 수직면 x = ±xg, 아래 y0 에서 지붕면까지
  if (shape.type === 'hip-gable' || shape.type === 'gable') {
    const xg = shape.type === 'gable' ? shape.a : shape.a - shape.e;
    const tBase = shape.type === 'gable' ? 0 : shape.e;
    for (const sx of [1, -1]) {
      const n = 24;
      const pos = [];
      const zHalf = b - tBase;
      const yBase = shape.H * shape.f(tBase / b) - (shape.type === 'gable' ? thickness : 0.05);
      for (let i = 0; i < n; i++) {
        const z0 = -zHalf + (2 * zHalf * i) / n, z1 = -zHalf + (2 * zHalf * (i + 1)) / n;
        const y0 = shape.H * shape.f((b - Math.abs(z0)) / b) - 0.02;
        const y1 = shape.H * shape.f((b - Math.abs(z1)) / b) - 0.02;
        const X = sx * (xg - (shape.type === 'gable' ? 0 : 0.25));
        // 사다리꼴 두 삼각형
        const quad = [[X, yBase, z0], [X, yBase, z1], [X, y1, z1], [X, y0, z0]];
        const tri = sx > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const k of tri) pos.push(...quad[k]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const uvs = [];
      for (let k = 0; k < pos.length; k += 3) uvs.push(pos[k + 2] / 4 + 0.5, (pos[k + 1] - yBase) / 4);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      gable.push(g);
    }
  }
  return { top, under, edge, gable };
}

function slopeLen(shape, t) {
  // 처마에서 t 까지 물매를 따라 잰 길이 (근사)
  const n = 8;
  let L = 0, py = 0, pt = 0;
  for (let k = 1; k <= n; k++) {
    const tt = (t * k) / n;
    const y = shape.H * shape.f(tt / shape.b);
    L += Math.hypot(tt - pt, y - py);
    pt = tt; py = y;
  }
  return L;
}

// 처마 끝을 따라가는 세로 띠 (두께면)
function stripGeometry(n, fn, h, flip) {
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  let L = 0;
  const prev = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    fn(i / n, p);
    if (i > 0) L += p.distanceTo(prev);
    prev.copy(p);
    pos.push(p.x, p.y, p.z, p.x, p.y - h, p.z);
    uv.push(L, 1, L, 0);
  }
  for (let i = 0; i < n; i++) {
    const A = i * 2, B = A + 1, C = A + 2, D = A + 3;
    if (flip) idx.push(A, C, B, B, C, D); else idx.push(A, B, C, B, D, C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 마루(용마루·추녀마루·내림마루): 곡선을 따라가는 각진 관
export function ridgeTube(points, width, height) {
  const curve = new THREE.CatmullRomCurve3(points);
  const shape = new THREE.Shape();
  const w = width / 2;
  shape.moveTo(-w, -height * 0.4);
  shape.lineTo(w, -height * 0.4);
  shape.lineTo(w * 0.8, height * 0.45);
  shape.quadraticCurveTo(0, height * 0.7, -w * 0.8, height * 0.45);
  shape.lineTo(-w, -height * 0.4);
  const g = new THREE.ExtrudeGeometry(shape, { steps: Math.max(4, points.length * 3), bevelEnabled: false, extrudePath: curve });
  return g;
}

// 추녀마루/내림마루가 따라갈 선들 (지붕면 위 점열)
export function ridgeLines(shape) {
  const lines = [];
  const { a, b, H } = shape;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const rh = shape.ridgeHalf;
  // 용마루
  lines.push({ kind: 'main', pts: [v(-rh - 0.3, H, 0), v(0, H, 0), v(rh + 0.3, H, 0)] });
  if (shape.type === 'gable') return lines;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const pts = [];
      const n = 10;
      // 추녀마루: 모서리(t=0) → 합각 아래(t=e) (우진각이면 용마루 끝까지)
      for (let k = 0; k <= n; k++) {
        const t = (shape.e * k) / n;
        const p = shape.point('long', 0, sz, sx * shape.longHalfSpan(t), t);
        pts.push(p);
      }
      lines.push({ kind: 'hip', pts: pts.reverse() });
      if (shape.type === 'hip-gable') {
        // 내림마루: 합각 위(용마루 끝) → 추녀마루 시작점
        const xg = a - shape.e;
        const q = [];
        for (let k = 0; k <= 8; k++) {
          const t = shape.e + ((b - shape.e) * (8 - k)) / 8;
          q.push(new THREE.Vector3(sx * xg, H * shape.f(t / b), sz * (b - t)));
        }
        lines.push({ kind: 'rake', pts: q });
      }
    }
  }
  return lines;
}
