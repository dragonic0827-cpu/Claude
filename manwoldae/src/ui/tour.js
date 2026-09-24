// 안내 여행: spec.tour 12곳 — 제목·해설, 이전/다음, 진행 점, 자동 재생
//
// createTour({ spec, nav, sheet }) → { open(i?), close(), go(i, instant), next(), prev(), toggleAutoplay(), isOpen, index, update(dt) }
import { h, icon, announce } from './dom.js';

export function createTour({ spec, nav, sheets, onOpenChange }) {
  const stops = (spec.tour || []).filter((s) => s && s.camera && s.target);
  const n = stops.length;
  let index = -1, open = false, autoplay = false, dwell = 0, arrived = false, flightToken = 0;

  const title = h('h2', { class: 'tour-title', id: 'tour-title' });
  const count = h('span', { class: 'tour-count' });
  const text = h('p', { class: 'tour-text' });
  const bar = h('div', { class: 'tour-progress', 'aria-hidden': 'true' }, h('i'));
  const dots = h('ol', { class: 'tour-dots', 'aria-label': '안내 지점' });
  const dotBtns = stops.map((s, i) => {
    const b = h('button', { class: 'dot', type: 'button', 'aria-label': `${i + 1}. ${s.titleKo || ''}`, title: s.titleKo || '', onclick: () => go(i) });
    dots.append(h('li', {}, b));
    return b;
  });
  const prevBtn = h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': '이전 지점 (←)', onclick: () => prev() }, icon('prev'));
  const nextBtn = h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': '다음 지점 (→)', onclick: () => next() }, icon('next'));
  const playIco = h('span', { class: 'play-ico' }, icon('play'));
  const playLabel = h('span', {}, '자동 재생');
  const playBtn = h('button', { class: 'btn text-btn', type: 'button', 'aria-pressed': 'false', onclick: () => toggleAutoplay() }, playIco, playLabel);

  const sheet = sheets.create('tour', {
    side: 'left', label: '안내 여행', labelledBy: 'tour-title', eyebrow: h('span', { class: 'eyebrow' }, '안내 여행 ', count),
    body: [title, text],
    footer: [dots, bar, h('div', { class: 'tour-nav' }, prevBtn, playBtn, nextBtn)],
    onClose: () => { open = false; setAutoplay(false); onOpenChange?.(false); },
  });

  function render() {
    const s = stops[index];
    if (!s) return;
    title.textContent = s.titleKo || '';
    text.textContent = s.textKo || '';
    count.textContent = `${index + 1} / ${n}`;
    dotBtns.forEach((b, i) => {
      b.classList.toggle('on', i === index);
      b.classList.toggle('seen', i < index);
      if (i === index) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= n - 1;
    sheet.body.scrollTop = 0;
  }

  function go(i, instant = false) {
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i | 0));
    index = i;
    if (!open) show();
    render();
    const s = stops[i];
    arrived = false;
    dwell = 0;
    const token = ++flightToken;
    const p = nav.flyTo(s.camera, s.target, { instant });
    p.then((done) => { if (token === flightToken) arrived = true; if (!done && token === flightToken && !instant) setAutoplay(false); });
    announce(`${i + 1}번째 지점, ${s.titleKo}`);
    return p;
  }
  const next = () => (index < n - 1 ? go(index + 1) : setAutoplay(false));
  const prev = () => (index > 0 ? go(index - 1) : null);

  function setAutoplay(v) {
    autoplay = !!v;
    playBtn.setAttribute('aria-pressed', String(autoplay));
    playIco.replaceChildren(icon(autoplay ? 'pause' : 'play'));
    playLabel.textContent = autoplay ? '멈춤' : '자동 재생';
    bar.classList.toggle('on', autoplay);
    dwell = 0;
    bar.firstChild.style.transform = 'scaleX(0)';
  }
  function toggleAutoplay() {
    setAutoplay(!autoplay);
    if (autoplay && index >= n - 1) go(0);
    else if (autoplay && arrived) dwell = 0;
  }

  function show() {
    open = true;
    sheets.open('tour');
    onOpenChange?.(true);
  }
  function close() { sheets.close('tour'); }

  // 자동 재생: 도착한 뒤 글 길이에 맞춰 머무르고 다음으로
  function update(dt) {
    if (!autoplay || !open || !arrived) return;
    if (nav.interacting) { setAutoplay(false); return; }
    const s = stops[index];
    const hold = 7 + Math.min(14, (s.textKo || '').length * 0.045);
    dwell += dt;
    bar.firstChild.style.transform = `scaleX(${Math.min(1, dwell / hold)})`;
    if (dwell >= hold) {
      if (index < n - 1) go(index + 1); else setAutoplay(false);
    }
  }

  return {
    go, next, prev, close, toggleAutoplay, update,
    open: (i) => (index < 0 ? go(i ?? 0) : (show(), render())),
    get isOpen() { return open; },
    get index() { return index; },
    get autoplay() { return autoplay; },
    stops,
  };
}
