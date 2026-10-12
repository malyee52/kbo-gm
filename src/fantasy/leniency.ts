// AI 판정의 관대함 7단계 (2026-10-13 사용자 요청: "난이도에 따라 AI의 설득 난이도도 쉽게. 완전한 판타지 리그가 가능하도록 순전히 재미를 위한 리그",
// 이어서 "무엇이든이라는 것도 걍 해줘가 아니라 어느 정도 명분이 있어야 해. 난이도를 7단계 정도로").
// 세부 난이도의 "AI 판정"(DifficultySettings.aiLeniency, 0~6)을 따른다. 묶음 기본값: 쉬움 4, 보통 3, 어려움 2.
// 가장 쉬운 단계도 명분 없는 요구("그냥 줘")는 통하지 않는다: 지시문이 명분을 요구하고, 협상 보정도 AI가 명분을 인정했을 때(태도 1 이상)만 더한다.
import type { LeagueState } from '../league/types';
import { settingsOf } from '../league/difficulty';

export type Leniency = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const LENIENCY_LABEL = ['아주 엄격', '엄격', '조금 엄격', '보통', '관대', '아주 관대', '판타지 리그'] as const;

export function leniencyOf(league: Pick<LeagueState, 'settings' | 'difficulty'>): Leniency {
  const v = settingsOf(league).aiLeniency ?? 3;
  return Math.max(0, Math.min(6, Math.round(v))) as Leniency;
}

const RULE: Record<Leniency, string> = {
  0: '상대 구단·인물은 자기 이익을 철저히 지킨다. 숫자로 분명히 이득이고 논리도 탄탄해야 받아들인다. 성공에도 대가가 크다.',
  1: '상대는 자기 이익을 강하게 지킨다. 근거가 약하거나 손해 보는 제안은 거절하고, 성공에는 분명한 대가가 따른다.',
  2: '현실적으로 판정한다. 손해가 작고 논리가 좋으면 받아들이되, 대가를 붙인다.',
  3: '현실성과 재미를 함께 본다. 그럴듯한 논리와 그에 맞는 대가가 있으면 받아들인다.',
  4: '재미를 조금 더 본다. 숫자가 조금 모자라도 설득력 있는 명분이면 받아들이고, 대가는 가볍게.',
  5: '재미를 우선한다. 명분이 그럴듯하면 숫자가 꽤 모자라도 받아들이고, 대담한 행동도 성공하기 쉽다. 대가는 작게.',
  6: '순전히 재미를 위한 판타지 리그다. 그럴듯한 명분(상대 구단·인물의 사정, 이야기의 흐름, 대가나 약속)이 하나라도 있으면 큰일도 이루어진다. 숫자 평가는 크게 신경 쓰지 않는다.',
};

/** 지시문에 넣는 판정 기준 */
export function leniencyRule(l: Leniency): string {
  return `[판정 기준 ${l + 1}/7: ${LENIENCY_LABEL[l]}] ${RULE[l]}
- 어느 단계든 명분이 없는 요구(이유 없이 "그냥 해 줘", 떼쓰기, 협박)는 받아들이지 않는다. 명분이 약하면 조건부·일부만 들어주거나 역제안한다.`;
}

/** 협상 태도 보정 (AI가 낸 −3~+3에 더한다). 올려 주는 보정은 AI가 명분을 인정했을 때(태도 1 이상)만 */
const STANCE_BIAS: Record<Leniency, number> = { 0: -2, 1: -1, 2: -1, 3: 0, 4: 1, 5: 1, 6: 2 };
export function adjustStance(stance: number, l: Leniency): number {
  const b = STANCE_BIAS[l];
  if (b > 0 && stance < 1) return stance;
  return Math.max(-3, Math.min(3, stance + b));
}
/** 협상 효과 배율 (호감 런, 요구액 할인 상한) */
export const NEGOTIATE_SCALE: Record<Leniency, number> = { 0: 0.6, 1: 0.75, 2: 0.9, 3: 1, 4: 1.25, 5: 1.6, 6: 2 };
