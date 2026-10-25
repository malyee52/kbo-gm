// FA 계약 기간·금액 분포와 구단별 샐러리캡 사용률 점검 (모든 구단 AI).
//
// 사용법:  npx tsx tools/fa_contract_check.ts [--start 2026] [--seasons 3] [--seeds a,b] [--team SSG] [--out reports/fa-contracts.md]
//
// FA 계약: 기간(1~6년) 분포를 나이·라운드·잔류/이적별로, 기간별 연평균·총액 중앙값과 요구액 대비 연봉.
// 실제 비교값은 자료집 FA계약 시트(public/data/contracts.json, 2015년 뒤 FA, 금액 미검증)와 생년(players.json).
// 샐러리캡: 해마다 개막 기준(오프시즌 뒤) 구단별 캡 대상 합계 ÷ 캡, 초과 구단. --team이면 그 구단 상위 연봉 12명.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, type EngineParams } from '../src/engine';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import type { LeagueState } from '../src/league/types';
import { worldFromLeague } from '../src/league/world';
import { salaryCap, teamCapPayroll } from '../src/league/salary';
import { installCalCache } from './calCache';
import { currentRuns, valueContext } from '../src/ai/value';
import { asSim } from '../src/league/growth';

const unsigned = { n: 0 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Signing { seed: string; year: number; age: number | null; years: number; round: number; home: boolean; salary: number; ask: number; grade: string; runs: number }
interface CapRow { seed: string; year: number; team: string; pay: number; cap: number; top: string[] }

const ageBands: [string, number, number][] = [['~29', 0, 29], ['30~31', 30, 31], ['32~33', 32, 33], ['34~35', 34, 35], ['36~', 36, 99]];

function distLine(label: string, ys: number[]): string {
  const n = ys.length;
  const c = [1, 2, 3, 4, 5, 6].map((y) => ys.filter((v) => Math.min(6, v) === y).length);
  return `| ${label} | ${n} | ${c.map((x) => (n ? `${x} (${Math.round((x / n) * 100)}%)` : '-')).join(' | ')} |`;
}
const HEAD = '| 구분 | 건수 | 1년 | 2년 | 3년 | 4년 | 5년 | 6년+ |\n|---|---|---|---|---|---|---|---|';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const eok = (man: number) => (man / 10000).toFixed(1);

function runYear(league: LeagueState, store: ReturnType<typeof loadDataStore>, params: EngineParams, seedName: string, team: string | undefined, sign: Signing[], caps: CapRow[]): void {
  const world = worldFromLeague(structuredClone(league), store, params);
  const seed = league.year === league.startYear ? league.seed : `${league.seed}/${league.year}`;
  const season = Season.start(world, params, seed);
  season.runToEnd();
  const off = Off.beginOffseason(league, world, season, store, -1, params);
  let guard = 0;
  while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
  const ctx = valueContext(world);
  for (const e of off.fa.entries) {
    if (e.returnee) continue;
    const p = league.players.find((x) => x.id === e.id)!;
    if (e.status !== 'signed') { if (!p.abroad) unsigned.n++; continue; }
    sign.push({ seed: seedName, year: off.year, age: p.birthYear ? off.year + 1 - p.birthYear : null, years: e.signedYears!, round: e.round!, home: e.team === e.from, salary: e.salary!, ask: e.ask, grade: e.grade,
      runs: currentRuns(asSim(p, world.league, world.year + 1), ctx) });
  }
  Off.closeOffseason(league, off);
  const cap = salaryCap(league.year, league);
  if (cap === null) return;
  league.teams.forEach((tm, t) => {
    const pay = teamCapPayroll(league, t, league.year);
    const top = team && tm.name.includes(team)
      ? league.players.filter((p) => p.team === t && !p.foreign && p.contract.kind !== 'rookie' && p.military?.state !== 'serving')
        .sort((a, b) => b.contract.salary - a.contract.salary).slice(0, 12)
        .map((p) => `${p.name} ${eok(p.contract.salary)}억(${p.contract.kind}, ~${p.contract.until})`)
      : [];
    caps.push({ seed: seedName, year: league.year, team: tm.name, pay, cap, top });
  });
}

/** 자료집 FA계약 시트의 실제 FA (계약 첫 시즌 2015년 뒤) */
function realSignings(store: ReturnType<typeof loadDataStore>): { years: number; age: number | null; total: number }[] {
  const birth = new Map<string, number>();
  for (const m of store.players.values()) if (m.birthYear) birth.set(m.id, m.birthYear);
  return (store.contracts ?? []).filter((c) => c.kind === 'FA' && c.first >= 2015)
    .map((c) => ({ years: c.years, age: birth.has(c.id) ? c.first - birth.get(c.id)! : null, total: c.guaranteed * 10000 }));
}

async function main(): Promise<void> {
  installCalCache();
  const start = Number(arg('start') ?? 2026);
  const n = Number(arg('seasons') ?? 3);
  const seeds = (arg('seeds') ?? 'fa-a,fa-b').split(',');
  const team = arg('team');
  const out = arg('out');
  const params: EngineParams = DEFAULT_PARAMS;
  const store = loadDataStore();
  const sign: Signing[] = [];
  const caps: CapRow[] = [];
  for (const seed of seeds) {
    const t0 = Date.now();
    const { league } = createLeague(store, start, seed, params);
    for (let i = 0; i < n; i++) {
      runYear(league, store, params, seed, team, sign, caps);
      console.log(`[${seed}] ${league.year - 1} 오프시즌 끝 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    }
  }
  const lines: string[] = [`# FA 계약·샐러리캡 점검 (${start}년부터 ${n}시즌, 시드 ${seeds.join(', ')})\n`, `도구: \`npx tsx tools/fa_contract_check.ts\`. 모든 구단 AI.\n`];
  lines.push('## FA 계약 기간 분포\n', HEAD);
  const real = realSignings(store);
  lines.push(distLine('실제 2015~ (자료집)', real.map((r) => r.years)));
  lines.push(distLine('게임 전체', sign.map((s) => s.years)));
  for (const [label, lo, hi] of ageBands) {
    lines.push(distLine(`실제 ${label}세`, real.filter((r) => r.age !== null && r.age >= lo && r.age <= hi).map((r) => r.years)));
    lines.push(distLine(`게임 ${label}세`, sign.filter((s) => s.age !== null && s.age >= lo && s.age <= hi).map((s) => s.years)));
  }
  for (const r of [1, 2, 3, 4]) lines.push(distLine(r <= 3 ? `게임 ${r}라운드` : '게임 마지막 (라운드 뒤)', sign.filter((s) => s.round === r).map((s) => s.years)));
  lines.push(distLine('게임 잔류', sign.filter((s) => s.home).map((s) => s.years)), distLine('게임 이적', sign.filter((s) => !s.home).map((s) => s.years)));
  lines.push('', `계약하지 못한 FA (무적 선수): ${unsigned.n}명`, '', '## 기간별 런 (현재 기여, 중앙값)\n','| 기간 | 런 |', '|---|---|');
  for (const y of [1, 2, 3, 4, 5, 6]) { const g = sign.filter((s) => Math.min(6, s.years) === y); lines.push(`| ${y}년 | ${g.length ? median(g.map((s) => s.runs)).toFixed(1) : '-'} |`); }
  lines.push('', '| 나이 | 런 25% | 중앙 | 75% |', '|---|---|---|---|');
  for (const [label, lo, hi] of ageBands) { const xs = sign.filter((s) => s.age !== null && s.age >= lo && s.age <= hi).map((s) => s.runs).sort((a, b) => a - b); if (xs.length) lines.push(`| ${label} | ${xs[Math.floor(xs.length / 4)].toFixed(1)} | ${median(xs).toFixed(1)} | ${xs[Math.floor((xs.length * 3) / 4)].toFixed(1)} |`); }
  lines.push('', '## 기간별 금액 (중앙값, 억 원, 2026년 물가)\n', '| 기간 | 게임 건수 | 게임 연평균 | 게임 총액 | 게임 연봉 ÷ 요구 | 실제 건수 | 실제 총액 |', '|---|---|---|---|---|---|---|');
  for (const y of [1, 2, 3, 4, 5, 6]) {
    const g = sign.filter((s) => Math.min(6, s.years) === y);
    const r = real.filter((x) => Math.min(6, x.years) === y);
    lines.push(`| ${y}${y === 6 ? '+' : ''}년 | ${g.length} | ${g.length ? eok(median(g.map((s) => s.salary))) : '-'} | ${g.length ? eok(median(g.map((s) => s.salary * s.years))) : '-'} | ${g.length ? median(g.map((s) => s.salary / s.ask)).toFixed(2) : '-'} | ${r.length} | ${r.length ? eok(median(r.map((x) => x.total))) : '-'} |`);
  }
  if (caps.length) {
    lines.push('', '## 개막 샐러리캡 사용률 (캡 대상 합계 ÷ 캡)\n');
    const years = [...new Set(caps.map((c) => c.year))].sort();
    const teams = [...new Set(caps.map((c) => c.team))];
    lines.push(`| 구단 | ${years.map((y) => `${y} 평균 (최대)`).join(' | ')} | 초과 횟수 |`, `|---|${years.map(() => '---').join('|')}|---|`);
    for (const t of teams) {
      const cells = years.map((y) => { const xs = caps.filter((c) => c.team === t && c.year === y).map((c) => c.pay / c.cap); return xs.length ? `${xs.reduce((a, b) => a + b, 0) / xs.length >= 0 ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : ''} (${Math.max(...xs).toFixed(3)})` : '-'; });
      lines.push(`| ${t} | ${cells.join(' | ')} | ${caps.filter((c) => c.team === t && c.pay > c.cap).length} / ${caps.filter((c) => c.team === t).length} |`);
    }
    for (const c of caps.filter((x) => x.top.length)) lines.push('', `### ${c.seed} ${c.year} ${c.team}: ${eok(c.pay)}억 / 캡 ${eok(c.cap)}억`, '', c.top.map((x) => `- ${x}`).join('\n'));
  }
  const text = lines.join('\n') + '\n';
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); }
  console.log(text);
}

main();
