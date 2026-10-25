// 수비 포지션·능력치 (2026-10-13 사용자 "수비 능력치·포지션이 실제와 다르게 작동"; 능력치 v2 16-3에서 새 식으로): 본 자리는 수비 가능,
// 수비상 수상자는 정상급, 지명타자도 수비 본 자리가 있고, 직접 고치면 경기·저장·재현에 들어간다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { fieldYears, homeOf } from '../src/engine/fielding';
import { DEFAULT_PARAMS, defenseAt, defenseGrade, FIELD_POS } from '../src/engine';
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
  it('능력치 v2: 본 자리는 늘 수비 가능, 안 해 본 자리는 등급 20 (16-3, 13.2)', () => {
    for (const p of g.world.players.filter((x) => !x.isPitcher && x.pos && x.pos !== 'DH' && x.bat?.def)) {
      const home = homeOf(p.pos)!;
      expect(p.bat!.playable, p.name).toContain(home);
      const years = fieldYears(store, p.id, 2026);
      for (const q of FIELD_POS) if (!years.some((y) => (y.inn?.[q] ?? 0) > 0) && !p.bat!.playable!.includes(q)) expect(defenseGrade(defenseAt(p, q)), `${p.name} ${q}`).toBe(20);
    }
  });

  it('KBO 수비상 수상자는 그 자리 정상급 (등급 65 이상)', () => {
    expect(store.defenseAwards).toBeDefined();
    for (const [name, q] of [['박해민', 'CF'], ['김주원', 'SS'], ['디아즈', '1B'], ['에레디아', 'LF'], ['송성문', '3B']] as const) {
      const p = hitter(name);
      if (p) expect(defenseGrade(defenseAt(p, q)), name).toBeGreaterThanOrEqual(65);
    }
  });

  it('지명타자도 수비 본 자리가 있다 (강백호 2026: 화면 DH, 1B·RF 수비 가능, 비상 포수, LF 불가)', () => {
    // 능력치 v2 (12.2·14.2): 수비 없는 타석 몫 0.76이라 화면 DH, 수비 본 자리는 커리어 최다 1B. 포수 3시즌 202이닝은 비상 포수
    const p = hitter('강백호');
    expect(p.pos).toBe('DH');
    expect(p.bat!.playable).toEqual(expect.arrayContaining(['1B', 'RF']));
    expect(p.bat!.playable).not.toContain('LF');
    expect(p.bat!.playable).not.toContain('C');
    expect(p.bat!.emC).toBe(true);
    expect(defenseGrade(defenseAt(p, 'C'))).toBeLessThan(30);
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
