// 리그 수준 보정 (2026-10-12 사용자: "리그 수준에 따른 보정을 두자").
//
// 방법: 성적 퍼짐(표준편차). 리그 수준이 낮을수록 최고 선수와 평균의 차이가 크다 (같은 리그 대비 1.3배라도 약한 리그에서는 덜 대단하다).
// 시즌마다 주전급(타자 300타석, 투수 상대 타자 300명) "리그 대비 성적"(로그)의 사분위 범위로 퍼짐을 재고, 앞뒤 해를 섞어 다듬는다.
// 보정 배율 = 기준 시대(2015~2026) 평균 퍼짐 ÷ 그 해 퍼짐. 평균보다 잘한 몫(리그 대비 성적 − 1)에 곱한다.
//   타자: 리그 대비 wOBA 비율 (tools/war.ts 선형 가중치), 투수: 리그 실점률 ÷ (실점률·FIP 반반)
// 처음 시도한 델타 방식(두 해 연속 뛴 선수의 변화를 나이·연도로 나눔)은 쓰지 않는다: 부진한 해에 출전이 줄어 빠지는 선수 때문에
// "복귀 선수가 해마다 좋아진다"로 치우쳐 1982년이 2026년보다 강한 리그로 나왔고, 리그 전체의 꾸준한 변화는 나이 곡선과 구별되지 않는다.
// 실행: npx tsx tools/league_quality.ts
import { loadDataStore } from '../src/data/loadNode';
import type { BatRow, DataStore, PitRow } from '../src/data/types';
import { leagueRefs } from './war';

const LW = { bb: 0.69, hbp: 0.72, s1: 0.89, d2: 1.27, t3: 1.62, hr: 2.1 };
/** 기준 시대 (보정 배율 1) */
export const BASE_YEARS: [number, number] = [2015, 2026];

type Lg = ReturnType<typeof leagueRefs> extends Map<number, infer T> ? T : never;

export function batRel(r: BatRow, lg: Lg): number {
  const s1 = r.h - r.d - r.t - r.hr;
  const woba = (LW.bb * (r.bb ?? 0) + LW.hbp * (r.hbp ?? 0) + LW.s1 * s1 + LW.d2 * r.d + LW.t3 * r.t + LW.hr * r.hr) / r.pa;
  return woba / lg.woba;
}
export function pitRel(r: PitRow, lg: Lg): number {
  const ip = r.outs / 3;
  const fip = (13 * r.hr + 3 * (r.bb + r.hbp) - 2 * r.so) / ip + lg.fipC;
  const mix = 0.5 * fip + 0.5 * ((r.r * 9) / ip);
  return lg.ra9 / Math.max(0.5, mix);
}

/** 퍼짐: 로그 비율의 사분위 범위 ÷ 1.35 (표준편차와 같은 눈금, 한두 명의 극단값에 흔들리지 않는다) */
function sdOf(xs: number[], _ws: number[]): number {
  const v = xs.map((x) => Math.log(Math.max(0.2, x))).sort((a, b) => a - b);
  const q = (f: number) => { const i = (v.length - 1) * f; const lo = Math.floor(i); return v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (i - lo); };
  return (q(0.75) - q(0.25)) / 1.35;
}

/** 연도별 보정 배율 (타자·투수). 평균보다 잘한 몫에 곱한다. 기준 시대 = 1 */
export function qualityFactors(store: Pick<DataStore, 'meta' | 'season'>): { bat: Map<number, number>; pit: Map<number, number>; raw: Map<number, { bat: number; pit: number }> } {
  const lgOf = leagueRefs(store);
  const years = store.meta.years;
  const raw = new Map<number, { bat: number; pit: number }>();
  for (const y of years) {
    const s = store.season(y)!;
    const lg = lgOf.get(y)!;
    const b = s.bat.filter((r) => r.pa >= 300);
    const p = s.pit.filter((r) => r.tbf >= 300 && r.outs > 0);
    raw.set(y, { bat: sdOf(b.map((r) => batRel(r, lg)), b.map((r) => r.pa)), pit: sdOf(p.map((r) => pitRel(r, lg)), p.map((r) => r.tbf)) });
  }
  // 앞뒤 해와 섞어 다듬는다 (1:2:1)
  const smooth = (k: 'bat' | 'pit') => new Map(years.map((y, i) => {
    const a = raw.get(years[Math.max(0, i - 1)])![k], b = raw.get(y)![k], c = raw.get(years[Math.min(years.length - 1, i + 1)])![k];
    return [y, (a + 2 * b + c) / 4] as const;
  }));
  const sb = smooth('bat'), sp = smooth('pit');
  const base = (m: Map<number, number>) => {
    const xs = years.filter((y) => y >= BASE_YEARS[0] && y <= BASE_YEARS[1]).map((y) => m.get(y)!);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const bb = base(sb), bp = base(sp);
  return {
    bat: new Map(years.map((y) => [y, bb / sb.get(y)!])),
    pit: new Map(years.map((y) => [y, bp / sp.get(y)!])),
    raw,
  };
}

if (process.argv[1]?.endsWith('league_quality.ts')) {
  const store = loadDataStore();
  const q = qualityFactors(store);
  console.log('연도 | 타자 퍼짐 | 타자 보정 배율 | 투수 퍼짐 | 투수 보정 배율');
  for (const y of store.meta.years) {
    const r = q.raw.get(y)!;
    console.log(`${y} | ${r.bat.toFixed(3)} | ${q.bat.get(y)!.toFixed(2)} | ${r.pit.toFixed(3)} | ${q.pit.get(y)!.toFixed(2)}`);
  }
}
