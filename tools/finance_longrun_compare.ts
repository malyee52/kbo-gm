// finance_longrun.ts JSON 둘(전·후)을 견준다: 시드·연도 평균의 장부 항목(2026년 돈)과 자금·긴급 지원·부채 전 → 후.
// 사용법: npx tsx tools/finance_longrun_compare.ts 전.json 후.json [--label 전,후] [--years 10] [--md 파일]
import { readFileSync, writeFileSync } from 'node:fs';
import type { FinRow } from './finance_longrun';

const [a, b] = process.argv.slice(2).filter((x) => x.endsWith('.json'));
const opt = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
const [la, lb] = (opt('label') ?? '전,후').split(',');
const spans = (opt('years') ?? '10,20').split(',').map(Number);
const A: FinRow[] = JSON.parse(readFileSync(a, 'utf8'));
const B: FinRow[] = JSON.parse(readFileSync(b, 'utf8'));
const eok = (x: number) => (x / 10000).toFixed(1);
const lines: string[] = [];
for (const span of spans) {
  const pick = (rs: FinRow[]) => { const y0 = Math.min(...rs.map((r) => r.year)); return rs.filter((r) => r.year < y0 + span); };
  const ra = pick(A); const rb = pick(B);
  const mean = (rs: FinRow[], f: (r: FinRow) => number) => rs.reduce((s, r) => s + f(r), 0) / (rs.length || 1);
  const kinds = [...new Set([...ra, ...rb].flatMap((r) => Object.keys(r.items)))];
  lines.push(`### 처음 ${span}시즌 (시드·연도 평균)`, '', `| 값 | ${la} | ${lb} | 차이 |`, '|---|---|---|---|');
  const row = (name: string, f: (r: FinRow) => number, fmt = eok) => { const x = mean(ra, f); const y = mean(rb, f); lines.push(`| ${name} | ${fmt(x)} | ${fmt(y)} | ${fmt(y - x)} |`); };
  row('자금 평균 (그 해 돈)', (r) => r.cashAvg);
  row('자금 평균 (2026년 돈)', (r) => r.cashReal);
  row('자금 최대 ÷ 평균', (r) => r.cashMax / Math.max(1, r.cashAvg), (x) => x.toFixed(2));
  row('0 이하 구단 (해마다)', (r) => r.zero, (x) => x.toFixed(2));
  row('긴급 지원 구단 (해마다)', (r) => r.rescued, (x) => x.toFixed(2));
  row('긴급 지원 합 (그 해 돈)', (r) => r.rescueSum);
  row('부채 구단 (해마다)', (r) => r.debtTeams, (x) => x.toFixed(2));
  row('환원 합 (그 해 돈)', (r) => r.dividendSum);
  row('연봉÷수입 %', (r) => r.payRatio * 100, (x) => x.toFixed(1));
  row('수지 (2026년 돈)', (r) => r.net);
  for (const k of kinds) row(k, (r) => r.items[k] ?? 0);
  row('그 밖', (r) => r.other);
  lines.push('');
}
const text = lines.join('\n');
const md = opt('md');
if (md) writeFileSync(md, text);
console.log(text);
