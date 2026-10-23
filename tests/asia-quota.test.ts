// 아시아쿼터 선수 (2026-10-22 사용자 보고: "LG 웰스가 그냥 외국인으로 되어 있음", "계약도 못 하던데?").
// 표시 태그(src/ui/foreignTag.ts), 시작 연봉(league/create.ts), 오프시즌 외국인 단계 자리 계산(league/offseason.ts)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import * as Off from '../src/league/offseason';
import { ASIA_NEW_CAP } from '../src/league/salary';
import { foreignTag } from '../src/ui/foreignTag';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

describe('아시아쿼터 표시와 시작 계약 (2026 시작판)', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'asia-start' }, FAST);
  });
  const byName = (team: string, name: string) => {
    const t = g.world.teams.findIndex((x) => x.name === team);
    const p = g.world.teams[t].org.find((x) => x.name === name);
    expect(p, `${team} ${name}`).toBeDefined();
    return p!;
  };
  const tagOf = (team: string, name: string) => foreignTag(byName(team, name), (id) => g.leaguePlayer(id));

  it('웰스(LG)·왕옌청(한화)은 아시아쿼터, 오스틴은 외국인, 국내 선수는 태그 없음', () => {
    expect(tagOf('LG', '웰스')).toEqual({ short: '아', long: '아시아쿼터', title: '아시아쿼터 선수' });
    expect(tagOf('한화', '왕옌청')?.long).toBe('아시아쿼터');
    expect(tagOf('LG', '오스틴')).toEqual({ short: '외', long: '외국인', title: '외국인 선수' });
    expect(tagOf('LG', '박해민')).toBeNull();
  });

  it('아시아쿼터의 시작 연봉은 아시아쿼터 식 (신규 상한 안). 전에는 일반 외국인 재계약 식으로 100만 달러를 넘었다', () => {
    const asia = g.league.players.filter((p) => p.team >= 0 && p.asia);
    expect(asia.length).toBe(10);
    for (const p of asia) expect(p.contract.salary, p.name).toBeLessThanOrEqual(ASIA_NEW_CAP);
  });

  it('저장·불러오기 뒤에도 아시아쿼터 값이 남는다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const wells = h.league.players.find((p) => p.name === '웰스' && p.team === lg)!;
    expect(wells.asia).toBe(true);
  });
});

describe('오프시즌 외국인 단계: 웰스 + 일반 외국인 2명 (2026-10-22 사용자 재현)', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'asia-off' }, FAST);
    g.advance(1000);
    g.beginOffseason();
    for (let i = 0; i < 20 && g.offseason!.stage !== 'foreign'; i++) {
      if (g.offseason!.stage === 'comp') g.autoComp();
      g.nextStage();
    }
  }, 120_000);
  const wells = () => g.league.players.find((p) => p.id === '55348')!;
  const regularPool = () => g.offseason!.foreign!.pool.map((id) => g.leaguePlayer(id)!).filter((p) => !p.asia).sort((a, b) => a.contract.salary - b.contract.salary);

  it('결산·저장 뒤에도 웰스는 아시아쿼터이고 아시아쿼터 자리로 센다 (일반 자리·총액에 들지 않는다)', () => {
    expect(g.offseason!.stage).toBe('foreign');
    expect(wells().asia).toBe(true);
    expect(GameSession.load(store, roundTrip(g.toSave()), FAST).league.players.find((p) => p.id === '55348')!.asia).toBe(true);
    const keep = g.offseason!.foreign!.keep;
    const s = Off.foreignSlots(g.league, lg, g.offseason!);
    const kept = g.league.players.filter((p) => keep[p.id] && p.team === lg);
    expect(s.asia).toBe(kept.filter((p) => p.asia).length);
    expect(s.regular).toBe(kept.filter((p) => !p.asia).length);
    expect(s.regularPay).toBe(kept.filter((p) => !p.asia).reduce((a, p) => a + p.contract.salary, 0));
  });

  it('막히면 총액 상한 문구에 지금 총액과 요구액이 나온다 (권고대로 오스틴·톨허스트를 남기면 일반 후보가 모두 막힌다)', () => {
    const off = g.offseason!;
    const s = Off.foreignSlots(g.league, lg, off);
    const c = regularPool()[0];
    const check = Off.canSignForeign(g.league, off, lg, c);
    expect(s.regular).toBeLessThan(3); // 일반 자리는 남아 있다
    expect(s.regularPay + c.contract.salary).toBeGreaterThan(4_000_000);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('총액 상한');
    expect(check.message).toContain('요구액');
  });

  it('웰스만 재계약하면 일반 외국인 3명과 차례로 계약할 수 있다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    for (const id of Object.keys(h.offseason!.foreign!.keep)) expect(h.setForeignKeep(id, id === '55348').ok).toBe(true);
    for (let k = 0; k < 3; k++) {
      const c = h.offseason!.foreign!.pool.map((id) => h.leaguePlayer(id)!).filter((p) => !p.asia).sort((a, b) => a.contract.salary - b.contract.salary)[0];
      expect(h.signForeign(c.id)).toEqual({ ok: true, message: '' });
    }
    expect(Off.foreignSlots(h.league, lg, h.offseason!)).toMatchObject({ regular: 3, asia: 1 });
    h.nextStage();
    const w = h.league.players.find((p) => p.id === '55348')!;
    expect(w.team).toBe(lg);
    expect(w.asia).toBe(true);
    // 아시아쿼터 재계약 연봉도 신규 상한 안 (임시 규칙: 실제 재계약 상한은 확인 필요)
    expect(w.contract.salary).toBeLessThanOrEqual(ASIA_NEW_CAP);
  });
});
