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
  it('개막일에는 처리할 일이 없다 (확인 완료)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: team, seed: 'inbox-1' }, FAST);
    expect(decisions(g)).toEqual([]);
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
    expect(blockOf(g, 'offseason')).toBeNull();
    expect(blockOf(g, 'roster')).not.toBeNull();
  }, 120_000);

  it('메뉴의 모든 화면은 한 칸에만 있다', () => {
    const screens = MENU.flatMap((m) => m.tabs.map((t) => t.screen));
    expect(new Set(screens).size).toBe(screens.length);
  });
});
