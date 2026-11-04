// 실제 KBO 외국인 능력 분포 (게임 눈금, 런): 해마다 시작 판을 만들어 외국인의 지금 능력(currentRuns)을 잰다.
// 신규 외국인(시작 연도 전 KBO 기록 없음)은 그 해 기록으로 능력을 추정하므로(create.ts) 첫해 성적 분포가 된다.
// 다음 해 KBO 기록이 있으면 재계약(남음)으로 센다. 외국인 재계약 판단·시장 후보 분포 맞춤의 근거 (2026-11-04 외국인 재계약 카드).
//
// 사용법:  npx tsx tools/foreign_real.ts [--from 2015] [--to 2025] [--out reports/foreign-real.md]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { currentRuns } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { careerIndex } from '../src/league/growth';
import { leagueView } from '../src/league/offseason';
import { installCalCache } from './calCache';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');

export interface ForeignRealRow { year: number; id: string; name: string; pit: boolean; asia: boolean; isNew: boolean; runs: number; age: number | null; back: boolean; rank: number }

export function measureReal(from: number, to: number, seed = 'fx-real'): { rows: ForeignRealRow[]; top10: number[] } {
  const store = loadDataStore();
  const idx = careerIndex(store);
  const rows: ForeignRealRow[] = [];
  const top10: number[] = [];
  for (let y = from; y <= to; y++) {
    if (!store.season(y)) continue;
    const { league } = createLeague(store, y, seed, DEFAULT_PARAMS);
    const view = leagueView(league, store, DEFAULT_PARAMS);
    const all = league.players.filter((p) => p.team >= 0).map((p) => ({ p, runs: currentRuns(view.sim.get(p.id)!, view.ctx) }))
      .sort((a, b) => b.runs - a.runs);
    top10.push(all.slice(0, 10).filter((x) => x.p.foreign).length / 10);
    all.forEach((x, rank) => {
      const p = x.p;
      if (!p.foreign) return;
      const years = [...(idx.bat.get(p.id) ?? []), ...(idx.pit.get(p.id) ?? [])].map((r) => r.year);
      rows.push({
        year: y, id: p.id, name: p.name, pit: p.isPitcher, asia: !!p.asia, isNew: !years.some((t) => t < y), runs: x.runs,
        age: p.birthYear ? y - p.birthYear : null, back: years.includes(y + 1), rank,
      });
    });
    process.stderr.write(`${y} `);
  }
  process.stderr.write('\n');
  return { rows, top10 };
}

function dist(label: string, xs: number[]): string {
  return `| ${label} | ${xs.length} | ${f1(mean(xs))} | ${f1(q(xs, 0.1))} | ${f1(q(xs, 0.25))} | ${f1(q(xs, 0.5))} | ${f1(q(xs, 0.75))} | ${f1(q(xs, 0.9))} |`;
}

function main(): void {
  installCalCache();
  const from = Number(arg('from', '2015'));
  const to = Number(arg('to', '2025'));
  const { rows, top10 } = measureReal(from, to);
  const fresh = rows.filter((r) => r.isNew && !r.asia);
  const old = rows.filter((r) => !r.isNew && !r.asia);
  const out: string[] = [];
  out.push(`# 실제 KBO 외국인 능력 분포 (${from}~${to} 시작 판, 게임 눈금 런)\n`);
  out.push('신규 = 시작 연도 전 KBO 기록 없음 (그 해 기록으로 추정한 능력 = 첫해 성적). 재계약 = 다음 해 KBO 기록 있음. 아시아쿼터 제외.\n');
  out.push('| 묶음 | 수 | 평균 | 10% | 25% | 50% | 75% | 90% |\n|---|---|---|---|---|---|---|---|');
  out.push(dist('신규 전체', fresh.map((r) => r.runs)));
  out.push(dist('신규 투수', fresh.filter((r) => r.pit).map((r) => r.runs)));
  out.push(dist('신규 타자', fresh.filter((r) => !r.pit).map((r) => r.runs)));
  out.push(dist('2년차 이상', old.map((r) => r.runs)));
  out.push(dist('신규 중 다음 해 남음', fresh.filter((r) => r.back).map((r) => r.runs)));
  out.push(dist('신규 중 다음 해 떠남', fresh.filter((r) => !r.back && r.year < to).map((r) => r.runs)));
  out.push('');
  out.push('## 능력 구간별 다음 해 남는 비율 (신규·2년차 이상 합침, 마지막 해 제외)\n');
  out.push('| 런 구간 | 수 | 남음 |\n|---|---|---|');
  const cut = [-99, 0, 10, 20, 30, 40, 50, 999];
  for (let i = 0; i + 1 < cut.length; i++) {
    const g = rows.filter((r) => !r.asia && r.year < to && r.runs >= cut[i] && r.runs < cut[i + 1]);
    out.push(`| ${cut[i]}~${cut[i + 1]} | ${g.length} | ${g.length ? ((g.filter((r) => r.back).length / g.length) * 100).toFixed(0) : '-'}% |`);
  }
  out.push('');
  out.push(`시작 판 능력 상위 10명 중 외국인 (평균): ${(mean(top10) * 100).toFixed(1)}% (해마다 ${top10.map((x) => Math.round(x * 100)).join('·')})\n`);
  out.push(`외국인 능력 순위 중앙값: ${q(rows.filter((r) => !r.asia).map((r) => r.rank + 1), 0.5)}위\n`);
  const text = out.join('\n');
  const file = arg('out');
  if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); console.log(`${file}에 썼습니다.`); } else console.log(text);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/foreign_real.ts')) main();
