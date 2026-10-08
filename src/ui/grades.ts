// 기여(런)를 20~80 등급으로 (잠재력·종합 능력 표시용, 임시 환산).
// 15런(리그 평균 주전) = 50, 15런마다 10씩. 능력치 등급(display.ts)과 달리 리그 분포가 아니라 고정 환산이다.
export function runsGrade(runs: number): number {
  return Math.max(20, Math.min(80, Math.round(50 + ((runs - 15) / 15) * 10)));
}
