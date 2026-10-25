// 양대 리그 포스트시즌 (일정 개편 13단계, 기획안 10.5·10.7 A4): 대진(bracket), 조건부 준플레이오프, 교차 플레이오프, 동시 시리즈, 홈 순서, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, rankWithTiebreak, type TeamRecord } from '../src/engine';
import { emptyTeamRecord } from '../src/engine/types';
import { seasonPostseasonPlaces } from '../src/game/rank';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import {
  bracketFor, bracketText, currentSeries, finishPostseason, isSeoulTeam, openBracket, playNextGame, resultOf, semiCheckText, seriesHome, seriesRngKey,
  startPostseason, TWO_LEAGUE_RULES, type PostseasonState, type SeriesResult,
} from '../src/league/postseason';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rec = (w: number, l: number): TeamRecord => ({ ...emptyTeamRecord(), g: w + l, w, l });

// 드림 0·1·2·3, 매직 4·5·6·7
const tablesOf = (teams: TeamRecord[]) => [
  { name: '드림', teams: rankWithTiebreak([0, 1, 2, 3], teams, []) },
  { name: '매직', teams: rankWithTiebreak([4, 5, 6, 7], teams, []) },
];
const orderOf = (teams: TeamRecord[]) => rankWithTiebreak([0, 1, 2, 3, 4, 5, 6, 7], teams, []);
const NAMES_1999 = ['두산', '롯데', '현대', '해태', '삼성', '한화', 'LG', '쌍방울'];
const NAMES_2000 = ['현대', '두산', '삼성', '해태', 'LG', '롯데', '한화', 'SK'];
// 실제 성적 (기획안 10.5. 1999 드림: 두산 76-51, 롯데 75-52, 현대 68-59, 해태 60-69 / 매직: 삼성 73-57, 한화 72-58, LG 61-70, 쌍방울 28-97)
const REAL_1999 = [rec(76, 51), rec(75, 52), rec(68, 59), rec(60, 69), rec(73, 57), rec(72, 58), rec(61, 70), rec(28, 97)];
// 2000 드림: 현대 91-40, 두산 76-57, 삼성 69-59, 해태 57-72 / 매직: LG 67-63, 롯데 65-64, 한화 50-78, SK 44-86
const REAL_2000 = [rec(91, 40), rec(76, 57), rec(69, 59), rec(57, 72), rec(67, 63), rec(65, 64), rec(50, 78), rec(44, 86)];

/** 시즌 기록을 실제 성적으로 바꾼다 (names 순서대로 REAL의 기록). 구단 색인 → names 순서 */
function setRecords(g: GameSession, names: string[], real: TeamRecord[]): number[] {
  const idx = names.map((n) => g.world.teams.findIndex((t) => t.name === n));
  expect(idx.every((i) => i >= 0)).toBe(true);
  idx.forEach((t, k) => { g.season.teams[t] = { ...real[k] }; });
  return idx;
}

beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('대진 만들기 (bracketFor)', () => {
  it('1999 실제 승률: 준플레이오프 없이 두산 대 한화·삼성 대 롯데', () => {
    const b = bracketFor(orderOf(REAL_1999), tablesOf(REAL_1999), REAL_1999, []);
    expect(b.semiCheck.map((c) => c.open)).toEqual([false, false]);
    expect(b.bracket.map((x) => x.round)).toEqual(['po', 'po', 'ks']);
    const team = (s: { seed: number } | { winnerOf: number }) => ('seed' in s ? b.seeds[s.seed] : -1 - s.winnerOf);
    expect(b.bracket.slice(0, 2).map((x) => [team(x.high), team(x.low)])).toEqual([[0, 5], [4, 1]]);
    expect(b.bracket[2]).toMatchObject({ high: { winnerOf: 0 }, low: { winnerOf: 1 }, byRank: true });
    expect([...b.seeds].sort()).toEqual([0, 1, 4, 5]);
    expect(b.seedLabels[b.seeds.indexOf(5)]).toBe('매직 2위');
    const name = (t: number) => NAMES_1999[t];
    expect(semiCheckText(b, name)).toBe('두 리그 3위 모두 다른 리그 2위보다 승률이 낮아 준플레이오프가 없습니다 (드림 3위 현대 .535 < 매직 2위 한화 .554, 매직 3위 LG .466 < 드림 2위 롯데 .591).');
    expect(bracketText({ ...b, series: [] }, name)).toBe('플레이오프 드림 1위 두산 대 매직 2위 한화 · 매직 1위 삼성 대 드림 2위 롯데');
  });

  it('2000 실제 승률: 롯데 대 삼성 준플레이오프 뒤 현대 대 (승자)·LG 대 두산', () => {
    const b = bracketFor(orderOf(REAL_2000), tablesOf(REAL_2000), REAL_2000, []);
    expect(b.bracket.map((x) => x.round)).toEqual(['semi', 'po', 'po', 'ks']);
    const team = (s: { seed: number } | { winnerOf: number }) => ('seed' in s ? b.seeds[s.seed] : -1 - s.winnerOf);
    // 준플레이오프: 상위 = 매직 2위 롯데(1차전 홈), 하위 = 드림 3위 삼성
    expect([team(b.bracket[0].high), team(b.bracket[0].low)]).toEqual([5, 2]);
    expect([team(b.bracket[1].high), team(b.bracket[1].low)]).toEqual([0, -1]); // 현대 대 준플레이오프 승자
    expect([team(b.bracket[2].high), team(b.bracket[2].low)]).toEqual([4, 1]); // LG 대 두산
    expect(b.bracket[3]).toMatchObject({ round: 'ks', high: { winnerOf: 1 }, low: { winnerOf: 2 } });
    expect(b.seeds).toHaveLength(5);
    const name = (t: number) => NAMES_2000[t];
    expect(semiCheckText(b, name)).toBe('드림 3위 삼성(.539)이 매직 2위 롯데(.504)보다 승률이 높아 준플레이오프를 치릅니다.');
    expect(bracketText({ ...b, series: [] }, name))
      .toBe('준플레이오프 매직 2위 롯데 대 드림 3위 삼성, 플레이오프 드림 1위 현대 대 준플레이오프 승자 · 매직 1위 LG 대 드림 2위 두산');
  });

  it('매직 3위가 드림 2위보다 높으면 그 둘 (드림 1위 대 매직 2위는 그대로)', () => {
    // 드림: 0 80-50, 1 66-64 / 매직: 4 85-45, 5 75-55, 6 70-60
    const teams = [rec(80, 50), rec(66, 64), rec(60, 70), rec(50, 80), rec(85, 45), rec(75, 55), rec(70, 60), rec(40, 90)];
    const b = bracketFor(orderOf(teams), tablesOf(teams), teams, []);
    const team = (s: { seed: number } | { winnerOf: number }) => ('seed' in s ? b.seeds[s.seed] : -1 - s.winnerOf);
    expect(b.bracket.map((x) => [x.round, team(x.high), team(x.low)])).toEqual([['semi', 1, 6], ['po', 0, 5], ['po', 4, -1], ['ks', -2, -3]]);
  });

  it('난수 줄기: 대진이 있으면 노드 번호가 들어가 두 플레이오프 1차전이 다르고, 사다리 키는 예전 그대로', () => {
    expect(seriesRngKey({ round: 'po', node: 1 }, 0)).toBe('ps/po.1/0');
    expect(seriesRngKey({ round: 'po', node: 2 }, 0)).not.toBe(seriesRngKey({ round: 'po', node: 1 }, 0));
    expect(seriesRngKey({ round: 'po' }, 0)).toBe('ps/po/0');
  });
});

describe('2000 실제 성적으로 가을야구 진행', () => {
  let g: GameSession;
  let T: number[];
  let st: PostseasonState;
  beforeAll(() => {
    g = GameSession.create(store, { year: 2000, teamIdx: 0, seed: 'ps-div-2000' }, FAST);
    g.advance(100000);
    T = setRecords(g, NAMES_2000, REAL_2000);
    st = startPostseason(g.season, g.season.standings(), 4, 'real-2000');
    finishPostseason(st, g.season);
  }, 300_000);
  const node = (i: number) => st.series.find((x) => x.node === i)!;
  const homes = (x: SeriesResult) => x.games.map((q) => (q.neutral ? 'n' : q.home === x.high ? 'H' : 'L')).join('');

  it('대진: 준플레이오프 롯데 대 삼성, 그 승자 대 현대, LG 대 두산', () => {
    expect([node(0).round, node(0).high, node(0).low]).toEqual(['semi', T[5], T[2]]);
    expect([node(1).high, node(1).low]).toEqual([T[0], node(0).winner]);
    expect([node(2).high, node(2).low]).toEqual([T[4], T[1]]);
    expect(st.seedLabels).toEqual(st.seeds.map((t) => ({ [T[0]]: '드림 1위', [T[1]]: '드림 2위', [T[2]]: '드림 3위', [T[4]]: '매직 1위', [T[5]]: '매직 2위' })[t]));
    expect(st.done).toBe(true);
  });

  it('홈 순서: 준플레이오프 1-1-1 (3차전 중립), 플레이오프 2-3-2', () => {
    expect(homes(node(0))).toBe('HLn'.slice(0, node(0).games.length));
    for (const i of [1, 2]) expect(homes(node(i))).toBe('HHLLLHHHH'.slice(0, node(i).games.length));
    // 중립 경기는 상위 팀 홈으로 계산
    for (const q of st.series.flatMap((x) => x.games.filter((y) => y.neutral).map((y) => [y.home, x.high]))) expect(q[0]).toBe(q[1]);
  });

  it('한국시리즈: 통합 승률 상위가 상위 팀, 서울 구단이 있으면 2-3-2, 없으면 2-2-3 (5~7차전 중립)', () => {
    const ks = node(3);
    expect(st.seeds.indexOf(ks.high)).toBeLessThan(st.seeds.indexOf(ks.low));
    const seoul = isSeoulTeam(g.world, ks.high) || isSeoulTeam(g.world, ks.low);
    expect(ks.rule).toEqual(seoul ? TWO_LEAGUE_RULES.ks232 : TWO_LEAGUE_RULES.ks223);
    expect(homes(ks)).toBe((seoul ? 'HHLLLHHHH' : 'HHLLnnnnn').slice(0, ks.games.length));
    expect(resultOf(st).champion).toBe(ks.winner);
  });

  it('동시 시리즈: 준플레이오프와 LG 대 두산이 같은 날 시작, 현대 쪽은 준플레이오프 뒤 쉬고, 한국시리즈는 두 플레이오프 뒤', () => {
    const first = (x: SeriesResult) => x.games[0].day;
    const last = (x: SeriesResult) => x.games[x.games.length - 1].day;
    expect(first(node(0))).toBe(first(node(2)));
    expect(first(node(1))).toBe(last(node(0)) + 3);
    expect(first(node(3))).toBe(Math.max(last(node(1)), last(node(2))) + 3);
    // 시리즈마다 하루 한 경기, 날짜가 이어진다
    for (const x of st.series) x.games.forEach((q, i) => i && expect(q.day).toBe(x.games[i - 1].day + 1));
  });

  it('서울 구단 판정: 1999·2000 두산·LG만 잠실', () => {
    expect(T.map((t) => isSeoulTeam(g.world, t))).toEqual([false, true, false, false, true, false, false, false]);
  });
});

describe('한국시리즈 규칙 고르기 (1999 대진, 플레이오프 승자를 정해 둔다)', () => {
  let g: GameSession;
  let T: number[];
  beforeAll(() => {
    g = GameSession.create(store, { year: 1999, teamIdx: 0, seed: 'ps-div-1999' }, FAST);
    g.advance(100000);
    T = setRecords(g, NAMES_1999, REAL_1999);
  }, 300_000);
  const ksWith = (w0: number, w1: number): { ks: SeriesResult; start: number } => {
    const st = startPostseason(g.season, g.season.standings(), 4, 'ks-rule');
    expect(st.series.map((x) => x.node)).toEqual([0, 1]);
    // 두 플레이오프를 다른 날 끝난 것으로 둔다 (첫 노드 start + 4, 둘째 start + 5)
    st.series.forEach((x, i) => {
      x.winner = [w0, w1][i];
      x.games = [{ day: st.day + 4 + i, home: x.high, away: x.low, homeRuns: 1, awayRuns: 0, innings: 9 }];
    });
    openBracket(st, g.world, st.day);
    return { ks: st.series[2], start: st.day };
  };

  it('지방 두 팀 (한화·롯데): 2-2-3, 상위는 통합 승률이 높은 롯데. 첫 경기는 늦게 끝난 플레이오프 + 3일', () => {
    const { ks, start } = ksWith(T[5], T[1]);
    expect([ks.round, ks.high, ks.low]).toEqual(['ks', T[1], T[5]]);
    expect(ks.rule).toEqual(TWO_LEAGUE_RULES.ks223);
    expect([4, 5, 6].map((i) => seriesHome(ks, i).neutral)).toEqual([true, true, true]);
    expect([0, 1, 2, 3].map((i) => seriesHome(ks, i).home)).toEqual([T[1], T[1], T[5], T[5]]);
    expect(ks.nextDay).toBe(start + 5 + 3);
  });

  it('서울 구단이 있으면 (두산·롯데): 2-3-2, 상위 두산', () => {
    const { ks } = ksWith(T[0], T[1]);
    expect([ks.high, ks.low]).toEqual([T[0], T[1]]);
    expect(ks.rule).toEqual(TWO_LEAGUE_RULES.ks232);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => seriesHome(ks, i).home === ks.high)).toEqual([true, true, false, false, false, true, true]);
    expect([0, 1, 2, 3, 4, 5, 6].some((i) => seriesHome(ks, i).neutral)).toBe(false);
  });
});

describe('양대 리그 해 세션: 대진 소식, 진행 단위, 저장·재현', () => {
  const opts = { year: 2000, teamIdx: 0, seed: 'ps-div-play' };
  let full: ReturnType<typeof resultOf>;
  let base: GameSession;
  let save: GameSaveV2;
  beforeAll(() => {
    base = GameSession.create(store, opts, FAST);
    base.advance(100000);
    // 저장을 먼저 떠 둔다 (base.season으로 가을야구를 치르면 선수 피로가 바뀌어 저장에 들어간다)
    save = roundTrip(base.toSave()) as GameSaveV2;
    const c = GameSession.load(store, roundTrip(save), FAST);
    finishPostseason(c.postseason!, c.season);
    full = roundTrip(resultOf(c.postseason!));
  }, 300_000);

  it('정규시즌이 끝나면 대진이 서고, 진출 팀은 순위 화면의 가을야구권과 같다', () => {
    const ps = base.postseason!;
    expect(ps.bracket).toBeDefined();
    expect(ps.seeds).toEqual(seasonPostseasonPlaces(base.season, base.world.rules.postseasonTeams));
    const news = base.news.find((n) => n.text.startsWith('가을야구 대진'))!.text;
    expect(news).toContain('플레이오프 드림 1위');
    expect(news).toContain(ps.semiCheck!.some((c) => c.open) ? '준플레이오프를 치릅니다' : '준플레이오프가 없습니다');
  });

  it('같은 날 두 경기는 함께 치르고, 한 경기씩·시리즈 단위·중간 저장·화면 조회를 끼워도 한 번에 치른 결과와 같다', () => {
    const g = GameSession.load(store, roundTrip(save), FAST);
    const day = g.postseason!.day;
    const today = g.postseason!.series.filter((x) => x.nextDay === day).length;
    expect(g.advancePostseason(1)).toBe(today);
    expect(g.postseason!.day).toBeGreaterThan(day);
    g.activeTeam();
    g.advanceSeries();
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    while (h.postseasonRunning) { h.activeTeam(); h.advancePostseason(1); }
    expect(resultOf(h.postseason!)).toEqual(full);
    // 조작 기록으로 다시 돌려도 같다
    const r = GameSession.replay(store, opts, h.actions, undefined, FAST);
    r.advance(100000);
    r.advancePostseason(100000);
    expect(resultOf(r.postseason!)).toEqual(full);
  });

  it('지금 시리즈(currentSeries)는 다음 경기 날이 가장 이른 시리즈, 같은 날이면 대진 순서', () => {
    const g = GameSession.load(store, roundTrip(save), FAST);
    const st = g.postseason!;
    for (let k = 0; k < 6 && !st.done; k++) {
      const x = currentSeries(st)!;
      const open = st.series.filter((s) => s.winner < 0);
      expect(x.nextDay).toBe(Math.min(...open.map((s) => s.nextDay!)));
      expect(x.nextDay).toBe(st.day);
      expect(open.filter((s) => s.nextDay === x.nextDay).every((s) => s.node! >= x.node!)).toBe(true);
      expect(playNextGame(st, g.season)!.day).toBe(x.games[x.games.length - 1].day);
    }
  }, 120_000);

  it('결산 뒤 지난 시즌 결과에 대진과 자리 이름이 남는다', () => {
    const g = GameSession.load(store, roundTrip(save), FAST);
    g.beginOffseason();
    const ps = g.league.lastSeason!.postseason!;
    expect(ps.champion).toBe(full.champion);
    expect(ps.bracket).toEqual(full.bracket);
    expect(ps.seedLabels).toEqual(full.seedLabels);
    expect(ps.series.map((x) => x.node)).toEqual(full.series.map((x) => x.node));
  }, 300_000);
});

describe('단일 리그 해는 사다리 그대로', () => {
  it('2001: 대진 없음, 대진 소식은 "1위 …" 꼴', () => {
    const g = GameSession.create(store, { year: 2001, teamIdx: 0, seed: 'ps-div-2001' }, FAST);
    g.advance(100000);
    const ps = g.postseason!;
    expect(ps.bracket).toBeUndefined();
    expect(ps.seeds).toEqual(g.season.standings().slice(0, g.world.rules.postseasonTeams));
    expect(g.news.find((n) => n.text.startsWith('가을야구 대진'))!.text).toMatch(/^가을야구 대진: 1위 /);
    g.advancePostseason(100000);
    // 시리즈 규칙은 연표의 그 해 승수(규칙 실제화, yearRoundRule)만: 대진 마디·양대 리그 규칙은 없다
    const st = g.postseason!;
    expect(resultOf(st).series.every((x) => x.node === undefined && JSON.stringify(x.rule) === JSON.stringify(st.roundRules?.[x.round]))).toBe(true);
  }, 300_000);
});
