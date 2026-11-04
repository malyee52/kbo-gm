// 100시즌 평가 (docs/평가100.md): 게임 세션(GameSession)을 실제 플레이처럼 몰아 여러 시즌을 진행하고, 평가 항목 재료를 JSON으로 남긴다.
// 점수는 tools/eval100_score.ts가 이 JSON들을 읽어 매긴다.
//
// 사용법:  npx tsx tools/eval100.ts --team LG --seed eval-lg --seasons 100 --out reports/eval100/raw/LG-eval-lg.json [--pilot 3]
//
// 진행 단위 (2026-11-04 사용자 지시 "시행 단위는 7일 진행으로 고정, 가을야구는 직접 전 경기 진행"):
// - 정규시즌: session.advance(7, 멈춤 규칙)을 되풀이한다. 멈춤(이벤트·트레이드 제안·트레이드 마감·육성 등록일)이 오면
//   대리 단장(아래 규칙)이 그때 필요한 결정을 하고 남은 날을 이어서 진행한다. 7일을 다 채우면 그 주의 결정함을 본다.
// - 가을야구: session.advancePostseason(1)로 한 경기씩 전 경기.
// - 오프시즌: 단계마다 결정함에 있는 일을 조작(session의 dispatchOff 경로)으로 처리하고 nextStage → openNextSeason.
// 대리 단장 규칙은 docs/평가100.md 2장에 적었다. 플레이어 구단만 대리 단장이 맡고 나머지 9구단은 게임 AI 그대로다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyBatLine, emptyPitLine, isSpecificEvent, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { decisions } from '../src/ui/decisions';
import { currentRuns } from '../src/ai/value';
import { runsNow } from '../src/league/careers';
import { batWarOf, pitWarOf } from '../src/league/war';
import { salaryCap, teamCapPayroll, wageIndex } from '../src/league/salary';
import { capFloorShorts } from '../src/league/owner';
import { ruleOf } from '../src/league/rules';
import * as Off from '../src/league/offseason';
import type { LeaguePlayer } from '../src/league/types';
import { installCalCache } from './calCache';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };

const BK = Object.keys(emptyBatLine()) as (keyof ReturnType<typeof emptyBatLine>)[];
const PK = Object.keys(emptyPitLine()) as (keyof ReturnType<typeof emptyPitLine>)[];
const B = Object.fromEntries(BK.map((k, i) => [k, i])) as Record<(typeof BK)[number], number>;
const P = Object.fromEntries(PK.map((k, i) => [k, i])) as Record<(typeof PK)[number], number>;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** 선수 한 시즌 (1군): [연도, 구단, WAR, 타석, 아웃, 홈런, 승, 세이브, 나이(없으면 -1), 탈삼진(투), 홀드] */
export type SeasonRow = [number, number, number, number, number, number, number, number, number, number, number];

export interface PlayerRec {
  n: string; real: boolean; pit: boolean; birth: number | null; foreign: boolean; asia: boolean; entry: number;
  school: string | null; /** 처음 본 해의 잠재 (런, 숨은 값: 도구만 본다) */ pot0: number; first: number; twoWay?: true;
  s: SeasonRow[];
  /** 은퇴한 해·나이, 입대한 해들 */
  retired?: number; retAge?: number | null; enlisted?: number[];
}

export interface YearRow {
  y: number; secs: number; userTeam: number;
  champ: number | null; ru: number | null; seeds: number[];
  st: number[]; w: number[]; l: number[]; t: number[]; homeW: number; homeL: number;
  runsPg: number; hrPa: number; era: number; avg: number;
  lead: { hr: number; avg: number; w: number; so: number; sv: number; hld: number; sb: number };
  cnt: { hr50: number; hr40: number; hr30: number; avg400: number; avg300: number; w20: number; w15: number; ip180: number; sv30: number; qPit: number; qBat: number; era1: number };
  fin: { cash: number; net: number; rescue: number; debt: number; rev: number; pay: number; att: number }[];
  wage: number; cap: number | null; capOver: number; floorShort: number;
  fa: { filed: number; signed: number; moved: number; money: number; star: number; starMoved: number; outsideUser: number };
  aiTrades: number; aiTradeStar: number; userTrades: number; offers: number; offersOk: number; offersAccepted: number;
  market: Record<string, number>;
  retired: number; serving: number; enlist: number; pendingOld: number;
  inj: number; major: number; events: number; specificReal: number;
  foreign: number[]; asiaN: number; twoWay: number;
  mvp: { id: string; team: number; war: number } | null; rookie: { id: string; team: number; war: number } | null;
  titlesNew: number; legendsNew: number;
  owner: { trust: number; achieved: boolean | null; fired: boolean; achievements: number };
  mgrChanges: number; orgMax: number; orgLimit: number; unsignedFa: number;
  stops: { weeks: number; stops: number; zero: number; events: number; stageFail: number };
}

function main(): void {
  installCalCache();
  const store = loadDataStore();
  const start = Number(arg('start', '2026'));
  const teamArg = arg('team', 'LG')!;
  const seed = arg('seed', `eval-${teamArg}`)!;
  const n = Number(arg('seasons', '100'));
  const out = arg('out', `reports/eval100/raw/${teamArg}-${seed}.json`)!;
  const params: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: Number(arg('pilot', String(DEFAULT_PARAMS.pilotSeasons))) };
  const teams = store.season(start)!.teams;
  const teamIdx = /^\d+$/.test(teamArg) ? Number(teamArg) : teams.findIndex((t) => t.name === teamArg);
  if (teamIdx < 0) throw new Error(`구단을 찾을 수 없습니다: ${teamArg}`);
  const g = GameSession.create(store, { year: start, teamIdx, seed }, params);
  const focus = teamIdx; // 처음 맡은 구단 (해고돼도 구단 지표는 이 구단으로)
  const players: Record<string, PlayerRec> = {};
  const years: YearRow[] = [];
  const errors: string[] = [];
  const t00 = Date.now();
  const save = () => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ mgr: (g.league.managerLog ?? []).map((m) => [m.year, m.team]), ownerHist: g.owner.history.map((h) => [h.year, h.team, h.achieved ? 1 : 0, h.trustAfter]), meta: { team: teamArg, teamIdx, focus, seed, start, seasons: years.length, wanted: n, pilot: params.pilotSeasons, secs: (Date.now() - t00) / 1000, teams: g.league.teams.map((t) => t.franchise) }, years, players, errors }));
  };

  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const stops = { weeks: 0, stops: 0, zero: 0, events: 0, stageFail: 0 };
    let offers = 0, offersOk = 0, offersAccepted = 0;
    const year = g.year;
    try {
      // ---- 정규시즌: 7일씩
      const STOPS = { event: true, tradeOffer: true, injury: false, injuryDays: 3, losing: false, losingN: 5, deadline: true, devDay: true, cast: false, crisis: false };
      while (g.phase === 'season' && !g.done) {
        let left = 7;
        stops.weeks++;
        let guard = 0;
        while (left > 0 && !g.done && guard++ < 20) {
          const d = g.advance(left, STOPS);
          left -= d;
          if (g.pendingEvent) {
            stops.stops++; stops.events++;
            const ev = g.pendingEvent;
            let choice = 0;
            if (ev.id === 'trade-offer' && !ev.vars?.none) {
              offers++;
              const give = g.world.players.find((p) => p.id === String(ev.vars!.give));
              const get = g.world.players.find((p) => p.id === String(ev.vars!.get));
              if (give && get) {
                const ctx = g.values;
                const a = currentRuns(give, ctx), b = currentRuns(get, ctx);
                if (b >= a * 1.15 + 0.3) { choice = 1; offersOk++; }
              }
            }
            const res = g.answerEvent(choice);
            if (choice === 1 && res.ok) offersAccepted++;
            continue;
          }
          if (d === 0) {
            if (g.stopped) { stops.stops++; continue; } // 마감일·육성 등록일 멈춤: 대리 단장은 바꿀 것이 없어 이어서 진행
            stops.zero++;
            break;
          }
        }
        // 그 주의 결정함: 막히는 일만 처리 (재활 복귀 선택은 기본 = 원래 선수 복귀)
        for (const dcs of decisions(g)) {
          if (dcs.key === 'owner-offers' && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
        }
        if (stops.zero > 3) throw new Error(`${year} 정규시즌 진행이 멈춤 (day ${g.currentDay})`);
      }
      // ---- 가을야구: 한 경기씩
      let psGuard = 0;
      while (g.postseasonRunning && psGuard++ < 200) g.advancePostseason(1);
      // ---- 결산 (입대는 추천대로)
      g.beginOffseason();
      collectSeason(g, players, year);
      const row = yearRow(g, year, focus, players);
      // ---- 오프시즌: 단계마다
      let outsideTried = false;
      let og = 0;
      while (g.phase === 'offseason' && og++ < 120) {
        const off = g.offseason!;
        if (g.owner.offers?.length) { row.owner.fired = true; g.acceptOffer(g.owner.offers[0]); continue; }
        if (off.stage === 'fa') {
          faRound(g, outsideTried);
          outsideTried = true;
        } else if (off.stage === 'comp') g.autoComp();
        else if (off.stage === 'foreign') signForeigners(g);
        else if (off.stage === 'draft') g.autoDraft();
        else if (off.stage === 'release') g.autoRelease();
        if (off.stage === 'ready') {
          fillOffseason(g, row, focus);
          const r = g.openNextSeason();
          if (!r.ok) { stops.stageFail++; errors.push(`${year} 개막 실패: ${r.message}`); break; }
          break;
        }
        const r = g.nextStage();
        if (!r.ok) {
          stops.stageFail++;
          if (stops.stageFail > 5) throw new Error(`${year} 오프시즌 ${off.stage} 단계 넘김 실패: ${r.message}`);
        }
      }
      row.offers = offers; row.offersOk = offersOk; row.offersAccepted = offersAccepted;
      row.stops = stops;
      row.secs = (Date.now() - t0) / 1000;
      years.push(row);
      console.log(`[${teamArg}/${seed}] ${year}: ${row.secs.toFixed(0)}초, 우승 ${row.champ === null ? '-' : g.league.teams[row.champ].franchise}, 득점 ${row.runsPg.toFixed(2)}, 주 ${stops.weeks}·멈춤 ${stops.stops}, 신뢰 ${row.owner.trust}`);
    } catch (e) {
      errors.push(`${year}: ${(e as Error).stack ?? e}`);
      console.error(e);
      break;
    }
    if (i % 5 === 4) save();
  }
  save();
  console.log(`${out}에 썼습니다 (${years.length}시즌, ${((Date.now() - t00) / 1000).toFixed(0)}초)`);
}

/** FA 단계 한 라운드: 우리 FA 붙잡기 + 바깥 FA 한 명까지 (대리 단장 규칙 2.3) */
function faRound(g: GameSession, outsideTried: boolean): void {
  const off = g.offseason!;
  const ctx = g.values;
  const me = g.teamIdx;
  const byId = new Map(g.league.players.map((p) => [p.id, p]));
  const open = off.fa.entries.filter((e) => e.status === 'open' && !off.fa.userOffers[e.id]);
  for (const e of open.filter((x) => x.from === me)) {
    const p = byId.get(e.id);
    if (!p) continue;
    const runs = runsNow(p, ctx, g.year + 1);
    if (runs < 1.0) continue;
    const rg = g.faAcceptRange(e.id);
    const salary = Math.ceil(Math.max(e.ask, rg?.hi ?? 0));
    g.offerFa(e.id, salary, e.years);
  }
  if (outsideTried) return;
  const outside = open.filter((x) => x.from !== me).map((e) => ({ e, runs: byId.get(e.id) ? runsNow(byId.get(e.id)!, ctx, g.year + 1) : 0 }))
    .filter((x) => x.runs >= 2.5).sort((a, b) => b.runs - a.runs || a.e.id.localeCompare(b.e.id));
  for (const x of outside.slice(0, 3)) {
    const rg = g.faAcceptRange(x.e.id);
    const r = g.offerFa(x.e.id, Math.ceil(Math.max(x.e.ask, rg?.hi ?? 0)), x.e.years);
    if (r.ok) break;
  }
}

/** 외국인 단계: 후보 가운데 지금 기여가 큰 차례로 계약되는 만큼 (대리 단장 규칙 2.3) */
function signForeigners(g: GameSession): void {
  const off = g.offseason!;
  const f = off.foreign;
  if (!f) return;
  const ctx = g.values;
  const byId = new Map(g.league.players.map((p) => [p.id, p]));
  const pool = f.pool.map((id) => byId.get(id)).filter((p): p is LeaguePlayer => !!p && p.team === -1)
    .map((p) => ({ p, runs: runsNow(p, ctx, g.year + 1) })).sort((a, b) => b.runs - a.runs || a.p.id.localeCompare(b.p.id));
  let tries = 0;
  for (const x of pool) {
    if (tries++ > 40) break;
    g.signForeign(x.p.id);
  }
}

function warOf(env: ReturnType<typeof envOf>, pos: string | null, bat?: number[], pit?: number[]): number {
  if (!env) return 0;
  let w = 0;
  if (bat) w += batWarOf({ pa: bat[B.pa], h: bat[B.h], d: bat[B.d], t: bat[B.t], hr: bat[B.hr], bb: bat[B.bb], hbp: bat[B.hbp] }, pos, env);
  if (pit) w += pitWarOf({ g: pit[P.g], gs: pit[P.gs], outs: pit[P.outs], hr: pit[P.hr], bb: pit[P.bb], hbp: pit[P.hbp], so: pit[P.so], r: pit[P.r] }, env);
  return w;
}
const envOf = (g: GameSession, year: number) => g.league.seasonEnv?.[String(year)];

/** 결산 직후: 이 시즌 1군 기록을 선수 기록장에 붙인다 */
function collectSeason(g: GameSession, players: Record<string, PlayerRec>, year: number): void {
  const L = g.league;
  const env = envOf(g, year);
  const teamByName = new Map(g.world.teams.map((t, i) => [t.name, i]));
  for (const p of L.players) {
    const h = p.history.find((x) => x.year === year);
    let rec = players[p.id];
    if (!rec) {
      rec = players[p.id] = { n: p.name, real: p.real !== false, pit: p.isPitcher, birth: p.birthYear, foreign: p.foreign, asia: !!p.asia, entry: p.entryYear,
        school: p.school, pot0: r2(p.potential), first: year, s: [] };
    }
    if (p.twoWay) rec.twoWay = true;
    if (p.military?.enlisted === year + 1 || (p.military?.state === 'serving' && p.military.enlisted !== undefined && !(rec.enlisted ?? []).includes(p.military.enlisted))) {
      const e = p.military!.enlisted!;
      if (!(rec.enlisted ?? []).includes(e)) (rec.enlisted ??= []).push(e);
    }
    if (!h || (!h.bat?.[B.pa] && !h.pit?.[P.outs])) continue;
    const pa = h.bat?.[B.pa] ?? 0, outs = h.pit?.[P.outs] ?? 0;
    const age = p.birthYear ? year - p.birthYear : -1;
    rec.s.push([year, teamByName.get(h.team) ?? -1, r2(warOf(env, p.pos, h.bat, h.pit)), pa, outs, h.bat?.[B.hr] ?? 0, h.pit?.[P.w] ?? 0, h.pit?.[P.sv] ?? 0, age, h.pit?.[P.so] ?? 0, h.pit?.[P.hld] ?? 0]);
  }
  for (const r of (L.retired ?? []).filter((x) => x.year === year)) {
    const rec = players[r.id];
    if (rec) { rec.retired = year; rec.retAge = r.age; }
  }
}

function yearRow(g: GameSession, year: number, focus: number, players: Record<string, PlayerRec>): YearRow {
  const L = g.league;
  const s = g.season;
  const T = s.totals;
  const teams = s.teams;
  const ps = L.lastSeason?.postseason;
  const wp = g.world.players;
  const games = Math.max(...teams.map((x) => x.g));
  const qPa = Math.ceil(3.1 * games), qOuts = 3 * games;
  const bats = wp.map((p) => s.bat[p.idx]);
  const pits = wp.map((p) => s.pit[p.idx]);
  const avgOf = (b: (typeof bats)[number]) => (b.ab ? b.h / b.ab : 0);
  const qb = bats.filter((b) => b.pa >= qPa);
  const qp = pits.filter((q) => q.outs >= qOuts);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const hist = L.teams.map((_, i) => L.finance?.[i]?.history.find((h) => h.year === year));
  const fin = L.teams.map((_, i) => {
    const h = hist[i];
    const items = (h?.items ?? {}) as Record<string, number>;
    const rev = Object.values(items).filter((v) => v > 0).reduce((a, b) => a + b, 0);
    return { cash: h?.cash ?? 0, net: h?.net ?? 0, rescue: h?.rescue ?? 0, debt: h?.debt ?? 0, rev, pay: teamCapPayroll(L, i, year), att: h?.attendance ?? 0 };
  });
  const cap = salaryCap(year, L);
  const abs = s.absences;
  const specific = abs.filter((a) => a.event && isSpecificEvent(a.event));
  const aw = L.awards?.find((a) => a.year === year);
  const ctx = g.values;
  const runsOf = new Map(wp.map((p) => [p.id, currentRuns(p, ctx)]));
  const allRuns = [...runsOf.values()].sort((a, b) => b - a);
  const starLine = allRuns[Math.floor(allRuns.length * 0.05)] ?? 99;
  const aiT = (L.aiTrades ?? []).filter((t) => t.year === year);
  const ownerRec = g.owner.history.find((h) => h.year === year && h.team === g.teamIdx);
  return {
    y: year, secs: 0, userTeam: g.teamIdx,
    champ: ps?.champion ?? null, ru: ps?.runnerUp ?? null, seeds: ps?.seeds ?? [],
    st: s.standings(), w: teams.map((x) => x.w), l: teams.map((x) => x.l), t: teams.map((x) => x.t),
    homeW: teams.reduce((a, x) => a + x.homeW, 0), homeL: teams.reduce((a, x) => a + x.homeL, 0),
    runsPg: T.r / (teams.reduce((a, x) => a + x.g, 0) || 1), hrPa: T.hr / (T.pa || 1),
    era: (27 * T.er) / (pits.reduce((a, q) => a + q.outs, 0) || 1), avg: T.h / (T.ab || 1),
    lead: {
      hr: max(bats.map((b) => b.hr)), avg: r2(max(qb.map(avgOf)) * 1000) / 1000, w: max(pits.map((q) => q.w)), so: max(pits.map((q) => q.so)),
      sv: max(pits.map((q) => q.sv)), hld: max(pits.map((q) => q.hld)), sb: max(bats.map((b) => b.sb)),
    },
    cnt: {
      hr50: bats.filter((b) => b.hr >= 50).length, hr40: bats.filter((b) => b.hr >= 40).length, hr30: bats.filter((b) => b.hr >= 30).length,
      avg400: qb.filter((b) => avgOf(b) >= 0.4).length, avg300: qb.filter((b) => avgOf(b) >= 0.3).length,
      w20: pits.filter((q) => q.w >= 20).length, w15: pits.filter((q) => q.w >= 15).length, ip180: pits.filter((q) => q.outs >= 540).length,
      sv30: pits.filter((q) => q.sv >= 30).length, qPit: qp.length, qBat: qb.length, era1: qp.filter((q) => (27 * q.er) / q.outs < 2).length,
    },
    fin, wage: wageIndex(year, L), cap, capOver: cap === null ? 0 : fin.filter((f) => f.pay > cap).length, floorShort: capFloorShorts(L, year).length,
    fa: { filed: 0, signed: 0, moved: 0, money: 0, star: 0, starMoved: 0, outsideUser: 0 },
    aiTrades: aiT.length, aiTradeStar: aiT.filter((t) => [...t.got, ...t.gave].some((id) => (runsOf.get(id) ?? 0) >= starLine)).length,
    userTrades: (L.eventTrades ?? []).filter((t) => t.year === year).length, offers: 0, offersOk: 0, offersAccepted: 0,
    market: Object.fromEntries(['release', 'claim', 'sign', 'rehab', 'keep'].map((k) => [k, (L.marketMoves ?? []).filter((m) => m.year === year && m.kind === k).length])),
    retired: (L.retired ?? []).filter((r) => r.year === year).length, serving: 0, enlist: 0, pendingOld: 0,
    inj: abs.filter((a) => a.kind !== 'event').length, major: abs.filter((a) => a.kind === 'major').length,
    events: abs.filter((a) => a.kind === 'event').length, specificReal: specific.filter((a) => g.world.players[a.idx]?.real !== false).length,
    foreign: g.world.teams.map((_, i) => wp.filter((p) => p.teamIdx === i && p.foreign && s.bat[p.idx].pa + s.pit[p.idx].bf > 0).length),
    asiaN: L.players.filter((p) => p.asia && p.team >= 0).length, twoWay: L.players.filter((p) => p.twoWay && p.team >= 0).length,
    mvp: aw?.mvp ? { id: aw.mvp.id, team: aw.mvp.team, war: r2(aw.mvp.war) } : null,
    rookie: aw?.rookie ? { id: aw.rookie.id, team: aw.rookie.team, war: r2(aw.rookie.war) } : null,
    titlesNew: (L.titles ?? []).filter((t) => t.year === year).length, legendsNew: (L.legends ?? []).filter((t) => t.year === year).length,
    owner: { trust: g.owner.trust, achieved: ownerRec ? ownerRec.achieved : null, fired: false, achievements: g.owner.achievements.filter((a) => a.team === focus).length },
    mgrChanges: 0,
    orgMax: 0, orgLimit: 0, unsignedFa: 0,
    stops: { weeks: 0, stops: 0, zero: 0, events: 0, stageFail: 0 },
  };
  void players;
}

/** 오프시즌 'ready' 때 (개막 전): FA 결과·병역·정원 */
function fillOffseason(g: GameSession, row: YearRow, focus: number): void {
  const L = g.league;
  const off = g.offseason!;
  const ctx = g.values;
  const byId = new Map(L.players.map((p) => [p.id, p]));
  const entries = off.fa.entries.filter((e) => !e.returnee);
  const all = L.players.filter((p) => p.team >= 0 || p.freeAgent).map((p) => runsNow(p, ctx, off.year + 1)).sort((a, b) => b - a);
  const line = all[Math.floor(all.length * 0.05)] ?? 99; // 리그 상위 5% 기여
  const star = (id: string) => { const p = byId.get(id); return p ? runsNow(p, ctx, off.year + 1) >= line : false; };
  row.fa = {
    filed: entries.length, signed: entries.filter((e) => e.status === 'signed').length,
    moved: entries.filter((e) => e.status === 'signed' && e.team !== undefined && e.team !== e.from).length,
    money: entries.filter((e) => e.status === 'signed').reduce((a, e) => a + (e.salary ?? 0) * (e.signedYears ?? 1), 0),
    star: entries.filter((e) => star(e.id)).length,
    starMoved: entries.filter((e) => star(e.id) && e.status === 'signed' && e.team !== e.from).length,
    outsideUser: entries.filter((e) => e.status === 'signed' && e.team === g.teamIdx && e.from !== g.teamIdx).length,
  };
  row.serving = L.players.filter((p) => p.military?.state === 'serving').length;
  row.enlist = L.players.filter((p) => p.military?.state === 'serving' && (p.military.enlisted === off.year || p.military.enlisted === off.year + 1)).length;
  row.pendingOld = L.players.filter((p) => p.team >= 0 && !p.foreign && p.military?.state === 'pending' && p.birthYear && off.year + 1 - p.birthYear >= 30).length;
  const sizes = L.teams.map((_, i) => L.players.filter((p) => p.team === i && p.military?.state !== 'serving' && !p.dev).length);
  row.orgMax = Math.max(...sizes);
  row.orgLimit = ruleOf(L, 'orgLimit');
  row.unsignedFa = L.players.filter((p) => p.team === -1 && p.freeAgent).length;
  void focus;
  void Off;
}

main();
