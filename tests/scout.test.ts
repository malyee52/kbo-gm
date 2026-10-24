// 스카우트 추측과 드래프트 보드 (능력치 v2 기획안 17.7·17.8·19.2·19.3). 리그를 만들지 않는 가벼운 시험.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gradeRuns } from '../src/league/potential';
import {
  aiDifficultyScale, boardTier, branchSigma, ceilingSigma, CEIL_SIGMA, draftBoard, gapPhrase, guessProspect, guessView, relationScale, sampleScale, scoutZ,
} from '../src/league/scout';
import { INVEST_COST, investCost, type InvestKind } from '../src/league/finance';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

const YEAR = 2027;

function fakeLeague(o: { amateur?: number; pro?: number; aiAmateur?: number; difficulty?: 'easy' | 'normal' | 'hard'; gm?: LeagueState['gm']; seed?: string } = {}): LeagueState {
  const lv = (a: number, p: number): Record<InvestKind, number> => ({ scout: a, scoutPro: p, develop: 1, medical: 1, marketing: 1 });
  const finance = Array.from({ length: 10 }, (_, t) => {
    const l = t === 0 ? lv(o.amateur ?? 1, o.pro ?? 1) : lv(o.aiAmateur ?? 1, 1);
    return { invest: l, active: l, history: [] };
  });
  return { seed: o.seed ?? 'scout-test', difficulty: o.difficulty ?? 'normal', finance, gm: o.gm, owner: { team: 0 } } as unknown as LeagueState;
}

function prospect(i: number, potential: number, extra: Partial<LeaguePlayer> = {}): LeaguePlayer {
  return { id: `v${i}`, name: `후보${i}`, isPitcher: i % 2 === 0, pos: i % 2 ? 'SS' : null, birthYear: YEAR - 19, potential, ...extra } as LeaguePlayer;
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}

describe('추측 폭 σ (17.7 ①)', () => {
  it('표본·관계·스카우트 배율', () => {
    expect(sampleScale(null)).toBe(2.5);
    expect(sampleScale(0)).toBe(2.5);
    expect(sampleScale(1500)).toBe(1);
    expect(sampleScale(750)).toBeCloseTo(1.75);
    expect(relationScale(null)).toBe(1);
    expect(relationScale(1)).toBeCloseTo(0.7);
    expect(relationScale(2)).toBeCloseTo(0.52);
    const L = fakeLeague({ pro: 3 });
    expect(branchSigma(L, { team: 0, user: true }, 'clear', { sample: 1500, seasonsWithUs: null, scout: 'pro' })).toBeCloseTo(3);
    expect(branchSigma(L, { team: 0, user: true }, 'mid', { sample: 1500, seasonsWithUs: null, scout: 'amateur' })).toBeCloseTo(9 * 0.8);
  });

  it('AI 구단 난이도 배율: 쉬움 1.5 · 보통 1 · 어려움 0.5, 플레이어 쪽에는 난이도가 없다 (Q5 ①)', () => {
    expect(aiDifficultyScale(fakeLeague({ difficulty: 'easy' }))).toBeCloseTo(1.5);
    expect(aiDifficultyScale(fakeLeague({ difficulty: 'normal' }))).toBeCloseTo(1);
    expect(aiDifficultyScale(fakeLeague({ difficulty: 'hard' }))).toBeCloseTo(0.5);
    for (const d of ['easy', 'normal', 'hard'] as const) expect(ceilingSigma(fakeLeague({ difficulty: d }), { team: 0, user: true })).toBe(CEIL_SIGMA[1]);
    expect(ceilingSigma(fakeLeague({ difficulty: 'easy' }), { team: 3, user: false })).toBeCloseTo(CEIL_SIGMA[1] * 1.5);
  });

  it('z는 보는 쪽·선수·갈래마다 고정이고 구단마다 다르게 틀린다', () => {
    const me = { team: 0, user: true };
    expect(scoutZ('s', me, 'p1', 'ceiling')).toBe(scoutZ('s', me, 'p1', 'ceiling'));
    expect(scoutZ('s', me, 'p1', 'ceiling')).not.toBe(scoutZ('s', me, 'p1', 'now'));
    expect(scoutZ('s', { team: 2, user: false }, 'p1', 'ceiling')).not.toBe(scoutZ('s', { team: 3, user: false }, 'p1', 'ceiling'));
    expect(scoutZ('s', me, 'p1', 'ceiling')).not.toBe(scoutZ('t', me, 'p1', 'ceiling'));
  });

  it('보이는 꼴: 5단위 범위, σ 1.5 아래는 숫자 하나, 20~80 안', () => {
    expect(guessView(61, 1, 0.4)).toEqual({ kind: 'one', v: 61 });
    const v = guessView(60, 6, 0.5);
    expect(v).toEqual({ kind: 'range', lo: 55, hi: 70, mid: 63 });
    const top = guessView(79, 6, 1.5);
    expect(top.kind === 'range' && top.hi).toBe(80);
  });

  it('스카우트 문구 4단계, 32세부터 없음', () => {
    expect(gapPhrase(2, 22)).toBe('거의 다 자랐다는 평');
    expect(gapPhrase(6, 22)).toBe('조금 더 클 수 있다는 평');
    expect(gapPhrase(12, 22)).toBe('크게 자랄 수 있다는 평');
    expect(gapPhrase(25, 22)).toBe('리그 정상급으로 클 수 있다는 평');
    expect(gapPhrase(25, 32)).toBeNull();
  });
});

describe('드래프트 보드 (19.2)', () => {
  it('아마추어 단계별 천장 추측과 진짜 천장의 상관이 기획안 표대로 (0.59 · 0.70 · 0.80 · 0.89)', () => {
    // 그 판 풀의 천장 퍼짐 약 9등급 (19.2). 2,000명이면 표본 오차 ±0.02 안팎
    const want = [0.59, 0.7, 0.8, 0.89];
    const truthG = Array.from({ length: 2000 }, (_, i) => 50 + 9 * Math.sqrt(-2 * Math.log((i + 0.5) / 2000)) * Math.cos(i * 2.399963));
    for (let lv = 0; lv < 4; lv++) {
      const L = fakeLeague({ amateur: lv });
      const guessG = truthG.map((g, i) => {
        const pot = gradeRuns(g, YEAR);
        const r = guessProspect(L, { team: 0, user: true }, { id: `c${i}`, potential: pot }, pot - 200, YEAR);
        return r.top;
      });
      expect(Math.abs(corr(truthG, guessG) - want[lv])).toBeLessThan(0.04);
    }
  });

  it('같은 시드 같은 보드, 다른 시드·다른 AI 구단은 다른 보드. 플레이어 보드에는 포수 가산이 없다', () => {
    const pool = Array.from({ length: 60 }, (_, i) => prospect(i, gradeRuns(40 + (i % 30), YEAR)));
    const now = Object.fromEntries(pool.map((p) => [p.id, p.potential - 20]));
    const o = { teams: 10, slots: 110, year: YEAR };
    const ids = (L: LeagueState, team: number, user: boolean, opt = o) => draftBoard(L, { team, user }, pool, now, opt).map((r) => r.id);
    const L = fakeLeague();
    expect(ids(L, 0, true)).toEqual(ids(fakeLeague(), 0, true));
    expect(ids(L, 0, true)).not.toEqual(ids(fakeLeague({ seed: 'other' }), 0, true));
    expect(ids(L, 3, false)).not.toEqual(ids(L, 4, false));
    const board = draftBoard(L, { team: 0, user: true }, pool, now, o);
    expect(board.map((r) => r.rank)).toEqual(pool.map((_, i) => i + 1));
    expect(board[0].tier).toBe('1라운드감');
    expect(board[0].note).toMatch(/평/);
    // AI 포수 필요 가산
    const pool2 = pool.map((p, i) => (i === 1 ? { ...p, pos: 'C' } : p));
    const withC = draftBoard(L, { team: 3, user: false }, pool2, now, { ...o, catcherBonus: 500 });
    expect(withC[0].id).toBe('v1');
    expect(draftBoard(L, { team: 0, user: true }, pool2, now, o)[0].id).toBe(board[0].id);
  });

  it('보드(지금 + 격차 몫)와 진짜 천장: 0단계 상관 약 0.66·상위 10명 중 4명 → 3단계 약 0.90·7명 (풀 110명, 시드 40개 평균)', () => {
    // 천장 퍼짐 9등급(정규), 지금 = 천장 − 12~18등급 (고졸 19세). 기획안 19.2 표(0.59 · 3.3명 → 0.89 · 6.6명)는 천장 추측만 본 어림
    const gauss = (i: number, s: number) => {
      const u = (i * 0.618 + s * 0.31) % 1 || 0.5;
      const v = (i * 0.414 + s * 0.77) % 1 || 0.5;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const S = 40;
    const out = [0, 3].map((lv) => {
      let c = 0, top = 0;
      for (let s = 0; s < S; s++) {
        const pool = Array.from({ length: 110 }, (_, i) => prospect(i, gradeRuns(47 + 9 * gauss(i, s), YEAR)));
        const now = Object.fromEntries(pool.map((p, i) => [p.id, gradeRuns(40 + 9 * gauss(i, s) - 5 - (i % 7), YEAR)]));
        const b = draftBoard(fakeLeague({ amateur: lv, seed: `b${s}` }), { team: 0, user: true }, pool, now, { teams: 10, slots: 110, year: YEAR });
        const trueTop = new Set([...pool].sort((x, y) => y.potential - x.potential).slice(0, 10).map((p) => p.id));
        top += b.slice(0, 10).filter((r) => trueTop.has(r.id)).length;
        const v = new Map(b.map((r) => [r.id, r.value]));
        c += corr(pool.map((p) => p.potential), pool.map((p) => v.get(p.id)!));
      }
      return { c: c / S, top: top / S };
    });
    expect(out[0].c).toBeGreaterThan(0.58);
    expect(out[0].c).toBeLessThan(0.74);
    expect(out[1].c).toBeGreaterThan(0.85);
    expect(out[1].top - out[0].top).toBeGreaterThan(2);
  });

  it('묶음 꼬리표', () => {
    expect(boardTier(10, 10, 110)).toBe('1라운드감');
    expect(boardTier(11, 10, 110)).toBe('2~3라운드감');
    expect(boardTier(31, 10, 110)).toBe('하위 라운드감');
    expect(boardTier(111, 10, 110)).toBe('육성감');
  });
});

describe('투자 갈래 (19.3)', () => {
  it('아마추어·프로 각각 0·5억·12억·20억, 장부는 투자와 스카우트비로 나뉜다', () => {
    expect(INVEST_COST.scout).toEqual([0, 50_000, 120_000, 200_000]);
    expect(INVEST_COST.scoutPro).toEqual([0, 50_000, 120_000, 200_000]);
    const f = { invest: { scout: 2, scoutPro: 3, develop: 0, medical: 0, marketing: 0 }, history: [] };
    expect(investCost(f, true, 1, (k) => k === 'scout' || k === 'scoutPro')).toBe(320_000);
    expect(investCost(f, true, 1)).toBe(320_000);
  });
});

describe('숨은 값은 스카우트가 보지 않는다 (17.4 ②, 19.2)', () => {
  it('scout.ts는 성장 성향 d·시기 τ·갈래 천장을 읽지 않고, AI 지명은 진짜 잠재를 직접 쓰지 않는다', () => {
    const src = readFileSync('src/league/scout.ts', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/\.drive\b|\.timing\b|\.ceil\b|driveOf|timingOf/);
    const off = readFileSync('src/league/offseason.ts', 'utf8');
    const fn = off.slice(off.indexOf('function bestProspect'), off.indexOf('function makePick'));
    expect(fn).not.toMatch(/aiPotential|\.potential\b|scoutPotential/);
  });
});
