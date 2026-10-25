// 개인 기록 전체 표의 줄 만들기와 거르기 (2026-10-23 UI 2단계 U2-4, 기획안 2.3.2). 그리기는 screens/Leaders.tsx.
// 규정은 1위 보드와 같다 (game/stats.ts batQualified·pitQualified, 그 선수 소속 팀의 경기 수 기준).
import { lineTeam, type BatLine, type PitLine, type Season, type SimPlayer } from '../engine';
import { batQualified, pitQualified } from '../game/stats';

export interface BatRec { p: SimPlayer; team: number; pos: string; age: number | null; l: BatLine; q: boolean; war: number | null }
export interface PitRec { p: SimPlayer; team: number; role: 'SP' | 'RP'; age: number | null; l: PitLine; q: boolean; war: number | null }

/** 투수 자리: 이번 시즌 선발 등판이 절반 이상이면 SP */
export const pitRole = (l: Pick<PitLine, 'g' | 'gs'>): 'SP' | 'RP' => (l.gs * 2 >= l.g && l.gs > 0 ? 'SP' : 'RP');

/** 타석이 있는 선수 전부 (이도류 투수 포함). 소속이 없는 선수(시장)는 마지막 소속으로 */
export function batRecs(players: SimPlayer[], season: Pick<Season, 'bat' | 'teams'>, war: Map<number, number>): BatRec[] {
  return players.filter((p) => season.bat[p.idx].pa > 0 && season.teams[lineTeam(p)]).map((p) => {
    const team = lineTeam(p);
    const l = season.bat[p.idx];
    return { p, team, pos: p.isPitcher ? 'P' : p.pos ?? '-', age: p.age, l, q: batQualified(l, season.teams[team].g), war: war.get(p.idx) ?? null };
  });
}

/** 상대한 타자가 있는 선수 전부 (던진 야수 포함) */
export function pitRecs(players: SimPlayer[], season: Pick<Season, 'pit' | 'teams'>, war: Map<number, number>): PitRec[] {
  return players.filter((p) => season.pit[p.idx].bf > 0 && season.teams[lineTeam(p)]).map((p) => {
    const team = lineTeam(p);
    const l = season.pit[p.idx];
    return { p, team, role: pitRole(l), age: p.age, l, q: pitQualified(l, season.teams[team].g), war: war.get(p.idx) ?? null };
  });
}

export interface RecFilter {
  /** 'all' | 구단 색인 */
  team: 'all' | number;
  /** 자리 약자 (타자 C 1B … DH, 투수 SP·RP). 빈 글자는 전체 */
  pos: string;
  /** 이 나이 이하만 (null은 전체). 나이를 모르는 선수는 뺀다 */
  ageMax: number | null;
  /** 규정 이상만 */
  qualified: boolean;
}

export const EMPTY_REC_FILTER: RecFilter = { team: 'all', pos: '', ageMax: null, qualified: false };

export function filterRecs<R extends BatRec | PitRec>(rows: R[], f: RecFilter): R[] {
  return rows.filter((r) => {
    if (f.team !== 'all' && r.team !== f.team) return false;
    if (f.pos && ('role' in r ? r.role : r.pos) !== f.pos) return false;
    if (f.ageMax !== null && (r.age === null || r.age > f.ageMax)) return false;
    if (f.qualified && !r.q) return false;
    return true;
  });
}
