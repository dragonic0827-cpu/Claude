// [임시 스텁] 하늘·조명 — 곧 실제 구현으로 교체됩니다.
import * as THREE from 'three';

export function createEnvironment(renderer, scene, opts = {}) {
  scene.background = new THREE.Color('#a9c3d6');
  scene.fog = new THREE.Fog('#a9c3d6', 400, 3000);
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x6b5b45, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
  sun.position.set(200, 300, 150);
  scene.add(sun);
  return { sun, hemi, setTime() {}, update() {} };
}
