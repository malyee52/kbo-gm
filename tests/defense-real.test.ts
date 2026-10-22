// 수비 포지션·능력치 (2026-10-13 사용자 "수비 능력치·포지션이 실제와 다르게 작동"): 본 자리가 가장 높고, 수비상 수상자는 정상급,
// 지명타자도 커리어 수비 자리가 있고, 직접 고치면 경기·저장·재현에 들어간다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, defenseAt, defenseGrade, fieldPosOf, FIELD_POS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { rookiePosition } from '../src/league/offseason';

let store: DataStore;
let g: GameSession;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => {
  store = loadDataStore();
  g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'def-real' }, FAST);
}, 120_000);
const hitter = (name: string) => g.world.players.find((p) => p.name === name && !p.isPitcher)!;

describe('수비 포지션·능력치', () => {
  it('본 자리가 가장 높다 (예전에는 거의 모두 1루가 가장 높았다)', () => {
    let ok = 0;
    let n = 0;
    for (const p of g.world.players.filter((x) => !x.isPitcher && x.pos && x.pos !== 'DH' && x.bat?.def)) {
      const own = defenseAt(p, fieldPosOf(p.pos));
      n++;
      if (FIELD_POS.every((q) => defenseAt(p, q) <= own + 1e-9)) ok++;
    }
    expect(ok / n).toBeGreaterThan(0.95);
  });

  it('KBO 수비상 수상자는 그 자리 정상급 (등급 65 이상)', () => {
    expect(store.defenseAwards).toBeDefined();
    for (const [name, q] of [['박해민', 'CF'], ['김주원', 'SS'], ['디아즈', '1B'], ['에레디아', 'LF'], ['송성문', '3B']] as const) {
      const p = hitter(name);
      if (p) expect(defenseGrade(defenseAt(p, q)), name).toBeGreaterThanOrEqual(65);
    }
  });

  it('지명타자도 커리어에 맡은 수비 자리가 있다', () => {
    // 2026-10-22 하드힛 주 포지션 반영: 하드힛 주 포지션에는 지명타자가 없어 강백호도 수비 자리(포수·1루·우익수 이력)로 잡힌다
    const p = hitter('강백호');
    expect(p.pos).not.toBe('DH');
    expect(defenseGrade(defenseAt(p, '1B'))).toBeGreaterThanOrEqual(40);
  });

  it('직접 고치기: 경기에 들어가고 저장·재현이 같다', () => {
    const h = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'def-edit' }, FAST);
    const p = h.team.org.find((x) => !x.isPitcher && x.pos === 'SS') ?? h.team.org.find((x) => !x.isPitcher)!;
    expect(h.editDefense(p.id, { SS: 12, '2B': 10 }).ok).toBe(true);
    expect(defenseAt(p, 'SS')).toBe(12);
    expect(h.leaguePlayer(p.id)!.bat!.def!.SS).toBe(12);
    h.advance(5);
    const info = h.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(h.toSave().league));
    const l = GameSession.load(store, roundTrip(h.toSave()), FAST);
    expect(defenseAt(l.world.players.find((x) => x.id === p.id)!, 'SS')).toBe(12);
  }, 300_000);

  it('신인은 지명타자로 시작하지 않는다 (이대호: 커리어 끝 프로필은 지명타자지만 신인 때는 수비 자리)', () => {
    const m = [...store.players.values()].find((x) => x.name === '이대호' && x.birthYear === 1982)!;
    const pos = rookiePosition(store, m, 2001, 'P');
    expect(pos).not.toBe('DH');
    expect(['1B', '3B', 'C', '2B', 'SS', 'LF', 'RF', 'CF']).toContain(pos);
    expect(rookiePosition(store, null, 2027, 'P')).toBe('IF');
  });
});
