// 공개 특수능력 크기 재료: 타석 보정 edge 하나가 wOBA·타석당 득점으로 얼마인지 (2026-10-26, 공개 스킬 기획 16-6)
// 사용법: npx tsx tools/skill_edge.ts [--year 2025] [--edges 0.013,0.02,0.03,0.035,0.04]
// 지금 엔진 길(paRates, 능력치 v2 사슬 + 타구 갈래)에서 타자 쪽 edge만 e로 둔 매치업 확률을 실제 주전 타자 × 투수 쌍 전부로 평균한다.
// edge는 컨디션 자리(ctx.form)로 넣는다: paRates가 좌우·홈·특수능력과 같은 합에 더하므로 특수능력 edge와 같은 길이다. 난수를 쓰지 않는다.

import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';
import type { GameContext } from '../src/engine/game';
import { enterPitcher } from '../src/engine/manager';
import { NEUTRAL_PARK, NO_STATE, paRates } from '../src/engine/pa';
import { installCalCache } from './calCache';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const year = Number(arg('year') ?? 2025);
const edges = (arg('edges') ?? '0.013,0.02,0.03,0.035,0.04').split(',').map(Number);
// tools/pbp_clutch.py와 같은 대략 가중치
const W = { bb: 0.69, hbp: 0.72, s1: 0.88, d2: 1.25, t3: 1.58, hr: 2.03 };
// wOBA 1점 → 타석당 득점 환산 (wOBA 눈금, 대략값 1.25, 임시값)
const WOBA_SCALE = 1.25;

installCalCache();
const store = loadDataStore();
const params = DEFAULT_PARAMS;
const world = worldForYear(store, year, params);
const probe = Season.start(world, params, `skill-edge-${year}`);
const ctx = (probe as unknown as { ctx: GameContext }).ctx;

const bats = world.players.filter((p) => !p.isPitcher && p.bat && p.bat.sample >= 300);
const pits = world.players.filter((p) => p.isPitcher && p.pit && p.pit.sample >= 200);
const n = world.players.reduce((m, p) => Math.max(m, p.idx + 1), 0);

interface Line { woba: number; so: number; bb: number; hr: number; hit: number }
function measure(e: number): Line {
  ctx.form = new Float64Array(n);
  const acc: Line = { woba: 0, so: 0, bb: 0, hr: 0, hit: 0 };
  let cnt = 0;
  for (const b of bats) {
    ctx.form[b.idx] = e;
    for (const p of pits) {
      const pg = enterPitcher(p, true, 0, ctx);
      const r = paRates(b, pg, false, ctx, NO_STATE, NEUTRAL_PARK);
      const s = r.scale;
      acc.woba += s * (W.bb * r.bb + W.hbp * r.hbp + W.s1 * r.s1 + W.d2 * r.d2 + W.t3 * r.t3 + W.hr * r.hr);
      acc.so += s * r.so;
      acc.bb += s * r.bb;
      acc.hr += s * r.hr;
      acc.hit += s * (r.s1 + r.d2 + r.t3 + r.hr);
      cnt++;
    }
    ctx.form[b.idx] = 0;
  }
  for (const k of Object.keys(acc) as (keyof Line)[]) acc[k] /= cnt;
  return acc;
}

const base = measure(0);
console.log(`${year} 월드: 타자 ${bats.length}명 × 투수 ${pits.length}명, 사슬 ${ctx.plate ? '있음 (능력치 v2)' : '없음'}`);
console.log(`edge 0: wOBA ${base.woba.toFixed(4)}, 삼진 ${base.so.toFixed(4)}, 볼넷 ${base.bb.toFixed(4)}, 홈런 ${base.hr.toFixed(4)}, 안타 ${base.hit.toFixed(4)}`);
console.log('| edge | wOBA 차 | 타석당 득점 차 | 600타석당 득점 | 삼진 배율 | 볼넷 배율 | 홈런 배율 | 안타 배율 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const e of edges) {
  const m = measure(e);
  const dw = m.woba - base.woba;
  console.log(`| ${e} | ${dw >= 0 ? '+' : ''}${dw.toFixed(4)} | ${(dw / WOBA_SCALE).toFixed(4)} | ${((dw / WOBA_SCALE) * 600).toFixed(1)} | ${(m.so / base.so).toFixed(3)} | ${(m.bb / base.bb).toFixed(3)} | ${(m.hr / base.hr).toFixed(3)} | ${(m.hit / base.hit).toFixed(3)} |`);
}
