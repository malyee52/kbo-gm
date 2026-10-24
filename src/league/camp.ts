// 스프링캠프 (2026-10-14): 오프시즌에 다음 시즌 캠프 장소와 훈련 방향을 정하고, 개막(openNextSeason) 때 효과를 준다.
// - 장소: 비용과 시설 배율. 국내는 싸지만 추워서 부상이 조금 늘고, 해외는 비싼 만큼 효과가 크다.
// - 훈련 방향: 개막 뒤 CAMP_DAYS일 동안의 경기력(events.ts FormBuff), 체력은 시즌 내내 부상 빈도를 줄이고(world.ts),
//   유망주 집중은 24세 이하 선수를 잠재력 안에서 조금 더 끌어올린다 (상한을 넘기지 않아 장기 재능 총량은 그대로).
// - AI 구단은 자금으로 장소를, 약한 쪽(타격·투수)이나 단장 성향으로 방향을 고른다.
// 수치는 모두 임시값 (docs/temp-values.md).
import { currentRuns, type ValueContext } from '../ai/value';
import type { SimPlayer } from '../engine';
import { ensureEvents } from './events';
import { gmStyle } from './gm';
import { runsOf, skillForRuns } from './growth';
import type { LeagueState } from './types';

export type CampPlace = 'home' | 'taiwan' | 'japan' | 'australia' | 'usa';
export type CampFocus = 'balanced' | 'bat' | 'pit' | 'def' | 'fitness' | 'youth';
export const CAMP_PLACES: CampPlace[] = ['home', 'taiwan', 'japan', 'australia', 'usa'];
export const CAMP_FOCUSES: CampFocus[] = ['balanced', 'bat', 'pit', 'def', 'fitness', 'youth'];

/** 장소: 비용(만 원), 효과 배율, 시즌 부상 배율 (임시값) */
export const PLACE: Record<CampPlace, { label: string; cost: number; factor: number; injury: number }> = {
  home: { label: '국내 (제주·남해)', cost: 10_000, factor: 0.5, injury: 1.05 },
  taiwan: { label: '대만', cost: 35_000, factor: 0.85, injury: 1 },
  japan: { label: '일본 오키나와', cost: 60_000, factor: 1, injury: 1 },
  australia: { label: '호주', cost: 80_000, factor: 1.1, injury: 1 },
  usa: { label: '미국 애리조나', cost: 110_000, factor: 1.2, injury: 1 },
};

/** 방향: 개막 뒤 경기력 (타자·투수, 장소 배율을 곱한다), 시즌 부상 배율, 유망주 성장(런, 장소 배율을 곱한다) (임시값) */
export const FOCUS: Record<CampFocus, { label: string; note: string; bat: number; pit: number; injury: number; youth: number }> = {
  balanced: { label: '균형', note: '타자·투수 모두 조금', bat: 0.004, pit: 0.004, injury: 1, youth: 0 },
  bat: { label: '타격', note: '타자 경기력을 크게', bat: 0.008, pit: 0, injury: 1, youth: 0 },
  pit: { label: '투구', note: '투수 경기력을 크게', bat: 0, pit: 0.008, injury: 1, youth: 0 },
  def: { label: '수비·주루', note: '실점을 줄인다 (투수 쪽 경기력)', bat: 0.001, pit: 0.005, injury: 1, youth: 0 },
  fitness: { label: '체력', note: '시즌 내내 부상이 줄어든다', bat: 0.002, pit: 0.002, injury: 0.85, youth: 0 },
  youth: { label: '유망주 집중', note: '24세 이하가 잠재력 안에서 성장', bat: 0.001, pit: 0.001, injury: 1, youth: 1.5 },
};
/** 개막 뒤 경기력이 이어지는 날 (일정 색인) */
export const CAMP_DAYS = 30;
export const YOUTH_AGE = 24;
const KEEP_YEARS = 5;

export interface CampPick { place: CampPlace; focus: CampFocus }
export interface CampRecord extends CampPick { year: number; team: number; cost: number }

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

/** 시즌 부상 빈도 배율 (world.ts SimTeam.injuryRate에 곱한다) */
export function campInjury(league: Pick<LeagueState, 'camps'>, team: number, year: number): number {
  const c = campOf(league, team, year);
  return c ? PLACE[c.place].injury * FOCUS[c.focus].injury : 1;
}

/** AI 구단의 선택: 자금으로 장소, 단장 성향·약한 쪽으로 방향 */
export function aiCamp(league: LeagueState, team: number, cash: number, strength: { bat: number; pit: number }): CampPick {
  const place: CampPlace = cash >= 1_000_000 ? 'usa' : cash >= 600_000 ? 'australia' : cash >= 200_000 ? 'japan' : cash >= 50_000 ? 'taiwan' : 'home';
  const style = gmStyle(league, team);
  const focus: CampFocus = style === 'develop' ? 'youth' : style === 'frugal' ? 'balanced'
    : Math.abs(strength.bat - strength.pit) < 0.03 ? 'balanced' : strength.bat < strength.pit ? 'bat' : 'pit';
  return { place: style === 'frugal' && place !== 'home' ? 'taiwan' : place, focus };
}

/**
 * 개막 때 모든 구단의 캠프: 비용을 장부에, 경기력을 이벤트 효과로, 유망주 성장을 능력에. 우리 구단 소식 문장을 돌려준다.
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
  const forms = (ensureEvents(league).forms ??= []);
  league.camps = (league.camps ?? []).filter((c) => c.year > year - KEEP_YEARS && c.year !== year);
  for (const { t, s } of all) {
    const pick = t === userTeam ? (userPick ?? DEFAULT_CAMP) : aiCamp(league, t, cashOf(t), { bat: s.bat / lgBat, pit: s.pit / lgPit });
    const place = PLACE[pick.place];
    const focus = FOCUS[pick.focus];
    league.ledger.push({ year, from: t, to: -1, amount: place.cost, note: `${league.teams[t].name} 스프링캠프 (${place.label})`, kind: 'ops' });
    const edge = (v: number) => Math.round(v * place.factor * 10000) / 10000;
    const note = `스프링캠프 (${place.label}, ${focus.label})`;
    if (focus.bat && focus.bat === focus.pit) forms.push({ team: t, year, from: 0, until: CAMP_DAYS, edge: edge(focus.bat), note });
    else {
      if (focus.bat) forms.push({ team: t, year, from: 0, until: CAMP_DAYS, edge: edge(focus.bat), note, side: 'bat' });
      if (focus.pit) forms.push({ team: t, year, from: 0, until: CAMP_DAYS, edge: edge(focus.pit), note, side: 'pit' });
    }
    let grown = 0;
    if (focus.youth) grown = youthGrowth(league, t, year, focus.youth * place.factor, sim, ctx);
    league.camps.push({ year, team: t, ...pick, cost: place.cost });
    if (t === userTeam) {
      news.push(`스프링캠프: ${place.label}, ${focus.label} 훈련 (비용 ${(place.cost / 10000).toFixed(0)}억 원). 개막 뒤 ${CAMP_DAYS}일 동안 ${focus.note}${grown ? `, 유망주 ${grown}명 성장` : ''}`);
    }
  }
  return news;
}

/** 24세 이하 선수를 잠재력 안에서 runs만큼 끌어올린다. 끌어올린 선수 수 */
function youthGrowth(league: LeagueState, team: number, year: number, runs: number, sim: Map<string, SimPlayer>, ctx: ValueContext): number {
  let n = 0;
  for (const p of league.players) {
    if (p.team !== team || p.reserve !== undefined || p.birthYear === null || year - p.birthYear > YOUTH_AGE || !sim.get(p.id)) continue;
    const now = runsOf(p, ctx, year);
    const target = Math.min(p.potential, now + runs);
    if (target <= now + 0.05) continue;
    Object.assign(p, skillForRuns(p, target, ctx, year));
    n++;
  }
  return n;
}
