// M5 오프시즌: 리그 상태, 잠재력·성장, FA, 외국인, 드래프트, 연봉, 정원, 2027 개막까지.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { GameSession, type GameSave } from '../src/game/session';
import { isServing } from '../src/league/careers';
import { createLeague, openingForeigners } from '../src/league/create';
import * as Off from '../src/league/offseason';
import {
  ASIA_NEW_CAP, COMPENSATION, faEligible, faGrade, FOREIGN_NEW_CAP, FOREIGN_TOTAL_CAP, MIN_SALARY, ORG_LIMIT, salaryCap, serviceNeeded,
} from '../src/league/salary';
import type { LeaguePlayer } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lgIdx: number;

beforeAll(() => {
  store = loadDataStore();
  lgIdx = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

/** 시즌 끝까지 → 오프시즌 시작 */
function toOffseason(seed: string, team = lgIdx): GameSession {
  const g = GameSession.create(store, { year: 2026, teamIdx: team, seed }, FAST);
  g.advance(1000);
  g.beginOffseason();
  return g;
}

/** 플레이어 결정을 모두 자동으로 해서 오프시즌을 끝내고 개막한다 */
function finishOffseason(g: GameSession): void {
  let guard = 0;
  while (g.offseason && g.offseason.stage !== 'ready' && guard++ < 50) {
    if (g.offseason.stage === 'draft') g.autoDraft();
    if (g.offseason.stage === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.openNextSeason().ok).toBe(true);
}

describe('리그 상태 만들기', () => {
  it('시작 연도 월드는 worldForYear에서 개막 명단에 없는 외국인과 특별 엔트리 선수만 뺀 것이다 (나머지 구성·능력은 같다)', () => {
    const { world } = createLeague(store, 2026, 's', FAST);
    const ref = worldForYear(store, 2026, FAST);
    const opening = openingForeigners(store, 2026)!;
    const special = new Set(store.meta.specialEntries?.['2026'] ?? []);
    const kept = ref.players.filter((p) => (!p.foreign || opening.has(p.id)) && !special.has(p.id));
    // 특별 엔트리(은퇴식 등으로 하루 등록된 선수)는 빠진다
    expect(world.players.some((p) => p.name === '박병호')).toBe(false);
    // 1군 기록 없는 2026 신인(d2026-)은 따로 더해진다 (다음 테스트)
    const recorded = world.players.filter((p) => !p.id.startsWith('d2026-'));
    expect(recorded.map((p) => `${p.id}@${p.teamIdx}`)).toEqual(kept.map((p) => `${p.id}@${p.teamIdx}`));
    expect(recorded.map((p) => p.value)).toEqual(kept.map((p) => p.value));
    expect(ref.players.length - recorded.length).toBeGreaterThan(20);
  });

  it('2026년 입단 신인 중 1군 기록이 없는 선수도 실제 지명 구단에 들어온다 (baseballchart.kr 지명 자료)', () => {
    const { league, world } = createLeague(store, 2026, 's', FAST);
    const rows = store.drafts!['2026'].filter((d) => d.games === 0);
    const added = league.players.filter((p) => p.id.startsWith('d2026-'));
    expect(added.length).toBeGreaterThan(50);
    expect(added.length).toBeLessThanOrEqual(rows.length);
    for (const p of added) {
      // 같은 이름이 여럿일 수 있다 (2026년 김현수: KIA·롯데)
      expect(rows.some((x) => x.name === p.name && x.team === league.teams[p.team].name), `${p.name} ${league.teams[p.team].name}`).toBe(true);
      expect(p.real).toBe(true);
      expect(p.entryYear).toBe(2026);
      expect(world.players.some((w) => w.id === p.id)).toBe(true);
    }
    // 1군 기록이 있는 신인은 두 번 들어오지 않는다: 구단·이름별 인원이 지명 명단의 인원을 넘지 않는다
    // (동명이인은 있다: 2026년 삼성 이서준 투수·포수 2명)
    const count = (xs: string[]) => xs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
    const inLeague = count(league.players.filter((p) => p.entryYear === 2026 && !p.foreign).map((p) => `${league.teams[p.team].name}/${p.name}`));
    const inDraft = count(store.drafts!['2026'].map((d) => `${d.team}/${d.name}`));
    for (const [k, n] of inLeague) if (inDraft.has(k)) expect(n, k).toBeLessThanOrEqual(inDraft.get(k)!);
  });

  it('2026 개막 외국인은 구단마다 일반 3명·아시아쿼터 1명 이하이고, 아시아쿼터 표시가 붙는다', () => {
    const { league } = createLeague(store, 2026, 's', FAST);
    for (let t = 0; t < league.teams.length; t++) {
      const f = league.players.filter((p) => p.team === t && p.foreign);
      expect(f.filter((p) => !p.asia).length, league.teams[t].name).toBeLessThanOrEqual(3);
      expect(f.filter((p) => p.asia).length, league.teams[t].name).toBeLessThanOrEqual(1);
    }
    expect(league.players.filter((p) => p.asia).length).toBeGreaterThanOrEqual(9);
    const ssg = league.teams.findIndex((t) => t.name === 'SSG');
    expect(league.players.find((p) => p.name === '아빌라')?.team).toBe(ssg);
  });

  it('잠재력은 지금 능력 이상이고, 같은 시드면 같다', () => {
    const a = createLeague(store, 2026, 'pot', FAST).league;
    const b = createLeague(store, 2026, 'pot', FAST).league;
    expect(a.players.map((p) => p.potential)).toEqual(b.players.map((p) => p.potential));
    const c = createLeague(store, 2026, 'other', FAST).league;
    expect(c.players.map((p) => p.potential)).not.toEqual(a.players.map((p) => p.potential));
  });

  it('계약 기록이 있는 선수는 그 계약을 따른다 (양의지: FA 계약 2028년까지)', () => {
    const { league } = createLeague(store, 2026, 's', FAST);
    const p = league.players.find((x) => x.name === '양의지')!;
    expect(p.contract.kind).toBe('fa');
    expect(p.contract.until).toBe(2028);
    expect(faEligible(p, 2026)).toBe(false);
  });

  it('FA 자격 연한: 고졸 8년, 대졸 7년 (출신교가 없으면 입단 나이로)', () => {
    expect(serviceNeeded('HS', 2010, 1991)).toBe(8);
    expect(serviceNeeded('UNIV', 2010, 1988)).toBe(7);
    expect(serviceNeeded(null, 2010, 1988)).toBe(7); // 22세 입단
    expect(serviceNeeded(null, 2010, 1991)).toBe(8); // 19세 입단
  });

  it('FA 등급: 35세 이상 신규 FA는 C, 두 번째 FA는 B 이하', () => {
    const { league } = createLeague(store, 2026, 's', FAST);
    const top = [...league.players].filter((p) => !p.foreign).sort((a, b) => b.contract.salary - a.contract.salary)[0];
    const asNew = { ...top, faCount: 0, birthYear: 2026 + 1 - 30 } as LeaguePlayer;
    expect(faGrade(asNew, league.players, 2026)).toBe('A');
    expect(faGrade({ ...asNew, birthYear: 2026 + 1 - 35 }, league.players, 2026)).toBe('C');
    expect(faGrade({ ...asNew, faCount: 1 }, league.players, 2026)).toBe('B');
    expect(faGrade({ ...asNew, faCount: 2 }, league.players, 2026)).toBe('C');
  });

  it('샐러리캡: 2026·2027·2028년은 발표값, 이후 5%씩', () => {
    expect(salaryCap(2026)).toBe(1439723);
    expect(salaryCap(2027)).toBe(1511709);
    expect(salaryCap(2028)).toBe(1587294);
    expect(salaryCap(2029)).toBe(Math.round(1587294 * 1.05));
  });
});

describe('오프시즌 단계 (2026 → 2027)', () => {
  let g: GameSession;
  let afterFa: GameSession;

  beforeAll(() => {
    g = toOffseason('off-main');
  });

  it('결산하면 FA 단계로 들어가고, 지난 시즌 기록과 1군 연차가 리그 상태에 남는다', () => {
    expect(g.phase).toBe('offseason');
    expect(g.offseason!.stage).toBe('fa');
    const withHistory = g.league.players.filter((p) => p.history.some((h) => h.year === 2026));
    expect(withHistory.length).toBeGreaterThan(400);
    expect(g.league.lastSeason!.year).toBe(2026);
  });

  it('성장: 23세 이하는 대체로 좋아지고 34세 이상은 대체로 나빠진다', () => {
    const before = g['finishedLeague']!;
    const delta = (minAge: number, maxAge: number) => {
      const ids = before.players.filter((p) => p.birthYear && 2027 - p.birthYear >= minAge && 2027 - p.birthYear <= maxAge && !p.foreign);
      let up = 0;
      for (const b of ids) {
        const a = g.league.players.find((x) => x.id === b.id)!;
        const s0 = b.isPitcher ? b.pit!.so / b.pit!.bb : b.bat!.hr + b.bat!.bb;
        const s1 = a.isPitcher ? a.pit!.so / a.pit!.bb : a.bat!.hr + a.bat!.bb;
        if (s1 > s0) up++;
      }
      return up / ids.length;
    };
    expect(delta(18, 23)).toBeGreaterThan(0.65);
    expect(delta(34, 45)).toBeLessThan(0.35);
  });

  it('성장 결과 화면 자료: 소속 선수마다 전후 기여가 남고, 은퇴한 선수는 없으며, 젊은 선수는 대체로 오르고 노장은 대체로 내린다', () => {
    const list = g.offseason!.growth!;
    expect(list.filter((x) => x.team === lgIdx).length).toBeGreaterThan(40);
    const ids = new Set(list.map((x) => x.id));
    expect(ids.size).toBe(list.length);
    for (const x of list) {
      expect(Number.isFinite(x.before) && Number.isFinite(x.after)).toBe(true);
      expect(g.league.players.find((p) => p.id === x.id)!.team).toBeGreaterThanOrEqual(0);
    }
    const retired = new Set((g.league.retired ?? []).filter((r) => r.year === 2026).map((r) => r.id));
    expect(list.some((x) => retired.has(x.id))).toBe(false);
    const upShare = (lo: number, hi: number) => {
      const xs = list.filter((x) => x.age !== null && x.age >= lo && x.age <= hi && !x.tags?.includes('입대'));
      return xs.filter((x) => x.after > x.before).length / xs.length;
    };
    expect(upShare(18, 23)).toBeGreaterThan(0.6);
    expect(upShare(34, 45)).toBeLessThan(0.4);
    // 저장했다 불러와도 남는다
    expect(GameSession.load(store, roundTrip(g.toSave()), FAST).offseason!.growth).toEqual(list);
  });

  it('FA 제시 검사: 최저 연봉 미만, 샐러리캡 초과는 받지 않는다', () => {
    const e = g.offseason!.fa.entries.find((x) => x.from !== g.teamIdx)!;
    expect(g.offerFa(e.id, MIN_SALARY - 1, 2).ok).toBe(false);
    expect(g.offerFa(e.id, 1_000_000, 2).ok).toBe(false); // 100억
    expect(g.offerFa(e.id, e.ask * 1.2, e.years).ok).toBe(true);
  });

  it('FA: 요구액보다 넉넉히 제시하면 첫 라운드에 우리와 계약하고, 원 소속 구단에 보상금이 기록된다', () => {
    afterFa = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const e = afterFa.offseason!.fa.entries.find((x) => x.from !== afterFa.teamIdx && x.status === 'open')!;
    expect(afterFa.offerFa(e.id, Math.round(e.ask * 1.3), e.years).ok).toBe(true);
    afterFa.nextStage();
    const done = afterFa.offseason!.fa.entries.find((x) => x.id === e.id)!;
    expect(done.status).toBe('signed');
    expect(done.team).toBe(afterFa.teamIdx);
    const p = afterFa.leaguePlayer(e.id)!;
    expect(p.team).toBe(afterFa.teamIdx);
    expect(p.faCount).toBeGreaterThanOrEqual(1);
    const ledger = afterFa.league.ledger.find((l) => l.note.startsWith(p.name));
    expect(ledger?.to).toBe(e.from);
    expect(ledger?.amount).toBe(Math.round(COMPENSATION[e.grade] * e.prevSalary));
  });

  it('외국인: 끝나면 모든 구단이 아시아쿼터 빼고 3명 이하, 아시아쿼터 1명 이하, 금액 상한을 지킨다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage === 'fa') h.nextStage();
    expect(h.offseason!.stage).toBe('foreign');
    // 우리 차례: 후보 중 계약 가능한 선수 하나와 계약해 본다
    const pool = h.offseason!.foreign!.pool.map((id) => h.leaguePlayer(id)!);
    const cand = pool.find((p) => Off.canSignForeign(h.league, h.offseason!, h.teamIdx, p).ok);
    if (cand) expect(h.signForeign(cand.id).ok).toBe(true);
    h.nextStage();
    for (let t = 0; t < h.league.teams.length; t++) {
      const fs = h.league.players.filter((p) => p.team === t && p.foreign);
      const regular = fs.filter((p) => !p.asia);
      expect(regular.length, h.league.teams[t].name).toBeLessThanOrEqual(3);
      expect(fs.length - regular.length).toBeLessThanOrEqual(1);
      expect(regular.reduce((s, p) => s + p.contract.salary, 0)).toBeLessThanOrEqual(FOREIGN_TOTAL_CAP);
      for (const p of fs.filter((x) => !x.real)) expect(p.contract.salary).toBeLessThanOrEqual(p.asia ? ASIA_NEW_CAP : FOREIGN_NEW_CAP);
    }
  });

  it('드래프트: 11라운드, 전년도 순위 역순, 구단마다 11명, 2027 입단은 실제 지명 명단의 선수', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage !== 'draft') h.nextStage();
    expect(h.nextStage().ok).toBe(false); // 우리 차례에 멈춰 있다
    const firstPick = h.offseason!.draft!.picks[0];
    const st = h.league.lastSeason!.standings;
    if (firstPick) expect(firstPick.team).toBe(st[st.length - 1]);
    h.autoDraft();
    const d = h.offseason!.draft!;
    expect(d.picks).toHaveLength(110);
    for (let t = 0; t < 10; t++) expect(d.picks.filter((p) => p.team === t)).toHaveLength(11);
    // 같은 라운드 안 순서는 직전 시즌 성적 역순
    expect(d.picks.slice(0, 10).map((p) => p.team)).toEqual([...st].reverse());
    // 풀은 실제 2027 지명 명단 110명 그대로 (지명 구단은 게임 속 순위로 다시 정해진다)
    const list = Off.draftPool(store, 2027);
    expect(list).toHaveLength(110);
    expect(new Set(d.picks.map((pk) => h.leaguePlayer(pk.id)!.name))).toEqual(new Set(list.map((x) => x.name)));
    for (const pk of d.picks) {
      const p = h.leaguePlayer(pk.id)!;
      expect(p.real).toBe(true);
      expect(p.id.startsWith('d2027-')).toBe(true);
      expect(p.military?.state).toBe('pending');
    }
    const first = h.leaguePlayer('d2027-1')!; // 실제 전체 1순위 하현승 (부산고, 투수)
    expect(first.name).toBe('하현승');
    expect(first.isPitcher).toBe(true);
    expect(first.school).toBe('HS');
  });

  it('과거 연도 드래프트: 실제 기록이 있는 지명자는 실존 선수 id로 연결되고 잠재력이 실제 커리어를 따른다 (2005 시작, 류현진)', () => {
    const h = GameSession.create(store, { year: 2005, teamIdx: 0, seed: 'ryu' }, FAST);
    h.advance(100000);
    h.beginOffseason();
    while (h.offseason!.stage !== 'draft') h.nextStage();
    const ryu = h.leaguePlayer('76715')!; // 류현진: 실제 선수 id
    expect(ryu.name).toBe('류현진');
    expect(ryu.birthYear).toBe(1987);
    expect(ryu.potential).toBeGreaterThan(40); // 실제 전성기 기여 (지명 순번으로 만들면 10런 안팎이었다)
    // 1군에 오르지 못한 과거 지명자는 낮은 잠재력
    const ids = [...h.offseason!.draft!.pool, ...h.offseason!.draft!.picks.map((x) => x.id)];
    const never = ids.map((id) => h.leaguePlayer(id)!).filter((p) => p.id.startsWith('d2006-'));
    expect(never.length).toBeGreaterThan(0);
    for (const p of never) expect(p.potential).toBeLessThanOrEqual(0);
  }, 60_000);

  it('지명 명단이 없는 해의 드래프트는 실존 선수와 이름이 겹치지 않는 가상 신인', () => {
    const noList = { ...store, drafts: undefined };
    const h = GameSession.load(noList, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage !== 'draft') h.nextStage();
    h.autoDraft();
    const realNames = new Set([...store.players.values()].map((m) => m.name));
    for (const pk of h.offseason!.draft!.picks) {
      const p = h.leaguePlayer(pk.id)!;
      expect(p.real).toBe(false);
      expect(realNames.has(p.name), p.name).toBe(false);
    }
  });

  it('연봉 협상: 요구액 이상이면 제시액, 모자라면 가운데로 정한다', () => {
    expect(Off.settledSalary(12000, 10000)).toBe(12000);
    expect(Off.settledSalary(8000, 10000)).toBe(9000);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage !== 'salary') {
      if (h.offseason!.stage === 'draft') h.autoDraft();
      h.nextStage();
    }
    const s = h.offseason!.salary!;
    const [id, demand] = Object.entries(s.demands).find(([k]) => k in s.offers)!;
    expect(h.setSalaryOffer(id, MIN_SALARY - 1).ok).toBe(false);
    expect(h.setSalaryOffer(id, Math.max(MIN_SALARY, demand - 2000)).ok).toBe(true);
    h.nextStage();
    expect(h.leaguePlayer(id)!.contract.salary).toBe(Off.settledSalary(Math.max(MIN_SALARY, demand - 2000), demand));
    expect(h.leaguePlayer(id)!.contract.until).toBe(2027);
  });

  it('정원: 우리 구단이 68명을 넘으면 다음 단계로 못 가고, 정리하면 모든 구단이 68명 이하 (복무 중인 선수는 세지 않음)', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage !== 'release') {
      if (h.offseason!.stage === 'draft') h.autoDraft();
      h.nextStage();
    }
    const mine = () => h.league.players.filter((p) => p.team === h.teamIdx && !isServing(p)).length;
    if (mine() > ORG_LIMIT) expect(h.nextStage().ok).toBe(false);
    h.autoRelease();
    expect(h.nextStage().ok).toBe(true);
    for (let t = 0; t < 10; t++) expect(h.league.players.filter((p) => p.team === t && !isServing(p)).length).toBeLessThanOrEqual(ORG_LIMIT);
  });
});

describe('2026 시즌 종료 → 오프시즌 → 2027 개막과 완주 (M5 완료 기준)', () => {
  let g: GameSession;
  beforeAll(() => {
    g = toOffseason('cycle');
    finishOffseason(g);
  });

  it('2027 시즌이 열리고 끝까지 치르면 모든 팀이 144경기를 한다', () => {
    expect(g.phase).toBe('season');
    expect(g.year).toBe(2027);
    g.advance(1000);
    for (const t of g.season.teams) expect(t.g).toBe(144);
  });

  it('2027 리그 평균이 최근 실제 시즌 평균 근처다', () => {
    const recent = [2022, 2023, 2024, 2025, 2026].map((y) => store.season(y)!.league.runsPerTeamGame);
    const target = recent.reduce((a, b) => a + b, 0) / recent.length;
    const runs = g.season.totals.r / (g.season.totals.games * 2);
    expect(runs).toBeGreaterThan(target * 0.88);
    expect(runs).toBeLessThan(target * 1.12);
  });

  it('2027 시즌이 끝나면 다시 오프시즌을 열 수 있다 (2028 개막까지)', () => {
    g.beginOffseason();
    finishOffseason(g);
    expect(g.year).toBe(2028);
    g.advance(30);
    expect(g.season.teams.every((t) => t.g > 0)).toBe(true);
  });
});

describe('오프시즌 저장·불러오기와 재현', () => {
  it('오프시즌 중간에 저장(JSON)했다 불러와 끝까지 가면 끊지 않은 것과 같다', () => {
    const run = (save: boolean) => {
      let g = toOffseason('off-save');
      g.nextStage(); // FA 1라운드
      if (save) g = GameSession.load(store, roundTrip(g.toSave()), FAST);
      g.nextStage();
      g.nextStage();
      if (save) g = GameSession.load(store, roundTrip(g.toSave()), FAST);
      finishOffseason(g);
      g.advance(20);
      return g;
    };
    const a = run(false);
    const b = run(true);
    expect(b.league.players.map((p) => [p.id, p.team, p.contract.salary])).toEqual(a.league.players.map((p) => [p.id, p.team, p.contract.salary]));
    expect(b.season.teams).toEqual(a.season.teams);
  });

  it('조작 기록으로 처음부터 다시 돌리면 오프시즌을 지나 같은 상태가 된다', () => {
    const g = toOffseason('off-replay');
    const e = g.offseason!.fa.entries.find((x) => x.from !== g.teamIdx)!;
    g.offerFa(e.id, Math.round(e.ask * 1.25), e.years);
    finishOffseason(g);
    g.advance(12);
    const r = GameSession.replay(store, { year: 2026, teamIdx: g.teamIdx, seed: 'off-replay' }, g.actions, { year: 2027, day: g.day }, FAST);
    expect(r.year).toBe(2027);
    expect(r.day).toBe(g.day);
    expect(r.toSave().league).toEqual(g.toSave().league);
    expect(r.toSave().season).toEqual(g.toSave().season);
  });

  it('M4까지의 저장(형식 1)도 불러와 이어서 진행한다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgIdx, seed: 'v1' }, FAST);
    g.advance(10);
    const v2 = g.toSave();
    const v1 = { app: 'kbo-gm', format: 1, year: 2026, teamIdx: v2.teamIdx, teamName: v2.teamName, seed: v2.seed, season: v2.season, news: v2.news, actions: v2.actions } as GameSave;
    const h = GameSession.load(store, roundTrip(v1), FAST);
    expect(h.day).toBe(10);
    h.advance(5);
    g.advance(5);
    expect(h.season.teams).toEqual(g.season.teams);
  });
});
