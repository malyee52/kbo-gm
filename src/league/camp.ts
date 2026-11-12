// 스프링캠프 (2026-10-14): 오프시즌에 다음 시즌 캠프 장소와 훈련 방향을 정하고, 개막(openNextSeason) 때 효과를 준다.
// 2026-11-12 개편 (사용자 결정 Q36, reports/nominal-content.md 2장): 개막 뒤 30일 경기력(최대 0.23승, 1승당 78억 원)을 빼고
// 효과를 유망주 성장과 시즌 부상 위험으로 옮겼다.
// - 장소: 비용, 시설 배율(유망주 성장), 시즌 부상 배율. 국내는 싸지만 추워서 부상이 늘고, 따뜻한 해외일수록 부상이 줄고 성장이 크다.
// - 훈련 방향: 유망주 성장(24세 이하 선수를 잠재력 안에서 끌어올린다. 상한을 넘기지 않아 장기 재능 총량은 그대로)과 시즌 부상 배율의 맞바꿈.
//   유망주 집중은 성장이 가장 크지만 훈련 강도로 부상이 늘고, 체력은 성장이 없는 대신 부상이 가장 준다.
//   어느 쪽이 나은지는 구단의 젊은 선수 수와 주전 나이에 달려 있어 늘 같은 답이 아니다.
// - AI 구단은 자금으로 장소를, 단장 성향·젊은 선수 수·약한 쪽으로 방향을 고른다 (진짜 잠재는 보지 않고 나이만 센다).
// 수치는 모두 임시값 (docs/temp-values.md "스프링캠프").
import { currentRuns, type ValueContext } from '../ai/value';
import type { SimPlayer } from '../engine';
import { gmStyle } from './gm';
import { runsOf, skillForRuns } from './growth';
import type { LeagueState } from './types';

export type CampPlace = 'home' | 'taiwan' | 'japan' | 'australia' | 'usa';
export type CampFocus = 'balanced' | 'bat' | 'pit' | 'def' | 'fitness' | 'youth';
export const CAMP_PLACES: CampPlace[] = ['home', 'taiwan', 'japan', 'australia', 'usa'];
export const CAMP_FOCUSES: CampFocus[] = ['balanced', 'bat', 'pit', 'def', 'fitness', 'youth'];

/** 장소: 비용(만 원), 유망주 성장 배율, 시즌 부상 배율 (임시값) */
export const PLACE: Record<CampPlace, { label: string; cost: number; factor: number; injury: number }> = {
  home: { label: '국내 (제주·남해)', cost: 10_000, factor: 0.5, injury: 1.06 },
  taiwan: { label: '대만', cost: 35_000, factor: 0.8, injury: 1 },
  japan: { label: '일본 오키나와', cost: 60_000, factor: 1, injury: 0.97 },
  australia: { label: '호주', cost: 80_000, factor: 1.1, injury: 0.96 },
  usa: { label: '미국 애리조나', cost: 110_000, factor: 1.25, injury: 0.96 },
};

/**
 * 방향: 유망주 성장(런, 장소 배율을 곱한다)과 대상(타자·투수·모두), 시즌 부상 배율 (임시값).
 * 2026-11-12 전에는 개막 뒤 30일 경기력(타자·투수 edge)이었다. 예전 저장에 남은 그 효과(events.forms의 '스프링캠프' 줄)는 그 해에만 쓰인다
 */
export const FOCUS: Record<CampFocus, { label: string; note: string; youth: number; scope: 'all' | 'bat' | 'pit'; injury: number }> = {
  balanced: { label: '균형', note: '젊은 선수가 조금씩 성장', youth: 0.6, scope: 'all', injury: 1 },
  bat: { label: '타격', note: '젊은 타자가 성장', youth: 1.4, scope: 'bat', injury: 1 },
  pit: { label: '투구', note: '젊은 투수가 성장', youth: 1.4, scope: 'pit', injury: 1 },
  def: { label: '수비·주루', note: '젊은 타자가 조금 성장하고 부상이 조금 준다', youth: 0.8, scope: 'bat', injury: 0.93 },
  fitness: { label: '체력', note: '성장은 없지만 시즌 내내 부상이 크게 준다', youth: 0, scope: 'all', injury: 0.82 },
  youth: { label: '유망주 집중', note: '젊은 선수가 크게 성장하지만 훈련 강도로 부상이 늘어난다', youth: 2, scope: 'all', injury: 1.08 },
};
export const YOUTH_AGE = 24;
const KEEP_YEARS = 5;

export interface CampPick { place: CampPlace; focus: CampFocus }
export interface CampRecord extends CampPick {
  year: number; team: number; cost: number;
  /** 유망주 성장으로 끌어올린 선수 수와 런 합 (2026-11-12, 측정용 선택 칸. 예전 저장에는 없다. 화면에는 런을 보이지 않는다) */
  grown?: number; grownRuns?: number;
}

export const DEFAULT_CAMP: CampPick = { place: 'japan', focus: 'balanced' };

export const campCost = (c: CampPick) => PLACE[c.place].cost;

export function isCampPick(x: unknown): x is CampPick {
  const c = x as CampPick | null;
  return !!c && CAMP_PLACES.includes(c.place) && CAMP_FOCUSES.includes(c.focus);
}

/** 그 해 그 구단의 캠프 (개막 뒤) */
export function campOf(league: Pick<LeagueState, 'camps'>, team: number, year: number): CampRecord | undefined {
  return league.camps?.find((c) => c.team === team && c.year === year);
}

/** 캠프의 시즌 부상 빈도 배율 (장소 × 방향) */
export const campInjuryOf = (c: CampPick) => PLACE[c.place].injury * FOCUS[c.focus].injury;

/** 시즌 부상 빈도 배율 (world.ts SimTeam.injuryRate에 곱한다) */
export function campInjury(league: Pick<LeagueState, 'camps'>, team: number, year: number): number {
  const c = campOf(league, team, year);
  return c ? campInjuryOf(c) : 1;
}

/** 부상 배율 낱말 (화면) */
export function injuryWord(x: number): string {
  if (x <= 0.85) return '부상 크게 줄어듦';
  if (x < 0.99) return '부상 조금 줄어듦';
  if (x <= 1.01) return '부상 보통';
  if (x < 1.1) return '부상 조금 늘어남';
  return '부상 늘어남';
}

/** 유망주 성장 대상 (24세 이하, 군 복무·보류 명단 아님). 화면의 인원 안내와 AI 판단이 같이 쓴다 (나이만 본다) */
export function campYoung(league: LeagueState, team: number, year: number, scope: 'all' | 'bat' | 'pit' = 'all') {
  return league.players.filter((p) => p.team === team && p.reserve === undefined && p.birthYear !== null && year - p.birthYear <= YOUTH_AGE
    && p.military?.state !== 'serving' && (scope === 'all' || (scope === 'pit') === !!p.isPitcher));
}

/** AI가 유망주 집중을 고르는 젊은 선수 수 (24세 이하, 임시값) */
export const AI_YOUTH_MIN = 14;

/**
 * AI 구단의 선택: 자금으로 장소, 단장 성향·젊은 선수 수·약한 쪽으로 방향 (2026-11-12 Q36에서 다시 맞춤, 임시값).
 * 우승 도전형은 부상을 줄이는 체력, 육성형은 유망주 집중, 짠돌이는 대만·균형, 나머지는 젊은 선수가 많으면 유망주 집중,
 * 아니면 약한 쪽(타격·투구)이나 수비·주루
 */
export function aiCamp(league: LeagueState, team: number, cash: number, strength: { bat: number; pit: number }, year = league.year): CampPick {
  const place: CampPlace = cash >= 1_000_000 ? 'usa' : cash >= 600_000 ? 'australia' : cash >= 200_000 ? 'japan' : cash >= 50_000 ? 'taiwan' : 'home';
  const style = gmStyle(league, team);
  const young = campYoung(league, team, year).length;
  let focus: CampFocus;
  if (style === 'frugal') focus = 'balanced';
  else if (style === 'develop') focus = 'youth';
  else if (style === 'winnow') focus = young >= AI_YOUTH_MIN + 4 ? 'balanced' : 'fitness';
  else if (young >= AI_YOUTH_MIN) focus = 'youth';
  else if (Math.abs(strength.bat - strength.pit) < 0.03) focus = 'def';
  else focus = strength.bat < strength.pit ? 'bat' : 'pit';
  return { place: style === 'frugal' && place !== 'home' ? 'taiwan' : place, focus };
}

/**
 * 개막 때 모든 구단의 캠프: 비용을 장부에, 유망주 성장을 능력에 (부상 배율은 campInjury로 world.ts가 읽는다). 우리 구단 소식 문장을 돌려준다.
 * teams: 이번 시즌 1군 구단 색인, sim: 선수 ID → 능력 계산용 선수 (leagueView)
 */
export function runCamps(league: LeagueState, year: number, teams: number[], userTeam: number, userPick: CampPick | null,
                         cashOf: (t: number) => number, sim: Map<string, SimPlayer>, ctx: ValueContext): string[] {
  const news: string[] = [];
  const strength = (t: number) => {
    // 구단 상위 타자 13명·투수 12명의 지금 기여(런) 평균, 리그 평균 대비 비율
    const org = league.players.filter((p) => p.team === t);
    const top = (pit: boolean, n: number) => org.filter((p) => !!p.isPitcher === pit).map((p) => (sim.get(p.id) ? currentRuns(sim.get(p.id)!, ctx) : 0)).sort((a, b) => b - a).slice(0, n);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    return { bat: avg(top(false, 13)), pit: avg(top(true, 12)) };
  };
  const all = teams.map((t) => ({ t, s: strength(t) }));
  const lgBat = all.reduce((a, x) => a + x.s.bat, 0) / Math.max(1, all.length) || 1;
  const lgPit = all.reduce((a, x) => a + x.s.pit, 0) / Math.max(1, all.length) || 1;
  league.camps = (league.camps ?? []).filter((c) => c.year > year - KEEP_YEARS && c.year !== year);
  for (const { t, s } of all) {
    const pick = t === userTeam ? (userPick ?? DEFAULT_CAMP) : aiCamp(league, t, cashOf(t), { bat: s.bat / lgBat, pit: s.pit / lgPit }, year);
    const place = PLACE[pick.place];
    const focus = FOCUS[pick.focus];
    league.ledger.push({ year, from: t, to: -1, amount: place.cost, note: `${league.teams[t].name} 스프링캠프 (${place.label})`, kind: 'ops' });
    let grown = 0;
    let grownRuns = 0;
    if (focus.youth) ({ n: grown, runs: grownRuns } = youthGrowth(league, t, year, focus.youth * place.factor, focus.scope, sim, ctx));
    league.camps.push({ year, team: t, ...pick, cost: place.cost, ...(grown ? { grown, grownRuns: Math.round(grownRuns * 100) / 100 } : {}) });
    if (t === userTeam) {
      news.push(`스프링캠프: ${place.label}, ${focus.label} 훈련 (비용 ${(place.cost / 10000).toFixed(0)}억 원). ${grown ? `유망주 ${grown}명 성장` : '성장한 유망주 없음'}, 시즌 ${injuryWord(campInjuryOf(pick))}`);
    }
  }
  return news;
}

/** 24세 이하 선수(scope 쪽)를 잠재력 안에서 runs만큼 끌어올린다. 끌어올린 선수 수와 런 합 */
function youthGrowth(league: LeagueState, team: number, year: number, runs: number, scope: 'all' | 'bat' | 'pit',
                     sim: Map<string, SimPlayer>, ctx: ValueContext): { n: number; runs: number } {
  let n = 0;
  let sum = 0;
  for (const p of campYoung(league, team, year, scope)) {
    if (!sim.get(p.id)) continue;
    const now = runsOf(p, ctx, year);
    const target = Math.min(p.potential, now + runs);
    if (target <= now + 0.05) continue;
    Object.assign(p, skillForRuns(p, target, ctx, year));
    n++;
    sum += target - now;
  }
  return { n, runs: sum };
}
