// 엔진 공개 진입점. 화면(src/ui)과 도구(tools)는 여기서만 가져다 쓴다.

import type { DataStore } from '../data/types';
import { DEFAULT_PARAMS, type EngineParams } from './params';
import { buildWorld } from './ratings';
import type { World } from './types';

export { DEFAULT_PARAMS, type EngineParams } from './params';
export { Rng } from './rng';
export { buildWorld, batValue, pitValue, batSkillFrom, pitSkillFrom, leagueEnvFor } from './ratings';
export {
  simulateSeason, calibrate, generateSchedule, winPct, rankTeams, rosterFingerprint, Season,
  type SeasonResult, type SeasonSave, type GameLog, type BoxScore, type BoxSide, type BoxBatter, type BoxPitcher, type ScheduledGame,
} from './season';
export {
  MIN_ACTIVE_HITTERS, MIN_ACTIVE_PITCHERS, LINEUP_SLOTS, assignLineup, positionFit, todaysStarter, currentFatigue, type Slot, type TeamSeason,
} from './team';
export { emptyBatLine, emptyPitLine } from './types';
export { computeGrades, type BatterGrades, type PitcherGrades, type DisplayGrades } from './display';
export type * from './types';

/** 데이터 저장소에서 그 해 시작 시점의 월드를 만든다 (능력은 직전 3시즌 기준) */
export function worldForYear(store: Pick<DataStore, 'meta' | 'players' | 'season'>, year: number, params: EngineParams = DEFAULT_PARAMS): World {
  const current = store.season(year);
  if (!current) throw new Error(`${year}년 시즌 데이터가 없습니다`);
  return buildWorld({
    year,
    current,
    history: [store.season(year - 1), store.season(year - 2), store.season(year - 3)],
    players: store.players,
    meta: store.meta,
    params,
  });
}
