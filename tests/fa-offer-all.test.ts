// 편의 U2: "우리 FA 모두 요구 조건대로 제시" (session.offerAllOwnFa).
// 새 조작 종류 없이 선수마다 'fa-offer' 조작을 보내므로 조작 기록·재현·저장 뒤 결과가 같아야 하고, 거절은 선수별로 모인다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { stageLeftovers } from '../src/ui/offStage';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let g: GameSession;

beforeAll(() => {
  store = loadDataStore();
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fa-offer-all' }, FAST);
  g.advance(1000);
  g.beginOffseason();
  if (g.offseason!.stage === 'vote') g.nextStage();
}, 600_000);

describe('우리 FA 모두 요구 조건대로 제시 (편의 U2)', () => {
  it('FA 단계에 우리 FA가 있고, 남은 처리 창에 자동 처리 길이 붙는다', () => {
    expect(g.offseason!.stage).toBe('fa');
    expect(g.ownFaOpen().length).toBeGreaterThan(0);
    const own = stageLeftovers(g).find((l) => l.key === 'fa-own');
    expect(own?.fix).toBe('offer-own-fa');
  });

  it('요구 연봉·기간 그대로 선수마다 fa-offer 조작이 남고, 미리보기 총액이 그 합이다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const list = h.ownFaOpen();
    // 요구 연봉이 큰 순서 (공개 값)
    for (let i = 1; i < list.length; i++) expect(list[i - 1].ask).toBeGreaterThanOrEqual(list[i].ask);
    const pv = h.ownFaOfferPreview();
    expect(pv.count).toBe(list.length);
    expect(pv.total).toBe(list.reduce((s, e) => s + e.ask, 0));
    const n0 = h.actions.length;
    const r = h.offerAllOwnFa();
    expect(r.offered.length + r.failed.length).toBe(list.length);
    const added = h.actions.slice(n0);
    expect(added.every((a) => a.type === 'fa-offer')).toBe(true);
    expect(added.length).toBe(list.length);
    for (const id of r.offered) {
      const e = list.find((x) => x.id === id)!;
      expect(h.offseason!.fa.userOffers[id]).toMatchObject({ salary: Math.round(e.ask), years: e.years });
    }
    // 다 제시하면 남은 처리에서 빠지고, 다시 누르면 할 일이 없다
    if (!r.failed.length) expect(stageLeftovers(h).some((l) => l.key === 'fa-own')).toBe(false);
    expect(h.ownFaOpen().length).toBe(r.failed.length);
  });

  it('재현·저장 뒤 같다: 조작 기록으로 다시 돌린 판과 저장했다 불러온 판이 라운드 마감 결과까지 같다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    h.offerAllOwnFa();
    const info = h.reproInfo();
    const back = GameSession.replay(store, roundTrip(info.opts), roundTrip(info.actions), info.at, FAST);
    expect(back.offseason!.fa.userOffers).toEqual(h.offseason!.fa.userOffers);
    const saved = GameSession.load(store, roundTrip(h.toSave()), FAST);
    expect(saved.offseason!.fa.userOffers).toEqual(h.offseason!.fa.userOffers);
    // 라운드 마감 결과 (선수의 선택)도 같다
    for (const s of [h, back, saved]) s.nextStage();
    const view = (s: GameSession) => s.offseason!.fa.entries.map((e) => [e.id, e.status, e.team, e.salary]);
    expect(view(back)).toEqual(view(h));
    expect(view(saved)).toEqual(view(h));
  });

  it('거절은 선수별로 모은다: 다른 제시로 캡·자금이 꽉 찼으면 우리 FA마다 까닭이 남고 제시는 등록되지 않는다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const off = h.offseason!;
    const ext = off.fa.entries.find((e) => e.from !== h.teamIdx && e.status === 'open');
    expect(ext).toBeTruthy();
    // 시험 대상이 아닌 길(외부 제시 검사)을 건너뛰어 아주 큰 외부 제시를 바로 넣는다 (재현 시험이 아니다)
    off.fa.userOffers[ext!.id] = { team: h.teamIdx, salary: 50_000_000, years: 1 };
    const list = h.ownFaOpen();
    const r = h.offerAllOwnFa();
    expect(r.ok).toBe(false);
    expect(r.failed.map((f) => f.id).sort()).toEqual(list.map((e) => e.id).sort());
    for (const f of r.failed) {
      expect(f.message.length).toBeGreaterThan(0);
      expect(r.message).toContain(f.name);
      expect(off.fa.userOffers[f.id]).toBeUndefined();
    }
    const pv = h.ownFaOfferPreview();
    expect(pv.limit).not.toBeNull();
    expect(pv.after).toBeGreaterThan(pv.limit!);
  });
});
