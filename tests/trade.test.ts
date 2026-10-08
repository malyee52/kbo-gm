// M4 트레이드: 악용 시나리오(docs/trade-exploits.md)와 트레이드 뒤 상태.
import { beforeAll, describe, expect, it } from 'vitest';
import { currentRuns } from '../src/ai/value';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type SimPlayer } from '../src/engine';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function newGame(seed = 'trade') {
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  return GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
}
const teamIdx = (g: GameSession, name: string) => g.world.teams.findIndex((t) => t.name === name);
const nowRuns = (g: GameSession) => (p: SimPlayer) => currentRuns(p, g.values);
/** 국내 선수를 지금 기여 순으로 (외국인은 트레이드할 수 없어 시나리오에서 뺀다) */
const byNow = (g: GameSession, ps: SimPlayer[]) => ps.filter((p) => !p.foreign).sort((a, b) => nowRuns(g)(b) - nowRuns(g)(a) || a.idx - b.idx);
/**
 * 주축: 30세 이하 국내 선수 중 지금 기여 순. 외국인 스타가 빠진 뒤 그냥 1위를 고르면 30대 후반 고액 포수가 뽑혀
 * "주축을 준다"는 시나리오 뜻과 달라진다 (AI가 나이·연봉을 보고 낮게 치는 것은 맞는 판단).
 */
const prime = (g: GameSession, ps: SimPlayer[]) => byNow(g, ps.filter((p) => (p.age ?? 99) <= 30));

beforeAll(() => {
  store = loadDataStore();
});

describe('악용 시나리오: AI가 손해 보는 거래를 거절한다', () => {
  it('E1 유망주 헐값 영입: 노장 저평가 선수로 상대의 젊은 주축을 달라고 하면 거절', () => {
    const g = newGame();
    const mine = g.team.org.filter((p) => (p.age ?? 0) >= 31);
    const cheap = byNow(g, mine).at(-1)!;
    let tested = 0;
    for (const t of g.world.teams) {
      if (t.idx === g.teamIdx) continue;
      const young = byNow(g, t.org.filter((p) => (p.age ?? 99) <= 23))[0];
      if (!young || nowRuns(g)(young) < 15) continue;
      const ev = g.evaluateTrade(t.idx, [cheap], [young]);
      expect(ev.verdict, `${t.name} ${young.name} (${g.tendency(t.idx)})`).toBe('reject-value');
      tested++;
    }
    expect(tested).toBeGreaterThanOrEqual(3);
  });

  it('E2 노장 떠넘기기: 대체 수준 노장을 공짜로 주거나, 둘로 젊은 백업을 달라고 하면 거절', () => {
    const g = newGame();
    const oldies = g.team.org.filter((p) => (p.age ?? 0) >= 33 && !p.foreign).sort((a, b) => nowRuns(g)(a) - nowRuns(g)(b)).slice(0, 2);
    expect(oldies.length).toBe(2);
    for (const t of g.world.teams) {
      if (t.idx === g.teamIdx) continue;
      expect(g.evaluateTrade(t.idx, oldies, []).verdict, `${t.name} 공짜`).toBe('reject-value');
      const backup = byNow(g, t.org.filter((p) => (p.age ?? 99) <= 25))[3];
      if (backup) expect(g.evaluateTrade(t.idx, oldies, [backup]).verdict, `${t.name} ${backup.name}`).toBe('reject-value');
    }
  });

  it('E3 다대일 묶음: 백업급 4명으로 상대 최고 선수를 달라고 하면 거절 (선수 가치 합은 더 커도)', () => {
    const g = newGame();
    // 주전이 아닌(서브) 야수 중 기여가 큰 4명. 투수를 섞으면 상대의 약한 불펜을 채우는 정당한 거래가 될 수 있다
    // (2026-10-08: 롯데가 구원 3명 + 야수 1명을 받고 2루 여유 자원 고승민을 내주는 것을 받아들임. 전력 +17런으로 타당한 판단)
    const bench = byNow(g, g.team.org.filter((p) => !p.isPitcher && g.slotOf(p) === null && nowRuns(g)(p) > 0)).slice(0, 4);
    expect(bench).toHaveLength(4);
    let sumBeatsStar = 0;
    for (const t of g.world.teams) {
      if (t.idx === g.teamIdx) continue;
      const star = prime(g, t.org)[0];
      // 이번 시즌 기여의 단순 합 (주전 자리가 9개뿐이라 전력에는 그대로 더해지지 않는다)
      if (bench.reduce((s, p) => s + Math.max(0, nowRuns(g)(p)), 0) > nowRuns(g)(star)) sumBeatsStar++;
      expect(g.evaluateTrade(t.idx, bench, [star]).verdict, `${t.name} ${star.name}`).not.toBe('accept');
    }
    // 단순 합으로는 넘는 경우가 있어야 이 시나리오가 의미가 있다
    expect(sumBeatsStar).toBeGreaterThan(0);
  });

  it('E4 왕복 되팔기: 성사된 트레이드를 곧바로 거꾸로 제안하면 거절', () => {
    const g = newGame();
    const other = teamIdx(g, '롯데');
    const myStar = prime(g, g.team.org)[0];
    const theirs = byNow(g, g.world.teams[other].org)[6];
    const ev = g.proposeTrade(other, [myStar], [theirs]);
    expect(ev.verdict).toBe('accept');
    const back = g.evaluateTrade(other, [theirs], [myStar]);
    expect(back.verdict).toBe('reject-value');
  });

  it('E5 포지션 싹쓸이: 상대 포수를 1명만 남기고 다 달라고 하면 인원 사유로 거절', () => {
    const g = newGame();
    for (const t of g.world.teams) {
      if (t.idx === g.teamIdx) continue;
      const cs = t.org.filter((p) => p.pos === 'C');
      const want = cs.slice(0, Math.min(4, cs.length - 1));
      if (cs.length - want.length >= 2) continue; // 4명을 데려와도 2명 넘게 남는 구단은 건너뜀
      const star = prime(g, g.team.org.filter((p) => p.pos !== 'C'))[0];
      expect(g.evaluateTrade(t.idx, [star], want).verdict, t.name).toBe('reject-roster');
    }
  });

  it('E6 마감 뒤 거래: 트레이드 마감 다음 날부터는 받지 않는다', () => {
    const g = newGame('deadline');
    const other = teamIdx(g, '두산');
    const myStar = prime(g, g.team.org)[0];
    const theirs = byNow(g, g.world.teams[other].org)[10];
    g.advance(g.tradeDeadlineDay);
    expect(g.tradeOpen).toBe(true);
    expect(g.evaluateTrade(other, [myStar], [theirs]).verdict).toBe('accept');
    g.advance(1);
    expect(g.tradeOpen).toBe(false);
    const ev = g.proposeTrade(other, [myStar], [theirs]);
    expect(ev.verdict).toBe('reject-invalid');
    expect(ev.message).toMatch(/마감/);
    expect(myStar.teamIdx).toBe(g.teamIdx);
  });

  it('E7 같은 제안 반복: 평가는 같은 답을 내고 선수단을 바꾸지 않는다', () => {
    const g = newGame();
    const other = teamIdx(g, 'KT');
    const give = byNow(g, g.team.org).slice(5, 7);
    const get = byNow(g, g.world.teams[other].org).slice(0, 1);
    const orgBefore = g.world.teams[other].org.map((p) => p.idx);
    const a = g.evaluateTrade(other, give, get);
    const b = g.evaluateTrade(other, give, get);
    expect(b).toEqual(a);
    expect(g.world.teams[other].org.map((p) => p.idx)).toEqual(orgBefore);
  });

  it('잘못된 제안은 받지 않는다: 남의 선수 끼워 넣기, 같은 선수 두 번, 인원 초과', () => {
    const g = newGame();
    const kt = teamIdx(g, 'KT');
    const ssg = teamIdx(g, 'SSG');
    const ktP = byNow(g, g.world.teams[kt].org)[0];
    const ssgP = byNow(g, g.world.teams[ssg].org)[0];
    const mine = byNow(g, g.team.org);
    expect(g.evaluateTrade(kt, [ssgP], [ktP]).verdict).toBe('reject-invalid');
    expect(g.evaluateTrade(kt, [mine[0]], [ssgP]).verdict).toBe('reject-invalid');
    expect(g.evaluateTrade(kt, [mine[0], mine[0]], [ktP]).verdict).toBe('reject-invalid');
    expect(g.evaluateTrade(kt, mine.slice(0, 5), [ktP]).verdict).toBe('reject-invalid');
    expect(g.evaluateTrade(g.teamIdx, [mine[0]], [mine[1]]).verdict).toBe('reject-invalid');
  });

  it('E8 외국인 트레이드: 외국인 선수를 주거나 받는 제안은 규정 위반으로 거절하고, 요구안에도 넣지 않는다', () => {
    const g = newGame();
    const kt = teamIdx(g, 'KT');
    const myForeign = g.team.org.find((p) => p.foreign)!;
    const theirForeign = g.world.teams[kt].org.find((p) => p.foreign)!;
    const theirs = byNow(g, g.world.teams[kt].org)[8];
    const mine = byNow(g, g.team.org);
    // 아무리 후한 조건이라도 거절
    expect(g.evaluateTrade(kt, [myForeign, mine[0]], [theirs]).verdict).toBe('reject-invalid');
    expect(g.evaluateTrade(kt, mine.slice(0, 3), [theirForeign]).verdict).toBe('reject-invalid');
    expect(g.askPackage(kt, [theirForeign])).toBeNull();
    const pkg = g.askPackage(kt, [theirs]);
    if (pkg) expect(pkg.some((p) => p.foreign)).toBe(false);
  });
});

describe('AI가 받아들일 거래는 받아들인다', () => {
  it('S1 플레이어가 손해 보는 거래(주축을 주고 백업을 받음)는 수락', () => {
    const g = newGame();
    const myStar = prime(g, g.team.org)[0];
    let accepted = 0;
    for (const t of g.world.teams) {
      if (t.idx === g.teamIdx) continue;
      const backup = byNow(g, t.org)[12];
      if (g.evaluateTrade(t.idx, [myStar], [backup]).verdict === 'accept') accepted++;
    }
    expect(accepted).toBeGreaterThanOrEqual(8);
  });

  it('S2 요구안을 그대로 제안하면 수락되고, 선수 소속이 바뀐다', () => {
    const g = newGame();
    const other = teamIdx(g, 'NC');
    const want = byNow(g, g.world.teams[other].org)[2];
    const pkg = g.askPackage(other, [want]);
    expect(pkg).not.toBeNull();
    const ev = g.proposeTrade(other, pkg!, [want]);
    expect(ev.verdict).toBe('accept');
    expect(want.teamIdx).toBe(g.teamIdx);
    for (const p of pkg!) expect(p.teamIdx).toBe(other);
    expect(g.trades).toHaveLength(1);
    expect(g.news.at(-1)?.kind).toBe('trade');
  });
});

describe('트레이드 뒤 상태', () => {
  it('받은 선수는 2군, 내준 선수는 1군 명단에서 빠지고 양 구단 엔트리가 규정을 지킨다', () => {
    const g = newGame();
    const other = teamIdx(g, '한화');
    // 1군 주축 한 명을 주고 상대가 받아들이는 선수를 받는다 (수락 여부가 아니라 트레이드 뒤 상태를 보는 시험)
    let give: SimPlayer | undefined;
    let get: SimPlayer | undefined;
    search: for (const x of prime(g, g.registered()).slice(0, 5)) {
      for (const y of byNow(g, g.world.teams[other].org).slice(3, 20)) {
        if (g.evaluateTrade(other, [x], [y]).verdict === 'accept') {
          give = x;
          get = y;
          break search;
        }
      }
    }
    if (!give || !get) throw new Error('성사되는 트레이드를 찾지 못했습니다');
    expect(g.proposeTrade(other, [give], [get]).verdict).toBe('accept');
    expect(g.manualEntry!.has(give.idx)).toBe(false);
    expect(g.manualEntry!.has(get.idx)).toBe(false);
    expect(g.team.org.includes(get)).toBe(true);
    expect(g.world.teams[other].org.includes(give)).toBe(true);
    g.advance(7);
    const ai = g.season.refresh(other);
    const active = [...ai.hitters, ...ai.rotation, ...ai.bullpen];
    expect(active.length).toBeLessThanOrEqual(g.world.rules.rosterSize);
    expect(active.filter((p) => p.foreign).length).toBeLessThanOrEqual(g.world.rules.foreignLimit);
  });

  it('트레이드한 게임을 저장했다 불러와 끝까지 돌리면 끊지 않은 게임과 같다', () => {
    const run = (save: boolean) => {
      const g = newGame('trade-save');
      const other = teamIdx(g, 'SSG');
      g.advance(15);
      g.proposeTrade(other, [byNow(g, g.team.org)[0]], [byNow(g, g.world.teams[other].org)[4]]);
      g.advance(20);
      const h = save ? GameSession.load(store, roundTrip(g.toSave()), FAST) : g;
      h.advance(1000);
      return h;
    };
    const a = run(false);
    const b = run(true);
    expect(b.trades).toEqual(a.trades);
    expect(b.season.teams).toEqual(a.season.teams);
    expect(b.season.bat).toEqual(a.season.bat);
    expect(b.world.teams.map((t) => t.org.map((p) => p.idx).sort((x, y) => x - y)))
      .toEqual(a.world.teams.map((t) => t.org.map((p) => p.idx).sort((x, y) => x - y)));
  });

  it('조작 기록으로 다시 돌리면 트레이드까지 같은 상태가 된다', () => {
    const g = newGame('trade-replay');
    const kia = teamIdx(g, 'KIA');
    g.advance(9);
    g.proposeTrade(kia, [byNow(g, g.team.org)[1]], [byNow(g, g.world.teams[kia].org)[5]]);
    g.advance(11);
    const r = GameSession.replay(store, { year: 2026, teamIdx: g.teamIdx, seed: 'trade-replay' }, g.actions, g.day, FAST);
    expect(r.toSave().season).toEqual(g.toSave().season);
  });
});
