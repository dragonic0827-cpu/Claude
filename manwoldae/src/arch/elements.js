// 계단·다리·회랑·담장·기념물 — 월드 좌표에 이미 배치된 Object3D 를 돌려줍니다.
//
//   createStairs(def, mats)                      spec.stairs[]    디딤돌·소맷돌·지대석(+ 회경전·건덕전 계단 주칠 목난간)
//   createBridge(def, mats, opts?)               spec.bridges[]   opts.streams(spec.terrain.streams)로 방향·수면 확인
//   createCorridor(def, mats, heightAt, ctx?)    spec.corridors[] ctx = { buildings, terraces, corridors, stairs }
//   createWall(def, mats, heightAt, ctx?)        spec.walls[]     ctx = { buildings } (문 기단에서 끊음)
//   createLandmark(def, mats, heightAt)          spec.landmarks[] userData = { id, nameKo, labelY }
//
//   mergeElements(objects, name?) → Group      (선택) 정적 요소를 재질별 메시 하나로 합침. pickIdAt(mesh, faceIndex)
//
// 메시마다 castShadow/receiveShadow 와 userData.pickId = def.id 가 들어 있습니다.
export { createStairs, createBridge, createLandmark } from './elements-stairs.js';
export { createCorridor } from './elements-corridor.js';
export { createWall } from './elements-wall.js';
export { mergeElements, pickIdAt } from './elements-geo.js';
