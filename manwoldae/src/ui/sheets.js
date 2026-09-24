// 패널(시트) 관리: 넓은 화면은 왼쪽·오른쪽에 하나씩, 좁은 화면은 아래쪽 시트 하나만.
// Esc 는 가장 최근에 연 시트를 닫고, 닫으면 연 버튼으로 초점을 돌려줍니다.
import { h, icon, isNarrow } from './dom.js';

export function createSheets(root) {
  const sheets = new Map();
  const stack = [];
  const listeners = new Set();

  function create(id, o) {
    const closeBtn = h('button', { class: 'btn icon-btn sheet-close', type: 'button', 'aria-label': `${o.label} 닫기 (Esc)`, onclick: () => close(id) }, icon('close'));
    // 좁은 화면: 시트를 접어 장면을 넓게 보기
    const minBtn = h('button', { class: 'btn icon-btn sheet-min', type: 'button', 'aria-label': `${o.label} 접기`, 'aria-expanded': 'true' }, icon('chevronDown'));
    minBtn.addEventListener('click', () => {
      const min = !el.classList.contains('min');
      el.classList.toggle('min', min);
      minBtn.setAttribute('aria-expanded', String(!min));
      minBtn.setAttribute('aria-label', `${o.label} ${min ? '펼치기' : '접기'}`);
      minBtn.replaceChildren(icon(min ? 'chevronUp' : 'chevronDown'));
    });
    const body = h('div', { class: 'sheet-body' }, ...(o.body || []));
    const head = h('div', { class: 'sheet-head' }, o.eyebrow || h('span', { class: 'eyebrow' }, o.label), h('span', { class: 'sheet-tools' }, minBtn, closeBtn));
    const el = h('section', {
      class: `sheet sheet-${o.side || 'left'} ${o.cls || ''}`, id: `sheet-${id}`, role: 'dialog', 'aria-modal': 'false',
      'aria-label': o.labelledBy ? undefined : o.label, 'aria-labelledby': o.labelledBy, tabindex: '-1',
    }, head, body, o.footer ? h('div', { class: 'sheet-foot' }, ...o.footer) : null);
    el.hidden = true;
    root.append(el);
    const s = { id, el, body, side: o.side || 'left', onClose: o.onClose, onOpen: o.onOpen, opener: null };
    sheets.set(id, s);
    return s;
  }

  function open(id) {
    const s = sheets.get(id);
    if (!s) return;
    const already = !s.el.hidden;
    // 같은 쪽(좁은 화면은 모두) 다른 시트는 닫음
    for (const o of sheets.values()) {
      if (o !== s && !o.el.hidden && (isNarrow() || o.side === s.side)) close(o.id, { silent: true });
    }
    s.el.classList.remove('min');
    if (!already) {
      s.opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      s.el.hidden = false;
      requestAnimationFrame(() => s.el.classList.add('in'));
      s.onOpen?.();
    }
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    stack.push(id);
    const focusTarget = s.el.querySelector('[data-autofocus]') || s.el.querySelector('h2') || s.el;
    if (focusTarget.tabIndex < 0 && focusTarget !== s.el) focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus({ preventScroll: true });
    emit();
  }

  function close(id, o = {}) {
    const s = sheets.get(id);
    if (!s || s.el.hidden) return;
    s.el.classList.remove('in');
    s.el.hidden = true;
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    s.onClose?.();
    if (!o.silent && s.opener && document.contains(s.opener)) s.opener.focus({ preventScroll: true });
    s.opener = null;
    emit();
  }

  const isOpen = (id) => !!sheets.get(id) && !sheets.get(id).el.hidden;
  const toggle = (id) => (isOpen(id) ? close(id) : open(id));
  function closeTop() {
    const id = stack[stack.length - 1];
    if (!id) return false;
    close(id);
    return true;
  }
  function emit() { for (const fn of listeners) fn(); }

  return {
    create, open, close, toggle, isOpen, closeTop,
    get(id) { return sheets.get(id); },
    anyOpen: () => stack.length > 0,
    openSides: () => new Set(stack.map((id) => sheets.get(id).side)),
    onChange(fn) { listeners.add(fn); },
  };
}
