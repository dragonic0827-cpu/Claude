// 만월대 3D — 부트스트랩: 렌더러·카메라·조작·월드 조립
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import spec from './data/spec.js';
import { createMaterials } from './core/materials.js';
import { createEnvironment } from './world/sky.js';
import { createTerrain } from './world/terrain.js';
import { createVegetation } from './world/vegetation.js';
import { createBuilding } from './arch/building.js';
import { createStairs, createCorridor, createWall, createLandmark } from './arch/elements.js';

const status = (msg) => {
  const el = document.getElementById('loading-msg');
  if (el) el.textContent = msg;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  const container = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.5, 8000);
  camera.position.set(60, 90, 420);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 60);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3;
  controls.maxDistance = 2500;

  status('재료를 마련하는 중…');
  await nextFrame();
  const mats = createMaterials(spec.palette);
  const env = createEnvironment(renderer, scene, { spec });

  status('송악산과 축대를 쌓는 중…');
  await nextFrame();
  const terrain = createTerrain(spec, mats);
  scene.add(terrain.group);

  status('전각을 세우는 중…');
  await nextFrame();
  const buildings = new Map();
  for (const def of spec.buildings) {
    const b = createBuilding(def, mats);
    buildings.set(def.id, b);
    scene.add(b);
  }
  for (const def of spec.stairs || []) scene.add(createStairs(def, mats));
  const ctx = { buildings: spec.buildings, terraces: spec.terraces || [] };
  for (const def of spec.corridors || []) scene.add(createCorridor(def, mats, terrain.heightAt, ctx));
  for (const def of spec.walls || []) scene.add(createWall(def, mats, terrain.heightAt, ctx));
  for (const def of spec.landmarks || []) scene.add(createLandmark(def, mats, terrain.heightAt));

  status('소나무를 심는 중…');
  await nextFrame();
  scene.add(createVegetation(spec, mats, terrain.heightAt, () => false));

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update(dt);
    env.update(dt, camera);
    renderer.render(scene, camera);
  });

  const lookAt = (cam, target) => {
    camera.position.set(cam.x, cam.y, cam.z);
    controls.target.set(target.x, target.y, target.z);
    controls.update();
  };
  window.__app = {
    THREE, scene, camera, controls, renderer, spec, terrain, buildings, env,
    lookAt,
    setTime: (name) => env.setTime(name),
    tour: {
      go(i) {
        const s = spec.tour[i];
        lookAt(s.camera, s.target);
      },
    },
  };
  document.getElementById('loading')?.classList.add('done');
  await nextFrame();
  await nextFrame();
  window.__ready = true;
}

main().catch((e) => {
  console.error(e);
  status('불러오는 중 오류가 났어요: ' + e.message);
});
