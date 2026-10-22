// AI 감독 판단 (공통 규칙 계층, 타석 경계에서): 투수 등판·교체, 구원 투수 고르기.

import type { GameContext } from './game';
import type { PitcherInGame, Side } from './state';
import { isStarterSkill } from './params';
import { currentFatigue, FATIGUE_AVAILABLE_BELOW, needsRest } from './team';
import type { SimPlayer } from './types';
import { lengthOf } from './pa';

const STARTER_LIMIT_SCALE = 1.15;
/** 어제 던진 필승조를 오늘 아낄 확률 (임시값, 상위 구원 투수 시즌 등판 80경기 안팎에 맞춤) */
const SPARE_YESTERDAY = 0.4;
/** 직접 정한 롱릴리프가 이른 이닝에 나왔을 때 한계 투구 수 배율 (임시값) */
const LONG_RELIEF_STRETCH = 1.6;

export function enterPitcher(p: SimPlayer, isStarter: boolean, lead: number, ctx: GameContext): PitcherInGame {
  const skill = p.pit!;
  const line = ctx.pit[p.idx];
  line.g++;
  if (isStarter) line.gs++;
  // 한계 투구 수 (엔진 2 4단계): 기록으로 추정한 체력(타자 수)에 이 투수의 타석당 기대 투구 수를 곱한다. 기대 투구 수는 리그 평균 타자를
  // 상대할 때의 볼카운트 사슬 값이라 삼진·볼넷이 많은 투수는 같은 체력이어도 상대 타자가 적다 (선수별 P/PA 자료는 D단계에서)
  // 선발 몸 한계는 체력보다 조금 길게 (STARTER_LIMIT_SCALE 1.15, 임시값: 체력 추정이 평균 쪽으로 당겨져 있고, 감독 기준과 함께 2025 선발 투구 수·QS에 맞춤).
  // 몸의 한계(limit)는 그날 몸 상태(0.82~1.18배)를 곱한 값이다. AI 감독은 투수의 한계를 보지 않고 자기 투구 수 기준(plan)으로만
  // 바꾼다 (사용자 결정 2026-10-22: 감독이 보는 한계는 감독 성향으로만. 성향 hook은 game.ts에서 곱한다)
  const lg = ctx.league;
  const ppa = ctx.resolver?.pitchesPerPa?.(skill.so * lg.so, skill.bb * lg.bb, skill.hbp * lg.hbp,
    lengthOf(ctx, skill.ppaRel, skill.so * lg.so, skill.bb * lg.bb, skill.hbp * lg.hbp)) ?? ctx.params.pitchesPerPaDefault;
  const base = (isStarter ? skill.stamina * STARTER_LIMIT_SCALE * (ctx.startLimitScale ?? 1) : skill.reliefStint) * ppa;
  const limit = base * ctx.rng.range(0.82, 1.18);
  const sp = ctx.params.planScale.spread;
  const plan = ctx.planNorms ? (isStarter ? ctx.planNorms.starter : ctx.planNorms.relief) * ctx.rng.range(1 - sp, 1 + sp) : base;
  return { p, skill, line, bf: 0, runs: 0, outs: 0, limit, plan, isStarter, enteredLead: lead, er: 0, blown: false, pitches: 0, ppa };
}

/**
 * AI 감독의 투구 수 기준 (선발, 구원): 그 시즌 리그 평균 투수(기록 표본 가중)의 한계 투구 수(몸 상태 뺀 값) × planScale.
 * 시대마다 숫자를 따로 정하지 않고 그 시대 투수들의 체력에서 나온다 (옛 시대는 eras.ts limitScale로 길다). 난수를 쓰지 않는다
 */
export function managerNorms(players: readonly SimPlayer[], ctx: GameContext): { starter: number; relief: number } {
  const lg = ctx.league;
  let ws = 0, ss = 0, wr = 0, sr = 0;
  for (const p of players) {
    const k = p.pit;
    if (!p.isPitcher || !k || !(k.sample > 0)) continue;
    const ppa = ctx.resolver?.pitchesPerPa?.(k.so * lg.so, k.bb * lg.bb, k.hbp * lg.hbp) ?? ctx.params.pitchesPerPaDefault;
    if (isStarterSkill(k)) { ws += k.sample; ss += k.sample * k.stamina * ppa; } else { wr += k.sample; sr += k.sample * k.reliefStint * ppa; }
  }
  const sc = ctx.params.planScale;
  return {
    starter: (ws ? ss / ws : 22 * ctx.params.pitchesPerPaDefault) * STARTER_LIMIT_SCALE * (ctx.startLimitScale ?? 1) * sc.starter,
    relief: (wr ? sr / wr : 5 * ctx.params.pitchesPerPaDefault) * sc.relief,
  };
}

/** 쓸 수 있는 구원 투수: 이번 경기에 안 나왔고, 쉴 만큼 쉬었고, 3연투가 아닌 투수 */
export function availableRelievers(fld: Side, ctx: GameContext): SimPlayer[] {
  const st = ctx.states;
  return fld.ts.bullpen.filter((p) => !fld.usedIdx.has(p.idx)
    && currentFatigue(st, p.idx, ctx.day) < FATIGUE_AVAILABLE_BELOW && !needsRest(st, p.idx, ctx.day));
}

/**
 * 불펜 서열 (2026-10-22, docs/하드힛_현실감_기획안.md 2.1). 개막에는 지난 시즌 실제 쓰임 순(penTrust 큰 순, 쓰임을 모르는 투수는 그 뒤에 능력 순),
 * blendDays가 지나면 능력 순. 그 사이는 두 순위를 날짜 비율로 섞는다. 난수를 쓰지 않는다
 */
export function bullpenOrder(pen: SimPlayer[], day: number, blendDays: number): SimPlayer[] {
  const byValue = [...pen].sort((a, b) => a.value - b.value);
  const w = blendDays > 0 ? Math.min(1, Math.max(0, day / blendDays)) : 1;
  if (w >= 1 || !pen.some((p) => p.penTrust)) return byValue;
  const byTrust = [...byValue].sort((a, b) => (b.penTrust ?? 0) - (a.penTrust ?? 0));
  const key = new Map(pen.map((p) => [p, (1 - w) * byTrust.indexOf(p) + w * byValue.indexOf(p)]));
  return byValue.sort((a, b) => key.get(a)! - key.get(b)! || a.value - b.value);
}

/**
 * 구원 투수 고르기 (2026-10-08 사용자 지적 "투수 교체가 비현실적"으로 다시 짬).
 * 역할: 마무리, 필승조(SU), 추격조(역할 없음), 롱릴리프(LR), 패전조(MOP).
 * 플레이어가 기용표에서 불펜 역할을 정했으면 그대로(2026-10-12), 아니면 불펜을 좋은 순으로 줄 세워
 * 좋은 순 1·2번째를 필승조(8회·7회 셋업), 나머지를 추격조로 본다 (롱릴리프는 그중 가장 길게 던지는 투수).
 * 역할 나누기와 점수 차 기준은 임시값.
 */
function pickReliever(fld: Side, lead: number, inning: number, ctx: GameContext): SimPlayer | null {
  const { ts } = fld;
  const st = ctx.states;
  const pool = availableRelievers(fld, ctx);
  if (pool.length === 0) {
    // 쉴 만큼 쉰 투수가 없으면 덜 지친 투수부터 (3연투는 마지막까지 미룬다)
    const rest = ts.bullpen.filter((p) => !fld.usedIdx.has(p.idx));
    if (rest.length === 0) return null;
    const cost = (p: SimPlayer) => currentFatigue(st, p.idx, ctx.day) + (needsRest(st, p.idx, ctx.day) ? 100 : 0);
    return rest.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  }
  const closer = ts.closer;
  const closerOk = !!closer && pool.includes(closer);
  // 마무리: 9회 이후 3점 차 이내 리드, 또는 9회 이후 동점(홈은 끝내기를 기다리며, 원정은 연장)
  if (closerOk && inning >= 9 && lead >= 0 && lead <= 3) return closer;
  // 불펜 서열 (마무리는 빼고): 능력 순(value가 낮을수록 좋다)과 지난 시즌 실제 쓰임 순(penTrust)을 날짜에 따라 섞는다
  const order = bullpenOrder(ts.bullpen.filter((p) => p !== closer), ctx.day, ctx.params.penBlendDays);
  const avail = order.filter((p) => pool.includes(p));
  if (avail.length === 0) return closerOk ? closer : null;
  const rank = (p: SimPlayer) => order.indexOf(p);
  // 역할: 직접 정한 기용표에 있으면 그것. 역할을 하나라도 정했으면 나머지는 추격조, 아무것도 안 정했으면 서열 1·2번째가 필승조
  const pen = ts.manual && ts.plan?.pen && Object.keys(ts.plan.pen).length ? ts.plan.pen : null;
  const role = (p: SimPlayer): 'SU' | 'LR' | 'MOP' | 'MR' => (pen ? pen[p.idx] ?? 'MR' : rank(p) < 2 ? 'SU' : 'MR');
  const of = (...rs: string[]) => avail.filter((p) => rs.includes(role(p)));
  const close = lead >= -2 && lead <= 3; // 이기고 있거나 근소하게 지는 접전
  const late = inning >= 7;
  if (late && close && lead >= 0) {
    // 필승조: 8회 이후는 1번 셋업, 7회는 2번 셋업부터. 필승조가 다 지쳤으면 추격조 → 롱릴리프 → 패전조
    // 필승조 안의 순서는 지친 투수까지 포함한 서열 (7회에 1번 셋업이 지쳐 있어도 2번 셋업부터 쓰는 것은 같다)
    const suAll = order.filter((p) => role(p) === 'SU');
    const want = inning >= 8 ? 0 : 1;
    const su = of('SU');
    const main = [...su.filter((p) => suAll.indexOf(p) >= want), ...of('MR'), ...of('LR'), ...of('MOP')];
    const list = main.length ? main : su;
    // 어제 던졌으면 확률적으로 아끼고 다음 투수를 쓴다
    const pick = list.find((p) => st.fatigueDay[p.idx] !== ctx.day - 1 || !ctx.rng.chance(SPARE_YESTERDAY));
    return pick ?? list[0];
  }
  if (late && close) {
    // 근소하게 지는 후반: 필승조는 아끼고 추격조부터
    return of('MR')[0] ?? of('LR')[0] ?? of('MOP')[0] ?? avail[avail.length - 1];
  }
  if (inning <= 5) {
    // 이른 강판: 롱릴리프. 정하지 않았으면 필승조를 뺀 투수 중 가장 길게 던질 투수
    const lr = of('LR');
    const cands = lr.length ? lr : of('MR', 'MOP').length ? of('MR', 'MOP') : avail;
    return cands.reduce((a, b) => (b.pit!.reliefStint > a.pit!.reliefStint ? b : a));
  }
  // 점수 차가 큰 경기나 중반: 패전조. 정하지 않았으면 필승조를 빼고 아래쪽에서 고른다
  const mop = of('MOP');
  const cands = mop.length ? mop : of('MR', 'LR').length ? of('MR', 'LR') : avail;
  return cands[ctx.rng.int(cands.length)];
}

/** 새 투수를 마운드에 올린다 (등판 기록과 경기 투수 명단) */
export function bringIn(fld: Side, p: SimPlayer, lead: number, ctx: GameContext): PitcherInGame {
  fld.usedIdx.add(p.idx);
  fld.pitcher = enterPitcher(p, false, lead, ctx);
  fld.staff.push(fld.pitcher);
  return fld.pitcher;
}

/**
 * 투수 교체 판단. 타석마다 부르지만, 감독처럼 이닝 시작에 바꾸는 것이 기본이다.
 * 이닝 중간에는 한계를 크게 넘었거나 이번 이닝에 무너질 때만 바꾼다. 기준값은 임시값 (실제 2025 KBO의 선발 이닝·구원 이닝에 맞춤).
 * 엔진 2 4단계부터 투구 수로 판단한다: 엔진 1의 "타자 k명" 여유는 "이 투수의 타석당 기대 투구 수 × k"구로 옮겼다 (u).
 * start: 반 이닝의 첫 타석. halfRuns: 이번 반 이닝에 내준 점수
 */
export function maybeChangePitcher(fld: Side, bat: Side, inning: number, basesEmpty: boolean, start: boolean, halfRuns: number, ctx: GameContext): void {
  const pg = fld.pitcher;
  const np = pg.pitches;
  const u = pg.ppa;
  const lead = fld.runs - bat.runs;
  const closer = fld.ts.closer;
  let pull = false;
  if (pg.isStarter) {
    if (start) {
      // 이닝 시작: 한 이닝을 더 못 버티거나, 이미 많이 내줬으면 내린다
      pull = np + 2 * u >= pg.plan || pg.runs >= 6 || (pg.runs >= 5 && inning <= 4);
    } else {
      pull = np >= pg.plan + 4 * u // 한계를 크게 넘김
        || (np >= pg.plan && !basesEmpty) // 한계를 넘긴 뒤 주자를 내보냄
        || pg.runs >= 7
        || (halfRuns >= 3 && !basesEmpty && (pg.runs >= 4 || np >= pg.plan - 3 * u)) // 이번 이닝 무너짐
        || (pg.runs >= 5 && inning <= 3 && !basesEmpty); // 초반 대량 실점
    }
  } else if (pg.p === closer) {
    // 마무리는 경기를 끝내게 둔다. 크게 흔들릴 때만
    pull = !start && (pg.runs >= 3 || np >= pg.plan + 4 * u);
  } else if (start) {
    // 구원: 다음 이닝(타자 약 4명)을 맡기에 모자라면 이닝 시작에 바꾼다
    pull = np + 3 * u >= pg.plan || pg.runs >= 3;
  } else {
    pull = pg.runs >= 3 || np >= pg.plan + 3 * u || (halfRuns >= 2 && !basesEmpty && Math.abs(lead) <= 2 && inning >= 7);
  }
  // 9회 세이브 상황에서 마무리가 쉬었으면 이닝 시작에 마무리로
  if (!pull && start && inning >= 9 && lead >= 1 && lead <= 3 && closer && pg.p !== closer && availableRelievers(fld, ctx).includes(closer)) pull = true;
  if (!pull) return;
  const next = pickReliever(fld, lead, inning, ctx);
  if (!next) return;
  bringIn(fld, next, lead, ctx);
  // 이른 이닝에 나온 구원(롱릴리프)은 감독 기준보다 길게 맡긴다
  if (inning <= 5 && ctx.planNorms) fld.pitcher.plan *= ctx.params.planScale.earlyRelief;
  // 직접 정한 롱릴리프가 이른 이닝에 나오면 평소보다 길게 맡긴다 (임시값). AI 감독 배치에는 쓰지 않는다
  if (inning <= 6 && fld.ts.manual && fld.ts.plan?.pen?.[next.idx] === 'LR') fld.pitcher.plan *= LONG_RELIEF_STRETCH;
}
