// 역사와 고증 시트(연표 · 장소 목록 · 고증 자료 · 복원에 대하여)와 도움말 시트
import { h, icon, confidenceBadge, CONFIDENCE, nobreak, confidenceOf, noteText } from './dom.js';

// 학설에 따라 바꿔 보는 복원 선택지 (docs/research.md 6.1 · 5장)
export const ALTERNATIVES = [
  { id: 'paving', title: '회경전 뜰 바닥', off: '박석', on: '전돌',
    note: '『고려도경』의 "甃石"을 넓은 돌을 깐 것으로 읽었습니다. 甃는 본래 벽돌을 까는 일이고, 회랑 안 마당에 전(塼)을 깔았다는 설명(신편한국사)도 있습니다.' },
  { id: 'dapo', title: '공포', off: '주심포', on: '다포',
    note: '남한의 현존 고려 건물은 모두 주심포입니다. 12세기 송 궁전과 개성 일대 14세기 건물을 따라 기둥 사이에도 공포를 한 조씩 넣은 안입니다(회경전·건덕전 등 중심 전각과 주요 궁문).' },
  { id: 'dc14', title: '단청', off: '12세기', on: '14세기',
    note: '12세기 이전에는 부재 전체를 붉게 칠했고, 윗부재를 녹색으로 칠하는 상록하단(上綠下丹)은 13–14세기에 받아들였다는 연구(이은희 2016)를 따라 두 안을 비교합니다.' },
  { id: 'celadon', title: '금원 정자 기와', off: '회흑색', on: '청자기와',
    note: '1157년 의종이 이궁의 양이정을 청자기와로 덮었다는 기록이 있습니다. 주요 전각에는 근거가 없어, 금원 정자에만 선택지로 두었습니다.' },
];

export function createAbout({ spec, sheets, onSelect, onOpenChange, onAlt }) {
  const tabs = [
    { id: 'history', label: '연표' },
    { id: 'places', label: '장소 목록' },
    { id: 'sources', label: '고증 자료' },
    { id: 'method', label: '복원에 대하여' },
  ];
  const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '정보 항목' });
  const panels = {};
  const tabBtns = tabs.map((t, i) => {
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`, 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1', onclick: () => show(t.id) }, t.label);
    tabList.append(b);
    panels[t.id] = h('div', { class: 'tab-panel', role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, tabindex: '0' });
    panels[t.id].hidden = i !== 0;
    return b;
  });
  tabList.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = tabBtns.indexOf(document.activeElement);
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % tabBtns.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + tabBtns.length) % tabBtns.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = tabBtns.length - 1;
    tabBtns[j].focus();
    show(tabs[j].id);
  });
  function show(id) {
    tabs.forEach((t, i) => {
      const on = t.id === id;
      tabBtns[i].setAttribute('aria-selected', String(on));
      tabBtns[i].tabIndex = on ? 0 : -1;
      panels[t.id].hidden = !on;
    });
    sheet.body.scrollTop = 0;
  }

  // 연표
  const hist = h('ol', { class: 'timeline' });
  for (const e of spec.history || []) {
    hist.append(h('li', {},
      h('span', { class: 'tl-year' }, e.label || String(e.year)),
      h('div', { class: 'tl-body' }, h('p', {}, nobreak(e.textKo || '')), e.confidence ? confidenceBadge(e.confidence, e.confidenceNote) : null,
        e.confidenceNote ? h('span', { class: 'conf-note' }, noteText(e.confidenceNote)) : null)));
  }
  panels.history.append(hist);

  // 장소 목록 (전각·문·누정·지점·다리)
  const groups = [
    ['전각', (spec.buildings || []).filter((b) => b.kind === 'hall')],
    ['문과 문루', (spec.buildings || []).filter((b) => b.kind === 'gate' || b.kind === 'gatehouse')],
    ['누각·정자', (spec.buildings || []).filter((b) => b.kind === 'pavilion')],
    ['지점', spec.landmarks || []],
    ['다리', spec.bridges || []],
  ];
  for (const [title, arr] of groups) {
    if (!arr.length) continue;
    const ul = h('ul', { class: 'place-list' });
    for (const d of [...arr].sort((a, b) => (a.rank ?? 5) - (b.rank ?? 5) || (a.cz ?? a.z ?? 0) - (b.cz ?? b.z ?? 0))) {
      const { confidence: cf, note } = confidenceOf(d);
      const c = CONFIDENCE[cf];
      ul.append(h('li', {}, h('button', { class: 'place', type: 'button', onclick: () => onSelect?.(d.id) },
        h('span', { class: `dot-conf ${c?.cls || 'c-none'}`, title: note ? noteText(note) : cf || '', 'aria-hidden': 'true' }),
        h('span', { class: 'place-n' }, d.nameKo), d.nameHanja ? h('span', { class: 'place-h', lang: 'zh-Hant' }, d.nameHanja) : null,
        cf ? h('span', { class: 'sr-only' }, `, 신뢰도 ${cf}`) : null)));
    }
    panels.places.append(h('h3', { class: 'group-title' }, title), ul);
  }

  // 고증 자료
  panels.sources.append(h('p', { class: 'muted' }, '이 복원의 배치·치수·해설은 아래 자료를 바탕으로 했습니다. 링크는 새 탭에서 열립니다.'));
  const src = h('ul', { class: 'sources' });
  for (const s of spec.sources || []) {
    src.append(h('li', {}, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title, icon('external', 'ico ico-sm')) : s.title));
  }
  panels.sources.append(src);

  // 복원 선택지: 켜고 끄는 스위치 (기본값 = 이 복원이 택한 안)
  const altBtns = new Map();
  const altList = h('ul', { class: 'alt-list', 'aria-labelledby': 'alt-title' });
  for (const a of ALTERNATIVES) {
    const state = h('span', { class: 'alt-state' }, a.off);
    const b = h('button', {
      class: 'alt-switch', type: 'button', role: 'switch', 'aria-checked': 'false', id: `alt-${a.id}`,
      'aria-describedby': `alt-note-${a.id}`, onclick: () => onAlt?.(a.id, b.getAttribute('aria-checked') !== 'true'),
    }, h('span', { class: 'alt-track', 'aria-hidden': 'true' }, h('i')), h('span', { class: 'alt-title' }, a.title), state);
    altBtns.set(a.id, { b, state, a });
    altList.append(h('li', {}, b, h('p', { class: 'alt-note', id: `alt-note-${a.id}` }, `${a.off} ↔ ${a.on}. ${a.note}`)));
  }
  function syncAlt(st = {}, busy = false) {
    for (const [id, { b, state, a }] of altBtns) {
      b.setAttribute('aria-checked', String(!!st[id]));
      state.textContent = st[id] ? a.on : a.off;
      b.disabled = busy;
    }
  }

  // 복원에 대하여
  const legend = h('ul', { class: 'legend' });
  for (const k of ['확실', '추정', '불확실']) legend.append(h('li', {}, confidenceBadge(k), h('span', {}, CONFIDENCE[k].text)));
  panels.method.append(
    h('p', {}, '이 장면은 송나라 사신 서긍이 개경을 찾은 ', h('b', {}, '1123년'), '의 본궐을 기준으로 삼았습니다. 『고려도경』의 기록, 2007–2018년 남북 공동발굴 보고서, 현존 고려 목조건축의 비례를 함께 써서 다시 세웠고, 이름은 1138년 개칭 이전의 것을 썼습니다.'),
    h('h3', { class: 'group-title' }, '신뢰도 표시'), legend,
    h('h3', { class: 'group-title' }, '가장 불확실한 부분'),
    h('ul', { class: 'bullets' },
      h('li', {}, '승평문·구정·동락정은 발굴되지 않아, 위치와 규모를 문헌에 기대어 추정했습니다.'),
      h('li', {}, '목조 상부 구조 전체(기둥 높이, 공포, 지붕 물매, 단청)는 현존 고려 불전과 송나라 『영조법식』에서 추정한 값입니다. 단청은 조선식 모로단청이 아니라 12세기 적색 주조로 칠했습니다.'),
      h('li', {}, '광명천의 궁 안 물길과 금교는 오늘날 하천 선형을 옮겨 온 것입니다.'),
      h('li', {}, '서부 건축군 전각 이름(건덕전·임천각 등)의 비정과 대지 높이는 학설에 따라 달라집니다.'),
      h('li', {}, '궁성·황성 성벽은 길이만 확실하고 선형은 모식도에서 추정했습니다. 중심축은 진북에서 서쪽으로 약 17°(±2°) 기울었습니다.')),
    h('h3', { class: 'group-title', id: 'alt-title' }, '다른 학설로 바꿔 보기'),
    altList,
    h('h3', { class: 'group-title' }, '유적 보기'),
    h('p', {}, '1361년 홍건적의 침입으로 불탄 뒤 궁궐은 다시 세워지지 않았습니다. ‘유적’ 단추를 누르면 목조 건물과 담장을 걷어 내고 축대·계단·초석처럼 오늘까지 남은 터만 보여 줍니다.'),
    h('p', { class: 'muted' }, '지형은 SRTM 30 m 표고 자료를 바탕으로 만들었고, 궁성 안은 발굴된 대지 높이에 맞추어 다듬었습니다.'),
  );

  const sheet = sheets.create('about', {
    side: 'left', cls: 'sheet-wide', label: '역사와 고증', labelledBy: 'about-title',
    eyebrow: h('span', { class: 'eyebrow' }, '역사와 고증'),
    body: [h('h2', { class: 'sheet-title', id: 'about-title' }, spec.meta?.title || '고려 개경 만월대'),
      spec.meta?.subtitle ? h('p', { class: 'sheet-sub' }, spec.meta.subtitle) : null, tabList, ...Object.values(panels)],
    onClose: () => onOpenChange?.(false),
  });

  return { open: (tab) => { sheets.open('about'); if (tab) show(tab); onOpenChange?.(true); }, close: () => sheets.close('about'), show, syncAlt };
}

// keys: { on, set(on) } — 한 글자 단축키 켜고 끄기 (WCAG 2.1.4)
export function createHelp({ sheets, onOpenChange, touch, keys = null }) {
  const row = (k, v) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v));
  const kbd = (...ks) => ks.map((k, i) => [i ? ' ' : '', h('kbd', {}, k)]);
  let keySwitch = null;
  if (keys) {
    const state = h('span', { class: 'alt-state' }, keys.on ? '켜짐' : '꺼짐');
    keySwitch = h('button', {
      class: 'alt-switch', type: 'button', role: 'switch', 'aria-checked': String(!!keys.on),
      onclick: () => {
        const on = keySwitch.getAttribute('aria-checked') !== 'true';
        keys.set(on);
        keySwitch.setAttribute('aria-checked', String(on));
        state.textContent = on ? '켜짐' : '꺼짐';
      },
    }, h('span', { class: 'alt-track', 'aria-hidden': 'true' }, h('i')), h('span', { class: 'alt-title' }, '한 글자 단축키'), state);
  }
  const body = [
    h('h2', { class: 'sheet-title', id: 'help-title' }, '둘러보는 법'),
    h('h3', { class: 'group-title' }, '하늘에서 보기'),
    h('table', { class: 'keys' }, h('tbody', {},
      row('돌려 보기', touch ? '한 손가락으로 끌기' : ['왼쪽 단추로 끌기 · ', kbd('←', '→', '↑', '↓')]),
      row('옮기기', touch ? '두 손가락으로 끌기' : ['오른쪽 단추로 끌기 · Shift+끌기 · Shift+방향키']),
      row('가까이·멀리', touch ? '두 손가락 벌리기·오므리기' : ['휠 (커서 쪽으로 다가감) · ', kbd('+', '−'), ' 또는 ', kbd('PgUp', 'PgDn')]),
      row('정보 보기', '전각이나 이름표를 누르기'),
      row('평면도', touch ? '평면도를 누르면 그곳으로 날아감' : ['평면도를 누르거나, 평면도에서 방향키로 표적을 옮기고 ', kbd('Enter')]))),
    h('h3', { class: 'group-title' }, '걸어서 보기'),
    h('table', { class: 'keys' }, h('tbody', {},
      row('걷기', touch ? '왼쪽 아래 조이스틱' : [kbd('W', 'A', 'S', 'D'), ' 또는 방향키']),
      row('둘러보기', touch ? '화면 끌기' : ['화면 끌기 · 위아래 ', kbd('PgUp', 'PgDn')]),
      row('달리기', kbd('Shift')),
      row('나가기', [kbd('Esc'), ' 또는 걷기 단추']))),
    h('h3', { class: 'group-title' }, '단축키'),
    h('table', { class: 'keys' }, h('tbody', {},
      row('시간대', kbd('1', '2', '3', '4')),
      row('안내 여행', [kbd('T'), ' · 이전/다음 ', kbd('←', '→')]),
      row('이름표 · 유적 · 걷기', kbd('L', 'R', 'G')),
      row('평면도 · 역사 · 도움말', kbd('M', 'I', 'H')),
      row('패널 닫기', kbd('Esc')))),
    keySwitch ? h('div', { class: 'key-switch' }, keySwitch, h('p', { class: 'alt-note' }, '끄면 글자·숫자 단축키가 동작하지 않습니다(방향키·Esc 는 그대로).')) : null,
    h('p', { class: 'muted' }, '움직임 줄이기 설정을 켜 두면 카메라가 날아가지 않고 바로 바뀝니다.'),
  ];
  sheets.create('help', { side: 'left', label: '도움말', labelledBy: 'help-title', body, onClose: () => onOpenChange?.(false) });
  return { open: () => { sheets.open('help'); onOpenChange?.(true); }, close: () => sheets.close('help') };
}
