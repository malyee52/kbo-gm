// 순위 문장 도우미 (일정 개편 기획안 10.4). 단일 리그 해는 "3위", 양대 리그 해(1999·2000)는 "드림 2위".
// 화면·소식·기사·기자회견이 순위를 문장으로 쓸 때 이것을 거친다. 지명·정산처럼 통합 순위가 필요한 곳은 standings()를 그대로 쓴다
import type { DivisionTable, Season, TeamRecord } from '../engine';
import { bracketFor } from '../league/postseason';
import type { LeagueState } from '../league/types';

/** 한 구단이 속한 순위표: 리그 이름(단일 리그면 null), 그 표의 순서(1위부터), 순위(1부터, 없으면 0) */
export interface RankPlace {
  league: string | null;
  order: number[];
  rank: number;
}

/** 통합 순위와 리그별 순위에서 team의 자리 */
export function placeIn(order: number[], tables: DivisionTable[] | null | undefined, team: number): RankPlace {
  const table = tables?.find((d) => d.teams.includes(team));
  if (table) return { league: table.name, order: table.teams, rank: table.teams.indexOf(team) + 1 };
  return { league: null, order, rank: order.indexOf(team) + 1 };
}

/** 시즌 중 team의 자리 (양대 리그 해는 리그 안 순위) */
export function seasonPlace(season: Season, team: number): RankPlace {
  return placeIn(season.standings(), season.divisionStandings(), team);
}

/** 지난 시즌 team의 자리 (리그 상태의 lastSeason). 지난 시즌 기록이 없으면 null */
export function lastSeasonPlace(league: Pick<LeagueState, 'lastSeason'>, team: number): RankPlace | null {
  const last = league.lastSeason;
  return last ? placeIn(last.standings, last.divisions, team) : null;
}

/** "3위" / "드림 2위". rank가 0(순위표에 없음)이면 빈 문자열 */
export function placeLabel(p: RankPlace): string {
  if (!p.rank) return '';
  return p.league ? `${p.league} ${p.rank}위` : `${p.rank}위`;
}

/** 세션의 지금 순위 문장: 시즌 중이면 이번 시즌, 오프시즌이면 지난 시즌 (기획안 10.4 `rankText`) */
export function rankText(session: { phase: string; season: Season; league: Pick<LeagueState, 'lastSeason'> }, team: number): string {
  const p = session.phase === 'offseason' ? lastSeasonPlace(session.league, team) : seasonPlace(session.season, team);
  return p ? placeLabel(p) : '';
}

/**
 * 지금 순위대로라면 가을야구에 나가는 구단 (순위 순). 단일 리그 해는 통합 상위 cut팀.
 * 양대 리그 해는 각 리그 1·2위 + 한 리그 3위가 다른 리그 2위를 동률 규칙까지 넣어 앞서면 그 3위 (준플레이오프, 기획안 10.5)
 */
export function postseasonPlaces(order: number[], tables: DivisionTable[] | null | undefined, cut: number, teams: TeamRecord[], log: Season['log'], prev?: readonly number[]): number[] {
  if (!tables || tables.length !== 2) return order.slice(0, cut);
  // 실제 가을야구 대진(league/postseason.ts bracketFor)과 같은 판정
  return bracketFor(order, tables, teams, log, prev).seeds;
}

/** 시즌 중 지금 순위로 가을야구에 나가는 구단 */
export function seasonPostseasonPlaces(season: Season, cut: number): number[] {
  return postseasonPlaces(season.standings(), season.divisionStandings(), cut, season.teams, season.log, season.world.prevStandings);
}
