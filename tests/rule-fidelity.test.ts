// 옛 규칙 실제화 (2026-10-24): 등록·출장 인원, 엔트리 확대, 가을야구 시리즈 승수·준플레이오프 생략·1986~1988 3팀.
// 연도표는 tools/build_data.py entry_rules·postseason_rules → public/data/meta.json rules
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimPlayer, World } from '../src/engine';
import { gameSide, rosterExtraAt, teamRules, type TeamSeason } from '../src/engine/team';
import type { Meta, YearRules } from '../src/data/types';
import { gamesBehind, RULES, startPostseason, yearRoundRule } from '../src/league/postseason';

const meta = JSON.parse(readFileSync('public/data/meta.json', 'utf-8')) as Meta;
const R = (y: number): YearRules => meta.rules[String(y)];

describe('연도표 (meta.json rules)', () => {
  it('등록·출장 인원: 2001 26/24, 2008 26/25, 2015 27/25, 2020 28/26, 2026 29/27, 2000년까지는 같다', () => {
    const pair = (y: number) => [R(y).rosterSize, R(y).activeSize];
    expect(pair(2001)).toEqual([26, 24]);
    expect(pair(2008)).toEqual([26, 25]);
    expect(pair(2015)).toEqual([27, 25]);
    expect(pair(2020)).toEqual([28, 26]);
    expect(pair(2026)).toEqual([29, 27]);
    expect(R(1995).activeSize).toBe(R(1995).rosterSize);
  });

  it('엔트리 확대: 2001~ 9월 1일 +5, 2020 8월 18일, 2026 후반기 +1·8월 25일 +5, 2000년까지 없음', () => {
    expect(R(2000).rosterExtra).toBeUndefined();
    expect(rosterExtraAt(R(2001), 831)).toBe(0);
    expect(rosterExtraAt(R(2001), 901)).toBe(5);
    expect(rosterExtraAt(R(2020), 818)).toBe(5);
    expect(rosterExtraAt(R(2026), 715)).toBe(0);
    expect(rosterExtraAt(R(2026), 716)).toBe(1);
    expect(rosterExtraAt(R(2026), 825)).toBe(5);
  });

  it('가을야구: 1985 2팀, 1986~1988 3팀, 1989 4팀 · 준PO 승수 연표 · PO 1995(조건부)·2008 4승, 2021 2승', () => {
    expect([1985, 1986, 1988, 1989, 2014, 2015].map((y) => R(y).postseasonTeams)).toEqual([2, 3, 3, 4, 4, 5]);
    const semi = (y: number) => R(y).semiWins;
    expect([1989, 2004, 2005, 2006, 2007, 2008, 2019, 2020, 2021, 2022, 2026].map(semi)).toEqual([2, 2, 3, 2, 2, 3, 3, 2, 2, 3, 3]);
    expect([1986, 1995, 2008, 2009, 2021, 2022].map((y) => R(y).poWins)).toEqual([3, 3, 4, 3, 2, 3]);
    expect(R(1995).poWinsNoSemi).toBe(4);
    expect([1992, 1993, 1998, 2001].map((y) => R(y).semiSkipGap)).toEqual([undefined, 3.5, 3.5, undefined]);
  });
});

describe('teamRules 엔트리 확대·창단 특례', () => {
  const world = { rules: R(2026) } as Pick<World, 'rules'>;
  it('확대는 등록·출장 모두에, 창단 특례도 둘 다', () => {
    expect(teamRules(world, {}, 0)).toMatchObject({ rosterSize: 29, activeSize: 27 });
    expect(teamRules(world, {}, 5)).toMatchObject({ rosterSize: 34, activeSize: 32 });
    expect(teamRules(world, { rosterBonus: 1 }, 0)).toMatchObject({ rosterSize: 30, activeSize: 28 });
  });
});

describe('출장 인원 (gameSide)', () => {
  let n = 0;
  const mk = (isPitcher: boolean, value: number, pos: string | null = null): SimPlayer =>
    ({ idx: n++, id: `p${n}`, name: `p${n}`, isPitcher, value, pos, foreign: false }) as unknown as SimPlayer;
  const world = { rules: { ...R(2026), foreignActive: 9 } } as Pick<World, 'rules'>;

  it('넘치면 가장 약한 구원 → 약한 벤치 야수 순으로 그 경기만 빠지고, 마지막 백업 포수는 남는다', () => {
    const starter = mk(true, -1);
    const lineup = Array.from({ length: 9 }, (_, i) => mk(false, 3 - i * 0.1, i === 1 ? 'C' : 'RF'));
    const bench = [mk(false, 0.1, 'C'), mk(false, 0.2, '2B'), mk(false, 0.3, 'LF')];
    // 구원 16명 (value 작을수록 좋다): 선발 1 + 9 + 3 + 16 = 29 > 27
    const pen = Array.from({ length: 16 }, (_, i) => mk(true, i * 0.1));
    const ts = { team: {}, hitters: [...lineup, ...bench], rotation: [starter], bullpen: pen, closer: pen[0] } as unknown as TeamSeason;
    const side = gameSide(ts, world, starter, lineup);
    expect(side.bullpen.length).toBe(14);
    expect(side.bullpen.map((p) => p.idx)).not.toContain(pen[15].idx);
    expect(side.bullpen.map((p) => p.idx)).not.toContain(pen[14].idx);
    expect(side.hitters.length).toBe(12);

    // 구원이 MIN_DRESSED_PEN(6)명이면 벤치 야수가 빠진다. 백업 포수는 하나 남긴다
    const small = { ...ts, bullpen: pen.slice(0, 6), closer: pen[0], hitters: [...lineup, ...bench, mk(false, 0.05, '1B'), mk(false, 0.04, 'SS'), ...Array.from({ length: 10 }, (_, i) => mk(false, 0.01 * i, '3B'))] } as TeamSeason;
    const side2 = gameSide(small, { rules: { ...world.rules, activeSize: 20 } }, starter, lineup);
    expect(1 + side2.bullpen.length + side2.hitters.length).toBe(20);
    expect(side2.hitters.filter((p) => p.pos === 'C').length).toBe(2);

    // 한도 안이면 그대로
    const fit = { ...ts, bullpen: pen.slice(0, 9) } as TeamSeason;
    expect(gameSide(fit, world, starter, lineup)).toBe(fit);
  });
});

describe('가을야구 시리즈 규칙 (사다리 해)', () => {
  const rec = (w: number, l: number) => ({ g: w + l, w, l, t: 0, rs: 0, ra: 0, homeW: 0, homeL: 0 });
  const fake = (year: number, recs: ReturnType<typeof rec>[]) => ({
    divisionStandings: () => null, teams: recs, schedule: { length: 126 }, plan: { opening: '04-10' },
    world: { year, rules: R(year), schedule: undefined },
  }) as unknown as Parameters<typeof startPostseason>[0];

  it('3전 2선승 홈: 1·3차전 상위 팀, 2차전 하위 팀', () => {
    expect(yearRoundRule('semi', 2, 4)).toMatchObject({ need: 2, homePattern: [true, false, true, true] });
    expect(yearRoundRule('semi', 3, 4)).toBeUndefined();
    expect(yearRoundRule('po', 4, 4)).toMatchObject({ need: 4, maxGames: 9 });
    expect(yearRoundRule('ks', undefined, 4)).toBeUndefined();
  });

  it('1993~1998: 3·4위 승차 3.5경기 이상이면 준플레이오프 없이 3팀, 플레이오프는 7전 4선승', () => {
    expect(gamesBehind(rec(70, 50), rec(66, 53))).toBe(3.5);
    const skip = startPostseason(fake(1995, [rec(80, 40), rec(75, 45), rec(70, 50), rec(66, 53), rec(50, 70)]), [0, 1, 2, 3, 4], 4, 's');
    expect(skip.seeds).toEqual([0, 1, 2]);
    expect(skip.semiSkip).toEqual({ third: 2, fourth: 3, gap: 3.5 });
    expect(skip.rounds).toEqual(['po', 'ks']);
    expect(skip.series[0]).toMatchObject({ round: 'po', high: 1, low: 2, rule: { need: 4 } });

    const open = startPostseason(fake(1995, [rec(80, 40), rec(75, 45), rec(70, 50), rec(67, 53), rec(50, 70)]), [0, 1, 2, 3, 4], 4, 's');
    expect(open.seeds).toEqual([0, 1, 2, 3]);
    expect(open.semiSkip).toBeUndefined();
    expect(open.series[0]).toMatchObject({ round: 'semi', high: 2, low: 3, rule: { need: 2 } });
    expect(open.roundRules?.po).toBeUndefined();
  });

  it('1986~1988: 1위 한국시리즈 직행, 2위 대 3위 플레이오프 5전 3선승 (2-3 홈)', () => {
    const st = startPostseason(fake(1987, [rec(60, 40), rec(55, 45), rec(50, 50), rec(45, 55)]), [0, 1, 2, 3], R(1987).postseasonTeams, 's');
    expect(st.seeds).toEqual([0, 1, 2]);
    expect(st.series[0]).toMatchObject({ round: 'po', high: 1, low: 2, rule: { need: 3, homePattern: [true, true, false, false, false, true] } });
  });

  it('2015년 이후 기본 해는 RULES 그대로 (rule 칸 없음)', () => {
    const st = startPostseason(fake(2025, Array.from({ length: 10 }, (_, i) => rec(90 - i * 3, 54 + i * 3))), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5, 's');
    expect(st.roundRules).toBeUndefined();
    expect(st.series[0].rule).toBeUndefined();
    expect(st.series[0].winsHigh).toBe(RULES.wc.highHeadStart);
  });
});
