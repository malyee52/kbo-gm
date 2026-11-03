// 부상 대체 외국인 (2024~, league/market.ts): 6주 넘게 다친 외국인을 재활 명단에 올리고 교체 횟수 없이 대체 선수를 데려온다.
// 복귀 때 원래 선수 복귀(대체 선수 방출) 또는 대체 선수 남기기(원래 선수 방출, 교체 1회). 고르지 않으면 원래 선수 복귀
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type SimPlayer } from '../src/engine';
import { GameSession, type GameAction } from '../src/game/session';
import { foreignHeld, foreignSwapsUsed, INJURY_SWAP_DAYS, INJURY_SWAP_MONTH_USD, movesOf, rehabBlock, rehabsOf } from '../src/league/market';
import { paydays } from '../src/league/finance';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
/** 파견 후보를 그 구단 관찰 명단에 모두 올린다 (조작 기록 밖) */
const watchAll = (g: GameSession, team = g.teamIdx) => {
  const t = g.league.scoutFx!.teams[team];
  for (const p of g.league.players) if (p.fx && !t.list.some((e) => e.id === p.id)) t.list.push({ id: p.id, at: 0, weeks: 0 });
};
const regularForeign = (g: GameSession, team = g.teamIdx) => g.world.teams[team].org.filter((p) => p.foreign && !g.leaguePlayer(p.id)!.asia);
const cands = (g: GameSession) => g.marketPlayers().filter((p) => p.foreign && !g.leaguePlayer(p.id)!.asia && p.id.startsWith('v'));
/** 오래 다치게 한다 (무작위 이벤트의 휴식 처방과 같은 길, 조작 기록 밖) */
const hurt = (g: GameSession, p: SimPlayer, days: number) => g.season.restPlayer(p.idx, g.day + days);
const saved = (g: GameSession) => roundTrip(g.toSave());
type Dispatch = { dispatchSeason(a: GameAction): void };

describe('부상 대체 외국인', () => {
  it('재활 명단에 올리면 보유 한도에서 빠지고 교체 횟수 없이 데려오며, 복귀 때 대체 선수를 남기면 교체 1회', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'inj-keep' }, FAST);
    g.advance(25);
    watchAll(g);
    const p = regularForeign(g)[0];
    expect(g.rehabCandidates()).not.toContain(p);
    hurt(g, p, INJURY_SWAP_DAYS - 1);
    expect(rehabBlock(g.marketCtx, p, g.teamIdx)).toMatch(/6주/);
    hurt(g, p, 50);
    expect(g.rehabCandidates()).toContain(p);
    expect(rehabBlock({ ...g.marketCtx, world: { ...g.world, year: 2023 } } as typeof g.marketCtx, p, g.teamIdx)).toMatch(/2024년부터/);
    const sub = cands(g)[0];
    // 보통 영입은 한도가 차 막히고, 부상 대체는 된다
    expect(g.signBlock(sub)).toMatch(/보유 한도/);
    expect(g.rehabSignBlock(sub, p)).toBeNull();
    const lpMap = () => new Map(g.league.players.map((x) => [x.id, x]));
    const held = foreignHeld(g.world, g.teamIdx, lpMap(), g.league);
    expect(g.signRehab(sub, p).ok).toBe(true);
    expect(sub.teamIdx).toBe(g.teamIdx);
    expect(p.teamIdx).toBe(g.teamIdx);
    expect(foreignSwapsUsed(g.marketCtx, g.teamIdx)).toBe(0);
    expect(foreignHeld(g.world, g.teamIdx, lpMap(), g.league)).toEqual(held);
    // 연봉은 한 달 10만 달러까지
    expect(g.leaguePlayer(sub.id)!.contract.salary).toBeLessThanOrEqual(INJURY_SWAP_MONTH_USD * paydays(2026, g.season.schedule.length).length);
    // 재활 중에는 둘 다 웨이버할 수 없고, 원래 선수는 나을 때까지 복귀를 고를 수 없다
    expect(g.releaseBlock(p)).toMatch(/재활 명단/);
    expect(g.releaseBlock(sub)).toMatch(/부상 대체/);
    const r = g.rehabs()[0];
    expect(r).toMatchObject({ injured: p.id, sub: sub.id });
    expect(g.rehabEndBlock(r, false)).toMatch(/복귀 전/);
    expect(g.rehabCandidates()).not.toContain(p);
    // 다 나은 날 멈추고 결정함에 오른다
    let stopped = false;
    for (let i = 0; i < 60 && !g.rehabsDue().length; i++) {
      g.advance(1);
      if (g.attention.some((a) => a.kind === 'rehab')) stopped = true;
    }
    expect(g.rehabsDue().length).toBe(1);
    expect(stopped).toBe(true);
    expect(g.rehabEndBlock(r, false)).toBeNull();
    expect(g.endRehab(p.id, true).ok).toBe(true);
    expect(p.teamIdx).toBe(-1);
    expect(sub.teamIdx).toBe(g.teamIdx);
    expect(foreignSwapsUsed(g.marketCtx, g.teamIdx)).toBe(1);
    expect(g.rehabs().length).toBe(0);
    expect(movesOf(g.league, 2026).filter((m) => m.id === p.id || m.id === sub.id).map((m) => m.kind)).toEqual(['rehab', 'keep', 'release']);
  }, 300_000);

  it('고르지 않으면 나은 날 경기 전에 원래 선수가 돌아오고 대체 선수는 방출된다. 교체 2번을 다 썼으면 남길 수 없다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'inj-default' }, FAST);
    g.advance(25);
    watchAll(g);
    const p = regularForeign(g)[0];
    hurt(g, p, 45);
    const sub = cands(g)[0];
    expect(g.signRehab(sub, p).ok).toBe(true);
    // 다른 외국인으로 교체 2번을 다 쓴다 (재활 중인 선수와 대체 선수는 빼고)
    for (let i = 0; i < 2; i++) {
      const out = regularForeign(g).find((x) => x !== p && x !== sub && !g.releaseBlock(x))!;
      expect(g.releaseInSeason(out).ok).toBe(true);
      expect(g.signInSeason(cands(g)[0]).ok).toBe(true);
    }
    expect(g.rehabEndBlock(g.rehabs()[0], true)).toMatch(/교체 2번/);
    while (!g.rehabsDue().length) g.advance(1);
    const day = g.day;
    g.advance(1);
    expect(p.teamIdx).toBe(g.teamIdx);
    expect(sub.teamIdx).toBe(-1);
    expect(g.rehabs().length).toBe(0);
    expect(movesOf(g.league, 2026).find((m) => m.id === sub.id && m.kind === 'release')!.day).toBe(day);
  }, 300_000);

  it('저장·불러오기와 조작 기록 재실행이 같은 상태를 만든다', () => {
    const opts = { year: 2026, teamIdx: lgOf(), seed: 'inj-replay' };
    const g = GameSession.create(store, opts, FAST);
    expect(g.sendScout('na').ok).toBe(true);
    expect(g.sendScout('latam').ok).toBe(true);
    g.advance(29);
    const p = regularForeign(g)[0];
    hurt(g, p, 48);
    const sub = cands(g)[0];
    expect(sub).toBeDefined();
    expect(g.signRehab(sub, p).ok).toBe(true);
    while (!g.rehabsDue().length) g.advance(1);
    expect(g.endRehab(p.id, true).ok).toBe(true);
    g.advance(5);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(roundTrip(h.toSave().league)).toEqual(saved(g).league);
    h.advance(5);
    g.advance(5);
    expect(roundTrip(h.toSave().season)).toEqual(saved(g).season);
    // 재실행: 다치게 한 날까지 진행 → 같은 부상 → 나머지 조작 (dispatchSeason은 replay와 같은 길)
    const r = GameSession.create(store, opts, FAST);
    const first = g.actions.filter((a) => 'day' in a && a.day < 29);
    const rest = g.actions.filter((a) => !first.includes(a)) as Extract<GameAction, { day: number }>[];
    for (const a of first) (r as unknown as Dispatch).dispatchSeason(a);
    r.advance(29);
    hurt(r, r.world.players[p.idx], 48);
    for (const a of rest) {
      while (r.day < a.day) r.advance(1);
      (r as unknown as Dispatch).dispatchSeason(a);
    }
    while (r.day < g.day) r.advance(1);
    expect(roundTrip(r.toSave().league)).toEqual(saved(g).league);
    expect(roundTrip(r.toSave().season)).toEqual(saved(g).season);
  }, 300_000);

  it('AI 구단도 6주 넘게 다친 외국인을 재활 명단에 올리고 대체 선수를 데려오며, 복귀 때 한쪽을 정리한다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'inj-ai' }, FAST);
    g.advance(20);
    const t = (g.teamIdx + 1) % g.world.teams.length;
    watchAll(g, t);
    const p = regularForeign(g, t)[0];
    hurt(g, p, 50);
    g.advance(8); // 21일째 AI 검토
    const m = movesOf(g.league, 2026).find((x) => x.kind === 'rehab' && x.to === t);
    expect(m?.rehab).toBe(p.id);
    expect(foreignSwapsUsed(g.marketCtx, t)).toBe(0);
    expect(rehabsOf(g.marketCtx, t).length).toBe(1);
    g.advance(50);
    expect(rehabsOf(g.marketCtx, t).length).toBe(0);
    const sub = g.world.players.find((x) => x.id === m!.id)!;
    expect([p.teamIdx, sub.teamIdx].filter((x) => x === t).length).toBe(1);
  }, 300_000);
});
