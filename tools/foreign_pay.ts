// 시작 판 외국인 연봉 점검: 구단마다 외국인(일반·아시아쿼터) 연봉과 일반 외국인 합이 구단 총액 상한 안인지 표로 (2026-10-22).
// 실제 계약(외국인_개막명단.csv의 연봉·계약금)이 있는 선수는 (실제)로 표시한다. 나머지는 생성식 (salary.ts foreignSalary).
//
// 사용법:  npx tsx tools/foreign_pay.ts [--year 2026] [--seed foreign-pay]

import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { createLeague } from '../src/league/create';
import { foreignCap, foreignContractTotal, foreignTeamCap } from '../src/league/salary';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const year = Number(arg('year') ?? 2026);
const store = loadDataStore();
const { league } = createLeague(store, year, arg('seed') ?? 'foreign-pay', DEFAULT_PARAMS);
const real = new Set<string>();
for (const list of Object.values(store.meta.foreignOpening?.[String(year)] ?? {})) for (const e of list) if (e.salary !== undefined) real.add(e.id);
const man = (usd: number) => `${Math.round(usd / 10_000)}만`;
const cap = foreignCap(league, 'foreignTotalCap', year);
console.log(`${year} 시작 판 외국인 연봉 (달러, 기본 총액 상한 ${man(cap)} + 재계약 외국인마다 같은 구단 시즌 수 × 10만). 실제 = 외국인_개막명단.csv의 연봉+계약금\n`);
console.log('| 구단 | 일반 외국인 (연봉+계약금) | 일반 합 | 구단 상한 | 상한 안 | 아시아쿼터 |\n|---|---|---|---|---|---|');
league.teams.forEach((t, i) => {
  const fs = league.players.filter((p) => p.team === i && p.foreign);
  const reg = fs.filter((p) => !p.asia);
  const asia = fs.filter((p) => p.asia);
  const txt = (ps: typeof fs) => ps.map((p) => `${p.name} ${man(foreignContractTotal(p.contract))}${real.has(p.id) ? ' (실제)' : ''}`).join(', ') || '-';
  const sum = reg.reduce((s, p) => s + foreignContractTotal(p.contract), 0);
  const teamCap = foreignTeamCap(league, i, year, reg);
  console.log(`| ${t.name} | ${txt(reg)} | ${man(sum)} | ${man(teamCap)} | ${sum <= teamCap ? '예' : '**넘음**'} | ${txt(asia)} |`);
});
