// 유명무실 후보 측정 (2026-11-12 사용자 그릴: "짐작으로 빼지 말고 먼저 잰다").
// 무작위 이벤트·스프링캠프·코치·단장 평판·도루·이닝·감독·라이벌·희귀 업적이 게임에서 실제로 얼마나 움직이는지 잰다.
// 게임 규칙·값은 바꾸지 않는다. 결과는 reports/nominal-content.md (표).
//
// 갈래 (--part):
//   edge     경기력 edge → 승수 환산과 감독 작전 배율 효과. 한 시즌에 구단마다 타자·투수 edge와 감독(실존 감독 명단에서)을 무작위로 걸고
//            여러 시즌 돌려 득실 기준 기대 승수를 회귀한다 (구단 고정 효과 포함). 이벤트·캠프·코치 효과를 승수로 바꾸는 눈금.
//   choices  이벤트 129종의 선택지별 효과: 2026 LG 시즌 중간(여러 날) 상황과 몇 가지 바꾼 상황(1위·꼴찌·연패·연승·7·8월·라이벌)에서
//            선택지마다 여러 난수로 적용해 자금·신뢰·팬·관중률·경기력·컨디션·잠재력 변화를 기록한다 (모의: 실제 상태는 바꾸지 않는다).
//   session  GameSession 장기 진행: 플레이어 자리 구단(기본 LG)도 AI 판단 그대로(라인업·오프시즌, FA는 AI 규칙, 이벤트는 첫 선택지 자동)
//            50시즌. 해마다 이벤트·재정·신뢰·평판·캠프·코치·감독·라이벌·업적·도루·이닝·FA 요구액·성장 폭을 JSONL로.
//   report   위 결과와 실제 기록(자료집 2015~2025)을 모아 reports/nominal-content.md를 쓴다.
//
// 실행 (무거운 갈래는 heavy2.sh로 하나씩):
//   npx tsx tools/nominal_measure.ts --part edge --seasons 80 --out reports/tmp/nominal-edge.json
//   npx tsx tools/nominal_measure.ts --part choices --out reports/tmp/nominal-choices.json
//   npx tsx tools/nominal_measure.ts --part session --seed nm-a --seasons 50 --team LG --out reports/tmp/nominal-session-nm-a.jsonl
//   npx tsx tools/nominal_measure.ts --part report --edge reports/tmp/nominal-edge.json --choices reports/tmp/nominal-choices.json
//        --sessions reports/tmp/nominal-session-nm-a.jsonl,reports/tmp/nominal-session-nm-b.jsonl --out reports/nominal-content.md

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, Season, type EngineParams, type World } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { worldFromLeague } from '../src/league/world';
import { ensureEvents, EVENTS, type EventContext, type EventDef } from '../src/league/events';
import { CAMP_DAYS, CAMP_FOCUSES, CAMP_PLACES, FOCUS, PLACE } from '../src/league/camp';
import { COACH_DECLINE, COACH_EDGE, COACH_GROWTH, COACH_ROLES, COACH_SALARY } from '../src/league/coaches';
import { REP, REP_FA, REP_TRADE } from '../src/league/reputation';
import { infoOf, NEUTRAL_TACTICS as NEUTRAL, tacticsOf, type Tactics } from '../src/league/managers';
import { runsOf } from '../src/league/growth';
import { valueContext } from '../src/ai/value';
import { ACHIEVEMENTS, FIRE_BELOW } from '../src/league/owner';
import { BALLPARK } from '../src/league/finance';
import { installCalCache } from './calCache';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const part = arg('part', 'report')!;
const outPath = arg('out');
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

function writeOut(path: string | undefined, text: string): void {
  if (!path) { console.log(text); return; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`${path}에 썼습니다.`);
}

/** 작은 최소제곱 (정규방정식 + 가우스 소거). 계수와 표준오차 */
function ols(X: number[][], y: number[]): { b: number[]; se: number[]; sigma: number } {
  const n = X.length;
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      v[a] += X[i][a] * y[i];
      for (let c = 0; c < k; c++) A[a][c] += X[i][a] * X[i][c];
    }
  }
  // 역행렬 (가우스-조르단)
  const M = A.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('회귀 행렬이 특이합니다');
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f) for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const inv = M.map((r) => r.slice(k));
  const b = inv.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
  let rss = 0;
  for (let i = 0; i < n; i++) { const e = y[i] - X[i].reduce((s, x, j) => s + x * b[j], 0); rss += e * e; }
  const sigma2 = rss / Math.max(1, n - k);
  return { b, se: inv.map((r, i) => Math.sqrt(Math.max(0, r[i] * sigma2))), sigma: Math.sqrt(sigma2) };
}

// ---------------------------------------------------------------- edge

const TACTIC_KEYS: (keyof Tactics)[] = ['steal', 'bunt', 'hook', 'pen', 'ibb', 'cond'];

interface EdgeRow { season: number; team: number; eBat: number; ePit: number; tactics: Tactics; manager: string; g: number; w: number; l: number; rs: number; ra: number; sb: number; sac: number }

async function partEdge(): Promise<void> {
  installCalCache();
  const store = loadDataStore();
  const n = Number(arg('seasons', '80'));
  const seed = arg('seed', 'nm-edge')!;
  const range = Number(arg('range', '0.02'));
  const { league } = createLeague(store, 2026, seed, FAST);
  const world = worldFromLeague(structuredClone(league), store, FAST);
  const names = Object.keys(store.managers?.people ?? {}).sort();
  const first = Season.start(world, FAST, `${seed}/0`);
  const cal = first.cal;
  const rows: EdgeRow[] = [];
  const t0 = Date.now();
  for (let s = 0; s < n; s++) {
    const rng = new Rng(`${seed}/assign/${s}`);
    const season = s === 0 ? first : Season.start(world, FAST, `${seed}/${s}`, { cal });
    const T = world.teams.length;
    const eBat = Array.from({ length: T }, () => (rng.next() * 2 - 1) * range);
    const ePit = Array.from({ length: T }, () => (rng.next() * 2 - 1) * range);
    // 리그 평균 0 (환경 맞춤은 고정이라 합이 0이 아니면 리그 득점이 움직인다)
    const mb = eBat.reduce((a, b) => a + b, 0) / T;
    const mp = ePit.reduce((a, b) => a + b, 0) / T;
    for (let t = 0; t < T; t++) { eBat[t] -= mb; ePit[t] -= mp; }
    const mgr = Array.from({ length: T }, () => names[rng.int(names.length)]);
    // 투구 단위 값(byYear)이 있는 감독은 그 마지막 해 값으로 (불펜 연투·고의4구·컨디션 반영까지 다르게)
    season.teamSeasons.forEach((ts, t) => {
      const info = infoOf(store, mgr[t]);
      const ys = Object.keys(info?.byYear ?? {}).map(Number);
      ts.tactics = tacticsOf(info, mgr[t], ys.length ? Math.max(...ys) : undefined);
    });
    const form = new Float64Array(world.players.length);
    for (const p of world.players) form[p.idx] = p.isPitcher ? ePit[p.teamIdx] : eBat[p.teamIdx];
    while (!season.done) { season.setForm(form); season.simulateDay(); }
    const sb = new Array(T).fill(0);
    const sac = new Array(T).fill(0);
    for (const p of world.players) { sb[p.teamIdx] += season.bat[p.idx].sb; sac[p.teamIdx] += (season.bat[p.idx] as unknown as { sac?: number }).sac ?? 0; }
    season.teams.forEach((tr, t) => rows.push({ season: s, team: t, eBat: eBat[t], ePit: ePit[t], tactics: { ...NEUTRAL, ...season.teamSeasons[t].tactics }, manager: mgr[t], g: tr.g, w: tr.w, l: tr.l, rs: tr.rs, ra: tr.ra, sb: sb[t], sac: sac[t] }));
    console.log(`[edge] ${s + 1}/${n} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  }
  writeOut(outPath, JSON.stringify({ seed, range, seasonDays: first.schedule.length, rows }));
}

interface EdgeFit { winsPerBat: number; winsPerPit: number; seBat: number; sePit: number; runsPerWin: number; games: number; seasonDays: number; tactic: Record<string, { b: number; se: number; sd: number; lo: number; hi: number }>; sigma: number; n: number; rdPerBat: number; rdPerPit: number; sbPerSteal: number }

/** 회귀: 득실 기준 기대 승수(피타고리안 1.83 × 경기 수)를 edge·작전 배율·구단 고정 효과에 */
function fitEdge(data: { rows: EdgeRow[]; seasonDays: number }): EdgeFit {
  const rows = data.rows;
  const T = Math.max(...rows.map((r) => r.team)) + 1;
  const X = rows.map((r) => [r.eBat, r.ePit, ...TACTIC_KEYS.map((k) => r.tactics[k] - 1), ...Array.from({ length: T }, (_, t) => (r.team === t ? 1 : 0))]);
  const pyth = rows.map((r) => (r.rs ** 1.83 / (r.rs ** 1.83 + r.ra ** 1.83)) * r.g);
  const fit = ols(X, pyth);
  const rd = ols(X, rows.map((r) => r.rs - r.ra));
  // 승수 ↔ 득실: 피타고리안 승수를 득실 차에 회귀 (구단 고정 효과)
  const rpw = ols(rows.map((r) => [r.rs - r.ra, ...Array.from({ length: T }, (_, t) => (r.team === t ? 1 : 0))]), pyth);
  const steal = ols(rows.map((r) => [r.tactics.steal - 1, ...Array.from({ length: T }, (_, t) => (r.team === t ? 1 : 0))]), rows.map((r) => r.sb));
  const tactic: EdgeFit['tactic'] = {};
  TACTIC_KEYS.forEach((k, i) => {
    const xs = rows.map((r) => r.tactics[k]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    tactic[k] = { b: fit.b[2 + i], se: fit.se[2 + i], sd: Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length), lo: Math.min(...xs), hi: Math.max(...xs) };
  });
  const games = rows.reduce((a, r) => a + r.g, 0) / rows.length;
  return {
    winsPerBat: fit.b[0], winsPerPit: fit.b[1], seBat: fit.se[0], sePit: fit.se[1], runsPerWin: 1 / rpw.b[0], games, seasonDays: data.seasonDays, tactic,
    sigma: fit.sigma, n: rows.length, rdPerBat: rd.b[0], rdPerPit: rd.b[1], sbPerSteal: steal.b[0],
  };
}

// ---------------------------------------------------------------- choices

interface ChoiceEffect {
  /** 자금 (만 원, 2026년 물가) */ cash: number;
  trust: number; fans: number;
  /** 관중률 × 날 */ fillDays: number;
  /** 경기력: 구단 타자·투수 쪽 edge × 날, 선수 하나는 따로 (타자·선발·구원) */
  formBat: number; formPit: number; formOneBat: number; formOneSp: number; formOneRp: number;
  /** 컨디션 값 × 날 (구단 전체·한 선수) */ condTeam: number; condOne: number;
  /** 잠재력 (런, 합) */ potential: number;
  rest: number; restPitchers: number; trade: number;
  /** 효과가 미래 날짜(delay)에 걸린 경기력 몫 */ delayed: number;
}
const zero = (): ChoiceEffect => ({ cash: 0, trust: 0, fans: 0, fillDays: 0, formBat: 0, formPit: 0, formOneBat: 0, formOneSp: 0, formOneRp: 0, condTeam: 0, condOne: 0, potential: 0, rest: 0, restPitchers: 0, trade: 0, delayed: 0 });

interface ChoiceRow { label: string; n: number; mean: ChoiceEffect; fail: number }
interface EventRow { id: string; title: string; weight: number; manual: boolean; variants: string[]; choices: ChoiceRow[] }

async function partChoices(): Promise<void> {
  installCalCache();
  const store = loadDataStore();
  const team = arg('team', 'LG')!;
  const samples = Number(arg('samples', '24'));
  const days = (arg('days', '45,90,125') ?? '').split(',').map(Number);
  const teamIdx = store.season(2026)!.teams.findIndex((t) => t.name === team);
  const g = GameSession.create(store, { year: 2026, teamIdx, seed: arg('seed', 'nm-choices')! }, FAST);
  ensureEvents(g.league).chance = 0;
  const contexts: { label: string; c: EventContext }[] = [];
  let at = 0;
  for (const d of days) {
    g.advance(d - at);
    at = d;
    const base = g.eventContext();
    const T = base.teams;
    const mk = (label: string, o: Partial<EventContext>) => contexts.push({ label: `${d}일 ${label}`, c: { ...base, ...o } });
    mk('그대로', {});
    mk('1위', { rank: 1, rankLabel: '1위', winPct: 0.6 });
    mk('꼴찌', { rank: T, rankLabel: `${T}위`, winPct: 0.4 });
    mk('5연패', { streak: -5, recent: { w: 2, l: 8 } });
    mk('5연승', { streak: 5, recent: { w: 8, l: 2 } });
    mk('7월·라이벌', { month: 7, hasRival: true });
    mk('8월', { month: 8 });
    mk('마감 뒤', { tradeOpen: false });
    // 선수 상태로만 걸리는 이벤트 (지친 불펜·많이 던진 선발·부진한 주전): 모의로 선수 기록을 바꾼 상황
    const topSp = [...base.players].filter((p) => p.isPitcher && p.starter).sort((a, b) => b.outs - a.outs)[0]?.id;
    const topBat = [...base.players].filter((p) => !p.isPitcher).sort((a, b) => b.pa - a.pa)[0]?.id;
    mk('지친 불펜·많이 던진 선발·부진 주전', {
      players: base.players.map((p) => ({
        ...p,
        ...(p.isPitcher && !p.starter ? { fatigue: Math.max(p.fatigue, 30) } : {}),
        ...(p.id === topSp ? { outs: Math.max(p.outs, 330) } : {}),
        ...(p.id === topBat ? { pa: Math.max(p.pa, 200), ops: 0.6 } : {}),
      })),
    });
  }
  const players = contexts[contexts.length - 1].c.players;
  const kind = new Map(players.map((p) => [p.id, p.isPitcher ? (p.starter ? 'sp' : 'rp') : 'bat']));
  const out: EventRow[] = [];
  for (const def of EVENTS) {
    const row: EventRow = { id: def.id, title: def.title, weight: def.weight, manual: !!def.manual, variants: [], choices: def.choices.map((ch) => ({ label: ch.label, n: 0, mean: zero(), fail: 0 })) };
    for (const { label, c } of contexts) {
      if (def.manual) { if (label.endsWith('그대로')) row.variants.push(label); else continue; }
      else if (def.when && !def.when(c)) continue;
      else row.variants.push(label);
      for (let s = 0; s < samples; s++) {
        let vars: Record<string, number | string> = {};
        try { vars = def.vars ? def.vars(c, new Rng(`nm/vars/${def.id}/${label}/${s}`)) : {}; } catch { row.choices.forEach((r) => r.fail++); continue; }
        def.choices.forEach((ch, ci) => {
          const e = zero();
          const pots = new Map(c.roster.map((p) => [p.id, p.potential]));
          const mock: EventContext = {
            ...c,
            addCash: (m) => { e.cash += m; },
            addTrust: (d) => { e.trust += d; },
            addFill: (f, dd) => { e.fillDays += f * dd; },
            addFans: (d) => { e.fans += d; },
            addPotential: (_id, d) => { e.potential += d; },
            addForm: (edge, dd, _n, o) => {
              const k = o?.player ? kind.get(o.player) ?? 'bat' : null;
              if (o?.delay) e.delayed += edge * dd;
              if (k === 'bat') e.formOneBat += edge * dd; else if (k === 'sp') e.formOneSp += edge * dd; else if (k === 'rp') e.formOneRp += edge * dd;
              else { if (o?.side !== 'pit') e.formBat += edge * dd; if (o?.side !== 'bat') e.formPit += edge * dd; }
            },
            addCond: (v, dd, _r, o) => { if (o?.player) e.condOne += v * dd; else e.condTeam += v * dd; },
            restPitchers: () => { e.restPitchers++; },
            rest: () => { e.rest++; },
            tradeOffer: () => null,
            trade: () => { e.trade++; return ''; },
          };
          try {
            ch.apply(mock, vars, new Rng(`nm/apply/${def.id}/${label}/${s}`));
          } catch { row.choices[ci].fail++; }
          // 잠재력을 리그 상태에 바로 쓰는 선택지 (events.ts 일부): 차이를 재고 되돌린다
          for (const p of c.roster) { const was = pots.get(p.id)!; if (p.potential !== was) { e.potential += p.potential - was; p.potential = was; } }
          const r = row.choices[ci];
          r.n++;
          for (const k of Object.keys(e) as (keyof ChoiceEffect)[]) r.mean[k] += e[k];
        });
      }
    }
    for (const r of row.choices) if (r.n) for (const k of Object.keys(r.mean) as (keyof ChoiceEffect)[]) r.mean[k] /= r.n;
    out.push(row);
  }
  const fin = g.league.finance?.[teamIdx]?.history.at(-1);
  writeOut(outPath, JSON.stringify({ team, seasonDays: g.season.schedule.length, wage: 1, variants: contexts.length, events: out, sample: fin ?? null }));
}

// ---------------------------------------------------------------- session

interface YearRec {
  seed: string; year: number; team: number; teamName: string; teams: string[];
  wins: number[]; losses: number[]; games: number[]; standings: number[]; postseasonTeams: number; champion: number | null;
  events: { id: string; choice: number; day: number }[];
  eventCash: number; eventForm: { bat: number; pit: number; one: number }; eventFill: number;
  revenue: number; gate: number; attendance: number; homeGames: number; capacity: number;
  trustBefore: number; trustAfter: number; rep: number; fired: boolean; achievements: string[];
  camps: { team: number; place: string; focus: string; cost?: number; grown?: number; grownRuns?: number }[];
  /** 구단별 정규시즌 부상 결장 (경기 전·경기 중 부상, 이탈 이벤트 뺌): 횟수, 결장 일 합 (2026-11-12 이벤트·캠프 개편 카드) */
  injuries?: { n: number; days: number }[];
  coaches: number[][];
  managerChanges: { team: number; reason: string; to: string }[];
  tactics: Tactics[];
  /** 그 시즌 구단별 감독 이름 */
  managers: string[];
  rivals: number; myRivals: number;
  stats: { sb: number; cs: number; topSb: number; ip180: number; ip150: number; w20: number; w15: number; sv40: number; sv30: number; topIp: number; topW: number; topSv: number; teams: number; games: number };
  faAsks: number[];
  growth: { bat: number; pit: number }[];
  scSeasonDays: number;
}

async function partSession(): Promise<void> {
  installCalCache();
  const store = loadDataStore();
  const seed = arg('seed', 'nm-a')!;
  const n = Number(arg('seasons', '50'));
  const team = arg('team', 'LG')!;
  const out = outPath ?? `reports/tmp/nominal-session-${seed}.jsonl`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, '');
  const teamIdx = store.season(2026)!.teams.findIndex((t) => t.name === team);
  const g = GameSession.create(store, { year: 2026, teamIdx, seed, difficulty: 'normal' }, FAST);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const L = g.league;
    const year = g.year;
    const T = g.world.teams.length;
    // 성장 폭: 개막 상태의 능력(런)을 적어 두었다가 다음 개막 때 견준다
    const ctx0 = valueContext(g.world);
    const before = new Map(L.players.filter((p) => p.team >= 0).map((p) => [p.id, { team: p.team, pit: !!p.isPitcher, runs: runsOf(p, ctx0, year) }]));
    g.advance(100000);
    const s = g.season;
    const st = s.standings();
    const myRow = g.team;
    // 도루·이닝·승·세이브 (정규시즌)
    const bat = g.world.players.map((p) => s.bat[p.idx]);
    const pit = g.world.players.map((p) => s.pit[p.idx]);
    const stats = {
      sb: bat.reduce((a, b) => a + b.sb, 0), cs: bat.reduce((a, b) => a + b.cs, 0), topSb: Math.max(...bat.map((b) => b.sb)),
      ip180: pit.filter((q) => q.outs >= 540).length, ip150: pit.filter((q) => q.outs >= 450).length,
      w20: pit.filter((q) => q.w >= 20).length, w15: pit.filter((q) => q.w >= 15).length,
      sv40: pit.filter((q) => q.sv >= 40).length, sv30: pit.filter((q) => q.sv >= 30).length,
      topIp: Math.max(...pit.map((q) => q.outs)) / 3, topW: Math.max(...pit.map((q) => q.w)), topSv: Math.max(...pit.map((q) => q.sv)),
      teams: T, games: Math.max(...s.teams.map((x) => x.g)),
    };
    const forms = (L.events?.forms ?? []).filter((f) => f.team === teamIdx && f.year === year && !f.note.startsWith('스프링캠프'));
    const eventForm = { bat: 0, pit: 0, one: 0 };
    for (const f of forms) {
      const d = f.until - f.from;
      if (f.player) eventForm.one += f.edge * d;
      else { if (f.side !== 'pit') eventForm.bat += f.edge * d; if (f.side !== 'bat') eventForm.pit += f.edge * d; }
    }
    const eventFill = (L.events?.buffs ?? []).filter((b) => b.team === teamIdx && b.year === year).reduce((a, b) => a + b.fill * (b.until - b.from), 0);
    const events = (L.events?.log ?? []).filter((l) => l.year === year).map((l) => ({ id: l.id, choice: l.choice, day: l.day }));
    const camps = (L.camps ?? []).filter((c) => c.year === year).map((c) => ({ team: c.team, place: c.place, focus: c.focus, cost: c.cost, grown: c.grown ?? 0, grownRuns: c.grownRuns ?? 0 }));
    const injuries = Array.from({ length: T }, () => ({ n: 0, days: 0 }));
    for (const a of s.absences) {
      if (a.kind === 'event') continue;
      const t = g.world.players[a.idx]?.teamIdx;
      if (t === undefined || t < 0 || t >= T) continue;
      injuries[t].n++;
      injuries[t].days += Math.max(0, Math.min(a.until, s.schedule.length) - a.day);
    }
    const coaches = Array.from({ length: T }, (_, t) => COACH_ROLES.map((r) => L.coaches?.[t]?.find((c) => c.role === r)?.level ?? 0));
    const tactics = s.teamSeasons.map((ts) => ({ ...NEUTRAL, ...ts.tactics }));
    const rivals = L.rivals?.pairs.length ?? 0;
    const myFr = L.teams[teamIdx].franchise;
    const myRivals = (L.rivals?.pairs ?? []).filter((p) => p.a === myFr || p.b === myFr).length;
    const trustBefore = g.owner.trust;
    const teamNames = g.world.teams.map((t) => t.name);
    const wins = s.teams.map((x) => x.w);
    const losses = s.teams.map((x) => x.l);
    const games = s.teams.map((x) => x.g);
    const scSeasonDays = s.schedule.length;
    const achBefore = g.owner.achievements.length;
    const firedBefore = g.owner.firedYears.length;
    const mgrBefore = L.managerLog?.length ?? 0;

    g.beginOffseason();
    const L2 = g.league;
    const fin = L2.finance?.[teamIdx]?.history.find((h) => h.year === year);
    const items = fin?.items ?? {};
    const revenue = Object.entries(items).filter(([k, v]) => v > 0 && k !== 'start' && k !== 'rescue').reduce((a, [, v]) => a + v, 0);
    const eventCash = L2.ledger.filter((x) => x.year === year && x.kind === 'event').reduce((a, x) => a + (x.to === teamIdx ? x.amount : x.from === teamIdx ? -x.amount : 0), 0);
    const hist = g.owner.history.at(-1);
    const champion = g.owner.history.at(-1)?.champion ? teamIdx : null;
    // 오프시즌: 우리 구단 FA는 AI 규칙, 나머지 단계는 자동, 해고되면 첫 제의를 받는다 (tools/challenge_odds.ts와 같은 방식)
    let k = 0;
    let faAsks: number[] = [];
    while (g.offseason!.stage !== 'ready' && k++ < 60) {
      const stg = g.offseason!.stage;
      if (stg === 'draft') g.autoDraft();
      if (stg === 'comp') g.autoComp();
      if (stg === 'release') g.autoRelease();
      if (stg === 'fa') faAsks = (g.offseason!.fa?.entries ?? []).filter((e) => !e.returnee).map((e) => e.ask).sort((a, b) => b - a).slice(0, 15);
      g.offseason!.userTeam = stg === 'fa' ? -1 : g.teamIdx;
      const r = g.nextStage();
      if (!r.ok && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
    }
    if (!faAsks.length) faAsks = (g.offseason!.fa?.entries ?? []).filter((e) => !e.returnee).map((e) => e.ask).sort((a, b) => b - a).slice(0, 15);
    g.offseason!.userTeam = g.teamIdx;
    const o = g.openNextSeason();
    if (!o.ok) throw new Error(o.message);
    // 감독 교체는 개막(openManagers) 때 기록된다: 시즌 중 경질 + 오프시즌 + 개막을 모두 센다
    const managerChanges = (g.league.managerLog ?? []).slice(mgrBefore).filter((c) => c.to).map((c) => ({ team: c.team, reason: c.reason, to: c.to }));
    // 성장 폭 (구단별 타자·투수, 같은 구단에 남은 선수의 상위 25명 안 오른 몫 합, 런)
    const ctx1 = valueContext(g.world);
    const growth = Array.from({ length: T }, () => ({ bat: 0, pit: 0 }));
    const gains: { team: number; pit: boolean; gain: number; runs: number }[] = [];
    for (const p of g.league.players) {
      const b = before.get(p.id);
      if (!b || p.team !== b.team || b.team >= T) continue;
      const now = runsOf(p, ctx1, g.year);
      gains.push({ team: b.team, pit: b.pit, gain: now - b.runs, runs: now });
    }
    for (let t = 0; t < T; t++) {
      const top = gains.filter((x) => x.team === t).sort((a, b) => b.runs - a.runs).slice(0, 25);
      for (const x of top) if (x.gain > 0) growth[t][x.pit ? 'pit' : 'bat'] += x.gain;
    }
    const ach = g.owner.achievements.slice(achBefore).map((a) => a.id);
    const rec: YearRec = {
      seed, year, team: teamIdx, teamName: myRow.name, teams: teamNames, wins, losses, games, standings: st,
      postseasonTeams: g.world.rules.postseasonTeams, champion,
      events, eventCash, eventForm, eventFill,
      revenue, gate: items.gate ?? 0, attendance: fin?.attendance ?? 0, homeGames: fin?.homeGames ?? 0, capacity: BALLPARK[myRow.name]?.capacity ?? 0,
      trustBefore, trustAfter: hist?.trustAfter ?? g.owner.trust, rep: L2.reputation?.value ?? 50, fired: g.owner.firedYears.length > firedBefore, achievements: ach,
      camps, injuries, coaches, managerChanges, tactics, managers: s.teamSeasons.map((_, t) => L.managers?.[t]?.name ?? ''), rivals, myRivals, stats, faAsks, growth, scSeasonDays,
    };
    appendFileSync(out, JSON.stringify(rec) + '\n');
    console.log(`[${seed}] ${year} ${myRow.name} ${wins[teamIdx]}승, 이벤트 ${events.length}, 신뢰 ${rec.trustAfter}, 평판 ${rec.rep}, 도루 ${stats.sb}, 180이닝 ${stats.ip180} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    teamIdx !== g.teamIdx && console.log(`[${seed}] 맡은 구단이 바뀜: ${g.team.name}`);
  }
}

// ---------------------------------------------------------------- report

const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const eok = (man: number, d = 1) => f1(man / 10000, d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sdv = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

function realStats(store: DataStore, from: number, to: number) {
  const rows: { year: number; sb: number; cs: number; topSb: number; ip180: number; ip150: number; w20: number; w15: number; sv40: number; sv30: number; topIp: number; topW: number; topSv: number; teams: number; games: number; csKnown: boolean }[] = [];
  for (let y = from; y <= to; y++) {
    const s = store.season(y);
    if (!s) continue;
    const bat = new Map<string, { sb: number; cs: number }>();
    for (const b of s.bat) { const x = bat.get(b.id) ?? { sb: 0, cs: 0 }; x.sb += b.sb ?? 0; x.cs += b.cs ?? 0; bat.set(b.id, x); }
    const pit = new Map<string, { outs: number; w: number; sv: number }>();
    for (const p of s.pit) { const x = pit.get(p.id) ?? { outs: 0, w: 0, sv: 0 }; x.outs += p.outs; x.w += p.w; x.sv += p.sv; pit.set(p.id, x); }
    const bs = [...bat.values()];
    const ps = [...pit.values()];
    rows.push({
      year: y, sb: s.league.sb, cs: bs.reduce((a, b) => a + b.cs, 0), topSb: Math.max(...bs.map((b) => b.sb)),
      ip180: ps.filter((q) => q.outs >= 540).length, ip150: ps.filter((q) => q.outs >= 450).length,
      w20: ps.filter((q) => q.w >= 20).length, w15: ps.filter((q) => q.w >= 15).length, sv40: ps.filter((q) => q.sv >= 40).length, sv30: ps.filter((q) => q.sv >= 30).length,
      topIp: Math.max(...ps.map((q) => q.outs)) / 3, topW: Math.max(...ps.map((q) => q.w)), topSv: Math.max(...ps.map((q) => q.sv)),
      teams: s.teams.length, games: s.games, csKnown: s.bat.some((b) => b.cs !== null),
    });
  }
  return rows;
}

async function partReport(): Promise<void> {
  // 손으로 쓴 해석 (원인 짐작·판정 의견): --notes 파일의 '<!-- causes -->'·'<!-- verdict -->' 아래 글
  const notesPath = arg('notes', 'reports/nominal-content-notes.md')!;
  const notesText = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
  const note = (k: string) => (notesText.split(`<!-- ${k} -->`)[1]?.split('<!-- ')[0] ?? '').trim() + '\n';
  const store = loadDataStore();
  const edgeRaw = JSON.parse(readFileSync(arg('edge', 'reports/tmp/nominal-edge.json')!, 'utf8'));
  const E = fitEdge(edgeRaw);
  const C = JSON.parse(readFileSync(arg('choices', 'reports/tmp/nominal-choices.json')!, 'utf8')) as { team: string; seasonDays: number; events: EventRow[]; variants: number };
  const nVariants = C.variants;
  const files = (arg('sessions', '') ?? '').split(',').filter((x) => x && existsSync(x));
  const Y: YearRec[] = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as YearRec));
  const seeds = [...new Set(Y.map((y) => y.seed))];
  const nSeasons = Y.length;
  const days = E.seasonDays;
  /** 구단 전체 edge × 날 → 승수 (타자·투수 쪽) */
  const winsOf = (bat: number, pit: number) => (bat / days) * E.winsPerBat + (pit / days) * E.winsPerPit;
  // 선수 하나 경기력의 근사 몫 (팀 타석의 1/9, 선발 투수 이닝 몫 12%, 구원 5%): 근사
  const ONE = { bat: 1 / 9, sp: 0.12, rp: 0.05 };
  const condEdge = DEFAULT_PARAMS.cond.edge;
  const choiceWins = (e: ChoiceEffect) => winsOf(e.formBat, e.formPit) + (e.formOneBat * ONE.bat / days) * E.winsPerBat + ((e.formOneSp * ONE.sp + e.formOneRp * ONE.rp) / days) * E.winsPerPit
    + winsOf(e.condTeam * condEdge, e.condTeam * condEdge) + (e.condOne * condEdge * ONE.bat / days) * E.winsPerBat;
  // 관중률 × 날 → 관중 수입 근사: (관중 수입 ÷ 관중) × 수용 인원 × 관중률 × 홈 경기 몫(날의 절반)
  const myY = Y.filter((y) => y.gate > 0 && y.attendance > 0);
  const perFan = mean(myY.map((y) => y.gate / y.attendance));
  const cap = mean(myY.map((y) => y.capacity || 20000));
  const fillMan = (fd: number) => fd * cap * perFan * (mean(myY.map((y) => y.homeGames)) / days);
  const revenue = mean(Y.map((y) => y.revenue));

  const P: string[] = [];
  P.push('# 유명무실 후보 측정 (2026-11-12)\n');
  P.push(`도구: \`tools/nominal_measure.ts\` (갈래 edge·choices·session·report). 게임 규칙·값은 바꾸지 않았다. 세션: 2026 시작, 플레이어 자리 ${Y[0]?.teamName ?? '-'} (AI가 운영, 이벤트는 첫 선택지 자동, FA는 AI 규칙), 시드 ${seeds.join('·')}, 모두 ${nSeasons}시즌. 금액은 장부 그대로(그 해 연봉 지수가 곱해진 값, 2027년부터 오른다)이고 선택지 표만 2026년 돈이다.\n`);

  P.push('## 0. 눈금: 경기력 edge → 승수\n');
  P.push(`2026 월드로 ${E.n / 10}시즌, 구단마다 타자·투수 edge를 ±${edgeRaw.range} 안에서 무작위(리그 합 0)로, 감독을 실존 감독 명단에서 무작위로 걸고 득실 기준 기대 승수(피타고리안 1.83 × 경기 수)를 회귀했다 (구단 고정 효과).\n`);
  P.push('| 항목 | 값 |', '|---|---|',
    `| 타자 쪽 edge +0.01 시즌 내내 | ${f1(E.winsPerBat * 0.01, 2)}승 (표준오차 ${f1(E.seBat * 0.01, 2)}) |`,
    `| 투수 쪽 edge +0.01 시즌 내내 | ${f1(E.winsPerPit * 0.01, 2)}승 (표준오차 ${f1(E.sePit * 0.01, 2)}) |`,
    `| 구단 전체 edge +0.01 시즌 내내 | ${f1((E.winsPerBat + E.winsPerPit) * 0.01, 2)}승 |`,
    `| 득실 1승 | ${f1(E.runsPerWin, 1)}점 |`,
    `| 한 시즌 일정 길이 | ${days}일 (구단 경기 ${f1(E.games, 0)}) |`,
    `| 운 (같은 조건 구단 시즌 승수 표준편차) | ${f1(E.sigma, 1)}승 |`, '');
  P.push('비교: 홈 이점 0.013, 좌우 상성 0.035 (events.ts 주석).\n');

  // ---- 1. 이벤트
  P.push('## 1. 무작위 이벤트\n');
  const cnt = new Map<string, number>();
  for (const y of Y) for (const e of y.events) cnt.set(e.id, (cnt.get(e.id) ?? 0) + 1);
  const perSeason = mean(Y.map((y) => y.events.length));
  const total = [...cnt.values()].reduce((a, b) => a + b, 0);
  const allIds = EVENTS.map((d) => d.id);
  const per50 = (id: string) => ((cnt.get(id) ?? 0) / nSeasons) * 50;
  const rare = allIds.filter((id) => per50(id) <= 2);
  const never = allIds.filter((id) => !cnt.get(id));
  P.push(`세션 ${nSeasons}시즌에 이벤트 ${total}번 (시즌당 ${f1(perSeason)}번, 시즌당 표준편차 ${f1(sdv(Y.map((y) => y.events.length)))}). 종류 ${EVENTS.length}개 중 한 번이라도 나온 것 ${cnt.size}개, 50시즌 환산 2번 이하 ${rare.length}개 (그중 0번 ${never.length}개).\n`);
  const evCash = Y.map((y) => y.eventCash);
  const evWins = Y.map((y) => winsOf(y.eventForm.bat, y.eventForm.pit) + (y.eventForm.one * ONE.bat / days) * E.winsPerBat);
  P.push('| 시즌당 (플레이어 구단, 첫 선택지 자동) | 평균 | 10% | 90% |', '|---|---|---|---|',
    `| 이벤트 자금 (억) | ${eok(mean(evCash))} | ${eok(pct(evCash, 0.1))} | ${eok(pct(evCash, 0.9))} |`,
    `| 구단 수입 (억, 긴급 지원·시작 자금 뺌) | ${eok(revenue, 0)} | ${eok(pct(Y.map((y) => y.revenue), 0.1), 0)} | ${eok(pct(Y.map((y) => y.revenue), 0.9), 0)} |`,
    `| 이벤트 자금 ÷ 수입 | ${f1((mean(evCash.map(Math.abs)) / revenue) * 100, 2)}% (절댓값) | | |`,
    `| 이벤트 경기력 → 승수 (근사, 선수 하나 = 타자 몫) | ${f1(mean(evWins), 2)} | ${f1(pct(evWins, 0.1), 2)} | ${f1(pct(evWins, 0.9), 2)} |`,
    `| 이벤트 관중률 × 날 | ${f1(mean(Y.map((y) => y.eventFill)), 2)} (≈ ${eok(fillMan(mean(Y.map((y) => y.eventFill))), 2)}억) | | |`, '');
  // 선택지 표
  P.push('### 1.1 선택지별 효과 (모의 상황, 2026년 돈)\n');
  P.push(`2026 ${C.team} 시즌 45·90·125일 상황과 바꾼 상황(1위·꼴찌·5연패·5연승·7월 라이벌·8월·마감 뒤)에서 \`when\`이 맞는 곳만, 상황마다 난수 ${arg('samples', '24')}번. 승수 = 경기력·컨디션 효과를 0절 눈금으로 바꾼 값 (선수 하나는 타자 1/9·선발 12%·구원 5% 몫, 근사). 관중률은 관중 수입 근사(억). '선택지 차' = 가장 좋은 선택지와 가장 나쁜 선택지의 승수·자금 차이.\n`);
  P.push('| 이벤트 | 가중치 | 50시즌 횟수 | 맞는 상황 | 선택지: 자금(억)·신뢰·팬·관중(억)·승수·잠재(런) | 선택지 차 승수·자금(억) |', '|---|---|---|---|---|---|');
  const evSummary: { id: string; n50: number; maxWins: number; maxCash: number; spreadWins: number; spreadCash: number }[] = [];
  for (const ev of C.events) {
    const chs = ev.choices.filter((c) => c.n > 0);
    const cells = chs.map((c, i) => {
      const m = c.mean;
      const parts = [
        m.cash ? `${eok(m.cash, 1)}` : '0', m.trust ? `신뢰${m.trust > 0 ? '+' : ''}${f1(m.trust, 1)}` : '', m.fans ? `팬${m.fans > 0 ? '+' : ''}${f1(m.fans, 1)}` : '',
        m.fillDays ? `관중${eok(fillMan(m.fillDays), 2)}` : '', choiceWins(m) ? `${f1(choiceWins(m), 2)}승` : '', m.potential ? `잠재${f1(m.potential, 1)}` : '',
        m.rest ? `휴식${f1(m.rest, 1)}` : '', m.restPitchers ? '불펜 회복' : '', m.trade ? '트레이드' : '', c.fail ? `실패${c.fail}` : '',
      ].filter(Boolean).join(' ');
      return `${i + 1}) ${parts}`;
    });
    const w = chs.map((c) => choiceWins(c.mean));
    const cs = chs.map((c) => c.mean.cash);
    const n50 = per50(ev.id);
    evSummary.push({ id: ev.id, n50, maxWins: Math.max(0, ...w.map(Math.abs)), maxCash: Math.max(0, ...cs.map(Math.abs)), spreadWins: w.length ? Math.max(...w) - Math.min(...w) : 0, spreadCash: cs.length ? Math.max(...cs) - Math.min(...cs) : 0 });
    P.push(`| ${ev.title} (\`${ev.id}\`) | ${ev.weight}${ev.manual ? ' 따로' : ''} | ${f1(n50, 1)} | ${ev.variants.length}/${nVariants} | ${cells.join('<br>') || '모의 상황에서 안 맞음'} | ${w.length ? `${f1(Math.max(...w) - Math.min(...w), 2)} · ${eok(Math.max(...cs) - Math.min(...cs))}` : '-'} |`);
  }
  P.push('');
  const big = evSummary.filter((e) => e.spreadWins >= 0.3).length;
  const money = evSummary.filter((e) => e.spreadCash >= 50_000).length;
  const tinyIds = evSummary.filter((e) => e.spreadWins < 0.05 && e.spreadCash < 10_000).map((e) => e.id);
  const tiny = tinyIds.length;
  if (arg('tiny-out')) writeFileSync(arg('tiny-out')!, JSON.stringify({ tiny: tinyIds, summary: evSummary }, null, 1));
  P.push(`요약: 선택지 차가 0.3승 이상인 이벤트 ${big}개, 5억 이상 ${money}개, 둘 다 미미한(0.05승·1억 미만) 이벤트 ${tiny}개 (모의 상황에서 안 맞는 이벤트 포함). 50시즌 2번 이하 이벤트: ${rare.map((id) => `\`${id}\``).join(', ') || '없음'}.\n`);
  // 시즌당 합: 세션에서 나온 횟수 × 선택지 평균 효과 (자동 = 첫 선택지, 고르기 = 그 기준으로 가장 좋은 선택지)
  const byId = new Map(C.events.map((e) => [e.id, e]));
  const policy = (pick: (cs: ChoiceRow[]) => ChoiceRow | undefined) => {
    const acc = { cash: 0, trust: 0, fans: 0, wins: 0, fill: 0 };
    for (const [id, n] of cnt) {
      const ev = byId.get(id);
      const ch = ev && pick(ev.choices.filter((c) => c.n > 0));
      if (!ch) continue;
      const k = n / nSeasons;
      acc.cash += k * ch.mean.cash; acc.trust += k * ch.mean.trust; acc.fans += k * ch.mean.fans; acc.wins += k * choiceWins(ch.mean); acc.fill += k * fillMan(ch.mean.fillDays);
    }
    return acc;
  };
  const by = (f: (c: ChoiceRow) => number) => (cs: ChoiceRow[]) => [...cs].sort((a, b) => f(b) - f(a))[0];
  const pols: [string, ReturnType<typeof policy>][] = [
    ['자동 (첫 선택지)', policy((cs) => cs[0])],
    ['늘 자금 최대', policy(by((c) => c.mean.cash + fillMan(c.mean.fillDays)))],
    ['늘 신뢰 최대', policy(by((c) => c.mean.trust))],
    ['늘 승수 최대', policy(by((c) => choiceWins(c.mean)))],
  ];
  P.push('시즌당 합 (세션 횟수 × 선택지 평균 효과, 2026년 돈):\n');
  P.push('| 선택 방식 | 자금(억) | 관중(억) | 신뢰 | 팬 만족도 | 승수 |', '|---|---|---|---|---|---|',
    ...pols.map(([l, a]) => `| ${l} | ${eok(a.cash)} | ${eok(a.fill, 2)} | ${f1(a.trust, 1)} | ${f1(a.fans, 1)} | ${f1(a.wins, 2)} |`), '');

  // ---- 2. 캠프
  P.push('## 2. 스프링캠프\n');
  P.push(`개막 뒤 ${CAMP_DAYS}일 경기력 (장소 배율 × 방향 값). 승수 = 0절 눈금. 체력의 부상 0.85배와 유망주 성장은 승수에 넣지 않았다 (아래 줄).\n`);
  P.push(`| 장소 \\ 방향 | 비용(억) | ${CAMP_FOCUSES.map((f) => FOCUS[f].label).join(' | ')} |`, `|---|---|${CAMP_FOCUSES.map(() => '---|').join('')}`);
  for (const pl of CAMP_PLACES) {
    const pp = PLACE[pl];
    P.push(`| ${pp.label} | ${eok(pp.cost, 1)} | ${CAMP_FOCUSES.map((fc) => f1(winsOf(FOCUS[fc].bat * pp.factor * CAMP_DAYS, FOCUS[fc].pit * pp.factor * CAMP_DAYS), 3)).join(' | ')} |`);
  }
  const campW = (pl: string, fc: string) => winsOf(FOCUS[fc as keyof typeof FOCUS].bat * PLACE[pl as keyof typeof PLACE].factor * CAMP_DAYS, FOCUS[fc as keyof typeof FOCUS].pit * PLACE[pl as keyof typeof PLACE].factor * CAMP_DAYS);
  P.push('', `가장 비싼 캠프(미국·균형) − 가장 싼 캠프(국내·균형): ${f1(campW('usa', 'balanced') - campW('home', 'balanced'), 3)}승에 ${eok(PLACE.usa.cost - PLACE.home.cost)}억 (1승당 ${eok((PLACE.usa.cost - PLACE.home.cost) / Math.max(1e-9, campW('usa', 'balanced') - campW('home', 'balanced')), 0)}억). 국내 장소는 부상 1.05배.`);
  P.push(`유망주 집중: 24세 이하 선수마다 잠재력 안에서 ${FOCUS.youth.youth}런 × 장소 배율 (미국 ${f1(FOCUS.youth.youth * PLACE.usa.factor, 2)}런). 체력: 시즌 부상 빈도 ${FOCUS.fitness.injury}배.`);
  const campCnt = new Map<string, number>();
  for (const y of Y) for (const c of y.camps) if (c.team !== y.team) campCnt.set(`${c.place}/${c.focus}`, (campCnt.get(`${c.place}/${c.focus}`) ?? 0) + 1);
  const campTot = [...campCnt.values()].reduce((a, b) => a + b, 0);
  P.push('', `AI 구단의 선택 (세션 ${nSeasons}시즌): ${[...campCnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${PLACE[k.split('/')[0] as keyof typeof PLACE].label}·${FOCUS[k.split('/')[1] as keyof typeof FOCUS].label} ${f1((v / campTot) * 100, 0)}%`).join(', ')}.`, '');

  // ---- 3. 코치
  P.push('## 3. 코치\n');
  const lvWins = (lv: number) => ({ bat: winsOf((lv - 3) * COACH_EDGE * days, 0), pit: winsOf(0, (lv - 3) * COACH_EDGE * days) });
  const allGrowth = Y.flatMap((y) => y.growth);
  const gBat = mean(allGrowth.map((g) => g.bat));
  const gPit = mean(allGrowth.map((g) => g.pit));
  P.push(`시즌 경기력: 타격 코치 (등급 − 3) × ${COACH_EDGE} (타자), 투수 코치 (등급 − 3) × ${COACH_EDGE}·수비 코치 그 절반 (투수 쪽). 성장: 오른 몫 × (1 + (등급 − 3) × ${COACH_GROWTH}), 베테랑형은 31세 이상 하락 (등급 − 3) × ${COACH_DECLINE} 줄임. 구단 상위 25명 안 같은 구단에 남은 선수의 한 해 오른 몫 합 (세션 평균): 타자 ${f1(gBat)}런·투수 ${f1(gPit)}런.\n`);
  P.push('| 등급 | 연봉(억) | 타격 코치 시즌 승수 | 투수 코치 시즌 승수 | 수비 코치 시즌 승수 | 타격 코치 성장 몫(다음 해, 승) | 투수 코치 성장 몫(다음 해, 승) |', '|---|---|---|---|---|---|---|');
  for (let lv = 1; lv <= 5; lv++) {
    const w = lvWins(lv);
    P.push(`| ${lv} | ${eok(COACH_SALARY[lv])} | ${f1(w.bat, 2)} | ${f1(w.pit, 2)} | ${f1(w.pit / 2, 2)} | ${f1((gBat * (lv - 3) * COACH_GROWTH) / E.runsPerWin, 2)} | ${f1((gPit * (lv - 3) * COACH_GROWTH) / E.runsPerWin, 2)} |`);
  }
  const best = lvWins(5);
  const worst = lvWins(1);
  const fullSpan = (best.bat - worst.bat) + (best.pit - worst.pit) * 1.5 + ((gBat + gPit) * 4 * COACH_GROWTH) / E.runsPerWin;
  const pay = (COACH_SALARY[5] - COACH_SALARY[1]) * 4;
  P.push('', `5등급 넷 − 1등급 넷: 시즌 ${f1((best.bat - worst.bat) + (best.pit - worst.pit) * 1.5, 2)}승 + 성장 몫 ${f1(((gBat + gPit) * 4 * COACH_GROWTH) / E.runsPerWin, 2)}승 (다음 해부터, 쌓임) = 약 ${f1(fullSpan, 2)}승에 연봉 차 ${eok(pay)}억 (1승당 ${eok(pay / Math.max(1e-9, fullSpan), 0)}억).`);
  const lvAll = Y.flatMap((y) => y.coaches.filter((_, t) => t !== y.team).flat());
  const lvMine = Y.flatMap((y) => y.coaches[y.team] ?? []);
  const dist = (xs: number[]) => [0, 1, 2, 3, 4, 5].map((l) => `${l}:${f1((xs.filter((x) => x === l).length / Math.max(1, xs.length)) * 100, 0)}%`).join(' ');
  P.push(`세션 코치 등급 분포: AI 구단 ${dist(lvAll)} · 플레이어 자리(빈자리를 가장 싼 후보로 채움) ${dist(lvMine)} (0 = 빈자리).`, '');

  // ---- 4. 평판
  P.push('## 4. 단장 평판\n');
  const reps = Y.map((y) => y.rep);
  const asks = Y.flatMap((y) => y.faAsks);
  const topAsk = mean(Y.map((y) => y.faAsks[0] ?? NaN).filter(Number.isFinite));
  const askAvg = mean(asks);
  P.push(`효과: FA·다년 계약 요구 배율 1 − (평판 − 50)/50 × ${REP_FA} (0이면 +${REP_FA * 100}%, 100이면 −${REP_FA * 100}%), 트레이드 호의 (평판 − 50)/50 × ${REP_TRADE}런, 해고 뒤 제의 (70 이상 강팀 포함 3곳, 30 미만 2곳). 변화: 승률 (−.500) × ${REP.winPct}, 가을야구 +${REP.postseason}, 시리즈 승 +${REP.series}, 우승 +${REP.champion}, 목표 ±${REP.goalMet}, 해고 ${REP.fired}, 해마다 50 쪽 ${REP.revert * 100}%.\n`);
  P.push('| 평판 | FA 요구 배율 | 최고 FA 요구액 차 (억, 평판 50 대비) | FA 상위 15명 평균 요구액 차 (억) | 트레이드 호의 (런) | ≈ 승 |', '|---|---|---|---|---|---|');
  for (const r of [0, 50, 100]) {
    const m = 1 - ((r - 50) / 50) * REP_FA;
    P.push(`| ${r} | ${f1(m, 3)} | ${eok(topAsk * (m - 1))} | ${eok(askAvg * (m - 1), 2)} | ${f1(((r - 50) / 50) * REP_TRADE, 2)} | ${f1((((r - 50) / 50) * REP_TRADE) / E.runsPerWin, 2)} |`);
  }
  // 모든 구단에 같은 식을 걸어 본 가상 평판 (목표 항·업적·해고·캡은 뺌: 승률·가을야구·우승만)
  const hypo: number[] = [];
  for (const seed of seeds) {
    const ys = Y.filter((y) => y.seed === seed);
    const T = ys[0].teams.length;
    const v = new Array(T).fill(50);
    for (const y of ys) {
      for (let t = 0; t < Math.min(T, y.wins.length); t++) {
        const wp = y.wins[t] / Math.max(1, y.wins[t] + y.losses[t]);
        let d = (wp - 0.5) * REP.winPct;
        if (y.standings.indexOf(t) < y.postseasonTeams) d += REP.postseason;
        let x = v[t] + d;
        x += (50 - x) * REP.revert;
        v[t] = Math.max(0, Math.min(100, x));
        hypo.push(v[t]);
      }
    }
  }
  P.push('', `플레이어 자리 실제 평판 (${nSeasons}시즌): 평균 ${f1(mean(reps))}, 10% ${f1(pct(reps, 0.1))}, 90% ${f1(pct(reps, 0.9))}, 최소 ${f1(Math.min(...reps))}, 최대 ${f1(Math.max(...reps))}, 70 이상 ${f1((reps.filter((r) => r >= 70).length / reps.length) * 100, 0)}%·30 미만 ${f1((reps.filter((r) => r < 30).length / reps.length) * 100, 0)}%.`);
  P.push(`모든 구단 가상 평판 (승률·가을야구 항만): 10% ${f1(pct(hypo, 0.1))}, 50% ${f1(pct(hypo, 0.5))}, 90% ${f1(pct(hypo, 0.9))}, 최소 ${f1(Math.min(...hypo))}, 최대 ${f1(Math.max(...hypo))}.`, '');

  // ---- 5. 도루·이닝
  P.push('## 5. 도루·이닝 (게임 vs 실제)\n');
  const real = realStats(store, 2015, 2025);
  const real2 = realStats(store, 2023, 2025);
  const S = Y.map((y) => y.stats);
  const early = Y.filter((y) => y.year <= 2030).map((y) => y.stats);
  const late = Y.filter((y) => y.year >= 2046).map((y) => y.stats);
  type St = YearRec['stats'];
  const row = (label: string, k: (s: St) => number, d = 1) => `| ${label} | ${f1(mean(real.map(k as (s: unknown) => number)), d)} | ${f1(mean(real2.map(k as (s: unknown) => number)), d)} | ${f1(mean(early.map(k)), d)} | ${f1(mean(S.map(k)), d)} | ${f1(mean(late.map(k)), d)} |`;
  P.push('| 지표 (한 시즌) | 실제 2015~2025 평균 | 실제 2023~2025 평균 | 게임 2026~2030 | 게임 전체 | 게임 2046~ |', '|---|---|---|---|---|---|',
    row('리그 도루 합', (s) => s.sb, 0), row('리그 도루 실패 합', (s) => s.cs, 0), row('도루 성공률 %', (s) => (s.sb / Math.max(1, s.sb + s.cs)) * 100, 1),
    row('개인 최다 도루', (s) => s.topSb, 1), row('180이닝 투수 수', (s) => s.ip180, 1), row('150이닝 투수 수', (s) => s.ip150, 1), row('개인 최다 이닝', (s) => s.topIp, 1),
    row('20승 투수 수', (s) => s.w20, 2), row('15승 투수 수', (s) => s.w15, 1), row('개인 최다 승', (s) => s.topW, 1),
    row('40세이브 투수 수', (s) => s.sv40, 2), row('30세이브 투수 수', (s) => s.sv30, 1), row('개인 최다 세이브', (s) => s.topSv, 1), '');
  P.push(`실제는 자료집 시즌 기록(같은 선수 여러 구단 줄은 합침). 실제 도루 실패는 ${real.filter((r) => r.csKnown).length}/${real.length}해만 자료가 있다. 2015~2025 구단 수 10, 경기 수 144.\n`);
  P.push(note('causes'));

  // ---- 6. 감독·라이벌·업적
  P.push('## 6. 감독·라이벌·희귀 업적\n');
  const mc = Y.flatMap((y) => y.managerChanges);
  P.push(`감독 교체: ${nSeasons}시즌에 ${mc.length}번 (시즌당 ${f1(mc.length / nSeasons, 2)}), 사유 ${[...new Set(mc.map((m) => m.reason))].map((r) => `${r} ${mc.filter((m) => m.reason === r).length}`).join(', ')}.\n`);
  P.push('작전 배율 효과 (0절 회귀, 배율 1 대비 +0.1일 때 승수, 실존 감독 무작위):\n');
  P.push('| 배율 | 실존 감독 범위 | 표준편차 | +0.1 → 승 (표준오차) | 범위 끝 차 → 승 |', '|---|---|---|---|---|');
  for (const k of TACTIC_KEYS) {
    const t = E.tactic[k];
    P.push(`| ${k} | ${f1(t.lo, 2)}~${f1(t.hi, 2)} | ${f1(t.sd, 3)} | ${f1(t.b * 0.1, 2)} (${f1(t.se * 0.1, 2)}) | ${f1(t.b * (t.hi - t.lo), 2)} |`);
  }
  P.push('', `도루 배율 +0.1 → 팀 도루 ${f1(E.sbPerSteal * 0.1, 1)}개.`);
  const rv = Y.map((y) => y.rivals);
  P.push('', `라이벌 쌍 (개막 때, 리그 전체): 평균 ${f1(mean(rv), 2)}쌍, 0쌍인 해 ${f1((rv.filter((x) => x === 0).length / rv.length) * 100, 0)}%. 플레이어 자리에 라이벌이 있는 해 ${f1((Y.filter((y) => y.myRivals > 0).length / nSeasons) * 100, 0)}%.`);
  const achCnt = new Map<string, number>();
  for (const y of Y) for (const a of y.achievements) achCnt.set(a, (achCnt.get(a) ?? 0) + 1);
  const fired = Y.filter((y) => y.fired).length;
  const moved = seeds.map((s) => new Set(Y.filter((y) => y.seed === s).map((y) => y.teamName)).size);
  P.push(`해고 ${fired}번, 맡은 구단 수 (시드별) ${moved.join('·')}. 업적 (${nSeasons}시즌, 플레이어 자리 AI 운영): ${Object.keys(ACHIEVEMENTS).map((id) => `${ACHIEVEMENTS[id as keyof typeof ACHIEVEMENTS].label} ${achCnt.get(id) ?? 0}`).join(', ')}.`, '');
  const trusts = Y.map((y) => y.trustAfter);
  P.push(`구단주 신뢰 (결산 뒤, 플레이어 자리): 평균 ${f1(mean(trusts))}, 최소 ${f1(Math.min(...trusts), 0)}, 10% ${f1(pct(trusts, 0.1), 0)}, 해고선 ${FIRE_BELOW} 미만 ${trusts.filter((t) => t < FIRE_BELOW).length}번.`);
  const mgrNames = Y.flatMap((y) => (y.managers ?? []).map((m, t) => `${y.seed}/${t}/${m}`));
  if (mgrNames.length) P.push(`감독 이름 기록: 구단·시드마다 50시즌에 거친 감독 수 평균 ${f1(mean(seeds.flatMap((sd) => Y[0].teams.map((_, t) => new Set(Y.filter((y) => y.seed === sd).map((y) => y.managers?.[t])).size))), 1)}명.`);
  P.push('');
  P.push(note('verdict'));
  // 범위 물결표는 \~ (GitHub 취소선 방지). 이미 \~인 곳은 그대로
  writeOut(outPath, P.join('\n').replace(/(?<!\\)~/g, '\\~'));
}

const parts: Record<string, () => Promise<void>> = { edge: partEdge, choices: partChoices, session: partSession, report: partReport };
if (!parts[part]) throw new Error(`없는 갈래: ${part}`);
void parts[part]();

// 쓰지 않는 가져오기 경고 막기 (타입만)
export type { EventDef, World };
