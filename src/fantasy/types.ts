// 판타지 모드 상태 (league.fantasy, docs/fantasy-mode.md). AI가 만든 글과 효과는 조작 기록(GameAction 'ai'·'ai-off'·'ai-choice')으로 남아
// 재현·불러오기 때 AI를 다시 부르지 않고 그대로 들어간다.
import type { FantasyEffect } from './effects';
import type { FreeOp } from './free';
import type { FantasyPromise, PromiseDraft, PromiseSettle } from './promises';

export type FantasyKind = 'article' | 'chat' | 'event' | 'memory' | 'action';

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
  /** 자유 모드 조작 (src/fantasy/free.ts). 들어갈 때 바로 적용 */
  ops?: FreeOp[];
  /** 이 판정에서 생긴 약속 (promises.ts) */
  promises?: PromiseDraft[];
  /** 이 판정이 끝낸 약속 (지킴·어김·없던 일) */
  settles?: PromiseSettle[];
  /** 자유 모드: 받아들이기 전에 다시 판정한 횟수 (하루 한도, ui/screens/GmPreview.tsx) */
  rerolls?: number;
  /** 자유 모드: 단장이 판정을 보고 거둬들인 행동 (조작 없음, 기록만) */
  withdrawn?: boolean;
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
  /** 자유 모드 (AI 진행): AI 게임 마스터가 행동을 판정하고 게임을 바꾼다 (src/fantasy/free.ts) */
  free?: boolean;
  log: FantasyEntry[];
  /** 다음 id 번호 */
  seq?: number;
  /** 지금 이야기 줄기와 끝난 줄기 (5단계) */
  arc?: FantasyArc;
  pastArcs?: FantasyArc[];
  /** 협상으로 생긴 상대 구단 호감 (트레이드, negotiate.ts). 구단마다 하나, 다시 협상하면 바뀐다 */
  goodwill?: { team: number; runs: number; year: number; until: number }[];
  /** 협상으로 생긴 요구액 할인·할증 (선수마다, 그 오프시즌) */
  discounts?: { id: string; pct: number; year: number }[];
  /** 다음 개막에 입단할 가상 유망주 (5단계 큰 변화) */
  prospects?: Extract<FantasyEffect, { type: 'prospect' }>[];
  /** 약속·조건 장부 (자유 모드, promises.ts) */
  promises?: FantasyPromise[];
  pseq?: number;
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

/** 지금 그 구단의 호감 (런). 그 해 until 전까지 */
export function goodwillFor(state: FantasyState | null | undefined, team: number, year: number, day: number): number {
  const g = state?.goodwill?.find((x) => x.team === team && x.year === year && day < x.until);
  return g ? g.runs : 0;
}

/** 그 선수의 요구액 할인 비율 (그 오프시즌, 없으면 0) */
export function discountFor(state: FantasyState | null | undefined, id: string, year: number): number {
  return state?.discounts?.find((x) => x.id === id && x.year === year)?.pct ?? 0;
}

