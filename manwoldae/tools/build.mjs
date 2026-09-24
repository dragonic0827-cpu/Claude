// 한 파일 배포본 만들기: `node tools/build.mjs`
//   dist/index.html    — CSS·JS 를 모두 품은 단일 HTML (three.js 만 CDN 에서 불러옴)
//   dist/artifact.html — 같은 내용에서 <html>/<head>/<body> 껍데기를 뺀 판 (claude.ai 아티팩트 게시용)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const result = await build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  target: 'es2022',
  external: ['three', 'three/addons/*'],
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<link[^>]+href="\.?\/?css\/([^"]+)"[^>]*>/g, (_, file) => {
  const css = fs.readFileSync(path.join(ROOT, 'css', file), 'utf8');
  return `<style>\n${css}\n</style>`;
});
const scriptTag = /<script type="module" src="\.?\/?src\/main\.js"><\/script>/;
if (!scriptTag.test(html)) throw new Error('index.html 에서 src/main.js 스크립트 태그를 찾지 못했습니다');
html = html.replace(scriptTag, () => `<script type="module">\n${js}\n</script>`);
fs.writeFileSync(path.join(DIST, 'index.html'), html);

// 아티팩트용: 문서 껍데기와 charset/viewport meta 제거 (게시할 때 다시 감싸짐)
const artifact = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body[^>]*>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
fs.writeFileSync(path.join(DIST, 'artifact.html'), artifact);

const kb = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0) + ' KB';
console.log(`dist/index.html ${kb('index.html')}, dist/artifact.html ${kb('artifact.html')}`);
