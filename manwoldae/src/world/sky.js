// 하늘·해/달·안개·조명·그림자 — 시간대 4가지(팔관회 아침 / 한낮 / 해질녘 / 보름달 밤)
//
// createEnvironment(renderer, scene, { spec, camera, shadowMapSize })
//   → { setTime(name, { instant }), update(dt, camera, target), sun, hemi, presets[{ name, label, subtitle, night }], current,
//       keyDirection, moonDirection, invalidateShadows(), setShadows({ enabled, mapSize }), shadowMapSize, dispose() }
//
// - 낮 하늘은 three 의 Sky(Preetham 모형), 밤은 그 위에 달·달무리·별을 그리는 반투명 돔을 겹칩니다.
// - 해 방위는 spec.modelingGuide.lighting 규칙: 진방위 A → PLAN 수평 방향 (sin(A+17°), −cos(A+17°)).
//   17° 는 spec.meta.trueNorthInPlan 에서 다시 계산해 부호를 확인합니다.
// - 그림자 카메라는 보는 곳(target)을 따라다니고, 그림자 텍셀 격자에 맞춰 움직여 반짝임을 막습니다.
//   정적인 장면이라 그림자 맵은 빛·상자가 바뀔 때만 다시 그립니다(renderer.shadowMap.autoUpdate = false).
//   상자는 원하는 중심이 지금 중심에서 0.15·half 넘게 벗어날 때만 옮깁니다 — 제자리에서 돌려 보기만 해서는 다시 그리지 않음.
// - 환경맵은 하늘 장면을 큐브 카메라로 찍어 같은 PMREM 표적에 다시 구우므로(할당·셰이더 재검사 없음) 전환 중에도 가볍습니다.
// - 안개 색은 카메라가 보는 방향의 지평선 하늘색(톤매핑 후 화면색)과 같게 맞춥니다.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { rng } from '../core/textures.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// ─────────────── 태양 위치 (간이 천문식, 지방 태양시) ───────────────
function solarPosition(latDeg, dayOfYear, solarHour) {
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10)) * DEG;
  const H = (solarHour - 12) * 15 * DEG;
  const phi = latDeg * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const cosAz = (Math.sin(decl) - Math.sin(alt) * Math.sin(phi)) / (Math.cos(alt) * Math.cos(phi));
  let az = Math.acos(clamp(cosAz, -1, 1)) / DEG;
  if (H > 0) az = 360 - az; // 오후는 서쪽
  return { az, alt: alt / DEG };
}

// ─────────────── 시간대 ───────────────
// key = 그림자를 드리우는 빛(낮: 해, 밤: 달), skySun = Sky 셰이더의 해. 색은 선형 sRGB 헥스. label = 화면에 쓰는 이름(키와 다를 때).
// 낮의 채움빛(hemi·env)은 밝은 뜰·흙바닥에서 튀어 오는 빛을 흉내 내어, 그늘진 기둥·공포 밑면(황단)도 붉은빛을 잃지 않게 함.
function makePresets(lat) {
  const winter = solarPosition(lat, 349, 9.6);    // 12월 15일 무렵(음력 11월 보름 팔관회) 오전 9시 반~10시
  const summer = solarPosition(lat, 172, 12.6);   // 하지 무렵 한낮(12시 반)
  const autumn = solarPosition(lat, 293, 16.85);  // 10월 20일 무렵 해 질 녘
  const moon = { az: 133, alt: 16 };               // 여름 보름달: 남동쪽 하늘에 떠오른 만월 (적위 약 −20°)
  return {
    '팔관회 아침': {
      subtitle: '동짓달 오전 · 남동쪽 낮은 햇빛',
      key: winter, skySun: winter, night: 0,
      turbidity: 2.0, rayleigh: 1.9, mie: 0.0028, mieG: 0.82, skyGain: 0.86,
      lightColor: '#ffe0bd', lightIntensity: 3.9,
      hemiSky: '#c4d0e0', hemiGround: '#a89478', hemiIntensity: 1.05,
      envIntensity: 0.85, envGround: [0.22, 0.19, 0.15],
      exposure: 0.52, fogDensity: 0.00034, stars: 0,
    },
    '한낮': {
      subtitle: '여름 한낮 · 높이 뜬 해',
      key: summer, skySun: summer, night: 0,
      turbidity: 3.6, rayleigh: 1.6, mie: 0.0038, mieG: 0.8, skyGain: 0.84,
      lightColor: '#fff3e2', lightIntensity: 4.3,
      hemiSky: '#dfe3e8', hemiGround: '#b4a282', hemiIntensity: 0.95,
      envIntensity: 0.75, envGround: [0.27, 0.24, 0.19],
      exposure: 0.43, fogDensity: 0.00032, stars: 0,
    },
    '해질녘': {
      label: '해 질 녘',
      subtitle: '가을 해 질 녘 · 서남서로 지는 해',
      key: autumn, skySun: autumn, night: 0,
      turbidity: 6.5, rayleigh: 2.8, mie: 0.006, mieG: 0.86, skyGain: 1.0,
      lightColor: '#ffa45e', lightIntensity: 4.4,
      hemiSky: '#b7b2d2', hemiGround: '#6e5040', hemiIntensity: 0.48,
      envIntensity: 0.6, envGround: [0.09, 0.065, 0.045],
      exposure: 0.62, fogDensity: 0.00038, stars: 0,
    },
    '보름달 밤': {
      subtitle: '여름 보름달 · 남동쪽 하늘에 떠오른 만월',
      key: moon, skySun: { az: moon.az + 180, alt: -24 }, night: 1, moon,
      turbidity: 2, rayleigh: 1, mie: 0.004, mieG: 0.8, skyGain: 1.0,
      lightColor: '#a9bfe8', lightIntensity: 2.6,
      hemiSky: '#4a6490', hemiGround: '#1a1e26', hemiIntensity: 0.9,
      envIntensity: 1.0, envGround: [0.004, 0.005, 0.007],
      exposure: 1.05, fogDensity: 0.00042, stars: 1,
    },
  };
}
export const DEFAULT_TIME = '팔관회 아침';

// ─────────────── Preetham 하늘을 CPU 에서 (안개 색 계산용, Sky.js 셰이더와 같은 식) ───────────────
const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const SKY_BIAS = [0, 0.0003, 0.00075];
function skyRadiance(dir, sunDir, p, out) {
  const cutoff = 1.6110731556870734;
  const zc = clamp(sunDir.y, -1, 1);
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((cutoff - Math.acos(zc)) / 1.5)));
  const sunfade = 1 - clamp(1 - Math.exp(sunDir.y / 450000), 0, 1);
  const rc = p.rayleigh - (1 - sunfade);
  const cM = 0.2 * p.turbidity * 10e-18;
  const zen = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen / DEG, -1.253));
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const cosT = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieG, g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const mixK = clamp(Math.pow(1 - sunDir.y, 5), 0, 1);
  const pw = 1 / (1.2 + 1.2 * sunfade);
  for (let i = 0; i < 3; i++) {
    const bR = TR[i] * rc, bM = 0.434 * cM * MIE[i] * p.mie;
    const fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= lerp(1, Math.pow(sunE * ratio * fex, 0.5), mixK);
    const tex = (lin + 0.1 * fex) * 0.04 + SKY_BIAS[i];
    out[i] = Math.pow(Math.max(tex, 0), pw);
  }
  return out;
}
// 톤 매핑: three 의 ACES 곡선 앞에 박명시(薄明視) 보정 — 어두운 곳일수록 채도가 빠지고 푸르스름해집니다.
// 낮의 밝은 면은 그대로, 달밤은 달밤답게. (셰이더와 CPU 안개색 계산이 같은 식을 씁니다)
const MESOPIC = { lo: 0.004, hi: 0.09, floor: 0.35, tint: [0.8, 0.93, 1.22] };
const TONEMAP_GLSL = /* glsl */`
vec3 CustomToneMapping( vec3 color ) {
  vec3 c = color * toneMappingExposure;
  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float k = ${MESOPIC.floor.toFixed(3)} + ${(1 - MESOPIC.floor).toFixed(3)} * smoothstep( ${MESOPIC.lo.toFixed(4)}, ${MESOPIC.hi.toFixed(4)}, lum );
  c = mix( lum * vec3( ${MESOPIC.tint.map((v) => v.toFixed(3)).join(', ')} ), c, k );
  return ACESFilmicToneMapping( c / max( toneMappingExposure, 1e-4 ) );
}`;
let toneMapPatched = null;
function patchToneMapping() {
  if (toneMapPatched !== null) return toneMapPatched;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  toneMapPatched = chunk.includes(stub) && chunk.includes('vec3 ACESFilmicToneMapping');
  if (toneMapPatched) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, TONEMAP_GLSL);
  else console.warn('[sky] 톤 매핑 조각 모양이 달라 ACES 만 씁니다');
  return toneMapPatched;
}
// 위 톤 매핑 + sRGB 인코딩 → 화면색(0..1)
function acesDisplay(c, exposure, out) {
  let r = c[0] * exposure, g = c[1] * exposure, b = c[2] * exposure;
  if (toneMapPatched) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const t = clamp((lum - MESOPIC.lo) / (MESOPIC.hi - MESOPIC.lo), 0, 1);
    const k = MESOPIC.floor + (1 - MESOPIC.floor) * t * t * (3 - 2 * t);
    r = lerp(lum * MESOPIC.tint[0], r, k); g = lerp(lum * MESOPIC.tint[1], g, k); b = lerp(lum * MESOPIC.tint[2], b, k);
  }
  r /= 0.6; g /= 0.6; b /= 0.6;
  const a0 = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const a1 = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const a2 = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const f = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const t0 = f(a0), t1 = f(a1), t2 = f(a2);
  const enc = (x) => { const v = clamp(x, 0, 1); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
  out[0] = enc(1.60475 * t0 - 0.53108 * t1 - 0.07367 * t2);
  out[1] = enc(-0.10208 * t0 + 1.10813 * t1 - 0.00605 * t2);
  out[2] = enc(-0.00327 * t0 - 0.07276 * t1 + 1.07602 * t2);
  return out;
}

// ─────────────── 밤하늘 돔: 밤빛 그라데이션 + 달(바다 무늬) + 달무리 ───────────────
const NIGHT_VERT = /* glsl */`
varying vec3 vWorldPosition;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPosition = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;
}`;
const NIGHT_FRAG = /* glsl */`
uniform float uNight;
uniform float uDisk;
uniform vec3 uMoonDir;
uniform vec3 uMoonRight;
uniform vec3 uMoonUp;
uniform float uMoonRadius;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uMoonColor;
varying vec3 vWorldPosition;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}
float blob(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float h = dir.y;
  // 지평선은 옅은 청회색, 천정은 짙은 남색
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col *= mix(0.55, 1.0, smoothstep(-0.25, 0.0, h));
  // 달빛 산란(넓은 빛무리 + 가까운 달무리)
  float c = clamp(dot(dir, uMoonDir), -1.0, 1.0);
  float ang = acos(c);
  float wide = exp(-ang * 2.3) * (0.55 + 0.45 * smoothstep(-0.05, 0.25, h));
  float nearGlow = exp(-ang * ang / (2.0 * 0.045 * 0.045));
  float ring = exp(-pow((ang - 0.384) / 0.03, 2.0)) * 0.022; // 22° 달무리 (아주 옅게)
  col += uGlow * (0.16 * wide + 0.9 * nearGlow + ring);
  // 옅은 구름 띠 (달빛에 가장자리가 밝다)
  vec2 sp = dir.xz / max(h + 0.12, 0.05);
  float cl = smoothstep(0.52, 0.8, fbm(sp * 0.9 + vec2(3.0, 1.0))) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.35, 0.7, h));
  col = mix(col, uHorizon * 1.2 + uGlow * (0.25 * wide + 1.2 * nearGlow), cl * 0.5);
  // 달 원반
  vec2 q = vec2(dot(dir, uMoonRight), dot(dir, uMoonUp)) / uMoonRadius;
  float r = length(q);
  if (r < 1.2 && c > 0.0) {
    float disk = smoothstep(1.0, 0.965, r);
    float limb = mix(0.78, 1.0, sqrt(max(0.0, 1.0 - r * r)));
    // 바다(어두운 무늬) — 방아 찧는 토끼로 보던 그 무늬
    float mare = 0.0;
    mare += blob(q, vec2(-0.38, 0.34), vec2(0.30, 0.26));  // 비의 바다
    mare += blob(q, vec2(0.12, 0.34), vec2(0.20, 0.17));   // 맑음의 바다
    mare += blob(q, vec2(0.30, 0.08), vec2(0.24, 0.20));   // 고요의 바다
    mare += blob(q, vec2(0.62, 0.18), vec2(0.12, 0.10));   // 위기의 바다
    mare += blob(q, vec2(0.48, -0.26), vec2(0.15, 0.14));  // 풍요의 바다
    mare += blob(q, vec2(0.24, -0.34), vec2(0.10, 0.09));  // 신주의 바다
    mare += blob(q, vec2(-0.58, -0.05), vec2(0.26, 0.46)); // 폭풍의 대양
    mare += blob(q, vec2(-0.28, -0.52), vec2(0.13, 0.11)); // 습기의 바다
    mare = clamp(mare, 0.0, 1.0) * (0.75 + 0.5 * fbm(q * 5.0));
    vec3 moon = uMoonColor * limb * (1.0 - 0.32 * mare);
    moon *= 0.92 + 0.08 * fbm(q * 11.0 + 3.0);
    col = mix(col, moon, disk * uDisk);
  }
  gl_FragColor = vec4(col, uNight);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ─────────────── 별 ───────────────
const STAR_VERT = /* glsl */`
attribute float size;
attribute float bright;
uniform float uPixelRatio;
uniform float uStars;
uniform vec3 uMoonDir;
varying float vB;
varying vec3 vCol;
attribute vec3 tint;
void main() {
  vec3 d = normalize(position);
  float alt = d.y;
  float moonFade = smoothstep(0.12, 0.6, acos(clamp(dot(d, uMoonDir), -1.0, 1.0)));
  float ext = smoothstep(-0.01, 0.2, alt);
  vB = bright * uStars * moonFade * ext;
  vCol = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio;
}`;
const STAR_FRAG = /* glsl */`
varying float vB;
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0 || vB < 0.003) discard;
  float a = exp(-r2 * 3.2) * vB;
  gl_FragColor = vec4(vCol * a, a);
}`;

function makeStars(count, seed) {
  const rand = rng(seed);
  const pos = new Float32Array(count * 3), size = new Float32Array(count), bright = new Float32Array(count), tint = new Float32Array(count * 3);
  const cA = new THREE.Color('#bcd0ff'), cB = new THREE.Color('#fff4e0'), cC = new THREE.Color('#ffd7a8'), tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // 윗반구에 고르게 (고도 −3° 이상)
    const u = rand(), v = rand();
    const y = -0.05 + 1.05 * u;
    const th = 2 * Math.PI * v, r = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = r * Math.cos(th); pos[i * 3 + 1] = y; pos[i * 3 + 2] = r * Math.sin(th);
    const m = Math.pow(rand(), 5.5);     // 밝은 별은 드물게
    bright[i] = 0.12 + 0.95 * m;
    size[i] = 1.4 + 3.2 * m;
    const k = rand();
    tmp.copy(k < 0.3 ? cA : k < 0.85 ? cB : cC);
    tint[i * 3] = tmp.r; tint[i * 3 + 1] = tmp.g; tint[i * 3 + 2] = tmp.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('bright', new THREE.BufferAttribute(bright, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  return g;
}

// ─────────────── 본체 ───────────────
export function createEnvironment(renderer, scene, opts = {}) {
  const spec = opts.spec || {};
  const L = spec.modelingGuide?.lighting || {};
  const lat = L.latitude ?? spec.meta?.originLatLon?.[0] ?? 37.985;
  // 진북 보정각: trueNorthInPlan = (sin θ, −cos θ) 에서 θ 를 구해 규칙(17°)과 대조
  let north = L.trueNorthOffsetDeg ?? 17;
  const tn = spec.meta?.trueNorthInPlan;
  if (Array.isArray(tn) && tn.length === 2) {
    const fromVec = Math.atan2(tn[0], -tn[1]) / DEG;
    if (Math.abs(fromVec - north) > 0.5) console.warn(`[sky] trueNorthInPlan(${fromVec.toFixed(1)}°) 과 lighting.trueNorthOffsetDeg(${north}°) 가 다릅니다 — 벡터 값을 씁니다`);
    north = fromVec;
  }
  const dirFrom = (azTrue, alt, out) => {
    const A = (azTrue + north) * DEG, h = alt * DEG;
    return out.set(Math.sin(A) * Math.cos(h), Math.sin(h), -Math.cos(A) * Math.cos(h));
  };

  const PRESETS = makePresets(lat);
  const names = Object.keys(PRESETS);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.toneMapping = patchToneMapping() ? THREE.CustomToneMapping : THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'environment';
  scene.add(group);

  // ── 하늘 (Sky.js, 해 원반 세기를 uniform 으로 조절하도록 조금 고침) ──
  const SS = Sky.SkyShader;
  let frag = SS.fragmentShader;
  const diskLine = 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;';
  const patched = frag.includes(diskLine);
  if (patched) {
    frag = frag.replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\n\t\tuniform float sunDisk;\n\t\tuniform float skyGain;')
      .replace(diskLine, 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * sunDisk;')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
  } else console.warn('[sky] Sky 셰이더 모양이 달라 해 원반을 끄지 못합니다');
  const skyMat = new THREE.ShaderMaterial({
    name: 'SkyShader', uniforms: THREE.UniformsUtils.merge([SS.uniforms, { sunDisk: { value: 1 }, skyGain: { value: 1 } }]),
    vertexShader: SS.vertexShader, fragmentShader: frag, side: THREE.BackSide, depthWrite: false,
  });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sky = new THREE.Mesh(box, skyMat);
  sky.name = 'sky';
  sky.scale.setScalar(40000);
  sky.renderOrder = 1e6; // 불투명 물체 뒤에 그려 덮어 그리기를 줄임
  sky.frustumCulled = false;
  group.add(sky);

  // ── 밤하늘 돔 ──
  const nightU = {
    uNight: { value: 0 }, uDisk: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonRight: { value: new THREE.Vector3(1, 0, 0) }, uMoonUp: { value: new THREE.Vector3(0, 1, 0) },
    uMoonRadius: { value: 1.2 * DEG },
    uZenith: { value: new THREE.Color(0.0055, 0.011, 0.03) },
    uHorizon: { value: new THREE.Color(0.028, 0.045, 0.078) },
    uGlow: { value: new THREE.Color(0.24, 0.24, 0.23) },
    uMoonColor: { value: new THREE.Color(1.35, 1.2, 0.95) },
  };
  const nightMat = new THREE.ShaderMaterial({
    name: 'NightSky', uniforms: nightU, vertexShader: NIGHT_VERT, fragmentShader: NIGHT_FRAG,
    side: THREE.BackSide, depthWrite: false, transparent: true, fog: false,
  });
  const nightDome = new THREE.Mesh(box, nightMat);
  nightDome.name = 'night-sky';
  nightDome.scale.setScalar(40000);
  nightDome.renderOrder = -10;
  nightDome.frustumCulled = false;
  nightDome.visible = false;
  group.add(nightDome);

  // ── 별 ──
  const starU = { uPixelRatio: { value: renderer.getPixelRatio() }, uStars: { value: 0 }, uMoonDir: nightU.uMoonDir };
  const stars = new THREE.Points(makeStars(1900, 1123), new THREE.ShaderMaterial({
    name: 'Stars', uniforms: starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  stars.visible = false;
  group.add(stars);

  // ── 빛 ──
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.name = 'sun';
  sun.castShadow = true;
  const isMobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let mapSize = opts.shadowMapSize || (isMobile ? 2048 : 4096);
  mapSize = Math.min(mapSize, renderer.capabilities.maxTextureSize || 4096);
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.05;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  hemi.name = 'hemi';
  group.add(hemi);

  const fog = new THREE.FogExp2(0xa9c3d6, 0.00025);
  scene.fog = fog;

  // ── 환경맵(PMREM): 하늘 + 땅 반사색 원판 ──
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.5, 6000, cubeRT);
  const envSky = new THREE.Mesh(box, skyMat);
  const envNight = new THREE.Mesh(box, nightMat);
  envNight.renderOrder = 1;
  const envGroundMat = new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide });
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(4000, 48).rotateX(-Math.PI / 2), envGroundMat);
  envGround.position.y = -2;
  envScene.add(envSky, envNight, envGround);
  let envRT = null;

  // ── 상태 (전환 중에는 from → to 로 보간) ──
  const mk = () => ({
    keyAz: 0, keyAlt: 30, skyAz: 0, skyAlt: 30, night: 0, turbidity: 2, rayleigh: 1, mie: 0.005, mieG: 0.8, skyGain: 1,
    lightColor: new THREE.Color(), lightIntensity: 3, hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0.5,
    envIntensity: 0.6, envGround: new THREE.Color(), exposure: 0.6, fogDensity: 0.00025, stars: 0, moonAz: 84, moonAlt: 17,
  });
  const S = mk(), A = mk(), B = mk();
  const load = (dst, p) => {
    dst.keyAz = p.key.az; dst.keyAlt = p.key.alt; dst.skyAz = p.skySun.az; dst.skyAlt = p.skySun.alt;
    dst.night = p.night; dst.turbidity = p.turbidity; dst.rayleigh = p.rayleigh; dst.mie = p.mie; dst.mieG = p.mieG; dst.skyGain = p.skyGain ?? 1;
    dst.lightColor.set(p.lightColor); dst.lightIntensity = p.lightIntensity;
    dst.hemiSky.set(p.hemiSky); dst.hemiGround.set(p.hemiGround); dst.hemiIntensity = p.hemiIntensity;
    dst.envIntensity = p.envIntensity; dst.envGround.setRGB(...p.envGround); dst.exposure = p.exposure;
    dst.fogDensity = p.fogDensity; dst.stars = p.stars;
    const m = p.moon || PRESETS['보름달 밤'].moon;
    dst.moonAz = m.az; dst.moonAlt = m.alt;
  };
  const angLerp = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
  const copyMix = (dst, a, b, t) => {
    for (const k of ['keyAlt', 'skyAlt', 'night', 'turbidity', 'rayleigh', 'mie', 'mieG', 'skyGain', 'lightIntensity', 'hemiIntensity', 'envIntensity', 'exposure', 'fogDensity', 'stars', 'moonAlt']) dst[k] = lerp(a[k], b[k], t);
    dst.keyAz = angLerp(a.keyAz, b.keyAz, t); dst.skyAz = angLerp(a.skyAz, b.skyAz, t); dst.moonAz = angLerp(a.moonAz, b.moonAz, t);
    for (const k of ['lightColor', 'hemiSky', 'hemiGround', 'envGround']) dst[k].copy(a[k]).lerp(b[k], t);
  };

  const keyDir = new THREE.Vector3(0, 1, 0);
  const skySunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3(0, 1, 0);
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const upY = new THREE.Vector3(0, 1, 0);
  const rad = [0, 0, 0], disp = [0, 0, 0], dispN = [0, 0, 0];
  const lastFogDir = new THREE.Vector3(9, 9, 9);
  let version = 0;

  function apply() {
    dirFrom(S.keyAz, S.keyAlt, keyDir);
    dirFrom(S.skyAz, S.skyAlt, skySunDir);
    dirFrom(S.moonAz, S.moonAlt, moonDir);
    const u = skyMat.uniforms;
    u.turbidity.value = S.turbidity; u.rayleigh.value = S.rayleigh;
    u.mieCoefficient.value = S.mie; u.mieDirectionalG.value = S.mieG;
    if (u.skyGain) u.skyGain.value = S.skyGain;
    u.sunPosition.value.copy(skySunDir);
    // 달 좌표축
    nightU.uMoonDir.value.copy(moonDir);
    nightU.uMoonRight.value.crossVectors(moonDir, upY).normalize().negate();
    nightU.uMoonUp.value.crossVectors(nightU.uMoonRight.value, moonDir).normalize();
    nightU.uNight.value = S.night;
    nightDome.visible = S.night > 0.002;
    starU.uStars.value = S.stars;
    stars.visible = S.stars > 0.01;
    sun.color.copy(S.lightColor);
    // 빛이 지평선 아래로 내려가면 약하게
    sun.intensity = S.lightIntensity * smooth(clamp((S.keyAlt + 1) / 6, 0, 1));
    hemi.color.copy(S.hemiSky); hemi.groundColor.copy(S.hemiGround); hemi.intensity = S.hemiIntensity;
    scene.environmentIntensity = S.envIntensity;
    envGroundMat.color.copy(S.envGround);
    renderer.toneMappingExposure = S.exposure;
    fog.density = S.fogDensity;
    lastFogDir.set(9, 9, 9); // 안개 색 다시 계산
    version++;
  }

  function regenEnv() {
    skyMat.uniforms.sunDisk.value = 0;
    nightU.uDisk.value = 0;
    envNight.visible = S.night > 0.002;
    cubeCam.update(renderer, envScene);
    // 처음 한 번만 표적을 만들고, 그다음부터는 같은 표적에 다시 구움 → scene.environment 텍스처가 그대로라 재질 셰이더 재검사 없음
    envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
    skyMat.uniforms.sunDisk.value = 1;
    nightU.uDisk.value = 1;
    if (scene.environment !== envRT.texture) scene.environment = envRT.texture;
  }

  // 카메라가 보는 방향 지평선의 화면색 → 안개 색
  function updateFog(camera) {
    camera.getWorldDirection(tmpV);
    tmpV.y = 0;
    if (tmpV.lengthSq() < 1e-6) tmpV.set(0, 0, -1);
    tmpV.normalize();
    if (tmpV.distanceToSquared(lastFogDir) < 1e-4) return;
    lastFogDir.copy(tmpV);
    tmpV.y = 0.035;
    tmpV.normalize();
    skyRadiance(tmpV, skySunDir, S, rad);
    if (patched) { rad[0] *= S.skyGain; rad[1] *= S.skyGain; rad[2] *= S.skyGain; }
    acesDisplay(rad, S.exposure, disp);
    if (S.night > 0) {
      // 밤 돔의 지평선 부근 색 (셰이더와 같은 근사)
      const h = nightU.uHorizon.value, z = nightU.uZenith.value, gl = nightU.uGlow.value;
      const tt = Math.pow(tmpV.y, 0.42);
      const ang = Math.acos(clamp(tmpV.dot(moonDir), -1, 1));
      const wide = Math.exp(-ang * 2.3) * (0.55 + 0.45 * smooth(clamp((tmpV.y + 0.05) / 0.3, 0, 1)));
      rad[0] = lerp(h.r, z.r, tt) + gl.r * 0.16 * wide;
      rad[1] = lerp(h.g, z.g, tt) + gl.g * 0.16 * wide;
      rad[2] = lerp(h.b, z.b, tt) + gl.b * 0.16 * wide;
      acesDisplay(rad, S.exposure, dispN);
      for (let i = 0; i < 3; i++) disp[i] = lerp(disp[i], dispN[i], S.night);
    }
    fog.color.setRGB(disp[0], disp[1], disp[2], THREE.SRGBColorSpace);
  }

  // ── 그림자 상자: 보는 곳을 따라, 텍셀 격자에 맞춰 ──
  const shadowState = { cx: NaN, cy: NaN, cz: NaN, half: 0, halfV: 0, key: new THREE.Vector3() };
  const lookM = new THREE.Matrix4();
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
  const center = new THREE.Vector3();
  function updateShadow(camera, target) {
    if (!sun.castShadow) return;
    const dist = camera.position.distanceTo(target);
    const half = dist < 260 ? 175 : dist < 650 ? 300 : 520;
    // 카메라 쪽으로 조금 당긴 중심
    center.copy(camera.position).sub(target);
    center.y = 0;
    const sh = Math.min(center.length() * 0.3, half * 0.55);
    if (center.lengthSq() > 1e-6) center.normalize().multiplyScalar(sh);
    center.add(target);
    const sinA = Math.max(Math.sin(Math.max(S.keyAlt, 2) * DEG), 0.035);
    const halfV = Math.min(half, half * sinA * 1.25 + 40 * Math.sqrt(1 - sinA * sinA));
    // 빛 공간 축 (Matrix4.lookAt 과 같은 규칙: z = 빛 방향, x = up × z, y = z × x)
    az.copy(keyDir);
    lookM.lookAt(tmpV2.set(0, 0, 0).add(az), tmpV.set(0, 0, 0), upY);
    ax.setFromMatrixColumn(lookM, 0); ay.setFromMatrixColumn(lookM, 1);
    const tx = (2 * half) / sun.shadow.mapSize.x, ty = (2 * halfV) / sun.shadow.mapSize.y;
    let px = center.dot(ax), py = center.dot(ay);
    const pz = center.dot(az);
    // 같은 크기·빛이고 원하는 중심이 지금 상자 중심 가까이(0.15·half)면 그대로 — 돌려 보기·작은 이동으로는 다시 그리지 않음
    const hold = half === shadowState.half && Math.abs(halfV - shadowState.halfV) < 0.05 * half && shadowState.key.equals(keyDir)
      && Math.abs(px - shadowState.cx) < 0.15 * half && Math.abs(py - shadowState.cy) < 0.15 * halfV && Math.abs(pz - shadowState.cz) < 30;
    if (hold) return;
    px = Math.round(px / tx) * tx;
    py = Math.round(py / ty) * ty;
    shadowState.cx = px; shadowState.cy = py; shadowState.cz = pz; shadowState.half = half; shadowState.halfV = halfV;
    shadowState.key.copy(keyDir);
    center.copy(ax).multiplyScalar(px).addScaledVector(ay, py).addScaledVector(az, pz);
    const D = half * 2 + 400;
    const R = half * 1.4 + 220;
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(keyDir, D);
    const cam = sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = halfV; cam.bottom = -halfV;
    cam.near = Math.max(1, D - R); cam.far = D + R;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    const texel = Math.max(tx, ty);
    sun.shadow.normalBias = clamp(texel * 0.9, 0.03, 0.4);
    sun.shadow.bias = -0.00006 * (600 / (2 * R)) - 0.00003;
    renderer.shadowMap.needsUpdate = true;
  }

  // ── 전환 ──
  let current = DEFAULT_TIME;
  let tr = null; // { t0, dur, lastEnv }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function setTime(name, o = {}) {
    if (!PRESETS[name]) { console.warn('[sky] 모르는 시간대:', name); return current; }
    const instant = !!(o.instant || reduceMotion);
    current = name;
    load(B, PRESETS[name]);
    if (instant) {
      copyMix(S, B, B, 1);
      tr = null;
      apply();
      regenEnv();
    } else {
      copyMix(A, S, S, 1);
      tr = { t0: now(), dur: o.duration ?? 1500, env: 0 };
    }
    renderer.shadowMap.needsUpdate = true;
    return current;
  }
  load(S, PRESETS[DEFAULT_TIME]);
  apply();
  regenEnv();

  const camFallback = new THREE.Vector3();
  function update(dt, camera, target) {
    camera = camera || opts.camera;
    let busy = false;
    if (tr) {
      const t = clamp((now() - tr.t0) / tr.dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      copyMix(S, A, B, e);
      apply();
      // 환경맵은 전환 중 두 번(1/3·2/3)과 끝에서만 다시 구움 (세기는 environmentIntensity 로 매 프레임 보간)
      if (t >= 1) { tr = null; regenEnv(); } else if (t >= (tr.env + 1) / 3) { regenEnv(); tr.env++; }
      busy = true;
    }
    if (camera) {
      if (!target) {
        camera.getWorldDirection(camFallback);
        target = camFallback.multiplyScalar(60).add(camera.position);
      }
      updateShadow(camera, target);
      updateFog(camera);
      stars.position.copy(camera.position);
      const R = Math.min(camera.far * 0.92, 20000);
      if (stars.scale.x !== R) stars.scale.setScalar(R);
      starU.uPixelRatio.value = renderer.getPixelRatio();
    }
    return busy;
  }

  function setShadows({ enabled, mapSize: ms } = {}) {
    if (typeof enabled === 'boolean') { sun.castShadow = enabled; if (enabled) shadowState.half = 0; }
    if (ms && ms !== sun.shadow.mapSize.x) {
      const n = Math.min(ms, renderer.capabilities.maxTextureSize || 4096);
      sun.shadow.mapSize.set(n, n);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      shadowState.half = 0;
    }
    renderer.shadowMap.needsUpdate = true;
  }

  const env = {
    sun, hemi, sky, stars, fog,
    presets: names.map((n) => ({ name: n, label: PRESETS[n].label || n, subtitle: PRESETS[n].subtitle, night: !!PRESETS[n].night })),
    get shadowMapSize() { return sun.shadow.mapSize.x; },
    get current() { return current; },
    get transitioning() { return !!tr; },
    get version() { return version; },
    keyDirection: keyDir,
    sunDirection: skySunDir,
    moonDirection: moonDir,
    northOffsetDeg: north,
    setTime,
    update,
    setMoving(v) { opts.moving = v; },
    // 그림자 맵을 다음 프레임에 다시 그림 (보이는 물체·LOD 단계가 바뀌었을 때, GL 문맥을 되찾았을 때)
    invalidateShadows() { renderer.shadowMap.needsUpdate = true; },
    setShadows,
    // 개발용: 현재 시간대 값을 바꿔 바로 적용 (예: env.tune({ exposure: 0.5 }))
    tune(o = {}) {
      Object.assign(PRESETS[current], o);
      setTime(current, { instant: true });
      return PRESETS[current];
    },
    dispose() {
      if (envRT) envRT.dispose();
      cubeRT.dispose();
      pmrem.dispose();
      box.dispose(); skyMat.dispose(); nightMat.dispose(); stars.geometry.dispose(); stars.material.dispose();
      envGround.geometry.dispose(); envGroundMat.dispose();
      scene.remove(group);
    },
  };
  return env;
}
