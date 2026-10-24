// 리그별 순위 (일정 개편 12단계, 기획안 10.4·10.7 A3): 동률 규칙, divisionStandings, 리그 게임차, rankText, 가을야구권, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, rankTeams, rankWithTiebreak, winPct, type GameLog, type TeamRecord } from '../src/engine';
import { emptyTeamRecord } from '../src/engine/types';
import { GameSession } from '../src/game/session';
import { lastSeasonPlace, placeIn, placeLabel, postseasonPlaces, rankText, seasonPlace } from '../src/game/rank';
import { gamesBehind } from '../src/game/stats';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

const rec = (w: number, l: number, t = 0): TeamRecord => ({ ...emptyTeamRecord(), g: w + l + t, w, l, t });
const game = (home: number, away: number, homeRuns: number, awayRuns: number): GameLog =>
  ({ day: 0, home, away, homeRuns, awayRuns, innings: 9, win: null, loss: null, save: null });

describe('동률 규칙 (1999·2000, 기획안 10.4)', () => {
  it('승률이 다르면 승률 순 (무승부 제외, 승수는 보지 않는다)', () => {
    // 0: 76-51 (0.598), 1: 75-52-5 (0.591), 2: 60-60
    const teams = [rec(75, 52, 5), rec(76, 51), rec(60, 60)];
    expect(rankWithTiebreak([0, 1, 2], teams, [])).toEqual([1, 0, 2]);
    // 승률이 같고 승수가 다르다: 지금 규칙(rankTeams)은 승수로 가르지만 양대 리그 규칙은 상대 전적
    const tied = [rec(60, 60), rec(66, 66)];
    expect(rankTeams(tied)).toEqual([1, 0]);
    expect(rankWithTiebreak([0, 1], tied, [game(0, 1, 5, 3)])).toEqual([0, 1]);
  });

  it('① 승률이 같으면 그 구단들 사이 상대 전적 다승', () => {
    const teams = [rec(70, 60), rec(70, 60), rec(80, 50)];
    // 1이 0을 2승 1패로 앞선다. 2와의 경기는 세지 않는다
    const log = [game(0, 1, 1, 4), game(1, 0, 3, 2), game(0, 1, 9, 0), game(0, 2, 10, 0), game(2, 0, 0, 10)];
    expect(rankWithTiebreak([0, 1, 2], teams, log)).toEqual([2, 1, 0]);
  });

  it('② 상대 전적도 같으면 맞대결 득점', () => {
    const teams = [rec(70, 60), rec(70, 60)];
    // 1승 1패씩, 득점 0: 2+3 = 5, 1: 1+8 = 9. 무승부는 다승에 들지 않는다
    const log = [game(0, 1, 2, 1), game(1, 0, 8, 3), game(0, 1, 4, 4)];
    expect(rankWithTiebreak([0, 1], teams, log)).toEqual([1, 0]);
    // 맞대결 득점이 앞서면 0이 위
    expect(rankWithTiebreak([0, 1], teams, [game(0, 1, 2, 1), game(1, 0, 3, 2)])).toEqual([0, 1]);
  });

  it('③ 모두 같으면 전년도 순위 (전년도에 없으면 뒤, 그다음 색인)', () => {
    const teams = [rec(70, 60), rec(70, 60), rec(70, 60)];
    const log = [game(0, 1, 3, 2), game(1, 0, 3, 2), game(1, 2, 3, 2), game(2, 1, 3, 2), game(0, 2, 3, 2), game(2, 0, 3, 2)];
    expect(rankWithTiebreak([0, 1, 2], teams, log, [2, 0, 1])).toEqual([2, 0, 1]);
    expect(rankWithTiebreak([0, 1, 2], teams, log, [1])).toEqual([1, 0, 2]);
    expect(rankWithTiebreak([0, 1, 2], teams, log)).toEqual([0, 1, 2]);
  });
});

describe('가을야구권 (기획안 10.5 준플레이오프 조건)', () => {
  // 드림 0·1·2·3, 매직 4·5·6·7
  const tables = (teams: TeamRecord[]) => [
    { name: '드림', teams: rankWithTiebreak([0, 1, 2, 3], teams, []) },
    { name: '매직', teams: rankWithTiebreak([4, 5, 6, 7], teams, []) },
  ];
  const order = (teams: TeamRecord[]) => rankWithTiebreak([0, 1, 2, 3, 4, 5, 6, 7], teams, []);

  it('1999 실제 승률: 매직 2위 한화(0.554)가 드림 3위 현대(0.535)보다 높아 4팀', () => {
    // 드림: 두산 76-51, 롯데 75-52, 현대 68-59, 해태 60-69 / 매직: 삼성 73-57, 한화 72-58, LG 61-70, 쌍방울 28-97
    const teams = [rec(76, 51), rec(75, 52), rec(68, 59), rec(60, 69), rec(73, 57), rec(72, 58), rec(61, 70), rec(28, 97)];
    const ps = postseasonPlaces(order(teams), tables(teams), 4, teams, []);
    expect([...ps].sort()).toEqual([0, 1, 4, 5]);
  });

  it('2000 실제 승률: 드림 3위 삼성(0.539)이 매직 2위 롯데(0.504)보다 높아 5팀', () => {
    // 드림: 현대 91-40, 두산 76-57, 삼성 69-59, 해태 57-72 / 매직: LG 67-63, 롯데 65-64, 한화 50-78, SK 44-86
    const teams = [rec(91, 40), rec(76, 57), rec(69, 59), rec(57, 72), rec(67, 63), rec(65, 64), rec(50, 78), rec(44, 86)];
    const ps = postseasonPlaces(order(teams), tables(teams), 4, teams, []);
    expect(ps).toEqual(order(teams).filter((t) => [0, 1, 2, 4, 5].includes(t)));
    expect(ps).toHaveLength(5);
  });

  it('3위와 다른 리그 2위의 승률이 같으면 동률 규칙으로 가린다', () => {
    const teams = [rec(80, 50), rec(75, 55), rec(70, 60), rec(50, 80), rec(80, 50), rec(70, 60), rec(60, 70), rec(40, 90)];
    // 드림 3위(2)와 매직 2위(5)가 0.538로 같다: 맞대결에서 2가 앞서면 준플레이오프
    expect(postseasonPlaces(order(teams), tables(teams), 4, teams, [game(2, 5, 3, 1)])).toContain(2);
    expect(postseasonPlaces(order(teams), tables(teams), 4, teams, [game(5, 2, 3, 1)])).not.toContain(2);
  });

  it('단일 리그 해는 상위 cut팀', () => {
    expect(postseasonPlaces([3, 1, 0, 2, 4], null, 3, [], [])).toEqual([3, 1, 0]);
  });
});

describe('리그별 순위표와 문장', () => {
  it('리그 게임차는 그 리그 1위 기준, 문장은 "드림 2위" / 단일 리그는 "3위"', () => {
    const teams = [rec(80, 50), rec(75, 55), rec(90, 40), rec(70, 60)];
    const tables = [{ name: '드림', teams: [0, 1] }, { name: '매직', teams: [2, 3] }];
    const p = placeIn([2, 0, 1, 3], tables, 1);
    expect(p).toEqual({ league: '드림', order: [0, 1], rank: 2 });
    expect(placeLabel(p)).toBe('드림 2위');
    expect(gamesBehind(teams[p.order[0]], teams[1])).toBe(5);
    // 통합 1위 기준이면 15경기 차
    expect(gamesBehind(teams[2], teams[1])).toBe(15);
    expect(placeLabel(placeIn([2, 0, 1, 3], null, 1))).toBe('3위');
    expect(placeLabel(placeIn([2, 0], null, 1))).toBe('');
  });

  it('2026은 단일 리그: divisionStandings 없음, 통합 순위·문장이 그대로', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'div-2026' }, FAST);
    g.advance(40);
    const s = g.season;
    expect(s.divisionStandings()).toBeNull();
    expect(s.standings()).toEqual(rankTeams(s.teams));
    expect(rankText(g, 2)).toBe(`${s.standings().indexOf(2) + 1}위`);
    expect(seasonPlace(s, 2).order).toEqual(s.standings());
  }, 120_000);

  it('1999 시즌: 리그마다 4팀 승률 순, 통합 순위는 두 리그를 합친 동률 규칙 순, 시즌 끝 소식·지난 시즌 순위가 리그 순위', () => {
    const g = GameSession.create(store, { year: 1999, teamIdx: 0, seed: 'div-1999' }, FAST);
    const w = g.world;
    expect(w.prevStandings).toHaveLength(8);
    g.advance(60);
    // 중간 저장 → 불러와 이어 한 결과가 끊김 없이 한 결과와 같다
    const mid = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (!g.done) g.advance(30);
    while (!mid.done) mid.advance(30);
    const s = g.season;
    const divs = s.divisionStandings()!;
    expect(divs.map((d) => d.name)).toEqual(['드림', '매직']);
    expect(divs.map((d) => [...d.teams].sort((a, b) => a - b))).toEqual(w.divisions!.teams);
    for (const d of divs) {
      for (let k = 1; k < d.teams.length; k++) expect(winPct(s.teams[d.teams[k - 1]])).toBeGreaterThanOrEqual(winPct(s.teams[d.teams[k]]));
    }
    const order = s.standings();
    expect(order).toEqual(rankWithTiebreak(order, s.teams, s.log, w.prevStandings));
    expect(mid.season.divisionStandings()).toEqual(divs);
    expect(mid.season.standings()).toEqual(order);
    // 문장
    const me = g.teamIdx;
    const mine = divs.find((d) => d.teams.includes(me))!;
    const label = `${mine.name} ${mine.teams.indexOf(me) + 1}위`;
    expect(rankText(g, me)).toBe(label);
    expect(g.news.some((n) => n.text.startsWith(`정규시즌 종료. ${g.team.name} 최종 ${label} (`))).toBe(true);
    // 결산 뒤: 지난 시즌 리그별 순위가 리그 상태에 남는다
    g.beginOffseason();
    expect(g.league.lastSeason!.divisions).toEqual(divs);
    expect(placeLabel(lastSeasonPlace(g.league, me)!)).toBe(label);
    expect(rankText(g, me)).toBe(label);
  }, 300_000);
});
