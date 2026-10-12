// 판타지 모드 상태 (league.fantasy, docs/fantasy-mode.md). AI가 만든 글과 효과는 조작 기록(GameAction 'ai'·'ai-off')으로 남아
// 재현·불러오기 때 AI를 다시 부르지 않고 그대로 들어간다.

export type FantasyKind = 'article' | 'chat' | 'event' | 'memory';

export interface FantasyEntry {
  year: number;
  /** 정규시즌 일정 색인. 오프시즌이면 -1 */
  day: number;
  kind: FantasyKind;
  title: string;
  text: string;
  /** 대화 상대·글쓴이 (가상 인물) */
  who?: string;
}

export interface FantasyState {
  /** 회귀자: 단장(플레이어)이 원래 역사를 기억한다 (2단계) */
  regressor?: boolean;
  log: FantasyEntry[];
}

export const FANTASY_LOG_MAX = 300;

export function addFantasyEntry(state: FantasyState, e: FantasyEntry): void {
  state.log.push({ ...e });
  if (state.log.length > FANTASY_LOG_MAX) state.log.splice(0, state.log.length - FANTASY_LOG_MAX);
}
