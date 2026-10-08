// 수비 모델과 플레이어 기용표 (2026-10-08 사용자 요청): 포지션별 수비, 최적 배치, 주전·선발·마무리 지정.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import {
  assignSlots, bestAssignment, computeGrades, DEFAULT_PARAMS, defenseAt, defenseGrade, LINEUP_SLOTS, makeDefense, moveRuns, Season, worldForYear,
  type DepthPlan,
} from '../src/engine';
import { newPlayerStates, refreshActive, type TeamSeason } from '../src/engine/team';
import { GameSession, type GameSave } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };

beforeAll(() => {
  store = loadDataStore();
});

function lgGame(seed = 'lineup'): GameSession {
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  return GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
}

describe('최적 배정 (헝가리안)', () => {
  it('작은 문제에서 모든 경우를 따진 답과 점수 합이 같다', () => {
    const score = [[7, 2, 9, 4], [3, 8, 1, 6], [5, 5, 8, 2]];
    const pick = bestAssignment(score);
    let best = -Infinity;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
      if (a === b || b === c || a === c) continue;
      best = Math.max(best, score[0][a] + score[1][b] + score[2][c]);
    }
    expect(new Set(pick).size).toBe(3);
    expect(pick.reduce((s, j, i) => s + score[i][j], 0)).toBe(best);
  });

  it('선수가 자리보다 적으면 남는 자리는 비운다', () => {
    const pick = bestAssignment([[1, 2], [3, 4], [5, 1]]);
    expect(pick.filter((j) => j >= 0)).toHaveLength(2);
  });
});

describe('수비 능력', () => {
  it('같은 선수면 같은 값이고, 포지션 이력이 있으면 그 자리 손해가 작다', () => {
    expect(makeDefense('x1', 'SS', [], 0.5, 27)).toEqual(makeDefense('x1', 'SS', [], 0.5, 27));
    expect(moveRuns('3B', 'SS', true)).toBeGreaterThan(moveRuns('3B', 'SS', false));
    expect(moveRuns('1B', 'SS', false)).toBeLessThan(moveRuns('3B', 'SS', false));
    expect(moveRuns('SS', '1B', false)).toBeGreaterThan(0); // 유격수는 1루를 평균보다 잘 본다
    expect(moveRuns('LF', 'C', false)).toBeLessThanOrEqual(-60);
  });

  it('AI 감독 배치: 2026 모든 구단의 포수 자리에는 포수가 서고, 그 자리 평균보다 15런 넘게 나쁜 배치가 없다', () => {
    const world = worldForYear(store, 2026, FAST);
    for (const team of world.teams) {
      const ts = { team, hitters: [], rotation: [], bullpen: [], closer: null, nextReturnDay: 0, dirty: true, manual: null } as TeamSeason;
      refreshActive(ts, world, newPlayerStates(world.players.length), 0);
      const placed = assignSlots(ts.hitters);
      expect(placed).toHaveLength(9);
      const c = placed.find((x) => x.slot === 'C')!;
      expect(c.p.pos, `${team.name} 포수 ${c.p.name}`).toBe('C');
      for (const x of placed) expect(defenseAt(x.p, x.slot), `${team.name} ${x.slot} ${x.p.name}`).toBeGreaterThan(-15);
    }
  });

  it('한 자리에서 400타석 넘게 뛴 주전은 그 자리 수비 등급이 35 이상이다 (최정 3루가 20으로 나온 문제의 회귀 시험)', () => {
    const world = worldForYear(store, 2026, FAST);
    const prev = new Map(store.season(2025)!.bat.map((r) => [r.id, r]));
    let n = 0;
    for (const p of world.players) {
      const r = prev.get(p.id);
      if (p.isPitcher || !r || r.pa < 400 || !r.pos || ['DH', 'IF', 'OF'].includes(r.pos)) continue;
      expect(defenseGrade(defenseAt(p, r.pos)), `${p.name} ${r.pos}`).toBeGreaterThanOrEqual(35);
      n++;
    }
    expect(n).toBeGreaterThan(30);
    const choi = world.players.find((p) => p.name === '최정')!;
    expect(choi.pos).toBe('3B'); // 2025년 한 해 지명타자였어도 주 포지션은 3루
  });

  it('엉뚱한 자리에 세운 팀은 상대에게 인플레이 안타를 더 내준다', () => {
    // 같은 월드·시드에서 한 구단만 수비를 망가뜨린 기용표로 돌려, 그 구단 투수들의 피안타율(홈런 제외)을 비교한다
    const run = (bad: boolean) => {
      const world = worldForYear(store, 2025, FAST);
      const s = Season.start(world, FAST, 'def-effect', { cal: UNIT });
      const t = 0;
      const ts = s.refresh(t);
      const hitters = [...ts.hitters];
      s.setManualEntry(t, [...hitters, ...ts.rotation, ...ts.bullpen].map((p) => p.idx));
      if (bad) {
        // 최적 배치를 거꾸로: 각 자리에 그 자리 수비가 가장 나쁜 선수를 (포수는 그대로)
        const starters: DepthPlan['starters'] = {};
        const used = new Set<number>();
        const good = assignSlots(hitters);
        const catcher = good.find((x) => x.slot === 'C')!.p;
        starters.C = catcher.idx;
        used.add(catcher.idx);
        for (const slot of LINEUP_SLOTS.filter((x) => x !== 'C' && x !== 'DH')) {
          const worst = hitters.filter((p) => !used.has(p.idx)).sort((a, b) => defenseAt(a, slot) - defenseAt(b, slot))[0];
          if (worst) { starters[slot] = worst.idx; used.add(worst.idx); }
        }
        s.setPlan(t, { starters, rotation: [], closer: null });
      }
      s.runToEnd();
      const staff = world.players.filter((p) => p.teamIdx === t && p.isPitcher);
      let h = 0;
      let bip = 0;
      for (const p of staff) {
        const l = s.pit[p.idx];
        h += l.h - l.hr;
        bip += l.bf - l.so - l.bb - l.hbp - l.hr;
      }
      return h / bip;
    };
    expect(run(true)).toBeGreaterThan(run(false) + 0.01);
  });
});

describe('기용표 (주전 자리, 선발·중계·마무리)', () => {
  it('드롭다운으로 정한 주전이 그 자리에 선다', () => {
    const g = lgGame();
    const sub = g.activeTeam().hitters.find((p) => !g.slotOf(p))!;
    expect(sub).toBeDefined();
    const before = g.effectivePlan().starters['1B'];
    expect(g.setHitterSlot(sub, '1B').errors).toEqual([]);
    expect(g.slotOf(sub)).toBe('1B');
    if (before !== undefined) expect(g.slotOf(g.world.players[before])).toBeNull(); // 원래 1루수는 서브로
    g.advance(20);
    // 결장하지 않았다면 대부분의 경기에 1루로 나온다
    const games = g.season.bat[sub.idx].g;
    if (!g.isAbsent(sub)) expect(games).toBeGreaterThanOrEqual(8);
  });

  it('중계 투수를 선발로 돌리면 선발로 나오고, 정한 마무리가 세이브를 올린다', () => {
    const g = lgGame('roles');
    const ts = g.activeTeam();
    const reliever = ts.bullpen.filter((p) => p !== ts.closer).sort((a, b) => b.pit!.reliefStint - a.pit!.reliefStint)[0];
    const newCloser = ts.bullpen.filter((p) => p !== ts.closer && p !== reliever)[0];
    expect(g.setPitcherRole(reliever, 'SP').errors).toEqual([]);
    expect(g.setPitcherRole(newCloser, 'CL').errors).toEqual([]);
    expect(g.pitcherRole(reliever)).toBe('SP');
    expect(g.pitcherRole(newCloser)).toBe('CL');
    g.advance(40);
    expect(g.season.pit[reliever.idx].gs).toBeGreaterThan(0);
    if (!g.isAbsent(newCloser)) expect(g.season.pit[newCloser.idx].sv).toBeGreaterThan(0);
  });

  it('잘못된 기용표는 받지 않는다: 2군 선수, 투수를 야수 자리에, 선발을 마무리로', () => {
    const g = lgGame('bad-plan');
    const reg = new Set(g.registered().map((p) => p.idx));
    const farm = g.team.org.find((p) => !reg.has(p.idx) && !p.isPitcher)!;
    const pitcher = g.registered().find((p) => p.isPitcher)!;
    const pl = g.effectivePlan();
    expect(g.setPlan({ ...pl, starters: { ...pl.starters, LF: farm.idx } }).errors.length).toBeGreaterThan(0);
    expect(g.setPlan({ ...pl, starters: { ...pl.starters, LF: pitcher.idx } }).errors.length).toBeGreaterThan(0);
    expect(g.setPlan({ ...pl, closer: pl.rotation[0] }).errors.length).toBeGreaterThan(0);
  });

  it('기용표를 정한 게임을 저장했다 불러와 끝까지 돌리면 끊지 않은 게임과 같고, 조작 기록으로 다시 돌려도 같다', () => {
    const play = (g: GameSession) => {
      const ts = g.activeTeam();
      const sub = ts.hitters.find((p) => !g.slotOf(p))!;
      g.setHitterSlot(sub, 'LF');
      g.setPitcherRole(ts.bullpen[1], 'CL');
      g.advance(30);
    };
    const a = lgGame('plan-save');
    play(a);
    const saved = JSON.parse(JSON.stringify(a.toSave())) as GameSave;
    a.advance(100000);
    const b = GameSession.load(store, saved, FAST);
    b.advance(100000);
    expect(b.season.teams).toEqual(a.season.teams);
    expect(b.season.bat).toEqual(a.season.bat);
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const c = GameSession.replay(store, { year: 2026, teamIdx: lg, seed: 'plan-save' }, a.actions, undefined, FAST);
    c.advance(100000);
    expect(c.season.teams).toEqual(a.season.teams);
  });
});

describe('구원 체력', () => {
  it('모든 투수에게 선발 체력과 구원 체력 등급이 있고, 롱릴리프가 구원 체력이 높다', () => {
    const world = worldForYear(store, 2025, FAST);
    const g = computeGrades(world);
    const rp = world.players.filter((p) => p.isPitcher && p.pit!.startShare < 0.5 && p.pit!.sample >= 200);
    for (const p of rp) {
      expect(g.pitchers.get(p.id)!.reliefStamina).toBeGreaterThanOrEqual(20);
      expect(g.pitchers.get(p.id)!.stamina).not.toBeNull();
    }
    const long = [...rp].sort((a, b) => b.pit!.reliefStint - a.pit!.reliefStint);
    expect(g.pitchers.get(long[0].id)!.reliefStamina).toBeGreaterThan(g.pitchers.get(long.at(-1)!.id)!.reliefStamina);
  });
});
