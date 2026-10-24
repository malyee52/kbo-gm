// 구종·코스 (엔진 2 20단계, docs/경기엔진2_기획안.md 3.4.1·6장 20-1~20-4): 구종을 섞은 칸 = 지금 사슬 칸 (1e-12),
// AI 포수 볼 배합 = 리그 카운트별 구종 몫, 지시 없는 경기는 구종과 상관없이 결과가 같고, 같은 지시는 같은 결과, 한 구종만 고르면 노림수 손해.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { arsenalFor } from '../src/data/pitches';
import { DEFAULT_PARAMS, Season, worldForYear, type CommandChoice, type CommandRequest } from '../src/engine';
import { aimedOutcome, newAim, O, pitchJoint, rememberAim, typeMix, PITCH_TYPES, type ArsenalPitch } from '../src/engine/arsenal';
import { chainShapeFor } from '../src/engine/params';
import { leaguePlateFor, plateCells, type BatPlate, type PitPlate } from '../src/engine/plate';
import { calledShare } from '../src/engine/pitch';
import { COUNT_TYPE_COUNTS } from '../src/engine/pitchTable';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';

let store: DataStore;
beforeAll(() => {
  store = loadDataStore();
}, 120_000);

const SHIFT = { con: 0.1, eye: -0.05, hbp: 1.2 };
const BAT: BatPlate = { agg: 0.2, eye: -0.3, con: 0.4, two: 0.1, tough: 0.2 };
const PIT: PitPlate = { ctl: 0.3, stuff: -0.2, eff: 0.1 };
const IN_PLAY = [0.21, 0.06, 0.006, 0.035, 0.689];
const ARSENALS: ArsenalPitch[][] = [
  [{ type: '포심', share: 50 }, { type: '슬라이더', share: 30, grade: 65 }, { type: '포크', share: 20, grade: 40 }],
  [{ type: '투심', share: 45 }, { type: '커터', share: 25 }, { type: '커브', share: 15, grade: 70 }, { type: '체인지업', share: 10 }, { type: '스위퍼', share: 5 }],
  [{ type: '포심', share: 1 }],
  [{ type: '싱커', share: 60 }, { type: '너클볼', share: 40 }],
];

function setup() {
  const lp = leaguePlateFor(chainShapeFor(DEFAULT_PARAMS, 2025), store.season(2025)!.league.rates, DEFAULT_PARAMS.plate);
  return { cells: plateCells(lp, BAT, PIT, SHIFT), called: calledShare(lp, BAT, PIT, SHIFT) };
}

describe('20-1 구종 능력: 구종을 섞은 칸 = 지금 사슬 칸', () => {
  it('칸마다 구종 × 결과 결합표의 결과 쪽 합이 사슬 칸(맞힘은 결과로 펼침)과 1e-12 안, 구종 쪽 합이 AI 배합과 1e-9 안', () => {
    const { cells, called } = setup();
    for (const a of ARSENALS) {
      const j = pitchJoint(cells, called, IN_PLAY, a);
      const nt = j.arsenal.length;
      for (let c = 0; c < 12; c++) {
        const o5 = c * 5;
        const want = [cells[o5], cells[o5 + 1] * called[c], cells[o5 + 1] * (1 - called[c]), cells[o5 + 2], cells[o5 + 4], ...IN_PLAY.map((q) => cells[o5 + 3] * q)];
        for (let o = 0; o < 10; o++) {
          let s = 0;
          for (let t = 0; t < nt; t++) s += j.m[c][t * 10 + o];
          expect(Math.abs(s - want[o])).toBeLessThan(1e-12);
        }
        for (let t = 0; t < nt; t++) {
          let s = 0;
          for (let o = 0; o < 10; o++) s += j.m[c][t * 10 + o];
          expect(Math.abs(s - j.mix[c][t])).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('구종 등급이 높으면 그 구종에서 헛스윙이 더 나고 (투수 전체는 그대로), 싱커·너클볼 같은 낱말은 표준 구종으로', () => {
    const { cells, called } = setup();
    const whiff = (g: number) => {
      const j = pitchJoint(cells, called, IN_PLAY, [{ type: '포심', share: 60 }, { type: '슬라이더', share: 40, grade: g }]);
      return aimedOutcome(j, 2, '슬라이더', undefined, 0, undefined)[O.S];
    };
    expect(whiff(70)).toBeGreaterThan(whiff(50));
    expect(whiff(50)).toBeGreaterThan(whiff(30));
    const j = pitchJoint(cells, called, IN_PLAY, ARSENALS[3]);
    expect(j.arsenal.map((a) => a.type)).toEqual(['투심', '너클볼']);
  });

  it('투수 구종: 실측(그 해 전) → 위키 → 자료 없음(선수 ID로 정한 4구종, 늘 같음)', () => {
    const measured = arsenalFor(store.pitches, '50030', 2026);
    expect(measured.map((a) => a.type)).toEqual(expect.arrayContaining(['투심', '커터', '체인지업']));
    expect(measured.every((a) => PITCH_TYPES.includes(a.type as never) && a.share >= 2)).toBe(true);
    const virtual = arsenalFor(store.pitches, 'virtual-123', 2030);
    expect(virtual).toHaveLength(4);
    expect(virtual[0].type).toBe('포심');
    expect(new Set(virtual.map((a) => a.type)).size).toBe(4);
    expect(arsenalFor(store.pitches, 'virtual-123', 2030)).toEqual(virtual);
  });
});

describe('20-2 AI 포수 볼 배합', () => {
  it('리그 전체 몫으로 던지는 투수의 카운트별 구종 비율 = 자료(문자중계 2023~2025)의 카운트별 구종 몫', () => {
    // 표가 작아 다른 구종 몫을 빌리는 스위퍼·너클볼은 뺀다
    const types = PITCH_TYPES.filter((t) => t !== '스위퍼' && t !== '너클볼');
    const tot = PITCH_TYPES.reduce((s, t) => s + COUNT_TYPE_COUNTS[t].reduce((a, x) => a + x, 0), 0);
    const lgShare = types.map((t) => ({ type: t, share: COUNT_TYPE_COUNTS[t].reduce((a, x) => a + x, 0) / tot }));
    for (let c = 0; c < 12; c++) {
      const w = typeMix(lgShare, c);
      const cellTot = types.reduce((s, t) => s + COUNT_TYPE_COUNTS[t][c], 0);
      types.forEach((t, i) => expect(w[i]).toBeCloseTo(COUNT_TYPE_COUNTS[t][c] / cellTot, 9));
    }
    // 2스트라이크 뒤 변화구가 는다 (포심 몫: 0-0 > 0-2)
    const two = typeMix(lgShare, 2)[0];
    expect(typeMix(lgShare, 0)[0]).toBeGreaterThan(two);
  });

  it('지시 없는 A 시즌은 투수 구종과 상관없이 결과가 같고, 공마다 구종·코스가 붙는다', () => {
    const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
    const run = (fastballOnly: boolean) => {
      const world = worldForYear(store, 2025, params);
      if (fastballOnly) for (const id of Object.keys(world.arsenals!)) world.arsenals![id] = [{ type: '포심', share: 1 }];
      const s = Season.start(world, params, 'arsenal-a', { engine: 'A', boxTeams: [0] });
      for (let d = 0; d < 4; d++) s.simulateDay();
      return s;
    };
    const a = run(false);
    const b = run(true);
    expect(a.log).toEqual(b.log);
    const strip = (s: Season) => [...s.plays.values()][0].map(({ pt: _t, pz: _z, ...rest }) => rest);
    expect(strip(a)).toEqual(strip(b));
    const pas = [...a.plays.values()][0].filter((x) => x.seq !== undefined);
    expect(pas.length).toBeGreaterThan(20);
    for (const x of pas) {
      expect(x.pt).toHaveLength(x.seq!.length);
      expect(x.pz).toHaveLength(x.seq!.length);
    }
    expect(new Set(pas.flatMap((x) => x.pt!)).size).toBeGreaterThan(3);
    expect([...b.plays.values()][0].filter((x) => x.pt).every((x) => x.pt!.every((t) => t === '' || t === '포심'))).toBe(true);
  }, 120_000);
});

describe('20-3·20-4 구종·코스 지시', () => {
  it('구종만 고르면 그 구종의 결과 비율 그대로, 코스는 기울기만큼 (유인구는 볼이 늘고 가운데는 준다)', () => {
    const { cells, called } = setup();
    const j = pitchJoint(cells, called, IN_PLAY, ARSENALS[0]);
    const c = 4; // 1-1
    const plain = aimedOutcome(j, c, '슬라이더', undefined, 0, undefined);
    let col = 0;
    for (let o = 0; o < 10; o++) col += j.m[c][1 * 10 + o];
    for (let o = 0; o < 10; o++) expect(plain[o]).toBeCloseTo(j.m[c][10 + o] / col, 12);
    const chase = aimedOutcome(j, c, '슬라이더', 'chase', 0, undefined);
    const mid = aimedOutcome(j, c, '슬라이더', 'mid', 0, undefined);
    expect(chase[O.B]).toBeGreaterThan(plain[O.B]);
    expect(mid[O.B]).toBeLessThan(plain[O.B]);
    // 제구가 좋으면 겨눈 코스에 더 들어간다
    expect(aimedOutcome(j, c, '슬라이더', 'mid', 1, undefined)[O.B]).toBeLessThan(mid[O.B]);
  });

  it('노림수: 한 구종만 계속 고르면 루킹·헛스윙이 줄고 안타가 는다. 자연 몫대로 섞으면 손해가 없다', () => {
    const { cells, called } = setup();
    const j = pitchJoint(cells, called, IN_PLAY, ARSENALS[0]);
    const mem = newAim();
    const first = aimedOutcome(j, 2, '슬라이더', undefined, 0, mem);
    for (let i = 0; i < 20; i++) rememberAim(mem, '슬라이더', undefined);
    const later = aimedOutcome(j, 2, '슬라이더', undefined, 0, mem);
    expect(later[O.S]).toBeLessThan(first[O.S]);
    expect(later[O.HR]).toBeGreaterThan(first[O.HR]);
    const mixed = newAim();
    for (let i = 0; i < 10; i++) rememberAim(mixed, ['포심', '포심', '포심', '포심', '포심', '슬라이더', '슬라이더', '슬라이더', '포크', '포크'][i], undefined);
    expect(aimedOutcome(j, 2, '포크', undefined, 0, mixed)).toEqual(aimedOutcome(j, 2, '포크', undefined, 0, undefined));
  });

  it('같은 지시 → 같은 결과 (조작 기록 pitch 칸으로 재현), 지시한 공은 중계에 고른 구종·코스', () => {
    const fast = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const day = () => {
      const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'arsenal-cmd' }, fast);
      while (!g.hasGameToday || g.pendingEvent) {
        if (g.pendingEvent) g.answerEvent(0);
        else g.advance(1, NO_STOPS);
      }
      return g;
    };
    // 우리 수비 공 사이 물음마다: 2스트라이크면 첫 구종 유인구, 그 밖에는 비율 1위 구종 바깥쪽 낮게
    const pick = (r: CommandRequest): CommandChoice =>
      r.side === 'field' && r.step === 'pitch' && r.arsenal?.length
        ? { pitch: r.count![1] === 2 ? { type: r.arsenal.at(-1)!.type, zone: 'chase' } : { type: r.arsenal[0].type, zone: 'out_low' } }
        : {};
    const play = (g: GameSession) => {
      let pv = g.commandOpen();
      let guard = 0;
      while (pv.req && guard++ < 5000) pv = g.commandStep(pick(pv.req), 'pitch');
      expect(g.commandFinish('A').ok).toBe(true);
      return g;
    };
    const a = play(day());
    const b = play(day());
    expect(a.season.log).toEqual(b.season.log);
    const plays = a.ourGames().at(-1)!.plays!;
    expect(plays).toEqual(b.ourGames().at(-1)!.plays);
    expect(plays.some((p) => p.pz?.includes('out_low'))).toBe(true);
    const rep = GameSession.replay(store, a.reproInfo().opts, a.actions, { year: 2026, day: a.day }, fast);
    expect(rep.season.log).toEqual(a.season.log);
    expect(rep.ourGames().at(-1)!.plays).toEqual(plays);
  }, 300_000);
});
