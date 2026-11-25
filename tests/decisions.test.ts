// 결정함 (2026-10-22 UI 대개편 1차, src/ui/decisions.ts): 이미 있는 처리 대상만 모으고, 없는 일을 만들지 않는다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';
import { decisions } from '../src/ui/decisions';
import { blockOf, MENU } from '../src/ui/menu';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let team: number;

beforeAll(() => {
  store = loadDataStore();
  team = store.season(2026)!.teams.findIndex((t) => t.name === '두산');
}, 120_000);

describe('결정함', () => {
  // 2026-11-25 Q56: 예전에는 개막일에 아무 일도 없었지만(확인 완료) 집중 훈련 0/12를 알린다. 확인으로 내리면 처리할 일이 없다
  it('개막일: 집중 훈련이 비어 있으면 한 줄, 확인하거나 훈련을 걸면 처리할 일이 없다 (확인 완료)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: team, seed: 'inbox-1' }, FAST);
    const d = decisions(g);
    expect(d.map((x) => x.key)).toEqual(['training-empty']);
    expect(d[0].go).toBe('training');
    expect(d[0].title).toContain('0 / 12');
    expect(decisions(g, { 'training-empty': d[0].ack! })).toEqual([]);
    const p = g.league.players.find((x) => x.team === team && !x.isPitcher)!;
    expect(g.setTraining(p.id, { pos: '1B' }).ok).toBe(true);
    expect(decisions(g)).toEqual([]);
  });

  it('외국인 관찰 명단이 차서 기다리는 후보가 있으면 한 줄 (확인하면 같은 후보는 다시 띄우지 않는다)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: team, seed: 'inbox-1' }, FAST);
    const ids = g.league.players.filter((p) => p.team === -1).slice(0, 9).map((p) => p.id);
    const teams = g.league.teams.map(() => ({ out: [], list: [], sent: 0 }));
    teams[team] = { out: [], list: ids.slice(0, 8).map((id) => ({ id, at: 0, weeks: 0 })), sent: 0, wait: { id: ids[8], at: 1, weeks: 0 } } as never;
    g.league.scoutFx = { year: g.world.year, off: false, teams };
    const d = decisions(g).find((x) => x.key === 'fx-wait')!;
    expect(d.go).toBe('scout-fx');
    expect(d.title).toContain(g.leaguePlayer(ids[8])!.name);
    expect(decisions(g, { 'fx-wait': ids[8] }).some((x) => x.key === 'fx-wait')).toBe(false);
  });

  it('이벤트가 걸리면 진행을 막는 일로 맨 앞에 온다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: team, seed: 'inbox-1' }, FAST);
    for (let i = 0; i < 200 && !g.pendingEvent && !g.done; i++) g.advance(1, { event: true });
    if (!g.pendingEvent) return; // 이 시드에서 이벤트가 안 나오면 건너뛴다
    const list = decisions(g);
    expect(list[0].kind).toBe('사건');
    expect(list[0].blocking).toBe(true);
  });

  it('정규시즌 뒤: 가을야구 중에는 가을야구, 끝나면 결산이 할 일로 나오고 메뉴가 열린다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: team, seed: 'inbox-1' }, FAST);
    g.advance(100000, NO_STOPS);
    expect(g.done).toBe(true);
    if (g.postseasonRunning) {
      expect(decisions(g).map((d) => d.key)).toContain('ps');
      expect(blockOf(g, 'postseason')).toBeNull();
      g.advancePostseason(10_000);
    }
    const keys = decisions(g).map((d) => d.key);
    expect(keys).toContain('settle');
    expect(blockOf(g, 'season-end')).toBeNull();
    expect(blockOf(g, 'offseason')).not.toBeNull();
    g.beginOffseason();
    const off = decisions(g);
    // 오프시즌은 단계를 넘겨야 끝나므로 단계 항목이 늘 있다
    expect(off.some((d) => d.key.startsWith('stage:'))).toBe(true);
    // 스프링캠프를 고르기 전에는 한 줄 (Q56), 고르면 빠진다
    expect(off.find((d) => d.key === 'camp')?.go).toBe('offseason');
    expect(g.setCamp({ place: 'home', focus: 'bat' }).ok).toBe(true);
    expect(decisions(g).some((d) => d.key === 'camp')).toBe(false);
    expect(blockOf(g, 'offseason')).toBeNull();
    expect(blockOf(g, 'roster')).not.toBeNull();
  }, 120_000);

  it('메뉴의 모든 화면은 한 칸에만 있다', () => {
    const screens = MENU.flatMap((m) => m.tabs.map((t) => t.screen));
    expect(new Set(screens).size).toBe(screens.length);
  });
});
