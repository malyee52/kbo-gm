// 숨겨진 특수능력 (2026-10-08 사용자 기획).
//
// - 레전드·프랜차이즈 선수에게 붙는 작은 보정. 화면 어디에도 보이지 않고, AI 단장의 가치 계산에도 들어가지 않으며, 저장 파일에도 남지 않는다.
//   (월드를 만들 때마다 데이터에서 다시 붙인다. src/ui 어디서도 이 모듈을 가져다 쓰지 않는다: tests/traits.test.ts가 검사한다)
// - 데이터: data-src/특수능력.csv → public/data/traits.json. 선수 ID는 해시(traitKey)로만 적어 데이터 파일을 열어 봐도 바로 알 수 없게 한다.
// - 실존 선수에게는 긍정·중립 능력만 둔다 (기획서 7장의 정신: 실존 인물에게 부정적 꼬리표를 붙이지 않는다).
// - 난수를 쓰지 않는다. 확률 배율만 바꾸므로 같은 시드는 같은 결과를 낸다.

import type { SimPlayer } from './types';

export const TRAIT_CODES = ['clutch', 'october', 'escape', 'ironman', 'evergreen', 'stamina', 'homer', 'vsLeft', 'vsRight'] as const;
export type Trait = (typeof TRAIT_CODES)[number];

/** 능력 설명 (문서·데이터 도구용. 화면에는 쓰지 않는다) */
export const TRAIT_INFO: Record<Trait, { label: string; note: string; who: 'bat' | 'pit' | 'both' }> = {
  clutch: { label: '승부사', note: '득점권이거나 7회 이후 2점 차 이내일 때 타격이 좋아진다', who: 'bat' },
  october: { label: '가을 사나이', note: '포스트시즌 경기에서 좋아진다', who: 'both' },
  escape: { label: '위기 탈출', note: '주자가 있을 때 투구가 좋아진다', who: 'pit' },
  ironman: { label: '철인', note: '부상 확률이 낮다', who: 'both' },
  evergreen: { label: '늦게 지는 꽃', note: '31세 이후 노화 하락이 완만하다', who: 'both' },
  stamina: { label: '에이스 체력', note: '한계 투구 수를 넘긴 뒤 피로 누적이 느리다', who: 'pit' },
  homer: { label: '안방 사나이', note: '홈 경기에서 좋아진다', who: 'both' },
  vsLeft: { label: '좌완 킬러', note: '좌투수를 상대로 타격이 좋아진다', who: 'bat' },
  vsRight: { label: '우완 킬러', note: '우투수를 상대로 타격이 좋아진다', who: 'bat' },
};

export interface TraitParams {
  /** 승부사: 득점권·접전 후반에 타자 유리 보정 (타석 비율 배율에 더하는 값, 임시값) */
  clutchEdge: number;
  /** 위기 탈출: 주자가 있을 때 투수 유리 보정 (임시값) */
  escapeEdge: number;
  /** 가을 사나이: 포스트시즌 보정 (임시값) */
  octoberEdge: number;
  /** 안방 사나이: 홈 이점에 더하는 값 (임시값) */
  homerEdge: number;
  /** 좌완·우완 킬러: 그 손 투수를 상대할 때 더하는 값 (임시값) */
  killerEdge: number;
  /** 에이스 체력: 피로 누적 배율 (임시값) */
  fatigueScale: number;
  /** 철인: 부상 확률 배율 (임시값) */
  injuryScale: number;
  /** 늦게 지는 꽃: 31세 이후 노화 하락 배율 (임시값) */
  agingScale: number;
}

export const DEFAULT_TRAIT_PARAMS: TraitParams = {
  clutchEdge: 0.04,
  escapeEdge: 0.04,
  octoberEdge: 0.04,
  homerEdge: 0.015,
  killerEdge: 0.03,
  fatigueScale: 0.5,
  injuryScale: 0.6,
  agingScale: 0.6,
};

/** 타석 상황 (game.ts가 채운다) */
export interface Situation {
  postseason: boolean;
  /** 타자가 홈 팀인가 */
  home: boolean;
  runnersOn: boolean;
  /** 득점권 (2·3루에 주자) */
  scoring: boolean;
  /** 7회 이후 2점 차 이내 */
  late: boolean;
}

export function hasTrait(p: Pick<SimPlayer, 'traits'>, t: Trait): boolean {
  return p.traits?.includes(t) ?? false;
}

/**
 * 타석에서 타자에게 유리한 보정의 합. 투수 능력은 음수로 더한다.
 * game.ts의 edge(좌우 상성 + 홈 이점)에 그대로 더하는 단위다.
 */
export function traitEdge(b: Pick<SimPlayer, 'traits'>, p: Pick<SimPlayer, 'traits' | 'throws'>, sit: Situation, tp: TraitParams): number {
  let e = 0;
  if (b.traits) {
    if (hasTrait(b, 'clutch') && (sit.scoring || sit.late)) e += tp.clutchEdge;
    if (hasTrait(b, 'october') && sit.postseason) e += tp.octoberEdge;
    if (hasTrait(b, 'homer') && sit.home) e += tp.homerEdge;
    if (hasTrait(b, 'vsLeft') && p.throws === 'L') e += tp.killerEdge;
    if (hasTrait(b, 'vsRight') && p.throws === 'R') e += tp.killerEdge;
  }
  if (p.traits) {
    if (hasTrait(p, 'escape') && sit.runnersOn) e -= tp.escapeEdge;
    if (hasTrait(p, 'october') && sit.postseason) e -= tp.octoberEdge;
    if (hasTrait(p, 'homer') && !sit.home) e -= tp.homerEdge;
  }
  return e;
}

/** 투수 피로 누적 배율 */
export function fatigueScale(p: Pick<SimPlayer, 'traits'>, tp: TraitParams): number {
  return hasTrait(p, 'stamina') ? tp.fatigueScale : 1;
}

/** 부상 확률 배율 */
export function injuryScale(p: Pick<SimPlayer, 'traits'>, tp: TraitParams): number {
  return hasTrait(p, 'ironman') ? tp.injuryScale : 1;
}

/** 31세 이후 노화 하락 배율 */
export function agingScale(traits: readonly Trait[] | undefined, tp: TraitParams): number {
  return traits?.includes('evergreen') ? tp.agingScale : 1;
}

/**
 * 데이터 파일의 선수 키: 선수 ID의 FNV-1a 32비트 해시 (소금을 붙인 뒤). tools/build_data.py의 trait_key와 같은 값이어야 한다.
 * 선수 ID가 ASCII라는 전제로 문자 코드를 바이트로 쓴다.
 */
export function traitKey(id: string): string {
  const s = `kbo-gm/traits/${id}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 데이터(traits.json의 traits)에서 그 선수의 능력. 모르는 코드는 버린다. 없으면 undefined */
export function traitsOf(table: Record<string, string[]> | undefined, id: string): Trait[] | undefined {
  if (!table) return undefined;
  const raw = table[traitKey(id)];
  if (!raw?.length) return undefined;
  const out = raw.filter((t): t is Trait => (TRAIT_CODES as readonly string[]).includes(t));
  return out.length ? out : undefined;
}
