// 외국인 재계약·시장 후보 장기 점검 (2026-11-04 외국인 재계약 카드): 모든 구단 AI로 여러 시즌을 돌려
// 외국인 머무는 시즌(평가 K3), WAR 상위 10명 중 외국인(K2), 외국인 연봉 합, 한 구단 외국인 사용 수, 재정, 시장 후보·신규 계약·재계약 능력을 잰다.
// 시즌 기록(머무는 시즌·WAR 상위 10명·양수 WAR 몫·구단당 외국인 사용)은 오프시즌 고리에서 closeOffseason 전에 센다 (떠나는 선수의 마지막 시즌까지).
//
// 사용법:  npx tsx tools/foreign_renew_check.ts --start 2026 --seasons 20 --seeds a,b,c [--out reports/foreign-renew.md]
// 실제 값은 tools/foreign_real.ts (게임 눈금 첫해 능력 분포)와 reports/eval100.md K2·K3 실제 셈

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyBatLine, emptyPitLine } from '../src/engine';
import { valueContext } from '../src/ai/value';
import { runsNow } from '../src/league/careers';
import { setForeignKeepProbe, type ForeignKeepProbe } from '../src/league/offseason';
import { createLeague } from '../src/league/create';
import { foreignContractTotal } from '../src/league/salary';
import { batWarOf, pitWarOf } from '../src/league/war';
import type { LeagueState } from '../src/league/types';
import { runYear } from './longsim';
import { installCalCache } from './calCache';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const B = Object.fromEntries(Object.keys(emptyBatLine()).map((k, i) => [k, i])) as Record<string, number>;
const P = Object.fromEntries(Object.keys(emptyPitLine()).map((k, i) => [k, i])) as Record<string, number>;

interface Rec { foreign: boolean; asia: boolean; seasons: number[]; teams: Set<number>; firstGame: number }
interface SeedResult {
  seed: string; start: number; end: number;
  stay: number; stayAll: number; leftN: number; top10: number; foreignWarShare: number;
  usedPerTeam: number; payPerTeam: number; cashAvg: number; rescued: number;
  pool: number[]; signed: number[]; renewed: number[]; released: number[]; renewRate: number;
  /** 계약이 끝난 외국인의 판단 재료 (진짜 능력, 시즌 기여, 출전 몫, 남았나) */
  form: { truth: number; runs: number; share: number; bar: number; age: number; kept: boolean; same?: boolean }[];
}

function warOfLine(league: LeagueState, year: number, pos: string | null, bat?: number[], pit?: number[]): number {
  const env = league.seasonEnv?.[String(year)];
  if (!env) return 0;
  let w = 0;
  if (bat) w += batWarOf({ pa: bat[B.pa], h: bat[B.h], d: bat[B.d], t: bat[B.t], hr: bat[B.hr], bb: bat[B.bb], hbp: bat[B.hbp] }, pos, env);
  if (pit) w += pitWarOf({ g: pit[P.g], gs: pit[P.gs], outs: pit[P.outs], hr: pit[P.hr], bb: pit[P.bb], hbp: pit[P.hbp], so: pit[P.so], r: pit[P.r] }, env);
  return w;
}

function runSeed(store: ReturnType<typeof loadDataStore>, start: number, seasons: number, seed: string): SeedResult {
  const { league } = createLeague(store, start, seed, DEFAULT_PARAMS);
  const recs = new Map<string, Rec>();
  const top10: number[] = [];
  const share: number[] = [];
  const used: number[] = [];
  const pay: number[] = [];
  const cash: number[] = [];
  let rescued = 0;
  const pool: number[] = [], signed: number[] = [], renewed: number[] = [], released: number[] = [];
  let renewN = 0, expN = 0;
  const form: SeedResult['form'] = [];
  const probes = new Map<string, ForeignKeepProbe>();
  setForeignKeepProbe((r) => probes.set(`${r.id}:${r.year}`, r));
  for (let s = 0; s < seasons; s++) {
    const year = league.year;
    // 개막 때 외국인 연봉 합 (일반 + 아시아쿼터, 달러)
    const fs = league.players.filter((p) => p.team >= 0 && p.foreign);
    pay.push(fs.reduce((a, p) => a + foreignContractTotal(p.contract), 0) / league.teams.length);
    const countSeason = () => {
      const rows: { foreign: boolean; war: number }[] = [];
      const teamsUsed = new Map<number, Set<string>>();
      const teamIdx = new Map(league.teams.map((t, i) => [t.name, i]));
      for (const p of league.players) {
        const h = p.history.find((x) => x.year === year);
        if (!h || (!h.bat?.[B.pa] && !h.pit?.[P.outs])) continue;
        let r = recs.get(p.id);
        if (!r) recs.set(p.id, (r = { foreign: p.foreign, asia: !!p.asia, seasons: [], teams: new Set(), firstGame: year }));
        r.seasons.push(year);
        const w = warOfLine(league, year, p.pos ?? null, h.bat, h.pit);
        rows.push({ foreign: p.foreign, war: w });
        if (p.foreign) {
          const t = teamIdx.get(h.team) ?? -1;
          (teamsUsed.get(t) ?? teamsUsed.set(t, new Set()).get(t)!).add(p.id);
        }
      }
      rows.sort((a, b) => b.war - a.war);
      top10.push(rows.slice(0, 10).filter((x) => x.foreign).length / 10);
      const pos = rows.filter((x) => x.war > 0);
      share.push(pos.filter((x) => x.foreign).reduce((a, x) => a + x.war, 0) / Math.max(1e-9, pos.reduce((a, x) => a + x.war, 0)));
      used.push(mean([...teamsUsed.values()].map((x) => x.size)));
    };
    const { m } = runYear(league, store, DEFAULT_PARAMS, (off, world) => {
      // 이 시즌(year) 1군 기록은 closeOffseason이 소속 없는 선수(풀린 외국인·은퇴 선수)를 지우기 전에 센다 (2026-11-10 고침:
      // 전에는 runYear 뒤에 세어 떠나는 선수의 마지막 시즌이 빠졌고, 한 시즌만 뛴 외국인은 머무는 시즌에서 아예 빠졌다)
      countSeason();
      const f = off.foreign;
      if (!f) return;
      const ctx = valueContext(world);
      const inPool = new Set(f.pool);
      const part = (p: (typeof league.players)[number], kept: boolean) => { const r = probes.get(`${p.id}:${year}`); if (r) form.push({ ...r, kept, same: kept && p.history.find((h) => h.year === year)?.team === league.teams[p.team]?.name }); };
      for (const p of league.players) {
        if (!p.foreign || p.asia) continue;
        const played = p.history.some((h) => h.year === year);
        const runs = runsNow(p, ctx, year + 1);
        // 계약한 후보는 풀 목록에서 빠지므로: 이번 시즌 기록이 없고 KBO 기록이 없는 소속 외국인 = 신규 계약 (계약 때 fx 칸이 지워진다)
        if (!played && p.team >= 0 && !p.history.length && !p.tenure0 && !inPool.has(p.id)) { pool.push(runs); signed.push(runs); continue; }
        if (inPool.has(p.id)) {
          if (played) { released.push(runs); expN++; part(p, false); }
          else pool.push(runs);
        } else if (played && p.team >= 0 && p.contract.until === year + 1 && p.history.length >= 1) {
          // 계약이 이번에 끝나 다시 1년을 받은 선수 (다년 계약 없음: 외국인은 해마다 1년)
          renewed.push(runs); renewN++; expN++; part(p, true);
        }
      }
    });
    cash.push(m.econ.cashAvg);
    rescued += m.econ.rescued;
    process.stderr.write(`${seed} ${year} `);
  }
  process.stderr.write('\n');
  const end = league.year; // 다음에 열릴 시즌
  const last = end - 1;
  const foreignRecs = [...recs.values()].filter((r) => r.foreign && !r.asia);
  // 평가 K3와 같은 셈: 판 끝 5시즌 전에 떠난 외국인의 시즌 수 (시작 판 실존 외국인의 예전 시즌은 세지 않음)
  const left = foreignRecs.filter((r) => r.seasons.at(-1)! < last - 4);
  const leftNew = left.filter((r) => r.firstGame > start);
  return {
    seed, start, end: last, stay: mean(leftNew.map((r) => r.seasons.length)), stayAll: mean(left.map((r) => r.seasons.length)), leftN: leftNew.length,
    top10: mean(top10), foreignWarShare: mean(share), usedPerTeam: mean(used), payPerTeam: mean(pay), cashAvg: mean(cash), rescued,
    pool, signed, renewed, released, renewRate: expN ? renewN / expN : NaN, form,
  };
}

function main(): void {
  installCalCache();
  const store = loadDataStore();
  const start = Number(arg('start', '2026'));
  const seasons = Number(arg('seasons', '20'));
  const seeds = (arg('seeds', 'fr-a,fr-b,fr-c') ?? '').split(',');
  const res = seeds.map((s) => runSeed(store, start, seasons, s));
  const out: string[] = [];
  out.push(`# 외국인 재계약 장기 점검 (${start} 시작, ${seasons}시즌, 시드 ${seeds.join('·')}, 모든 구단 AI)\n`);
  out.push('| 시드 | 머무는 시즌 (게임 안 입단) | 머무는 시즌 (전체) | 떠난 수 | WAR 상위 10명 중 외국인 | 양수 WAR 중 외국인 몫 | 구단당 외국인 사용 | 구단당 외국인 연봉 (만 달러) | 구단 자금 평균 (억) | 긴급 지원 구단·해 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of res) {
    out.push(`| ${r.seed} | ${f2(r.stay)} | ${f2(r.stayAll)} | ${r.leftN} | ${f1(r.top10 * 100)}% | ${f1(r.foreignWarShare * 100)}% | ${f2(r.usedPerTeam)} | ${f1(r.payPerTeam / 10_000)} | ${f1(r.cashAvg / 10_000)} | ${r.rescued} |`);
  }
  out.push('');
  out.push('기준: 머무는 시즌 1.3~2.5 (실제 1.57 · 2015~ 1.49), WAR 상위 10명 중 외국인 30~60% (실제 2015~ 48.2%).\n');
  const all = (k: 'pool' | 'signed' | 'renewed' | 'released') => res.flatMap((r) => r[k]);
  out.push('## 오프시즌 외국인 능력 (일반, 다음 시즌 런, 모든 시드·해)\n');
  out.push('| 묶음 | 수 | 평균 | 10% | 25% | 50% | 75% | 90% |\n|---|---|---|---|---|---|---|---|');
  for (const [k, label] of [['pool', '시장 새 후보'], ['signed', '그 가운데 계약'], ['renewed', '재계약'], ['released', '재계약 안 함']] as const) {
    const xs = all(k);
    out.push(`| ${label} | ${xs.length} | ${f1(mean(xs))} | ${f1(q(xs, 0.1))} | ${f1(q(xs, 0.25))} | ${f1(q(xs, 0.5))} | ${f1(q(xs, 0.75))} | ${f1(q(xs, 0.9))} |`);
  }
  out.push(`\n재계약 비율 (계약이 끝난 외국인 중): ${res.map((r) => f1(r.renewRate * 100) + '%').join(' · ')}\n`);
  // 판단 재료: 시즌 기여 눈금 영점(많이 뛴 선수의 시즌 기여 ÷ 출전 몫 − 진짜 능력)과 능력 구간별 남는 비율 (실제 24·42·61%)
  const form = res.flatMap((r) => r.form);
  const full = form.filter((x) => x.share >= 0.7);
  const dev = full.map((x) => x.runs / x.share - x.truth);
  const sd = Math.sqrt(mean(dev.map((d) => (d - mean(dev)) ** 2)));
  out.push(`## 재계약 판단 재료\n\n출전 몫 0.7 이상 ${full.length}명: 시즌 기여 ÷ 출전 몫 − 진짜 능력 평균 ${f1(mean(dev))}런, 표준편차 ${f1(sd)}런. 출전 몫 평균 ${f2(mean(form.map((x) => x.share)))}, 출전 몫 0.7 이상 몫 ${f1((full.length / (form.length || 1)) * 100)}%\n`);
  out.push(`남은 선수 ${form.filter((x) => x.kept).length}명 가운데 같은 구단 ${form.filter((x) => x.same).length}명, 다른 구단으로 옮김 ${form.filter((x) => x.kept && !x.same).length}명\n`);
  out.push('| 진짜 능력 구간 | 수 | 남은 비율 | 실제 (2015~2025) |\n|---|---|---|---|');
  for (const [lo, hi, real] of [[-99, 30, '-'], [30, 40, '24%'], [40, 50, '42%'], [50, 999, '61%']] as const) {
    const g = form.filter((x) => x.truth >= lo && x.truth < hi);
    out.push(`| ${lo < -50 ? '30 미만' : hi > 500 ? '50 이상' : `${lo}~${hi}`} | ${g.length} | ${f1((g.filter((x) => x.kept).length / (g.length || 1)) * 100)}% | ${real} |`);
  }
  out.push('');
  const dump = arg('dump');
  if (dump) { mkdirSync(dirname(dump), { recursive: true }); writeFileSync(dump, JSON.stringify(form)); }
  const text = out.join('\n');
  const file = arg('out');
  if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); console.log(`${file}에 썼습니다.`); } else console.log(text);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/foreign_renew_check.ts')) main();
