// 훈련 탭 (능력치 v2 16-4c, 기획안 9.10·15.8, league/training.ts)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type FieldPos } from '../src/engine';
import { refreshPlayable } from '../src/engine/fielding';
import { experienceGrade, runGradesOf } from '../src/engine/runskills';
import { valueContext, type ValueContext } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { growBranches, makeCeiling } from '../src/league/branches';
import { runsOf } from '../src/league/growth';
import { aiTraining, applyDrill, focusOf, posGain, setTraining, teamTraining, trainingFrac, TRAIN_SLOTS } from '../src/league/training';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

let store: DataStore;
let league: LeagueState;
let ctx: ValueContext;

beforeAll(() => {
  store = loadDataStore();
  const made = createLeague(store, 2026, 'tr-a');
  league = made.league;
  ctx = valueContext(made.world);
});

const ofTeam = (t: number) => league.players.filter((p) => p.team === t);

describe('훈련 걸기', () => {
  it(`구단당 ${TRAIN_SLOTS}명까지, 투수는 수비 자리 훈련 불가, 이미 수비 가능한 자리·포수 아닌 선수의 포수 훈련은 막는다`, () => {
    const L = structuredClone(league);
    const team = 0;
    const bats = L.players.filter((p) => p.team === team && !p.isPitcher);
    const pit = L.players.find((p) => p.team === team && p.isPitcher)!;
    expect(setTraining(L, team, pit.id, { pos: '1B' }, 0).ok).toBe(false);
    const nonC = bats.find((p) => !p.bat?.playable?.includes('C'))!;
    expect(setTraining(L, team, nonC.id, { drill: 'cFrame' }, 0).ok).toBe(false);
    const playable = nonC.bat!.playable![0];
    expect(setTraining(L, team, nonC.id, { pos: playable }, 0).ok).toBe(false);
    const all = L.players.filter((p) => p.team === team);
    for (const p of all.slice(0, TRAIN_SLOTS)) expect(setTraining(L, team, p.id, { drill: p.isPitcher ? 'bb' : 'hr' }, 0).ok).toBe(true);
    expect(setTraining(L, team, all[TRAIN_SLOTS].id, { drill: all[TRAIN_SLOTS].isPitcher ? 'bb' : 'hr' }, 0).ok).toBe(false);
    // 이미 훈련 중인 선수의 꼴 바꾸기·풀기는 인원과 상관없다
    expect(setTraining(L, team, all[0].id, { drill: all[0].isPitcher ? 'so' : 'bb' }, 30).ok).toBe(true);
    expect(L.training![all[0].id].since).toBe(30);
    expect(setTraining(L, team, all[0].id, null, 40).ok).toBe(true);
    expect(teamTraining(L, team).length).toBe(TRAIN_SLOTS - 1);
    // 다른 구단 선수는 안 됨
    const other = L.players.find((p) => p.team === 1)!;
    expect(setTraining(L, team, other.id, { drill: 'bb' }, 0).ok).toBe(false);
  });

  it('기간 몫: 개막부터 1, 시즌 절반에 걸면 0.5', () => {
    expect(trainingFrac({ since: 0 }, 140)).toBe(1);
    expect(trainingFrac({ since: 70 }, 140)).toBe(0.5);
    expect(trainingFrac({ since: 200 }, 140)).toBe(0);
  });
});

describe('훈련 효과', () => {
  it('갈래 집중: 파워 훈련이면 같은 성장 총량에서 홈런이 더 크고 다른 갈래는 덜 큰다', () => {
    const p0 = ofTeam(0).find((p) => !p.isPitcher && p.bat && p.birthYear && 2027 - p.birthYear <= 24)!;
    const p = { ...p0, potential: runsOf(p0, ctx, 2026) + 25 };
    const ceil = makeCeiling(p, ctx, 2026, 'tr-test');
    const now = runsOf(p, ctx, 2026);
    const base = growBranches(p, ceil, now + 5, ctx, 2026, { age: 23, timing: 0, stream: 'tr/s' });
    const focus = growBranches(p, ceil, now + 5, ctx, 2026, { age: 23, timing: 0, stream: 'tr/s', focus: focusOf({ team: 0, drill: 'hr', since: 0 }, 1) });
    expect(focus.bat!.hr).toBeGreaterThan(base.bat!.hr);
    expect(focus.bat!.bb).toBeLessThan(base.bat!.bb);
    expect(runsOf({ ...p, ...focus }, ctx, 2026)).toBeCloseTo(now + 5, 1);
    // 기간 몫 0이면 집중 없음
    expect(focusOf({ team: 0, drill: 'hr', since: 0 }, 0)).toBeUndefined();
    expect(focusOf({ team: 0, drill: 'runIQ', since: 0 }, 1)).toBeUndefined();
  });

  it('자라지 않는 능력: 시즌당 +1.5 (기간 비례), 월드 때 그 나이 평균 + 15까지만', () => {
    const p = structuredClone(ofTeam(0).find((x) => !x.isPitcher && x.real !== false)!) as LeaguePlayer;
    applyDrill(p, { team: 0, drill: 'runIQ', since: 0 }, 1, 25, null);
    applyDrill(p, { team: 0, drill: 'runIQ', since: 70 }, 0.5, 25, null);
    expect(p.drill!.runIQ).toBeCloseTo(2.25, 9);
    const sim = { id: p.id, age: 25, real: true, bat: p.bat, pit: null };
    const plain = runGradesOf(sim, DEFAULT_PARAMS).bat!.runIQ;
    const trained = runGradesOf(sim, DEFAULT_PARAMS, { startYear: 2026, drill: new Map([[p.id, { runIQ: 2.25 }]]), drillCap: 15 }).bat!.runIQ;
    expect(trained - plain).toBeCloseTo(2.25, 9);
    const capped = runGradesOf(sim, DEFAULT_PARAMS, { startYear: 2026, drill: new Map([[p.id, { runIQ: 40 }]]), drillCap: 15 }).bat!.runIQ;
    expect(capped).toBeCloseTo(experienceGrade(25) + 15, 9);
  });

  it('수비 자리 훈련: 익힘 m이 표대로 쌓이고, 0.5가 되면 그 자리가 수비 가능이 된다', () => {
    expect(posGain('SS', '2B', 24)).toBeCloseTo(0.72, 9);
    expect(posGain('3B', '1B', 28)).toBeCloseTo(0.5, 9);
    expect(posGain('LF', 'C', 36)).toBeCloseTo(0.06, 9);
    const p = structuredClone(ofTeam(0).find((x) => !x.isPitcher && x.bat?.playable && !x.bat.playable.includes('1B') && x.pos !== 'C')!) as LeaguePlayer;
    applyDrill(p, { team: 0, pos: '1B', since: 0 }, 1, 28, 'SS');
    expect(p.drillPos!['1B']).toBeCloseTo(0.5, 9);
    const before = refreshPlayable([], 2027, 'SS');
    const after = refreshPlayable([], 2027, 'SS', p.drillPos as Partial<Record<FieldPos, number>>);
    expect(before.playable.includes('1B')).toBe(false);
    expect(after.playable.includes('1B')).toBe(true);
  });

  it(`AI 구단 훈련: 결정적, ${TRAIN_SLOTS}명 이하, 30세 이하, 걸 수 있는 꼴만`, () => {
    // 갈래 천장은 리그를 만들 때 실존 선수에게 붙는다
    for (let t = 1; t < league.teams.length; t++) {
      const a = aiTraining(league, t, 2026);
      const b = aiTraining(league, t, 2026);
      expect([...a]).toEqual([...b]);
      expect(a.size).toBeLessThanOrEqual(TRAIN_SLOTS);
      expect(a.size).toBeGreaterThan(0);
      for (const [id, plan] of a) {
        const p = league.players.find((x) => x.id === id)!;
        expect(p.team).toBe(t);
        expect(2027 - p.birthYear!).toBeLessThanOrEqual(30);
        expect(['so', 'bb', 's1', 'hr', 't3']).toContain(plan.drill);
      }
    }
  });
});
