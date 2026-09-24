// 만월대 3D — 부트스트랩: 렌더러·카메라·조작·월드 조립·UI 연결
//
// 장면은 필요할 때만 그립니다(조작·비행·걷기·시간대 전환·이름표 흐림이 있을 때). 그림자 맵도 빛·상자가 바뀔 때만 갱신(sky.js).
// 테스트 API: window.__app = { THREE, scene, camera, controls, renderer, spec, terrain, buildings, env, nav, items, labels,
//   lookAt(cam, target), setTime(name, instant?), setRuins(bool), setWalk(bool), setLabels(bool), setQuality('high'|'medium'|'low'),
//   setAlt(id, on) → Promise (복원 선택지: paving·dapo·dc14·celadon), select(id), tour: { go(i, instant), next(), prev() }, info() }
//   ·  window.__ready = true (첫 화면을 그린 뒤)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import spec from './data/spec.js';
import { createMaterials } from './core/materials.js';
import { createEnvironment, DEFAULT_TIME } from './world/sky.js';
import { createTerrain } from './world/terrain.js';
import { createVegetation } from './world/vegetation.js';
import * as Building from './arch/building.js';
import * as Elements from './arch/elements.js';
import { createLoading, yieldFrame } from './ui/loading.js';
import { createNavigation } from './ui/navigation.js';
import { createSheets } from './ui/sheets.js';
import { createTour } from './ui/tour.js';
import { createInfo } from './ui/info.js';
import { createLabels } from './ui/labels.js';
import { createMinimap } from './ui/minimap.js';
import { createDock } from './ui/dock.js';
import { createAbout, createHelp, ALTERNATIVES } from './ui/about.js';
import { createPicker } from './ui/picking.js';
import { isCoarse, isNarrow, announce, mq, reducedMotion } from './ui/dom.js';

const loading = createLoading();
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get(k) { try { return localStorage.getItem(`manwoldae:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`manwoldae:${k}`, v); } catch { /* 저장 불가 */ } },
};

async function main() {
  const container = document.getElementById('app');
  const uiRoot = document.getElementById('ui');
  const mobile = isCoarse() || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  // ── 화질 ──
  const dpr = window.devicePixelRatio || 1;
  const QUALITY = {
    high: { ratio: Math.min(dpr, 2), shadows: true, map: mobile ? 2048 : 4096 },
    medium: { ratio: Math.min(dpr, 1.5), shadows: true, map: 2048 },
    low: { ratio: Math.min(dpr, 1), shadows: false, map: 1024 },
  };
  let quality = QUALITY[store.get('quality')] ? store.get('quality') : mobile ? 'medium' : 'high';
  let ratioScale = 1, autoLowered = false;

  loading.stage('붓과 먹을 고르는 중…', 0.04);
  await yieldFrame();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(QUALITY[quality].ratio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '만월대 3D 장면');
  renderer.domElement.setAttribute('role', 'img');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.3, 14000);
  // 세로 화면에서도 가로 시야각이 40° 아래로 좁아지지 않게 (세로 시야각 45°~75°)
  const fovFor = (a) => clamp((2 * Math.atan(Math.tan(20 * DEG) / a)) / DEG, 45, 75);
  camera.fov = fovFor(camera.aspect);
  camera.updateProjectionMatrix();
  // 첫 화면: 남남동 하늘에서 승평문부터 송악산까지 중심축을 한눈에 (세로 화면은 조금 더 멀리)
  const HERO = camera.aspect < 0.8
    ? { cam: [80, 170, 380], target: [-20, 0, -50] }
    : { cam: [120, 95, 420], target: [-30, 0, -30] };
  camera.position.set(...HERO.cam);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...HERO.target);
  controls.update();

  const mats = createMaterials(spec.palette);
  const env = createEnvironment(renderer, scene, { spec, camera, shadowMapSize: QUALITY[quality].map });
  env.setShadows({ enabled: QUALITY[quality].shadows, mapSize: QUALITY[quality].map });

  // ── 지형 ──
  loading.stage('송악산 자락과 축대를 다지는 중…', 0.1);
  await yieldFrame();
  const terrain = createTerrain(spec, mats);
  scene.add(terrain.group);
  const heightAt = (x, z) => {
    const y = terrain.heightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  };

  // ── 전각 ──
  const items = new Map();   // id → { id, type, def, object }
  const buildings = new Map();
  const world = new THREE.Group();
  world.name = 'palace';
  scene.add(world);
  const tagPick = (obj, id) => obj.traverse((o) => { if (o.isMesh && !o.userData.pickId) o.userData.pickId = id; });
  const shadowAll = (obj) => obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const makeBuilding = typeof Building.createBuildingLOD === 'function' ? Building.createBuildingLOD : Building.createBuilding;
  const lodOpts = mobile ? { lodDistances: [55, 150] } : {};
  // 복원 선택지(다른 학설): 전돌 뜰 · 다포 · 14세기 단청 · 청자기와
  const alt = { paving: false, dapo: false, dc14: false, celadon: false };
  const buildOne = (def) => {
    const b = makeBuilding(def, mats, { ...lodOpts, dapo: alt.dapo, celadon: alt.celadon, dancheong14: alt.dc14 });
    tagPick(b, def.id);
    shadowAll(b);
    return b;
  };
  const defs = (spec.buildings || []).filter((d) => d && d.id);
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    try {
      const b = buildOne(def);
      world.add(b);
      buildings.set(def.id, b);
      items.set(def.id, { id: def.id, type: 'building', def, object: b });
    } catch (e) {
      console.warn(`[main] 전각 ${def.id} 을(를) 만들지 못했습니다:`, e);
    }
    if (i % 3 === 2 || i === defs.length - 1) {
      loading.stage(`전각을 세우는 중… ${i + 1} / ${defs.length}`, 0.22 + 0.42 * ((i + 1) / defs.length));
      await yieldFrame();
    }
  }

  // ── 계단·다리·회랑·담장·유적 ──
  loading.stage('계단과 회랑, 담장을 잇는 중…', 0.66);
  await yieldFrame();
  const ctx = { buildings: spec.buildings || [], terraces: spec.terraces || [], corridors: spec.corridors || [], stairs: spec.stairs || [] };
  const safe = (fn, label) => { try { return fn(); } catch (e) { console.warn(`[main] ${label}:`, e); return null; } };
  const statics = [];    // 계단·다리·담장 (합쳐도 되는 정적 요소)
  const corridorParts = [];
  const make = (fn, def, label) => {
    if (typeof fn !== 'function') return null;
    const o = safe(() => fn(), `${label} ${def.id}`);
    if (o) shadowAll(o);
    return o;
  };
  for (const def of spec.stairs || []) {
    const o = make(Elements.createStairs && (() => Elements.createStairs(def, mats, heightAt)), def, '계단');
    if (!o) continue;
    tagPick(o, def.id);
    if (def.nameKo) items.set(def.id, { id: def.id, type: 'stairs', def, object: o });
    statics.push(o);
  }
  for (const def of spec.bridges || []) {
    const o = make(Elements.createBridge && (() => Elements.createBridge(def, mats, { streams: spec.terrain?.streams })), def, '다리');
    if (!o) continue;
    tagPick(o, def.id);
    items.set(def.id, { id: def.id, type: 'bridge', def, object: o });
    statics.push(o);
  }
  for (const def of spec.corridors || []) {
    const o = make(Elements.createCorridor && (() => Elements.createCorridor(def, mats, heightAt, ctx)), def, '회랑');
    if (o) corridorParts.push(o);
  }
  await yieldFrame();
  // 궁성·도성 성벽은 자연 지면을 따름 (대지 윗면을 쓰면 관(觀) 기단 같은 높은 축대 위로 벽이 타고 올라감)
  const groundAt = (x, z) => {
    const y = terrain.groundAt?.(x, z);
    return Number.isFinite(y) ? y : heightAt(x, z);
  };
  for (const def of spec.walls || []) {
    const hf = def.kind === 'palace' || def.kind === 'city' ? groundAt : heightAt;
    const o = make(Elements.createWall && (() => Elements.createWall(def, mats, hf, ctx)), def, '담장');
    if (o) statics.push(o);
  }
  // 재질별로 합쳐 그리기 호출을 줄임 (elements.mergeElements 가 있으면). 합친 뒤에는 개별 객체가 없으므로 강조는 생략.
  const corridors = [];
  const canMerge = typeof Elements.mergeElements === 'function';
  const mergeInto = (list, name) => {
    if (!list.length) return null;
    const g = canMerge ? safe(() => Elements.mergeElements(list, name), `${name} 합치기`) : null;
    if (g) {
      for (const it of items.values()) if (list.includes(it.object)) it.object = null;
      world.add(g);
      return [g];
    }
    for (const o of list) world.add(o);
    return list;
  };
  const staticGroups = mergeInto(statics, 'elements-static') || [];
  corridors.push(...(mergeInto(corridorParts, 'corridors') || []));
  for (const def of spec.landmarks || []) {
    const o = make(Elements.createLandmark && (() => Elements.createLandmark(def, mats, heightAt)), def, '유적');
    if (o) { tagPick(o, def.id); world.add(o); }
    items.set(def.id, { id: def.id, type: 'landmark', def, object: o });
  }
  // 폐허 모드: 회랑은 돌 재질만 남기고, 계단·담장에서는 목재·기와(난간·담장 지붕)만 숨김
  const stoneMats = new Set([mats.stone, mats.stoneTop, mats.stoneWeathered, mats.stoneRubble, mats.brick, mats.courtyard]);
  const woodMats = new Set([mats.column, mats.beam, mats.beamPlain, mats.beam14, mats.timber, mats.bracketUnder, mats.lacquer, mats.gilt, mats.goldLeaf,
    mats.woodDark, mats.doorLattice, mats.doorPlank, mats.tileGray, mats.tileCeladon, mats.ridgeGray, mats.ridgeCeladon, mats.eaveTileGray,
    mats.eaveTileCeladon, mats.roofUnder, mats.rafterEnd, mats.whiteLine]);
  const staticRuins = (on) => {
    for (const g of staticGroups) {
      g.traverse((o) => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        // 담장 회벽 몸체도 무너져 없어졌다고 보고 화강암 아랫단만 남김
        if (woodMats.has(m) || m === mats.plasterPlain || m === mats.plaster || /wood|trim|tile|lacquer/i.test(m?.name || '')) o.visible = !on;
      });
    }
  };

  // ── 숲 ──
  loading.stage('소나무 숲을 가꾸는 중…', 0.78);
  await yieldFrame();
  const isBlocked = makeBlocker(spec);
  const VEG_DENSITY = { high: 1, medium: 0.55, low: 0.3 };
  let vegDensity = VEG_DENSITY[quality];
  let veg = safe(() => createVegetation(spec, mats, heightAt, isBlocked, { density: vegDensity }), '숲');
  if (veg) scene.add(veg);
  // 화질을 바꾸면 숲 밀도도 다시 (지오메트리만 버림, 재질은 모듈이 캐시)
  function rebuildVegetation(d) {
    if (d === vegDensity) return;
    const next = safe(() => createVegetation(spec, mats, heightAt, isBlocked, { density: d }), '숲');
    if (!next) return;
    if (veg) {
      scene.remove(veg);
      veg.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); if (o.isInstancedMesh) o.dispose?.(); });
    }
    veg = next;
    vegDensity = d;
    scene.add(veg);
  }

  // ── UI ──
  loading.stage('빛과 그림자를 맞추는 중…', 0.9);
  await yieldFrame();
  const sheets = createSheets(uiRoot);
  const nav = createNavigation({ camera, controls, dom: renderer.domElement, terrain, spec, joystickRoot: uiRoot });

  let frames = 2;
  const invalidate = (n = 1) => { frames = Math.max(frames, n); };
  controls.addEventListener('change', () => invalidate());

  const names = (id) => items.get(id)?.def?.nameKo || '';
  const info = createInfo({
    items, sheets,
    onFocus: (it) => focusItem(it),
    onChange: () => { invalidate(); syncDock(); },
  });
  const tour = createTour({ spec, nav, sheets, onOpenChange: () => syncDock() });
  const about = createAbout({ spec, sheets, onSelect: (id) => { selectAndFocus(id); }, onOpenChange: () => syncDock(), onAlt: (id, on) => setAlt(id, on) });
  const help = createHelp({ sheets, onOpenChange: () => syncDock(), touch: mobile });
  const labelRoot = document.getElementById('labels');
  const labels = createLabels({ spec, camera, root: labelRoot, heightAt, items, onPick: (id) => selectAndFocus(id, false) });
  const minimap = createMinimap({ spec, root: uiRoot, heightAt, northOffsetDeg: env.northOffsetDeg, onPick: (x, z) => goToPoint(x, z) });
  const picker = createPicker({
    camera, dom: renderer.domElement, heightAt, tooltipRoot: uiRoot, names,
    roots: () => world.children,
    resolve: typeof Elements.pickIdAt === 'function' ? (hit) => (hit.object.userData.pickRanges ? Elements.pickIdAt(hit.object, hit.faceIndex) : null) : null,
    enabled: () => !nav.flying,
    onPick: (id) => { if (id) info.select(id); else if (info.current && !nav.walking) info.clear(); },
  });

  // 상태 알림 (시간대 바뀜·유적·걷기 안내)
  const toast = document.getElementById('toast');
  let toastTimer = 0;
  function showToast(html, ms = 3200) {
    if (!toast) return;
    toast.innerHTML = html;
    toast.hidden = false;
    toast.classList.remove('out');
    clearTimeout(toastTimer);
    if (ms > 0) toastTimer = setTimeout(() => { toast.classList.add('out'); setTimeout(() => { toast.hidden = true; }, 400); }, ms);
  }
  const ruinsNote = document.getElementById('ruins-note');

  // ── 상태 ──
  const state = { time: DEFAULT_TIME, ruins: false, labels: store.get('labels') !== '0', walk: false, map: !isNarrow() && store.get('map') !== '0' };

  function setTime(name, instant = false) {
    if (!env.presets.some((p) => p.name === name)) return env.current;
    env.setTime(name, { instant });
    state.time = name;
    const p = env.presets.find((q) => q.name === name);
    showToast(`<b>${p.name}</b><span>${p.subtitle}</span>`);
    announce(`시간대: ${p.name}`);
    invalidate(2);
    syncDock();
    return name;
  }
  function setRuins(on) {
    state.ruins = !!on;
    for (const b of buildings.values()) b.traverse((o) => { if (o.name === 'superstructure') o.visible = !state.ruins; });
    for (const c of corridors) corridorRuins(c, state.ruins, stoneMats);
    staticRuins(state.ruins);
    terrain.setRuins?.(state.ruins);
    if (ruinsNote) ruinsNote.hidden = !state.ruins;
    env.invalidateShadows();
    invalidate(2);
    announce(state.ruins ? '유적 보기: 오늘 남은 터만 보입니다' : '복원 보기');
    syncDock();
    return state.ruins;
  }
  // 복원 선택지 바꾸기: 뜰 바닥은 재질만, 공포·단청·기와는 해당 전각만 다시 지음(한 프레임에 몇 채씩)
  let altBusy = false;
  async function setAlt(id, on) {
    if (!(id in alt) || altBusy) return alt[id];
    on = !!on;
    if (alt[id] === on) return on;
    alt[id] = on;
    const done = () => { about.syncAlt?.(alt, false); env.invalidateShadows(); invalidate(2); };
    if (id === 'paving') { terrain.setPaving?.(on); done(); return on; }
    const hit = id === 'dapo' ? (d) => (d.rank ?? 9) <= 2 : id === 'celadon' ? (d) => !!d.celadonOption : () => true;
    const list = defs.filter(hit);
    altBusy = true;
    about.syncAlt?.(alt, true);
    showToast('<b>다시 짓는 중…</b><span>고른 학설에 맞춰 전각을 고칩니다</span>', 0);
    for (let i = 0; i < list.length; i++) {
      const def = list[i];
      const old = buildings.get(def.id);
      let b = null;
      try { b = buildOne(def); } catch (e) { console.warn(`[main] 전각 ${def.id} 다시 짓기 실패:`, e); }
      if (b) {
        if (state.ruins) b.traverse((o) => { if (o.name === 'superstructure') o.visible = false; });
        world.add(b);
        if (old) { world.remove(old); old.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); }); }
        buildings.set(def.id, b);
        const it = items.get(def.id);
        if (it) it.object = b;
      }
      if (i % 3 === 2) { invalidate(); await yieldFrame(); }
    }
    info.refreshHighlight?.();
    altBusy = false;
    const a = ALTERNATIVES.find((q) => q.id === id);
    showToast(`<b>${a ? `${a.title}: ${on ? a.on : a.off}` : '바꿨습니다'}</b><span>${on ? '다른 학설에 따른 모습입니다' : '이 복원의 기본안입니다'}</span>`);
    done();
    return on;
  }
  function setLabels(on) {
    state.labels = !!on;
    labels.setVisible(state.labels);
    store.set('labels', state.labels ? '1' : '0');
    invalidate();
    syncDock();
    return state.labels;
  }
  // 하늘에서 걷기를 켜면: 보던 곳에서 가장 가까운 '걷기 시작점'(마당·문 앞)에 내려 그 전각을 바라봄
  const WALK_SPOTS = [
    [-4, 292, -4, 263], [18, 246, -3.3, 180], [-3, 150, -2.3, 104.4], [8.5, 96, 8.5, 70], [0.8, 50, 0, 0],
    [24, -60, 27.3, -84], [-80, -93, -89, -110], [-95, -205, -103, -221], [33, -168, 33, -195], [97, 172, 97, 125],
  ];
  function setWalk(on) {
    if (on && !nav.walking) {
      const p = camera.position, t = controls.target;
      if (p.y - heightAt(p.x, p.z) > 6) {
        let best = null, bd = Infinity;
        for (const s of WALK_SPOTS) {
          const d = Math.hypot(s[0] - t.x, s[1] - t.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (best && bd < 400) {
          const [x, z, tx, tz] = best;
          const gy = heightAt(x, z);
          nav.lookAt({ x, y: gy + 1.6, z }, { x: tx, y: gy + 1.6, z: tz });
        }
      }
    }
    return nav.setWalk(!!on);
  }
  function setMap(on) {
    state.map = !!on;
    minimap.setVisible(state.map);
    document.body.classList.toggle('map-open', state.map);
    if (state.map) requestAnimationFrame(() => document.body.style.setProperty('--map-h', `${minimap.el.offsetHeight}px`));
    if (!isNarrow()) store.set('map', state.map ? '1' : '0');
    invalidate();
    syncDock();
  }
  nav.onWalkChange((w) => {
    state.walk = w;
    document.body.classList.toggle('walking', w);
    if (w) {
      // 좁은 화면: 조이스틱이 가리지 않도록 패널을 닫음
      if (isNarrow()) { tour.close(); info.clear(); sheets.close('about'); sheets.close('help'); if (state.map) setMap(false); }
      showToast(mobile ? '<b>걷기</b><span>왼쪽 아래 조이스틱으로 걷고, 화면을 끌어 둘러봅니다</span>'
        : '<b>걷기</b><span>W A S D 또는 방향키로 걷고, 끌어서 둘러봅니다 · Shift 달리기 · Esc 나가기</span>', 6000);
      if (tour.autoplay) tour.toggleAutoplay();
    }
    announce(w ? '걷기 모드' : '하늘에서 보기');
    invalidate(2);
    syncDock();
  });

  // 건물·유적으로 날아가기
  const _v = new THREE.Vector3();
  function viewFor(it) {
    const d = it.def || {};
    if (it.type === 'building') {
      const r = (d.rotationDeg || 0) * DEG;
      const fx = -Math.sin(r), fz = Math.cos(r);   // 정면
      const gy = d.groundY ?? heightAt(d.cx, d.cz);
      const ridge = it.object?.userData?.ridgeY ?? gy + 12;
      const size = Math.max(d.platformW || 12, d.platformD || 10);
      const dist = size * 1.15 + 16;
      const side = 0.42; // 3/4 시점
      const cx = d.cx + (fx * Math.cos(side) - fz * Math.sin(side)) * dist;
      const cz = d.cz + (fz * Math.cos(side) + fx * Math.sin(side)) * dist;
      const cy = Math.max(heightAt(cx, cz) + 1.7, gy + (ridge - gy) * 0.55 + dist * 0.18);
      return { cam: { x: cx, y: cy, z: cz }, target: { x: d.cx, y: gy + (ridge - gy) * 0.42, z: d.cz } };
    }
    const x = d.cx ?? d.x, z = d.cz ?? d.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const gy = Number.isFinite(d.y) ? d.y : Number.isFinite(d.deckY) ? d.deckY : heightAt(x, z);
    const far = d.id === 'songak_summit';
    const dist = far ? 420 : it.type === 'stairs' ? Math.max(d.run || 10, d.width || 8) * 1.6 + 14 : 34;
    camera.getWorldDirection(_v);
    _v.y = 0; if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1); _v.normalize();
    const cx = x - _v.x * dist, cz = z - _v.z * dist;
    return { cam: { x: cx, y: Math.max(heightAt(cx, cz) + 2, gy + dist * (far ? 0.35 : 0.45)), z: cz }, target: { x, y: gy + (far ? 0 : 2), z } };
  }
  function focusItem(it) {
    const v = viewFor(it);
    if (v) nav.flyTo(v.cam, v.target);
  }
  function selectAndFocus(id, fly = true) {
    if (!info.select(id)) return;
    if (fly) focusItem(items.get(id));
  }
  function goToPoint(x, z) {
    if (nav.walking) {
      if (!nav.blocked(x, z)) { nav.walkState.x = x; nav.walkState.z = z; nav.walkState.y = heightAt(x, z) + 1.6; invalidate(); }
      return;
    }
    const t = controls.target, p = camera.position;
    const off = _v.copy(p).sub(t);
    const len = clamp(off.length(), 60, 420);
    off.setLength(len);
    const ty = heightAt(x, z) + 1;
    nav.flyTo({ x: x + off.x, y: Math.max(ty + off.y, heightAt(x + off.x, z + off.z) + 3), z: z + off.z }, { x, y: ty, z });
  }

  // ── 도구 막대 ──
  const dock = createDock({
    root: uiRoot, presets: env.presets,
    actions: {
      setTime: (n) => setTime(n),
      toggleRuins: () => setRuins(!state.ruins),
      toggleLabels: () => setLabels(!state.labels),
      toggleWalk: () => setWalk(!nav.walking),
      toggleTour: () => (tour.isOpen ? tour.close() : tour.open()),
      toggleMap: () => setMap(!state.map),
      toggleAbout: () => (sheets.isOpen('about') ? about.close() : about.open()),
      toggleHelp: () => (sheets.isOpen('help') ? help.close() : help.open()),
      setQuality: (q) => setQuality(q),
    },
  });
  function syncDock() {
    dock.sync({
      time: state.time, ruins: state.ruins, labels: state.labels, walk: nav.walking, tour: tour.isOpen, map: state.map,
      about: sheets.isOpen('about'), help: sheets.isOpen('help'), quality, pixelRatio: renderer.getPixelRatio(), auto: autoLowered,
    });
    document.body.classList.toggle('sheet-left-open', sheets.openSides().has('left'));
    document.body.classList.toggle('sheet-right-open', sheets.openSides().has('right'));
  }
  sheets.onChange(() => { syncDock(); measureShift(); });

  // ── 패널에 가리지 않게: 열린 시트만큼 화면 중심을 옮김 (투영 view offset — 이름표·피킹도 그대로 맞음) ──
  const shift = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0 };
  function measureShift() {
    const W = container.clientWidth, H = container.clientHeight;
    let l = 0, r = 0, b = 0;
    for (const el of uiRoot.querySelectorAll('.sheet')) {
      if (el.hidden) continue;
      const rc = el.getBoundingClientRect();
      if (rc.width < 1 || rc.height < 1) continue;
      if (isNarrow()) b = Math.max(b, H - rc.top);
      else if (rc.left + rc.width / 2 < W / 2) l = Math.max(l, rc.right);
      else r = Math.max(r, W - rc.left);
    }
    const tx = clamp((l - r) / 2, -W * 0.22, W * 0.22), ty = clamp(b / 2, 0, H * 0.3);
    if (Math.abs(tx - shift.tx) < 0.5 && Math.abs(ty - shift.ty) < 0.5) return;
    shift.fx = shift.x; shift.fy = shift.y; shift.tx = tx; shift.ty = ty;
    shift.t0 = performance.now();
    invalidate();
  }
  function applyShift() {
    const W = container.clientWidth, H = container.clientHeight;
    if (Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, -shift.x, shift.y, W, H);
  }
  // 시트 크기가 바뀌면(접기·내용 바뀜·전환 끝) 다시 잼
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => measureShift());
    for (const el of uiRoot.querySelectorAll('.sheet')) ro.observe(el);
  }
  function stepShift(now) {
    if (shift.x === shift.tx && shift.y === shift.ty) return false;
    const t = reducedMotion() ? 1 : clamp((now - shift.t0) / 420, 0, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    shift.x = t >= 1 ? shift.tx : shift.fx + (shift.tx - shift.fx) * e;
    shift.y = t >= 1 ? shift.ty : shift.fy + (shift.ty - shift.fy) * e;
    applyShift();
    return true;
  }

  function setQuality(q) {
    if (!QUALITY[q]) return;
    quality = q;
    ratioScale = 1; autoLowered = false;
    store.set('quality', q);
    renderer.setPixelRatio(QUALITY[q].ratio);
    env.setShadows({ enabled: QUALITY[q].shadows, mapSize: QUALITY[q].map });
    rebuildVegetation(VEG_DENSITY[q]);
    invalidate(2);
    syncDock();
  }

  // ── 키보드 ──
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (dock.closePop(true) || sheets.closeTop()) { e.preventDefault(); return; }
      if (nav.walking) { setWalk(false); e.preventDefault(); return; }
      if (info.current) { info.clear(); e.preventDefault(); }
      return;
    }
    const inWidget = e.target?.closest?.('[role="tablist"], [role="radiogroup"]');
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && tour.isOpen && !nav.walking && !inWidget) {
      e.preventDefault();
      if (e.key === 'ArrowRight') tour.next(); else tour.prev();
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const idx = ['1', '2', '3', '4'].indexOf(k);
    if (idx >= 0 && env.presets[idx]) { setTime(env.presets[idx].name); return; }
    switch (k) {
      case 't': tour.isOpen ? tour.close() : tour.open(); break;
      case 'l': setLabels(!state.labels); break;
      case 'r': setRuins(!state.ruins); break;
      case 'g': setWalk(!nav.walking); break;
      case 'm': setMap(!state.map); break;
      case 'i': sheets.isOpen('about') ? about.close() : about.open(); break;
      case 'h': case '?': sheets.isOpen('help') ? help.close() : help.open(); break;
      default: return;
    }
    e.preventDefault();
  });

  // ── 크기 ──
  function onResize() {
    const w = container.clientWidth, hgt = container.clientHeight;
    camera.aspect = w / hgt;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(w, hgt);
    applyShift();
    measureShift();
    minimap.invalidate();
    invalidate(2);
  }
  addEventListener('resize', onResize);
  mq('(max-width: 720px)').addEventListener?.('change', () => { if (isNarrow() && state.map) setMap(false); syncDock(); });

  // ── 적응 화질: 계속 그리는 동안 프레임이 느리면 해상도 배율을 낮춤 ──
  const perf = { acc: 0, n: 0, streak: 0 };
  function samplePerf(dt, continuous) {
    if (!continuous || document.hidden) { perf.streak = 0; return; }
    perf.streak++;
    if (perf.streak < 4) return;
    perf.acc += dt; perf.n++;
    if (perf.n < 45) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    if (avg > 0.045 && ratioScale > 0.55) {
      ratioScale = Math.max(0.55, ratioScale - 0.15);
      renderer.setPixelRatio(Math.max(0.6, QUALITY[quality].ratio * ratioScale));
      autoLowered = true;
      syncDock();
    }
  }

  // ── 그리기 루프 (필요할 때만 그림) ──
  const shadowTarget = new THREE.Vector3();
  let last = performance.now(), labelsBusy = true, lastActive = false, envVersion = -1;
  function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    let active = nav.update(dt);
    if (nav.walking) {
      camera.getWorldDirection(shadowTarget);
      shadowTarget.y = 0;
      shadowTarget.normalize().multiplyScalar(40).add(camera.position);
      shadowTarget.y = heightAt(shadowTarget.x, shadowTarget.z);
    } else shadowTarget.copy(controls.target);
    env.setMoving(active);
    if (env.update(dt, camera, shadowTarget)) active = true;
    if (env.version !== envVersion) { envVersion = env.version; invalidate(); }
    tour.update(dt);
    if (stepShift(now)) active = true;
    if (active) invalidate();
    if (frames > 0) {
      frames--;
      renderer.render(scene, camera);
      samplePerf(dt, active && lastActive);
      labelsBusy = labels.update();
      minimap.update(camera, shadowTarget, env.keyDirection, env.current === '보름달 밤');
    } else if (labelsBusy) {
      labelsBusy = labels.update();
    }
    lastActive = active;
  }

  // ── 테스트·디버그 API ──
  const lookAt = (cam, target) => { nav.lookAt(cam, target); labels.snap(); invalidate(2); };
  window.__app = {
    THREE, scene, camera, controls, renderer, spec, terrain, buildings, env, nav, items, labels,
    lookAt,
    setTime: (name, instant = false) => setTime(name, instant),
    setRuins, setLabels,
    setWalk: (on) => { setWalk(on); invalidate(2); return nav.walking; },
    setQuality,
    setAlt: (id, on) => setAlt(id, on),
    select: (id) => { const ok = info.select(id); invalidate(2); return ok; },
    tour: {
      go: (i, instant = false) => { tour.go(i, instant); if (instant) labels.snap(); invalidate(2); },
      next: () => tour.next(), prev: () => tour.prev(),
    },
    info: () => ({ ...renderer.info.render, pixelRatio: renderer.getPixelRatio(), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };

  // 셰이더 미리 준비 후 첫 화면
  // (병렬 컴파일 확장이 없으면 compileAsync 가 경고만 내고 동기로 돌므로 그냥 compile)
  try {
    if (renderer.extensions.has('KHR_parallel_shader_compile')) {
      await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 4000))]);
    } else renderer.compile(scene, camera);
  } catch { /* 지원하지 않으면 첫 프레임에서 컴파일 */ }
  setLabels(state.labels);
  setMap(state.map);
  syncDock();
  renderer.setAnimationLoop(frame);
  frame();
  loading.stage('다 되었습니다', 1);
  await yieldFrame();
  loading.done();
  document.body.classList.add('ready');
  if (!store.get('visited')) {
    store.set('visited', '1');
    showToast('<b>만월대에 오신 것을 환영합니다</b><span>끌어서 돌려 보고, 전각을 누르면 설명이 나옵니다 · 투어로 둘러보기</span>', 7000);
  }
  await yieldFrame();
  await yieldFrame();
  window.__ready = true;
}

// 회랑의 목조부(지붕·기둥)만 숨김: 이름(superstructure/roof…)이 있으면 이름으로, 없으면 돌 재질이 아닌 메시를 숨김
function corridorRuins(c, on, stoneMats) {
  const wood = /superstructure|roof|column|pillar|post|timber|wood|beam|rafter|tile/i;
  let found = false;
  c.traverse((o) => { if (o !== c && wood.test(o.name || '')) { o.visible = !on; found = true; } });
  if (found) return;
  c.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const stone = stoneMats.has(m) || /granite|stone|석/i.test(m?.name || '');
    if (!stone) o.visible = !on;
  });
}

// 숲이 들어가면 안 되는 곳: 전각 기단(여유 4 m), 회랑, 대지 (32 m 격자로 빠르게)
function makeBlocker(spec) {
  const CELL = 32;
  const grid = new Map();
  const shapes = [];
  const addRect = (cx, cz, w, d, rot, pad) => {
    if (![cx, cz, w, d].every(Number.isFinite)) return;
    const r = (rot || 0) * DEG;
    shapes.push({ type: 'rect', cx, cz, c: Math.cos(r), s: Math.sin(r), hw: w / 2 + pad, hd: d / 2 + pad, R: Math.hypot(w / 2 + pad, d / 2 + pad) });
  };
  for (const b of spec.buildings || []) addRect(b.cx, b.cz, b.platformW, b.platformD, b.rotationDeg, 4);
  for (const t of spec.terraces || []) addRect(t.cx, t.cz, t.w, t.d, t.rotationDeg, 2);
  for (const c of spec.corridors || []) {
    const pts = c.closed ? [...(c.path || []), c.path?.[0]] : c.path || [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i] || [], [bx, bz] = pts[i + 1] || [];
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      const rot = Math.atan2(bz - az, bx - ax) / DEG;
      addRect((ax + bx) / 2, (az + bz) / 2, len, c.width || 5, rot, 3);
    }
  }
  shapes.forEach((s, i) => {
    const i0 = Math.floor((s.cx - s.R) / CELL), i1 = Math.floor((s.cx + s.R) / CELL);
    const j0 = Math.floor((s.cz - s.R) / CELL), j1 = Math.floor((s.cz + s.R) / CELL);
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const key = j * 100000 + k;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  });
  return (x, z) => {
    const list = grid.get(Math.floor(z / CELL) * 100000 + Math.floor(x / CELL));
    if (!list) return false;
    for (const i of list) {
      const s = shapes[i];
      const dx = x - s.cx, dz = z - s.cz;
      const u = dx * s.c + dz * s.s, v = -dx * s.s + dz * s.c;
      if (Math.abs(u) < s.hw && Math.abs(v) < s.hd) return true;
    }
    return false;
  };
}

main().catch((e) => {
  console.error(e);
  loading.error('불러오는 중 문제가 생겼습니다: ' + (e?.message || e));
});
