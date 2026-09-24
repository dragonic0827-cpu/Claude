// 공유 재질 — 모든 모듈은 이 재질 묶음을 받아 씁니다 (재질을 새로 만들지 말고 여기에 추가하세요).
import * as THREE from 'three';
import {
  ashlarTexture, rubbleTexture, roofTileTexture, dancheongBeamTexture, rafterEndTexture,
  lattice, plasterTexture, groundTexture, courtyardTexture,
} from './textures.js';

// 고려 궁궐 기본 색 (spec.palette 가 있으면 덮어씀)
export const DEFAULT_PALETTE = {
  columnRed: '#8e2b1f',   // 석간주/주칠 기둥
  beamGreen: '#3f7d62',   // 뇌록 가칠
  blue: '#2f5d8c',        // 삼청
  red: '#9b2d20',         // 주홍
  yellow: '#d9a83a',      // 석황
  white: '#ece6d6',       // 백분
  black: '#1f1f1f',       // 먹
  tileGray: '#5a5f63',    // 회색 기와
  tileCeladon: '#7fa89a', // 청자기와 (비색)
  stone: '#aaa498',       // 화강암 장대석
  stoneDark: '#8f8a7f',   // 자연석
  plaster: '#e9e3d3',     // 회벽
  lattice: '#6b2a1f',     // 창호 살
  paper: '#efe7d2',       // 창호지
  grass: '#6f7a45',
  soil: '#9c8a6a',
  courtyard: '#b9a98a',
  pine: '#2e4a2c',
  water: '#4f7383',
};

export function createMaterials(palette = {}) {
  const P = { ...DEFAULT_PALETTE, ...palette };
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });

  const ashlar = ashlarTexture(P.stone);
  const rubble = rubbleTexture(P.stoneDark);
  const tileGrayTex = roofTileTexture(P.tileGray, 3);
  const tileCeladonTex = roofTileTexture(P.tileCeladon, 4);
  const beamTex = dancheongBeamTexture({ green: P.beamGreen, red: P.red, blue: P.blue, yellow: P.yellow, white: P.white, black: P.black });
  const rafterTex = rafterEndTexture({ green: P.beamGreen, red: P.red, blue: P.blue, yellow: P.yellow, white: P.white });

  const m = {
    palette: P,
    // 석재
    stone: std({ map: ashlar, color: 0xffffff, roughness: 0.92 }),           // 축대·기단 벽면 (UV: 1 = 4 m × 2 m)
    stoneTop: std({ color: P.stone, roughness: 0.9 }),                         // 기단 윗면·계단 디딤판
    stoneRubble: std({ map: rubble, color: 0xffffff, roughness: 0.95 }),      // 궁성 담장·자연석 축대
    // 목부재
    column: std({ color: P.columnRed, roughness: 0.7 }),
    beam: std({ map: beamTex, color: 0xffffff, roughness: 0.75 }),           // UV u = 길이 방향 0..1 (양 끝 머리초)
    beamPlain: std({ color: P.beamGreen, roughness: 0.75 }),                  // 뇌록 부재 (공포·서까래 몸)
    bracket: std({ color: P.beamGreen, roughness: 0.75 }),
    bracketAccent: std({ color: P.blue, roughness: 0.75 }),
    rafterEnd: std({ map: rafterTex, color: 0xffffff, roughness: 0.8 }),
    woodRed: std({ color: P.red, roughness: 0.75 }),                          // 문얼굴·난간 등 붉은 부재
    woodDark: std({ color: '#3a2a20', roughness: 0.9 }),
    // 벽·창호
    plaster: std({ map: plasterTexture({ plaster: P.plaster, line: P.red }), color: 0xffffff, roughness: 0.95 }),
    plasterPlain: std({ color: P.plaster, roughness: 0.95 }),
    doorLattice: std({ map: lattice({ frame: P.lattice, paper: P.paper }, 'ttisal'), color: 0xffffff, roughness: 0.9 }),
    doorPlank: std({ color: '#7a2a1c', roughness: 0.8 }),                      // 판문 (궁문)
    // 지붕
    tileGray: std({ map: tileGrayTex, color: 0xffffff, roughness: 0.75 }),   // UV: u 처마 방향(m/1.2), v 물매 방향(m/1.2)
    tileCeladon: std({ map: tileCeladonTex, color: 0xffffff, roughness: 0.45, metalness: 0.05 }),
    ridgeGray: std({ color: shadeHex(P.tileGray, -0.2), roughness: 0.7 }),  // 용마루·내림마루
    ridgeCeladon: std({ color: shadeHex(P.tileCeladon, -0.1), roughness: 0.45 }),
    roofUnder: std({ color: '#b98a5e', roughness: 0.9, side: THREE.DoubleSide }), // 처마 밑 (연등천장 느낌)
    eaveEdge: std({ color: P.white, roughness: 0.8 }),                        // 막새 줄
    // 지면
    grass: std({ map: groundTexture(P.grass, 13, { grass: true }), color: 0xffffff, roughness: 1 }),
    soil: std({ map: groundTexture(P.soil, 21, { grass: false }), color: 0xffffff, roughness: 1 }),
    courtyard: std({ map: courtyardTexture(P.courtyard), color: 0xffffff, roughness: 0.95 }),
    water: new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    // 식생
    pineFoliage: std({ color: P.pine, roughness: 0.95 }),
    pineTrunk: std({ color: '#6b4a35', roughness: 1 }),
    // 강조/선택 표시
    highlight: new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.35, depthWrite: false }),
  };
  return m;
}

function shadeHex(hex, k) {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.lerp(new THREE.Color(0, 0, 0), -k);
  return c;
}
