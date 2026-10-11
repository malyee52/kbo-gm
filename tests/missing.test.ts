// 시작 연도 1군 기록이 없어 빠지던 실제 선수 보충과 창단 해 드래프트 (2026-10-11 사용자 요청).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { ORG_LIMIT } from '../src/league/salary';
import { expansionRule, pickKindAt, snakeDraftYear } from '../src/league/offseason';
import { PRESETS } from '../src/league/difficulty';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const KIM_JINSUNG = '75867'; // 2004 입단 SK 지명, 1군 데뷔 2013 (NC)
const KIM_GUNWOO = '51867'; // 2021 SK 1차, 2023·2024 군 복무 (2024 전역)
const NA_SUNGBUM = '62947'; // 2012 입단 NC 지명, 1군 데뷔 2013

beforeAll(() => {
  store = loadDataStore();
});

describe('시작 명단 보충', () => {
  it('늦게 데뷔한 지명 선수: 2004 시작이면 김진성이 지명 구단 SK에 있다', () => {
    const { league } = createLeague(store, 2004, 'miss');
    const p = league.players.find((x) => x.id === KIM_JINSUNG)!;
    expect(p).toBeDefined();
    expect(league.teams[p.team].name).toBe('SK');
    expect(p.military?.state).not.toBe('serving');
  });

  it('군 복무 중인 선수: 2023 시작이면 김건우가 SSG 소속 복무 중이고 2025년에 복귀한다', () => {
    const { league } = createLeague(store, 2023, 'miss');
    const p = league.players.find((x) => x.id === KIM_GUNWOO)!;
    expect(league.teams[p.team].name).toBe('SSG');
    expect(p.military).toMatchObject({ state: 'serving', returnYear: 2025 });
  });

  it('보충해도 선수가 겹치지 않고, 보충 때문에 정원(복무 중 제외)을 넘는 구단이 없다', () => {
    for (const y of [1990, 2012, 2014, 2023]) {
      const { league } = createLeague(store, y, 'miss');
      expect(new Set(league.players.map((p) => p.id)).size, String(y)).toBe(league.players.length);
      for (let t = 0; t < league.teams.length; t++) {
        const n = league.players.filter((p) => p.team === t && p.military?.state !== 'serving').length;
        expect(n, `${y} ${league.teams[t].name}`).toBeLessThanOrEqual(ORG_LIMIT + 3); // 시작 연도 기록만으로 조금 넘는 구단은 그대로 둔다
      }
    }
  });
});

describe('창단 구단은 1군 진입 2년 전에 퓨처스 구단으로 (2026-10-11 사용자 결정, 실제 NC 일정)', () => {
  it('2012 시작: NC는 퓨처스 구단으로 있고 시즌 월드에는 없으며, 2012 입단 NC 지명 선수(나성범 등)는 처음부터 NC 소속이다', () => {
    const sk = store.season(2012)!.teams.findIndex((t) => t.name === 'SK');
    const g = GameSession.create(store, { year: 2012, teamIdx: sk, seed: 'nc-futures' }, FAST);
    const nc = g.league.teams.findIndex((t) => t.name === 'NC');
    expect(nc).toBe(g.league.teams.length - 1);
    expect(g.world.teams).toHaveLength(8);
    expect(g.league.players.find((p) => p.id === NA_SUNGBUM)!.team).toBe(nc);
    expect(g.world.players.some((p) => p.id === NA_SUNGBUM)).toBe(false);
  });

  let g: GameSession;
  let nc: number;
  beforeAll(() => {
    // 2011 시작: 2011 시즌 뒤 NC가 창단해 2012 입단 드래프트(실제로는 2011년 8월)에 처음 참가한다
    const sk = store.season(2011)!.teams.findIndex((t) => t.name === 'SK');
    // 지명 순서 구조를 보는 시험이라 지명권 트레이드는 실제 규정(2020년부터)으로: 과거 시즌 허용(기본)이면 AI끼리 지명권이 오가 순번 주인이 바뀐다
    g = GameSession.create(store, { year: 2011, teamIdx: sk, seed: 'nc-draft', settings: { ...PRESETS.normal, pickTradeEra: 0 } }, FAST);
    g.advance(100000);
    g.advancePostseason(10_000);
    g.beginOffseason();
    let guard = 0;
    while (g.offseason!.stage !== 'draft' && guard++ < 30) {
      if (g.offseason!.stage === 'comp') g.autoComp();
      g.nextStage();
    }
    nc = g.league.teams.findIndex((t) => t.name === 'NC');
  }, 300_000);

  it('2011 시작: 2011 시즌 뒤 NC가 퓨처스 구단으로 창단하고, FA·외국인 시장에는 나서지 않는다', () => {
    expect(nc).toBeGreaterThanOrEqual(0);
    expect(g.league.expansions).toContainEqual({ team: nc, firstYear: 2013 });
    expect(g.offseason!.fa.entries.some((e) => e.team === nc)).toBe(false);
    expect(g.league.players.some((p) => p.team === nc && p.foreign)).toBe(false);
  });

  it('NC 첫 드래프트(2012 입단)는 실제대로: 우선 지명 2명(라운드 밖) → 1라운드 맨 끝 → 지그재그라 2라운드 맨 앞 → 2라운드 뒤 특별 지명 5명', () => {
    const off = g.offseason!;
    const slots = off.draft!.slots!;
    const n = off.draft!.order.length;
    expect(slots.slice(0, 2)).toEqual([nc, nc]);
    expect([pickKindAt(off, 0), pickKindAt(off, 1)]).toEqual([0, 0]);
    const r1 = slots.slice(2, 2 + n);
    expect(r1.filter((t) => t === nc)).toHaveLength(1);
    expect(r1[n - 1]).toBe(nc);
    expect(slots.slice(2 + n, 2 + 2 * n)).toEqual([...r1].reverse());
    expect(slots.slice(2 + 2 * n, 2 + 2 * n + 5)).toEqual([nc, nc, nc, nc, nc]);
    expect(pickKindAt(off, 2 + 2 * n)).toBe(-1);
    expect(pickKindAt(off, 2 + 2 * n + 5)).toBe(3);
    expect(off.log.some((l) => l.text.startsWith('우선 지명 NC'))).toBe(true);
  });

  it('지명이 끝나면 NC의 1라운드 지명은 한 번뿐이고 (우선 지명은 1라운드로 세지 않는다), 2012 시즌 월드에 NC는 없다', () => {
    g.autoDraft();
    expect(g.offseason!.log.filter((l) => /^1라운드 \d+순위 NC/.test(l.text))).toHaveLength(1);
    let guard = 0;
    while (g.offseason!.stage !== 'ready' && guard++ < 30) {
      if (g.offseason!.stage === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.openNextSeason().ok).toBe(true);
    expect(g.world.teams.map((t) => t.name)).not.toContain('NC');
    expect(g.league.players.filter((p) => p.team === nc).length).toBeGreaterThan(10);
  });
});

describe('창단 구단 지명 특례는 구단마다 실제 자료대로 (KBO 공통 규칙이 아니다)', () => {
  it('쌍방울은 우선 10명씩·특별 없음, NC는 우선 2명·특별 5명→3명(2라운드 뒤), KT는 특별이 1라운드 뒤, 빙그레는 없음', () => {
    expect(expansionRule(store, '쌍방울', 1991, 0)).toEqual({ priority: 10, special: 0, after: 2 });
    expect(expansionRule(store, '쌍방울', 1991, 1)).toEqual({ priority: 10, special: 0, after: 2 });
    expect(expansionRule(store, 'NC', 2013, 0)).toEqual({ priority: 2, special: 5, after: 2 });
    expect(expansionRule(store, 'NC', 2013, 1)).toEqual({ priority: 2, special: 3, after: 2 });
    expect(expansionRule(store, 'KT', 2015, 0)).toEqual({ priority: 2, special: 5, after: 1 });
    expect(expansionRule(store, '한화', 1986, 0)).toEqual({ priority: 0, special: 0, after: 2 });
  });

  it('라운드 방식은 해마다 실제대로: 2010~2015 입단은 지그재그, 2005·2018·2026 입단은 매 라운드 같은 순서', () => {
    for (const y of [2010, 2012, 2013, 2014, 2015]) expect(snakeDraftYear(store, y), String(y)).toBe(true);
    for (const y of [2005, 2018, 2026, 2030]) expect(snakeDraftYear(store, y), String(y)).toBe(false);
  });
});
