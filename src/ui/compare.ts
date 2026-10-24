// 리그 평균 대비 표시 (2026-10-23 UI 2단계 결정 1): 요약 표는 ▲▼ 모양 + 색, 상세는 리그 백분위 "상위 8%".
// 기준은 그 해 리그 표본(규정 이상 선수). 계산만 여기, 그리기는 parts.tsx의 VsLeague.

/** 리그 안 자리: 0~1 (1 = 가장 좋음). 표본이 없으면 null */
export function leagueRank(v: number, sample: readonly number[], higherBetter = true): number | null {
  const xs = sample.filter((x) => Number.isFinite(x));
  if (!xs.length || !Number.isFinite(v)) return null;
  // 같은 값은 절반만 센다 (중간 순위)
  let better = 0;
  let same = 0;
  for (const x of xs) {
    if (x === v) same++;
    else if (higherBetter ? x < v : x > v) better++;
  }
  return (better + same / 2) / xs.length;
}

/** "상위 N%" 문구의 N (1~100). 위에서 몇 % 안에 드는지 */
export function topPercent(rank: number): number {
  return Math.max(1, Math.min(100, Math.round((1 - rank) * 100)));
}

/** 요약 표의 모양: 상위 40% 안이면 ▲, 하위 40%면 ▼, 그 사이는 표시 없음 (경계는 임시값) */
export const VS_MARK_EDGE = 0.6;
export type VsMark = 'up' | 'down' | null;

export function vsMark(rank: number | null): VsMark {
  if (rank === null) return null;
  return rank >= VS_MARK_EDGE ? 'up' : rank <= 1 - VS_MARK_EDGE ? 'down' : null;
}
