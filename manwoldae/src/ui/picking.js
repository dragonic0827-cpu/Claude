// 누르기(클릭·탭)로 고르기: 보이는 메시만 광선 검사하고, 지형이 먼저 가리면 무시합니다.
// 마우스를 올리면 이름을 작은 풍선으로 보여 줍니다(데스크톱, 0.15 초 간격).
//
// createPicker({ camera, dom, heightAt, roots, onPick(id|null), tooltipRoot, names }) → { pickAt(x, y) }
import * as THREE from 'three';
import { h } from './dom.js';

export function createPicker({ camera, dom, heightAt, roots, onPick, tooltipRoot, names, resolve = null, enabled = () => true }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = [];
  const hits = [];
  const p = new THREE.Vector3();

  function visibleMeshes() {
    meshes.length = 0;
    const walk = (o) => {
      if (!o.visible) return;
      if (o.isLOD) {
        // 지금 보이는 단계만
        const lvl = o.levels.find((l) => l.object.visible);
        if (lvl) walk(lvl.object);
        return;
      }
      if (o.isMesh && !o.userData.__rim) meshes.push(o);
      for (const c of o.children) walk(c);
    };
    for (const r of roots()) walk(r);
    return meshes;
  }

  // 지형과 처음 만나는 거리 (높이 함수를 따라 걸음)
  function groundDistance(r) {
    const o = r.ray.origin, d = r.ray.direction;
    let t = 0, step = 1.5, prevT = 0;
    for (let i = 0; i < 400 && t < 6000; i++) {
      p.copy(o).addScaledVector(d, t);
      if (p.y < heightAt(p.x, p.z) - 0.05) {
        // 이분법으로 다듬기
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          p.copy(o).addScaledVector(d, m);
          if (p.y < heightAt(p.x, p.z) - 0.05) b = m; else a = m;
        }
        return b;
      }
      prevT = t;
      t += step;
      step = Math.min(step * 1.12, 25);
    }
    return Infinity;
  }

  function idOf(o) {
    for (let q = o; q; q = q.parent) {
      if (q.userData?.pickId) return q.userData.pickId;
      if (q.userData?.id && q.userData.pickable) return q.userData.id;
    }
    return null;
  }

  function pickAt(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const gd = groundDistance(ray);
    ray.far = Number.isFinite(gd) ? gd + 0.6 : 8000;
    ray.near = 0;
    hits.length = 0;
    ray.intersectObjects(visibleMeshes(), false, hits);
    for (const hit of hits) {
      const id = (resolve && resolve(hit)) || idOf(hit.object);
      if (id) return id;
    }
    return null;
  }

  // 클릭 판정: 거의 움직이지 않고 짧게 누름
  let down = null;
  dom.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  });
  dom.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 650 || !enabled()) return;
    onPick?.(pickAt(e.clientX, e.clientY));
  });

  // 마우스 올림 풍선
  let tip = null, lastHover = 0, hoverId = null, pending = null;
  if (tooltipRoot) {
    tip = h('div', { class: 'hover-tip', 'aria-hidden': 'true' });
    tip.hidden = true;
    tooltipRoot.append(tip);
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) { tip.hidden = true; return; }
      pending = { x: e.clientX, y: e.clientY };
      const now = performance.now();
      if (now - lastHover < 150) return;
      lastHover = now;
      const id = enabled() ? pickAt(pending.x, pending.y) : null;
      hoverId = id;
      dom.style.cursor = id ? 'pointer' : '';
      if (!id) { tip.hidden = true; return; }
      tip.textContent = names(id) || id;
      tip.hidden = false;
      tip.style.transform = `translate3d(${pending.x + 14}px, ${pending.y + 16}px, 0)`;
    });
    dom.addEventListener('pointerleave', () => { tip.hidden = true; hoverId = null; });
  }

  return { pickAt, get hoverId() { return hoverId; }, hideTip() { if (tip) tip.hidden = true; } };
}
