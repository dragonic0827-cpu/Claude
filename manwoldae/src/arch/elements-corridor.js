// 회랑(回廊) — 0.4 m 장대석 기단, 배흘림 둥근 기둥(석간주), 익공, 창방·장혀·도리, 대들보·대공,
// 서까래(연등천장), 맞배 홑처마(오목 곡선·회흑색 기와·막새·용마루·백도), ㄱ자 모서리 마이터(추녀마루),
// 바깥쪽 회벽과 살창(일곽을 두르는 회랑), 문·다른 회랑과 만나는 끝 처리.
//
// ctx = { buildings, terraces, corridors, stairs, detail }  — corridors 가 있으면 끝점끼리 만나는 모서리를
// 마이터로 잇고(너비가 비슷하면), T자로 붙는 끝은 상대 지붕면에서 끊습니다.
// detail: 'high'(기본) | 'low' (휴대폰용: 서까래·막새 원판 없이 개판만, 기둥 6각) — 삼각형 약 45 % 절감
import * as THREE from 'three';
import {
  Sink, box, tube, worldUV, elementMats, clamp, lerp, smooth01, v2, lineX, miterVec, segProj,
  orientedRect, rectDist, sweep, capSection,
} from './elements-geo.js';
import SPEC from '../data/spec.js';   // ctx.corridors / ctx.stairs 가 없을 때만 쓰는 기본값

const EDGE = 0.6;          // 기단 가장자리 → 기둥 중심
const PLAT_H = 0.4;        // 기단 높이
const PLINTH = 0.12;       // 초석이 바닥 위로 드러난 높이
const TILE_OV = 0.14;      // 기와가 서까래 끝보다 더 나간 길이
const TIES = 0.33;         // 서까래 간격 (기왓골 0.33 m 와 같게)

// 지붕 치수: 기둥 간격 Dc, 기둥머리 높이 Yc, 처마 내밀기 O
function roofDims(Dc, Yc, O) {
  const yP = Yc + 0.76;                 // 주심도리 윗면 = 서까래 윗선(기둥선)
  const yR = yP + 0.31 * Dc;            // 종도리 윗면 (물매: 총 상승 0.31·D)
  const half = Dc / 2;
  const De = half + O;                  // 서까래 끝
  const ys = (d) => {                   // 서까래 윗선(개판)
    d = Math.abs(d);
    return d <= half ? yR - (yR - yP) * (d / half) : yP - 0.5 * (d - half);
  };
  // 꺾임을 부드럽게(±0.5 m) 한 선 + 두께(용마루 쪽 두껍게) → 오목한 기와면
  const f = 0.5;
  const ysSmooth = (d) => {
    d = Math.abs(d);
    if (Math.abs(d - half) >= f) return ys(d);
    const a = ys(half - f), b = ys(half + f), m = ys(half);
    const t = (d - (half - f)) / (2 * f);
    return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * m + t * t * b;
  };
  const yt = (d) => {
    const q = clamp(Math.abs(d) / (De + TILE_OV), 0, 1);
    return ysSmooth(d) + 0.2 + 0.26 * Math.pow(1 - q, 1.6);
  };
  return { Dc, Yc, O, yP, yR, half, De, ys, yt };
}

// 기와 지붕 단면(오른쪽 처마 밑 → 처마 앞 → 기와면 → 왼쪽 처마 → 개판) — 태그로 재질을 나눕니다
function roofProfile(R) {
  const { De, half, O, ys, yt } = R;
  const Dt = De + TILE_OV;
  const P = [];
  const eaveY = yt(Dt), under = eaveY - 0.13;
  // 기와면 샘플 (오른쪽 처마 → 용마루 → 왼쪽 처마)
  const ds = [];
  for (const k of [1, 0.85, 0.7, 0.55, 0.4]) ds.push(half + (Dt - half) * k);
  for (const k of [0.8, 0.55, 0.3, 0.1]) ds.push(half * k);
  // 오른쪽
  P.push({ d: Dt, y: under, tag: 'makse' });
  for (const d of ds) P.push({ d, y: yt(d), tag: 'tile' });
  P.push({ d: 0, y: yt(0), tag: 'tile' });
  for (let i = ds.length - 1; i >= 1; i--) P.push({ d: -ds[i], y: yt(ds[i]), tag: 'tile' });
  P.push({ d: -Dt, y: eaveY, tag: 'makse' });
  P.push({ d: -Dt, y: under, tag: 'under' });
  P.push({ d: -(De + 0.02), y: under, tag: 'wood' });
  P.push({ d: -(De + 0.02), y: ys(De) - 0.01, tag: 'wood' });
  P.push({ d: -De, y: ys(De) - 0.01, tag: 'soffit' });
  P.push({ d: -half, y: ys(half), tag: 'soffit' });
  P.push({ d: 0, y: ys(0), tag: 'soffit' });
  P.push({ d: half, y: ys(half), tag: 'soffit' });
  P.push({ d: De, y: ys(De) - 0.01, tag: 'wood' });
  P.push({ d: De + 0.02, y: ys(De) - 0.01, tag: 'wood' });
  P.push({ d: De + 0.02, y: under, tag: 'under' });
  // 닫힘: 마지막 → 첫 점(Dt, under) 은 'under'
  return P;
}

// 용마루 단면 (백도 + 적새 + 둥근 수키와 등)
function ridgeProfile(R, hr) {
  const yb = R.yt(0.22) - 0.02;
  const P = [];
  const w = 0.17, wb = 0.21, r = 0.12, yc = yb + hr - 0.08;
  P.push({ d: wb, y: yb - 0.06, tag: 'white' });
  P.push({ d: wb, y: yb + 0.06, tag: 'ridge' });
  P.push({ d: w, y: yb + 0.06, tag: 'ridge' });
  P.push({ d: w, y: yc, tag: 'ridge' });
  P.push({ d: r, y: yc, tag: 'cap' });
  for (let k = 1; k < 6; k++) { const a = (k / 6) * Math.PI; P.push({ d: Math.cos(a) * r, y: yc + Math.sin(a) * r, tag: 'cap' }); }
  P.push({ d: -r, y: yc, tag: 'ridge' });
  P.push({ d: -w, y: yc, tag: 'ridge' });
  P.push({ d: -w, y: yb + 0.06, tag: 'ridge' });
  P.push({ d: -wb, y: yb + 0.06, tag: 'white' });
  P.push({ d: -wb, y: yb - 0.06, tag: null });
  return P;
}

// 3D 꺾은선을 따라 가는 작은 마루(추녀마루·착고): 폭 w, 높이 h, 둥근 등
function ridgeStrip(buf, pts, w, h, col, colTop) {
  if (pts.length < 2) return;
  const frames = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(...T) || 1;
    T = T.map((q) => q / tl);
    let S = [T[2], 0, -T[0]];
    const sl = Math.hypot(...S) || 1;
    S = S.map((q) => q / sl);
    const U = [T[1] * S[2] - T[2] * S[1], T[2] * S[0] - T[0] * S[2], T[0] * S[1] - T[1] * S[0]];
    if (U[1] < 0) { S = S.map((q) => -q); U[0] = -U[0]; U[1] = -U[1]; U[2] = -U[2]; }
    return { p, S, U };
  });
  const r = w / 2;
  const prof = [[r, -0.04], [r, h - r]];
  for (let k = 1; k < 5; k++) { const a = (k / 5) * Math.PI; prof.push([Math.cos(a) * r, h - r + Math.sin(a) * r]); }
  prof.push([-r, h - r], [-r, -0.04]);
  const at = (F, q) => [F.p[0] + F.S[0] * q[0] + F.U[0] * q[1], F.p[1] + F.S[1] * q[0] + F.U[1] * q[1], F.p[2] + F.S[2] * q[0] + F.U[2] * q[1]];
  for (let i = 0; i < frames.length - 1; i++) {
    const A = frames[i], B = frames[i + 1];
    for (let k = 0; k < prof.length - 1; k++) {
      const q0 = prof[k], q1 = prof[k + 1];
      const mid = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2 - (h - r) * (k > 0 && k < prof.length - 2 ? 1 : 0)];
      const hint = [A.S[0] * mid[0] + A.U[0] * mid[1], A.S[1] * mid[0] + A.U[1] * mid[1], A.S[2] * mid[0] + A.U[2] * mid[1]];
      buf.quad(at(A, q0), at(B, q0), at(B, q1), at(A, q1), null, k > 1 && k < prof.length - 3 ? colTop : col, hint);
    }
  }
  // 끝 막음
  for (const [F, a] of [[frames[0], frames[1]], [frames[frames.length - 1], frames[frames.length - 2]]]) {
    const T = [F.p[0] - a.p[0], F.p[1] - a.p[1], F.p[2] - a.p[2]];
    const ctr = at(F, [0, h * 0.45]);
    for (let k = 0; k < prof.length - 1; k++) buf.tri(ctr, at(F, prof[k]), at(F, prof[k + 1]), null, col, T);
  }
}

// 익공(翼工) 옆모습: x = 바깥으로, y = 기둥머리 기준. 쇠서(끝이 아래로 휜 부리)
let _ikgong = null;
function ikgongGeometry() {
  if (_ikgong) return _ikgong;
  const s = new THREE.Shape();
  s.moveTo(-0.34, -0.28);
  s.lineTo(0.16, -0.28);
  s.quadraticCurveTo(0.34, -0.28, 0.44, -0.19);
  s.quadraticCurveTo(0.56, -0.12, 0.64, -0.15);   // 부리 끝 (아래로 휨)
  s.quadraticCurveTo(0.62, -0.07, 0.54, -0.04);
  s.quadraticCurveTo(0.47, -0.02, 0.44, 0.0);
  s.lineTo(-0.34, 0.0);
  s.lineTo(-0.34, -0.28);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -0.07);
  _ikgong = g;
  return g;
}

let _column = null, _columnKey = '';
function columnGeometry(H, Dm, segs = 9) {
  const key = `${H.toFixed(3)}|${Dm.toFixed(4)}|${segs}`;
  if (_column && _columnKey === key) return _column;
  // 배흘림: 뿌리 0.90·D, H/3 에서 최대 D, 머리 0.78·D
  const pts = [[0.45, 0], [0.5, H / 3], [0.46, 0.66 * H], [0.39, H]].map(([r, y]) => new THREE.Vector2(r * Dm, y));
  _column = new THREE.LatheGeometry(pts, segs);
  _columnKey = key;
  return _column;
}

const _M = new THREE.Matrix4(), _B = new THREE.Matrix4();
const Y3 = [0, 1, 0];

export function createCorridor(def, mats, heightAt, ctx = {}) {
  const E = elementMats(mats);
  const C = E.C;
  const group = new THREE.Group();
  group.name = def.id || 'corridor';
  // 경로 정리 (겹친 점 제거)
  const raw = (def.path || []).map((p) => [p[0], p[1]]);
  const path = [];
  for (const p of raw) if (!path.length || v2.dist(p, path[path.length - 1]) > 0.05) path.push(p);
  if (path.length < 2) return group;
  const closed = !!def.closed && path.length > 2;
  if (closed && v2.dist(path[0], path[path.length - 1]) > 0.05) path.push(path[0].slice());
  const nSeg = path.length - 1;
  const segs = [];
  let acc = 0;
  for (let i = 0; i < nSeg; i++) {
    const a = path[i], b = path[i + 1];
    const len = v2.dist(a, b), t = v2.norm(v2.sub(b, a));
    segs.push({ a, b, len, t, nl: v2.left(t), s0: acc });
    acc += len;
  }
  const W = def.width > 0 ? def.width : 4.5;
  const H = def.columnHeight > 0 ? def.columnHeight : 3;
  const gY = Number.isFinite(def.groundY) ? def.groundY : heightAt ? heightAt(path[0][0], path[0][1]) : 0;
  const dbl = !!def.double;
  const Dc = Math.max(1.6, W - 2 * EDGE);
  const Dm = H / 8.5;
  const F = gY + PLAT_H;
  const baseY = F + PLINTH;
  const Yc = baseY + H;
  const O = 0.55 * H;
  const rows = dbl ? [-Dc / 2, 0, Dc / 2] : [-Dc / 2, Dc / 2];
  const hr = W > 5.2 ? 0.36 : 0.3;
  const low = ctx.detail === 'low';
  const R0 = roofDims(Dc, Yc, O);

  const sink = new Sink();
  const bStone = sink.get(mats.stone), bCol = sink.get(mats.column), bBeam = sink.get(mats.beamPlain);
  const bWood = sink.get(E.wood), bTile = sink.get(mats.tileGray), bTrim = sink.get(E.trim);

  // ── 이웃(다른 회랑) ──
  const others = (ctx.corridors || SPEC.corridors || []).filter((o) => o && o !== def && o.id !== def.id && Array.isArray(o.path) && o.path.length >= 2
    && Math.abs((Number.isFinite(o.groundY) ? o.groundY : gY) - gY) < 0.5);
  const odims = (o) => {
    const oW = o.width > 0 ? o.width : 4.5, oH = o.columnHeight > 0 ? o.columnHeight : 3;
    const oDc = Math.max(1.6, oW - 2 * EDGE);
    const oYc = (Number.isFinite(o.groundY) ? o.groundY : gY) + PLAT_H + PLINTH + oH;
    return { W: oW, Dc: oDc, R: roofDims(oDc, oYc, 0.55 * oH) };
  };

  // ── 끝 분류 ──
  const classify = (which) => {
    const V = which === 0 ? path[0] : path[path.length - 1];
    const sg = which === 0 ? segs[0] : segs[nSeg - 1];
    const bodyDir = which === 0 ? sg.t : v2.mul(sg.t, -1);
    const out = v2.mul(bodyDir, -1);
    if (closed) return { type: 'loop', V, out, bodyDir, sg };
    // 1) 다른 회랑 끝점과 만남 → 모서리
    for (const o of others) {
      const op = o.path, on = op.length;
      for (const oi of [0, on - 1]) {
        if (v2.dist(op[oi], V) > 0.45) continue;
        const oBody = oi === 0 ? v2.norm(v2.sub(op[1], op[0])) : v2.norm(v2.sub(op[on - 2], op[on - 1]));
        if (v2.dot(oBody, bodyDir) > 0.95) continue;
        const od = odims(o);
        const ratio = Math.max(W, od.W) / Math.min(W, od.W);
        if (ratio > 1.15) {
          if (W > od.W) return { type: 'extend', V, out, bodyDir, sg, ext: od.W / 2, other: o };
          // 좁은 쪽: 넓은 회랑의 끝을 늘인 선에 T자로 붙음
          const q = op[oi];
          return { type: 'tee', V, out, bodyDir, sg, other: o, q, od: v2.mul(oBody, -1), ohw: od.W / 2, oR: od.R };
        }
        return { type: 'joint', V, out, bodyDir, sg, other: o, oBody, od };
      }
    }
    // 2) 다른 회랑 옆구리에 T자로 붙음
    for (const o of others) {
      const op = o.path;
      const od = odims(o);
      for (let i = 0; i < op.length - 1; i++) {
        const pr = segProj(V, op[i], op[i + 1]);
        if (pr.d > od.W / 2 + 0.3) continue;
        const odir = v2.norm(v2.sub(op[i + 1], op[i]));
        if (Math.abs(v2.dot(odir, bodyDir)) > 0.8) continue;
        return { type: 'tee', V, out, bodyDir, sg, other: o, q: pr.q, od: odir, ohw: od.W / 2, oR: od.R };
      }
    }
    // 3) 건물 기단
    for (const b of ctx.buildings || SPEC.buildings || []) {
      if (!(b.platformW > 0)) continue;
      const Rb = orientedRect(b.cx, b.cz, b.platformW / 2, b.platformD / 2, b.rotationDeg);
      if (rectDist(Rb, V) < 0.6) return { type: 'building', V, out, bodyDir, sg, b };
    }
    // 4) 계단(회랑 안에서 오르내림)
    for (const s of ctx.stairs || SPEC.stairs || []) {
      const r = ((s.rotationDeg || 0) * Math.PI) / 180;
      const asc = [Math.sin(r), -Math.cos(r)];
      if (Math.abs(v2.dot(asc, out)) < 0.9) continue;
      const c = [s.cx, s.cz];
      const top = v2.madd(c, asc, s.run / 2), bot = v2.madd(c, asc, -s.run / 2);
      if (v2.dist(V, top) < W / 2 || v2.dist(V, bot) < W / 2) return { type: 'stair', V, out, bodyDir, sg, run: s.run };
    }
    return { type: 'free', V, out, bodyDir, sg };
  };
  const ends = [classify(0), classify(1)];

  // T 끝: 상대 중심선·가장자리선과 내 중심선의 교점, 상대 쪽 부호
  for (const e of ends) {
    if (e.type !== 'tee') continue;
    const nlo = v2.left(e.od);
    e.side = Math.sign(v2.dot(v2.sub(v2.madd(e.V, e.bodyDir, 1.5), e.q), nlo)) || 1;
    e.nlo = nlo;
    const edgeP = v2.madd(e.q, nlo, e.side * e.ohw);
    e.trim = lineX(e.V, e.bodyDir, edgeP, e.od) || e.V;
    e.center = lineX(e.V, e.bodyDir, e.q, e.od) || e.V;
  }
  // 모서리(joint): 가상의 이어진 꺾은선에서 들어오는/나가는 방향
  for (const [w, e] of ends.entries()) {
    if (e.type !== 'joint') continue;
    if (w === 1) { e.aIn = e.sg.t; e.bOut = e.oBody; } else { e.aIn = v2.mul(e.oBody, -1); e.bOut = e.sg.t; }
    e.nIn = v2.left(e.aIn); e.nOut = v2.left(e.bOut);
    e.mine = w; // 내가 들어오는 쪽(1) / 나가는 쪽(0)
    // 내 옆 거리 d1, 상대 옆 거리 d2 → 교점
    e.pt = (d1, d2) => {
      const mineN = w === 1 ? e.nIn : e.nOut, mineT = w === 1 ? e.aIn : e.bOut;
      const othN = w === 1 ? e.nOut : e.nIn, othT = w === 1 ? e.bOut : e.aIn;
      return lineX(v2.madd(e.V, mineN, d1), mineT, v2.madd(e.V, othN, d2), othT) || v2.madd(e.V, mineN, d1);
    };
    e.emit = String(def.id) < String(e.other.id);
    e.oDc = e.od.Dc;
    e.oW = e.od.W;
  }

  // ── 기둥 줄(station) ──
  const stations = [];
  for (let i = 0; i < nSeg; i++) {
    const sg = segs[i];
    const nb = Math.max(1, Math.round(def.segmentBays?.[i] > 0 ? def.segmentBays[i] : sg.len / (def.bayLength || 4.2)));
    for (let j = i === 0 ? 0 : 1; j <= nb; j++) {
      const p = v2.madd(sg.a, sg.t, (sg.len * j) / nb);
      const vtx = j === nb && i < nSeg - 1;
      const m = vtx ? miterVec(sg.t, segs[i + 1].t) : sg.nl;
      stations.push({ p, s: sg.s0 + (sg.len * j) / nb, m, dir: vtx ? v2.norm(v2.add(sg.t, segs[i + 1].t)) : sg.t, emit: true, pos: null });
    }
  }
  if (closed) {
    // 첫·끝 점을 꺾임점으로
    const m = miterVec(segs[nSeg - 1].t, segs[0].t);
    stations[0].m = m; stations[0].dir = v2.norm(v2.add(segs[nSeg - 1].t, segs[0].t));
    stations.pop();
  }
  const setEnd = (w, e) => {
    const k = w === 0 ? 0 : stations.length - 1;
    const st = stations[k];
    const inward = e.bodyDir;
    if (e.type === 'free' || e.type === 'stair') { st.p = v2.madd(e.V, inward, EDGE); st.s += w === 0 ? EDGE : -EDGE; }
    else if (e.type === 'building') { st.p = v2.madd(e.V, inward, 0.45); st.s += w === 0 ? 0.45 : -0.45; }
    else if (e.type === 'tee') {
      const d0 = v2.dot(v2.sub(e.trim, e.V), inward) + 0.45;
      st.p = v2.madd(e.V, inward, d0); st.s += w === 0 ? d0 : -d0;
      const nb = stations[w === 0 ? 1 : stations.length - 2];
      if (nb && v2.dist(nb.p, st.p) < 1.2) stations.splice(k, 1);
    } else if (e.type === 'joint') {
      st.p = e.V;
      st.emit = e.emit;
      st.pos = (d) => (Math.abs(d) < 1e-6 ? e.V : e.pt(d, Math.sign(d) * e.oDc / 2));
      st.joint = e;
    } else if (e.type === 'extend') {
      const far = e.ext - EDGE;
      if (far > 0.8) {
        const extra = { p: v2.madd(e.V, e.out, far), s: st.s + (w === 0 ? -far : far), m: st.m, dir: st.dir, emit: true, pos: null };
        if (w === 0) stations.unshift(extra); else stations.push(extra);
      }
    }
  };
  if (!closed) { setEnd(1, ends[1]); setEnd(0, ends[0]); }
  for (const st of stations) if (!st.pos) st.pos = ((p, m) => (d) => v2.madd(p, m, d))(st.p, st.m);

  // ── 바깥 방향(일곽 안쪽의 반대) ──
  const connector = /천랑|연결/.test(def.nameKo || '') || /cheonrang|link/.test(def.id || '');
  const wallMode = def.outerWall === false ? 'none' : connector ? 'none' : dbl ? 'center' : 'outer';
  let court = null;
  const ter = (ctx.terraces || SPEC.terraces || []).find((t) => t.id === def.terraceId);
  if (ter) court = [ter.cx, ter.cz];
  if (!court) { court = [0, 0]; for (const p of path) { court[0] += p[0] / path.length; court[1] += p[1] / path.length; } }
  const segOut = segs.map((sg) => {
    const mid = v2.mul(v2.add(sg.a, sg.b), 0.5);
    return -Math.sign(v2.dot(v2.sub(court, mid), sg.nl)) || -1;
  });

  // ── 기단 ──
  const platProf = [
    { d: W / 2, y: gY - 0.3, tag: 'side' }, { d: W / 2, y: F, tag: 'top' },
    { d: -W / 2, y: F, tag: 'side' }, { d: -W / 2, y: gY - 0.3, tag: null },
  ];
  const endSection = (w, e, kind) => {
    // kind: 'plat' | 'roof'
    const V = e.V, nl = e.sg.nl;
    if (e.type === 'joint') {
      if (kind === 'plat') {
        const k = e.oW / W;
        const P1 = e.pt(1, k);
        return { o: V, m: v2.sub(P1, V), joint: true };
      }
      const P1 = e.pt(1, 1);
      return { o: V, m: v2.sub(P1, V), joint: true };
    }
    if (e.type === 'tee') {
      const m = v2.mul(e.od, 1 / (v2.dot(e.od, nl) || 1));
      return { o: kind === 'plat' ? e.trim : e.center, m, tee: true };
    }
    let ext = 0;
    if (kind === 'roof') {
      ext = e.type === 'building' ? 0.3 : e.type === 'stair' ? 0.55 * e.run : 0.25;
      if (e.type === 'extend') ext += e.ext;
    } else if (e.type === 'extend') ext = e.ext;
    return { o: v2.madd(V, e.out, ext), m: nl, gable: kind === 'roof' };
  };
  {
    const secs = [];
    if (closed) {
      for (let i = 0; i <= nSeg; i++) {
        const k = i % nSeg;
        secs.push({ o: path[i], m: miterVec(segs[(k - 1 + nSeg) % nSeg].t, segs[k].t), prof: platProf });
      }
    } else {
      secs.push({ ...endSection(0, ends[0], 'plat'), prof: platProf });
      for (let i = 1; i < nSeg; i++) secs.push({ o: path[i], m: miterVec(segs[i - 1].t, segs[i].t), prof: platProf });
      secs.push({ ...endSection(1, ends[1], 'plat'), prof: platProf });
    }
    sweep(secs, {
      side: { buf: bStone, uv: (p, u, v, q) => [u / 4, q.y / 2] },
      top: { buf: bStone, uv: (p, u, v, q) => [u / 4, q.d / 2 + 0.25] },
    }, { closed: true });
    if (!closed) {
      for (const [w, S] of [[0, secs[0]], [1, secs[secs.length - 1]]]) {
        const e = ends[w];
        if (e.type === 'joint' || e.type === 'tee') continue;
        capSection(bStone, S, [0, 1, 2, 3], e.out, (p) => worldUV(p, [e.out[0], 0, e.out[1]], [4, 2]));
      }
    }
  }

  // ── 초석·기둥 ──
  const colGeo = columnGeometry(H, Dm, low ? 6 : 9);
  const plinth = new THREE.CylinderGeometry(0.8 * Dm * 0.94, 0.8 * Dm, PLINTH + 0.05, 10, 1, false);
  plinth.deleteAttribute('uv');
  const stoneUV = (p, n) => worldUV(p, n, [2, 2]);
  for (const st of stations) {
    if (!st.emit) continue;
    for (const d of rows) {
      const p = st.pos(d);
      _M.makeTranslation(p[0], F + (PLINTH - 0.05) / 2, p[1]);
      bStone.addGeometry(plinth, _M, { uvFn: stoneUV });
      _M.makeTranslation(p[0], baseY, p[1]);
      bCol.addGeometry(colGeo, _M);
    }
  }
  plinth.dispose();

  // ── 공포(주두·익공)·대들보·대공 ──
  const juduGeo = new THREE.CylinderGeometry(0.2 * Math.SQRT2, 0.155 * Math.SQRT2, 0.2, 4, 1, false);
  juduGeo.rotateY(Math.PI / 4);
  const underCol = (n) => (n[1] < -0.4 ? C.hwangdan : C.timber);
  const ik = ikgongGeometry();
  const yRof = (st) => roofDims(dcAt(st.s), Yc, O).yR;
  // 지붕 Dc 보간 (모서리에서 너비가 다른 회랑과 맞추려고 끝 몇 m 동안 평균 쪽으로)
  const totalLen = acc;
  const blends = [];
  for (const [w, e] of ends.entries()) {
    if (e.type !== 'joint' || Math.abs(e.oDc - Dc) < 1e-3) continue;
    const skew = R0.De + TILE_OV + 0.3;
    blends.push({ w, target: (Dc + e.oDc) / 2, s0: w === 0 ? skew : totalLen - skew, len: 4 });
  }
  function dcAt(s) {
    let v = Dc;
    for (const b of blends) {
      const dist = b.w === 0 ? b.s0 - s : s - b.s0;   // 모서리 쪽으로 갈수록 +
      const k = dist >= 0 ? 1 : smooth01(1 + dist / b.len);
      v = lerp(v, b.target, k);
    }
    return v;
  }

  for (const st of stations) {
    if (!st.emit) continue;
    const pA = st.pos(rows[0]), pB = st.pos(rows[rows.length - 1]);
    const across = v2.norm(v2.sub(pB, pA));
    const along = [-across[1], across[0]];
    const ang = Math.atan2(-st.dir[1], st.dir[0]);
    for (const d of rows) {
      const p = st.pos(d);
      // 주두
      _M.makeRotationY(ang).setPosition(p[0], Yc + 0.1, p[1]);
      bWood.addGeometry(juduGeo, _M, { colFn: underCol });
      // 익공: 바깥 줄 기둥에서 바깥으로
      if (d !== 0) {
        const oo = Math.sign(d) > 0 ? v2.norm(v2.sub(pB, st.pos(0))) : v2.norm(v2.sub(pA, st.pos(0)));
        const Xv = new THREE.Vector3(oo[0], 0, oo[1]), Yv = new THREE.Vector3(0, 1, 0), Zv = new THREE.Vector3().crossVectors(Xv, Yv);
        _B.makeBasis(Xv, Yv, Zv).setPosition(p[0], Yc - 0.01, p[1]);
        bWood.addGeometry(ik, _B, { colFn: underCol });
      }
    }
    // 대들보: 첫 줄 → 끝 줄 + 보머리 0.32
    const L = v2.dist(pA, pB) + 0.64;
    const cxz = v2.mul(v2.add(pA, pB), 0.5);
    box(bBeam, [cxz[0], Yc + 0.33, cxz[1]], [across[0], 0, across[1]], Y3, [along[0], 0, along[1]], L / 2, 0.17, 0.13, { uv: 'member' });
    // 대공 (사다리꼴 판) + 종도리 장혀 받침
    const yR = yRof(st);
    const c0 = st.pos(0);
    const yTop = yR - 0.26 - 0.12;
    taper(bWood, [c0[0], Yc + 0.5, c0[1]], yTop, [across[0], 0, across[1]], [along[0], 0, along[1]], 0.36, 0.16, 0.07, C.timber);
    if (dbl) {
      // 동자주: 중도리 받침
      for (const sgn of [-1, 1]) {
        const q = v2.madd(c0, across, sgn * v2.dist(pA, pB) / 4);
        const yM = (yR + R0.yP) / 2 - 0.26;
        box(bWood, [q[0], (Yc + 0.5 + yM) / 2, q[1]], Y3, [across[0], 0, across[1]], [along[0], 0, along[1]], (yM - Yc - 0.5) / 2, 0.09, 0.09, { uv: 'member', col: C.timber, skip: ['-x', '+x'] });
      }
    }
  }
  juduGeo.dispose();

  // ── 칸마다: 창방·장혀·도리 ──
  // 도리 줄은 지붕 끝까지: 박공이면 박공판 안쪽, T 끝이면 상대 회랑의 도리(또는 개판)까지
  const roofEndPt = (w, d, yTop) => {
    const e = ends[w];
    if (closed || e.type === 'joint') return null;
    const S = endSection(w, e, 'roof');
    if (!S.tee) return v2.madd(v2.madd(S.o, S.m, d), e.out, -0.07);
    const base = v2.madd(e.V, e.sg.nl, d);
    let eo;
    if (d !== 0) eo = e.oR.Dc / 2;
    else {
      const ys = e.oR.ys, lim = e.oR.De;
      if (yTop >= ys(0)) eo = 0;
      else {
        let lo = 0, hi = lim;
        for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (ys(mid) > yTop) lo = mid; else hi = mid; }
        eo = lo;
      }
    }
    return lineX(base, e.out, v2.madd(e.q, e.nlo, e.side * eo), e.od) || null;
  };
  const beamPieces = [];
  for (let j = 0; j < stations.length - 1 + (closed ? 1 : 0); j++) {
    beamPieces.push([stations[j], stations[(j + 1) % stations.length]]);
  }
  for (const [A, B] of beamPieces) {
    for (const d of rows) {
      const a = A.pos(d), b = B.pos(d);
      const dir = v2.norm(v2.sub(b, a));
      const a2 = v2.madd(a, dir, -0.1), b2 = v2.madd(b, dir, 0.1);
      const L = v2.dist(a2, b2), c = v2.mul(v2.add(a2, b2), 0.5);
      const nrm = [-dir[1], 0, dir[0]];
      // 창방
      box(bBeam, [c[0], Yc - 0.15, c[1]], [dir[0], 0, dir[1]], Y3, nrm, L / 2, 0.15, 0.1, { uv: 'member', skip: ['-x', '+x'] });
      if (d !== 0) {
        // 장혀 + 주심도리
        box(bBeam, [c[0], Yc + 0.46, c[1]], [dir[0], 0, dir[1]], Y3, nrm, L / 2, 0.07, 0.065, { uv: 'member', skip: ['-x', '+x', '-y'] });
        tube(bBeam, [a2[0], R0.yP - 0.13, a2[1]], [b2[0], R0.yP - 0.13, b2[1]], 0.13, 8);
      }
    }
    // 종도리 + 받침 장혀
    const a = A.pos(0), b = B.pos(0);
    const ya = yRof(A) - 0.13, yb = yRof(B) - 0.13;
    tube(bBeam, [a[0], ya, a[1]], [b[0], yb, b[1]], 0.13, 8);
    const dir = v2.norm(v2.sub(b, a));
    const nrm = [-dir[1], 0, dir[0]];
    const L = v2.dist(a, b);
    const c = v2.mul(v2.add(a, b), 0.5);
    box(bBeam, [c[0], (ya + yb) / 2 - 0.19, c[1]], [dir[0], (yb - ya) / (L || 1), dir[1]].map((q, i, arr) => q / Math.hypot(...arr)), Y3, nrm, L / 2, 0.06, 0.06, { uv: 'member', skip: ['-x', '+x'] });
    if (dbl) {
      for (const sgn of [-1, 1]) {
        const qa = v2.madd(a, v2.norm(v2.sub(A.pos(rows[2]), A.pos(rows[0]))), sgn * v2.dist(A.pos(rows[0]), A.pos(rows[2])) / 4);
        const qb = v2.madd(b, v2.norm(v2.sub(B.pos(rows[2]), B.pos(rows[0]))), sgn * v2.dist(B.pos(rows[0]), B.pos(rows[2])) / 4);
        const yM = (yRof(A) + R0.yP) / 2 - 0.13, yMb = (yRof(B) + R0.yP) / 2 - 0.13;
        tube(bBeam, [qa[0], yM, qa[1]], [qb[0], yMb, qb[1]], 0.12, 8);
      }
    }
  }
  // 끝 칸 밖으로 박공까지 뻗는 도리
  if (!closed) {
    for (const w of [0, 1]) {
      const st = w === 0 ? stations[0] : stations[stations.length - 1];
      const dl = [...rows.filter((d) => d !== 0), 0];
      for (const d of dl) {
        const y = d === 0 ? yRof(st) - 0.13 : R0.yP - 0.13;
        const pe = roofEndPt(w, d, y + 0.13);
        if (!pe) continue;
        const ps = st.pos(d);
        tube(bBeam, [ps[0], y, ps[1]], [pe[0], y, pe[1]], 0.13, 8);
      }
    }
  }

  // ── 지붕 ──
  const roofSecs = [];
  const pushSec = (o, m, s, extra = {}) => roofSecs.push({ o, m, s, Dc: dcAt(s), ...extra });
  if (closed) {
    for (let i = 0; i <= nSeg; i++) {
      const k = i % nSeg;
      pushSec(path[i], miterVec(segs[(k - 1 + nSeg) % nSeg].t, segs[k].t), i === nSeg ? totalLen : segs[k].s0, { vertex: true, seg: Math.min(i, nSeg - 1) });
    }
  } else {
    const S0 = endSection(0, ends[0], 'roof');
    pushSec(S0.o, S0.m, v2.dot(v2.sub(S0.o, path[0]), segs[0].t), { end: 0, ...S0, seg: 0 });
    for (const b of blends) {
      if (b.w !== 0) continue;
      for (const k of [0, 0.5, 1]) {
        const s = b.s0 + k * b.len;
        if (s < segs[0].len - 0.5) pushSec(v2.madd(path[0], segs[0].t, s), segs[0].nl, s, { seg: 0 });
      }
    }
    for (let i = 1; i < nSeg; i++) pushSec(path[i], miterVec(segs[i - 1].t, segs[i].t), segs[i].s0, { vertex: true, seg: i });
    for (const b of blends) {
      if (b.w !== 1) continue;
      const sl = segs[nSeg - 1];
      for (const k of [1, 0.5, 0]) {
        const s = b.s0 - k * b.len;
        if (s > sl.s0 + 0.5) pushSec(v2.madd(sl.a, sl.t, s - sl.s0), sl.nl, s, { seg: nSeg - 1 });
      }
    }
    const S1 = endSection(1, ends[1], 'roof');
    const sl = segs[nSeg - 1];
    pushSec(S1.o, S1.m, sl.s0 + v2.dot(v2.sub(S1.o, sl.a), sl.t), { end: 1, ...S1, seg: nSeg - 1 });
  }
  roofSecs.sort((a, b) => a.s - b.s);
  for (const S of roofSecs) { S.R = roofDims(S.Dc, Yc, O); S.prof = roofProfile(S.R); }
  // T 끝: 단면 점마다 상대 지붕면과 만나는 곳까지 (평면에서 V 자 골)
  for (const S of roofSecs) {
    if (!S.tee) continue;
    const e = ends[S.end];
    S.xz = S.prof.map((q) => teePoint(e, q, S.R));
  }
  const tileUV = { buf: bTile, su: 1.2, sv: 1.2, smooth: true, smoothCos: 0.7 };
  const roofTags = {
    tile: { ...tileUV, uv: (p, u, v) => [u / 1.2, v / 1.2] },
    makse: { buf: bTrim, col: C.makseFace, uv: (p, u) => [u, 0] },
    under: { buf: bTrim, col: C.eaveDark, uv: (p, u) => [u, 0] },
    wood: { buf: bWood, col: C.timber, uv: (p, u) => [u, 0] },
    soffit: { buf: bWood, col: C.soffit, uv: (p, u) => [u, 0] },
  };
  sweepX(roofSecs, roofTags);
  // 용마루
  const ridgeSecs = roofSecs.map((S) => {
    const prof = ridgeProfile(S.R, hr);
    let xz = null;
    if (S.tee) xz = prof.map((q) => teePoint(ends[S.end], { ...q, tag: 'tile' }, S.R, true));
    return { o: S.o, m: S.m, prof, xz };
  });
  sweepX(ridgeSecs, {
    white: { buf: bTrim, col: C.white },
    ridge: { buf: bTrim, col: C.ridge },
    cap: { buf: bTrim, col: C.ridgeDark, smooth: true, smoothCos: 0.5 },
  });

  // ── 박공(맞배 끝): 박공판 + 목기와 + 용마루 끝 막음 ──
  for (const S of roofSecs) {
    if (!S.gable) continue;
    const e = ends[S.end];
    gableEnd(bWood, bTrim, S, e.out, C, hr);
  }
  // T 끝에서 상대 용마루보다 높이 솟은 박공 삼각형 막음
  for (const S of roofSecs) {
    if (!S.tee) continue;
    const e = ends[S.end];
    const yTopO = e.oR.yt(0);
    const pts = S.prof.filter((q) => q.tag === 'tile' && q.y > yTopO + 0.02);
    if (pts.length >= 2) {
      const dmax = Math.max(...pts.map((q) => Math.abs(q.d)));
      const poly = [{ d: dmax, y: yTopO }, ...pts, { d: -dmax, y: yTopO }];
      const P3 = poly.map((q) => { const xz = v2.madd(e.center, S.m, q.d); return [xz[0], q.y + 0.01, xz[1]]; });
      bWood.polygon(P3, poly.map((q) => [q.d, q.y]), [e.out[0], 0, e.out[1]], () => [0, 0], C.timber);
    }
  }

  // ── 추녀마루(ㄱ자 바깥 모서리) ──
  for (const S of roofSecs) {
    if (!(S.vertex || S.joint)) continue;
    if (S.joint && !ends[S.end].emit) continue;
    // 바깥쪽 = 꺾임의 볼록한 쪽
    let a, b;
    if (S.joint) { const e = ends[S.end]; a = e.aIn; b = e.bOut; } else { a = segs[S.seg - 1 >= 0 ? S.seg - 1 : nSeg - 1].t; b = segs[S.seg].t; }
    const turn = v2.cross(a, b);
    if (Math.abs(turn) < 0.05) continue;
    const so = Math.sign(turn);
    const R = S.R;
    const Dt = R.De + TILE_OV;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const d = so * (0.18 + (Dt - 0.18) * (k / 8));
      const xz = v2.madd(S.o, S.m, d);
      pts.push([xz[0], R.yt(d) - 0.01, xz[1]]);
    }
    ridgeStrip(bTrim, pts, 0.26, 0.22, C.ridge, C.ridgeDark);
    // 안쪽 골: 어두운 골 기와 줄
    const vpts = [];
    for (let k = 0; k <= 8; k++) {
      const d = -so * (0.2 + (Dt - 0.25) * (k / 8));
      const xz = v2.madd(S.o, S.m, d);
      vpts.push([xz[0], R.yt(d) - 0.03, xz[1]]);
    }
    ridgeStrip(bTrim, vpts, 0.3, 0.05, C.eaveDark, C.eaveDark);
  }

  // ── 서까래 (연등천장, V자 단면) · 막새 ──
  if (!low) {
    buildRafters(bWood, roofSecs, C);
    buildMakse(bTrim, roofSecs, C);
  }

  // ── 바깥벽(회벽 + 살창) ──
  if (wallMode !== 'none') {
    const bPl = sink.get(mats.plasterPlain), bWin = sink.get(E.salchang);
    buildWalls({ bPl, bWin, bWood, C }, {
      stations, rows, wallMode, segOut, segs, ends, closed, F, Yc, others, W,
    });
  }

  // 결과
  sink.build(group, def.id, 'corridor');
  group.userData = { id: def.id, nameKo: def.nameKo, kind: 'corridor', pickId: def.id, ends: ends.map((e) => e.type), tris: sink.tris };
  return group;

  // T 끝의 단면 점 → 상대 지붕면에 닿는 평면 위치
  function teePoint(e, q, R, ridge = false) {
    const oR = e.oR;
    const y = q.y;
    // 상대 기와면(또는 개판) 높이가 y 가 되는 옆 거리
    const surf = q.tag === 'soffit' || q.tag === 'wood' || q.tag === 'under' ? oR.ys : oR.yt;
    const lim = oR.De + TILE_OV;
    let eo;
    if (y >= surf(0)) eo = 0;
    else if (y <= surf(lim)) eo = lim;
    else {
      let lo = 0, hi = lim;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (surf(mid) > y) lo = mid; else hi = mid; }
      eo = (lo + hi) / 2;
    }
    if (ridge) eo = Math.max(0, eo - 0.05);
    const nl = e.sg.nl;
    const base = v2.madd(e.V, nl, q.d);
    const t = e.out;
    const den = v2.dot(t, e.nlo);
    const u = Math.abs(den) < 1e-6 ? 0 : (e.side * eo - v2.dot(v2.sub(base, e.q), e.nlo)) / den;
    return v2.madd(base, t, u);
  }
}

// 단면 중 하나라도 점별 위치(xz: T 끝처럼 평면에서 꺾인 끝)를 가지면 sweepDirect, 아니면 공용 sweep
function sweepX(secs, tags) {
  if (secs.some((S) => S.xz)) sweepDirect(secs, tags);
  else sweep(secs, tags, { closed: true });
}

// 점별 위치를 가진 단면들을 잇는 스윕 (sweep 과 같은 규칙, 위치만 다름)
function sweepDirect(secs, tags) {
  const mapped = secs.map((S) => ({ ...S, pts: S.xz || S.prof.map((q) => v2.madd(S.o, S.m, q.d)) }));
  const np = mapped[0].prof.length;
  const P3 = mapped.map((S) => S.prof.map((q, k) => [S.pts[k][0], q.y, S.pts[k][1]]));
  const ns = mapped.length;
  const uAcc = mapped.map(() => new Float64Array(np));
  for (let i = 1; i < ns; i++) for (let k = 0; k < np; k++) {
    const a = P3[i - 1][k], b = P3[i][k];
    uAcc[i][k] = uAcc[i - 1][k] + Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const vAcc = mapped.map((S) => {
    const arr = new Float64Array(np + 1);
    for (let k = 1; k <= np; k++) { const a = S.prof[k - 1], b = S.prof[k % np]; arr[k] = arr[k - 1] + Math.hypot(b.d - a.d, b.y - a.y); }
    return arr;
  });
  for (let i = 0; i < ns - 1; i++) {
    const A = mapped[i], B = mapped[i + 1];
    const oa = A.o, ob = B.o;
    const dir = v2.norm(v2.sub(ob, oa));
    const nl = v2.left(dir);
    const edgeN = (S, k) => {
      const a = S.prof[k], b = S.prof[(k + 1) % np];
      const dd = b.d - a.d, dy = b.y - a.y; const l = Math.hypot(dd, dy) || 1;
      return [dy / l, -dd / l];
    };
    const to3 = (n2) => [nl[0] * n2[0], n2[1], nl[1] * n2[0]];
    const vertN = (S, k, side) => {
      const tg = S.prof[k].tag, T = tags[tg];
      const e = edgeN(S, k);
      if (!T || !T.smooth) return to3(e);
      const kk = (side === 0 ? k - 1 + np : k + 1) % np;
      if (S.prof[kk].tag !== tg) return to3(e);
      const e2 = edgeN(S, kk);
      if (e[0] * e2[0] + e[1] * e2[1] < (T.smoothCos ?? 0.8)) return to3(e);
      const s = [e[0] + e2[0], e[1] + e2[1]]; const l = Math.hypot(...s) || 1;
      return to3([s[0] / l, s[1] / l]);
    };
    for (let k = 0; k < np; k++) {
      const T = tags[A.prof[k].tag];
      if (!T) continue;
      const k1 = (k + 1) % np;
      const a0 = P3[i][k], a1 = P3[i][k1], b0 = P3[i + 1][k], b1 = P3[i + 1][k1];
      let U;
      if (typeof T.uv === 'function') {
        U = [...T.uv(a0, uAcc[i][k], vAcc[i][k]), ...T.uv(a1, uAcc[i][k1], vAcc[i][k + 1]), ...T.uv(b1, uAcc[i + 1][k1], vAcc[i + 1][k + 1]), ...T.uv(b0, uAcc[i + 1][k], vAcc[i + 1][k])];
      } else U = [0, 0, 0, 0, 0, 0, 0, 0];
      T.buf.quadN(a0, a1, b1, b0, vertN(A, k, 0), vertN(A, k, 1), vertN(B, k, 1), vertN(B, k, 0), U, T.col || null);
    }
  }
}

// 사다리꼴 판(대공): 아래 중심 c, 윗면 높이 yTop, 판 방향 ax(가로), 두께 방향 az
function taper(buf, c, yTop, ax, az, hwB, hwT, ht, col) {
  const y0 = c[1], y1 = yTop;
  const P = (sx, top, sz) => {
    const hw = top ? hwT : hwB;
    return [c[0] + ax[0] * hw * sx + az[0] * ht * sz, top ? y1 : y0, c[2] + ax[2] * hw * sx + az[2] * ht * sz];
  };
  for (const sz of [-1, 1]) buf.quad(P(-1, 0, sz), P(1, 0, sz), P(1, 1, sz), P(-1, 1, sz), null, col, [az[0] * sz, 0, az[2] * sz]);
  for (const sx of [-1, 1]) buf.quad(P(sx, 0, -1), P(sx, 0, 1), P(sx, 1, 1), P(sx, 1, -1), null, col, [ax[0] * sx, 0.2, ax[2] * sx]);
}

// 박공판·목기와·용마루 끝 막음
function gableEnd(bWood, bTrim, S, out, C, hr) {
  const R = S.R;
  const Dt = R.De + TILE_OV;
  const ds = [];
  for (let k = -12; k <= 12; k++) ds.push((k / 12) * Dt);
  const th = 0.06;
  const at = (d, y, o = 0) => { const xz = v2.madd(v2.madd(S.o, S.m, d), out, o); return [xz[0], y, xz[1]]; };
  const top = (d) => R.yt(d) + 0.03, bot = (d) => R.yt(d) - 0.5;
  const nOut = [out[0], 0, out[1]], nIn = [-out[0], 0, -out[1]];
  for (let i = 0; i < ds.length - 1; i++) {
    const a = ds[i], b = ds[i + 1];
    bWood.quad(at(a, bot(a), th), at(b, bot(b), th), at(b, top(b), th), at(a, top(a), th), null, C.timber, nOut);
    bWood.quad(at(a, bot(a), -0.005), at(b, bot(b), -0.005), at(b, top(b), -0.005), at(a, top(a), -0.005), null, C.timberDark, nIn);
    bWood.quad(at(a, bot(a), -0.005), at(b, bot(b), -0.005), at(b, bot(b), th), at(a, bot(a), th), null, C.timberDark, [0, -1, 0]);
    // 백분 선 (박공판 아래 모서리)
    bWood.quad(at(a, bot(a) + 0.045, th + 0.002), at(b, bot(b) + 0.045, th + 0.002), at(b, bot(b), th + 0.002), at(a, bot(a), th + 0.002), null, C.white, nOut);
  }
  // 목기와(박공 기와 줄)
  const pts = ds.map((d) => at(d, R.yt(d) + 0.0, 0.02));
  ridgeStrip(bTrim, pts, 0.16, 0.1, C.ridge, C.ridgeDark);
  // 처마 끝 박공판 마구리
  for (const sg of [-1, 1]) {
    const d = sg * Dt;
    bWood.quad(at(d, bot(d), -0.005), at(d, bot(d), th), at(d, top(d), th), at(d, top(d), -0.005), null, C.timberDark, [S.m[0] * sg, 0, S.m[1] * sg]);
  }
  // 용마루 끝: 망와 느낌의 반원판
  const yb = R.yt(0.22) - 0.02;
  const c = at(0, yb + hr * 0.55, th + 0.03);
  const rr = 0.24;
  const pts2 = [];
  for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; pts2.push(at(Math.cos(a) * rr, yb + hr * 0.2 + Math.sin(a) * rr * 1.25, th + 0.03)); }
  for (let k = 0; k < 8; k++) bTrim.tri(c, pts2[k], pts2[k + 1], null, C.ridgeDark, nOut);
}

// 서까래: 구간마다 0.33 m 간격, 마이터·박공·T 끝 선 안쪽만
function buildRafters(buf, secs, C) {
  const rw = 0.068, rd = 0.1;
  // 구간 목록: 꼭짓점 단면 사이 (T 끝·박공·마이터 선으로 서까래를 자름)
  const cuts = [];
  for (let i = 0; i < secs.length; i++) if (i === 0 || i === secs.length - 1 || secs[i].vertex || secs[i].joint) cuts.push(i);
  for (let c = 0; c < cuts.length - 1; c++) {
    const A = secs[cuts[c]], B = secs[cuts[c + 1]];
    const dir = v2.norm(v2.sub(B.o, A.o));
    const nl = v2.left(dir);
    const len = v2.dist(A.o, B.o);
    const clipSecs = [A, B];
    const De = Math.max(A.R.De, B.R.De);
    const n0 = Math.floor(-De / TIES), n1 = Math.ceil((len + De) / TIES);
    for (let n = n0; n <= n1; n++) {
      const s = (n + 0.5) * TIES;
      const cpt = v2.madd(A.o, dir, s);
      const t = clamp(s / (len || 1), 0, 1);
      const Rs = t < 0.5 ? A.R : B.R;
      for (const sg of [-1, 1]) {
        let lo = 0, hi = Rs.De;
        let ok = true;
        for (const S of clipSecs) {
          const lines = S.xz ? teeLines(S, sg) : [{ o: S.o, m: S.m }];
          for (const L of lines) {
            const inside = v2.mul(v2.add(A.o, B.o), 0.5);
            const sIn = Math.sign(v2.cross(L.m, v2.sub(inside, L.o))) || 1;
            const nd = v2.mul(nl, sg);
            const f0 = v2.cross(L.m, v2.sub(cpt, L.o)), f1 = v2.cross(L.m, nd);
            const Aa = sIn * f1, Bb = sIn * f0;
            if (Math.abs(Aa) < 1e-9) { if (Bb < -1e-6) ok = false; continue; }
            const dz = -Bb / Aa;
            if (Aa > 0) lo = Math.max(lo, dz); else hi = Math.min(hi, dz);
          }
        }
        if (!ok || hi - lo < 0.15) continue;
        lo += lo > 0 ? 0.05 : 0; hi -= hi < Rs.De - 1e-3 ? 0.05 : 0;
        // 기둥선에서 꺾임
        const parts = [];
        if (lo < Rs.half) parts.push([lo, Math.min(hi, Rs.half)]);
        if (hi > Rs.half) parts.push([Math.max(lo, Rs.half), hi]);
        for (const [d0, d1] of parts) {
          const p0 = v2.madd(cpt, nl, sg * d0), p1 = v2.madd(cpt, nl, sg * d1);
          const y0 = Rs.ys(d0) - 0.005, y1 = Rs.ys(d1) - 0.005;
          // 사다리꼴 단면(둥근 서까래 흉내): 위 폭 2·rw, 아래 폭 1.2·rw, 깊이 rd
          const sx = [dir[0], 0, dir[1]];
          const at = (p, y, u, dv) => [p[0] + sx[0] * u, y - dv, p[1] + sx[2] * u];
          const prof = [[-rw, 0], [-0.62 * rw, 0.8 * rd], [0.62 * rw, 0.8 * rd], [rw, 0]];
          for (let k = 0; k < 3; k++) {
            const [ua, va] = prof[k], [ub, vb] = prof[k + 1];
            const nrm = k === 1 ? [0, -1, 0] : [sx[0] * (k === 0 ? -1 : 1), -0.6, sx[2] * (k === 0 ? -1 : 1)];
            buf.quad(at(p0, y0, ua, va), at(p1, y1, ua, va), at(p1, y1, ub, vb), at(p0, y0, ub, vb), null, C.timber, nrm);
          }
          if (d1 >= Rs.De - 0.06) {
            const ends = prof.map(([u, dv]) => at(p1, y1, u, dv));
            buf.quad(ends[0], ends[1], ends[2], ends[3], null, C.rafterEnd, [nl[0] * sg, -0.2, nl[1] * sg]);
          }
        }
      }
    }
  }
}

// T 끝 단면의 한쪽(부호 sg) 끝선 두 점으로 만든 선 (서까래 자르기용)
function teeLines(S, sg) {
  const idx = S.prof.map((q, k) => k).filter((k) => S.prof[k].tag === 'soffit');
  const pick = idx.filter((k) => Math.sign(S.prof[k].d) === sg || Math.abs(S.prof[k].d) < 1e-6);
  if (pick.length < 2) return [{ o: S.o, m: S.m }];
  const a = S.xz[pick[0]], b = S.xz[pick[pick.length - 1]];
  const m = v2.sub(b, a);
  if (v2.len(m) < 1e-6) return [{ o: S.o, m: S.m }];
  return [{ o: a, m }];
}

// 수막새: 처마 앞 기와 줄(u = 0.3 m 배수)에 원판
function buildMakse(buf, secs, C) {
  for (const sg of [-1, 1]) {
    // 처마선 꺾은선과 누적 길이
    const pts = secs.map((S) => {
      const k = sg > 0 ? 0 : S.prof.findIndex((q) => q.tag === 'makse' && q.d < 0);
      const q = S.prof[sg > 0 ? 1 : k];
      const xz = S.xz ? S.xz[sg > 0 ? 1 : k] : v2.madd(S.o, S.m, q.d);
      return { xz, y: q.y, S };
    });
    let u = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = v2.dist(a.xz, b.xz);
      if (L < 1e-6) continue;
      const dir = v2.norm(v2.sub(b.xz, a.xz));
      // 바깥 법선: 진행 방향의 왼쪽(+d) 이 sg=+1 쪽
      const nl = v2.left(dir);
      const no = [nl[0] * sg, 0, nl[1] * sg];
      const kStart = Math.ceil((u + 0.08) / 0.3), kEnd = Math.floor((u + L - 0.08) / 0.3);
      for (let k = kStart; k <= kEnd; k++) {
        const t = (k * 0.3 - u) / L;
        const xz = v2.madd(a.xz, dir, t * L);
        const y = lerp(a.y, b.y, t) - 0.065;
        disc(buf, [xz[0] + no[0] * 0.018, y, xz[1] + no[2] * 0.018], no, dir, 0.06, C.makse);
      }
      u += L;
    }
  }
}
function disc(buf, c, n, dir, r, col) {
  // 평평한 팔각 원판 (정면이 n)
  const a = [dir[0], 0, dir[1]];
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push([c[0] + a[0] * Math.cos(t) * r, c[1] + Math.sin(t) * r, c[2] + a[2] * Math.cos(t) * r]);
  }
  for (let i = 1; i < 7; i++) buf.tri(pts[0], pts[i], pts[i + 1], null, col, n);
}

// 바깥벽: 칸마다 하인방·회벽·중인방·살창·상인방
function buildWalls(B, o) {
  const { bPl, bWin, bWood, C } = B;
  const { stations, rows, wallMode, segOut, segs, ends, closed, F, Yc, others, W } = o;
  const yTopW = Yc - 0.3;
  const sill = F + 1.05, head = Math.min(yTopW - 0.36, F + 2.35);
  const t = 0.075;           // 벽 반두께
  const rc = 0.15;           // 기둥 반지름(벽이 파고드는 곳)
  // 다른 회랑이 벽 쪽에서 T 자로 붙는 곳은 벽을 뺌 (문 구실)
  const gaps = [];
  for (const oc of others) {
    const op = oc.path;
    for (const [p, q] of [[op[0], op[1]], [op[op.length - 1], op[op.length - 2]]]) {
      for (let i = 0; i < segs.length; i++) {
        const pr = segProj(p, segs[i].a, segs[i].b);
        if (pr.d > W / 2 + 0.3 || pr.t <= 0.001 || pr.t >= 0.999) continue;
        const bodySide = Math.sign(v2.dot(v2.sub(q, pr.q), segs[i].nl));
        gaps.push({ seg: i, s: pr.t * segs[i].len, hw: (oc.width || 4.5) / 2, side: bodySide });
      }
    }
  }
  const segOf = (p) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < segs.length; i++) { const pr = segProj(p, segs[i].a, segs[i].b); if (pr.d < bd) { bd = pr.d; best = i; } }
    return best;
  };
  const panel = (a, b, nrm) => {
    // a, b: 벽 중심선 두 점(기둥 중심) — 기둥 반지름만큼 줄여 그림
    const dir = v2.norm(v2.sub(b, a));
    const L = v2.dist(a, b);
    if (L < 0.5) return;
    const a2 = v2.madd(a, dir, rc), b2 = v2.madd(b, dir, -rc);
    const L2 = L - 2 * rc;
    const nn = [nrm[0], 0, nrm[1]];
    const P = (u, y, s) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * t); return [xz[0], y, xz[1]]; };
    const wall = (u0, u1, y0, y1) => {
      for (const s of [-1, 1]) bPl.quad(P(u0, y0, s), P(u1, y0, s), P(u1, y1, s), P(u0, y1, s), [0, 0, 1, 0, 1, 1, 0, 1], null, [nn[0] * s, 0, nn[2] * s]);
    };
    const woodBar = (u0, u1, y0, y1, th = t + 0.02) => {
      for (const s of [-1, 1]) {
        const Q = (u, y) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * th); return [xz[0], y, xz[1]]; };
        bWood.quad(Q(u0, y0), Q(u1, y0), Q(u1, y1), Q(u0, y1), null, C.timber, [nn[0] * s, 0, nn[2] * s]);
      }
      const Qt = (u, s) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * th); return [xz[0], y1, xz[1]]; };
      bWood.quad(Qt(u0, -1), Qt(u1, -1), Qt(u1, 1), Qt(u0, 1), null, C.timber, [0, 1, 0]);
      const Qb = (u, s) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * th); return [xz[0], y0, xz[1]]; };
      bWood.quad(Qb(u0, -1), Qb(u1, -1), Qb(u1, 1), Qb(u0, 1), null, C.hwangdan, [0, -1, 0]);
    };
    const hasWin = L2 > 1.6;
    // 하인방
    woodBar(-0.02, L2 + 0.02, F, F + 0.18);
    if (!hasWin) { wall(0, L2, F + 0.18, yTopW); return; }
    const ww = Math.min(L2 * 0.56, 2.1), u0 = (L2 - ww) / 2, u1 = u0 + ww;
    wall(0, L2, F + 0.18, sill);
    woodBar(-0.02, L2 + 0.02, sill, sill + 0.13);
    wall(0, u0, sill + 0.13, head);
    wall(u1, L2, sill + 0.13, head);
    woodBar(-0.02, L2 + 0.02, head, head + 0.12);
    wall(0, L2, head + 0.12, yTopW);
    // 문얼굴(창 옆 기둥)
    for (const uu of [u0, u1]) {
      for (const s of [-1, 1]) {
        const Q = (u, y) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * (t + 0.015)); return [xz[0], y, xz[1]]; };
        bWood.quad(Q(uu - 0.05, sill + 0.13), Q(uu + 0.05, sill + 0.13), Q(uu + 0.05, head), Q(uu - 0.05, head), null, C.timber, [nn[0] * s, 0, nn[2] * s]);
      }
    }
    // 창 안쪽 벽면(두께)
    for (const uu of [u0 + 0.05, u1 - 0.05]) {
      const Q = (s, y) => { const xz = v2.madd(v2.madd(a2, dir, uu), nrm, s * t); return [xz[0], y, xz[1]]; };
      bWood.quad(Q(-1, sill + 0.13), Q(1, sill + 0.13), Q(1, head), Q(-1, head), null, C.timberDark, [dir[0] * (uu < L2 / 2 ? 1 : -1), 0, dir[1] * (uu < L2 / 2 ? 1 : -1)]);
    }
    // 살창 (한 장, 양면 재질)
    const Wp = (u, y) => { const xz = v2.madd(a2, dir, u); return [xz[0], y, xz[1]]; };
    const nwin = Math.max(1, Math.round((ww - 0.1) / 0.95));
    bWin.quad(Wp(u0 + 0.05, sill + 0.13), Wp(u1 - 0.05, sill + 0.13), Wp(u1 - 0.05, head), Wp(u0 + 0.05, head), [0, 0, nwin, 0, nwin, 1, 0, 1], null, nn);
  };
  const rowD = (st, segIdx) => (wallMode === 'center' ? 0 : segOut[segIdx] * Math.abs(rows[0]));
  for (let j = 0; j < stations.length - 1 + (closed ? 1 : 0); j++) {
    const A = stations[j], Bs = stations[(j + 1) % stations.length];
    const mid = v2.mul(v2.add(A.p, Bs.p), 0.5);
    const si = segOf(mid);
    const d = rowD(A, si);
    const a = A.pos(d), b = Bs.pos(d);
    // T 자로 붙는 회랑 자리는 벽을 뺌
    const sA = segProj(A.p, segs[si].a, segs[si].b).t * segs[si].len, sB = segProj(Bs.p, segs[si].a, segs[si].b).t * segs[si].len;
    let skip = false;
    for (const g of gaps) {
      if (g.seg !== si) continue;
      if (wallMode === 'outer' && g.side !== Math.sign(d)) continue;
      if (wallMode === 'center') continue;
      if (Math.min(sA, sB) < g.s + g.hw && Math.max(sA, sB) > g.s - g.hw) skip = true;
    }
    if (skip) continue;
    const dir = v2.norm(v2.sub(b, a));
    const nrm = v2.left(dir);
    panel(a, b, nrm);
  }
  // 끝 칸 → 기단 끝까지 (문·T 끝): 창 없는 벽
  if (!closed) {
    for (const w of [0, 1]) {
      const e = ends[w];
      if (!(e.type === 'building' || e.type === 'tee')) continue;
      const st = w === 0 ? stations[0] : stations[stations.length - 1];
      const si = w === 0 ? 0 : segs.length - 1;
      const d = rowD(st, si);
      const a = st.pos(d);
      const endP = e.type === 'tee' ? e.trim : e.V;
      const b = v2.madd(endP, segs[si].nl, d);
      const dir = v2.norm(v2.sub(b, a));
      const L = v2.dist(a, b);
      if (L < 0.2) continue;
      const nrm = v2.left(dir);
      const a2 = v2.madd(a, dir, 0.15);
      const Q = (u, y, s) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * t); return [xz[0], y, xz[1]]; };
      for (const s of [-1, 1]) bPl.quad(Q(0, F + 0.18, s), Q(L - 0.15, F + 0.18, s), Q(L - 0.15, yTopW, s), Q(0, yTopW, s), null, null, [nrm[0] * s, 0, nrm[1] * s]);
      for (const s of [-1, 1]) {
        const Qw = (u, y) => { const xz = v2.madd(v2.madd(a2, dir, u), nrm, s * (t + 0.02)); return [xz[0], y, xz[1]]; };
        bWood.quad(Qw(-0.05, F), Qw(L - 0.15, F), Qw(L - 0.15, F + 0.18), Qw(-0.05, F + 0.18), null, C.timber, [nrm[0] * s, 0, nrm[1] * s]);
      }
    }
  }
}
