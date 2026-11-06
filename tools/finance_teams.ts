// finance_longrun.ts JSON(구단별 칸이 있는 판)을 구단별로 모은다 (재정 2 F7).
// 구단마다: 평균 자금·마지막 해 자금(2026년 돈), 긴급 지원·부채 구단-시즌 비율, 수지 ÷ 수입, 평균 수지, 환원.
// 리그 전체: 긴급 지원·부채 빈도(구단-시즌, 평가 G1·G2와 같은 정의), 마지막 해 자금 지니(G4), AI 추천안 분포.
// 사용법: npx tsx tools/finance_teams.ts a.json [b.json …] [--md 파일]
import { readFileSync, writeFileSync } from 'node:fs';
import type { FinRow } from './finance_longrun';

const files = process.argv.slice(2).filter((x) => x.endsWith('.json'));
const opt = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
const rows: FinRow[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as FinRow[]);
const eok = (x: number) => (x / 10000).toFixed(1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

type Acc = { n: number; cash: number; last: number[]; rescue: number; debt: number; net: number; rev: number; div: number };
const by = new Map<string, Acc>();
const lastYear = new Map<string, number>();
for (const r of rows) lastYear.set(r.seed, Math.max(lastYear.get(r.seed) ?? 0, r.year));
let teamSeasons = 0, rescued = 0, debted = 0;
const presets: Record<string, number> = {};
const gini: number[] = [];
let surplus = 0;
const works: string[] = [];
for (const r of rows) {
  for (const w of r.works ?? []) works.push(`${r.seed} ${r.year}: ${w}`);
  for (const [k, v] of Object.entries(r.presets)) presets[k.replace('+', '')] = (presets[k.replace('+', '')] ?? 0) + v;
  for (const [k, v] of Object.entries(r.presets)) if (k.endsWith('+')) surplus += v;
  if (!r.teams) continue;
  if (r.year === lastYear.get(r.seed)) {
    const xs = r.teams.map((t) => Math.max(0, t.cash)).sort((a, b) => a - b);
    const sum = xs.reduce((a, b) => a + b, 0);
    let g = 0;
    xs.forEach((x, i) => { g += (2 * (i + 1) - xs.length - 1) * x; });
    gini.push(sum > 0 ? g / (xs.length * sum) : 0);
  }
  for (const t of r.teams) {
    const a = by.get(t.name) ?? { n: 0, cash: 0, last: [], rescue: 0, debt: 0, net: 0, rev: 0, div: 0 };
    a.n++; a.cash += t.cash; a.net += t.net; a.rev += t.rev ?? 0; a.div += t.dividend ?? 0;
    if ((t.rescue ?? 0) > 0) { a.rescue++; rescued++; }
    if ((t.debt ?? 0) > 0) { a.debt++; debted++; }
    if (r.year === lastYear.get(r.seed)) a.last.push(t.cash);
    teamSeasons++;
    by.set(t.name, a);
  }
}
const lines = [
  `시드 ${[...lastYear.keys()].join('·')}, 구단-시즌 ${teamSeasons}개.`, '',
  `- 긴급 지원 빈도 (구단-시즌): ${pct(rescued / Math.max(1, teamSeasons))}`,
  `- 부채 빈도 (결산 뒤 부채가 있는 구단-시즌): ${pct(debted / Math.max(1, teamSeasons))}`,
  `- 마지막 해 자금 지니 (시드 평균): ${(gini.reduce((a, b) => a + b, 0) / Math.max(1, gini.length)).toFixed(2)}`,
  `- 여유 자금 투자를 얹은 구단-시즌: ${pct(surplus / Math.max(1, Object.values(presets).reduce((s, x) => s + x, 0)))}`,
  `- AI 구장 공사 (재정 2 F8, 시드 합): 신구장 ${works.filter((w) => w.includes('신구장')).length}번 · 리모델링 ${works.filter((w) => w.includes('리모델링')).length}번${works.length ? ` (${works.join(' / ')})` : ''}`,
  `- AI 추천안 (구단-시즌, 여유 자금 투자는 원래 추천안으로): ${Object.entries(presets).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / Math.max(1, Object.values(presets).reduce((s, x) => s + x, 0)))}`).join(' · ')}`, '',
  '| 구단 | 평균 자금 | 마지막 해 자금 (시드별) | 긴급 지원 | 부채 | 수지 ÷ 수입 | 평균 수지 | 평균 환원 |',
  '|---|---|---|---|---|---|---|---|',
  ...[...by.entries()].sort((a, b) => b[1].cash / b[1].n - a[1].cash / a[1].n).map(([name, a]) =>
    `| ${name} | ${eok(a.cash / a.n)} | ${a.last.map(eok).join('·')} | ${pct(a.rescue / a.n)} | ${pct(a.debt / a.n)} | ${pct(a.net / Math.max(1, a.rev))} | ${eok(a.net / a.n)} | ${eok(a.div / a.n)} |`),
  '', '(억 원, 2026년 돈)',
];
const text = lines.join('\n');
const md = opt('md');
if (md) writeFileSync(md, text);
console.log(text);
