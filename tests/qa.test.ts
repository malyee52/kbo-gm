// 2026-10-09 기능 점검(QA)에서 고친 것들: 시대별 물가 표기, 캡 도입 전 예산, 외국인 요구액 분포, 포지션 없는 야수, 포스트시즌 대진 설명, 자동 저장 칸.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { createLeague } from '../src/league/create';
import { budgetFor, spendLimit } from '../src/league/owner';
import { roundsFor } from '../src/league/postseason';
import { FOREIGN_NEW_CAP, foreignSalary, PRE_CAP_BUDGET, priceIndex, salaryCap, wonText } from '../src/league/salary';
import { autoSlotOf, isAutoSlot } from '../src/game/storage';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('시대별 물가 표기 (내부 값은 2026년 물가)', () => {
  it('물가 계수는 2026년 1, 과거로 갈수록 작고 단조롭게 는다', () => {
    expect(priceIndex(2026)).toBe(1);
    expect(priceIndex(2040)).toBe(1);
    expect(priceIndex(1982)).toBeLessThan(0.1);
    let prev = 0;
    for (let y = 1982; y <= 2026; y++) {
      const v = priceIndex(y);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(priceIndex(2000)).toBeCloseTo(0.3, 5);
    expect(priceIndex(2002)).toBeGreaterThan(0.3);
    expect(priceIndex(2002)).toBeLessThan(0.45);
  });

  it('wonText는 연도를 주면 그 해 물가로 바꿔 보여 준다', () => {
    expect(wonText(10000)).toBe('1억 원');
    expect(wonText(10000, 2026)).toBe('1억 원');
    expect(wonText(10000, 2000)).toBe('3,000만 원');
    expect(wonText(100000, 2000)).toBe('3억 원');
  });
});

describe('캡 도입 전 예산', () => {
  it('2022년 이전에도 구단 예산이 있어 FA 제시에 상한이 생긴다 (캡 제재는 없음)', () => {
    const { league } = createLeague(store, 1999, 'qa-budget', FAST);
    expect(salaryCap(2000)).toBeNull();
    const b = budgetFor(league, 0, 2000);
    expect(b).not.toBeNull();
    expect(b!).toBeLessThanOrEqual(PRE_CAP_BUDGET);
    expect(b!).toBeGreaterThan(PRE_CAP_BUDGET * 0.7);
    expect(spendLimit(league, 0, 2000)).toBe(b);
  });
});

describe('외국인 신규 요구액', () => {
  it('상한 아래에 퍼진다 (후보 대부분이 100만 달러로 같지 않다)', () => {
    const asks = [0, 5, 10, 14, 20, 25, 30].map((r) => foreignSalary(r, true, false));
    expect(new Set(asks).size).toBeGreaterThanOrEqual(5);
    expect(asks[0]).toBeLessThan(FOREIGN_NEW_CAP);
    expect(asks[3]).toBeLessThan(FOREIGN_NEW_CAP);
    expect(asks[asks.length - 1]).toBeLessThanOrEqual(FOREIGN_NEW_CAP);
    expect(foreignSalary(14, false, false)).toBeGreaterThan(foreignSalary(14, true, false));
  });
});

describe('포지션이 없는 야수', () => {
  it('1999년 월드의 야수는 모두 포지션(내야·외야 구분이라도)이 있다', () => {
    const w = worldForYear(store, 1999);
    const noPos = w.players.filter((p) => !p.isPitcher && !p.pos);
    expect(noPos.map((p) => p.name)).toEqual([]);
  });
});

describe('포스트시즌 라운드 구성', () => {
  it('진출 팀 수에 따라 2팀 한국시리즈, 4팀 준PO부터, 5팀 와일드카드부터', () => {
    expect(roundsFor(2)).toEqual(['ks']);
    expect(roundsFor(4)).toEqual(['semi', 'po', 'ks']);
    expect(roundsFor(5)).toEqual(['wc', 'semi', 'po', 'ks']);
  });
});

describe('자동 저장 칸', () => {
  it('게임마다 다른 칸을 쓰고, 예전 auto 칸도 자동 저장으로 본다', () => {
    expect(autoSlotOf(2026, 'abc')).not.toBe(autoSlotOf(2026, 'abd'));
    expect(autoSlotOf(2026, 'abc')).not.toBe(autoSlotOf(1999, 'abc'));
    expect(isAutoSlot('auto')).toBe(true);
    expect(isAutoSlot(autoSlotOf(2026, 'abc'))).toBe(true);
    expect(isAutoSlot('저장 1')).toBe(false);
  });
});

describe('부임 이력의 구단 이름', () => {
  it('승계 뒤에도 그 시즌의 이름이 남는다 (1999 쌍방울 → 2000 SK)', () => {
    const g = GameSession.create(store, { year: 1999, teamIdx: store.season(1999)!.teams.findIndex((t) => t.name === '쌍방울'), seed: 'qa-name' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    expect(g.league.teams[g.teamIdx].name).toBe('SK');
    const h = g.owner.history[0];
    expect(h.year).toBe(1999);
    expect(h.teamName).toBe('쌍방울');
  }, 120_000);
});
