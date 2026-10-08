// M8 과거 시대 확장: 시대별 제도 스위치, 구단 변화(명칭 변경·승계·창단), 1982년 시작 → 2026년 자동 진행 (완료 기준).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, eraPitching, type EngineParams } from '../src/engine';
import { createLeague, estimatedBirthYear } from '../src/league/create';
import { changeText, faEnabled, faServiceNeeded, foreignRule, teamChangesFor } from '../src/league/eras';
import { expansionSlots, EXPANSION_MIN } from '../src/league/offseason';
import { GameSession } from '../src/game/session';
import { runYear } from '../tools/longsim';

let store: DataStore;
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('시대별 제도', () => {
  it('FA는 1999 시즌 뒤부터, 자격 연차는 10 → 9(대졸 8) → 8(대졸 7)', () => {
    expect(faEnabled(1998)).toBe(false);
    expect(faEnabled(1999)).toBe(true);
    expect(faServiceNeeded(1999, false)).toBe(10);
    expect(faServiceNeeded(2010, false)).toBe(9);
    expect(faServiceNeeded(2010, true)).toBe(8);
    expect(faServiceNeeded(2023, false)).toBe(8);
    expect(faServiceNeeded(2023, true)).toBe(7);
  });

  it('외국인 한도는 연도별 규칙을 따른다: 1997년 0명, 1998년 2명, 2026년 3+아시아쿼터 1, 자료 밖 연도는 마지막 해 값', () => {
    expect(foreignRule(store.meta, 1997)).toEqual({ total: 0, asia: 0, regular: 0 });
    expect(foreignRule(store.meta, 1998)).toEqual({ total: 2, asia: 0, regular: 2 });
    expect(foreignRule(store.meta, 2026)).toEqual({ total: 4, asia: 1, regular: 3 });
    expect(foreignRule(store.meta, 2040)).toEqual({ total: 4, asia: 1, regular: 3 });
  });

  it('투수 기용: 1980년대는 4인 로테이션에 긴 선발, 2000년대는 5인', () => {
    expect(eraPitching(1985).rotation).toBe(4);
    expect(eraPitching(1985).limitScale).toBeGreaterThan(1);
    expect(eraPitching(2005)).toEqual({ rotation: 5, restDays: 5, limitScale: 1 });
  });

  it('생년 추정: 입단 연도에서 대졸 22세, 1991년 이전 23세, 그 뒤 19세', () => {
    expect(estimatedBirthYear({ entryYear: 1985 })).toBe(1962);
    expect(estimatedBirthYear({ entryYear: 1995 })).toBe(1976);
    expect(estimatedBirthYear({ entryYear: 1995, school: 'UNIV' })).toBe(1973);
  });

  it('창단 구단 추가 지명: 1라운드 앞 2명, 2라운드 뒤 5명', () => {
    const base = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const slots = expansionSlots(base, 3, [2]);
    expect(slots.slice(0, 2)).toEqual([2, 2]);
    expect(slots.slice(2, 8)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(slots.slice(8, 13)).toEqual([2, 2, 2, 2, 2]);
    expect(slots.length).toBe(base.length + 7);
    expect(expansionSlots(base, 3, [])).toEqual(base);
  });
});

describe('구단 변화 (자료의 구단 목록과 계보)', () => {
  const teamsOf = (year: number) => store.season(year)!.teams.map((t) => ({ name: t.name, franchise: t.franchise }));

  it('1986 빙그레 창단, 1990 MBC → LG, 2000 쌍방울 → SK 승계, 2008 현대 → 우리 승계, 2013 NC, 2015 KT', () => {
    expect(teamChangesFor(store, teamsOf(1985), 1986)).toEqual([{ kind: 'expand', name: '빙그레', franchise: '한화' }]);
    expect(teamChangesFor(store, teamsOf(1989), 1990)).toContainEqual({ kind: 'rename', team: teamsOf(1989).findIndex((t) => t.name === 'MBC'), from: 'MBC', to: 'LG' });
    const t99 = teamsOf(1999);
    expect(teamChangesFor(store, t99, 2000)).toContainEqual({ kind: 'succeed', team: t99.findIndex((t) => t.name === '쌍방울'), from: '쌍방울', to: 'SK', franchise: 'SSG' });
    const t07 = teamsOf(2007);
    expect(teamChangesFor(store, t07, 2008)).toContainEqual({ kind: 'succeed', team: t07.findIndex((t) => t.name === '현대'), from: '현대', to: '우리', franchise: '히어로즈' });
    expect(teamChangesFor(store, teamsOf(2012), 2013)).toEqual([{ kind: 'expand', name: 'NC', franchise: 'NC' }]);
    expect(teamChangesFor(store, teamsOf(2014), 2015)).toEqual([{ kind: 'expand', name: 'KT', franchise: 'KT' }]);
    expect(teamChangesFor(store, teamsOf(2026), 2027)).toEqual([]);
    expect(changeText({ kind: 'succeed', team: 0, from: '현대', to: '우리', franchise: '히어로즈' })).toContain('승계');
  });

  it('플레이어 게임에서도 창단이 일어난다: 2012년 시작 → 2013년 NC 10번째 구단, 특별 지명과 창단 선수로 최소 인원, 드래프트 추가 지명', () => {
    const g = GameSession.create(store, { year: 2012, teamIdx: 0, seed: 'era-nc' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const off = g.offseason!;
    expect(off.changes).toEqual([{ kind: 'expand', name: 'NC', franchise: 'NC' }]);
    const nc = g.league.teams.length - 1;
    expect(g.league.teams[nc]).toEqual({ name: 'NC', franchise: 'NC' });
    expect(g.league.teams.length).toBe(9);
    const org = g.league.players.filter((p) => p.team === nc);
    expect(org.length).toBeGreaterThanOrEqual(EXPANSION_MIN);
    expect(org.filter((p) => p.real).length).toBeGreaterThanOrEqual(6); // 기존 8구단에서 1명씩 특별 지명
    expect(off.log.some((l) => l.text.includes('NC 창단'))).toBe(true);
    // 우리 차례(보상 선택·지명·방출)가 막으면 자동으로 처리하고 넘어간다. 넘어가지 못하면 멈추지 말고 실패한다
    const stage = () => g.offseason!.stage;
    const step = () => {
      if (stage() === 'comp') g.autoComp();
      if (stage() === 'draft') g.autoDraft();
      if (stage() === 'release') g.autoRelease();
      const r = g.nextStage();
      expect(r.ok, `${stage()}: ${r.message}`).toBe(true);
    };
    while (stage() !== 'draft') step();
    const slots = off.draft!.slots!;
    expect(slots.slice(0, 2)).toEqual([nc, nc]);
    expect(slots.filter((t) => t === nc).length).toBe(11 + 7);
    for (let guard = 0; stage() !== 'ready' && guard < 10; guard++) step();
    expect(stage()).toBe('ready');
    expect(g.openNextSeason().ok).toBe(true);
    expect(g.world.teams.length).toBe(9);
    expect(g.world.teams[nc].org.length).toBeGreaterThanOrEqual(EXPANSION_MIN);
    expect(g.news.some((n) => n.text.includes('NC 창단'))).toBe(true);
  }, 120_000);
});

describe('M8 완료 기준: 1982년 시작 → 2026년까지 자동 진행', () => {
  it('해마다 구단 수·구단 이름·경기 수가 실제 시즌 자료와 같고, FA·외국인은 도입 연도부터 생긴다', () => {
    const { league } = createLeague(store, 1982, 'm8-done', FAST);
    const seenFa: number[] = [];
    const seenForeign: number[] = [];
    for (let i = 0; i < 45; i++) {
      const year = league.year;
      const real = store.season(year)!;
      const { m, world } = runYear(league, store, FAST);
      expect(world.teams.length, `${year} 구단 수`).toBe(real.teams.length);
      expect(world.teams.map((t) => t.name).sort(), `${year} 구단 이름`).toEqual(real.teams.map((t) => t.name).sort());
      expect(world.gamesPerTeam, `${year} 경기 수`).toBe(real.games);
      expect(m.runs, `${year} 경기당 득점`).toBeGreaterThan(3);
      expect(m.runs, `${year} 경기당 득점`).toBeLessThan(6.5);
      // 1982~1983년은 자료에 1군 기록이 있는 선수만 있어 구단당 20명 안팎으로 시작한다
      for (const t of world.teams) expect(t.org.length, `${year} ${t.name} 선수단`).toBeGreaterThanOrEqual(18);
      if (league.players.some((p) => p.contract.kind === 'fa')) seenFa.push(year);
      if (world.players.some((p) => p.foreign)) seenForeign.push(year);
    }
    expect(league.year).toBe(2027);
    expect(league.teams.length).toBe(10);
    expect(league.teams.map((t) => t.name).sort()).toEqual(['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']);
    // FA 계약은 1999 시즌 뒤(2000년 개막)부터, 외국인은 1998년부터
    expect(Math.min(...seenFa)).toBeGreaterThanOrEqual(1999);
    expect(seenFa.length).toBeGreaterThan(0);
    expect(Math.min(...seenForeign)).toBe(1998);
  }, 600_000);
});
