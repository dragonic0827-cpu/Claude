// 공유 재질 — 모든 모듈은 이 재질 묶음을 받아 씁니다.
// 색 이름은 spec.palette 의 키를 그대로 씁니다(고증 조사 결과, docs/research.md 참고).
import * as THREE from 'three';
import {
  ashlarTexture, rubbleTexture, roofTileTexture, dancheongBeamTexture, dancheong12Texture, rafterEndTexture,
  lattice, plasterTexture, groundTexture, courtyardTexture,
} from './textures.js';

// spec.palette 가 없을 때 쓰는 기본값 (spec 과 같은 값)
export const DEFAULT_PALETTE = {
  timberRed: '#8C3A2B',        // 석간주(土朱) — 12세기 목부재 전체
  lacquerRed: '#B8322A',       // 주칠(丹漆) — 난간·편액 바탕
  hwangdan: '#D4622B',         // 황단 — 공포·첨차 밑면
  baekbun: '#EFE8D8',          // 백분 — 부재 모서리 흰 선, 용마루 백도
  meok: '#1F1B18',             // 먹
  noerok: '#6B8A62',           // 뇌록 (14세기안)
  yangrok: '#3F8F55',          // 양록 — 문양 녹색
  hayeop: '#3B5534',
  samcheong: '#7FA6C8',
  gunCheong: '#2C4A8A',        // 군청 — 문양 청색
  seokhwang: '#D8A840',        // 석황
  gold: '#C8A245',             // 금박 — 편액 글자
  giltBronze: '#B48A4A',       // 금동 — 문고리·화주
  patinaBronze: '#6E6A45',
  roofTile: '#5A5D5E',         // 회흑색 기와
  roofTileHighlight: '#72767A',
  roofTileShadow: '#3F4244',
  celadonTile: '#8FB8A6',      // 비색 청자기와 (옵션)
  celadonTileShadow: '#6E9887',
  granite: '#A9A59C',          // 개성 화강암 — 축대·기단·계단
  graniteWeathered: '#8E8A82',
  courtyardStone: '#9C978C',   // 중정 박석
  brickGray: '#6F6D69',        // 회색 전돌
  plasterWall: '#E6DFCF',      // 회벽
  earthWall: '#BFA784',
  windowWood: '#8A6A48',
  rammedEarthWall: '#9E8466',  // 판축 성벽
  packedEarth: '#A68B69',      // 다진 흙 마당
  soilRedBrown: '#8B5E45',
  grass: '#7D8B5A',
  pineForest: '#2E4630',
  oakForest: '#4D5E35',
  graniteOutcrop: '#B7B0A3',   // 송악산 암릉
  water: '#4E6E73',
  waterShallow: '#6C8C88',
};

export function createMaterials(palette = {}) {
  const P = { ...DEFAULT_PALETTE, ...palette };
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const dc = { base: P.timberRed, white: P.baekbun, blue: P.gunCheong, green: P.yangrok, yellow: P.seokhwang, ink: P.meok };

  const m = {
    palette: P,
    // ── 석재 ──
    stone: std({ map: ashlarTexture(P.granite), color: 0xffffff, roughness: 0.92 }),          // 축대·기단 옆면 (UV 1 = 4 m × 2 m)
    stoneTop: std({ color: P.granite, roughness: 0.9 }),                                       // 기단 윗면·갑석·계단 디딤판
    stoneWeathered: std({ color: P.graniteWeathered, roughness: 0.95 }),                       // 초석·지대석
    stoneRubble: std({ map: rubbleTexture(P.graniteWeathered), color: 0xffffff, roughness: 0.95 }),
    // ── 목부재 (12세기: 모두 석간주 바탕) ──
    column: std({ color: P.timberRed, roughness: 0.72 }),
    beam: std({ map: dancheong12Texture(dc, { rich: true }), color: 0xffffff, roughness: 0.75 }),   // rank 1–2 창방·평방 (u = 길이 0..1)
    beamPlain: std({ map: dancheong12Texture(dc, { rich: false }), color: 0xffffff, roughness: 0.75 }), // rank 3–4
    beam14: std({ map: dancheongBeamTexture({ green: P.noerok, red: P.lacquerRed, blue: P.gunCheong, yellow: P.seokhwang, white: P.baekbun, black: P.meok }), color: 0xffffff, roughness: 0.75 }), // 14세기안 토글
    timber: std({ color: P.timberRed, roughness: 0.75 }),                                      // 공포·도리·서까래 몸
    bracketUnder: std({ color: P.hwangdan, roughness: 0.75 }),                                  // 공포·첨차 밑면
    whiteLine: std({ color: P.baekbun, roughness: 0.8 }),                                       // 백분 선·백도
    // 서까래·부연 마구리: 12세기 기본은 석간주에 백분 테두리, 14세기안은 녹색 바탕 원문 (단청 토글이 고름)
    rafterEnd: std({ map: rafterEndTexture({ base: P.timberRed, white: P.baekbun }, '12'), color: 0xffffff, roughness: 0.8 }),
    rafterEnd14: std({ map: rafterEndTexture({ green: P.noerok, red: P.lacquerRed, white: P.baekbun, ink: P.meok }, '14'), color: 0xffffff, roughness: 0.8 }),
    lacquer: std({ color: P.lacquerRed, roughness: 0.45 }),                                      // 난간·편액 바탕
    gilt: std({ color: P.giltBronze, roughness: 0.35, metalness: 0.75 }),                       // 금동 장식·화주
    goldLeaf: std({ color: P.gold, roughness: 0.3, metalness: 0.85 }),
    woodDark: std({ color: '#3a2a20', roughness: 0.9 }),
    // ── 벽·창호 ──
    plaster: std({ map: plasterTexture({ plaster: P.plasterWall, line: P.timberRed }), color: 0xffffff, roughness: 0.95 }), // 벽면 한 칸(UV 0..1)
    plasterPlain: std({ color: P.plasterWall, roughness: 0.95 }),
    earthWall: std({ color: P.earthWall, roughness: 1 }),
    doorLattice: std({ map: lattice({ frame: P.timberRed, paper: '#efe7d2' }, 'ttisal'), color: 0xffffff, roughness: 0.9 }), // 창호 한 짝(UV 0..1)
    doorPlank: std({ color: P.timberRed, roughness: 0.8 }),                                     // 판문
    // ── 지붕 ──
    tileGray: std({ map: roofTileTexture(P.roofTile, 3), color: 0xffffff, roughness: 0.78 }),   // UV: 미터/1.2 (u 처마 방향, v 물매 방향)
    tileCeladon: std({ map: roofTileTexture(P.celadonTile, 4), color: 0xffffff, roughness: 0.4, metalness: 0.05 }),
    ridgeGray: std({ color: P.roofTileShadow, roughness: 0.75 }),                                // 용마루·추녀마루 적새
    ridgeCeladon: std({ color: P.celadonTileShadow, roughness: 0.4 }),
    eaveTileGray: std({ color: P.roofTileHighlight, roughness: 0.7 }),                           // 막새 줄
    eaveTileCeladon: std({ color: P.celadonTile, roughness: 0.4 }),
    roofUnder: std({ color: '#8a5a3f', roughness: 0.9, side: THREE.DoubleSide }),               // 처마 밑(서까래 사이 개판)
    // ── 담장·성벽 ──
    rammedEarth: std({ color: P.rammedEarthWall, roughness: 1 }),
    // ── 지면 ──
    grass: std({ map: groundTexture(P.grass, 13, { grass: true }), color: 0xffffff, roughness: 1 }),
    soil: std({ map: groundTexture(P.soilRedBrown, 21, { grass: false }), color: 0xffffff, roughness: 1 }),
    packedEarth: std({ map: groundTexture(P.packedEarth, 23, { grass: false }), color: 0xffffff, roughness: 1 }), // 다진 흙 마당
    courtyard: std({ map: courtyardTexture(P.courtyardStone), color: 0xffffff, roughness: 0.95 }),             // 박석 마당
    brick: std({ color: P.brickGray, roughness: 0.9 }),
    outcrop: std({ color: P.graniteOutcrop, roughness: 0.95 }),
    water: new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.88 }),
    // ── 식생 ──
    pineFoliage: std({ color: P.pineForest, roughness: 0.95 }),
    oakFoliage: std({ color: P.oakForest, roughness: 0.95 }),
    pineTrunk: std({ color: '#7a4a33', roughness: 1 }),
    // ── 선택 표시 ──
    highlight: new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.35, depthWrite: false }),
  };
  return m;
}
