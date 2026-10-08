// M3 첫 플레이 버전: 하루 단위 진행, 저장·불러오기, 엔트리 조작, 한 시즌 완주.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, simulateSeason, worldForYear, type World } from '../src/engine';
import { dateOf } from '../src/game/calendar';
import { GameSession, type GameSave } from '../src/game/session';

let store: DataStore;
let world2025: World;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
  world2025 = worldForYear(store, 2025, FAST);
});

describe('하루 단위 진행과 저장 (엔진)', () => {
  it('하루씩 돌린 시즌은 simulateSeason과 결과가 같다', () => {
    const whole = simulateSeason(world2025, FAST, 'day-by-day');
    const s = Season.start(world2025, FAST, 'day-by-day');
    while (!s.done) s.simulateDay();
    expect(s.teams).toEqual(whole.teams);
    expect(s.bat).toEqual(whole.bat);
    expect(s.pit).toEqual(whole.pit);
  });

  it('중간에 여러 번 저장(JSON)하고 다시 열어도 끊지 않고 돌린 결과와 같다', () => {
    const cal = simulateSeason(world2025, { ...FAST, pilotSeasons: 0 }, 'x').cal; // 맞춤 생략으로 빠르게
    const ref = Season.start(world2025, FAST, 'save-test', { cal, boxTeams: [3] });
    ref.runToEnd();

    let s = Season.start(world2025, FAST, 'save-test', { cal, boxTeams: [3] });
    for (const stop of [1, 7, 40, 95, 150]) {
      while (s.day < stop && !s.done) s.simulateDay();
      s = Season.restore(world2025, FAST, roundTrip(s.toSave()));
    }
    s.runToEnd();
    expect(s.teams).toEqual(ref.teams);
    expect(s.bat).toEqual(ref.bat);
    expect(s.pit).toEqual(ref.pit);
    expect(s.totals).toEqual(ref.totals);
    expect(s.log).toEqual(ref.log);
    expect([...s.boxes.entries()]).toEqual([...ref.boxes.entries()]);
  });

  it('박스스코어 기록과 화면용 엔트리 조회는 결과를 바꾸지 않는다', () => {
    const cal = simulateSeason(world2025, { ...FAST, pilotSeasons: 0 }, 'x').cal;
    const plain = Season.start(world2025, FAST, 'side-effects', { cal });
    plain.runToEnd();
    const busy = Season.start(world2025, FAST, 'side-effects', { cal, boxTeams: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
    while (!busy.done) {
      for (let t = 0; t < 10; t++) busy.refresh(t); // 화면이 매일 1군을 조회하는 상황
      busy.simulateDay();
    }
    expect(busy.teams).toEqual(plain.teams);
    expect(busy.bat).toEqual(plain.bat);
    expect(busy.pit).toEqual(plain.pit);
  });

  it('데이터가 다른 월드에는 저장을 불러오지 않는다', () => {
    const s = Season.start(world2025, { ...FAST, pilotSeasons: 0 }, 'fp');
    const save = s.toSave();
    const other = worldForYear(store, 2024, FAST);
    expect(() => Season.restore(other, FAST, save)).toThrow();
    expect(() => Season.restore(world2025, FAST, { ...save, roster: 'bad' })).toThrow(/데이터/);
  });
});

describe('한 시즌 완주 (2026년, 플레이어 구단 LG)', () => {
  let g: GameSession;
  let lg: number;

  beforeAll(() => {
    lg = worldForYear(store, 2026, FAST).teams.findIndex((t) => t.name === 'LG');
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'full-season' }, FAST);
  });

  it('시작하면 1군이 규정 인원이고 플레이어가 관리하는 상태다', () => {
    const reg = g.registered();
    expect(reg.length).toBe(g.world.rules.rosterSize);
    expect(reg.filter((p) => p.foreign).length).toBeLessThanOrEqual(g.world.rules.foreignLimit);
    expect(g.manualEntry).not.toBeNull();
  });

  it('하루·일주일 단위로 진행하고 끝까지 가면 모든 팀이 144경기를 치른다', () => {
    expect(g.advance(1)).toBe(1);
    expect(g.day).toBe(1);
    expect(g.advance(7)).toBe(7);
    expect(g.day).toBe(8);
    let guard = 0;
    while (!g.done && guard++ < 400) g.advance(7);
    expect(g.done).toBe(true);
    for (const t of g.season.teams) expect(t.g).toBe(144);
    expect(g.advance(7)).toBe(0); // 끝난 시즌은 더 진행하지 않는다
    // 정규시즌 종료 알림 뒤에 가을야구 대진 알림이 붙는다 (M7)
    expect(g.news.at(-2)?.text).toMatch(/최종 \d+위/);
    expect(g.news.at(-1)?.text).toMatch(/^가을야구 대진/);
    expect(g.postseasonRunning).toBe(true);
  });

  it('플레이어 구단 경기는 모두 박스스코어가 있고 점수와 맞는다', () => {
    const mine = g.season.log.map((x, i) => [x, i] as const).filter(([x]) => x.home === lg || x.away === lg);
    expect(mine).toHaveLength(144);
    for (const [x, i] of mine) {
      const box = g.season.boxes.get(i)!;
      expect(box).toBeDefined();
      const sum = (a: number[]) => a.filter((v) => v >= 0).reduce((s, v) => s + v, 0);
      expect(sum(box.lineScore.home)).toBe(x.homeRuns);
      expect(sum(box.lineScore.away)).toBe(x.awayRuns);
      expect(box.home.batters.reduce((s, b) => s + b.r, 0)).toBe(x.homeRuns);
      expect(box.away.pitchers.reduce((s, p) => s + p.r, 0)).toBe(x.homeRuns);
      expect(box.home.batters).toHaveLength(9);
    }
  });

  it('알림에 실존 선수의 결장 사유를 적지 않는다', () => {
    const absences = g.news.filter((n) => n.kind === 'absence');
    for (const n of absences) expect(n.text).not.toMatch(/부상|골절|징계|음주|도박|폭행|사생활/);
  });

  it('시즌 일정이 달력 날짜로 3월 말에 시작해 10월 전에 끝난다', () => {
    const first = dateOf(2026, 0);
    const last = dateOf(2026, g.season.schedule.length - 1);
    expect(first.month).toBe(3);
    expect(first.weekday).toBe(2); // 화요일 개막, 월요일 휴식
    expect(last.month).toBeLessThan(10);
  });
});

describe('엔트리 조작', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'entry' }, FAST);
  });

  it('1군 인원 한도를 넘으면 등록되지 않는다', () => {
    const second = g.team.org.find((p) => !g.manualEntry!.has(p.idx))!;
    const before = [...g.manualEntry!];
    const res = g.move(second, true);
    expect(res.errors.join()).toMatch(/최대/);
    expect([...g.manualEntry!]).toEqual(before);
  });

  it('외국인 보유 한도를 넘으면 등록되지 않는다', () => {
    const h = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'foreign' }, FAST);
    const foreign = h.team.org.filter((p) => p.foreign);
    expect(foreign.length).toBeGreaterThanOrEqual(2);
    const entry = new Set(h.registered().map((p) => p.idx));
    const regForeign = h.registered().filter((p) => p.foreign).length;
    h.world.rules = { ...h.world.rules, foreignLimit: regForeign }; // 지금 1군 외국인 수를 한도로 둔다
    const outsider = foreign.find((p) => !entry.has(p.idx));
    const local = h.registered().find((p) => !p.foreign)!;
    // 국내 선수 한 명을 내리고 2군 외국인을 올리거나, 2군 외국인이 없으면 한도를 하나 줄여서 확인
    if (outsider) {
      h.move(local, false);
      expect(h.move(outsider, true).errors.join()).toMatch(/외국인/);
      expect(h.manualEntry!.has(outsider.idx)).toBe(false);
    } else {
      h.world.rules = { ...h.world.rules, foreignLimit: regForeign - 1 };
      expect(h.checkEntry(entry).errors.join()).toMatch(/외국인/);
    }
  });

  it('2군으로 내린 선수는 그 뒤 경기에 나오지 않는다 (임시 승격 제외)', () => {
    const star = [...g.registered()].filter((p) => !p.isPitcher).sort((a, b) => b.value - a.value)[0];
    const res = g.move(star, false);
    expect(res.errors).toHaveLength(0);
    expect(g.manualEntry!.has(star.idx)).toBe(false);
    const paBefore = g.season.bat[star.idx].pa;
    g.advance(20);
    const calledUp = g.news.some((n) => n.kind === 'callup' && n.text.includes(star.name));
    if (!calledUp) expect(g.season.bat[star.idx].pa).toBe(paBefore);
  });

  it('1군 야수가 모자라면 2군에서 임시로 올려 경기를 치른다', () => {
    const h = GameSession.create(store, { year: 2026, teamIdx: 1, seed: 'short' }, FAST);
    const pitchersOnly = h.registered().filter((p) => p.isPitcher).map((p) => p.idx);
    const fiveHitters = h.registered().filter((p) => !p.isPitcher).slice(0, 5).map((p) => p.idx);
    const res = h.setEntry([...pitchersOnly, ...fiveHitters]);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings.join()).toMatch(/야수/);
    h.advanceToNextGameDay();
    expect(h.news.some((n) => n.kind === 'callup')).toBe(true);
    expect(h.season.teams[1].g).toBe(1);
  });

  it('AI에게 맡기면 플레이어 명단이 없어지고 다시 직접 관리로 돌릴 수 있다', () => {
    const h = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'auto' }, FAST);
    h.setEntry(null);
    expect(h.manualEntry).toBeNull();
    h.advance(3);
    expect(h.registered().length).toBeLessThanOrEqual(h.world.rules.rosterSize);
    const p = h.registered()[0];
    expect(h.move(p, false).errors).toHaveLength(0); // 현재 AI 명단에서 한 명을 빼며 직접 관리로
    expect(h.manualEntry).not.toBeNull();
  });
});

describe('게임 저장·불러오기와 재현', () => {
  it('저장(JSON)했다가 불러와 끝까지 돌린 결과가 끊지 않은 게임과 같다', () => {
    const opts = { year: 2026, teamIdx: 4, seed: 'load-test' };
    const a = GameSession.create(store, opts, FAST);
    const b = GameSession.create(store, opts, FAST);
    const mover = (g: GameSession) => g.registered().filter((p) => !p.isPitcher).sort((x, y) => x.value - y.value)[0];
    for (const g of [a, b]) {
      g.advance(10);
      g.move(mover(g), false);
    }
    a.advance(30);
    b.advance(30);
    const saved = roundTrip(b.toSave());
    const c = GameSession.load(store, saved, FAST);
    expect(c.day).toBe(b.day);
    a.advance(1000);
    c.advance(1000);
    expect(c.season.teams).toEqual(a.season.teams);
    expect(c.season.bat).toEqual(a.season.bat);
    expect(c.news).toEqual(a.news);
  });

  it('같은 시드와 조작 기록으로 다시 돌리면 같은 상태가 된다 (버그 재현용)', () => {
    const opts = { year: 2026, teamIdx: 6, seed: 'replay' };
    const g = GameSession.create(store, opts, FAST);
    g.advance(5);
    const sp = g.registered().filter((p) => p.isPitcher)[3];
    g.move(sp, false);
    g.advance(12);
    g.move(sp, true);
    g.advance(4);
    g.setEntry(null);
    g.advance(9);
    const r = GameSession.replay(store, opts, g.actions, g.day, FAST);
    expect(r.day).toBe(g.day);
    const strip = (s: GameSave) => ({ ...s.season });
    expect(strip(r.toSave())).toEqual(strip(g.toSave()));
  });

  it('형식이 다른 파일은 불러오지 않는다', () => {
    expect(() => GameSession.load(store, {} as GameSave, FAST)).toThrow(/저장 파일이 아닙니다/);
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'bad' }, FAST);
    const s = g.toSave();
    expect(() => GameSession.load(store, { ...s, teamName: '없는팀' }, FAST)).toThrow(/구단/);
    expect(() => GameSession.load(store, { ...s, format: 99 as 2 }, FAST)).toThrow(/형식/);
  });
});
