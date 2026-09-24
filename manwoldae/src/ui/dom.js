// 작은 DOM 도우미와 아이콘(인라인 SVG, 20×20, 1.5 px 선)

const SVG_NS = 'http://www.w3.org/2000/svg';

// h('button', { class: 'x', onclick }, '글', child) — 속성 이름이 on 으로 시작하면 이벤트
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// 아이콘 경로 (viewBox 0 0 20 20, stroke 방식)
const PATHS = {
  sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4"/>',
  sunrise: '<path d="M3 14.5h14M5.5 14.5a4.5 4.5 0 0 1 9 0"/><path d="M10 4v3M4.3 8.3l1.6 1.2M15.7 8.3l-1.6 1.2"/><path d="M6 17.5h8"/>',
  noon: '<circle cx="10" cy="8.5" r="3.6"/><path d="M10 1.8v1.6M3.6 8.5H2M18 8.5h-1.6M5.1 3.6l1.1 1.1M14.9 3.6l-1.1 1.1"/><path d="M4 16.5h12"/>',
  sunset: '<path d="M3 13.5h14M6 13.5a4 4 0 0 1 8 0"/><path d="M5 16.5h10M7.5 19h5"/><path d="M13.2 6.2l2.2-2.2M16.5 9.2h-2"/>',
  moon: '<path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4z"/>',
  fullmoon: '<circle cx="10" cy="9" r="5.2"/><path d="M3 17h14"/><circle cx="8.3" cy="7.8" r="1" fill="currentColor" stroke="none"/><circle cx="11.6" cy="10.4" r=".7" fill="currentColor" stroke="none"/>',
  ruins: '<path d="M3 17.5h14M4.5 17.5V8.5M8 17.5v-7M12 17.5V9l1.2-1.4M15.5 17.5V12"/><path d="M3.5 8.5h3.2M7 10.5h2M11 9h3"/>',
  hall: '<path d="M2.5 8.2L10 3.5l7.5 4.7"/><path d="M4 8v7M16 8v7M8 9v6M12 9v6M2.8 15.5h14.4M2 17.5h16"/>',
  tag: '<path d="M3 3.5h6.5l7.5 7.5-6 6-7.5-7.5z"/><circle cx="6.8" cy="7.2" r="1.2"/>',
  walk: '<circle cx="11" cy="3.6" r="1.6"/><path d="M8.2 18l2-5.2 2.4 2V18M10.2 12.8l.6-4.4-3 1.6-1 3M10.8 8.4l2.4 2.6 2.4.6"/>',
  route: '<circle cx="5" cy="15" r="1.8"/><circle cx="15" cy="5" r="1.8"/><path d="M6.6 14c3-1 1-5.2 4-6.4s3.2-1 3-1.2"/>',
  book: '<path d="M3 4.5c2.5-1 5-.8 7 .8 2-1.6 4.5-1.8 7-.8v11c-2.5-1-5-.8-7 .8-2-1.6-4.5-1.8-7-.8z"/><path d="M10 5.3v11"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.6"/><circle cx="10" cy="14.3" r=".4" fill="currentColor"/>',
  sliders: '<path d="M4 5.5h7M14.5 5.5H16M4 10h2M9.5 10H16M4 14.5h8M15.5 14.5h.5"/><circle cx="12.8" cy="5.5" r="1.6"/><circle cx="7.8" cy="10" r="1.6"/><circle cx="13.8" cy="14.5" r="1.6"/>',
  map: '<path d="M2.5 5l5-2 5 2 5-2v12l-5 2-5-2-5 2z"/><path d="M7.5 3v12M12.5 5v12"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  prev: '<path d="M12.5 4.5L7 10l5.5 5.5"/>',
  next: '<path d="M7.5 4.5L13 10l-5.5 5.5"/>',
  play: '<path d="M6.5 4.5v11l9-5.5z"/>',
  pause: '<path d="M7 4.5v11M13 4.5v11"/>',
  target: '<circle cx="10" cy="10" r="6"/><path d="M10 1.8v3.4M10 14.8v3.4M1.8 10h3.4M14.8 10h3.4"/>',
  fly: '<path d="M3 16c3-6 7-9 14-11M17 5l-4.5.3M17 5l-1.6 4.2"/>',
  north: '<path d="M10 2.5l3.5 12L10 12l-3.5 2.5z"/>',
  external: '<path d="M8 4.5H4.5v11h11V12M11 3.5h5.5V9M16.5 3.5L9 11"/>',
  chevronDown: '<path d="M5 8l5 5 5-5"/>',
  chevronUp: '<path d="M5 12l5-5 5 5"/>',
};

export function icon(name, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

export const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {} });
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)').matches;
export const isCoarse = () => mq('(pointer: coarse)').matches;
export const isNarrow = () => mq('(max-width: 720px)').matches;

// 신뢰도 표기
export const CONFIDENCE = {
  확실: { cls: 'c-sure', text: '발굴·실측·원문 기록으로 확인된 내용입니다.' },
  추정: { cls: 'c-est', text: '근거가 있으나 해석이나 계산이 들어간 복원입니다.' },
  불확실: { cls: 'c-unsure', text: '이견이 크거나 근거가 약한, 가설에 가까운 배치입니다.' },
};
export function confidenceBadge(conf, note) {
  const c = CONFIDENCE[conf] || CONFIDENCE['추정'];
  return h('span', { class: `badge ${c.cls}`, title: note || c.text }, conf || '추정');
}

export const KIND_KO = {
  hall: '전각', gate: '문', gatehouse: '문루(2층 누문)', pavilion: '누각·정자', landmark: '유적·지점',
  bridge: '다리', stairs: '돌계단', peak: '산',
};

// 스크린리더 알림
let liveEl = null;
export function announce(msg) {
  if (!liveEl) liveEl = document.getElementById('sr-live');
  if (!liveEl) return;
  liveEl.textContent = '';
  requestAnimationFrame(() => { liveEl.textContent = msg; });
}
