// 화면용 구장 지수와 세이버 구장 보정 (구장효과 기획안 5.5, 결정 5): 엔진이 경기에 쓰는 배율(stadium.ts teamParkInfo)을 그대로 읽는다.
// 따로 계산하지 않으므로 화면 지수와 경기·능력 산출의 구장 효과가 늘 같다.

import type { DataStore, Rates, SeasonData } from '../data/types';
import { DEFAULT_PARAMS, leagueRpa, parkIndexOf, type EngineParams, type ParkIndex, type World } from '../engine';
import { teamParkInfo, type TeamParkBasis } from '../league/stadium';
import type { LeagueState } from '../league/types';
import { isFuturesTeam } from '../league/world';

/** 지수의 근거 (실측은 2015~ 하드힛 파크팩터, 그 전은 구장 제원으로 거꾸로 쓰거나 짐작, 기획안 4.3) */
export const PARK_BASIS_LABEL: Record<TeamParkBasis, string> = {
  measured: '실측',
  back: '실측 (옛 해에 그대로)',
  diff: '실측 × 펜스 차이 짐작',
  guess: '제원으로 짐작',
  built: '신구장',
  none: '자료 없음(중립)',
};

/** 짐작이 섞인 근거 (화면에서 흐리게, 툴팁 "제원으로 짐작한 값") */
export const isGuessBasis = (b: TeamParkBasis) => b === 'diff' || b === 'guess';

export interface TeamParkView {
  index: ParkIndex;
  basis: TeamParkBasis;
}

/** 그 해 리그 비율과 타석당 득점 (옛 해 득점 계수, 신구장 득점 계수를 셀 때) */
export interface ParkLeague {
  rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>;
  rpa: number;
}

type ParkStore = Pick<DataStore, 'meta' | 'season'> & Partial<Pick<DataStore, 'parks'>>;
type ParkLeagueState = Pick<LeagueState, 'teams' | 'stadiums' | 'expansions'>;

/**
 * 그 해 그 구단 구장 지수. 그 해 실제 시즌 자료가 있으면 그 리그 비율을 쓰고(경기 월드와 같은 값), 없으면 lg.
 * 리그 구단은 그 해 1군 구단만 (퓨처스 창단 구단은 빼고, world.ts와 같다)
 */
export function teamParkView(store: ParkStore, league: ParkLeagueState, t: number, year: number, lg: ParkLeague,
                             params: EngineParams = DEFAULT_PARAMS): TeamParkView {
  const data = store.season(year);
  const rates = data ? leagueRpa(data.league) : lg;
  const frs = league.teams.filter((_, i) => !isFuturesTeam(league, i, year)).map((x) => x.franchise);
  const src = { parkFactors: store.meta.parkFactors, parkEvents: store.meta.parkEvents, parks: store.parks };
  const { park, basis } = teamParkInfo(src, league.teams[t].franchise, year, league.stadiums?.[t], frs, rates, params.park);
  return { index: parkIndexOf(park, params.park, rates.rates, rates.rpa), basis };
}

/**
 * 세이버 기록에 쓰는 시즌 구장 계수: 홈 경기 절반은 홈 구장, 원정은 리그 평균 구장으로 본다 (능력 산출 seasonPark와 같은 생각).
 * 리그 안에서 이름이 같은 구단이 없으면 1
 */
export function seasonParkFactor(store: ParkStore, league: ParkLeagueState, teamName: string, year: number,
                                 lg: ParkLeague, params: EngineParams = DEFAULT_PARAMS): number {
  const t = league.teams.findIndex((x) => x.name === teamName);
  if (t < 0) return 1;
  return (1 + teamParkView(store, league, t, year, lg, params).index.run) / 2;
}

/** 게임 시작 전 실제 시즌의 시즌 구장 계수 (그 해 실제 소속 구단의 실제 구장, 게임 안 공사와 무관. 능력 산출 seasonPark와 같은 값) */
export function realSeasonParkFactor(store: Partial<Pick<DataStore, 'parks'>> & Pick<DataStore, 'meta'>, season: Pick<SeasonData, 'year' | 'teams' | 'league'>,
                                     teamName: string, params: EngineParams = DEFAULT_PARAMS): number {
  const fr = season.teams.find((x) => x.name === teamName)?.franchise;
  if (!fr) return 1;
  const src = { parkFactors: store.meta.parkFactors, parkEvents: store.meta.parkEvents, parks: store.parks };
  const lg = leagueRpa(season.league);
  const { park } = teamParkInfo(src, fr, season.year, undefined, season.teams.map((x) => x.franchise), lg, params.park);
  return (1 + parkIndexOf(park, params.park, lg.rates, lg.rpa).run) / 2;
}

/** 지금 시즌 월드에서 그 구단의 시즌 구장 계수 (경기에 쓰는 SimTeam.park 그대로). rpa = 타석당 득점 (신구장 배율만 있을 때 득점 계수를 셀 때) */
export function worldParkFactor(world: Pick<World, 'teams' | 'league'>, t: number, rpa: number, params: EngineParams = DEFAULT_PARAMS): number {
  if (t < 0 || !world.teams[t]) return 1;
  return (1 + parkIndexOf(world.teams[t].park, params.park, world.league, rpa).run) / 2;
}
