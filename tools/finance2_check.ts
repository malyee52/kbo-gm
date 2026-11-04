// 재정 2 F1 점검 (docs/재정2_기획안.md 7장): 첫 시즌을 하루씩 돌려 구단별 "개막 직전·개막일·시즌 중 최저·결산" 자금과
// 결산 수지·긴급 지원, 장부 지문을 낸다. 고치기 전과 뒤의 JSON을 견주어 돈 흐름이 바뀌었는지 본다.
//
// 실행: npx tsx tools/finance2_check.ts [--seeds f2-0,...] [--n 10] [--year 2026] [--out reports/tmp/finance2-before.json]
//       npx tsx tools/finance2_check.ts --compare a.json b.json [--md reports/finance2-f1.md]

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { cashOf } from '../src/league/finance';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

interface TeamRow { team: string; pre: number; day0: number; min: number; minDay: number; end: number; net: number; rescue: number; debt?: number; items: Record<string, number> }
interface SeedRow { seed: string; ledger: string; teams: TeamRow[] }

function run(seed: string, year: number): SeedRow {
  const store = loadDataStore();
  const lg = store.season(year)!.teams.findIndex((t) => t.name === 'LG');
  const g = GameSession.create(store, { year, teamIdx: Math.max(0, lg), seed }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  const L = g.league;
  const n = L.teams.length;
  const pre = L.teams.map((_, t) => cashOf(L, t));
  const day0 = L.teams.map((_, t) => g.cashNow(t));
  const min = [...day0];
  const minDay = new Array(n).fill(0);
  while (g.phase === 'season' && !g.season.done) {
    g.advance(1);
    for (let t = 0; t < n; t++) {
      const c = g.cashNow(t);
      if (c < min[t]) { min[t] = c; minDay[t] = g.currentDay; }
    }
  }
  g.advancePostseason(10_000);
  g.beginOffseason();
  const teams = L.teams.map((tm, t) => {
    const h = g.league.finance![t].history.at(-1)!;
    return { team: tm.franchise, pre: pre[t], day0: day0[t], min: min[t], minDay: minDay[t], end: h.cash, net: h.net, rescue: h.rescue, debt: h.debt ?? 0, items: h.items as Record<string, number> };
  });
  return { seed, ledger: hash(g.league.ledger.filter((e) => e.year <= year).map((e) => [e.from, e.to, e.amount, e.kind ?? ''])), teams };
}

const eok = (man: number) => (man / 10000).toFixed(1);

function compare(a: SeedRow[], b: SeedRow[]): string {
  const lines: string[] = ['| 시드 | 장부 같음 | 개막 직전 평균 | 개막일 평균 | 시즌 중 최저 평균 | 최저 < 0 구단 | 결산 자금 평균 | 긴급 지원 합 | 부채 합 | 대여 이자 합 | 계약금 합 |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  const avg = (r: SeedRow, k: keyof TeamRow) => r.teams.reduce((s, x) => s + (x[k] as number), 0) / r.teams.length;
  const neg = (r: SeedRow) => r.teams.filter((x) => x.min < 0).length;
  const sum = (r: SeedRow, k: keyof TeamRow) => r.teams.reduce((s, x) => s + ((x[k] as number | undefined) ?? 0), 0);
  const item = (r: SeedRow, k: string) => -r.teams.reduce((s, x) => s + (x.items[k] ?? 0), 0);
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    const pair = (k: keyof TeamRow) => `${eok(avg(x, k))} → ${eok(avg(y, k))}`;
    lines.push(`| ${x.seed} | ${x.ledger === y.ledger ? '같음' : '다름'} | ${pair('pre')} | ${pair('day0')} | ${pair('min')} | ${neg(x)} → ${neg(y)} | ${pair('end')} | ${eok(sum(x, 'rescue'))} → ${eok(sum(y, 'rescue'))} | ${eok(sum(x, 'debt'))} → ${eok(sum(y, 'debt'))} | ${eok(item(x, 'interest'))} → ${eok(item(y, 'interest'))} | ${eok(item(x, 'signing'))} → ${eok(item(y, 'signing'))} |`);
  }
  const all = (rs: SeedRow[], k: keyof TeamRow) => rs.reduce((s, r) => s + avg(r, k), 0) / rs.length;
  lines.push(`| 평균 | | ${eok(all(a, 'pre'))} → ${eok(all(b, 'pre'))} | ${eok(all(a, 'day0'))} → ${eok(all(b, 'day0'))} | ${eok(all(a, 'min'))} → ${eok(all(b, 'min'))} | ${a.reduce((s, r) => s + neg(r), 0)} → ${b.reduce((s, r) => s + neg(r), 0)} | ${eok(all(a, 'end'))} → ${eok(all(b, 'end'))} | | | | |`);
  lines.push('', '금액은 억 원 (2026년 돈), 구단 평균. 최저 < 0 구단 = 시즌 중 자금이 한 번이라도 0 아래로 내려간 구단 수 (시드마다 합).');
  return lines.join('\n');
}

if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare');
  const a = JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) as SeedRow[];
  const b = JSON.parse(readFileSync(process.argv[i + 2], 'utf8')) as SeedRow[];
  const md = compare(a, b);
  console.log(md);
  const out = arg('md');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, md + '\n'); }
} else {
  const year = Number(arg('year', '2026'));
  const nSeeds = Number(arg('n', '10'));
  const seeds = arg('seeds')?.split(',') ?? Array.from({ length: nSeeds }, (_, i) => `f2-${i}`);
  const out = arg('out', 'reports/tmp/finance2.json')!;
  const rows: SeedRow[] = [];
  for (const s of seeds) {
    const t0 = performance.now();
    rows.push(run(s, year));
    console.log(`${s} ${rows.at(-1)!.ledger} (${((performance.now() - t0) / 1000).toFixed(0)}초)`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rows, null, 1));
}
