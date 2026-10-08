// 기록 계산: 비율 기록, 규정 타석·이닝, 부문별 순위.

import type { BatLine, PitLine, SimPlayer, TeamRecord } from '../engine';
import { rankTeams } from '../engine';

export const avg = (b: BatLine) => (b.ab > 0 ? b.h / b.ab : NaN);
export const obp = (b: BatLine) => {
  const d = b.ab + b.bb + b.hbp + b.sf;
  return d > 0 ? (b.h + b.bb + b.hbp) / d : NaN;
};
export const slg = (b: BatLine) => (b.ab > 0 ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : NaN);
export const ops = (b: BatLine) => obp(b) + slg(b);
export const era = (p: PitLine) => (p.outs > 0 ? (p.er * 27) / p.outs : p.er > 0 ? Infinity : NaN);
export const whip = (p: PitLine) => (p.outs > 0 ? ((p.h + p.bb) * 3) / p.outs : NaN);

/** 규정 타석: 팀 경기 수 × 3.1 */
export const qualifiedPa = (teamGames: number) => Math.floor(teamGames * 3.1);
/** 규정 이닝: 팀 경기 수 × 1 (아웃 수로) */
export const qualifiedOuts = (teamGames: number) => teamGames * 3;

/** 이닝 표기: 아웃 수 → "123 1/3" */
export function ipText(outs: number): string {
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return rem ? `${whole} ${rem}/3` : String(whole);
}

/** .312 형식 (1 이상이면 1.012) */
export function rate3(x: number): string {
  if (!Number.isFinite(x)) return '-';
  const s = x.toFixed(3);
  return x < 1 ? s.replace(/^0/, '') : s;
}

export function fixed2(x: number): string {
  if (x === Infinity) return '∞';
  return Number.isFinite(x) ? x.toFixed(2) : '-';
}

/** 게임차: 선두와의 차이 */
export function gamesBehind(leader: TeamRecord, t: TeamRecord): number {
  return (leader.w - t.w + (t.l - leader.l)) / 2;
}

export interface LeaderCategory<L> {
  key: string;
  label: string;
  /** 표시값 */
  show: (l: L) => string;
  /** 정렬값 (클수록 위) */
  score: (l: L) => number;
  /** 비율 기록이면 규정을 채운 선수만 */
  qualified?: boolean;
}

export const BAT_CATEGORIES: LeaderCategory<BatLine>[] = [
  { key: 'avg', label: '타율', show: (b) => rate3(avg(b)), score: avg, qualified: true },
  { key: 'hr', label: '홈런', show: (b) => String(b.hr), score: (b) => b.hr },
  { key: 'rbi', label: '타점', show: (b) => String(b.rbi), score: (b) => b.rbi },
  { key: 'h', label: '안타', show: (b) => String(b.h), score: (b) => b.h },
  { key: 'r', label: '득점', show: (b) => String(b.r), score: (b) => b.r },
  { key: 'sb', label: '도루', show: (b) => String(b.sb), score: (b) => b.sb },
  { key: 'obp', label: '출루율', show: (b) => rate3(obp(b)), score: obp, qualified: true },
  { key: 'slg', label: '장타율', show: (b) => rate3(slg(b)), score: slg, qualified: true },
  { key: 'ops', label: 'OPS', show: (b) => rate3(ops(b)), score: ops, qualified: true },
];

export const PIT_CATEGORIES: LeaderCategory<PitLine>[] = [
  { key: 'era', label: '평균자책', show: (p) => fixed2(era(p)), score: (p) => -era(p), qualified: true },
  { key: 'w', label: '승리', show: (p) => String(p.w), score: (p) => p.w },
  { key: 'sv', label: '세이브', show: (p) => String(p.sv), score: (p) => p.sv },
  { key: 'so', label: '탈삼진', show: (p) => String(p.so), score: (p) => p.so },
  { key: 'ip', label: '이닝', show: (p) => ipText(p.outs), score: (p) => p.outs },
  { key: 'whip', label: 'WHIP', show: (p) => fixed2(whip(p)), score: (p) => -whip(p), qualified: true },
];

export interface LeaderRow<L> {
  player: SimPlayer;
  line: L;
  value: string;
}

/**
 * 부문별 순위. 비율 부문은 규정을 채운 선수만 (규정은 각 선수 소속 팀의 경기 수 기준).
 * 동률은 같은 순위가 아니라 선수 색인 순으로 늘어놓는다.
 */
export function leaders<L extends BatLine | PitLine>(
  players: SimPlayer[], lines: L[], cat: LeaderCategory<L>, teams: TeamRecord[], isQualified: (l: L, teamGames: number) => boolean, n = 10,
): LeaderRow<L>[] {
  return players
    .filter((p) => {
      const l = lines[p.idx];
      if (!cat.qualified) return true;
      return isQualified(l, teams[p.teamIdx].g) && Number.isFinite(cat.score(l));
    })
    .map((p) => ({ p, s: cat.score(lines[p.idx]) }))
    .filter((x) => Number.isFinite(x.s) && (cat.qualified || x.s > 0))
    .sort((a, b) => b.s - a.s || a.p.idx - b.p.idx)
    .slice(0, n)
    .map(({ p }) => ({ player: p, line: lines[p.idx], value: cat.show(lines[p.idx]) }));
}

export const batQualified = (b: BatLine, g: number) => b.pa >= qualifiedPa(g) && b.pa > 0;
export const pitQualified = (p: PitLine, g: number) => p.outs >= qualifiedOuts(g) && p.outs > 0;

/** 최근 n경기 성적과 연속 기록 */
export function recentForm(log: { home: number; away: number; homeRuns: number; awayRuns: number }[], teamIdx: number, n = 10) {
  const results: ('W' | 'L' | 'T')[] = [];
  for (const g of log) {
    if (g.home !== teamIdx && g.away !== teamIdx) continue;
    const mine = g.home === teamIdx ? g.homeRuns : g.awayRuns;
    const theirs = g.home === teamIdx ? g.awayRuns : g.homeRuns;
    results.push(mine > theirs ? 'W' : mine < theirs ? 'L' : 'T');
  }
  const last = results.slice(-n);
  let streak = '';
  if (results.length) {
    const r = results[results.length - 1];
    let k = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === r; i--) k++;
    streak = `${k}${r === 'W' ? '연승' : r === 'L' ? '연패' : '무'}`;
  }
  return {
    w: last.filter((x) => x === 'W').length,
    l: last.filter((x) => x === 'L').length,
    t: last.filter((x) => x === 'T').length,
    streak,
  };
}

export { rankTeams };
