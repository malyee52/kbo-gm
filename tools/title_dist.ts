// 칭호 조건 분포 (칭호 기획안, 2026-10-26): 칭호 후보 조건마다 "리그에 몇 명쯤" 붙는지 실제 KBO 기록과 게임 장기 진행에서 같은 셈으로 잰다.
//
// 사용법:  npx tsx tools/title_dist.ts [--real-only] [--start 2026] [--seasons 20] [--seeds a,b] [--out reports/title-dist.md]
//
// 셈 기준
// - 시즌 칭호: 그 해 조건을 채운 선수 수 (해마다 평균).
// - 통산·횟수 칭호: 그 해 1군에서 뛴 선수 가운데 그 해까지의 통산(시작 전 실제 + 게임 안)이 조건을 채운 선수 수 (= 그 해 리그의 보유자 수).
// - 레전드 칭호: 조건을 처음 채운 선수와 해. 실제 기록 1982~2025에서 누가 채우는지, 게임에서 새로 몇 명이 채우는지.
// - 타이틀(부문 1위)은 이 도구가 기록에서 직접 센다 (공동 1위 모두). 실제 공식 타이틀과 규정이 조금 다를 수 있다.
// - 장기 진행 도구(longsim)처럼 가을야구를 치르지 않으므로 게임 쪽 우승·가을야구 칭호는 잴 수 없다 (실제 기록만).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, type EngineParams, type World } from '../src/engine';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import type { LeagueState } from '../src/league/types';
import { worldFromLeague } from '../src/league/world';
import { realYearbook } from '../src/league/history';
import { batWarOf, pitWarOf, realEnv } from '../src/league/war';
import { installCalCache } from './calCache';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Store = ReturnType<typeof loadDataStore>;

interface Bat { g: number; pa: number; ab: number; r: number; h: number; d: number; t: number; hr: number; rbi: number; bb: number; hbp: number; sf: number; so: number; sb: number }
interface Pit { g: number; gs: number; w: number; l: number; sv: number; hld: number; outs: number; so: number; er: number; bb: number; h: number }
const emptyBat = (): Bat => ({ g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, sf: 0, so: 0, sb: 0 });
const emptyPit = (): Pit => ({ g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, outs: 0, so: 0, er: 0, bb: 0, h: 0 });
function addTo<T extends object>(a: T, b: Partial<T>): void {
  for (const k of Object.keys(a) as (keyof T)[]) (a as Record<keyof T, number>)[k] += Number(b[k] ?? 0) || 0;
}

/** 한 선수의 한 시즌 */
interface S {
  id: string; name: string; real: boolean; pitcher: boolean; year: number; age: number | null; fr: string; pos: string | null;
  bat: Bat; pit: Pit; war: number;
  qBat: boolean; qPit: boolean;
  /** 부문 1위 (공동 포함) */
  lead: Set<string>;
  mvp: boolean; gg: boolean; ggPos?: string; rookie: boolean; champ: boolean; ksMvp: boolean;
  /** 리그 OPS 순위 분위 (규정타석 타자 안, 0 = 1위) / 리그 평균자책 대비 (규정이닝) */
  opsPct: number | null; eraRel: number | null;
}

const avg = (b: Bat) => (b.ab ? b.h / b.ab : 0);
const obp = (b: Bat) => { const d = b.ab + b.bb + b.hbp + b.sf; return d ? (b.h + b.bb + b.hbp) / d : 0; };
const slg = (b: Bat) => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
const ops = (b: Bat) => obp(b) + slg(b);
const era = (p: Pit) => (p.outs ? (p.er * 27) / p.outs : 99);

const LEAD_KEYS = ['avg', 'hr', 'rbi', 'r', 'h', 'sb', 'obp', 'slg', 'w', 'era', 'so', 'sv', 'hld', 'wpct'] as const;

/** 한 해 선수들의 부문 1위·규정·분위를 채운다 */
function markYear(xs: S[], games: number): void {
  const qPa = Math.ceil(3.1 * games);
  const qOuts = 3 * games;
  for (const s of xs) { s.qBat = !s.pitcher && s.bat.pa >= qPa; s.qPit = s.pitcher && s.pit.outs >= qOuts; }
  const bats = xs.filter((s) => !s.pitcher);
  const qb = bats.filter((s) => s.qBat);
  const pits = xs.filter((s) => s.pitcher);
  const qp = pits.filter((s) => s.qPit);
  const year = xs[0]?.year ?? 0;
  const lead = (key: string, pool: S[], v: (s: S) => number, low = false) => {
    if (!pool.length) return;
    const best = pool.reduce((m, s) => (low ? Math.min(m, v(s)) : Math.max(m, v(s))), low ? Infinity : -Infinity);
    if (!Number.isFinite(best) || (!low && best <= 0)) return;
    for (const s of pool) if (Math.abs(v(s) - best) < 1e-9) s.lead.add(key);
  };
  lead('avg', qb, (s) => avg(s.bat)); lead('obp', qb, (s) => obp(s.bat)); lead('slg', qb, (s) => slg(s.bat));
  lead('hr', bats, (s) => s.bat.hr); lead('rbi', bats, (s) => s.bat.rbi); lead('r', bats, (s) => s.bat.r);
  lead('h', bats, (s) => s.bat.h); lead('sb', bats, (s) => s.bat.sb);
  lead('w', pits, (s) => s.pit.w); lead('era', qp, (s) => era(s.pit), true); lead('so', pits, (s) => s.pit.so);
  lead('sv', pits, (s) => s.pit.sv);
  if (year >= 2000) lead('hld', pits, (s) => s.pit.hld);
  lead('wpct', pits.filter((s) => s.pit.w >= 10), (s) => s.pit.w / (s.pit.w + s.pit.l));
  const byOps = [...qb].sort((a, b) => ops(b.bat) - ops(a.bat));
  byOps.forEach((s, i) => { s.opsPct = byOps.length > 1 ? i / (byOps.length - 1) : 0; });
  let er = 0, outs = 0;
  for (const s of pits) { er += s.pit.er; outs += s.pit.outs; }
  const lgEra = outs ? (er * 27) / outs : 4.5;
  for (const s of qp) s.eraRel = era(s.pit) / lgEra;
}

// ---- 실제 기록

interface RealAward { award: string; year: number; id: string | null; part?: string }

function realSeasons(store: Store, before: number): S[] {
  const awards = (JSON.parse(readFileSync(join('public', 'data', 'awards.json'), 'utf8')) as { awards: RealAward[] }).awards;
  const aw = new Map<string, Set<string>>();
  const ggPos = new Map<string, string>();
  for (const a of awards) if (a.id) {
    (aw.get(`${a.year}/${a.id}`) ?? aw.set(`${a.year}/${a.id}`, new Set()).get(`${a.year}/${a.id}`)!).add(a.award);
    if (a.award === '골든글러브' && a.part) ggPos.set(`${a.year}/${a.id}`, a.part);
  }
  const champ = new Map(realYearbook(store, before).map((y) => [y.year, y.champion]));
  const out: S[] = [];
  for (const y of store.meta.years) {
    if (y >= before) continue;
    const sd = store.season(y);
    if (!sd) continue;
    const env = realEnv(sd);
    const fr = new Map(sd.teams.map((t) => [t.name, t.franchise]));
    const by = new Map<string, S>();
    const get = (id: string, team: string): S => {
      let s = by.get(id);
      if (!s) {
        const m = store.players.get(id);
        const a = aw.get(`${y}/${id}`) ?? new Set<string>();
        s = {
          id, name: m?.name ?? id, real: true, pitcher: m?.kind === 'P', year: y, age: m?.birthYear ? y - m.birthYear : null,
          fr: fr.get(team) ?? team, pos: m?.pos ?? null, bat: emptyBat(), pit: emptyPit(), war: 0, qBat: false, qPit: false, lead: new Set(),
          mvp: a.has('MVP'), gg: a.has('골든글러브'), ggPos: ggPos.get(`${y}/${id}`), rookie: a.has('신인왕'), ksMvp: a.has('한국시리즈 MVP'), champ: false, opsPct: null, eraRel: null,
        };
        by.set(id, s);
      }
      if (champ.get(y) === team) s.champ = true;
      return s;
    };
    for (const r of sd.bat) {
      const s = get(r.id, r.team);
      addTo(s.bat, { ...r, bb: r.bb ?? 0, hbp: r.hbp ?? 0, sf: r.sf ?? 0, so: r.so ?? 0, sb: r.sb ?? 0 } as Partial<Bat>);
      if (!s.pitcher) s.war += batWarOf(r, r.pos, env);
    }
    for (const r of sd.pit) {
      const s = get(r.id, r.team);
      addTo(s.pit, { ...r, gs: r.gs ?? 0, hld: r.hld ?? 0 } as Partial<Pit>);
      s.war += pitWarOf(r, env);
    }
    const xs = [...by.values()];
    markYear(xs, sd.games);
    out.push(...xs);
  }
  return out;
}

// ---- 게임 장기 진행

function gameYear(league: LeagueState, store: Store, params: EngineParams): S[] {
  const world: World = worldFromLeague(structuredClone(league), store, params);
  const seed = league.year === league.startYear ? league.seed : `${league.seed}/${league.year}`;
  const season = Season.start(world, params, seed);
  season.runToEnd();
  const games = Math.max(...season.teams.map((t) => t.g));
  const xs: S[] = [];
  for (const sp of world.players) {
    const b = season.bat[sp.idx];
    const p = season.pit[sp.idx];
    if (b.pa === 0 && p.bf === 0) continue;
    const team = sp.teamIdx >= 0 ? sp.teamIdx : sp.formerTeam ?? -1;
    xs.push({
      id: sp.id, name: sp.name, real: sp.real !== false, pitcher: sp.isPitcher, year: world.year, age: sp.age, fr: league.teams[team]?.franchise ?? '',
      pos: sp.pos ?? null, bat: { ...emptyBat(), ...pick(b, emptyBat()) }, pit: { ...emptyPit(), ...pick(p, emptyPit()) }, war: 0,
      qBat: false, qPit: false, lead: new Set(), mvp: false, gg: false, rookie: false, champ: false, ksMvp: false, opsPct: null, eraRel: null,
    });
  }
  markYear(xs, games);
  const off = Off.beginOffseason(league, world, season, store, -1, params);
  // 시즌 가치: 명예의 전당·통산 가치와 같은 셈 (war.ts, 결산이 남긴 그 시즌 리그 환경)
  const env = league.seasonEnv?.[String(world.year)];
  if (env) for (const sp of world.players) {
    const s = xs.find((x) => x.id === sp.id);
    if (!s) continue;
    const b = season.bat[sp.idx];
    const p = season.pit[sp.idx];
    s.war = (sp.isPitcher ? 0 : batWarOf(b, sp.pos, env)) + pitWarOf(p, env);
  }
  const aw = league.awards?.find((a) => a.year === world.year);
  const byId = new Map(xs.map((s) => [s.id, s]));
  if (aw?.mvp) { const s = byId.get(aw.mvp.id); if (s) s.mvp = true; }
  if (aw?.rookie) { const s = byId.get(aw.rookie.id); if (s) s.rookie = true; }
  for (const g of aw?.goldenGlove ?? []) { const s = byId.get(g.winner.id); if (s) { s.gg = true; s.ggPos = g.pos; } }
  let guard = 0;
  while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
  Off.closeOffseason(league, off);
  return xs;
}
function pick<T extends object>(src: object, keys: T): Partial<T> {
  const o: Record<string, number> = {};
  for (const k of Object.keys(keys)) o[k] = Number((src as Record<string, unknown>)[k] ?? 0) || 0;
  return o as Partial<T>;
}

// ---- 누적

interface Cum {
  bat: Bat; pit: Pit; war: number; seasons: number;
  lead: Record<string, number>; mvp: number; gg: number; champ: number; ksMvp: number;
  fr: Record<string, number>;
  hist: S[];
}
const emptyCum = (): Cum => ({ bat: emptyBat(), pit: emptyPit(), war: 0, seasons: 0, lead: {}, mvp: 0, gg: 0, champ: 0, ksMvp: 0, fr: {}, hist: [] });
function addSeason(c: Cum, s: S): void {
  addTo(c.bat, s.bat); addTo(c.pit, s.pit); c.war += s.war; c.seasons += 1;
  for (const k of s.lead) c.lead[k] = (c.lead[k] ?? 0) + 1;
  c.mvp += +s.mvp; c.gg += +s.gg; c.champ += +s.champ; c.ksMvp += +s.ksMvp;
  if (s.fr) c.fr[s.fr] = (c.fr[s.fr] ?? 0) + 1;
  c.hist.push(s);
}
const leads = (c: Cum, ...ks: string[]) => ks.reduce((n, k) => n + (c.lead[k] ?? 0), 0);
const titleTotal = (c: Cum) => LEAD_KEYS.reduce((n, k) => n + (c.lead[k] ?? 0), 0);
const maxFr = (c: Cum) => Math.max(0, ...Object.values(c.fr));
const streak = (h: S[], ok: (s: S) => boolean) => { let best = 0, cur = 0, prev = -9; for (const s of h) { cur = ok(s) && s.year === prev + 1 ? cur + 1 : ok(s) ? 1 : 0; prev = s.year; best = Math.max(best, cur); } return best; };
const throwsLSet = new Set<string>();
const foreignSet = new Set<string>();
const throwsL = (id: string) => throwsLSet.has(id);
const countIf = (h: S[], ok: (s: S) => boolean) => h.filter(ok).length;

// ---- 조건 표

interface Cond { key: string; group: string; label: string; test: (s: S, c: Cum) => boolean }

/** 시즌 칭호 후보 (그 해만) */
const SEASON: Cond[] = [
  { key: 'hr30', group: '시즌 타격', label: '홈런 30', test: (s) => s.bat.hr >= 30 },
  { key: 'hr40', group: '시즌 타격', label: '홈런 40', test: (s) => s.bat.hr >= 40 },
  { key: 'hr50', group: '시즌 타격', label: '홈런 50', test: (s) => s.bat.hr >= 50 },
  { key: 'avg330', group: '시즌 타격', label: '타율 .330 (규정)', test: (s) => s.qBat && avg(s.bat) >= 0.33 },
  { key: 'avg350', group: '시즌 타격', label: '타율 .350 (규정)', test: (s) => s.qBat && avg(s.bat) >= 0.35 },
  { key: 'h180', group: '시즌 타격', label: '안타 180', test: (s) => s.bat.h >= 180 },
  { key: 'h200', group: '시즌 타격', label: '안타 200', test: (s) => s.bat.h >= 200 },
  { key: 'rbi100', group: '시즌 타격', label: '타점 100', test: (s) => s.bat.rbi >= 100 },
  { key: 'rbi120', group: '시즌 타격', label: '타점 120', test: (s) => s.bat.rbi >= 120 },
  { key: 'sb40', group: '시즌 타격', label: '도루 40', test: (s) => s.bat.sb >= 40 },
  { key: 'sb50', group: '시즌 타격', label: '도루 50', test: (s) => s.bat.sb >= 50 },
  { key: 'ops1000', group: '시즌 타격', label: 'OPS 1.000 (규정)', test: (s) => s.qBat && ops(s.bat) >= 1 },
  { key: 'opsTop', group: '시즌 타격', label: 'OPS 규정 상위 5%', test: (s) => s.qBat && (s.opsPct ?? 1) <= 0.05 },
  { key: '2020', group: '시즌 타격', label: '20홈런-20도루', test: (s) => s.bat.hr >= 20 && s.bat.sb >= 20 },
  { key: '3030', group: '시즌 타격', label: '30홈런-30도루', test: (s) => s.bat.hr >= 30 && s.bat.sb >= 30 },
  { key: '33100', group: '시즌 타격', label: '3할-30홈런-100타점', test: (s) => s.qBat && avg(s.bat) >= 0.3 && s.bat.hr >= 30 && s.bat.rbi >= 100 },
  { key: 'tc', group: '시즌 타격', label: '타격 3관왕 (타율·홈런·타점 1위)', test: (s) => ['avg', 'hr', 'rbi'].every((k) => s.lead.has(k)) },
  { key: 'w15', group: '시즌 투구', label: '15승', test: (s) => s.pit.w >= 15 },
  { key: 'w20', group: '시즌 투구', label: '20승', test: (s) => s.pit.w >= 20 },
  { key: 'era250', group: '시즌 투구', label: '평균자책 2.50 이하 (규정)', test: (s) => s.qPit && era(s.pit) <= 2.5 },
  { key: 'era200', group: '시즌 투구', label: '평균자책 2.00 이하 (규정)', test: (s) => s.qPit && era(s.pit) <= 2.0 },
  { key: 'eraRel60', group: '시즌 투구', label: '평균자책 리그의 60% 이하 (규정)', test: (s) => s.qPit && (s.eraRel ?? 9) <= 0.6 },
  { key: 'so180', group: '시즌 투구', label: '탈삼진 180', test: (s) => s.pit.so >= 180 },
  { key: 'so200', group: '시즌 투구', label: '탈삼진 200', test: (s) => s.pit.so >= 200 },
  { key: 'ip180', group: '시즌 투구', label: '180이닝', test: (s) => s.pit.outs >= 540 },
  { key: 'sv30', group: '시즌 투구', label: '세이브 30', test: (s) => s.pit.sv >= 30 },
  { key: 'sv40', group: '시즌 투구', label: '세이브 40', test: (s) => s.pit.sv >= 40 },
  { key: 'hld30', group: '시즌 투구', label: '홀드 30', test: (s) => s.pit.hld >= 30 },
  { key: 'ptc', group: '시즌 투구', label: '투수 3관왕 (다승·평균자책·탈삼진 1위)', test: (s) => ['w', 'era', 'so'].every((k) => s.lead.has(k)) },
  { key: 'war6', group: '시즌 가치', label: '시즌 가치 6승', test: (s) => s.war >= 6 },
  { key: 'war8', group: '시즌 가치', label: '시즌 가치 8승', test: (s) => s.war >= 8 },
];

/** 통산·횟수 칭호 후보 (그 해까지 누적, 그 해 뛴 선수 중 보유자) */
const CAREER: Cond[] = [
  { key: 'ch1000', group: '통산 타격', label: '통산 1,000안타', test: (_, c) => c.bat.h >= 1000 },
  { key: 'ch1500', group: '통산 타격', label: '통산 1,500안타', test: (_, c) => c.bat.h >= 1500 },
  { key: 'ch2000', group: '통산 타격', label: '통산 2,000안타', test: (_, c) => c.bat.h >= 2000 },
  { key: 'ch2500', group: '통산 타격', label: '통산 2,500안타', test: (_, c) => c.bat.h >= 2500 },
  { key: 'chr100', group: '통산 타격', label: '통산 100홈런', test: (_, c) => c.bat.hr >= 100 },
  { key: 'chr200', group: '통산 타격', label: '통산 200홈런', test: (_, c) => c.bat.hr >= 200 },
  { key: 'chr300', group: '통산 타격', label: '통산 300홈런', test: (_, c) => c.bat.hr >= 300 },
  { key: 'chr400', group: '통산 타격', label: '통산 400홈런', test: (_, c) => c.bat.hr >= 400 },
  { key: 'crbi1000', group: '통산 타격', label: '통산 1,000타점', test: (_, c) => c.bat.rbi >= 1000 },
  { key: 'csb300', group: '통산 타격', label: '통산 300도루', test: (_, c) => c.bat.sb >= 300 },
  { key: 'cg2000', group: '통산 타격', label: '통산 2,000경기 (타자)', test: (_, c) => c.bat.g >= 2000 },
  { key: 'cw100', group: '통산 투구', label: '통산 100승', test: (_, c) => c.pit.w >= 100 },
  { key: 'cw150', group: '통산 투구', label: '통산 150승', test: (_, c) => c.pit.w >= 150 },
  { key: 'csv100', group: '통산 투구', label: '통산 100세이브', test: (_, c) => c.pit.sv >= 100 },
  { key: 'csv200', group: '통산 투구', label: '통산 200세이브', test: (_, c) => c.pit.sv >= 200 },
  { key: 'csv300', group: '통산 투구', label: '통산 300세이브', test: (_, c) => c.pit.sv >= 300 },
  { key: 'chld100', group: '통산 투구', label: '통산 100홀드', test: (_, c) => c.pit.hld >= 100 },
  { key: 'cso1000', group: '통산 투구', label: '통산 1,000탈삼진', test: (_, c) => c.pit.so >= 1000 },
  { key: 'cso1500', group: '통산 투구', label: '통산 1,500탈삼진', test: (_, c) => c.pit.so >= 1500 },
  { key: 'cso2000', group: '통산 투구', label: '통산 2,000탈삼진', test: (_, c) => c.pit.so >= 2000 },
  { key: 'cip2000', group: '통산 투구', label: '통산 2,000이닝', test: (_, c) => c.pit.outs >= 6000 },
  { key: 'cwar30', group: '통산 가치', label: '통산 가치 30승', test: (_, c) => c.war >= 30 },
  { key: 'cwar45', group: '통산 가치', label: '통산 가치 45승 (명예의 전당 선)', test: (_, c) => c.war >= 45 },
  { key: 't1', group: '타이틀 횟수', label: '타이틀 1회 이상 (어느 부문)', test: (_, c) => titleTotal(c) >= 1 },
  { key: 't5', group: '타이틀 횟수', label: '타이틀 합계 5회', test: (_, c) => titleTotal(c) >= 5 },
  { key: 't10', group: '타이틀 횟수', label: '타이틀 합계 10회', test: (_, c) => titleTotal(c) >= 10 },
  { key: 'same3', group: '타이틀 횟수', label: '같은 부문 1위 3회', test: (_, c) => LEAD_KEYS.some((k) => (c.lead[k] ?? 0) >= 3) },
  { key: 'same5', group: '타이틀 횟수', label: '같은 부문 1위 5회', test: (_, c) => LEAD_KEYS.some((k) => (c.lead[k] ?? 0) >= 5) },
  { key: 'mvp1', group: '수상', label: 'MVP 1회', test: (_, c) => c.mvp >= 1 },
  { key: 'mvp2', group: '수상', label: 'MVP 2회', test: (_, c) => c.mvp >= 2 },
  { key: 'gg3', group: '수상', label: '골든글러브 3회', test: (_, c) => c.gg >= 3 },
  { key: 'gg5', group: '수상', label: '골든글러브 5회', test: (_, c) => c.gg >= 5 },
  { key: 'gg8', group: '수상', label: '골든글러브 8회', test: (_, c) => c.gg >= 8 },
  { key: 'rookie', group: '수상', label: '신인왕', test: (_, c) => c.hist.some((s) => s.rookie) },
  { key: 'fr10', group: '구단', label: '한 구단 10시즌', test: (_, c) => maxFr(c) >= 10 },
  { key: 'fr15', group: '구단', label: '한 구단 15시즌', test: (_, c) => maxFr(c) >= 15 },
  { key: 'one15', group: '구단', label: '한 구단에서만 15시즌', test: (_, c) => Object.keys(c.fr).length === 1 && c.seasons >= 15 },
  { key: 'champ1', group: '가을야구', label: '우승 1회 (실제만)', test: (_, c) => c.champ >= 1 },
  { key: 'champ3', group: '가을야구', label: '우승 3회 (실제만)', test: (_, c) => c.champ >= 3 },
  { key: 'champ5', group: '가을야구', label: '우승 5회 (실제만)', test: (_, c) => c.champ >= 5 },
  { key: 'ksmvp', group: '가을야구', label: '한국시리즈 MVP (실제만)', test: (_, c) => c.ksMvp >= 1 },
  { key: 'age40', group: '커리어', label: '40세 시즌 1군 (타석 100 또는 30이닝)', test: (s) => (s.age ?? 0) >= 40 && (s.bat.pa >= 100 || s.pit.outs >= 90) },
  { key: 'seasons20', group: '커리어', label: '1군 20시즌', test: (_, c) => c.seasons >= 20 },
];

/** 레전드 별명 칭호 조건 예시 (이름은 별명 후보, 모두 미확인. 기준은 그 커리어를 닮은 수준) */
const LEGEND: Cond[] = [
  { key: 'L-국보', group: '레전드', label: '평균자책 1위 5회', test: (_, c) => leads(c, 'era') >= 5 },
  { key: 'L-무쇠팔', group: '레전드', label: '한 시즌 탈삼진 220 + 280이닝', test: (s) => s.pit.so >= 220 && s.pit.outs >= 840 },
  { key: 'L-바람의 아들', group: '레전드', label: '한 시즌 도루 1위 + 타율 1위', test: (s) => s.lead.has('sb') && s.lead.has('avg') },
  { key: 'L-국민타자', group: '레전드', label: '홈런 1위 5회 + MVP 3회', test: (_, c) => leads(c, 'hr') >= 5 && c.mvp >= 3 },
  { key: 'L-헐크', group: '레전드', label: '포수로 타격 3관왕, 또는 포수로 홈런 1위 3회', test: (s, c) => (s.pos === 'C' && ['avg', 'hr', 'rbi'].every((k) => s.lead.has(k))) || c.hist.filter((x) => x.pos === 'C' && x.lead.has('hr')).length >= 3 },
  { key: 'L-양신', group: '레전드', label: '타율 1위 4회 + 통산 2,000안타', test: (_, c) => leads(c, 'avg') >= 4 && c.bat.h >= 2000 },
  { key: 'L-대성불패', group: '레전드', label: '구원 투수(선발 등판 1/3 미만)로 MVP', test: (_, c) => c.hist.some((s) => s.mvp && s.pitcher && s.pit.gs * 3 < s.pit.g) },
  { key: 'L-노송', group: '레전드', label: '통산 200세이브 + 100승', test: (_, c) => c.pit.sv >= 200 && c.pit.w >= 100 },
  { key: 'L-야생마', group: '레전드', label: '좌투 세이브 1위 2회', test: (_, c) => countIf(c.hist, (s) => s.lead.has('sv') && throwsL(s.id)) >= 2 },
  { key: 'L-적토마', group: '레전드', label: '안타 1위 3회 + 통산 2,000안타', test: (_, c) => leads(c, 'h') >= 3 && c.bat.h >= 2000 },
  { key: 'L-빅보이', group: '레전드', label: '한 시즌 타격 7부문 중 6부문 이상 1위', test: (s) => ['avg', 'hr', 'rbi', 'r', 'h', 'obp', 'slg'].filter((k) => s.lead.has(k)).length >= 6 },
  { key: 'L-괴물', group: '레전드', label: '같은 해 신인왕 + MVP', test: (s) => s.rookie && s.mvp },
  { key: 'L-KK', group: '레전드', label: '좌투 다승·탈삼진·평균자책 1위 (각 1회 이상) + 통산 150승', test: (_, c) => throwsL(c.hist[0].id) && leads(c, 'w') >= 1 && leads(c, 'so') >= 1 && leads(c, 'era') >= 1 && c.pit.w >= 150 },
  { key: 'L-대투수', group: '레전드', label: '좌투 통산 170승 + 2,000탈삼진', test: (_, c) => throwsL(c.hist[0].id) && c.pit.w >= 170 && c.pit.so >= 2000 },
  { key: 'L-돌부처', group: '레전드', label: '통산 350세이브', test: (_, c) => c.pit.sv >= 350 },
  { key: 'L-소년장사', group: '레전드', label: '10시즌 연속 20홈런', test: (_, c) => streak(c.hist, (s) => s.bat.hr >= 20) >= 10 },
  { key: 'L-박뱅', group: '레전드', label: '홈런 1위 연속 4시즌', test: (_, c) => streak(c.hist, (s) => s.lead.has('hr')) >= 4 },
  { key: 'L-타격기계', group: '레전드', label: '타율 1위 2회 + 안타 1위 2회 + 통산 2,000안타', test: (_, c) => leads(c, 'avg') >= 2 && leads(c, 'h') >= 2 && c.bat.h >= 2000 },
  { key: 'L-바람의 손자', group: '레전드', label: '만 25세 이하 타율 1위 2회', test: (_, c) => countIf(c.hist, (s) => (s.age ?? 99) <= 25 && s.lead.has('avg')) >= 2 },
  { key: 'L-국민 유격수', group: '레전드', label: '유격수 골든글러브 5회 + 우승 5회 (게임은 우승을 못 셈)', test: (_, c) => countIf(c.hist, (s) => s.ggPos === 'SS') >= 5 && c.champ >= 5 },
  { key: 'L-곰의 탈을 쓴 여우', group: '레전드', label: '포수 골든글러브 8회', test: (_, c) => countIf(c.hist, (s) => s.ggPos === 'C') >= 8 },
  { key: 'L-불사조', group: '레전드', label: '한 시즌 22승 + 4패 이하', test: (s) => s.pit.w >= 22 && s.pit.l <= 4 },
  { key: 'L-(장효조 후보)', group: '레전드', label: '통산 타율 .330 (3,000타수)', test: (_, c) => c.bat.ab >= 3000 && c.bat.h / c.bat.ab >= 0.33 },
  { key: 'L-(송진우 후보)', group: '레전드', label: '통산 200승', test: (_, c) => c.pit.w >= 200 },
  { key: 'L-(장종훈 후보)', group: '레전드', label: '홈런 1위 연속 3시즌 + 한 시즌 40홈런', test: (_, c) => streak(c.hist, (s) => s.lead.has('hr')) >= 3 && c.hist.some((s) => s.bat.hr >= 40) },
  { key: 'L-(박경완 후보)', group: '레전드', label: '포수로 홈런 1위', test: (s) => s.pos === 'C' && s.lead.has('hr') },
  { key: 'L-(김태균 후보)', group: '레전드', label: '출루율 1위 4회', test: (_, c) => leads(c, 'obp') >= 4 },
];


// ---- 세기

interface Tally { years: number; perYear: Map<string, number[]>; legend: Map<string, { name: string; year: number; real: boolean; before: boolean }[]> }

function tally(seasons: S[], start: Map<string, Cum> | null): { tally: Tally; cum: Map<string, Cum> } {
  const cum = new Map<string, Cum>();
  if (start) for (const [id, c] of start) cum.set(id, { ...c, bat: { ...c.bat }, pit: { ...c.pit }, lead: { ...c.lead }, fr: { ...c.fr }, hist: [...c.hist] });
  const t: Tally = { years: 0, perYear: new Map(), legend: new Map() };
  // 시작 전 이미 레전드 조건을 채운 선수 (게임 쪽 기준점)
  const had = new Map<string, Set<string>>();
  if (start) for (const [id, c] of cum) for (const L of LEGEND) if (c.hist.some((s, i) => L.test(s, prefix(c, i)))) (had.get(L.key) ?? had.set(L.key, new Set()).get(L.key)!).add(id);
  const years = [...new Set(seasons.map((s) => s.year))].sort((a, b) => a - b);
  for (const y of years) {
    t.years++;
    const xs = seasons.filter((s) => s.year === y);
    for (const s of xs) { let c = cum.get(s.id); if (!c) cum.set(s.id, (c = emptyCum())); addSeason(c, s); }
    for (const C of [...SEASON, ...CAREER]) {
      const n = xs.filter((s) => C.test(s, cum.get(s.id)!)).length;
      (t.perYear.get(C.key) ?? t.perYear.set(C.key, []).get(C.key)!).push(n);
    }
    for (const L of LEGEND) {
      const got = had.get(L.key) ?? had.set(L.key, new Set()).get(L.key)!;
      for (const s of xs) {
        if (got.has(s.id) || !L.test(s, cum.get(s.id)!)) continue;
        got.add(s.id);
        (t.legend.get(L.key) ?? t.legend.set(L.key, []).get(L.key)!).push({ name: s.name, year: y, real: s.real, before: false });
      }
    }
  }
  return { tally: t, cum };
}
/** 그 시즌까지 누적 (시작 전 레전드 판정용) */
function prefix(c: Cum, i: number): Cum {
  const p = emptyCum();
  for (const s of c.hist.slice(0, i + 1)) addSeason(p, s);
  return p;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number) => x.toFixed(1);

async function main(): Promise<void> {
  const realOnly = process.argv.includes('--real-only');
  const start = Number(arg('start') ?? 2026);
  const n = Number(arg('seasons') ?? 20);
  const seeds = (arg('seeds') ?? 'title-a').split(',');
  const out = arg('out');
  const params: EngineParams = { ...DEFAULT_PARAMS };
  const store = loadDataStore();
  for (const m of store.players.values()) { if (m.throws === 'L') throwsLSet.add(m.id); if (m.foreign) foreignSet.add(m.id); }
  const real = realSeasons(store, 2026);
  const eras: [string, number, number][] = [['1982~1999', 1982, 1999], ['2000~2014', 2000, 2014], ['2015~2025', 2015, 2025]];
  const realAll = tally(real, null).tally;
  const firstYear = real.reduce((m, s) => Math.min(m, s.year), 9999);
  // 시대별 평균은 그 시대 해만 (누적은 1982부터 이어서 센다)
  const eraMean = (k: string, i: number) => {
    const [, a, b] = eras[i];
    return mean((realAll.perYear.get(k) ?? []).slice(a - firstYear, b - firstYear + 1));
  };
  const parts: string[] = [`# 칭호 조건 분포\n`, `만든 날: ${new Date().toISOString().slice(0, 10)}. 도구: \`npx tsx tools/title_dist.ts\`. 칭호 기획안(docs/칭호_기획안.md)의 조건 숫자 근거.\n`];

  // 게임 장기 진행
  const game: Tally[] = [];
  if (!realOnly) {
    installCalCache();
    const startCum = tally(real.filter((s) => s.year < start), null).cum;
    for (const seed of seeds) {
      const t0 = Date.now();
      const { league } = createLeague(store, start, seed, params);
      const xs: S[] = [];
      for (let i = 0; i < n; i++) {
        xs.push(...gameYear(league, store, params));
        console.log(`[${seed}] ${league.year - 1} 끝 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
      }
      game.push(tally(xs, startCum).tally);
      parts.push(`- 시드 ${seed}: ${start}~${start + n - 1}, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    }
    parts.push('');
  }

  const gameMean = (k: string) => mean(game.map((t) => mean(t.perYear.get(k) ?? [])));
  const gameFirst = (k: string) => mean(game.map((t) => (t.perYear.get(k) ?? [])[0] ?? 0));
  const gameLast = (k: string) => mean(game.map((t) => (t.perYear.get(k) ?? []).at(-1) ?? 0));
  const head = `| 조건 | 실제 ${eras.map((e) => e[0]).join(' | 실제 ')} |${realOnly ? '' : ' 게임 평균 | 게임 첫해 | 게임 마지막 해 |'}`;
  const sep = `|---|${eras.map(() => '---:').join('|')}|${realOnly ? '' : '---:|---:|---:|'}`;
  const row = (C: Cond) => `| ${C.label} | ${eras.map((_, i) => f1(eraMean(C.key, i))).join(' | ')} |${realOnly ? '' : ` ${f1(gameMean(C.key))} | ${f1(gameFirst(C.key))} | ${f1(gameLast(C.key))} |`}`;
  parts.push('## 시즌 칭호 후보: 해마다 조건을 채운 선수 수 (평균)\n', head, sep, ...SEASON.map(row), '');
  parts.push('## 통산·횟수 칭호 후보: 그 해 1군에서 뛴 보유자 수 (평균)\n', '누적은 1982년부터 (실제) / 시작 전 실제 + 게임 안 (게임). 우승·한국시리즈 MVP는 장기 진행 도구가 가을야구를 치르지 않아 게임 쪽 값이 없다.\n', head, sep, ...CAREER.map(row), '');

  // 레전드: 실제 1982~2025 전체에서 처음 채운 선수
  parts.push('## 레전드 칭호 조건 예시: 처음 채운 선수\n', `| 조건 | 실제 1982~2025 (처음 채운 해) | 실제 수 |${realOnly ? '' : ' 게임에서 새로 (시드당 평균) | 게임 예 |'}`, `|---|---|---:|${realOnly ? '' : '---:|---|'}`);
  for (const L of LEGEND) {
    const r = realAll.legend.get(L.key) ?? [];
    const g = game.map((t) => t.legend.get(L.key) ?? []);
    parts.push(`| ${L.key.slice(2)}: ${L.label} | ${r.map((x) => `${x.name} ${x.year}`).join(', ') || '—'} | ${r.length} |${realOnly ? '' : ` ${f1(mean(g.map((x) => x.length)))} | ${g.flat().slice(0, 4).map((x) => `${x.name}${x.real ? '' : '(가상)'} ${x.year}`).join(', ') || '—'} |`}`);
  }
  parts.push('');
  const text = parts.join('\n');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); console.log(`${out}에 썼습니다.`); } else console.log(text);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/title_dist.ts')) void main();
