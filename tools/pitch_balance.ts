// 구종 균형 점검 (엔진 2 20-4단계, docs/경기엔진2_기획안.md 6장): 플레이어가 공마다 구종·코스를 지시할 때
// 한 구종만·한 코스만·카운트마다 가장 유리한 공(욕심쟁이)을 계속 고르는 전략이 AI 포수 배합보다 크게 좋지 않은지 잰다.
// 타석 단위 흉내: 리그 평균 타자 대 투수(구종 꼴 몇 가지), 칸 확률은 엔진의 칸 함수 사슬, 구종·코스는 arsenal.ts 그대로.
// 한 "등판" = 타석 27개 (예측 손해 기억은 등판마다 새로). 값은 타석당 득점 가치(아웃 0, 볼넷 0.69, 사구 0.72, 단타 0.88, 2루타 1.25, 3루타 1.58, 홈런 2.03).
// AI 배합 값은 사슬에서 바로 계산한다 (지시 없는 공의 결과 = 사슬 그대로).
//
// 사용법: npx tsx tools/pitch_balance.ts [--pas 54000] [--seed bal] [--lambda 2.5] [--aim 0.45] [--greedy-only] [--year 2025] [--out reports/pitch-balance.md]
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng } from '../src/engine';
import { aimedOutcome, ARSENAL_PARAMS, newAim, O, pitchJoint, PITCH_ZONES, rememberAim, type ArsenalPitch, type PitchJoint, type PitchZone } from '../src/engine/arsenal';
import { chainShapeFor } from '../src/engine/params';
import { calledShare } from '../src/engine/pitch';
import { leaguePlateFor, plateCells, ZERO_BAT, ZERO_PIT, NO_SHIFT } from '../src/engine/plate';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PAS = Number(arg('pas', '54000'));
const SEED = arg('seed', 'bal');
const YEAR = Number(arg('year', '2025'));
const OUT = arg('out', '');
if (process.argv.includes('--lambda')) ARSENAL_PARAMS.read.lambda = Number(arg('lambda', '2.5'));
if (process.argv.includes('--aim')) ARSENAL_PARAMS.aimHit = Number(arg('aim', '0.45'));
const ONLY_GREEDY = process.argv.includes('--greedy-only');

/** 결과 칸별 타석 끝 값 (타석이 끝나는 결과만) */
const VAL: Record<number, number> = { [O.H]: 0.72, [O.X1]: 0.88, [O.X2]: 1.25, [O.X3]: 1.58, [O.HR]: 2.03, [O.OUT]: 0 };
const W_VAL = 0.69;

const store = loadDataStore();
const lg = store.season(YEAR)!.league.rates;
const lp = leaguePlateFor(chainShapeFor(DEFAULT_PARAMS, YEAR), lg, DEFAULT_PARAMS.plate);
const cells = plateCells(lp, ZERO_BAT, ZERO_PIT, NO_SHIFT);
const called = calledShare(lp, ZERO_BAT, ZERO_PIT, NO_SHIFT);
const x = 1 - lg.so - lg.bb - lg.hbp;
const IN_PLAY = [lg.s1 / x, lg.d2 / x, lg.t3 / x, lg.hr / x];
IN_PLAY.push(1 - IN_PLAY.reduce((a, b) => a + b, 0));

const PITCHERS: { name: string; arsenal: ArsenalPitch[] }[] = [
  { name: '평균 4구종', arsenal: [{ type: '포심', share: 54 }, { type: '슬라이더', share: 28 }, { type: '체인지업', share: 13 }, { type: '커브', share: 5 }] },
  { name: '주무기 슬라이더(등급 70)', arsenal: [{ type: '포심', share: 50 }, { type: '슬라이더', share: 35, grade: 70 }, { type: '포크', share: 15 }] },
  { name: '투심·커터 맞혀 잡기', arsenal: [{ type: '투심', share: 45 }, { type: '커터', share: 30 }, { type: '체인지업', share: 15 }, { type: '커브', share: 10, grade: 40 }] },
];

/** 다음 칸: 볼·스트라이크·파울 */
function next(c: number, o: number): number | 'W' | 'K' {
  const b = Math.floor(c / 3);
  const s = c % 3;
  if (o === O.B) return b === 3 ? 'W' : (b + 1) * 3 + s;
  if (o === O.C || o === O.S) return s === 2 ? 'K' : b * 3 + s + 1;
  return s === 2 ? c : b * 3 + s + 1; // 파울
}

/** 칸 값 (뒤에서부터, 결과 확률 q(c)로): AI 배합이면 사슬 칸 그대로 */
function stateValues(q: (c: number) => Float64Array): Float64Array {
  const V = new Float64Array(12);
  for (let b = 3; b >= 0; b--) {
    for (let s = 2; s >= 0; s--) {
      const c = b * 3 + s;
      const p = q(c);
      let v = 0;
      let stay = 0;
      for (let o = 0; o < 10; o++) {
        if (p[o] === 0) continue;
        if (o in VAL) { v += p[o] * VAL[o]; continue; }
        const n = next(c, o);
        if (n === 'W') v += p[o] * W_VAL;
        else if (n === 'K') v += 0;
        else if (n === c) stay += p[o];
        else v += p[o] * V[n];
      }
      V[c] = v / (1 - stay);
    }
  }
  return V;
}

/** 한 공의 기대 값 (지금 칸 값 V로) */
function pitchValue(p: Float64Array, c: number, V: Float64Array): number {
  let v = 0;
  for (let o = 0; o < 10; o++) {
    if (p[o] === 0) continue;
    if (o in VAL) v += p[o] * VAL[o];
    else {
      const n = next(c, o);
      v += n === 'W' ? p[o] * W_VAL : n === 'K' ? 0 : p[o] * V[n];
    }
  }
  return v;
}

type Policy = (j: PitchJoint, c: number, mem: ReturnType<typeof newAim>, V: Float64Array) => { type: string; zone?: PitchZone };

function simulate(j: PitchJoint, policy: Policy, V: Float64Array, rng: Rng): { mean: number; se: number } {
  let sum = 0;
  let sq = 0;
  let mem = newAim();
  for (let i = 0; i < PAS; i++) {
    if (i % 27 === 0) mem = newAim();
    let c = 0;
    let val = 0;
    for (let k = 0; k < 60; k++) {
      const pick = policy(j, c, mem, V);
      const q = aimedOutcome(j, c, pick.type, pick.zone, 0, mem);
      rememberAim(mem, pick.type, pick.zone);
      let u = rng.next();
      let o = 9;
      for (let t = 0; t < 10; t++) if ((u -= q[t]) < 0) { o = t; break; }
      if (o in VAL) { val = VAL[o]; break; }
      const n = next(c, o);
      if (n === 'W') { val = W_VAL; break; }
      if (n === 'K') { val = 0; break; }
      c = n;
    }
    sum += val;
    sq += val * val;
  }
  const mean = sum / PAS;
  return { mean, se: Math.sqrt((sq / PAS - mean * mean) / PAS) };
}

const lines: string[] = [];
const out = (s: string) => { lines.push(s); console.log(s); };
out(`# 구종 균형 점검 (엔진 2 20-4단계)`);
out('');
out(`${YEAR}년 리그 평균 타자, 전략마다 ${PAS.toLocaleString()}타석 (등판 = 27타석), 시드 ${SEED}. 노림수 λ ${ARSENAL_PARAMS.read.lambda}, n0 ${ARSENAL_PARAMS.read.n0}, 겨눈 코스 몫 ${ARSENAL_PARAMS.aimHit}.`);
out('값 = 타석당 득점 가치 (작을수록 투수에게 좋다). 차이 = 전략 − AI 배합 (음수면 AI보다 유리), 괄호는 표본 오차.');
out('');
let worst = -Infinity;
for (const pit of PITCHERS) {
  const j = pitchJoint(cells, called, IN_PLAY, pit.arsenal);
  const Vai = stateValues((c) => {
    const p = new Float64Array(10);
    for (let t = 0; t < j.arsenal.length; t++) for (let o = 0; o < 10; o++) p[o] += j.m[c][t * 10 + o];
    return p;
  });
  const ai = Vai[0];
  out(`## ${pit.name}`);
  out('');
  out(`AI 배합: ${ai.toFixed(4)}`);
  out('');
  out('| 전략 | 값 | 차이 |');
  out('|---|---:|---:|');
  const row = (name: string, policy: Policy) => {
    const r = simulate(j, policy, Vai, new Rng(`${SEED}/${pit.name}/${name}`));
    const d = r.mean - ai;
    worst = Math.max(worst, -d);
    out(`| ${name} | ${r.mean.toFixed(4)} | ${d >= 0 ? '+' : ''}${d.toFixed(4)} (±${r.se.toFixed(4)}) |`);
  };
  if (!ONLY_GREEDY) for (const a of j.arsenal) row(`${a.type}만`, () => ({ type: a.type }));
  if (!ONLY_GREEDY) for (const z of PITCH_ZONES) row(`${z}만 (구종은 비율 1위)`, () => ({ type: j.arsenal[0].type, zone: z }));
  // 욕심쟁이: 카운트마다 지금 기억(노림수)까지 넣어 다음 한 공의 기대 값이 가장 작은 구종·코스
  row('욕심쟁이 (공마다 가장 유리한 구종·코스)', (jj, c, mem, V) => {
    let best = { type: jj.arsenal[0].type } as { type: string; zone?: PitchZone };
    let bv = Infinity;
    for (const a of jj.arsenal) {
      for (const z of [undefined, ...PITCH_ZONES]) {
        const v = pitchValue(aimedOutcome(jj, c, a.type, z, 0, mem), c, V);
        if (v < bv) { bv = v; best = { type: a.type, ...(z ? { zone: z } : {}) }; }
      }
    }
    return best;
  });
  out('');
}
out(`가장 유리한 전략의 이득: ${worst.toFixed(4)} (타석당 득점 가치)`);
if (OUT) writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
