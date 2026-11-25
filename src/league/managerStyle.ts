// 감독 작전 스타일 문구 (2026-11-12 사용자 그릴 Q39): 감독 효과 크기는 그대로 두고, 경기에 실제로 쓰는 작전 배율(managers.ts tacticsOf)을
// 낱말로 보여 준다. 숫자 배율은 드러내지 않는다. 선수 숨은 특수능력과는 관계없다 (감독 배율만 읽는다).
import type { Tactics } from './managers';

export interface StyleTag {
  /** 화면 문구 (예: 적극 도루) */
  label: string;
  /** 마우스를 올리면 보이는 설명 (숫자 없이) */
  note: string;
  /** 정렬용 세기 (문턱 대비 얼마나 벗어났나) */
  strength: number;
}

type Rule = { key: keyof Tactics; hi: number; lo: number; up: [string, string]; down: [string, string] };

/**
 * 문턱 (임시값): 2015년 뒤 감독을 맡은 실존 감독 44명의 경기 배율(tacticsOf) 20%·80% 분위 근처 (도루 0.98·1.06, 번트 0.95·1.04,
 * 투수 밀어붙이기 0.977·1.011, 불펜 연투 0.99·1.00, 컨디션 1.00·1.00: 자료 없는 감독이 1이라 가운데가 몰려 있다). 고의4구는 팀당 수가 적어 흔들림이 커서 넓게.
 * 대타·대주자(sub)는 실존 감독이 모두 1이라 가상 감독만 걸린다
 */
const RULES: Rule[] = [
  { key: 'steal', hi: 1.06, lo: 0.95, up: ['적극 도루', '주자가 나가면 자주 뛴다'], down: ['도루 자제', '무리한 도루를 피한다'] },
  { key: 'bunt', hi: 1.05, lo: 0.95, up: ['번트 선호', '희생번트로 주자를 자주 보낸다'], down: ['강공 선호', '번트보다 타자에게 맡긴다'] },
  { key: 'hook', hi: 1.025, lo: 0.975, up: ['선발 길게', '선발 투수를 오래 끌고 간다'], down: ['불펜 조기 투입', '선발 투수를 일찍 내리고 불펜을 쓴다'] },
  { key: 'pen', hi: 1.06, lo: 0.94, up: ['불펜 연투 마다 않음', '좋은 구원 투수를 연달아 낸다'], down: ['불펜 아끼기', '구원 투수 연투를 피한다'] },
  { key: 'sub', hi: 1.15, lo: 0.85, up: ['대타·대주자 자주', '경기 중 교체가 잦다'], down: ['교체 적게', '선발 라인업을 끝까지 믿는다'] },
  { key: 'ibb', hi: 1.3, lo: 0.7, up: ['고의4구 잦음', '위기에 거르는 승부를 자주 고른다'], down: ['정면 승부', '고의4구를 거의 쓰지 않는다'] },
  { key: 'cond', hi: 1.08, lo: 0.92, up: ['컨디션 따라 기용', '그날 몸 상태로 라인업과 선발을 바꾼다'], down: ['주전 고정', '컨디션보다 정해진 주전을 쓴다'] },
];

/** 작전 배율 → 스타일 문구 (센 것부터, 많아야 max개). 걸리는 것이 없으면 '정석 운영' 하나 */
export function managerStyle(t: Tactics, max = 3): StyleTag[] {
  const out: StyleTag[] = [];
  for (const r of RULES) {
    const v = t[r.key];
    if (v >= r.hi) out.push({ label: r.up[0], note: r.up[1], strength: (v - 1) / (r.hi - 1) });
    else if (v <= r.lo) out.push({ label: r.down[0], note: r.down[1], strength: (1 - v) / (1 - r.lo) });
  }
  out.sort((a, b) => b.strength - a.strength);
  return out.length ? out.slice(0, max) : [{ label: '정석 운영', note: '작전이 리그 평균에 가깝다', strength: 0 }];
}
