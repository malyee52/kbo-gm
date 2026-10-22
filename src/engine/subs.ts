// AI 감독 경기 중 교체 (엔진 2 9단계, docs/경기엔진2_기획안.md 3.9): 대타, 대주자, 수비 재배치·대수비.
// 모두 정해진 규칙이라 난수를 쓰지 않는다. 기준값은 params.sub (임시값)
import { defenseAt } from './defense';
import type { GameState, Side } from './state';
import { fieldDefense, substitute } from './state';
import { assignSlots, batRunsVs, type Slot } from './team';
import type { SimPlayer } from './types';

/** 한 시즌 수비 이닝 (수비 런 → 이 경기 몫) */
const SEASON_INNINGS = 144 * 9;
/** 한 시즌 타석 (타격 런 → 타석 하나 몫) */
const SEASON_PA = 600;

/** 포수를 맡을 수 있는 선수 (수비 가능 목록 기준, defense.ts playablePositions의 −5런) */
const canCatch = (p: SimPlayer) => !p.isPitcher && defenseAt(p, 'C') >= -5;

/** 지금 벤치 (1군 야수 중 라인업에 없고 교체로 빠지지 않은 선수) */
export function benchOf(side: Side): SimPlayer[] {
  return side.ts.hitters.filter((p) => !p.isPitcher && !side.lineup.includes(p) && !side.removed.has(p.idx));
}

/**
 * 포수를 남기는 규칙 (기획안 3.9 "벤치에 포수 1명은 남김"): use를 out 대신 넣어도 되나.
 * 벤치의 마지막 포수는 포수를 바꿀 때만 쓰고, 포수를 빼면 대신 포수를 맡을 사람(use 또는 벤치 포수)이 남아야 한다
 */
function keepsCatcher(side: Side, out: SimPlayer | null, use: SimPlayer): boolean {
  const outIsCatcher = !!out && side.slots.get(out.idx) === 'C';
  const left = benchOf(side).filter((p) => p !== use && canCatch(p)).length;
  if (canCatch(use) && left === 0 && !outIsCatcher) return false;
  if (outIsCatcher && !canCatch(use) && left === 0) return false;
  return true;
}

/**
 * 대타 (7회 이후 접전): 상대 투수 기준 기대 타격이 지금 타자보다 높은 벤치 타자. 남은 타석의 이득에서 수비 손해(남은 이닝)를 빼
 * 기준(params.sub.phGain ÷ 감독 성향) 이상이면 바꾼다. 바꿀 선수가 없으면 null
 */
export function pickPinchHitter(st: GameState): SimPlayer | null {
  const { bat, fld, ctx } = st;
  const sp = ctx.params.sub;
  const lead = bat.runs - fld.runs;
  if (st.inning < sp.phInning || Math.abs(lead) > sp.phMaxDiff) return null;
  const cur = bat.lineup[bat.spot];
  const throws = fld.pitcher.p.throws;
  const slot = bat.slots.get(cur.idx);
  const innLeft = Math.max(0, 9 - st.inning);
  const pas = 1 + innLeft * 0.45;
  const curRuns = batRunsVs(cur, throws, ctx.params.platoon);
  const need = sp.phGain / (bat.ts.tactics?.sub ?? 1);
  let best: SimPlayer | null = null;
  let bestGain = need;
  for (const b of benchOf(bat)) {
    if (!keepsCatcher(bat, cur, b)) continue;
    const defLoss = slot && slot !== 'DH' ? Math.max(0, defenseAt(cur, slot) - defenseAt(b, slot)) * innLeft / SEASON_INNINGS : 0;
    const gain = (batRuns(b) - curRuns) * pas / SEASON_PA - defLoss;
    if (gain > bestGain) { bestGain = gain; best = b; }
  }
  return best;
  function batRuns(b: SimPlayer) { return batRunsVs(b, throws, ctx.params.platoon); }
}

/**
 * 대주자 (8회 이후 2점 차 이내): 느린 주자(주력 ≤ prSlow)가 누상에 있고, 벤치에 주력이 prGap(÷ 감독 성향) 이상 빠른 선수가 있으면.
 * 앞 베이스 주자부터 본다. 바꿀 [베이스, 선수]가 없으면 null
 */
export function pickPinchRunner(st: GameState): [0 | 1 | 2, SimPlayer] | null {
  const { bat, fld, ctx } = st;
  const sp = ctx.params.sub;
  if (st.inning < sp.prInning || Math.abs(bat.runs - fld.runs) > sp.prMaxDiff) return null;
  const gap = sp.prGap / (bat.ts.tactics?.sub ?? 1);
  for (const base of [2, 1, 0] as const) {
    const r = st.bases[base];
    if (!r || r.p.bat!.speed > sp.prSlow || !bat.lineup.includes(r.p)) continue;
    let best: SimPlayer | null = null;
    for (const b of benchOf(bat)) {
      if (b.bat!.speed < r.p.bat!.speed + gap || !keepsCatcher(bat, r.p, b)) continue;
      if (!best || b.bat!.speed > best.bat!.speed) best = b;
    }
    if (best) return [base, best];
  }
  return null;
}

/**
 * 수비 반 이닝을 시작할 때 (AI 감독): ① 대타·대주자가 들어왔으면 9명의 수비 위치를 다시 배정 (수비 런 합이 가장 큰 배정),
 * 포수 자리에 포수가 없으면 벤치 포수를 넣는다. ② 7회 이후 리드 중이면 수비 런이 defGain 넘게 나은 벤치 선수로 대수비 (반 이닝에 한 명).
 * 수비 위치는 지금 수비 모델(defense.ts)의 수비 런 안에서만 고른다
 */
export function aiDefense(st: GameState, fld: Side, bat: Side): void {
  const sp = st.ctx.params.sub;
  if (fld.realign) {
    fld.realign = false;
    realignSlots(fld);
    const atC = fld.lineup.find((p) => fld.slots.get(p.idx) === 'C');
    if (atC && !canCatch(atC)) {
      const c = benchOf(fld).filter(canCatch).sort((a, b) => defenseAt(b, 'C') - defenseAt(a, 'C'))[0];
      if (c) defSub(st, fld, atC, c, 'C');
    }
  }
  if (st.inning < sp.defInning || fld.runs <= bat.runs) return;
  let best: { out: SimPlayer; in: SimPlayer; slot: Slot; gain: number } | null = null;
  const bench = benchOf(fld);
  for (const p of fld.lineup) {
    const slot = fld.slots.get(p.idx);
    if (!slot || slot === 'DH') continue;
    const now = defenseAt(p, slot);
    for (const b of bench) {
      if (slot !== 'C' && canCatch(b) && bench.filter(canCatch).length <= 1) continue;
      const gain = defenseAt(b, slot) - now;
      if (gain >= sp.defGain && (!best || gain > best.gain)) best = { out: p, in: b, slot, gain };
    }
  }
  if (best) defSub(st, fld, best.out, best.in, best.slot);
}

/** 대수비 한 명: 나간 선수의 타순과 자리를 받는다 */
function defSub(st: GameState, side: Side, out: SimPlayer, inP: SimPlayer, slot: Slot): void {
  const order = side.lineup.indexOf(out);
  if (order < 0) return;
  substitute(side, order, inP, 'DEF');
  side.slots.set(inP.idx, slot);
  Object.assign(side, fieldDefense(side.lineup, side.slots));
  st.ctx.bat[inP.idx].g++;
  st.note('DEF', inP.idx, st.fld.pitcher.p.idx, st.bat.runs);
}

/** 지금 9명의 수비 위치를 수비 런 합이 가장 큰 배정으로 (지명타자 자리 포함) */
function realignSlots(side: Side): void {
  const placed = assignSlots(side.lineup, undefined, (p, slot) => defenseAt(p, slot));
  if (placed.length !== side.lineup.length) return;
  side.slots = new Map(placed.map(({ p, slot }) => [p.idx, slot]));
  Object.assign(side, fieldDefense(side.lineup, side.slots));
}
