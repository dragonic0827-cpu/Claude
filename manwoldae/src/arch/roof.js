// 한국 전통 지붕 생성기 — 팔작(hip-gable) · 우진각(hip) · 사모(pyramid = 정방형 hip) · 맞배(gable)
//
// 지붕면은 처마 선(평면 직사각형, 반폭 a × 반깊이 b)에서 안쪽으로 들어간 거리 t 의 함수로 높이를 정합니다.
//   · profile 을 주면: 물매 기울기 s(t) 가 처마 끝 s0 → 주심(기둥선, t = tc) sc → 용마루 sT 로 선형 증가
//     (modelingGuide.roof.purlinRise: 아래 물매 0.50, 위 물매 0.72 — 가운데가 오목한 곡면), y(t) = ∫ s
//   · profile 이 없으면(예전 방식): y = H · (t / b)^p
// 여기에 한국 지붕의 곡선을 더합니다(eaveCurve).
//   · 앙곡(仰曲): 모서리 쪽 처마가 들림 — 처마를 따라 모서리에서 잰 거리 d 의 2차곡선
//   · 안허리: 평면에서 모서리 쪽 처마가 바깥으로 뻗음
// 두 곡선은 d 와 t 로만 계산하므로 추녀마루를 사이에 둔 두 면이 정확히 이어집니다.
//
// 팔작: 끝면(측면 지붕)은 t ≤ e 까지(추녀가 돌아 들어간 깊이), 그 위는 긴 면이 박공선 x = ±xVerge 까지 덮고,
// 합각벽은 박공에서 proj 만큼 들어간 x = ±xWall(중도리선)에 섭니다.
//
// 좌표: 지붕 중심이 원점, 처마 끝(모서리 제외) 기와 윗면이 y = 0, 정면은 +z.
import * as THREE from 'three';
import { GeoSink } from './building-geo.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class RoofShape {
  constructor(o) {
    let type = o.type || 'hip-gable';
    if (type === 'pyramid') type = 'hip';
    this.type = type;                      // 'hip-gable' | 'hip' | 'gable'
    this.a = o.halfWidth;                  // 처마 반폭 (x)
    this.b = o.halfDepth;                  // 처마 반깊이 (z)
    this.H = o.height;                     // 처마 끝 → 용마루 (기와 윗면)
    const { a, b } = this;
    if (o.profile) {
      this.tc = Math.min(o.profile.tc, b * 0.92);
      this.s0 = o.profile.s0 ?? 0.28;
      this.sc = o.profile.sc ?? 0.5;
      this.yc = (this.tc * (this.s0 + this.sc)) / 2;
      const L = b - this.tc;
      this.sT = L > 1e-6 ? (2 * (this.H - this.yc)) / L - this.sc : this.sc;
      this.p = null;
    } else {
      this.p = o.concavity ?? 1.22;        // 물매 오목함 (예전 방식)
    }
    this.lift = o.cornerLift ?? 0.085 * b;               // 앙곡: 모서리 들림 (m)
    this.flare = o.cornerFlare ?? 0.075 * b;             // 안허리: 모서리 뻗침 (m)
    this.sweep = Math.max(0.5, o.sweepLength ?? Math.min(a, b) * 0.9); // 처마를 따라 곡선이 미치는 길이
    this.liftDepth = Math.max(0.3, o.liftDepth ?? (this.p === null ? this.tc * 1.1 : b * 0.85)); // t 방향 감쇠
    if (type === 'gable') {
      this.e = 0; this.proj = 0; this.xVerge = a; this.xWall = a;
    } else if (type === 'hip') {
      this.e = Math.min(a, b); this.proj = 0; this.xVerge = this.xWall = a - this.e;
    } else {
      const e = o.hipDepth ?? Math.min(b * (o.gableInset ?? 0.6), a - 0.5);
      this.e = Math.min(Math.max(e, 0.2), b - 0.15, a - 0.1);
      this.xVerge = a - this.e;
      this.proj = Math.min(Math.max(0, o.gableProjection ?? 0.25), this.xVerge * 0.8);
      this.xWall = this.xVerge - this.proj;
    }
    this.pyramid = type === 'hip' && a - b < 1e-3;
    // 물매 길이 표 (기와 UV 의 v)
    const n = 64;
    this._sl = new Float64Array(n + 1);
    let py = 0;
    for (let k = 1; k <= n; k++) {
      const t = (b * k) / n, y = this.y(t);
      this._sl[k] = this._sl[k - 1] + Math.hypot(b / n, y - py);
      py = y;
    }
  }

  // 처마 끝에서 안쪽 t 까지의 높이 (곡선 제외)
  y(t) {
    const { b, H } = this;
    if (t <= 0) return 0;
    if (this.p !== null) return H * Math.pow(Math.min(1, t / b), this.p);
    const tc = this.tc;
    if (t <= tc) return this.s0 * t + ((this.sc - this.s0) * t * t) / (2 * tc);
    const u = Math.min(t, b) - tc, L = b - tc;
    return this.yc + this.sc * u + ((this.sT - this.sc) * u * u) / (2 * L);
  }

  f(u) { return this.y(u * this.b) / this.H; } // 예전 API

  slopeLen(t) {
    const n = this._sl.length - 1;
    const x = clamp01(t / this.b) * n, i = Math.min(n - 1, Math.floor(x));
    return this._sl[i] + (this._sl[i + 1] - this._sl[i]) * (x - i);
  }

  // 모서리 효과 가중치 (d: 모서리에서 처마를 따라 잰 거리, t: 처마에서 안쪽 거리)
  cornerWeight(d, t) {
    const wd = clamp01(1 - d / this.sweep);
    const wt = clamp01(1 - t / this.liftDepth);
    return wd * wd * wt * wt;
  }

  // 면 위의 점: face = 'long' (±z 면) | 'end' (±x 면). s = 처마 방향 좌표(m), t = 안쪽 거리(m)
  point(face, sx, sz, s, t, target = new THREE.Vector3()) {
    const { a, b } = this;
    let x, z, d;
    if (face === 'long') {
      x = s; z = sz * (b - t);
      d = this.type === 'gable' ? Infinity : a - Math.abs(s);
    } else {
      z = s; x = sx * (a - t);
      d = b - Math.abs(s);
    }
    const w = this.type === 'gable' ? 0 : this.cornerWeight(Math.max(0, d), Math.max(0, t));
    const y = this.y(t) + this.lift * w;
    const fl = this.flare * w * Math.SQRT1_2;
    const signX = face === 'long' ? Math.sign(s) || 1 : sx;
    const signZ = face === 'long' ? sz : Math.sign(s) || 1;
    return target.set(x + signX * fl, y, z + signZ * fl);
  }

  // 긴 면에서 t 줄의 처마 방향 반폭
  longHalfSpan(t) {
    const { a } = this;
    if (this.type === 'gable') return a;
    if (this.type === 'hip') return Math.max(0, a - t);
    return t <= this.e ? a - t : this.xVerge;
  }

  get ridgeHalf() { // 용마루 반길이
    if (this.type === 'gable') return this.a;
    if (this.type === 'hip') return Math.max(0, this.a - this.b);
    return this.xVerge;
  }

  get ridgeY() { return this.H; }

  // 평면 (x, z) 에서 기와 윗면 높이 (안허리 무시한 근사)
  heightAt(x, z) {
    const ax = Math.abs(x), az = Math.abs(z);
    const tL = this.b - az, tE = this.a - ax;
    if (this.type !== 'gable' && tE < tL && tE <= this.e) {
      const t = Math.max(0, tE);
      return this.y(t) + this.lift * this.cornerWeight(Math.max(0, this.b - az), t);
    }
    const t = Math.max(0, tL);
    if (this.type === 'gable') return this.y(t);
    return this.y(t) + this.lift * this.cornerWeight(Math.max(0, this.a - ax), t);
  }
}

// ─────────────────────────────── 지붕 조립 ───────────────────────────────

function sampleTs(shape, o) {
  const { b } = shape;
  const high = o.detail !== 'low';
  const set = [];
  const nv = high ? Math.min(24, Math.max(8, Math.round(b / (o.res?.dv ?? 0.6)))) : 3;
  for (let k = 0; k <= nv; k++) set.push((b * k) / nv);
  if (high) {
    const tc = shape.tc ?? b * 0.3;
    set.push(tc, tc * 0.5, tc * 0.25, tc * 0.75);
    if (o.eave && o.eave.double) { set.push(o.eave.tO - 0.04, o.eave.tO + 0.04); }
  }
  if (shape.type !== 'gable') set.push(shape.e);
  if (o.tMax != null) set.push(o.tMax);
  const tMax = o.tMax ?? b;
  const ts = set.filter((t) => t >= 0 && t <= tMax + 1e-9).sort((p, q) => p - q);
  const out = [];
  for (const t of ts) if (!out.length || t - out[out.length - 1] > 1e-3) out.push(t);
  return out;
}

// 처마 방향 분할: 모서리 쪽을 촘촘하게 (sin 배치)
function warp(i, n, curved) {
  const q = (2 * i) / n - 1;
  return curved ? Math.sin((q * Math.PI) / 2) : q;
}

/**
 * 지붕 전체를 GeoSink 에 그립니다 (sink 의 현재 변환 = 지붕 로컬 → 건물 로컬).
 * o = {
 *   detail, keys: { tile, under, trim, paint, plank, end, gilt },
 *   C: 색 { ridge, ridgeDark, white, eave, eaveLight, timber, timberDark, chimi },
 *   te: 처마 끝 두께(암막새), T(t): 기와 윗면→처마 밑(개판) 두께 함수,
 *   ridge: { h, w }, hip: { h, w }, chimi: 높이(0 = 없음), finialTop, finialCorners,
 *   gableWall: 합각벽(팔작), tMax: 여기까지만(하층 차양), eave: 서까래 설정(없으면 서까래 생략)
 * }
 * 반환: { ridgeTop } (지붕 로컬 y)
 */
export function buildRoof(shape, sink, o) {
  const K = { tile: 'tile', under: 'under', trim: 'trim', paint: 'painted', plank: 'plank', end: 'rafterEnd', gilt: 'gilt', ...(o.keys || {}) };
  const C = o.C;
  const high = o.detail !== 'low';
  const fine = high && o.detail !== 'medium';
  const { a, b } = shape;
  const T = o.T || (() => (o.te ?? 0.3));
  const te = o.te ?? 0.2;
  const ts = sampleTs(shape, o);
  const tMax = o.tMax ?? b;
  const hipType = shape.type !== 'gable';
  const lowerTs = hipType ? ts.filter((t) => t <= Math.min(shape.e, tMax) + 1e-9) : ts;
  const tileScale = 1.2;
  const P = V3();

  // 면 목록
  const faces = [];
  for (const sz of [1, -1]) faces.push({ kind: 'long', sx: 0, sz, out: [0, 0, sz] });
  if (hipType) for (const sx of [1, -1]) faces.push({ kind: 'end', sx, sz: 0, out: [sx, 0, 0] });
  const faceTs = (f) => (f.kind === 'long' ? ts : lowerTs);
  const faceHalf = (f, t) => (f.kind === 'long' ? shape.longHalfSpan(t) : Math.max(0, b - t));
  const nuFor = (f) => {
    const L = f.kind === 'long' ? a : b;
    return high ? Math.min(44, Math.max(8, Math.round((2 * L) / (o.res?.du ?? 1.0)))) : (f.kind === 'long' ? 6 : 4);
  };

  // ── 기와면 / 처마 밑면 ──
  for (const f of faces) {
    const rows = faceTs(f);
    if (rows.length < 2) continue;
    const nu = nuFor(f), nv = rows.length - 1;
    const curved = hipType;
    const at = (i, j, out, drop) => {
      const t = rows[j];
      const half = faceHalf(f, t);
      // 팔작 박공 위쪽은 곧게(곡선 없음) 나눔
      const s = half * warp(i, nu, curved && !(f.kind === 'long' && shape.type === 'hip-gable' && t > shape.e + 1e-6));
      shape.point(f.kind, f.sx, f.sz, s, t, out);
      if (drop) out.y -= T(t);
      return s;
    };
    sink.grid(K.tile, nu, nv, (i, j, out) => {
      const s = at(i, j, out, false);
      return [s / tileScale, shape.slopeLen(rows[j]) / tileScale];
    }, (n) => n.y > 0);
    // 처마 밑면은 줄 수를 줄임 (처마 끝·부연 경계·합각 줄은 유지)
    const keep = rows.map((t, j) => !high || j === 0 || j === nv || j % 2 === 0 || (o.eave && Math.abs(t - o.eave.tO) < 0.06) || Math.abs(t - shape.e) < 1e-6);
    const uRows = rows.filter((_, j) => keep[j]);
    sink.grid(K.under, nu, uRows.length - 1, (i, j, out) => {
      const t = uRows[j];
      const half = faceHalf(f, t);
      const s = half * warp(i, nu, curved && !(f.kind === 'long' && shape.type === 'hip-gable' && t > shape.e + 1e-6));
      shape.point(f.kind, f.sx, f.sz, s, t, out);
      out.y -= T(t);
      return [s / 2, t / 2];
    }, (n) => n.y < 0);
    // 처마 끝 두께면(암막새 줄)
    for (let i = 0; i < nu; i++) {
      const p0 = V3(), p1 = V3();
      at(i, 0, p0, false); at(i + 1, 0, p1, false);
      const d0 = T(0), d1 = T(0);
      sink.quad(K.trim, [p0.x, p0.y - d0, p0.z], [p1.x, p1.y - d1, p1.z], [p1.x, p1.y, p1.z], [p0.x, p0.y, p0.z], C.eave, undefined, f.out);
    }
  }

  // ── 팔작: 박공 끝면·박공널·합각 바닥·합각벽 ──
  if (shape.type === 'hip-gable' || shape.type === 'gable') {
    const xv = shape.xVerge;
    const vRows = shape.type === 'gable' ? ts : ts.filter((t) => t >= shape.e - 1e-9);
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        for (let j = 0; j < vRows.length - 1; j++) {
          const t0 = vRows[j], t1 = vRows[j + 1];
          const p0 = shape.point('long', 0, sz, sx * xv, t0, V3()), p1 = shape.point('long', 0, sz, sx * xv, t1, V3());
          sink.quad(K.trim, [p0.x, p0.y - T(t0), p0.z], [p1.x, p1.y - T(t1), p1.z], [p1.x, p1.y, p1.z], [p0.x, p0.y, p0.z], C.ridgeDark, undefined, [sx, 0, 0]);
        }
      }
      // 박공널: 앞 처마(또는 합각 아래) → 용마루 → 뒤
      const bb = o.barge;
      if (bb) {
        const path = [];
        // 팔작은 합각 아래 끝보다 조금 위에서 시작 (추녀마루 밑으로 삐져나오지 않게)
        const t0 = shape.type === 'gable' ? 0 : shape.e + Math.min(0.35, (b - shape.e) * 0.15);
        const up = [t0, ...vRows.filter((t) => t > t0 + 1e-3)];
        for (let j = 0; j < up.length; j++) path.push(shape.point('long', 0, 1, sx * (xv - bb.t / 2 - 0.01), up[j], V3()).setY(shape.y(up[j]) - T(up[j]) + 0.02));
        for (let j = up.length - 2; j >= 0; j--) path.push(shape.point('long', 0, -1, sx * (xv - bb.t / 2 - 0.01), up[j], V3()).setY(shape.y(up[j]) - T(up[j]) + 0.02));
        // 곡선 보정: point() 의 y 는 앙곡 포함 → 박공선은 모서리에서 멀어 무시
        const prof = [[-bb.t / 2, -bb.h], [bb.t / 2, -bb.h], [bb.t / 2, 0], [-bb.t / 2, 0], [-bb.t / 2, -bb.h]];
        sink.sweep(K.paint, path, prof, [C.white, C.timber, C.timber, C.timber], { capStart: true, capEnd: true, col: C.timber });
      }
    }
  }
  if (shape.type === 'hip-gable' && tMax >= b - 1e-6) {
    const { xVerge: xv, xWall: xw, e } = shape;
    const zH = b - e, ye = shape.y(e);
    for (const sx of [1, -1]) {
      // 합각 바닥 (박공 밑, 끝면 윗선 ~ 합각벽)
      if (xv - xw > 0.02) {
        const x0 = sx * xw, x1 = sx * xv, y = ye - 0.015;
        sink.quad(K.tile, [x0, y, zH], [x1, y, zH], [x1, y, -zH], [x0, y, -zH], null, [0, 0, 1, 0, 1, 2 * zH / tileScale, 0, 2 * zH / tileScale], [0, 1, 0]);
      }
      if (o.gableWall) {
        const X = sx * (xw + 0.005);
        const yBot = ye - 0.12;
        const rows = ts.filter((t) => t >= e - 1e-9);
        // 합각벽 윗선: 긴 면 밑면
        const edge = [];
        for (const sz of [-1, 1]) {
          const list = sz < 0 ? rows : rows.slice().reverse();
          for (const t of list) {
            if (sz > 0 && t === b && edge.length) continue;
            const p = shape.point('long', 0, sz, sx * xw, t, V3());
            edge.push([p.z, p.y - T(t) - 0.01]);
          }
        }
        edge.sort((p, q) => p[0] - q[0]);
        for (let k = 0; k < edge.length - 1; k++) {
          const [z0, y0] = edge[k], [z1, y1] = edge[k + 1];
          if (z1 - z0 < 1e-4 || Math.min(y0, y1) < yBot + 0.01) continue;
          sink.quad(K.plank, [X, yBot, z0], [X, yBot, z1], [X, y1, z1], [X, y0, z0], null, [z0 / 2, 0, z1 / 2, 0, z1 / 2, y1 / 2, z0 / 2, y0 / 2], [sx, 0, 0]);
        }
        const topAt = (z) => {
          for (let k = 0; k < edge.length - 1; k++) {
            if (z >= edge[k][0] && z <= edge[k + 1][0]) {
              const u = (z - edge[k][0]) / Math.max(1e-6, edge[k + 1][0] - edge[k][0]);
              return edge[k][1] + (edge[k + 1][1] - edge[k][1]) * u;
            }
          }
          return yBot;
        };
        // 머름(아래 띠) + 백분 선 — 지붕 밑면 아래에 들어오는 구간만
        const bandH = Math.min(0.32, (topAt(0) - yBot) * 0.2);
        let zB = zH;
        while (zB > 0.1 && topAt(zB) < yBot + bandH + 0.08) zB -= 0.05;
        sink.box(K.paint, X + sx * 0.03, yBot + bandH / 2, 0, 0.06, bandH, 2 * zB, { col: C.timber, skip: '-y' });
        sink.box(K.paint, X + sx * 0.035, yBot + bandH + 0.02, 0, 0.05, 0.04, 2 * zB, { col: C.white, skip: '-y' });
        if (fine) {
          // 널판 띠살(세로 쫄대)
          const step = 0.42;
          const n = Math.floor((2 * zH) / step);
          for (let k = 1; k < n; k++) {
            const z = -zH + (k * 2 * zH) / n;
            const top = topAt(z) - 0.02, bot = yBot + bandH + 0.04;
            if (top - bot < 0.1) continue;
            sink.box(K.paint, X + sx * 0.025, (top + bot) / 2, z, 0.05, top - bot, 0.07, { col: C.timberDark, skip: '-y+y' });
          }
          // 가운데 금동 장식(지네철 대신 원형 꽃장식)
          if (o.gableOrnament) {
            const yc = yBot + bandH + (topAt(0) - yBot - bandH) * 0.45;
            sink.disc(K.gilt, V3(X + sx * 0.06, yc, 0), V3(sx, 0, 0), Math.min(0.35, zH * 0.12), 12, null);
          }
        }
      }
    }
  }

  // ── 마루 ──
  const R = o.ridge, Hh = o.hip || { h: R.h * 0.6, w: R.w * 0.8 };
  const ridgeProfile = (w, h, bury, full) => {
    const v1 = h * 0.18, v2 = h * 0.3, v3 = h * 0.82;
    const pts = full
      ? [[-w / 2, -bury], [-w / 2, v1], [-w / 2, v2], [-w * 0.45, v2], [-w * 0.45, v3], [-w * 0.5, v3], [-w * 0.48, h * 0.93], [-w * 0.3, h], [w * 0.3, h], [w * 0.48, h * 0.93], [w * 0.5, v3], [w * 0.45, v3], [w * 0.45, v2], [w / 2, v2], [w / 2, v1], [w / 2, -bury]]
      : [[-w / 2, -bury], [-w / 2, v1], [-w / 2, v2], [-w * 0.42, h], [w * 0.42, h], [w / 2, v2], [w / 2, v1], [w / 2, -bury]];
    const cols = full
      ? [C.ridgeDark, C.white, C.white, C.ridge, C.ridge, C.ridge, C.ridge, C.ridge, C.ridge, C.ridge, C.ridge, C.ridge, C.white, C.white, C.ridgeDark]
      : [C.ridgeDark, C.white, C.ridge, C.ridge, C.ridge, C.white, C.ridgeDark];
    return [pts, cols];
  };
  const slopeTop = Math.max(0.3, shape.sT ?? 0.8);
  let ridgeTop = shape.H;
  const rh = shape.ridgeHalf;
  if (!shape.pyramid && tMax >= b - 1e-6 && rh > 0.05) {
    const [prof, cols] = ridgeProfile(R.w, R.h, (R.w / 2) * slopeTop + 0.08, o.ridgeFull ?? fine);
    const ext = shape.type === 'gable' ? 0.05 : 0.1;
    const x1 = rh + ext;
    const path = [V3(-x1, shape.H, 0), V3(0, shape.H, 0), V3(x1, shape.H, 0)];
    sink.sweep(K.trim, path, prof, cols, { capStart: true, capEnd: true, capCol: C.ridgeDark, col: C.ridge });
    ridgeTop = shape.H + R.h;
    // 치미 또는 망와
    for (const sx of [1, -1]) {
      if (o.chimi > 0) chimi(sink, K.trim, sx * (x1 - o.chimi * 0.05), shape.H - 0.08, 0, sx, o.chimi, R.w, C, fine);
      else if (fine) sink.disc(K.trim, V3(sx * (x1 + 0.012), shape.H + R.h * 0.5, 0), V3(sx, 0.1, 0), R.h * 0.4, 10, C.ridge);
    }
  }
  // 추녀마루
  if (hipType) {
    // 묻히는 깊이는 처마 끝 두께 이내로 (모서리 끝에서 아래로 삐져나오지 않게)
    const [prof, cols] = ridgeProfile(Hh.w, Hh.h, Math.min(Hh.w * 0.55 + 0.05, te * 0.85), false);
    const tTop = Math.min(shape.e, tMax);
    const hts = lowerTs.filter((t) => t <= tTop + 1e-9);
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const pts = [];
        // 모서리 밖으로 조금 내민 시작점
        const c0 = shape.point('long', 0, sz, sx * a, 0, V3());
        const c1 = shape.point('long', 0, sz, sx * (a - 0.3), 0.3, V3());
        const dir = V3().subVectors(c0, c1).normalize();
        pts.push(c0.clone().addScaledVector(dir, 0.04));
        for (const t of hts) if (t > 0.05) pts.push(shape.point('long', 0, sz, sx * (a - t), t, V3()));
        if (shape.pyramid && tMax >= b - 1e-6) pts[pts.length - 1].set(0, shape.H, 0);
        // 모서리 끝으로 갈수록 가늘게
        const scale = pts.map((p) => 0.62 + 0.38 * Math.min(1, p.distanceTo(c0) / 1.6));
        sink.sweep(K.trim, pts, prof, cols, { capStart: true, capEnd: tMax < b - 1e-6, capCol: C.ridgeDark, col: C.ridge, scale });
        // 망와 (추녀마루 끝 막음)
        const tip = pts[0];
        if (fine) sink.disc(K.trim, V3(tip.x, tip.y + Hh.h * 0.3, tip.z).addScaledVector(dir, 0.012), V3(dir.x, 0.25, dir.z).normalize(), Hh.h * 0.3, 8, C.ridge);
        if (o.finialCorners > 0) finial(sink, K.gilt, V3(tip.x, tip.y + Hh.h * 0.75, tip.z), o.finialCorners, high);
      }
    }
  }
  // 내림마루: 팔작은 박공선을 따라 합각 아래까지, 맞배는 처마까지
  if ((shape.type === 'hip-gable' || shape.type === 'gable') && tMax >= b - 1e-6) {
    const [prof, cols] = ridgeProfile(Hh.w, Hh.h * 1.1, Hh.w * 0.6 + 0.05, false);
    const xk = shape.xVerge - Hh.w * 0.5 - 0.02;
    const vRows = shape.type === 'gable' ? ts : ts.filter((t) => t >= shape.e - 1e-9);
    for (const sx of [1, -1]) {
      const pts = [];
      // 팔작: 내림마루 아래 끝이 추녀마루 위 끝을 덮도록 추녀선을 따라 조금 더 내려감
      const te2 = Math.max(0, shape.e - Math.min(0.45, shape.e * 0.2));
      const hipPt = (sz) => shape.point('long', 0, sz, sx * (a - te2), te2, V3());
      if (shape.type === 'hip-gable') pts.push(hipPt(1));
      for (const t of vRows) pts.push(shape.point('long', 0, 1, sx * xk, t, V3()));
      for (let j = vRows.length - 2; j >= 0; j--) pts.push(shape.point('long', 0, -1, sx * xk, vRows[j], V3()));
      if (shape.type === 'hip-gable') pts.push(hipPt(-1));
      let scale;
      if (shape.type === 'gable') {
        // 처마 끝에서 조금 내밈, 끝으로 갈수록 가늘게
        pts[0].z += 0.06; pts[pts.length - 1].z -= 0.06;
        scale = pts.map((p) => 0.65 + 0.35 * Math.min(1, (b - Math.abs(p.z)) / 1.4));
      }
      sink.sweep(K.trim, pts, prof, cols, { capStart: true, capEnd: true, capCol: C.ridgeDark, col: C.ridge, scale });
      if (fine && shape.type === 'gable') {
        for (const p of [pts[0], pts[pts.length - 1]]) {
          const dz = Math.sign(p.z);
          sink.disc(K.trim, V3(p.x, p.y + Hh.h * 0.45, p.z + dz * 0.02), V3(0, 0.3, dz).normalize(), Hh.h * 0.5, 8, C.eaveLight);
        }
      }
    }
  }
  // 하층 차양: 윗단 가장자리 마감 마루
  if (tMax < b - 1e-6) {
    const [prof, cols] = ridgeProfile(Hh.w * 0.9, Hh.h * 0.8, Hh.w * 0.5, false);
    const ax = a - tMax, bz = b - tMax;
    const yT = shape.y(tMax);
    const segs = [[V3(-ax - 0.1, yT, bz), V3(ax + 0.1, yT, bz)], [V3(-ax - 0.1, yT, -bz), V3(ax + 0.1, yT, -bz)],
      [V3(ax, yT, -bz - 0.1), V3(ax, yT, bz + 0.1)], [V3(-ax, yT, -bz - 0.1), V3(-ax, yT, bz + 0.1)]];
    for (const [p, q] of segs) sink.sweep(K.trim, [p, q], prof, cols, { capStart: true, capEnd: true, col: C.ridge });
  }
  // 사모지붕 꼭대기 화주
  if (shape.pyramid && tMax >= b - 1e-6) {
    ridgeTop = shape.H + Hh.h;
    if (o.finialTop > 0) finial(sink, K.gilt, V3(0, shape.H + Hh.h * 0.5, 0), o.finialTop, high, true);
  }

  // ── 막새(수막새 줄) ──
  if (fine && o.makse !== false) {
    const seg = o.makseSegs ?? 8;
    const rM = o.makseR ?? 0.085;
    for (const f of faces) {
      const half = faceHalf(f, 0);
      const n = Math.floor(half / 0.3);
      for (let k = -n; k <= n; k++) {
        const s = k * 0.3;
        if (hipType && Math.abs(s) > half - 0.2) continue;
        shape.point(f.kind, f.sx, f.sz, s, 0, P);
        const out = V3(f.out[0], -0.12, f.out[2]).normalize();
        sink.disc(K.trim, V3(P.x + f.out[0] * 0.025, P.y - rM * 0.55, P.z + f.out[2] * 0.025), out, rM, seg, C.eaveLight, { phase: Math.PI / seg });
      }
    }
  }

  // ── 서까래·부연·추녀·사래 ──
  if (fine && o.eave) eaveTimbers(shape, sink, o, K, C, T, faces, faceHalf);

  return { ridgeTop };
}

// 서까래(원형, 끝 단청) · 부연(각형) · 선자연(모서리 부채꼴) · 추녀 · 사래
function eaveTimbers(shape, sink, o, K, C, T, faces, faceHalf) {
  const E = o.eave;
  const { a } = shape;
  const hipType = shape.type !== 'gable';
  const segs = E.segs ?? 8;
  const tIn = E.tIn;
  const tO = E.double ? E.tO : E.tB0;
  const Tin = (t) => T(Math.max(t, E.double ? E.tO + 0.05 : t));
  const O = V3(), I = V3(), P0 = V3(), P1 = V3(), dir = V3(), side = V3(), upv = V3();
  const rsv = hipType ? Math.max(0.3, E.cw * 1.1) : 0.12;
  for (const f of faces) {
    const isLong = f.kind === 'long';
    const halfO = faceHalf(f, tO);
    const hAlong = isLong ? E.hx : E.hz;
    const hIn = isLong ? E.hz : E.hx;
    const n = Math.floor(halfO / E.sp);
    for (let k = -n; k <= n; k++) {
      const s = k * E.sp;
      if (Math.abs(s) > halfO - rsv) continue;
      const fan = hipType && Math.abs(s) > hAlong + 1e-3;
      shape.point(f.kind, f.sx, f.sz, s, tO, O);
      O.y -= Tin(tO) + E.rR;
      if (fan) {
        const sg = Math.sign(s);
        if (isLong) I.set(sg * hAlong, 0, f.sz * hIn); else I.set(f.sx * hIn, 0, sg * hAlong);
        I.y = shape.heightAt(I.x, I.z) - Tin(E.tIn) - E.rR;
        I.lerp(O, 0.12);
      } else {
        // 추녀선을 넘지 않게 (넘으면 끝면 지붕 위로 뚫고 나옴)
        const tI = hipType ? Math.max(tO + 0.3, Math.min(tIn, (isLong ? a : shape.b) - Math.abs(s) - 0.08)) : tIn;
        shape.point(f.kind, f.sx, f.sz, s, tI, I);
        I.y -= Tin(tI) + E.rR;
      }
      sink.cyl(K.paint, O, I, E.rR, E.rR, segs, C.timber);
      dir.subVectors(O, I).normalize();
      sink.disc(K.end, V3().copy(O).addScaledVector(dir, 0.004), dir, E.rR * 0.98, segs, null);
      if (E.double) {
        // 부연: 서까래 연장선을 따라 처마 끝까지
        const dh = V3(dir.x, 0, dir.z).normalize();
        const cosA = Math.max(0.3, Math.abs(dh.x * f.out[0] + dh.z * f.out[2]));
        const along = isLong ? dh.x : dh.z;
        const Lout = (E.tO - E.tB0) / cosA, Lin = 0.45 / cosA;
        shape.point(f.kind, f.sx, f.sz, s + along * Lout, E.tB0, P1);
        shape.point(f.kind, f.sx, f.sz, s - along * Lin, E.tO + 0.45, P0);
        P1.y -= o.te + E.bS / 2; P0.y -= o.te + E.bS / 2;
        sink.beam(K.paint, P0, P1, E.bS, E.bS, C.timber, { open: true });
        const bd = V3().subVectors(P1, P0).normalize();
        side.crossVectors(bd, V3(0, 1, 0)).normalize();
        upv.crossVectors(side, bd).normalize();
        const hs = E.bS / 2 * 0.97, c = V3().copy(P1).addScaledVector(bd, 0.004);
        const pt = (u, v) => [c.x + side.x * u + upv.x * v, c.y + side.y * u + upv.y * v, c.z + side.z * u + upv.z * v];
        sink.quad(K.end, pt(-hs, -hs), pt(hs, -hs), pt(hs, hs), pt(-hs, hs), null, undefined, [bd.x, bd.y, bd.z]);
      }
    }
  }
  // 추녀 · 사래
  if (!hipType) return;
  const tStart = Math.min(E.tIn, shape.e);
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const tEnd = E.double ? E.tO : E.tB0;
      const pts = [];
      const nS = 6;
      for (let k = 0; k <= nS; k++) {
        const t = tStart + ((tEnd - tStart) * k) / nS;
        const p = shape.point('long', 0, sz, sx * (a - t), t, V3());
        p.y -= Tin(t) + E.ch / 2;
        pts.push(p);
      }
      const prof = [[-E.cw / 2, -E.ch / 2], [E.cw / 2, -E.ch / 2], [E.cw / 2, E.ch / 2], [-E.cw / 2, E.ch / 2], [-E.cw / 2, -E.ch / 2]];
      sink.sweep(K.paint, pts, prof, [C.hwangdan, C.timber, C.timber, C.timber], { col: C.timber });
      endCap(sink, K.end, pts[pts.length - 2], pts[pts.length - 1], E.cw, E.ch);
      if (E.double) {
        const sp = [];
        for (let k = 0; k <= 4; k++) {
          const t = E.tO + 0.5 + ((E.tB0 - E.tO - 0.5) * k) / 4;
          const p = shape.point('long', 0, sz, sx * (a - t), t, V3());
          p.y -= o.te + E.bS * 0.6;
          sp.push(p);
        }
        const w2 = E.cw * 0.8, h2 = E.bS * 1.2;
        const prof2 = [[-w2 / 2, -h2 / 2], [w2 / 2, -h2 / 2], [w2 / 2, h2 / 2], [-w2 / 2, h2 / 2], [-w2 / 2, -h2 / 2]];
        sink.sweep(K.paint, sp, prof2, [C.hwangdan, C.timber, C.timber, C.timber], { col: C.timber });
        endCap(sink, K.end, sp[sp.length - 2], sp[sp.length - 1], w2, h2);
        if (E.gilt) {
          const q = sp[sp.length - 1], d = V3().subVectors(q, sp[sp.length - 2]).normalize();
          sink.cyl(K.gilt, V3().copy(q).addScaledVector(d, -0.12), V3().copy(q).addScaledVector(d, 0.02), w2 * 0.62, w2 * 0.62, 6, null);
          // 풍경(바람 방울)
          const bell = V3().copy(q).addScaledVector(d, -0.22);
          const yb = bell.y - h2 * 0.5;
          sink.cyl(K.gilt, V3(bell.x, yb, bell.z), V3(bell.x, yb - 0.3, bell.z), 0.008, 0.008, 3, null);
          latheAt(sink, K.gilt, V3(bell.x, yb - 0.46, bell.z), 1, [[0, 0], [0.085, 0], [0.075, 0.04], [0.045, 0.14], [0, 0.17]], 6, null);
        }
      }
    }
  }
}

// 부재 끝 마구리(단청) — A→B 방향 끝의 w × h 사각
function endCap(sink, key, A, B, w, h) {
  const d = V3().subVectors(B, A).normalize();
  const side = V3().crossVectors(d, V3(0, 1, 0)).normalize();
  const up = V3(0, 1, 0);
  const c = V3().copy(B).addScaledVector(d, 0.004);
  const pt = (u, v) => [c.x + side.x * u + up.x * v, c.y + side.y * u + up.y * v, c.z + side.z * u + up.z * v];
  sink.quad(key, pt(-w / 2 * 0.95, -h / 2 * 0.95), pt(w / 2 * 0.95, -h / 2 * 0.95), pt(w / 2 * 0.95, h / 2 * 0.95), pt(-w / 2 * 0.95, h / 2 * 0.95), null, undefined, [d.x, d.y, d.z]);
}

// ── 치미(鴟吻): 올빼미 꼬리 윤곽. 바깥(용마루 끝 쪽)이 +X, 꼭대기가 안쪽으로 휨 ──
const CHIMI_OUTLINE = [
  [-0.3, 0], [0.26, 0], [0.33, 0.1], [0.36, 0.25], [0.35, 0.4], [0.31, 0.55], [0.24, 0.69], [0.14, 0.81], [0.03, 0.9], [-0.08, 0.96], [-0.17, 0.99], [-0.24, 0.98],
  [-0.25, 0.93], [-0.2, 0.89], [-0.13, 0.86], [-0.1, 0.8], [-0.12, 0.72], [-0.17, 0.66], [-0.13, 0.6], [-0.17, 0.52], [-0.24, 0.42], [-0.28, 0.28], [-0.3, 0.12],
];
const chimiCache = new Map();
function chimiGeometry(high) {
  const key = high ? 'h' : 'l';
  if (chimiCache.has(key)) return chimiCache.get(key);
  const shp = new THREE.Shape();
  // 바깥 윤곽(2..10)에 깃털 톱니
  const pts = [];
  CHIMI_OUTLINE.forEach((p, i) => {
    pts.push(p);
    if (high && i >= 2 && i < 10) {
      const [x0, y0] = p, [x1, y1] = CHIMI_OUTLINE[i + 1];
      const nx = y1 - y0, ny = -(x1 - x0), L = Math.hypot(nx, ny) || 1;
      pts.push([x0 + (x1 - x0) * 0.62 + (nx / L) * 0.028, y0 + (y1 - y0) * 0.62 + (ny / L) * 0.028]);
      pts.push([x0 + (x1 - x0) * 0.66 - (nx / L) * 0.012, y0 + (y1 - y0) * 0.66 - (ny / L) * 0.012]);
    }
  });
  pts.forEach(([x, y], i) => (i ? shp.lineTo(x, y) : shp.moveTo(x, y)));
  shp.closePath();
  const depth = 0.26;
  const geo = new THREE.ExtrudeGeometry(shp, high
    ? { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 }
    : { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  // 깃 무늬: 바깥 윤곽을 따라 안쪽으로 띠 3줄 (조금 도드라짐)
  const ribs = [];
  if (high) {
    for (const k of [0.13, 0.26, 0.39]) {
      const pts = [];
      for (let i = 2; i <= 10; i++) {
        const [x, y] = CHIMI_OUTLINE[i];
        const cx = -0.02, cy = 0.42;
        pts.push([x + (cx - x) * k, y + (cy - y) * k]);
      }
      ribs.push(pts);
    }
  }
  const r = { geo, ribs, depth };
  chimiCache.set(key, r);
  return r;
}

function chimi(sink, key, x, y, z, sx, h, ridgeW, C, high) {
  const { geo, ribs, depth } = chimiGeometry(high);
  const thick = Math.max(ridgeW * 1.08, h * 0.28);
  const zs = thick / (depth + (high ? 0.08 : 0));
  const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(sx * h, h, zs));
  const save = sink.M.clone(), saveId = sink.ident;
  sink.setMatrix(saveId ? m : save.clone().multiply(m));
  addGeometry(sink, key, geo, C.chimi || C.ridge, sx < 0);
  // 깃 띠
  if (high) {
    for (const rib of ribs) {
      for (const zz of [depth / 2 + 0.04, -depth / 2 - 0.04]) {
        for (let i = 0; i < rib.length - 1; i++) {
          const [x0, y0] = rib[i], [x1, y1] = rib[i + 1];
          const nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny) || 1;
          const w = 0.02;
          const ox = (nx / L) * w, oy = (ny / L) * w;
          const zs = zz + Math.sign(zz) * 0.012;
          sink.quad(key, [x0 - ox, y0 - oy, zs], [x1 - ox, y1 - oy, zs], [x1 + ox, y1 + oy, zs], [x0 + ox, y0 + oy, zs], C.ridgeDark, undefined, [0, 0, Math.sign(zz)]);
        }
      }
    }
  }
  if (saveId) sink.setMatrix(null); else sink.setMatrix(save);
}

// BufferGeometry 를 sink 에 추가 (현재 변환 적용). mirror 면 감김을 뒤집음
export function addGeometry(sink, key, geo, col, mirror = false) {
  const bk = sink.get(key);
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  const p = V3(), n = V3();
  const base = bk.nv;
  for (let i = 0; i < pos.count; i++) {
    sink.tp(pos.getX(i), pos.getY(i), pos.getZ(i), p);
    sink.tn(nrm.getX(i), nrm.getY(i), nrm.getZ(i), n);
    sink.pushV(bk, p, n, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, col);
  }
  const idx = geo.index;
  const cnt = idx ? idx.count : pos.count;
  for (let i = 0; i < cnt; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    if (mirror) bk.idx.push(base + a, base + c, base + b); else bk.idx.push(base + a, base + b, base + c);
  }
}

// ── 화주(火珠): 연꽃 받침 + 구슬 + 불꽃 (금동) ──
const FINIAL_PROFILE = [
  [0.0, 0], [0.3, 0], [0.34, 0.04], [0.28, 0.1], [0.14, 0.14], [0.1, 0.2], [0.1, 0.24], [0.2, 0.3], [0.24, 0.4], [0.2, 0.5], [0.1, 0.56], [0.08, 0.6], [0.11, 0.64], [0.07, 0.76], [0.03, 0.9], [0, 1],
];
export function finial(sink, key, pos, h, high, withLotus = false) {
  const prof = withLotus ? [[0, -0.1], [0.42, -0.1], [0.46, -0.04], ...FINIAL_PROFILE.slice(1)] : FINIAL_PROFILE;
  latheAt(sink, key, pos, h, prof, high ? 10 : 6, null);
}

// 원점 기준 회전체를 pos 로 옮겨(배율 k) 그림
export function latheAt(sink, key, pos, k, prof, segs, col) {
  const save = sink.M.clone(), saveId = sink.ident;
  const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z).multiply(new THREE.Matrix4().makeScale(k, k, k));
  sink.setMatrix(saveId ? m : save.clone().multiply(m));
  sink.lathe(key, prof, segs, col);
  if (saveId) sink.setMatrix(null); else sink.setMatrix(save);
}

// ─────────────────────────── 예전 API (호환) ───────────────────────────

// 지붕 기와면(윗면) + 처마 밑면 + 처마 두께면 + 합각/박공 — BufferGeometry 배열로 돌려줌
export function buildRoofSurfaces(shape, { thickness = 0.45, segU = 28, segV = 14 } = {}) {
  const sink = new GeoSink(['trim', 'painted']);
  const white = new THREE.Color(1, 1, 1);
  buildRoof(shape, sink, {
    detail: segU >= 12 ? 'high' : 'low', T: () => thickness, te: thickness,
    keys: { tile: 'top', under: 'under', trim: 'edge', plank: 'gable', paint: 'edge', gilt: 'edge', end: 'edge' },
    C: { ridge: white, ridgeDark: white, white, eave: white, eaveLight: white, timber: white, timberDark: white },
    ridge: { h: 0.001, w: 0.001 }, hip: { h: 0.001, w: 0.001 }, makse: false, gableWall: true,
  });
  const out = { top: [], under: [], edge: [], gable: [] };
  for (const k of Object.keys(out)) {
    const b = sink.buckets.get(k);
    if (!b || !b.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx);
    out[k].push(g);
  }
  return out;
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
  return new THREE.ExtrudeGeometry(shape, { steps: Math.max(4, points.length * 3), bevelEnabled: false, extrudePath: curve });
}

// 추녀마루/내림마루가 따라갈 선들 (지붕면 위 점열)
export function ridgeLines(shape) {
  const lines = [];
  const { a, b, H } = shape;
  const rh = shape.ridgeHalf;
  if (rh > 0) lines.push({ kind: 'main', pts: [V3(-rh, H, 0), V3(0, H, 0), V3(rh, H, 0)] });
  if (shape.type === 'gable') return lines;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const pts = [];
      const n = 10;
      for (let k = 0; k <= n; k++) {
        const t = (shape.e * k) / n;
        pts.push(shape.point('long', 0, sz, sx * (a - t), t));
      }
      lines.push({ kind: 'hip', pts: pts.reverse() });
      if (shape.type === 'hip-gable') {
        const q = [];
        for (let k = 0; k <= 8; k++) {
          const t = shape.e + ((b - shape.e) * (8 - k)) / 8;
          q.push(V3(sx * shape.xVerge, shape.y(t), sz * (b - t)));
        }
        lines.push({ kind: 'rake', pts: q });
      }
    }
  }
  return lines;
}
