// 경기 중 비: 강우 콜드·노게임 (일정 개편 기획안 4.7, 8장 10단계 확인 칸):
// 노게임 경기가 순위·개인 기록에 없음, 피로 남음, 다시 편성된 경기 있음. 콜드 경기 이닝 = rainInning. 동점 콜드 = 무승부.
// 노게임 날 저장 → 이어 하기 = 끊김 없이, 같은 시드 같은 결과, 소식·직접 지휘 미리보기
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, isNoGame, Season, simulateSeason, worldForYear, type World } from '../src/engine';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';
import type { Rates } from '../src/data/types';

let store: DataStore;
let world: World;
let cal: Rates;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const YEAR = 2024;

beforeAll(() => {
  store = loadDataStore();
  world = worldForYear(store, YEAR, FAST);
  cal = simulateSeason(world, { ...FAST, pilotSeasons: 0 }, 'x').cal; // 맞춤 생략으로 빠르게
}, 120_000);

/** 경기 중 비가 있는 날 */
const rainDays = (s: Season, pick: (r: number) => boolean) => s.schedule.flatMap((d, i) => (d.some((g) => g.rainInning && pick(g.rainInning)) ? [i] : []));

describe('강우 콜드·노게임 (10단계)', () => {
  it('노게임은 순위·개인 기록·경기 기록에 없고 피로는 남으며 다시 치르는 경기가 있다. 콜드는 그 회까지, 동점 콜드는 무승부', () => {
    const teams = world.teams.map((t) => t.idx);
    let noGames = 0;
    let colds = 0;
    let coldTies = 0;
    let solo = 0;
    for (const seed of ['rain-a', 'rain-b', 'rain-c', 'rain-d']) {
      const s = Season.start(world, FAST, seed, { cal, boxTeams: teams });
      const ng = new Set(rainDays(s, isNoGame));
      const cold = new Set(rainDays(s, (r) => !isNoGame(r)));
      expect(ng.size + cold.size, seed).toBeGreaterThan(5);
      while (!s.done) {
        const day = s.day;
        if (!ng.has(day) && !cold.has(day)) { s.simulateDay(); continue; }
        const games = s.schedule[day];
        const before = { teams: s.teams.map((t) => ({ ...t })), bat: s.bat.map((l) => ({ ...l })), pit: s.pit.map((l) => ({ ...l })) };
        const from = s.log.length;
        const ngFrom = s.noGames.length;
        s.simulateDay();
        const logs = s.log.slice(from);
        expect(logs.length, `${seed} ${day}`).toBe(games.filter((g) => !isNoGame(g.rainInning)).length);
        for (const g of games) {
          const same = (l: { home: number; away: number; dh?: 1 | 2 }) => l.home === g.home && l.away === g.away && l.dh === g.dh;
          if (isNoGame(g.rainInning)) {
            noGames++;
            expect(logs.some(same), `${seed} ${day} 노게임 기록`).toBe(false);
            const n = s.noGames.slice(ngFrom).find(same)!;
            expect(n.innings).toBe(g.rainInning);
            // 다시 치르는 경기: 일정의 cancels에 노게임 표시와 옮긴 날, 그날 같은 대진이 있거나 또 취소됐다
            const c = s.plan.cancels.find((x) => x[4] && x[0] === day && x[1] === g.home && x[2] === g.away)!;
            expect(c, `${seed} ${day} 다시 편성`).toBeDefined();
            expect(c[3]).toBeGreaterThan(day);
            expect(s.plan.days[c[3]].some((x) => x.home === g.home && x.away === g.away) || s.plan.cancels.some((x) => x[0] === c[3] && x[1] === g.home && x[2] === g.away)).toBe(true);
            // 그날 이 경기만 치른 두 팀: 순위·개인 기록은 그대로, 선발 투수 피로·선발일은 남는다
            const only = (t: number) => games.filter((x) => x.home === t || x.away === t).length === 1;
            if (!only(g.home) || !only(g.away)) continue;
            solo++;
            for (const t of [g.home, g.away]) {
              expect(s.teams[t], `${seed} ${day} 순위 ${t}`).toEqual(before.teams[t]);
              const org = world.teams[t].org.map((p) => p.idx);
              for (const i of org) {
                expect(s.bat[i], `${seed} ${day} 타격 ${i}`).toEqual(before.bat[i]);
                expect(s.pit[i], `${seed} ${day} 투구 ${i}`).toEqual(before.pit[i]);
              }
              const starters = org.filter((i) => s.states.lastStartDay[i] === day);
              expect(starters.length, `${seed} ${day} 선발 ${t}`).toBe(1);
              expect(s.states.fatigueDay[starters[0]]).toBe(day);
              expect(s.states.fatigue[starters[0]]).toBeGreaterThan(0);
            }
          } else if (g.rainInning) {
            colds++;
            const l = logs.find(same)!;
            expect(l.rain).toBe('cold');
            expect(l.innings).toBe(g.rainInning);
            const box = s.boxes.get(s.log.indexOf(l))!;
            expect(box.lineScore.away.length).toBe(g.rainInning);
            expect(box.lineScore.home.length).toBe(g.rainInning);
            expect(box.lineScore.home.every((r) => r >= 0)).toBe(true);
            if (l.homeRuns === l.awayRuns) {
              coldTies++;
              expect(l.win).toBeNull();
              expect(s.teams[g.home].t).toBe(before.teams[g.home].t + 1);
              expect(s.teams[g.away].t).toBe(before.teams[g.away].t + 1);
            }
          }
        }
      }
      // 노게임을 다시 치러 모든 팀이 정해진 경기 수를 채운다
      for (const t of s.teams) expect(t.g, `${seed} 팀 경기 수`).toBe(world.gamesPerTeam);
      expect(s.log.length).toBe((world.gamesPerTeam * world.teams.length) / 2);
    }
    expect(noGames).toBeGreaterThan(4);
    expect(solo).toBeGreaterThan(2);
    expect(colds).toBeGreaterThan(4);
    expect(coldTies).toBeGreaterThan(0);
  }, 300_000);

  it('노게임·콜드 날 앞뒤로 저장(JSON)했다가 이어 돌려도 끊김 없이 돌린 결과와 같고, 같은 시드는 같은 결과', () => {
    const ref = Season.start(world, FAST, 'rain-save', { cal, boxTeams: [0] });
    const stops = [...rainDays(ref, isNoGame).slice(0, 3), ...rainDays(ref, (r) => !isNoGame(r)).slice(0, 2)].sort((a, b) => a - b).flatMap((d) => [d, d + 1]);
    expect(stops.length).toBeGreaterThan(6);
    ref.runToEnd();
    const again = Season.start(world, FAST, 'rain-save', { cal, boxTeams: [0] });
    again.runToEnd();
    expect(again.log).toEqual(ref.log);

    let s = Season.start(world, FAST, 'rain-save', { cal, boxTeams: [0] });
    for (const stop of stops) {
      while (s.day < stop && !s.done) s.simulateDay();
      s = Season.restore(world, FAST, roundTrip(s.toSave()));
    }
    s.runToEnd();
    expect(s.log).toEqual(ref.log);
    expect(s.teams).toEqual(ref.teams);
    expect(s.bat).toEqual(ref.bat);
    expect(s.pit).toEqual(ref.pit);
    expect(s.totals).toEqual(ref.totals);
  }, 240_000);
});

describe('경기 중 비 소식과 직접 지휘 (10단계)', () => {
  const rainNews = (news: { day: number; text: string }[]) => news.filter((n) => /강우 콜드|노게임/.test(n.text));

  it('콜드·노게임 소식: 같은 시드는 같은 날 같은 문장, 저장 뒤 이어 해도 같다. 우리 경기는 한 줄씩', () => {
    const opts = { year: 2025, teamIdx: 3, seed: 'rain-news' };
    const a = GameSession.create(store, opts, FAST);
    const b = GameSession.create(store, opts, FAST);
    a.advance(1000, NO_STOPS);
    b.advance(70, NO_STOPS);
    const c = GameSession.load(store, roundTrip(b.toSave()), FAST);
    c.advance(1000, NO_STOPS);
    const ra = rainNews(a.news);
    expect(ra.length).toBeGreaterThan(3);
    expect(rainNews(c.news)).toEqual(ra);
    const p = a.season.plan;
    const ours = p.days.flatMap((d, i) => d.filter((g) => g.rainInning && (g.home === 3 || g.away === 3)).map((g) => ({ day: i, g })));
    const mine = ra.filter((n) => /경기는 \d회 (강우 콜드로|노게임)/.test(n.text));
    expect(mine.map((n) => n.day)).toEqual(ours.map((x) => x.day));
    for (const [k, n] of mine.entries()) {
      const g = ours[k].g;
      expect(n.text).toContain(`${g.rainInning}회 ${isNoGame(g.rainInning) ? '노게임' : '강우 콜드'}`);
      if (isNoGame(g.rainInning)) expect(n.text).toMatch(/다시 치릅니다|추후 편성/);
    }
  }, 300_000);

  it('직접 지휘 중 비가 오면 그 회를 마치고 멈추고, 미리보기에 강우 콜드·노게임이 보인다', () => {
    const seen = new Set<string>();
    for (const seed of ['rain-cmd-a', 'rain-cmd-b', 'rain-cmd-c']) {
      for (let team = 0; team < 10 && seen.size < 2; team++) {
        const probe = GameSession.create(store, { year: 2025, teamIdx: team, seed }, FAST);
        const day = probe.season.plan.days.findIndex((d) => d.some((g) => g.rainInning && (g.home === team || g.away === team) && !g.dh));
        if (day < 0) continue;
        const kind = isNoGame(probe.season.plan.days[day].find((g) => g.home === team || g.away === team)!.rainInning) ? 'nogame' : 'cold';
        if (seen.has(kind)) continue;
        probe.advance(day, NO_STOPS);
        if (probe.day !== day) continue;
        if (probe.pendingEvent) probe.answerEvent(0);
        if (!probe.canCommand) continue;
        const g = probe.season.plan.days[day].find((x) => x.home === team || x.away === team)!;
        const pv = probe.commandPreview([], 'auto');
        expect(pv.req).toBeNull();
        expect(pv.rain).toEqual({ kind, inning: g.rainInning });
        // 중계도 그 회까지만
        expect(Math.max(...pv.plays.map((x) => x.inn))).toBe(g.rainInning);
        const from = probe.season.log.length;
        expect(probe.commitCommand(pv.choices).ok).toBe(true);
        const mineLog = probe.season.log.slice(from).find((l) => l.home === team || l.away === team);
        if (kind === 'nogame') expect(mineLog).toBeUndefined();
        else expect({ away: mineLog!.awayRuns, home: mineLog!.homeRuns }).toEqual(pv.final);
        seen.add(kind);
      }
    }
    expect([...seen].sort()).toEqual(['cold', 'nogame']);
  }, 300_000);
});
