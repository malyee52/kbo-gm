// 능력치 v2 16-3: 자료 없는 주루·작전·포수·투수 짝 능력의 시작값 (기획안 1.3~1.5, 9.5 결정 12).
// 실존 선수는 그 나이 평균, 가상 선수는 같은 곡선 + 분포에서 뽑은 값(선수 ID 시드라 해마다 같다). 포수 블로킹·프레이밍은 포수 수비 런에 비례해 조금 옮긴다.
// 월드를 만들 때마다 나이로 다시 내므로 커리어 중에도 곡선을 따르고, 저장 칸이 필요 없다 (훈련·성장 몫은 16-4).
// 손잡이 값은 리그 대비라 월드마다 출장량 가중 평균 등급을 영점으로 뺀다 (applyRunSkills).
// 도루 스타트·판단은 기록 성공률·시도율(sbPct·sbAtt)에 이미 들어 있어 0으로 둔다 (기록 밖 차이만 담는 손잡이).
// 어깨(16-3d, 12.6)는 몸 묶음 나이 곡선 + 평판 글의 어깨 낱말 (시작 연도 전 시기만). 포수 도루 저지(cArm)는 따로 기록으로 잰다.

import { normal } from './condition';
import type { DefenseData } from '../data/types';
import type { EngineParams } from './params';
import { Rng } from './rng';
import type { BatSkill, PitSkill, SimPlayer } from './types';

/** 경험 묶음 (주루 판단·견제·프레이밍·번트 수행) 나이 평균 등급: 21세 45, 22~31세 해마다 +0.8, 31세 뒤 53 그대로 (9.5, 임시값) */
export function experienceGrade(age: number | null): number {
  if (age === null) return 50;
  return 45 + 0.8 * (Math.min(31, Math.max(21, age)) - 21);
}

/**
 * 몸 묶음 (퀵모션·포수 블로킹) 나이 평균 등급: 21세 50 → 25세 51, 30세까지 51, 그 뒤 해마다 −0.6 (9.5 표: 33세 49·37세 46, 임시값).
 * 포수 도루 저지(cArm)는 기록으로 재므로 여기서 다루지 않는다
 */
export function bodyGrade(age: number | null): number {
  if (age === null) return 50;
  if (age <= 25) return 50 + 0.25 * (Math.max(21, age) - 21);
  if (age <= 30) return 51;
  return 51 - 0.6 * (age - 30);
}

/** 어깨 낱말 시기 무게: 시기 끝 + 3시즌까지 1, 그 뒤 해마다 × 0.7 (수비 평판과 같은 꼴, fielding.ts reputationWeight) */
const ARM_FULL_YEARS = 3;
const ARM_DECAY = 0.7;

/**
 * 평판 글의 어깨 낱말 → −1~1 (defense.json arm: [1 좋음 / −1 나쁨, 시기 시작, 시기 끝], 기획안 12.6·결정 28).
 * 앞날 평판(시기 시작 ≥ 시작 연도)은 버리고(결정 29: 시작 능력은 직전 자료에서), 시기 없는 평판은 무게 1, 남은 줄은 무게로 평균한다.
 * 무게가 1보다 작아도 평균이라 오래된 평판 하나만 있으면 그 값을 그대로 쓴다 (나이 곡선이 따로 내린다)
 */
export function armWord(entries: readonly (readonly [number, number | null, number | null])[] | undefined, startYear: number): number {
  let w = 0;
  let s = 0;
  for (const [level, from, to] of entries ?? []) {
    if (from !== null && from >= startYear) continue;
    const gap = from === null ? 0 : startYear - (to ?? startYear);
    const x = gap <= ARM_FULL_YEARS ? 1 : ARM_DECAY ** (gap - ARM_FULL_YEARS);
    w += x;
    s += x * level;
  }
  return w > 0 ? s / w : 0;
}

/** 어깨 낱말 자료와 시기를 거르는 시작 연도 (applyRunSkills) */
export interface ArmSource {
  arm: DefenseData['arm'];
  startYear: number;
}

type BatKnob = 'runIQ' | 'bunting' | 'cBlock' | 'cFrame' | 'arm';
type PitKnob = 'hold' | 'quick';

/** 등급 → 손잡이 값: (등급 − 50) ÷ 10 × 한 칸 폭 */
const toKnob = (grade: number, scale: number) => ((grade - 50) / 10) * scale;

/**
 * 선수 하나의 손잡이별 등급 (영점을 빼기 전). 가상 선수(real === false)만 분포 몫을 뽑는다 (난수: 선수 ID 시드, 리그 난수를 쓰지 않는다).
 * 어깨는 따로 난수 줄기(skill2-arm)라 앞 손잡이 값이 그대로다
 */
export function runGradesOf(p: Pick<SimPlayer, 'id' | 'age' | 'real' | 'bat' | 'pit'>, params: EngineParams, armSrc?: ArmSource): { bat?: Record<BatKnob, number>; pit?: Record<PitKnob, number> } {
  const sp = params.skill2;
  const rng = p.real === false ? new Rng(`skill2/${p.id}`) : null;
  const luck = () => (rng ? normal(rng) * sp.virtualSd : 0);
  const exp = experienceGrade(p.age);
  const body = bodyGrade(p.age);
  const out: { bat?: Record<BatKnob, number>; pit?: Record<PitKnob, number> } = {};
  if (p.bat) {
    // 정규 포수만 포수 수비 런으로 옮긴다 (런 = (등급 − 50) ÷ 2, 임시값 catcherPerRun 등급/런)
    const c = isCatcher(p.bat) ? p.bat.def?.C ?? 0 : 0;
    out.bat = {
      runIQ: exp + luck(),
      bunting: exp + luck(),
      cBlock: body + luck() + sp.catcherPerRun * c,
      cFrame: exp + luck() + sp.catcherPerRun * c,
      arm: body + (p.real === false ? normal(new Rng(`skill2-arm/${p.id}`)) * sp.virtualSd : 0)
        + (armSrc ? sp.armWord * armWord(armSrc.arm?.[p.id], armSrc.startYear) : 0),
    };
  }
  if (p.pit) out.pit = { hold: exp + luck(), quick: body + luck() };
  return out;
}

const isCatcher = (b: BatSkill) => !!b.playable?.includes('C');
const BAT_KNOBS: readonly BatKnob[] = ['runIQ', 'bunting', 'cBlock', 'cFrame', 'arm'];
const PIT_KNOBS: readonly PitKnob[] = ['hold', 'quick'];

/**
 * 월드의 모든 선수에게 손잡이를 붙인다 (bat·pit는 새 객체로 바꿔 리그 상태와 같이 쓰는 객체를 건드리지 않는다).
 * 손잡이 값은 리그 대비(기획안 1.1: 0 = 그 해 리그 평균)라, 등급에서 그 월드의 출장량(능력 표본 sample) 가중 평균을 뺀다.
 * 포수 블로킹·프레이밍의 평균은 정규 포수만으로 낸다 (포수 자리에 서는 선수). 돌려주는 값은 빼기 전 가중 평균 등급.
 * armSrc: 어깨 낱말 자료 (없으면 나이 곡선과 가상 선수 분포만)
 */
export function applyRunSkills(players: SimPlayer[], params: EngineParams, armSrc?: ArmSource): Record<BatKnob | PitKnob, number> {
  const sc = params.skill2.scale;
  const grades = players.map((p) => runGradesOf(p, params, armSrc));
  const zero = {} as Record<BatKnob | PitKnob, number>;
  const mean = (k: BatKnob | PitKnob, pick: (i: number) => { g: number; w: number } | null) => {
    let w = 0;
    let s = 0;
    for (let i = 0; i < players.length; i++) {
      const x = pick(i);
      if (!x) continue;
      w += x.w;
      s += x.w * x.g;
    }
    zero[k] = w > 0 ? s / w : 50;
  };
  for (const k of BAT_KNOBS) {
    const catcherOnly = k === 'cBlock' || k === 'cFrame';
    mean(k, (i) => {
      const p = players[i];
      const g = grades[i].bat;
      if (!g || p.isPitcher || (catcherOnly && !isCatcher(p.bat!))) return null;
      return { g: g[k], w: Math.max(1, p.bat!.sample) };
    });
  }
  for (const k of PIT_KNOBS) mean(k, (i) => (grades[i].pit && players[i].isPitcher ? { g: grades[i].pit![k], w: Math.max(1, players[i].pit!.sample) } : null));
  players.forEach((p, i) => {
    const g = grades[i];
    if (p.bat && g.bat) {
      const bat: BatSkill = { ...p.bat };
      for (const k of BAT_KNOBS) {
        const x = toKnob(g.bat[k] - zero[k] + 50, sc[k]);
        if (x) bat[k] = x;
        else delete bat[k];
      }
      p.bat = bat;
    }
    if (p.pit && g.pit) {
      const pit: PitSkill = { ...p.pit };
      for (const k of PIT_KNOBS) {
        const x = toKnob(g.pit[k] - zero[k] + 50, sc[k]);
        if (x) pit[k] = x;
        else delete pit[k];
      }
      p.pit = pit;
    }
  });
  return zero;
}

/** 손잡이를 뺀 능력 (리그 상태에 담을 때: 월드마다 다시 내는 값이라 저장하지 않는다) */
export function withoutRunSkills<T extends BatSkill | PitSkill | null | undefined>(s: T): T {
  if (!s) return s;
  const o = { ...s } as Record<string, unknown>;
  for (const k of [...BAT_KNOBS, ...PIT_KNOBS]) delete o[k];
  return o as T;
}
