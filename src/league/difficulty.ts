// 세부 난이도 (2026-10-12 사용자 요청: 스카우팅뿐 아니라 트레이드 난이도·부상 빈도 등을 따로 조정).
// 쉬움·보통·어려움은 아래 값의 묶음이고, "사용자 설정"이면 항목마다 고른다 (league.settings).
// 모두 플레이어 구단에만 걸리는 배율이다 (AI 구단끼리는 지금과 같다). 수치는 임시값.

import type { Difficulty } from './owner';
import type { LeagueState } from './types';

export interface DifficultySettings {
  /** AI 구단의 잠재력 평가 오차 (표준편차, 런). 클수록 AI가 잘못 봐서 쉽다 */
  scoutNoise: number;
  /** AI가 우리 트레이드 제안을 받아들이는 기준(필요 이득)의 배율 */
  tradeStrict: number;
  /** 우리 구단 부상 빈도 배율 */
  injury: number;
  /** FA가 우리 제시를 받아들이는 기준(요구액)의 배율 */
  faDemand: number;
  /** 구단주 신뢰도가 떨어질 때의 배율 */
  ownerPressure: number;
  /** 우리 구단 모기업 지원금·스폰서 배율 */
  income: number;
}

export const PRESETS: Record<Difficulty, DifficultySettings> = {
  easy: { scoutNoise: 12, tradeStrict: 0.6, injury: 0.75, faDemand: 0.92, ownerPressure: 0.7, income: 1.15 },
  normal: { scoutNoise: 6, tradeStrict: 1, injury: 1, faDemand: 1, ownerPressure: 1, income: 1 },
  hard: { scoutNoise: 2, tradeStrict: 1.5, injury: 1.25, faDemand: 1.08, ownerPressure: 1.35, income: 0.9 },
};

/** 화면용: 항목마다 고를 수 있는 값 (쉬움 → 어려움 순) */
export const SETTING_DEFS: { key: keyof DifficultySettings; label: string; note: string; options: { v: number; label: string }[] }[] = [
  { key: 'scoutNoise', label: '스카우팅 (AI 평가 오차)', note: 'AI 구단이 선수 잠재력을 얼마나 잘못 보나. 오차가 크면 드래프트·트레이드에서 숨은 유망주를 건지기 쉽다',
    options: [{ v: 12, label: '±12런 (쉬움)' }, { v: 9, label: '±9런' }, { v: 6, label: '±6런 (보통)' }, { v: 4, label: '±4런' }, { v: 2, label: '±2런 (어려움)' }] },
  { key: 'tradeStrict', label: '트레이드', note: 'AI가 우리 제안을 받아들이려면 얼마나 이득이어야 하나',
    options: [{ v: 0.6, label: '후함 (쉬움)' }, { v: 0.8, label: '조금 후함' }, { v: 1, label: '보통' }, { v: 1.25, label: '조금 깐깐함' }, { v: 1.5, label: '깐깐함 (어려움)' }] },
  { key: 'injury', label: '부상 빈도', note: '우리 구단 선수가 다치는 빈도',
    options: [{ v: 0.5, label: '절반' }, { v: 0.75, label: '적게 (쉬움)' }, { v: 1, label: '보통' }, { v: 1.25, label: '많이 (어려움)' }, { v: 1.5, label: '아주 많이' }] },
  { key: 'faDemand', label: 'FA 요구', note: 'FA가 우리 제시를 받아들이는 금액 기준',
    options: [{ v: 0.92, label: '덜 받아도 됨 (쉬움)' }, { v: 1, label: '보통' }, { v: 1.08, label: '더 요구 (어려움)' }, { v: 1.15, label: '훨씬 더 요구' }] },
  { key: 'ownerPressure', label: '구단주 압박', note: '성적이 나쁠 때 구단주 신뢰도가 떨어지는 정도',
    options: [{ v: 0.5, label: '느긋함' }, { v: 0.7, label: '너그러움 (쉬움)' }, { v: 1, label: '보통' }, { v: 1.35, label: '엄격함 (어려움)' }, { v: 1.7, label: '아주 엄격함' }] },
  { key: 'income', label: '수입', note: '우리 구단의 모기업 지원금·스폰서 수입',
    options: [{ v: 1.3, label: '넉넉함' }, { v: 1.15, label: '조금 넉넉함 (쉬움)' }, { v: 1, label: '보통' }, { v: 0.9, label: '빠듯함 (어려움)' }, { v: 0.8, label: '아주 빠듯함' }] },
];

/** 지금 리그의 세부 난이도 (사용자 설정이 있으면 그것, 없으면 난이도 묶음) */
export function settingsOf(league: Pick<LeagueState, 'settings' | 'difficulty'>): DifficultySettings {
  return league.settings ?? PRESETS[league.difficulty ?? 'normal'];
}

/** 플레이어 구단 색인 (구단주 상태에서) */
export function userTeamOf(league: Pick<LeagueState, 'owner'>): number {
  return league.owner?.team ?? -1;
}

/** 묶음 이름 (사용자 설정이 묶음과 같으면 그 이름) */
export function settingsLabel(league: Pick<LeagueState, 'settings' | 'difficulty'>): string {
  const s = settingsOf(league);
  const same = (Object.keys(PRESETS) as Difficulty[]).find((d) => SETTING_DEFS.every((def) => PRESETS[d][def.key] === s[def.key]));
  return same ? { easy: '쉬움', normal: '보통', hard: '어려움' }[same] : '사용자 설정';
}
