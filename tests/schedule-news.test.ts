// 일정 개편 11단계 날짜 연결: 개막 알림의 일정 항목(league/scheduleNews.ts), 올스타 날(규칙 표), 투수 부상 페이스(팀 경기 수)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { daysBetween, scheduleRule } from '../src/data/schedule';
import { DEFAULT_PARAMS } from '../src/engine';
import { pitcherLoadFactor } from '../src/engine/injury';
import type { PitLine, SimPlayer } from '../src/engine/types';
import { GameSession } from '../src/game/session';
import { scheduleNews, scheduleNewsText } from '../src/league/scheduleNews';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

const rule = (y: number) => scheduleRule(store.schedule!, y)!;
const text = (y: number) => scheduleNewsText(y, scheduleNews(rule(y), scheduleRule(store.schedule!, y - 1)));

describe('개막 알림: 올해 달라지는 일정', () => {
  it('1983: 경기 수·연전·올스타 휴식이 바뀌고, 실제 올스타 2경기는 게임에서 1경기로 단순화', () => {
    const lines = scheduleNews(rule(1983), rule(1982));
    expect(lines.map((l) => l.key)).toEqual(['games', 'frame', 'allStarBreak', 'allStarGames']);
    expect(text(1983)).toBe('1983 시즌 일정 (조사값): 정규시즌 경기 수: 팀당 80경기 (상대별 16차전) → 팀당 100경기 (상대별 20차전)'
      + ' / 연전: 수요일 단발(목요일이 열리면 2연전) + 토·일 2연전 → 주중 2·3연전 + 토·일 2연전'
      + ' / 올스타 휴식: 4일 → 5일'
      + ' / 올스타전: 실제 올스타전은 2경기, 게임은 1경기로 단순화.');
  });

  it('2000: 양대 리그 상대별이 단일로, 올스타 2경기 단순화, 시드니 올림픽 중단', () => {
    expect(text(2000)).toBe('2000 시즌 일정 (출처 갈림): 정규시즌 경기 수: 팀당 132경기 (같은 리그 20·다른 리그 18차전) → 팀당 133경기 (상대별 19차전)'
      + ' / 연전: 3연전, 후반기에 2연전 섞음 → 3연전 (화~목 / 금~일)'
      + ' / 올스타 휴식: 3일 → 4일'
      + ' / 올스타전: 실제 올스타전은 2경기, 게임은 1경기로 단순화'
      + ' / 정규시즌 중단: 9월 8일~9월 28일 올림픽.');
  });

  it('2020 올스타 없음·순연 규칙, 2021 중단, 바뀐 것이 없는 해는 줄이 없다', () => {
    const y20 = scheduleNews(rule(2020), rule(2019));
    expect(y20.find((l) => l.key === 'allStarBreak')).toMatchObject({ before: '7일', after: '올스타전 없음' });
    expect(y20.some((l) => l.key === 'postpone')).toBe(true);
    expect(scheduleNews(rule(2021), rule(2020)).find((l) => l.key === 'stop')!.after).toBe('7월 13일~8월 9일 코로나·올림픽');
    expect(scheduleNews(rule(1992), rule(1991))).toEqual([]);
    expect(scheduleNewsText(1992, [])).toBeNull();
    // 2027~는 2026 모양 (임시값)
    expect(scheduleNews(rule(2027), rule(2026)).every((l) => l.status === '2026 모양 (임시값)')).toBe(true);
    // 첫 해(1982)는 지난해가 없어 모두 보인다
    expect(scheduleNews(rule(1982)).map((l) => l.key)).toEqual(['games', 'frame', 'allStarBreak', 'postpone', 'allStarGames']);
  });

  it('새 게임 개막 소식에 그 해 일정 알림이 한 줄 붙는다', () => {
    const g = GameSession.create(store, { year: 1983, teamIdx: 0, seed: 'sn-1983' }, FAST);
    expect(g.news.filter((n) => n.text === text(1983))).toHaveLength(1);
  }, 120_000);
});

describe('올스타 날은 규칙 표에서', () => {
  it('2026은 규칙 표의 날(7월 11일), 2020·2021은 없음', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'sn-as' }, FAST);
    expect(g.allStarDay).toBe(daysBetween(rule(2026).opening, '2026-07-11'));
    expect(g.season.schedule[g.allStarDay]).toHaveLength(0);
    for (const y of [2020, 2021]) expect(GameSession.create(store, { year: y, teamIdx: 0, seed: `sn-as-${y}` }, FAST).allStarDay).toBe(-1);
  }, 180_000);
});

describe('투수 부상 페이스는 팀 경기 수 기준', () => {
  it('같은 이닝·같은 경기 수면 같은 배율, 경기를 덜 치렀으면 페이스가 높다', () => {
    const p = { isPitcher: true, age: 29, pit: { startShare: 1 } } as unknown as SimPlayer;
    const line = { outs: 100 * 3 } as PitLine;
    // 72경기에 100이닝 = 144경기 페이스 (144 / 85) × 100 ≈ 169이닝 > 160
    expect(pitcherLoadFactor(p, line, 72, 144)).toBeCloseTo(1 + ((100 * 144) / 85 - 160) / 80, 10);
    expect(pitcherLoadFactor(p, line, 60, 144)).toBeGreaterThan(pitcherLoadFactor(p, line, 72, 144));
    expect(pitcherLoadFactor(p, { outs: 30 } as PitLine, 72, 144)).toBe(1);
  });
});

describe('월간 MVP: 경기일이 적은 달은 다음 달과 합친다', () => {
  it('2026 (3월 28일 개막): 3월 기사 없이 "3·4월 MVP"', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'sn-month' }, FAST);
    g.advance(daysBetween(rule(2026).opening, '2026-05-02'));
    const titles = (g.league.articles ?? []).filter((a) => a.kind === 'monthly').map((a) => a.title);
    expect(titles.some((t) => t.startsWith('3월'))).toBe(false);
    expect(titles.filter((t) => t.startsWith('3·4월 MVP'))).toHaveLength(1);
  }, 180_000);
});
