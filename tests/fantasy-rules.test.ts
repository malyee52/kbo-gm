// 자유 모드 규정 변경: 바뀐 규정이 실제 판정(트레이드 인원·마감·캡·정원)에 들어가고, 지명권 이동·외국인 포스팅·리그 밖 인물 처리, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { namesContext, resolveOps, rulesContext } from '../src/fantasy/free';
import { pickOwner } from '../src/league/picks';
import { ruleOf, foreignPostingOn } from '../src/league/rules';
import { salaryCap } from '../src/league/salary';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('자유 모드 규정', () => {
  it('규정 변경이 판정에 들어가고, 지명권이 넘어가고, 저장·재현이 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'rules-1', fantasy: { free: true } }, FAST);
    expect(g.league.rules).toBeUndefined();
    expect(rulesContext(g, store)).toContain('거래 가능');
    const sam = g.league.teams.findIndex((t) => t.name === '삼성');
    const { ops, dropped } = resolveOps(g, [
      { op: 'rule', key: 'maxPerSide', value: 6 },
      { op: 'rule', key: 'tradeDeadline', value: 930 },
      { op: 'rule', key: 'capScale', value: 0 },
      { op: 'rule', key: 'orgLimit', value: 999 },
      { op: 'rule', key: 'foreignPosting', value: 1 },
      { op: 'pick', draft: 2027, round: 1, from: '삼성', to: 'LG' },
      { op: 'pick', draft: 2035, round: 1, from: '삼성', to: 'LG' },
      { op: 'rule', key: '없는규정', value: 1 },
    ]);
    expect(dropped.length).toBe(2);
    expect(ops.find((o) => o.op === 'rule' && o.key === 'orgLimit')).toMatchObject({ value: 90 });
    g.addFantasy({ kind: 'action', title: '이사회 설득', text: 'x', ops });
    expect(ruleOf(g.league, 'maxPerSide')).toBe(6);
    expect(salaryCap(2026, g.league)).toBeNull();
    expect(foreignPostingOn(g.league)).toBe(true);
    expect(pickOwner(g.league, { draft: 2027, round: 1, from: sam })).toBe(g.teamIdx);
    expect(rulesContext(g, store)).toContain('바뀐 규정');
    // 5명 트레이드도 인원 규정으로는 막히지 않는다
    const five = g.team.org.filter((p) => !p.foreign && !p.dev).slice(0, 5);
    const ev = g.evaluateTrade(sam, five, []);
    expect(ev.message).not.toContain('명까지');
    // 마감이 9월 30일로: 8월에도 트레이드가 된다
    g.advance(130);
    expect(g.tradeOpen).toBe(true);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(roundTrip(h.toSave().league)).toEqual(roundTrip(g.toSave().league));
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
    // 기본값으로 돌리면 기록에서 지운다
    g.addFantasy({ kind: 'action', title: '원상 복구', text: 'x', ops: resolveOps(g, [{ op: 'rule', key: 'maxPerSide', value: 4 }]).ops });
    expect(g.league.rules?.maxPerSide).toBeUndefined();
  }, 600_000);

  it('외국인 포스팅: 자유 모드에서 켜면 외국인 선수도 해외로 간다 (기본 모드에서는 규정이 있어도 작동 안 함)', () => {
    let seen = 0;
    for (const seed of ['fp-1', 'fp-2', 'fp-3']) {
      const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed, fantasy: { free: true } }, FAST);
      g.addFantasy({ kind: 'action', title: '포스팅 허용', text: 'x', ops: resolveOps(g, [{ op: 'rule', key: 'foreignPosting', value: 1 }]).ops });
      g.advance(100000);
      g.beginOffseason();
      const gone = g.league.players.filter((p) => p.foreign && p.abroad?.mode === 'posting');
      const asked = (g.offseason!.postings ?? []).filter((x) => g.leaguePlayer(x.id)?.foreign);
      for (const p of gone) expect(p.abroad!.returnYear).toBe(9999);
      seen += gone.length + asked.length;
      if (seen) break;
    }
    expect(seen).toBeGreaterThan(0);
    const b = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'fp-base' }, FAST);
    b.league.rules = { foreignPosting: 1 };
    expect(foreignPostingOn(b.league)).toBe(false);
  }, 900_000);

  it('리그 밖 실존 인물: 이름 안내, 실존 이름으로 가상 선수를 만들지 않는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'rules-3', fantasy: { free: true } }, FAST);
    const text = namesContext(g, store, 'MLB에서 뛰는 박찬호를 스카우팅해');
    expect(text).toContain('리그에 없음');
    expect(text).toMatch(/박찬호@/);
    const { ops, dropped } = resolveOps(g, [{ op: 'create', name: '박찬호', team: 'LG', pos: 'P', age: 25, now: 70, potential: 75 }], store);
    expect(ops.length).toBe(0);
    expect(dropped[0]).toContain('실존');
  }, 120_000);
});
