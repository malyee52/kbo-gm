// 경기 상태 (두 해결기 공통): 이닝·아웃·주자와 책임 투수·점수·타순·수비 배치·마운드 투수·교체로 빠진 선수·승패 후보.
// 점수·아웃·중계 기록을 남기는 기본 동작도 여기에 둔다 (docs/경기엔진2_기획안.md 3.2).

import type { GameContext, Play, PlayKind } from './game';
import { defenseAt } from './defense';
import type { GamePark } from './pa';
import { assignSlots, type Slot, type TeamSeason } from './team';
import type { BatLine, PitLine, PitSkill, SimPlayer } from './types';

export interface PitcherInGame {
  p: SimPlayer;
  skill: PitSkill;
  line: PitLine;
  bf: number;
  runs: number;
  outs: number;
  limit: number;
  isStarter: boolean;
  /** 등판 시점의 점수 차 (자기 팀 기준) */
  enteredLead: number;
  /** 이 경기 자책점 (퀄리티 스타트 판정) */
  er: number;
  /** 이 등판에서 블론 세이브를 기록했나 */
  blown: boolean;
  /** 이 등판에서 던진 공 수 (투구 수를 세는 해결기만 채운다, 엔진 2 3단계) */
  pitches: number;
}

export interface Runner {
  p: SimPlayer;
  resp: PitcherInGame;
  earned: boolean;
}

/** 경기 중 교체로 들어온 타자 (직접 지휘의 대타·대주자) */
export interface GameSub {
  idx: number;
  /** 타순 자리 (0~8) */
  order: number;
  kind: 'PH' | 'PR';
}

export interface Side {
  ts: TeamSeason;
  lineup: SimPlayer[];
  spot: number;
  runs: number;
  pitcher: PitcherInGame;
  staff: PitcherInGame[];
  usedIdx: Set<number>;
  isHome: boolean;
  /** 라인업 가치의 중앙값 (희생번트를 누가 대는지 정할 때 쓴다) */
  medianValue: number;
  /** 수비 8명의 수비 런 합 (defense.ts) */
  def: number;
  /** 포수의 수비 런 */
  catcherDef: number;
  /** 실책 배율 (수비수별 실책률을 타구 몫으로 가중한 합, 평균 수비진 ≈ 1) */
  errMult: number;
  /** 실책이 났을 때 누가 했나 고르는 몫 (선수 색인, 타구 몫 × 실책률) */
  errBy: { idx: number; w: number }[];
  /** 교체로 빠진 선수 (다시 나올 수 없다) */
  removed: Set<number>;
  /** 지금 수비 위치 (선수 색인 → 자리). 대타·대주자는 바꾼 선수의 자리를 그대로 받는다 */
  slots: Map<number, Slot>;
  /** 경기 중 들어온 타자 (박스스코어: 타순 자리, 대타·대주자) */
  subs: GameSub[];
}

/** 선발 라인업의 수비 위치 (선수 색인 → 자리) */
export function fieldSlots(ts: TeamSeason, lineup: SimPlayer[]): Map<number, Slot> {
  const slots = ts.field && lineup.every((p) => ts.field!.has(p.idx))
    ? lineup.map((p) => ({ p, slot: ts.field!.get(p.idx)! }))
    : assignSlots(lineup);
  return new Map(slots.map(({ p, slot }) => [p.idx, slot]));
}

/**
 * 실책 날 타구가 그 자리로 가는 몫 (실책 출루 기준, 임시값): 내야 땅볼·송구가 대부분, 1루는 송구를 받는 쪽이라 적다.
 * 2026-10-13 사용자 "수비 능력치에 따른 실책 비율": 전에는 팀 수비 합으로만 실책 출루 확률을 줄였다
 */
const ERROR_SHARE: Partial<Record<Slot, number>> = { SS: 0.2, '3B': 0.17, '2B': 0.17, '1B': 0.12, C: 0.04, LF: 0.1, CF: 0.1, RF: 0.1 };
/** 수비 1런당 실책률 변화 (지수, 임시값): +10런이면 0.64배, −10런이면 1.57배 (실제 리그 정상급 유격수 한 해 실책 10개 안팎 ↔ 약한 수비 20개 넘음) */
const ERROR_PER_RUN = 0.045;
export const errorRateOf = (runs: number) => Math.min(2.5, Math.max(0.4, Math.exp(-ERROR_PER_RUN * runs)));
/** 리그 실책 수를 예전(팀 수비 합 방식)과 같게 맞추는 배율 (2025 두 시드로 잼: 수비수별로 바꾸니 약 8% 많았다) */
const ERROR_NORM = 0.93;

/** 수비 배치에서 팀 수비 런, 포수 수비 런, 실책 배율 */
export function fieldDefense(lineup: SimPlayer[], slots: Map<number, Slot>): { def: number; catcherDef: number; errMult: number; errBy: { idx: number; w: number }[] } {
  let def = 0;
  let catcherDef = 0;
  let errMult = 0;
  const errBy: { idx: number; w: number }[] = [];
  for (const p of lineup) {
    const slot = slots.get(p.idx);
    if (!slot) continue;
    const r = defenseAt(p, slot);
    def += r;
    if (slot === 'C') catcherDef = r;
    const share = ERROR_SHARE[slot] ?? 0;
    if (share > 0) {
      const w = share * errorRateOf(r);
      errMult += w;
      errBy.push({ idx: p.idx, w });
    }
  }
  return { def, catcherDef, errMult: (errMult || 1) * ERROR_NORM, errBy };
}

/**
 * 대타·대주자: 타순 order 자리의 선수를 바꾼다. 들어온 선수는 나간 선수의 수비 자리를 맡고(포수 자리에 포수가 아니면 수비력이 떨어진다),
 * 다음 수비부터 팀 수비력에 반영된다 (2026-10-12 직접 지휘 마무리)
 */
export function substitute(side: Side, order: number, inP: SimPlayer, kind: 'PH' | 'PR'): void {
  const outP = side.lineup[order];
  const slot = side.slots.get(outP.idx);
  side.lineup[order] = inP;
  side.removed.add(outP.idx);
  side.slots.delete(outP.idx);
  if (slot) side.slots.set(inP.idx, slot);
  Object.assign(side, fieldDefense(side.lineup, side.slots));
  side.subs.push({ idx: inP.idx, order, kind });
}

/** 한 경기의 상태. 반 이닝 상태(inning·bat·fld·outs·bases)는 반 이닝을 시작할 때 startHalf로 바꾼다 */
export class GameState {
  readonly ctx: GameContext;
  readonly home: Side;
  readonly away: Side;
  readonly park: GamePark;
  /** 승리·패전 후보: 리드를 잡은 시점의 투수와 그 점수를 내준 투수. 동점이 되면 지운다 */
  readonly rec: { win: PitcherInGame | null; loss: PitcherInGame | null; leader: Side | null } = { win: null, loss: null, leader: null };
  /** 2아웃에서 실책이 나오면 그 이닝의 이후 실점은 비자책 */
  halfUnearned = false;
  /** 직접 지휘 물음 번호 */
  cmdN = 0;

  inning = 0;
  bat!: Side;
  fld!: Side;
  outs = 0;
  bases: (Runner | null)[] = [null, null, null];
  /** 이번 반 이닝 시작 때 공격 팀 점수 */
  runsAtStart = 0;
  /** 마지막 실책(E)을 한 수비수 (중계 기록용) */
  errFielder = -1;

  constructor(ctx: GameContext, home: Side, away: Side, park: GamePark) {
    this.ctx = ctx;
    this.home = home;
    this.away = away;
    this.park = park;
  }

  startHalf(bat: Side, fld: Side, inning: number): void {
    this.bat = bat;
    this.fld = fld;
    this.inning = inning;
    this.outs = 0;
    this.runsAtStart = bat.runs;
    this.halfUnearned = false;
    this.bases = [null, null, null];
    this.errFielder = -1;
  }

  get basesEmpty(): boolean {
    return !this.bases[0] && !this.bases[1] && !this.bases[2];
  }

  baseIdx(): [number, number, number] {
    const b = this.bases;
    return [b[0]?.p.idx ?? -1, b[1]?.p.idx ?? -1, b[2]?.p.idx ?? -1];
  }

  /** 홈 팀 말 공격 9회 이후 앞서면 끝내기 */
  walkOff(): boolean {
    return this.bat.isHome && this.inning >= 9 && this.bat.runs > this.fld.runs;
  }

  out(n: number): void {
    this.outs += n;
    const pg = this.fld.pitcher;
    pg.outs += n;
    pg.line.outs += n;
    this.ctx.totals.outs += n;
  }

  /** 주자 한 명 득점. batterLine이 있으면 타점 */
  score(runner: Runner, batterLine: BatLine | null): void {
    const { bat, fld, ctx, rec } = this;
    const before = bat.runs - fld.runs;
    bat.runs++;
    ctx.totals.r++;
    ctx.bat[runner.p.idx].r++;
    if (batterLine) batterLine.rbi++;
    runner.resp.runs++;
    runner.resp.line.r++;
    if (runner.earned && !this.halfUnearned && !ctx.rng.chance(ctx.env.unearnedRun)) {
      runner.resp.line.er++;
      runner.resp.er++;
      ctx.totals.er++;
    }
    const after = before + 1;
    // 블론 세이브: 세이브 상황(1~3점 리드)에 나온 구원 투수가 마운드에 있을 때 리드가 사라지면. 승리 투수가 될 수는 있다
    const cur = fld.pitcher;
    if (before === -1 && !cur.isStarter && !cur.blown && cur.enteredLead >= 1 && cur.enteredLead <= 3) {
      cur.blown = true;
      cur.line.bsv++;
    }
    if (before <= 0 && after > 0) {
      rec.win = bat.pitcher;
      rec.loss = runner.resp;
      rec.leader = bat;
    } else if (after === 0) {
      rec.win = null;
      rec.loss = null;
      rec.leader = null;
    }
  }

  /** 중계 기록 한 줄 (ctx.plays가 있을 때만). r0: 플레이 전 공격 팀 점수 */
  note(kind: PlayKind, who: number, pit: number, r0: number): void {
    const plays = this.ctx.plays;
    if (!plays) return;
    const play: Play = {
      inn: this.inning, top: !this.bat.isHome, kind, bat: who, pit, outs: Math.min(3, this.outs),
      bases: this.baseIdx(), away: this.away.runs, home: this.home.runs, runs: this.bat.runs - r0,
      ...(kind === 'E' && this.errFielder >= 0 ? { fielder: this.errFielder } : {}),
    };
    plays.push(play);
  }
}
