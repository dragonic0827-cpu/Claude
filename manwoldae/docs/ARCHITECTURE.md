# 코드 구조와 모듈 약속

빌드 도구 없이 브라우저에서 바로 도는 ES 모듈 프로젝트입니다. three.js 는 `index.html` 의 import map 으로
`cdn.jsdelivr.net/npm/three@0.170.0` 에서 불러옵니다.

## 좌표계 (모든 모듈 공통)

- 단위: 미터(m), 각도: 도(°)
- `x` = 동쪽(+), `z` = 남쪽(+), `y` = 위(+). 북쪽은 `-z` 입니다.
- 원점 `(0, 0, 0)` = 회경전 기단 평면의 중심, 회경전 마당(뜰) 지면 높이.
- 원점 기준 PLAN 좌표계는 회경전 중심축에 맞춘 것이라, 진북은 PLAN 에서 서쪽으로 17° 돌아가 있습니다(축 방위 343°).
- `rotationDeg` 는 **시계방향(나침반) +** 입니다 → three.js 에서는 `rotation.y = -rotationDeg·π/180`.
  건물 모델은 **정면이 +z(남쪽)** 을 향하도록 만든 뒤 돌립니다. 정면 방향 = `(-sin r, cos r)`, 로컬 x 축 = `(cos r, sin r)`.
- 계단은 로컬 `-z` 쪽으로 올라갑니다. 오르는 방향 = `(sin r, -cos r)`; 윗변이 `(cx,cz) + ascent·run/2` 에서 위 대지와 만납니다.
- 모든 `create*` 함수는 **월드 좌표에 이미 배치된** `THREE.Object3D` 를 돌려줍니다.

## 데이터

- 명세의 세부 규칙(기둥 비례, 공포, 지붕 물매, 단청, 성벽, 지형 평탄화 등)은 `spec.modelingGuide` 에 있습니다. 구현은 이 규칙을 따릅니다.

- `src/data/spec.js` — 고증 조사를 정리한 장면 명세(`export default {...}`). 형식은 아래 “spec 형식” 참고.
- 사용자에게 보이는 글은 모두 spec 의 한국어 문자열에서 가져옵니다.

## 모듈

| 파일 | 내보내기 | 역할 |
|---|---|---|
| `src/core/textures.js` | `ashlarTexture()` 등 | 캔버스로 그린 절차적 텍스처 |
| `src/core/materials.js` | `createMaterials(palette)` → `mats` | 모든 공유 재질. 새 재질이 필요하면 여기에 추가 |
| `src/arch/building.js` | `createBuilding(def, mats, opts)` → `Group` | 고려 목조건축(기단·초석·배흘림기둥·공포·단청·창호·팔작/우진각/맞배 지붕·치미) |
| `src/arch/elements.js` | `createStairs(def, mats)`, `createBridge(def, mats)`, `createCorridor(def, mats, heightAt, ctx)`, `createWall(def, mats, heightAt, ctx)`, `createLandmark(def, mats, heightAt)` | 계단(소맷돌·답도), 회랑, 궁성 담장, 첨성대 등. `ctx = { buildings, terraces }` — 회랑·담장은 건물(문) 자리에서 끊깁니다 |
| `src/world/terrain.js` | `createTerrain(spec, mats)` → `{ group, heightAt(x,z), groundAt(x,z), setPaving(alt), setRuins(on) }` | 송악산·구릉·하천·연못 지형과 대지(축대). `heightAt` 은 걸을 수 있는 면(대지 윗면 포함). `setRuins` 는 대지 윗면을 풀밭으로 |
| `src/world/vegetation.js` | `createVegetation(spec, mats, heightAt, isBlocked)` → `Group` | 소나무 숲(인스턴싱) |
| `src/world/sky.js` | `createEnvironment(renderer, scene, opts)` → `{ setTime(name), update(dt, camera), sun }` | 하늘·해/달·안개·조명·그림자, 시간대(아침/한낮/노을/달밤) |
| `src/ui/*.js` | | 투어, 건물 정보 카드, 이름표, 미니맵, 도움말 |
| `src/main.js` | | 부트스트랩: 렌더러·카메라·조작·월드 조립·UI 연결 |

### 공통 규칙

- **그리기 호출(draw call) 절약**: 건물 하나는 재질별로 지오메트리를 합쳐(`mergeGeometries`) 메시 15개 이하로.
  반복 요소(나무, 회랑 기둥 등)는 `InstancedMesh` 사용.
- 선택(피킹): 건물의 모든 메시에 `userData.pickId = def.id` 를 넣습니다. 그룹에는 `userData = { id, nameKo, kind, ridgeY }`.
- 그림자: 건물·계단·담장은 `castShadow = receiveShadow = true`, 지형은 `receiveShadow` 만.
- 난수는 `textures.js` 의 `rng(seed)` 를 써서 매번 같은 결과가 나오게 합니다(`Math.random` 금지).

## 테스트 페이지와 도구

- `node tools/serve.mjs` → <http://localhost:5173/> (ES 모듈은 `file://` 로 열 수 없습니다)
- `dev/*.html` — 모듈별 확인 페이지. 준비가 끝나면 `window.__ready = true`.
- `node tools/shoot.mjs <페이지> --shot a.png` — 헤드리스 Chromium(WebGL)으로 스크린샷을 찍고
  콘솔 오류가 있으면 실패합니다. `--steps '[{"eval":"...","wait":500,"shot":"b.png"}]'` 로 여러 장.
- 메인 앱은 테스트용으로 `window.__app` 을 노출합니다: `tour.go(i, instant)`, `setTime(name, instant)`, `lookAt(camera, target)`,
  `setRuins(on)`, `setWalk(on)`, `select(id)`, `setAlt(id, on)`(복원 선택지 `paving`·`dapo`·`dc14`·`celadon`, Promise), `setQuality(level)`, `info()`.
- `--mobile` 을 붙이면 휴대폰(터치·모바일 UA)으로 흉내 내어 앱의 휴대폰 경로(보통 화질·짧은 LOD 거리·조이스틱)를 점검합니다.

## 통합(main.js)에서 정한 것

- **패널만큼 화면 중심 옮기기**: 열린 시트(넓은 화면은 왼쪽·오른쪽, 좁은 화면은 아래)를 재서 `camera.setViewOffset` 으로
  투영 중심을 옮깁니다. 투어 카메라는 이 상태(왼쪽 안내 패널)를 기준으로 잡았습니다. 이름표 투영·피킹은 그대로 맞습니다.
- **걷기 시작점**: 땅에서 6 m 넘게 떠 있을 때 걷기를 켜면, 보던 곳에서 가장 가까운 마당(`WALK_SPOTS`)에 내려 그 전각을 바라봅니다.
- **복원 선택지**: 뜰 바닥은 `terrain.setPaving`, 공포·단청·청자기와는 해당 전각만 `createBuildingLOD(def, mats, { dapo, dancheong14, celadon })`
  로 다시 지어 바꿔 끼웁니다(재질은 모듈이 캐시하므로 지오메트리만 버림).
- **정적 요소 합치기**: 계단·다리·담장과 회랑은 `mergeElements` 로 재질별 메시 하나씩. 피킹은 `pickIdAt(mesh, faceIndex)`.
