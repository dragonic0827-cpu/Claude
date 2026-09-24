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
| `src/core/materials.js` | `createMaterials(palette)` → `mats`, `addUnderLift(mat, color, k)`, `UNDER_LIFT` | 모든 공유 재질. 새 재질이 필요하면 여기에 추가. 아주 작은 부재 재질(`gilt`·`goldLeaf`·`rafterEnd`·`rafterEnd14`)은 `userData.noCastShadow = true`. `addUnderLift` 는 황단 정점색(또는 재질 색)인 아래 향한 면에 반구광(하늘·땅 평균)×k 만큼의 빛을 더하는 셰이더 조각(전각 `painted`·회랑 `elements-wood`·`bracketUnder`) |
| `src/arch/building.js` | `createBuilding(def, mats, opts)` → `Group` | 고려 목조건축(기단·초석·배흘림기둥·공포·단청·창호·팔작/우진각/맞배 지붕·치미) |
| | `createBuildingLOD(def, mats, opts)` → `LOD`, `highBuildPending()` | high·medium·low 세 단계(전환에 10 % 되돌림 여유). high 는 카메라가 medium 거리의 1.5배 안에 들어올 때 지음(곧 필요한 것은 60 ms 에 한 채, medium 거리 안은 바로 — 단 한 프레임에 30 ms 를 넘기면 다음 프레임으로 미루고 `highBuildPending()` 이 true) — `lod.userData.ensureHigh()` 로 바로 지을 수도 있고(main 의 쉬는 틈 미리 짓기), 새로 지은 단계는 폐허 모드·선택 강조 상태를 따름. low 는 평균색 정점색 두 메시(`foundation`·`superstructure`) |
| `src/arch/elements.js` | `createStairs(def, mats)`, `createBridge(def, mats)`, `createCorridor(def, mats, heightAt, ctx)`, `createWall(def, mats, heightAt, ctx)`, `createLandmark(def, mats, heightAt)`, `mergeElements(objects, name, opts?)`, `pickIdAt(mesh, faceIndex)` | 계단(소맷돌·답도), 회랑, 궁성 담장, 첨성대 등. `ctx = { buildings, terraces }` — 회랑·담장은 건물(문) 자리에서 끊깁니다. `mergeElements` 는 재질별로 합치고(재질에 `noCastShadow` 면 그림자 없음), `opts = { cell, near, center, grow, minTris }` 면 넓은 것을 공간 칸으로 나눔(아래 “정적 요소 합치기”) |
| `src/world/terrain.js` | `createTerrain(spec, mats)` → `{ group, heightAt(x,z), groundAt(x,z), setPaving(alt), setRuins(on) }` | 송악산·구릉·하천·연못 지형과 대지(축대). `heightAt` 은 걸을 수 있는 면(대지 윗면 포함). `setRuins` 는 대지 윗면을 풀밭으로 |
| `src/world/vegetation.js` | `createVegetation(spec, mats, heightAt, isBlocked, { density })` → `Group` | 소나무·참나무·버드나무 숲(인스턴싱). 타일(나무 900 m, 덤불·바위 3 km)마다 화면 밖이면 건너뛰고, 480 m 밖 나무는 간단한 모양. 궁궐 가까이 그림자를 드리우는 나무는 260 m 밖에서 보통 모양으로. 타일은 카메라가 20 m 넘게 움직였을 때만 다시 나눔 |
| `src/world/sky.js` | `createEnvironment(renderer, scene, opts)` → `{ setTime(name), update(dt, camera, target), sun, presets, invalidateShadows(), setShadows() }` | 하늘·해/달·안개·조명·그림자, 시간대(아침/한낮/해 질 녘/달밤). 그림자 상자는 보는 곳이 0.15·half 넘게 옮겨 갈 때만 다시 그리고, 환경맵은 같은 PMREM 표적에 다시 굽습니다 |
| `src/ui/*.js` | | 투어, 건물 정보 카드, 이름표, 미니맵, 도움말 |
| `src/main.js` | | 부트스트랩: 렌더러·카메라·조작·월드 조립·UI 연결 |

### 공통 규칙

- **그리기 호출(draw call) 절약**: 건물 하나는 재질별로 지오메트리를 합쳐(`mergeGeometries`) 메시 15개 이하로.
  반복 요소(나무, 회랑 기둥 등)는 `InstancedMesh` 사용.
- 선택(피킹): 건물의 모든 메시에 `userData.pickId = def.id` 를 넣습니다. 그룹에는 `userData = { id, nameKo, kind, ridgeY }`.
- 그림자: 건물·계단·담장은 `castShadow = receiveShadow = true`, 지형은 `receiveShadow` 만. 예외: 전각의 아주 작은 부재(`rafterEnd`·`gilt`·`plaque`)와 low 단계 기단, 그리고 재질에 `userData.noCastShadow` 가 있는 것(금동·금박·서까래 마구리 — 계단 난간 장식처럼 합쳐 그리는 요소 포함)은 드리우지 않음.
- 난수는 `textures.js` 의 `rng(seed)` 를 써서 매번 같은 결과가 나오게 합니다(`Math.random` 금지).

## 테스트 페이지와 도구

- `node tools/serve.mjs` → <http://localhost:5173/> (ES 모듈은 `file://` 로 열 수 없습니다)
- `dev/*.html` — 모듈별 확인 페이지. 준비가 끝나면 `window.__ready = true`.
- `node tools/shoot.mjs <페이지> --shot a.png` — 헤드리스 Chromium(WebGL)으로 스크린샷을 찍고
  콘솔 오류가 있으면 실패합니다. `--steps '[{"eval":"...","wait":500,"shot":"b.png"}]'` 로 여러 장.
- 메인 앱은 테스트용으로 `window.__app` 을 노출합니다: `tour.go(i, instant)`, `setTime(name, instant)`, `lookAt(camera, target)`,
  `setRuins(on)`, `setWalk(on)`, `select(id)`, `setAlt(id, on)`(복원 선택지 `paving`·`dapo`·`dc14`·`celadon`, Promise), `setQuality(level)`, `info()`,
  `prebuild()`(쉬는 틈 high 단계 미리 짓기 진행: `{ queued, done, remaining, built, ms }`).
- `--mobile` 을 붙이면 휴대폰(터치·모바일 UA)으로 흉내 내어 앱의 휴대폰 경로(보통 화질·짧은 LOD 거리·조이스틱)를 점검합니다.

## 통합(main.js)에서 정한 것

- **크기·문맥**: 캔버스 CSS 크기는 `style.css`(100 %)가 정하고 `renderer.setSize(w, h, false)` 로 그리기 버퍼만 맞춥니다.
  `#app` 의 `ResizeObserver` 와 `resize` 를 첫 await 전에 붙여 불러오는 동안의 회전·창 크기·숨김(0×0)도 따라가고,
  화면 배율(dpr)이 바뀌면 해상도 배율을 다시 계산합니다. GL 문맥을 잃었다 되찾으면 환경맵(PMREM)·그림자 맵을 다시 굽고 다시 그립니다.
- **불러오기 감시**: `main.js` 는 첫 문장에서 `window.__boot = true` 를 둡니다. `index.html` 의 인라인 스크립트는 모듈 스크립트의
  `error` 나 25 초 동안 `__boot` 가 없으면 불러오기 화면에 오류를 보입니다(three.js CDN 실패). 문서 언어(`lang="ko"`)도 여기서 다시 둡니다.
- **움직이지 않는 물체**: 지형·전각·합친 요소·숲은 배치 뒤 `freeze()`(행렬 한 번 계산, `matrixAutoUpdate = false`), `scene` 도 고정. 나중에 지어 붙는 전각 high 단계는 붙일 때 `updateMatrixWorld(true)` 를 한 번 부릅니다.
  환경 그룹(해·달·별)과 선택 테두리는 그대로 움직입니다. 전각을 다시 지으면(복원 선택지) 그 전각만 다시 `freeze`.
- **피킹**: 이름표는 `pointer-events` 가 없어 끌기·집기는 장면으로 가고, 누르기는 `labels.hitTest(x, y)` 가 먼저 봅니다.
  `items` 에 없는 id(이름 없는 부재)에 맞으면 광선은 멈추되 고르지도 카드를 닫지도 않습니다. 회랑·담장도 `items`(type `corridor`·`wall`)에 들어 있습니다.
  삼각형이 많은 메시는 128개씩 묶은 상자를 먼저 걸러 검사하고, 마우스 올림은 포인터가 멈추고 장면이 가만할 때만 검사합니다.
  손가락이 둘 이상 닿았던 몸짓과 비행을 끊은 누름은 고르기로 치지 않습니다.
- **시트**: 좁거나(≤720 px) 낮은(≤560 px) 화면은 시트를 하나만 둡니다(`sheets.enforceSingle()` — 휴대폰을 돌렸을 때도).
  걷는 중 휴대폰에서 고른 카드는 접힌 채(`open(id, { min: true })`) 조이스틱 위에 열립니다.
- **정적 요소 묶음**: 계단·다리·궁 안 담장은 `elements-static`, 궁성·도성 성벽은 `walls-outer`(유적 보기에서 숨기고 풀 둔덕 `walls-berm` 을 보임),
  회랑은 대지(일곽)별 `corridors-*`(부모 그룹 `corridors`)로 합칩니다. 휴대폰·낮은 화질은 `ctx.detail = 'low'` 회랑.
  `walls-outer` 는 `{ cell: 1400, near: 1300, center: [0, 0] }` 로 나눠 합침 — 궁궐 1.3 km 안(궁성·황성)은 재질마다 한 덩이(`walls-outer:near`),
  나성은 1.4 km 칸(2.8 km 밖 2.8 km, 5.6 km 밖 5.6 km 칸; 메시 이름 `walls-outer:<단계>_<i>_<j>`). 700 m 칸으로 모두 나누면 한 화면 그리기 호출이 12–17개,
  그림자 패스가 6개 늘어 이렇게 정함(지금은 본 패스 +2–6, 그림자 +0–2, 성벽 삼각형 5.5만 → 2.3만–4.1만).

- **패널만큼 화면 중심 옮기기**: 열린 시트(넓은 화면은 왼쪽·오른쪽, 좁은 화면은 아래)와 펼친 평면도를 재서 `camera.setViewOffset` 으로
  투영 중심을 옮깁니다. 투어 카메라는 이 상태(왼쪽 안내 패널)를 기준으로 잡았고, 넓은 화면에서 투어를 열면 평면도를 잠시 접습니다.
  이름표 투영·피킹은 그대로 맞고, 이름표는 패널·도구 막대·평면도 자리를 비워 둡니다(`labels.invalidateUi()`).
- **걷기 시작점**: 땅에서 6 m 넘게 떠 있을 때 걷기를 켜면, 보던 곳에서 가장 가까운 마당(`WALK_SPOTS`)에 내려 그 전각을 바라봅니다.
- **전각 LOD 와 그림자**: `buildOne` 이 전각마다 `createBuildingLOD` 를 부릅니다. 그림자 설정은 `building.js` 가 메시마다 정하므로 main 에서 덮어쓰지 않습니다
  (서까래 마구리·금동 장식·편액과 먼 단계(low)의 기단은 `castShadow = false` — 창호·판문·포벽은 빛이 새지 않게 드리움). 계단·회랑·담장·지점은
  `shadowAll` 이 드리우게 하되 재질에 `noCastShadow` 가 있으면 뺍니다.
  LOD 단계가 바뀌면 그리기 루프의 `lodSignature()`(단계 번호가 아니라 지금 단계의 `detail` 이름으로 셈 — high 단계가 끼어들어 번호만 밀려도 그대로)가
  달라져 그림자 맵을 다시 그립니다. 렌더 뒤 `Building.highBuildPending()` 이 true 면(한 프레임 30 ms 예산을 넘겨 미룬 high 단계) 한 장 더 그립니다.
- **쉬는 틈 미리 짓기**: `window.__ready` 뒤 `prebuild.start()` — 안내 여행 지점마다 카메라에서 medium 거리 ×1.5 안의 전각(가까운 순),
  이어 1·2등급 전각을 차례로 `lod.userData.ensureHigh()`. `requestIdleCallback`(timeout 300 ms; 없으면 `setTimeout`)마다 **한 채씩**,
  마지막 입력(pointerdown·wheel·keydown·touchstart) 뒤 1.2 초가 지나고 `frames === 0`·비행·조작·복원 선택지 다시 짓기가 없을 때만.
  아니면 쉬었다가 다시 시도하고, `setAlt` 가 전각을 다시 지으면 `hooks.rebuilt` → `prebuild.restart()`.
- **도구 막대(`ui/dock.js`)**: 좁은 화면(≤720 px)에서는 CSS 가 `.in-more`(이름표·도움말·화질) 단추를 숨기고 `.more-toggle`(‘더보기’)을 보입니다.
  ‘더보기’ 는 `aria-haspopup="menu"` 단추 + `role="menu"`(menuitemcheckbox 이름표·도움말, role=group 안 menuitemradio 화질) — 위아래 방향키·Home·End,
  Tab·Esc 로 닫고 초점은 단추로. 펼침 목록이 열리면 `body.dock-pop-open`(좁은 화면에서 알림을 투명하게), 초점이 막대 밖으로 나가면 닫힘.
- **복원 선택지**: 뜰 바닥은 `terrain.setPaving`, 공포·단청·청자기와는 해당 전각만 `createBuildingLOD(def, mats, { dapo, dancheong14, celadon })`
  로 다시 지어 바꿔 끼웁니다(재질은 모듈이 캐시하므로 지오메트리만 버림).
- **정적 요소 합치기**: 계단·다리·담장과 회랑은 `mergeElements` 로 재질별 메시 하나씩. 피킹은 `pickIdAt(mesh, faceIndex)`.
  `opts.cell` 을 주면 xz 경계 상자 반대각이 cell 보다 넓은 재질 메시를 공간 칸으로 나눕니다: 삼각형을 만든 차례(경로 순)대로 칸 크기를 넘지 않는
  구간으로 끊고, 구간을 무게중심이 든 칸에 모음(칸 크기는 `center` 에서 반지름 `grow·cell` 밖마다 두 배, `near` 안은 한 덩이,
  `minTris` 보다 작은 칸은 가까운 칸에 붙임). 칸마다 경계 구·상자와 `pickRanges` 를 새로 계산하므로 frustum culling·피킹이 그대로 맞습니다.
