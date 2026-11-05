// 장기 진행 리그 환경 흐름 (2026-11-04 리그 타율 카드): 해마다 리그 타율·BABIP·삼진·볼넷·홈런과
// 그 해 엔진 환경 목표(world.league), 환경 맞춤 계수(선수층 압력 = 1 ÷ 계수), 미래 규칙 값(반발계수 홈런 배율·존)을 나란히 남긴다.
// 모든 구단 AI, 가을야구 없음 (title_dist.ts gameYear와 같은 진행).
//
// 사용법: npx tsx tools/league_env_trend.ts --seasons 50 --seeds long-a,long-b [--start 2026] [--shape0] [--set 키=값,…] --out reports/tmp/env.json
//   --shape0: 가상 선수 특기 모양 끄기 (params.shape bat·pit 0, 특기 모양 전과 견주기)
//   --center JSON·--center0: 특기 모양 가운데 맞춤 덮어쓰기·끄기
//   --set:    params 덮어쓰기 (점 경로, 예: shape.bat=0.5)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, type EngineParams } from '../src/engine';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import { worldFromLeague } from '../src/league/world';
import { ballHrMul, futureValue } from '../src/league/futureRules';
import { installCalCache } from './calCache';
import { currentRuns, valueContext } from '../src/ai/value';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const start = Number(arg('start') ?? 2026);
const n = Number(arg('seasons') ?? 20);
const seeds = (arg('seeds') ?? 'long-a').split(',');
const out = arg('out') ?? 'reports/tmp/env.json';
const params: EngineParams = structuredClone(DEFAULT_PARAMS);
if (process.argv.includes('--shape0')) params.shape = { ...params.shape, bat: 0, pit: 0 };
// --center '{"bat":[…6],"pit":[…4]}': 특기 모양 가운데 맞춤 덮어쓰기, --center0: 가운데 맞춤 끄기
if (arg('center')) params.shape = { ...params.shape, center: JSON.parse(arg('center')!) };
if (process.argv.includes('--center0')) params.shape = { ...params.shape, center: undefined };
for (const kv of (arg('set') ?? '').split(',').filter(Boolean)) {
  const [path, val] = kv.split('=');
  const keys = path.split('.');
  let o = params as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys.at(-1)!] = Number(val);
}

installCalCache();
const store = loadDataStore();
const rows: unknown[] = [];
for (const seed of seeds) {
  const t0 = Date.now();
  const { league } = createLeague(store, start, seed, params);
  for (let i = 0; i < n; i++) {
    const world = worldFromLeague(structuredClone(league), store, params);
    const sseed = league.year === league.startYear ? league.seed : `${league.seed}/${league.year}`;
    const season = Season.start(world, params, sseed);
    season.runToEnd();
    const t = season.totals;
    // 규정 타석 3할 (경기 수 × 3.1)
    const games = Math.max(...season.teams.map((x) => x.g));
    let q = 0, q300 = 0, qAvg = 0, q390 = 0, q400 = 0, hrTop = 0;
    // 규정 타자의 천장(잠재력)과 지금 기여(런): 가상·실존 따로 (특기 모양 기울기가 천장으로 쓰이는지 점검)
    const ctx = valueContext(world);
    const potOf = new Map(league.players.map((lp) => [lp.id, lp.potential ?? NaN]));
    const pr = { v: [0, 0, 0], r: [0, 0, 0] };
    for (const sp of world.players) {
      if (sp.isPitcher) continue;
      const b = season.bat[sp.idx];
      hrTop = Math.max(hrTop, b.hr);
      if (b.pa < Math.ceil(3.1 * games)) continue;
      q++; const a = b.ab ? b.h / b.ab : 0; qAvg += a; if (a >= 0.3) q300++; if (a >= 0.39) q390++; if (a >= 0.4) q400++;
      const pot = potOf.get(sp.id) ?? NaN;
      if (Number.isFinite(pot)) { const o = sp.real === false ? pr.v : pr.r; o[0]++; o[1] += pot; o[2] += currentRuns(sp, ctx); }
    }
    // 가상 선수 출전 가중 천장 (타자 타석·투수 상대 타자 가중)
    const wp = { b: [0, 0], p: [0, 0] };
    for (const sp of world.players) {
      if (sp.real !== false) continue;
      const pot = potOf.get(sp.id) ?? NaN;
      if (!Number.isFinite(pot)) continue;
      if (sp.isPitcher) { const w = season.pit[sp.idx].bf; wp.p[0] += w; wp.p[1] += w * pot; }
      else { const w = season.bat[sp.idx].pa; wp.b[0] += w; wp.b[1] += w * pot; }
    }
    // 가상 선수 출전 가중 log 능력 비율 (리그 상태의 비율, 특기 모양 가운데 맞춤 params.shape.center 재기)
    const lpOf = new Map(league.players.map((lp) => [lp.id, lp]));
    const BK = ['so', 'bb', 's1', 'd2', 't3', 'hr'] as const, PK = ['so', 'bb', 'hr', 'hit'] as const;
    const lb = { w: 0, v: BK.map(() => 0), a: BK.map(() => 0) }, lq = { w: 0, v: PK.map(() => 0), a: PK.map(() => 0) };
    for (const sp of world.players) {
      if (sp.real !== false) continue;
      const lp = lpOf.get(sp.id);
      if (!lp) continue;
      if (sp.isPitcher && lp.pit) { const w = season.pit[sp.idx].bf; lq.w += w; PK.forEach((k, i) => { lq.v[i] += w * Math.log(lp.pit![k]); lq.a[i] += w * lp.pit![k]; }); }
      if (!sp.isPitcher && lp.bat) { const w = season.bat[sp.idx].pa; lb.w += w; BK.forEach((k, i) => { lb.v[i] += w * Math.log(lp.bat![k]); lb.a[i] += w * lp.bat![k]; }); }
    }
    const virt = world.players.filter((p) => !p.isPitcher && p.real === false).length / Math.max(1, world.players.filter((p) => !p.isPitcher).length);
    rows.push({
      seed, year: world.year,
      tot: { pa: t.pa, ab: t.ab, h: t.h, d: t.d, t: t.t, hr: t.hr, bb: t.bb, hbp: t.hbp, so: t.so, sf: (t as unknown as Record<string, number>).sf ?? 0 },
      target: { ...world.league }, cal: { ...season.cal },
      hrMul: ballHrMul(league, world.year), ball: futureValue(league, 'ball', world.year), zone: futureValue(league, 'zone', world.year),
      q, q300, q390, q400, hrTop, qAvg: q ? qAvg / q : 0, virt,
      logBat: lb.v.map((x) => x / (lb.w || 1)), logPit: lq.v.map((x) => x / (lq.w || 1)),
      // 출전 가중 산술 평균 비율의 log (리그 합계·선수층 압력에 닿는 것은 이쪽)
      amBat: lb.a.map((x) => Math.log(x / (lb.w || 1))), amPit: lq.a.map((x) => Math.log(x / (lq.w || 1))),
      wPot: { bat: wp.b[1] / (wp.b[0] || 1), pit: wp.p[1] / (wp.p[0] || 1) },
      pot: { vN: pr.v[0], vPot: pr.v[1] / (pr.v[0] || 1), vCur: pr.v[2] / (pr.v[0] || 1), rN: pr.r[0], rPot: pr.r[1] / (pr.r[0] || 1), rCur: pr.r[2] / (pr.r[0] || 1) },
    });
    // 결산과 오프시즌 끝까지 (title_dist와 같음)
    const off = Off.beginOffseason(league, world, season, store, -1, params);
    let guard = 0;
    while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
    Off.closeOffseason(league, off);
    console.log(`[${seed}] ${world.year} 끝 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ start, seeds, params: { shape: params.shape }, rows }));
console.log(`${out}에 썼습니다.`);
