// 헤드리스 Chromium 스크린샷/오류 검사 도구
//
//   node tools/shoot.mjs <page> [options]
//
//   <page>             index.html, dev/building.html 등 (프로젝트 루트 기준)
//   --out <dir>        스크린샷 저장 폴더 (기본: shots)
//   --size 1280x720    뷰포트 크기
//   --shot <name.png>  준비 완료 후 한 장 촬영
//   --steps <json>     [{ "eval": "JS 식", "wait": ms, "shot": "a.png" }, ...] 순서대로 실행
//   --timeout <ms>     window.__ready 대기 시간 (기본 120000)
//   --mobile           휴대폰 흉내 (터치·coarse 포인터·모바일 UA → 앱의 휴대폰 경로)
//
// 페이지는 준비가 끝나면 window.__ready = true 를 설정해야 합니다.
// 콘솔 error / pageerror / 요청 실패가 있으면 출력하고 종료 코드 1 을 반환합니다.
// three.js CDN(jsdelivr) 요청은 로컬 node_modules/three 로 대체해 오프라인에서도 동작합니다.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  throw new Error('playwright 를 찾을 수 없습니다 (npm i -g playwright)');
}

const argv = process.argv.slice(2);
const page = argv[0] || 'index.html';
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const outDir = path.resolve(ROOT, opt('out', 'shots'));
const [vw, vh] = opt('size', '1280x720').split('x').map(Number);
const timeout = Number(opt('timeout', 120000));
let steps = [];
if (opt('steps')) steps = JSON.parse(opt('steps'));
if (opt('shot')) steps.push({ shot: opt('shot') });
fs.mkdirSync(outDir, { recursive: true });

const { chromium } = loadPlaywright();
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const mobile = argv.includes('--mobile');
const ctx = await browser.newContext({
  viewport: { width: vw, height: vh }, deviceScaleFactor: 1,
  ...(mobile ? {
    isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  } : {}),
});
const p = await ctx.newPage();
const threeDir = path.join(ROOT, 'node_modules', 'three');
if (fs.existsSync(threeDir)) {
  await p.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
    const rel = route.request().url().replace(/^.*?three@[^/]+\//, '').split('?')[0];
    const file = path.join(threeDir, rel);
    if (fs.existsSync(file)) route.fulfill({ path: file, contentType: 'text/javascript' });
    else route.fulfill({ status: 404, body: 'missing ' + rel });
  });
}
const problems = [];
p.on('console', (m) => {
  const t = m.type();
  if (t === 'error') problems.push(`console.error: ${m.text()}`);
  if (t === 'warning' || t === 'log' || t === 'info') console.log(`[${t}] ${m.text()}`);
});
p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}\n${e.stack || ''}`));
p.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const t0 = Date.now();
await p.goto(base + page);
try {
  await p.waitForFunction(() => window.__ready === true, null, { timeout, polling: 250 });
  console.log(`ready in ${Date.now() - t0} ms`);
} catch {
  problems.push(`timeout: window.__ready not set within ${timeout} ms`);
}
for (const s of steps) {
  if (s.eval) {
    try {
      const r = await p.evaluate(s.eval);
      if (r !== undefined) console.log(`eval(${s.eval}) =>`, typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) { problems.push(`eval failed (${s.eval}): ${e.message}`); }
  }
  if (s.wait) await p.waitForTimeout(s.wait);
  if (s.shot) {
    const file = path.join(outDir, s.shot);
    await p.screenshot({ path: file, timeout: 180000 }); // SwiftShader 는 한 프레임에 수십 초 걸리기도 함
    console.log(`shot: ${path.relative(ROOT, file)}`);
  }
}
await browser.close();
server.close();
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('OK (no console errors)');
