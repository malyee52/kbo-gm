// M6 다년 진행: 부상·이탈 이벤트, 실존 인물 규칙 자동 검사, 노화, 은퇴, 병역, 슬럼프, 여러 시즌 연속 진행.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import {
  absenceLabel, DEFAULT_PARAMS, eventLabel, isSpecificEvent, NEUTRAL_EVENTS, pickEvent, Rng, Season, SPECIFIC_EVENTS, worldForYear,
  type EngineParams, type World,
} from '../src/engine';
import { agingDelta, REPL_BAT_RATIO, REPL_PIT_RATIO, valueContext } from '../src/ai/value';
import { initialMilitary, isServing, retireChance } from '../src/league/careers';
import { createLeague } from '../src/league/create';
import { careerIndex } from '../src/league/growth';
import { worldFromLeague } from '../src/league/world';
import { GameSession } from '../src/game/session';
import { runYear, type YearMetrics } from '../tools/longsim';

let store: DataStore;
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };

beforeAll(() => {
  store = loadDataStore();
});

describe('실존 인물 규칙 (기획서 7장): 구체적 사건은 가상 선수에게만', () => {
  /** 이벤트를 많이 일으키고, 선수 절반을 가상 선수로 바꾼 월드 */
  function eventfulSeason(seed: string): { season: Season; world: World } {
    const world = worldForYear(store, 2025);
    world.players.forEach((p, i) => { if (i % 2 === 1) p.real = false; });
    const params = { ...NO_PILOT, injury: { ...NO_PILOT.injury, eventChance: 0.004 } };
    const season = Season.start(world, params, seed, { cal: UNIT });
    season.runToEnd();
    return { season, world };
  }

  it('이벤트를 크게 늘려 한 시즌을 돌려도 실존 선수에게는 중립 이벤트만 붙는다', () => {
    const { season, world } = eventfulSeason('m6-events');
    const events = season.absences.filter((a) => a.kind === 'event');
    const specific = events.filter((a) => isSpecificEvent(a.event!));
    expect(events.length).toBeGreaterThan(100);
    expect(specific.length).toBeGreaterThan(10);
    for (const a of specific) expect(world.players[a.idx].real, world.players[a.idx].name).toBe(false);
    // 실존 선수도 중립 이벤트는 받는다 (규칙이 이벤트 자체를 막는 것은 아니다)
    expect(events.some((a) => world.players[a.idx].real !== false && !isSpecificEvent(a.event!))).toBe(true);
  });

  it('실존 여부가 없는(모르는) 선수는 실존 선수로 본다', () => {
    const rng = new Rng('m6-unknown');
    for (let i = 0; i < 2000; i++) expect(isSpecificEvent(pickEvent({}, rng, DEFAULT_PARAMS.injury).event)).toBe(false);
  });

  it('문구 단계에서도 막는다: 실존 선수에게 구체적 사건 문구를 만들면 오류', () => {
    for (const code of Object.keys(SPECIFIC_EVENTS) as (keyof typeof SPECIFIC_EVENTS)[]) {
      expect(() => eventLabel(code, { real: true })).toThrow();
      expect(() => eventLabel(code, {})).toThrow();
      expect(eventLabel(code, { real: false })).toBe(SPECIFIC_EVENTS[code].label);
    }
    for (const code of Object.keys(NEUTRAL_EVENTS) as (keyof typeof NEUTRAL_EVENTS)[]) expect(eventLabel(code, { real: true })).toBe(NEUTRAL_EVENTS[code].label);
  });

  it('실존 선수의 결장 문구에는 부상 같은 사유가 없고, 가상 선수에게만 부상 정도를 쓴다', () => {
    for (const kind of ['minor', 'long', 'major'] as const) {
      expect(absenceLabel({ kind }, { real: true }, true)).not.toMatch(/부상|골절/);
      expect(absenceLabel({ kind }, {})).not.toMatch(/부상/);
      expect(absenceLabel({ kind }, { real: false })).toMatch(/부상/);
    }
  });

  it('중립 이벤트 문구에는 구체적 사유가 없다', () => {
    for (const { label } of Object.values(NEUTRAL_EVENTS)) expect(label).not.toMatch(/음주|도박|폭행|SNS|외출|약물|사고/);
  });

  it('데이터의 선수는 모두 실존 선수로 월드에 들어간다', () => {
    const world = worldForYear(store, 2026);
    expect(world.players.every((p) => p.real === true)).toBe(true);
  });
});

describe('부상', () => {
  it('결장 비율이 바꾸기 전 무작위 결장(약 10.7%)과 비슷하다', () => {
    let absent = 0;
    let total = 0;
    const kinds = new Set<string>();
    for (const seed of ['inj1', 'inj2']) {
      const world = worldForYear(store, 2025);
      const s = Season.start(world, NO_PILOT, seed, { cal: UNIT });
      while (!s.done) {
        const d = s.day;
        s.simulateDay();
        if (!s.schedule[d].length) continue;
        for (const p of world.players) {
          total++;
          if (s.states.absentUntil[p.idx] > d) absent++;
        }
      }
      for (const a of s.absences) kinds.add(a.kind);
    }
    expect(absent / total).toBeGreaterThan(0.09);
    expect(absent / total).toBeLessThan(0.13);
    expect([...kinds].sort()).toEqual(['event', 'long', 'major', 'minor']);
  });

  it('저장했다 불러와 이어 돌려도 부상 기록이 같다', () => {
    const w1 = worldForYear(store, 2025);
    const ref = Season.start(w1, NO_PILOT, 'inj-save', { cal: UNIT });
    ref.runToEnd();
    const w2 = worldForYear(store, 2025);
    const half = Season.start(w2, NO_PILOT, 'inj-save', { cal: UNIT });
    for (let i = 0; i < 80; i++) half.simulateDay();
    const save = JSON.parse(JSON.stringify(half.toSave()));
    const back = Season.restore(worldForYear(store, 2025), NO_PILOT, save);
    back.runToEnd();
    expect(back.absences).toEqual(ref.absences);
  });

  it('개막부터 결장(startAbsent)하는 선수는 그날까지 나오지 않는다', () => {
    const world = worldForYear(store, 2025);
    const star = world.players.filter((p) => !p.isPitcher).sort((a, b) => b.value - a.value)[0];
    star.startAbsent = 30;
    const s = Season.start(world, NO_PILOT, 'start-absent', { cal: UNIT });
    while (s.day < 30) s.simulateDay();
    expect(s.bat[star.idx].pa).toBe(0);
    s.runToEnd();
    expect(s.bat[star.idx].pa).toBeGreaterThan(0);
  });
});

describe('노화와 대체 선수 기준', () => {
  it('31세부터 떨어지고, 투수가 타자보다 크게 떨어진다 (tools/fit_aging.ts 추정값)', () => {
    for (let a = 31; a <= 40; a++) expect(agingDelta(a)).toBeLessThan(0);
    const sum = (pit: boolean) => [31, 32, 33, 34, 35].reduce((s, a) => s + agingDelta(a, pit), 0);
    expect(sum(true)).toBeLessThan(sum(false));
  });

  it('대체 선수 기준은 리그 평균 대비 고정 비율이라 선수 구성과 상관없다', () => {
    const world = worldForYear(store, 2026);
    const a = valueContext(world);
    const b = valueContext({ ...world, players: world.players.slice(0, 50) });
    expect(a.replBat).toBe(b.replBat);
    expect(a.replPit).toBe(b.replPit);
    expect(REPL_BAT_RATIO).toBeLessThan(1);
    expect(REPL_PIT_RATIO).toBeGreaterThan(1);
  });
});

describe('은퇴', () => {
  it('나이가 많을수록, 기량이 낮을수록 더 은퇴하고 45세는 모두 은퇴한다', () => {
    expect(retireChance(28, 5, 0)).toBe(0);
    expect(retireChance(36, 5, 0)).toBeLessThan(retireChance(40, 5, 0));
    expect(retireChance(38, 20, 0)).toBeLessThan(retireChance(38, -3, 0));
    expect(retireChance(38, 5, 2)).toBeLessThan(retireChance(38, 5, 0));
    expect(retireChance(45, 30, 3)).toBe(1);
  });
});

describe('병역', () => {
  it('시작 때 상태: 외국인 대상 아님, 가상 신인 미필, 29세 이상 실존 선수는 마친 것으로 본다', () => {
    expect(initialMilitary({ id: 'x', foreign: true, real: true, birthYear: 2000 }, null, 2026)).toBeUndefined();
    expect(initialMilitary({ id: 'x', foreign: false, real: false, birthYear: 2008 }, null, 2026)?.state).toBe('pending');
    expect(initialMilitary({ id: 'x', foreign: false, real: true, birthYear: 1990 }, null, 2026)?.state).toBe('done');
  });

  it('20대 실존 선수 중 기록이 1~2시즌 비었던 선수는 복무한 것으로 본다', () => {
    const idx = careerIndex(store);
    const { league } = createLeague(store, 2026, 'mil', NO_PILOT);
    const young = league.players.filter((p) => p.real && !p.foreign && p.birthYear && 2026 - p.birthYear < 29);
    const done = young.filter((p) => p.military?.state === 'done');
    const pending = young.filter((p) => p.military?.state === 'pending');
    expect(done.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);
    // 마친 것으로 본 선수는 실제로 기록 공백이 있다
    for (const p of done.slice(0, 20)) {
      const years = [...new Set([...(idx.bat.get(p.id) ?? []), ...(idx.pit.get(p.id) ?? [])].map((x) => x.year))].filter((y) => y < 2026).sort();
      expect(years.some((y, i) => i > 0 && y - years[i - 1] >= 2), p.name).toBe(true);
    }
  });

  it('복무 중인 선수는 월드에 없고, 복귀하는 해에는 개막부터 결장한다', () => {
    const { league } = createLeague(store, 2026, 'mil2', NO_PILOT);
    const p = league.players.find((x) => !x.foreign && x.team >= 0)!;
    p.military = { state: 'serving', enlisted: 2026, returnYear: 2028 };
    expect(worldFromLeague(league, store).players.some((x) => x.id === p.id)).toBe(false);
    p.military = { state: 'done' };
    p.startAbsent = 75;
    const w = worldFromLeague(league, store);
    expect(w.players.find((x) => x.id === p.id)?.startAbsent).toBe(75);
  });
});

describe('M5 저장 호환', () => {
  it('병역 정보가 없는 리그 상태(M5 저장)도 결산하면 국내 선수에게 병역 상태가 생긴다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'm5-compat' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    for (const p of g.league.players) delete p.military;
    g.advance(100000);
    g.beginOffseason();
    const domestic = g.league.players.filter((p) => !p.foreign && p.team >= 0);
    expect(domestic.every((p) => p.military !== undefined)).toBe(true);
    expect(g.offseason!.stage).toBe('fa');
  });
});

describe('슬럼프', () => {
  it('슬럼프는 그 시즌 월드의 능력만 낮추고 리그 상태의 능력은 그대로다', () => {
    const { league } = createLeague(store, 2026, 'slump', NO_PILOT);
    const p = league.players.find((x) => !x.isPitcher && x.team >= 0)!;
    const before = { ...p.bat! };
    p.slump = -0.2;
    const w = worldFromLeague(league, store);
    const sp = w.players.find((x) => x.id === p.id)!;
    expect(sp.bat!.hr).toBeLessThan(before.hr);
    expect(p.bat).toEqual(before);
    expect(worldFromLeague(league, store, DEFAULT_PARAMS, { form: false }).players.find((x) => x.id === p.id)!.bat).toEqual(before);
  });
});

describe('여러 시즌 연속 진행 (M6 완료 기준의 축소판: 4시즌, 전체 20시즌은 tools/longsim.ts)', () => {
  const rows: YearMetrics[] = [];
  let retiredTotal = 0;
  let servingSeen = 0;

  beforeAll(() => {
    const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
    const { league } = createLeague(store, 2026, 'm6-multi', params);
    for (let i = 0; i < 4; i++) {
      rows.push(runYear(league, store, params).m);
      servingSeen = Math.max(servingSeen, league.players.filter(isServing).length);
    }
    retiredTotal = league.retired?.length ?? 0;
  }, 120_000);

  it('네 시즌이 이어지고 지표가 정해 둔 범위 안에 있다', () => {
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029]);
    for (const r of rows) {
      // 환경 맞춤 계수: 선수 전체 기량이 실제 리그 수준에서 크게 벗어나지 않는다
      for (const v of Object.values(r.cal)) {
        expect(v, `${r.year} cal`).toBeGreaterThan(0.8);
        expect(v, `${r.year} cal`).toBeLessThan(1.25);
      }
      expect(r.runs).toBeGreaterThan(4.73 * 0.9);
      expect(r.runs).toBeLessThan(5.2 * 1.1);
      expect(r.players, `${r.year} 소속 최대`).toBeLessThanOrEqual(68);
      expect(r.orgMin, `${r.year} 월드 최소 인원`).toBeGreaterThanOrEqual(40);
      expect(r.maxAge).toBeLessThanOrEqual(45);
      expect(r.specificOnReal).toBe(0);
    }
  });

  it('은퇴와 병역이 실제로 일어난다', () => {
    expect(retiredTotal).toBeGreaterThan(30);
    expect(servingSeen).toBeGreaterThan(10);
    expect(rows[3].realPa).toBeLessThan(1);
    expect(rows[3].realPa).toBeGreaterThan(0.5);
  });
});
