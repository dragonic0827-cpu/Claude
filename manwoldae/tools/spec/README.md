# 장면 명세 생성기

`src/data/spec.js` 는 이 폴더의 `build_spec.py` 가 만든 `spec.json` 을 JS 모듈로 감싼 것입니다.

- `build_spec.py` — 고증 조사 결과(`docs/research.md`)를 좌표·치수로 옮긴 생성기. 대지·계단·전각·회랑·담장·지형 격자를 만들고 기하 검사를 돌립니다.
- `verify_spec.py` — 겹침, 대지 높이 일치, 계단 연결, 투어 카메라 위치 등을 따로 검사합니다 (`python3 verify_spec.py`, 같은 폴더의 spec.json 을 읽음).
- `dem_util.py` — 지형 고도 보간. 원본 DEM(`env/terr13.npy`, AWS Terrarium z13 타일을 PLAN 좌표로 재표본한 8 MB 격자)은 용량 때문에 저장소에 넣지 않았습니다. 명세에는 이미 10 m / 40 m / 200 m 격자로 표본한 고도가 들어 있습니다.

다시 만들 때: `python3 build_spec.py` → `spec.json` 을 `src/data/spec.js` 로 감싸기(`export default …;`).
