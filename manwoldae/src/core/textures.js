// 절차적(procedural) 캔버스 텍스처 — 외부 이미지 없이 석재·기와·단청·창호·지면 무늬를 그립니다.
import * as THREE from 'three';

// 결정적 난수 (같은 시드 → 같은 무늬)
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

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

function speckle(ctx, w, h, rand, n, alpha, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand() * alpha})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function toTexture(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// 다듬은 장대석 쌓기 (축대·기단) — 1 텍스처 반복 = 가로 4 m × 세로 2 m 를 가정
export function ashlarTexture(base = '#a8a296', seed = 7) {
  const [c, ctx] = canvas(512, 256);
  const rand = rng(seed);
  ctx.fillStyle = shade(base, -0.35);
  ctx.fillRect(0, 0, 512, 256);
  const rows = 5;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * 80;
    while (x < 512) {
      const w = 70 + rand() * 90;
      const k = (rand() - 0.5) * 0.22;
      ctx.fillStyle = shade(base, k);
      ctx.fillRect(x + 2, r * rh + 2, w - 3, rh - 3);
      // 윗면 하이라이트 / 아랫면 그림자
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 2, r * rh + 2, w - 3, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x + 2, r * rh + rh - 5, w - 3, 3);
      x += w;
    }
  }
  speckle(ctx, 512, 256, rand, 5000, 0.12, true);
  speckle(ctx, 512, 256, rand, 5000, 0.14, false);
  return toTexture(c);
}

// 거친 자연석(궁성 담장·축대 하부)
export function rubbleTexture(base = '#8f8a7f', seed = 11) {
  const [c, ctx] = canvas(512, 512);
  const rand = rng(seed);
  ctx.fillStyle = shade(base, -0.45);
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const x = rand() * 512, y = rand() * 512;
    const rx = 18 + rand() * 30, ry = 12 + rand() * 20;
    ctx.fillStyle = shade(base, (rand() - 0.5) * 0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, 512, 512, rand, 8000, 0.12, false);
  return toTexture(c);
}

// 기와 지붕: 암키와 골 + 수키와 등 (세로 방향이 물매 방향). 반복 1 = 폭 약 1.2 m (수키와 4줄)
export function roofTileTexture(base = '#5a5f63', seed = 3) {
  const [c, ctx] = canvas(256, 256);
  const rand = rng(seed);
  const lanes = 4;
  const lw = 256 / lanes;
  for (let i = 0; i < lanes; i++) {
    const x0 = i * lw;
    // 암키와 골 (어두움)
    const g = ctx.createLinearGradient(x0, 0, x0 + lw, 0);
    g.addColorStop(0, shade(base, -0.45));
    g.addColorStop(0.18, shade(base, -0.15));
    g.addColorStop(0.5, shade(base, -0.05));
    g.addColorStop(0.82, shade(base, -0.15));
    g.addColorStop(1, shade(base, -0.45));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, lw, 256);
  }
  for (let i = 0; i < lanes; i++) {
    // 수키와 등 (밝은 원통)
    const cx = i * lw;
    const g = ctx.createLinearGradient(cx - lw * 0.22, 0, cx + lw * 0.22, 0);
    g.addColorStop(0, shade(base, -0.55));
    g.addColorStop(0.3, shade(base, 0.05));
    g.addColorStop(0.5, shade(base, 0.22));
    g.addColorStop(0.75, shade(base, -0.05));
    g.addColorStop(1, shade(base, -0.6));
    ctx.fillStyle = g;
    ctx.fillRect(cx - lw * 0.22, 0, lw * 0.44, 256);
    if (i === 0) ctx.fillRect(256 - lw * 0.22, 0, lw * 0.44, 256);
  }
  // 기와 한 장 단위의 이음매
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, y, 256, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, y + 2, 256, 2);
  }
  speckle(ctx, 256, 256, rand, 1500, 0.10, true);
  speckle(ctx, 256, 256, rand, 1500, 0.15, false);
  return toTexture(c);
}

// 모로단청 띠 (창방·평방·도리): 가운데 뇌록 바탕, 양 끝 머리초(적·청·황·백 띠)
// u: 부재 길이 방향 0..1, v: 부재 둘레/높이
export function dancheongBeamTexture(pal = {}, seed = 5) {
  const P = {
    green: '#3f7d62', red: '#9b2d20', blue: '#2f5d8c', yellow: '#d9a83a', white: '#ece6d6', black: '#1f1f1f', ...pal,
  };
  const [c, ctx] = canvas(1024, 64);
  ctx.fillStyle = P.green;
  ctx.fillRect(0, 0, 1024, 64);
  // 가칠 무늬 결
  const rand = rng(seed);
  speckle(ctx, 1024, 64, rand, 900, 0.07, false);
  const head = (x0, dir) => {
    const bands = [
      [P.red, 26], [P.white, 5], [P.blue, 20], [P.white, 4], [P.yellow, 16], [P.white, 4], [P.red, 14], [P.black, 3], [P.white, 3],
    ];
    let x = x0;
    for (const [col, w] of bands) {
      ctx.fillStyle = col;
      if (dir > 0) ctx.fillRect(x, 0, w, 64); else ctx.fillRect(x - w, 0, w, 64);
      x += dir * w;
    }
    // 머리초 꽃(연화) 문양
    const cx = x0 + dir * 44;
    for (const [r, col] of [[26, P.white], [21, P.red], [15, P.yellow], [8, P.blue]]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, 32, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.fillStyle = P.white;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * 18, 32 + Math.sin(a) * 18, 7, 3.5, a, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  head(0, 1);
  head(1024, -1);
  // 윗선·아랫선 (긋기)
  ctx.fillStyle = P.white; ctx.fillRect(0, 0, 1024, 3); ctx.fillRect(0, 61, 1024, 3);
  ctx.fillStyle = P.black; ctx.fillRect(0, 3, 1024, 2); ctx.fillRect(0, 59, 1024, 2);
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

// 12세기 고려 단청: 석간주(토주) 바탕 + 부재 아래 모서리 백분 선 + (rank 1–2) 가운데 연화·보상화 문양
// u: 부재 길이 방향 0..1, v: 부재 높이(아래 0 → 위 1)
export function dancheong12Texture(pal = {}, { rich = true, seed = 6 } = {}) {
  const P = {
    base: '#8C3A2B', white: '#EFE8D8', blue: '#2C4A8A', green: '#3F8F55', yellow: '#D8A840', ink: '#1F1B18', ...pal,
  };
  const [c, ctx] = canvas(1024, 64);
  ctx.fillStyle = P.base;
  ctx.fillRect(0, 0, 1024, 64);
  const rand = rng(seed);
  speckle(ctx, 1024, 64, rand, 1200, 0.06, false);
  speckle(ctx, 1024, 64, rand, 600, 0.04, true);
  // 백분 선: 아래 모서리 굵게, 위 모서리 가늘게 (먹선으로 테두리)
  ctx.fillStyle = P.ink; ctx.fillRect(0, 55, 1024, 2);
  ctx.fillStyle = P.white; ctx.fillRect(0, 57, 1024, 7);
  ctx.fillStyle = P.white; ctx.fillRect(0, 0, 1024, 3);
  ctx.fillStyle = P.ink; ctx.fillRect(0, 3, 1024, 1);
  // 양 끝 짧은 띠(부재 이음 표시)
  for (const x of [0, 1024 - 10]) {
    ctx.fillStyle = P.white; ctx.fillRect(x, 0, 10, 64);
    ctx.fillStyle = P.ink; ctx.fillRect(x === 0 ? 10 : x - 2, 0, 2, 64);
  }
  if (rich) {
    // 가운데 보상화(연화) 원문 + 좌우 넝쿨
    const cx = 512;
    ctx.strokeStyle = P.green; ctx.lineWidth = 4;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * 30, 30);
      for (let k = 1; k <= 6; k++) ctx.quadraticCurveTo(cx + dir * (30 + k * 26 - 13), k % 2 ? 12 : 48, cx + dir * (30 + k * 26), 30);
      ctx.stroke();
      for (let k = 1; k <= 6; k++) {
        ctx.fillStyle = k % 2 ? P.blue : P.yellow;
        ctx.beginPath(); ctx.arc(cx + dir * (30 + k * 26), 30, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const [r, col] of [[27, P.white], [24, P.blue], [18, P.white], [15, P.green], [9, P.yellow], [4, P.base]]) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx, 30, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      ctx.fillStyle = P.white;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 21, 30 + Math.sin(a) * 21, 6, 3, a, 0, Math.PI * 2); ctx.fill();
    }
  }
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

// 서까래 마구리/부연 끝 단청용 작은 원형 문양
export function rafterEndTexture(pal = {}) {
  const P = { green: '#3f7d62', red: '#9b2d20', blue: '#2f5d8c', yellow: '#d9a83a', white: '#ece6d6', ...pal };
  const [c, ctx] = canvas(64, 64);
  for (const [r, col] of [[32, P.blue], [24, P.white], [18, P.green], [10, P.yellow], [5, P.red]]) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(32, 32, r, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(c, { aniso: 1 });
}

// 창호 (띠살문 / 빗살) + 문얼굴
export function lattice(pal = {}, kind = 'ttisal') {
  const P = { frame: '#6b2a1f', paper: '#efe7d2', ...pal };
  const [c, ctx] = canvas(256, 512);
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = P.frame;
  const bar = 7;
  if (kind === 'ttisal') {
    for (let x = 20; x < 256; x += 22) ctx.fillRect(x, 0, bar - 2, 512);
    for (const y of [60, 90, 120, 240, 270, 390, 420, 450]) ctx.fillRect(0, y, 256, bar - 2);
  } else {
    ctx.lineWidth = 5;
    ctx.strokeStyle = P.frame;
    for (let d = -512; d < 512; d += 30) {
      ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + 512, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d + 512, 0); ctx.lineTo(d, 512); ctx.stroke();
    }
  }
  // 문틀
  ctx.fillRect(0, 0, 256, 14); ctx.fillRect(0, 498, 256, 14);
  ctx.fillRect(0, 0, 14, 512); ctx.fillRect(242, 0, 14, 512);
  ctx.fillRect(122, 0, 12, 512);
  return toTexture(c, { aniso: 4 });
}

// 회벽 (흰 벽면 + 가장자리 붉은 선)
export function plasterTexture(pal = {}, seed = 9) {
  const P = { plaster: '#e9e3d3', line: '#9b2d20', ...pal };
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = P.plaster;
  ctx.fillRect(0, 0, 256, 256);
  const rand = rng(seed);
  speckle(ctx, 256, 256, rand, 2500, 0.06, false);
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 240, 240);
  const t = toTexture(c, { aniso: 4 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// 지면(흙·잔디) — 넓은 면적에 반복
export function groundTexture(base = '#7a7a4a', seed = 13, { grass = true } = {}) {
  const [c, ctx] = canvas(512, 512);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 400; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const x = rand() * 512, y = rand() * 512, r = 10 + rand() * 50;
    ctx.save();
    ctx.translate(x, y); ctx.scale(r, r);
    g.addColorStop(0, shade(base, (rand() - 0.5) * 0.35));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (grass) {
    for (let i = 0; i < 9000; i++) {
      ctx.strokeStyle = shade(base, (rand() - 0.3) * 0.5);
      ctx.globalAlpha = 0.5;
      const x = rand() * 512, y = rand() * 512;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  speckle(ctx, 512, 512, rand, 6000, 0.08, false);
  return toTexture(c);
}

// 마당(다진 흙·전돌) — 궁궐 마당
export function courtyardTexture(base = '#b9a98a', seed = 17) {
  const [c, ctx] = canvas(512, 512);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  // 박석(넓은 판석) 느낌의 불규칙 판
  for (let y = 0; y < 512; y += 64) {
    let x = -rand() * 60;
    while (x < 512) {
      const w = 60 + rand() * 70;
      ctx.fillStyle = shade(base, (rand() - 0.5) * 0.16);
      ctx.fillRect(x + 2, y + 2, w - 4, 60);
      x += w;
    }
  }
  speckle(ctx, 512, 512, rand, 7000, 0.10, false);
  speckle(ctx, 512, 512, rand, 3000, 0.08, true);
  return toTexture(c);
}
