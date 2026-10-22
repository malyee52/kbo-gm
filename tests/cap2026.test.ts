// 리그 규칙 변경 1-7: 2026 샐러리캡 개편 (제재 완화, 프랜차이즈 예외, 2027 하한). 값은 조사값, 초과 횟수 이어 세기·하한 미달 제재는 임시값.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { applyCapSanctions, capFloorShorts, capSanctionRule } from '../src/league/owner';
import {
  CAP_FLOOR_2027, capPayroll, franchiseTag, franchiseTagEligible, FRANCHISE_TAG_SEASONS, salaryCap, salaryFloor, teamCapPayroll,
} from '../src/league/salary';
import { seasonsWith } from '../src/league/stadium';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
});

/** 구단 t의 캡 대상 선수 하나에게 캡의 3배 연봉을 줘 (예외로 절반이 빠져도) 초과시킨다. 예외 자격이 없는 선수를 고른다 */
function overCap(league: LeagueState, t: number): void {
  const p = league.players.find((x) => x.team === t && !x.foreign && x.contract.kind !== 'rookie' && x.military?.state !== 'serving' && !franchiseTagEligible(league, x, t))!;
  p.contract = { ...p.contract, salary: salaryCap(2028)! * 3 };
}

describe('샐러리캡 제재 단계 (2023~2025 옛 규정, 2026~ 완화)', () => {
  it('규정표: 2025까지 50·100·150%와 2회부터 지명권 하락, 2026부터 30·50·100%와 3회부터', () => {
    expect(capSanctionRule(2025)).toEqual({ rates: [0.5, 1.0, 1.5], dropFrom: 2 });
    expect(capSanctionRule(2026)).toEqual({ rates: [0.3, 0.5, 1.0], dropFrom: 3 });
  });

  it('2025 판정은 옛 비율, 2026부터 새 비율. 2회 연속 초과에도 지명권 하락 없음, 3회째에 하락', () => {
    const { league } = createLeague(store, 2026, 'cap26', FAST);
    const t = 0;
    overCap(league, t);
    const y25 = applyCapSanctions(league, 2025).find((x) => x.team === t)!;
    expect(y25.fine).toBe(Math.round(y25.over * 0.5));
    league.capStrikes![t] = 0;
    league.draftPenalty![t] = null;
    const a = applyCapSanctions(league, 2026).find((x) => x.team === t)!;
    expect([a.strike, a.fine, a.pickDrop]).toEqual([1, Math.round(a.over * 0.3), false]);
    const b = applyCapSanctions(league, 2027).find((x) => x.team === t)!;
    expect([b.strike, b.fine, b.pickDrop]).toEqual([2, Math.round(b.over * 0.5), false]);
    expect(league.draftPenalty![t]).toBeNull();
    const c = applyCapSanctions(league, 2028).find((x) => x.team === t)!;
    expect([c.strike, c.fine, c.pickDrop]).toEqual([3, Math.round(c.over * 1.0), true]);
    expect(league.draftPenalty![t]).toBe(2028);
  });

  it('초과 횟수는 2023년부터 이어 센다 (임시값): 2024·2025 초과 뒤 2026은 3회째', () => {
    const { league } = createLeague(store, 2026, 'cap26b', FAST);
    const t = 1;
    overCap(league, t);
    applyCapSanctions(league, 2024);
    expect(applyCapSanctions(league, 2025).find((x) => x.team === t)!.pickDrop).toBe(true);
    const c = applyCapSanctions(league, 2026).find((x) => x.team === t)!;
    expect([c.strike, c.pickDrop]).toEqual([3, true]);
    expect(c.fine).toBe(Math.round(c.over * 1.0));
  });
});

describe('프랜차이즈 예외 (2026~, 구단당 1명, 7시즌 이상, 연봉 50%)', () => {
  it('2025에는 없고, 2026부터 자격 선수 중 연봉 최고를 자동 지정해 절반만 캡에 넣는다', () => {
    const { league } = createLeague(store, 2026, 'tag', FAST);
    let checked = 0;
    for (let t = 0; t < league.teams.length; t++) {
      expect(franchiseTag(league, t, 2025)).toBeNull();
      const tag = franchiseTag(league, t, 2026);
      const cands = league.players.filter((p) => franchiseTagEligible(league, p, t));
      if (!tag) { expect(cands).toHaveLength(0); continue; }
      checked++;
      expect(seasonsWith(tag, league, t)).toBeGreaterThanOrEqual(FRANCHISE_TAG_SEASONS);
      expect(Math.max(...cands.map((p) => p.contract.salary))).toBe(tag.contract.salary);
      const full = capPayroll(league.players, t, 40);
      const now = teamCapPayroll(league, t, 2026);
      expect(now).toBeLessThanOrEqual(full);
      expect(capPayroll(league.players, t, 40, tag.id)).toBe(now);
    }
    // 실존 선수로 시작하면 대부분 구단에 7시즌 이상 뛴 선수가 있다
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('플레이어가 고른 선수가 자격이 있으면 그 선수, 자격이 없어지면 자동 지정으로 돌아간다', () => {
    const { league } = createLeague(store, 2026, 'tag2', FAST);
    const t = league.teams.findIndex((_, i) => league.players.filter((p) => franchiseTagEligible(league, p, i)).length >= 2);
    const cands = league.players.filter((p) => franchiseTagEligible(league, p, t)).sort((a, b) => a.contract.salary - b.contract.salary);
    league.franchiseTags = new Array(league.teams.length).fill(null);
    league.franchiseTags[t] = cands[0].id;
    expect(franchiseTag(league, t, 2026)!.id).toBe(cands[0].id);
    cands[0].team = (t + 1) % league.teams.length;
    expect(franchiseTag(league, t, 2026)!.id).toBe(cands[cands.length - 1].id);
  });
});

describe('샐러리캡 하한 (2027~)', () => {
  it('2026에는 없고 2027은 발표값, 2028부터 캡과 같은 비율로', () => {
    expect(salaryFloor(2026)).toBeNull();
    expect(salaryFloor(2027)).toBe(CAP_FLOOR_2027);
    expect(salaryFloor(2028)!).toBe(Math.round(CAP_FLOOR_2027 * salaryCap(2028)! / salaryCap(2027)!));
    const { league } = createLeague(store, 2026, 'floor', FAST);
    expect(capFloorShorts(league, 2026)).toEqual([]);
    for (const x of capFloorShorts(league, 2027)) expect(x.pay).toBeLessThan(x.floor);
  });
});

describe('조작 franchise-tag 재현', () => {
  it('오프시즌에 예외 선수를 고르면 조작 기록에 남고, replay가 같은 상태가 된다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'tag-replay' }, FAST);
    g.advance(1000);
    g.beginOffseason();
    let guard = 0;
    while (g.offseason && g.offseason.stage !== 'ready' && guard++ < 50) {
      const offers = g.league.owner?.offers;
      if (offers?.length) g.acceptOffer(offers[0]);
      if (g.offseason.stage === 'draft') g.autoDraft();
      if (g.offseason.stage === 'comp') g.autoComp();
      if (g.offseason.stage === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.offseason!.stage).toBe('ready');
    const me = g.teamIdx;
    const cands = g.league.players.filter((p) => franchiseTagEligible(g.league, p, me)).sort((a, b) => a.contract.salary - b.contract.salary);
    expect(cands.length).toBeGreaterThan(0);
    const auto = franchiseTag(g.league, me, 2027)!;
    const pick = cands[0];
    const r1 = g.setFranchiseTag(pick.id);
    expect(r1.ok).toBe(true);
    expect(franchiseTag(g.league, me, 2027)!.id).toBe(pick.id);
    expect(g.actions.some((a) => a.type === 'franchise-tag')).toBe(true);
    // 자격 없는 선수는 고를 수 없다
    const other = g.league.players.find((p) => p.team !== me)!;
    expect(g.setFranchiseTag(other.id).ok).toBe(false);
    if (cands.length === 1) expect(auto.id).toBe(pick.id);
    expect(g.openNextSeason().ok).toBe(true);
    g.advance(5);
    const r = GameSession.replay(store, { year: 2026, teamIdx: 2, seed: 'tag-replay' }, g.actions, { year: 2027, day: g.day }, FAST);
    expect(r.league.franchiseTags).toEqual(g.league.franchiseTags);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 300_000);
});
