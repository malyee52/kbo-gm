// 경기 상태 (두 해결기 공통): 이닝·아웃·주자와 책임 투수·점수·타순·수비 배치·마운드 투수·교체로 빠진 선수·승패 후보.
// 점수·아웃·중계 기록을 남기는 기본 동작도 여기에 둔다 (docs/경기엔진2_기획안.md 3.2).

import type { CommandMode, GameCommand, GameContext, Play, PlayKind } from './game';
import { defenseAt } from './defense';
import { CATCHER_ARM_FLOOR } from './fielding';
import { tallyBlown } from './manager';
import type { GamePark } from './pa';
import type { AimMemory } from './arsenal';
import type { Rng } from './rng';
import { assignSlots, type Slot, type TeamSeason } from './team';
import type { BatLine, PitLine, PitSkill, SimPlayer } from './types';

export interface PitcherInGame {
  p: SimPlayer;
  skill: PitSkill;
  line: PitLine;
  bf: number;
  runs: number;
  outs: number;
  /** 그날 몸의 한계 투구 수 (공 수). 넘기면 능력이 꺾인다 (pa.ts). AI 감독은 이 값을 모른다 */
  limit: number;
  /** 실제 한계 투구 수 (숨은 능력, 기획안 4.6): 넘긴 공은 부상 확률을 올리고 혹사지수를 쌓는다. AI 감독은 모른다 */
  realLimit: number;
  /** 등판 때 혹사지수 (경기 중 부상 확률 배율, 엔진 2 11단계) */
  overuse: number;
  /** 경기 중 부상을 마지막으로 따진 때의 투구 수 (그 뒤 던진 공만 다음에 따진다) */
  injChecked: number;
  /** 경기 중 다쳤다: 다음 타석 전에 바꾼다 */
  injured?: boolean;
  /** 이 등판에서 플레이어가 지시한 공 (구종·코스 쏠림, 예측 손해, arsenal.ts, 엔진 2 20-4단계). 지시한 적이 없으면 없다 */
  aim?: AimMemory;
  /** AI 감독이 보는 한계 투구 수: 보이는 체력 × 타석당 기대 투구 수 (그날의 몸 상태는 모른다), 감독 성향(hook)·시대 상한을 넣은 값. 교체 판단에 쓴다 */
  plan: number;
  isStarter: boolean;
  /** 등판 시점의 점수 차 (자기 팀 기준) */
  enteredLead: number;
  /** 세이브 상황에 등판했나 (isSaveSituation). 세이브·홀드·블론 세이브 기록에 쓴다 */
  saveSit: boolean;
  /** 이 경기 자책점 (퀄리티 스타트 판정) */
  er: number;
  /** 이 등판에서 블론 세이브를 기록했나 */
  blown: boolean;
  /** 이 등판에서 던진 공 수 (엔진 2 3단계) */
  pitches: number;
  /** 이 투수의 타석당 기대 투구 수 (리그 평균 타자 상대, 볼카운트 사슬에서). 타자 수로 정한 체력·교체 기준을 공 수로 바꿀 때 쓴다 */
  ppa: number;
  /** 구원 등판한 회 (블론 기록 BLOWN_FROM_INNING, 엔진 2 10단계) */
  entryInning?: number;
  /** 등판 때 동점 주자가 누상·타석·대기 타석에 있었나 (세이브 조건 ②, 이닝 수와 관계없이. 엔진 2 14단계) */
  tyingNear?: boolean;
  /** 마운드를 내려갈 때 우리 팀 리드 (홀드 판정, 엔진 2 14단계). 경기를 끝낸 투수는 없다 */
  exitLead?: number;
  /** 좌우 원포인트로 올라왔다 (엔진 2 10단계): 맡은 좌타자 뒤 다음 타자가 좌타가 아니면 바꾼다 */
  onePoint?: boolean;
  /** 세이브 상황 등판 집계 칸 (검증 도구 ctx.pen이 있을 때만, manager.ts tallySaveEntry) */
  entryKey?: string;
  entryTired?: boolean;
  entryRunners?: number;
}

/**
 * 세이브 상황의 등판 조건 (기록 규정 ①②, 2026-10-22 사용자 결정): 1~3점 리드, 또는 4점 이상 앞서도 동점 주자가 누상·타석·대기 타석에 있을 때
 * (리드 ≤ 누상 주자 + 2). 기록에만 쓰고 경기 진행에는 쓰지 않는다
 */
export const isSaveSituation = (lead: number, runners: number): boolean => lead >= 1 && (lead <= 3 || lead <= runners + 2);

/** 동점 주자가 누상·타석·대기 타석에 있다 (리드 ≤ 누상 주자 + 2). 세이브 조건 ②: 이 상황에 나왔으면 아웃 하나로도 세이브 */
export const tyingRunNear = (lead: number, runners: number): boolean => lead >= 1 && lead <= runners + 2;

/**
 * 세이브 (기록 규정, 엔진 2 14단계): 이긴 팀의 마지막 투수가 승리 투수가 아니고 아웃을 하나 이상 잡았으며,
 * ① 3점 이하 리드에 나와 1이닝 이상 던졌거나 ② 동점 주자가 누상·타석·대기 타석일 때 나왔거나 ③ 3이닝 이상 던졌을 때.
 * 리드는 끝까지 지켰다고 본다 (잃었다가 다시 앞서면 그 투수가 승리 투수가 된다). ③의 "효과적으로"는 판정하지 않는다
 */
export function earnsSave(pg: Pick<PitcherInGame, 'isStarter' | 'saveSit' | 'tyingNear' | 'enteredLead' | 'outs'>): boolean {
  if (pg.isStarter || pg.outs < 1) return false;
  if (pg.outs >= 9) return true;
  if (!pg.saveSit) return false;
  return !!pg.tyingNear || (pg.enteredLead <= 3 && pg.outs >= 3);
}

/**
 * 블론 세이브를 기록하는 등판 회 (엔진 2 10단계): 이 회 이후 세이브 상황에 나온 투수만 리드를 잃으면 블론으로 센다.
 * 근거: 투구 단위 자료(2023~2025)에서 세이브 상황 구원 등판이 리드를 잃은 수 가운데 7회 이후 등판분이 하드힛 블론 합과 세 해 모두 정확히 같다
 * (2023 183 · 2024 199 · 2025 185, tools/pbp_saves.py). KBO 규정 문구로는 확인하지 못했다 (조사값). 6회 이전 등판이 리드를 잃어도 홀드는 받지 못한다
 */
export const BLOWN_FROM_INNING = 7;

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
  /** 대타, 대주자, 대수비 (엔진 2 9단계) */
  kind: 'PH' | 'PR' | 'DEF';
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
  /** 자리별 수비 런 (defense.ts). 타구 모형(battedball.ts)이 그 타구를 맡은 수비수의 값을 쓴다 */
  slotDef: Partial<Record<Slot, number>>;
  /** 포수의 수비 런 (폭투·포일) */
  catcherDef: number;
  /** 포수의 도루 저지 (런, 능력치 v2 16-3 BatSkill.cArm). 예전 수비(cArm·playable 없음)면 포수 수비 런과 같다 */
  catcherArm: number;
  /** 수비 영점 (런 = (m − 50) ÷ 2, LeagueEnv.defZero). 자리별 수비 런에서 뺀다 */
  defZero: number;
  /** 교체로 빠진 선수 (다시 나올 수 없다) */
  removed: Set<number>;
  /** 지금 수비 위치 (선수 색인 → 자리). 대타·대주자는 바꾼 선수의 자리를 그대로 받는다 */
  slots: Map<number, Slot>;
  /** 경기 중 들어온 타자 (박스스코어: 타순 자리, 대타·대주자) */
  subs: GameSub[];
  /** 대타·대주자가 들어와 다음 수비 때 수비 위치를 다시 정해야 한다 (AI 감독, subs.ts aiDefense) */
  realign?: boolean;
  /** 선발 출전 선수와 시작 수비 위치 (경기 뒤 야수 피로, 엔진 2 11단계) */
  starters: { p: SimPlayer; slot: Slot | undefined }[];
}

/** 선발 라인업의 수비 위치 (선수 색인 → 자리) */
export function fieldSlots(ts: TeamSeason, lineup: SimPlayer[]): Map<number, Slot> {
  const slots = ts.field && lineup.every((p) => ts.field!.has(p.idx))
    ? lineup.map((p) => ({ p, slot: ts.field!.get(p.idx)! }))
    : assignSlots(lineup);
  return new Map(slots.map(({ p, slot }) => [p.idx, slot]));
}

/**
 * 2026-10-13 사용자 "수비 능력치에 따른 실책 비율". 엔진 2 7단계부터 실책은 타구를 맡은 수비수가 이 실책률로 한다 (rules.ts, params.error).
 * 수비 1런당 실책률 변화 (지수, 임시값): +10런이면 0.64배, −10런이면 1.57배 (실제 리그 정상급 유격수 한 해 실책 10개 안팎 ↔ 약한 수비 20개 넘음) */
const ERROR_PER_RUN = 0.045;
export const errorRateOf = (runs: number) => Math.min(2.5, Math.max(0.4, Math.exp(-ERROR_PER_RUN * runs)));

/**
 * 수비 배치에서 자리별 수비 런, 포수 수비 런·도루 저지. zero: 수비 영점 (런, Side.defZero) — 리그 평균 수비가 0이 되게 뺀다 (능력치 v2 13.6).
 * 포수 도루 저지는 v2 선수면 cArm (없으면 수비 가능 포수 0, 아니면 바닥 CATCHER_ARM_FLOOR), 예전 수비면 포수 수비 런
 */
export function fieldDefense(lineup: SimPlayer[], slots: Map<number, Slot>, zero = 0): { slotDef: Partial<Record<Slot, number>>; catcherDef: number; catcherArm: number } {
  const slotDef: Partial<Record<Slot, number>> = {};
  let catcherDef = 0;
  let catcherArm = 0;
  for (const p of lineup) {
    const slot = slots.get(p.idx);
    if (!slot) continue;
    const r = defenseAt(p, slot) - (slot === 'DH' ? 0 : zero);
    slotDef[slot] = r;
    if (slot === 'C') {
      catcherDef = r;
      const b = p.bat;
      catcherArm = b?.cArm ?? (b?.playable ? (b.playable.includes('C') ? 0 : CATCHER_ARM_FLOOR) : r);
    }
  }
  return { slotDef, catcherDef, catcherArm };
}

/** 그 자리를 맡은 수비수의 선수 색인 (투수는 지금 마운드의 투수). 없으면 −1 */
export function fielderAt(side: Side, slot: Slot | 'P'): number {
  if (slot === 'P') return side.pitcher.p.idx;
  for (const [idx, s] of side.slots) if (s === slot) return idx;
  return -1;
}

/**
 * 대타·대주자: 타순 order 자리의 선수를 바꾼다. 들어온 선수는 나간 선수의 수비 자리를 맡고(포수 자리에 포수가 아니면 수비력이 떨어진다),
 * 다음 수비부터 팀 수비력에 반영된다 (2026-10-12 직접 지휘 마무리)
 */
export function substitute(side: Side, order: number, inP: SimPlayer, kind: GameSub['kind']): void {
  const outP = side.lineup[order];
  const slot = side.slots.get(outP.idx);
  side.lineup[order] = inP;
  side.removed.add(outP.idx);
  side.slots.delete(outP.idx);
  if (slot) side.slots.set(inP.idx, slot);
  Object.assign(side, fieldDefense(side.lineup, side.slots, side.defZero));
  side.subs.push({ idx: inP.idx, order, kind });
  if (kind !== 'DEF') side.realign = true;
}

/** 한 경기의 상태. 반 이닝 상태(inning·bat·fld·outs·bases)는 반 이닝을 시작할 때 startHalf로 바꾼다 */
export class GameState {
  readonly ctx: GameContext;
  readonly home: Side;
  readonly away: Side;
  readonly park: GamePark;
  /** 승리·패전 후보: 리드를 잡은 시점의 투수와 그 점수를 내준 투수. 동점이 되면 지운다 */
  readonly rec: { win: PitcherInGame | null; loss: PitcherInGame | null; leader: Side | null } = { win: null, loss: null, leader: null };
  /**
   * 이번 반 이닝의 실책 출루 수 (엔진 2 7단계, 자책 판정): 실책을 아웃으로 친 아웃 수(outs + errOuts)가 3이 된 뒤의 실점은 비자책.
   * 예전 "2아웃 실책 뒤 그 이닝 실점은 비자책"을 1·0아웃 실책까지 넓혔다
   */
  errOuts = 0;
  /** 이번 타석에 수비 팀이 전진 수비를 했나 (AI 감독, 엔진 2 10단계). 타석마다 game.ts가 정한다 */
  infieldIn = false;
  /** 직접 지휘 물음 번호 */
  cmdN = 0;
  /** 끼어들기를 기다리는 지휘 (엔진 2 18단계, CommandMode.takeover): 있으면 지휘 없이 진행하며 타석 경계마다 묻는다. k = 다음 타석 경계 번호 */
  cmdWatch: { cmd: GameCommand; takeover: NonNullable<CommandMode['takeover']>; k: number } | null = null;
  /** A → B 넘기기 물음 번호 (CommandMode.handoff, 없으면 −1) */
  cmdHandoff = -1;
  /** 이번 타석 인플레이 타구를 맡은 수비 자리 (없으면 null). 경기 중 수비 부상에 쓴다 (엔진 2 11단계) */
  ballSlot: Slot | 'P' | null = null;
  /** 구종·코스를 붙이는 난수 줄기 (A 해결기, 엔진 2 20단계): 경기 줄기와 따로라 지시 없는 공의 결과는 구종을 넣기 전과 같다. 처음 쓸 때 만든다 */
  pitchRng: Rng | null = null;

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
    this.errOuts = 0;
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
    if (runner.earned && this.outs + this.errOuts < 3 && !ctx.rng.chance(ctx.env.unearnedRun)) {
      runner.resp.line.er++;
      runner.resp.er++;
      ctx.totals.er++;
    }
    const after = before + 1;
    // 블론 세이브: 세이브 상황(isSaveSituation)에 나온 구원 투수가 마운드에 있을 때 리드가 사라지면. 승리 투수가 될 수는 있다
    const cur = fld.pitcher;
    if (before === -1 && !cur.isStarter && !cur.blown && cur.saveSit) {
      cur.blown = true;
      if ((cur.entryInning ?? BLOWN_FROM_INNING) >= BLOWN_FROM_INNING) cur.line.bsv++;
      if (ctx.pen) tallyBlown(cur, runner.resp !== cur, ctx);
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
  note(kind: PlayKind, who: number, pit: number, r0: number, extra?: Pick<Play, 'seq' | 'np' | 'pt' | 'pz'>): void {
    const plays = this.ctx.plays;
    if (!plays) return;
    const play: Play = {
      inn: this.inning, top: !this.bat.isHome, kind, bat: who, pit, outs: Math.min(3, this.outs),
      bases: this.baseIdx(), away: this.away.runs, home: this.home.runs, runs: this.bat.runs - r0,
      ...(kind === 'E' && this.errFielder >= 0 ? { fielder: this.errFielder } : {}),
      ...extra,
    };
    plays.push(play);
  }
}
