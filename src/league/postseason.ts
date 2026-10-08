// 포스트시즌(가을야구) (M7): 정규시즌 순위 상위 팀의 사다리식 시리즈. 정규시즌 기록에는 남기지 않는다.
//
// 2015년 이후 방식 (자료집 "시즌구조"·"제도연표", 출처 확인): 4위 대 5위 와일드카드 → 준플레이오프(3위) → 플레이오프(2위) → 한국시리즈(1위).
// 시리즈 길이와 와일드카드 1승 어드밴티지, 포스트시즌 연장 이닝은 자료집에서 확인하지 못한 값이라 임시값이다.
// 한국시리즈 홈경기 2-3-2 방식은 자료집 2025년 비고에 있다 (출처 확인).
//
// 진행 상태(PostseasonState)는 JSON으로 저장할 수 있고 한 경기씩 진행한다 (플레이어가 가을야구를 직접 진행, 2026-10-08 사용자 요청).
// 난수 위치를 상태에 담으므로 저장했다 이어 해도 결과가 같다.

import {
  emptyBatLine, emptyLeagueCounters, emptyPitLine, Rng, type BoxBatter, type BoxPitcher, type BoxScore, type Season, type SimPlayer,
} from '../engine';

export type SeriesRound = 'wc' | 'semi' | 'po' | 'ks';

export const ROUND_LABEL: Record<SeriesRound, string> = {
  wc: '와일드카드 결정전', semi: '준플레이오프', po: '플레이오프', ks: '한국시리즈',
};

interface RoundRule {
  /** 이기면 끝나는 승수 */
  need: number;
  /** 최대 경기 수 (무승부가 이어지면 여기서 멈추고 상위 팀이 올라간다) */
  maxGames: number;
  /** 상위 팀이 갖고 시작하는 승수 */
  highHeadStart: number;
  /** 경기별 홈 팀 (true = 상위 팀 홈) */
  homePattern: boolean[];
}

/** 시리즈 규칙 (임시값: 시리즈 길이·어드밴티지는 실제 규정 미확인. 한국시리즈 2-3-2는 출처 확인) */
export const RULES: Record<SeriesRound, RoundRule> = {
  wc: { need: 2, maxGames: 2, highHeadStart: 1, homePattern: [true, true] },
  semi: { need: 3, maxGames: 6, highHeadStart: 0, homePattern: [true, true, false, false, true, true] },
  po: { need: 3, maxGames: 6, highHeadStart: 0, homePattern: [true, true, false, false, true, true] },
  ks: { need: 4, maxGames: 9, highHeadStart: 0, homePattern: [true, true, false, false, false, true, true, true, true] },
};

/** 포스트시즌 연장 한계 이닝 (임시값: 자료집에는 2024년까지 15회만 확인) */
export const POSTSEASON_MAX_INNINGS = 15;
/** 정규시즌이 끝나고 포스트시즌 첫 경기까지 쉬는 날 (임시값) */
const REST_BEFORE = 3;
/** 시리즈 사이에 쉬는 날 (임시값) */
const REST_BETWEEN = 2;

export interface SeriesGame {
  /** 일정 색인 (정규시즌 일정 뒤로 이어진다. 달력 날짜는 calendar.ts) */
  day: number;
  home: number;
  away: number;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  box?: BoxScore;
}

export interface SeriesResult {
  round: SeriesRound;
  /** 상위 시드 팀 (구단 색인) */
  high: number;
  low: number;
  winsHigh: number;
  winsLow: number;
  /** 이긴 팀. 진행 중이면 -1 */
  winner: number;
  games: SeriesGame[];
}

export interface PostseasonResult {
  year: number;
  /** 진출 팀 (정규시즌 순위 순) */
  seeds: number[];
  series: SeriesResult[];
  champion: number;
  runnerUp: number;
}

/** 진행 중인 포스트시즌 (저장 가능) */
export interface PostseasonState {
  format: 1;
  year: number;
  seed: string;
  seeds: number[];
  rounds: SeriesRound[];
  /** 끝났거나 진행 중인 시리즈 (마지막이 진행 중일 수 있다) */
  series: SeriesResult[];
  /** 다음 경기 날짜 (일정 색인) */
  day: number;
  /** 난수 위치 */
  rng: number;
  done: boolean;
}

/** 진출 팀 수에 따른 라운드 순서 (낮은 라운드부터). 5팀이면 와일드카드부터 */
function roundsFor(n: number): SeriesRound[] {
  if (n >= 5) return ['wc', 'semi', 'po', 'ks'];
  if (n === 4) return ['semi', 'po', 'ks'];
  if (n === 3) return ['po', 'ks'];
  return ['ks'];
}

/** 대진을 정한다 (아직 경기는 치르지 않는다). standings는 정규시즌 순위, n은 진출 팀 수 */
export function startPostseason(season: Season, standings: number[], n: number, seed: string): PostseasonState {
  const seeds = standings.slice(0, Math.max(2, Math.min(n, standings.length)));
  const rounds = roundsFor(seeds.length);
  const rngSeed = `${seed}/postseason`;
  const st: PostseasonState = {
    format: 1, year: season.world.year, seed: rngSeed, seeds, rounds, series: [],
    day: season.schedule.length + REST_BEFORE, rng: new Rng(rngSeed).state(), done: false,
  };
  openSeries(st, seeds[seeds.length - 1]);
  return st;
}

/** i번째 라운드 시리즈를 연다. 사다리: 가장 낮은 두 시드부터, 이긴 팀이 다음 상위 시드를 만난다 */
function openSeries(st: PostseasonState, challenger: number): void {
  const i = st.series.length;
  const round = st.rounds[i];
  const high = st.seeds[st.seeds.length - 2 - i];
  st.series.push({ round, high, low: challenger, winsHigh: RULES[round].highHeadStart, winsLow: 0, winner: -1, games: [] });
}

/** 지금 진행 중인 시리즈 (끝났으면 null) */
export function currentSeries(st: PostseasonState): SeriesResult | null {
  return st.done ? null : st.series[st.series.length - 1];
}

/** 아직 탈락하지 않은 팀인가 (진출하지 못한 팀은 false) */
export function stillAlive(st: PostseasonState, team: number): boolean {
  if (!st.seeds.includes(team)) return false;
  if (st.done) return false;
  for (const x of st.series) if (x.winner >= 0 && x.winner !== team && (x.high === team || x.low === team)) return false;
  return true;
}

/** 다음 경기를 치른다. 끝났으면 null. 시리즈가 끝나면 다음 시리즈를 연다 */
export function playNextGame(st: PostseasonState, season: Season): SeriesGame | null {
  const x = currentSeries(st);
  if (!x) return null;
  const rule = RULES[x.round];
  const highHome = rule.homePattern[x.games.length] ?? true;
  const home = highHome ? x.high : x.low;
  const away = highHome ? x.low : x.high;
  const rng = Rng.fromState(st.seed, st.rng);
  const n = season.world.players.length;
  const rec = { bat: Array.from({ length: n }, emptyBatLine), pit: Array.from({ length: n }, emptyPitLine), totals: emptyLeagueCounters() };
  const { result: r, home: hl, away: al } = season.playExtraGame(home, away, st.day, rng, POSTSEASON_MAX_INNINGS, rec);
  st.rng = rng.state();
  const g: SeriesGame = {
    day: st.day, home, away, homeRuns: r.homeRuns, awayRuns: r.awayRuns, innings: r.innings,
    box: {
      lineScore: r.lineScore,
      home: { batters: boxBat(hl, rec.bat), pitchers: boxPit(r.homeStaff, rec.pit) },
      away: { batters: boxBat(al, rec.bat), pitchers: boxPit(r.awayStaff, rec.pit) },
    },
  };
  x.games.push(g);
  if (r.homeRuns !== r.awayRuns) {
    if ((home === x.high) === (r.homeRuns > r.awayRuns)) x.winsHigh++;
    else x.winsLow++;
  }
  st.day++;
  if (x.winsHigh >= rule.need || x.winsLow >= rule.need || x.games.length >= rule.maxGames) {
    // 승수가 같거나 경기 수 한도에 걸리면 상위 팀이 올라간다 (임시 규칙)
    x.winner = x.winsLow >= rule.need || x.winsLow > x.winsHigh ? x.low : x.high;
    if (st.series.length === st.rounds.length) st.done = true;
    else {
      st.day += REST_BETWEEN;
      openSeries(st, x.winner);
    }
  }
  return g;
}

function boxBat(lineup: SimPlayer[], bat: ReturnType<typeof emptyBatLine>[]): BoxBatter[] {
  return lineup.map((p) => {
    const b = bat[p.idx];
    return { idx: p.idx, ab: b.ab, r: b.r, h: b.h, rbi: b.rbi, hr: b.hr, bb: b.bb, so: b.so };
  });
}

function boxPit(staff: number[], pit: ReturnType<typeof emptyPitLine>[]): BoxPitcher[] {
  return staff.map((idx) => {
    const q = pit[idx];
    return { idx, outs: q.outs, bf: q.bf, h: q.h, r: q.r, er: q.er, bb: q.bb, so: q.so, hr: q.hr };
  });
}

/** 남은 경기를 모두 치른다 */
export function finishPostseason(st: PostseasonState, season: Season): void {
  while (!st.done) playNextGame(st, season);
}

/** 끝난 포스트시즌의 결과 (박스스코어는 빼고 가볍게) */
export function resultOf(st: PostseasonState): PostseasonResult {
  if (!st.done) throw new Error('포스트시즌이 끝나지 않았습니다');
  const last = st.series[st.series.length - 1];
  return {
    year: st.year, seeds: st.seeds,
    series: st.series.map((x) => ({ ...x, games: x.games.map(({ box: _box, ...g }) => g) })),
    champion: last.winner, runnerUp: last.winner === last.high ? last.low : last.high,
  };
}

/** 포스트시즌을 한 번에 치른다 (같은 시즌·같은 seed면 한 경기씩 진행한 것과 결과가 같다) */
export function simulatePostseason(season: Season, standings: number[], n: number, seed: string): PostseasonResult {
  const st = startPostseason(season, standings, n, seed);
  finishPostseason(st, season);
  return resultOf(st);
}
