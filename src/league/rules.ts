// 리그 규정 (2026-10-13 사용자 요청 "게임의 규정이나 규칙마저 바꿀 수 있어?" → "다 넣어줘").
// 기본값은 실제 KBO 규정(각 상수 파일의 출처 메모 참고). 자유 모드에서 AI 게임 마스터가 명분 있는 설득에 따라 바꿀 수 있고(FreeOp 'rule'),
// 바뀐 값은 league.rules에 남아 AI 구단에도 똑같이 적용되고 저장·재현된다. 기본 모드·판타지(AI 보조) 모드에서는 바뀌지 않는다.
// 외국인 포스팅(foreignPosting): KBO 외국인 선수도 해외 구단 요청으로 포스팅할 수 있다. 기본 꺼짐이고 자유 모드에서만 켤 수 있다 (사용자 결정).
import type { LeagueState } from './types';

export interface RuleSet {
  /** 외국인 보유 한도 (아시아쿼터 제외). 없으면 시대별 실제 한도 */
  foreignRegular: number | null;
  /** 아시아쿼터 자리. 없으면 시대별 실제 */
  foreignAsia: number | null;
  /** 신규 외국인 계약 상한 (달러) */
  foreignNewCap: number;
  /** 아시아쿼터 신규 상한 (달러) */
  asiaNewCap: number;
  /** 외국인(아시아쿼터 제외) 총액 상한 (달러) */
  foreignTotalCap: number;
  /** 시즌 중 외국인 교체 횟수 */
  foreignSwaps: number;
  /** 샐러리캡 배율 (1 = 실제, 0 = 폐지) */
  capScale: number;
  /** 샐러리캡 계산 인원 (연봉 상위 N명) */
  capTopN: number;
  /** 캡 초과 제재금 배율 (1 = 실제 50%·100%·150%) */
  capFineScale: number;
  /** 캡 3회 초과 때 1라운드 지명 순서가 밀리는 자리 수 */
  capPickDrop: number;
  /** 트레이드 마감 (월×100 + 일) */
  tradeDeadline: number;
  /** 트레이드 한쪽 선수 수 */
  maxPerSide: number;
  /** 트레이드 한 번의 지명권 수 */
  maxPicksPerTrade: number;
  /** 시즌 중 방출·영입 마감 (월×100 + 일) */
  marketDeadline: number;
  /** 오프시즌 외부 FA 영입 수 */
  maxFaSignings: number;
  /** 비FA 다년 계약 최대 기간 */
  extMaxYears: number;
  /** 소속 선수 정원 */
  orgLimit: number;
  /** 육성선수 수 */
  devLimit: number;
  /** 육성선수 나이 상한 */
  devMaxAge: number;
  /** 포스트시즌 연장 이닝 제한 */
  postseasonMaxInnings: number;
  /** 외국인 포스팅 (1 켬, 0 끔). 자유 모드에서만 작동 */
  foreignPosting: number;
}

export const RULE_DEFAULTS: RuleSet = {
  foreignRegular: null, foreignAsia: null, foreignNewCap: 1_000_000, asiaNewCap: 200_000, foreignTotalCap: 4_000_000, foreignSwaps: 2,
  capScale: 1, capTopN: 40, capFineScale: 1, capPickDrop: 9,
  tradeDeadline: 731, maxPerSide: 4, maxPicksPerTrade: 2, marketDeadline: 815,
  maxFaSignings: 2, extMaxYears: 6, orgLimit: 68, devLimit: 12, devMaxAge: 25, postseasonMaxInnings: 15, foreignPosting: 0,
};

export type RuleKey = keyof RuleSet;

/** AI·화면용: 이름, 값의 범위, 표시 */
export const RULE_DEFS: { key: RuleKey; label: string; min: number; max: number; unit: string }[] = [
  { key: 'foreignRegular', label: '외국인 보유 한도 (아시아쿼터 제외)', min: 0, max: 10, unit: '명' },
  { key: 'foreignAsia', label: '아시아쿼터 자리', min: 0, max: 5, unit: '명' },
  { key: 'foreignNewCap', label: '신규 외국인 계약 상한', min: 100_000, max: 20_000_000, unit: '달러' },
  { key: 'asiaNewCap', label: '아시아쿼터 신규 계약 상한', min: 50_000, max: 5_000_000, unit: '달러' },
  { key: 'foreignTotalCap', label: '외국인 연봉 총액 상한', min: 500_000, max: 100_000_000, unit: '달러' },
  { key: 'foreignSwaps', label: '시즌 중 외국인 교체 횟수', min: 0, max: 10, unit: '번' },
  { key: 'capScale', label: '샐러리캡 배율 (0이면 폐지)', min: 0, max: 5, unit: '배' },
  { key: 'capTopN', label: '샐러리캡 계산 인원 (연봉 상위)', min: 10, max: 80, unit: '명' },
  { key: 'capFineScale', label: '샐러리캡 초과 제재금 배율', min: 0, max: 5, unit: '배' },
  { key: 'capPickDrop', label: '캡 3회 초과 때 지명 순서 강등', min: 0, max: 20, unit: '자리' },
  { key: 'tradeDeadline', label: '트레이드 마감 (월일, 예 731)', min: 401, max: 1031, unit: '' },
  { key: 'maxPerSide', label: '트레이드 한쪽 선수 수', min: 1, max: 10, unit: '명' },
  { key: 'maxPicksPerTrade', label: '트레이드 지명권 수', min: 0, max: 10, unit: '장' },
  { key: 'marketDeadline', label: '시즌 중 방출·영입 마감 (월일, 예 815)', min: 401, max: 1031, unit: '' },
  { key: 'maxFaSignings', label: '오프시즌 외부 FA 영입 수', min: 0, max: 10, unit: '명' },
  { key: 'extMaxYears', label: '비FA 다년 계약 최대 기간', min: 2, max: 10, unit: '년' },
  { key: 'orgLimit', label: '소속 선수 정원', min: 50, max: 90, unit: '명' },
  { key: 'devLimit', label: '육성선수 수', min: 0, max: 30, unit: '명' },
  { key: 'devMaxAge', label: '육성선수 나이 상한', min: 20, max: 35, unit: '세' },
  { key: 'postseasonMaxInnings', label: '포스트시즌 연장 이닝 제한', min: 9, max: 25, unit: '회' },
  { key: 'foreignPosting', label: '외국인 포스팅 (1 켬, 0 끔)', min: 0, max: 1, unit: '' },
];

type RulesHolder = Pick<LeagueState, 'rules'> | null | undefined;

/** 지금 리그의 규정 값 하나 */
export function ruleOf<K extends RuleKey>(league: RulesHolder, key: K): RuleSet[K] {
  const v = league?.rules?.[key];
  return (v === undefined ? RULE_DEFAULTS[key] : v) as RuleSet[K];
}

/** 월일 규정 (731 → 7월 31일) */
export function ruleDate(league: RulesHolder, key: 'tradeDeadline' | 'marketDeadline'): { month: number; date: number } {
  const v = ruleOf(league, key);
  return { month: Math.floor(v / 100), date: v % 100 };
}

/** 값을 범위 안으로 (월일은 달력에 맞게) */
export function clampRule(key: RuleKey, v: number): number {
  const d = RULE_DEFS.find((x) => x.key === key)!;
  let x = Math.max(d.min, Math.min(d.max, v));
  if (key === 'capScale' || key === 'capFineScale') return Math.round(x * 100) / 100;
  x = Math.round(x);
  if (key === 'tradeDeadline' || key === 'marketDeadline') {
    const m = Math.max(4, Math.min(10, Math.floor(x / 100)));
    const days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
    return m * 100 + Math.max(1, Math.min(days, x % 100));
  }
  return x;
}

/** 기본값에서 바뀐 규정 (화면·AI 맥락용) */
export function changedRules(league: RulesHolder): { key: RuleKey; label: string; from: number | null; to: number | null; unit: string }[] {
  return RULE_DEFS.filter((d) => league?.rules?.[d.key] !== undefined && league.rules[d.key] !== RULE_DEFAULTS[d.key])
    .map((d) => ({ key: d.key, label: d.label, from: RULE_DEFAULTS[d.key], to: league!.rules![d.key] as number | null, unit: d.unit }));
}

/** 외국인 포스팅이 켜져 있나 (자유 모드에서만) */
export function foreignPostingOn(league: Pick<LeagueState, 'rules' | 'fantasy'>): boolean {
  return !!league.fantasy?.free && ruleOf(league, 'foreignPosting') === 1;
}
