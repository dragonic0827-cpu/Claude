// [임시 스텁] 계단·회랑·담장·기념물 — 곧 실제 구현으로 교체됩니다.
import * as THREE from 'three';

export function createStairs(def, mats) {
  const h = def.topY - def.bottomY;
  const m = new THREE.Mesh(new THREE.BoxGeometry(def.width, h, def.run), mats.stoneTop);
  m.position.set(def.cx, def.bottomY + h / 2, def.cz);
  m.rotation.y = THREE.MathUtils.degToRad(def.rotationDeg || 0);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function createCorridor(def, mats) {
  const g = new THREE.Group();
  const pts = def.path.map(([x, z]) => new THREE.Vector3(x, def.groundY ?? 0, z));
  if (def.closed) pts.push(pts[0].clone());
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(def.width, 4, len), mats.plasterPlain);
    m.position.copy(a).lerp(b, 0.5); m.position.y += 2;
    m.lookAt(b.x, m.position.y, b.z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

export function createWall(def, mats, heightAt) {
  const g = new THREE.Group();
  const pts = def.path.map(([x, z]) => new THREE.Vector3(x, 0, z));
  if (def.closed) pts.push(pts[0].clone());
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const mid = a.clone().lerp(b, 0.5);
    const y = def.groundY ?? heightAt(mid.x, mid.z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(def.thickness, def.height, len), mats.stoneRubble);
    m.position.set(mid.x, y + def.height / 2, mid.z);
    m.lookAt(b.x, m.position.y, b.z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

export function createLandmark(def, mats, heightAt) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 8), mats.stone);
  const y = def.y ?? heightAt(def.x, def.z);
  m.position.set(def.x, y + 1.5, def.z);
  m.userData.pickId = def.id;
  return m;
}
