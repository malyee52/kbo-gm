// 기획안 도전 (league/campaigns.ts, 2026-10-12): 시즌 도전 30개 + 장기 캠페인 10개 + 클래식 캠페인 10개, 단계 판정, 자체 육성, 예산, 시놉시스.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { condStatus, PLAN_CHALLENGES, stageStatus, type Cond, type SeasonMark } from '../src/league/campaigns';
import { challengeById, CHALLENGES, planTeam } from '../src/league/challenges';
import { spendLimit } from '../src/league/owner';
import { PLAN_SYNOPSIS } from '../src/league/synopses';
import { capPayroll } from '../src/league/salary';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => { store = loadDataStore(); }, 120_000);

const mk = (year: number, o: Partial<SeasonMark> = {}): SeasonMark => ({ year, rank: 5, teams: 10, pct: 0.5, ps: false, ks: false, champ: false, home: 0, ...o });
const start = (id: string, seed = `cp-${id}`) => {
  const ch = challengeById(id)!;
  return GameSession.create(store, { year: ch.plan!.year, teamIdx: planTeam(store, ch)!, seed, challenge: id }, FAST);
};

describe('기획안 도전 목록', () => {
  it('하·중·상 각 10개와 장기·클래식 캠페인 10개씩, 모든 시작 구단이 그 해 자료에 있고 시놉시스가 있다', () => {
    expect(PLAN_CHALLENGES).toHaveLength(50);
    for (const p of PLAN_CHALLENGES) expect(PLAN_SYNOPSIS[p.no]?.text.length, p.no).toBeGreaterThan(80);
    for (const t of ['하', '중', '상', '장기', '클래식']) expect(PLAN_CHALLENGES.filter((p) => p.tier === t)).toHaveLength(10);
    // 같은 난이도 안에서 구단이 겹치지 않는다
    for (const t of ['하', '중', '상']) expect(new Set(PLAN_CHALLENGES.filter((p) => p.tier === t).map((p) => p.franchise)).size).toBe(10);
    for (const c of CHALLENGES.filter((x) => x.plan)) expect(planTeam(store, c), c.id).not.toBeNull();
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
  });

  it('배경의 승수는 시즌 자료와 같다', () => {
    // 클래식 캠페인 배경에는 선수 승수(장명부 30승 등)가 섞여 있어 '정규시즌 N승'만 본다
    for (const p of PLAN_CHALLENGES) {
      const m = p.tier === '클래식' ? p.background.match(/정규시즌 (\d+)승/) : p.background.match(/(\d+)승/);
      if (!m) continue;
      expect(store.season(p.year)!.teams.find((t) => t.franchise === p.franchise)!.w, `${p.no}`).toBe(Number(m[1]));
    }
  });
});

describe('조건 판정', () => {
  it('클래식: 전·후기 1위(반기 1위)와 승수 조건', () => {
    const half: Cond = { t: 'in', year: 1983, m: { k: 'half' } };
    expect(condStatus(half, [mk(1983, { half: true })], 1983)).toBe(1);
    expect(condStatus(half, [mk(1983)], 1983)).toBe(2);
    const h06: Cond = { t: 'same', from: 1992, to: 1992, ms: [{ k: 'wins', n: 80 }, { k: 'champ' }] };
    expect(condStatus(h06, [mk(1992, { w: 81, champ: true })], 1992)).toBe(1);
    expect(condStatus(h06, [mk(1992, { w: 79, champ: true })], 1992)).toBe(2);
  });

  it('in·by: 그 해 / 그 해까지, 지나면 실패', () => {
    const c: Cond = { t: 'by', year: 2009, m: { k: 'ps' } };
    expect(condStatus(c, [mk(2007)], 2007)).toBe(0);
    expect(condStatus(c, [mk(2007), mk(2008, { ps: true })], 2008)).toBe(1);
    expect(condStatus(c, [mk(2007), mk(2008), mk(2009)], 2009)).toBe(2);
    const i: Cond = { t: 'in', year: 2003, m: { k: 'pct', v: 0.4 } };
    expect(condStatus(i, [mk(2002, { pct: 0.6 })], 2002)).toBe(0);
    expect(condStatus(i, [mk(2002), mk(2003, { pct: 0.4 })], 2003)).toBe(1);
  });

  it('count: 남은 시즌으로 못 채우면 바로 실패, all: 한 번이라도 어기면 실패', () => {
    const c: Cond = { t: 'count', from: 2014, to: 2016, m: { k: 'champ' }, n: 2 };
    expect(condStatus(c, [mk(2014)], 2014)).toBe(0);
    expect(condStatus(c, [mk(2014), mk(2015)], 2015)).toBe(2);
    expect(condStatus(c, [mk(2014, { champ: true }), mk(2015, { champ: true })], 2015)).toBe(1);
    const a: Cond = { t: 'all', from: 2012, to: 2014, m: { k: 'ps' } };
    expect(condStatus(a, [mk(2012, { ps: true })], 2012)).toBe(0);
    expect(condStatus(a, [mk(2012, { ps: true }), mk(2013)], 2013)).toBe(2);
    expect(condStatus(a, [2012, 2013, 2014].map((y) => mk(y, { ps: true })), 2014)).toBe(1);
  });

  it('same: 우승과 자체 육성 4명이 같은 시즌이어야 한다', () => {
    const c: Cond = { t: 'same', from: 2022, to: 2029, ms: [{ k: 'champ' }, { k: 'home', n: 4 }] };
    expect(condStatus(c, [mk(2025, { champ: true, home: 3 }), mk(2026, { home: 5 })], 2026)).toBe(0);
    expect(condStatus(c, [mk(2027, { champ: true, home: 4 })], 2027)).toBe(1);
    expect(stageStatus({ label: '', conds: [c, { t: 'in', year: 2023, m: { k: 'ps' } }] }, [mk(2023)], 2023)).toBe(2);
  });
});

describe('게임에서', () => {
  it('시즌 도전: 결산 때 정규시즌 순위로 판정하고 기록을 남긴다 (01 2017 KIA, 3위 이내)', () => {
    const g = start('plan-01');
    expect(g.year).toBe(2017);
    expect(g.team.franchise).toBe('KIA');
    g.advance(100000);
    g.beginOffseason();
    const c = g.league.challenge!;
    expect(c.marks).toHaveLength(1);
    const rank = c.marks![0].rank;
    expect(c.result).toBe(rank <= 3 ? 'success' : 'fail');
    expect(g.news.some((n) => n.text.includes('「호랑이 군단의 진격」'))).toBe(true);
  }, 240_000);

  it('장기 캠페인: 시작 때 만 23세 이하 선수와 그 뒤 지명한 선수가 자체 육성 후보, 중간 단계는 진행 중', () => {
    const g = start('plan-l04');
    const c = g.league.challenge!;
    expect(c.homegrown!.length).toBeGreaterThan(0);
    for (const id of c.homegrown!) {
      const p = g.league.players.find((x) => x.id === id)!;
      expect(2022 - p.birthYear!).toBeLessThanOrEqual(23);
    }
    const before = c.homegrown!.length;
    g.advance(100000);
    g.beginOffseason();
    expect(c.result).toBeUndefined();
    let guard = 0;
    while (g.offseason!.stage !== 'ready' && guard++ < 40) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    const drafted = g.offseason!.draft!.picks.filter((p) => p.team === g.teamIdx).map((p) => p.id);
    expect(drafted.length).toBeGreaterThan(0);
    expect(g.league.challenge!.homegrown!.length).toBe(before + drafted.length);
  }, 300_000);

  it('넥센 캠페인 예산: 우리 구단 연봉 상한은 리그 평균의 85%, 다른 구단은 캡이 없던 해라 제한 없음', () => {
    const g = start('plan-l10');
    const L = g.league;
    const pay = L.teams.map((_, t) => capPayroll(L.players, t)).filter((v) => v > 0);
    const avg = pay.reduce((a, b) => a + b, 0) / pay.length;
    expect(spendLimit(L, g.teamIdx, 2012)).toBe(Math.round(avg * 0.85));
    expect(spendLimit(L, (g.teamIdx + 1) % L.teams.length, 2012)).toBeNull();
  });

  it('조작 기록으로 다시 돌리면 도전 진행이 같다', () => {
    const g = start('plan-21', 'cp-replay');
    g.advance(100000);
    g.beginOffseason();
    const rep = GameSession.replay(store, g.reproInfo().opts, g.actions, undefined, FAST);
    expect(rep.league.challenge).toEqual(g.league.challenge);
  }, 240_000);
});

describe('클래식 캠페인', () => {
  it('H01 1983 삼미: 그 시절 구단으로 시작하고, 결산 때 반기 1위를 판정한다', () => {
    const g = start('plan-h01');
    expect(g.year).toBe(1983);
    expect(g.team.name).toBe('삼미');
    g.advance(100000);
    g.beginOffseason();
    const m = g.league.challenge!.marks![0];
    expect(typeof m.half).toBe('boolean');
    expect(m.w).toBeGreaterThan(0);
    expect(g.league.challenge!.result).toBe(m.half ? 'success' : 'fail');
  }, 240_000);
});
