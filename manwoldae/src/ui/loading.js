// 불러오기 화면: index.html 의 #loading 을 단계 글과 금색 진행선으로 갱신
export function createLoading() {
  const root = document.getElementById('loading');
  const msg = document.getElementById('loading-msg');
  const bar = document.getElementById('loading-bar');
  let shown = 0;
  return {
    stage(text, frac) {
      if (msg && text) msg.textContent = text;
      if (bar && Number.isFinite(frac)) {
        shown = Math.max(shown, Math.min(1, frac));
        bar.style.transform = `scaleX(${shown.toFixed(3)})`;
        bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
      }
    },
    error(text) {
      root?.classList.add('failed');
      if (msg) msg.textContent = text;
    },
    done() {
      if (!root) return;
      if (bar) bar.style.transform = 'scaleX(1)';
      root.classList.add('done');
      root.setAttribute('aria-hidden', 'true');
      setTimeout(() => root.remove(), 1200);
    },
  };
}

// 브라우저가 화면을 한 번 그리도록 양보 (불러오기 글이 갱신되게)
export const yieldFrame = () => new Promise((r) => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 120); // 탭이 가려져 rAF 가 멈춰도 진행
});
