// 공개 특수능력 2차 기획 재료: 볼카운트 칸 '때 나눔'(평균 0) 스킬이 타석 결과를 얼마나 바꾸는지 (2026-10-26, 공개 스킬 기획 16-6 2차)
// 사용법: npx tsx tools/skill_shape_value.ts [--year 2025] [--deltas 0.15,0.3,0.45]
// 두 가지를 잰다. 둘 다 등급(시즌 평균)은 그대로 두고 칸 사이에서만 옮긴다:
//  초구 스윙 (타자 적극성의 때): 0-0 칸 스윙 로짓 −δ(공 보는 타자) / +δ(초구 공략), 나머지 칸은 리그 평균 매치업의 타석당 스윙 수가 같도록 반대로 w·δ.
//  초구 존 (투수 제구의 때): 0-0 칸 존 로짓 +δ(정면 승부), 나머지 칸은 타석당 존 안 공 수가 같도록 반대로.
// 리그 칸 상수(LeaguePlate)를 잠시 바꿔 실제 주전 타자 × 투수 쌍 전부의 paRates를 평균한다 (모두가 그 스킬을 가진 것과 같은 평균). 난수를 쓰지 않는다.

import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';
import type { GameContext } from '../src/engine/game';
import { enterPitcher } from '../src/engine/manager';
import { NEUTRAL_PARK, NO_STATE, paRates } from '../src/engine/pa';
import { plateCells, plateSteps, NO_SHIFT, ZERO_BAT, ZERO_PIT, type LeaguePlate } from '../src/engine/plate';
import { installCalCache } from './calCache';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const year = Number(arg('year') ?? 2025);
const deltas = (arg('deltas') ?? '0.15,0.3,0.45').split(',').map(Number);
const W = { bb: 0.69, hbp: 0.72, s1: 0.88, d2: 1.25, t3: 1.58, hr: 2.03 };
const WOBA_SCALE = 1.25;

installCalCache();
const store = loadDataStore();
const params = DEFAULT_PARAMS;
const world = worldForYear(store, year, params);
const probe = Season.start(world, params, `skill-shape-${year}`);
const ctx = (probe as unknown as { ctx: GameContext }).ctx;
const lp = ctx.plate!.lp;

const bats = world.players.filter((p) => !p.isPitcher && p.bat && p.bat.sample >= 300);
const pits = world.players.filter((p) => p.isPitcher && p.pit && p.pit.sample >= 200);

/** 0-0에서 시작한 칸별 방문 수 (2스트라이크 파울은 제자리) */
function visits(): Float64Array {
  const pr = plateCells(lp, ZERO_BAT, ZERO_PIT, NO_SHIFT);
  const v = new Float64Array(12);
  v[0] = 1;
  for (let bl = 0; bl < 4; bl++) {
    for (let st = 0; st < 3; st++) {
      const c = bl * 3 + st;
      const o = c * 5;
      if (st === 2) v[c] /= 1 - pr[o + 2];
      if (bl < 3) v[(bl + 1) * 3 + st] += v[c] * pr[o];
      if (st < 2) v[c + 1] += v[c] * (pr[o + 1] + pr[o + 2]);
    }
  }
  return v;
}
/** 리그 평균 매치업의 타석당 스윙 수·존 안 공 수 */
function perPa(): { swing: number; zone: number; ppa: number } {
  const v = visits();
  let swing = 0, zone = 0, ppa = 0;
  for (let c = 0; c < 12; c++) {
    const s = plateSteps(lp, c, ZERO_BAT, ZERO_PIT, NO_SHIFT);
    swing += v[c] * (s.zone * s.swingIn + (1 - s.zone) * s.swingOut);
    zone += v[c] * s.zone;
    ppa += v[c];
  }
  return { swing, zone, ppa };
}

interface Line { woba: number; so: number; bb: number; hr: number; ppa: number }
function measure(): Line {
  const acc: Line = { woba: 0, so: 0, bb: 0, hr: 0, ppa: 0 };
  let cnt = 0;
  for (const b of bats) {
    for (const p of pits) {
      const pg = enterPitcher(p, true, 0, ctx);
      const r = paRates(b, pg, false, ctx, NO_STATE, NEUTRAL_PARK);
      acc.woba += W.bb * r.bb + W.hbp * r.hbp + W.s1 * r.s1 + W.d2 * r.d2 + W.t3 * r.t3 + W.hr * r.hr;
      acc.so += r.so;
      acc.bb += r.bb;
      acc.hr += r.hr;
      cnt++;
    }
  }
  for (const k of Object.keys(acc) as (keyof Line)[]) acc[k] /= cnt;
  acc.ppa = perPa().ppa;
  return acc;
}

type Arr = 'lsi' | 'lso' | 'lz';
/** 0-0 칸에 d, 나머지 칸에 −w·d를 더하고 keep(타석당 값)이 그대로가 되는 w를 이분법으로 찾는다 */
function shiftCells(arrs: Arr[], d: number, keep: () => number): () => void {
  const saved = arrs.map((a) => Float64Array.from(lp[a]));
  const apply = (w: number) => {
    arrs.forEach((a, i) => {
      for (let c = 0; c < 12; c++) lp[a][c] = saved[i][c] + (c === 0 ? d : -w * d);
    });
  };
  apply(0);
  const target = (() => { const s = arrs.map((a) => Float64Array.from(lp[a])); arrs.forEach((a, i) => lp[a].set(saved[i])); const t = keep(); arrs.forEach((a, i) => lp[a].set(s[i])); return t; })();
  let lo = -2, hi = 2;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    apply(mid);
    // d > 0이면 0-0 칸이 늘어 w를 키워야 keep이 줄어든다
    if ((keep() - target) * Math.sign(d) > 0) lo = mid; else hi = mid;
  }
  apply((lo + hi) / 2);
  return () => arrs.forEach((a, i) => lp[a].set(saved[i]));
}

const base = measure();
const b0 = perPa();
console.log(`${year} 월드: 타자 ${bats.length}명 × 투수 ${pits.length}명. 기준 wOBA ${base.woba.toFixed(4)}, 삼진 ${base.so.toFixed(4)}, 볼넷 ${base.bb.toFixed(4)}, 홈런 ${base.hr.toFixed(4)}, P/PA ${base.ppa.toFixed(3)}, 타석당 스윙 ${b0.swing.toFixed(3)}, 존 안 공 ${b0.zone.toFixed(3)}`);
const row = (name: string, d: number, m: Line) => {
  const dw = m.woba - base.woba;
  console.log(`| ${name} | ${d} | ${dw >= 0 ? '+' : ''}${dw.toFixed(4)} | ${((dw / WOBA_SCALE) * 600).toFixed(2)} | ${(m.so / base.so).toFixed(3)} | ${(m.bb / base.bb).toFixed(3)} | ${(m.hr / base.hr).toFixed(3)} | ${(m.ppa - base.ppa >= 0 ? '+' : '') + (m.ppa - base.ppa).toFixed(3)} |`);
};
console.log('| 스킬 | δ (로짓) | wOBA 차 | 600타석 득점 | 삼진 배율 | 볼넷 배율 | 홈런 배율 | P/PA 차 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const d of deltas) {
  for (const [name, sign] of [['공 보는 타자 (초구 스윙 −)', -1], ['초구 공략 (초구 스윙 +)', 1]] as const) {
    const undo = shiftCells(['lsi', 'lso'], sign * d, () => perPa().swing);
    row(name, d, measure());
    undo();
  }
  const undo = shiftCells(['lz'], d, () => perPa().zone);
  row('정면 승부 (투수 초구 존 +)', d, measure());
  undo();
}
