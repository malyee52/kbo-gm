// 화면용 구장 지수와 세이버 구장 보정 (구장효과 기획안 5.5, 결정 5): 엔진이 경기에 쓰는 배율(stadium.ts teamParkAt)을 그대로 읽는다.
// 따로 계산하지 않으므로 화면 지수와 경기·능력 산출의 구장 효과가 늘 같다.

import type { DataStore, Rates, SeasonData } from '../data/types';
import { DEFAULT_PARAMS, parkIndexOf, type EngineParams, type ParkIndex, type World } from '../engine';
import { teamParkAt } from '../league/stadium';
import type { LeagueState } from '../league/types';

/** 지수의 근거: 실측(2015~ 하드힛 파크팩터), 게임 안 신구장, 자료 없음(중립) */
export type ParkBasis = 'measured' | 'built' | 'none';

export const PARK_BASIS_LABEL: Record<ParkBasis, string> = {
  measured: '실측',
  built: '신구장',
  none: '자료 없음(중립)',
};

export interface TeamParkView {
  index: ParkIndex;
  basis: ParkBasis;
}

/** 그 해 리그 비율과 타석당 득점 (득점 계수를 다시 셀 때만 쓴다) */
export interface ParkLeague {
  rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>;
  rpa: number;
}

export function teamParkView(store: Pick<DataStore, 'meta'>, league: Pick<LeagueState, 'teams' | 'stadiums'>, t: number, year: number,
                             lg: ParkLeague, params: EngineParams = DEFAULT_PARAMS): TeamParkView {
  const s = league.stadiums?.[t];
  const tp = teamParkAt(store.meta, league.teams[t].franchise, year, s);
  const built = (s?.done ?? []).some((d) => d.kind === 'new' && d.open <= year);
  return { index: parkIndexOf(tp, params.park, lg.rates, lg.rpa), basis: built ? 'built' : tp?.run !== undefined ? 'measured' : 'none' };
}

/**
 * 세이버 기록에 쓰는 시즌 구장 계수: 홈 경기 절반은 홈 구장, 원정은 리그 평균 구장으로 본다 (능력 산출 seasonPark와 같은 생각).
 * 리그 안에서 이름이 같은 구단이 없으면 1
 */
export function seasonParkFactor(store: Pick<DataStore, 'meta'>, league: Pick<LeagueState, 'teams' | 'stadiums'>, teamName: string, year: number,
                                 lg: ParkLeague, params: EngineParams = DEFAULT_PARAMS): number {
  const t = league.teams.findIndex((x) => x.name === teamName);
  if (t < 0) return 1;
  return (1 + teamParkView(store, league, t, year, lg, params).index.run) / 2;
}

/** 게임 시작 전 실제 시즌의 시즌 구장 계수 (그 해 실제 소속 구단의 실제 구장, 게임 안 공사와 무관) */
export function realSeasonParkFactor(store: Pick<DataStore, 'meta'>, season: Pick<SeasonData, 'year' | 'teams' | 'league'>, teamName: string,
                                     params: EngineParams = DEFAULT_PARAMS): number {
  const fr = season.teams.find((x) => x.name === teamName)?.franchise;
  if (!fr) return 1;
  const tp = teamParkAt(store.meta, fr, season.year, undefined);
  const L = season.league;
  return (1 + parkIndexOf(tp, params.park, L.rates, L.pa > 0 ? L.r / L.pa : 0).run) / 2;
}

/** 지금 시즌 월드에서 그 구단의 시즌 구장 계수 (경기에 쓰는 SimTeam.park 그대로). rpa = 타석당 득점 (신구장 배율만 있을 때 득점 계수를 셀 때) */
export function worldParkFactor(world: Pick<World, 'teams' | 'league'>, t: number, rpa: number, params: EngineParams = DEFAULT_PARAMS): number {
  if (t < 0 || !world.teams[t]) return 1;
  return (1 + parkIndexOf(world.teams[t].park, params.park, world.league, rpa).run) / 2;
}
