// 고려 목조건축 생성기 — 기단·초석·배흘림기둥·주심포 공포·창방·포벽·창호·겹처마(서까래·부연·선자연)·
// 팔작/우진각/사모/맞배 지붕·치미·화주·편액·2층 누문(하층 차양 + 평좌 난간)
//
//   createBuilding(def, mats, opts) → THREE.Group (월드 좌표에 배치, 정면 = 로컬 +z)
//     children: 'foundation' (기단·월대·계단·초석) / 'superstructure' (목조·벽·지붕)
//   createBuildingLOD(def, mats, opts) → THREE.LOD (high / medium / low)
//
// 치수 규칙은 spec.modelingGuide(column·bracket·roof·twoStoryGatehouse·platforms·dancheong12thCentury)를 따릅니다.
import * as THREE from 'three';
import { GeoSink } from './building-geo.js';
import { RoofShape, buildRoof } from './roof.js';
import {
  member, platformBox, platformStair, plinth, column, bracketSet, cornerBracket, bayInfill, railing,
  plaqueTexture, plaque, halberdRack, pobyeokTexture,
} from './building-parts.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ─────────────── 재질 (mats 마다 한 번) ───────────────
const cache = new WeakMap();
function buildingMats(mats) {
  let m = cache.get(mats);
  if (m) return m;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...o });
  m = {
    painted: std({ vertexColors: true, roughness: 0.72 }),                       // 석간주·황단·백분·주칠·처마 밑 (정점색)
    stoneV: std({ vertexColors: true, roughness: 0.93 }),                        // 갑석·계단·초석·지대석 (정점색 화강암)
    trimGray: std({ vertexColors: true, roughness: 0.8 }),                       // 마루·막새·치미 (회흑)
    trimCeladon: std({ vertexColors: true, roughness: 0.42, metalness: 0.04 }),  // 청자 기와 마루
    plaques: new Map(),
    colors: new Map(),
    pobyeok: null,
  };
  cache.set(mats, m);
  return m;
}

function colorsFor(mats, celadon) {
  const bm = buildingMats(mats);
  const key = celadon ? 'c' : 'g';
  if (bm.colors.has(key)) return bm.colors.get(key);
  const P = mats.palette || {};
  const c = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const C = {
    timber: c(P.timberRed || '#8C3A2B'), timberDark: c(P.timberRed || '#8C3A2B', 0.6), hwangdan: c(P.hwangdan || '#D4622B'),
    white: c(P.baekbun || '#EFE8D8'), lacquer: c(P.lacquerRed || '#B8322A'), lacquerDark: c(P.lacquerRed || '#B8322A', 0.62),
    ink: c(P.meok || '#1F1B18'), plaster: c(P.plasterWall || '#E6DFCF'), floor: c(P.windowWood || '#8A6A48', 0.8),
    granite: c(P.granite || '#A9A59C'), graniteW: c(P.graniteWeathered || '#8E8A82'), under: c('#8a5a3f'),
    ridge: celadon ? c(P.celadonTileShadow || '#6E9887') : c(P.roofTileShadow || '#3F4244'),
    ridgeDark: celadon ? c(P.celadonTileShadow || '#6E9887', 0.72) : c(P.roofTileShadow || '#3F4244', 0.7),
    eave: celadon ? c(P.celadonTileShadow || '#6E9887', 0.95) : c(P.roofTile || '#5A5D5E', 0.85),
    eaveLight: celadon ? c(P.celadonTile || '#8FB8A6') : c(P.roofTileHighlight || '#72767A'),
    chimi: celadon ? c(P.celadonTile || '#8FB8A6', 0.9) : c(P.roofTile || '#5A5D5E', 0.95),
  };
  bm.colors.set(key, C);
  return C;
}

function pobyeokMat(mats) {
  const bm = buildingMats(mats);
  if (!bm.pobyeok) {
    const P = { plasterWall: '#E6DFCF', timberRed: '#8C3A2B', baekbun: '#EFE8D8', yangrok: '#3F8F55', gunCheong: '#2C4A8A', seokhwang: '#D8A840', lacquerRed: '#B8322A', ...(mats.palette || {}) };
    bm.pobyeok = new THREE.MeshStandardMaterial({ map: pobyeokTexture(P), roughness: 0.95 });
  }
  return bm.pobyeok;
}

function plaqueMat(mats, text) {
  const bm = buildingMats(mats);
  if (bm.plaques.has(text)) return bm.plaques.get(text);
  const P = { lacquerRed: '#B8322A', gold: '#C8A245', gunCheong: '#2C4A8A', yangrok: '#3F8F55', ...(mats.palette || {}) };
  const { tex } = plaqueTexture(text, P);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.05 });
  bm.plaques.set(text, mat);
  return mat;
}

// ─────────────── 치수 유도 ───────────────
function bayList(arr, n, w, span) {
  if (Array.isArray(arr) && arr.length && arr.every((v) => v > 0)) return arr.slice();
  const k = Math.max(1, Math.round(n || 1));
  const bw = w > 0 ? w : (span > 0 ? span / k : 3);
  return new Array(k).fill(bw);
}
const cumulative = (bays) => {
  const W = sum(bays);
  const out = [-W / 2];
  for (const b of bays) out.push(out[out.length - 1] + b);
  return out;
};
const HANJA = /^[㐀-鿿豈-﫿]{2,4}$/;

function derive(def, opts) {
  const warn = [];
  const rank = clamp(Math.round(def.rank ?? 3), 1, 4);
  const kind = ['hall', 'gate', 'gatehouse', 'pavilion'].includes(def.kind) ? def.kind : 'hall';
  if (def.kind && kind !== def.kind) warn.push(`kind '${def.kind}' → hall`);
  const bw = bayList(def.bayWidthsFront, def.baysFront, def.bayWidth, def.columnSpanW);
  const bd = bayList(def.bayWidthsSide, def.baysSide, def.bayDepth, def.columnSpanD);
  const W = sum(bw), D = sum(bd);
  if (def.columnSpanW && Math.abs(def.columnSpanW - W) > 0.05) warn.push(`columnSpanW ${def.columnSpanW} ≠ Σ bayWidthsFront ${W.toFixed(2)}`);
  const H = def.columnHeight > 0 ? def.columnHeight : (kind === 'pavilion' ? 2.8 : 3.5);
  const Dm = H / (rank <= 2 ? 7.5 : 8.5);
  const ph = Math.max(0.12, def.platformHeight ?? 0.5);
  const plinthD = def.plinthDiameter > 0 ? def.plinthDiameter : 1.6 * Dm;
  const need = (span) => span + 2 * (plinthD / 2 + 0.03);
  let pw = def.platformW ?? need(W) + 1, pd = def.platformD ?? need(D) + 1;
  if (pw < need(W)) { warn.push(`platformW ${pw} too tight → ${need(W).toFixed(2)}`); pw = need(W); }
  if (pd < need(D)) { warn.push(`platformD ${pd} too tight → ${need(D).toFixed(2)}`); pd = need(D); }
  let roof = ['hip-gable', 'hip', 'gable'].includes(def.roof) ? def.roof : 'hip-gable';
  if (def.roof && roof !== def.roof) warn.push(`roof '${def.roof}' → hip-gable`);
  const celadon = def.roofTileColor === 'celadonTile' || !!(opts.celadon && def.celadonOption);
  const dapo = rank <= 2 && (opts.dapo === true || def.bracket === 'dapo');
  const stories = kind === 'gatehouse' && (def.stories ?? 1) >= 2 ? 2 : 1;
  const plaqueText = rank <= 3 && kind !== 'pavilion' && HANJA.test(def.nameHanja || '') ? def.nameHanja : null;
  return {
    rank, kind, bw, bd, W, D, H, Dm, ph, plinthD, pw, pd, roof, celadon, dapo, stories, plaqueText, warn,
    xs: cumulative(bw), zs: cumulative(bd),
    boost: !!def.dancheongBoost, dc14: !!opts.dancheong14,
  };
}

// 몸채 설정 (한 층)
function bodyConfig(P, o) {
  const rank = o.rank ?? P.rank;
  const H = o.H;
  const Dm = H / (rank <= 2 ? 7.5 : 8.5);
  const n = o.n ?? (rank <= 2 ? 2 : rank === 3 ? 1 : 0);
  return {
    xs: o.xs, zs: o.zs, yb: o.yb, H, Dm, rank, n,
    H1: o.H1 ?? (rank <= 2 ? 0.5 : 0.35) * H,
    double: o.double ?? rank <= 3,
    ov: o.ov ?? (rank <= 2 ? 0.8 : 0.65) * H,
    roof: o.roof, walls: o.walls, allCols: !!o.allCols, plinths: o.plinths !== false,
    skirt: o.skirt || null, floorY: o.floorY, chimi: o.chimi ?? 0, finialTop: o.finialTop ?? 0,
    finialCorners: o.finialCorners ?? 0, dapo: !!o.dapo, doorLine: o.doorLine ?? null, doors: o.doors ?? 3, shrine: !!o.shrine,
    beamKey: 'beam', bayEnd: o.bayEnd,
  };
}

// ─────────────── 몸채 (기둥·공포·벽·지붕) ───────────────
function buildBody(ctx, B) {
  const { S, F, C, high, fine, P } = ctx;
  const { xs, zs, H, Dm, n } = B;
  const nx = xs.length, nz = zs.length;
  const hw = xs[nx - 1], hd = zs[nz - 1];
  const kx = high ? 1 - (0.010 * H) / hw : 1;          // 안쏠림 (정면)
  const kz = high ? 1 - (0.008 * H) / hd : 1;          // 안쏠림 (측면)
  const rise = high ? 0.012 * (nx - 2) : 0;            // 귀솟음
  const colTop = (x) => B.yb + H + rise * Math.min(1, Math.abs(x) / hw);
  const hx = hw * kx, hz = hd * kz;
  const floorY = B.floorY ?? P.ph;

  // 공포 치수 (modelingGuide.bracket)
  const jw = 1.02 * Dm, hJ = 0.62 * jw, jH = 0.42 * Dm, jD = 0.36 * Dm, rP = 0.42 * Dm, aW = 0.36 * Dm;
  let pbH = 0;                                           // 평방 (다포)
  if (B.dapo) pbH = 0.34 * Dm;
  const tH = Math.max(0.12, (B.H1 - pbH - hJ - jH - rP) / (n + 1));
  const cH = 0.6 * tH, sH = 0.4 * tH;
  const p = n > 0 ? tH / (0.5 * n) : 0;
  const cbH = 0.72 * Dm, cbD = 0.5 * Dm;               // 창방
  const bayMin = Math.min(...P.bw, ...P.bd);
  const bktBase = (x) => colTop(x) + pbH;
  const yJ = (x) => bktBase(x) + hJ + (n + 1) * tH;       // 주심장여 밑
  const yP = (x) => yJ(x) + jH + rP;                      // 주심도리 중심
  const open = B.walls === 'gate' || B.walls === 'pavilion';

  // ── 서까래·지붕 두께 ──
  const rR = 0.0225 * H;
  const te = Math.max(0.13, 0.045 * H);
  const bS = 1.5 * rR;
  const tO = B.double ? 0.27 * B.ov : 0.06;
  const T = B.double
    ? (t) => te + bS * clamp((t - (tO - 0.04)) / 0.08, 0, 1)
    : () => te + 0.04;
  const Tin = T(B.ov + 1);

  // ── 지붕 형태 ──
  const roofType = B.roof;
  const pyramid = roofType === 'hip' && Math.abs(hx - hz) < 0.05;
  // 측면이 정면보다 긴 평면의 우진각·팔작은 지붕을 90° 돌려 만듦 (용마루가 긴 쪽을 따름)
  const swap = roofType !== 'gable' && !pyramid && hz > hx + 0.01;
  const [ex, ez] = swap ? [hz, hx] : [hx, hz];
  const ovG = 0.42 * B.ov;
  const a = ex + (roofType === 'gable' ? ovG : B.ov), b = ez + B.ov;
  const s0 = B.double ? 0.26 : 0.34;
  const yRoofRise = 0.31 * 2 * ez;                       // purlinRise = 0.31 × D
  const tc = B.ov;
  const yTc = (tc * (s0 + 0.5)) / 2;
  const Hroof = yTc + yRoofRise;
  const frontLen = P.W;
  const bayEnd = B.bayEnd ?? (swap ? P.bw[0] : P.bd[0]);
  const hipIn = Math.min(bayEnd, 0.6 * ez);
  const proj = Math.min(0.25 * bayEnd, 0.4 * hipIn);
  const shape = new RoofShape({
    type: pyramid ? 'pyramid' : roofType, halfWidth: a, halfDepth: b, height: Hroof,
    profile: { tc, s0, sc: 0.5 },
    cornerLift: Math.min(0.025 * frontLen, 1.0),
    cornerFlare: Math.min(0.018 * frontLen, 0.7),
    sweepLength: Math.max(1.5, (2 * a) / 3),
    liftDepth: tc * 1.1,
    hipDepth: B.ov + hipIn - proj, gableProjection: proj,
  });
  const yc = yP(0) + rP + 2 * rR + Tin;
  const roofY = yc - shape.y(tc);

  // ── 기둥 목록 ──
  const cols = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const perim = i === 0 || i === nx - 1 || j === 0 || j === nz - 1;
      if (!perim && (!B.allCols || !high)) continue;
      cols.push({ x: xs[i], z: zs[j], perim, corner: (i === 0 || i === nx - 1) && (j === 0 || j === nz - 1) });
    }
  }
  const rich = B.rank <= 2 && !B.skirt;
  for (const c of cols) {
    const sg = !high ? 6 : !fine ? 8 : c.perim ? (rich ? 14 : 9) : 8;
    column(S, c.x, B.yb, c.z, c.x * kx, c.z * kz, colTop(c.x) - B.yb, Dm, sg, C.timber, !high);
    if (B.plinths && high) plinth(F, c.x, B.yb - 0.15, c.z, P.plinthD, fine && c.perim ? (rich ? 14 : 10) : 8, fine && rich && c.perim);
  }
  // 문설주 (문 선이 기둥 줄이 아닐 때)
  const doorOnRow = B.doorLine !== null && zs.some((z) => Math.abs(z - B.doorLine) < 0.05);
  if (high && B.doorLine !== null && !doorOnRow) {
    const zD = B.doorLine;
    const topY = colTop(0) - cbH;
    for (const x of xs) S.box('painted', x * kx, (floorY + topY) / 2, zD, 0.62 * Dm, topY - floorY, 0.62 * Dm, { col: C.timber, skip: '-y' });
    member(S, 'beam', V3(-hx - 0.1, topY + cbH, zD), V3(hx + 0.1, topY + cbH, zD), cbH, cbD, { uv: 'member' });
    for (const x of xs) {
      member(S, 'painted', V3(x * kx, topY + cbH * 0.9, -hz), V3(x * kx, topY + cbH * 0.9, hz), cbH * 0.9, cbD * 0.9, { col: C.timber });
    }
  }

  // ── 창방 ──
  const sides = [
    { n: [0, 0, 1], a: [1, 0, 0], pts: xs.map((x) => V3(x * kx, 0, hz)), key: 'front' },
    { n: [0, 0, -1], a: [-1, 0, 0], pts: xs.slice().reverse().map((x) => V3(x * kx, 0, -hz)), key: 'back' },
    { n: [1, 0, 0], a: [0, 0, -1], pts: zs.slice().reverse().map((z) => V3(hx, 0, z * kz)), key: 'right' },
    { n: [-1, 0, 0], a: [0, 0, 1], pts: zs.map((z) => V3(-hx, 0, z * kz)), key: 'left' },
  ];
  const withY = (p, y) => V3(p.x, y, p.z);
  for (const s of high ? sides : []) {
    for (let i = 0; i < s.pts.length - 1; i++) {
      const A = s.pts[i], Bp = s.pts[i + 1];
      member(S, B.beamKey, withY(A, colTop(A.x / kx)), withY(Bp, colTop(Bp.x / kx)), cbH, cbD, { uv: 'member' });
      if (pbH > 0) member(S, B.beamKey, withY(A, colTop(A.x / kx) + pbH), withY(Bp, colTop(Bp.x / kx) + pbH), pbH, cbD * 1.25, { uv: 'member', ext: 0.1 });
    }
  }
  if (high && (doorOnRow || open)) {
    // 가운데 줄 창방 + 보 (문간·정자 안에서 보임)
    for (let j = 1; j < nz - 1; j++) {
      if (!B.allCols) break;
      for (let i = 0; i < nx - 1; i++) {
        const A = V3(xs[i] * kx, colTop(xs[i]), zs[j] * kz), Bp = V3(xs[i + 1] * kx, colTop(xs[i + 1]), zs[j] * kz);
        member(S, B.beamKey, A, Bp, cbH, cbD, { uv: 'member' });
      }
    }
    for (let i = 1; i < nx - 1; i++) {
      const x = xs[i] * kx, y = yJ(xs[i]) - 0.02;
      member(S, 'painted', V3(x, y, -hz), V3(x, y, hz), Dm * 0.95, Dm * 0.7, { col: C.timber, under: C.hwangdan, ext: 0.1 });
    }
  }

  // ── 벽·창호 ──
  const doorH = (B.walls === 'gate' ? 0.8 : 0.74) * H;
  const infO = { C, Dm, doorH, studs: fine && B.rank <= 2 };
  const wallFrame = (s, fn) => {
    const an = V3(...s.a), nn = V3(...s.n);
    const origin = V3(nn.x * (s.key === 'front' || s.key === 'back' ? 0 : hw), 0, nn.z * (s.key === 'front' || s.key === 'back' ? hd : 0));
    const m = new THREE.Matrix4().makeBasis(an, V3(0, 1, 0), nn).setPosition(origin);
    S.push(m);
    fn(an, origin);
    S.pop();
  };
  if (!high) {
    const yT = colTop(0) - cbH;
    if (B.walls === 'hall' || B.walls === 'upper') {
      S.box('painted', 0, (floorY + yT) / 2, 0, 2 * hw - 0.1, yT - floorY, 2 * hd - 0.1, { col: C.plaster, skip: '-y+y' });
    } else if (B.walls === 'gate' && B.doorLine !== null) {
      S.box('painted', 0, (floorY + yT) / 2, B.doorLine, 2 * hw, yT - floorY, 0.2, { col: C.timber, skip: '-y+y-x+x' });
    }
  } else if (B.walls === 'hall' || B.walls === 'upper') {
    for (const s of sides) {
      const raw = s.key === 'front' ? xs : s.key === 'back' ? xs.slice().reverse() : s.key === 'right' ? zs.slice().reverse() : zs;
      const nb = raw.length - 1;
      wallFrame(s, (an, origin) => {
        for (let i = 0; i < nb; i++) {
          const pa = s.key === 'front' || s.key === 'back' ? V3(raw[i], 0, 0) : V3(0, 0, raw[i]);
          const pb = s.key === 'front' || s.key === 'back' ? V3(raw[i + 1], 0, 0) : V3(0, 0, raw[i + 1]);
          const u0 = pa.x * an.x + pa.z * an.z - (origin.x * an.x + origin.z * an.z);
          const u1 = pb.x * an.x + pb.z * an.z - (origin.x * an.x + origin.z * an.z);
          const mid = i === (nb - 1) / 2 || Math.abs(i - (nb - 1) / 2) < 0.6;
          let type = 'plaster';
          if (B.walls === 'upper') type = s.key === 'front' || s.key === 'back' ? 'lattice' : 'plaster';
          else if (B.shrine) {
            // 사당(경령전): 남면 가운데 문 셋(판문), 나머지는 두꺼운 벽
            const nd = Math.min(nb, B.doors ?? 3), f0 = Math.floor((nb - nd) / 2);
            type = s.key === 'front' && i >= f0 && i < f0 + nd ? 'plank' : 'plaster';
          } else if (s.key === 'front') {
            if (B.rank <= 2 || nb <= 3) type = 'lattice';
            else type = Math.abs(i - (nb - 1) / 2) <= Math.max(0.5, nb / 6) ? 'lattice' : 'window';
          } else if (s.key === 'back') type = mid ? 'lattice' : 'plaster';
          else type = mid && nb >= 3 && B.rank <= 3 ? 'window' : 'plaster';
          const xA = s.key === 'front' || s.key === 'back' ? pa.x : (s.key === 'right' ? hw : -hw);
          const xB = s.key === 'front' || s.key === 'back' ? pb.x : xA;
          const yT = Math.min(colTop(xA), colTop(xB)) - cbH + 0.04;
          bayInfill(S, type, u0, u1, floorY, yT, infO);
        }
      });
    }
  } else if (B.walls === 'gate' && B.doorLine !== null) {
    const zD = B.doorLine;
    const nb = xs.length - 1;
    const nDoor = Math.min(nb, B.doors ?? 3);
    const first = Math.floor((nb - nDoor) / 2);
    S.push(new THREE.Matrix4().makeTranslation(0, 0, zD));
    for (let i = 0; i < nb; i++) {
      const type = i >= first && i < first + nDoor ? 'plank' : 'plaster';
      const yT = Math.min(colTop(xs[i]), colTop(xs[i + 1])) - cbH + 0.04;
      bayInfill(S, type, xs[i] * kx, xs[i + 1] * kx, floorY, yT, { ...infO, twoSided: true });
    }
    S.pop();
  }

  // ── 공포 ──
  const B0 = {
    jw, hJ, tH, cH, sH, aW, p, n, C, high, q: fine && B.rank === 1 ? 'full' : 'simple',
    band: fine && (B.rank <= 2 || P.boost) && !B.skirt, maxL: bayMin - 0.3 * jw, soro: fine ? (B.rank <= 2 ? 3 : 2) : 1,
  };
  if (high) {
    for (const c of cols) {
      if (!c.perim) continue;
      const x = c.x * kx, z = c.z * kz, y = bktBase(c.x);
      if (c.corner) {
        const sx = Math.sign(c.x), sz = Math.sign(c.z);
        const m = new THREE.Matrix4().makeBasis(V3(sx, 0, 0), V3(0, 1, 0), V3(0, 0, sz)).setPosition(x, y, z);
        S.push(m); cornerBracket(S, B0); S.pop();
        continue;
      }
      let out, along;
      if (Math.abs(Math.abs(c.z) - hd) < 1e-6) { out = V3(0, 0, Math.sign(c.z)); along = V3(Math.sign(c.z), 0, 0); } else { out = V3(Math.sign(c.x), 0, 0); along = V3(0, 0, -Math.sign(c.x)); }
      const m = new THREE.Matrix4().makeBasis(along, V3(0, 1, 0), out).setPosition(x, y, z);
      S.push(m); bracketSet(S, B0); S.pop();
    }
    if (B.dapo) {
      // 보간포: 칸마다 1조
      const Bd = { ...B0, q: 'simple', soro: 1, band: false, maxL: Math.min(B0.maxL, bayMin / 2 - 0.2 * jw) };
      for (const s of sides) {
        for (let i = 0; i < s.pts.length - 1; i++) {
          const m0 = V3().addVectors(s.pts[i], s.pts[i + 1]).multiplyScalar(0.5);
          const y = (bktBase(s.pts[i].x / kx) + bktBase(s.pts[i + 1].x / kx)) / 2;
          const m = new THREE.Matrix4().makeBasis(V3(...s.a), V3(0, 1, 0), V3(...s.n)).setPosition(m0.x, y, m0.z);
          S.push(m); bracketSet(S, Bd); S.pop();
        }
      }
    }
  } else {
    // 먼 거리: 공포대를 띠 상자로
    const yb0 = colTop(0), yt0 = yJ(0) + jH;
    const hh = yt0 - yb0, th = jw * 1.1;
    S.box('painted', 0, yb0 + hh / 2, hz, 2 * hx + th, hh, th, { col: C.timber, under: C.hwangdan, skip: '+y' });
    S.box('painted', 0, yb0 + hh / 2, -hz, 2 * hx + th, hh, th, { col: C.timber, under: C.hwangdan, skip: '+y' });
    S.box('painted', hx, yb0 + hh / 2, 0, th, hh, 2 * hz, { col: C.timber, under: C.hwangdan, skip: '+y' });
    S.box('painted', -hx, yb0 + hh / 2, 0, th, hh, 2 * hz, { col: C.timber, under: C.hwangdan, skip: '+y' });
  }

  // ── 장여·도리 ──
  const gable = roofType === 'gable';
  const ring = (ox, oz, yFn, fn, gableExt) => {
    // 네 변 (맞배면 앞뒤만 박공까지)
    const ext = gableExt ?? 0.25;
    for (const sz of [1, -1]) {
      const x0 = -(gable ? a - 0.15 : ox + ext), x1 = gable ? a - 0.15 : ox + ext;
      const pts = [x0, ...xs.map((x) => x * kx).filter((x) => x > x0 && x < x1), x1];
      for (let i = 0; i < pts.length - 1; i++) fn(V3(pts[i], yFn(pts[i] / kx), sz * oz), V3(pts[i + 1], yFn(pts[i + 1] / kx), sz * oz));
    }
    if (!gable) {
      for (const sx of [1, -1]) {
        const y = yFn(sx * hw);
        fn(V3(sx * ox, y, -oz - ext), V3(sx * ox, y, oz + ext));
      }
    }
  };
  if (high) {
    ring(hx, hz, (x) => yJ(x) + jH, (A, Bp) => member(S, 'painted', A, Bp, jH, jD, { col: C.timber, under: C.hwangdan }), gable ? undefined : 0.1);
    if (gable) for (const sx of [1, -1]) member(S, 'painted', V3(sx * hx, yJ(hw) + jH, -hz), V3(sx * hx, yJ(hw) + jH, hz), jH, jD, { col: C.timber, under: C.hwangdan });
    ring(hx, hz, (x) => yP(x), (A, Bp) => S.cyl('painted', A, Bp, rP, rP, 8, C.timber), gable ? undefined : rP + 0.1);
    if (n > 0) {
      const d = n * p;
      const tOP = B.ov - d;
      const yOP0 = roofY + shape.point('long', 0, 1, 0, tOP, V3()).y - T(tOP) - 2 * rR - rP;
      const yOP = (x) => yOP0 + rise * Math.min(1, Math.abs(x) / hw);
      const yJo = (x) => bktBase(x) + hJ + n * tH;
      ring(hx + d, hz + d, (x) => yOP(x) - rP, (A, Bp) => {
        const hh = Math.max(0.06, A.y - yJo(A.x / kx));
        member(S, 'painted', A, Bp, hh, jD, { col: C.timber, under: C.hwangdan });
      }, gable ? undefined : 0.1);
      ring(hx + d, hz + d, yOP, (A, Bp) => S.cyl('painted', A, Bp, rP, rP, 8, C.timber), gable ? undefined : rP + 0.1);
    }
  }

  // ── 포벽 ──
  if (high) {
    for (const s of sides) {
      const nn = V3(...s.n);
      for (let i = 0; i < s.pts.length - 1; i++) {
        const A = s.pts[i], Bp = s.pts[i + 1];
        const ya = colTop(A.x / kx) + pbH, yb2 = colTop(Bp.x / kx) + pbH;
        const ta = yJ(A.x / kx) + 0.02, tb = yJ(Bp.x / kx) + 0.02;
        const off = nn.clone().multiplyScalar(0.005);
        const pk = B.rank <= 2 || P.boost ? 'pobyeok' : 'plaster';
        S.quad(pk, [A.x + off.x, ya, A.z + off.z], [Bp.x + off.x, yb2, Bp.z + off.z], [Bp.x + off.x, tb, Bp.z + off.z], [A.x + off.x, ta, A.z + off.z], null, undefined, s.n);
        if (open) S.quad(pk, [Bp.x - off.x, yb2, Bp.z - off.z], [A.x - off.x, ya, A.z - off.z], [A.x - off.x, ta, A.z - off.z], [Bp.x - off.x, tb, Bp.z - off.z], null, undefined, [-nn.x, 0, -nn.z]);
      }
    }
  }

  // ── 지붕 ──
  const R = {
    h: Math.max(0.26, (B.rank === 1 ? 0.06 : 0.04) * 2 * ez),
    w: 0,
  };
  R.w = Math.max(0.3, 0.5 * R.h + 0.14);
  const Hh = { h: Math.max(0.2, 0.44 * R.h), w: Math.max(0.26, 0.66 * R.w) };
  const roofM = new THREE.Matrix4().makeTranslation(0, roofY, 0);
  if (swap) roofM.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  S.push(roofM);
  const info = buildRoof(shape, S, {
    detail: ctx.lvl,
    keys: { tile: 'tile', under: 'under', trim: 'trim', paint: 'painted', plank: 'plank', end: 'rafterEnd', gilt: 'gilt' },
    C, te, T,
    ridge: R, hip: Hh,
    chimi: Math.min(B.chimi, 0.34 * Hroof), finialTop: B.finialTop, finialCorners: B.finialCorners,
    gableWall: true, gableOrnament: B.rank <= 2,
    barge: { t: 0.08, h: Math.max(0.3, 0.09 * H) },
    tMax: B.skirt ? B.ov - B.skirt.deckOut : undefined,
    makseSegs: B.rank <= 2 && !B.skirt ? 8 : 5, makseR: 0.085, makse: fine,
    ridgeFull: fine && B.rank <= 2,
    res: !fine ? { du: 2.4, dv: 1.1 } : B.rank <= 2 ? { du: 1.0, dv: 0.6 } : { du: 1.8, dv: 1.0 },
    eave: !fine ? undefined : {
      double: B.double, tO, tB0: 0.05, tIn: B.ov + (open ? 0.9 : 0.35), rR, sp: 0.33, bS, hx: ex, hz: ez,
      segs: B.skirt ? 5 : B.rank <= 2 ? 7 : 5, cw: 2.6 * rR, ch: 3.0 * rR, gilt: B.rank <= 2 && !B.skirt,
    },
  });
  S.pop();

  // ── 맞배 측면 가구(대들보·종보·대공) + 박공벽 ──
  if (gable) gableEnd(ctx, { shape, roofY, T, hx, hz, yP, hw, rP, Dm, high, fine, H, yJ });

  const roofHeightAt = (x, z) => roofY + (swap ? shape.heightAt(z, x) : shape.heightAt(x, z));
  return { ridgeTop: roofY + info.ridgeTop, shape, roofY, roofHeightAt, T, hx, hz, kx, kz, colTop, yJ, yP, jw, n, tH, p, aW, hJ, Tin, rR, te, B };
}

// 맞배 박공면: 측면 기둥선 위 삼각 벽 + 노출 가구
function gableEnd(ctx, g) {
  const { S, C } = ctx;
  const { shape, roofY, T, hx, hz, yP, hw, rP, Dm, high, fine } = g;
  const b = shape.b;
  for (const sx of [1, -1]) {
    const X = sx * hx;
    const yBeam = yP(hw);
    const under = (z) => {
      const t = b - Math.abs(z);
      return roofY + shape.y(t) - T(t) - 0.03;
    };
    // 삼각 벽 (회벽)
    const n = high ? 12 : 4;
    const yb = high ? yBeam + rP * 0.5 : g.yJ(hw);
    for (let k = 0; k < n; k++) {
      const z0 = -hz + (2 * hz * k) / n, z1 = -hz + (2 * hz * (k + 1)) / n;
      S.quad('painted', [X, yb, z0], [X, yb, z1], [X, under(z1), z1], [X, under(z0), z0], C.plaster, undefined, [sx, 0, 0]);
    }
    if (!high) continue;
    // 대들보
    const bh = Dm * 1.15, bd = Dm * 0.85;
    member(S, 'painted', V3(X, yBeam + bh * 0.35, -hz - 0.3), V3(X, yBeam + bh * 0.35, hz + 0.3), bh, bd, { col: C.timber, under: C.hwangdan });
    // 종보 + 대공
    const yTop = under(0);
    const yJong = yb + (yTop - yb) * 0.5;
    const zJ = hz * 0.5;
    member(S, 'painted', V3(X + sx * 0.02, yJong, -zJ - 0.2), V3(X + sx * 0.02, yJong, zJ + 0.2), bh * 0.75, bd * 0.8, { col: C.timber, under: C.hwangdan });
    for (const zz of [-zJ, zJ]) S.box('painted', X + sx * 0.02, (yb + yJong) / 2, zz, bd * 0.7, yJong - yb, bd * 0.7, { col: C.timber });
    S.box('painted', X + sx * 0.03, (yJong + yTop) / 2, 0, bd * 0.7, yTop - yJong, bd * 0.75, { col: C.timber });
    // 도리 뺄목 (중도리·종도리)
    if (fine) {
      for (const zz of [-zJ, 0, zJ]) {
        const y = under(zz) - rP * 0.9;
        S.cyl('painted', V3(X - sx * 0.3, y, zz), V3(sx * (shape.a - 0.2), y, zz), rP * 0.9, rP * 0.9, 10, C.timber);
        S.disc('rafterEnd', V3(sx * (shape.a - 0.195), y, zz), V3(sx, 0, 0), rP * 0.88, 10, null);
      }
    }
  }
}

// ─────────────── 기단·계단 ───────────────
function buildFoundation(ctx) {
  const { F, P, def, high } = ctx;
  const { pw, pd, ph } = P;
  if (high) {
    platformBox(F, 0, 0, pw, pd, ph, { postsX: P.xs.slice(1, -1), postsZ: P.zs.slice(1, -1) });
  } else {
    F.box('stone', 0, (ph - 0.15) / 2, 0, pw, ph + 0.15, pd, { uv: 'world', us: 4, vs: 2, skip: '-y+y' });
    F.box('stoneTop', 0, ph - 0.05, 0, pw + 0.06, 0.1, pd + 0.06, { skip: '-y' });
  }
  // 둘레 전돌 (surroundPaving)
  if (def.surroundPaving) {
    const m = 1.6;
    F.box('brick', 0, 0.025, 0, pw + 2 * m, 0.1, pd + 2 * m, { uv: 'world', us: 2, vs: 2, skip: '-y' });
  }
  // 월대
  let wd = null;
  if (def.woldae && def.woldae.x1 > def.woldae.x0) {
    const w = def.woldae;
    const hd = P.zs[P.zs.length - 1];
    const back = Math.max(0.3, Math.min(1.2, pd / 2 - hd - P.plinthD / 2 - 0.4));
    const z0 = pd / 2 - back, z1 = pd / 2 + (w.projectionSouth ?? 1.5);
    const h = Math.max(ph + 0.05, w.topHeight ?? ph + 0.3);
    wd = { x0: w.x0, x1: w.x1, z1, h };
    if (high) platformBox(F, (w.x0 + w.x1) / 2, (z0 + z1) / 2, w.x1 - w.x0, z1 - z0, h, { posts: true });
    else F.box('stone', (w.x0 + w.x1) / 2, h / 2 - 0.07, (z0 + z1) / 2, w.x1 - w.x0, h + 0.15, z1 - z0, { uv: 'world', us: 4, vs: 2, skip: '-y' });
  }
  ctx.woldae = wd;
  // 계단
  let stairs = Array.isArray(def.platformStairs) ? def.platformStairs : null;
  if (!stairs && ph >= 0.28) {
    const mid = P.bw[Math.floor(P.bw.length / 2)];
    const width = clamp(mid * 0.72, 1.6, 4.2);
    const run = Math.round(ph / 0.18) * 0.3;
    stairs = [{ side: 'S', x: 0, width, run, rise: ph }];
    if (P.kind === 'gate' || P.kind === 'gatehouse') stairs.push({ side: 'N', x: 0, width, run, rise: ph });
  }
  ctx.stairs = [];
  for (const s of stairs || []) {
    const dirZ = s.side === 'N' ? -1 : 1;
    let zEdge = dirZ * (pd / 2 + 0.05);
    let rise = s.rise ?? ph;
    if (dirZ > 0 && wd && s.x >= wd.x0 && s.x <= wd.x1) { zEdge = wd.z1 + 0.05; rise = s.rise ?? wd.h; }
    const run = s.run ?? Math.round(rise / 0.18) * 0.3;
    if (high) platformStair(F, s.x ?? 0, zEdge, dirZ, s.width ?? 2.4, run, rise);
    else {
      // 경사면으로 단순화
      const x = s.x ?? 0, w = s.width ?? 2.4, z1 = zEdge + dirZ * run;
      F.quad('stoneTop', [x - w / 2, 0, z1], [x + w / 2, 0, z1], [x + w / 2, rise, zEdge], [x - w / 2, rise, zEdge], null, undefined, [0, 1, dirZ]);
      for (const sgn of [1, -1]) F.tri('stoneTop', [x + sgn * w / 2, 0, zEdge], [x + sgn * w / 2, 0, z1], [x + sgn * w / 2, rise, zEdge], null, undefined, [sgn, 0, 0]);
    }
    ctx.stairs.push({ ...s, zEdge, dirZ, run, rise, width: s.width ?? 2.4, x: s.x ?? 0 });
  }
}

// ─────────────── 2층 누문 ───────────────
function buildGatehouse(ctx) {
  const { P, S, C, high, fine } = ctx;
  const H = P.H;
  // 아래층: 문간 (홑처마 차양)
  const doorLine = 0;
  const lower = bodyConfig(P, {
    xs: P.xs, zs: P.zs, yb: P.ph + 0.15, H, n: 1, H1: 0.36 * H, double: false, ov: 0.6 * H,
    roof: 'hip', walls: 'gate', allCols: true, doorLine, doors: ctx.def.doors ?? 3, skirt: { deckOut: 0.85 },
  });
  const L = buildBody(ctx, lower);
  // 평좌 (위층 마루)
  const dd = 0.85;
  const ex = L.hx + dd, ez = L.hz + dd;
  const tMax = lower.ov - dd;
  const ringTop = L.roofY + L.shape.y(tMax);
  const yD0 = Math.max(ringTop - 0.2, L.yP(P.W / 2) + 0.45 * P.Dm + 0.06);
  const deckTh = 0.26;
  const yDeck = yD0 + deckTh + 0.2;
  S.box('painted', 0, (yD0 + yDeck) / 2, 0, 2 * ex, yDeck - yD0, 2 * ez, { col: C.timber, top: C.floor, under: C.hwangdan });
  // 평좌 테두리 백분 선
  S.box('painted', 0, yD0 + 0.05, 0, 2 * ex + 0.02, 0.05, 2 * ez + 0.02, { col: C.white, skip: '-y+y' });
  // 난간
  const ri = 0.12;
  const rx = ex - ri, rz = ez - ri;
  if (high) railing(S, [[-rx, rz], [rx, rz], [rx, -rz], [-rx, -rz], [-rx, rz]], yDeck, 0.95, { C, gilt: true, high: fine, spacing: 1.35 });
  // 위층
  const zsU = P.bd.length > 2 ? P.zs.slice(1, -1) : P.zs;
  const bdU = P.bd.length > 2 ? P.bd.slice(1, -1) : P.bd;
  const upper = bodyConfig(P, {
    xs: P.xs, zs: zsU, yb: yDeck, H: 0.75 * H, roof: P.roof, walls: 'upper', allCols: false, plinths: false, floorY: yDeck,
    chimi: chimiHeight(ctx), finialCorners: ctx.def.finials ? 0.6 : 0, dapo: P.dapo, bayEnd: bdU[0],
  });
  const U = buildBody(ctx, upper);
  ctx.plaqueBody = U;
  return U.ridgeTop;
}

function chimiHeight(ctx) {
  const { P, def } = ctx;
  if (P.rank > 2) return 0;
  return def.chimi?.height > 0 ? def.chimi.height : Math.min(0.12 * P.W, 2.5);
}

// ─────────────── 조립 ───────────────
function buildMain(ctx) {
  const { P, def } = ctx;
  const kind = P.kind;
  const doorLine = kind === 'gate' || kind === 'gatehouse' ? 0 : null;
  const pyr = P.roof === 'hip' && Math.abs(P.W - P.D) < 0.05;
  const B = bodyConfig(P, {
    xs: P.xs, zs: P.zs, yb: P.ph + 0.15, H: P.H, roof: P.roof,
    walls: kind === 'hall' ? 'hall' : kind === 'pavilion' ? 'pavilion' : 'gate',
    allCols: kind !== 'hall' && kind !== 'pavilion', doorLine, doors: def.doors ?? 3,
    shrine: kind === 'hall' && typeof def.walls === 'string',
    chimi: pyr ? 0 : chimiHeight(ctx), finialTop: pyr ? clamp(0.09 * P.W + 0.25, 0.7, 1.4) : 0,
    finialCorners: def.finials ? 0.6 : 0, dapo: P.dapo,
  });
  // 6-2호 곁채: 정면 한쪽 칸들을 낮은 지붕으로 (annex)
  if (def.annex && def.annex.baysFront > 0 && def.annex.baysFront < P.bw.length - 1) {
    return buildWithAnnex(ctx, B);
  }
  const R = buildBody(ctx, B);
  ctx.plaqueBody = R;
  // 정자 난간 (앞 가운데 칸은 드나듦)
  if (kind === 'pavilion' && ctx.high) {
    const { S, C, fine } = ctx;
    const { xs, zs } = P;
    const hw = xs[xs.length - 1], hd = zs[zs.length - 1];
    const cr = P.Dm * 0.5;
    const lines = [];
    const midF = Math.floor((xs.length - 1) / 2);
    for (let i = 0; i < xs.length - 1; i++) {
      if (i !== midF) lines.push([[xs[i] * R.kx + cr, hd * R.kz], [xs[i + 1] * R.kx - cr, hd * R.kz]]);
      lines.push([[xs[i] * R.kx + cr, -hd * R.kz], [xs[i + 1] * R.kx - cr, -hd * R.kz]]);
    }
    for (let j = 0; j < zs.length - 1; j++) for (const sx of [1, -1]) lines.push([[sx * hw * R.kx, zs[j] * R.kz + cr], [sx * hw * R.kx, zs[j + 1] * R.kz - cr]]);
    for (const l of lines) railing(S, l, P.ph, 0.72, { C, gilt: false, high: fine, spacing: 3 });
  }
  return R.ridgeTop;
}

function buildWithAnnex(ctx, B) {
  const { P, def } = ctx;
  const nA = def.annex.baysFront;
  const side = def.annex.side === 'W' ? -1 : 1;
  const nb = P.bw.length;
  // 본채 = 반대쪽 칸들, 곁채 = side 쪽 nA 칸
  const mainIdx = side > 0 ? [0, nb - nA] : [nA, nb];
  const xsMain = P.xs.slice(mainIdx[0], mainIdx[1] + 1);
  const xsAnnex = side > 0 ? P.xs.slice(nb - nA) : P.xs.slice(0, nA + 1);
  const cxM = (xsMain[0] + xsMain[xsMain.length - 1]) / 2;
  const cxA = (xsAnnex[0] + xsAnnex[xsAnnex.length - 1]) / 2;
  // 몸채마다 중심 좌표계를 옮겨 그림
  const { S, F } = ctx;
  const draw = (xsAbs, cx, zsAbs, zc, H, extra) => {
    const xsL = xsAbs.map((x) => x - cx);
    const zsL = zsAbs.map((z) => z - zc);
    const cfg = bodyConfig(P, { xs: xsL, zs: zsL, yb: B.yb, H, roof: B.roof, walls: 'hall', dapo: B.dapo, ...extra });
    const m = new THREE.Matrix4().makeTranslation(cx, 0, zc);
    S.push(m); F.push(m);
    const saveW = P.W;
    P.W = xsL[xsL.length - 1] * 2;
    const r = buildBody(ctx, cfg);
    P.W = saveW;
    S.pop(); F.pop();
    return r;
  };
  const nbS = P.bd.length;
  const zsA = P.zs.slice(Math.max(0, nbS - Math.max(1, def.annex.baysSide ?? nbS)));
  const zc = (zsA[0] + zsA[zsA.length - 1]) / 2;
  const main = draw(xsMain, cxM, P.zs, 0, P.H, { chimi: B.chimi });
  // 곁채는 앞쪽에 맞추고 한 단 낮게
  const annex = draw(xsAnnex, cxA, zsA, zc, P.H * 0.86, { chimi: 0 });
  ctx.plaqueBody = { ...main, offsetX: cxM };
  return Math.max(main.ridgeTop, annex.ridgeTop);
}

// 편액·극·활주·계단 난간
function buildExtras(ctx) {
  const { S, C, P, def, high, fine } = ctx;
  if (!high) return;
  // 계단 난간 (주칠 목난간 + 금동 꽃장식)
  for (const s of ctx.stairs || []) {
    if (!s.railing) continue;
    for (const sg of [1, -1]) {
      const x = s.x + sg * (s.width / 2 + 0.15);
      const z0 = s.zEdge, z1 = s.zEdge + s.dirZ * (s.run + 0.02);
      railing(S, [[x, z0 - s.dirZ * 0.1, s.rise + 0.1], [x, z1, 0.2]], 0, 0.85, { C, gilt: true, high: fine, spacing: 1.4 });
    }
  }
  // 편액
  const R = ctx.plaqueBody;
  if (P.plaqueText && R && R.B) {
    const bw = P.bw[Math.floor(P.bw.length / 2)];
    const x = R.offsetX ?? 0;
    const y0 = R.colTop(0) + (R.B.dapo ? 0.34 * R.B.Dm : 0);
    const zoneH = R.yJ(0) - y0;
    const aspect = [...P.plaqueText].length * 0.82 + 0.55;
    let h = clamp(zoneH * 0.62, 0.45, 1.2);
    let w = h * aspect;
    const maxW = bw - 2.2 * R.jw;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    const z = R.hz + R.aW / 2 + (R.n > 0 ? R.p * (R.B.dapo ? R.n + 0.3 : 0.55) : 0.25) + 0.05;
    const y = y0 + zoneH * 0.52;
    plaque(S, x, y, z, w, h, 0.2, C);
    ctx.plaque = true;
  }
  // 극(戟) 24자루: 문밖 좌우 12자루씩 — 문칸을 막지 않게 양 끝 벽칸 앞, 기단 바로 앞 땅에 세움
  // (문 앞 가운데 두면 대계단을 올라온 길을 막음)
  if (typeof def.props === 'string' && def.props.includes('극')) {
    const zc = P.pd / 2 + 0.55;
    const n = P.bw.length;
    const endW = P.bw[0];
    const span = P.bw.reduce((a, v) => a + v, 0);
    const xc = n >= 3 ? span / 2 - endW / 2 : span / 2 + 1.2;
    const sp = Math.min(0.38, Math.max(0.22, (endW - 0.8) / 11));
    for (const sg of [1, -1]) halberdRack(S, sg * xc, zc, 12, C, sp);
  }
  // 활주: 추녀 끝을 받치는 보조 기둥
  if (def.hwalju && ctx.mainBody) {
    const M = ctx.mainBody;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const d = M.B.ov * 0.52;
        let x = sx * (M.hx + d), z = sz * (M.hz + d);
        x = clamp(x, -P.pw / 2 + 0.3, P.pw / 2 - 0.3); z = clamp(z, -P.pd / 2 + 0.3, P.pd / 2 - 0.3);
        const top = M.roofHeightAt(x, z) - M.Tin - 0.25;
        S.cyl('painted', V3(x, P.ph + 0.12, z), V3(x, top, z), 0.1, 0.1, 8, C.timber);
        ctx.F.push(new THREE.Matrix4());
        plinth(ctx.F, x, P.ph - 0.03, z, 0.34, 10);
        ctx.F.pop();
      }
    }
  }
}

function resolveMat(key, mats, P, ctx) {
  const bm = buildingMats(mats);
  switch (key) {
    case 'stone': return mats.stone;
    case 'stoneV': return buildingMats(mats).stoneV;
    case 'brick': return mats.brick || mats.stoneTop;
    case 'painted': return bm.painted;
    case 'trim': return P.celadon ? bm.trimCeladon : bm.trimGray;
    case 'beam': return P.dc14 ? mats.beam14 : (P.rank <= 2 || P.boost ? mats.beam : mats.beamPlain);
    case 'rafterEnd': return mats.rafterEnd;
    case 'plaster': return mats.plaster;
    case 'lattice': return mats.doorLattice;
    case 'plank': return mats.doorPlank;
    case 'tile': return P.celadon ? mats.tileCeladon : mats.tileGray;
    case 'under': return mats.roofUnder;
    case 'gilt': return mats.gilt;
    case 'plaque': return typeof document === 'undefined' ? mats.lacquer : plaqueMat(mats, P.plaqueText);
    case 'pobyeok': return typeof document === 'undefined' ? mats.plaster : pobyeokMat(mats);
    default: return mats.timber;
  }
}

/**
 * 건물 하나를 만듭니다.
 * @param {object} def  spec.buildings[i]
 * @param {object} mats createMaterials() 결과
 * @param {{detail?: 'high'|'medium'|'low', celadon?: boolean, dapo?: boolean, dancheong14?: boolean}} opts
 *   detail: high = 서까래·부연·막새·공포 세부까지 / medium = 서까래·막새 없이 공포 단순화(중거리) / low = 상자형(원거리)
 *   celadon: celadonOption 건물을 청자기와로, dapo: rank 1–2 다포(보간포) 토글, dancheong14: 14세기 단청(beam14)
 * @returns {THREE.Group} 월드 좌표에 놓인 그룹 — children 'foundation', 'superstructure'
 */
export function createBuilding(def, mats, opts = {}) {
  const lvl = opts.detail === 'low' ? 'low' : opts.detail === 'medium' ? 'medium' : 'high';
  const high = lvl !== 'low';
  const P = derive(def, opts);
  const ctx = {
    def, P, lvl, high, fine: lvl === 'high', C: colorsFor(mats, P.celadon),
    F: new GeoSink(['stoneV']), S: new GeoSink(['painted', 'trim']),
  };
  // 단색 재질은 정점색 메시로 합쳐 그리기 호출을 줄임
  ctx.F.alias('stoneTop', 'stoneV', ctx.C.granite).alias('stoneW', 'stoneV', ctx.C.graniteW);
  ctx.S.alias('under', 'painted', ctx.C.under);
  if (lvl === 'low') ctx.S.alias('plank', 'painted', ctx.C.timber);
  buildFoundation(ctx);
  let ridgeTop;
  if (P.stories === 2) ridgeTop = buildGatehouse(ctx);
  else {
    ridgeTop = buildMain(ctx);
  }
  ctx.mainBody = ctx.plaqueBody;
  buildExtras(ctx);
  const matFor = (key) => resolveMat(key, mats, P, ctx);
  const group = new THREE.Group();
  group.name = def.id;
  const f = ctx.F.build('foundation', matFor, def.id);
  const s = ctx.S.build('superstructure', matFor, def.id);
  group.add(f, s);
  const gy = def.groundY ?? 0;
  group.position.set(def.cx ?? 0, gy, def.cz ?? 0);
  group.rotation.y = -THREE.MathUtils.degToRad(def.rotationDeg || 0);
  group.userData = {
    id: def.id, nameKo: def.nameKo, kind: def.kind, rank: P.rank,
    ridgeY: gy + ridgeTop, size: { w: P.pw, d: P.pd },
    detail: lvl,
    triangles: ctx.F.triangles() + ctx.S.triangles(),
    celadonOption: !!def.celadonOption,
    warnings: P.warn,
  };
  return group;
}

/**
 * 거리에 따라 high → medium → low 로 바뀌는 LOD. 모든 단계가 같은 이름('foundation'/'superstructure')의 자식을 가집니다.
 * 폐허 모드는 lod.traverse(o => { if (o.name === 'superstructure') o.visible = false; }) 로 모든 단계를 숨깁니다.
 *   opts.lodDistances = [medium, low] (m) 로 전환 거리를 바꿀 수 있습니다 (휴대폰은 더 짧게).
 */
export function createBuildingLOD(def, mats, opts = {}) {
  const levels = ['high', 'medium', 'low'].map((d) => createBuilding(def, mats, { ...opts, detail: d }));
  const lod = new THREE.LOD();
  lod.name = def.id;
  const hi = levels[0];
  const size = Math.max(hi.userData.size.w, hi.userData.size.d);
  const dMed = opts.lodDistances?.[0] ?? clamp(55 + 1.6 * size, 70, 140);
  const dLow = opts.lodDistances?.[1] ?? clamp(150 + 3 * size, 180, 320);
  levels.forEach((g, i) => {
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.name = `${def.id}:${g.userData.detail}`;
    lod.addLevel(g, [0, dMed, dLow][i]);
  });
  lod.position.set(def.cx ?? 0, def.groundY ?? 0, def.cz ?? 0);
  lod.rotation.y = -THREE.MathUtils.degToRad(def.rotationDeg || 0);
  lod.userData = {
    ...hi.userData,
    lodDistances: [dMed, dLow],
    trianglesByLevel: levels.map((g) => g.userData.triangles),
  };
  return lod;
}
