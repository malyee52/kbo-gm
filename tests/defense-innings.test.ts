// 능력치 v2 16-3b: 경기마다 자리별 수비 이닝 (12.9·15.2) — 엔진이 세고(Season.defOuts), 저장에 담고, 결산 때 이력(SeasonLine.def)에 남긴다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, simulateSeason, worldForYear, type World } from '../src/engine';
import { FIELD_POS } from '../src/engine/defense';
import { fieldYears, gameFieldYear, refreshPlayable } from '../src/engine/fielding';
import { GameSession } from '../src/game/session';

let store: DataStore;
let w: World;
let s: Season;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
  w = worldForYear(store, 2025, FAST);
  s = Season.start(w, FAST, 'def-innings');
  s.runToEnd();
}, 120_000);

describe('자리별 수비 이닝 (엔진)', () => {
  it('구단마다 자리별 수비 아웃 합이 그 구단 투수가 잡은 아웃과 같다 (지명타자 리그: 아웃마다 여덟 자리 모두 한 명)', () => {
    for (const t of w.teams) {
      const outs = t.org.filter((p) => p.isPitcher).reduce((a, p) => a + s.pit[p.idx].outs, 0);
      expect(outs).toBeGreaterThan(0);
      FIELD_POS.forEach((_, k) => {
        const sum = t.org.reduce((a, p) => a + s.defOuts[p.idx * 8 + k], 0);
        expect(sum, `${t.name} ${FIELD_POS[k]}`).toBe(outs);
      });
    }
  });

  it('투수는 수비 이닝이 없고, 주전 포수는 C 이닝이 가장 많다', () => {
    for (const p of w.players.filter((q) => q.isPitcher)) expect(s.defOuts.subarray(p.idx * 8, p.idx * 8 + 8).every((v) => v === 0)).toBe(true);
    const c = w.players.filter((p) => !p.isPitcher).sort((a, b) => s.defOuts[b.idx * 8] - s.defOuts[a.idx * 8])[0];
    expect(s.defOuts[c.idx * 8] / 3).toBeGreaterThan(700);
    expect(c.bat!.playable).toContain('C');
  });

  it('중간에 저장(JSON)하고 다시 열어도 끊지 않고 센 수비 이닝과 같다', () => {
    const cal = simulateSeason(w, { ...FAST, pilotSeasons: 0 }, 'x').cal;
    const ref = Season.start(w, FAST, 'def-save', { cal });
    ref.runToEnd();
    let t = Season.start(w, FAST, 'def-save', { cal });
    for (const stop of [5, 60, 130]) {
      while (t.day < stop && !t.done) t.simulateDay();
      t = Season.restore(w, FAST, roundTrip(t.toSave()));
    }
    t.runToEnd();
    expect(Array.from(t.defOuts)).toEqual(Array.from(ref.defOuts));
    expect(t.bat).toEqual(ref.bat);
  }, 120_000);
});

describe('결산 때 이력에 남긴다 (2026 시작)', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'def-innings' }, FAST);
    g.advance(100000);
    g.beginOffseason();
  }, 180_000);

  it('그 해 이력 줄의 def는 반올림한 1군 자리별 이닝이고, 구단·자리 합은 구단 수비 이닝과 거의 같다', () => {
    const lines = g.league.players.flatMap((p) => p.history.filter((h) => h.year === 2026 && h.def).map((h) => ({ p, h })));
    expect(lines.length).toBeGreaterThan(150);
    for (const { h } of lines) {
      expect(h.def).toHaveLength(8);
      expect(h.def!.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    }
    // 자리마다 리그 합 = 정규시즌 아웃 ÷ 3 (반올림 오차와, 시장에 남아 리그에서 지워진 선수 몫만큼 모자랄 수 있다)
    const inn = g.season.totals.outs / 3;
    FIELD_POS.forEach((q, k) => {
      const sum = lines.reduce((a, { h }) => a + h.def![k], 0);
      expect(sum / inn, q).toBeGreaterThan(0.97);
      expect(sum / inn, q).toBeLessThan(1.01);
    });
  });

  it('2군 수비 이닝(fdef, 15.2): 본 자리로 나가고, 구단·자리 합이 2군 경기 × 9(+반올림)를 넘지 않는다', () => {
    const lines = g.league.players.flatMap((p) => p.history.filter((h) => h.year === 2026 && h.fdef).map((h) => ({ p, h })));
    expect(lines.length).toBeGreaterThan(100);
    const games = new Map(g.league.lastFutures!.teams.map((t) => [g.league.teams[t.team]?.name, t.g]));
    const sum = new Map<string, { inn: number; n: number }>();
    for (const { h } of lines) {
      expect(h.fdef!.filter((v) => v > 0)).toHaveLength(1);
      h.fdef!.forEach((v, k) => {
        if (!v) return;
        const key = `${h.team}/${k}`;
        const a = sum.get(key) ?? sum.set(key, { inn: 0, n: 0 }).get(key)!;
        a.inn += v; a.n++;
      });
    }
    for (const [key, a] of sum) expect(a.inn, key).toBeLessThanOrEqual((games.get(key.split('/')[0]) ?? 0) * 9 + a.n);
  });

  it('결산 뒤 수비 가능: 그 해 포수 아닌 자리를 450이닝 넘게 맡은 야수는 그 자리가 수비 가능이다 (16-3b, 등급은 그대로)', () => {
    let n = 0;
    for (const p of g.league.players) {
      const h = p.history.find((x) => x.year === 2026 && x.def);
      if (!h || !p.bat?.playable) continue;
      FIELD_POS.forEach((q, k) => {
        if (q === 'C' || h.def![k] < 450) return;
        n++;
        expect(p.bat!.playable, `${p.name} ${q} ${h.def![k]}이닝`).toContain(q);
      });
    }
    expect(n).toBeGreaterThan(60);
  });
});

describe('수비 가능 다시 보기 (refreshPlayable, 16-3b)', () => {
  it('3루수가 게임 안에서 유격수를 한 시즌 150이닝 맡으면 다음 해 SS 수비 가능 (3B → SS는 100이닝에 다 참, 15.3)', () => {
    const years = [2023, 2024, 2025].map((y) => gameFieldYear(y, [0, 0, 0, 1100, 0, 0, 0, 0], undefined, 560));
    expect(refreshPlayable(years, 2026, '3B').playable).not.toContain('SS');
    const more = [...years, gameFieldYear(2026, [0, 0, 0, 950, 150, 0, 0, 0], undefined, 560)];
    expect(refreshPlayable(more, 2027, '3B').playable).toContain('SS');
  });

  it('퓨처스 이닝(fdef)도 같은 무게로 센다 (15.3 W_F 1.0)', () => {
    const years = [2023, 2024, 2025].map((y) => gameFieldYear(y, [0, 0, 0, 1100, 0, 0, 0, 0], undefined, 560));
    const fut = [...years, gameFieldYear(2026, [0, 0, 0, 900, 0, 0, 0, 0], [0, 0, 0, 0, 150, 0, 0, 0], 480)];
    expect(refreshPlayable(fut, 2027, '3B').playable).toContain('SS');
  });

  it('강백호: 게임 안에서 포수를 안 보면 직전 3시즌 포수 이닝이 150 밑으로 떨어지는 해에 비상 포수에서 빠진다 (15.3 ④)', () => {
    const id = w.players.find((p) => p.name === '강백호' && !p.isPitcher)!.id;
    const real = fieldYears(store, id, 2026);
    expect(refreshPlayable(real, 2026, '1B').emergencyC).toBe(true);
    const game = (y: number) => gameFieldYear(y, [0, 300, 0, 0, 0, 0, 0, 300], undefined, 600);
    expect(refreshPlayable([...real, game(2026), game(2027), game(2028)], 2029, '1B').emergencyC).toBe(false);
  });
});
