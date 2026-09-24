// 아래 도구 막대: 시간대 · 복원/유적 · 이름표 · 걷기 · 투어 · 평면도 · 정보 · 도움말 · 화질
//
// createDock({ root, presets, actions }) → { sync(state) }
//   actions: { setTime(name), toggleRuins(), toggleLabels(), toggleWalk(), toggleTour(), toggleMap(), toggleAbout(), toggleHelp(), setQuality(level) }
//   state:   { time, ruins, labels, walk, tour, map, about, help, quality, pixelRatio, auto }
import { h, icon } from './dom.js';

const TIME_ICON = { '팔관회 아침': 'sunrise', '한낮': 'noon', '해질녘': 'sunset', '보름달 밤': 'fullmoon' };
const TIME_SHORT = { '팔관회 아침': '아침', '한낮': '한낮', '해질녘': '해질녘', '보름달 밤': '달밤' };
export const QUALITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };

export function createDock({ root, presets, actions }) {
  const btn = (ico, label, onclick, o = {}) => h('button', {
    class: `dock-btn ${o.cls || ''}`, type: 'button', 'aria-label': o.aria || label, title: o.title || label,
    'aria-pressed': o.toggle ? 'false' : undefined, 'aria-expanded': o.expand ? 'false' : undefined, 'aria-controls': o.controls, onclick,
  }, icon(ico), h('span', { class: 'dock-label' }, label));

  // 시간대: 넓은 화면은 네 칸 선택, 좁은 화면은 한 칸 + 펼침 목록
  const timeBtns = new Map();
  const seg = h('div', { class: 'dock-seg', role: 'radiogroup', 'aria-label': '시간대' });
  presets.forEach((p, i) => {
    const b = h('button', {
      class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', title: `${p.name} — ${p.subtitle} (${i + 1})`,
      onclick: () => { actions.setTime(p.name); closePop(); },
    }, icon(TIME_ICON[p.name] || 'sun'), h('span', { class: 'dock-label' }, TIME_SHORT[p.name] || p.name));
    timeBtns.set(p.name, b);
    seg.append(b);
  });
  seg.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const arr = [...timeBtns.values()];
    const i = arr.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + arr.length) % arr.length;
    arr[j].focus();
    arr[j].click();
  });
  const timeToggle = btn('sunrise', '아침', () => togglePop(timePop, timeToggle), { cls: 'time-toggle', aria: '시간대 고르기', expand: true, controls: 'pop-time' });
  const timePop = h('div', { class: 'pop', id: 'pop-time', role: 'group', 'aria-label': '시간대' });
  timePop.hidden = true;
  presets.forEach((p) => timePop.append(h('button', { class: 'pop-item', type: 'button', 'data-time': p.name, onclick: () => { actions.setTime(p.name); closePop(); } },
    icon(TIME_ICON[p.name] || 'sun'), h('span', {}, h('b', {}, p.name), h('small', {}, p.subtitle)))));

  const ruins = btn('ruins', '유적', actions.toggleRuins, { toggle: true, aria: '유적 보기 (지금 남은 터)', title: '유적 보기 — 목조 건물을 걷어 내고 오늘 남은 터만 (R)' });
  const labels = btn('tag', '이름표', actions.toggleLabels, { toggle: true, title: '이름표 보이기 (L)' });
  const walk = btn('walk', '걷기', actions.toggleWalk, { toggle: true, title: '걸어서 둘러보기 (G)' });
  const tour = btn('route', '투어', actions.toggleTour, { toggle: true, aria: '안내 여행', title: '안내 여행 (T)' });
  const map = btn('map', '평면도', actions.toggleMap, { toggle: true, cls: 'map-toggle', title: '궁성 평면도 (M)' });
  const about = btn('book', '정보', actions.toggleAbout, { toggle: true, aria: '역사와 고증 자료', title: '역사·고증·전각 목록 (I)' });
  const help = btn('help', '도움말', actions.toggleHelp, { toggle: true, aria: '조작 도움말', title: '조작 도움말 (H)' });
  const quality = btn('sliders', '화질', () => togglePop(qualPop, quality), { expand: true, controls: 'pop-quality', title: '화질' });

  const qualBtns = new Map();
  const qualNote = h('p', { class: 'pop-note' });
  const qualPop = h('div', { class: 'pop pop-quality', id: 'pop-quality', role: 'radiogroup', 'aria-label': '화질' },
    h('span', { class: 'eyebrow' }, '화질'));
  qualPop.hidden = true;
  for (const [k, desc] of [['high', '그림자 선명 · 고해상도'], ['medium', '그림자 보통 · 해상도 조금 낮춤'], ['low', '그림자 없음 · 가장 가벼움']]) {
    const b = h('button', { class: 'pop-item', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => { actions.setQuality(k); } },
      h('span', {}, h('b', {}, QUALITY_LABEL[k]), h('small', {}, desc)));
    qualBtns.set(k, b);
    qualPop.append(b);
  }
  qualPop.append(qualNote);

  const sep = () => h('span', { class: 'dock-sep', 'aria-hidden': 'true' });
  const dock = h('nav', { class: 'dock', id: 'dock', 'aria-label': '보기 도구' },
    seg, timeToggle, sep(), ruins, labels, walk, sep(), tour, map, about, help, quality, timePop, qualPop);
  root.append(dock);

  let openPop = null;
  function togglePop(pop, opener) {
    if (openPop === pop) { closePop(); return; }
    closePop();
    pop.hidden = false;
    openPop = pop;
    opener.setAttribute('aria-expanded', 'true');
    pop._opener = opener;
    const first = pop.querySelector('[aria-checked="true"]') || pop.querySelector('button');
    first?.focus();
  }
  function closePop(restore = false) {
    if (!openPop) return false;
    openPop.hidden = true;
    openPop._opener?.setAttribute('aria-expanded', 'false');
    if (restore) openPop._opener?.focus();
    openPop = null;
    return true;
  }
  document.addEventListener('pointerdown', (e) => { if (openPop && !openPop.contains(e.target) && !e.target.closest?.('.dock-btn')) closePop(); });

  const press = (b, v) => b.setAttribute('aria-pressed', String(!!v));
  function sync(s) {
    for (const [name, b] of timeBtns) b.setAttribute('aria-checked', String(name === s.time));
    for (const b of timePop.querySelectorAll('.pop-item')) b.classList.toggle('on', b.dataset.time === s.time);
    timeToggle.replaceChildren(icon(TIME_ICON[s.time] || 'sun'), h('span', { class: 'dock-label' }, TIME_SHORT[s.time] || '시간'));
    press(ruins, s.ruins); press(labels, s.labels); press(walk, s.walk); press(tour, s.tour);
    press(map, s.map); press(about, s.about); press(help, s.help);
    for (const [k, b] of qualBtns) b.setAttribute('aria-checked', String(k === s.quality));
    qualNote.textContent = `지금 해상도 배율 ${s.pixelRatio?.toFixed(2) ?? '1.00'}${s.auto ? ' · 느려서 자동으로 낮췄습니다' : ''}`;
  }

  return { sync, closePop, el: dock };
}
