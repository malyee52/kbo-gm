// 장기 진행 흐름 진단: 해마다 선수 유입·유출, 방출된 유망주, 입대, 포수 수, 상위 270명 기여 합을 잰다 (docs/longterm-plan.md).
// 실행: npx tsx tools/flow_longterm.ts --seasons 15 --seeds diag-a,diag-b [--start 2005]  (시드당 약 30초, 모든 구단 AI)
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { isServing } from '../src/league/careers';
import { asSim } from '../src/league/growth';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import type { LeaguePlayer } from '../src/league/types';
import { worldFromLeague } from '../src/league/world';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const seasons = Number(arg('seasons', '15'));
const seeds = arg('seeds', 'diag-a,diag-b').split(',');
const startYear = Number(arg('start', '2026'));
const store = loadDataStore();
// 능력치 기준 (--basis season|prior, 기본 prior: 예전 측정과 같게)
const params = { ...DEFAULT_PARAMS, ratingBasis: arg('basis', 'prior') as 'season' | 'prior', potential: { ...DEFAULT_PARAMS.potential } };
// 잠재력 손잡이 덮어쓰기 (16-5 맞춤용): --pot reachBase=0.8,draftScale=9.5,room=10.5/6/4.5/1.5
for (const kv of arg('pot', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  (params.potential as Record<string, unknown>)[k] = v.includes('/') ? v.split('/').map(Number) : Number(v);
}
if (arg('pot', '')) console.log(`잠재력 손잡이: ${arg('pot', '')}`);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

for (const seed of seeds) {
  const { league } = createLeague(store, startYear, seed, params);
  const startIds = new Set(league.players.map((p) => p.id));
  // 시작 때 30세 이하 실존 국내 선수(그 해 입단 신인 제외): 시작 능력과 5시즌 안 최고 능력 (tools/fit_prospects.ts 실측과 견줌, 기획안 4.4 넷째 줄)
  const young0 = new Map<string, { age: number; now: number; best: number }>();
  console.log(`\n## 시드 ${seed}`);
  console.log('| 연도 | 상위270 기여합 | 상위270 평균나이 | 25세이하 평균잠재 | 유입 수 | 유입 평균잠재 | 유입 잠재10위 | 은퇴(평균나이·기여) | 방출·미계약(평균나이·기여) | 방출 중 기여5+ | 입대 수(구단 최대) | 포수 최소 | 30세+ 비중 | 방출 중 잠재10+ (신인생성) | 상위270 중 투수 기여 비중 | 상위270 중 시작 명단 기여 비중 | 상위270 중 시작~시작+1 입단 기여 비중 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < seasons; i++) {
    const year = league.year;
    const world = worldFromLeague(structuredClone(league), store, params);
    const ctx = valueContext(world);
    const runs = (p: LeaguePlayer, y = year) => currentRuns(asSim(p, ctx.world.league, y), ctx);
    const age = (p: LeaguePlayer, y = year) => (p.birthYear ? y - p.birthYear : 28);
    const active = league.players.filter((p) => p.team >= 0 && !isServing(p));
    const top = active.map((p) => ({ p, r: runs(p) })).sort((a, b) => b.r - a.r).slice(0, 270);
    const young = active.filter((p) => age(p) <= 25 && !p.foreign);
    const catchers = league.teams.map((_, t) => active.filter((p) => p.team === t && !p.isPitcher && p.pos === 'C').length);
    if (i === 0) {
      for (const p of active) if (!p.foreign && p.real !== false && age(p) <= 30 && p.entryYear < startYear) young0.set(p.id, { age: age(p), now: runs(p), best: runs(p) });
    } else if (i < 5) {
      for (const p of active) { const y0 = young0.get(p.id); if (y0) y0.best = Math.max(y0.best, runs(p)); }
    }
    const before = new Map(league.players.filter((p) => p.team >= 0).map((p) => [p.id, { r: runs(p), a: age(p), team: p.team, pot: p.potential, gen: p.entryYear >= 2028 }]));

    const season = Season.start(world, params, i === 0 ? league.seed : `${league.seed}/${league.year}`);
    season.runToEnd();
    const off = Off.beginOffseason(league, world, season, store, -1, params);
    let guard = 0;
    while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
    const retiredIds = new Set((league.retired ?? []).filter((r) => r.year === year).map((r) => r.id));
    const enlisted = league.players.filter((p) => p.military?.state === 'serving' && p.military.enlisted === year);
    const enlistMax = Math.max(...league.teams.map((_, t) => enlisted.filter((p) => p.team === t).length));
    Off.closeOffseason(league, off);

    const now = new Set(league.players.map((p) => p.id));
    const gone = [...before.entries()].filter(([id]) => !now.has(id) || league.players.find((p) => p.id === id)!.team < 0);
    const ret = gone.filter(([id]) => retiredIds.has(id)).map(([, v]) => v);
    const rel = gone.filter(([id]) => !retiredIds.has(id)).map(([, v]) => v);
    const fresh = league.players.filter((p) => !before.has(p.id) && !p.foreign);
    const pots = fresh.map((p) => p.potential).sort((a, b) => b - a);
    const old = top.filter((x) => age(x.p) >= 30).length / top.length;
    console.log(`| ${year} | ${f1(top.reduce((s, x) => s + x.r, 0))} | ${f1(mean(top.map((x) => age(x.p))))} | ${f1(mean(young.map((p) => p.potential)))} | ${fresh.length} | ${f1(mean(pots))} | ${f1(pots[9])} | ${ret.length} (${f1(mean(ret.map((x) => x.a)))}·${f1(mean(ret.map((x) => x.r)))}) | ${rel.length} (${f1(mean(rel.map((x) => x.a)))}·${f1(mean(rel.map((x) => x.r)))}) | ${rel.filter((x) => x.r >= 5).length} | ${enlisted.length} (${enlistMax}) | ${Math.min(...catchers)} | ${(old * 100).toFixed(0)}% | ${rel.filter((x) => x.pot >= 10).length} (${rel.filter((x) => x.pot >= 10 && x.gen).length}) | ${(100 * top.filter((x) => x.p.isPitcher).reduce((t, x) => t + x.r, 0) / top.reduce((t, x) => t + x.r, 0)).toFixed(0)}% | ${(100 * top.filter((x) => startIds.has(x.p.id)).reduce((t, x) => t + x.r, 0) / top.reduce((t, x) => t + x.r, 0)).toFixed(0)}% | ${(100 * top.filter((x) => !x.p.foreign && x.p.entryYear >= startYear && x.p.entryYear <= startYear + 1).reduce((t, x) => t + x.r, 0) / top.reduce((t, x) => t + x.r, 0)).toFixed(0)}% |`);
  }
  // 시작 때 젊은 실존 선수의 5시즌 안 성장 (시작 해 포함 5시즌, 실측 표 '5시즌 안 전성기 − 지금'과 같은 칸)
  const cells: [string, (a: number) => boolean][] = [['18~20', (a) => a <= 20], ['21~22', (a) => a >= 21 && a <= 22], ['23~24', (a) => a >= 23 && a <= 24], ['25~26', (a) => a >= 25 && a <= 26], ['27', (a) => a === 27], ['28~30', (a) => a >= 28 && a <= 30]];
  const lv: [string, (r: number) => boolean][] = [['< -5', (r) => r < -5], ['-5~5', (r) => r >= -5 && r < 5], ['5~15', (r) => r >= 5 && r < 15], ['≥ 15', (r) => r >= 15]];
  console.log('\n시작 때 젊은 실존 선수 5시즌 안 최고 − 시작 (평균, 인원):');
  for (const [cn, cf] of cells) console.log(`  ${cn}: ` + lv.map(([ln, lf]) => { const xs = [...young0.values()].filter((x) => cf(x.age) && lf(x.now)); return `${ln} ${f1(mean(xs.map((x) => Math.max(0, x.best - x.now))))} (${xs.length})`; }).join(' · ') + ` · 모두 ${f1(mean([...young0.values()].filter((x) => cf(x.age)).map((x) => Math.max(0, x.best - x.now))))}`);
  // 마지막 해: 2028년 이후 입단(게임이 만든 신인) 중 26~31세의 잠재력 실현
  const y = league.year;
  const world = worldFromLeague(structuredClone(league), store, params);
  const ctx = valueContext(world);
  const gen = league.players.filter((p) => p.team >= 0 && !p.foreign && p.entryYear >= 2028 && p.birthYear && y - p.birthYear >= 26 && y - p.birthYear <= 31);
  const rr = gen.map((p) => ({ pot: p.potential, r: currentRuns(asSim(p, ctx.world.league, y), ctx), y: p.entryYear }));
  console.log(`\n${y} 개막, 2028+ 입단 26~31세 ${rr.length}명: 평균 잠재 ${f1(mean(rr.map((x) => x.pot)))}, 평균 현재 ${f1(mean(rr.map((x) => x.r)))}, 현재 10+ ${rr.filter((x) => x.r >= 10).length}명, 잠재 10+ ${rr.filter((x) => x.pot >= 10).length}명`);
  console.log('입단 연도별 생존 인원: ' + [...new Set(league.players.filter((p) => p.team >= 0 && p.entryYear >= 2028).map((p) => p.entryYear))].sort().map((e) => `${e}:${league.players.filter((p) => p.team >= 0 && p.entryYear === e).length}`).join(' '));
}
