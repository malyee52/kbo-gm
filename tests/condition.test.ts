// 엔진 2 12단계: 선수 컨디션 (docs/컨디션_기획안.md v1): 흐름·낱말·효과 0 = 지금 엔진·기복과 무관·저장 뒤 이어 돌리기
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { condLine, condSpread, condWord, DEFAULT_PARAMS, Rng, Season, worldForYear, type EngineParams } from '../src/engine';
import { openCondition, stepCondition } from '../src/engine/condition';

const store = loadDataStore();
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const C = DEFAULT_PARAMS.cond;
const withCond = (cond: Partial<EngineParams['cond']>): EngineParams => ({ ...NO_PILOT, cond: { ...C, ...cond } });

function run(params: EngineParams, seed: string, days: number, init: { hiddenSeed?: string } = {}) {
  const s = Season.start(worldForYear(store, 2025, params), params, seed, { cal: UNIT, ...init });
  for (let d = 0; d < days && !s.done; d++) s.simulateDay();
  return s;
}
const results = (s: Season) => {
  const { cond: _c, condDay: _d, ...rest } = s.toSave();
  return JSON.stringify(rest);
};

describe('컨디션 흐름 (condition.ts)', () => {
  it('오래 둔 퍼짐 약 0.35, 낱말 비율 약 12.7 / 74.7 / 12.7%, 평균 0', () => {
    expect(condSpread(C)).toBeCloseTo(0.351, 2);
    const flow = new Float32Array(2000);
    const rng = new Rng('cond-dist');
    openCondition(flow, rng, C);
    let n = 0, sum = 0, sq = 0;
    const words = { 좋음: 0, 보통: 0, 나쁨: 0 };
    for (let d = 0; d < 60; d++) {
      stepCondition(flow, rng, C);
      for (const v of flow) { n++; sum += v; sq += v * v; words[condWord(v, C)]++; }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(Math.sqrt(sq / n)).toBeGreaterThan(0.33);
    expect(Math.sqrt(sq / n)).toBeLessThan(0.37);
    expect(words.좋음 / n).toBeGreaterThan(0.11);
    expect(words.좋음 / n).toBeLessThan(0.145);
    expect(words.나쁨 / n).toBeGreaterThan(0.11);
    expect(words.나쁨 / n).toBeLessThan(0.145);
  });

  it('며칠 이어진다: 하루 뒤 상관 약 0.9', () => {
    const flow = new Float32Array(3000);
    const rng = new Rng('cond-ar');
    openCondition(flow, rng, C);
    const before = Float32Array.from(flow);
    stepCondition(flow, rng, C);
    let xy = 0, xx = 0;
    for (let i = 0; i < flow.length; i++) { xy += before[i] * flow[i]; xx += before[i] * before[i]; }
    expect(xy / xx).toBeGreaterThan(0.85);
    expect(xy / xx).toBeLessThan(0.95);
  });

  it('낱말 · 사유 문구 (숫자 없음, 사건 사유가 앞선다)', () => {
    expect(condLine(0.5, C)).toBe('좋음 · 몸 상태 좋음');
    expect(condLine(0.1, C)).toBe('보통');
    expect(condLine(-0.5, C)).toBe('나쁨 · 몸이 무거움');
    expect(condLine(-0.8, C)).toBe('나쁨 · 컨디션 난조');
    expect(condLine(0.1, C, '감기')).toBe('보통 · 감기');
    expect(condLine(-0.6, C, '감기')).toBe('나쁨 · 감기');
    for (const v of [-1, -0.4, 0, 0.4, 1]) expect(condLine(v, C)).not.toMatch(/\d/);
  });
});

describe('시즌의 컨디션 (엔진 2 12단계)', () => {
  it('효과 0이면 흐름의 크기와 상관없이 경기 결과가 같다 (컨디션 줄기가 다른 난수를 건드리지 않는다)', () => {
    const a = run(withCond({ edge: 0 }), 'cond-zero', 50);
    const b = run(withCond({ edge: 0, sd: 0 }), 'cond-zero', 50);
    expect(results(a)).toBe(results(b));
    // 효과를 켜면 달라진다
    const c = run(withCond({ edge: 0.04 }), 'cond-zero', 50);
    expect(results(c)).not.toBe(results(a));
  });

  it('숨은 능력 시드(기복·실제 한계 자리)를 바꿔도 모든 선수의 컨디션이 날마다 같다', () => {
    const a = run(NO_PILOT, 'cond-hidden', 30, { hiddenSeed: 'h1' });
    const b = run(NO_PILOT, 'cond-hidden', 30, { hiddenSeed: 'h2' });
    for (const p of a.world.players) expect(a.condition(p.idx)).toBe(b.condition(p.idx));
  });

  it('경기가 없는 날도 한 걸음 가고, 언제 물어도 그날 값은 같다', () => {
    const a = run(NO_PILOT, 'cond-day', 20);
    const b = run(NO_PILOT, 'cond-day', 10);
    // b는 10일까지 진행했지만 20일 값을 미리 물어볼 수 있다
    const ahead = b.world.players.map((p) => b.condition(p.idx, 20));
    expect(a.world.players.map((p) => a.condition(p.idx))).toEqual(ahead);
  });

  it('저장 뒤 이어 돌려도 같다 (컨디션 저장 있음·없음 모두)', () => {
    const params = NO_PILOT;
    const full = run(params, 'cond-save', 80);
    const half = run(params, 'cond-save', 35);
    const save = half.toSave();
    expect(save.cond).toBeDefined();
    const r1 = Season.restore(worldForYear(store, 2025, params), params, JSON.parse(JSON.stringify(save)));
    const { cond: _c, condDay: _d, ...old } = save;
    const r2 = Season.restore(worldForYear(store, 2025, params), params, JSON.parse(JSON.stringify(old)));
    for (let d = 35; d < 80; d++) { r1.simulateDay(); r2.simulateDay(); }
    expect(results(r1)).toBe(results(full));
    expect(results(r2)).toBe(results(full));
    expect(JSON.stringify(r1.toSave().cond)).toBe(JSON.stringify(full.toSave().cond));
  });
});

describe('컨디션 사건과 화면 정보 (엔진 2 12단계)', () => {
  it('몸 상태 사건: 구단 전체·한 선수, 기간 안에만, 사유는 가장 크게 내리는 사건', async () => {
    const { condToday } = await import('../src/league/events');
    const players = [{ idx: 0, id: 'a', teamIdx: 0 }, { idx: 1, id: 'b', teamIdx: 0 }, { idx: 2, id: 'c', teamIdx: 1 }];
    const league = { events: { chance: 0, pending: null, log: [], buffs: [], conds: [
      { team: 0, year: 2026, from: 10, until: 17, value: -0.5, reason: '감기' },
      { team: 0, year: 2026, from: 12, until: 15, value: -0.25, reason: '몸살', player: 'b' },
    ] } } as never;
    expect(condToday(league, 2026, 9, players)).toBeNull();
    const t = condToday(league, 2026, 13, players)!;
    expect([...t.value]).toEqual([-0.5, -0.75, 0]);
    expect(t.reason.get(1)).toBe('감기');
    expect(t.reason.has(2)).toBe(false);
    expect(condToday(league, 2026, 17, players)).toBeNull();
    expect(condToday(league, 2027, 13, players)).toBeNull();
  });

  it('몸 상태 이벤트(감기·배탈·몸살·컨디션 난조)는 경기력이 아니라 컨디션 사건을 건다', async () => {
    const { eventDef } = await import('../src/league/events');
    for (const id of ['x-team-flu', 'x-food-poison', 'x-body-ache', 'x-cond-slump']) {
      const def = eventDef(id)!;
      expect(def).toBeDefined();
      const src = def.choices.map((c) => c.apply.toString()).join('\n');
      expect(src).toMatch(/addCond/);
      expect(src).not.toMatch(/addForm/);
    }
  });

  it('화면은 낱말 · 사유만 받는다: 컨디션 숫자·흐름을 직접 읽지 않고, 컨디션 계산은 숨은 능력을 읽지 않는다', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk('src/ui')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/states\.cond\b|conditionFlow|\.condition\(|condToday|conditionOf/);
    }
    const cond = readFileSync('src/engine/condition.ts', 'utf8');
    expect(cond).not.toMatch(/traits|hidden|injuryProne|overuse|realLimit/);
  });
});

describe('AI 감독의 컨디션 반영 (엔진 2 12단계, 기획안 7.4)', () => {
  it('성향 0이면 컨디션을 보지 않은 라인업·선발과 같고, 성향이 크면 컨디션 좋은 백업이 들어온다', async () => {
    const { refreshActive, todaysLineup, todaysStarter } = await import('../src/engine/team');
    const s = run(NO_PILOT, 'cond-ai', 20);
    const ts = s.teamSeasons[0];
    refreshActive(ts, s.world, s.states, s.day);
    const ids = (xs: { idx: number }[]) => xs.map((p) => p.idx).join(',');
    const noTired = () => 0;
    ts.tactics = { steal: 1, bunt: 1, hook: 1, cond: 0 };
    const cond = (p: { idx: number }) => s.condition(p.idx);
    const base = todaysLineup(ts, s.world.league, NO_PILOT, new Rng('l'), 'R', noTired);
    expect(ids(todaysLineup(ts, s.world.league, NO_PILOT, new Rng('l'), 'R', noTired, cond))).toBe(ids(base));
    expect(todaysStarter(ts, s.states, s.day, NO_PILOT, () => -1).idx).toBe(todaysStarter(ts, s.states, s.day, NO_PILOT).idx);
    // 벤치 선수 한 명만 컨디션 +1, 주전 모두 −1이면 (성향 1.5) 그 선수가 들어온다
    const bench = ts.hitters.find((p) => !base.includes(p))!;
    ts.tactics = { steal: 1, bunt: 1, hook: 1, cond: 1.5 };
    const skewed = (p: { idx: number }) => (p.idx === bench.idx ? 1 : -1);
    const big = { ...NO_PILOT, cond: { ...NO_PILOT.cond, edge: 0.4 } };
    expect(todaysLineup(ts, s.world.league, big, new Rng('l'), 'R', noTired, skewed).some((p) => p.idx === bench.idx)).toBe(true);
  });

  it('차례인 선발의 컨디션이 나쁨이면 다음 투수가 먼저 나온다 (성향 1)', async () => {
    const { todaysStarter } = await import('../src/engine/team');
    const s = run(NO_PILOT, 'cond-ai2', 30);
    const ts = s.teamSeasons[1];
    ts.tactics = { steal: 1, bunt: 1, hook: 1, cond: 1 };
    const day = s.day + 6; // 모두 충분히 쉰 날
    const first = todaysStarter(ts, s.states, day, NO_PILOT);
    const bad = (p: { idx: number }) => (p.idx === first.idx ? -0.6 : 0);
    expect(todaysStarter(ts, s.states, day, NO_PILOT, bad).idx).not.toBe(first.idx);
    expect(todaysStarter(ts, s.states, day, NO_PILOT, (p) => (p.idx === first.idx ? -0.3 : 0)).idx).toBe(first.idx);
  });

  it('가상 감독의 컨디션 반영은 0.5~1.5, 실존 감독은 1', async () => {
    const { tacticsOf } = await import('../src/league/managers');
    for (const n of ['가상가', '가상나', '가상다', '가상라']) {
      const t = tacticsOf(undefined, n);
      expect(t.cond).toBeGreaterThanOrEqual(0.5);
      expect(t.cond).toBeLessThanOrEqual(1.5);
    }
    expect(tacticsOf({ steal: 1, bunt: 1, relief: 1 } as never, '실존').cond).toBe(1);
  });
});
