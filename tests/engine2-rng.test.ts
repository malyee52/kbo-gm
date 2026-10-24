// 경기 엔진 2 2단계: 경기마다 따로 난수 줄기 (docs/경기엔진2_기획안.md 3.7.1).
// 한 경기의 난수 소비가 바뀌어도 그날 다른 경기와, 그 경기 팀과 얽히지 않은 다음 날 경기는 그대로여야 한다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import type { Rates } from '../src/data/types';
import { DEFAULT_PARAMS, Season, simulateSeason, worldForYear, type GameLog, type SeasonSave, type World } from '../src/engine';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
let world: World;
let cal: Rates;
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  world = worldForYear(loadDataStore(), 2025, FAST);
  cal = simulateSeason(world, FAST, 'cal').cal;
});

/** day까지 진행하고, day 하루는 team 경기에 지휘자(onDay)를 건 채로 하루 더 진행한 시즌 */
function run(seed: string, day: number, team: number, onDay: boolean): Season {
  const s = Season.start(world, FAST, seed, { cal });
  while (s.day < day) s.simulateDay();
  // 우리 수비 첫 타석 몇 번은 고의4구: 그 경기의 난수 소비가 달라진다 (계속 내주면 이닝이 끝나지 않는다)
  if (onDay) s.commander = { team, decide: (q) => (q.side === 'field' && q.n < 8 ? { walk: true } : {}) };
  s.simulateDay();
  s.commander = null;
  s.simulateDay();
  return s;
}

const gamesOn = (s: Season, day: number): GameLog[] => s.log.filter((g) => g.day === day);

describe('경기별 난수 줄기', () => {
  it('한 경기의 난수 소비를 바꿔도 그날 다른 경기 결과는 같다', () => {
    const team = 0;
    // 그 구단 경기가 있고 다음 날도 경기가 있는 날
    const sched = Season.start(world, FAST, 'rng-iso', { cal }).schedule;
    const day = sched.findIndex((d, i) => i >= 20 && d.some((g) => g.home === team || g.away === team) && sched[i + 1]?.length > 0);
    const base = run('rng-iso', day, team, false);
    const changed = run('rng-iso', day, team, true);
    const mine = (g: GameLog) => g.home === team || g.away === team;
    const a = gamesOn(base, day);
    const b = gamesOn(changed, day);
    // 바꾼 경기는 실제로 달라졌다 (고의4구만 내줌)
    expect(b.find(mine)).not.toEqual(a.find(mine));
    expect(b.filter((g) => !mine(g))).toEqual(a.filter((g) => !mine(g)));
    expect(a.filter((g) => !mine(g)).length).toBeGreaterThan(0);

    // 다음 날: 바꾼 경기의 두 팀과 맞붙지 않은 경기는 그대로
    const touched = new Set(a.filter(mine).flatMap((g) => [g.home, g.away]));
    const clean = (g: GameLog) => !touched.has(g.home) && !touched.has(g.away);
    const next = (s: Season) => gamesOn(s, day + 1).filter(clean);
    expect(next(changed)).toEqual(next(base));
  });

  it('경기 전 부상·이탈 뽑기는 선수·날짜 줄기 (엔진 2 13단계): 한 선수가 빠져도 다른 선수의 그날 뽑기는 같다', () => {
    // 경기 전 부상이 많은 조정값으로, 어느 날 한 선수를 결장시킨 시즌과 아닌 시즌의 그날 부상·이탈을 견준다
    const P = { ...FAST, injury: { ...FAST.injury, eventChance: 0.02 } };
    const go = (drop: boolean) => {
      const s = Season.start(world, P, 'inj-iso', { cal });
      while (s.day < 30) s.simulateDay();
      const p = world.teams[0].org.find((x) => s.states.absentUntil[x.idx] <= s.day)!;
      if (drop) s.states.absentUntil[p.idx] = s.day + 1;
      const before = s.absences.length;
      s.simulateDay();
      return { p: p.idx, today: s.absences.slice(before).filter((a) => a.day === 30 && a.idx !== p.idx).map((a) => ({ ...a })) };
    };
    const a = go(false);
    const b = go(true);
    expect(b.today.length).toBeGreaterThan(0);
    expect(b.today).toEqual(a.today);
  });

  it('경기 난수는 날짜와 대진으로만 정해진다 (저장에 경기 난수 위치가 없다)', () => {
    const s = Season.start(world, FAST, 'rng-key', { cal });
    const save = s.toSave() as SeasonSave & { rngGames?: number };
    expect(save.format).toBe(3);
    expect(save.rngGames).toBeUndefined();
    const g = s.schedule[0][0];
    expect(s.gameRng(0, g).next()).toBe(s.gameRng(0, g).next());
    expect(s.gameRng(0, g).next()).not.toBe(s.gameRng(1, g).next());
  });

  it('저장 뒤 이어가기 = 끊지 않음 (하루마다 저장·복원)', () => {
    const ref = Season.start(world, FAST, 'rng-save', { cal, boxTeams: [2] });
    for (let i = 0; i < 30; i++) ref.simulateDay();
    let s = Season.start(world, FAST, 'rng-save', { cal, boxTeams: [2] });
    for (let i = 0; i < 30; i++) {
      s.simulateDay();
      s = Season.restore(world, FAST, roundTrip(s.toSave()));
    }
    expect(s.toSave()).toEqual(ref.toSave());
  });

  it('엔진 2 이전 저장(시즌 형식 1)은 불러오지 않는다', () => {
    const s = Season.start(world, FAST, 'rng-old', { cal });
    const old = { ...roundTrip(s.toSave()), format: 1, rngGames: 12345 } as unknown as SeasonSave;
    expect(() => Season.restore(world, FAST, old)).toThrow('엔진 2 이전 저장');
  });
});
