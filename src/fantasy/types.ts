// 판타지 모드 상태 (league.fantasy, docs/fantasy-mode.md). AI가 만든 글과 효과는 조작 기록(GameAction 'ai'·'ai-off'·'ai-choice')으로 남아
// 재현·불러오기 때 AI를 다시 부르지 않고 그대로 들어간다.
import type { FantasyEffect } from './effects';

export type FantasyKind = 'article' | 'chat' | 'event' | 'memory';

/** 고를 수 있는 길 (대화의 제안, 사건의 선택지) */
export interface FantasyChoice {
  label: string;
  /** 고른 뒤 결과 글 */
  result: string;
  effects: FantasyEffect[];
}

/** AI가 낸 이야기 줄기 변화 */
export interface ArcUpdate {
  title: string;
  summary: string;
  /** 절정 (큰 효과를 쓸 수 있다) */
  climax?: boolean;
  /** 끝났다 */
  done?: boolean;
}

export interface FantasyEntry {
  /** 이야기 기록에 들어갈 때 붙는다 (f1, f2, …). 선택은 이 id로 */
  id?: string;
  year: number;
  /** 정규시즌 일정 색인. 오프시즌이면 -1 */
  day: number;
  kind: FantasyKind;
  title: string;
  text: string;
  /** 대화 상대·글쓴이 (가상 인물) */
  who?: string;
  /** 대화: 단장이 한 말 */
  ask?: string;
  /** 들어갈 때 바로 적용하는 효과 */
  effects?: FantasyEffect[];
  /** 고를 길. 고르면 chosen */
  choices?: FantasyChoice[];
  chosen?: number;
  /** 이야기 줄기 변화 (5단계) */
  arc?: ArcUpdate;
}

export interface FantasyArc {
  title: string;
  summary: string;
  /** 이 줄기에서 지나간 사건 수 */
  beats: number;
  from: { year: number; day: number };
  climax?: boolean;
  done?: boolean;
}

export interface FantasyState {
  /** 회귀자: 단장(플레이어)이 원래 역사를 기억한다 (2단계) */
  regressor?: boolean;
  log: FantasyEntry[];
  /** 다음 id 번호 */
  seq?: number;
  /** 지금 이야기 줄기와 끝난 줄기 (5단계) */
  arc?: FantasyArc;
  pastArcs?: FantasyArc[];
  /** 다음 개막에 입단할 가상 유망주 (5단계 큰 변화) */
  prospects?: Extract<FantasyEffect, { type: 'prospect' }>[];
}

export const FANTASY_LOG_MAX = 300;

export function addFantasyEntry(state: FantasyState, e: FantasyEntry): FantasyEntry {
  state.seq = (state.seq ?? 0) + 1;
  const entry = { ...e, id: `f${state.seq}` };
  state.log.push(entry);
  if (state.log.length > FANTASY_LOG_MAX) state.log.splice(0, state.log.length - FANTASY_LOG_MAX);
  return entry;
}

/** 이야기 줄기 반영 */
export function applyArc(state: FantasyState, u: ArcUpdate, at: { year: number; day: number }): void {
  const cur = state.arc && !state.arc.done ? state.arc : null;
  if (!cur || cur.title !== u.title) {
    if (cur) (state.pastArcs ??= []).push({ ...cur, done: true });
    state.arc = { title: u.title.slice(0, 60), summary: u.summary.slice(0, 400), beats: 1, from: at, ...(u.climax ? { climax: true } : {}) };
  } else {
    cur.summary = u.summary.slice(0, 400);
    cur.beats++;
    if (u.climax) cur.climax = true;
  }
  if (u.done && state.arc) {
    state.arc.done = true;
    (state.pastArcs ??= []).push({ ...state.arc });
    state.arc = undefined;
  }
}

/** 답을 기다리는 사건 (고르지 않은 선택지가 있는 글) */
export function pendingChoices(state: FantasyState | null | undefined): FantasyEntry[] {
  return (state?.log ?? []).filter((e) => e.choices?.length && e.chosen === undefined);
}
