// 자유 모드에서 만든 아시아 국적 외국인의 아시아쿼터 (2026-10-29 사용자 보고: "AI가 추가하는 외국인 선수들이 아쿼를 안 붙이고 나옴. 오타니나 야마모토 같은 선수들").
// 국적(nation)을 받으면 그대로, 없으면 이름(일본 성·가나)으로 짐작한다. 아시아쿼터가 있는 해(2026~)에 그 구단 자리가 비면 아시아쿼터, 아니면 일반 외국인
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { asiaEligible, asiaNation, resolveOps } from '../src/fantasy/free';
import { foreignCap } from '../src/league/salary';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('자유 모드 아시아쿼터', () => {
  it('국적·이름으로 아시아쿼터 대상을 가린다', () => {
    expect(asiaNation('일본')).toBe(true);
    expect(asiaNation('Japan')).toBe(true);
    expect(asiaNation('호주')).toBe(true);
    expect(asiaNation('미국')).toBe(false);
    expect(asiaNation(undefined)).toBeNull();
    expect(asiaEligible(undefined, '오타니 쇼헤이')).toBe(true);
    expect(asiaEligible(undefined, '야마모토 요시노부')).toBe(true);
    expect(asiaEligible(undefined, 'ダルビッシュ')).toBe(true);
    expect(asiaEligible(undefined, '멜빈 번치')).toBe(false);
    expect(asiaEligible('대만', '왕보룽')).toBe(true);
    // 국적을 주면 이름 짐작보다 앞선다 (일본 성의 미국 국적 선수)
    expect(asiaEligible('미국', '스즈키 켄')).toBe(false);
  });

  it('2026 시즌 중: 아시아쿼터 자리가 빈 구단에 만든 일본 선수는 아시아쿼터, 자리가 차면 일반 외국인. 서양 선수는 일반', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'free-asia', fantasy: { free: true } }, FAST);
    g.advance(3);
    const asiaHeld = (t: number) => g.world.teams[t].org.filter((p) => p.foreign && g.leaguePlayer(p.id)?.asia).length;
    // 2026은 모든 구단이 아시아쿼터를 채워 시작하므로 한 구단의 아시아쿼터 선수를 먼저 내보낸다
    const t = 1;
    const team = g.league.teams[t].name;
    const out = g.world.teams[t].org.find((p) => p.foreign && g.leaguePlayer(p.id)?.asia)!;
    const rel = resolveOps(g, [{ op: 'move', player: `${out.name}@${team}`, to: '방출' }], store);
    expect(rel.dropped).toEqual([]);
    g.addFantasy({ kind: 'action', title: 't', text: 'x', ops: rel.ops });
    expect(asiaHeld(t)).toBe(0);
    const { ops, dropped } = resolveOps(g, [
      { op: 'create', name: '오타니 쇼헤이', team, pos: 'P', role: 'SP', age: 31, now: 80, potential: 80, real: true },
      { op: 'create', name: '야마모토 요시노부', team, pos: 'P', role: 'SP', age: 27, now: 78, potential: 80, real: true, nation: '일본' },
      { op: 'create', name: '멜빈 번치', team, pos: 'P', role: 'SP', age: 28, now: 55, potential: 55, real: true },
    ], store);
    expect(dropped).toEqual([]);
    expect(ops.map((o) => (o as { asia?: boolean }).asia ?? false)).toEqual([true, true, false]);
    g.addFantasy({ kind: 'action', title: 't', text: 'x', ops });
    const lp = (name: string) => g.league.players.find((p) => p.name.startsWith(name))!;
    expect(lp('야마모토').name).toBe('야마모토 요시노부'); // 8자로 잘리지 않는다
    expect(lp('오타니').foreign).toBe(true);
    expect(lp('오타니').asia).toBe(true);
    expect(lp('오타니').contract.salary).toBeLessThanOrEqual(foreignCap(g.league, 'asiaNewCap', 2026));
    // 아시아쿼터 자리(1명)가 찼으니 야마모토는 일반 외국인
    expect(lp('야마모토').foreign).toBe(true);
    expect(lp('야마모토').asia).toBe(false);
    expect(lp('멜빈').asia).toBe(false);
    expect(asiaHeld(t)).toBe(1);
  }, 300_000);

  it('아시아쿼터 도입 전(2025)에는 일본 선수도 일반 외국인', () => {
    const g = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'free-asia-25', fantasy: { free: true } }, FAST);
    g.advance(3);
    const { ops } = resolveOps(g, [{ op: 'create', name: '오타니 쇼헤이', team: g.league.teams[1].name, pos: 'P', role: 'SP', age: 30, now: 80, potential: 80, real: true }], store);
    expect(ops[0]).toMatchObject({ foreign: true, asia: true });
    g.addFantasy({ kind: 'action', title: 't', text: 'x', ops });
    const p = g.league.players.find((x) => x.name.startsWith('오타니'))!;
    expect(p.foreign).toBe(true);
    expect(p.asia).toBe(false);
  }, 300_000);
});
