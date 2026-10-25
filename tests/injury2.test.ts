// 엔진 2 11단계: 야수 체력(피로 휴식), 경기 중 부상·교체, 부상 부위, 혹사지수 (docs/경기엔진2_기획안.md 6장 11단계·4.6)
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import {
  absenceLabel, DEFAULT_PARAMS, INJURY_PARTS, overuseDecay, Rng, Season, worldForYear, type EngineParams,
} from '../src/engine';
import { refreshActive, todaysLineup } from '../src/engine/team';

const store = loadDataStore();
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };

function run(params: EngineParams, seed: string, days: number) {
  const s = Season.start(worldForYear(store, 2025, params), params, seed, { cal: UNIT });
  for (let d = 0; d < days && !s.done; d++) s.simulateDay();
  return s;
}

describe('경기 중 부상 (엔진 2 11단계)', () => {
  // 시드: 투수 부상 표본이 작아(열 건 안팎) 엔진이 바뀌면 경계에 걸릴 수 있다 (능력치 v2 16-2 타구각 때 inj2-season → inj2-season-2)
  const s = run(NO_PILOT, 'inj2-season-2', 400);

  it('투구·주루·수비 사건으로 생기고, 다음 날부터 결장하며 부위가 붙는다', () => {
    const inGame = s.absences.filter((a) => a.cause);
    expect(new Set(inGame.map((a) => a.cause))).toEqual(new Set(['pitch', 'run', 'field']));
    for (const a of inGame) {
      expect(a.part && a.part in INJURY_PARTS).toBe(true);
      // 다음 날부터 결장 (경기 전 부상은 그날부터)
      expect(a.until).toBeGreaterThan(a.day + 1);
    }
    // 경기 전 부상에도 부위가 붙는다
    expect(s.absences.filter((a) => !a.cause && a.kind !== 'event').every((a) => a.part)).toBe(true);
  });

  it('투수 부상 부위는 팔꿈치·어깨가 많고, 주루 부상은 다리 쪽이다', () => {
    const count = (cause: string, parts: string[]) => s.absences.filter((a) => a.cause === cause && parts.includes(a.part!)).length / Math.max(1, s.absences.filter((a) => a.cause === cause).length);
    expect(count('pitch', ['elbow', 'shoulder'])).toBeGreaterThan(0.4);
    expect(count('run', ['hamstring', 'thigh', 'calf', 'ankle', 'groin', 'knee'])).toBeGreaterThan(0.7);
  });

  it('같은 시드는 같은 결과, 저장 뒤 이어 돌려도 같다 (경기 중 부상·피로·혹사 포함)', () => {
    const a = run(NO_PILOT, 'inj2-save', 60);
    const half = run(NO_PILOT, 'inj2-save', 30);
    const back = Season.restore(worldForYear(store, 2025, NO_PILOT), NO_PILOT, JSON.parse(JSON.stringify(half.toSave())));
    for (let d = 0; d < 30; d++) back.simulateDay();
    expect(back.absences).toEqual(a.absences);
    expect(Array.from(back.states.overuse)).toEqual(Array.from(a.states.overuse));
    expect(Array.from(back.states.body)).toEqual(Array.from(a.states.body));
    expect(back.bat).toEqual(a.bat);
  });
});

describe('혹사지수 (기획안 4.6)', () => {
  it('혹사지수가 늘 0이면 혹사가 없는 엔진과 결과가 같다', () => {
    const ou = DEFAULT_PARAMS.injury.overuse;
    const zero: EngineParams = { ...NO_PILOT, injury: { ...NO_PILOT.injury, overuse: { ...ou, overPitch: 0, b2b: 0, b3b: 0, shortRest: 0, overInjury: 0 } } };
    const off: EngineParams = { ...NO_PILOT, injury: { ...NO_PILOT.injury, overuse: { ...ou, on: false } } };
    const a = run(zero, 'inj2-zero', 40);
    const b = run(off, 'inj2-zero', 40);
    expect(Array.from(a.states.overuse).every((v) => v === 0)).toBe(true);
    expect(a.absences).toEqual(b.absences);
    expect(a.pit).toEqual(b.pit);
    expect(a.bat).toEqual(b.bat);
  });

  it('쌓이면 투구 피로 회복이 느려지고, 쉴수록 크게 빠진다', () => {
    const s = run(NO_PILOT, 'inj2-overuse', 60);
    const hi = Array.from(s.states.overuse).map((v, i) => [v, i] as const).filter(([v]) => v > 1);
    expect(hi.length).toBeGreaterThan(5);
    for (const [, i] of hi) expect(s.states.recoverMul[i]).toBeLessThan(1);
    const o = DEFAULT_PARAMS.injury.overuse;
    // 하루 감소량이 날이 갈수록 커진다
    for (let n = 1; n < 40; n++) expect(overuseDecay(n + 1, o) / overuseDecay(n, o)).toBeLessThan(overuseDecay(n, o) / overuseDecay(n - 1, o));
  });
});

describe('야수 체력 (엔진 2 11단계)', () => {
  it('지치지 않았으면 쉬지 않고, 지칠수록 더 쉰다', () => {
    const world = worldForYear(store, 2025, NO_PILOT);
    const s = Season.start(world, NO_PILOT, 'inj2-rest', { cal: UNIT });
    const ts = s.teamSeasons[0];
    refreshActive(ts, world, s.states, 0);
    const restCount = (tired: number) => {
      const rng = new Rng(`rest-${tired}`);
      let rested = 0;
      for (let i = 0; i < 300; i++) {
        const lineup = todaysLineup(ts, world.league, NO_PILOT, rng, null, () => tired);
        const full = todaysLineup(ts, world.league, NO_PILOT, rng, null, () => 0);
        rested += lineup.filter((p) => !full.includes(p)).length;
      }
      return rested;
    };
    expect(restCount(0)).toBe(0);
    const mid = restCount(1.5);
    expect(mid).toBeGreaterThan(0);
    expect(restCount(3)).toBeGreaterThan(mid);
  });

  it('선발 출전마다 피로가 쌓인다: 포수는 더, 지명타자는 덜, 30세 넘으면 나이만큼 더', () => {
    const s = run(NO_PILOT, 'inj2-body', 1);
    const bp = NO_PILOT.body;
    // 연장 경기를 한 팀은 뺀다 (이닝 ÷ 9배)
    const regular = new Set(s.log.filter((x) => x.innings <= 9).flatMap((x) => [x.home, x.away]));
    let checked = 0;
    for (const p of s.world.players) {
      if (p.isPitcher || s.bat[p.idx].pa === 0 || !regular.has(p.teamIdx)) continue;
      const age = 1 + bp.agePer * Math.max(0, (p.age ?? 30) - 30);
      const v = s.states.body[p.idx] / age;
      // 선발은 load × 자리 배율 중 하나, 교체 출전은 sub
      expect([bp.load, bp.load * bp.catcher, bp.load * bp.dh, bp.sub].some((x) => Math.abs(x - v) < 1e-5)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    expect(bp.catcher).toBeGreaterThan(1);
    expect(bp.dh).toBeLessThan(1);
  });
});

describe('부상 문구', () => {
  it('경기에서 생긴 실존 선수 부상도 부위·정도를 쓴다', () => {
    const s = run(NO_PILOT, 'inj2-label', 60);
    const a = s.absences.find((x) => x.cause && s.world.players[x.idx].real !== false)!;
    expect(absenceLabel(a, s.world.players[a.idx])).toContain(`${INJURY_PARTS[a.part!]} 부상`);
  });
});
