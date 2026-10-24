// M5 오프시즌: 리그 상태, 잠재력·성장, FA, 외국인, 드래프트, 연봉, 정원, 2027 개막까지.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, worldForYear } from '../src/engine';
import { GameSession, type GameSave } from '../src/game/session';
import { isServing } from '../src/league/careers';
import { createLeague, openingForeigners, openingTeamMoves } from '../src/league/create';
import * as Off from '../src/league/offseason';
import {
  ASIA_NEW_CAP, COMPENSATION, FA_COMP, faEligible, faGrade, foreignContractTotal, FOREIGN_NEW_CAP, FOREIGN_TOTAL_CAP, foreignTeamCap, MIN_SALARY, ORG_LIMIT, salaryCap, serviceNeeded,
} from '../src/league/salary';
import { careerIndex } from '../src/league/growth';
import { ageWidth, draftIndex, gradeRuns, rankCenterRuns, runsPerGrade, sampleScale, triangular } from '../src/league/potential';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

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

/** 다음 단계로 (FA 보상선수 단계면 우리 보상을 자동으로 고른 뒤) */
function step(g: GameSession): void {
  if (g.offseason!.stage === 'comp') g.autoComp();
  g.nextStage();
}

/** 플레이어 결정을 모두 자동으로 해서 오프시즌을 끝내고 개막한다 */
function finishOffseason(g: GameSession): void {
  let guard = 0;
  while (g.offseason && g.offseason.stage !== 'ready' && guard++ < 50) {
    // 시드에 따라 해고될 수 있다: 첫 영입 제의를 받아들이고 이어 간다
    const offers = g.league.owner?.offers;
    if (offers?.length) g.acceptOffer(offers[0]);
    if (g.offseason.stage === 'draft') g.autoDraft();
    if (g.offseason.stage === 'comp') g.autoComp();
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
    // 개막 명단에 없던 외국인(시즌 중 교체돼 들어온 선수)은 소속 없이 시즌 중 시장 후보로 들어온다 (market.ts)
    const late = ref.players.filter((p) => p.foreign && !opening.has(p.id) && !special.has(p.id)).map((p) => p.id).sort();
    expect(world.players.filter((p) => p.teamIdx === -1 && !p.id.startsWith('v')).map((p) => p.id).sort()).toEqual(late);
    // 특별 엔트리(은퇴식 등으로 하루 등록된 선수)는 빠진다
    expect(world.players.some((p) => p.name === '박병호')).toBe(false);
    // 1군 기록 없는 2026 신인(d2026-)은 따로 더해진다 (다음 테스트)
    const recorded = world.players.filter((p) => !p.id.startsWith('d2026-') && p.teamIdx >= 0);
    // 시즌 중 이적한 개막 외국인(2026 데이비슨: 개막 NC, 기록 키움)은 개막 구단에서 시작한다
    const moves = openingTeamMoves(store, 2026);
    const teamOf = new Map(ref.teams.map((t) => [t.name, t.idx]));
    expect(moves.get('54944')).toBe('NC');
    expect(recorded.map((p) => `${p.id}@${p.teamIdx}`)).toEqual(kept.map((p) => `${p.id}@${moves.has(p.id) ? teamOf.get(moves.get(p.id)!) : p.teamIdx}`));
    // 능력도 같다. 다만 시작 연도 국내 신인은 그 해 기록 대신 지명 신인 생성기로 매긴다 (잠재력 v2 Q11 ①, create.ts)
    const rookie = (id: string) => { const m = store.players.get(id)!; return !m.foreign && m.entryYear >= 2026; };
    expect(recorded.filter((p) => !rookie(p.id)).map((p) => p.value)).toEqual(kept.filter((p) => !rookie(p.id)).map((p) => p.value));
    expect(recorded.filter((p) => rookie(p.id)).length).toBeGreaterThan(0);
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
    // 나무위키 계약표의 개막 선수 미치 화이트(55855)는 SSG, 출전량 추정으로 넣었던 아빌라는 시즌 중 교체 선수라 시장 후보
    expect(league.players.find((p) => p.id === '55855')?.team).toBe(ssg);
    expect(league.players.find((p) => p.name === '아빌라')?.team).toBe(-1);
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
      expect(g.league.players.find((p) => p.id === x.id)!.team).toBeGreaterThanOrEqual(-2); // −2: 이번 오프시즌 해외 진출 (overseas.ts)
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
    // 요구액이 가장 적은 외부 FA (2026-10-12 투수 가치를 올린 뒤 첫 외부 FA의 1.2배가 샐러리캡을 넘었다)
    const e = g.offseason!.fa.entries.filter((x) => x.from !== g.teamIdx).sort((a, b) => a.ask - b.ask)[0];
    expect(g.offerFa(e.id, MIN_SALARY - 1, 2).ok).toBe(false);
    expect(g.offerFa(e.id, 1_000_000, 2).ok).toBe(false); // 100억
    expect(g.offerFa(e.id, e.ask * 1.2, e.years).ok).toBe(true);
  });

  it('FA: 요구액보다 넉넉히 제시하면 첫 라운드에 우리와 계약하고, 원 소속 구단에 보상이 간다 (C등급은 보상금, A·B등급은 보상선수 단계)', () => {
    afterFa = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const e = afterFa.offseason!.fa.entries.filter((x) => x.from !== afterFa.teamIdx && x.status === 'open').sort((a, b) => a.ask - b.ask)[0];
    expect(afterFa.offerFa(e.id, Math.round(e.ask * 1.3), e.years).ok).toBe(true);
    afterFa.nextStage();
    const done = afterFa.offseason!.fa.entries.find((x) => x.id === e.id)!;
    expect(done.status).toBe('signed');
    expect(done.team).toBe(afterFa.teamIdx);
    const p = afterFa.leaguePlayer(e.id)!;
    expect(p.team).toBe(afterFa.teamIdx);
    expect(p.faCount).toBeGreaterThanOrEqual(1);
    if (e.grade === 'C') {
      // 보상금 (원 소속 구단이 받는 돈). 같은 선수 이름으로 계약금 줄도 있다
      const ledger = afterFa.league.ledger.find((l) => l.note.startsWith(p.name) && l.to === e.from);
      expect(ledger?.to).toBe(e.from);
      expect(ledger?.amount).toBe(Math.round(COMPENSATION[e.grade] * e.prevSalary));
    } else {
      // 보상선수 단계는 FA 시장이 끝난 뒤 열린다
      while (afterFa.offseason!.stage === 'fa') afterFa.nextStage();
      const c = afterFa.offseason!.comp!.find((x) => x.fa === e.id)!;
      expect(c.to).toBe(afterFa.teamIdx);
      expect(c.from).toBe(e.from);
    }
  });

  it('FA: 우리 제시가 요구에 못 미치면 그 라운드에 알림이 남는다 (2026-10-12)', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const e = h.offseason!.fa.entries.filter((x) => x.from !== h.teamIdx && x.status === 'open' && x.ask > MIN_SALARY * 3).sort((a, b) => b.ask - a.ask)[0];
    expect(h.offerFa(e.id, MIN_SALARY, e.years).ok).toBe(true);
    const before = h.offseason!.log.length;
    h.nextStage();
    const notes = h.offseason!.log.slice(before).filter((l) => l.mine && l.text.startsWith(`${h.leaguePlayer(e.id)!.name}: 우리 제시`));
    expect(notes.length).toBe(1);
    expect(notes[0].text).toMatch(/받아들여지지 않았습니다|선택되지 않았습니다/);
  });

  it('외국인: 끝나면 모든 구단이 아시아쿼터 빼고 3명 이하, 아시아쿼터 1명 이하, 금액 상한을 지킨다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage === 'fa' || h.offseason!.stage === 'comp') step(h);
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
      // 총액은 연봉 + 계약금, 상한은 기본 400만 달러 + 재계약 외국인마다 같은 구단 재계약 연차 × 10만 달러 (사용자 조사 2026-10-22)
      const cap = foreignTeamCap(h.league, t, h.offseason!.year + 1, regular);
      expect(cap).toBeGreaterThanOrEqual(FOREIGN_TOTAL_CAP);
      expect(regular.reduce((s, p) => s + foreignContractTotal(p.contract), 0), h.league.teams[t].name).toBeLessThanOrEqual(cap);
      // 새로 온 가상 외국인만 신규 상한 (시즌 중 시장에서 데려와 뛴 가상 외국인은 재계약이라 상한이 다르다, market.ts)
      for (const p of fs.filter((x) => !x.real && !x.history.length)) expect(p.contract.salary).toBeLessThanOrEqual(p.asia ? ASIA_NEW_CAP : FOREIGN_NEW_CAP);
    }
  });

  it('드래프트: 11라운드, 전년도 순위 역순, 구단마다 11명, 2027 입단은 실제 지명 명단의 선수', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage !== 'draft') step(h);
    expect(h.nextStage().ok).toBe(false); // 우리 차례에 멈춰 있다
    const firstPick = h.offseason!.draft!.picks[0];
    const st = h.league.lastSeason!.standings;
    if (firstPick) expect(firstPick.team).toBe(st[st.length - 1]);
    h.autoDraft();
    const d = h.offseason!.draft!;
    expect(d.picks).toHaveLength(110);
    // 원래 구단 기준으로 11장씩 (AI 구단끼리 지명권을 주고받으면 실제로 뽑는 구단은 달라진다, league/gm.ts)
    for (let t = 0; t < 10; t++) expect(d.picks.filter((p, i) => (d.orig?.[i] ?? p.team) === t)).toHaveLength(11);
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
    while (h.offseason!.stage !== 'draft') step(h);
    const ryu = h.leaguePlayer('76715')!; // 류현진: 실제 선수 id
    expect(ryu.name).toBe('류현진');
    expect(ryu.birthYear).toBe(1987);
    // 잠재력 v2 (기획안 18.3): 천장 = 지명 순위 표 중심 + ¼ × (실제 커리어 고점 − 표 중심) + 입단 나이 폭 × z.
    // 천장은 판마다 뽑히므로 같은 z로 중심을 거꾸로 구해 본다 (천장이 지금 능력에 붙은 판은 뺀다)
    const zOf = (p: LeaguePlayer) => triangular(new Rng(`ryu/pa/${p.id}`));
    const centerOf = (p: LeaguePlayer) => p.potential - ageWidth(2006 - p.birthYear! + 1) * sampleScale(0) * runsPerGrade(2006) * zOf(p);
    const info = draftIndex(store).get('76715')!;
    expect(info.entryYear).toBe(2006);
    expect(centerOf(ryu)).toBeGreaterThan(rankCenterRuns(info) + 3); // 실제 전성기 쪽으로 당겨짐
    // 1군에 오르지 못한 과거 지명자는 당기지 않는다: 중심이 순위 표 값 그대로 (z ≥ 0이면 천장이 지금 능력에 붙지 않는다)
    const table = [44, 45, 46, 47, 50, 51, 53].map((g) => gradeRuns(g, 2006));
    const ids = [...h.offseason!.draft!.pool, ...h.offseason!.draft!.picks.map((x) => x.id)];
    const never = ids.map((id) => h.leaguePlayer(id)!).filter((p) => p.id.startsWith('d2006-') && zOf(p) >= 0);
    expect(never.length).toBeGreaterThan(0);
    for (const p of never) expect(Math.min(...table.map((t) => Math.abs(centerOf(p) - t))), p.name).toBeLessThan(1e-6);
  }, 60_000);

  it('지명 포지션과 실제 커리어가 다른 선수는 실제 커리어를 따른다 (이대호·나성범 야수, 김재윤 투수)', () => {
    const empty = { players: [] } as unknown as LeagueState;
    const career = () => careerIndex(store);
    const row = (year: number, name: string) => store.drafts![String(year)].find((d) => d.name === name)!;
    const daeho = Off.matchDraftee(store, row(2001, '이대호'), 2001, empty)!; // 2001년 투수로 지명
    expect(daeho?.id).toBe('71564');
    expect(Off.masterIsPitcher(daeho, career)).toBe(false);
    const na = Off.matchDraftee(store, row(2012, '나성범'), 2012, empty)!; // 2012년 투수로 지명, 마스터는 야수(B)라 수정 전에는 연결이 끊겼다
    expect(na?.id).toBe('62947');
    expect(Off.masterIsPitcher(na, career)).toBe(false);
    const jy = Off.matchDraftee(store, row(2015, '김재윤'), 2015, empty)!; // 포수로 지명, 마무리 투수로 성공
    expect(jy).not.toBeNull();
    expect(Off.masterIsPitcher(jy, career)).toBe(true);
  });

  it('지명 명단이 없는 해의 드래프트는 실존 선수와 이름이 겹치지 않는 가상 신인', () => {
    const noList = { ...store, drafts: undefined };
    const h = GameSession.load(noList, roundTrip(g.toSave()), FAST);
    while (h.offseason!.stage !== 'draft') step(h);
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
      step(h);
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
      step(h);
    }
    const mine = () => h.league.players.filter((p) => p.team === h.teamIdx && !isServing(p) && !p.dev).length;
    if (mine() > ORG_LIMIT) expect(h.nextStage().ok).toBe(false);
    h.autoRelease();
    expect(h.nextStage().ok).toBe(true);
    for (let t = 0; t < 10; t++) expect(h.league.players.filter((p) => p.team === t && !isServing(p) && !p.dev).length).toBeLessThanOrEqual(ORG_LIMIT);
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

describe('FA 보상선수 (A·B등급 이적)', () => {
  // 여러 시드로 결산해 A·B등급 이적이 있는 오프시즌을 찾는다
  let h: GameSession;
  beforeAll(() => {
    for (const seed of ['comp-1', 'comp-2', 'comp-3', 'comp-4']) {
      const g = toOffseason(seed);
      while (g.offseason!.stage === 'fa') g.nextStage();
      if (g.offseason!.stage === 'comp') { h = g; break; }
    }
  }, 300_000);

  it('보호 인원(A 20명, B 25명)을 지키고, 외국인·군 보류·이번 FA 계약 선수는 명단에 넣지 않는다', () => {
    expect(h, 'A·B등급 이적이 있는 시드가 없습니다').toBeDefined();
    const off = h.offseason!;
    for (const c of off.comp!) {
      expect(c.protect.length).toBeLessThanOrEqual(c.grade === 'A' ? 20 : 25);
      for (const id of c.protect) {
        const p = h.leaguePlayer(id)!;
        expect(p.team).toBe(c.to);
        expect(Off.autoProtected(off, p)).toBe(false);
      }
    }
  });

  it('마감하면 보상선수는 원 소속 구단으로 옮기고(보호 명단·자동 보호 밖 선수), 보상금이 장부에 남는다', () => {
    const off = h.offseason!;
    const before = new Map(off.comp!.map((c) => [c.fa, Off.compCandidates(h.league, off, c).map((p) => p.id)]));
    if (off.comp!.some((c) => c.from === h.teamIdx)) {
      expect(h.nextStage().ok).toBe(false); // 우리 보상을 고르기 전에는 넘어갈 수 없다
      h.autoComp();
    }
    expect(h.nextStage().ok).toBe(true);
    expect(h.offseason!.stage).toBe('foreign');
    // AI는 보호 밖에 쓸 만한 선수가 있으면 선수를 고른다 (보상금만 고르는 것은 예외여야 한다)
    expect(h.offseason!.comp!.some((c) => c.pick !== 'cash')).toBe(true);
    for (const c of h.offseason!.comp!) {
      expect(c.pick).not.toBeNull();
      const fa = h.leaguePlayer(c.fa)!;
      const ledger = h.league.ledger.find((l) => l.note.startsWith(`${fa.name} FA 보상금`))!;
      expect(ledger.to).toBe(c.from);
      if (c.pick === 'cash') {
        expect(ledger.amount).toBe(Math.round((c.grade === 'A' ? 3 : 2) * c.prevSalary));
      } else {
        expect(before.get(c.fa)).toContain(c.pick);
        expect(h.leaguePlayer(c.pick!)!.team).toBe(c.from);
        expect(ledger.amount).toBe(Math.round((c.grade === 'A' ? 2 : 1) * c.prevSalary));
      }
    }
  });

  it('보호선수 명단 검사: 다른 구단 선수나 인원 초과는 받지 않는다', () => {
    const off = { ...h.offseason!, stage: 'comp' as const };
    const c = { ...off.comp![0], to: h.teamIdx, pick: null };
    off.comp = [c];
    off.userTeam = h.teamIdx;
    const pool = Off.protectPool(h.league, off, c).map((p) => p.id);
    const other = h.league.players.find((p) => p.team >= 0 && p.team !== h.teamIdx)!;
    expect(Off.setProtectByUser(h.league, off, c.fa, [other.id]).ok).toBe(false);
    expect(Off.setProtectByUser(h.league, off, c.fa, pool.slice(0, (c.grade === 'A' ? 20 : 25) + 1)).ok).toBe(false);
    expect(Off.setProtectByUser(h.league, off, c.fa, pool.slice(0, 5)).ok).toBe(true);
  });
});

describe('등급제 전 FA 보상 (1-5, 조사값)', () => {
  it('등급: 2010 시즌 뒤까지 P1, 2011~2019 시즌 뒤 P2, 2020 시즌 뒤부터 A·B·C', () => {
    const { league } = createLeague(store, 2026, 's', FAST);
    const top = [...league.players].filter((p) => !p.foreign).sort((a, b) => b.contract.salary - a.contract.salary)[0];
    const p = { ...top, faCount: 0, birthYear: 2026 + 1 - 30 } as LeaguePlayer;
    expect(faGrade(p, league.players, 1999)).toBe('P1');
    expect(faGrade(p, league.players, 2005)).toBe('P1');
    expect(faGrade(p, league.players, 2010)).toBe('P1');
    expect(faGrade(p, league.players, 2011)).toBe('P2');
    expect(faGrade(p, league.players, 2019)).toBe('P2');
    expect(faGrade(p, league.players, 2020)).toBe('A');
    expect(faGrade(p, league.players, 2021)).toBe('A');
    expect(FA_COMP.P1).toEqual({ cashOnly: 4.5, withPlayer: 3, protect: 18 });
    expect(FA_COMP.P2).toEqual({ cashOnly: 3, withPlayer: 2, protect: 20 });
  });

  // 시대별 오프시즌: FA 신청 등급, 보상선수 단계의 보호 인원, 보상금
  for (const [year, grades, protect] of [[2005, ['P1'], 18], [2015, ['P2'], 20], [2021, ['A', 'B', 'C'], null]] as const) {
    it(`${year} 시즌 뒤: FA 등급 ${grades.join('·')}${protect ? `, 보호 ${protect}명` : ''}`, () => {
      const g = GameSession.create(store, { year, teamIdx: 0, seed: `comp-${year}` }, FAST);
      g.advance(1000);
      g.beginOffseason();
      const entries = g.offseason!.fa.entries.filter((e) => !e.returnee);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => (grades as readonly string[]).includes(e.grade))).toBe(true);
      while (g.offseason!.stage === 'fa') g.nextStage();
      const cases = g.offseason!.comp ?? [];
      for (const c of cases) {
        if (protect) {
          expect(c.grade).toBe(grades[0]);
          expect(c.protect.length).toBeLessThanOrEqual(protect);
        }
      }
      if (g.offseason!.stage === 'comp') { g.autoComp(); g.nextStage(); }
      for (const c of cases) {
        const name = g.leaguePlayer(c.fa)!.name;
        const l = g.league.ledger.find((x) => x.note.startsWith(`${name} FA 보상금`) && x.to === c.from)!;
        const rule = FA_COMP[c.grade];
        expect(l.amount).toBe(Math.round((c.pick === 'cash' ? rule.cashOnly : rule.withPlayer!) * c.prevSalary));
      }
    });
  }
});
