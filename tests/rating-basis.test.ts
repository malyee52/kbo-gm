// 능력치 기준 (engine/params.ts ratingBasis, 2026-10-12): 역사 재현은 그 시즌 기록 중심, 예측은 직전 3시즌. 잠재력은 어느 쪽이든 실제 고점.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

/** 주전 타자 9명 평균 가치(높을수록 좋다)와 투수 10명 평균 실점 가치(낮을수록 좋다) */
const side = (y: number, basis: 'season' | 'prior', name: string) => {
  const org = worldForYear(store, y, { ...DEFAULT_PARAMS, ratingBasis: basis }).teams.find((x) => x.name === name)!.org;
  const bat = org.filter((p) => !p.isPitcher).sort((a, b) => b.value - a.value).slice(0, 9).reduce((s, p) => s + p.value, 0) / 9;
  const pit = org.filter((p) => p.isPitcher).sort((a, b) => a.value - b.value).slice(0, 10).reduce((s, p) => s + p.value, 0) / 10;
  return { bat, pit };
};

describe('능력치 기준', () => {
  it('역사 재현은 그해 실제로 강했던 팀을 더 강하게, 무너진 팀을 더 약하게 본다 (2016 두산, 2002 롯데)', () => {
    expect(side(2016, 'season', '두산').bat).toBeGreaterThan(side(2016, 'prior', '두산').bat);
    expect(side(2002, 'season', '롯데').bat).toBeLessThan(side(2002, 'prior', '롯데').bat);
    expect(side(2002, 'season', '롯데').pit).toBeGreaterThan(side(2002, 'prior', '롯데').pit);
  });

  it('새 게임 선택이 리그에 남고 재현 정보에 들어간다. 예전 조작 기록(선택 없음)은 예측 기준', () => {
    const a = GameSession.create(store, { year: 2016, teamIdx: 0, seed: 'basis', ratingBasis: 'season' }, FAST);
    const b = GameSession.create(store, { year: 2016, teamIdx: 0, seed: 'basis' }, FAST);
    expect(a.league.ratingBasis).toBe('season');
    expect(a.reproInfo().opts.ratingBasis).toBe('season');
    expect(b.league.ratingBasis).toBeUndefined();
    expect(b.reproInfo().opts.ratingBasis).toBeUndefined();
  }, 120_000);

  it('잠재력은 보여 준 고점 아래로 안 간다: 하락기(2012)에 시작해도 김광현의 잠재력은 고점 수준, 전성기(2010) 시작에는 지금 능력이 바닥', () => {
    const at = (y: number) => {
      const g = GameSession.create(store, { year: y, teamIdx: 0, seed: 'kkh', ratingBasis: 'season' }, FAST);
      const lp = g.league.players.find((x) => x.name === '김광현' && x.isPitcher && x.team >= 0)!;
      const ctx = valueContext(g.world);
      return { pot: lp.potential, now: currentRuns(g.world.players.find((x) => x.id === lp.id)!, ctx) };
    };
    const prime = at(2010);
    const slump = at(2012);
    // 잠재력 v2 (기획안 18.2): 시작 연도 전 기록만 보고 고정 선수는 max(지금, 보여 준 고점, 기준 + 나이 폭 ½ × z).
    // 2010년(22세) 시작은 앞날 기록을 보지 않으므로 지금 능력 위로 나이 여유분이 붙을 수 있다 (예전 v1은 실제 고점에 묶었다)
    expect(prime.pot).toBeGreaterThanOrEqual(prime.now - 1e-6);
    // 2012년(부진한 해) 시작: 지금 능력은 낮아도 잠재력은 2010년에 보여 준 고점 수준 (시작 연도 리그 환경에 따라 런 값만 조금 다르다)
    expect(slump.now).toBeLessThan(prime.now - 20);
    expect(slump.pot).toBeGreaterThan(prime.now * 0.85);
  }, 240_000);
});
