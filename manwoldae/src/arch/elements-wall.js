// 성벽·담장 — 궁성(판축 토성 + 1 m 석축, 비탈진 면), 궁장(화강암 아랫단 + 회벽 + 기와 지붕 덮개),
// 황성·나성(토석 혼축, 흙길 윗면). 문(gate/gatehouse) 기단에서 끊고, 물길(waterGates)에는 석축 수구를 둡니다.
import * as THREE from 'three';
import { Sink, box, worldUV, elementMats, clamp, lerp, v2, miterVec, segProj, orientedRect, clipSegRect, sweep, capSection } from './elements-geo.js';
import SPEC from '../data/spec.js';   // ctx.buildings 가 없을 때 기본값

export function createWall(def, mats, heightAt, ctx = {}) {
  const E = elementMats(mats);
  const C = E.C;
  const group = new THREE.Group();
  group.name = def.id || 'wall';
  const kind = def.kind === 'palace' || def.kind === 'city' ? def.kind : 'enclosure';
  const T = def.thickness > 0 ? def.thickness : 1;
  const h = def.height > 0 ? def.height : 3;
  const follow = !!def.followTerrain || !Number.isFinite(def.groundY);
  const H = typeof heightAt === 'function' ? heightAt : () => (Number.isFinite(def.groundY) ? def.groundY : 0);
  const step = kind === 'city' ? 5 : kind === 'palace' ? 4 : 3;

  let path = [];
  for (const p of def.path || []) if (!path.length || v2.dist(p, path[path.length - 1]) > 0.05) path.push([p[0], p[1]]);
  if (path.length < 2) return group;
  let closed = !!def.closed && path.length > 2;
  if (closed && v2.dist(path[0], path[path.length - 1]) > 0.05) path.push(path[0].slice());

  // 끊는 곳: 문 기단 + 수구
  const cut = (P) => {
    const cum = [0];
    for (let i = 0; i < P.length - 1; i++) cum.push(cum[i] + v2.dist(P[i], P[i + 1]));
    const ex = [];
    for (const b of ctx.buildings || SPEC.buildings || []) {
      if (!(b.kind === 'gate' || b.kind === 'gatehouse') || !(b.platformW > 0)) continue;
      const R = orientedRect(b.cx, b.cz, b.platformW / 2, b.platformD / 2, b.rotationDeg);
      for (let i = 0; i < P.length - 1; i++) {
        const c = clipSegRect(R, P[i], P[i + 1]);
        if (!c) continue;
        const L = cum[i + 1] - cum[i];
        ex.push([cum[i] + c[0] * L, cum[i] + c[1] * L, 'gate']);
      }
    }
    const wgs = [];
    for (const wg of def.waterGates || []) {
      let best = null;
      for (let i = 0; i < P.length - 1; i++) {
        const pr = segProj([wg.x, wg.z], P[i], P[i + 1]);
        if (!best || pr.d < best.d) best = { ...pr, i };
      }
      if (!best || best.d > 30) continue;
      const s = cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]);
      const w = wg.width > 0 ? wg.width : 6;
      ex.push([s - w / 2, s + w / 2, 'water']);
      wgs.push({ s, w, wg });
    }
    ex.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const e of ex) {
      const last = merged[merged.length - 1];
      if (last && e[0] <= last[1] + 0.05) last[1] = Math.max(last[1], e[1]);
      else merged.push([e[0], e[1]]);
    }
    return { cum, merged, wgs };
  };

  let info = cut(path);
  if (closed && info.merged.length) {
    // 닫힌 성벽은 첫 틈 가운데에서 풀어 열린 경로로 (틈이 양 끝으로 나뉨)
    const L = info.cum[info.cum.length - 1];
    const [g0, g1] = info.merged[0];
    const s0 = (g0 + g1) / 2, half = (g1 - g0) / 2;
    const at = (s) => pointAt(path, info.cum, ((s % L) + L) % L).p;
    const np = [at(s0)];
    info.cum.forEach((c, i) => { if (c > s0 + 1e-6 && c < L - 1e-6) np.push(path[i]); });
    np.push(path[0]);
    info.cum.forEach((c, i) => { if (c > 1e-6 && c < s0 - 1e-6) np.push(path[i]); });
    np.push(at(s0));
    path = np.filter((p, i) => i === 0 || v2.dist(p, np[i - 1]) > 0.02);
    closed = false;
    const cum2 = [0];
    for (let i = 0; i < path.length - 1; i++) cum2.push(cum2[i] + v2.dist(path[i], path[i + 1]));
    const L2 = cum2[cum2.length - 1];
    const sh = (s) => ((((s - s0) % L) + L) % L) * (L2 / L);
    const merged2 = [[0, half], ...info.merged.slice(1).map(([a, b]) => [sh(a), sh(b)]), [L2 - half, L2]];
    info = { cum: cum2, merged: merged2, wgs: info.wgs.map((w) => ({ ...w, s: Math.abs(w.s - s0) < 1e-6 ? 0 : sh(w.s) })) };
  }
  const { cum, merged, wgs } = info;
  const Ltot = cum[cum.length - 1];

  // 남는 구간
  const spans = [];
  if (closed) spans.push([0, Ltot]);
  else {
    let s = 0;
    for (const [a, b] of merged) {
      if (a > s + 0.3) spans.push([s, Math.min(a, Ltot)]);
      s = Math.max(s, b);
    }
    if (Ltot > s + 0.3) spans.push([s, Ltot]);
  }

  const sink = new Sink();
  const bStone = sink.get(kind === 'palace' ? mats.stoneRubble : mats.stone);
  const bEarth = kind === 'palace' ? sink.get(E.earth) : kind === 'city' ? sink.get(E.earthStone) : null;
  const bTop = kind !== 'enclosure' ? sink.get(mats.packedEarth) : null;
  const bPl = kind === 'enclosure' ? sink.get(mats.plasterPlain) : null;
  const bTile = kind === 'enclosure' ? sink.get(mats.tileGray) : null;
  const bTrim = kind === 'enclosure' ? sink.get(E.trim) : null;

  // 단면
  const bat = kind === 'palace' ? 0.2 : 0.225;   // 한쪽 기울기(윗폭 = T·(1 − 2·bat))
  const hw = (z) => T / 2 - bat * T * (z / h);
  const profile = (y0, yb) => {
    if (kind === 'palace') {
      const P = [
        { d: hw(yb - y0) + 0.08, y: yb, tag: 'stone' },
        { d: hw(1) + 0.08, y: y0 + 1, tag: 'stoneTop' },
        { d: hw(1), y: y0 + 1, tag: 'earth' },
        { d: hw(h), y: y0 + h, tag: 'top' },
        { d: 0, y: y0 + h + 0.12, tag: 'top' },
        { d: -hw(h), y: y0 + h, tag: 'earth' },
        { d: -hw(1), y: y0 + 1, tag: 'stoneTop' },
        { d: -hw(1) - 0.08, y: y0 + 1, tag: 'stone' },
        { d: -hw(yb - y0) - 0.08, y: yb, tag: null },
      ];
      return { P, caps: [{ idx: [0, 1, 2, 6, 7, 8], buf: bStone }, { idx: [2, 3, 4, 5, 6], buf: bEarth }] };
    }
    if (kind === 'city') {
      const P = [
        { d: hw(yb - y0), y: yb, tag: 'earth' },
        { d: hw(h), y: y0 + h, tag: 'top' },
        { d: 0, y: y0 + h + 0.15, tag: 'top' },
        { d: -hw(h), y: y0 + h, tag: 'earth' },
        { d: -hw(yb - y0), y: yb, tag: null },
      ];
      return { P, caps: [{ idx: [0, 1, 2, 3, 4], buf: bEarth }] };
    }
    // 궁장: 화강암 아랫단 0.6 m + 회벽 + 기와 덮개
    const ov = 0.36, de = T / 2 + ov;
    const yrb = y0 + h - 0.26, yc = yrb + 0.05;
    const yAt = (d) => yc - 0.55 * d + 0.14 * (d * d) / de;
    const yte = yAt(de), under = yte - 0.14;
    const P = [
      { d: T / 2 + 0.06, y: yb, tag: 'stone' },
      { d: T / 2 + 0.06, y: y0 + 0.6, tag: 'stoneTop' },
      { d: T / 2, y: y0 + 0.6, tag: 'plaster' },
      { d: T / 2, y: under + 0.02, tag: 'under' },
      { d: de, y: under, tag: 'eave' },
    ];
    const ks = [1, 0.75, 0.5, 0.25];
    for (const k of ks) P.push({ d: de * k, y: yAt(de * k), tag: 'tile' });
    P.push({ d: 0, y: yc, tag: 'tile' });
    for (const k of ks.slice().reverse()) P.push({ d: -de * k, y: yAt(de * k), tag: k === 1 ? 'eave' : 'tile' });
    P.push({ d: -de, y: under, tag: 'under' });
    P.push({ d: -T / 2, y: under + 0.02, tag: 'plaster' });
    P.push({ d: -T / 2, y: y0 + 0.6, tag: 'stoneTop' });
    P.push({ d: -T / 2 - 0.06, y: y0 + 0.6, tag: 'stone' });
    P.push({ d: -T / 2 - 0.06, y: yb, tag: null });
    const n = P.length;
    const iTile0 = 4, iTileEnd = n - 5; // (de,under) … (−de,under)
    const coping = [];
    for (let k = 3; k <= n - 4; k++) coping.push(k);
    return {
      P, yrb,
      caps: [
        { idx: [0, 1, 2, n - 3, n - 2, n - 1], buf: bStone },
        { idx: [2, 3, n - 4, n - 3], buf: bPl },
        { idx: coping, buf: bTrim, col: C.ridgeDark },
      ],
      iTile0, iTileEnd,
    };
  };

  const tags = {
    stone: { buf: bStone, uv: (p, u, v, q) => [u / (kind === 'palace' ? 3 : 4), q.y / (kind === 'palace' ? 3 : 2)] },
    stoneTop: { buf: bStone, uv: (p, u, v, q) => [u / 3, q.d / 3] },
    earth: bEarth ? { buf: bEarth, uv: (p, u, v, q) => [u / 4, q.y / 2] } : null,
    top: bTop ? { buf: bTop, uv: (p, u, v, q) => [u / 7, q.d / 7], smooth: true, smoothCos: 0.9 } : null,
    plaster: bPl ? { buf: bPl, uv: (p, u, v, q) => [u / 2, q.y / 2] } : null,
    under: bTrim ? { buf: bTrim, col: C.eaveDark, uv: () => [0, 0] } : null,
    eave: bTrim ? { buf: bTrim, col: C.makse, uv: () => [0, 0] } : null,
    tile: bTile ? { buf: bTile, uv: (p, u, v) => [u / 1.2, v / 1.2], smooth: true, smoothCos: 0.8 } : null,
  };
  const ridgeTags = bTrim ? { ridge: { buf: bTrim, col: C.ridge }, cap: { buf: bTrim, col: C.ridgeDark, smooth: true, smoothCos: 0.4 } } : null;

  // 구간마다 단면 만들기
  for (const [sa, sb] of spans) {
    const secs = [];
    const stops = [sa];
    for (let i = 1; i < cum.length - 1; i++) if (cum[i] > sa + 0.05 && cum[i] < sb - 0.05) stops.push(cum[i]);
    stops.push(sb);
    const stations = [];
    for (let k = 0; k < stops.length - 1; k++) {
      const a = stops[k], b = stops[k + 1];
      const n = follow ? Math.max(1, Math.ceil((b - a) / step)) : 1;
      for (let j = k === 0 ? 0 : 1; j <= n; j++) stations.push(a + ((b - a) * j) / n);
    }
    if (closed) stations[stations.length - 1] = Ltot;
    for (let k = 0; k < stations.length; k++) {
      const s = stations[k];
      const pa = pointAt(path, cum, s);
      // 꼭짓점이면 마이터
      let m = v2.left(pa.t);
      const vi = cum.findIndex((c) => Math.abs(c - s) < 1e-6);
      const isEnd = !closed && (k === 0 || k === stations.length - 1);
      if (vi > 0 && vi < cum.length - 1 && !isEnd) m = miterVec(segDir(path, vi - 1), segDir(path, vi), 1.8);
      else if (closed && (vi === 0 || vi === cum.length - 1)) m = miterVec(segDir(path, path.length - 2), segDir(path, 0), 1.8);
      const mn = v2.norm(m);
      let y0, yb;
      if (follow) {
        const yc = H(pa.p[0], pa.p[1]);
        const foot = T / 2 + 0.4;
        const yo = H(pa.p[0] + mn[0] * foot, pa.p[1] + mn[1] * foot);
        const yi = H(pa.p[0] - mn[0] * foot, pa.p[1] - mn[1] * foot);
        y0 = yc;
        yb = Math.min(yc, yo, yi) - 0.7;
      } else {
        y0 = def.groundY;
        yb = y0 - 0.35;
      }
      const pr = profile(y0, yb);
      secs.push({ o: pa.p, m, prof: pr.P, caps: pr.caps, yrb: pr.yrb, y0, t: pa.t });
    }
    sweep(secs, tags, { closed: true });
    if (ridgeTags) {
      const rsecs = secs.map((S) => ({ o: S.o, m: S.m, prof: ridgeProf(S.yrb) }));
      sweep(rsecs, ridgeTags, { closed: true });
      if (!closed) for (const [S, dir] of [[rsecs[0], v2.mul(secs[0].t, -1)], [rsecs[rsecs.length - 1], secs[secs.length - 1].t]]) {
        capSection(bTrim, S, S.prof.map((q, i) => i), dir, null, C.ridgeDark);
      }
    }
    // 끝 막음
    if (!closed) {
      for (const [S, dir] of [[secs[0], v2.mul(secs[0].t, -1)], [secs[secs.length - 1], secs[secs.length - 1].t]]) {
        for (const cp of S.caps) {
          if (!cp.buf) continue;
          capSection(cp.buf, S, cp.idx, dir, (p) => worldUV(p, [dir[0], 0, dir[1]], [3, 2]), cp.col || null);
        }
      }
    }
  }

  // ── 수구(水口): 물길 위 화강암 홍예 수문 ──
  for (const { s, w } of wgs) {
    const pa = pointAt(path, cum, s);
    const t = pa.t;
    const samples = [];
    for (let k = -4; k <= 4; k++) {
      const q = v2.madd(pa.p, t, (k / 4) * (w / 2 + 1));
      samples.push(H(q[0], q[1]));
    }
    const yBed = Math.min(...samples);
    const yBank = Math.max(samples[0], samples[samples.length - 1]);
    const Lg = w + 0.7, Dg = T + 0.5;
    const yB = yBed - 0.8, yT = Math.max(yBank + 0.62 * h, yBed + 2.6);
    const N = Math.max(1, Math.round((w - 2) / 2.9));
    const pier = 0.8;
    const span = Math.min(2.6, (w - 1.6 - (N - 1) * pier) / N);
    const ra = span / 2;
    const yS = yBed + 0.35;
    const shape = new THREE.Shape();
    shape.moveTo(-Lg / 2, yB); shape.lineTo(Lg / 2, yB); shape.lineTo(Lg / 2, yT); shape.lineTo(-Lg / 2, yT); shape.lineTo(-Lg / 2, yB);
    const centers = [];
    for (let k = 0; k < N; k++) centers.push((k - (N - 1) / 2) * (span + pier));
    for (const c of centers) {
      const hp = new THREE.Path();
      hp.moveTo(c - ra, yB + 0.1); hp.lineTo(c - ra, yS); hp.absarc(c, yS, ra, Math.PI, 0, true); hp.lineTo(c + ra, yB + 0.1); hp.lineTo(c - ra, yB + 0.1);
      shape.holes.push(hp);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: Dg, bevelEnabled: false, curveSegments: 12 });
    const X = new THREE.Vector3(t[0], 0, t[1]), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3().crossVectors(X, Y);
    const M = new THREE.Matrix4().makeBasis(X, Y, Z);
    M.setPosition(pa.p[0] - Z.x * Dg / 2, 0, pa.p[1] - Z.z * Dg / 2);
    const bS = sink.get(mats.stone);
    bS.addGeometry(g, M, { uvFn: (p, n) => worldUV(p, n, [4, 2]) });
    g.dispose();
    // 윗돌(갑석) 띠
    box(bS, [pa.p[0], yT + 0.12, pa.p[1]], [t[0], 0, t[1]], [0, 1, 0], [Z.x, 0, Z.z], Lg / 2 + 0.1, 0.12, Dg / 2 + 0.1, { uv: 'world', scale: [4, 2], skip: ['-y'] });
    // 홍예석 띠 (양면)
    const bG = sink.get(E.granite);
    for (const c of centers) {
      const ring = new THREE.Shape();
      const ro = ra + 0.38;
      ring.moveTo(c + ro, yS); ring.absarc(c, yS, ro, 0, Math.PI, false); ring.lineTo(c - ra, yS); ring.absarc(c, yS, ra, Math.PI, 0, true); ring.lineTo(c + ro, yS);
      const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.05, bevelEnabled: false, curveSegments: 12 });
      for (const sd of [-1, 1]) {
        const off = sd > 0 ? Dg / 2 : -Dg / 2 - 0.05;
        const Mr = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(pa.p[0] + Z.x * off, 0, pa.p[1] + Z.z * off);
        bG.addGeometry(rg, Mr, {
          uvFn: (p) => {
            const lx = (p[0] - pa.p[0]) * t[0] + (p[2] - pa.p[1]) * t[1];
            return [Math.atan2(p[1] - yS, lx - c) * (ra + 0.2) * 2.4 / 4, 0.3];
          },
          colFn: () => C.ao(0.95),
        });
      }
      rg.dispose();
    }
  }

  sink.build(group, def.id, 'wall');
  group.userData = { id: def.id, nameKo: def.nameKo, kind: 'wall', pickId: def.id, tris: sink.tris, spans: spans.length };
  return group;

  // 기와 덮개의 용마루 (작은 적새 + 둥근 등)
  function ridgeProf(yrb) {
    const w = 0.15, r = 0.11, yc = yrb + 0.16;
    const P = [{ d: w, y: yrb - 0.05, tag: 'ridge' }, { d: w, y: yc, tag: 'cap' }];
    for (let k = 1; k < 5; k++) { const a = (k / 5) * Math.PI; P.push({ d: Math.cos(a) * r * 1.3, y: yc + Math.sin(a) * r, tag: 'cap' }); }
    P.push({ d: -w, y: yc, tag: 'ridge' }, { d: -w, y: yrb - 0.05, tag: null });
    return P;
  }
}

function segDir(path, i) { return v2.norm(v2.sub(path[i + 1], path[i])); }
function pointAt(path, cum, s) {
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const L = cum[i + 1] - cum[i] || 1;
  const t = clamp((s - cum[i]) / L, 0, 1);
  const dir = segDir(path, i);
  return { p: [lerp(path[i][0], path[i + 1][0], t), lerp(path[i][1], path[i + 1][1], t)], t: dir, i };
}
