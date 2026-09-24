// 만월대 3D — 부트스트랩: 렌더러·카메라·조작·월드 조립·UI 연결
//
// 장면은 필요할 때만 그립니다(조작·비행·걷기·시간대 전환·이름표 흐림이 있을 때). 그림자 맵도 빛·상자가 바뀔 때만 갱신(sky.js).
// 테스트 API: window.__app = { THREE, scene, camera, controls, renderer, spec, terrain, buildings, env, nav, items, labels,
//   lookAt(cam, target), setTime(name, instant?), setRuins(bool), setWalk(bool), setLabels(bool), setQuality('high'|'medium'|'low'),
//   setAlt(id, on) → Promise (복원 선택지: paving·dapo·dc14·celadon), select(id), tour: { go(i, instant), next(), prev() }, info() }
//   ·  window.__ready = true (첫 화면을 그린 뒤) · window.__boot = true (모듈을 모두 불러와 실행을 시작함 — index.html 감시용)
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
import { isCoarse, isNarrow, isCompact, announce, mq, reducedMotion } from './ui/dom.js';

window.__boot = true;   // 모듈 그래프(three 포함)를 불러왔음 — 못 불러오면 index.html 의 감시가 오류를 보임

const loading = createLoading();
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get(k) { try { return localStorage.getItem(`manwoldae:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`manwoldae:${k}`, v); } catch { /* 저장 불가 */ } },
};
// 투어 지점 → 이름표를 먼저 세울 대상 (지점 id 가 곧 전각 id 가 아닌 곳)
const TOUR_FOCUS = { gujeong: 'sinbongmun', daegye: 'hoegyeongjeonmun', songak: 'songak_summit' };

async function main() {
  const container = document.getElementById('app');
  const uiRoot = document.getElementById('ui');
  const mobile = isCoarse() || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  // ── 화질 (해상도 배율은 그때그때의 devicePixelRatio 로 — 창을 다른 화면으로 옮겨도 맞게) ──
  const QUALITY = {
    high: { cap: 2, shadows: true, map: mobile ? 2048 : 4096 },
    medium: { cap: 1.5, shadows: true, map: 2048 },
    low: { cap: 1, shadows: false, map: 1024 },
  };
  const ratioFor = (q) => Math.min(window.devicePixelRatio || 1, QUALITY[q].cap);
  let quality = QUALITY[store.get('quality')] ? store.get('quality') : mobile ? 'medium' : 'high';
  let ratioScale = 1, autoLowered = false, autoMap = 0;
  const pixelRatio = () => Math.max(0.6, ratioFor(quality) * ratioScale);

  loading.stage('붓과 먹을 고르는 중…', 0.04);
  await yieldFrame();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(pixelRatio());
  // 캔버스 CSS 크기는 style.css(100 %)가 정하고, 여기서는 그리기 버퍼만 (인라인 px 크기를 쓰지 않음)
  const W0 = container.clientWidth || innerWidth || 1280, H0 = container.clientHeight || innerHeight || 800;
  renderer.setSize(W0, H0, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-roledescription', '3D 장면');
  canvas.setAttribute('aria-label', '만월대 3D 장면: 방향키로 돌려 보고, Shift+방향키로 옮기고, + − 로 가까이·멀리 봅니다');
  canvas.tabIndex = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W0 / H0, 0.3, 14000);
  // 세로 화면에서도 가로 시야각이 40° 아래로 좁아지지 않게 (세로 시야각 45°~75°)
  const fovFor = (a) => clamp((2 * Math.atan(Math.tan(20 * DEG) / a)) / DEG, 45, 75);
  camera.fov = fovFor(camera.aspect);
  camera.updateProjectionMatrix();
  // 첫 화면: 남남동 하늘에서 승평문부터 송악산까지 중심축을 한눈에 (세로 화면은 조금 더 멀리)
  const HERO = camera.aspect < 0.8
    ? { cam: [80, 170, 380], target: [-20, 0, -50] }
    : { cam: [120, 95, 420], target: [-30, 0, -30] };
  camera.position.set(...HERO.cam);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...HERO.target);
  controls.update();

  // ── 그리기 요청 (필요할 때만 그림) ──
  let frames = 2, running = false;
  const invalidate = (n = 1) => { frames = Math.max(frames, n); };
  controls.addEventListener('change', () => invalidate());

  // 상태 알림 (시간대 바뀜·유적·걷기 안내) — 사라지는 두 단계 타이머를 모두 붙잡아 겹쳐 뜬 알림이 곧바로 숨지 않게
  const toast = document.getElementById('toast');
  let toastTimer = 0, toastHide = 0;
  function showToast(html, ms = 3200) {
    if (!toast) return;
    clearTimeout(toastTimer);
    clearTimeout(toastHide);
    toast.innerHTML = html;
    toast.hidden = false;
    toast.classList.remove('out');
    if (ms > 0) toastTimer = setTimeout(() => { toast.classList.add('out'); toastHide = setTimeout(() => { toast.hidden = true; }, 400); }, ms);
  }

  // ── 크기: 불러오는 동안에도 (회전·창 크기·숨겨졌다 보이기) — ResizeObserver + resize ──
  const hooks = { resize: null, restored: null };   // 불러오기가 끝난 뒤 붙는 것(패널 중심 옮기기·평면도·이름표)
  const size = { w: W0, h: H0 };
  function onResize() {
    const w = container.clientWidth, hgt = container.clientHeight;
    if (!w || !hgt) return;   // 숨겨진 동안(0×0)은 그대로 두고, 다시 보이면 맞춤
    if (w !== size.w || hgt !== size.h) {
      size.w = w; size.h = hgt;
      camera.aspect = w / hgt;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
      renderer.setSize(w, hgt, false);
    }
    hooks.resize?.();
    invalidate(2);
    // ResizeObserver 는 그리기 뒤에 불려 캔버스가 비므로 바로 한 장 그림
    if (running) frame();
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => onResize()).observe(container);
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 250));
  onResize();

  // ── 화면 배율(dpr)이 바뀌면(다른 모니터·브라우저 확대) 해상도를 다시 ──
  const watchDpr = () => {
    const m = mq(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    m.addEventListener?.('change', () => {
      renderer.setPixelRatio(pixelRatio());
      hooks.resize?.();
      invalidate(2);
      if (running) syncDock();
      watchDpr();
    }, { once: true });
  };
  watchDpr();

  // ── GL 문맥을 잃었다 되찾으면(휴대폰 백그라운드·메모리 부족): 환경맵·그림자 맵을 다시 굽고 다시 그림 ──
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showToast('<b>그래픽 문맥을 잃었습니다</b><span>잠시 뒤 다시 그립니다. 계속 비어 있으면 새로 고쳐 주세요.</span>', 0);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    env.setTime(env.current, { instant: true });
    env.invalidateShadows();
    hooks.restored?.();
    invalidate(3);
    showToast('<b>다시 그렸습니다</b><span>그래픽 문맥을 되찾았습니다</span>', 2400);
  });

  const mats = createMaterials(spec.palette);
  const env = createEnvironment(renderer, scene, { spec, camera, shadowMapSize: QUALITY[quality].map });
  env.setShadows({ enabled: QUALITY[quality].shadows, mapSize: QUALITY[quality].map });

  // 움직이지 않는 물체는 행렬을 한 번만 계산 (매 프레임 1,600여 개 행렬 다시 짜기를 없앰; 환경 그룹·카메라·선택 테두리는 그대로)
  const freeze = (o) => { o.updateMatrixWorld(true); o.traverse((q) => { q.matrixAutoUpdate = false; }); };
  scene.matrixAutoUpdate = false;

  // ── 지형 ──
  loading.stage('송악산 자락과 축대를 다지는 중…', 0.1);
  await yieldFrame();
  // (createTerrain 이 단계 사이에 양보하는 async 판이어도 그대로 동작: opts.yieldFrame 을 넘기고 await)
  const terrain = await createTerrain(spec, mats, { yieldFrame });
  scene.add(terrain.group);
  freeze(terrain.group);
  const heightAt = (x, z) => {
    const y = terrain.heightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  };
  loading.stage('전각을 세우는 중…', 0.2);
  await yieldFrame();

  // ── 전각 ──
  const items = new Map();   // id → { id, type, def, object, center?, radius? }
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
    // 그림자 설정은 building.js 가 메시마다 정함(작은 부재·먼 단계 기단은 드리우지 않음) — 여기서 덮어쓰지 않음
    return b;
  };
  const defs = (spec.buildings || []).filter((d) => d && d.id);
  let tYield = performance.now();
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
    // 한 번에 오래 붙잡지 않게 0.15 초마다 양보 (불러오기 글이 갱신되게)
    if (performance.now() - tYield > 150 || i === defs.length - 1) {
      loading.stage(`전각을 세우는 중… ${i + 1} / ${defs.length}`, 0.22 + 0.42 * ((i + 1) / defs.length));
      await yieldFrame();
      tYield = performance.now();
    }
  }

  // ── 계단·다리·회랑·담장·지점 ──
  loading.stage('계단과 회랑, 담장을 잇는 중…', 0.66);
  await yieldFrame();
  // 휴대폰·낮은 화질: 서까래·막새 원판 없는 가벼운 회랑 (삼각형 약 45 % 절감)
  const ctx = {
    buildings: spec.buildings || [], terraces: spec.terraces || [], corridors: spec.corridors || [], stairs: spec.stairs || [],
    detail: mobile || quality === 'low' ? 'low' : 'high',
  };
  const safe = (fn, label) => { try { return fn(); } catch (e) { console.warn(`[main] ${label}:`, e); return null; } };
  const statics = [];      // 계단·다리·궁 안 담장 (합쳐도 되는 정적 요소)
  const outerWalls = [];   // 궁성·도성 성벽 (따로 합쳐 유적 보기에서 통째로 낮춤)
  const corridorParts = new Map();   // 대지(일곽)별 회랑 — 따로 합쳐 화면 밖 일곽은 그리지 않게
  const make = (fn, def, label) => {
    if (typeof fn !== 'function') return null;
    const o = safe(() => fn(), `${label} ${def.id}`);
    if (o) shadowAll(o);
    return o;
  };
  // 경로(회랑·담장)의 가운데와 반경: 정보 카드 '가까이 가기'용
  const pathExtent = (path) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of path || []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return Number.isFinite(x0) ? { center: [(x0 + x1) / 2, (z0 + z1) / 2], radius: Math.hypot(x1 - x0, z1 - z0) / 2 } : {};
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
    if (!o) continue;
    const key = def.terraceId === 'link' ? 'janghwa' : def.terraceId || 'etc';
    if (!corridorParts.has(key)) corridorParts.set(key, []);
    corridorParts.get(key).push(o);
    if (def.nameKo) items.set(def.id, { id: def.id, type: 'corridor', def, object: null, ...pathExtent(def.path) });
  }
  await yieldFrame();
  // 궁성·도성 성벽은 자연 지면을 따름 (대지 윗면을 쓰면 관(觀) 기단 같은 높은 축대 위로 벽이 타고 올라감)
  const groundAt = (x, z) => {
    const y = terrain.groundAt?.(x, z);
    return Number.isFinite(y) ? y : heightAt(x, z);
  };
  const outerDefs = [];
  for (const def of spec.walls || []) {
    const outer = def.kind === 'palace' || def.kind === 'city';
    const o = make(Elements.createWall && (() => Elements.createWall(def, mats, outer ? groundAt : heightAt, ctx)), def, '담장');
    if (o) { tagPick(o, def.id); (outer ? outerWalls : statics).push(o); }
    if (outer) outerDefs.push(def);
    if (def.nameKo) items.set(def.id, { id: def.id, type: 'wall', def, object: null, ...(outer ? {} : pathExtent(def.path)) });
  }
  // 재질별로 합쳐 그리기 호출을 줄임 (elements.mergeElements 가 있으면). 합친 뒤에는 개별 객체가 없으므로 강조는 생략.
  const canMerge = typeof Elements.mergeElements === 'function';
  const mergeInto = (list, name, parent = world) => {
    if (!list.length) return [];
    const g = canMerge ? safe(() => Elements.mergeElements(list, name), `${name} 합치기`) : null;
    if (g) {
      for (const it of items.values()) if (list.includes(it.object)) it.object = null;
      parent.add(g);
      return [g];
    }
    for (const o of list) parent.add(o);
    return list;
  };
  const staticGroups = mergeInto(statics, 'elements-static');
  const outerGroups = mergeInto(outerWalls, 'walls-outer');
  const corridorRoot = new THREE.Group();
  corridorRoot.name = 'corridors';
  world.add(corridorRoot);
  for (const [key, list] of corridorParts) mergeInto(list, `corridors-${key}`, corridorRoot);
  const corridors = [corridorRoot];
  for (const def of spec.landmarks || []) {
    const o = make(Elements.createLandmark && (() => Elements.createLandmark(def, mats, heightAt)), def, '지점');
    if (o) { tagPick(o, def.id); world.add(o); }
    items.set(def.id, { id: def.id, type: 'landmark', def, object: o });
  }
  // 폐허 모드: 회랑은 돌 재질만 남기고, 계단·담장에서는 목재·기와(난간·담장 지붕)만 숨김
  const stoneMats = new Set([mats.stone, mats.stoneTop, mats.stoneWeathered, mats.stoneRubble, mats.brick, mats.courtyard]);
  const woodMats = new Set([mats.column, mats.beam, mats.beamPlain, mats.beam14, mats.timber, mats.bracketUnder, mats.lacquer, mats.gilt, mats.goldLeaf,
    mats.woodDark, mats.doorLattice, mats.doorPlank, mats.tileGray, mats.tileCeladon, mats.ridgeGray, mats.ridgeCeladon, mats.eaveTileGray,
    mats.eaveTileCeladon, mats.roofUnder, mats.rafterEnd, mats.rafterEnd14, mats.whiteLine].filter(Boolean));
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
  // 궁성·도성 성벽: 유적 보기에서는 무너져 풀 덮인 낮은 둔덕(약 1 m)만 (처음 켤 때 만듦)
  let berms = null;
  const outerRuins = (on) => {
    if (on && !berms) {
      berms = new THREE.Group();
      berms.name = 'walls-berm';
      for (const def of outerDefs) {
        const m = safe(() => makeBerm(def, groundAt, mats.grass, spec.buildings || []), `둔덕 ${def.id}`);
        if (m) berms.add(m);
      }
      world.add(berms);
      freeze(berms);
    }
    for (const g of outerGroups) g.visible = !on;
    if (berms) berms.visible = on;
  };

  // ── 숲 ──
  loading.stage('소나무 숲을 가꾸는 중…', 0.78);
  await yieldFrame();
  const isBlocked = makeBlocker(spec);
  const VEG_DENSITY = { high: 1, medium: 0.55, low: 0.3 };
  let vegDensity = VEG_DENSITY[quality];
  let veg = safe(() => createVegetation(spec, mats, heightAt, isBlocked, { density: vegDensity }), '숲');
  if (veg) { scene.add(veg); freeze(veg); }
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
    freeze(veg);
    env.invalidateShadows();
  }
  freeze(world);

  // ── UI ──
  loading.stage('빛과 그림자를 맞추는 중…', 0.9);
  await yieldFrame();
  const sheets = createSheets(uiRoot);
  const nav = createNavigation({ camera, controls, dom: canvas, terrain, spec, joystickRoot: uiRoot });

  const names = (id) => items.get(id)?.def?.nameKo || '';
  const info = createInfo({
    items, sheets,
    onFocus: (it) => focusItem(it),
    onChange: () => { invalidate(); syncDock(); },
  });
  const labelRoot = document.getElementById('labels');
  const labels = createLabels({ spec, camera, root: labelRoot, heightAt, items });
  // 넓은 화면에서 투어를 열면 펼친 평면도(오른쪽 아래)가 보는 대상을 가리지 않게 잠시 접고, 닫으면 되돌림
  let mapAutoCollapsed = false;
  const tourMap = (open) => {
    if (open && !isNarrow() && state.map && !minimap.collapsed && container.clientWidth < 1700) {
      minimap.resetTouched();
      minimap.setCollapsed(true);
      mapAutoCollapsed = true;
    } else if (!open && mapAutoCollapsed) {
      if (!minimap.userTouched) minimap.setCollapsed(false);
      mapAutoCollapsed = false;
    }
  };
  const tour = createTour({
    spec, nav, sheets, onOpenChange: (open) => { tourMap(open); syncDock(); },
    onStop: (s) => { labels.setFocus(s ? TOUR_FOCUS[s.id] || s.id : null); invalidate(); },
  });
  // 사용자가 직접 끌기·휠·키로 카메라를 움직이면 자동 재생을 멈춤
  controls.addEventListener('start', () => tour.stopAutoplay());
  const about = createAbout({ spec, sheets, onSelect: (id) => { selectAndFocus(id); }, onOpenChange: () => syncDock(), onAlt: (id, on) => setAlt(id, on) });
  const keysPref = { on: store.get('keys') !== '0', set(on) { keysPref.on = !!on; store.set('keys', on ? '1' : '0'); } };
  const help = createHelp({ sheets, onOpenChange: () => syncDock(), touch: mobile, keys: keysPref });
  const minimap = createMinimap({ spec, root: uiRoot, heightAt, northOffsetDeg: env.northOffsetDeg, onPick: (x, z) => goToPoint(x, z), onChange: () => { invalidate(); labels.invalidateUi(); measureShift(); } });
  const picker = createPicker({
    camera, dom: canvas, heightAt, tooltipRoot: uiRoot, names,
    roots: () => world.children,
    resolve: typeof Elements.pickIdAt === 'function' ? (hit) => (hit.object.userData.pickRanges ? Elements.pickIdAt(hit.object, hit.faceIndex) : null) : null,
    enabled: () => !nav.flying,
    isKnown: (id) => items.has(id),
    hitLabel: (x, y) => (state.labels ? labels.hitTest(x, y) : null),
    onHoverLabel: (id) => labels.setHover(id),
    isIdle: () => frames === 0 && !nav.flying && !nav.interacting,
    // 걷는 중 휴대폰에서는 카드를 접은 채로 열어 조이스틱과 장면을 가리지 않음
    onPick: (id) => {
      if (id) info.select(id, { min: nav.walking && isCompact(), focus: nav.walking ? false : undefined });
      else if (info.current && !nav.walking) info.clear();
    },
  });

  const ruinsNote = document.getElementById('ruins-note');
  let ruinsNoteTimer = 0;

  // ── 상태 ──
  const state = { time: DEFAULT_TIME, ruins: false, labels: store.get('labels') !== '0', walk: false, map: !isNarrow() && store.get('map') !== '0' };

  function setTime(name, instant = false) {
    if (!env.presets.some((p) => p.name === name)) return env.current;
    env.setTime(name, { instant });
    state.time = name;
    const p = env.presets.find((q) => q.name === name);
    showToast(`<b>${p.label || p.name}</b><span>${p.subtitle}</span>`);   // 알림(role=status)이 곧 스크린리더 알림
    invalidate(2);
    syncDock();
    return name;
  }
  function setRuins(on) {
    state.ruins = !!on;
    for (const b of buildings.values()) b.traverse((o) => { if (o.name === 'superstructure') o.visible = !state.ruins; });
    for (const c of corridors) corridorRuins(c, state.ruins, stoneMats);
    staticRuins(state.ruins);
    outerRuins(state.ruins);
    terrain.setRuins?.(state.ruins);
    labels.setRuins(state.ruins);
    // 안내 글은 몇 초만 크게 보이고 작은 표시로 접힘 (보는 대상을 가리지 않게)
    clearTimeout(ruinsNoteTimer);
    if (ruinsNote) {
      ruinsNote.hidden = !state.ruins;
      ruinsNote.classList.remove('chip');
      if (state.ruins) ruinsNoteTimer = setTimeout(() => { ruinsNote.classList.add('chip'); labels.invalidateUi(); invalidate(); }, 6000);
    }
    labels.invalidateUi();
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
        freeze(b);
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
  // [x, z, 바라볼 x, 바라볼 z] — 전각의 지붕까지 한눈에 들어오게 충분히 떨어진 곳
  const WALK_SPOTS = [
    [-4, 292, -4, 263], [18, 246, -3.3, 180], [-3, 150, -2.3, 104.4], [8.5, 96, 8.5, 70], [0.8, 50, 0, 0],
    [24, -60, 27.3, -84], [-66, -89, -89, -110], [-86, -187, -103, -221], [33, -168, 33, -195], [97, 172, 97, 125],
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
          // 시선은 전각 몸체 높이로 조금 올려 봄 (기단 위 약 4 m)
          const ty = Math.max(gy + 1.6, heightAt(tx, tz) + 4);
          nav.lookAt({ x, y: gy + 1.6, z }, { x: tx, y: ty, z: tz });
        }
      }
    }
    return nav.setWalk(!!on);
  }
  function setMap(on) {
    state.map = !!on;
    minimap.setVisible(state.map);
    document.body.classList.toggle('map-open', state.map);
    if (state.map) requestAnimationFrame(() => { document.body.style.setProperty('--map-h', `${minimap.el.offsetHeight}px`); measureShift(); labels.invalidateUi(); });
    if (!isNarrow()) store.set('map', state.map ? '1' : '0');
    labels.invalidateUi();
    measureShift();
    invalidate();
    syncDock();
  }
  nav.onWalkChange((w) => {
    state.walk = w;
    document.body.classList.toggle('walking', w);
    if (w) {
      // 휴대폰(세로·가로)·좁은 화면: 조이스틱이 가리지 않도록 패널을 닫음
      if (isCompact() || mobile) { tour.close(); info.clear(); sheets.close('about'); sheets.close('help'); if (state.map && isNarrow()) setMap(false); }
      showToast(mobile ? '<b>걷기</b><span>왼쪽 아래 조이스틱으로 걷고, 화면을 끌어 둘러봅니다</span>'
        : '<b>걷기</b><span>W A S D 또는 방향키로 걷고, 끌어서 둘러봅니다 · PgUp/PgDn 위아래 · Shift 달리기 · Esc 나가기</span>', 6000);
      tour.stopAutoplay();
    } else announce('하늘에서 보기');
    labels.invalidateUi();
    invalidate(2);
    syncDock();
  });

  // 건물·지점·회랑으로 날아가기
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
    const x = it.center ? it.center[0] : d.cx ?? d.x, z = it.center ? it.center[1] : d.cz ?? d.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const gy = Number.isFinite(d.y) ? d.y : Number.isFinite(d.deckY) ? d.deckY : heightAt(x, z);
    const far = d.id === 'songak_summit';
    const dist = far ? 420 : it.type === 'stairs' ? Math.max(d.run || 10, d.width || 8) * 1.6 + 14 : it.radius ? clamp(it.radius * 1.3 + 12, 34, 220) : 34;
    camera.getWorldDirection(_v);
    _v.y = 0; if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1); _v.normalize();
    const cx = x - _v.x * dist, cz = z - _v.z * dist;
    return { cam: { x: cx, y: Math.max(heightAt(cx, cz) + 2, gy + dist * (far ? 0.35 : 0.45)), z: cz }, target: { x, y: gy + (far ? 0 : 2), z } };
  }
  // 사용자가 고른 비행(정보 카드·목록·평면도)은 자동 재생을 멈춤
  function focusItem(it) {
    const v = it && viewFor(it);
    if (!v) return;
    tour.stopAutoplay();
    nav.flyTo(v.cam, v.target);
  }
  function selectAndFocus(id, fly = true) {
    if (!info.select(id)) return;
    if (fly) focusItem(items.get(id));
  }
  function goToPoint(x, z) {
    tour.stopAutoplay();
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
  // 탭 순서: 도구 막대 → 평면도 (평면도가 DOM 에서 먼저 붙었으므로 뒤로 옮김)
  uiRoot.append(minimap.el);
  function syncDock() {
    dock.sync({
      time: state.time, ruins: state.ruins, labels: state.labels, walk: nav.walking, tour: tour.isOpen, map: state.map,
      about: sheets.isOpen('about'), help: sheets.isOpen('help'), quality, pixelRatio: renderer.getPixelRatio(), auto: autoLowered,
    });
    document.body.classList.toggle('sheet-left-open', sheets.openSides().has('left'));
    document.body.classList.toggle('sheet-right-open', sheets.openSides().has('right'));
  }
  sheets.onChange(() => { syncDock(); measureShift(); labels.invalidateUi(); invalidate(); });

  // ── 패널에 가리지 않게: 열린 시트·펼친 평면도만큼 화면 중심을 옮김 (투영 view offset — 이름표·피킹도 그대로 맞음) ──
  const shift = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0 };
  function measureShift() {
    const W = container.clientWidth, H = container.clientHeight;
    if (!W || !H) return;
    let l = 0, r = 0, b = 0;
    const narrow = isNarrow();
    for (const el of uiRoot.querySelectorAll('.sheet')) {
      if (el.hidden) continue;
      const rc = el.getBoundingClientRect();
      if (rc.width < 1 || rc.height < 1) continue;
      if (narrow) b = Math.max(b, H - rc.top);
      else if (rc.left + rc.width / 2 < W / 2) l = Math.max(l, rc.right);
      else r = Math.max(r, W - rc.left);
    }
    // 넓은 화면: 펼친 평면도(오른쪽 아래)도 오른쪽을 가리는 것으로 셈 — 보는 대상이 패널과 평면도 사이 가운데에 오게
    if (!narrow && state.map && !minimap.collapsed) {
      const rc = minimap.el.getBoundingClientRect();
      if (rc.width > 1 && rc.height > H * 0.25) r = Math.max(r, W - rc.left);
    }
    const tx = clamp((l - r) / 2, -W * 0.22, W * 0.22), ty = clamp(b / 2, 0, H * 0.3);
    if (Math.abs(tx - shift.tx) < 0.5 && Math.abs(ty - shift.ty) < 0.5) return;
    shift.fx = shift.x; shift.fy = shift.y; shift.tx = tx; shift.ty = ty;
    shift.t0 = performance.now();
    invalidate();
  }
  function applyShift() {
    const W = container.clientWidth, H = container.clientHeight;
    if (!W || !H) return;
    if (Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, -shift.x, shift.y, W, H);
  }
  // 시트·평면도 크기가 바뀌면(접기·내용 바뀜·전환 끝) 다시 잼
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { measureShift(); labels.invalidateUi(); });
    for (const el of uiRoot.querySelectorAll('.sheet')) ro.observe(el);
    ro.observe(minimap.el);
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
    ratioScale = 1; autoLowered = false; autoMap = 0;
    store.set('quality', q);
    renderer.setPixelRatio(pixelRatio());
    env.setShadows({ enabled: QUALITY[q].shadows, mapSize: QUALITY[q].map });
    rebuildVegetation(VEG_DENSITY[q]);
    invalidate(2);
    syncDock();
  }

  // ── 키보드 ──
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  const camKey = (o) => { tour.stopAutoplay(); nav.nudge(o); invalidate(2); };
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (dock.closePop(true) || sheets.closeTop()) { e.preventDefault(); return; }
      if (nav.walking) { setWalk(false); e.preventDefault(); return; }
      if (info.current) { info.clear(); e.preventDefault(); }
      return;
    }
    const inWidget = e.target?.closest?.('[role="tablist"], [role="radiogroup"], [role="menu"]');
    const inPanel = e.target?.closest?.('.sheet, .pop, .minimap, [role="radiogroup"], [role="tablist"], [role="menu"]');
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && tour.isOpen && !nav.walking && !inWidget && !e.shiftKey) {
      e.preventDefault();
      if (e.key === 'ArrowRight') tour.next(); else tour.prev();
      return;
    }
    // 카메라: 방향키 돌리기, Shift+방향키 옮기기, PageUp/PageDown(+ −) 가까이·멀리 — 패널 안에서는 패널 스크롤이 먼저
    if (!nav.walking && !inPanel) {
      const s = e.shiftKey;
      const move = {
        ArrowLeft: s ? { pan: [-1, 0] } : { yaw: 4 * DEG }, ArrowRight: s ? { pan: [1, 0] } : { yaw: -4 * DEG },
        ArrowUp: s ? { pan: [0, 1] } : { pitch: -3 * DEG }, ArrowDown: s ? { pan: [0, -1] } : { pitch: 3 * DEG },
        PageUp: { dolly: 0.85 }, PageDown: { dolly: 1 / 0.85 },
      }[e.key];
      if (move) { e.preventDefault(); camKey(move); return; }
    }
    // 한 글자 단축키 (도움말에서 끌 수 있음)
    if (!keysPref.on) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!nav.walking && !inPanel && (k === '+' || k === '=' || k === '-' || k === '_')) {
      e.preventDefault();
      camKey({ dolly: k === '+' || k === '=' ? 0.85 : 1 / 0.85 });
      return;
    }
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

  // ── 크기·배치가 바뀌면 (onResize 에서) ──
  hooks.resize = () => {
    sheets.enforceSingle();
    applyShift();
    measureShift();
    minimap.invalidate();
    labels.invalidateUi();
    labels.snap();
  };
  hooks.restored = () => { minimap.invalidate(); labels.snap(); };
  // 휴대폰을 돌려 좁은(세로) 또는 낮은(가로) 화면이 되면: 시트는 가장 최근 것 하나만, 좁으면 평면도 닫기
  const onLayout = () => {
    sheets.enforceSingle();
    if (isNarrow() && state.map) setMap(false);
    syncDock();
    measureShift();
    labels.invalidateUi();
  };
  mq('(max-width: 720px)').addEventListener?.('change', onLayout);
  mq('(max-height: 560px)').addEventListener?.('change', onLayout);

  // ── 적응 화질: 계속 그리는 동안 프레임이 느리면(33 fps 아래) 해상도를 낮추고, 그래도 느리면 그림자 맵을 줄임. 빠르면 되돌림 ──
  const perf = { acc: 0, n: 0, streak: 0, fast: 0, slow: 0 };
  function samplePerf(dt, continuous) {
    if (!continuous || document.hidden) { perf.streak = 0; return; }
    perf.streak++;
    if (perf.streak < 4) return;
    perf.acc += dt; perf.n++;
    if (perf.n < 45) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    if (avg > 0.03) {
      perf.fast = 0;
      perf.slow++;
      if (ratioScale > 0.55) {
        ratioScale = Math.max(0.55, ratioScale - 0.15);
        renderer.setPixelRatio(pixelRatio());
        autoLowered = true;
      }
      // 두 번째로 느리면 그림자 맵도 한 단계 (4096 → 2048 → 1024)
      if (perf.slow >= 2 && QUALITY[quality].shadows && env.shadowMapSize > 1024) {
        autoMap = env.shadowMapSize / 2;
        env.setShadows({ mapSize: autoMap });
        autoLowered = true;
      }
      syncDock();
    } else if (avg < 0.014 && (ratioScale < 1 || autoMap)) {
      perf.slow = 0;
      if (++perf.fast >= 2) {
        perf.fast = 0;
        if (ratioScale < 1) ratioScale = Math.min(1, ratioScale + 0.15);
        else if (autoMap) { autoMap = autoMap * 2 >= QUALITY[quality].map ? 0 : autoMap * 2; env.setShadows({ mapSize: autoMap || QUALITY[quality].map }); }
        renderer.setPixelRatio(pixelRatio());
        autoLowered = ratioScale < 1 || !!autoMap;
        syncDock();
      }
    } else { perf.fast = 0; }
  }

  // ── 그리기 루프 (필요할 때만 그림) ──
  const shadowTarget = new THREE.Vector3();
  let last = performance.now(), labelsBusy = true, lastActive = false, envVersion = -1, lodSig = -1;
  // 전각 LOD 단계가 바뀌면 그림자 맵도 다시 (그림자는 멈춰 있어도 단계와 맞아야 함)
  const lodSignature = () => {
    let s = 0, k = 1;
    for (const b of buildings.values()) { if (b.isLOD) s += (b.getCurrentLevel() + 1) * k; k = (k * 3) % 99991; }
    return s;
  };
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
      const sig = lodSignature();
      if (sig !== lodSig) { if (lodSig >= 0) { env.invalidateShadows(); invalidate(); } lodSig = sig; }
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
    select: (id) => { const ok = info.select(id, { min: nav.walking && isCompact() }); invalidate(2); return ok; },
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
  running = true;
  onResize();   // 불러오는 동안 바뀐 크기·패널 배치를 한 번 더 맞춤
  renderer.setAnimationLoop(frame);
  frame();
  loading.stage('다 되었습니다', 1);
  await yieldFrame();
  loading.done();
  document.body.classList.add('ready');
  if (!store.get('visited')) {
    store.set('visited', '1');
    showToast('<b>만월대에 오신 것을 환영합니다</b><span>끌어서 돌려 보고, 전각을 누르면 설명이 나옵니다 · 안내 여행으로 둘러보기</span>', 7000);
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

// 무너진 성벽 둔덕: 성벽 선을 따라 폭 (두께 + 3 m), 높이 약 1 m 의 풀 덮인 사다리꼴 단면. 문 기단과 수구 자리는 끊음.
function makeBerm(def, groundAt, material, buildings) {
  const pts = def.closed ? [...(def.path || []), def.path?.[0]] : def.path || [];
  if (pts.length < 2) return null;
  const city = def.kind === 'city';
  const stepLen = city ? 10 : 4;
  const T = def.thickness > 0 ? def.thickness : 3;
  const B = T / 2 + 1.6, top = T * 0.2, H = city ? 1.2 : 1.0;
  const prof = [[-B - 0.4, -0.4], [-B, 0], [-top, H * 0.85], [0, H], [top, H * 0.85], [B, 0], [B + 0.4, -0.4]];
  const gates = buildings.filter((b) => (b.kind === 'gate' || b.kind === 'gatehouse') && b.platformW > 0).map((b) => {
    const r = (b.rotationDeg || 0) * DEG;
    return { cx: b.cx, cz: b.cz, c: Math.cos(r), s: Math.sin(r), hw: b.platformW / 2 + 1, hd: b.platformD / 2 + 1 };
  });
  const inGap = (x, z) => {
    for (const g of gates) {
      const dx = x - g.cx, dz = z - g.cz;
      if (Math.abs(dx * g.c + dz * g.s) < g.hw && Math.abs(-dx * g.s + dz * g.c) < g.hd) return true;
    }
    for (const w of def.waterGates || []) if (Math.hypot(x - w.x, z - w.z) < (w.width || 6) / 2 + 2) return true;
    return false;
  };
  // 경로를 고르게 나눈 점 (점마다 옆 방향)
  const S = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const n = Math.max(1, Math.ceil(len / stepLen));
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let k = 0; k <= n; k++) {
      if (k === 0 && S.length) continue;
      const t = k / n;
      S.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, nx, nz, u: 0 });
    }
  }
  const pos = [], uv = [], idx = [];
  const P = prof.length;
  let run = -1, dist = 0;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (i) dist += Math.hypot(s.x - S[i - 1].x, s.z - S[i - 1].z);
    if (inGap(s.x, s.z)) { run = -1; continue; }
    const base = pos.length / 3;
    for (const [d, y] of prof) {
      const x = s.x + s.nx * d, z = s.z + s.nz * d;
      pos.push(x, groundAt(x, z) + y, z);
      uv.push(dist / 6, d / 6);
    }
    if (run >= 0) {
      for (let j = 0; j < P - 1; j++) {
        const a = run + j, b = run + j + 1, c = base + j, e = base + j + 1;
        idx.push(a, b, c, b, e, c);
      }
    }
    run = base;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.name = `berm-${def.id}`;
  m.receiveShadow = true;
  m.userData.pickId = def.id;
  return m;
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
