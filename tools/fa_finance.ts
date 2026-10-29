// 장기 재정·FA 요구액 점검: 모든 구단 AI로 여러 시즌을 돌리며 해마다 구단 수입·연봉·운영비·투자·자금과
// FA 요구액 분포(최고·상위 5·중앙값, 연봉 상승 지수로 나눈 2026년 물가 값)를 표로 낸다.
// 요구액이 문턱(기본 연 100억)을 넘은 FA는 런·나이·기간·지수로 나눠 보인다.
//
// 이도류 FA와 --watch 이름(기본 하현승)은 따로 모아 본업·반대쪽 몫, 옛 식(꺾임·이도류 나눔 전, 런^1.31) 요구액과 나란히 보인다.
//
// 사용법:  npx tsx tools/fa_finance.ts [--start 2026] [--seasons 20] [--seeds a,b] [--over 1000000] [--watch 하현승] [--out reports/fa-finance.md]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { salaryCap, teamCapPayroll, wageIndex } from '../src/league/salary';
import { cashOf } from '../src/league/finance';
import type { FinanceKind } from '../src/league/finance';
import { faAskParts, leagueView } from '../src/league/offseason';
import { runYear } from './longsim';
import { installCalCache } from './calCache';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const INCOME: FinanceKind[] = ['gate', 'postseason', 'broadcast', 'sponsor', 'parent', 'champion'];
const eok = (man: number, d = 0) => (man / 10000).toFixed(d);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

interface Row {
  year: number; wage: number;
  income: number; payroll: number; foreign: number; ops: number; invest: number; coach: number; signing: number; net: number;
  cashAvg: number; cashMin: number; zero: number; rescued: number;
  avgPay: number; topPay: number; capUse: number; capOver: number;
  fa: { n: number; top: number; top5: number; med: number; signedTop: number };
}
interface Big { seed: string; year: number; name: string; age: number; years: number; now: number; avg: number; share: number; wage: number; ask: number; old: number; salary?: number; signed: boolean; twoWay: boolean }
/** 고치기 전 시장 연봉식 (꺾임 없음, 이도류도 합친 런 하나로) */
const oldAsk = (avg: number, wage: number, floor: number) => Math.max(floor, Math.round(1200 * wage * Math.max(0, avg) ** 1.31));

async function main(): Promise<void> {
  installCalCache();
  const start = Number(arg('start') ?? 2026);
  const n = Number(arg('seasons') ?? 20);
  const seeds = (arg('seeds') ?? 'fa-a,fa-b').split(',');
  const over = Number(arg('over') ?? 1_000_000);
  const watch = new Set((arg('watch') ?? '하현승').split(','));
  const out = arg('out');
  const params: EngineParams = DEFAULT_PARAMS;
  const store = loadDataStore();
  const parts: string[] = [`# 장기 재정·FA 요구액 (${start}년부터 ${n}시즌)\n`,
    `도구: \`npx tsx tools/fa_finance.ts\`. 모든 구단 AI. 금액은 내부 값(만 원, 2026년 뒤는 연봉 상승 지수가 곱해진 그 해 돈)을 억 원으로. "÷지수"는 2026년 물가.\n`];
  const bigs: Big[] = [];
  for (const seed of seeds) {
    const { league } = createLeague(store, start, seed, params);
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      let fa: Row['fa'] = { n: 0, top: 0, top5: 0, med: 0, signedTop: 0 };
      const { world } = runYear(league, store, params, (off, w) => {
        const wage = wageIndex(off.year + 1, league);
        const ctx = valueContext(w);
        const es = off.fa.entries.filter((e) => !e.returnee);
        const asks = es.map((e) => e.ask).sort((a, b) => b - a);
        fa = { n: es.length, top: asks[0] ?? 0, top5: asks.slice(0, 5).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(5, asks.length)), med: median(asks),
          signedTop: Math.max(0, ...es.filter((e) => e.status === 'signed').map((e) => e.salary ?? 0)) };
        const view = leagueView(league, store, params);
        for (const e of es) {
          const p = league.players.find((x) => x.id === e.id)!;
          const sp = view.sim.get(e.id);
          const twoWay = !!sp?.alt;
          if (!sp || (e.ask < over && !twoWay && !watch.has(p.name))) continue;
          const parts = faAskParts(sp, e.years, view);
          bigs.push({ seed, year: off.year, name: p.name, age: p.birthYear ? off.year + 1 - p.birthYear : -1, years: e.years, twoWay,
            now: currentRuns(sp, ctx), avg: parts.avg, share: parts.share, wage, ask: e.ask, old: oldAsk(parts.avg, wage, view.minPay), salary: e.salary, signed: e.status === 'signed' });
        }
      });
      const y = world.year;
      const teams = league.teams.map((_, t) => t).filter((t) => league.finance?.[t]?.history.some((h) => h.year === y));
      const hist = teams.map((t) => league.finance![t].history.find((h) => h.year === y)!);
      const sum = (k: FinanceKind) => -hist.reduce((a, h) => a + (h.items[k] ?? 0), 0) / hist.length;
      const pays = league.players.filter((p) => p.team >= 0 && !p.foreign).map((p) => p.contract.salary);
      const cap = salaryCap(league.year, league);
      const capPays = teams.map((t) => teamCapPayroll(league, t, league.year));
      rows.push({
        year: y, wage: wageIndex(y, league),
        income: -INCOME.reduce((a, k) => a + sum(k), 0), payroll: sum('payroll'), foreign: sum('foreign'), ops: sum('ops'),
        invest: sum('invest') + sum('scouting'), coach: sum('coach'), signing: sum('signing'),
        net: hist.reduce((a, h) => a + h.net, 0) / hist.length,
        cashAvg: hist.reduce((a, h) => a + h.cash, 0) / hist.length, cashMin: Math.min(...hist.map((h) => h.cash)),
        zero: teams.filter((t) => cashOf(league, t) <= 0).length, rescued: hist.filter((h) => h.rescue > 0).length,
        avgPay: pays.reduce((a, b) => a + b, 0) / pays.length, topPay: Math.max(...pays),
        capUse: cap ? capPays.reduce((a, b) => a + b, 0) / capPays.length / cap : 0, capOver: cap ? capPays.filter((x) => x > cap).length : 0,
        fa,
      });
      console.log(`[${seed}] ${y}: 지수 ${rows.at(-1)!.wage.toFixed(2)}, 수입 ${eok(rows.at(-1)!.income)}억, 국내 연봉 ${eok(rows.at(-1)!.payroll)}억, FA 최고 요구 ${eok(fa.top, 1)}억`);
    }
    parts.push(`## 시드 ${seed}\n`, '### 재정 (구단 평균, 억 원, 시즌 결산)\n',
      '| 해 | 지수 | 수입 | 국내 연봉 | 외국인 | 운영비 | 투자·스카우트 | 감독·코치 | FA 계약금 | 수지 | 연봉÷수입 | 자금 평균·최소 | 자금 0 | 긴급 지원 | 캡 사용률·초과 |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.year} | ${r.wage.toFixed(2)} | ${eok(r.income)} | ${eok(r.payroll)} | ${eok(r.foreign)} | ${eok(r.ops)} | ${eok(r.invest)} | ${eok(r.coach)} | ${eok(r.signing)} | ${eok(r.net)} | ${((r.payroll + r.foreign) / r.income * 100).toFixed(0)}% | ${eok(r.cashAvg)}·${eok(r.cashMin)} | ${r.zero} | ${r.rescued} | ${(r.capUse * 100).toFixed(0)}%·${r.capOver} |`),
      '', '### 연봉과 FA 요구 (억 원, 괄호는 ÷지수 = 2026년 물가)\n',
      '| 결산 | 국내 평균 연봉 | 국내 최고 연봉 | FA 신청 | 요구 최고 | 요구 상위 5 평균 | 요구 중앙값 | 계약 최고 |',
      '|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => { const w = wageIndex(r.year + 1, league); const two = (v: number) => `${eok(v, 1)} (${eok(v / w, 1)})`;
        return `| ${r.year} | ${eok(r.avgPay, 2)} | ${eok(r.topPay, 1)} | ${r.fa.n} | ${two(r.fa.top)} | ${two(r.fa.top5)} | ${two(r.fa.med)} | ${two(r.fa.signedTop)} |`; }), '');
  }
  parts.push(`## 요구액 ${eok(over)}억 이상·이도류·${[...watch].join('·')} FA (${bigs.length}명)
`,
    '옛 식 = 고치기 전 식(런^1.31 끝까지, 이도류도 합친 런 하나로)을 같은 때 같은 런에 넣은 값. 반대쪽 몫 = 이도류 기여 중 겸업 쪽.\n',
    '| 시드 | 결산 | 선수 | 이도류 | 나이 | 기간 | 지금 런 | 기간 평균 런 | 반대쪽 몫 | 지수 | 옛 식 요구 | 요구 | ÷지수 | 계약 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...bigs.map((b) => `| ${b.seed} | ${b.year} | ${b.name} | ${b.twoWay ? '○' : ''} | ${b.age} | ${b.years} | ${b.now.toFixed(1)} | ${b.avg.toFixed(1)} | ${(b.share * 100).toFixed(0)}% | ${b.wage.toFixed(2)} | ${eok(b.old, 1)} | ${eok(b.ask, 1)} | ${eok(b.ask / b.wage, 1)} | ${b.signed ? eok(b.salary ?? 0, 1) : '-'} |`), '');
  const text = parts.join('\n');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); console.log(`${out}에 썼습니다.`); } else console.log(text);
}

void main();
