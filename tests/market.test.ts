// 시즌 중 방출·영입 (2026-10-12, league/market.ts): 웨이버 공시, 자유계약 선수 영입, 외국인 교체, AI 외국인 교체
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { currentRuns } from '../src/ai/value';
import { FOREIGN_SWAPS, foreignSwapsUsed, movesOf } from '../src/league/market';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('시즌 중 시장', () => {
  it('2026 시작: 실제 시즌 중 교체 외국인과 가상 후보가 소속 없이 시장에 있다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'mk-open' }, FAST);
    const m = g.marketPlayers();
    expect(m.filter((p) => !p.id.startsWith('v')).length).toBeGreaterThan(3); // 실제 교체 외국인
    expect(m.filter((p) => p.id.startsWith('v')).length).toBeGreaterThanOrEqual(8);
    expect(m.every((p) => p.foreign && p.teamIdx === -1)).toBe(true);
    for (const t of g.world.teams) expect(t.org.some((p) => p.teamIdx === -1)).toBe(false);
    // 실제 교체 외국인은 실제로 들어온 무렵부터 영입할 수 있다 (개막 날에는 아직)
    const late = m.filter((p) => (g.leaguePlayer(p.id)!.marketFrom ?? 0) > 0.2);
    expect(late.length).toBeGreaterThan(0);
    for (const p of late) expect(g.signBlock(p)).toMatch(/아직 시장에 나오지 않았습니다/);
  }, 120_000);

  it('외국인 교체: 방출 → 시장 후보 영입, 보유 한도와 교체 2회 한도, 마감', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'mk-swap' }, FAST);
    g.advance(30);
    // 가상 후보 (실제 교체 외국인은 실제로 들어온 무렵부터 나온다, 아래 따로)
    const cand = () => g.marketPlayers().filter((p) => p.foreign && !g.leaguePlayer(p.id)!.asia && p.id.startsWith('v'));
    // 보유 한도가 차 있으면 영입할 수 없다
    expect(g.signBlock(cand()[0])).toMatch(/보유 한도/);
    for (let i = 0; i < FOREIGN_SWAPS; i++) {
      const out = g.team.org.find((p) => p.foreign && !g.leaguePlayer(p.id)!.asia)!;
      const cash = g.league.ledger.length;
      expect(g.releaseInSeason(out).ok).toBe(true);
      expect(out.teamIdx).toBe(-1);
      expect(out.formerTeam).toBe(g.teamIdx);
      expect(g.league.ledger.length).toBe(cash + 1); // 남은 연봉 정산
      const pick = cand()[0];
      expect(g.signInSeason(pick).ok).toBe(true);
      expect(pick.teamIdx).toBe(g.teamIdx);
      expect(g.team.org.includes(pick)).toBe(true);
    }
    expect(foreignSwapsUsed(g.marketCtx, g.teamIdx)).toBe(FOREIGN_SWAPS);
    const out = g.team.org.find((p) => p.foreign && !g.leaguePlayer(p.id)!.asia)!;
    g.releaseInSeason(out);
    expect(g.signBlock(cand()[0])).toMatch(/2번까지/);
    // 방출한 선수는 같은 시즌에 다시 데려올 수 없다 (목록에도 없다)
    expect(g.marketPlayers().some((p) => p.id === out.id)).toBe(false);
    // 마감(8월 15일) 뒤에는 방출도 영입도 안 된다
    g.advance(g.marketDeadlineDay - g.day + 1);
    const any = g.team.org.find((p) => !p.foreign && !p.isPitcher && p.pos !== 'C')!;
    expect(g.releaseBlock(any)).toMatch(/마감/);
  }, 300_000);

  it('웨이버: 쓸 만한 국내 선수는 하위 구단이 데려가 계약을 넘겨받고, 아니면 자유계약 선수가 되어 다른 구단이 영입할 수 있다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'mk-waiver' }, FAST);
    g.advance(20);
    const runs = (p: (typeof g.team.org)[number]) => currentRuns(p, g.values);
    const dom = g.team.org.filter((p) => !p.foreign && !p.dev && p.pos !== 'C').sort((a, b) => runs(b) - runs(a));
    const good = dom.find((p) => runs(p) >= 15 && g.leaguePlayer(p.id)!.contract.salary < 30_000)!;
    const r1 = g.releaseInSeason(good);
    expect(r1.ok).toBe(true);
    expect(good.teamIdx).toBeGreaterThanOrEqual(0);
    expect(good.teamIdx).not.toBe(g.teamIdx);
    const claim = movesOf(g.league, 2026).find((m) => m.id === good.id)!;
    expect(claim.kind).toBe('claim');
    // 순위 역순: 데려간 구단은 그때 우리를 뺀 최하위
    const bad = [...dom].reverse().find((p) => runs(p) < 0)!;
    expect(g.releaseInSeason(bad).ok).toBe(true);
    expect(bad.teamIdx).toBe(-1);
    // 다른 구단으로 시작한 게임에서는 이 선수를 영입할 수 있다 (여기서는 원 소속이라 목록에 없다)
    expect(g.marketPlayers().some((p) => p.id === bad.id)).toBe(false);
  }, 300_000);

  it('저장·불러오기와 조작 기록 재실행이 같은 상태를 만든다 (방출·영입·AI 외국인 교체 포함)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'mk-replay' }, FAST);
    g.advance(25);
    const out = g.team.org.find((p) => p.foreign && !g.leaguePlayer(p.id)!.asia)!;
    g.releaseInSeason(out);
    g.signInSeason(g.marketPlayers().find((p) => p.foreign && !g.leaguePlayer(p.id)!.asia && p.id.startsWith('v'))!);
    g.advance(60);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    // 불러온 쪽은 JSON을 거쳐 -0이 0이 되므로 양쪽 다 JSON으로 견준다
    expect(roundTrip(h.toSave().league)).toEqual(roundTrip(g.toSave().league));
    expect(h.world.players.map((p) => `${p.id}@${p.teamIdx}`)).toEqual(g.world.players.map((p) => `${p.id}@${p.teamIdx}`));
    h.advance(10);
    g.advance(10);
    expect(roundTrip(h.toSave().season)).toEqual(roundTrip(g.toSave().season));
    const r = GameSession.replay(store, { year: 2026, teamIdx: g.teamIdx, seed: 'mk-replay' }, g.actions, { year: 2026, day: g.day }, FAST);
    expect(r.toSave().league).toEqual(g.toSave().league);
    expect(r.toSave().season).toEqual(g.toSave().season);
  }, 300_000);

  it('한 시즌: AI 구단이 외국인을 바꾸고(구단당 2번까지), 결산 때 남은 후보는 지워지며 방출 선수 기록은 마지막 소속으로 남는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'mk-season' }, FAST);
    g.advance(20);
    const bad = g.team.org.filter((p) => !p.foreign && !p.dev && p.pos !== 'C').sort((a, b) => currentRuns(a, g.values) - currentRuns(b, g.values))[0];
    g.releaseInSeason(bad);
    g.advance(100000);
    const ai = movesOf(g.league, 2026).filter((m) => m.kind === 'sign' && m.to !== g.teamIdx);
    expect(ai.length).toBeGreaterThan(0);
    for (let t = 0; t < g.world.teams.length; t++) expect(foreignSwapsUsed(g.marketCtx, t)).toBeLessThanOrEqual(FOREIGN_SWAPS);
    g.beginOffseason();
    expect(g.league.players.some((p) => p.market !== undefined)).toBe(false);
    // AI가 데려왔다가 다시 바꾼(방출한) 선수는 뺀다: 마지막 움직임이 영입인 선수만 (2026-10-13 엔트리 순환 뒤 이 시드에서 다시 바꾼 경우가 생겼다)
    const last = new Map(movesOf(g.league, 2026).map((m) => [m.id, m.kind]));
    const signed = new Set(ai.map((m) => m.id).filter((id) => last.get(id) === 'sign'));
    for (const id of signed) expect(g.league.players.find((p) => p.id === id)!.team).toBeGreaterThanOrEqual(0);
    const lp = g.league.players.find((p) => p.id === bad.id);
    if (lp && lp.history.some((h) => h.year === 2026)) expect(lp.history.at(-1)!.team).toBe(g.team.name);
  }, 600_000);
});
