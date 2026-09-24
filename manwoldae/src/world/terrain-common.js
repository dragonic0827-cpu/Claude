// 지형·식생 공용 도구 — 결정적 노이즈, 다각형 판정, 숲 밀도
// (terrain.js / vegetation.js 가 함께 씁니다. Math.random 은 쓰지 않습니다.)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// 정수 격자 해시 → [0,1)
export function hash2(ix, iz, seed = 0) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 2D 그래디언트 노이즈 (−1..1 근처). 순열표(1024)로 격자 해시 → 빠름
const PN = 1024, PM = PN - 1;
const PERM = new Uint16Array(PN * 2);
const GR = new Float32Array(PN * 2);
{
  for (let i = 0; i < PN; i++) PERM[i] = i;
  for (let i = PN - 1; i > 0; i--) {
    const j = Math.floor(hash2(i, 3, 77) * (i + 1));
    const t = PERM[i]; PERM[i] = PERM[j]; PERM[j] = t;
  }
  for (let i = 0; i < PN; i++) {
    PERM[i + PN] = PERM[i];
    const a = hash2(i, 7, 91) * Math.PI * 2;
    GR[i * 2] = Math.cos(a); GR[i * 2 + 1] = Math.sin(a);
  }
}
function grad(i, j, dx, dz) {
  const k = PERM[(PERM[i & PM] + j) & PM] * 2;
  return GR[k] * dx + GR[k + 1] * dz;
}
export function noise2(x, z, seed = 0) {
  x += seed * 57.31; z += seed * 131.7;
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = grad(ix, iz, fx, fz), b = grad(ix + 1, iz, fx - 1, fz);
  const c = grad(ix, iz + 1, fx, fz - 1), d = grad(ix + 1, iz + 1, fx - 1, fz - 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 1.41;
}

// 주기 p 로 이어지는 그래디언트 노이즈(텍스처용, 이음매 없음)
export function noise2p(x, z, p, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const so = seed * 131;
  let i0 = ix % p; if (i0 < 0) i0 += p;
  let j0 = iz % p; if (j0 < 0) j0 += p;
  const i1 = i0 + 1 === p ? 0 : i0 + 1, j1 = j0 + 1 === p ? 0 : j0 + 1;
  const a = grad(i0 + so, j0, fx, fz), b = grad(i1 + so, j0, fx - 1, fz);
  const c = grad(i0 + so, j1, fx, fz - 1), d = grad(i1 + so, j1, fx - 1, fz - 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 1.41;
}

export function fbm(x, z, octaves = 4, seed = 0) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += noise2(x * f, z * f, seed + o * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

// 점-다각형 포함 (pts: [[x,z],...], 닫힘 가정)
export function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// 선분까지 거리와 매개변수
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return { d: Math.sqrt(qx * qx + qz * qz), t };
}

// 다각형 경로까지 최소 거리
export function polylineDist(px, pz, pts, closed = false) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const { d } = segDist(px, pz, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

// 궁성(palace) 다각형 — spec.walls 의 kind='palace' 경로를 닫아 씁니다.
export function palacePolygon(spec) {
  const w = (spec.walls || []).find((v) => v.kind === 'palace') || (spec.walls || []).find((v) => v.id === 'gungseong');
  return w && w.path && w.path.length >= 3 ? w.path.map((p) => [p[0], p[1]]) : null;
}

// 축 정렬 사각형 (대지·계단 발자국)
export function terraceRect(t) {
  const r = (((t.rotationDeg || 0) % 180) + 180) % 180;
  const swap = Math.abs(r - 90) < 1;
  const w = swap ? t.d : t.w, d = swap ? t.w : t.d;
  return { x0: t.cx - w / 2, x1: t.cx + w / 2, z0: t.cz - d / 2, z1: t.cz + d / 2 };
}
export function stairRect(s) {
  const r = (((s.rotationDeg || 0) % 180) + 180) % 180;
  const swap = Math.abs(r - 90) < 1;
  const w = swap ? s.run : s.width, d = swap ? s.width : s.run;
  return { x0: s.cx - w / 2, x1: s.cx + w / 2, z0: s.cz - d / 2, z1: s.cz + d / 2 };
}
export const rectDist = (r, x, z) => {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.sqrt(dx * dx + dz * dz);
};

// 숲 밀도 0..1 — 지형 색(숲 바닥)과 나무 배치가 같은 규칙을 씁니다.
// h: 지형 y, slope: 1 − normal.y
export function forestDensity(x, z, h, slope) {
  const hill = smoothstep(10, 36, h);                       // 해발 약 70–95 m 부터 산기슭 숲
  const steep = smoothstep(0.05, 0.14, slope) * smoothstep(-2, 12, h);
  let d = Math.max(hill, steep * 0.85);
  // 해발 350 m(y≈292) 위는 성긴 소나무 + 암릉
  d *= 1 - 0.62 * smoothstep(275, 335, h);
  // 숲 가장자리를 들쭉날쭉하게
  const n = noise2(x / 260, z / 260, 5) * 0.55 + noise2(x / 85, z / 85, 6) * 0.3;
  d *= smoothstep(-0.55, 0.15, n + 0.2);
  return clamp(d, 0, 1);
}
