// 구단주 평가와 난이도 (M7, 기획서 8·9·10장): 시즌 목표, 신뢰도, 해고와 영입 제의, 모기업 등급과 예산, 샐러리캡 제재, 업적.
// 근거 자료 없이 정한 값은 "임시값"으로 표시했다. 샐러리캡 제재 비율과 지명권 하락은 자료집 "제도연표" (출처 확인).

import { Rng } from '../engine';
import type { PostseasonResult } from './postseason';
import { capPayroll, salaryCap, PRE_CAP_BUDGET } from './salary';
import type { LeaguePlayer, LeagueState } from './types';

// ---- 난이도

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };
export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  easy: 'AI 구단이 선수 잠재력을 크게 잘못 본다 (오차 약 ±12런)',
  normal: 'AI 구단의 잠재력 평가에 보통 오차 (약 ±6런)',
  hard: 'AI 구단이 잠재력을 거의 정확히 본다 (약 ±2런)',
};
/** AI 잠재력 평가 오차의 표준편차 (런, 임시값). 기획서 10장: 쉬움은 오차가 크고 어려움은 거의 정확 */
export const DIFFICULTY_NOISE: Record<Difficulty, number> = { easy: 12, normal: 6, hard: 2 };

/**
 * AI 구단이 보는 잠재력: 실제 잠재력 + 선수마다 고정된 오차 (게임 시드·선수 id로 정해져 해마다 같다).
 * 플레이어는 실제 잠재력(가상 신인은 스카우트 평가)을 본다.
 */
export function aiPotential(league: Pick<LeagueState, 'seed' | 'difficulty'>, p: Pick<LeaguePlayer, 'id' | 'potential'>): number {
  const sd = DIFFICULTY_NOISE[league.difficulty ?? 'normal'];
  const r = new Rng(`${league.seed}/aipot/${p.id}`);
  // 균등 분포 4개의 합으로 만든 표준정규 근사
  const z = (r.next() + r.next() + r.next() + r.next() - 2) * Math.sqrt(3);
  return p.potential + z * sd;
}

// ---- 모기업 등급과 예산

export type ParentGrade = 'A' | 'B' | 'C';
/**
 * 모기업 등급 (임시값: 실제 구단 지원금 자료가 없어 모기업 규모로 대략 나눴다).
 * 키는 구단 계열 (자료의 franchise). 없는 계열은 B.
 */
export const PARENT_GRADE: Record<string, ParentGrade> = {
  삼성: 'A', LG: 'A', SSG: 'A', 롯데: 'A', KIA: 'A', 한화: 'A',
  두산: 'B', NC: 'B', KT: 'B',
  히어로즈: 'C', 쌍방울: 'C', 현대계: 'B',
};
/** 등급별 예산 배율 (샐러리캡 대비, 임시값) */
export const GRADE_FACTOR: Record<ParentGrade, number> = { A: 1.0, B: 0.92, C: 0.8 };

export function parentGrade(league: LeagueState, team: number): ParentGrade {
  return PARENT_GRADE[league.teams[team].franchise] ?? 'B';
}

/**
 * 연봉 예산 (만 원, 샐러리캡과 같은 대상: 외국인·신인 제외 상위 40명). 샐러리캡이 없는 해는 null.
 * 샐러리캡 × 등급 배율 × 성적 연동 (지난 시즌 상위 3팀 +5%, 하위 3팀 -5%, 임시값). 캡보다 커지지는 않는다.
 */
export function budgetFor(league: LeagueState, team: number, year: number): number | null {
  // 캡 도입 전에도 예산은 있다 (2023년 캡 값 기준, 임시값). 전에는 null이라 2022년 이전 FA 제시에 상한이 없었다 (2026-10-09 QA)
  const cap = salaryCap(year) ?? PRE_CAP_BUDGET;
  let f = GRADE_FACTOR[parentGrade(league, team)];
  const st = league.lastSeason?.standings;
  if (st) {
    const rank = st.indexOf(team) + 1;
    if (rank > 0 && rank <= 3) f += 0.05;
    if (rank > st.length - 3) f -= 0.05;
  }
  return Math.round(cap * Math.min(1, f));
}


/** FA 계약 등 연봉 지출의 상한: 샐러리캡과 예산 중 작은 쪽. 둘 다 없으면 null */
export function spendLimit(league: LeagueState, team: number, year: number): number | null {
  const cap = salaryCap(year);
  const budget = budgetFor(league, team, year);
  if (cap === null) return budget;
  return budget === null ? cap : Math.min(cap, budget);
}

// ---- 샐러리캡 제재 (제도연표, 출처 확인)

/** 연속 초과 횟수별 제재금 비율 (초과분 대비): 1회 50%, 2회 연속 100%, 3회 이상 연속 150% */
export const CAP_FINE_RATE = [0.5, 1.0, 1.5];
/** 2회 이상 연속 초과하면 다음 드래프트 1라운드 지명권이 이만큼 밀린다 */
export const CAP_PICK_DROP = 9;

export interface CapSanction {
  team: number;
  year: number;
  over: number;
  /** 연속 초과 횟수 */
  strike: number;
  fine: number;
  pickDrop: boolean;
}

/**
 * 개막 때 샐러리캡 초과를 판정하고 제재한다 (임시 규칙: 실제로는 시즌 중 연봉 총액 기준인지 확인하지 못해 개막 때 한 번 본다).
 * 제재금은 장부(ledger)에 남고, 지명권 하락은 그 시즌 뒤 드래프트에 적용된다.
 */
export function applyCapSanctions(league: LeagueState, year: number): CapSanction[] {
  const cap = salaryCap(year);
  const n = league.teams.length;
  league.capStrikes ??= new Array(n).fill(0);
  league.draftPenalty ??= new Array(n).fill(null);
  const out: CapSanction[] = [];
  if (cap === null) return out;
  for (let t = 0; t < n; t++) {
    const pay = capPayroll(league.players, t);
    if (pay <= cap) {
      league.capStrikes[t] = 0;
      continue;
    }
    const strike = ++league.capStrikes[t];
    const over = pay - cap;
    const fine = Math.round(over * CAP_FINE_RATE[Math.min(strike, 3) - 1]);
    const pickDrop = strike >= 2;
    league.ledger.push({ year, from: t, to: -1, amount: fine, note: `샐러리캡 초과 제재금 (${strike}회 연속, 초과 ${Math.round(over / 10000)}억 원)` });
    if (pickDrop) league.draftPenalty[t] = year;
    out.push({ team: t, year, over, strike, fine, pickDrop });
  }
  return out;
}

/** 드래프트 지명 순서 (전체 지명 순 구단). order는 라운드 안 순서. 제재 구단은 1라운드에서 9단계 뒤로 */
export function draftSlots(order: number[], rounds: number, penalized: Set<number>): number[] {
  const slots: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const round = [...order];
    if (r === 0) {
      for (const t of order) {
        if (!penalized.has(t)) continue;
        const i = round.indexOf(t);
        round.splice(i, 1);
        round.splice(Math.min(round.length, i + CAP_PICK_DROP), 0, t);
      }
    }
    slots.push(...round);
  }
  return slots;
}

// ---- 시즌 목표와 신뢰도

export type GoalKind = 'champion' | 'postseason' | 'notLast';
export const GOAL_LABEL: Record<GoalKind, string> = {
  champion: '한국시리즈 우승', postseason: '가을야구 진출', notLast: '탈꼴찌',
};
/** 목표·결과의 단계 (클수록 높다) */
const GOAL_TIER: Record<GoalKind, number> = { champion: 3, postseason: 2, notLast: 1 };

/** 개막 때 전력 예상 순위로 목표를 정한다 (임시값: 1~2위 우승, 진출 팀 수 + 1위까지 가을야구, 그 아래 탈꼴찌) */
export function goalFor(projectedRank: number, postseasonTeams: number): GoalKind {
  if (projectedRank <= 2) return 'champion';
  if (projectedRank <= postseasonTeams + 1) return 'postseason';
  return 'notLast';
}

export interface SeasonOutcome {
  rank: number;
  nTeams: number;
  postseasonTeams: number;
  champion: boolean;
  /** 한국시리즈에 오름 */
  finalist: boolean;
  capOver: boolean;
}

/** 결과의 단계: 우승 3, 한국시리즈 진출 2.5, 가을야구 2, 탈꼴찌 1, 꼴찌 0 */
export function outcomeTier(o: SeasonOutcome): number {
  if (o.champion) return 3;
  if (o.finalist) return 2.5;
  if (o.rank <= o.postseasonTeams) return 2;
  if (o.rank < o.nTeams) return 1;
  return 0;
}

export function outcomeLabel(o: SeasonOutcome): string {
  if (o.champion) return '한국시리즈 우승';
  if (o.finalist) return '한국시리즈 준우승';
  if (o.rank <= o.postseasonTeams) return `가을야구 (${o.rank}위)`;
  return o.rank === o.nTeams ? `꼴찌 (${o.rank}위)` : `${o.rank}위`;
}

/** 신뢰도 변화 (임시값): 달성 +12, 목표보다 한 단계 높을 때마다 +8 / 미달 -10, 한 단계 낮을 때마다 -6 (최대 -25) / 캡 초과 -10 */
export function trustDelta(goal: GoalKind, o: SeasonOutcome): { achieved: boolean; delta: number } {
  const diff = outcomeTier(o) - GOAL_TIER[goal];
  const achieved = diff >= 0;
  let delta = achieved ? 12 + 8 * diff : Math.max(-25, -10 + 6 * (diff + 1));
  if (o.capOver) delta -= 10;
  return { achieved, delta: Math.round(delta) };
}

/** 신뢰도가 이 값보다 낮아지면 해고 (임시값). 시작 50에서 한 시즌 미달(최대 -25)로는 해고되지 않는다 */
export const FIRE_BELOW = 25;
export const START_TRUST = 50;
/** 해고되면 받는 영입 제의 수 (하위권 구단에서, 임시값) */
export const OFFER_COUNT = 3;

export interface OwnerRecord {
  year: number;
  team: number;
  goal: GoalKind;
  projectedRank: number;
  rank: number;
  result: string;
  achieved: boolean;
  trustBefore: number;
  trustAfter: number;
  champion: boolean;
  capOver: boolean;
  /** 그 시즌의 구단 이름 (명칭 변경·승계 뒤에도 그대로). 없으면 지금 이름 */
  teamName?: string;
}

export interface OwnerState {
  /** 지금 맡은 구단 */
  team: number;
  trust: number;
  /** 이번 시즌 목표 */
  goal: { year: number; kind: GoalKind; projectedRank: number } | null;
  history: OwnerRecord[];
  achievements: { id: AchievementId; year: number; team: number }[];
  /** 해고된 뒤 받은 영입 제의 (구단 색인). 고르기 전에는 오프시즌을 진행할 수 없다 */
  offers: number[] | null;
  firedYears: number[];
}

export function newOwner(team: number): OwnerState {
  return { team, trust: START_TRUST, goal: null, history: [], achievements: [], offers: null, firedYears: [] };
}

/** 하위권 구단의 영입 제의: 정규시즌 순위 아래쪽부터, 지금 구단 제외 (임시 규칙) */
export function offersFor(standings: number[], fromTeam: number, count = OFFER_COUNT): number[] {
  const bottomHalf = standings.slice(Math.floor(standings.length / 2)).filter((t) => t !== fromTeam);
  const pool = bottomHalf.length ? bottomHalf : standings.filter((t) => t !== fromTeam);
  return [...pool].reverse().slice(0, count);
}

// ---- 업적

export type AchievementId =
  | 'firstPostseason' | 'regularFirst' | 'champion' | 'backToBack' | 'dynasty' | 'fiveTitles'
  | 'worstToPostseason' | 'comeback' | 'twoTeamsTitle' | 'capCleanTitle';

export const ACHIEVEMENTS: Record<AchievementId, { label: string; note: string }> = {
  firstPostseason: { label: '첫 가을야구', note: '처음으로 포스트시즌에 진출' },
  regularFirst: { label: '정규시즌 1위', note: '정규시즌을 1위로 마침' },
  champion: { label: '한국시리즈 우승', note: '처음으로 한국시리즈 우승' },
  backToBack: { label: '2년 연속 우승', note: '같은 구단으로 2년 연속 한국시리즈 우승' },
  dynasty: { label: '왕조', note: '같은 구단으로 3년 연속 한국시리즈 우승' },
  fiveTitles: { label: '통산 우승 5회', note: '한국시리즈 우승 통산 5회' },
  worstToPostseason: { label: '꼴찌에서 가을야구로', note: '지난 시즌 꼴찌였던 구단으로 이듬해 가을야구' },
  comeback: { label: '해고 뒤 재기', note: '해고된 뒤 새 구단에서 가을야구' },
  twoTeamsTitle: { label: '두 구단에서 우승', note: '서로 다른 두 구단에서 한국시리즈 우승' },
  capCleanTitle: { label: '살림꾼 우승', note: '샐러리캡을 넘기지 않고 한국시리즈 우승' },
};

/** 이번 시즌 기록(history 마지막)을 보고 새로 얻은 업적 */
export function newAchievements(owner: OwnerState, prevLastPlace: boolean): AchievementId[] {
  const got = new Set(owner.achievements.map((a) => a.id));
  const h = owner.history;
  const cur = h[h.length - 1];
  const out: AchievementId[] = [];
  const add = (id: AchievementId, ok: boolean) => { if (ok && !got.has(id)) out.push(id); };
  const post = (r: OwnerRecord) => r.result.startsWith('가을야구') || r.result.startsWith('한국시리즈');
  const titles = h.filter((r) => r.champion);
  const sameTeamStreak = (k: number) => h.length >= k && h.slice(-k).every((r) => r.champion && r.team === cur.team);
  add('firstPostseason', post(cur));
  add('regularFirst', cur.rank === 1);
  add('champion', cur.champion);
  add('backToBack', sameTeamStreak(2));
  add('dynasty', sameTeamStreak(3));
  add('fiveTitles', titles.length >= 5);
  add('worstToPostseason', prevLastPlace && post(cur));
  add('comeback', owner.firedYears.length > 0 && post(cur) && h.some((r) => r.team !== cur.team));
  add('twoTeamsTitle', new Set(titles.map((r) => r.team)).size >= 2);
  add('capCleanTitle', cur.champion && !cur.capOver);
  return out;
}

/** 포스트시즌 결과에서 구단의 결과 */
export function outcomeOf(team: number, standings: number[], ps: PostseasonResult | null | undefined, postseasonTeams: number,
                          capOver: boolean): SeasonOutcome {
  return {
    rank: standings.indexOf(team) + 1,
    nTeams: standings.length,
    postseasonTeams,
    champion: ps?.champion === team,
    finalist: ps?.champion === team || ps?.runnerUp === team,
    capOver,
  };
}
