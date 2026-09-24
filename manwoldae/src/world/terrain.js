// [임시 스텁] 지형 — 곧 실제 구현으로 교체됩니다.
import * as THREE from 'three';

export function createTerrain(spec, mats) {
  const group = new THREE.Group();
  const heightAt = (x, z) => {
    for (const t of spec.terraces || []) {
      if (Math.abs(x - t.cx) <= t.w / 2 && Math.abs(z - t.cz) <= t.d / 2) return t.topY;
    }
    return (spec.terrain?.groundY ?? -10) + Math.max(0, -z) * 0.02;
  };
  const geo = new THREE.PlaneGeometry(3000, 3000, 100, 100);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) - 0.5);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, mats.grass);
  ground.receiveShadow = true;
  group.add(ground);
  for (const t of spec.terraces || []) {
    const h = t.topY - t.bottomY;
    const m = new THREE.Mesh(new THREE.BoxGeometry(t.w, h, t.d), mats.stone);
    m.position.set(t.cx, t.bottomY + h / 2, t.cz);
    m.rotation.y = THREE.MathUtils.degToRad(t.rotationDeg || 0);
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, heightAt };
}
