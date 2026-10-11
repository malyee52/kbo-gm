// 도전 모드 (league/challenges.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { challengeById, judgeChallenge, lastPlaceTeam, newChallenge } from '../src/league/challenges';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

const leagueWith = (id: string, from = 2026) => ({ challenge: newChallenge(challengeById(id)!, 3, from) }) as unknown as LeagueState;
const out = (o: Partial<{ champion: number | null; first: number | null; postseason: number[]; rescue: number; userTeam: number }> = {}) =>
  ({ userTeam: 3, champion: null, first: null, postseason: [], rescue: 0, ...o });

describe('판정', () => {
  it('3년 안에 정상: 우승하면 성공, 기한이 지나면 실패', () => {
    const L = leagueWith('quick');
    expect(judgeChallenge(L, 2026, out())!.result).toBeUndefined();
    expect(judgeChallenge(L, 2027, out({ champion: 3 }))!.result).toBe('success');
    const M = leagueWith('quick');
    judgeChallenge(M, 2026, out()); judgeChallenge(M, 2027, out());
    expect(judgeChallenge(M, 2028, out())).toMatchObject({ result: 'fail', why: '기한이 지났습니다' });
  });

  it('왕조: 3년 연속 우승이면 성공, 남은 시즌으로 못 채우면 일찍 실패', () => {
    const L = leagueWith('dynasty');
    for (const y of [2026, 2027]) judgeChallenge(L, y, out({ champion: 3 }));
    expect(judgeChallenge(L, 2028, out({ champion: 3 }))!.result).toBe('success');
    const M = leagueWith('dynasty');
    for (let y = 2026; y <= 2033; y++) judgeChallenge(M, y, out());
    expect(M.challenge!.result).toBe('fail'); // 2033 결산 뒤 남은 2시즌으로 3연패 불가
  });

  it('적자 없는 강팀: 긴급 지원을 받으면 바로 실패, 5시즌에 가을야구 3번이면 성공', () => {
    const L = leagueWith('thrift');
    expect(judgeChallenge(L, 2026, out({ rescue: 1 }))!.result).toBe('fail');
    const M = leagueWith('thrift');
    for (const [y, ps] of [[2026, true], [2027, false], [2028, true], [2029, false]] as const) judgeChallenge(M, y, out({ postseason: ps ? [3] : [] }));
    expect(M.challenge!.result).toBeUndefined();
    expect(judgeChallenge(M, 2030, out({ postseason: [3] }))!.result).toBe('success');
  });

  it('구단을 떠나면 실패', () => {
    const L = leagueWith('quick');
    expect(judgeChallenge(L, 2026, out({ userTeam: 4 }))).toMatchObject({ result: 'fail', why: '도전 구단을 떠났습니다' });
  });
});

describe('게임에서', () => {
  it('직전 시즌 최하위 구단: 2026 시작이면 2025 최하위 구단', () => {
    const t = lastPlaceTeam(store, 2026)!;
    const prev = store.season(2025)!.teams;
    const worst = [...prev].sort((a, b) => b.rank - a.rank)[0];
    expect(store.season(2026)!.teams[t].franchise).toBe(worst.franchise);
    expect(lastPlaceTeam(store, 1982)).toBeNull();
  });

  it('도전으로 시작하면 진행이 리그 상태에 남고, 시즌 결산 때 판정·재현 정보에 들어간다', () => {
    const t = lastPlaceTeam(store, 2026)!;
    const g = GameSession.create(store, { year: 2026, teamIdx: t, seed: 'ch', challenge: 'last-to-first' }, FAST);
    expect(g.league.challenge).toMatchObject({ id: 'last-to-first', team: t, from: 2026, until: 2027 });
    expect(g.reproInfo().opts.challenge).toBe('last-to-first');
    g.advance(100000);
    g.beginOffseason();
    const c = g.league.challenge!;
    const first = g.league.yearbook!.find((y) => y.year === 2026)!.teams[0].franchise === g.team.franchise;
    expect(c.result).toBe(first ? 'success' : undefined);
    expect(g.news.some((n) => n.text.includes('도전 「꼴찌에서 1위로」'))).toBe(true);
  }, 300_000);
});
