// [임시 스텁] 고려 목조건축 생성기 — 곧 실제 구현으로 교체됩니다.
import * as THREE from 'three';

export function createBuilding(def, mats, opts = {}) {
  const g = new THREE.Group();
  const w = def.baysFront * def.bayWidth, d = def.baysSide * def.bayDepth;
  const ph = def.platformHeight ?? 1, ch = def.columnHeight ?? 4;
  const plat = new THREE.Mesh(new THREE.BoxGeometry(w + 3, ph, d + 3), mats.stone);
  plat.position.y = ph / 2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, ch, d), mats.column);
  body.position.y = ph + ch / 2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 2, ch * 0.9, 4), mats.tileGray);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.hypot(w, d) * 1.4, 1, d / Math.hypot(w, d) * 1.4);
  roof.position.y = ph + ch + ch * 0.45;
  for (const m of [plat, body, roof]) { m.castShadow = m.receiveShadow = true; m.userData.pickId = def.id; g.add(m); }
  g.position.set(def.cx, def.groundY ?? 0, def.cz);
  g.rotation.y = THREE.MathUtils.degToRad(def.rotationDeg || 0);
  g.userData = { id: def.id, nameKo: def.nameKo, kind: def.kind, ridgeY: (def.groundY ?? 0) + ph + ch * 1.9 };
  return g;
}
