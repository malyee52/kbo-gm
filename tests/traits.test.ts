// 숨겨진 특수능력 (2026-10-08): 데이터 키, 엔진 효과, 숨김(화면·AI·저장에 나오지 않음).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import {
  DEFAULT_PARAMS, DEFAULT_TRAIT_PARAMS, Rng, Season, TRAIT_CODES, traitEdge, traitKey, traitsOf, worldForYear,
  type EngineParams, type Situation, type World,
} from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { growthRuns } from '../src/league/growth';
import { GameSession } from '../src/game/session';

let store: DataStore;
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const SIT: Situation = { postseason: false, home: false, runnersOn: false, scoring: false, late: false };

beforeAll(() => {
  store = loadDataStore();
});

describe('데이터 키', () => {
  it('traitKey는 tools/build_data.py의 trait_key와 같은 값을 낸다', () => {
    expect(traitKey('75847')).toBe('fdf3222e');
    expect(traitKey('77637')).toBe('5eabe491');
    expect(traitKey('x')).toBe('dfd95b1f');
  });

  it('traits.json의 키는 모두 실제 선수의 해시이고 코드는 아는 값이다', () => {
    const table = store.traits;
    expect(table).toBeDefined();
    const keys = new Set([...store.players.keys()].map(traitKey));
    const entries = Object.entries(table!);
    expect(entries.length).toBeGreaterThan(20);
    for (const [k, v] of entries) {
      expect(keys.has(k)).toBe(true);
      for (const c of v) expect(TRAIT_CODES).toContain(c);
    }
  });

  it('월드를 만들면 능력이 붙고, 표가 없으면 아무도 없다', () => {
    const w = worldForYear(store, 2026);
    const withTraits = w.players.filter((p) => p.traits?.length);
    expect(withTraits.length).toBeGreaterThan(20);
    expect(withTraits.every((p) => p.real !== false)).toBe(true);
    const bare = worldForYear({ ...store, traits: undefined }, 2026);
    expect(bare.players.some((p) => p.traits)).toBe(false);
    expect(traitsOf(undefined, '75847')).toBeUndefined();
    expect(traitsOf({ [traitKey('1')]: ['nonsense'] }, '1')).toBeUndefined();
  });
});

describe('엔진 효과', () => {
  const tp = DEFAULT_TRAIT_PARAMS;
  it('승부사는 득점권·접전 후반에만, 안방 사나이는 홈에서만, 킬러는 그 손 투수에게만 붙는다', () => {
    const b = { traits: ['clutch', 'homer', 'vsLeft'] as const };
    const pR = { traits: undefined, throws: 'R' as const };
    const pL = { traits: undefined, throws: 'L' as const };
    expect(traitEdge(b, pR, SIT, tp)).toBe(0);
    expect(traitEdge(b, pR, { ...SIT, scoring: true }, tp)).toBeCloseTo(tp.clutchEdge);
    expect(traitEdge(b, pR, { ...SIT, late: true }, tp)).toBeCloseTo(tp.clutchEdge);
    expect(traitEdge(b, pR, { ...SIT, home: true }, tp)).toBeCloseTo(tp.homerEdge);
    expect(traitEdge(b, pL, SIT, tp)).toBeCloseTo(tp.killerEdge);
  });

  it('투수 능력은 타자 반대 방향이다: 위기 탈출은 주자가 있을 때, 가을 사나이는 포스트시즌에만', () => {
    const b = { traits: undefined };
    const p = { traits: ['escape', 'october', 'homer'] as const, throws: 'R' as const };
    expect(traitEdge(b, p, { ...SIT, home: true }, tp)).toBe(0); // 타자가 홈 = 투수는 원정
    expect(traitEdge(b, p, { ...SIT, runnersOn: true, home: true }, tp)).toBeCloseTo(-tp.escapeEdge);
    expect(traitEdge(b, p, { ...SIT, postseason: true, home: true }, tp)).toBeCloseTo(-tp.octoberEdge);
    expect(traitEdge(b, p, SIT, tp)).toBeCloseTo(-tp.homerEdge);
  });

  it('늦게 지는 꽃은 31세 이후 하락만 줄이고 성장은 그대로 둔다', () => {
    const rng = () => new Rng('aging');
    const old = growthRuns(34, 20, 20, 1, rng(), false);
    const oldEver = growthRuns(34, 20, 20, 1, rng(), false, 0.6);
    expect(oldEver).toBeGreaterThan(old);
    const young = growthRuns(23, 5, 25, 1, rng(), false);
    const youngEver = growthRuns(23, 5, 25, 1, rng(), false, 0.6);
    expect(youngEver).toBe(young);
  });

  /** 한 시즌을 돌려 능력 있는 선수 집단의 결과를 잰다 */
  function season(world: World, seed: string, params: EngineParams = NO_PILOT): Season {
    const s = Season.start(world, params, seed, { cal: UNIT });
    s.runToEnd();
    return s;
  }

  it('철인은 부상이 눈에 띄게 적다 (같은 월드에서 절반에게만 주고 비교)', () => {
    const world = worldForYear({ ...store, traits: undefined }, 2025);
    world.players.forEach((p, i) => { if (i % 2 === 0) p.traits = ['ironman']; });
    const params = { ...NO_PILOT, injury: { ...NO_PILOT.injury, base: 0.03 } };
    const s = season(world, 'traits-ironman', params);
    const inj = s.absences.filter((a) => a.kind !== 'event');
    const iron = inj.filter((a) => world.players[a.idx].traits).length;
    const plain = inj.length - iron;
    expect(plain).toBeGreaterThan(300);
    expect(iron / plain).toBeLessThan(0.8);
    expect(iron / plain).toBeGreaterThan(0.4);
  });

  it('안방 사나이 타자는 홈에서 원정보다 더 잘 치고, 없는 선수는 그 차이가 작다', () => {
    const base = worldForYear({ ...store, traits: undefined }, 2025);
    const sum = (w: World, seed: string) => {
      const s = season(w, seed);
      // 홈·원정 구분 기록은 없으므로 팀 득점의 홈·원정 차이로 본다
      let home = 0;
      let away = 0;
      for (const g of s.log) { home += g.homeRuns; away += g.awayRuns; }
      return home / away;
    };
    const plain = sum(base, 'traits-homer');
    const boosted = worldForYear({ ...store, traits: undefined }, 2025);
    for (const p of boosted.players) if (!p.isPitcher) p.traits = ['homer'];
    const tp = { ...DEFAULT_TRAIT_PARAMS, homerEdge: 0.08 };
    const s = Season.start(boosted, { ...NO_PILOT, traits: tp }, 'traits-homer', { cal: UNIT });
    s.runToEnd();
    let home = 0;
    let away = 0;
    for (const g of s.log) { home += g.homeRuns; away += g.awayRuns; }
    expect(home / away).toBeGreaterThan(plain + 0.05);
  });

  it('같은 시드·같은 능력이면 결과가 같다 (난수를 쓰지 않는다)', () => {
    const a = season(worldForYear(store, 2025), 'traits-det');
    const b = season(worldForYear(store, 2025), 'traits-det');
    expect(a.teams.map((t) => t.w)).toEqual(b.teams.map((t) => t.w));
  });
});

describe('숨김', () => {
  it('AI 가치 계산은 능력을 보지 않는다', () => {
    const w = worldForYear(store, 2026);
    const ctx = valueContext(w);
    const p = w.players.find((x) => x.traits?.length)!;
    const before = currentRuns(p, ctx);
    const stripped = { ...p, traits: undefined };
    expect(currentRuns(stripped, ctx)).toBe(before);
  });

  it('저장 파일에 능력이 남지 않는다', () => {
    const session = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'traits-save', difficulty: 'normal' });
    session.advance(3);
    const text = JSON.stringify(session.toSave());
    expect(text).not.toContain('"traits"');
    // 'stamina'는 투수 능력 필드 이름이기도 해서 뺀다
    for (const c of TRAIT_CODES) if (c !== 'stamina') expect(text).not.toContain(`"${c}"`);
  });

  it('화면 코드(src/ui)는 특수능력 모듈과 코드를 가져다 쓰지 않는다', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(f)) files.push(p);
      }
    };
    walk(join(__dirname, '..', 'src', 'ui'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, 'utf-8');
      expect(text, f).not.toMatch(/traits?\b/i);
      expect(text, f).not.toMatch(/TRAIT_/);
    }
  });
});
