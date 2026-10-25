// 리그 나눔이 닿는 곳 (일정 개편 14단계, 기획안 10.6·10.7 A5): 구단주·AI·감독 기준(10.8 결정 2), 축하, 연표 표시, 개막 알림, 캠페인 문구.
// 올스타 드림 대 매직은 tests/allstar.test.ts
import { strengthTier } from '../src/game/rank';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { divisionsOf } from '../src/data/schedule';
import { DEFAULT_PARAMS } from '../src/engine';
import { tendencyOf, type TeamSituation } from '../src/ai/trade';
import { achievements } from '../src/game/celebrate';
import { seasonPlace, seasonPostseasonPlaces } from '../src/game/rank';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';
import { condText, planById } from '../src/league/campaigns';
import { lastPlaceTeam } from '../src/league/challenges';
import { franchiseHistory, realYearbook, yearLeagues, yearPlaceLabel } from '../src/league/history';
import { openManagers } from '../src/league/managers';
import {
  goalFor, goalForLeague, newAchievements, newOwner, outcomeLabel, outcomeOf, outcomeTier, trustDelta, type OwnerState,
} from '../src/league/owner';
import type { PostseasonResult } from '../src/league/postseason';
import { leagueNews } from '../src/league/scheduleNews';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('구단주 평가 (10.8 결정 2: 문장은 리그 순위, 가을야구는 실제 진출, 꼴찌는 통합 순위)', () => {
  // 통합 순위 = 구단 색인 순 (0이 1위). 드림 0·2·3·5, 매직 1·4·6·7
  // 드림: 0(통합 1) 2(통합 3) 3(통합 4) 5(통합 6) / 매직: 1(통합 2) 4(통합 5) 6(통합 7) 7(통합 8)
  // 드림 3위 3이 매직 2위 4보다 승률이 높아 준플레이오프 → 진출 0·1·2·3·4
  const st = [0, 1, 2, 3, 4, 5, 6, 7];
  const ps = { year: 1999, seeds: [0, 1, 2, 3, 4], series: [], champion: 0, runnerUp: 1 } as unknown as PostseasonResult;

  it('리그 2위가 통합 5위여도 가을야구 목표 달성 (단일 리그 판정이면 진출 밖)', () => {
    const o = outcomeOf(4, st, ps, 4, false, { name: '매직', rank: 2 });
    expect(o.rank).toBe(5);
    expect(outcomeTier(o)).toBe(2);
    expect(outcomeLabel(o)).toBe('가을야구 (매직 2위)');
    expect(trustDelta('postseason', o).achieved).toBe(true);
    // 같은 순위를 단일 리그로 보면(league 없음) 통합 5위 > 진출 4팀
    const single = outcomeOf(4, st, ps, 4, false);
    expect(single.league).toBeUndefined();
    expect(outcomeTier(single)).toBe(1);
    expect(outcomeLabel(single)).toBe('5위');
  });

  it('준플레이오프 조건을 채운 리그 3위도 가을야구', () => {
    const o = outcomeOf(3, st, ps, 4, false, { name: '드림', rank: 3 });
    expect(outcomeTier(o)).toBe(2);
    expect(outcomeLabel(o)).toBe('가을야구 (드림 3위)');
  });

  it('리그 4위가 통합 6위면 꼴찌 아님, 통합 8위면 꼴찌', () => {
    const o6 = outcomeOf(5, st, ps, 4, false, { name: '드림', rank: 4 });
    expect(outcomeTier(o6)).toBe(1);
    expect(outcomeLabel(o6)).toBe('드림 4위');
    expect(trustDelta('notLast', o6).achieved).toBe(true);
    const o8 = outcomeOf(7, st, ps, 4, false, { name: '매직', rank: 4 });
    expect(outcomeTier(o8)).toBe(0);
    expect(outcomeLabel(o8)).toBe('꼴찌 (매직 4위, 통합 8위)');
    expect(trustDelta('notLast', o8).achieved).toBe(false);
  });

  it('우승·준우승 판정은 그대로', () => {
    expect(outcomeLabel(outcomeOf(0, st, ps, 4, false, { name: '드림', rank: 1 }))).toBe('한국시리즈 우승');
    expect(outcomeLabel(outcomeOf(1, st, ps, 4, false, { name: '매직', rank: 1 }))).toBe('한국시리즈 준우승');
  });

  it('목표: 리그 안 전력 예상 순위로 (1위 우승, 2~3위 가을야구, 4위 탈꼴찌). 단일 리그 goalFor는 그대로', () => {
    expect([1, 2, 3, 4].map(goalForLeague)).toEqual(['champion', 'postseason', 'postseason', 'notLast']);
    expect([1, 2, 3, 5, 6].map((r) => goalFor(r, 4))).toEqual(['champion', 'champion', 'postseason', 'postseason', 'notLast']);
  });

  it('업적 "정규시즌 1위"는 리그 1위 (통합 2위여도)', () => {
    const o: OwnerState = newOwner(1);
    o.history.push({
      year: 1999, team: 1, goal: 'postseason', projectedRank: 2, rank: 2, result: '가을야구 (매직 1위)', achieved: true,
      trustBefore: 50, trustAfter: 62, champion: false, capOver: false, league: { name: '매직', rank: 1 },
    });
    expect(newAchievements(o, false)).toContain('regularFirst');
    o.history[0] = { ...o.history[0], league: { name: '매직', rank: 2 } };
    expect(newAchievements(o, false)).not.toContain('regularFirst');
  });
});

describe('AI 트레이드 성향과 감독 재계약 (실제 진출)', () => {
  const base: TeamSituation = { teamIdx: 0, rank: 5, nTeams: 8, cut: 4, coreAge: 25, remaining: 0.5 };

  it('inPlace가 있으면 진출권 판정은 그것으로, 없으면 통합 순위 ≤ cut 그대로', () => {
    expect(tendencyOf(base)).toBe('rebuild');
    expect(tendencyOf({ ...base, inPlace: true })).toBe('contend');
    expect(tendencyOf({ ...base, rank: 3 })).toBe('contend');
    expect(tendencyOf({ ...base, rank: 3, inPlace: false })).toBe('rebuild');
    // 진출권 바로 밖 + 주축 30세 이상은 통합 순위 그대로
    expect(tendencyOf({ ...base, rank: 6, inPlace: false, coreAge: 31 })).toBe('contend');
  });

  it('감독 재계약: 지난 시즌 실제 진출 구단은 통합 하위 절반이어도 재계약, 꼴찌는 통합 순위', () => {
    const make = () => ({
      year: 2030,
      teams: [{ name: 'A', franchise: 'X1' }, { name: 'B', franchise: 'X2' }, { name: 'C', franchise: 'X3' }, { name: 'D', franchise: 'X4' }],
      managers: [
        { name: '김태형', since: 2027, until: 2029, salary: 1 },
        { name: '이강철', since: 2027, until: 2029, salary: 1 },
        { name: '박진만', since: 2027, until: 2029, salary: 1 },
        { name: '염경엽', since: 2027, until: 2029, salary: 1 },
      ],
      ledger: [],
    } as unknown as LeagueState);
    // 단일 리그 판정: 통합 3위(색인 2)는 진출 밖(1팀) + 하위 절반 → 교체
    const a = make();
    openManagers(a, store, -1, [0, 1, 2, 3], 1);
    expect(a.managers![2]!.name).not.toBe('박진만');
    // 양대 리그: 색인 2가 실제 진출 → 재계약. 꼴찌(색인 3)는 진출 못 했으니 교체
    const b = make();
    openManagers(b, store, -1, [0, 1, 2, 3], 1, [0, 2]);
    expect(b.managers![2]).toMatchObject({ name: '박진만' });
    expect(b.managers![2]!.until).toBeGreaterThan(2029);
    expect(b.managers![3]!.name).not.toBe('염경엽');
  });
});

describe('1999 한 시즌: 구단주 목표·평가, AI 진출권, 축하가 리그 순위·실제 진출을 따른다', () => {
  it('목표는 리그 안 전력 예상, 결과 문장은 리그 순위, 가을야구는 대진의 진출 팀', () => {
    const g = GameSession.create(store, { year: 1999, teamIdx: 1, seed: 'div-a5' }, FAST);
    const w = g.world;
    expect(w.divisions).toBeTruthy();
    const goal = g.owner.goal!;
    const myLeague = w.divisions!.names[w.divisions!.teams.findIndex((ts) => ts.includes(g.teamIdx))];
    expect(goal.projectedLeague).toBe(myLeague);
    expect(goal.projectedRank).toBeGreaterThanOrEqual(1);
    expect(goal.projectedRank).toBeLessThanOrEqual(4);
    expect(goal.kind).toBe(goalForLeague(goal.projectedRank));
    expect(g.news.some((n) => n.kind === 'owner' && n.text.includes(`(구단주 전망 ${myLeague} ${strengthTier(goal.projectedRank, 4)})`))).toBe(true);
    // 개막 알림: 양대 리그 시작
    expect(g.news.some((n) => n.text.includes('리그: 단일 리그 → 드림·매직 양대 리그 (드림 '))).toBe(true);

    // 20경기 넘게 치른 뒤: AI 진출권은 실제 진출 규칙 (game/rank.ts)
    g.advance(40, NO_STOPS);
    const places = seasonPostseasonPlaces(g.season, w.rules.postseasonTeams);
    for (const t of w.teams) {
      const sit = g.situation(t.idx);
      // 20경기 전에는 전력 순위 (진출권 칸 없음)
      if (g.season.teams[t.idx].g < 20) { expect(sit.inPlace).toBeUndefined(); continue; }
      expect(sit.inPlace).toBe(places.includes(t.idx));
      expect(sit.rank).toBe(g.season.standings().indexOf(t.idx) + 1);
    }

    while (!g.done) g.advance(100000, NO_STOPS);
    const p = seasonPlace(g.season, g.teamIdx);
    expect(p.league).toBe(myLeague);
    // 축하: 리그 1위면 "드림리그 1위!"
    const first = achievements(g).find((a) => a.key === '1999-first');
    if (p.rank === 1) expect(first?.title).toBe(`${myLeague}리그 1위!`);
    else expect(first).toBeUndefined();

    g.advancePostseason(10_000);
    const st = g.postseason!;
    const psA = achievements(g).find((a) => a.key === '1999-ps');
    if (st.seeds.includes(g.teamIdx)) expect(psA?.sub).toBe(`1999 ${g.team.name} · ${st.seedLabels![st.seeds.indexOf(g.teamIdx)]}로 진출`);
    else expect(psA).toBeUndefined();

    g.beginOffseason();
    const h = g.owner.history.at(-1)!;
    expect(h.year).toBe(1999);
    expect(h.league).toEqual({ name: myLeague, rank: p.rank });
    expect(h.rank).toBe(g.league.lastSeason!.standings.indexOf(g.teamIdx) + 1);
    const inPs = g.league.lastSeason!.postseason!.seeds.includes(g.teamIdx);
    const ps = g.league.lastSeason!.postseason!;
    if (ps.champion === g.teamIdx) expect(h.result).toBe('한국시리즈 우승');
    else if (ps.runnerUp === g.teamIdx) expect(h.result).toBe('한국시리즈 준우승');
    else if (inPs) expect(h.result).toBe(`가을야구 (${myLeague} ${p.rank}위)`);
    else expect(h.result.includes(`${myLeague} ${p.rank}위`)).toBe(true);
    expect(g.news.some((n) => n.kind === 'owner' && n.text.startsWith(`구단주 평가: `) && n.text.includes(h.result))).toBe(true);
  }, 600_000);

  it('2026(단일 리그)은 목표에 리그가 없고 AI 진출권 칸도 없다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'div-a5-2026' }, FAST);
    expect(g.owner.goal!.projectedLeague).toBeUndefined();
    expect(g.news.some((n) => n.kind === 'owner' && /\(구단주 전망 (상위권|중위권|하위권)\)/.test(n.text))).toBe(true);
    g.advance(40, NO_STOPS);
    expect(g.situation(3).inPlace).toBeUndefined();
    expect(g.news.some((n) => n.text.includes('양대 리그'))).toBe(false);
  }, 240_000);
});

describe('연표 표시 (리그는 저장하지 않고 자료로 다시 계산)', () => {
  it('1999·2000 실제 연표에 리그와 리그 순위, 1998·2001은 null', () => {
    const yb = realYearbook(store, 2002);
    const at = (y: number) => yb.find((x) => x.year === y)!;
    const label = (y: number, name: string) => {
      const r = at(y);
      return yearPlaceLabel(yearLeagues(store, r), r.teams.findIndex((t) => t.name === name));
    };
    expect(label(1999, '두산')).toBe('드림 1위');
    expect(label(1999, '롯데')).toBe('드림 2위');
    expect(label(1999, '삼성')).toBe('매직 1위');
    expect(label(1999, '쌍방울')).toBe('매직 4위');
    expect(label(2000, '삼성')).toBe('드림 3위');
    expect(label(2000, '롯데')).toBe('매직 2위');
    expect(label(2000, 'SK')).toBe('매직 4위');
    expect(yearLeagues(store, at(1998))).toBeNull();
    expect(yearLeagues(store, at(2001))).toBeNull();
    expect(yearPlaceLabel(null, 2)).toBe('3위');
  });

  it('구단 역사의 가을야구 횟수: 1999는 각 리그 1·2위, 2000은 준플레이오프 삼성까지 5팀', () => {
    const fake = (startYear: number) => ({ startYear, yearbook: [] } as unknown as LeagueState);
    const count = (startYear: number) => new Map(franchiseHistory(fake(startYear), store).map((f) => [f.franchise, f.postseasons]));
    const [b99, b00, b01] = [count(1999), count(2000), count(2001)];
    const diff = (a: Map<string, number>, b: Map<string, number>) =>
      [...b.keys()].filter((f) => (b.get(f) ?? 0) - (a.get(f) ?? 0) > 0).sort();
    // 1999 진출 (계보): 두산·롯데·삼성·한화 (현대는 준플레이오프 조건을 못 채움)
    const f99 = (n: string) => store.season(1999)!.teams.find((t) => t.name === n)!.franchise;
    expect(diff(b99, b00)).toEqual(['두산', '롯데', '삼성', '한화'].map(f99).sort());
    // 2000 진출: 현대·두산·삼성·LG·롯데 (통합 4위 안만 세면 롯데가 빠진다)
    const f00 = (n: string) => store.season(2000)!.teams.find((t) => t.name === n)!.franchise;
    expect(diff(b00, b01)).toEqual(['현대', '두산', '삼성', 'LG', '롯데'].map(f00).sort());
  });

  it('직전 시즌 최하위(캠페인·도전): 양대 리그 해는 리그별 4위가 둘이라 통합 승률로', () => {
    const s99 = store.season(1999)!;
    const s00 = store.season(2000)!;
    const s01 = store.season(2001)!;
    // 2000 시작: 1999 최하위 쌍방울(0.224)의 계보는 2000 구단에 없다 (SK는 다른 계보) → null
    expect([...s99.teams].sort((a, b) => a.pct - b.pct)[0].name).toBe('쌍방울');
    expect(lastPlaceTeam(store, 2000)).toBeNull();
    // 2001 시작: 2000 최하위 SK(0.338). 같은 4위인 해태(드림 4위)가 아니다
    const t01 = lastPlaceTeam(store, 2001)!;
    expect(s01.teams[t01].name).toBe('SK');
    expect(s01.teams[t01].franchise).toBe([...s00.teams].sort((a, b) => a.pct - b.pct)[0].franchise);
  });
});

describe('개막 알림 "올해 달라지는 규칙"의 리그 줄', () => {
  const teamsOf = (y: number) => store.season(y)!.teams.map((t) => ({ name: t.name, franchise: t.franchise }));
  const divs = (y: number) => divisionsOf(store.season(y), store.season(y)!.teams.map((t) => t.franchise));
  const news = (y: number) => leagueNews(divs(y), teamsOf(y), store.season(y), store.season(y - 1));

  it('1999 양대 리그 시작, 2000 리그 재편(삼성 드림, 롯데 매직), 2001 단일 리그로', () => {
    const n99 = news(1999);
    expect(n99).toHaveLength(1);
    expect(n99[0]).toMatchObject({ key: 'league', title: '리그', before: '단일 리그' });
    expect(n99[0].after).toContain('드림·매직 양대 리그 (드림 ');
    expect(n99[0].after).toContain('각 리그 1·2위가 가을야구');
    const n00 = news(2000);
    expect(n00).toHaveLength(1);
    expect(n00[0].title).toBe('리그 재편');
    expect(n00[0].after!.startsWith('삼성 드림, 롯데 매직 (')).toBe(true);
    const n01 = news(2001);
    expect(n01).toEqual([{ key: 'league', title: '리그', before: '양대 리그', after: '단일 리그', status: '자료집' }]);
    expect(news(1998)).toEqual([]);
    expect(news(2026)).toEqual([]);
  });

  it('자료는 양대 리그인데 게임 구단과 맞지 않아 나누지 않은 해는 "단일 리그로 진행"', () => {
    const n = leagueNews(null, teamsOf(1999), store.season(1999), store.season(1998));
    expect(n).toHaveLength(1);
    expect(n[0].after!.startsWith('단일 리그로 진행')).toBe(true);
  });
});

describe('캠페인 문구: 양대 리그 해의 순위 목표는 "통합"', () => {
  it('S06 (2000 현대) 정규시즌 1위 → "정규시즌 통합 1위", 다른 해는 그대로', () => {
    expect(planById('plan-s06')!.stages[0].label).toBe('2000년 정규시즌 통합 1위');
    expect(planById('plan-s17')!.stages[0].label).toBe('2001년 정규시즌 1위');
    expect(condText({ t: 'in', year: 2000, m: { k: 'rank', n: 3 } })).toBe('2000년 정규시즌 통합 3위 이내');
    expect(condText({ t: 'all', from: 1998, to: 2002, m: { k: 'rank', n: 1 } })).toBe('1998~2002년 모두 정규시즌 1위 (1999·2000년은 통합 순위)');
    expect(condText({ t: 'in', year: 1999, m: { k: 'ps' } })).toBe('1999년 포스트시즌 진출');
  });
});
