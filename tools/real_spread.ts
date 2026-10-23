// 실제 리그의 해마다 공·타격 퍼짐: 타석당 홈런, 평균자책, 최다 홈런, 규정이닝 평균자책 2점 미만 투수 (자료집 시즌 자료).
// 시즌 반발계수(futureRules.ts seasonCor)로 흔들리는 게임 리그를 실제와 나란히 볼 때 쓴다 (tools/longsim.ts의 "공·타격" 표).
//
// 사용법:  npx tsx tools/real_spread.ts [--from 2010] [--to 2026]

import { loadDataStore } from '../src/data/loadNode';

export interface SpreadRow { year: number; hrPa: number; era: number; topHr: number; subTwo: number }
export interface SpreadSummary { from: number; to: number; hrPa: [number, number]; hrPaSd: number; era: [number, number]; eraSd: number; topHr: [number, number]; subTwo: [number, number] }

export const sdOf = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];

export function realSpread(store: ReturnType<typeof loadDataStore>, from = 2010, to = 2026): { rows: SpreadRow[]; summary: SpreadSummary } {
  const rows: SpreadRow[] = [];
  for (let y = from; y <= to; y++) {
    const d = store.season(y);
    if (!d) continue;
    const L = d.league;
    // 시즌 자료의 개인 기록 열 (hr, outs, er)
    const bat = d.bat as unknown as { hr?: number }[];
    const pit = d.pit as unknown as { outs?: number; er?: number }[];
    rows.push({
      year: y, hrPa: L.hr / L.pa, era: L.era,
      topHr: Math.max(...bat.map((b) => b.hr ?? 0)),
      subTwo: pit.filter((p) => (p.outs ?? 0) >= d.games * 3 && (27 * (p.er ?? 0)) / p.outs! < 2).length,
    });
  }
  const summary: SpreadSummary = {
    from, to,
    hrPa: range(rows.map((r) => r.hrPa)), hrPaSd: sdOf(rows.map((r) => r.hrPa)),
    era: range(rows.map((r) => r.era)), eraSd: sdOf(rows.map((r) => r.era)),
    topHr: range(rows.map((r) => r.topHr)), subTwo: range(rows.map((r) => r.subTwo)),
  };
  return { rows, summary };
}

export function spreadLine(label: string, s: Pick<SpreadSummary, 'hrPa' | 'hrPaSd' | 'era' | 'eraSd' | 'topHr' | 'subTwo'>): string {
  const p = (x: number) => (x * 100).toFixed(2);
  return `| ${label} | ${p(s.hrPa[0])}~${p(s.hrPa[1])}% | ${p(s.hrPaSd)}%p | ${s.era[0].toFixed(2)}~${s.era[1].toFixed(2)} | ${s.eraSd.toFixed(2)} | ${s.topHr[0]}~${s.topHr[1]} | ${s.subTwo[0]}~${s.subTwo[1]} |`;
}
export const SPREAD_HEAD = '| 구분 | 타석당 홈런 | 표준편차 | 평균자책 | 표준편차 | 최다 홈런 | 2점 미만 투수 |\n|---|---|---|---|---|---|---|';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/real_spread.ts')) {
  const { rows, summary } = realSpread(loadDataStore(), Number(arg('from') ?? 2010), Number(arg('to') ?? 2026));
  console.log('| 연도 | 타석당 홈런 | 평균자책 | 최다 홈런 | 2점 미만 투수 |\n|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.year} | ${(r.hrPa * 100).toFixed(2)}% | ${r.era.toFixed(2)} | ${r.topHr} | ${r.subTwo} |`);
  console.log(`\n${SPREAD_HEAD}\n${spreadLine(`실제 ${summary.from}~${summary.to}`, summary)}`);
}
