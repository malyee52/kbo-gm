// 판타지 3~5단계: 효과 검사, 대화·사건 선택, 이야기 줄기, 큰 변화(유망주·구단주 교체)와 재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { sanitizeEffects, type EffectPlayer } from '../src/fantasy/effects';
import { applyArc, pendingChoices, type FantasyState } from '../src/fantasy/types';
import { arcReady, autoEventDue, chatTurn, effectRoster, makeEvent } from '../src/fantasy/ai';
import { castOf } from '../src/fantasy/cast';
import { cashOf } from '../src/league/finance';
import { fanLevel } from '../src/league/stadium';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('효과 검사', () => {
  const roster: EffectPlayer[] = [{ id: 'r1', name: '실존이', real: true }, { id: 'v1', name: '가상이', real: false }, { id: 'v2', name: '같은이름', real: false }, { id: 'v3', name: '같은이름', real: false }];
  it('상한으로 자르고, 실존 선수 잠재력·모르는 선수·큰 변화(사건)는 버린다', () => {
    const { effects, dropped } = sanitizeEffects([
      { type: 'trust', delta: 50 }, { type: 'potential', player: '실존이', delta: 3 }, { type: 'potential', player: '가상이', delta: 9 },
      { type: 'rest', player: '없는사람', days: 3 }, { type: 'prospect', name: '김신인', pos: 'P', age: 18, potential: 40 },
    ], 'event', roster);
    expect(effects).toEqual([{ type: 'trust', delta: 6 }, { type: 'potential', player: 'v1', delta: 4 }]);
    expect(dropped.join(' ')).toMatch(/실존 선수/);
    expect(dropped.join(' ')).toMatch(/절정에서만/);
  });
  it('이름이 겹치는 선수는 고르지 않는다, 대화는 2개까지', () => {
    const { effects } = sanitizeEffects([{ type: 'rest', player: '같은이름', days: 2 }, { type: 'fans', delta: 1 }, { type: 'trust', delta: 1 }, { type: 'cash', amount: 99999999 }], 'chat', roster);
    expect(effects).toEqual([{ type: 'fans', delta: 1 }, { type: 'trust', delta: 1 }]);
  });
  it('절정(arc)에서는 유망주·구단주 교체, 값은 범위 안으로', () => {
    const { effects } = sanitizeEffects([{ type: 'prospect', name: '김신인', pos: 'X', age: 30, potential: 99 }, { type: 'ownerChange', trust: 5 }], 'arc', roster);
    expect(effects).toEqual([{ type: 'prospect', name: '김신인', pos: 'IF', age: 22, potential: 45 }, { type: 'ownerChange', trust: 40 }]);
  });
});

describe('이야기 줄기', () => {
  it('같은 제목이면 이어지고, 다른 제목이면 새로 시작, done이면 끝난다', () => {
    const f: FantasyState = { log: [] };
    applyArc(f, { title: 'A', summary: 's1' }, { year: 2026, day: 1 });
    applyArc(f, { title: 'A', summary: 's2' }, { year: 2026, day: 5 });
    expect(f.arc).toMatchObject({ title: 'A', beats: 2, summary: 's2' });
    applyArc(f, { title: 'B', summary: 't' }, { year: 2026, day: 9 });
    expect(f.pastArcs!.map((a) => a.title)).toEqual(['A']);
    applyArc(f, { title: 'B', summary: 'end', done: true }, { year: 2026, day: 12 });
    expect(f.arc).toBeUndefined();
    expect(f.pastArcs!.map((a) => a.title)).toEqual(['A', 'B']);
  });
});

describe('판타지 게임: 대화·사건·큰 변화', () => {
  it('가상 인물은 시드로 늘 같고 실존 선수 이름과 겹치지 않는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'st-cast', fantasy: {} }, FAST);
    const c = castOf(g.league);
    expect(c).toHaveLength(5);
    expect(castOf(roundTrip(g.league)).map((x) => x.name)).toEqual(c.map((x) => x.name));
    const names = new Set(g.league.players.map((p) => p.name));
    for (const m of c) expect(names.has(m.name)).toBe(false);
  }, 120_000);

  it('대화·사건(시험용 AI): 선택하면 효과가 들어가고, 저장·불러오기와 재현이 같다', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'st-1', fantasy: {} }, FAST);
    g.advance(12);
    expect(autoEventDue(g)).toBe(true);
    const chat = await chatTurn(g, store, mock, castOf(g.league)[0], '이번 주 분위기 어때요?');
    g.addFantasy(chat);
    const ev = await makeEvent(g, store, mock);
    expect(ev.choices!.length).toBeGreaterThanOrEqual(2);
    g.addFantasy(ev);
    expect(pendingChoices(g.fantasy)).toHaveLength(1);
    expect(autoEventDue(g)).toBe(false); // 답을 기다리는 사건이 있으면 새로 만들지 않는다
    expect(g.fantasy!.arc?.title).toBe('팬과 함께');
    const id = g.fantasy!.log.at(-1)!.id!;
    const fans0 = fanLevel(g.league, g.teamIdx, 2026, g.day);
    expect(g.chooseFantasy(id, 0).ok).toBe(true);
    expect(g.chooseFantasy(id, 1).ok).toBe(false);
    expect(fanLevel(g.league, g.teamIdx, 2026, g.day)).toBeGreaterThan(fans0);
    g.advance(3);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(roundTrip(h.toSave().league)).toEqual(roundTrip(g.toSave().league));
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 300_000);

  it('큰 변화: 절정의 선택으로 구단주 교체·자금·유망주 입단 (다음 개막), 재현도 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'st-big', fantasy: {} }, FAST);
    g.advance(5);
    for (let k = 0; k < 3; k++) g.addFantasy({ kind: 'event', title: `줄기 ${k}`, text: 't', choices: [{ label: 'a', result: '', effects: [] }, { label: 'b', result: '', effects: [] }], arc: { title: '새 시대', summary: `${k}` } });
    for (const e of g.fantasy!.log) g.chooseFantasy(e.id!, 0);
    expect(arcReady(g)).toBe(true);
    const roster = effectRoster(g);
    const { effects } = sanitizeEffects([{ type: 'ownerChange', trust: 60 }, { type: 'cash', amount: 500_000 }, { type: 'prospect', name: '한별빛', pos: 'P', age: 18, potential: 42 }], 'arc', roster);
    expect(effects).toHaveLength(3);
    const cash0 = cashOf(g.league, g.teamIdx);
    g.addFantasy({ kind: 'event', title: '절정', text: 't', choices: [{ label: '받아들인다', result: '', effects }, { label: '거절', result: '', effects: [] }], arc: { title: '새 시대', summary: 'end', climax: true, done: true } });
    g.chooseFantasy(g.fantasy!.log.at(-1)!.id!, 0);
    expect(g.league.owner!.trust).toBe(60);
    expect(cashOf(g.league, g.teamIdx)).toBe(cash0 + 500_000);
    expect(g.fantasy!.prospects).toHaveLength(1);
    expect(g.fantasy!.arc).toBeUndefined();
    g.advance(100000);
    g.beginOffseason();
    for (let guard = 0; g.offseason && g.offseason.stage !== 'ready' && guard < 50; guard++) {
      const st = g.offseason.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.openNextSeason().ok).toBe(true);
    const p = g.league.players.find((x) => x.name === '한별빛')!;
    expect(p.team).toBe(g.teamIdx);
    expect(p.real).toBe(false);
    expect(p.potential).toBeGreaterThanOrEqual(40);
    expect(g.fantasy!.prospects).toEqual([]);
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(r.league.players.some((x) => x.name === '한별빛' && x.team === g.teamIdx)).toBe(true);
  }, 600_000);
});
