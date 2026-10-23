// 더블헤더 엔진 처리 (일정 개편 기획안 4.6, 8장 9단계 확인 칸):
// 1차전 묶음 → 2차전 묶음, 1차전 선발은 2차전에 안 나옴, 같은 날 두 번 던진 투수·뛴 야수의 피로가 회복 없이 쌓임,
// 더블헤더 날 저장 → 이어 하기 = 끊김 없이, 더블헤더 날 우리 2차전 직접 지휘 재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { currentBody, currentFatigue, DEFAULT_PARAMS, Season, simulateSeason, worldForYear, type CommandChoice, type World } from '../src/engine';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';
import type { Rates } from '../src/data/types';

let store: DataStore;
let world: World;
let cal: Rates;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const YEAR = 2024; // R4: 금·토 취소는 다음 날 더블헤더, 9월 중순 뒤 잔여 경기도

beforeAll(() => {
  store = loadDataStore();
  world = worldForYear(store, YEAR, FAST);
  cal = simulateSeason(world, { ...FAST, pilotSeasons: 0 }, 'x').cal; // 맞춤 생략으로 빠르게
}, 120_000);

/** 2차전이 있는 날 */
const dhDays = (s: Season) => s.schedule.flatMap((d, i) => (d.some((g) => g.dh === 2) ? [i] : []));

describe('더블헤더 엔진 처리 (9단계)', () => {
  it('1차전 묶음을 모두 치른 뒤 2차전, 1차전 선발은 2차전에 안 나오고, 같은 날 두 번 던진 투수·뛴 야수의 피로는 회복 없이 쌓인다', () => {
    const teams = world.teams.map((t) => t.idx);
    let checked = 0;
    let twicePitched = 0;
    let twiceBody = 0;
    for (const seed of ['dh-a', 'dh-b']) {
      const s = Season.start(world, FAST, seed, { cal, boxTeams: teams });
      const days = new Set(dhDays(s));
      expect(days.size, seed).toBeGreaterThan(5);
      const { states } = s;
      const bp = FAST.body;
      while (!s.done) {
        const day = s.day;
        if (!days.has(day)) { s.simulateDay(); continue; }
        // 2차전이 있는 팀 하나를 지휘자로 두고(모두 자동 = 지휘 없음), 그 팀 2차전 첫 물음 때 1차전 뒤 상태를 본다
        const g2 = s.schedule[day].find((g) => g.dh === 2)!;
        const team = g2.home;
        const org = world.teams[team].org.map((p) => p.idx);
        let mid: { fatigue: number[]; fatigueDay: number[]; body: number[]; bodyDay: number[] } | null = null;
        s.commander = {
          team,
          decide: (req) => {
            if (req.dh === 2 && !mid) {
              mid = {
                fatigue: org.map((i) => states.fatigue[i]), fatigueDay: org.map((i) => states.fatigueDay[i]),
                body: org.map((i) => states.body[i]), bodyDay: org.map((i) => states.bodyDay[i]),
              };
            }
            return {};
          },
        };
        const before = org.map((i) => ({ fatigue: currentFatigue(states, i, day), body: currentBody(states, i, day, bp) }));
        const from = s.log.length;
        s.simulateDay();
        s.commander = null;
        const logs = s.log.slice(from);
        // 1차전(또는 한 경기) 묶음이 모두 2차전 앞이고, 경기 기록에 차전이 남는다
        const firstTwo = logs.findIndex((l) => l.dh === 2);
        expect(firstTwo, `${seed} ${day}`).toBeGreaterThan(0);
        expect(logs.slice(firstTwo).every((l) => l.dh === 2)).toBe(true);
        expect(logs.length).toBe(s.schedule[day].length);
        for (const l of logs) expect(l.dh).toBe(s.schedule[day].find((g) => g.home === l.home && g.away === l.away && (g.dh === 2) === (l.dh === 2))!.dh);
        // 1차전 선발은 2차전에 나오지 않는다 (두 팀 모두)
        for (const [k, l] of logs.entries()) {
          if (l.dh !== 2) continue;
          const k1 = logs.findIndex((x) => x.dh === 1 && x.home === l.home && x.away === l.away);
          const b1 = s.boxes.get(from + k1)!;
          const b2 = s.boxes.get(from + k)!;
          for (const side of ['home', 'away'] as const) {
            const st1 = b1[side].pitchers[0].idx;
            expect(b2[side].pitchers.some((p) => p.idx === st1), `${seed} ${day} ${side} 1차전 선발`).toBe(false);
            expect(states.lastStartDay[b2[side].pitchers[0].idx]).toBe(day);
          }
          checked++;
        }
        // 지휘자 팀: 1차전 뒤 상태(mid)에서 2차전 몫만 더해졌다 (같은 날이라 회복 없음)
        expect(mid, `${seed} ${day} 2차전 물음`).not.toBeNull();
        const m = mid!;
        const k2 = logs.findIndex((l) => l.dh === 2 && l.home === team);
        const k1 = logs.findIndex((l) => l.dh === 1 && l.home === team);
        const box1 = s.boxes.get(from + k1)!.home;
        const box2 = s.boxes.get(from + k2)!.home;
        for (const p of box2.pitchers) {
          const j = org.indexOf(p.idx);
          const in1 = box1.pitchers.find((x) => x.idx === p.idx);
          if (in1) {
            // 1차전에도 던졌다: 1차전 뒤 = 경기 전 + 1차전 공, 하루가 끝난 뒤 = 그 값 + 2차전 공
            expect(m.fatigueDay[j]).toBe(day);
            expect(m.fatigue[j]).toBeCloseTo(before[j].fatigue + in1.np, 2);
            twicePitched++;
          }
          expect(states.fatigue[p.idx], `${seed} ${day} 투수 ${p.idx}`).toBeCloseTo((m.fatigueDay[j] === day ? m.fatigue[j] : before[j].fatigue) + p.np, 2);
        }
        for (const b of box2.batters) {
          if (b.sub) continue;
          const j = org.indexOf(b.idx);
          const in1 = box1.batters.some((x) => x.idx === b.idx && !x.sub);
          if (in1) {
            expect(m.bodyDay[j]).toBe(day);
            expect(m.body[j]).toBeGreaterThan(before[j].body);
            twiceBody++;
          }
          // 2차전 선발 출전은 load × 자리 배율(지명타자 0.6이 가장 작다) 이상을 더한다. 상한(cap)에 닿으면 상한
          const midBody = m.bodyDay[j] === day ? m.body[j] : before[j].body;
          expect(states.body[b.idx] + 1e-4, `${seed} ${day} 야수 ${b.idx}`).toBeGreaterThanOrEqual(Math.min(bp.cap, midBody + bp.load * bp.dh));
          expect(states.bodyDay[b.idx]).toBe(day);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(twicePitched).toBeGreaterThan(0);
    expect(twiceBody).toBeGreaterThan(20);
  }, 300_000);

  it('2차전 경기 난수는 1차전과 다른 줄기이고, 더블헤더 날 앞뒤로 저장(JSON)했다가 이어 돌려도 끊김 없이 돌린 결과와 같다', () => {
    const ref = Season.start(world, FAST, 'dh-save', { cal, boxTeams: [0] });
    const g2 = ref.schedule[dhDays(ref)[0]].find((g) => g.dh === 2)!;
    const day = dhDays(ref)[0];
    expect(ref.gameRng(day, g2).next()).not.toBe(ref.gameRng(day, { home: g2.home, away: g2.away, dh: 1 }).next());
    expect(ref.gameRng(day, { home: g2.home, away: g2.away, dh: 1 }).next()).toBe(ref.gameRng(day, { home: g2.home, away: g2.away }).next());
    ref.runToEnd();

    let s = Season.start(world, FAST, 'dh-save', { cal, boxTeams: [0] });
    const stops = dhDays(s).slice(0, 4).flatMap((d) => [d, d + 1]);
    for (const stop of stops) {
      while (s.day < stop && !s.done) s.simulateDay();
      s = Season.restore(world, FAST, roundTrip(s.toSave()));
    }
    s.runToEnd();
    expect(s.log).toEqual(ref.log);
    expect(s.teams).toEqual(ref.teams);
    expect(s.bat).toEqual(ref.bat);
    expect(s.pit).toEqual(ref.pit);
  }, 240_000);
});

describe('더블헤더 직접 지휘 (9단계)', () => {
  it('더블헤더 날 우리 2차전을 지휘하면 1차전은 감독이 맡고, 미리보기 = 확정, 조작 기록으로 다시 돌려도 같다', () => {
    const lg = store.season(YEAR)!.teams.findIndex((t) => t.name === 'LG');
    const opts = { year: YEAR, teamIdx: lg, seed: 'dh-cmd' };
    const g = GameSession.create(store, opts, FAST);
    const auto = GameSession.create(store, opts, FAST);
    while (g.ourGamesToday().length < 2 && !g.season.done) { g.advance(1, NO_STOPS); auto.advance(1, NO_STOPS); }
    expect(g.ourGamesToday()).toEqual([undefined, 2]);
    // 답을 기다리는 이벤트가 있으면 지휘할 수 없다: 두 판 모두 같은 답
    if (g.pendingEvent) { g.answerEvent(0); auto.answerEvent(0); }
    expect(g.canCommand).toBe(true);
    // 2차전: 지휘하는 동안 1차전(감독)을 미리보기가 먼저 돌린다. 도루·번트를 고른다
    let pv = g.commandPreview([], 'next', 2);
    expect(pv.dh).toBe(2);
    let guard = 0;
    while (pv.req && guard++ < 300) {
      const r = pv.req;
      const c: CommandChoice = {};
      if (r.step === 'run') c.steal = 'go';
      if (r.step === 'bat' && r.bases[0] >= 0 && r.bases[1] < 0 && r.outs < 2) c.tactic = 'bunt';
      pv = g.commandPreview([...pv.choices, c], 'next', 2);
    }
    expect(pv.req).toBeNull();
    expect(pv.dh).toBe(2);
    const from = g.season.log.length;
    expect(g.commitCommand(pv.choices, pv.dh).ok).toBe(true);
    expect(g.actions.at(-1)).toMatchObject({ type: 'command', dh: 2 });
    auto.advance(1, NO_STOPS);
    const mine = (l: { home: number; away: number }) => l.home === lg || l.away === lg;
    const ours = g.season.log.slice(from).filter(mine);
    const autos = auto.season.log.slice(from).filter(mine);
    expect(ours.map((l) => l.dh)).toEqual([1, 2]);
    // 1차전은 지휘하지 않은 판과 같고, 2차전은 미리보기와 같다
    expect(ours[0]).toEqual(autos[0]);
    expect({ away: ours[1].awayRuns, home: ours[1].homeRuns }).toEqual(pv.final);
    expect(g.ourGames().at(-1)!.plays).toEqual(pv.plays);
    // 지휘한 2차전은 감독에게 맡긴 판과 달라졌다 (도루·번트)
    expect(g.ourGames().at(-1)!.plays).not.toEqual(auto.ourGames().at(-1)!.plays);
    const rep = GameSession.replay(store, g.reproInfo().opts, g.actions, { year: YEAR, day: g.day }, FAST);
    expect(rep.season.log).toEqual(g.season.log);
  }, 300_000);
});
