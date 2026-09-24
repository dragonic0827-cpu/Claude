// 지형 — 송악산·구릉·하천·연못과 대지(축대)
//
// createTerrain(spec, mats, { yieldFrame }?) → (yieldFrame 이 있으면 Promise) { group, heightAt, groundAt, naturalAt, isOnTerrace, setPaving, setRuins, info }
//   heightAt(x,z)   걸을 수 있는 면: 대지 윗면 > 계단 경사 > 다리 상판 > 렌더된 지형
//   groundAt(x,z)   렌더된 지형 메시와 같은 보간(대지 무시, 궁성 안 물길은 바닥)
//   naturalAt(x,z)  평탄화 전 원지형(DEM + 세부 기복)
//   isOnTerrace(x,z)
//
// 지형 메시는 4단 격자(2 m / 4 m / 20 m / 200 m)이고, 고운 단의 바깥 띠를 거친 단의 보간면에 맞춰
// 틈 없이 잇습니다. 대지 발자국과 궁성 안 석축 물길은 삼각형을 정확히 잘라내고(볼록 다각형 빼기),
// 그 자리에 축대 벽·갑석·호안을 세웁니다 → 벽 아래 흙 조각(sliver)이나 z-fighting 이 생기지 않습니다.
import * as THREE from 'three';
import { rng } from '../core/textures.js';
import { createHeightModel } from './terrain-height.js';
import { clamp, lerp, smoothstep, noise2, noise2p, pointInPolygon, forestDensity, rectDist } from './terrain-common.js';

const LEVELS = [
  { x0: -180, x1: 200, z0: -340, z1: 320, cell: 2, minL: 0, band: 16, clip: true },
  { x0: -400, x1: 440, z0: -560, z1: 560, cell: 4, minL: 8, band: 40, clip: true },
  { x0: -1600, x1: 1600, z0: -2600, z1: 1000, cell: 20, minL: 45, band: 200, clip: false },
  { x0: -9600, x1: 9600, z0: -9600, z1: 9600, cell: 200, minL: 420, band: 0, clip: false },
];
const CAP_H = 0.32;      // 갑석 높이
const CAP_IN = 0.45;     // 갑석 윗면이 대지 안쪽으로 들어오는 폭
const CAP_OUT = 0.08;    // 갑석 내민 폭

const cache = new WeakMap();

// ─────────────────────────── 재질 ───────────────────────────
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// 지면 세부 무늬(회색 명암, 채널별로 다른 무늬): r 흙 얼룩, g 큰 얼룩, b 잔 알갱이·풀잎
function detailTexture() {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const R = rng(4242);
  const tile = (f, x, y, seed) => noise2p((x / S) * f, (y / S) * f, f, seed); // 이음매 없는 반복 노이즈
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = tile(6, x, y, 101) * 0.6 + tile(18, x, y, 102) * 0.3 + tile(48, x, y, 103) * 0.18;
      const b = tile(3, x, y, 104) * 0.7 + tile(9, x, y, 105) * 0.3;
      const k = (y * S + x) * 4;
      img.data[k] = clamp(128 + a * 150, 0, 255);
      img.data[k + 1] = clamp(128 + b * 140, 0, 255);
      img.data[k + 2] = 128 + (R() - 0.5) * 70;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 풀잎·잔돌 (b 채널에 섞이도록 가볍게)
  for (let i = 0; i < 14000; i++) {
    const x = R() * S, y = R() * S, l = 1 + R() * 3.5;
    const v = R() < 0.5 ? 70 : 190;
    ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (R() - 0.5) * 2, y - l); ctx.stroke();
  }
  return canvasTex(c, false);
}

function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  const detail = detailTexture();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aField;\nvarying float vField;\nvarying vec3 vTWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvField = aField;\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail;
varying float vField;
varying vec3 vTWorld;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vTWorld.xz;
  float dist = length(vTWorld - cameraPosition);
  float d1 = texture2D(uDetail, p / 9.0).r;
  float d2 = texture2D(uDetail, p / 71.0 + 0.37).g;
  float d3 = texture2D(uDetail, p / 1.7).b;
  float nearA = 1.0 - smoothstep(60.0, 420.0, dist);
  float nearB = 1.0 - smoothstep(5.0, 45.0, dist);
  float k = mix(1.0, 0.74 + 0.52 * d1, nearA) * (0.86 + 0.28 * d2) * mix(1.0, 0.78 + 0.44 * d3, nearB);
  diffuseColor.rgb *= k;
  if (vField > 0.01) {
    // 경지: 진북(PLAN 에서 17°) 에 맞춘 논밭 구획
    vec2 q = vec2(0.9563 * p.x + 0.2924 * p.y, -0.2924 * p.x + 0.9563 * p.y);
    vec2 cs = vec2(64.0, 38.0);
    vec2 id = floor(q / cs);
    vec2 f = fract(q / cs);
    float h = tHash(id);
    vec3 tint = h < 0.3 ? vec3(1.12, 1.04, 0.78) : (h < 0.62 ? vec3(0.88, 1.0, 0.8) : vec3(1.06, 0.88, 0.72));
    vec2 e = min(f, 1.0 - f) * cs;
    float ridge = 1.0 - smoothstep(0.5, 1.6, min(e.x, e.y));
    float furrow = 0.93 + 0.07 * sin(q.x * (h > 0.5 ? 2.4 : 1.7));
    vec3 fc = diffuseColor.rgb * tint * furrow * (1.0 - 0.2 * ridge);
    diffuseColor.rgb = mix(diffuseColor.rgb, fc, vField * step(0.15, fract(h * 7.31)));
  }
}`);
  };
  m.customProgramCacheKey = () => 'manwoldae-terrain-1';
  return m;
}

// 물: 잔물결 노멀맵 + 하늘빛 반사(프레넬). 하늘색은 장면의 안개/배경색을 따라갑니다.
function waterNormalTexture() {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [f, a, sd] of [[4, 1, 201], [9, 0.5, 202], [19, 0.25, 203]]) v += a * noise2p((x / S) * f, (y / S) * f, f, sd);
      hgt[y * S + x] = v;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const n = new THREE.Vector3(-hx * 3, -hy * 3, 1).normalize();
      const k = (y * S + x) * 4;
      img.data[k] = (n.x * 0.5 + 0.5) * 255;
      img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTex(c, false);
}
function waterMaterial(P) {
  const m = new THREE.MeshStandardMaterial({
    color: P.water, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.82,
    normalMap: waterNormalTexture(), normalScale: new THREE.Vector2(0.3, 0.3),
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  const sky = { value: new THREE.Color('#a9c3d6') };
  m.userData.sky = sky.value;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSky = sky;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSky;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 Vw = normalize(vViewPosition);
  float fr = pow(1.0 - clamp(abs(dot(normal, Vw)), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += uSky * (0.03 + 0.3 * fr);
}`);
  };
  m.customProgramCacheKey = () => 'manwoldae-water-1';
  return m;
}

// 다진 흙 마당 (UV 1 = 8 m). 공유 packedEarth 무늬가 가까이서 너무 어두워 따로 만듭니다.
function packedEarthTexture(base) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const b = new THREE.Color(base);
  const R = rng(2323);
  const tile = (f, x, y, seed) => noise2p((x / S) * f, (y / S) * f, f, seed);
  // sRGB 값으로 직접 칠합니다
  const br = Math.pow(b.r, 1 / 2.2) * 255, bg = Math.pow(b.g, 1 / 2.2) * 255, bb = Math.pow(b.b, 1 / 2.2) * 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k0 = tile(3, x, y, 301) * 0.07 + tile(11, x, y, 302) * 0.05 + tile(40, x, y, 303) * 0.035;
      const k = 1 + k0 + (R() - 0.5) * 0.07;
      const warm = tile(5, x, y, 304) * 0.04;
      const o = (y * S + x) * 4;
      img.data[o] = clamp(br * (k + warm), 0, 255);
      img.data[o + 1] = clamp(bg * k, 0, 255);
      img.data[o + 2] = clamp(bb * (k - warm), 0, 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 잔돌
  for (let i = 0; i < 2600; i++) {
    const x = R() * S, y = R() * S, r = 0.6 + R() * 1.6;
    const v = R() < 0.6 ? 235 : 80;
    ctx.fillStyle = `rgba(${v},${v - 8},${v - 20},${0.18 + R() * 0.22})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return canvasTex(c);
}

// 전돌(方塼) 바닥 — 회경전 뜰 전돌 토글용 (UV 1 = 2.4 m, 전돌 8×8)
function brickPavingTexture(base) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const R = rng(777);
  const col = new THREE.Color(base);
  ctx.fillStyle = '#' + col.clone().multiplyScalar(0.6).getHexString();
  ctx.fillRect(0, 0, S, S);
  const n = 8, t = S / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = 0.86 + R() * 0.26;
      const cc = col.clone().multiplyScalar(k);
      ctx.fillStyle = '#' + cc.getHexString();
      ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      for (let q = 0; q < 60; q++) {
        ctx.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.08})`;
        ctx.fillRect(i * t + 2 + R() * (t - 6), j * t + 2 + R() * (t - 6), 2, 2);
      }
    }
  }
  return canvasTex(c);
}

function getMaterials(mats) {
  let M = cache.get(mats);
  if (M) return M;
  const P = mats.palette || {};
  const topClone = (src) => {
    const m = src.clone();
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
    return m;
  };
  M = {
    terrain: terrainMaterial(),
    water: waterMaterial(P),
    topStone: topClone(mats.courtyard),
    topEarth: topClone(new THREE.MeshStandardMaterial({ map: packedEarthTexture(P.packedEarth || '#A68B69'), roughness: 1 })),
    topBrick: topClone(new THREE.MeshStandardMaterial({ map: brickPavingTexture(P.brickGray || '#6F6D69'), roughness: 0.9 })),
    // 유적 보기: 오늘의 만월대처럼 풀이 덮인 대지 윗면 (약간 누렇고 어둡게)
    topGrass: (() => { const m = topClone(mats.grass); m.color = new THREE.Color(0.9, 0.9, 0.82); return m; })(),
    rock: mats.outcrop.clone(),   // 괴석: 반쯤 부드러운 법선 (rockGeometry)
  };
  cache.set(mats, M);
  return M;
}

// ─────────────────────────── 기하 도우미 ───────────────────────────
// 비색인 삼각형 묶음 (위치·법선·UV)
class Tris {
  constructor() { this.p = []; this.n = []; this.u = []; }
  tri(a, b, c, na, nb, nc, ua, ub, uc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  // 네 점 사각형. n 방향이 앞면이 되도록 감는 순서를 고칩니다.
  quad(a, b, c, d, n, ua = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) {
      this.tri(a, b, c, n, n, n, ua, ub, uc); this.tri(a, c, d, n, n, n, ua, uc, ud);
    } else {
      this.tri(a, c, b, n, n, n, ua, uc, ub); this.tri(a, d, c, n, n, n, ua, ud, uc);
    }
  }
  get count() { return this.p.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// 볼록 다각형 (x,z) → 반평면 목록 (바깥쪽이 +)
function convexShape(pts) {
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  const planes = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    let nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const L = Math.hypot(nx, nz) || 1;
    nx /= L; nz /= L;
    if (nx * (cx - a[0]) + nz * (cz - a[1]) > 0) { nx = -nx; nz = -nz; }
    planes.push([nx, nz, nx * a[0] + nz * a[1]]);
    x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); z0 = Math.min(z0, a[1]); z1 = Math.max(z1, a[1]);
  }
  return { planes, x0, x1, z0, z1 };
}
const insideShape = (S, x, z, eps = 1e-6) => S.planes.every(([nx, nz, c]) => nx * x + nz * z - c <= eps);

function splitPoly(poly, nx, nz, c) {
  const out = [], ins = [];
  const n = poly.length;
  for (let k = 0; k < n; k++) {
    const P = poly[k], Q = poly[(k + 1) % n];
    let fp = nx * P[0] + nz * P[1] - c, fq = nx * Q[0] + nz * Q[1] - c;
    if (Math.abs(fp) < 1e-9) fp = 0;
    if (Math.abs(fq) < 1e-9) fq = 0;
    if (fp >= 0) out.push(P);
    if (fp <= 0) ins.push(P);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
      const t = fp / (fp - fq);
      const X = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
      out.push(X); ins.push(X);
    }
  }
  return [out, ins];
}
const polyArea = (p) => {
  let a = 0;
  for (let k = 0; k < p.length; k++) {
    const A = p[k], B = p[(k + 1) % p.length];
    a += A[0] * B[1] - B[0] * A[1];
  }
  return Math.abs(a) * 0.5;
};
function subtractShape(poly, S) {
  const res = [];
  let rest = poly;
  for (const [nx, nz, c] of S.planes) {
    const [o, i] = splitPoly(rest, nx, nz, c);
    if (o.length >= 3 && polyArea(o) > 1e-7) res.push(o);
    rest = i;
    if (rest.length < 3 || polyArea(rest) <= 1e-7) return res;
  }
  return res;
}

// ─────────────────────────── 본체 ───────────────────────────
export function createTerrain(spec, mats, opts = {}) {
  const it = terrainStages(spec, mats);
  if (typeof opts.yieldFrame !== 'function') {
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  // opts.yieldFrame 이 있으면 단계마다 한 프레임 양보해 불러오기 화면이 멈추지 않게 함 (Promise 를 돌려줌 — main.js 는 await)
  return (async () => {
    let r = it.next();
    while (!r.done) { await opts.yieldFrame(); r = it.next(); }
    return r.value;
  })();
}

// 지형 만들기 본체: 단계(mark)마다 yield 하는 생성기. 기다린 시간은 단계 시간·buildMs 에서 뺌
function* terrainStages(spec, mats) {
  const t0 = performance.now();
  const stage = {};
  let tLast = t0, waited = 0;
  const mark = (k) => { const t = performance.now(); stage[k] = Math.round(t - tLast); tLast = t; };
  const resume = () => { const t = performance.now(); waited += t - tLast; tLast = t; };
  const model = createHeightModel(spec);
  mark('model');
  yield 'model';
  resume();
  const M = getMaterials(mats);
  mark('mats');
  yield 'mats';
  resume();
  const P = mats.palette || {};
  const problems = model.problems.slice();
  const group = new THREE.Group();
  group.name = 'terrain';

  const walls = new Tris();   // mats.stone (축대·호안 장대석, UV m/4 × m/2)
  const caps = new Tris();    // mats.stoneTop (갑석·호안 윗돌)
  const bed = new Tris();     // mats.stoneRubble (물길 바닥)
  const water = new Tris();   // 물
  const tops = { stone: new Tris(), earth: new Tris(), alt: new Tris() };

  // ── 궁성 안 석축 물길: 중심선·옆선(마이터) ──
  const channels = [];
  for (const st of model.streams) {
    for (const [sA, sB] of st.sections) {
      const pts = [model.pointAtS(st, sA)];
      let acc = 0;
      for (let k = 0; k < st.pts.length; k++) {
        if (k > 0) acc += Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1]);
        if (acc > sA + 0.5 && acc < sB - 0.5) pts.push([st.pts[k][0], st.pts[k][1], st.wy[k]]);
      }
      pts.push(model.pointAtS(st, sB));
      const n = pts.length;
      const segN = [];
      for (let k = 0; k < n - 1; k++) {
        const dx = pts[k + 1][0] - pts[k][0], dz = pts[k + 1][1] - pts[k][1];
        const L = Math.hypot(dx, dz) || 1;
        segN.push([-dz / L, dx / L, dx / L, dz / L]); // 왼쪽 법선(nx,nz), 접선(tx,tz)
      }
      const miter = pts.map((p, k) => {
        const a = segN[Math.max(0, k - 1)], b = segN[Math.min(n - 2, k)];
        let mx = a[0] + b[0], mz = a[1] + b[1];
        const L = Math.hypot(mx, mz) || 1;
        mx /= L; mz /= L;
        const s = 1 / Math.max(0.5, mx * b[0] + mz * b[1]);
        return [mx * s, mz * s];
      });
      const off = (k, d) => [pts[k][0] + miter[k][0] * d, pts[k][1] + miter[k][1] * d];
      const O = st.clipHalf;
      const shapes = [];
      for (let k = 0; k < n - 1; k++) shapes.push(convexShape([off(k, O), off(k + 1, O), off(k + 1, -O), off(k, -O)]));
      channels.push({ st, pts, segN, miter, off, O, shapes });
    }
  }

  // ── 잘라낼 볼록 다각형(대지 + 석축 물길) 구획 ──
  const clipShapes = [];
  for (const t of model.terraces) {
    const S = convexShape([[t.r.x0, t.r.z0], [t.r.x1, t.r.z0], [t.r.x1, t.r.z1], [t.r.x0, t.r.z1]]);
    S.rect = t.r;
    clipShapes.push(S);
  }
  for (const ch of channels) clipShapes.push(...ch.shapes);
  const CB = 16, CBX0 = -400, CBZ0 = -560, CBNX = 54, CBNZ = 71;
  const clipBins = Array.from({ length: CBNX * CBNZ }, () => []);
  clipShapes.forEach((S, si) => {
    const i0 = clamp(Math.floor((S.x0 - CBX0) / CB), 0, CBNX - 1), i1 = clamp(Math.floor((S.x1 - CBX0) / CB), 0, CBNX - 1);
    const j0 = clamp(Math.floor((S.z0 - CBZ0) / CB), 0, CBNZ - 1), j1 = clamp(Math.floor((S.z1 - CBZ0) / CB), 0, CBNZ - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) clipBins[j * CBNX + i].push(si);
  });
  let stamp = 1;
  const stamps = new Int32Array(clipShapes.length);
  function shapesNear(x0, z0, x1, z1, out) {
    out.length = 0;
    stamp++;
    const i0 = clamp(Math.floor((x0 - CBX0) / CB), 0, CBNX - 1), i1 = clamp(Math.floor((x1 - CBX0) / CB), 0, CBNX - 1);
    const j0 = clamp(Math.floor((z0 - CBZ0) / CB), 0, CBNZ - 1), j1 = clamp(Math.floor((z1 - CBZ0) / CB), 0, CBNZ - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const si of clipBins[j * CBNX + i]) {
          if (stamps[si] === stamp) continue;
          stamps[si] = stamp;
          const S = clipShapes[si];
          if (S.x1 < x0 || S.x0 > x1 || S.z1 < z0 || S.z0 > z1) continue;
          out.push(S);
        }
      }
    }
    return out;
  }

  // ── 격자 단 높이 (거친 단부터; 고운 단의 바깥 띠는 거친 단 보간면으로) ──
  mark('setup');
  yield 'setup';
  resume();
  const levels = LEVELS.map((L) => ({ ...L, nx: Math.round((L.x1 - L.x0) / L.cell) + 1, nz: Math.round((L.z1 - L.z0) / L.cell) + 1 }));
  const bilin = (Lv, arr, x, z) => {
    let fx = (x - Lv.x0) / Lv.cell, fz = (z - Lv.z0) / Lv.cell;
    fx = clamp(fx, 0, Lv.nx - 1.000001); fz = clamp(fz, 0, Lv.nz - 1.000001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * Lv.nx + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + Lv.nx] * (1 - tx) + arr[k + Lv.nx + 1] * tx) * tz;
  };
  // 메시와 같은 삼각형 보간 (대각선 (i+1,j)–(i,j+1))
  const triInterp = (Lv, arr, x, z) => {
    let fx = (x - Lv.x0) / Lv.cell, fz = (z - Lv.z0) / Lv.cell;
    fx = clamp(fx, 0, Lv.nx - 1.000001); fz = clamp(fz, 0, Lv.nz - 1.000001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * Lv.nx + i;
    const a = arr[k], b = arr[k + 1], c = arr[k + Lv.nx], d = arr[k + Lv.nx + 1];
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  };
  const edgeW = (Lv, x, z) => (Lv.band > 0 ? 1 - smoothstep(0, Lv.band, Math.min(x - Lv.x0, Lv.x1 - x, z - Lv.z0, Lv.z1 - z)) : 0);
  const hLevel = (li, x, z) => {
    const Lv = levels[li];
    let h = model.finalAt(x, z, Lv.minL);
    const c = levels[li + 1];
    if (c) {
      const w = edgeW(Lv, x, z);
      if (w > 0) h = lerp(h, bilin(c, c.H, x, z), w);
    }
    return h;
  };
  for (let li = levels.length - 1; li >= 0; li--) {
    const Lv = levels[li];
    Lv.H = new Float32Array(Lv.nx * Lv.nz);
    for (let j = 0; j < Lv.nz; j++) {
      for (let i = 0; i < Lv.nx; i++) Lv.H[j * Lv.nx + i] = hLevel(li, Lv.x0 + i * Lv.cell, Lv.z0 + j * Lv.cell);
    }
  }
  mark('heights');
  yield 'heights';
  resume();
  // 잘려 나가는 격자점 표시 (법선을 한쪽 차분으로)
  for (const Lv of levels) {
    Lv.cut = new Uint8Array(Lv.nx * Lv.nz);
    if (!Lv.clip) continue;
    for (const S of clipShapes) {
      const i0 = Math.max(0, Math.ceil((S.x0 - Lv.x0) / Lv.cell)), i1 = Math.min(Lv.nx - 1, Math.floor((S.x1 - Lv.x0) / Lv.cell));
      const j0 = Math.max(0, Math.ceil((S.z0 - Lv.z0) / Lv.cell)), j1 = Math.min(Lv.nz - 1, Math.floor((S.z1 - Lv.z0) / Lv.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (insideShape(S, Lv.x0 + i * Lv.cell, Lv.z0 + j * Lv.cell, -0.05)) Lv.cut[j * Lv.nx + i] = 1;
        }
      }
    }
  }
  // 법선
  for (let li = levels.length - 1; li >= 0; li--) {
    const Lv = levels[li], { nx, nz, H, cut } = Lv, s = Lv.cell;
    Lv.N = new Float32Array(nx * nz * 3);
    const c = levels[li + 1];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const iL = i > 0 && !cut[k - 1] ? i - 1 : i, iR = i < nx - 1 && !cut[k + 1] ? i + 1 : i;
        const jU = j > 0 && !cut[k - nx] ? j - 1 : j, jD = j < nz - 1 && !cut[k + nx] ? j + 1 : j;
        const gx = iR > iL ? (H[j * nx + iR] - H[j * nx + iL]) / ((iR - iL) * s) : 0;
        const gz = jD > jU ? (H[jD * nx + i] - H[jU * nx + i]) / ((jD - jU) * s) : 0;
        let ax = -gx, ay = 1, az = -gz;
        if (c) {
          const x = Lv.x0 + i * s, z = Lv.z0 + j * s;
          const w = edgeW(Lv, x, z);
          if (w > 0) {
            ax = lerp(ax / Math.hypot(ax, ay, az), bilin(c, c.NX, x, z), w);
            ay = lerp(1 / Math.hypot(-gx, 1, -gz), bilin(c, c.NY, x, z), w);
            az = lerp(-gz / Math.hypot(-gx, 1, -gz), bilin(c, c.NZ, x, z), w);
          }
        }
        const L = Math.hypot(ax, ay, az);
        Lv.N[k * 3] = ax / L; Lv.N[k * 3 + 1] = ay / L; Lv.N[k * 3 + 2] = az / L;
      }
    }
    // 보간용 성분 배열
    Lv.NX = new Float32Array(nx * nz); Lv.NY = new Float32Array(nx * nz); Lv.NZ = new Float32Array(nx * nz);
    for (let k = 0; k < nx * nz; k++) { Lv.NX[k] = Lv.N[k * 3]; Lv.NY[k] = Lv.N[k * 3 + 1]; Lv.NZ[k] = Lv.N[k * 3 + 2]; }
  }

  // ── 정점 색 ──
  const C = (hex) => new THREE.Color(hex);
  const col = {
    grass: C(P.grass || '#7D8B5A'),
    dry: C(P.grass || '#7D8B5A').lerp(C('#a89a68'), 0.55),
    lawn: C(P.grass || '#7D8B5A').lerp(C('#6f8a4a'), 0.5),
    soil: C(P.soilRedBrown || '#8B5E45'),
    masa: C(P.soilRedBrown || '#8B5E45').lerp(C('#b8a07a'), 0.55),
    earth: C(P.packedEarth || '#A68B69'),
    forest: C(P.pineForest || '#2E4630').lerp(C('#332c1f'), 0.3).multiplyScalar(0.85),
    rock: C(P.graniteOutcrop || '#B7B0A3').lerp(C('#9d9e9c'), 0.45),
    rockDark: C(P.graniteOutcrop || '#B7B0A3').lerp(C('#57554f'), 0.7),
    scrub: C(P.pineForest || '#2E4630').lerp(C('#5b5a3a'), 0.5),
    gravel: C('#8f8a7c'),
    wet: C(P.grass || '#7D8B5A').lerp(C('#48573a'), 0.55),
  };
  const palacePoly = model.palacePoly;
  const cityWall = (spec.walls || []).find((w) => w.id === 'hwangseong' || (w.kind === 'city' && w.closed));
  const hwangPoly = cityWall ? cityWall.path : null;
  const approach = { x0: -18, x1: 10, z0: 296, z1: 445 }; // 승평문 밖 진입로(흙길)
  const tmpC = new THREE.Color(), tmpR = new THREE.Color();
  function colorAt(x, z, h, ny, fine, out, o) {
    const slope = 1 - ny;
    const n1 = noise2(x / 230, z / 230, 71), n2 = noise2(x / 52, z / 52, 72);
    const n3 = fine ? noise2(x / 14, z / 14, 73) : 0;
    const inPal = palacePoly && x > -300 && x < 200 && z > -500 && z < 270 && pointInPolygon(x, z, palacePoly);
    const c = tmpC.copy(col.grass).lerp(col.dry, clamp(0.4 + 0.35 * n1 + 0.15 * n2, 0, 1));
    if (inPal) c.lerp(col.lawn, 0.45);
    // 비탈의 흙, 산 위쪽 마사토
    c.lerp(col.soil, smoothstep(0.14, 0.42, slope + 0.06 * n2) * 0.85 * (1 - 0.7 * smoothstep(250, 320, h)));
    c.lerp(col.masa, smoothstep(110, 260, h + 40 * n1) * (1 - smoothstep(300, 380, h)) * 0.4 * smoothstep(0.03, 0.12, slope));
    // 대지 둘레·깎은 비탈: 다져진 흙
    if (fine) {
      const bin = model.binAt(x, z);
      let td = Infinity;
      for (const ti of bin.t) td = Math.min(td, rectDist(model.terraces[ti].r, x, z));
      if (td < 20) {
        const nat = model.naturalAt(x, z);
        const cutAmt = nat - h;
        c.lerp(col.earth, Math.max(smoothstep(0.5, 2.0, cutAmt) * 0.4, (1 - smoothstep(0.2, 1.6 + 0.6 * n3, td)) * 0.4));
      }
      // 물가: 자갈·젖은 풀
      if (bin.g.length || bin.p.length) {
        const wet = waterProximity(x, z);
        if (wet < 12) {
          c.lerp(col.wet, (1 - smoothstep(2, 12, wet)) * 0.5);
          c.lerp(col.gravel, (1 - smoothstep(0.2, 2.2, wet)) * 0.6);
        }
      }
      if (x > approach.x0 - 6 && x < approach.x1 + 6 && z > approach.z0 && z < approach.z1 + 30) {
        const e = Math.min(x - approach.x0, approach.x1 - x);
        const along = 1 - smoothstep(approach.z1 - 20, approach.z1 + 30, z);
        c.lerp(col.earth, smoothstep(-3, 2, e) * 0.55 * along);
      }
    }
    // 숲 바닥
    if (!inPal) c.lerp(col.forest, forestDensity(x, z, h, slope) * 0.88);
    // 화강암 암릉 (가파른 곳 + 송악산 윗부분)
    const rockW = clamp(smoothstep(0.45, 0.7, slope + 0.12 * n2) + smoothstep(270, 340, h + 40 * n2 + 25 * n1) * 0.95, 0, 1) * (0.88 + 0.12 * n1);
    if (rockW > 0.001) {
      // 화강암: 결 따라 밝고 어두운 줄, 틈마다 관목
      const streak = 1 - Math.abs(noise2(x / 38, z / 38, 74));
      const tone = clamp(0.4 + 0.55 * n2 + 0.5 * (streak - 0.55), 0, 1);
      const rc = tmpR.copy(col.rockDark).lerp(col.rock, tone);
      c.lerp(rc, clamp(rockW, 0, 1));
      const scrub = smoothstep(-0.2, 0.35, noise2(x / 55, z / 55, 75) + 0.3 * noise2(x / 17, z / 17, 76)) * 0.62 * (1 - smoothstep(0.5, 0.75, slope));
      c.lerp(col.scrub, scrub * rockW);
    }
    const k = 1 + 0.07 * n2 + 0.05 * n3;
    out[o] = c.r * k; out[o + 1] = c.g * k; out[o + 2] = c.b * k;
  }
  function waterProximity(x, z) {
    let best = Infinity;
    const bin = model.binAt(x, z);
    for (const gi of bin.g) {
      const g = model.allSegs[gi];
      const dx = g.bx - g.ax, dz = g.bz - g.az;
      const t = clamp(((x - g.ax) * dx + (z - g.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(g.ax + dx * t - x, g.az + dz * t - z) - (model.streams[g.si].w / 2 + 1.2);
      if (d < best) best = d;
    }
    for (const pi of bin.p) best = Math.min(best, Math.max(0, model.pondEdge(model.ponds[pi], x, z)));
    return best;
  }
  function fieldAt(x, z, h, ny) {
    if (!hwangPoly || h > 28 || ny < 0.93) return 0;
    const flat = 1 - smoothstep(0.02, 0.07, 1 - ny);
    const low = 1 - smoothstep(8, 28, h);
    const patch = smoothstep(-0.25, 0.25, noise2(x / 700, z / 700, 81));
    const f = flat * low * patch;
    if (f <= 0.001) return 0;
    if (Math.abs(x) < 900 && z > -800 && z < 820 && pointInPolygon(x, z, hwangPoly)) return 0;
    return clamp(f, 0, 1);
  }

  mark('normals');
  yield 'normals';
  resume();
  // ── 지형 메시 조립 ──
  const tp = [], tn = [], tc = [], tf = [], ti = [];
  let nv = 0;
  const pushV = (x, y, z, nxv, nyv, nzv, fine) => {
    tp.push(x, y, z); tn.push(nxv, nyv, nzv);
    const o = tc.length; tc.push(0, 0, 0);
    colorAt(x, z, y, nyv, fine, tc, o);
    tf.push(fieldAt(x, z, y, nyv));
    return nv++;
  };
  const near = [], NONE = [];
  let clippedCells = 0;
  levels.forEach((Lv, li) => {
    const { nx, nz, H, N, cell } = Lv;
    const fine = li <= 1;
    const hole = levels[li - 1];
    const vmap = new Int32Array(nx * nz).fill(-1);
    const gv = (i, j) => {
      const k = j * nx + i;
      if (vmap[k] < 0) vmap[k] = pushV(Lv.x0 + i * cell, H[k], Lv.z0 + j * cell, N[k * 3], N[k * 3 + 1], N[k * 3 + 2], fine);
      return vmap[k];
    };
    // 잘린 칸의 새 정점도 원래 칸 삼각형 평면 위에 (정확한 높이를 쓰면 이웃 칸 모서리와 T자 틈이 생겨 하늘이 비침)
    const pv = (x, z) => pushV(x, triInterp(Lv, H, x, z), z, bilin(Lv, Lv.NX, x, z), bilin(Lv, Lv.NY, x, z), bilin(Lv, Lv.NZ, x, z), fine);
    const emitPoly = (poly) => {
      const ids = poly.map(([x, z]) => pv(x, z));
      for (let k = 1; k < poly.length - 1; k++) {
        const A = poly[0], B = poly[k], Cc = poly[k + 1];
        const up = (B[1] - A[1]) * (Cc[0] - A[0]) - (B[0] - A[0]) * (Cc[1] - A[1]);
        if (Math.abs(up) < 1e-9) continue;
        if (up > 0) ti.push(ids[0], ids[k], ids[k + 1]); else ti.push(ids[0], ids[k + 1], ids[k]);
      }
    };
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const x0 = Lv.x0 + i * cell, z0 = Lv.z0 + j * cell, x1 = x0 + cell, z1 = z0 + cell;
        if (hole && x0 >= hole.x0 - 1e-6 && x1 <= hole.x1 + 1e-6 && z0 >= hole.z0 - 1e-6 && z1 <= hole.z1 + 1e-6) continue;
        const shapes = Lv.clip ? shapesNear(x0, z0, x1, z1, near) : NONE;
        if (!shapes.length) {
          const a = gv(i, j), b = gv(i + 1, j), c = gv(i, j + 1), d = gv(i + 1, j + 1);
          ti.push(a, c, b, b, c, d);
          continue;
        }
        if (shapes.some((S) => insideShape(S, x0, z0) && insideShape(S, x1, z0) && insideShape(S, x0, z1) && insideShape(S, x1, z1))) continue;
        clippedCells++;
        const triA = [[x0, z0], [x0, z1], [x1, z0]], triB = [[x1, z0], [x0, z1], [x1, z1]];
        for (const [tri, ids] of [[triA, [[i, j], [i, j + 1], [i + 1, j]]], [triB, [[i + 1, j], [i, j + 1], [i + 1, j + 1]]]]) {
          let pieces = [tri];
          let touched = false;
          for (const S of shapes) {
            const next = [];
            for (const p of pieces) {
              const r = subtractShape(p, S);
              if (r.length !== 1 || r[0] !== p) touched = true;
              next.push(...r);
            }
            pieces = next;
            if (!pieces.length) break;
          }
          if (!touched) ti.push(gv(...ids[0]), gv(...ids[1]), gv(...ids[2]));
          else for (const p of pieces) emitPoly(p);
        }
      }
    }
  });
  mark('mesh');
  yield 'mesh';
  resume();
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  tgeo.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
  tgeo.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
  tgeo.setAttribute('aField', new THREE.Float32BufferAttribute(tf, 1));
  tgeo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(ti, 1) : new THREE.Uint16BufferAttribute(ti, 1));
  tgeo.computeBoundingSphere();
  const terrainMesh = new THREE.Mesh(tgeo, M.terrain);
  terrainMesh.name = 'terrain-ground';
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 격자 보간이 아닌 정확한 단 높이(잘린 가장자리 정점과 같은 값) — 벽·호안 높이 맞춤용
  function exactAt(x, z) {
    for (let li = 0; li < levels.length; li++) {
      const Lv = levels[li];
      if (x >= Lv.x0 && x <= Lv.x1 && z >= Lv.z0 && z <= Lv.z1) return hLevel(li, x, z);
    }
    return model.finalAt(x, z, 420);
  }

  // ── groundAt: 메시와 같은 보간 ──
  function groundAt(x, z) {
    const bedY = model.channelBedAt(x, z);
    if (!Number.isNaN(bedY)) return bedY;
    for (const Lv of levels) {
      if (x >= Lv.x0 && x <= Lv.x1 && z >= Lv.z0 && z <= Lv.z1) return triInterp(Lv, Lv.H, x, z);
    }
    return model.finalAt(x, z, 420);
  }

  mark('geo');
  yield 'geo';
  resume();
  // ── 대지: 윗면·축대·갑석 ──
  const TER = model.terraces;
  const EQ = 0.02;
  function neighborTop(self, x, z) {
    let top = NaN;
    const bin = model.binAt(x, z);
    for (const k of bin.t) {
      const t = TER[k];
      if (t === self) continue;
      if (x >= t.r.x0 - 1e-6 && x <= t.r.x1 + 1e-6 && z >= t.r.z0 - 1e-6 && z <= t.r.z1 + 1e-6) top = Number.isNaN(top) ? t.top : Math.max(top, t.top);
    }
    return top;
  }
  let wallTris0 = 0;
  for (const t of TER) {
    const { x0, x1, z0, z1 } = t.r;
    const y = t.top;
    const surf = t.surface === 'stone' ? (t.surfaceAlt ? 'alt' : 'stone') : 'earth';
    const S = surf === 'earth' ? 8 : 5;
    tops[surf].quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], [x0 / S, z0 / S], [x1 / S, z0 / S], [x1 / S, z1 / S], [x0 / S, z1 / S]);
    // 네 변: [시작, 끝, 고정좌표, 축('x'면 x 가 변함), 바깥 법선]
    const edges = [
      { a: x0, b: x1, c: z1, alongX: true, n: [0, 0, 1] },
      { a: x0, b: x1, c: z0, alongX: true, n: [0, 0, -1] },
      { a: z0, b: z1, c: x1, alongX: false, n: [1, 0, 0] },
      { a: z0, b: z1, c: x0, alongX: false, n: [-1, 0, 0] },
    ];
    for (const E of edges) {
      // 끊는 점: 다른 대지 모서리 좌표
      const cuts = [E.a, E.b];
      for (const o of TER) {
        if (o === t) continue;
        for (const v of E.alongX ? [o.r.x0, o.r.x1] : [o.r.z0, o.r.z1]) if (v > E.a + 1e-3 && v < E.b - 1e-3) cuts.push(v);
      }
      cuts.sort((p, q) => p - q);
      const segs = [];
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], b = cuts[k + 1];
        if (b - a < 1e-3) continue;
        const m = (a + b) / 2;
        const px = E.alongX ? m : E.c + E.n[0] * 0.03, pz = E.alongX ? E.c + E.n[2] * 0.03 : m;
        const nt = neighborTop(t, px, pz);
        let kind, bottom;
        if (Number.isNaN(nt)) {
          kind = 'ground';
          let gmin = Infinity;
          const steps = Math.max(2, Math.ceil((b - a) / 1));
          for (let q = 0; q <= steps; q++) {
            const v = a + ((b - a) * q) / steps;
            const gx = E.alongX ? v : E.c + E.n[0] * 0.05, gz = E.alongX ? E.c + E.n[2] * 0.05 : v;
            gmin = Math.min(gmin, exactAt(gx, gz), groundAt(gx, gz));
          }
          bottom = Math.min(t.bottom - 2, gmin - 1.0);
        } else if (nt < y - EQ) { kind = 'lower'; bottom = nt - 0.12; }
        else kind = 'none';
        const last = segs[segs.length - 1];
        if (last && last.kind === kind && kind !== 'none' && Math.abs(last.b - a) < 1e-6) { last.b = b; last.bottom = Math.min(last.bottom, bottom); }
        else segs.push({ a, b, kind, bottom });
      }
      for (const sg of segs) {
        if (sg.kind === 'none') continue;
        const P3 = (v, yy, d = 0) => (E.alongX ? [v, yy, E.c + E.n[2] * d] : [E.c + E.n[0] * d, yy, v]);
        const n = E.n;
        // 축대 면 (장대석)
        const yt = y - CAP_H, yb = sg.bottom;
        if (yt > yb) {
          walls.quad(P3(sg.a, yb), P3(sg.b, yb), P3(sg.b, yt), P3(sg.a, yt), n,
            [sg.a / 4, yb / 2], [sg.b / 4, yb / 2], [sg.b / 4, yt / 2], [sg.a / 4, yt / 2]);
        }
        // 갑석: 윗면·앞면·아랫면·마구리
        const ea = sg.a - CAP_OUT, eb = sg.b + CAP_OUT;
        caps.quad(P3(ea, y, -CAP_IN), P3(eb, y, -CAP_IN), P3(eb, y, CAP_OUT), P3(ea, y, CAP_OUT), [0, 1, 0]);
        caps.quad(P3(ea, y - CAP_H, CAP_OUT), P3(eb, y - CAP_H, CAP_OUT), P3(eb, y, CAP_OUT), P3(ea, y, CAP_OUT), n);
        caps.quad(P3(ea, y - CAP_H, 0), P3(eb, y - CAP_H, 0), P3(eb, y - CAP_H, CAP_OUT), P3(ea, y - CAP_H, CAP_OUT), [0, -1, 0]);
        const tan = E.alongX ? [1, 0, 0] : [0, 0, 1];
        caps.quad(P3(eb, y - CAP_H, 0), P3(eb, y - CAP_H, CAP_OUT), P3(eb, y, CAP_OUT), P3(eb, y, -CAP_IN), tan);
        caps.quad(P3(ea, y - CAP_H, 0), P3(ea, y - CAP_H, CAP_OUT), P3(ea, y, CAP_OUT), P3(ea, y, -CAP_IN), [-tan[0], 0, -tan[2]]);
      }
    }
  }
  wallTris0 = walls.count;

  // ── 궁성 안 석축 물길: 호안 벽·윗돌·바닥·마구리 ──
  for (const ch of channels) {
    const { st, pts, off, O } = ch;
    const B = st.bankHalf;
    let sAcc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const segLen = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      const steps = Math.max(1, Math.ceil(segLen / 2));
      const [nlx, nlz] = ch.segN[k];
      for (let q = 0; q < steps; q++) {
        const u0 = q / steps, u1 = (q + 1) / steps;
        const wy0 = lerp(pts[k][2], pts[k + 1][2], u0), wy1 = lerp(pts[k][2], pts[k + 1][2], u1);
        const s0 = sAcc + segLen * u0, s1 = sAcc + segLen * u1;
        for (const side of [1, -1]) {
          const at = (u, d) => {
            const A = off(k, side * d), Bp = off(k + 1, side * d);
            return [lerp(A[0], Bp[0], u), lerp(A[1], Bp[1], u)];
          };
          const copeTop = (u, wy) => {
            const po = at(u, O);
            const g = Math.max(exactAt(po[0], po[1]), exactAt(...at(u, O + 1.2)));
            let top = Math.max(g + 0.1, wy + 0.55);
            const tt = model.terraceTopAt(at(u, O - 0.05)[0], at(u, O - 0.05)[1]);
            if (!Number.isNaN(tt) && Math.abs(tt - top) < 0.6) top = tt;
            return top;
          };
          const ct0 = copeTop(u0, wy0), ct1 = copeTop(u1, wy1);
          const nIn = [-side * nlx, 0, -side * nlz];
          const nOut = [side * nlx, 0, side * nlz];
          const b0 = wy0 - 0.9, b1 = wy1 - 0.9;
          // 호안 벽 (물 쪽)
          const w0 = at(u0, B), w1 = at(u1, B);
          walls.quad([w0[0], b0, w0[1]], [w1[0], b1, w1[1]], [w1[0], ct1 - 0.24, w1[1]], [w0[0], ct0 - 0.24, w0[1]], nIn,
            [s0 / 4, b0 / 2], [s1 / 4, b1 / 2], [s1 / 4, (ct1 - 0.24) / 2], [s0 / 4, (ct0 - 0.24) / 2]);
          // 윗돌: 물 쪽 내민 턱, 윗면, 바깥면
          const l0 = at(u0, B - 0.08), l1 = at(u1, B - 0.08);
          const o0 = at(u0, O), o1 = at(u1, O);
          caps.quad([l0[0], ct0 - 0.24, l0[1]], [l1[0], ct1 - 0.24, l1[1]], [l1[0], ct1, l1[1]], [l0[0], ct0, l0[1]], nIn);
          caps.quad([l0[0], ct0 - 0.24, l0[1]], [l1[0], ct1 - 0.24, l1[1]], [w1[0], ct1 - 0.24, w1[1]], [w0[0], ct0 - 0.24, w0[1]], [0, -1, 0]);
          // 윗면은 장대석 무늬(길이 방향으로 놓인 판석)
          const vIn = (B - 0.08) / 2, vOut = O / 2;
          walls.quad([l0[0], ct0, l0[1]], [l1[0], ct1, l1[1]], [o1[0], ct1, o1[1]], [o0[0], ct0, o0[1]], [0, 1, 0],
            [s0 / 4, vIn], [s1 / 4, vIn], [s1 / 4, vOut], [s0 / 4, vOut]);
          const g0 = Math.min(exactAt(o0[0], o0[1]), ct0) - 0.5, g1 = Math.min(exactAt(o1[0], o1[1]), ct1) - 0.5;
          caps.quad([o0[0], g0, o0[1]], [o1[0], g1, o1[1]], [o1[0], ct1, o1[1]], [o0[0], ct0, o0[1]], nOut);
        }
        // 바닥 (강자갈)
        const L0 = off(k, B + 0.05), R0 = off(k, -B - 0.05), L1 = off(k + 1, B + 0.05), R1 = off(k + 1, -B - 0.05);
        const la = [lerp(L0[0], L1[0], u0), lerp(L0[1], L1[1], u0)], lb = [lerp(L0[0], L1[0], u1), lerp(L0[1], L1[1], u1)];
        const ra = [lerp(R0[0], R1[0], u0), lerp(R0[1], R1[1], u0)], rb = [lerp(R0[0], R1[0], u1), lerp(R0[1], R1[1], u1)];
        const by0 = wy0 - 0.6, by1 = wy1 - 0.6;
        bed.quad([ra[0], by0, ra[1]], [rb[0], by1, rb[1]], [lb[0], by1, lb[1]], [la[0], by0, la[1]], [0, 1, 0],
          [ra[0] / 3, ra[1] / 3], [rb[0] / 3, rb[1] / 3], [lb[0] / 3, lb[1] / 3], [la[0] / 3, la[1] / 3]);
      }
      sAcc += segLen;
    }
    // 마구리(석축 물길 끝의 날개벽): 바깥 흙 비탈을 가리는 두께 0.7 m 의 돌덩이
    for (const [k, dir] of [[0, -1], [pts.length - 1, 1]]) {
      const sn = ch.segN[Math.min(k, ch.segN.length - 1)];
      const tn = [sn[2] * dir, 0, sn[3] * dir];
      const wy = pts[k][2];
      const W = O + 1.6;
      for (const side of [1, -1]) {
        const lat = [sn[0] * side, 0, sn[1] * side];
        const top = Math.max(exactAt(...off(k, side * O)), exactAt(...off(k, side * W)), exactAt(...off(k, side * (W + 1)))) + 0.15;
        const bot = wy - 0.9;
        const a = off(k, side * (B - 0.08)), b = off(k, side * W);
        const back = (p, d = 0.7) => [p[0] - tn[0] * d, p[1] - tn[2] * d];
        const a2 = back(a), b2 = back(b), o2 = back(off(k, side * O));
        const o1 = off(k, side * O);
        const L = W - B;
        walls.quad([a[0], bot, a[1]], [b[0], bot, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], tn,
          [0, bot / 2], [L / 4, bot / 2], [L / 4, top / 2], [0, top / 2]);
        walls.quad([b[0], bot, b[1]], [b2[0], bot, b2[1]], [b2[0], top, b2[1]], [b[0], top, b[1]], lat,
          [0, bot / 2], [0.7 / 4, bot / 2], [0.7 / 4, top / 2], [0, top / 2]);
        walls.quad([o1[0] - tn[0] * 0.7, bot, o1[1] - tn[2] * 0.7], [b2[0], bot, b2[1]], [b2[0], top, b2[1]], [o2[0], top, o2[1]], [-tn[0], 0, -tn[2]],
          [0, bot / 2], [(W - O) / 4, bot / 2], [(W - O) / 4, top / 2], [0, top / 2]);
        caps.quad([a[0], top, a[1]], [b[0], top, b[1]], [b2[0], top, b2[1]], [a2[0], top, a2[1]], [0, 1, 0]);
      }
    }
  }

  mark('walls');
  yield 'walls';
  resume();
  // ── 물 리본 (모든 물길) ──
  const waterUV = (x, z) => [x / 14, z / 14];
  const streamWaterY = model.streams.map((st) => st.wy.slice());
  // 합류점: 지류 끝의 수면을 본류 수면에 맞춥니다.
  model.streams.forEach((st, si) => {
    const end = st.pts[st.pts.length - 1];
    for (const o of model.streams) {
      if (o === st) continue;
      let best = null;
      for (const g of o.segs) {
        const dx = g.bx - g.ax, dz = g.bz - g.az;
        const t = clamp(((end[0] - g.ax) * dx + (end[1] - g.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(g.ax + dx * t - end[0], g.az + dz * t - end[1]);
        if (!best || d < best.d) best = { d, wy: lerp(g.wyA, g.wyB, t) };
      }
      if (best && best.d < o.w) {
        const last = streamWaterY[si].length - 1;
        if (Math.abs(streamWaterY[si][last] - best.wy) > 0.05) {
          problems.push(`stream ${st.id}: 끝 수면 ${streamWaterY[si][last]} ≠ 합류하는 ${o.id} 수면 ${best.wy.toFixed(2)} — 본류에 맞춤`);
        }
        streamWaterY[si][last] = best.wy - 0.03;
      }
    }
  });
  model.streams.forEach((st, si) => {
    const wys = streamWaterY[si];
    const samples = [];
    let acc = 0;
    for (let k = 0; k < st.pts.length - 1; k++) {
      const [ax, az] = st.pts[k], [bx, bz] = st.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 3));
      for (let q = (k === 0 ? 0 : 1); q <= steps; q++) {
        const u = q / steps;
        samples.push({ x: lerp(ax, bx, u), z: lerp(az, bz, u), wy: lerp(wys[k], wys[k + 1], u), s: acc + len * u, k });
      }
      acc += len;
    }
    // 방향(마이터 없이 이웃 표본으로)
    const rows = samples.map((p, q) => {
      const a = samples[Math.max(0, q - 1)], b = samples[Math.min(samples.length - 1, q + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      let ds = Infinity, inSec = false;
      for (const [sA, sB] of st.sections) {
        if (p.s >= sA && p.s <= sB) inSec = true;
        ds = Math.min(ds, p.s < sA ? sA - p.s : p.s - sB);
      }
      let half, y = p.wy;
      if (inSec) half = st.bankHalf - 0.02;
      else {
        const tr = st.sections.length ? clamp(ds / 18, 0, 1) : 1;
        const core = lerp(st.clipHalf, Math.max(1, st.w / 2 - 1), tr), shore = lerp(0.01, 1.6, tr);
        half = core + shore * 0.75 + 0.15;
        // 거친 격자 구간: 물이 흙 아래 묻히지 않게
        const g = groundAt(p.x, p.z);
        if (g > y - 0.15) {
          y = g + 0.15;
          // 올린 수면의 가장자리가 비탈 밖 허공에 뜨지 않게 폭을 줄임 (양쪽 기슭 땅이 수면보다 높아지는 곳까지)
          const nx = -dz / L, nz = dx / L;
          for (const k of [1, 0.75, 0.55, 0.4, 0.28]) {
            const hh = half * k;
            if (groundAt(p.x + nx * hh, p.z + nz * hh) > y - 0.08 && groundAt(p.x - nx * hh, p.z - nz * hh) > y - 0.08) { half = hh; break; }
            half = hh;
          }
        }
      }
      return { x: p.x, z: p.z, y, nx: -dz / L, nz: dx / L, half };
    });
    for (let q = 0; q < rows.length - 1; q++) {
      const A = rows[q], Bq = rows[q + 1];
      const aL = [A.x + A.nx * A.half, A.y, A.z + A.nz * A.half], aR = [A.x - A.nx * A.half, A.y, A.z - A.nz * A.half];
      const bL = [Bq.x + Bq.nx * Bq.half, Bq.y, Bq.z + Bq.nz * Bq.half], bR = [Bq.x - Bq.nx * Bq.half, Bq.y, Bq.z - Bq.nz * Bq.half];
      water.quad(aR, bR, bL, aL, [0, 1, 0], waterUV(aR[0], aR[2]), waterUV(bR[0], bR[2]), waterUV(bL[0], bL[2]), waterUV(aL[0], aL[2]));
    }
  });

  // ── 연못: 수면·괴석 호안·선산 ──
  const rockInst = [];
  for (const Pd of model.ponds) {
    const segs = 72;
    const ring = [];
    for (let q = 0; q < segs; q++) {
      const ang = (q / segs) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const rho = 1 / Math.sqrt((c / Pd.a) ** 2 + (s / Pd.b) ** 2);
      const wob = noise2(c * 1.6 + 5, s * 1.6 + 5, 33) * 1.6;
      const r = rho + 0.6 - wob;
      ring.push([Pd.cx + c * r, Pd.cz + s * r, ang, rho - wob]);
    }
    for (let q = 0; q < segs; q++) {
      const A = ring[q], Bq = ring[(q + 1) % segs];
      const y = Pd.waterY;
      water.tri([Pd.cx, y, Pd.cz], [Bq[0], y, Bq[1]], [A[0], y, A[1]], [0, 1, 0], [0, 1, 0], [0, 1, 0],
        waterUV(Pd.cx, Pd.cz), waterUV(Bq[0], Bq[1]), waterUV(A[0], A[1]));
    }
    // 호안 괴석: 물가(e≈0..1.4)를 따라
    const R = rng(9001 + Pd.i);
    let perim = 0;
    for (let q = 0; q < segs; q++) perim += Math.hypot(ring[(q + 1) % segs][0] - ring[q][0], ring[(q + 1) % segs][1] - ring[q][1]);
    const count = Math.round(perim / 1.05);
    for (let q = 0; q < count; q++) {
      const ang = ((q + R() * 0.6) / count) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const rho = 1 / Math.sqrt((c / Pd.a) ** 2 + (s / Pd.b) ** 2);
      const wob = noise2(c * 1.6 + 5, s * 1.6 + 5, 33) * 1.6;
      const e = -0.2 + R() * 1.6;
      const r = rho - wob + e;
      const x = Pd.cx + c * r, z = Pd.cz + s * r;
      const size = 0.55 + R() * 0.8 + (R() < 0.12 ? 0.6 : 0);
      rockInst.push({ x, z, y: groundAt(x, z) - size * 0.25, sx: size * (1 + R() * 0.5), sy: size * (0.6 + R() * 0.5), sz: size * (0.9 + R() * 0.4), ry: R() * 6.28, tilt: (R() - 0.5) * 0.4 });
      if (R() < 0.35) {
        const e2 = e + 0.8 + R() * 1.2;
        const x2 = Pd.cx + c * (rho - wob + e2), z2 = Pd.cz + s * (rho - wob + e2);
        const s2 = 0.4 + R() * 0.5;
        rockInst.push({ x: x2, z: z2, y: groundAt(x2, z2) - s2 * 0.3, sx: s2 * 1.3, sy: s2 * 0.7, sz: s2, ry: R() * 6.28, tilt: (R() - 0.5) * 0.3 });
      }
    }
    // 선산(가산): 섬 위 괴석 무더기와 선 돌
    const I = Pd.island;
    for (let q = 0; q < 16; q++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * I.r * 1.1;
      const x = I.x + Math.cos(a) * rr, z = I.z + Math.sin(a) * rr;
      const size = 0.6 + R() * 0.9;
      const standing = q < 3;
      rockInst.push({ x, z, y: groundAt(x, z) - 0.2, sx: size * (standing ? 0.7 : 1.2), sy: size * (standing ? 2.4 + R() : 0.8), sz: size * (standing ? 0.6 : 1), ry: R() * 6.28, tilt: (R() - 0.5) * (standing ? 0.25 : 0.4) });
    }
  }
  if (rockInst.length) {
    const rg = rockGeometry(3);
    const im = new THREE.InstancedMesh(rg, M.rock, rockInst.length);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
    const cc = new THREE.Color();
    const R2 = rng(4411);
    rockInst.forEach((r, k) => {
      e3.set(r.tilt, r.ry, r.tilt * 0.5);
      q4.setFromEuler(e3);
      m4.compose(v3.set(r.x, r.y, r.z), q4, s3.set(r.sx, r.sy, r.sz));
      im.setMatrixAt(k, m4);
      im.setColorAt(k, cc.setRGB(1, 1, 1).multiplyScalar(0.78 + R2() * 0.3));
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'terrain-pond-rocks';
    group.add(im);
  }

  mark('water');
  yield 'water';
  resume();
  // ── 메시 추가 ──
  const addMesh = (tris, mat, name, shadow = true) => {
    if (!tris.count) return null;
    const m = new THREE.Mesh(tris.geometry(), mat);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  const stoneTop = addMesh(tops.stone, M.topStone, 'terrace-tops-stone', false);
  const earthTop = addMesh(tops.earth, M.topEarth, 'terrace-tops-earth', false);
  const altMesh = addMesh(tops.alt, M.topStone, 'terrace-tops-paving', false);
  addMesh(walls, mats.stone, 'terrace-walls');
  addMesh(caps, mats.stoneTop, 'terrace-caps');
  addMesh(bed, mats.stoneRubble, 'channel-bed', false);
  const waterMesh = addMesh(water, M.water, 'water', false);
  if (waterMesh) {
    waterMesh.renderOrder = 1;
    const skyCol = M.water.userData.sky;
    waterMesh.onBeforeRender = (renderer, scene) => {
      const src = scene.fog ? scene.fog.color : scene.background && scene.background.isColor ? scene.background : null;
      if (src) skyCol.copy(src);
    };
  }

  // ── 공개 함수 ──
  const heightAt = (x, z) => {
    let y = model.terraceTopAt(x, z);
    const s = model.stairTopAt(x, z);
    if (!Number.isNaN(s) && !(s <= y)) y = s;
    if (!Number.isNaN(y)) return y;
    const b = model.bridgeTopAt(x, z);
    if (!Number.isNaN(b)) return b;
    return groundAt(x, z);
  };
  const naturalAt = (x, z) => model.naturalAt(x, z);
  const isOnTerrace = (x, z) => !Number.isNaN(model.terraceTopAt(x, z));
  let paveAlt = false, ruins = false;
  const applyTops = () => {
    if (stoneTop) stoneTop.material = ruins ? M.topGrass : M.topStone;
    if (earthTop) earthTop.material = ruins ? M.topGrass : M.topEarth;
    if (altMesh) altMesh.material = ruins ? M.topGrass : paveAlt ? M.topBrick : M.topStone;
  };
  const setPaving = (alt) => { paveAlt = !!alt; applyTops(); };
  // 유적 보기: 대지 윗면을 풀밭으로 (축대·계단·초석만 드러남)
  const setRuins = (on) => { ruins = !!on; applyTops(); };

  let tris = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += o.isInstancedMesh ? n * o.count : n;
  });
  const info = {
    buildMs: Math.round(performance.now() - t0 - waited),
    stageMs: stage,
    triangles: Math.round(tris),
    groundTriangles: ti.length / 3,
    wallTriangles: walls.count,
    terraceWallTriangles: wallTris0,
    clippedCells,
    drawCalls: group.children.length,
    problems,
  };
  if (problems.length) console.warn('[terrain] spec 문제:', problems.join(' / '));
  return { group, heightAt, groundAt, naturalAt, isOnTerrace, setPaving, setRuins, model, info };
}

// 괴석: 울퉁불퉁한 다면체 (결정적). 법선은 면 법선과 중심에서 바깥 방향을 반씩 섞어 모서리 느낌만 남김
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = 0.78 + 0.34 * (noise2(v.x * 1.7 + seed, v.z * 1.7 - v.y, 17) * 0.5 + 0.5);
      map.set(key, k);
    }
    v.multiplyScalar(k);
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.4;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal, n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    n.fromBufferAttribute(nor, i).lerp(v, 0.5).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}
