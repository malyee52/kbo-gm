// 오프시즌 단계 화면 계산 (UI 2단계 U2-6, src/ui/offStage.ts): 남은 처리·"넘기면 일어나는 일"·단계 요약·지난 단계 기록.
// 남은 처리의 "먼저"(막힘) 표시는 실제 단계 진행이 막히는 조건(Off.blockedReason)과 늘 같아야 한다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import * as Off from '../src/league/offseason';
import { stageHeadline, stageLeftovers, stageRecord, type Leftover } from '../src/ui/offStage';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
}, 120_000);

describe('오프시즌 남은 처리 (2026 LG, 시즌 끝까지 자동)', () => {
  let g: GameSession;
  const seen: { stage: Off.Stage; left: Leftover[] }[] = [];
  beforeAll(() => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'off-stage' }, FAST);
    g.advance(1000);
    g.beginOffseason();
  }, 180_000);

  it('시즌 중에는 남은 처리가 없다', () => {
    const h = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'off-stage-season' }, FAST);
    expect(stageLeftovers(h)).toEqual([]);
    expect(stageHeadline(h)).toEqual([]);
  });

  it('여덟 단계를 끝까지: 막힘 표시 = 실제로 넘길 수 없음, 자동 처리 길로 풀리고, 개막 준비에는 남은 일이 없다', () => {
    for (let k = 0; k < 30 && g.offseason!.stage !== 'ready'; k++) {
      const off = g.offseason!;
      const left = stageLeftovers(g);
      seen.push({ stage: off.stage, left });
      const blocked = Off.blockedReason(g.league, off) !== null;
      expect(left.some((l) => l.blocking), `${off.stage}: ${JSON.stringify(left)}`).toBe(blocked);
      for (const l of left) {
        expect(l.title.length).toBeGreaterThan(0);
        expect(l.then.length).toBeGreaterThan(0);
        if (l.blocking) expect(l.fix).toBeDefined();
      }
      expect(stageHeadline(g).length).toBeGreaterThan(0);
      // 막히면 그대로 넘겨도 단계가 그대로 (확인 창은 자동 처리 길만 준다)
      if (blocked) {
        const before = off.stage;
        g.nextStage();
        expect(g.offseason!.stage).toBe(before);
        const fix = left.find((l) => l.fix)!.fix!;
        const r = fix === 'auto-comp' ? g.autoComp() : fix === 'auto-draft' ? g.autoDraft() : g.autoRelease();
        expect(r.ok).toBe(true);
        expect(stageLeftovers(g).some((l) => l.blocking)).toBe(false);
      }
      expect(g.nextStage().ok).toBe(true);
    }
    expect(g.offseason!.stage).toBe('ready');
    expect(stageLeftovers(g)).toEqual([]);
    // FA는 라운드마다 한 번씩, 드래프트는 우리 지명이 남아 막힌다
    expect(seen.filter((x) => x.stage === 'fa').length).toBe(Off.FA_ROUNDS);
    expect(seen.find((x) => x.stage === 'draft')!.left.some((l) => l.key === 'draft' && l.blocking)).toBe(true);
  });

  it('지난 단계 기록: 단계별 소식 묶음, 우리 것만 / 전체', () => {
    const fa = stageRecord(g, 'fa', true);
    expect(fa.length).toBeGreaterThan(0);
    expect(stageRecord(g, 'fa', false).length).toBeLessThanOrEqual(fa.length);
    expect(stageRecord(g, 'settle', true).length).toBeGreaterThan(0);
    expect(g.offseason!.log.filter((l) => l.stage === 'draft').length).toBe(stageRecord(g, 'draft', true).length);
  });

  it('조회만 해도 진행 결과가 같다 (계산이 조작을 만들지 않음)', () => {
    const save = roundTrip(g.toSave());
    const h = GameSession.load(store, save, FAST);
    stageLeftovers(h);
    stageHeadline(h);
    stageRecord(h, 'fa', true);
    expect(roundTrip(h.toSave())).toEqual(save);
  });
});
