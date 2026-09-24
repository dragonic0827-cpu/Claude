// tools/spec/spec.json → src/data/spec.js (머리 주석 4줄 유지). 숫자 표기를 Node 의 JSON.stringify 에 맞춥니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(ROOT, 'src/data/spec.js');
const hdr = fs.readFileSync(out, 'utf8').split('\n').slice(0, 4);
if (!hdr[3].startsWith('// 생성기')) throw new Error('spec.js 머리 주석이 예상과 다릅니다');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/spec/spec.json'), 'utf8'));
fs.writeFileSync(out, `${hdr.join('\n')}\nexport default ${JSON.stringify(data)};\n`);
console.log(`src/data/spec.js ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
