// 가상 선수 특기 모양 맞춤 (2026-11-04 특기 모양 카드, 사용자 결정 2026-10-26).
//
// 실존 선수의 능력 비율(게임이 매긴 능력, worldForYear = 직전 3시즌 가중·구장 걷어 냄·평균 당김)에서 "가치 방향"을 뺀 나머지 모양을 잰다.
// - 타자: x = log(so, bb, s1, d2, t3, hr). 성장 방향 w(growth.ts BAT_SHIFT)로 x를 사영해 뺀 나머지 r = x − (x·w / w·w) w 가 모양이다.
//   모양은 자리 무리(C·1B·2B·3B·SS·LF·CF·RF, 외국인)마다 평균이 다르고, 3루타 등은 도루 시도율과 같이 간다:
//   r = 무리 평균 + b × (log 도루 시도율 − 실존 평균) + e, e ~ 다변량 정규 (공분산의 촐레스키 분해를 낸다).
// - 투수: x = log(so, bb, hr, hit), w = PIT_SHIFT. 무리는 국내 선발·국내 구원·외국인. 언더·사이드는 빼고 잰다 (makeVirtual이 따로 곱한다).
// - 표본: 국내·외국인 모두, 타자 가중 타석 400 이상, 투수 가중 상대 타자 300 이상. 같은 선수가 여러 해 들어간다.
// 결과는 src/league/shapeTable.ts (자동 생성, 고치지 않는다). 쓰는 곳: league/offseason.ts makeVirtual (가상 선수만), 크기 배율 params.shape.
// 실행: npx tsx tools/fit_shapes.ts [--from 2001 --to 2025] [--out src/league/shapeTable.ts]   (약 1~2분)
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const from = Number(arg('from', '2001'));
const to = Number(arg('to', '2025'));
const out = arg('out', 'src/league/shapeTable.ts');
const store = loadDataStore();

const BAT_K = ['so', 'bb', 's1', 'd2', 't3', 'hr'] as const;
const PIT_K = ['so', 'bb', 'hr', 'hit'] as const;
const BAT_W = [-0.6, 0.7, 0.4, 0.7, 0.3, 1.2];
const PIT_W = [0.6, -0.6, -0.8, -0.3];
const MIN_PA = 400;
const MIN_BF = 300;

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const resid = (x: number[], w: number[]) => { const c = dot(x, w) / dot(w, w); return x.map((v, i) => v - c * w[i]); };

interface BatRow { g: string; r: number[]; lsb: number; real: number[] }
interface PitRow { g: string; r: number[] }
const bats: BatRow[] = [];
const pits: PitRow[] = [];
const batGroup = (pos: string | null, foreign: boolean) => foreign ? 'F' : pos === 'DH' || !pos ? '1B' : pos;

for (let y = from; y <= to; y++) {
  if (!store.season(y)) continue;
  const world = worldForYear(store, y, DEFAULT_PARAMS);
  for (const p of world.players) {
    if (p.bat && !p.isPitcher && p.bat.sample >= MIN_PA) {
      const x = BAT_K.map((k) => Math.log(Math.max(1e-3, p.bat![k])));
      bats.push({ g: batGroup(p.pos, p.foreign), r: resid(x, BAT_W), lsb: Math.log(Math.max(0.005, p.bat.sbAtt)), real: x });
    }
    if (p.pit && p.isPitcher && p.pit.sample >= MIN_BF && !p.underhand) {
      const x = PIT_K.map((k) => Math.log(Math.max(1e-3, p.pit![k])));
      pits.push({ g: p.foreign ? 'F' : p.pit.startShare >= 0.5 ? 'SP' : 'RP', r: resid(x, PIT_W) });
    }
  }
  process.stderr.write(`${y} `);
}
process.stderr.write('\n');

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** 촐레스키 분해 (아래 삼각) */
function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const l = a.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = a[i][j];
    for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k];
    l[i][j] = i === j ? Math.sqrt(Math.max(1e-12, s)) : s / l[j][j];
  }
  return l;
}

/** 무리 평균을 빼고(무리 평균은 표본이 적으면 전체 쪽으로 당김) 남은 것의 공분산 */
function fit<R extends { g: string; r: number[] }>(rows: R[], n: number, extra?: (row: R) => number) {
  const groups = [...new Set(rows.map((r) => r.g))].sort();
  const all = Array.from({ length: n }, (_, i) => mean(rows.map((r) => r.r[i])));
  const PULL = 50; // 무리 평균 당김 (가상 표본 수, 임시값)
  const gm: Record<string, number[]> = {};
  const count: Record<string, number> = {};
  for (const g of groups) {
    const rs = rows.filter((r) => r.g === g);
    count[g] = rs.length;
    gm[g] = all.map((m, i) => (rs.reduce((s, r) => s + r.r[i], 0) + PULL * m) / (rs.length + PULL));
  }
  // 도루 시도율 기울기: 무리 평균을 뺀 r을 log 시도율(무리 평균 뺀 값)에 회귀
  let slope = new Array(n).fill(0);
  let xMean = 0;
  if (extra) {
    xMean = mean(rows.map(extra));
    const xs = rows.map((r) => extra(r) - xMean);
    const vx = mean(xs.map((x) => x * x));
    slope = Array.from({ length: n }, (_, i) => mean(rows.map((r, j) => (r.r[i] - gm[r.g][i]) * xs[j])) / vx);
  }
  const e = rows.map((r) => r.r.map((v, i) => v - gm[r.g][i] - (extra ? slope[i] * (extra(r) - xMean) : 0)));
  const cov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => mean(e.map((v) => v[i] * v[j]))));
  return { groups, gm, count, slope, xMean, cov, chol: cholesky(cov) };
}

const fb = fit(bats, 6, (r) => r.lsb);
const fp = fit(pits, 4);

const mat = (m: number[][]) => `[\n${m.map((row) => `    [${row.map((x) => round(x)).join(', ')}],`).join('\n')}\n  ]`;
const rec = (gm: Record<string, number[]>) => `{\n${Object.entries(gm).map(([g, v]) => `    '${g}': [${v.map((x) => round(x)).join(', ')}],`).join('\n')}\n  }`;
const sd = (cov: number[][]) => cov.map((r, i) => round(Math.sqrt(r[i]), 3));

const text = `// 자동 생성: npx tsx tools/fit_shapes.ts (고치지 않는다). 가상 선수 특기 모양 (2026-11-04 특기 모양 카드).
// 실존 선수 능력(worldForYear ${from}~${to}, 타자 가중 타석 ${MIN_PA}+ ${bats.length}명·해, 투수 가중 상대 타자 ${MIN_BF}+ ${pits.length}명·해, 언더·사이드 뺌)의
// log 능력 비율에서 성장 방향(growth.ts BAT_SHIFT·PIT_SHIFT)을 사영해 뺀 나머지 = 모양. 무리 평균(표본 적으면 전체 쪽으로 50명만큼 당김)
// + 도루 시도율 기울기(타자) + 다변량 정규 나머지 (촐레스키 아래 삼각).

/** 타자 갈래 순서 */
export const SHAPE_BAT_KEYS = ['so', 'bb', 's1', 'd2', 't3', 'hr'] as const;
/** 투수 갈래 순서 */
export const SHAPE_PIT_KEYS = ['so', 'bb', 'hr', 'hit'] as const;

export const SHAPE_BAT = {
  /** 무리(자리, F = 외국인)별 모양 평균. 표본 수: ${JSON.stringify(fb.count)} */
  mean: ${rec(fb.gm)} as Record<string, readonly number[]>,
  /** log 도루 시도율(실존 평균 ${round(fb.xMean, 3)}을 뺀 값) 1당 모양 변화 */
  sbSlope: [${fb.slope.map((x) => round(x)).join(', ')}],
  sbMean: ${round(fb.xMean)},
  /** 나머지 공분산의 촐레스키 (표준편차 ${JSON.stringify(sd(fb.cov))}) */
  chol: ${mat(fb.chol)},
} as const;

export const SHAPE_PIT = {
  /** 무리(SP 국내 선발·RP 국내 구원·F 외국인)별 모양 평균. 표본 수: ${JSON.stringify(fp.count)} */
  mean: ${rec(fp.gm)} as Record<string, readonly number[]>,
  /** 나머지 공분산의 촐레스키 (표준편차 ${JSON.stringify(sd(fp.cov))}) */
  chol: ${mat(fp.chol)},
} as const;
`;
writeFileSync(out, text);
console.log(text);

// 참고: 모양 무리의 비율 (거포·삼진형·준족·컨택형 등). 모양 r의 갈래 값이 표준편차 1배를 넘는 선수 몫
const tag = (rows: { r: number[] }[], keys: readonly string[], cov: number[][]) => {
  const s = cov.map((r, i) => Math.sqrt(r[i]));
  const lines: string[] = [];
  keys.forEach((k, i) => {
    const hi = rows.filter((r) => r.r[i] > s[i]).length / rows.length;
    const lo = rows.filter((r) => r.r[i] < -s[i]).length / rows.length;
    lines.push(`${k}: +1sd ${(hi * 100).toFixed(0)}% / −1sd ${(lo * 100).toFixed(0)}%`);
  });
  return lines.join(', ');
};
console.error(`타자 ${tag(bats, BAT_K, fb.cov)}`);
console.error(`투수 ${tag(pits, PIT_K, fp.cov)}`);
