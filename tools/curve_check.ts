// 성장·노화 곡선 점검 (2026-11-04 가상 투수 곡선 카드): 모든 구단 AI로 여러 시즌을 돌리며 선수 시즌 WAR·나이·능력(런)을 모으고,
// 100시즌 평가(docs/평가100.md)의 곡선 항목(B2 즉시 전력 신인·B4 리그 최고 WAR·A6 스타 전성기·D9 통산 150승)과 나이별 WAR 곡선을 잰다.
//
// 실행: npx tsx tools/curve_check.ts --seasons 50 --seeds curve-a,curve-b,curve-c --out reports/tmp/curve/now
//       (시드마다 <out>-<시드>.json, 모든 구단 AI. 50시즌은 시드 하나에 약 10~15분)
// 요약: npx tsx tools/curve_check.ts --report reports/tmp/curve/now-curve-a.json,… [--real reports/eval100/raw/real-1982.json]
//       (real 파일은 tools/eval100_real.ts 형식: 같은 셈으로 실제 KBO 값)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyPitLine, Season } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { asSim } from '../src/league/growth';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import { lineWarOf } from '../src/league/history';
import { worldFromLeague } from '../src/league/world';
import { installCalCache } from './calCache';
import { applySets } from './setParams';

const arg = (n: string, d = '') => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const PK = Object.keys(emptyPitLine()) as (keyof ReturnType<typeof emptyPitLine>)[];
const P = Object.fromEntries(PK.map((k, i) => [k, i])) as Record<(typeof PK)[number], number>;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** 한 시즌: [연도, 구단, WAR, 타석, 아웃, 홈런, 승, 세이브, 나이, 탈삼진, 홀드] — eval100 raw와 같은 순서. 뒤에 [시즌 앞 능력(런), 잠재(런)] */
type Row = number[];
interface Rec { n: string; real: boolean; pit: boolean; birth: number | null; foreign: boolean; asia: boolean; entry: number; school: string | null; pot0: number; first: number; s: Row[]; retired?: number }
interface Raw { meta: { seed: string; start: number; seasons: number }; players: Record<string, Rec> }

function run(seed: string, seasons: number, startYear: number, out: string): void {
  const store = loadDataStore();
  const params = DEFAULT_PARAMS;
  const { league } = createLeague(store, startYear, seed, params);
  const players: Record<string, Rec> = {};
  const t0 = Date.now();
  for (let i = 0; i < seasons; i++) {
    const year = league.year;
    const world = worldFromLeague(structuredClone(league), store, params);
    const ctx = valueContext(world);
    const before = new Map(league.players.map((p) => [p.id, { runs: currentRuns(asSim(p, ctx.world.league, year), ctx), pot: p.potential }]));
    const season = Season.start(world, params, i === 0 ? league.seed : `${league.seed}/${league.year}`);
    season.runToEnd();
    const off = Off.beginOffseason(league, world, season, store, -1, params);
    // 결산 직후: 이 시즌 줄 (eval100 collectSeason과 같은 셈)
    for (const p of league.players) {
      const rec = (players[p.id] ??= { n: p.name, real: p.real !== false, pit: p.isPitcher, birth: p.birthYear, foreign: p.foreign, asia: !!p.asia,
        entry: p.entryYear, school: p.school, pot0: r2(before.get(p.id)?.pot ?? p.potential), first: year, s: [] });
      const h = p.history.find((x) => x.year === year);
      if (!h || (!h.bat?.[0] && !h.pit?.[P.outs])) continue;
      const b0 = before.get(p.id);
      rec.s.push([year, world.teams.findIndex((t) => t.name === h.team), r2(lineWarOf(league, h, p.pos)), h.bat?.[0] ?? 0, h.pit?.[P.outs] ?? 0, 0,
        h.pit?.[P.w] ?? 0, h.pit?.[P.sv] ?? 0, p.birthYear ? year - p.birthYear : -1, h.pit?.[P.so] ?? 0, h.pit?.[P.hld] ?? 0, r2(b0?.runs ?? NaN), r2(b0?.pot ?? NaN)]);
    }
    let guard = 0;
    while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
    for (const r of (league.retired ?? []).filter((x) => x.year === year)) if (players[r.id]) players[r.id].retired = year;
    Off.closeOffseason(league, off);
    console.log(`${seed} ${year} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  }
  for (const [id, r] of Object.entries(players)) if (!r.s.length) delete players[id];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ meta: { seed, start: startYear, seasons }, players } satisfies Raw));
}

// ---- 요약

const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

interface Summary {
  label: string; years: number;
  b2: number; b4: number; a6: number; d9: number;
  /** 투수 몫: B2 투수만, B4 해마다 투수 최고 WAR 평균, A6 투수만, 투수 WAR 8+ 시즌 수(10시즌당) */
  b2p: number; b4p: number; a6p: number; p8: number;
  ageP: Record<number, { n: number; w: number; top: number }>; ageB: Record<number, { n: number; w: number; top: number }>;
  debutP: number[]; debutB: number[];
  /** 스타(커리어 최고 WAR 6+, 40세까지 지켜본 선수) 나이별 평균 WAR·뛴 비율 */
  starP: { n: number; at: Record<number, [number, number]> }; starB: { n: number; at: Record<number, [number, number]> };
}

/** 게임 판: 시작 해 뒤 입단한 국내 선수. 실제 판(real-*): 그 대조 시작 해부터 데뷔한 국내 선수 */
function summarize(file: string): Summary {
  const d = JSON.parse(readFileSync(file, 'utf8')) as Raw & { meta: { start?: number; seasons?: number; seed?: string } };
  const real = /real-\d+/.test(file);
  const start = real ? Number(/real-(\d+)/.exec(file)![1]) : d.meta.start;
  const ps = Object.values(d.players).filter((p) => !p.foreign && p.s.length > 0);
  const allRows = Object.values(d.players).flatMap((p) => p.s);
  const years = [...new Set(allRows.map((r) => r[0]))].sort((a, b) => a - b);
  const last = years[years.length - 1];
  const gen = ps.filter((p) => p.entry >= start); // eval100_score G와 같은 무리 (게임: 시작 해 뒤 입단, 실제 지명 신인 포함)
  // B2: 1군 첫 두 시즌 안에 WAR 3 이상인 시즌 수 (국내), 10시즌당 (eval100_score와 같이 기록 줄 앞 둘)
  const b2 = gen.reduce((n, p) => n + p.s.slice(0, 2).filter((r) => r[2] >= 3).length, 0) / years.length * 10;
  // B4: 해마다 WAR 1위 (외국인 포함), 마지막 절반 평균 (실제는 모든 해)
  const top = new Map<number, number>();
  for (const r of allRows) top.set(r[0], Math.max(top.get(r[0]) ?? -99, r[2]));
  const half = real ? years : years.slice(Math.floor(years.length / 2));
  const b4 = mean(half.map((y) => top.get(y)!));
  // A6: WAR 4+ 시즌이 3번 이상인 입단 무리 선수(마지막 해 5년 전에 끝난 커리어)의 WAR 4+ 시즌 수 평균
  const done = gen.filter((p) => p.s[p.s.length - 1][0] <= last - 5 || p.retired);
  const a6 = mean(done.map((p) => p.s.filter((r) => r[2] >= 4).length).filter((n) => n >= 3));
  const isPit = new Map(Object.values(d.players).flatMap((p) => p.s.map((r) => [r, p.pit] as const)));
  const topP = new Map<number, number>();
  for (const r of allRows) if (isPit.get(r)) topP.set(r[0], Math.max(topP.get(r[0]) ?? -99, r[2]));
  const b4p = mean(half.map((y) => topP.get(y)!));
  const b2p = gen.filter((p) => p.pit).reduce((n, p) => n + p.s.slice(0, 2).filter((r) => r[2] >= 3).length, 0) / years.length * 10;
  const a6p = mean(done.filter((p) => p.pit).map((p) => p.s.filter((r) => r[2] >= 4).length).filter((n) => n >= 3));
  const p8 = gen.filter((p) => p.pit).reduce((n, p) => n + p.s.filter((r) => r[2] >= 8).length, 0) / years.length * 10;
  // D9: 통산 150승 (게임 안 입단 투수), 100시즌 환산
  const d9 = gen.filter((p) => p.pit && p.s.reduce((s, r) => s + r[6], 0) >= 150).length / years.length * 100;
  const ageOf = (pit: boolean) => {
    const o: Summary['ageP'] = {};
    const by: Record<number, number[]> = {};
    for (const p of gen.filter((x) => x.pit === pit)) for (const r of p.s) if (r[8] > 0) (by[r[8]] ??= []).push(r[2]);
    for (const [a, ws] of Object.entries(by)) o[Number(a)] = { n: ws.length / years.length, w: mean(ws), top: q(ws, 0.9) };
    return o;
  };
  const starOf = (pit: boolean) => {
    const xs = gen.filter((p) => p.pit === pit && p.birth && p.birth + 40 <= last && Math.max(...p.s.map((r) => r[2])) >= 6);
    const at: Record<number, [number, number]> = {};
    for (let a = 20; a <= 40; a += 2) {
      const ws = xs.map((p) => p.s.filter((r) => r[8] === a || r[8] === a + 1).map((r) => r[2])).flat();
      const played = xs.filter((p) => p.s.some((r) => r[8] === a || r[8] === a + 1)).length;
      at[a] = [mean(ws), xs.length ? played / xs.length : NaN];
    }
    return { n: xs.length / years.length, at };
  };
  return {
    starP: starOf(true), starB: starOf(false),
    label: real ? `실제 ${start}~` : file.replace(/^.*[/\\]|\.json$/g, ''), years: years.length, b2, b4, a6, d9, b2p, b4p, a6p, p8,
    ageP: ageOf(true), ageB: ageOf(false),
    debutP: gen.filter((p) => p.pit).map((p) => p.s[0][2]), debutB: gen.filter((p) => !p.pit).map((p) => p.s[0][2]),
  };
}

function report(files: string[]): void {
  const ss = files.map(summarize);
  console.log('| 판 | 시즌 | B2 즉시 전력 신인(10시즌당) | B4 리그 최고 WAR | A6 전성기 | D9 150승(100시즌) | 투수 B2 | 투수 B4 | 투수 A6 | 투수 WAR 8+(10시즌당) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of ss) console.log(`| ${s.label} | ${s.years} | ${f(s.b2, 1)} | ${f(s.b4)} | ${f(s.a6)} | ${f(s.d9, 1)} | ${f(s.b2p, 1)} | ${f(s.b4p)} | ${f(s.a6p)} | ${f(s.p8, 1)} |`);
  console.log('기준: B2 6~16, B4 7.5~10, A6 4~7, D9 5~18');
  for (const [name, key] of [['투수', 'ageP'], ['타자', 'ageB']] as const) {
    console.log(`\n${name} 나이별 평균 WAR / 상위 10% (해마다 시즌 수)`);
    console.log(`| 나이 | ${ss.map((s) => s.label).join(' | ')} |`);
    console.log(`|---|${ss.map(() => '---').join('|')}|`);
    for (let a = 18; a <= 42; a++) console.log(`| ${a} | ${ss.map((s) => { const c = s[key][a]; return c ? `${f(c.w)} / ${f(c.top)} (${f(c.n, 1)})` : '-'; }).join(' | ')} |`);
  }
  for (const [name, key] of [['투수', 'starP'], ['타자', 'starB']] as const) {
    console.log(`\n${name} 스타(최고 WAR 6+) 나이별 평균 WAR (그 두 해에 뛴 비율)`);
    console.log(`| 나이 | ${ss.map((s) => `${s.label} (해마다 ${f(s[key].n)}명)`).join(' | ')} |`);
    console.log(`|---|${ss.map(() => '---').join('|')}|`);
    for (let a = 20; a <= 40; a += 2) console.log(`| ${a}~${a + 1} | ${ss.map((s) => { const [w, r] = s[key].at[a]; return `${f(w, 1)} (${f(100 * r, 0)}%)`; }).join(' | ')} |`);
  }
  console.log('\n데뷔 첫해 WAR (분위 50/90/99 · 최대 · 3+ 비율)');
  for (const s of ss) for (const [name, xs] of [['투수', s.debutP], ['타자', s.debutB]] as const) {
    console.log(`  ${s.label} ${name}: ${f(q(xs, 0.5))} / ${f(q(xs, 0.9))} / ${f(q(xs, 0.99))} · ${f(Math.max(...xs))} · ${f(xs.filter((x) => x >= 3).length / xs.length, 3)} (${xs.length}명)`);
  }
}

if (arg('report')) report(arg('report').split(','));
else {
  applySets(arg('set'));
  installCalCache();
  const seasons = Number(arg('seasons', '50'));
  const start = Number(arg('start', '2026'));
  const out = arg('out', 'reports/tmp/curve/run');
  for (const seed of arg('seeds', 'curve-a').split(',')) run(seed, seasons, start, `${out}-${seed}.json`);
}
