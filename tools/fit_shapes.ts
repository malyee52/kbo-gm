// 가상 선수 특기 모양 맞춤 (2026-11-04 특기 모양 카드, 사용자 결정 2026-10-26).
//
// 실존 선수의 능력 비율(게임이 매긴 능력, worldForYear = 직전 3시즌 가중·구장 걷어 냄·평균 당김)에서 "가치 방향"을 뺀 나머지 모양을 잰다.
// - 타자: x = log(so, bb, s1, d2, t3, hr). 성장 방향 w(growth.ts BAT_SHIFT)로 x를 사영해 뺀 나머지 r = x − (x·w / w·w) w 가 모양이다.
//   모양은 자리 무리(C·1B·2B·3B·SS·LF·CF·RF, 외국인)마다 평균이 다르고, 3루타 등은 도루 시도율과 같이 간다:
//   r = 무리 평균 + b × (log 도루 시도율 − 실존 평균) + c × (기여 런 − 실존 평균) + e, e ~ 다변량 정규 (공분산의 촐레스키 분해를 낸다).
//   기여 기울기 c: 실존 스타는 성장 방향 w보다 홈런·볼넷 쪽으로 크다 (단타는 거의 같음). 가상 선수는 천장(잠재력) 런으로 모양을 뽑는다.
// - 투수: x = log(so, bb, hr, hit), w = PIT_SHIFT. 무리는 국내 선발·국내 구원·외국인. 언더·사이드는 빼고 잰다 (makeVirtual이 따로 곱한다).
// - 표본: 국내·외국인 모두, 타자 가중 타석 400 이상, 투수 가중 상대 타자 300 이상. 같은 선수가 여러 해 들어간다.
// 결과는 src/league/shapeTable.ts (자동 생성, 고치지 않는다). 쓰는 곳: league/offseason.ts makeVirtual (가상 선수·기록이 모자란 실존 지명 신인), 크기 배율 params.shape.
// 실행: npx tsx tools/fit_shapes.ts [--from 2001 --to 2025] [--out src/league/shapeTable.ts]   (약 1~2분)
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';

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

interface Row { g: string; r: number[]; z: number[] }
const bats: Row[] = [];
const pits: Row[] = [];
const batGroup = (pos: string | null, foreign: boolean) => foreign ? 'F' : pos === 'DH' || !pos ? '1B' : pos;

for (let y = from; y <= to; y++) {
  if (!store.season(y)) continue;
  const world = worldForYear(store, y, DEFAULT_PARAMS);
  const ctx = valueContext(world);
  for (const p of world.players) {
    if (p.bat && !p.isPitcher && p.bat.sample >= MIN_PA) {
      const x = BAT_K.map((k) => Math.log(Math.max(1e-3, p.bat![k])));
      bats.push({ g: batGroup(p.pos, p.foreign), r: resid(x, BAT_W), z: [Math.log(Math.max(0.005, p.bat.sbAtt)), currentRuns(p, ctx)] });
    }
    if (p.pit && p.isPitcher && p.pit.sample >= MIN_BF && !p.underhand) {
      const x = PIT_K.map((k) => Math.log(Math.max(1e-3, p.pit![k])));
      pits.push({ g: p.foreign ? 'F' : p.pit.startShare >= 0.5 ? 'SP' : 'RP', r: resid(x, PIT_W), z: [currentRuns(p, ctx)] });
    }
  }
  process.stderr.write(`${y} `);
}
process.stderr.write('\n');

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const quant = (xs: number[], f: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

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

/** 작은 정사각 행렬의 역 (가우스 소거) */
function inverse(a: number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    const piv = m[i][i];
    for (let j = 0; j < 2 * n; j++) m[i][j] /= piv;
    for (let k = 0; k < n; k++) if (k !== i) { const f = m[k][i]; for (let j = 0; j < 2 * n; j++) m[k][j] -= f * m[i][j]; }
  }
  return m.map((row) => row.slice(n));
}

/**
 * r = 무리 평균 + B (z − 전체 평균 z) + e. B는 무리 안에서 뺀 값끼리 회귀 (무리 효과와 섞이지 않게),
 * 무리 평균은 그 뒤 z 차이를 빼고 표본이 적으면 전체 쪽으로 PULL명만큼 당긴다
 */
function fit(rows: Row[], n: number) {
  const PULL = 50; // 무리 평균 당김 (가상 표본 수, 임시값)
  const groups = [...new Set(rows.map((r) => r.g))].sort();
  const nz = rows[0].z.length;
  const zAll = Array.from({ length: nz }, (_, i) => mean(rows.map((r) => r.z[i])));
  const gr: Record<string, number[]> = {};
  const gz: Record<string, number[]> = {};
  const count: Record<string, number> = {};
  for (const g of groups) {
    const rs = rows.filter((r) => r.g === g);
    count[g] = rs.length;
    gr[g] = Array.from({ length: n }, (_, i) => mean(rs.map((r) => r.r[i])));
    gz[g] = Array.from({ length: nz }, (_, i) => mean(rs.map((r) => r.z[i])));
  }
  const dz = rows.map((r) => r.z.map((v, i) => v - gz[r.g][i]));
  const dr = rows.map((r) => r.r.map((v, i) => v - gr[r.g][i]));
  const zz = Array.from({ length: nz }, (_, a) => Array.from({ length: nz }, (_, b) => mean(dz.map((v) => v[a] * v[b]))));
  const zi = inverse(zz);
  // B[i][a]: 갈래 i의 z_a 기울기
  const B = Array.from({ length: n }, (_, i) => {
    const zr = Array.from({ length: nz }, (_, a) => mean(dz.map((v, j) => v[a] * dr[j][i])));
    return Array.from({ length: nz }, (_, a) => zi[a].reduce((s, x, b) => s + x * zr[b], 0));
  });
  const fitted = (g: string) => gr[g].map((v, i) => v - B[i].reduce((s, b, a) => s + b * (gz[g][a] - zAll[a]), 0));
  const all = Array.from({ length: n }, (_, i) => mean(rows.map((r) => r.r[i] - B[i].reduce((s, b, a) => s + b * (r.z[a] - zAll[a]), 0))));
  const gm: Record<string, number[]> = {};
  for (const g of groups) gm[g] = fitted(g).map((v, i) => (count[g] * v + PULL * all[i]) / (count[g] + PULL));
  const e = dr.map((v, j) => v.map((x, i) => x - B[i].reduce((s, b, a) => s + b * dz[j][a], 0)));
  const cov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => mean(e.map((v) => v[i] * v[j]))));
  const runs = rows.map((r) => r.z[nz - 1]);
  return { groups, gm, count, B, zAll, cov, chol: cholesky(cov), runsLo: quant(runs, 0.05), runsHi: quant(runs, 0.95) };
}

const fb = fit(bats, 6);
const fp = fit(pits, 4);

const mat = (m: number[][]) => `[\n${m.map((row) => `    [${row.map((x) => round(x)).join(', ')}],`).join('\n')}\n  ]`;
const rec = (gm: Record<string, number[]>) => `{\n${Object.entries(gm).map(([g, v]) => `    '${g}': [${v.map((x) => round(x)).join(', ')}],`).join('\n')}\n  }`;
const sd = (cov: number[][]) => cov.map((r, i) => round(Math.sqrt(r[i]), 3));

const text = `// 자동 생성: npx tsx tools/fit_shapes.ts (고치지 않는다). 가상 선수 특기 모양 (2026-11-04 특기 모양 카드).
// 실존 선수 능력(worldForYear ${from}~${to}, 타자 가중 타석 ${MIN_PA}+ ${bats.length}명·해, 투수 가중 상대 타자 ${MIN_BF}+ ${pits.length}명·해, 언더·사이드 뺌)의
// log 능력 비율에서 성장 방향(growth.ts BAT_SHIFT·PIT_SHIFT)을 사영해 뺀 나머지 = 모양. 무리 평균(표본 적으면 전체 쪽으로 50명만큼 당김)
// + 도루 시도율 기울기(타자)·기여(런) 기울기 + 다변량 정규 나머지 (촐레스키 아래 삼각). 기여 기울기 덕에 가상 스타는 실존 스타처럼
// 홈런·볼넷으로 크고 단타로는 덜 큰다 (성장 방향 BAT_SHIFT는 단타도 홈런의 ⅓만큼 키운다).

/** 타자 갈래 순서 */
export const SHAPE_BAT_KEYS = ['so', 'bb', 's1', 'd2', 't3', 'hr'] as const;
/** 투수 갈래 순서 */
export const SHAPE_PIT_KEYS = ['so', 'bb', 'hr', 'hit'] as const;

export const SHAPE_BAT = {
  /** 무리(자리, F = 외국인)별 모양 평균. 표본 수: ${JSON.stringify(fb.count)} */
  mean: ${rec(fb.gm)} as Record<string, readonly number[]>,
  /** log 도루 시도율(실존 평균 ${round(fb.zAll[0], 3)}을 뺀 값) 1당 모양 변화 */
  sbSlope: [${fb.B.map((b) => round(b[0])).join(', ')}],
  sbMean: ${round(fb.zAll[0])},
  /** 기여(런, currentRuns, 실존 평균 ${round(fb.zAll[1], 2)}을 뺀 값) 1당 모양 변화. 런은 실존 표본의 5~95% (${round(fb.runsLo, 1)}~${round(fb.runsHi, 1)})로 자른다 */
  runSlope: [${fb.B.map((b) => round(b[1], 5)).join(', ')}],
  runMean: ${round(fb.zAll[1], 2)},
  runRange: [${round(fb.runsLo, 1)}, ${round(fb.runsHi, 1)}],
  /** 나머지 공분산의 촐레스키 (표준편차 ${JSON.stringify(sd(fb.cov))}) */
  chol: ${mat(fb.chol)},
} as const;

export const SHAPE_PIT = {
  /** 무리(SP 국내 선발·RP 국내 구원·F 외국인)별 모양 평균. 표본 수: ${JSON.stringify(fp.count)} */
  mean: ${rec(fp.gm)} as Record<string, readonly number[]>,
  /** 기여(런, 실존 평균 ${round(fp.zAll[0], 2)}을 뺀 값) 1당 모양 변화. 런은 ${round(fp.runsLo, 1)}~${round(fp.runsHi, 1)}로 자른다 */
  runSlope: [${fp.B.map((b) => round(b[0], 5)).join(', ')}],
  runMean: ${round(fp.zAll[0], 2)},
  runRange: [${round(fp.runsLo, 1)}, ${round(fp.runsHi, 1)}],
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
