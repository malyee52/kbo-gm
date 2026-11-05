// 재정 장기 균형 점검 (재정 2 F6, docs/재정2_기획안.md 7장 F6): 모든 구단 AI로 여러 시즌을 돌리고
// 해마다 장부 항목별 구단 평균(2026년 돈 = 그 해 돈 ÷ 연봉 지수), 자금 분포, 긴급 지원·부채·환원, 연봉÷수입,
// AI 추천안·입장권 가격·스폰서 성향 분포를 낸다.
//
// 사용법: npx tsx tools/finance_longrun.ts --seasons 20 --seeds f6a,f6b,f6c [--out reports/finance-longrun.md] [--json reports/tmp/x.json] [--no-gm]
// AI 단장 성향(league/gm.ts ensureGm)은 게임처럼 정한다 (--no-gm이면 longsim.ts처럼 모두 균형형).
// longsim.ts의 runYear를 그대로 쓴다 (같은 시드 = 같은 결과).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { createLeague } from '../src/league/create';
import { ensureGm } from '../src/league/gm';
import { wageIndex } from '../src/league/salary';
import * as Fin from '../src/league/finance';
import type { LeagueState } from '../src/league/types';
import { runYear } from './longsim';
import { installCalCache } from './calCache';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 표에 따로 보이는 장부 항목 (나머지는 '그 밖') */
const KINDS = ['gate', 'postseason', 'broadcast', 'sponsor', 'merch', 'parent', 'parentExtra', 'faSupport', 'champion',
  'payroll', 'foreign', 'coach', 'opsFront', 'opsGame', 'opsPark', 'opsFutures', 'ops', 'invest', 'scouting', 'signing', 'interest', 'debt'] as const;
/** 수입으로 보지 않는 항목 (연봉÷수입 셈) */
const NOT_REVENUE = new Set(['start', 'rescue', 'editor']);

export interface FinRow {
  seed: string;
  year: number;
  wage: number;
  /** 구단 평균 (2026년 돈, 만 원) */
  items: Record<string, number>;
  other: number;
  net: number;
  cashAvg: number;
  cashMin: number;
  cashMax: number;
  /** 2026년 돈 자금 평균 */
  cashReal: number;
  /** 결산 뒤 자금 0 이하 구단 */
  zero: number;
  rescued: number;
  rescueSum: number;
  /** 긴급 지원을 받은 구단 이름 */
  rescueNames: string[];
  debtTeams: number;
  debtSum: number;
  dividendSum: number;
  /** 연봉(국내 + 외국인) ÷ 수입 (리그 합) */
  payRatio: number;
  /** 그 시즌 AI 추천안 (개막 때 확정한 budget: 결산 뒤에도 다음 개막 전까지 그대로) */
  presets: Record<string, number>;
  /** 그 시즌 확정 가격 평균 (일반·지정·프리미엄) */
  prices: [number, number, number];
  /** 그 시즌 걸린 스폰서 성향 수 */
  styles: Record<string, number>;
  /** 구단별 (이름, 수지·자금 2026년 돈, 추천안, 관중 수입·스폰서+상품·모기업·연봉+외국인) */
  /** 그 해 결산 뒤 AI가 잡은 구장 공사 (stadiumYearEnd 소식 중 착공·리모델링, 재정 2 F8) */
  works?: string[];
  teams?: { name: string; net: number; cash: number; preset: string; want?: string; style?: string; gate: number; spon: number; parent: number; pay: number; rev?: number; rescue?: number; debt?: number; dividend?: number }[];
}

function presetOf(b: Partial<Record<string, number>> | undefined): string {
  const P = (Fin as unknown as { PRESET_BUDGET?: Record<string, Record<string, number>> }).PRESET_BUDGET;
  if (!b || !P) return '기타';
  for (const [k, v] of Object.entries(P)) if (Object.entries(v).every(([kk, vv]) => b[kk] === vv)) return k;
  // AI 여유 자금 투자(재정 2 F7)를 얹은 예산: 마케팅이 같고 모든 줄이 추천안 이상인 것 가운데 가장 가까운 추천안 + '+'
  let best = '기타';
  let gap = Infinity;
  for (const [k, v] of Object.entries(P)) {
    if (b.marketing !== v.marketing || !Object.entries(v).every(([kk, vv]) => (b[kk] ?? 0) >= vv)) continue;
    const d = Object.entries(v).reduce((s, [kk, vv]) => s + (b[kk] ?? 0) - vv, 0);
    if (d < gap) { gap = d; best = `${k}+`; }
  }
  return best;
}

export function finRow(league: LeagueState, seed: string, year: number): FinRow {
  const wage = wageIndex(year, league);
  const fins = (league.finance ?? []).map((f, i) => ({ f, i, h: f.history.find((h) => h.year === year) })).filter((x) => !!x.h);
  const n = fins.length || 1;
  const items: Record<string, number> = {};
  let other = 0;
  let rev = 0;
  let pay = 0;
  for (const { h } of fins) {
    for (const [k, v] of Object.entries(h!.items)) {
      const x = (v ?? 0) / wage / n;
      if ((KINDS as readonly string[]).includes(k)) items[k] = (items[k] ?? 0) + x;
      else if (k !== 'start') other += x;
      if (!NOT_REVENUE.has(k) && (v ?? 0) > 0) rev += v ?? 0;
      if (k === 'payroll' || k === 'foreign') pay -= v ?? 0;
    }
  }
  const cash = fins.map((x) => x.h!.cash);
  const presets: Record<string, number> = {};
  const styles: Record<string, number> = {};
  const pr: [number, number, number] = [0, 0, 0];
  for (const { f } of fins) {
    const p = presetOf(f.activeBudget ?? f.budget);
    presets[p] = (presets[p] ?? 0) + 1;
    const ap = (f as { activePrices?: Record<string, number> }).activePrices ?? {};
    pr[0] += (ap.normal ?? ap.general ?? 1) / n;
    pr[1] += (ap.reserved ?? ap.designated ?? 1) / n;
    pr[2] += (ap.premium ?? 1) / n;
    for (const d of (f as { sponsors?: { style: string; from: number; to: number }[] }).sponsors ?? [])
      if (d.from <= year && year <= d.to) styles[d.style] = (styles[d.style] ?? 0) + 1;
  }
  return {
    seed, year, wage, items, other,
    net: fins.reduce((s, x) => s + x.h!.net, 0) / wage / n,
    cashAvg: cash.reduce((a, b) => a + b, 0) / n, cashMin: Math.min(...cash), cashMax: Math.max(...cash),
    cashReal: cash.reduce((a, b) => a + b, 0) / n / wage,
    zero: cash.filter((c) => c <= 0).length,
    rescued: fins.filter((x) => x.h!.rescue > 0).length,
    rescueSum: fins.reduce((s, x) => s + x.h!.rescue, 0),
    rescueNames: fins.filter((x) => x.h!.rescue > 0).map((x) => league.teams[x.i].name),
    debtTeams: fins.filter((x) => (x.h!.debt ?? 0) > 0).length,
    debtSum: fins.reduce((s, x) => s + (x.h!.debt ?? 0), 0),
    dividendSum: fins.reduce((s, x) => s + (x.h!.dividend ?? 0), 0),
    payRatio: rev ? pay / rev : 0, presets, prices: pr, styles,
    works: (league.stadiumNews ?? []).filter((x) => x.includes('착공') || x.includes('구장 리모델링')),
    teams: fins.map(({ f, i, h }) => {
      const it = h!.items;
      const g = (k: string) => ((it as Record<string, number | undefined>)[k] ?? 0) / wage;
      // want = 다음 개막 때 자금 규칙 전에 고를 추천안 (aiPreset), 다음 해 preset과 견주면 자금 규칙으로 내린 몫이 보인다
      const want = (Fin as unknown as { aiPreset?: (l: LeagueState, t: number) => string }).aiPreset?.(league, i);
      return { name: league.teams[i].name, net: h!.net / wage, cash: h!.cash / wage, preset: presetOf(f.activeBudget ?? f.budget), want, style: league.gm?.[i],
        gate: g('gate'), spon: g('sponsor') + g('merch'), parent: g('parent') + g('parentExtra'), pay: g('payroll') + g('foreign'),
        rev: Object.entries(it).reduce((s, [k, v]) => s + (!NOT_REVENUE.has(k) && (v ?? 0) > 0 ? (v ?? 0) : 0), 0) / wage,
        rescue: h!.rescue / wage, debt: (h!.debt ?? 0) / wage, dividend: (h!.dividend ?? 0) / wage };
    }),
  };
}

const eok = (man: number, d = 1) => (man / 10000).toFixed(d);

export function finTable(rows: FinRow[]): string {
  const cols = KINDS.filter((k) => rows.some((r) => Math.abs(r.items[k] ?? 0) >= 500));
  const head = `| 연도 | ${cols.join(' | ')} | 그 밖 | 수지 |`;
  const sep = `|---|${cols.map(() => '---').join('|')}|---|---|`;
  const items = [head, sep, ...rows.map((r) => `| ${r.year} | ${cols.map((k) => eok(r.items[k] ?? 0)).join(' | ')} | ${eok(r.other)} | ${eok(r.net)} |`)];
  const sum = ['| 연도 | 연봉 지수 | 자금 평균·최소·최대 (그 해 돈, 억) | 자금 평균 (2026년 돈) | 최대 ÷ 평균 | 0 이하 | 긴급 지원 구단·합 (구단) | 부채 구단·합 | 환원 합 | 연봉÷수입 | AI 추천안 (그 시즌) | 가격 일반·지정·프리미엄 | 스폰서 성향 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.year} | ${r.wage.toFixed(2)} | ${eok(r.cashAvg)}·${eok(r.cashMin)}·${eok(r.cashMax)} | ${eok(r.cashReal)} | ${(r.cashMax / Math.max(1, r.cashAvg)).toFixed(2)} | ${r.zero} | ${r.rescued}·${eok(r.rescueSum)}${r.rescueNames?.length ? ` (${r.rescueNames.join(', ')})` : ''} | ${r.debtTeams}·${eok(r.debtSum)} | ${eok(r.dividendSum)} | ${(r.payRatio * 100).toFixed(1)}% | ${Object.entries(r.presets).map(([k, v]) => `${k} ${v}`).join(' ')} | ${r.prices.map((x) => x.toFixed(2)).join('·')} | ${Object.entries(r.styles).map(([k, v]) => `${k} ${v}`).join(' ')} |`)];
  return ['장부 항목 구단 평균 (2026년 돈, 억 원, 수입 +·지출 −):', '', ...items, '', ...sum].join('\n');
}

async function main(): Promise<void> {
  installCalCache();
  const start = Number(arg('start') ?? 2026);
  const n = Number(arg('seasons') ?? 20);
  const seeds = (arg('seeds') ?? 'f6a').split(',');
  const params: EngineParams = { ...DEFAULT_PARAMS };
  const store = loadDataStore();
  const all: FinRow[] = [];
  const parts = [`# 재정 장기 점검 (${start}년부터 ${n}시즌, 모든 구단 AI)\n`, `만든 날: ${new Date().toISOString().slice(0, 10)}. 도구: \`npx tsx tools/finance_longrun.ts\`.\n`];
  for (const seed of seeds) {
    const t0 = Date.now();
    const { league } = createLeague(store, start, seed, params);
    // 게임(세션)처럼 AI 단장 성향을 정한다 (longsim.ts는 정하지 않아 모두 균형형). --no-gm이면 longsim과 같게
    if (!process.argv.includes('--no-gm')) ensureGm(league);
    const rows: FinRow[] = [];
    for (let i = 0; i < n; i++) {
      const { world } = runYear(league, store, params);
      const r = finRow(league, seed, world.year);
      rows.push(r);
      console.log(`[${seed}] ${r.year}: 자금 평균 ${eok(r.cashAvg)}억 (2026년 돈 ${eok(r.cashReal)}), 최소 ${eok(r.cashMin)}, 긴급 ${r.rescued}, 부채 ${r.debtTeams}`);
    }
    all.push(...rows);
    parts.push(`## 시드 ${seed} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`, finTable(rows), '');
  }
  const out = arg('out');
  const json = arg('json');
  if (json) { mkdirSync(dirname(json), { recursive: true }); writeFileSync(json, JSON.stringify(all)); }
  const text = parts.join('\n');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); console.log(`${out}에 썼습니다.`); }
  else console.log(text);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/finance_longrun.ts')) void main();
