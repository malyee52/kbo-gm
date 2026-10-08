// 시상식 (2026-10-08 사용자 요청): MVP, 신인상, 골든글러브, 타이틀 홀더.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { isRookie, type SeasonAwards } from '../src/league/awards';

let store: DataStore;
let g: GameSession;
let aw: SeasonAwards;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'awards' }, FAST);
  g.advance(100000);
  g.beginOffseason();
  aw = g.league.awards!.at(-1)!;
}, 120_000);

describe('시상식', () => {
  it('결산하면 그 시즌 시상이 남고, 저장했다 불러와도 같다', () => {
    expect(aw.year).toBe(2026);
    expect(aw.mvp).not.toBeNull();
    const b = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())) as GameSaveV2, FAST);
    expect(b.league.awards).toEqual(g.league.awards);
  });

  it('홈런·다승 타이틀은 그 시즌 최다 기록 선수, 타율은 규정타석을 채운 선수 중 1위', () => {
    const s = g.season;
    const W = g.world.players;
    const maxHr = Math.max(...W.map((p) => s.bat[p.idx].hr));
    const hr = aw.titles.find((t) => t.key === 'hr')!;
    for (const w of hr.winners) expect(s.bat[W.find((p) => p.id === w.id)!.idx].hr).toBe(maxHr);
    const maxW = Math.max(...W.map((p) => s.pit[p.idx].w));
    expect(aw.titles.find((t) => t.key === 'w')!.value).toBe(`${maxW}승`);
    const qual = Math.ceil(3.1 * 144);
    const avgW = aw.titles.find((t) => t.key === 'avg')!.winners[0];
    expect(s.bat[W.find((p) => p.id === avgW.id)!.idx].pa).toBeGreaterThanOrEqual(qual);
  });

  it('골든글러브는 10명 (외야 3명), 같은 선수가 두 부문을 받지 않는다', () => {
    expect(aw.goldenGlove).toHaveLength(10);
    expect(aw.goldenGlove.filter((x) => x.pos === 'OF')).toHaveLength(3);
    const ids = aw.goldenGlove.map((x) => x.winner.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('신인 자격: 게임 시작 전 실제 기록도 본다 (2026년 기준 김도영은 신인이 아니다)', () => {
    const kim = g.league.players.find((p) => p.name === '김도영' && !p.isPitcher)!;
    expect(isRookie(kim, 2026, [{ year: 2022, pa: 254, outs: 0 }])).toBe(false);
    if (aw.rookie) {
      expect(aw.rookie.id).not.toBe(kim.id);
      expect(g.league.players.find((p) => p.id === aw.rookie!.id)!.foreign).toBe(false);
    }
  });

  it('우리 구단 수상과 MVP는 알림으로 나온다', () => {
    expect(g.news.some((n) => n.text.startsWith('2026 MVP'))).toBe(true);
  });
});
