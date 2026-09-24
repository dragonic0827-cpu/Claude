// 아래 도구 막대: 시간대 · 복원/유적 · 이름표 · 걷기 · 안내(여행) · 평면도 · 역사(고증) · 도움말 · 화질
// 라디오 묶음(시간대·화질)은 방향키로 움직이고 탭 멈춤은 고른 것 하나(roving tabindex).
// 좁은 화면(≤720 px, 휴대폰 세로)은 자주 쓰는 여섯(시간·유적·걷기·안내·평면도·역사)만 막대에 두고, 이름표·도움말·화질은
// ‘더보기’ 메뉴(role=menu: 위아래 방향키·Home/End, Esc·Tab 으로 닫힘)로 옮겨 단추마다 44 px 넘게 누를 자리를 둡니다.
//
// createDock({ root, presets, actions }) → { sync(state) }
//   actions: { setTime(name), toggleRuins(), toggleLabels(), toggleWalk(), toggleTour(), toggleMap(), toggleAbout(), toggleHelp(), setQuality(level) }
//   state:   { time, ruins, labels, walk, tour, map, about, help, quality, pixelRatio, auto }
import { h, icon } from './dom.js';

const TIME_ICON = { '팔관회 아침': 'sunrise', '한낮': 'noon', '해질녘': 'sunset', '보름달 밤': 'fullmoon' };
const TIME_SHORT = { '팔관회 아침': '아침', '한낮': '한낮', '해질녘': '저녁', '보름달 밤': '달밤' };
export const QUALITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
const QUALITY_DESC = { high: '그림자 선명 · 고해상도', medium: '그림자 보통 · 해상도 조금 낮춤', low: '그림자 없음 · 가장 가벼움' };

export function createDock({ root, presets, actions }) {
  const btn = (ico, label, onclick, o = {}) => h('button', {
    class: `dock-btn ${o.cls || ''}`, type: 'button', 'aria-label': o.aria || label, title: o.title || label,
    'aria-pressed': o.toggle ? 'false' : undefined, 'aria-expanded': o.expand ? 'false' : undefined, 'aria-controls': o.controls, onclick,
  }, icon(ico), h('span', { class: 'dock-label' }, label));

  // 시간대: 넓은 화면은 네 칸 선택, 좁은 화면은 한 칸 + 펼침 목록
  const timeBtns = new Map();
  const seg = h('div', { class: 'dock-seg', role: 'radiogroup', 'aria-label': '시간대' });
  const label = (p) => p.label || p.name;
  presets.forEach((p, i) => {
    const b = h('button', {
      class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: i ? '-1' : '0',
      'aria-label': (TIME_SHORT[p.name] || label(p)) === label(p) ? label(p) : `${TIME_SHORT[p.name]} (${label(p)})`, title: `${label(p)} — ${p.subtitle} (${i + 1})`,
      onclick: () => { actions.setTime(p.name); closePop(); },
    }, icon(TIME_ICON[p.name] || 'sun'), h('span', { class: 'dock-label', 'aria-hidden': 'true' }, TIME_SHORT[p.name] || label(p)));
    timeBtns.set(p.name, b);
    seg.append(b);
  });
  // 라디오 묶음 방향키: 고른 것을 옮기며 초점도 옮김
  const radioKeys = (group, getButtons, choose) => group.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key] ?? (e.key === 'Home' ? -99 : e.key === 'End' ? 99 : 0);
    if (!d) return;
    const arr = getButtons();
    const i = arr.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const j = d === -99 ? 0 : d === 99 ? arr.length - 1 : (i + d + arr.length) % arr.length;
    arr[j].focus();
    choose(arr[j]);
  });
  radioKeys(seg, () => [...timeBtns.values()], (b) => b.click());
  const timeToggle = btn('sunrise', '아침', () => togglePop(timePop, timeToggle), { cls: 'time-toggle', aria: '아침 — 시간대 고르기', expand: true, controls: 'pop-time' });
  const timePop = h('div', { class: 'pop', id: 'pop-time', role: 'menu', 'aria-label': '시간대' });
  timePop.hidden = true;
  presets.forEach((p) => timePop.append(h('button', {
    class: 'pop-item', type: 'button', role: 'menuitemradio', 'aria-checked': 'false', 'data-time': p.name,
    onclick: () => { actions.setTime(p.name); closePop(true); },
  }, icon(TIME_ICON[p.name] || 'sun'), h('span', {}, h('b', {}, label(p)), h('small', {}, p.subtitle)))));
  radioKeys(timePop, () => [...timePop.querySelectorAll('.pop-item')], () => {});

  const ruins = btn('ruins', '유적', actions.toggleRuins, { toggle: true, aria: '유적 보기 (지금 남은 터)', title: '유적 보기 — 목조 건물을 걷어 내고 오늘 남은 터만 (R)' });
  const labels = btn('tag', '이름표', actions.toggleLabels, { toggle: true, title: '이름표 보이기 (L)' });
  const walk = btn('walk', '걷기', actions.toggleWalk, { toggle: true, title: '걸어서 둘러보기 (G)' });
  const tour = btn('route', '안내', actions.toggleTour, { toggle: true, aria: '안내 여행', title: '안내 여행 (T)' });
  const map = btn('map', '평면도', actions.toggleMap, { toggle: true, cls: 'map-toggle', title: '궁성 평면도 (M)' });
  const about = btn('book', '역사', actions.toggleAbout, { toggle: true, aria: '역사와 고증', title: '역사·고증·장소 목록 (I)' });
  const help = btn('help', '도움말', actions.toggleHelp, { toggle: true, aria: '조작 도움말', title: '조작 도움말 (H)' });
  const quality = btn('sliders', '화질', () => togglePop(qualPop, quality), { expand: true, controls: 'pop-quality', title: '화질', cls: 'in-more' });
  labels.classList.add('in-more');
  help.classList.add('in-more');

  const qualBtns = new Map();
  const qualNote = h('p', { class: 'pop-note' });
  const qualPop = h('div', { class: 'pop pop-quality', id: 'pop-quality', role: 'radiogroup', 'aria-label': '화질' },
    h('span', { class: 'eyebrow' }, '화질'));
  qualPop.hidden = true;
  for (const k of ['high', 'medium', 'low']) {
    const b = h('button', { class: 'pop-item', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', onclick: () => { actions.setQuality(k); } },
      h('span', {}, h('b', {}, QUALITY_LABEL[k]), h('small', {}, QUALITY_DESC[k])));
    qualBtns.set(k, b);
    qualPop.append(b);
  }
  qualPop.append(qualNote);
  radioKeys(qualPop, () => [...qualBtns.values()], (b) => b.click());

  // ── 더보기 (좁은 화면): 이름표 · 도움말 · 화질 ──
  const moreIcon = icon('none');
  moreIcon.innerHTML = '<circle cx="4.5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none"/>';
  const more = h('button', {
    class: 'dock-btn more-toggle', type: 'button', 'aria-label': '더보기 — 이름표·도움말·화질', title: '더보기',
    'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'pop-more', onclick: () => togglePop(morePop, more),
  }, moreIcon, h('span', { class: 'dock-label' }, '더보기'));
  const mItem = (role, ico, title, desc, onclick, extra = {}) => h('button', {
    class: 'pop-item', type: 'button', role, tabindex: '-1', 'aria-checked': role === 'menuitem' ? undefined : 'false', onclick, ...extra,
  }, ico ? icon(ico) : null, h('span', {}, h('b', {}, title), desc ? h('small', {}, desc) : null));
  const mLabels = mItem('menuitemcheckbox', 'tag', '이름표', '전각·지점·산 이름 (L)', () => actions.toggleLabels());
  // 시트를 여는 항목은 메뉴를 닫고 초점을 ‘더보기’ 로 돌린 뒤 열어, 시트를 닫으면 초점이 막대로 돌아오게 함
  const mHelp = mItem('menuitemcheckbox', 'help', '조작 도움말', '마우스·터치·키보드 (H)', () => { closePop(true); actions.toggleHelp(); });
  const mQual = new Map();
  const mQualGroup = h('div', { class: 'pop-group', role: 'group', 'aria-label': '화질' }, h('span', { class: 'eyebrow', 'aria-hidden': 'true' }, '화질'));
  for (const k of ['high', 'medium', 'low']) {
    const b = mItem('menuitemradio', null, QUALITY_LABEL[k], QUALITY_DESC[k], () => actions.setQuality(k));
    mQual.set(k, b);
    mQualGroup.append(b);
  }
  const moreNote = h('p', { class: 'pop-note', id: 'pop-more-note' });
  const moreMenu = h('div', { class: 'pop-menu', role: 'menu', 'aria-label': '더보기', 'aria-describedby': 'pop-more-note' },
    mLabels, mHelp, h('div', { class: 'pop-sep', role: 'separator' }), mQualGroup);
  const morePop = h('div', { class: 'pop pop-more', id: 'pop-more' }, moreMenu, moreNote);
  morePop.hidden = true;
  morePop._focusFirst = () => mLabels;
  // 메뉴 안 방향키: 위아래(와 좌우)로 항목을 옮기고 Home/End 로 처음·끝, Tab 은 메뉴를 닫고 막대로
  moreMenu.addEventListener('keydown', (e) => {
    const items = [...moreMenu.querySelectorAll('[role^="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (d || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + d + items.length) % items.length;
      items[j]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      closePop(true);
    }
  });

  const sep = () => h('span', { class: 'dock-sep', 'aria-hidden': 'true' });
  const dock = h('nav', { class: 'dock', id: 'dock', 'aria-label': '보기 도구' },
    seg, timeToggle, sep(), ruins, labels, walk, sep(), tour, map, about, help, quality, more, timePop, qualPop, morePop);
  root.append(dock);
  // 초점이 펼친 목록 밖(막대 밖)으로 나가면 닫음 — 키보드로 지나쳐 가도 목록이 떠 있지 않게
  dock.addEventListener('focusout', (e) => {
    if (openPop && e.relatedTarget && !dock.contains(e.relatedTarget)) closePop();
  });
  // 화면이 넓어져 ‘더보기’ 단추가 사라지면(휴대폰 돌리기·창 넓히기) 열린 메뉴도 닫음
  const narrowMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 720px)') : null;
  narrowMq?.addEventListener?.('change', () => { if (openPop === morePop || openPop === qualPop) closePop(); });

  let openPop = null;
  function togglePop(pop, opener) {
    if (openPop === pop) { closePop(); return; }
    closePop();
    pop.hidden = false;
    openPop = pop;
    document.body.classList.add('dock-pop-open');
    opener.setAttribute('aria-expanded', 'true');
    pop._opener = opener;
    const first = pop._focusFirst?.() || pop.querySelector('[aria-checked="true"]') || pop.querySelector('button');
    first?.focus();
  }
  function closePop(restore = false) {
    if (!openPop) return false;
    openPop.hidden = true;
    document.body.classList.remove('dock-pop-open');
    openPop._opener?.setAttribute('aria-expanded', 'false');
    if (restore) openPop._opener?.focus();
    openPop = null;
    return true;
  }
  // 목록 밖을 누르면 닫음 (여는 단추는 제외 — 그 단추의 click 이 열고 닫음; 다른 도구 단추를 눌러도 닫힘)
  document.addEventListener('pointerdown', (e) => { if (openPop && !openPop.contains(e.target) && e.target.closest?.('.dock-btn') !== openPop._opener) closePop(); });

  const press = (b, v) => b.setAttribute('aria-pressed', String(!!v));
  function sync(s) {
    for (const [name, b] of timeBtns) { b.setAttribute('aria-checked', String(name === s.time)); b.tabIndex = name === s.time ? 0 : -1; }
    for (const b of timePop.querySelectorAll('.pop-item')) { const on = b.dataset.time === s.time; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const short = TIME_SHORT[s.time] || '시간';
    timeToggle.replaceChildren(icon(TIME_ICON[s.time] || 'sun'), h('span', { class: 'dock-label' }, short));
    timeToggle.setAttribute('aria-label', `${short} — 시간대 고르기`);
    press(ruins, s.ruins); press(labels, s.labels); press(walk, s.walk); press(tour, s.tour);
    press(map, s.map); press(about, s.about); press(help, s.help);
    for (const [k, b] of qualBtns) { b.setAttribute('aria-checked', String(k === s.quality)); b.tabIndex = k === s.quality ? 0 : -1; }
    qualNote.textContent = `지금 해상도 배율 ${s.pixelRatio?.toFixed(2) ?? '1.00'}${s.auto ? ' · 느려서 자동으로 낮췄습니다' : ''}`;
    // 더보기 메뉴도 같은 상태로
    mLabels.setAttribute('aria-checked', String(!!s.labels));
    mHelp.setAttribute('aria-checked', String(!!s.help));
    for (const [k, b] of mQual) b.setAttribute('aria-checked', String(k === s.quality));
    moreNote.textContent = qualNote.textContent;
  }

  return { sync, closePop, el: dock };
}
