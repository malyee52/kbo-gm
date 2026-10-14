// 단장 평판 (2026-10-14): 리그 안에서 플레이어(단장)를 보는 눈. 구단을 옮겨도 따라간다. 0~100, 50에서 시작.
// - 시즌 평가(evaluateOwner) 때 바뀐다: 승률, 가을야구·우승, 구단주 목표, 샐러리캡 초과, 모기업 적자 보전, 업적, 해고.
//   해마다 50 쪽으로 조금 돌아간다.
// - 효과: FA·비FA 다년 계약 요구액(평판이 높으면 덜 부른다), AI 구단의 트레이드 호의(런), 해고 뒤 영입 제의(평판이 높으면 강팀도 부른다).
// 수치는 모두 임시값 (docs/temp-values.md).
import { offersFor } from './owner';
import type { LeagueState } from './types';

export const REP_START = 50;
export const REP_LOG_KEEP = 30;
/** 시즌 평가 때 변화 (임시값) */
export const REP = {
  /** (승률 − .500) × 이 값 */
  winPct: 40,
  postseason: 2,
  /** 가을야구 시리즈를 이길 때마다 */
  series: 2,
  champion: 4,
  goalMet: 2,
  goalMissed: -2,
  capOver: -2,
  rescue: -1,
  achievement: 1,
  fired: -6,
  /** 50과의 차이 중 해마다 돌아가는 몫 */
  revert: 0.1,
};
/** 효과 (임시값): 평판 100이면 FA·다년 계약 요구 −5%, 0이면 +5%. 트레이드 호의 ±1.5런 */
export const REP_FA = 0.05;
export const REP_TRADE = 1.5;

export interface RepState {
  value: number;
  log: { year: number; delta: number; reason: string }[];
}

export function repOf(league: Pick<LeagueState, 'reputation'>): number {
  return league.reputation?.value ?? REP_START;
}

export function repLabel(v: number): string {
  return v >= 80 ? '명단장' : v >= 65 ? '좋음' : v >= 45 ? '보통' : v >= 30 ? '나쁨' : '바닥';
}

/** 우리 제시에 곱하는 요구 배율 (FA 수락선·다년 계약 요구액) */
export function repDemand(league: Pick<LeagueState, 'reputation'>): number {
  return 1 - ((repOf(league) - 50) / 50) * REP_FA;
}

/** AI 구단이 우리 제안에 얹는 호의 (런) */
export function repGoodwill(league: Pick<LeagueState, 'reputation'>): number {
  return ((repOf(league) - 50) / 50) * REP_TRADE;
}

export interface RepSeason {
  year: number;
  winPct: number;
  postseason: boolean;
  seriesWon: number;
  champion: boolean;
  goalMet: boolean;
  capOver: boolean;
  rescued: boolean;
  achievements: number;
  fired: boolean;
}

/** 시즌 평가: 항목별 변화를 더하고 50 쪽으로 돌린다. 바뀐 값과 이유들을 돌려준다 */
export function updateReputation(league: LeagueState, s: RepSeason): { before: number; after: number; parts: string[] } {
  const st = (league.reputation ??= { value: REP_START, log: [] });
  const before = st.value;
  const parts: [number, string][] = [];
  const add = (d: number, why: string) => { if (d) parts.push([d, why]); };
  add(Math.round((s.winPct - 0.5) * REP.winPct * 10) / 10, `승률 ${s.winPct.toFixed(3).replace(/^0/, '')}`);
  if (s.postseason) add(REP.postseason, '가을야구 진출');
  if (s.seriesWon) add(REP.series * s.seriesWon, `가을야구 ${s.seriesWon}시리즈 승리`);
  if (s.champion) add(REP.champion, '한국시리즈 우승');
  add(s.goalMet ? REP.goalMet : REP.goalMissed, s.goalMet ? '구단주 목표 달성' : '구단주 목표 미달');
  if (s.capOver) add(REP.capOver, '샐러리캡 초과');
  if (s.rescued) add(REP.rescue, '모기업 적자 보전');
  if (s.achievements) add(REP.achievement * s.achievements, `업적 ${s.achievements}개`);
  if (s.fired) add(REP.fired, '해고');
  let v = before + parts.reduce((a, [d]) => a + d, 0);
  const revert = (50 - v) * REP.revert;
  v = Math.max(0, Math.min(100, Math.round((v + revert) * 10) / 10));
  st.value = v;
  for (const [d, why] of parts) st.log.push({ year: s.year, delta: d, reason: why });
  if (Math.abs(revert) >= 0.1) st.log.push({ year: s.year, delta: Math.round(revert * 10) / 10, reason: '시간이 지나며 무뎌짐' });
  if (st.log.length > REP_LOG_KEEP) st.log.splice(0, st.log.length - REP_LOG_KEEP);
  return { before, after: v, parts: parts.map(([d, why]) => `${why} ${d > 0 ? '+' : ''}${d}`) };
}

/**
 * 해고 뒤 영입 제의 (owner.ts offersFor 대신): 평판이 높을수록 위쪽 순위 구단도 부르고 제의가 많다.
 * 평판 70 이상: 지금 구단 빼고 아래·위를 번갈아 3곳, 30 미만: 아래쪽 2곳, 그 사이: 예전처럼 아래 절반 (offersFor)
 */
export function offersByRep(standings: number[], fromTeam: number, rep: number): number[] {
  const others = standings.filter((t) => t !== fromTeam);
  if (rep >= 70) {
    // 위·아래를 번갈아: 꼴찌, 1위 쪽, 꼴찌 다음 ...
    const out: number[] = [];
    const lo = [...others].reverse();
    for (let i = 0; out.length < 3 && i < others.length; i++) {
      const pick = i % 2 === 0 ? lo[Math.floor(i / 2)] : others[Math.floor(i / 2)];
      if (pick !== undefined && !out.includes(pick)) out.push(pick);
    }
    return out;
  }
  return rep < 30 ? offersFor(standings, fromTeam, 2) : offersFor(standings, fromTeam);
}
