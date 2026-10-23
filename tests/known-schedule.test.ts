// 알려진 일정과 일정 소식 (일정 개편 기획안 4.5, 8장 8단계 확인 칸)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { scheduleRule } from '../src/data/schedule';
import { DEFAULT_PARAMS, isNoGame, knownSchedule, Rng } from '../src/engine';
import { planForWorld, type PlanGame, type SchedulePlan } from '../src/engine/schedule';
import { GameSession, type GameSave } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
});

type W = Parameters<typeof planForWorld>[0];
function planOf(y: number, seed: string): SchedulePlan {
  const rule = scheduleRule(store.schedule!, y)!;
  const franchises = store.season(y)?.teams.map((t) => t.franchise) ?? store.season(2026)!.teams.map((t) => t.franchise);
  const world = { year: y, teams: franchises.map((franchise) => ({ franchise })), gamesPerTeam: rule.games, schedule: rule } as unknown as W;
  return planForWorld(world, new Rng(seed));
}

// 순연 규칙 R1(1985·1995)·R2(2008·2012)·R3(2017·2023)·R3c(2020)·R4(2024)·R5(2025·2026)
const YEARS = [1985, 1995, 2008, 2012, 2017, 2020, 2023, 2024, 2025, 2026];
const SEEDS = ['k-a', 'k-b'];
const strip = (g: PlanGame): PlanGame => ({ home: g.home, away: g.away, ...(g.dh ? { dh: g.dh } : {}) });
const has = (d: PlanGame[] | undefined, h: number, a: number) => !!d?.some((g) => g.home === h && g.away === a);

describe('알려진 일정 knownSchedule (8단계)', () => {
  it('지난 날은 실제 일정 그대로, 오늘은 실제 일정에서 비 회만 뺀 것. 앞날에는 비 회가 없고 앞날의 취소는 반영하지 않는다', () => {
    for (const y of YEARS) for (const seed of SEEDS) {
      const p = planOf(y, seed);
      const n = Math.max(...p.days.flat().map((g) => Math.max(g.home, g.away))) + 1;
      for (let day = 0; day <= p.days.length; day++) {
        const k = knownSchedule(p, day);
        const at = `${y}/${seed} ${day}`;
        for (let e = 0; e < Math.min(day, p.days.length); e++) expect(k.days[e], `${at} 지난 날 ${e}`).toEqual(p.days[e]);
        if (day < p.days.length) expect(k.days[day] ?? [], `${at} 오늘`).toEqual(p.days[day].map(strip));
        for (let e = day; e < k.days.length; e++) for (const g of k.days[e]) expect(g.rainInning, `${at} 비 회 ${e}`).toBeUndefined();
        // day 뒤에 취소될 발표 일정 경기는 아직 원래 날에 있다 (순연으로 옮겨 온 경기는 옮긴 취소가 알려진 뒤에만)
        for (const [d, h, a] of p.cancels) if (d > day && has(p.planned[d], h, a)) expect(has(k.days[d], h, a), `${at} 취소 ${d}`).toBe(true);
        // 남은 경기 수 = 알려진 앞날 경기 + 날짜 미정 경기 = 실제 남은 경기 (팀마다). 노게임 경기는 다시 치르는 경기가 따로 있어 세지 않는다
        for (let t = 0; t < n; t++) {
          const mine = (g: PlanGame) => g.home === t || g.away === t;
          const real = p.days.slice(day).reduce((s, d) => s + d.filter((g) => mine(g) && !isNoGame(g.rainInning)).length, 0);
          const known = k.days.slice(day).reduce((s, d) => s + d.filter(mine).length, 0) + k.pending.filter(mine).length;
          expect(known, `${at} 팀 ${t}`).toBe(real);
        }
        if (day >= p.remainingFrom) expect(k.pending, `${at} 발표 뒤 미정 없음`).toEqual([]);
      }
      expect(knownSchedule(p, p.days.length).days).toEqual(p.days);
    }
  });

  it('잔여 경기 발표 전에는 순연 경기와 미편성분이 "추후 편성"이고, 발표 날에 날짜가 생긴다', () => {
    // 2023: 상대별 1경기 미편성 (발표 일정에 없음)
    const p = planOf(2023, 'k-a');
    expect(p.remainingFrom).toBeGreaterThan(0);
    const before = knownSchedule(p, p.remainingFrom - 1);
    expect(before.pending.length).toBeGreaterThan(0);
    expect(before.days.length).toBeLessThan(p.days.length);
    // 개막 날 아침에 알려진 일정 = 발표 일정 (개막 날 취소가 없으면)
    if (!p.cancels.some((c) => c[0] === 0)) expect(knownSchedule(p, 0).days).toEqual(p.planned.map((d) => d.map(strip)));
    const on = knownSchedule(p, p.remainingFrom);
    expect(on.pending).toEqual([]);
    // R1(1985~): 본 일정 마지막 3주 전까지 시즌 끝 잔여 경기로 간 순연은 발표 날까지 미정
    let seen = 0;
    for (const seed of SEEDS) {
      const q = planOf(1995, seed);
      for (const i of q.held) {
        const [d, h, a, to] = q.cancels[i];
        expect(d).toBeLessThan(q.remainingFrom);
        expect(has(knownSchedule(q, d).days[to], h, a)).toBe(false);
        expect(knownSchedule(q, d).pending.some((g) => g.home === h && g.away === a)).toBe(true);
        expect(has(knownSchedule(q, q.remainingFrom).days[to], h, a)).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('Season.knownSchedule은 저장 뒤 불러와도 같다', () => {
    const g = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'known' }, FAST);
    g.advance(60);
    const c = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(c.season.knownSchedule()).toEqual(g.season.knownSchedule());
    expect(c.season.knownSchedule(100)).toEqual(g.season.knownSchedule(100));
  });
});

describe('일정 소식 (8단계)', () => {
  const rainNews = (news: GameSave['news']) => news.filter((n) => /우천|잔여 경기 일정/.test(n.text));

  it('우천 취소·잔여 경기 발표 소식: 같은 시드는 같은 날 같은 문장, 저장 뒤 이어 해도 같다', () => {
    const opts = { year: 2025, teamIdx: 3, seed: 'rain-news' };
    const a = GameSession.create(store, opts, FAST);
    const b = GameSession.create(store, opts, FAST);
    a.advance(1000);
    b.advance(70);
    const c = GameSession.load(store, roundTrip(b.toSave()), FAST);
    c.advance(1000);
    const ra = rainNews(a.news);
    expect(ra.length).toBeGreaterThan(5);
    expect(rainNews(c.news)).toEqual(ra);
    const d = GameSession.create(store, opts, FAST);
    d.advance(1000);
    expect(rainNews(d.news)).toEqual(ra);

    // 소식의 날짜와 내용이 일정과 맞는다
    const p = a.season.plan;
    const ours = p.cancels.filter((x) => !x[4] && (x[1] === 3 || x[2] === 3));
    const mineNews = ra.filter((n) => /경기는 우천으로 취소/.test(n.text));
    expect(mineNews.map((n) => n.day)).toEqual(ours.map((x) => x[0]));
    for (const n of mineNews) expect(n.text).toMatch(/다시 치릅니다|추후 편성/);
    const announce = ra.filter((n) => /잔여 경기 일정이 발표/.test(n.text));
    expect(announce.map((n) => n.day)).toEqual([p.remainingFrom]);
    const left = a.season.plan.days.slice(p.remainingFrom).reduce((s, dd) => s + dd.filter((x) => x.home === 3 || x.away === 3).length, 0);
    // 발표 날 뒤에 생긴 취소는 순연이라 남은 경기 수는 실제와 같다
    expect(announce[0].text).toContain(`우리 팀 남은 경기 ${left}경기`);
  });
});
