// 자유 모드 (AI 진행): 게임 마스터 조작이 실제 게임을 바꾸고, 저장·불러오기·재현이 같다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { freeAction, freeContext, gradeOfRuns, resolveOps, runsForGrade } from '../src/fantasy/free';
import { currentRuns } from '../src/ai/value';
import { cashOf } from '../src/league/finance';
import { defenseAt, defenseGrade } from '../src/engine';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('자유 모드', () => {
  it('등급 ↔ 런', () => {
    for (const g of [30, 50, 65, 80]) expect(gradeOfRuns(runsForGrade(g, 2026), 2026)).toBe(g);
  });

  it('시즌 중: 다른 구단 선수 데려오기, 실존 선수 능력 바꾸기, 새 선수 만들기, 자금·계약 — 저장·재현이 같다', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'free-1', fantasy: { free: true } }, FAST);
    expect(g.fantasy!.free).toBe(true);
    g.advance(10);
    // 이름으로 조작: 삼성의 가장 좋은 국내 타자를 데려온다
    const sam = g.league.teams.findIndex((t) => t.name === '삼성');
    const star = g.world.teams[sam].org.filter((p) => !p.isPitcher && !p.foreign).sort((a, b) => b.value - a.value)[0];
    const mine = g.team.org.find((p) => !p.foreign && !p.isPitcher && p.real !== false)!;
    const { ops, dropped } = resolveOps(g, [
      { op: 'move', player: star.name, to: 'LG' },
      { op: 'move', player: mine.name, to: '삼성' },
      { op: 'ability', player: star.name, now: 75 },
      { op: 'create', name: '한별빛', team: 'LG', pos: 'P', age: 19, now: 55, potential: 78 },
      { op: 'contract', player: star.name, salary: 30, years: 4 },
      { op: 'cash', amount: 50 },
      { op: 'trust', delta: 20 },
      { op: 'move', player: '없는선수', to: 'LG' },
    ]);
    expect(dropped.length).toBe(1);
    const cash0 = cashOf(g.league, g.teamIdx);
    g.addFantasy({ kind: 'action', title: '대형 트레이드', text: 'x', ask: 'y', ops });
    expect(star.teamIdx).toBe(g.teamIdx);
    expect(g.world.players.find((p) => p.id === mine.id)!.teamIdx).toBe(sam);
    expect(gradeOfRuns(currentRuns(star, g.values), 2026)).toBeGreaterThanOrEqual(73);
    const born = g.world.players.find((p) => p.name === '한별빛')!;
    expect(born.teamIdx).toBe(g.teamIdx);
    expect(born.isPitcher).toBe(true);
    expect(g.marketPlayers().some((p) => p.reserve)).toBe(false);
    expect(g.leaguePlayer(star.id)!.contract).toMatchObject({ salary: 300000, until: 2029 });
    expect(cashOf(g.league, g.teamIdx)).toBe(cash0 + 500000);
    g.advance(15);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(roundTrip(h.toSave().league)).toEqual(roundTrip(g.toSave().league));
    expect(h.world.players.find((p) => p.name === '한별빛')!.teamIdx).toBe(g.teamIdx);
    h.advance(5); g.advance(5);
    expect(roundTrip(h.toSave().season)).toEqual(roundTrip(g.toSave().season));
    const info = g.reproInfo();
    expect(info.opts.fantasy).toEqual({ free: true });
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
    // 결산: 만든 선수는 남고, 쓰지 않은 빈 자리는 지운다
    g.advance(100000);
    g.beginOffseason();
    const lp = g.league.players.find((p) => p.name === '한별빛')!;
    expect(lp.team).toBe(g.teamIdx);
    expect(lp.reserve).toBeUndefined();
    expect(g.league.players.some((p) => p.reserve !== undefined)).toBe(false);
  }, 600_000);

  it('오프시즌: 만들기·이동은 리그 상태에 바로', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'free-2', fantasy: { free: true } }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const kia = g.league.teams.findIndex((t) => t.name === 'KIA');
    const target = g.league.players.filter((p) => p.team === kia && !p.foreign)[0];
    const { ops } = resolveOps(g, [{ op: 'create', name: '도하늘', team: 'LG', pos: 'OF', age: 24, now: 60, potential: 70 }, { op: 'move', player: `${target.name}@KIA`, to: 'LG' }]);
    g.addFantasy({ kind: 'action', title: 't', text: 'x', ops });
    expect(g.league.players.find((p) => p.name === '도하늘')!.team).toBe(g.teamIdx);
    expect(g.leaguePlayer(target.id)!.team).toBe(g.teamIdx);
  }, 600_000);

  it('시험용 AI 행동: 이야기와 조작이 남는다', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'free-3', fantasy: { free: true } }, FAST);
    const { entry } = await freeAction(g, store, { provider: 'mock', model: 'mock', key: '' }, '팬 사인회를 연다');
    g.addFantasy(entry);
    expect(g.fantasy!.log.at(-1)).toMatchObject({ kind: 'action', ask: '팬 사인회를 연다' });
    expect(g.fantasy!.log.at(-1)!.ops!.length).toBe(1);
  }, 120_000);

  it('리그 밖 정상급 마무리 영입 (2000년 선동열): 구원으로 만들고 1군에 바로 등록, 마무리로 던진다', () => {
    const team = store.season(2000)!.teams.findIndex((t) => t.name === 'SK');
    const g = GameSession.create(store, { year: 2000, teamIdx: team, seed: 'sun-t', fantasy: { free: true } }, FAST);
    const { ops } = resolveOps(g, [{ op: 'create', name: '선동열', team: 'SK', pos: 'P', role: '마무리', age: 37, now: 74, potential: 75, real: true }], store);
    expect(ops[0]).toMatchObject({ op: 'create', pos: 'P', role: 'RP' });
    g.addFantasy({ kind: 'action', title: '국보의 귀환', text: 'x', ops });
    const sp = g.world.players.find((p) => p.name === '선동열')!;
    expect(gradeOfRuns(currentRuns(sp, g.values), 2000)).toBeGreaterThanOrEqual(70);
    expect(g.registered().some((p) => p.idx === sp.idx)).toBe(true);
    g.advance(40); // 30일이면 세이브 기회가 적은 해에 등판 5번에 걸린다 (16-3 수비 v2 뒤)
    expect(g.season.teamSeasons[g.teamIdx].closer?.idx).toBe(sp.idx);
    expect(g.season.pit[sp.idx].g).toBeGreaterThan(5);
  }, 300_000);

  it('만든 야수는 그 주 포지션 기준 수비 (푸홀스 3루: 유격수 수비가 3루보다 낮다)', () => {
    const g = GameSession.create(store, { year: 2000, teamIdx: 0, seed: 'pujols', fantasy: { free: true } }, FAST);
    const { ops } = resolveOps(g, [{ op: 'create', name: '푸홀스', team: g.league.teams[0].name, pos: '3B', age: 20, now: 45, potential: 78, real: true }], store);
    expect(ops[0]).toMatchObject({ pos: '3B' });
    g.addFantasy({ kind: 'action', title: 't', text: 'x', ops });
    const sp = g.world.players.find((p) => p.name === '푸홀스')!;
    expect(sp.pos).toBe('3B');
    expect(defenseAt(sp, 'SS')).toBeLessThan(defenseAt(sp, '3B') - 5);
    expect(defenseAt(sp, 'CF')).toBeLessThan(defenseAt(sp, '3B') - 5);
    expect(defenseGrade(defenseAt(sp, 'C'))).toBe(20); // 능력치 v2: 안 해 본 자리는 등급 20 (16.4)
  }, 120_000);

  it('만든 선수의 국적·병역: 외국 이름은 외국인, 28세 이상 국내 선수는 병역 마침, 리그 밖 선수는 입대하지 않는다', () => {
    const g = GameSession.create(store, { year: 2000, teamIdx: 0, seed: 'mil-t', fantasy: { free: true } }, FAST);
    const team = g.league.teams[0].name;
    const { ops } = resolveOps(g, [
      { op: 'create', name: '선동열', team, pos: 'P', role: 'RP', age: 38, now: 70, potential: 70, real: true },
      { op: 'create', name: '멜빈 번치', team, pos: 'P', role: 'SP', age: 28, now: 55, potential: 55, real: true },
      { op: 'create', name: '김신인', team, pos: 'SS', age: 20, now: 40, potential: 60 },
    ], store);
    expect(ops[0]).toMatchObject({ military: 'done' });
    expect(ops[1]).toMatchObject({ foreign: true });
    expect(ops[2]).toMatchObject({ military: 'pending' });
    g.addFantasy({ kind: 'action', title: 't', text: 'x', ops });
    const sun = g.league.players.find((p) => p.name === '선동열')!;
    const bunch = g.league.players.find((p) => p.name === '멜빈 번치')!;
    expect(sun.military?.state).toBe('done');
    expect(bunch.foreign).toBe(true);
    expect(bunch.contract.kind).toBe('foreign');
    g.advance(100000);
    g.beginOffseason();
    expect(g.leaguePlayer(sun.id)!.military?.state).not.toBe('serving');
    expect(g.leaguePlayer(bunch.id)!.military?.state).not.toBe('serving');
  }, 600_000);

  it('입단 예약·단장 노트: 2000년에 후원한 그레인키(1983년생)는 만 17세 이후 정한 해 개막 때 실제로 들어온다', () => {
    // 시드: 2001 시즌 뒤 해고되면 개막을 못 해 입단이 시험되지 않는다. 엔진이 바뀌어 해고되면 시드를 바꾼다 (2026-10-21 첫 시즌 밸런스 때 pipe → pipe-2, 같은 날 입대 규칙(상무 정원·현역) 때 pipe-3, 2026-10-22 하드힛 투구손 채움 때 pipe-4, 같은 날 구장 효과 때 pipe-5, 엔진 2 6단계 타구 모형 2 때 pipe-6, 15단계 시간 제한 흉내 값 때 pipe-7, 능력치 v2 16-2 타구각 때 pipe-10 (pipe-8·9는 2001 뒤 FA 단계에서 멈춤), 16-3b AI 전력 배치 벌점 때 pipe-11)
    const g = GameSession.create(store, { year: 2000, teamIdx: 0, seed: 'pipe-11', fantasy: { free: true } }, FAST);
    const team = g.league.teams[0].name;
    const { ops, dropped } = resolveOps(g, [
      { op: 'future', name: '잭 그레인키', team, pos: 'P', role: 'SP', birthYear: 1983, joinYear: 2002, now: 50, potential: 75 },
      { op: 'future', name: '오타니 쇼헤이', team, pos: 'P', birthYear: 1994, joinYear: 2003, now: 45, potential: 80 },
    ], store);
    expect(dropped).toEqual([]);
    expect(ops[1]).toMatchObject({ joinYear: 2011, foreign: true }); // 만 17세 전에는 못 들어온다
    g.addFantasy({ kind: 'action', title: '글로벌 아카데미', text: 'x', ops, notes: ['SK 글로벌 아카데미: 그레인키 2002, 오타니 2011 입단 예약'] });
    expect(g.fantasy!.pipeline!.length).toBe(2);
    expect(g.fantasy!.notes![0]).toMatchObject({ id: 'n1' });
    expect(freeContext(g, store)).toContain('[단장 노트]');
    expect(freeContext(g, store)).toContain('[입단 예약]');
    for (let y = 2000; y < 2002; y++) {
      g.advance(100000);
      g.beginOffseason();
      for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
        const st = g.offseason!.stage;
        if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
        g.nextStage();
      }
      g.openNextSeason();
    }
    const gr = g.league.players.find((p) => p.name === '잭 그레인키');
    expect(gr?.team).toBe(0);
    expect(gr?.foreign).toBe(true);
    expect(g.fantasy!.pipeline!.map((x) => x.name)).toEqual(['오타니 쇼헤이']);
  }, 900_000);
});
