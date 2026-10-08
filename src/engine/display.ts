// 화면용 능력치: 내부 비율을 20~80 등급으로 환산한다. 50 = 리그 주전 평균, 10 = 1 표준편차.

import type { Rates } from '../data/types';
import type { SimPlayer, World } from './types';

export interface BatterGrades {
  contact: number;
  power: number;
  eye: number;
  speed: number;
}

export interface PitcherGrades {
  stuff: number;
  control: number;
  hrSuppression: number;
  /** 선발로 나왔을 때의 체력 (한 경기에 상대하는 타자 수 기준) */
  stamina: number | null;
  /** 구원 체력: 한 번 등판에 상대하는 타자 수. 높으면 롱릴리프로 길게 던진다 */
  reliefStamina: number;
}

/** 등급의 기준 집단에 넣을 최소 표본 (가중 타석 / 가중 상대 타자) */
const MIN_BAT_SAMPLE = 300;
const MIN_PIT_SAMPLE = 200;

function batterRaw(p: SimPlayer, lg: Rates) {
  const b = p.bat!;
  const onBaseFree = b.bb * lg.bb + b.hbp * lg.hbp;
  const hits = b.s1 * lg.s1 + b.d2 * lg.d2 + b.t3 * lg.t3 + b.hr * lg.hr;
  const ab = 1 - onBaseFree;
  return {
    contact: hits / ab - 0.35 * ((b.so * lg.so) / ab), // 기대 타율에 삼진을 조금 반영
    power: (b.d2 * lg.d2 + 2 * b.t3 * lg.t3 + 3 * b.hr * lg.hr) / ab, // 기대 순장타율
    eye: b.bb * lg.bb,
    speed: b.speed,
  };
}

function pitcherRaw(p: SimPlayer, lg: Rates) {
  const s = p.pit!;
  return {
    stuff: s.so * lg.so,
    control: -s.bb * lg.bb,
    hrSuppression: -s.hr * lg.hr,
    stamina: s.stamina,
    reliefStamina: s.reliefStint,
  };
}

function scaler(values: number[]): (x: number) => number {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return (x) => Math.max(20, Math.min(80, Math.round(50 + (10 * (x - mean)) / sd)));
}

export interface DisplayGrades {
  batters: Map<string, BatterGrades>;
  pitchers: Map<string, PitcherGrades>;
}

export function computeGrades(world: World): DisplayGrades {
  const lg = world.league;
  const hitters = world.players.filter((p) => !p.isPitcher && p.bat);
  const pitchers = world.players.filter((p) => p.isPitcher && p.pit);
  const refB = hitters.filter((p) => p.bat!.sample >= MIN_BAT_SAMPLE).map((p) => batterRaw(p, lg));
  const refP = pitchers.filter((p) => p.pit!.sample >= MIN_PIT_SAMPLE).map((p) => pitcherRaw(p, lg));
  const refStarters = pitchers.filter((p) => p.pit!.sample >= MIN_PIT_SAMPLE && p.pit!.startShare >= 0.5).map((p) => pitcherRaw(p, lg));
  const refRelievers = pitchers.filter((p) => p.pit!.sample >= MIN_PIT_SAMPLE && p.pit!.startShare < 0.5).map((p) => pitcherRaw(p, lg));

  const sb = {
    contact: scaler(refB.map((r) => r.contact)), power: scaler(refB.map((r) => r.power)),
    eye: scaler(refB.map((r) => r.eye)), speed: scaler(refB.map((r) => r.speed)),
  };
  const sp = {
    stuff: scaler(refP.map((r) => r.stuff)), control: scaler(refP.map((r) => r.control)),
    hrSuppression: scaler(refP.map((r) => r.hrSuppression)), stamina: scaler(refStarters.map((r) => r.stamina)),
    relief: scaler(refRelievers.map((r) => r.reliefStamina)),
  };

  const batters = new Map<string, BatterGrades>();
  for (const p of hitters) {
    const r = batterRaw(p, lg);
    batters.set(p.id, { contact: sb.contact(r.contact), power: sb.power(r.power), eye: sb.eye(r.eye), speed: sb.speed(r.speed) });
  }
  const out = new Map<string, PitcherGrades>();
  for (const p of pitchers) {
    const r = pitcherRaw(p, lg);
    out.set(p.id, { stuff: sp.stuff(r.stuff), control: sp.control(r.control), hrSuppression: sp.hrSuppression(r.hrSuppression),
      stamina: sp.stamina(r.stamina),
      reliefStamina: sp.relief(r.reliefStamina),
    });
  }
  return { batters, pitchers: out };
}
